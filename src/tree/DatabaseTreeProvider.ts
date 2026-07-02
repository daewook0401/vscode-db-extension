import * as vscode from 'vscode';
import { ConnectionManager } from '../connection/ConnectionManager';
import { ConnectionProfile } from '../connection/ConnectionProfile';
import { TableReference } from '../drivers/DbDriver';

type TreeNode = ConnectionNode | SchemaNode | TableNode;

interface ConnectionNode {
  kind: 'connection';
  profile: ConnectionProfile;
}

interface SchemaNode {
  kind: 'schema';
  profile: ConnectionProfile;
  schema: string;
}

interface TableNode {
  kind: 'table';
  profile: ConnectionProfile;
  schema: string;
  table: string;
}

export class DatabaseTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<TreeNode | undefined | null | void>();

  public readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  constructor(private readonly connectionManager: ConnectionManager) {}

  public refresh(): void {
    this.onDidChangeTreeDataEmitter.fire();
  }

  public getTreeItem(element: TreeNode): vscode.TreeItem {
    if (element.kind === 'connection') {
      const item = new vscode.TreeItem(element.profile.name, vscode.TreeItemCollapsibleState.Collapsed);
      item.description = `${element.profile.type} ${element.profile.host}:${element.profile.port}/${element.profile.database}`;
      item.contextValue = 'connection';
      item.iconPath = new vscode.ThemeIcon('database');
      return item;
    }

    if (element.kind === 'schema') {
      const item = new vscode.TreeItem(element.schema, vscode.TreeItemCollapsibleState.Collapsed);
      item.contextValue = 'schema';
      item.iconPath = new vscode.ThemeIcon('symbol-namespace');
      return item;
    }

    const tableRef: TableReference = {
      connection: element.profile,
      schema: element.schema,
      table: element.table
    };
    const item = new vscode.TreeItem(element.table, vscode.TreeItemCollapsibleState.None);
    item.contextValue = 'table';
    item.iconPath = new vscode.ThemeIcon('table');
    item.command = {
      command: 'personalDbClient.openTable',
      title: 'Open Table',
      arguments: [tableRef]
    };
    return item;
  }

  public async getChildren(element?: TreeNode): Promise<TreeNode[]> {
    if (!element) {
      return this.connectionManager.getProfiles().map((profile) => ({
        kind: 'connection',
        profile
      }));
    }

    if (element.kind === 'connection') {
      return this.loadSchemas(element.profile);
    }

    if (element.kind === 'schema') {
      return this.loadTables(element.profile, element.schema);
    }

    return [];
  }

  private async loadSchemas(profile: ConnectionProfile): Promise<TreeNode[]> {
    const driver = await this.connectionManager.createDriver(profile);
    try {
      await driver.connect();
      const schemas = await driver.listSchemas();
      return schemas.map((schema) => ({
        kind: 'schema',
        profile,
        schema
      }));
    } catch (error) {
      vscode.window.showErrorMessage(this.toErrorMessage(error));
      return [];
    } finally {
      await driver.dispose();
    }
  }

  private async loadTables(profile: ConnectionProfile, schema: string): Promise<TreeNode[]> {
    const driver = await this.connectionManager.createDriver(profile);
    try {
      await driver.connect();
      const tables = await driver.listTables(schema);
      return tables.map((table) => ({
        kind: 'table',
        profile,
        schema,
        table
      }));
    } catch (error) {
      vscode.window.showErrorMessage(this.toErrorMessage(error));
      return [];
    } finally {
      await driver.dispose();
    }
  }

  private toErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
