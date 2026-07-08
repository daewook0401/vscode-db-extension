import * as vscode from 'vscode';
import { ConnectionManager } from '../connection/ConnectionManager';
import { ConnectionProfile, ConnectionProfileInput, ConnectionProfileUpdateInput, DatabaseType } from '../connection/ConnectionProfile';
import { ConnectionSessionManager } from '../connection/ConnectionSessionManager';

interface ConnectionPanelOptions {
  context: vscode.ExtensionContext;
  connectionManager: ConnectionManager;
  sessionManager: ConnectionSessionManager;
  onSaved: (profile: ConnectionProfile) => void;
}

export class ConnectionPanel {
  public static showAdd(options: ConnectionPanelOptions): void {
    new ConnectionPanel(options, undefined).show();
  }

  public static showEdit(options: ConnectionPanelOptions, profile: ConnectionProfile): void {
    new ConnectionPanel(options, profile).show();
  }

  private panel: vscode.WebviewPanel | undefined;

  private constructor(
    private readonly options: ConnectionPanelOptions,
    private readonly profile: ConnectionProfile | undefined
  ) {}

  private show(): void {
    this.panel = vscode.window.createWebviewPanel(
      'personalDbClient.connection',
      this.profile ? `Connection: ${this.profile.name}` : 'Connect',
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true
      }
    );

