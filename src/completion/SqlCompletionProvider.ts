import * as vscode from 'vscode';
import type { ConnectionProfile } from '../connection/ConnectionProfile';
import type { ConnectionSessionManager } from '../connection/ConnectionSessionManager';
import type { ColumnInfo, DatabaseObjectInfo } from '../drivers/DbDriver';
import type { QueryExecutor } from '../query/QueryExecutor';
import { getStatementAtOffset } from '../query/SqlText';
import {
  findSqlTableReferences,
  getQualifierBeforeCursor
} from './SqlCompletionContext';
import type { SqlTableReference } from './SqlCompletionContext';

const METADATA_CACHE_TTL_MS = 60_000;
const SQL_KEYWORDS = [
  'SELECT',
  'FROM',
  'WHERE',
  'JOIN',
  'LEFT JOIN',
  'RIGHT JOIN',
  'INNER JOIN',
  'FULL JOIN',
  'CROSS JOIN',
  'ON',
  'USING',
  'AS',
  'DISTINCT',
  'GROUP BY',
  'ORDER BY',
  'HAVING',
  'LIMIT',
  'OFFSET',
  'INSERT INTO',
  'VALUES',
  'UPDATE',
  'SET',
  'DELETE FROM',
  'RETURNING',
  'WITH',
  'UNION',
  'UNION ALL',
  'CASE',
  'WHEN',
  'THEN',
  'ELSE',
  'END',
  'AND',
  'OR',
  'NOT',
  'NULL',
  'IS NULL',
  'IS NOT NULL',
  'IN',
  'EXISTS',
  'BETWEEN',
  'LIKE',
  'ILIKE',
  'ASC',
  'DESC',
  'BEGIN',
  'COMMIT',
  'ROLLBACK',
  'EXPLAIN',
  'ANALYZE'
];
const SQL_RESERVED_IDENTIFIERS = new Set([
  ...SQL_KEYWORDS.flatMap((keyword) => keyword.toLowerCase().split(' ')),
  'all',
  'any',
  'array',
  'asymmetric',
  'both',
  'cast',
  'check',
  'collate',
  'column',
  'constraint',
  'create',
  'current_catalog',
  'current_date',
  'current_role',
  'current_time',
  'current_timestamp',
  'current_user',
  'default',
  'deferrable',
  'false',
  'foreign',
  'initially',
  'lateral',
  'localtime',
  'localtimestamp',
  'only',
  'primary',
  'references',
  'session_user',
  'some',
  'symmetric',
  'table',
  'trailing',
  'true',
  'unique',
  'user',
  'variadic'
]);

interface MetadataCache {
  expiresAt: number;
  schemas?: Promise<string[]>;
  objects: Map<string, Promise<DatabaseObjectInfo[]>>;
  columns: Map<string, Promise<ColumnInfo[]>>;
}

export class SqlCompletionProvider implements vscode.CompletionItemProvider, vscode.Disposable {
  private readonly caches = new Map<string, MetadataCache>();
  private readonly connectionSubscription: vscode.Disposable;

  constructor(
    private readonly sessionManager: ConnectionSessionManager,
    private readonly queryExecutor: QueryExecutor
  ) {
    this.connectionSubscription = this.sessionManager.onDidChangeConnection((profileId) => {
      if (!profileId) {
        this.caches.clear();
      } else if (!this.sessionManager.isConnected(profileId)) {
        this.caches.delete(profileId);
      }
    });
  }

  public dispose(): void {
    this.connectionSubscription.dispose();
    this.caches.clear();
  }

