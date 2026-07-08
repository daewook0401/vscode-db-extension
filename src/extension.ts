import * as vscode from 'vscode';
import { ConnectionManager } from './connection/ConnectionManager';
import { ConnectionSessionManager } from './connection/ConnectionSessionManager';
import { ConnectionProfile } from './connection/ConnectionProfile';
import { SecretManager } from './connection/SecretManager';
import { QueryExecutor } from './query/QueryExecutor';
import { DatabaseTreeProvider } from './tree/DatabaseTreeProvider';
import { TableReference } from './drivers/DbDriver';
import { ConnectionPanel } from './webview/ConnectionPanel';
import { ResultPanel } from './webview/ResultPanel';

let activeSessionManager: ConnectionSessionManager | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const secretManager = new SecretManager(context.secrets);
  const connectionManager = new ConnectionManager(context.globalState, secretManager);
  const sessionManager = new ConnectionSessionManager(connectionManager);
  const resultPanel = new ResultPanel();
  const queryExecutor = new QueryExecutor(connectionManager, sessionManager, resultPanel);
  const treeProvider = new DatabaseTreeProvider(connectionManager, sessionManager);
  activeSessionManager = sessionManager;

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('personalDbClient.connections', treeProvider),
    vscode.commands.registerCommand('personalDbClient.addConnection', () => {
      ConnectionPanel.showAdd({
        context,
        connectionManager,
        sessionManager,
        onSaved: () => treeProvider.refresh()
      });
    }),
    vscode.commands.registerCommand('personalDbClient.refresh', () => {
      treeProvider.refresh();
    }),
    vscode.commands.registerCommand('personalDbClient.openTable', async (tableRef) => {
      await queryExecutor.openTable(tableRef);
    }),
    vscode.commands.registerCommand('personalDbClient.newSqlPage', async (item) => {
      const profile = getConnectionProfile(item);
      await openNewSqlPage(context, profile);
    }),
    vscode.commands.registerCommand('personalDbClient.showConnectionActions', async (item) => {
      const profile = getConnectionProfile(item);
      await showConnectionActions({
        profile,
        connectionManager,
        sessionManager,
        treeProvider,
        context
      });
    }),
    vscode.commands.registerCommand('personalDbClient.testConnection', async (item) => {
      const profile = getConnectionProfile(item);
      if (!profile) {
        vscode.window.showWarningMessage('Select a DB connection first.');
        return;
      }

      try {
        await sessionManager.testConnection(profile);
        treeProvider.refresh();
        vscode.window.showInformationMessage(`Connected to "${profile.name}".`);
      } catch (error) {
        vscode.window.showErrorMessage(toErrorMessage(error));
      }
    }),
    vscode.commands.registerCommand('personalDbClient.editConnection', async (item) => {
      const profile = getConnectionProfile(item);
      if (!profile) {
        vscode.window.showWarningMessage('Select a DB connection first.');
        return;
      }

      ConnectionPanel.showEdit(
        {
          context,
          connectionManager,
          sessionManager,
          onSaved: () => treeProvider.refresh()
        },
        profile
      );
    }),
    vscode.commands.registerCommand('personalDbClient.deleteConnection', async (item) => {
      const profile = getConnectionProfile(item);
      if (!profile) {
        vscode.window.showWarningMessage('Select a DB connection first.');
        return;
      }

      try {
        await sessionManager.disconnect(profile.id);
        const deleted = await connectionManager.deleteProfile(profile);
        if (deleted) {
          treeProvider.refresh();
          vscode.window.showInformationMessage(`Deleted DB connection "${profile.name}".`);
        }
      } catch (error) {
        vscode.window.showErrorMessage(toErrorMessage(error));
      }
    }),
    vscode.commands.registerCommand('personalDbClient.disconnectConnection', async (item) => {
      const profile = getConnectionProfile(item);
      if (!profile) {
        vscode.window.showWarningMessage('Select a DB connection first.');
        return;
      }

      try {
        const disconnected = await sessionManager.disconnect(profile.id);
        treeProvider.refresh();
        vscode.window.showInformationMessage(
          disconnected ? `Disconnected "${profile.name}".` : `"${profile.name}" is already disconnected.`
        );
      } catch (error) {
        vscode.window.showErrorMessage(toErrorMessage(error));
      }
    }),
    vscode.commands.registerCommand('personalDbClient.configureSchemas', async (item) => {
      const profile = getConnectionProfile(item);
      if (!profile) {
        vscode.window.showWarningMessage('Select a DB connection first.');
        return;
      }

      try {
        const updatedProfile = await connectionManager.configureSchemas(profile);
        if (updatedProfile) {
          await sessionManager.disconnect(profile.id);
          treeProvider.refresh();
          vscode.window.showInformationMessage(`Updated schema settings for "${updatedProfile.name}".`);
        }
      } catch (error) {
        vscode.window.showErrorMessage(toErrorMessage(error));
      }
    }),
    vscode.commands.registerCommand('personalDbClient.generateSelectSql', async (item) => {
      await runTableCommand(item, (tableRef) => queryExecutor.generateSql('select', tableRef));
    }),
    vscode.commands.registerCommand('personalDbClient.generateInsertSql', async (item) => {
      await runTableCommand(item, (tableRef) => queryExecutor.generateSql('insert', tableRef));
    }),
    vscode.commands.registerCommand('personalDbClient.generateUpdateSql', async (item) => {
      await runTableCommand(item, (tableRef) => queryExecutor.generateSql('update', tableRef));
    }),
    vscode.commands.registerCommand('personalDbClient.generateDeleteSql', async (item) => {
      await runTableCommand(item, (tableRef) => queryExecutor.generateSql('delete', tableRef));
    }),
    vscode.commands.registerCommand('personalDbClient.runSelectedQuery', async () => {
      await queryExecutor.runSelectedQuery();
    })
  );
}

