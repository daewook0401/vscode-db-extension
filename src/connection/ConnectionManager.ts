import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { DbDriver } from '../drivers/DbDriver';
import { MysqlDriver } from '../drivers/MysqlDriver';
import { PostgresDriver } from '../drivers/PostgresDriver';
import {
  ConnectionProfile,
  ConnectionProfileInput,
  ConnectionProfileUpdateInput,
  DatabaseType
} from './ConnectionProfile';
import { SecretManager } from './SecretManager';

const CONNECTIONS_KEY = 'personalDbClient.connections';
const DATABASE_TYPES: DatabaseType[] = ['postgres', 'mysql'];
const DEFAULT_PREVIEW_LIMIT = 100;

export class ConnectionManager {
  constructor(
    private readonly state: vscode.Memento,
    private readonly secretManager: SecretManager
  ) {}

  public getProfiles(): ConnectionProfile[] {
    return this.state.get<ConnectionProfile[]>(CONNECTIONS_KEY, []).map((profile) => this.normalizeProfile(profile));
  }

  public getProfile(profileId: string): ConnectionProfile | undefined {
    return this.getProfiles().find((profile) => profile.id === profileId);
  }

  public async addProfileFromInput(): Promise<ConnectionProfile | undefined> {
    const input = await this.promptForConnection();
    if (!input) {
      return undefined;
    }
    if (input.password === undefined) {
      return undefined;
    }

    const profile: ConnectionProfile = {
      id: crypto.randomUUID(),
      name: input.name,
      type: input.type,
      host: input.host,
      port: input.port,
      database: input.database,
      username: input.username,
      defaultSchema: input.defaultSchema,
      schemaFilters: input.schemaFilters,
      previewLimit: input.previewLimit
    };

    await this.secretManager.savePassword(profile.id, input.password);
    await this.saveProfiles([...this.getProfiles(), profile]);
    return profile;
  }

  public async editProfileFromInput(profile: ConnectionProfile): Promise<ConnectionProfile | undefined> {
    const passwordAction = await vscode.window.showQuickPick(['Keep existing password', 'Change password'], {
      title: 'Password',
      placeHolder: 'Choose whether to update the stored password'
    });
    if (!passwordAction) {
      return undefined;
    }

    const input = await this.promptForConnection(profile, passwordAction === 'Change password');
    if (!input) {
      return undefined;
    }

    const updatedProfile: ConnectionProfile = {
      id: profile.id,
      name: input.name,
      type: input.type,
      host: input.host,
      port: input.port,
      database: input.database,
      username: input.username,
      defaultSchema: input.defaultSchema,
      schemaFilters: input.schemaFilters,
      previewLimit: input.previewLimit
    };

    if (input.password !== undefined) {
      await this.secretManager.savePassword(profile.id, input.password);
    }

    await this.saveProfiles(
      this.getProfiles().map((storedProfile) => storedProfile.id === profile.id ? updatedProfile : storedProfile)
    );
    return updatedProfile;
  }

  public async deleteProfile(profile: ConnectionProfile): Promise<boolean> {
    const confirmed = await vscode.window.showWarningMessage(
      `Delete DB connection "${profile.name}"?`,
      { modal: true },
      'Delete'
    );
    if (confirmed !== 'Delete') {
      return false;
    }

    await this.secretManager.deletePassword(profile.id);
    await this.saveProfiles(this.getProfiles().filter((storedProfile) => storedProfile.id !== profile.id));
    return true;
  }

  public async configureSchemas(profile: ConnectionProfile): Promise<ConnectionProfile | undefined> {
    const defaultSchema = await vscode.window.showInputBox({
      title: 'Default schema',
      prompt: 'Optional schema used first for SQL execution and generated SQL',
      value: profile.defaultSchema ?? '',
      ignoreFocusOut: true
    });
    if (defaultSchema === undefined) {
      return undefined;
    }

    const schemaFilters = await vscode.window.showInputBox({
      title: 'Visible schemas',
      prompt: 'Comma-separated schema names. Leave empty to show all schemas.',
      value: profile.schemaFilters?.join(', ') ?? '',
      ignoreFocusOut: true
    });
    if (schemaFilters === undefined) {
      return undefined;
    }

    const previewLimitValue = await vscode.window.showInputBox({
      title: 'Table preview limit',
      prompt: 'Maximum number of rows to fetch when clicking a table',
      value: String(profile.previewLimit ?? DEFAULT_PREVIEW_LIMIT),
      ignoreFocusOut: true,
      validateInput: (value) => this.validatePreviewLimit(value)
    });
    if (previewLimitValue === undefined) {
      return undefined;
    }

    const updatedProfile: ConnectionProfile = {
      ...profile,
      defaultSchema: this.toOptionalString(defaultSchema),
      schemaFilters: this.parseSchemaFilters(schemaFilters),
      previewLimit: Number(previewLimitValue)
    };

    await this.saveProfiles(
      this.getProfiles().map((storedProfile) => storedProfile.id === profile.id ? updatedProfile : storedProfile)
    );
    return updatedProfile;
  }

