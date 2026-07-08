import { ColumnInfo, TableReference } from '../drivers/DbDriver';

export type SqlTemplateType = 'select' | 'insert' | 'update' | 'delete';

export class SqlGenerator {
  public generate(type: SqlTemplateType, tableRef: TableReference, columns: ColumnInfo[], limit: number): string {
    switch (type) {
      case 'select':
        return this.generateSelect(tableRef, columns, limit);
      case 'insert':
        return this.generateInsert(tableRef, columns);
      case 'update':
        return this.generateUpdate(tableRef, columns);
      case 'delete':
        return this.generateDelete(tableRef, columns);
    }
  }

  private generateSelect(tableRef: TableReference, columns: ColumnInfo[], limit: number): string {
    const selectColumns = columns.length > 0
      ? columns.map((column) => `  ${this.quoteIdentifier(column.name)}`).join(',\n')
      : '  *';

    return `SELECT
${selectColumns}
FROM ${this.qualifiedTable(tableRef)}
LIMIT ${limit};`;
  }

  private generateInsert(tableRef: TableReference, columns: ColumnInfo[]): string {
    const insertColumns = columns.filter((column) => !this.shouldSkipInsertColumn(column));
    if (insertColumns.length === 0) {
      return `INSERT INTO ${this.qualifiedTable(tableRef)}
DEFAULT VALUES;`;
    }

    const columnList = insertColumns.map((column) => `  ${this.quoteIdentifier(column.name)}`).join(',\n');
    const values = insertColumns
      .map((column) => `  ${this.placeholderFor(column)}`)
      .join(',\n');

    return `INSERT INTO ${this.qualifiedTable(tableRef)} (
${columnList}
) VALUES (
${values}
);`;
  }

  private generateUpdate(tableRef: TableReference, columns: ColumnInfo[]): string {
    const primaryKeys = columns.filter((column) => column.isPrimaryKey);
    const updateColumns = columns.filter((column) => !column.isPrimaryKey);
    const assignments = updateColumns
      .map((column) => `  ${this.quoteIdentifier(column.name)} = ${this.placeholderFor(column)}`)
      .join(',\n') || '  /* TODO: add column assignment */';
    const whereClause = this.buildWhereClause(primaryKeys);

    return `UPDATE ${this.qualifiedTable(tableRef)}
SET
${assignments}
${whereClause};`;
  }

  private generateDelete(tableRef: TableReference, columns: ColumnInfo[]): string {
    const primaryKeys = columns.filter((column) => column.isPrimaryKey);
    const whereClause = this.buildWhereClause(primaryKeys);

    return `DELETE FROM ${this.qualifiedTable(tableRef)}
${whereClause};`;
  }

  private buildWhereClause(primaryKeys: ColumnInfo[]): string {
    if (primaryKeys.length === 0) {
      return 'WHERE 1 = 0 /* TODO: replace with a safe condition */';
    }

    return primaryKeys
      .map((column, index) => `${index === 0 ? 'WHERE' : '  AND'} ${this.quoteIdentifier(column.name)} = ${this.placeholderFor(column)}`)
      .join('\n');
  }

  private shouldSkipInsertColumn(column: ColumnInfo): boolean {
    const defaultValue = column.columnDefault?.toLowerCase() ?? '';
    return defaultValue.includes('nextval(') || defaultValue.includes('generated');
  }

  private placeholderFor(column: ColumnInfo): string {
    return `NULL /* ${column.name}: ${column.dataType} */`;
  }

  private qualifiedTable(tableRef: TableReference): string {
    return `${this.quoteIdentifier(tableRef.schema)}.${this.quoteIdentifier(tableRef.table)}`;
  }

  private quoteIdentifier(identifier: string): string {
    return `"${identifier.replace(/"/g, '""')}"`;
  }
}
