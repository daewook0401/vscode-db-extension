const assert = require('node:assert/strict');
const test = require('node:test');
const {
  findMutatingKeywords,
  getStatementAtOffset,
  splitSqlStatements
} = require('../out/query/SqlText');

test('gets the statement at the cursor without splitting quoted semicolons', () => {
  const sql = "SELECT 'first;value';\nSELECT '두번째';";
  const statement = getStatementAtOffset(sql, sql.indexOf('두번째'));

  assert.equal(statement, "SELECT '두번째';");
});

test('does not treat a standard string backslash as an escaped quote', () => {
  const sql = "SELECT 'path\\';\nSELECT 7;";

  assert.equal(getStatementAtOffset(sql, sql.indexOf('7')), 'SELECT 7;');
});

test('supports PostgreSQL dollar-quoted bodies and nested comments', () => {
  const sql = [
    'DO $body$',
    'BEGIN',
    "  RAISE NOTICE 'inside;body';",
    'END',
    '$body$;',
    '/* outer /* inner; */ still outer */',
    'SELECT 42;'
  ].join('\n');

  const statements = splitSqlStatements(sql);
  assert.equal(statements.length, 2);
  assert.match(statements[0].text, /DO \$body\$/);
  assert.match(getStatementAtOffset(sql, sql.indexOf('42')), /SELECT 42;$/);
});

test('detects mutations anywhere in a multi-statement query', () => {
  const sql = 'SELECT 1;\nUPDATE users SET active = false;\nDELETE FROM audit_log;';

  assert.deepEqual(findMutatingKeywords(sql), ['UPDATE', 'DELETE']);
});

test('detects data-changing CTEs but ignores comments, strings, and quoted identifiers', () => {
  const mutating = 'WITH removed AS (DELETE FROM jobs RETURNING id) SELECT * FROM removed;';
  const readOnly = [
    "SELECT 'DELETE FROM users', \"update\" FROM messages;",
    '-- INSERT INTO hidden VALUES (1);',
    '/* DROP TABLE hidden; */'
  ].join('\n');

  assert.deepEqual(findMutatingKeywords(mutating), ['DELETE']);
  assert.deepEqual(findMutatingKeywords(readOnly), []);
});

test('does not treat ordinary column names as SQL commands', () => {
  const sql = 'SELECT comment, refresh, lock, execute FROM job_log;';

  assert.deepEqual(findMutatingKeywords(sql), []);
});
