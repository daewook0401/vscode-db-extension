import * as vscode from 'vscode';
import { ConnectionManager } from '../connection/ConnectionManager';
import { ConnectionSessionManager } from '../connection/ConnectionSessionManager';
import { ConnectionProfile } from '../connection/ConnectionProfile';
import { TableReference } from '../drivers/DbDriver';
import { ResultPanel } from '../webview/ResultPanel';
import { SqlGenerator, SqlTemplateType } from './SqlGenerator';

const DANGEROUS_SQL_PATTERN = /^\s*(insert|update|delete|truncate|drop|alter|create)\b/i;

export class QueryExecutor {
  private readonly sqlGenerator = new SqlGenerator();

  constructor(
    private readonly connectionManager: ConnectionManager,
    private readonly sessionManager: ConnectionSessionManager,
    private readonly resultPanel: ResultPanel
  ) {}

  public async openTable(tableRef: TableReference): Promise<void> {
    const limit = tableRef.connection.previewLimit ?? 100;
    const sql = `SELECT * FROM ${this.quoteIdentifier(tableRef.schema)}.${this.quoteIdentifier(tableRef.table)} LIMIT ${limit}`;
    await this.runQuery(tableRef.connection, sql, `${tableRef.schema}.${tableRef.table}`);
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
      await vscode.window.showTextDocument(document, vscode.ViewColumn.Beside);
    } catch (error) {
      vscode.window.showErrorMessage(this.toErrorMessage(error));
    }
  }

  public async runSelectedQuery(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('Open a SQL file before running a query.');
      return;
    }

    const sql = this.getSqlFromEditor(editor);
    if (!sql.trim()) {
      vscode.window.showWarningMessage('No SQL query found.');
      return;
    }

    const profile = await this.pickConnection();
    if (!profile) {
      return;
    }

    await this.runQuery(profile, sql, 'SQL Result');
  }

  private async runQuery(profile: ConnectionProfile, sql: string, title: string): Promise<void> {
    if (this.isDangerousSql(sql)) {
      const confirmed = await vscode.window.showWarningMessage(
        'This query can change database state. Do you want to continue?',
        { modal: true },
        'Run Query'
      );
      if (confirmed !== 'Run Query') {
        return;
      }
    }

    const driver = await this.sessionManager.getDriver(profile);
    try {
      const result = await driver.query(sql);
      this.resultPanel.show(title, result, {
        onRerun: () => this.runQuery(profile, sql, title)
      });
    } catch (error) {
      vscode.window.showErrorMessage(this.toErrorMessage(error));
    }
  }

  private isDangerousSql(sql: string): boolean {
    const normalizedSql = sql
      .replace(/^\s*--.*$/gm, '')
      .replace(/^\s*\/\*[\s\S]*?\*\//, '')
      .trimStart();

    return DANGEROUS_SQL_PATTERN.test(normalizedSql);
  }

  private getSqlFromEditor(editor: vscode.TextEditor): string {
    const selection = editor.selection;
    if (!selection.isEmpty) {
      return editor.document.getText(selection);
    }

    const documentText = editor.document.getText();
    const cursorOffset = editor.document.offsetAt(selection.active);
    const start = documentText.lastIndexOf(';', Math.max(0, cursorOffset - 1)) + 1;
    const nextStatementEnd = documentText.indexOf(';', cursorOffset);
    const end = nextStatementEnd === -1 ? documentText.length : nextStatementEnd + 1;

    return documentText.slice(start, end).trim();
  }

  private async pickConnection(): Promise<ConnectionProfile | undefined> {
    const profiles = this.connectionManager.getProfiles();
    if (profiles.length === 0) {
      vscode.window.showWarningMessage('Add a DB connection before running a query.');
      return undefined;
    }

    if (profiles.length === 1) {
      return profiles[0];
    }

    const selected = await vscode.window.showQuickPick(
      profiles.map((profile) => ({
        label: profile.name,
        description: `${profile.type} ${profile.host}:${profile.port}/${profile.database}`,
        profile
      })),
      {
        title: 'Select DB connection',
        placeHolder: 'Choose where to run this query'
      }
    );

    return selected?.profile;
  }

  private quoteIdentifier(identifier: string): string {
    return `"${identifier.replace(/"/g, '""')}"`;
  }

  private toErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
