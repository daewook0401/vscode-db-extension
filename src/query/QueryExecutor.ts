import * as vscode from 'vscode';
import { ConnectionManager } from '../connection/ConnectionManager';
import { ConnectionProfile } from '../connection/ConnectionProfile';
import { ConnectionSessionManager } from '../connection/ConnectionSessionManager';
import { TableReference } from '../drivers/DbDriver';
import { ResultPanel } from '../webview/ResultPanel';
import { SqlGenerator, SqlTemplateType } from './SqlGenerator';
import { findMutatingKeywords, getStatementAtOffset } from './SqlText';

const QUERY_CONNECTIONS_KEY = 'personalDbClient.queryConnections';
const MAX_REMEMBERED_DOCUMENTS = 100;

export class QueryExecutor implements vscode.Disposable {
  private readonly sqlGenerator = new SqlGenerator();
  private readonly statusBarItem: vscode.StatusBarItem;
  private readonly subscriptions: vscode.Disposable[] = [];
  private readonly transientBindings = new Map<string, string>();

  constructor(
    private readonly connectionManager: ConnectionManager,
    private readonly sessionManager: ConnectionSessionManager,
    private readonly resultPanel: ResultPanel,
    private readonly state: vscode.Memento
  ) {
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
    this.statusBarItem.command = 'personalDbClient.selectQueryConnection';
    this.statusBarItem.name = 'DB Client Connection';
    this.subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor(() => this.refreshStatus()),
      vscode.workspace.onDidCloseTextDocument((document) => {
        this.transientBindings.delete(this.documentKey(document));
      }),
      this.sessionManager.onDidChangeConnection(() => this.refreshStatus())
    );
    this.refreshStatus();
  }

  public dispose(): void {
    this.statusBarItem.dispose();
    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }
    this.transientBindings.clear();
  }

  public refreshStatus(): void {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'sql') {
      this.statusBarItem.hide();
      return;
    }

    const profile = this.getBoundProfile(editor.document);
    if (!profile) {
      this.statusBarItem.text = '$(database) Select DB';
      this.statusBarItem.tooltip = 'Select the database connection for this SQL file';
      this.statusBarItem.show();
      return;
    }

    const status = this.sessionManager.isConnected(profile.id) ? 'Connected' : 'Disconnected';
    this.statusBarItem.text = `$(database) ${this.truncate(profile.name, 28)}`;
    this.statusBarItem.tooltip = `${status}\n${profile.host}:${profile.port}/${profile.database}`;
    this.statusBarItem.show();
  }

  public async bindDocument(document: vscode.TextDocument, profile: ConnectionProfile): Promise<void> {
    const documentKey = this.documentKey(document);
    if (document.isUntitled) {
      this.transientBindings.set(documentKey, profile.id);
      this.refreshStatus();
      return;
    }

    const bindings = this.getBindings();
    delete bindings[documentKey];
    bindings[documentKey] = profile.id;

    const entries = Object.entries(bindings).slice(-MAX_REMEMBERED_DOCUMENTS);
    await this.state.update(QUERY_CONNECTIONS_KEY, Object.fromEntries(entries));
    this.refreshStatus();
  }

  public async selectConnectionForActiveEditor(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'sql') {
      vscode.window.showWarningMessage('Open a SQL file before selecting a DB connection.');
      return;
    }

    const profile = await this.pickConnection(this.getBoundProfile(editor.document));
    if (profile) {
      await this.bindDocument(editor.document, profile);
      vscode.window.setStatusBarMessage(`DB Client: ${profile.name}`, 2500);
    }
  }

  public async openTable(tableRef: TableReference, offset = 0): Promise<void> {
    const limit = Math.max(1, Math.min(tableRef.connection.previewLimit ?? 100, 10000));
    const safeOffset = Math.max(0, Math.floor(offset));
    const sql = `SELECT * FROM ${this.quoteIdentifier(tableRef.schema)}.${this.quoteIdentifier(tableRef.table)} LIMIT ${limit + 1} OFFSET ${safeOffset}`;
    const title = `${tableRef.schema}.${tableRef.table}`;
    const panelKey = `table:${tableRef.connection.id}:${tableRef.schema}:${tableRef.table}`;

    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Window,
          title: `Loading ${title}`
        },
        async () => {
          const driver = await this.sessionManager.getDriver(tableRef.connection);
          const [queryResult, columns] = await Promise.all([
            driver.query(sql),
            driver.listColumns(tableRef.schema, tableRef.table)
          ]);
          const hasNext = queryResult.rows.length > limit;
          const rows = queryResult.rows.slice(0, limit);

          this.resultPanel.show(panelKey, title, {
            ...queryResult,
            rows,
            rowCount: rows.length
          }, {
            connectionLabel: tableRef.connection.name,
            table: {
              reference: tableRef,
              columns
            },
            pagination: {
              offset: safeOffset,
              limit,
              hasPrevious: safeOffset > 0,
              hasNext,
              onPage: (nextOffset) => this.openTable(tableRef, nextOffset)
            },
            onRerun: () => this.openTable(tableRef, safeOffset)
          });
        }
      );
    } catch (error) {
      vscode.window.showErrorMessage(this.toErrorMessage(error));
    }
  }

  public async generateSql(type: SqlTemplateType, tableRef: TableReference): Promise<void> {
    try {
      const driver = await this.sessionManager.getDriver(tableRef.connection);
      const columns = await driver.listColumns(tableRef.schema, tableRef.table);
      const sql = this.sqlGenerator.generate(type, tableRef, columns, tableRef.connection.previewLimit ?? 100);
      const document = await vscode.workspace.openTextDocument({
        language: 'sql',
        content: sql
      });
      await this.bindDocument(document, tableRef.connection);
      await vscode.window.showTextDocument(document, vscode.ViewColumn.Active);
    } catch (error) {
      vscode.window.showErrorMessage(this.toErrorMessage(error));
    }
  }

  public async runSelectedQuery(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'sql') {
      vscode.window.showWarningMessage('Open a SQL file before running a query.');
      return;
    }

    const sql = this.getSqlFromEditor(editor);
    if (!sql.trim()) {
      vscode.window.showWarningMessage('No SQL query found at the cursor.');
      return;
    }

    const profile = await this.resolveConnection(editor.document);
    if (!profile) {
      return;
    }

    const documentName = editor.document.fileName.split(/[\\/]/).pop() || 'SQL';
    await this.runQuery(profile, sql, `${documentName} Result`, `query:${this.documentKey(editor.document)}`);
  }

  private async runQuery(
    profile: ConnectionProfile,
    sql: string,
    title: string,
    panelKey: string
  ): Promise<void> {
    const mutatingKeywords = findMutatingKeywords(sql);
    if (mutatingKeywords.length > 0) {
      const confirmed = await vscode.window.showWarningMessage(
        `This query may change database state (${mutatingKeywords.join(', ')}). Continue on "${profile.name}"?`,
        { modal: true },
        'Run Query'
      );
      if (confirmed !== 'Run Query') {
        return;
      }
    }

    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Window,
          title: `Executing on ${profile.name}`
        },
        async () => {
          const driver = await this.sessionManager.getDriver(profile);
          const result = await driver.query(sql);
          this.resultPanel.show(panelKey, title, result, {
            connectionLabel: profile.name,
            onRerun: () => this.runQuery(profile, sql, title, panelKey)
          });
        }
      );
    } catch (error) {
      vscode.window.showErrorMessage(this.toErrorMessage(error));
    }
  }

  private getSqlFromEditor(editor: vscode.TextEditor): string {
    if (!editor.selection.isEmpty) {
      return editor.document.getText(editor.selection);
    }

    const documentText = editor.document.getText();
    const cursorOffset = editor.document.offsetAt(editor.selection.active);
    return getStatementAtOffset(documentText, cursorOffset);
  }

  private async resolveConnection(document: vscode.TextDocument): Promise<ConnectionProfile | undefined> {
    const boundProfile = this.getBoundProfile(document);
    if (boundProfile) {
      return boundProfile;
    }

    const profiles = this.connectionManager.getProfiles();
    if (profiles.length === 0) {
      vscode.window.showWarningMessage('Add a DB connection before running a query.');
      return undefined;
    }

    const profile = profiles.length === 1 ? profiles[0] : await this.pickConnection();
    if (profile) {
      await this.bindDocument(document, profile);
    }
    return profile;
  }

  private async pickConnection(currentProfile?: ConnectionProfile): Promise<ConnectionProfile | undefined> {
    const profiles = this.connectionManager.getProfiles();
    if (profiles.length === 0) {
      vscode.window.showWarningMessage('Add a DB connection before selecting one.');
      return undefined;
    }

    const selected = await vscode.window.showQuickPick(
      profiles.map((profile) => ({
        label: profile.id === currentProfile?.id ? `$(check) ${profile.name}` : profile.name,
        description: `${this.sessionManager.isConnected(profile.id) ? 'connected' : 'disconnected'} | ${profile.host}:${profile.port}/${profile.database}`,
        profile
      })),
      {
        title: 'Select DB connection',
        placeHolder: 'Use this connection for the active SQL file'
      }
    );

    return selected?.profile;
  }

  private getBoundProfile(document: vscode.TextDocument): ConnectionProfile | undefined {
    const documentKey = this.documentKey(document);
    const profileId = this.transientBindings.get(documentKey) ?? this.getBindings()[documentKey];
    return profileId ? this.connectionManager.getProfile(profileId) : undefined;
  }

  private getBindings(): Record<string, string> {
    const stored = this.state.get<Record<string, unknown>>(QUERY_CONNECTIONS_KEY, {});
    return Object.fromEntries(
      Object.entries(stored).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    );
  }

  private documentKey(document: vscode.TextDocument): string {
    return document.uri.toString();
  }

  private quoteIdentifier(identifier: string): string {
    return `"${identifier.replace(/"/g, '""')}"`;
  }

  private truncate(value: string, maximumLength: number): string {
    return value.length <= maximumLength ? value : `${value.slice(0, maximumLength - 3)}...`;
  }

  private toErrorMessage(error: unknown): string {
    if (!(error instanceof Error)) {
      return String(error);
    }

    const details = [error.message];
    const databaseError = error as Error & { detail?: string; hint?: string; position?: string };
    if (databaseError.detail) {
      details.push(`Detail: ${databaseError.detail}`);
    }
    if (databaseError.hint) {
      details.push(`Hint: ${databaseError.hint}`);
    }
    if (databaseError.position) {
      details.push(`Position: ${databaseError.position}`);
    }
    return details.join('\n');
  }
}
