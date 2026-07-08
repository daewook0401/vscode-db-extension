import { ConnectionProfile } from '../connection/ConnectionProfile';

export interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
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
}

export interface TableReference {
  connection: ConnectionProfile;
  schema: string;
  table: string;
}

export interface DbDriver {
  connect(): Promise<void>;
  listSchemas(): Promise<string[]>;
  listTables(schema: string): Promise<string[]>;
  listColumns(schema: string, table: string): Promise<ColumnInfo[]>;
  query(sql: string): Promise<QueryResult>;
  dispose(): Promise<void>;
}

export interface DbDriverFactoryOptions {
  profile: ConnectionProfile;
  password: string;
}
