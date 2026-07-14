export type DatabaseType = 'postgres' | 'mysql';
export type SslMode = 'disable' | 'require' | 'verify-full';

export interface ConnectionProfile {
  id: string;
  name: string;
  type: DatabaseType;
  host: string;
  port: number;
  database: string;
  username: string;
  sslMode?: SslMode;
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
  sslMode: SslMode;
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
  sslMode: SslMode;
  defaultSchema?: string;
  schemaFilters?: string[];
  previewLimit: number;
}
