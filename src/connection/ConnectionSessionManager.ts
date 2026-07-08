import { DbDriver } from '../drivers/DbDriver';
import { ConnectionManager } from './ConnectionManager';
import { ConnectionProfile } from './ConnectionProfile';

export class ConnectionSessionManager {
  private readonly drivers = new Map<string, DbDriver>();

  constructor(private readonly connectionManager: ConnectionManager) {}

  public isConnected(profileId: string): boolean {
    return this.drivers.has(profileId);
  }

  public async getDriver(profile: ConnectionProfile): Promise<DbDriver> {
    const cachedDriver = this.drivers.get(profile.id);
    if (cachedDriver) {
      return cachedDriver;
    }

    const driver = await this.connectionManager.createDriver(profile);
    try {
      await driver.connect();
      this.drivers.set(profile.id, driver);
      return driver;
    } catch (error) {
      await driver.dispose();
      throw error;
    }
  }

  public async testConnection(profile: ConnectionProfile): Promise<void> {
    const driver = await this.getDriver(profile);
    await driver.connect();
  }

  public async disconnect(profileId: string): Promise<boolean> {
    const driver = this.drivers.get(profileId);
    if (!driver) {
      return false;
    }

    this.drivers.delete(profileId);
    await driver.dispose();
    return true;
  }

  public async disconnectAll(): Promise<void> {
    const drivers = [...this.drivers.values()];
    this.drivers.clear();

    await Promise.all(drivers.map((driver) => driver.dispose()));
  }
}
