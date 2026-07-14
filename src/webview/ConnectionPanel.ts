import * as vscode from 'vscode';
import { ConnectionManager } from '../connection/ConnectionManager';
import {
  ConnectionProfile,
  ConnectionProfileInput,
  ConnectionProfileUpdateInput,
  DatabaseType,
  SslMode
} from '../connection/ConnectionProfile';
import { ConnectionSessionManager } from '../connection/ConnectionSessionManager';

interface ConnectionPanelOptions {
  connectionManager: ConnectionManager;
  sessionManager: ConnectionSessionManager;
  onSaved: (profile: ConnectionProfile) => void;
}

type ConnectionAction = 'test' | 'save' | 'saveAndConnect';

export class ConnectionPanel {
  private static readonly instances = new Map<string, ConnectionPanel>();

  public static showAdd(options: ConnectionPanelOptions): void {
    ConnectionPanel.showForKey('new', options, undefined);
  }

  public static showEdit(options: ConnectionPanelOptions, profile: ConnectionProfile): void {
    ConnectionPanel.showForKey(profile.id, options, profile);
  }

  private static showForKey(
    key: string,
    options: ConnectionPanelOptions,
    profile: ConnectionProfile | undefined
  ): void {
    const existing = ConnectionPanel.instances.get(key);
    if (existing?.panel) {
      existing.panel.reveal(vscode.ViewColumn.Active);
      return;
    }

    const instance = new ConnectionPanel(key, options, profile);
    ConnectionPanel.instances.set(key, instance);
    instance.show();
  }

  private panel: vscode.WebviewPanel | undefined;

  private constructor(
    private readonly instanceKey: string,
    private readonly options: ConnectionPanelOptions,
    private readonly profile: ConnectionProfile | undefined
  ) {}

  private show(): void {
    this.panel = vscode.window.createWebviewPanel(
      'personalDbClient.connection',
      this.profile ? `Connection: ${this.profile.name}` : 'Add DB Connection',
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true
      }
    );

    this.panel.webview.html = this.renderHtml(this.panel.webview);
    this.panel.webview.onDidReceiveMessage((message) => {
      void this.handleMessage(message);
    });
    this.panel.onDidDispose(() => {
      this.panel = undefined;
      if (ConnectionPanel.instances.get(this.instanceKey) === this) {
        ConnectionPanel.instances.delete(this.instanceKey);
      }
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
      if (message.command === 'test') {
        await this.options.connectionManager.testConnectionInput(input, this.profile);
        await this.postStatus('success', 'Connection successful.');
        return;
      }

      if (message.command === 'saveAndConnect') {
        await this.options.connectionManager.testConnectionInput(input, this.profile);
      }

      const savedProfile = this.profile
        ? await this.options.connectionManager.updateProfile(this.profile, input)
        : await this.options.connectionManager.addProfile(input as ConnectionProfileInput);

      await this.options.sessionManager.disconnect(savedProfile.id);
      if (message.command === 'saveAndConnect') {
        await this.options.sessionManager.testConnection(savedProfile);
      }

      this.options.onSaved(savedProfile);
      vscode.window.showInformationMessage(
        message.command === 'saveAndConnect'
          ? `Saved and connected to "${savedProfile.name}".`
          : `Saved DB connection "${savedProfile.name}".`
      );
      this.panel?.dispose();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.postStatus('error', errorMessage);
      vscode.window.showErrorMessage(errorMessage);
    }
  }

