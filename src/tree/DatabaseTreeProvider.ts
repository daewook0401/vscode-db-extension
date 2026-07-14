import * as vscode from 'vscode';
import { ConnectionManager } from '../connection/ConnectionManager';
import { ConnectionProfile } from '../connection/ConnectionProfile';
import { ConnectionSessionManager } from '../connection/ConnectionSessionManager';
import { ColumnInfo, DatabaseObjectInfo, DatabaseObjectType, TableReference } from '../drivers/DbDriver';

export type TreeNode = ConnectionNode | SchemaNode | ObjectGroupNode | TableNode | ColumnNode;

interface ConnectionNode {
  kind: 'connection';
  profile: ConnectionProfile;
}

interface SchemaNode {
  kind: 'schema';
  profile: ConnectionProfile;
  schema: string;
}

interface ObjectGroupNode {
  kind: 'objectGroup';
  profile: ConnectionProfile;
  schema: string;
  group: ObjectGroup;
  objects: DatabaseObjectInfo[];
}

interface TableNode {
  kind: 'table';
  profile: ConnectionProfile;
  schema: string;
  table: string;
  object: DatabaseObjectInfo;
}

interface ColumnNode {
  kind: 'column';
  profile: ConnectionProfile;
  schema: string;
  table: string;
  column: ColumnInfo;
}

interface ObjectGroup {
  id: string;
  label: string;
  types: DatabaseObjectType[];
}

const OBJECT_GROUPS: ObjectGroup[] = [
  { id: 'tables', label: 'Tables', types: ['table', 'partitionedTable'] },
  { id: 'views', label: 'Views', types: ['view'] },
  { id: 'materialized-views', label: 'Materialized Views', types: ['materializedView'] },
  { id: 'foreign-tables', label: 'Foreign Tables', types: ['foreignTable'] }
];

export class DatabaseTreeProvider implements vscode.TreeDataProvider<TreeNode>, vscode.Disposable {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<TreeNode | undefined | null | void>();
  private readonly connectionSubscription: vscode.Disposable;

  public readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  constructor(
    private readonly connectionManager: ConnectionManager,
    private readonly sessionManager: ConnectionSessionManager
  ) {
    this.connectionSubscription = this.sessionManager.onDidChangeConnection(() => this.refresh());
  }

  public dispose(): void {
    this.connectionSubscription.dispose();
    this.onDidChangeTreeDataEmitter.dispose();
  }

  public refresh(element?: TreeNode): void {
    this.onDidChangeTreeDataEmitter.fire(element);
  }

  public getTreeItem(element: TreeNode): vscode.TreeItem {
    switch (element.kind) {
      case 'connection':
        return this.connectionItem(element);
      case 'schema':
        return this.schemaItem(element);
      case 'objectGroup':
        return this.objectGroupItem(element);
      case 'table':
        return this.tableItem(element);
      case 'column':
        return this.columnItem(element);
    }
  }

  public async getChildren(element?: TreeNode): Promise<TreeNode[]> {
    if (!element) {
      return this.connectionManager.getProfiles().map((profile) => ({
        kind: 'connection',
        profile
      }));
    }

    switch (element.kind) {
      case 'connection':
        return this.loadSchemas(element.profile);
      case 'schema':
        return this.loadObjectGroups(element.profile, element.schema);
      case 'objectGroup':
        return element.objects.map((object) => ({
          kind: 'table',
          profile: element.profile,
          schema: element.schema,
          table: object.name,
          object
        }));
      case 'table':
        return this.loadColumns(element.profile, element.schema, element.table);
      case 'column':
        return [];
    }
  }

