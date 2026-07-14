import { ConnectionProfile } from '../connection/ConnectionProfile';

export interface QueryColumn {
  name: string;
  dataType: string;
}

export interface QueryResult {
  columns: QueryColumn[];
  rows: unknown[][];
  rowCount: number;
  durationMs: number;
  sql: string;
}

export interface ColumnInfo {
  name: string;
  dataType: string;
  isNullable: boolean;
  ordinalPosition: number;
  columnDefault?: string;
  isPrimaryKey: boolean;
  isIdentity: boolean;
  isGenerated: boolean;
}

export type DatabaseObjectType = 'table' | 'partitionedTable' | 'view' | 'materializedView' | 'foreignTable';

export interface DatabaseObjectInfo {
  name: string;
  type: DatabaseObjectType;
  estimatedRows?: number;
}

export interface TableReference {
  connection: ConnectionProfile;
  schema: string;
  table: string;
}

export interface DbDriver {
  connect(): Promise<void>;
  listSchemas(): Promise<string[]>;
  listObjects(schema: string): Promise<DatabaseObjectInfo[]>;
  listColumns(schema: string, table: string): Promise<ColumnInfo[]>;
  query(sql: string): Promise<QueryResult>;
  dispose(): Promise<void>;
}

export interface DbDriverFactoryOptions {
  profile: ConnectionProfile;
  password: string;
}