export async function deactivate(): Promise<void> {
  await activeSessionManager?.disconnectAll();
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getConnectionProfile(item: unknown): ConnectionProfile | undefined {
  if (isConnectionNode(item)) {
    return item.profile;
  }

  if (isConnectionProfile(item)) {
    return item;
  }

  return undefined;
}

async function runTableCommand(item: unknown, command: (tableRef: TableReference) => Promise<void>): Promise<void> {
  const tableRef = getTableReference(item);
  if (!tableRef) {
    vscode.window.showWarningMessage('Select a table first.');
    return;
  }

  await command(tableRef);
}

function getTableReference(item: unknown): TableReference | undefined {
  if (isTableNode(item)) {
    return {
      connection: item.profile,
      schema: item.schema,
      table: item.table
    };
  }

  if (isTableReference(item)) {
    return item;
  }

  return undefined;
}

function isConnectionNode(item: unknown): item is { kind: 'connection'; profile: ConnectionProfile } {
  return typeof item === 'object'
    && item !== null
    && 'kind' in item
    && item.kind === 'connection'
    && 'profile' in item;
}

function isTableNode(item: unknown): item is { kind: 'table'; profile: ConnectionProfile; schema: string; table: string } {
  return typeof item === 'object'
    && item !== null
    && 'kind' in item
    && item.kind === 'table'
    && 'profile' in item
    && 'schema' in item
    && 'table' in item;
}

function isConnectionProfile(item: unknown): item is ConnectionProfile {
  return typeof item === 'object'
    && item !== null
    && 'id' in item
    && 'host' in item
    && 'database' in item
    && 'username' in item;
}

function isTableReference(item: unknown): item is TableReference {
  return typeof item === 'object'
    && item !== null
    && 'connection' in item
    && 'schema' in item
    && 'table' in item;
}

async function openNewSqlPage(
  context: vscode.ExtensionContext,
  profile: ConnectionProfile | undefined
): Promise<void> {
  const sqlDirectory = vscode.Uri.joinPath(context.globalStorageUri, 'sql');
  await vscode.workspace.fs.createDirectory(sqlDirectory);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = profile
    ? `${sanitizeFileName(profile.name)}-${timestamp}.sql`
    : `query-${timestamp}.sql`;
  const uri = vscode.Uri.joinPath(sqlDirectory, fileName);
  const content = buildNewSqlContent(profile);

  await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(content));
  const document = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(document, vscode.ViewColumn.Beside);
}

