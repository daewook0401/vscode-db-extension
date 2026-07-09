import * as vscode from 'vscode';
import { QueryResult } from '../drivers/DbDriver';

interface ResultPanelOptions {
  onRerun?: () => Promise<void>;
}

export class ResultPanel {
  private panel: vscode.WebviewPanel | undefined;
  private currentResult: QueryResult | undefined;
  private rerun: (() => Promise<void>) | undefined;

  public show(title: string, result: QueryResult, options: ResultPanelOptions = {}): void {
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        'personalDbClient.results',
        title,
        vscode.ViewColumn.Active,
        {
          enableScripts: true,
          retainContextWhenHidden: true
        }
      );

      this.panel.onDidDispose(() => {
        this.panel = undefined;
        this.currentResult = undefined;
        this.rerun = undefined;
      });

      this.panel.webview.onDidReceiveMessage((message) => {
        void this.handleMessage(message);
      });
    }

    this.currentResult = result;
    this.rerun = options.onRerun;
    this.panel.title = title;
    this.panel.webview.html = this.renderHtml(title, result, this.panel.webview);
    this.panel.reveal(vscode.ViewColumn.Active);
  }

  private async handleMessage(message: unknown): Promise<void> {
    if (!this.isResultMessage(message)) {
      return;
    }

    if (message.command === 'rerun') {
      await this.rerun?.();
      return;
    }

    if (!this.currentResult) {
      return;
    }

    if (message.command === 'copySql') {
      await vscode.env.clipboard.writeText(this.currentResult.sql);
      vscode.window.showInformationMessage('Copied SQL to clipboard.');
      return;
    }

    if (message.command === 'exportCsv') {
      await this.exportCsv(this.currentResult);
    }
  }

  private renderHtml(title: string, result: QueryResult, webview: vscode.Webview): string {
    const nonce = this.createNonce();
    const inferredTypes = this.inferColumnTypes(result);
    const header = result.columns
      .map((column) => `<th>
        <div class="column-name">${this.escapeHtml(column)}</div>
        <div class="column-type">${this.escapeHtml(inferredTypes.get(column) ?? 'unknown')}</div>
      </th>`)
      .join('');
    const rows = result.rows
      .map((row, index) => {
        const cells = result.columns
          .map((column) => `<td title="${this.escapeAttribute(this.formatValue(row[column]))}">${this.escapeHtml(this.formatValue(row[column]))}</td>`)
          .join('');
        return `<tr data-row-text="${this.escapeAttribute(this.rowSearchText(row, result.columns))}">
          <td class="selector"><input type="checkbox" aria-label="Select row ${index + 1}"></td>
          <td class="row-number">${index + 1}</td>
          ${cells}
        </tr>`;
      })
      .join('');
    const table = result.columns.length === 0
      ? '<div class="empty">Query completed. No tabular result was returned.</div>'
      : `<table>
          <thead>
            <tr>
              <th class="selector"></th>
              <th class="row-number">#</th>
              ${header}
            </tr>
          </thead>
          <tbody id="result-body">${rows}</tbody>
        </table>`;
    const completedAt = new Date().toLocaleTimeString();
    const visibleCount = result.rows.length;

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
      --db-panel-2: var(--vscode-editorGroupHeader-tabsBackground);
      --db-border: var(--vscode-panel-border);
      --db-text: var(--vscode-foreground);
      --db-muted: var(--vscode-descriptionForeground);
      --db-accent: var(--vscode-textLink-foreground);
      --db-green: #6bd26b;
      --db-warn: #d7a65f;
      --db-cell: rgba(255, 255, 255, 0.018);
      --db-hover: var(--vscode-list-hoverBackground);
      --db-selected: var(--vscode-list-activeSelectionBackground);
    }
    * {
      box-sizing: border-box;
    }
    html,
    body {
      height: 100%;
    }
    body {
      margin: 0;
      overflow: hidden;
      color: var(--db-text);
      background: var(--db-bg);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }
    .workbench {
      display: grid;
      grid-template-rows: auto auto auto 1fr 190px;
      height: 100vh;
      min-width: 900px;
    }
    .tab-strip {
      display: flex;
      align-items: center;
      min-height: 34px;
      border-bottom: 1px solid var(--db-border);
      background: var(--db-panel-2);
    }
    .tab {
      display: flex;
      align-items: center;
      gap: 8px;
      height: 34px;
      padding: 0 12px;
      border-right: 1px solid var(--db-border);
      background: var(--db-bg);
      color: var(--db-text);
      font-weight: 600;
    }
    .tab .close {
      color: var(--db-muted);
    }
    .section-tabs {
      display: flex;
      align-items: center;
      gap: 14px;
      min-height: 32px;
      padding: 0 12px;
      border-bottom: 1px solid var(--db-border);
      background: var(--db-panel);
      color: var(--db-muted);
      white-space: nowrap;
    }
    .section-tabs span.active {
      color: var(--db-text);
      font-weight: 600;
    }
    .sql-line {
      display: flex;
      align-items: center;
      gap: 8px;
      min-height: 34px;
      padding: 0 12px;
      border-bottom: 1px solid var(--db-border);
      background: var(--db-bg);
      font-family: var(--vscode-editor-font-family);
      color: var(--vscode-editor-foreground);
    }
    .keyword {
      color: #c586c0;
      font-weight: 700;
    }
    .toolbar {
      display: flex;
      align-items: center;
      gap: 6px;
      min-height: 36px;
      padding: 4px 12px;
      border-bottom: 1px solid var(--db-border);
      background: var(--db-panel);
    }
    .toolbar input {
      width: 220px;
      height: 26px;
      border: 1px solid var(--vscode-input-border);
      color: var(--vscode-input-foreground);
      background: var(--vscode-input-background);
      padding: 0 8px;
    }
    .tool {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 5px;
      min-width: 28px;
      height: 24px;
      padding: 0 7px;
      border: 0;
      color: var(--db-accent);
      background: transparent;
      font-size: 15px;
      cursor: pointer;
    }
    .tool:hover {
      background: var(--db-hover);
    }
    .tool.run {
      color: var(--db-green);
    }
    .spacer {
      flex: 1;
    }
    .cost {
      color: var(--db-accent);
      font-weight: 600;
    }
    .count {
      color: var(--db-muted);
    }
    .grid-wrap {
      overflow: auto;
      background: var(--db-bg);
    }
    table {
      width: max-content;
      min-width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
    }
    th,
    td {
      max-width: 340px;
      min-width: 130px;
      border-right: 1px solid var(--db-border);
      border-bottom: 1px solid rgba(255, 255, 255, 0.04);
      padding: 6px 8px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      background: var(--db-cell);
    }
    th {
      position: sticky;
      top: 0;
      z-index: 2;
      height: 44px;
      text-align: left;
      background: var(--db-panel);
    }
    tbody tr:hover td {
      background: var(--db-hover);
    }
    .selector,
    .row-number {
      min-width: 42px;
      max-width: 42px;
      width: 42px;
      color: var(--db-muted);
      text-align: center;
      position: sticky;
      left: 0;
      z-index: 1;
      background: var(--db-panel);
    }
    .row-number {
      left: 42px;
    }
    th.selector,
    th.row-number {
      z-index: 3;
    }
    .column-name {
      color: var(--db-text);
      font-weight: 600;
    }
    .column-type {
      margin-top: 3px;
      color: var(--db-muted);
      font-size: 11px;
      font-weight: 400;
    }
    .bottom {
      display: grid;
      grid-template-rows: 34px 1fr;
      border-top: 1px solid var(--db-border);
      background: var(--db-panel);
      min-height: 0;
    }
    .result-tabs {
      display: flex;
      align-items: center;
      gap: 2px;
      border-bottom: 1px solid var(--db-border);
    }
    .result-tab {
      height: 34px;
      min-width: 110px;
      padding: 8px 12px;
      border-right: 1px solid var(--db-border);
      color: var(--db-muted);
    }
    .result-tab.active {
      color: var(--db-text);
      background: var(--db-bg);
    }
    .logs {
      overflow: auto;
      padding: 10px 12px;
      font-family: var(--vscode-editor-font-family);
      font-size: 12px;
      color: var(--db-muted);
      white-space: pre-wrap;
    }
    .log-ok {
      color: var(--db-green);
    }
    .log-sql {
      color: var(--db-warn);
    }
    .empty {
      padding: 18px;
      color: var(--db-muted);
    }
  </style>
