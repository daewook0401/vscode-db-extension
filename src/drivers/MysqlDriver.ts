import { ColumnInfo, DbDriver, QueryResult } from './DbDriver';

export class MysqlDriver implements DbDriver {
  public async connect(): Promise<void> {
    throw new Error('MySQL/MariaDB support is not implemented in this MVP.');
  }

  public async listSchemas(): Promise<string[]> {
    throw new Error('MySQL/MariaDB support is not implemented in this MVP.');
  }

  public async listTables(_schema: string): Promise<string[]> {
    throw new Error('MySQL/MariaDB support is not implemented in this MVP.');
  }

  public async listColumns(_schema: string, _table: string): Promise<ColumnInfo[]> {
    throw new Error('MySQL/MariaDB support is not implemented in this MVP.');
  }

  public async query(_sql: string): Promise<QueryResult> {
    throw new Error('MySQL/MariaDB support is not implemented in this MVP.');
  }

  public async dispose(): Promise<void> {
    return Promise.resolve();
  }
}