  private async postStatus(kind: 'success' | 'error', message: string): Promise<void> {
    await this.panel?.webview.postMessage({ command: 'status', kind, message });
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
    const baseInput = {
      name: payload.name.trim(),
      type,
      host: payload.host.trim(),
      port,
      database: payload.database.trim(),
      username: payload.username.trim(),
      sslMode: this.parseSslMode(payload.sslMode),
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
      sslMode: profile?.sslMode ?? 'disable',
      defaultSchema: profile?.defaultSchema ?? 'public',
      schemaFilters: profile?.schemaFilters?.join(', ') ?? '',
      previewLimit: String(profile?.previewLimit ?? 100)
    };
    const title = profile ? 'Manage Connection' : 'Add DB Connection';
    const passwordLabel = profile ? 'Password (unchanged when empty)' : 'Password';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${this.escapeHtml(title)}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 24px clamp(18px, 4vw, 48px);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }
    .shell { width: min(760px, 100%); }
    h1 {
      margin: 0 0 26px;
      font-size: 22px;
      font-weight: 600;
    }
    fieldset {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      gap: 14px 16px;
      margin: 0 0 22px;
      padding: 0;
      border: 0;
    }
    legend {
      grid-column: 1 / -1;
      width: 100%;
      margin-bottom: 2px;
      padding: 0 0 8px;
      border-bottom: 1px solid var(--vscode-panel-border);
      color: var(--vscode-foreground);
      font-size: 13px;
      font-weight: 600;
    }
    label {
      display: flex;
      flex-direction: column;
      gap: 6px;
      min-width: 0;
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
    }
    input, select {
      width: 100%;
      height: 31px;
      padding: 4px 8px;
      border: 1px solid var(--vscode-input-border, transparent);
      border-radius: 0;
      color: var(--vscode-input-foreground);
      background: var(--vscode-input-background);
      font: inherit;
    }
    input:focus, select:focus {
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: -1px;
    }
    .wide { grid-column: 1 / -1; }
    .password-field {
      display: flex;
      flex-direction: column;
      gap: 6px;
      min-width: 0;
    }
    .field-title { color: var(--vscode-descriptionForeground); font-size: 12px; }
    .password-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
      gap: 10px;
    }
    .show-password {
      display: inline-flex;
      flex-direction: row;
      align-items: center;
      gap: 5px;
      color: var(--vscode-foreground);
      white-space: nowrap;
    }
    .show-password input { width: 16px; height: 16px; margin: 0; }
    .status {
      min-height: 22px;
      margin: 4px 0 8px;
      color: var(--vscode-descriptionForeground);
    }
    .status.success { color: var(--vscode-testing-iconPassed, #73c991); }
    .status.error { color: var(--vscode-errorForeground); }
    .actions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
    }
    button {
      height: 32px;
      padding: 0 14px;
      border: 1px solid var(--vscode-button-border, transparent);
      border-radius: 2px;
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
      font: inherit;
      cursor: pointer;
    }
    button:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }
    button.secondary {
      color: var(--vscode-button-secondaryForeground);
      background: var(--vscode-button-secondaryBackground);
    }
    button.secondary:hover:not(:disabled) { background: var(--vscode-button-secondaryHoverBackground); }
    button.link {
      margin-left: auto;
      border-color: transparent;
      color: var(--vscode-textLink-foreground);
      background: transparent;
    }
    button:disabled { opacity: 0.55; cursor: default; }
    @media (max-width: 620px) {
      fieldset { grid-template-columns: minmax(0, 1fr); }
      .wide, legend { grid-column: 1; }
      button.link { margin-left: 0; }
    }
  </style>
