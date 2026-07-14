const assert = require('node:assert/strict');
const test = require('node:test');
const { SqlGenerator } = require('../out/query/SqlGenerator');

const tableRef = {
  connection: {
    id: 'test',
    name: 'Test',
    type: 'postgres',
    host: 'localhost',
    port: 5432,
    database: 'postgres',
    username: 'postgres'
  },
  schema: 'app data',
  table: 'user'
};

const columns = [
  {
    name: 'id',
    dataType: 'integer',
    isNullable: false,
    ordinalPosition: 1,
    isPrimaryKey: true,
    isIdentity: true,
    isGenerated: false
  },
  {
    name: 'display_name',
    dataType: 'text',
    isNullable: false,
    ordinalPosition: 2,
    isPrimaryKey: false,
    isIdentity: false,
    isGenerated: false
  },
  {
    name: 'search_name',
    dataType: 'text',
    isNullable: true,
    ordinalPosition: 3,
    isPrimaryKey: false,
    isIdentity: false,
    isGenerated: true
  }
];

test('quotes qualified identifiers and includes a preview limit', () => {
  const sql = new SqlGenerator().generate('select', tableRef, columns, 250);

  assert.match(sql, /FROM "app data"\."user"/);
  assert.match(sql, /LIMIT 250;/);
});

test('omits identity and generated columns from INSERT templates', () => {
  const sql = new SqlGenerator().generate('insert', tableRef, columns, 100);

  assert.match(sql, /"display_name"/);
  assert.match(sql, /'value' \/\* TODO: display_name/);
  assert.doesNotMatch(sql, /\n  "id"/);
  assert.doesNotMatch(sql, /"search_name"/);
});

test('uses primary keys for UPDATE and protects DELETE without a primary key', () => {
  const generator = new SqlGenerator();
  const updateSql = generator.generate('update', tableRef, columns, 100);
  const deleteSql = generator.generate(
    'delete',
    tableRef,
    columns.map((column) => ({ ...column, isPrimaryKey: false })),
    100
  );

  assert.match(updateSql, /WHERE "id" = 0/);
  assert.doesNotMatch(updateSql, /"search_name" =/);
  assert.match(deleteSql, /WHERE 1 = 0/);
});
