const assert = require('node:assert/strict');
const test = require('node:test');
const {
  findSqlTableReferences,
  getQualifierBeforeCursor
} = require('../out/completion/SqlCompletionContext');

test('detects schema, alias, and schema-table completion qualifiers', () => {
  assert.deepEqual(
    getQualifierBeforeCursor('SELECT * FROM ismp.', 'SELECT * FROM ismp.'.length),
    ['ismp']
  );
  assert.deepEqual(
    getQualifierBeforeCursor('SELECT member. FROM ismp.members member', 'SELECT member.'.length),
    ['member']
  );
  assert.deepEqual(
    getQualifierBeforeCursor('SELECT public."Order Items".', 'SELECT public."Order Items".'.length),
    ['public', 'Order Items']
  );
});

test('does not detect qualifiers inside SQL strings or comments', () => {
  const stringSql = "SELECT 'public.users.";
  const commentSql = 'SELECT 1 -- public.users.';

  assert.deepEqual(getQualifierBeforeCursor(stringSql, stringSql.length), []);
  assert.deepEqual(getQualifierBeforeCursor(commentSql, commentSql.length), []);
});

test('finds table references and aliases across common query clauses', () => {
  const sql = [
    'SELECT u.id, e.created_at',
    'FROM public.users AS u',
    'LEFT JOIN audit.events e ON e.user_id = u.id',
    'WHERE u.active = true'
  ].join('\n');

  assert.deepEqual(findSqlTableReferences(sql), [
    { schema: 'public', table: 'users', alias: 'u' },
    { schema: 'audit', table: 'events', alias: 'e' }
  ]);
});

test('does not mistake clause keywords for aliases', () => {
  assert.deepEqual(findSqlTableReferences('SELECT * FROM public.users WHERE active = true'), [
    { schema: 'public', table: 'users', alias: undefined }
  ]);
  assert.deepEqual(findSqlTableReferences('UPDATE public.users SET active = false'), [
    { schema: 'public', table: 'users', alias: undefined }
  ]);
});
