import * as vscode from 'vscode';
import { QueryResult } from '../drivers/DbDriver';

export class ResultPanel {
  private panel: vscode.WebviewPanel | undefined;

  public show(title: string, result: QueryResult): void {
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        'personalDbClient.results',
        'DB Results',
        vscode.ViewColumn.Beside,
        {
          enableScripts: false
        }
      );

      this.panel.onDidDispose(() => {
        this.panel = undefined;
      });
    }

    this.panel.title = title;
    this.panel.webview.html = this.renderHtml(title, result);
    this.panel.reveal(vscode.ViewColumn.Beside);
  }

  private renderHtml(title: string, result: QueryResult): string {
    const header = result.columns
      .map((column) => `<th>${this.escapeHtml(column)}</th>`)
      .join('');
    const rows = result.rows
      .map((row) => {
        const cells = result.columns
          .map((column) => `<td>${this.escapeHtml(this.formatValue(row[column]))}</td>`)
          .join('');
        return `<tr>${cells}</tr>`;
      })
      .join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${this.escapeHtml(title)}</title>
  <style>
    body {
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      padding: 16px;
    }
    table {
      border-collapse: collapse;
      width: 100%;
    }
    th, td {
      border: 1px solid var(--vscode-panel-border);
      padding: 6px 8px;
      text-align: left;
      vertical-align: top;
      white-space: nowrap;
    }
    th {
      background: var(--vscode-editorGroupHeader-tabsBackground);
      position: sticky;
      top: 0;
    }
    .empty {
      color: var(--vscode-descriptionForeground);
    }
  </style>
</head>
<body>
  <h2>${this.escapeHtml(title)}</h2>
  <p class="empty">${result.rows.length} row(s)</p>
  <table>
    <thead><tr>${header}</tr></thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>`;
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

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}
