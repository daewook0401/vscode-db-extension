import { Pool } from 'pg';
import { ConnectionProfile } from '../connection/ConnectionProfile';
import { ColumnInfo, DbDriver, QueryResult } from './DbDriver';

export class PostgresDriver implements DbDriver {
  private readonly pool: Pool;

  constructor(profile: ConnectionProfile, password: string) {
    this.pool = new Pool({
      host: profile.host,
      port: profile.port,
      database: profile.database,
      user: profile.username,
      password,
      max: 1
    });
    this.defaultSchema = profile.defaultSchema;
  }

  private readonly defaultSchema: string | undefined;

  public async connect(): Promise<void> {
    const client = await this.pool.connect();
    try {
      if (this.defaultSchema) {
        await client.query(`set search_path to ${this.quoteIdentifier(this.defaultSchema)}, public`);
      }
    } finally {
      client.release();
    }
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

  public async listColumns(schema: string, table: string): Promise<ColumnInfo[]> {
    const result = await this.pool.query<{
      column_name: string;
      data_type: string;
      is_nullable: 'YES' | 'NO';
      ordinal_position: number;
      column_default: string | null;
      is_primary_key: boolean;
    }>(
      `select
         c.column_name,
         c.data_type,
         c.is_nullable,
         c.ordinal_position,
         c.column_default,
         coalesce(tc.constraint_type = 'PRIMARY KEY', false) as is_primary_key
       from information_schema.columns c
       left join information_schema.key_column_usage kcu
         on c.table_schema = kcu.table_schema
        and c.table_name = kcu.table_name
        and c.column_name = kcu.column_name
       left join information_schema.table_constraints tc
         on kcu.constraint_schema = tc.constraint_schema
        and kcu.constraint_name = tc.constraint_name
        and tc.constraint_type = 'PRIMARY KEY'
       where c.table_schema = $1
         and c.table_name = $2
       order by c.ordinal_position`,
      [schema, table]
    );

    return result.rows.map((row) => ({
      name: row.column_name,
      dataType: row.data_type,
      isNullable: row.is_nullable === 'YES',
      ordinalPosition: row.ordinal_position,
      columnDefault: row.column_default ?? undefined,
      isPrimaryKey: row.is_primary_key
    }));
  }

  public async query(sql: string): Promise<QueryResult> {
    const startedAt = Date.now();
    const result = await this.pool.query(sql);
    const columns = result.fields.map((field) => field.name);
    return {
      columns,
      rows: result.rows as Record<string, unknown>[],
      rowCount: result.rowCount ?? result.rows.length,
      durationMs: Date.now() - startedAt,
      sql
    };
  }

  public async dispose(): Promise<void> {
    await this.pool.end();
  }

  private quoteIdentifier(identifier: string): string {
    return `"${identifier.replace(/"/g, '""')}"`;
  }
}
