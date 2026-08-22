import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import path from 'path';

vi.mock('../src/config/gateway.config', () => ({
  gatewayConfig: {
    outboundDrivers: {
      stdio: {
        type: 'stdio',
        command: 'node',
        args: [path.join(__dirname, 'mock-stdio-server.js')]
      }
    }
  }
}));

import { driverManager } from '../src/core/mcp/driverManager';

describe('DriverManager', () => {
  const originalEnv = process.env;

  beforeAll(async () => {
    process.env = { ...originalEnv };

    await driverManager.initialize();
  });

  afterAll(async () => {
    await driverManager.shutdown();
    process.env = originalEnv;
  });

  it('should initialize and aggregate tools from stdio driver', async () => {
    const tools = await driverManager.getToolsList();
    
    expect(tools.length).toBeGreaterThan(0);
    // StdioDriver uses 'stdio_' prefix
    expect(tools[0].name).toBe('stdio_hello_world');
    expect(tools[0].description).toBe('A mock stdio tool');
  });

  it('should call namespaced tool successfully', async () => {
    const result = await driverManager.callTool('stdio_hello_world', {});
    
    expect(result).toBe('Hello from mock stdio server!');
  });

  it('should throw error for unknown tool', async () => {
    await expect(driverManager.callTool('unknown_tool', {}))
      .rejects
      .toThrow(/Method not found/);
  });
});