</head>
<body>
  <main class="shell">
    <h1>${this.escapeHtml(title)}</h1>
    <form id="connection-form">
      <fieldset>
        <legend>Connection</legend>
        <label>
          Service type
          <select name="type" id="type">
            <option value="postgres" ${values.type === 'postgres' ? 'selected' : ''}>PostgreSQL</option>
            <option value="mysql" ${values.type === 'mysql' ? 'selected' : ''} disabled>MySQL / MariaDB (coming later)</option>
          </select>
        </label>
        <label>
          SSL mode
          <select name="sslMode">
            <option value="disable" ${values.sslMode === 'disable' ? 'selected' : ''}>Disable</option>
            <option value="require" ${values.sslMode === 'require' ? 'selected' : ''}>Require</option>
            <option value="verify-full" ${values.sslMode === 'verify-full' ? 'selected' : ''}>Verify Full</option>
          </select>
        </label>
        <label>
          Connection name
          <input name="name" id="name" required value="${this.escapeAttribute(values.name)}" placeholder="Local PostgreSQL">
        </label>
        <label>
          Host
          <input name="host" id="host" required value="${this.escapeAttribute(values.host)}" placeholder="localhost">
        </label>
        <label>
          Port
          <input name="port" id="port" type="number" required min="1" max="65535" value="${this.escapeAttribute(values.port)}">
        </label>
        <label>
          Database
          <input name="database" id="database" required value="${this.escapeAttribute(values.database)}" placeholder="postgres">
        </label>
        <label>
          Username
          <input name="username" id="username" required value="${this.escapeAttribute(values.username)}" placeholder="postgres">
        </label>
        <div class="wide password-field">
          <span class="field-title">${this.escapeHtml(passwordLabel)}</span>
          <div class="password-row">
            <input name="password" id="password" aria-label="${this.escapeAttribute(passwordLabel)}" type="password" autocomplete="off">
            <label class="show-password"><input id="show-password" type="checkbox">Show</label>
          </div>
        </div>
      </fieldset>
      <fieldset>
        <legend>Browsing</legend>
        <label>
          Default schema
          <input name="defaultSchema" value="${this.escapeAttribute(values.defaultSchema)}" placeholder="public">
        </label>
        <label>
          Rows per page
          <input name="previewLimit" type="number" required min="1" max="10000" value="${this.escapeAttribute(values.previewLimit)}">
        </label>
        <label class="wide">
          Visible schemas
          <input name="schemaFilters" value="${this.escapeAttribute(values.schemaFilters)}" placeholder="public, app">
        </label>
      </fieldset>
      <div id="status" class="status" role="status" aria-live="polite"></div>
      <div class="actions">
        <button type="submit" data-action="saveAndConnect">Save &amp; Connect</button>
        <button class="secondary" type="button" data-action="test">Test</button>
        <button class="secondary" type="button" data-action="save" title="Save without opening a database session">Save</button>
        <button class="link" type="button" id="cancel">Cancel</button>
      </div>
    </form>
  </main>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const form = document.getElementById('connection-form');
    const status = document.getElementById('status');
    const password = document.getElementById('password');
    const actionButtons = [...document.querySelectorAll('[data-action]')];
    let pendingAction = '';

    const setBusy = (busy, action = '') => {
      pendingAction = busy ? action : '';
      for (const button of actionButtons) button.disabled = busy;
      document.getElementById('cancel').disabled = busy;
      if (busy) {
        status.className = 'status';
        status.textContent = action === 'test' ? 'Testing connection...' : action === 'save' ? 'Saving...' : 'Testing and connecting...';
      }
    };
    const submit = (action) => {
      if (!form.reportValidity() || pendingAction) return;
      setBusy(true, action);
      const data = new FormData(form);
      vscode.postMessage({ command: action, payload: Object.fromEntries(data.entries()) });
    };
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      submit('saveAndConnect');
    });
    for (const button of actionButtons) {
      if (button.type !== 'submit') button.addEventListener('click', () => submit(button.dataset.action));
    }
    document.getElementById('cancel').addEventListener('click', () => vscode.postMessage({ command: 'cancel' }));
    document.getElementById('show-password').addEventListener('change', (event) => {
      password.type = event.target.checked ? 'text' : 'password';
    });

    const name = document.getElementById('name');
    const updateSuggestedName = () => {
      if (name.value.trim()) return;
      const username = document.getElementById('username').value.trim();
      const host = document.getElementById('host').value.trim();
      const database = document.getElementById('database').value.trim();
      if (username && host && database) name.value = username + '@' + host + '/' + database;
    };
    for (const id of ['host', 'database', 'username']) {
      document.getElementById(id).addEventListener('blur', updateSuggestedName);
    }

    window.addEventListener('message', (event) => {
      if (event.data?.command !== 'status') return;
      setBusy(false);
      status.className = 'status ' + event.data.kind;
      status.textContent = event.data.message;
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

  private parseSslMode(value: string): SslMode {
    if (value === 'disable' || value === 'require' || value === 'verify-full') {
      return value;
    }
    throw new Error('Select a supported SSL mode.');
  }

  private parseSchemaFilters(value: string): string[] {
    return [...new Set(value.split(',').map((schema) => schema.trim()).filter(Boolean))];
  }

  private toOptionalString(value: string): string | undefined {
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  }

  private isConnectionMessage(message: unknown): message is ConnectionMessage {
    if (typeof message !== 'object' || message === null || !('command' in message)) {
      return false;
    }
    if (message.command === 'cancel') {
      return true;
    }
    return (message.command === 'test' || message.command === 'save' || message.command === 'saveAndConnect')
      && 'payload' in message
      && typeof message.payload === 'object'
      && message.payload !== null;
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

type ConnectionMessage =
  | { command: 'cancel' }
  | { command: ConnectionAction; payload: ConnectionFormPayload };

interface ConnectionFormPayload {
  type: string;
  name: string;
  host: string;
  port: string;
  database: string;
  username: string;
  password: string;
  sslMode: string;
  defaultSchema: string;
  schemaFilters: string;
  previewLimit: string;
}
