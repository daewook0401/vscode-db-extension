const assert = require('node:assert/strict');
const test = require('node:test');
const { PostgresDriver } = require('../out/drivers/PostgresDriver');

const enabled = process.env.TEST_POSTGRES === '1';

test('PostgreSQL driver browses objects and preserves duplicate result columns', { skip: !enabled }, async () => {
  const profile = {
    id: 'integration',
    name: 'Integration PostgreSQL',
    type: 'postgres',
    host: process.env.TEST_PG_HOST || '127.0.0.1',
    port: Number(process.env.TEST_PG_PORT || 55432),
    database: process.env.TEST_PG_DATABASE || 'postgres',
    username: process.env.TEST_PG_USER || 'postgres',
    defaultSchema: 'public',
    schemaFilters: [],
    previewLimit: 100
  };
  const driver = new PostgresDriver(profile, process.env.TEST_PG_PASSWORD || 'test-password');

  try {
    await driver.connect();
    await driver.query('DROP SCHEMA IF EXISTS db_client_test CASCADE');
    await driver.query('CREATE SCHEMA db_client_test');
    await driver.query(`CREATE TABLE db_client_test.users (
      id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      display_name text NOT NULL,
      normalized_name text GENERATED ALWAYS AS (lower(display_name)) STORED
    )`);
    await driver.query("INSERT INTO db_client_test.users (display_name) VALUES ('Ada')");
    await driver.query('CREATE VIEW db_client_test.active_users AS SELECT id, display_name FROM db_client_test.users');
    await driver.query('CREATE TEMP TABLE db_client_temp_probe (id integer)');

    const schemas = await driver.listSchemas();
    const objects = await driver.listObjects('db_client_test');
    const columns = await driver.listColumns('db_client_test', 'users');
    const result = await driver.query(`SELECT left_side.id, right_side.id
      FROM db_client_test.users left_side
      JOIN db_client_test.users right_side ON right_side.id = left_side.id`);
    const multiStatementResult = await driver.query('SELECT 1 AS first_result; SELECT 2 AS second_result');

    assert.ok(schemas.includes('db_client_test'));
    assert.equal(schemas.some((schema) => /^pg_temp_[0-9]+$/.test(schema)), false);
    assert.equal(objects.find((object) => object.name === 'users')?.type, 'table');
    assert.equal(objects.find((object) => object.name === 'active_users')?.type, 'view');
    assert.equal(columns.find((column) => column.name === 'id')?.isPrimaryKey, true);
    assert.equal(columns.find((column) => column.name === 'id')?.isIdentity, true);
    assert.equal(columns.find((column) => column.name === 'normalized_name')?.isGenerated, true);
    assert.deepEqual(result.columns.map((column) => column.name), ['id', 'id']);
    assert.deepEqual(result.rows, [[1, 1]]);
    assert.deepEqual(multiStatementResult.columns.map((column) => column.name), ['second_result']);
    assert.deepEqual(multiStatementResult.rows, [[2]]);
  } finally {
    try {
      await driver.query('DROP SCHEMA IF EXISTS db_client_test CASCADE');
    } finally {
      await driver.dispose();
    }
  }
});
