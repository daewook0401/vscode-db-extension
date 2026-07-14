import * as os from 'os';
import * as vscode from 'vscode';
import { ColumnInfo, QueryResult, TableReference } from '../drivers/DbDriver';

interface ResultPanelOptions {
  connectionLabel: string;
  onRerun?: () => Promise<void>;
  table?: {
    reference: TableReference;
    columns: ColumnInfo[];
  };
  pagination?: {
    offset: number;
    limit: number;
    hasPrevious: boolean;
    hasNext: boolean;
    onPage: (offset: number) => Promise<void>;
  };
}

interface PanelState {
  key: string;
  panel: vscode.WebviewPanel;
  title: string;
  result: QueryResult;
  options: ResultPanelOptions;
}

export class ResultPanel implements vscode.Disposable {
  private readonly panels = new Map<string, PanelState>();

  public dispose(): void {
    for (const state of [...this.panels.values()]) {
      state.panel.dispose();
    }
    this.panels.clear();
  }

  public show(
    key: string,
    title: string,
    result: QueryResult,
    options: ResultPanelOptions
  ): void {
    let state = this.panels.get(key);
    if (!state) {
      const panel = vscode.window.createWebviewPanel(
        'personalDbClient.results',
        title,
        vscode.ViewColumn.Active,
        {
          enableScripts: true,
          retainContextWhenHidden: true
        }
      );
      state = { key, panel, title, result, options };
      this.panels.set(key, state);

      panel.onDidDispose(() => {
        if (this.panels.get(key)?.panel === panel) {
          this.panels.delete(key);
        }
      });
      panel.webview.onDidReceiveMessage((message) => {
        const currentState = this.panels.get(key);
        if (currentState) {
          void this.handleMessage(currentState, message);
        }
      });
    } else {
      state.title = title;
      state.result = result;
      state.options = options;
    }

    state.panel.title = title;
    state.panel.webview.html = this.renderHtml(state, state.panel.webview);
    state.panel.reveal(vscode.ViewColumn.Active);
  }

  private async handleMessage(state: PanelState, message: unknown): Promise<void> {
    if (!this.isResultMessage(message)) {
      return;
    }

    if (message.command === 'rerun') {
      await this.runPanelAction(state, state.options.onRerun);
      return;
    }

    if (message.command === 'page') {
      const offset = Number(message.offset);
      const onPage = state.options.pagination?.onPage;
      if (Number.isInteger(offset) && offset >= 0 && onPage) {
        await this.runPanelAction(state, () => onPage(offset));
      }
      return;
    }

    if (message.command === 'copySql') {
      await vscode.env.clipboard.writeText(state.result.sql);
      vscode.window.setStatusBarMessage('DB Client: SQL copied', 2500);
      return;
    }

    if (message.command === 'copyRows') {
      await this.copyRows(state.result, message.indices);
      return;
    }

    if (message.command === 'copyCell') {
      await this.copyCell(state.result, message.row, message.column);
      return;
    }

    if (message.command === 'exportCsv') {
      await this.exportCsv(state.title, state.result);
    }
  }

  private async runPanelAction(state: PanelState, action: (() => Promise<void>) | undefined): Promise<void> {
    if (!action) {
      return;
    }

    await state.panel.webview.postMessage({ command: 'busy', value: true });
    try {
      await action();
    } catch (error) {
      vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      await state.panel.webview.postMessage({ command: 'busy', value: false });
    }
  }