  public async createDriver(profile: ConnectionProfile): Promise<DbDriver> {
    const password = await this.secretManager.getPassword(profile.id);
    if (password === undefined) {
      throw new Error(`Password for "${profile.name}" was not found. Recreate the connection profile.`);
    }

    if (profile.type === 'postgres') {
      return new PostgresDriver(profile, password);
    }

    return new MysqlDriver();
  }

  private async promptForConnection(
    existingProfile?: ConnectionProfile,
    requirePassword = true
  ): Promise<ConnectionProfileInput | ConnectionProfileUpdateInput | undefined> {
    const type = await vscode.window.showQuickPick(DATABASE_TYPES, {
      title: 'Database type',
      placeHolder: 'Select database type'
    });
    if (!type) {
      return undefined;
    }
    if (!this.isDatabaseType(type)) {
      return undefined;
    }
    if (type === 'mysql') {
      vscode.window.showInformationMessage('MySQL/MariaDB is planned but not implemented in this MVP.');
    }

    const host = await vscode.window.showInputBox({
      title: 'Host',
      prompt: 'Database host',
      value: existingProfile?.host ?? 'localhost',
      ignoreFocusOut: true,
      validateInput: (value) => value.trim() ? undefined : 'Host is required.'
    });
    if (!host) {
      return undefined;
    }

    const defaultPort = type === 'postgres' ? '5432' : '3306';
    const portValue = await vscode.window.showInputBox({
      title: 'Port',
      prompt: 'Database port',
      value: String(existingProfile?.port ?? defaultPort),
      ignoreFocusOut: true,
      validateInput: (value) => {
        const port = Number(value);
        return Number.isInteger(port) && port > 0 && port <= 65535 ? undefined : 'Enter a valid port.';
      }
    });
    if (!portValue) {
      return undefined;
    }

    const database = await vscode.window.showInputBox({
      title: 'Database',
      prompt: 'Database name',
      value: existingProfile?.database,
      ignoreFocusOut: true,
      validateInput: (value) => value.trim() ? undefined : 'Database is required.'
    });
    if (!database) {
      return undefined;
    }

    const username = await vscode.window.showInputBox({
      title: 'Username',
      prompt: 'Database username',
      value: existingProfile?.username,
      ignoreFocusOut: true,
      validateInput: (value) => value.trim() ? undefined : 'Username is required.'
    });
    if (!username) {
      return undefined;
    }

    let password: string | undefined;
    if (requirePassword) {
      password = await vscode.window.showInputBox({
        title: 'Password',
        prompt: 'Database password',
        password: true,
        ignoreFocusOut: true
      });
      if (password === undefined) {
        return undefined;
      }
    }

    const name = await vscode.window.showInputBox({
      title: 'Connection name',
      prompt: 'Display name in the DB Client tree',
      value: existingProfile?.name ?? `${username}@${host}/${database}`,
      ignoreFocusOut: true,
      validateInput: (value) => value.trim() ? undefined : 'Connection name is required.'
    });
    if (!name) {
      return undefined;
    }

    const defaultSchema = await vscode.window.showInputBox({
      title: 'Default schema',
      prompt: 'Optional schema used first for SQL execution and generated SQL',
      value: existingProfile?.defaultSchema ?? 'public',
      ignoreFocusOut: true
    });
    if (defaultSchema === undefined) {
      return undefined;
    }

    const schemaFilters = await vscode.window.showInputBox({
      title: 'Visible schemas',
      prompt: 'Comma-separated schema names. Leave empty to show all schemas.',
      value: existingProfile?.schemaFilters?.join(', ') ?? '',
      ignoreFocusOut: true
    });
    if (schemaFilters === undefined) {
      return undefined;
    }

    const previewLimit = await vscode.window.showInputBox({
      title: 'Table preview limit',
      prompt: 'Maximum number of rows to fetch when clicking a table',
      value: String(existingProfile?.previewLimit ?? DEFAULT_PREVIEW_LIMIT),
      ignoreFocusOut: true,
      validateInput: (value) => this.validatePreviewLimit(value)
    });
    if (previewLimit === undefined) {
      return undefined;
    }

    return {
      name: name.trim(),
      type,
      host: host.trim(),
      port: Number(portValue),
      database: database.trim(),
      username: username.trim(),
      password,
      defaultSchema: this.toOptionalString(defaultSchema),
      schemaFilters: this.parseSchemaFilters(schemaFilters),
      previewLimit: Number(previewLimit)
    };
  }

  private async saveProfiles(profiles: ConnectionProfile[]): Promise<void> {
    await this.state.update(CONNECTIONS_KEY, profiles.map((profile) => this.normalizeProfile(profile)));
  }

  private normalizeProfile(profile: ConnectionProfile): ConnectionProfile {
    return {
      ...profile,
      schemaFilters: profile.schemaFilters ?? [],
      previewLimit: profile.previewLimit ?? DEFAULT_PREVIEW_LIMIT
    };
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

  private validatePreviewLimit(value: string): string | undefined {
    const limit = Number(value);
    return Number.isInteger(limit) && limit > 0 && limit <= 10000
      ? undefined
      : 'Enter a row limit between 1 and 10000.';
  }

  private isDatabaseType(value: string): value is DatabaseType {
    return value === 'postgres' || value === 'mysql';
  }
}