  private connectionItem(element: ConnectionNode): vscode.TreeItem {
    const connected = this.sessionManager.isConnected(element.profile.id);
    const item = new vscode.TreeItem(element.profile.name, vscode.TreeItemCollapsibleState.Collapsed);
    item.id = `connection:${element.profile.id}`;
    item.description = `${element.profile.host}:${element.profile.port} / ${element.profile.database}`;
    item.tooltip = this.connectionTooltip(element.profile, connected ? 'connected' : 'disconnected');
    item.contextValue = 'connection';
    item.iconPath = new vscode.ThemeIcon(
      'database',
      new vscode.ThemeColor(connected ? 'testing.iconPassed' : 'disabledForeground')
    );
    return item;
  }

  private schemaItem(element: SchemaNode): vscode.TreeItem {
    const item = new vscode.TreeItem(element.schema, vscode.TreeItemCollapsibleState.Collapsed);
    item.id = `schema:${element.profile.id}:${encodeURIComponent(element.schema)}`;
    item.description = element.schema === element.profile.defaultSchema ? 'default' : undefined;
    item.contextValue = 'schema';
    item.iconPath = new vscode.ThemeIcon('symbol-namespace');
    return item;
  }

  private objectGroupItem(element: ObjectGroupNode): vscode.TreeItem {
    const item = new vscode.TreeItem(element.group.label, vscode.TreeItemCollapsibleState.Expanded);
    item.id = `group:${element.profile.id}:${encodeURIComponent(element.schema)}:${element.group.id}`;
    item.description = String(element.objects.length);
    item.contextValue = 'objectGroup';
    item.iconPath = new vscode.ThemeIcon('folder');
    return item;
  }

  private tableItem(element: TableNode): vscode.TreeItem {
    const tableRef: TableReference = {
      connection: element.profile,
      schema: element.schema,
      table: element.table
    };
    const item = new vscode.TreeItem(element.table, vscode.TreeItemCollapsibleState.Collapsed);
    item.id = `object:${element.profile.id}:${encodeURIComponent(element.schema)}:${encodeURIComponent(element.table)}`;
    item.description = this.objectDescription(element.object);
    item.tooltip = this.objectTooltip(element.schema, element.object);
    item.contextValue = 'table';
    item.iconPath = new vscode.ThemeIcon(this.objectIcon(element.object.type));
    item.command = {
      command: 'personalDbClient.openTable',
      title: 'Open Data',
      arguments: [tableRef]
    };
    return item;
  }

  private columnItem(element: ColumnNode): vscode.TreeItem {
    const item = new vscode.TreeItem(element.column.name, vscode.TreeItemCollapsibleState.None);
    const attributes = [
      element.column.dataType,
      element.column.isNullable ? '' : 'not null',
      element.column.isIdentity ? 'identity' : '',
      element.column.isGenerated ? 'generated' : ''
    ].filter(Boolean);
    item.id = `column:${element.profile.id}:${encodeURIComponent(element.schema)}:${encodeURIComponent(element.table)}:${encodeURIComponent(element.column.name)}`;
    item.description = attributes.join(' | ');
    item.tooltip = this.columnTooltip(element.column);
    item.contextValue = 'column';
    item.iconPath = new vscode.ThemeIcon(element.column.isPrimaryKey ? 'key' : 'symbol-field');
    return item;
  }

  private async loadSchemas(profile: ConnectionProfile): Promise<TreeNode[]> {
    try {
      const driver = await this.sessionManager.getDriver(profile);
      const schemas = await driver.listSchemas();
      return this.applySchemaFilters(profile, schemas).map((schema) => ({
        kind: 'schema',
        profile,
        schema
      }));
    } catch (error) {
      vscode.window.showErrorMessage(this.toErrorMessage(error));
      return [];
    }
  }

  private async loadObjectGroups(profile: ConnectionProfile, schema: string): Promise<TreeNode[]> {
    try {
      const driver = await this.sessionManager.getDriver(profile);
      const objects = await driver.listObjects(schema);
      return OBJECT_GROUPS
        .map((group): ObjectGroupNode => ({
          kind: 'objectGroup',
          profile,
          schema,
          group,
          objects: objects.filter((object) => group.types.includes(object.type))
        }))
        .filter((group) => group.objects.length > 0);
    } catch (error) {
      vscode.window.showErrorMessage(this.toErrorMessage(error));
      return [];
    }
  }

