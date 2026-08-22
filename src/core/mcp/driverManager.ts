import { McpDriver, McpDriverType } from './driver';
import { BigQueryDriver } from '../../drivers/bigqueryDriver';
import { StdioDriver } from '../../drivers/stdioDriver';
import { SseDriver } from '../../drivers/sseDriver';
import { gatewayConfig } from '../../config/gateway.config';

export class DriverManager {
  private drivers: Map<string, McpDriver> = new Map();
  // Map dari toolName ke nama driver pemiliknya
  private toolRegistry: Map<string, string> = new Map();
  
  // Untuk menyimpan agregasi metadata tools
  private cachedToolsList: any[] = [];

  async initialize(): Promise<void> {
    const config = gatewayConfig;
    if (!config || !config.outboundDrivers) {
      console.warn('[DriverManager] No outbound drivers configured.');
      return;
    }

    for (const [driverName, driverConfig] of Object.entries(config.outboundDrivers)) {
      let driver: McpDriver;
      const prefix = `${driverName}_`;

      switch (driverConfig.type) {
        case 'bigquery':
          driver = new BigQueryDriver({ name: driverName, prefix });
          break;
        case 'stdio':
          if (!driverConfig.command) {
            console.error(`[DriverManager] Driver ${driverName} of type stdio missing command`);
            continue;
          }
          driver = new StdioDriver({
            name: driverName,
            prefix,
            command: driverConfig.command,
            args: driverConfig.args || [],
            env: {
              ...process.env,
              ...(driverConfig.env || {})
            }
          });
          break;
        case 'sse':
          if (!driverConfig.url) {
            console.error(`[DriverManager] Driver ${driverName} of type sse missing url`);
            continue;
          }
          driver = new SseDriver({
            name: driverName,
            prefix,
            url: driverConfig.url
          });
          break;
        default:
          console.warn(`[DriverManager] Unknown driver type for ${driverName}`);
          continue;
      }

      try {
        await driver.initialize();
        this.drivers.set(driverName, driver);
        console.log(`[DriverManager] Initialized driver: ${driverName}`);
      } catch (err: any) {
        console.error(`[DriverManager] Failed to initialize driver ${driverName}:`, err.message);
      }
    }

    await this.aggregateTools();
  }

  private async aggregateTools(): Promise<void> {
    this.cachedToolsList = [];
    this.toolRegistry.clear();

    for (const [driverName, driver] of this.drivers.entries()) {
      try {
        const tools = await driver.listTools();
        
        for (const tool of tools) {
          // Namespace nama tool jika driver memiliki prefix
          const namespacedName = driver.prefix ? `${driver.prefix}${tool.name}` : tool.name;
          
          this.cachedToolsList.push({
            ...tool,
            name: namespacedName,
          });

          this.toolRegistry.set(namespacedName, driverName);
        }
      } catch (err: any) {
        console.error(`[DriverManager] Failed to fetch tools from driver ${driverName}:`, err.message);
      }
    }
  }

  async getToolsList(allowedDrivers?: string[]): Promise<any[]> {
    if (allowedDrivers) {
      return this.cachedToolsList.filter(tool => {
        const driverName = this.toolRegistry.get(tool.name);
        return driverName && allowedDrivers.includes(driverName);
      });
    }
    return this.cachedToolsList;
  }

  getDriverNameForTool(namespacedName: string): string | undefined {
    return this.toolRegistry.get(namespacedName);
  }

  async callTool(namespacedName: string, args: any): Promise<any> {
    const driverName = this.toolRegistry.get(namespacedName);
    
    if (!driverName) {
      throw new Error(`Method not found: Tool "${namespacedName}" is not registered by any active driver.`);
    }

    const driver = this.drivers.get(driverName);
    if (!driver) {
      throw new Error(`Driver ${driverName} is not active.`);
    }

    // Hilangkan prefix sebelum mengirim request ke downstream
    let originalName = namespacedName;
    if (driver.prefix && namespacedName.startsWith(driver.prefix)) {
      originalName = namespacedName.substring(driver.prefix.length);
    }

    return await driver.callTool(originalName, args);
  }

  async shutdown(): Promise<void> {
    for (const driver of this.drivers.values()) {
      try {
        await driver.shutdown();
      } catch (e: any) {
        console.error(`[DriverManager] Error shutting down driver ${driver.name}:`, e.message);
      }
    }
  }
}

// Export sebuah instance singleton untuk digunakan oleh router
export const driverManager = new DriverManager();