  public async provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): Promise<vscode.CompletionList> {
    const sql = document.getText();
    const offset = document.offsetAt(position);
    const qualifier = getQualifierBeforeCursor(sql, offset);
    const keywordItems = qualifier.length === 0 ? this.keywordItems() : [];
    const profile = this.queryExecutor.getConnectionForDocument(document);
    if (!profile) {
      return new vscode.CompletionList(keywordItems, false);
    }

    try {
      const cache = this.getCache(profile);
      const schemas = await this.getSchemas(profile, cache);
      if (token.isCancellationRequested) {
        return new vscode.CompletionList(keywordItems, false);
      }

      const statement = getStatementAtOffset(sql, offset);
      const references = findSqlTableReferences(statement);
      const metadataItems = qualifier.length > 0
        ? await this.qualifiedItems(profile, cache, schemas, references, qualifier)
        : await this.unqualifiedItems(profile, cache, schemas, references);

      return new vscode.CompletionList(this.uniqueItems([...metadataItems, ...keywordItems]), false);
    } catch {
      return new vscode.CompletionList(keywordItems, false);
    }
  }

  private async qualifiedItems(
    profile: ConnectionProfile,
    cache: MetadataCache,
    schemas: string[],
    references: SqlTableReference[],
    qualifier: string[]
  ): Promise<vscode.CompletionItem[]> {
    if (qualifier.length === 2) {
      const schema = this.findIdentifier(schemas, qualifier[0]) ?? qualifier[0];
      const columns = await this.getColumns(profile, cache, schema, qualifier[1]);
      return this.columnItems(columns, `${schema}.${qualifier[1]}`);
    }

    const name = qualifier[0];
    const aliasReference = references.find((item) => this.identifiersEqual(item.alias, name));
    if (aliasReference) {
      const schema = this.resolveReferenceSchema(profile, schemas, aliasReference);
      if (schema) {
        const columns = await this.getColumns(profile, cache, schema, aliasReference.table);
        return this.columnItems(columns, `${schema}.${aliasReference.table}`);
      }
    }

    const schema = this.findIdentifier(schemas, name);
    if (schema) {
      const objects = await this.getObjects(profile, cache, schema);
      return this.objectItems(objects, schema);
    }

    const tableReference = references.find((item) => this.identifiersEqual(item.table, name));
    if (tableReference) {
      const referenceSchema = this.resolveReferenceSchema(profile, schemas, tableReference);
      if (referenceSchema) {
        const columns = await this.getColumns(profile, cache, referenceSchema, tableReference.table);
        return this.columnItems(columns, `${referenceSchema}.${tableReference.table}`);
      }
    }

    const defaultSchema = this.defaultSchema(profile, schemas);
    if (!defaultSchema) {
      return [];
    }
    const columns = await this.getColumns(profile, cache, defaultSchema, name);
    return this.columnItems(columns, `${defaultSchema}.${name}`);
  }

  private async unqualifiedItems(
    profile: ConnectionProfile,
    cache: MetadataCache,
    schemas: string[],
    references: SqlTableReference[]
  ): Promise<vscode.CompletionItem[]> {
    const items = this.schemaItems(schemas);
    const defaultSchema = this.defaultSchema(profile, schemas);
    if (defaultSchema) {
      const objects = await this.getObjects(profile, cache, defaultSchema);
      items.push(...this.objectItems(objects, defaultSchema));
    }

    const referencedColumns = await Promise.all(references.slice(0, 12).map(async (reference) => {
      const schema = this.resolveReferenceSchema(profile, schemas, reference);
      if (!schema) {
        return [];
      }
      const objects = await this.getObjects(profile, cache, schema);
      const object = objects.find((item) => this.identifiersEqual(item.name, reference.table));
      if (!object) {
        return [];
      }
      const columns = await this.getColumns(profile, cache, schema, object.name);
      return this.columnItems(columns, `${schema}.${object.name}`);
    }));
    items.push(...referencedColumns.flat());

    for (const reference of references) {
      if (!reference.alias) {
        continue;
      }
      const item = new vscode.CompletionItem(reference.alias, vscode.CompletionItemKind.Variable);
      item.detail = `alias | ${reference.schema ? `${reference.schema}.` : ''}${reference.table}`;
      item.insertText = this.quoteIdentifier(reference.alias);
      item.sortText = `0_alias_${reference.alias.toLowerCase()}`;
      item.commitCharacters = ['.'];
      items.push(item);
    }

    return items;
  }

  private schemaItems(schemas: string[]): vscode.CompletionItem[] {
    return schemas.map((schema) => {
      const item = new vscode.CompletionItem(schema, vscode.CompletionItemKind.Module);
      item.detail = 'schema';
      item.insertText = this.quoteIdentifier(schema);
      item.sortText = `1_schema_${schema.toLowerCase()}`;
      item.commitCharacters = ['.'];
      return item;
    });
  }

  private objectItems(objects: DatabaseObjectInfo[], schema: string): vscode.CompletionItem[] {
    return objects.map((object) => {
      const item = new vscode.CompletionItem(object.name, vscode.CompletionItemKind.Struct);
      item.detail = `${this.objectTypeLabel(object)} | ${schema}`;
      item.insertText = this.quoteIdentifier(object.name);
      item.sortText = `2_object_${object.name.toLowerCase()}`;
      item.commitCharacters = ['.'];
      return item;
    });
  }

  private columnItems(columns: ColumnInfo[], source: string): vscode.CompletionItem[] {
    return columns.map((column) => {
      const item = new vscode.CompletionItem(column.name, vscode.CompletionItemKind.Field);
      const constraints = [
        column.dataType,
        column.isPrimaryKey ? 'primary key' : '',
        column.isNullable ? '' : 'not null'
      ].filter(Boolean);
      item.detail = `${constraints.join(' | ')} | ${source}`;
      item.insertText = this.quoteIdentifier(column.name);
      item.sortText = `0_column_${String(column.ordinalPosition).padStart(5, '0')}`;
      return item;
    });
  }

  private keywordItems(): vscode.CompletionItem[] {
    return SQL_KEYWORDS.map((keyword) => {
      const item = new vscode.CompletionItem(keyword, vscode.CompletionItemKind.Keyword);
      item.insertText = keyword;
      item.detail = 'SQL keyword';
      item.sortText = `4_keyword_${keyword}`;
      return item;
    });
  }

  private getCache(profile: ConnectionProfile): MetadataCache {
    const cached = this.caches.get(profile.id);
    if (cached && cached.expiresAt > Date.now()) {
      return cached;
    }

    const cache: MetadataCache = {
      expiresAt: Date.now() + METADATA_CACHE_TTL_MS,
      objects: new Map(),
      columns: new Map()
    };
    this.caches.set(profile.id, cache);
    return cache;
  }

  private async getSchemas(profile: ConnectionProfile, cache: MetadataCache): Promise<string[]> {
    if (!cache.schemas) {
      cache.schemas = this.sessionManager.getDriver(profile)
        .then((driver) => driver.listSchemas())
        .then((schemas) => this.filterAndSortSchemas(profile, schemas))
        .catch((error) => {
          cache.schemas = undefined;
          throw error;
        });
    }
    return cache.schemas;
  }

  private async getObjects(
    profile: ConnectionProfile,
    cache: MetadataCache,
    schema: string
  ): Promise<DatabaseObjectInfo[]> {
    let pending = cache.objects.get(schema);
    if (!pending) {
      pending = this.sessionManager.getDriver(profile)
        .then((driver) => driver.listObjects(schema))
        .catch((error) => {
          cache.objects.delete(schema);
          throw error;
        });
      cache.objects.set(schema, pending);
    }
    return pending;
  }

  private async getColumns(
    profile: ConnectionProfile,
    cache: MetadataCache,
    schema: string,
    table: string
  ): Promise<ColumnInfo[]> {
    const key = `${schema}\u0000${table}`;
    let pending = cache.columns.get(key);
    if (!pending) {
      pending = this.sessionManager.getDriver(profile)
        .then((driver) => driver.listColumns(schema, table))
        .catch((error) => {
          cache.columns.delete(key);
          throw error;
        });
      cache.columns.set(key, pending);
    }
    return pending;
  }

  private filterAndSortSchemas(profile: ConnectionProfile, schemas: string[]): string[] {
    const filters = new Set((profile.schemaFilters ?? []).map((schema) => schema.toLowerCase()));
    const filtered = filters.size === 0
      ? schemas
      : schemas.filter((schema) => filters.has(schema.toLowerCase()));
    const defaultSchema = profile.defaultSchema?.toLowerCase();
    return [...filtered].sort((left, right) => {
      if (defaultSchema) {
        if (left.toLowerCase() === defaultSchema) {
          return -1;
        }
        if (right.toLowerCase() === defaultSchema) {
          return 1;
        }
      }
      return left.localeCompare(right);
    });
  }

  private defaultSchema(profile: ConnectionProfile, schemas: string[]): string | undefined {
    return this.findIdentifier(schemas, profile.defaultSchema)
      ?? this.findIdentifier(schemas, 'public')
      ?? schemas[0];
  }

  private resolveReferenceSchema(
    profile: ConnectionProfile,
    schemas: string[],
    reference: SqlTableReference
  ): string | undefined {
    return reference.schema
      ? this.findIdentifier(schemas, reference.schema) ?? reference.schema
      : this.defaultSchema(profile, schemas);
  }

  private findIdentifier(values: string[], value: string | undefined): string | undefined {
    if (!value) {
      return undefined;
    }
    return values.find((item) => item === value)
      ?? values.find((item) => this.identifiersEqual(item, value));
  }

  private identifiersEqual(left: string | undefined, right: string | undefined): boolean {
    return left !== undefined
      && right !== undefined
      && left.toLowerCase() === right.toLowerCase();
  }

  private quoteIdentifier(identifier: string): string {
    if (/^[a-z_][a-z0-9_$]*$/.test(identifier)
      && !SQL_RESERVED_IDENTIFIERS.has(identifier)) {
      return identifier;
    }
    return `"${identifier.replace(/"/g, '""')}"`;
  }

  private objectTypeLabel(object: DatabaseObjectInfo): string {
    switch (object.type) {
      case 'partitionedTable':
        return 'partitioned table';
      case 'materializedView':
        return 'materialized view';
      case 'foreignTable':
        return 'foreign table';
      default:
        return object.type;
    }
  }

  private uniqueItems(items: vscode.CompletionItem[]): vscode.CompletionItem[] {
    const seen = new Set<string>();
    return items.filter((item) => {
      const label = typeof item.label === 'string' ? item.label : item.label.label;
      const key = `${item.kind ?? ''}:${label.toLowerCase()}:${item.detail ?? ''}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }
}
