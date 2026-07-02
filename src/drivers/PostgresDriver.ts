import { Pool } from 'pg';
import { ConnectionProfile } from '../connection/ConnectionProfile';
import { DbDriver, QueryResult } from './DbDriver';

export class PostgresDriver implements DbDriver {
  private readonly pool: Pool;

  constructor(profile: ConnectionProfile, password: string) {
    this.pool = new Pool({
      host: profile.host,
      port: profile.port,
      database: profile.database,
      user: profile.username,
      password
    });
  }

  public async connect(): Promise<void> {
    const client = await this.pool.connect();
    client.release();
  }

  public async listSchemas(): Promise<string[]> {
    const result = await this.pool.query<{ schema_name: string }>(
      `select schema_name
       from information_schema.schemata
       where schema_name not in ('information_schema', 'pg_catalog')
         and schema_name not like 'pg_toast%'
       order by schema_name`
    );

    return result.rows.map((row) => row.schema_name);
  }

  public async listTables(schema: string): Promise<string[]> {
    const result = await this.pool.query<{ table_name: string }>(
      `select table_name
       from information_schema.tables
       where table_schema = $1
         and table_type = 'BASE TABLE'
       order by table_name`,
      [schema]
    );

    return result.rows.map((row) => row.table_name);
  }

  public async query(sql: string): Promise<QueryResult> {
    const result = await this.pool.query(sql);
    const columns = result.fields.map((field) => field.name);
    return {
      columns,
      rows: result.rows as Record<string, unknown>[]
    };
  }

  public async dispose(): Promise<void> {
    await this.pool.end();
  }
}
