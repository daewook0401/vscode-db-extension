import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { DbDriver } from '../drivers/DbDriver';
import { MysqlDriver } from '../drivers/MysqlDriver';
import { PostgresDriver } from '../drivers/PostgresDriver';
import { ConnectionProfile, ConnectionProfileInput, DatabaseType } from './ConnectionProfile';
import { SecretManager } from './SecretManager';

const CONNECTIONS_KEY = 'personalDbClient.connections';
const DATABASE_TYPES: DatabaseType[] = ['postgres', 'mysql'];

export class ConnectionManager {
  constructor(
    private readonly state: vscode.Memento,
    private readonly secretManager: SecretManager
  ) {}

  public getProfiles(): ConnectionProfile[] {
    return this.state.get<ConnectionProfile[]>(CONNECTIONS_KEY, []);
  }

  public getProfile(profileId: string): ConnectionProfile | undefined {
    return this.getProfiles().find((profile) => profile.id === profileId);
  }

  public async addProfileFromInput(): Promise<ConnectionProfile | undefined> {
    const input = await this.promptForConnection();
    if (!input) {
      return undefined;
    }

    const profile: ConnectionProfile = {
      id: crypto.randomUUID(),
      name: input.name,
      type: input.type,
      host: input.host,
      port: input.port,
      database: input.database,
      username: input.username
    };

    await this.secretManager.savePassword(profile.id, input.password);
    await this.state.update(CONNECTIONS_KEY, [...this.getProfiles(), profile]);
    return profile;
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

  private async promptForConnection(): Promise<ConnectionProfileInput | undefined> {
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
      value: 'localhost',
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
      value: defaultPort,
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
      ignoreFocusOut: true,
      validateInput: (value) => value.trim() ? undefined : 'Database is required.'
    });
    if (!database) {
      return undefined;
    }

    const username = await vscode.window.showInputBox({
      title: 'Username',
      prompt: 'Database username',
      ignoreFocusOut: true,
      validateInput: (value) => value.trim() ? undefined : 'Username is required.'
    });
    if (!username) {
      return undefined;
    }

    const password = await vscode.window.showInputBox({
      title: 'Password',
      prompt: 'Database password',
      password: true,
      ignoreFocusOut: true
    });
    if (password === undefined) {
      return undefined;
    }

    const name = await vscode.window.showInputBox({
      title: 'Connection name',
      prompt: 'Display name in the DB Client tree',
      value: `${username}@${host}/${database}`,
      ignoreFocusOut: true,
      validateInput: (value) => value.trim() ? undefined : 'Connection name is required.'
    });
    if (!name) {
      return undefined;
    }

    return {
      name: name.trim(),
      type,
      host: host.trim(),
      port: Number(portValue),
      database: database.trim(),
      username: username.trim(),
      password
    };
  }

  private isDatabaseType(value: string): value is DatabaseType {
    return value === 'postgres' || value === 'mysql';
  }
}
