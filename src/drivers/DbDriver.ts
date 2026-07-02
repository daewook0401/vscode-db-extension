import { ConnectionProfile } from '../connection/ConnectionProfile';

export interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
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
  query(sql: string): Promise<QueryResult>;
  dispose(): Promise<void>;
}

export interface DbDriverFactoryOptions {
  profile: ConnectionProfile;
  password: string;
}
