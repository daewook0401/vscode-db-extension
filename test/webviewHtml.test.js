const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const originalLoad = Module._load;
Module._load = function loadWithVscodeMock(request, parent, isMain) {
  if (request === 'vscode') {
    return {};
  }
  return originalLoad.call(this, request, parent, isMain);
};

const { ConnectionPanel } = require('../out/webview/ConnectionPanel');
const { ResultPanel } = require('../out/webview/ResultPanel');
Module._load = originalLoad;

const webview = { cspSource: 'vscode-webview-test' };

test('result webview renders functional table controls and valid embedded JavaScript', () => {
  const panel = new ResultPanel();
  const profile = {
    id: 'test',
    name: 'Local DB',
    type: 'postgres',
    host: 'localhost',
    port: 5432,
    database: 'postgres',
    username: 'postgres'
  };
  const state = {
    key: 'table:test:public:users',
    panel: {},
    title: 'public.users',
    result: {
      columns: [
        { name: 'id', dataType: 'integer' },
        { name: 'id', dataType: 'integer' },
        { name: '<unsafe>', dataType: 'text' }
      ],
      rows: [[1, 1, '<script>alert(1)</script>']],
      rowCount: 1,
      durationMs: 12,
      sql: 'SELECT * FROM public.users LIMIT 101 OFFSET 0'
    },
    options: {
      connectionLabel: 'Local DB',
      table: {
        reference: { connection: profile, schema: 'public', table: 'users' },
        columns: [{
          name: 'id',
          dataType: 'integer',
          isNullable: false,
          ordinalPosition: 1,
          isPrimaryKey: true,
          isIdentity: true,
          isGenerated: false
        }]
      },
      pagination: {
        offset: 0,
        limit: 100,
        hasPrevious: false,
        hasNext: true,
        onPage: async () => {}
      },
      onRerun: async () => {}
    }
  };

  const html = panel.renderHtml(state, webview);

  assert.match(html, />Structure</);
  assert.match(html, /data-page-offset="100"/);
  assert.match(html, /Copy rows/);
  assert.match(html, /&lt;unsafe&gt;/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /ER Diagram|Mock|Manager/);
  assertEmbeddedScriptsCompile(html);
});

test('connection webview exposes test, offline save, SSL, and passwordless setup', () => {
  const panel = new ConnectionPanel('new', {
    connectionManager: {},
    sessionManager: {},
    onSaved: () => {}
  }, undefined);

  const html = panel.renderHtml(webview);

  assert.match(html, /Save &amp; Connect/);
  assert.match(html, /data-action="test"/);
  assert.match(html, /data-action="save"/);
  assert.match(html, /value="verify-full"/);
  assert.doesNotMatch(html, /name="password"[^>]*required/);
  assertEmbeddedScriptsCompile(html);
});

function assertEmbeddedScriptsCompile(html) {
  const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)];
  assert.ok(scripts.length > 0);
  for (const script of scripts) {
    assert.doesNotThrow(() => new Function(script[1]));
  }
}
