import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { driverManager } from '../src/core/mcp/driverManager';
import path from 'path';

describe('DriverManager', () => {
  const originalEnv = process.env;

  beforeAll(async () => {
    process.env = { ...originalEnv };
    process.env.ACTIVE_DRIVERS = 'stdio'; // Test with stdio to verify child_process works
    process.env.STDIO_DRIVER_COMMAND = 'node';
    process.env.STDIO_DRIVER_ARGS = path.join(__dirname, 'mock-stdio-server.js');
    
    // We don't initialize bigquery here to avoid GCP credentials requirements in this specific test
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