function buildNewSqlContent(profile: ConnectionProfile | undefined): string {
  if (!profile) {
    return [
      '-- New SQL page',
      '-- Run with DB Client: Run Selected Query',
      '',
      ''
    ].join('\n');
  }

  const lines = [
    `-- Connection: ${profile.name}`,
    `-- Database: ${profile.host}:${profile.port}/${profile.database}`,
    '-- Run with DB Client: Run Selected Query',
    ''
  ];

  if (profile.defaultSchema) {
    lines.push(`SET search_path TO ${quoteIdentifier(profile.defaultSchema)}, public;`, '');
  }

  lines.push('');
  return lines.join('\n');
}

async function showConnectionActions(options: {
  profile: ConnectionProfile | undefined;
  connectionManager: ConnectionManager;
  sessionManager: ConnectionSessionManager;
  treeProvider: DatabaseTreeProvider;
  context: vscode.ExtensionContext;
}): Promise<void> {
  const items: Array<vscode.QuickPickItem & { action: string }> = [
    {
      label: 'New SQL Page',
      description: 'Create a saved SQL scratch file',
      action: 'newSqlPage'
    },
    {
      label: 'Add DB Connection',
      description: 'Register another database connection',
      action: 'addConnection'
    }
  ];

  if (options.profile) {
    items.push(
      {
        label: 'Manage Connection',
        description: 'Edit host, port, database, user, password, and schema settings',
        action: 'manageConnection'
      },
      {
        label: 'Configure Schemas',
        description: 'Set default schema, visible schemas, and preview limit',
        action: 'configureSchemas'
      },
      {
        label: 'Disconnect',
        description: 'Close this connection session',
        action: 'disconnect'
      },
      {
        label: 'Delete Connection',
        description: 'Remove this profile and stored password',
        action: 'deleteConnection'
      }
    );
  }

  const selected = await vscode.window.showQuickPick(items, {
    title: options.profile ? options.profile.name : 'DB Client',
    placeHolder: 'Choose an action'
  });
  if (!selected) {
    return;
  }

  await runConnectionAction(selected.action, options);
}

async function runConnectionAction(
  action: string,
  options: {
    profile: ConnectionProfile | undefined;
    connectionManager: ConnectionManager;
    sessionManager: ConnectionSessionManager;
    treeProvider: DatabaseTreeProvider;
    context: vscode.ExtensionContext;
  }
): Promise<void> {
  try {
    switch (action) {
      case 'newSqlPage':
        await openNewSqlPage(options.context, options.profile);
        return;
      case 'addConnection': {
        ConnectionPanel.showAdd({
          context: options.context,
          connectionManager: options.connectionManager,
          sessionManager: options.sessionManager,
          onSaved: () => options.treeProvider.refresh()
        });
        return;
      }
      case 'manageConnection': {
        if (!options.profile) {
          return;
        }
        ConnectionPanel.showEdit(
          {
            context: options.context,
            connectionManager: options.connectionManager,
            sessionManager: options.sessionManager,
            onSaved: () => options.treeProvider.refresh()
          },
          options.profile
        );
        return;
      }
      case 'configureSchemas': {
        if (!options.profile) {
          return;
        }
        const updatedProfile = await options.connectionManager.configureSchemas(options.profile);
        if (updatedProfile) {
          await options.sessionManager.disconnect(options.profile.id);
          options.treeProvider.refresh();
          vscode.window.showInformationMessage(`Updated schema settings for "${updatedProfile.name}".`);
        }
        return;
      }
      case 'disconnect': {
        if (!options.profile) {
          return;
        }
        const disconnected = await options.sessionManager.disconnect(options.profile.id);
        options.treeProvider.refresh();
        vscode.window.showInformationMessage(
          disconnected ? `Disconnected "${options.profile.name}".` : `"${options.profile.name}" is already disconnected.`
        );
        return;
      }
      case 'deleteConnection': {
        if (!options.profile) {
          return;
        }
        await options.sessionManager.disconnect(options.profile.id);
        const deleted = await options.connectionManager.deleteProfile(options.profile);
        if (deleted) {
          options.treeProvider.refresh();
          vscode.window.showInformationMessage(`Deleted DB connection "${options.profile.name}".`);
        }
        return;
      }
    }
  } catch (error) {
    vscode.window.showErrorMessage(toErrorMessage(error));
  }
}

function sanitizeFileName(value: string): string {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'connection';
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}