    this.panel.webview.html = this.renderHtml(this.panel.webview);
    this.panel.webview.onDidReceiveMessage((message) => {
      void this.handleMessage(message);
    });
  }

  private async handleMessage(message: unknown): Promise<void> {
    if (!this.isConnectionMessage(message)) {
      return;
    }

    if (message.command === 'cancel') {
      this.panel?.dispose();
      return;
    }

    try {
      const input = this.toInput(message.payload);
      const savedProfile = this.profile
        ? await this.options.connectionManager.updateProfile(this.profile, input)
        : await this.options.connectionManager.addProfile(input as ConnectionProfileInput);

      await this.options.sessionManager.disconnect(savedProfile.id);
      await this.options.sessionManager.testConnection(savedProfile);
      this.options.onSaved(savedProfile);
      vscode.window.showInformationMessage(`Connected to "${savedProfile.name}".`);
      this.panel?.dispose();
    } catch (error) {
      await this.panel?.webview.postMessage({
        command: 'error',
        message: error instanceof Error ? error.message : String(error)
      });
      vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }

  private toInput(payload: ConnectionFormPayload): ConnectionProfileInput | ConnectionProfileUpdateInput {
    const type = this.parseDatabaseType(payload.type);
    const port = Number(payload.port);
    const previewLimit = Number(payload.previewLimit);

    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      throw new Error('Enter a valid port.');
    }
    if (!Number.isInteger(previewLimit) || previewLimit <= 0 || previewLimit > 10000) {
      throw new Error('Enter a preview limit between 1 and 10000.');
    }
    if (!payload.name.trim()) {
      throw new Error('Connection name is required.');
    }
    if (!payload.host.trim()) {
      throw new Error('Host is required.');
    }
    if (!payload.database.trim()) {
      throw new Error('Database is required.');
    }
    if (!payload.username.trim()) {
      throw new Error('Username is required.');
    }
    if (!this.profile && !payload.password) {
      throw new Error('Password is required.');
    }

    const baseInput = {
      name: payload.name.trim(),
      type,
      host: payload.host.trim(),
      port,
      database: payload.database.trim(),
      username: payload.username.trim(),
      defaultSchema: this.toOptionalString(payload.defaultSchema),
      schemaFilters: this.parseSchemaFilters(payload.schemaFilters),
      previewLimit
    };

    if (this.profile && !payload.password) {
      return baseInput;
    }

    return {
      ...baseInput,
      password: payload.password
    };
  }

  private renderHtml(webview: vscode.Webview): string {
    const nonce = this.createNonce();
    const profile = this.profile;
    const values = {
      type: profile?.type ?? 'postgres',
      name: profile?.name ?? '',
      host: profile?.host ?? 'localhost',
      port: String(profile?.port ?? 5432),
      database: profile?.database ?? '',
      username: profile?.username ?? '',
      defaultSchema: profile?.defaultSchema ?? 'public',
      schemaFilters: profile?.schemaFilters?.join(', ') ?? '',
      previewLimit: String(profile?.previewLimit ?? 100)
    };
    const title = profile ? 'Manage Connection' : 'Connect';
    const passwordLabel = profile ? 'Password (leave empty to keep current)' : 'Password';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${this.escapeHtml(title)}</title>
  <style>
    body {
      margin: 0;
      padding: 24px;
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      font-family: var(--vscode-font-family);
    }
    .shell {
      max-width: 760px;
    }
    h1 {
      margin: 0 0 8px;
      font-size: 24px;
      font-weight: 600;
    }
    .summary {
      margin: 0 0 24px;
      color: var(--vscode-descriptionForeground);
    }
    form {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 14px 16px;
    }
    label {
      display: flex;
      flex-direction: column;
      gap: 6px;
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
    }
    input, select {
      height: 30px;
      padding: 4px 8px;
      border: 1px solid var(--vscode-input-border);
      color: var(--vscode-input-foreground);
      background: var(--vscode-input-background);
      font: inherit;
    }
    .wide {
      grid-column: 1 / -1;
    }
    .actions {
      grid-column: 1 / -1;
      display: flex;
      gap: 8px;
      margin-top: 8px;
    }
    button {
      height: 32px;
      padding: 0 14px;
      border: 1px solid var(--vscode-button-border, transparent);
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
      cursor: pointer;
    }
    button.secondary {
      color: var(--vscode-button-secondaryForeground);
      background: var(--vscode-button-secondaryBackground);
    }
    .error {
      grid-column: 1 / -1;
      min-height: 20px;
      color: var(--vscode-errorForeground);
    }
  </style>
</head>
<body>
  <main class="shell">
    <h1>${this.escapeHtml(title)}</h1>
    <p class="summary">Choose a service type, fill in the connection details, and connect from this editor tab.</p>
    <form id="connection-form">
      <label>
        Service type
        <select name="type">
          <option value="postgres" ${values.type === 'postgres' ? 'selected' : ''}>PostgreSQL</option>
          <option value="mysql" ${values.type === 'mysql' ? 'selected' : ''}>MySQL / MariaDB (stub)</option>
        </select>
      </label>
      <label>
        Connection name
        <input name="name" value="${this.escapeAttribute(values.name)}" placeholder="Local PostgreSQL">
      </label>
      <label>
        Host
        <input name="host" value="${this.escapeAttribute(values.host)}" placeholder="localhost">
      </label>
      <label>
        Port
        <input name="port" type="number" min="1" max="65535" value="${this.escapeAttribute(values.port)}">
      </label>
      <label>
        Database
        <input name="database" value="${this.escapeAttribute(values.database)}" placeholder="postgres">
      </label>
      <label>
        Username
        <input name="username" value="${this.escapeAttribute(values.username)}" placeholder="postgres">
      </label>
      <label class="wide">
        ${this.escapeHtml(passwordLabel)}
        <input name="password" type="password" autocomplete="off">
      </label>
      <label>
        Default schema
        <input name="defaultSchema" value="${this.escapeAttribute(values.defaultSchema)}" placeholder="public">
      </label>
      <label>
        Preview limit
        <input name="previewLimit" type="number" min="1" max="10000" value="${this.escapeAttribute(values.previewLimit)}">
      </label>
      <label class="wide">
        Visible schemas
        <input name="schemaFilters" value="${this.escapeAttribute(values.schemaFilters)}" placeholder="public, app">
      </label>
      <div id="error" class="error"></div>
      <div class="actions">
        <button type="submit">${profile ? 'Save and Connect' : 'Connect'}</button>
        <button class="secondary" type="button" id="cancel">Cancel</button>
      </div>
    </form>
  </main>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const form = document.getElementById('connection-form');
    const error = document.getElementById('error');
    document.getElementById('cancel').addEventListener('click', () => {
      vscode.postMessage({ command: 'cancel' });
    });
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      error.textContent = '';
      const data = new FormData(form);
      vscode.postMessage({
        command: 'connect',
        payload: Object.fromEntries(data.entries())
      });
    });
    window.addEventListener('message', (event) => {
      if (event.data?.command === 'error') {
        error.textContent = event.data.message;
      }
    });
  </script>
</body>
</html>`;
  }

  private parseDatabaseType(value: string): DatabaseType {
    if (value === 'postgres' || value === 'mysql') {
      return value;
    }

    throw new Error('Select a supported database type.');
  }

  private parseSchemaFilters(value: string): string[] {
    return value
      .split(',')
      .map((schema) => schema.trim())
      .filter(Boolean);
  }

  private toOptionalString(value: string): string | undefined {
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  }

  private isConnectionMessage(message: unknown): message is ConnectionMessage {
    return typeof message === 'object'
      && message !== null
      && 'command' in message
      && (message.command === 'connect' || message.command === 'cancel');
  }

  private createNonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let nonce = '';
    for (let index = 0; index < 32; index += 1) {
      nonce += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return nonce;
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

interface ConnectionMessage {
  command: 'connect' | 'cancel';
  payload: ConnectionFormPayload;
}

interface ConnectionFormPayload {
  type: string;
  name: string;
  host: string;
  port: string;
  database: string;
  username: string;
  password: string;
  defaultSchema: string;
  schemaFilters: string;
  previewLimit: string;
}