  private async loadColumns(profile: ConnectionProfile, schema: string, table: string): Promise<TreeNode[]> {
    try {
      const driver = await this.sessionManager.getDriver(profile);
      const columns = await driver.listColumns(schema, table);
      return columns.map((column) => ({
        kind: 'column',
        profile,
        schema,
        table,
        column
      }));
    } catch (error) {
      vscode.window.showErrorMessage(this.toErrorMessage(error));
      return [];
    }
  }

  private applySchemaFilters(profile: ConnectionProfile, schemas: string[]): string[] {
    const filters = new Set((profile.schemaFilters ?? []).map((schema) => schema.toLowerCase()));
    const filtered = filters.size === 0
      ? schemas
      : schemas.filter((schema) => filters.has(schema.toLowerCase()));
    const defaultSchema = profile.defaultSchema?.toLowerCase();
    return [...filtered].sort((left, right) => {
      if (defaultSchema) {
        if (left.toLowerCase() === defaultSchema) {
          return -1;
        }
        if (right.toLowerCase() === defaultSchema) {
          return 1;
        }
      }
      return left.localeCompare(right);
    });
  }

  private objectDescription(object: DatabaseObjectInfo): string | undefined {
    if (object.type === 'partitionedTable') {
      return object.estimatedRows === undefined ? 'partitioned' : `partitioned | ~${this.formatCount(object.estimatedRows)}`;
    }
    if (object.estimatedRows !== undefined) {
      return `~${this.formatCount(object.estimatedRows)}`;
    }
    return undefined;
  }

  private objectTooltip(schema: string, object: DatabaseObjectInfo): string {
    const lines = [
      `${schema}.${object.name}`,
      `Type: ${this.objectTypeLabel(object.type)}`
    ];
    if (object.estimatedRows !== undefined) {
      lines.push(`Estimated rows: ${object.estimatedRows.toLocaleString()}`);
    }
    return lines.join('\n');
  }

  private objectIcon(type: DatabaseObjectType): string {
    if (type === 'view' || type === 'materializedView') {
      return 'preview';
    }
    if (type === 'foreignTable') {
      return 'remote';
    }
    return 'table';
  }

  private objectTypeLabel(type: DatabaseObjectType): string {
    switch (type) {
      case 'table': return 'Table';
      case 'partitionedTable': return 'Partitioned table';
      case 'view': return 'View';
      case 'materializedView': return 'Materialized view';
      case 'foreignTable': return 'Foreign table';
    }
  }

  private columnTooltip(column: ColumnInfo): string {
    const lines = [
      `${column.name}: ${column.dataType}`,
      column.isNullable ? 'Nullable' : 'Not nullable'
    ];
    if (column.isPrimaryKey) lines.push('Primary key');
    if (column.isIdentity) lines.push('Identity');
    if (column.isGenerated) lines.push('Generated');
    if (column.columnDefault) lines.push(`Default: ${column.columnDefault}`);
    return lines.join('\n');
  }

  private connectionTooltip(profile: ConnectionProfile, status: string): string {
    const defaultSchema = profile.defaultSchema ? `Default schema: ${profile.defaultSchema}` : 'Default schema: not set';
    const filters = profile.schemaFilters?.length ? `Visible schemas: ${profile.schemaFilters.join(', ')}` : 'Visible schemas: all';
    return [
      `Status: ${status}`,
      `${profile.type} ${profile.host}:${profile.port}/${profile.database}`,
      `SSL: ${profile.sslMode ?? 'disable'}`,
      defaultSchema,
      filters,
      `Preview page size: ${profile.previewLimit ?? 100}`
    ].join('\n');
  }

  private formatCount(value: number): string {
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}m`;
    if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}k`;
    return String(value);
  }

  private toErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
