const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const calls = {
  commands: [],
  create: [],
  reveal: [],
  showTextDocument: []
};
const sourceEditor = {
  document: { languageId: 'sql' },
  viewColumn: 1,
  selection: { start: 0, end: 0 }
};
const tabGroups = {
  all: [{ viewColumn: 1 }],
  activeTabGroup: { viewColumn: 1 }
};
const vscodeMock = {
  ViewColumn: { Active: -1, One: 1 },
  commands: {
    executeCommand: async (command) => {
      calls.commands.push(command);
      tabGroups.all = [{ viewColumn: 1 }, { viewColumn: 2 }];
      tabGroups.activeTabGroup = { viewColumn: 2 };
    }
  },
  window: {
    activeTextEditor: sourceEditor,
    tabGroups,
    createWebviewPanel: (_viewType, _title, showOptions) => {
      calls.create.push(showOptions);
      return {
        title: '',
        viewColumn: showOptions.viewColumn,
        webview: {
          cspSource: 'vscode-webview-test',
          html: '',
          onDidReceiveMessage: () => ({ dispose() {} })
        },
        onDidDispose: () => ({ dispose() {} }),
        reveal: (column, preserveFocus) => calls.reveal.push({ column, preserveFocus }),
        dispose() {}
      };
    },
    showTextDocument: async (document, options) => {
      calls.showTextDocument.push({ document, options });
      tabGroups.activeTabGroup = { viewColumn: options.viewColumn };
      return sourceEditor;
    }
  }
};

const originalLoad = Module._load;
Module._load = function loadWithVscodeMock(request, parent, isMain) {
  if (request === 'vscode') {
    return vscodeMock;
  }
  return originalLoad.call(this, request, parent, isMain);
};
const { ResultPanel } = require('../out/webview/ResultPanel');
Module._load = originalLoad;

test('creates one lower result group and reuses it for later result tabs', async () => {
  const resultPanel = new ResultPanel();
  const result = {
    columns: [{ name: 'id', dataType: 'integer' }],
    rows: [[1]],
    rowCount: 1,
    durationMs: 4,
    sql: 'SELECT 1 AS id'
  };
  const options = { connectionLabel: 'Local DB', placement: 'below' };

  await resultPanel.show('query:first', 'First Result', result, options);
  await resultPanel.show('query:second', 'Second Result', result, options);

  assert.deepEqual(calls.commands, ['workbench.action.newGroupBelow']);
  assert.equal(calls.create.length, 2);
  assert.deepEqual(calls.create.map((call) => call.viewColumn), [2, 2]);
  assert.ok(calls.create.every((call) => call.preserveFocus));
  assert.equal(calls.showTextDocument.length, 1);
  assert.equal(calls.showTextDocument[0].options.viewColumn, 1);
  assert.deepEqual(calls.reveal, [
    { column: 2, preserveFocus: true },
    { column: 2, preserveFocus: true }
  ]);
});
