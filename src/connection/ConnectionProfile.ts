export type DatabaseType = 'postgres' | 'mysql';

export interface ConnectionProfile {
  id: string;
  name: string;
  type: DatabaseType;
  host: string;
  port: number;
  database: string;
  username: string;
}

export interface ConnectionProfileInput {
  name: string;
  type: DatabaseType;
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
}