</head>
<body>
  <main class="workbench">
    <div class="tab-strip">
      <div class="tab">▦ ${this.escapeHtml(title)} <span class="close">×</span></div>
    </div>
    <div class="section-tabs">
      <span>✎ Properties</span>
      <span class="active">▦ Data</span>
      <span>🔗 ER Diagram</span>
      <span>⚗ Mock</span>
      <span>🔧 Manager</span>
      <span class="spacer"></span>
      <span>{ }</span>
      <span>↻</span>
      <span>▣ ${this.escapeHtml(this.databaseLabel(title))}</span>
    </div>
    <div class="sql-line">
      <span class="keyword">SELECT</span>
      <span>*</span>
      <span class="keyword">FROM</span>
      <span>${this.escapeHtml(title)}</span>
      <span class="keyword">LIMIT</span>
      <span>${this.escapeHtml(this.extractLimit(result.sql))}</span>
    </div>
    <div class="toolbar">
      <input id="filter" placeholder="Search result">
      <button id="rerun" class="tool run" title="Run again">▶ Run</button>
      <button id="refresh" class="tool" title="Refresh result">⟳</button>
      <button id="copy-sql" class="tool" title="Copy SQL">⧉ SQL</button>
      <button id="export-csv" class="tool" title="Export CSV">⇩ CSV</button>
      <span class="cost">Cost: ${result.durationMs}ms</span>
      <span id="visible-count" class="count">${visibleCount} shown</span>
      <span class="spacer"></span>
      <span>1</span>
      <span>2</span>
      <span>3</span>
      <span>4</span>
      <span>…</span>
      <strong>Total ${result.rowCount}</strong>
    </div>
    <div class="grid-wrap">
      ${table}
    </div>
    <section class="bottom">
      <div class="result-tabs">
        <div class="result-tab active">▦ Result</div>
        <div class="result-tab">▦ Log</div>
        <div class="result-tab">▦ Console</div>
      </div>
      <div class="logs">
