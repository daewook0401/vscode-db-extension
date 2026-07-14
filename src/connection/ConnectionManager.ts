import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { DbDriver } from '../drivers/DbDriver';
import { MysqlDriver } from '../drivers/MysqlDriver';
import { PostgresDriver } from '../drivers/PostgresDriver';
import {
  ConnectionProfile,
  ConnectionProfileInput,
  ConnectionProfileUpdateInput,
  SslMode
} from './ConnectionProfile';
import { SecretManager } from './SecretManager';

const CONNECTIONS_KEY = 'personalDbClient.connections';
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

  public async addProfile(input: ConnectionProfileInput): Promise<ConnectionProfile> {
    const profile: ConnectionProfile = {
      id: crypto.randomUUID(),
      name: input.name,
      type: input.type,
      host: input.host,
      port: input.port,
      database: input.database,
      username: input.username,
      sslMode: input.sslMode,
      defaultSchema: input.defaultSchema,
      schemaFilters: input.schemaFilters,
      previewLimit: input.previewLimit
    };

    await this.secretManager.savePassword(profile.id, input.password);
    await this.saveProfiles([...this.getProfiles(), profile]);
    return profile;
  }

  public async updateProfile(
    profile: ConnectionProfile,
    input: ConnectionProfileUpdateInput
  ): Promise<ConnectionProfile> {
    const updatedProfile: ConnectionProfile = {
      id: profile.id,
      name: input.name,
      type: input.type,
      host: input.host,
      port: input.port,
      database: input.database,
      username: input.username,
      sslMode: input.sslMode,
      defaultSchema: input.defaultSchema,
      schemaFilters: input.schemaFilters,
      previewLimit: input.previewLimit
    };

    if (input.password !== undefined && input.password.length > 0) {
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

    return this.createDriverWithPassword(profile, password);
  }

  public async testConnectionInput(
    input: ConnectionProfileInput | ConnectionProfileUpdateInput,
    existingProfile?: ConnectionProfile
  ): Promise<void> {
    const password = input.password !== undefined
      ? input.password
      : existingProfile
        ? await this.secretManager.getPassword(existingProfile.id)
        : undefined;

    if (password === undefined) {
      throw new Error('Password is required to test this connection.');
    }

    const temporaryProfile: ConnectionProfile = {
      id: existingProfile?.id ?? 'connection-test',
      name: input.name,
      type: input.type,
      host: input.host,
      port: input.port,
      database: input.database,
      username: input.username,
      sslMode: input.sslMode,
      defaultSchema: input.defaultSchema,
      schemaFilters: input.schemaFilters,
      previewLimit: input.previewLimit
    };
    const driver = this.createDriverWithPassword(temporaryProfile, password);

    try {
      await driver.connect();
    } finally {
      await driver.dispose();
    }
  }

  private createDriverWithPassword(profile: ConnectionProfile, password: string): DbDriver {
    if (profile.type === 'postgres') {
      return new PostgresDriver(profile, password);
    }

    return new MysqlDriver();
  }

  private async saveProfiles(profiles: ConnectionProfile[]): Promise<void> {
    await this.state.update(CONNECTIONS_KEY, profiles.map((profile) => this.normalizeProfile(profile)));
  }

  private normalizeProfile(profile: ConnectionProfile): ConnectionProfile {
    return {
      ...profile,
      sslMode: this.normalizeSslMode(profile.sslMode),
      schemaFilters: profile.schemaFilters ?? [],
      previewLimit: profile.previewLimit ?? DEFAULT_PREVIEW_LIMIT
    };
  }

  private parseSchemaFilters(value: string): string[] {
    return [...new Set(value.split(',').map((schema) => schema.trim()).filter(Boolean))];
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

  private normalizeSslMode(value: SslMode | undefined): SslMode {
    return value === 'require' || value === 'verify-full' ? value : 'disable';
  }
}
