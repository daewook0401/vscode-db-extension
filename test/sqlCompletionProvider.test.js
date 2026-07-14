const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

class CompletionItem {
  constructor(label, kind) {
    this.label = label;
    this.kind = kind;
  }
}

class CompletionList {
  constructor(items, isIncomplete) {
    this.items = items;
    this.isIncomplete = isIncomplete;
  }
}

const vscodeMock = {
  CompletionItem,
  CompletionList,
  CompletionItemKind: {
    Field: 1,
    Keyword: 2,
    Module: 3,
    Struct: 4,
    Variable: 5
  }
};
const originalLoad = Module._load;
Module._load = function loadWithVscodeMock(request, parent, isMain) {
  if (request === 'vscode') {
    return vscodeMock;
  }
  return originalLoad.call(this, request, parent, isMain);
};
const { SqlCompletionProvider } = require('../out/completion/SqlCompletionProvider');
Module._load = originalLoad;

test('suggests cached schemas, default-schema objects, and alias columns', async () => {
  const calls = { schemas: 0, objects: 0, columns: 0 };
  const driver = {
    listSchemas: async () => {
      calls.schemas += 1;
      return ['public', 'ismp'];
    },
    listObjects: async (schema) => {
      calls.objects += 1;
      return schema === 'ismp'
        ? [{ name: 'members', type: 'table' }, { name: 'user', type: 'table' }]
        : [];
    },
    listColumns: async (schema, table) => {
      calls.columns += 1;
      assert.equal(schema, 'ismp');
      assert.equal(table, 'members');
      return [{
        name: 'member_id',
        dataType: 'varchar',
        isNullable: false,
        ordinalPosition: 1,
        isPrimaryKey: true,
        isIdentity: false,
        isGenerated: false
      }];
    }
  };
  const sessionManager = {
    getDriver: async () => driver,
    isConnected: () => true,
    onDidChangeConnection: () => ({ dispose() {} })
  };
  const profile = {
    id: 'local',
    name: 'Local',
    type: 'postgres',
    host: 'localhost',
    port: 5432,
    database: 'postgres',
    username: 'postgres',
    defaultSchema: 'ismp'
  };
  const queryExecutor = { getConnectionForDocument: () => profile };
  const provider = new SqlCompletionProvider(sessionManager, queryExecutor);
  const token = { isCancellationRequested: false };

  const generic = await complete(provider, 'SELECT * FROM mem', token);
  assert.ok(labels(generic).includes('members'));
  assert.ok(labels(generic).includes('ismp'));
  assert.ok(labels(generic).includes('SELECT'));
  assert.equal(generic.items.find((item) => item.label === 'user').insertText, '"user"');

  const schemaQualified = await complete(provider, 'SELECT * FROM ismp.', token);
  assert.deepEqual(labels(schemaQualified), ['members', 'user']);

  const selectListSql = 'SELECT  FROM ismp.members AS m';
  const selectList = await complete(provider, selectListSql, token, 'SELECT '.length);
  assert.ok(labels(selectList).includes('member_id'));
  assert.ok(labels(selectList).includes('m'));

  const aliasSql = 'SELECT m. FROM ismp.members AS m';
  const aliasQualified = await complete(provider, aliasSql, token, 'SELECT m.'.length);
  assert.deepEqual(labels(aliasQualified), ['member_id']);

  assert.deepEqual(calls, { schemas: 1, objects: 1, columns: 1 });
  provider.dispose();
});

async function complete(provider, sql, token, offset = sql.length) {
  const document = {
    getText: () => sql,
    offsetAt: (position) => position.offset
  };
  return provider.provideCompletionItems(document, { offset }, token);
}

function labels(completionList) {
  return completionList.items.map((item) => (
    typeof item.label === 'string' ? item.label : item.label.label
  ));
}
