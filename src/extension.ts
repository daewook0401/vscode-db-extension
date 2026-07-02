import * as vscode from 'vscode';
import { ConnectionManager } from './connection/ConnectionManager';
import { SecretManager } from './connection/SecretManager';
import { QueryExecutor } from './query/QueryExecutor';
import { DatabaseTreeProvider } from './tree/DatabaseTreeProvider';
import { ResultPanel } from './webview/ResultPanel';

export function activate(context: vscode.ExtensionContext): void {
  const secretManager = new SecretManager(context.secrets);
  const connectionManager = new ConnectionManager(context.globalState, secretManager);
  const resultPanel = new ResultPanel();
  const queryExecutor = new QueryExecutor(connectionManager, resultPanel);
  const treeProvider = new DatabaseTreeProvider(connectionManager);

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('personalDbClient.connections', treeProvider),
    vscode.commands.registerCommand('personalDbClient.addConnection', async () => {
      try {
        const profile = await connectionManager.addProfileFromInput();
        if (profile) {
          treeProvider.refresh();
          vscode.window.showInformationMessage(`Added DB connection "${profile.name}".`);
        }
      } catch (error) {
        vscode.window.showErrorMessage(toErrorMessage(error));
      }
    }),
    vscode.commands.registerCommand('personalDbClient.refresh', () => {
      treeProvider.refresh();
    }),
    vscode.commands.registerCommand('personalDbClient.openTable', async (tableRef) => {
      await queryExecutor.openTable(tableRef);
    }),
    vscode.commands.registerCommand('personalDbClient.runSelectedQuery', async () => {
      await queryExecutor.runSelectedQuery();
    })
  );
}

export function deactivate(): void {
  return undefined;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
