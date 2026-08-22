import { McpDriver, McpDriverType } from './driver';
import { BigQueryDriver } from '../../drivers/bigqueryDriver';
import { StdioDriver } from '../../drivers/stdioDriver';
import { SseDriver } from '../../drivers/sseDriver';

export class DriverManager {
  private drivers: Map<string, McpDriver> = new Map();
  // Map dari toolName ke nama driver pemiliknya
  private toolRegistry: Map<string, string> = new Map();
  
  // Untuk menyimpan agregasi metadata tools
  private cachedToolsList: any[] = [];

  async initialize(): Promise<void> {
    const activeDriversRaw = process.env.ACTIVE_DRIVERS || McpDriverType.BIGQUERY;
    const activeDriverNames = activeDriversRaw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

    for (const name of activeDriverNames) {
      let driver: McpDriver;

      switch (name as McpDriverType) {
        case McpDriverType.BIGQUERY:
          driver = new BigQueryDriver();
          break;
        case McpDriverType.STDIO:
          driver = new StdioDriver();
          break;
        case McpDriverType.SSE:
          driver = new SseDriver();
          break;
        default:
          console.warn(`[DriverManager] Unknown driver requested: ${name}`);
          continue;
      }

      try {
        await driver.initialize();
        this.drivers.set(name, driver);
        console.log(`[DriverManager] Initialized driver: ${name}`);
      } catch (err: any) {
        console.error(`[DriverManager] Failed to initialize driver ${name}:`, err.message);
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

  async getToolsList(): Promise<any[]> {
    // Return aggregated list of namespaced tools
    return this.cachedToolsList;
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