  private renderHtml(state: PanelState, webview: vscode.Webview): string {
    const { result, options, title } = state;
    const nonce = this.createNonce();
    const rowOffset = options.pagination?.offset ?? 0;
    const header = result.columns
      .map((column) => `<th>
        <div class="column-name">${this.escapeHtml(column.name)}</div>
        <div class="column-type">${this.escapeHtml(column.dataType)}</div>
      </th>`)
      .join('');
    const rows = result.rows
      .map((row, rowIndex) => {
        const cells = result.columns
          .map((_, columnIndex) => this.renderCell(row[columnIndex], rowIndex, columnIndex))
          .join('');
        return `<tr class="data-row" data-index="${rowIndex}" data-row-text="${this.escapeAttribute(this.rowSearchText(row))}">
          <td class="selector"><input class="row-select" type="checkbox" data-index="${rowIndex}" aria-label="Select row ${rowOffset + rowIndex + 1}"></td>
          <td class="row-number">${rowOffset + rowIndex + 1}</td>
          ${cells}
        </tr>`;
      })
      .join('');
    const dataTable = result.columns.length === 0
      ? `<div class="empty">Query completed. ${result.rowCount} row(s) affected.</div>`
      : `<table class="data-table">
          <thead>
            <tr>
              <th class="selector"><input id="select-all" type="checkbox" aria-label="Select all visible rows"></th>
              <th class="row-number">#</th>
              ${header}
            </tr>
          </thead>
          <tbody id="result-body">${rows}</tbody>
        </table>`;
    const structureTab = options.table
      ? '<button class="section-tab" type="button" data-view="structure">Structure</button>'
      : '';
    const structureView = options.table
      ? `<section id="structure-view" class="content-view structure-view" hidden>${this.renderStructure(options.table.columns)}</section>`
      : '';
    const pagination = this.renderPagination(options, result.rows.length);
    const completedAt = new Date().toLocaleTimeString();
    const compactSql = result.sql.replace(/\s+/g, ' ').trim();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${this.escapeHtml(title)}</title>
  <style>
    :root {
      --db-bg: var(--vscode-editor-background);
      --db-panel: var(--vscode-sideBar-background);
      --db-border: var(--vscode-panel-border, var(--vscode-editorGroup-border));
      --db-text: var(--vscode-foreground);
      --db-muted: var(--vscode-descriptionForeground);
      --db-accent: var(--vscode-textLink-foreground);
      --db-positive: var(--vscode-testing-iconPassed, #73c991);
      --db-cell: color-mix(in srgb, var(--vscode-editor-background) 96%, var(--vscode-foreground));
      --db-hover: var(--vscode-list-hoverBackground);
      --db-selection: var(--vscode-list-activeSelectionBackground);
    }
    * { box-sizing: border-box; }
    html, body { height: 100%; }
    body {
      margin: 0;
      overflow: hidden;
      color: var(--db-text);
      background: var(--db-bg);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }
    button, input { font: inherit; }
    button:focus-visible, input:focus-visible {
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: -1px;
    }
    [hidden] { display: none !important; }
    .workbench {
      display: grid;
      grid-template-rows: 34px 34px minmax(0, 1fr) auto;
      height: 100vh;
      min-width: 0;
    }
    .context-bar {
      display: flex;
      align-items: stretch;
      justify-content: space-between;
      min-width: 0;
      border-bottom: 1px solid var(--db-border);
      background: var(--db-panel);
    }
    .section-tabs { display: flex; min-width: 0; }
    .section-tab {
      position: relative;
      min-width: 82px;
      height: 34px;
      padding: 0 12px;
      border: 0;
      color: var(--db-muted);
      background: transparent;
      cursor: pointer;
    }
    .section-tab:hover { color: var(--db-text); background: var(--db-hover); }
    .section-tab.active { color: var(--db-text); }
    .section-tab.active::after {
      content: '';
      position: absolute;
      right: 10px;
      bottom: 0;
      left: 10px;
      height: 2px;
      background: var(--vscode-focusBorder);
    }
    .connection-label {
      display: flex;
      align-items: center;
      min-width: 0;
      max-width: 42%;
      padding: 0 12px;
      color: var(--db-muted);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .query-line {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
      padding: 0 8px 0 12px;
      border-bottom: 1px solid var(--db-border);
      background: var(--db-bg);
    }
    .query-line code {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      color: var(--vscode-editor-foreground);
      font-family: var(--vscode-editor-font-family);
      white-space: nowrap;
      text-overflow: ellipsis;
    }
    .content-view { min-width: 0; min-height: 0; }
    .data-view {
      display: grid;
      grid-template-rows: 38px minmax(0, 1fr);
    }
    .toolbar {
      display: flex;
      align-items: center;
      gap: 4px;
      min-width: 0;
      padding: 4px 8px;
      overflow-x: auto;
      border-bottom: 1px solid var(--db-border);
      background: var(--db-panel);
      scrollbar-width: thin;
    }
    .filter {
      flex: 0 0 220px;
      height: 27px;
      padding: 0 8px;
      border: 1px solid var(--vscode-input-border, transparent);
      color: var(--vscode-input-foreground);
      background: var(--vscode-input-background);
    }
    .tool-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 5px;
      height: 27px;
      min-width: 28px;
      padding: 0 7px;
      border: 0;
      color: var(--db-text);
      background: transparent;
      white-space: nowrap;
      cursor: pointer;
    }
    .tool-button:hover:not(:disabled) { background: var(--db-hover); }
    .tool-button:disabled { color: var(--vscode-disabledForeground); cursor: default; }
    .tool-button.primary { color: var(--db-positive); }
    .tool-button.compact { padding: 0 6px; }
    .toolbar-separator {
      width: 1px;
      height: 20px;
      margin: 0 3px;
      background: var(--db-border);
    }
    .toolbar-spacer { flex: 1 0 16px; }
    .meta {
      color: var(--db-muted);
      white-space: nowrap;
    }
    .duration { color: var(--db-accent); }
    .grid-wrap, .structure-view {
      min-width: 0;
      min-height: 0;
      overflow: auto;
      background: var(--db-bg);
    }
    table {
      width: max-content;
      min-width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
    }
    th, td {
      min-width: 130px;
      max-width: 360px;
      padding: 6px 8px;
      overflow: hidden;
      border-right: 1px solid var(--db-border);
      border-bottom: 1px solid color-mix(in srgb, var(--db-border) 65%, transparent);
      background: var(--db-cell);
      text-align: left;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    th {
      position: sticky;
      top: 0;
      z-index: 2;
      height: 43px;
      background: var(--db-panel);
    }
    tbody tr:hover td { background: var(--db-hover); }
    tbody tr:has(.row-select:checked) td { background: var(--db-selection); }
    .selector, .row-number {
      position: sticky;
      left: 0;
      z-index: 1;
      width: 42px;
      min-width: 42px;
      max-width: 42px;
      color: var(--db-muted);
      background: var(--db-panel);
      text-align: center;
    }
    .row-number { left: 42px; }
    th.selector, th.row-number { z-index: 3; }
    .column-name { color: var(--db-text); font-weight: 600; }
    .column-type { margin-top: 3px; color: var(--db-muted); font-size: 11px; }
    .null-value { color: var(--db-muted); font-style: italic; }
    .structure-table th, .structure-table td { min-width: 120px; }
    .structure-table .column-wide { min-width: 240px; }
    .key-badge { color: var(--vscode-symbolIcon-keyForeground, var(--db-accent)); font-weight: 600; }
    .empty { padding: 18px; color: var(--db-muted); }
    .log-panel {
      display: grid;
      grid-template-rows: 30px minmax(0, 86px);
      min-height: 30px;
      border-top: 1px solid var(--db-border);
      background: var(--db-panel);
    }
    .log-heading {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 8px 0 12px;
      color: var(--db-muted);
      border-bottom: 1px solid var(--db-border);
    }
    .log-content {
      margin: 0;
      padding: 8px 12px;
      overflow: auto;
      color: var(--db-muted);
      font-family: var(--vscode-editor-font-family);
      font-size: 12px;
      white-space: pre-wrap;
    }
    .log-ok { color: var(--db-positive); }
    @media (max-width: 680px) {
      .filter { flex-basis: 150px; }
      .connection-label { max-width: 34%; }
      .tool-label { display: none; }
    }
  </style>
</head>
<body>
  <main class="workbench">
    <header class="context-bar">
      <nav class="section-tabs" aria-label="Result views">
        <button class="section-tab active" type="button" data-view="data">Data</button>
        ${structureTab}
      </nav>
      <div class="connection-label" title="${this.escapeAttribute(options.connectionLabel)}">DB: ${this.escapeHtml(options.connectionLabel)}</div>
    </header>
    <div class="query-line">
      <code title="${this.escapeAttribute(compactSql)}">${this.escapeHtml(compactSql)}</code>
      <button id="copy-sql" class="tool-button compact" type="button" title="Copy SQL">Copy SQL</button>
    </div>
    <section id="data-view" class="content-view data-view">
      <div class="toolbar">
        <input id="filter" class="filter" placeholder="Search rows" aria-label="Search rows">
        <button id="rerun" class="tool-button primary" type="button" title="Run query again" data-busy-action>▶ <span class="tool-label">Run</span></button>
        <button id="copy-rows" class="tool-button" type="button" title="Copy selected rows as tab-separated values" disabled>Copy rows</button>
        <button id="export-csv" class="tool-button" type="button" title="Export displayed rows to CSV">Export CSV</button>
        <span class="toolbar-separator"></span>
        <span id="visible-count" class="meta">${result.rows.length} shown</span>
        <span class="meta duration">${result.durationMs}ms</span>
        <span class="toolbar-spacer"></span>
        ${pagination}
      </div>
      <div class="grid-wrap">${dataTable}</div>
    </section>
    ${structureView}
    <section id="log-panel" class="log-panel">
      <div class="log-heading">
        <span>Execution log</span>
        <button id="toggle-log" class="tool-button compact" type="button" title="Collapse execution log">⌃</button>
      </div>
      <pre id="log-content" class="log-content"><span class="log-ok">Completed in ${result.durationMs}ms</span>
${this.escapeHtml(completedAt)}  ${this.escapeHtml(options.connectionLabel)}
${this.escapeHtml(result.sql)}
${result.rowCount} row(s) affected, ${result.rows.length} row(s) displayed</pre>
    </section>
  </main>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const savedState = vscode.getState() || {};
    const filter = document.getElementById('filter');
    const rows = [...document.querySelectorAll('.data-row')];
    const visibleCount = document.getElementById('visible-count');
    const copyRowsButton = document.getElementById('copy-rows');
    const selectAll = document.getElementById('select-all');
    const logPanel = document.getElementById('log-panel');
    const logContent = document.getElementById('log-content');
    const toggleLog = document.getElementById('toggle-log');

    const persistState = (changes) => {
      Object.assign(savedState, changes);
      vscode.setState(savedState);
    };
    const updateSelection = () => {
      const selected = [...document.querySelectorAll('.row-select:checked')];
      if (copyRowsButton) {
        copyRowsButton.disabled = selected.length === 0;
        copyRowsButton.textContent = selected.length > 0 ? 'Copy ' + selected.length + ' row(s)' : 'Copy rows';
      }
      if (selectAll) {
        const visibleCheckboxes = rows
          .filter((row) => row.style.display !== 'none')
          .map((row) => row.querySelector('.row-select'))
          .filter(Boolean);
        selectAll.checked = visibleCheckboxes.length > 0 && visibleCheckboxes.every((checkbox) => checkbox.checked);
        selectAll.indeterminate = visibleCheckboxes.some((checkbox) => checkbox.checked) && !selectAll.checked;
      }
    };
    const applyFilter = () => {
      const query = (filter?.value || '').trim().toLowerCase();
      let shown = 0;
      for (const row of rows) {
        const visible = row.dataset.rowText.includes(query);
        row.style.display = visible ? '' : 'none';
        if (visible) shown += 1;
      }
      if (visibleCount) visibleCount.textContent = shown + ' shown';
      updateSelection();
    };
    const selectView = (view) => {
      for (const button of document.querySelectorAll('.section-tab')) {
        button.classList.toggle('active', button.dataset.view === view);
      }
      document.getElementById('data-view').hidden = view !== 'data';
      const structure = document.getElementById('structure-view');
      if (structure) structure.hidden = view !== 'structure';
      persistState({ view });
    };
    const setLogCollapsed = (collapsed) => {
      if (!logPanel || !logContent || !toggleLog) return;
      logContent.hidden = collapsed;
      logPanel.style.gridTemplateRows = collapsed ? '30px' : '30px minmax(0, 86px)';
      toggleLog.textContent = collapsed ? '⌄' : '⌃';
      toggleLog.title = collapsed ? 'Expand execution log' : 'Collapse execution log';
      persistState({ logCollapsed: collapsed });
    };

    if (filter) {
      filter.value = savedState.filter || '';
      filter.addEventListener('input', () => {
        persistState({ filter: filter.value });
        applyFilter();
      });
    }
    for (const button of document.querySelectorAll('.section-tab')) {
      button.addEventListener('click', () => selectView(button.dataset.view));
    }
    for (const checkbox of document.querySelectorAll('.row-select')) {
      checkbox.addEventListener('change', updateSelection);
    }
    selectAll?.addEventListener('change', () => {
      for (const row of rows) {
        if (row.style.display !== 'none') {
          row.querySelector('.row-select').checked = selectAll.checked;
        }
      }
      updateSelection();
    });
    document.getElementById('rerun')?.addEventListener('click', () => vscode.postMessage({ command: 'rerun' }));
    document.getElementById('copy-sql')?.addEventListener('click', () => vscode.postMessage({ command: 'copySql' }));
    document.getElementById('export-csv')?.addEventListener('click', () => vscode.postMessage({ command: 'exportCsv' }));
    copyRowsButton?.addEventListener('click', () => {
      const indices = [...document.querySelectorAll('.row-select:checked')].map((checkbox) => Number(checkbox.dataset.index));
      vscode.postMessage({ command: 'copyRows', indices });
    });
    for (const cell of document.querySelectorAll('td[data-column]')) {
      cell.addEventListener('dblclick', () => {
        vscode.postMessage({ command: 'copyCell', row: Number(cell.dataset.row), column: Number(cell.dataset.column) });
      });
    }
    for (const button of document.querySelectorAll('[data-page-offset]')) {
      button.addEventListener('click', () => vscode.postMessage({ command: 'page', offset: Number(button.dataset.pageOffset) }));
    }
    toggleLog?.addEventListener('click', () => setLogCollapsed(!logContent.hidden));
    window.addEventListener('message', (event) => {
      if (event.data?.command !== 'busy') return;
      for (const button of document.querySelectorAll('[data-busy-action], [data-page-offset]')) {
        if (!button.dataset.defaultDisabled) {
          button.dataset.defaultDisabled = String(button.disabled);
        }
        button.disabled = Boolean(event.data.value) || button.dataset.defaultDisabled === 'true';
      }
    });

    selectView(savedState.view === 'structure' && document.getElementById('structure-view') ? 'structure' : 'data');
    setLogCollapsed(Boolean(savedState.logCollapsed));
    applyFilter();
  </script>
</body>
</html>`;
  }

  private renderCell(value: unknown, rowIndex: number, columnIndex: number): string {
    const formatted = this.formatValue(value);
    const className = value === null ? ' class="null-value"' : '';
    return `<td${className} data-row="${rowIndex}" data-column="${columnIndex}" title="${this.escapeAttribute(formatted)}">${this.escapeHtml(formatted)}</td>`;
  }

  private renderStructure(columns: ColumnInfo[]): string {
    if (columns.length === 0) {
      return '<div class="empty">No column metadata was returned.</div>';
    }

    const rows = columns.map((column) => {
      const flags = [
        column.isPrimaryKey ? 'Primary key' : '',
        column.isIdentity ? 'Identity' : '',
        column.isGenerated ? 'Generated' : ''
      ].filter(Boolean).join(', ');
      return `<tr>
        <td class="column-wide">${this.escapeHtml(column.name)}</td>
        <td>${this.escapeHtml(column.dataType)}</td>
        <td>${column.isPrimaryKey ? '<span class="key-badge">PK</span>' : ''}</td>
        <td>${column.isNullable ? 'YES' : 'NO'}</td>
        <td class="column-wide" title="${this.escapeAttribute(column.columnDefault ?? '')}">${this.escapeHtml(column.columnDefault ?? '')}</td>
        <td>${this.escapeHtml(flags)}</td>
      </tr>`;
    }).join('');

    return `<table class="structure-table">
      <thead><tr><th>Name</th><th>Type</th><th>Key</th><th>Nullable</th><th>Default</th><th>Attributes</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  }

  private renderPagination(options: ResultPanelOptions, rowCount: number): string {
    const pagination = options.pagination;
    if (!pagination) {
      return `<span class="meta">${rowCount} row(s)</span>`;
    }

    const start = rowCount > 0 ? pagination.offset + 1 : 0;
    const end = pagination.offset + rowCount;
    const previousOffset = Math.max(0, pagination.offset - pagination.limit);
    const nextOffset = pagination.offset + pagination.limit;
    return `<button class="tool-button compact" type="button" title="Previous page" data-page-offset="${previousOffset}" ${pagination.hasPrevious ? '' : 'disabled'}>‹</button>
      <span class="meta">Rows ${start}-${end}${pagination.hasNext ? '+' : ''}</span>
      <button class="tool-button compact" type="button" title="Next page" data-page-offset="${nextOffset}" ${pagination.hasNext ? '' : 'disabled'}>›</button>`;
  }

  private async copyRows(result: QueryResult, rawIndices: unknown): Promise<void> {
    if (!Array.isArray(rawIndices)) {
      return;
    }

    const indices = [...new Set(rawIndices)]
      .filter((value): value is number => Number.isInteger(value) && value >= 0 && value < result.rows.length);
    if (indices.length === 0) {
      return;
    }

    const lines = [result.columns.map((column) => this.escapeTsv(column.name)).join('\t')];
    for (const index of indices) {
      lines.push(result.rows[index].map((value) => this.escapeTsv(this.formatValue(value))).join('\t'));
    }

    await vscode.env.clipboard.writeText(lines.join('\n'));
    vscode.window.setStatusBarMessage(`DB Client: copied ${indices.length} row(s)`, 2500);
  }

  private async copyCell(result: QueryResult, rawRow: unknown, rawColumn: unknown): Promise<void> {
    const row = Number(rawRow);
    const column = Number(rawColumn);
    if (!Number.isInteger(row) || !Number.isInteger(column) || !result.rows[row] || column < 0 || column >= result.columns.length) {
      return;
    }

    await vscode.env.clipboard.writeText(this.formatValue(result.rows[row][column]));
    vscode.window.setStatusBarMessage('DB Client: cell copied', 2000);
  }

  private async exportCsv(title: string, result: QueryResult): Promise<void> {
    const fileName = `${this.sanitizeFileName(title)}-${this.timestampForFileName()}.csv`;
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri;
    const defaultUri = workspaceFolder
      ? vscode.Uri.joinPath(workspaceFolder, fileName)
      : vscode.Uri.joinPath(vscode.Uri.file(os.homedir()), fileName);
    const uri = await vscode.window.showSaveDialog({
      defaultUri,
      filters: { CSV: ['csv'] },
      saveLabel: 'Export CSV'
    });
    if (!uri) {
      return;
    }

    const csv = this.toCsv(result);
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(csv));
    vscode.window.showInformationMessage(`Exported ${result.rows.length} row(s) to CSV.`);
  }

  private toCsv(result: QueryResult): string {
    const lines = [result.columns.map((column) => this.escapeCsv(column.name)).join(',')];
    for (const row of result.rows) {
      lines.push(row.map((value) => this.escapeCsv(this.formatValue(value))).join(','));
    }
    return `\uFEFF${lines.join('\r\n')}\r\n`;
  }

  private escapeCsv(value: string): string {
    return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  }

  private escapeTsv(value: string): string {
    return value.replace(/[\t\r\n]+/g, ' ');
  }

  private rowSearchText(row: unknown[]): string {
    return row.map((value) => this.formatValue(value).toLowerCase()).join(' ');
  }

  private formatValue(value: unknown): string {
    if (value === null) {
      return 'NULL';
    }
    if (value === undefined) {
      return '';
    }
    if (value instanceof Date) {
      return value.toISOString();
    }
    if (Buffer.isBuffer(value)) {
      return `\\x${value.toString('hex')}`;
    }
    if (typeof value === 'object') {
      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
    }
    return String(value);
  }

  private createNonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let nonce = '';
    for (let index = 0; index < 32; index += 1) {
      nonce += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return nonce;
  }

  private timestampForFileName(): string {
    return new Date().toISOString().replace(/[:.]/g, '-');
  }

  private sanitizeFileName(value: string): string {
    return value.trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'query-result';
  }

  private isResultMessage(message: unknown): message is ResultMessage {
    if (typeof message !== 'object' || message === null || !('command' in message)) {
      return false;
    }

    return message.command === 'rerun'
      || message.command === 'page'
      || message.command === 'copySql'
      || message.command === 'copyRows'
      || message.command === 'copyCell'
      || message.command === 'exportCsv';
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private escapeAttribute(value: string): string {
    return this.escapeHtml(value);
  }
}

interface ResultMessage {
  command: 'rerun' | 'page' | 'copySql' | 'copyRows' | 'copyCell' | 'exportCsv';
  offset?: unknown;
  indices?: unknown;
  row?: unknown;
  column?: unknown;
}
