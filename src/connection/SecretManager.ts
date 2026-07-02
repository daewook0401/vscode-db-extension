import * as vscode from 'vscode';

export class SecretManager {
  constructor(private readonly secrets: vscode.SecretStorage) {}

  public getPasswordKey(profileId: string): string {
    return `personalDbClient.connection.${profileId}.password`;
  }

  public async savePassword(profileId: string, password: string): Promise<void> {
    await this.secrets.store(this.getPasswordKey(profileId), password);
  }

  public async getPassword(profileId: string): Promise<string | undefined> {
    return this.secrets.get(this.getPasswordKey(profileId));
  }

  public async deletePassword(profileId: string): Promise<void> {
    await this.secrets.delete(this.getPasswordKey(profileId));
  }
}
