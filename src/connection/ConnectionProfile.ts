export type DatabaseType = 'postgres' | 'mysql';

export interface ConnectionProfile {
  id: string;
  name: string;
  type: DatabaseType;
  host: string;
  port: number;
  database: string;
  username: string;
  defaultSchema?: string;
  schemaFilters?: string[];
  previewLimit?: number;
}

export interface ConnectionProfileInput {
  name: string;
  type: DatabaseType;
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  defaultSchema?: string;
  schemaFilters?: string[];
  previewLimit: number;
}

export interface ConnectionProfileUpdateInput {
  name: string;
  type: DatabaseType;
  host: string;
  port: number;
  database: string;
  username: string;
  password?: string;
  defaultSchema?: string;
  schemaFilters?: string[];
  previewLimit: number;
}
