import { Pool } from 'pg';
import { ConnectionProfile } from '../connection/ConnectionProfile';
import { ColumnInfo, DatabaseObjectInfo, DatabaseObjectType, DbDriver, QueryResult } from './DbDriver';

const POSTGRES_TYPE_NAMES = new Map<number, string>([
  [16, 'boolean'],
  [17, 'bytea'],
  [20, 'bigint'],
  [21, 'smallint'],
  [23, 'integer'],
  [25, 'text'],
  [26, 'oid'],
  [114, 'json'],
  [700, 'real'],
  [701, 'double precision'],
  [790, 'money'],
  [829, 'macaddr'],
  [869, 'inet'],
  [1042, 'character'],
  [1043, 'varchar'],
  [1082, 'date'],
  [1083, 'time'],
  [1114, 'timestamp'],
  [1184, 'timestamptz'],
  [1186, 'interval'],
  [1266, 'timetz'],
  [1560, 'bit'],
  [1562, 'varbit'],
  [1700, 'numeric'],
  [2950, 'uuid'],
  [3802, 'jsonb']
]);

export class PostgresDriver implements DbDriver {
  private readonly pool: Pool;

  constructor(profile: ConnectionProfile, password: string) {
    this.pool = new Pool({
      host: profile.host,
      port: profile.port,
      database: profile.database,
      user: profile.username,
      password,
      ssl: this.sslOptions(profile.sslMode),
      max: 1,
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 30000,
      application_name: 'vscode-personal-db-client'
    });
    this.pool.on('error', (error) => {
      console.error('[Personal DB Client] Unexpected PostgreSQL pool error', error);
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
         and schema_name !~ '^pg_temp_[0-9]+$'
       order by schema_name`
    );

    return result.rows.map((row) => row.schema_name);
  }

  public async listObjects(schema: string): Promise<DatabaseObjectInfo[]> {
    const result = await this.pool.query<{
      object_name: string;
      object_type: DatabaseObjectType;
      estimated_rows: string | number | null;
    }>(
      `select
         c.relname as object_name,
         case c.relkind
           when 'r' then 'table'
           when 'p' then 'partitionedTable'
           when 'v' then 'view'
           when 'm' then 'materializedView'
           when 'f' then 'foreignTable'
         end as object_type,
         case when c.reltuples >= 0 then round(c.reltuples)::bigint else null end as estimated_rows
       from pg_catalog.pg_class c
       join pg_catalog.pg_namespace n on n.oid = c.relnamespace
       where n.nspname = $1
         and c.relkind in ('r', 'p', 'v', 'm', 'f')
       order by c.relname`,
      [schema]
    );

    return result.rows.map((row) => ({
      name: row.object_name,
      type: row.object_type,
      estimatedRows: row.estimated_rows === null ? undefined : Number(row.estimated_rows)
    }));
  }

  public async listColumns(schema: string, table: string): Promise<ColumnInfo[]> {
    const result = await this.pool.query<{
      column_name: string;
      data_type: string;
      is_nullable: 'YES' | 'NO';
      ordinal_position: number;
      column_default: string | null;
      is_primary_key: boolean;
      is_identity: 'YES' | 'NO';
      is_generated: 'ALWAYS' | 'NEVER';
    }>(
      `select
         c.column_name,
         c.data_type,
         c.is_nullable,
         c.ordinal_position,
         c.column_default,
         exists (
           select 1
           from information_schema.table_constraints tc
           join information_schema.key_column_usage kcu
             on kcu.constraint_schema = tc.constraint_schema
            and kcu.constraint_name = tc.constraint_name
           where tc.constraint_type = 'PRIMARY KEY'
             and tc.table_schema = c.table_schema
             and tc.table_name = c.table_name
             and kcu.column_name = c.column_name
         ) as is_primary_key,
         c.is_identity,
         c.is_generated
       from information_schema.columns c
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
      isPrimaryKey: row.is_primary_key,
      isIdentity: row.is_identity === 'YES',
      isGenerated: row.is_generated === 'ALWAYS'
    }));
  }

  public async query(sql: string): Promise<QueryResult> {
    const startedAt = Date.now();
    const response = await this.pool.query({
      text: sql,
      rowMode: 'array'
    });
    const results = Array.isArray(response) ? response : [response];
    const result = results[results.length - 1];
    if (!result) {
      return {
        columns: [],
        rows: [],
        rowCount: 0,
        durationMs: Date.now() - startedAt,
        sql
      };
    }
    const columns = result.fields.map((field: { name: string; dataTypeID: number }) => ({
      name: field.name,
      dataType: POSTGRES_TYPE_NAMES.get(field.dataTypeID) ?? `oid:${field.dataTypeID}`
    }));
    return {
      columns,
      rows: result.rows as unknown[][],
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

  private sslOptions(mode: ConnectionProfile['sslMode']): false | { rejectUnauthorized: boolean } {
    if (mode === 'verify-full') {
      return { rejectUnauthorized: true };
    }
    if (mode === 'require') {
      return { rejectUnauthorized: false };
    }
    return false;
  }
}