<span class="log-ok">Execution completed in ${result.durationMs}ms</span>
${this.escapeHtml(completedAt)} [INFO] Executing: <span class="log-sql">${this.escapeHtml(result.sql)}</span>
${this.escapeHtml(completedAt)} [INFO] Result: ${result.rowCount} row(s) affected, ${result.rows.length} row(s) displayed
${this.escapeHtml(completedAt)} [INFO] Result: Completed
      </div>
    </section>
  </main>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const filter = document.getElementById('filter');
    const rows = [...document.querySelectorAll('#result-body tr')];
    const visibleCount = document.getElementById('visible-count');
    const updateVisibleCount = () => {
      const shown = rows.filter((row) => row.style.display !== 'none').length;
      if (visibleCount) {
        visibleCount.textContent = shown + ' shown';
      }
    };
    filter?.addEventListener('input', () => {
      const query = filter.value.trim().toLowerCase();
      for (const row of rows) {
        row.style.display = row.dataset.rowText.includes(query) ? '' : 'none';
      }
      updateVisibleCount();
    });
    document.getElementById('rerun')?.addEventListener('click', () => {
      vscode.postMessage({ command: 'rerun' });
    });
    document.getElementById('refresh')?.addEventListener('click', () => {
      vscode.postMessage({ command: 'rerun' });
    });
    document.getElementById('copy-sql')?.addEventListener('click', () => {
      vscode.postMessage({ command: 'copySql' });
    });
    document.getElementById('export-csv')?.addEventListener('click', () => {
      vscode.postMessage({ command: 'exportCsv' });
    });
  </script>
</body>
</html>`;
  }

  private async exportCsv(result: QueryResult): Promise<void> {
    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(`query-result-${this.timestampForFileName()}.csv`),
      filters: {
        CSV: ['csv']
      },
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
    const lines = [
      result.columns.map((column) => this.escapeCsv(column)).join(',')
    ];

    for (const row of result.rows) {
      lines.push(result.columns.map((column) => this.escapeCsv(this.formatValue(row[column]))).join(','));
    }

    return `${lines.join('\n')}\n`;
  }

  private escapeCsv(value: string): string {
    if (/[",\n\r]/.test(value)) {
      return `"${value.replace(/"/g, '""')}"`;
    }

    return value;
  }

  private inferColumnTypes(result: QueryResult): Map<string, string> {
    const types = new Map<string, string>();
    for (const column of result.columns) {
      const value = result.rows.find((row) => row[column] !== null && row[column] !== undefined)?.[column];
      types.set(column, this.inferValueType(value));
    }
    return types;
  }

  private inferValueType(value: unknown): string {
    if (value === undefined || value === null) {
      return 'unknown';
    }
    if (value instanceof Date) {
      return 'timestamp';
    }
    if (typeof value === 'number') {
      return Number.isInteger(value) ? 'integer' : 'numeric';
    }
    if (typeof value === 'boolean') {
      return 'boolean';
    }
    if (typeof value === 'object') {
      return 'json';
    }
    return 'varchar';
  }

  private extractLimit(sql: string): string {
    return /limit\s+(\d+)/i.exec(sql)?.[1] ?? '-';
  }

  private databaseLabel(title: string): string {
    return title.split('.')[0] || 'database';
  }

  private rowSearchText(row: Record<string, unknown>, columns: string[]): string {
    return columns.map((column) => this.formatValue(row[column]).toLowerCase()).join(' ');
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
    if (typeof value === 'object') {
      return JSON.stringify(value);
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

  private isResultMessage(message: unknown): message is ResultMessage {
    return typeof message === 'object'
      && message !== null
      && 'command' in message
      && (
        message.command === 'rerun'
        || message.command === 'copySql'
        || message.command === 'exportCsv'
      );
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
  command: 'rerun' | 'copySql' | 'exportCsv';
}
