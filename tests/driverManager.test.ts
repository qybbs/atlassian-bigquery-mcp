import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DriverManager } from '../src/core/mcp/driverManager';
import { gatewayConfig } from '../src/config/gateway.config';
import { BigQueryDriver } from '../src/drivers/bigqueryDriver';
import { StdioDriver } from '../src/drivers/stdioDriver';
import { SseDriver } from '../src/drivers/sseDriver';

vi.mock('../src/config/gateway.config', () => ({
  gatewayConfig: {
    outboundDrivers: {}
  }
}));

vi.mock('../src/drivers/bigqueryDriver');
vi.mock('../src/drivers/stdioDriver');
vi.mock('../src/drivers/sseDriver');

describe('DriverManager', () => {
  let driverManager: DriverManager;

  beforeEach(() => {
    vi.clearAllMocks();
    driverManager = new DriverManager();
    // Reset config before each test
    gatewayConfig.outboundDrivers = {};
  });

  describe('initialize', () => {
    it('harus skip jika tidak ada outboundDrivers', async () => {
      gatewayConfig.outboundDrivers = undefined as any;
      await expect(driverManager.initialize()).resolves.toBeUndefined();
    });

    it('harus inisialisasi bigquery driver', async () => {
      gatewayConfig.outboundDrivers = {
        testBq: { type: 'bigquery' }
      };

      const mockInit = vi.fn().mockResolvedValue(undefined);
      const mockListTools = vi.fn().mockResolvedValue([{ name: 'tool1' }]);
      vi.mocked(BigQueryDriver).mockImplementation(function() {
        return {
          name: 'testBq',
          prefix: 'testBq_',
          initialize: mockInit,
          listTools: mockListTools,
          callTool: vi.fn(),
          shutdown: vi.fn(),
        } as any;
      });

      await driverManager.initialize();

      expect(BigQueryDriver).toHaveBeenCalledWith({ name: 'testBq', prefix: 'testBq_' });
      expect(mockInit).toHaveBeenCalled();
      
      const tools = await driverManager.getToolsList();
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('testBq_tool1');
    });

    it('harus inisialisasi stdio driver', async () => {
      gatewayConfig.outboundDrivers = {
        testStdio: { type: 'stdio', command: 'node', args: ['-v'], env: { MOCK: '1' } }
      };

      const mockInit = vi.fn().mockResolvedValue(undefined);
      const mockListTools = vi.fn().mockResolvedValue([{ name: 'tool2' }]);
      vi.mocked(StdioDriver).mockImplementation(function() {
        return {
          name: 'testStdio',
          prefix: 'testStdio_',
          initialize: mockInit,
          listTools: mockListTools,
          callTool: vi.fn(),
          shutdown: vi.fn(),
        } as any;
      });

      await driverManager.initialize();

      expect(StdioDriver).toHaveBeenCalledWith(expect.objectContaining({
        name: 'testStdio',
        command: 'node',
        args: ['-v']
      }));
      expect(mockInit).toHaveBeenCalled();

      const tools = await driverManager.getToolsList();
      expect(tools[0].name).toBe('testStdio_tool2');
    });

    it('harus skip stdio driver jika command kosong', async () => {
      gatewayConfig.outboundDrivers = {
        testStdioBad: { type: 'stdio' } as any
      };
      await driverManager.initialize();
      expect(StdioDriver).not.toHaveBeenCalled();
    });

    it('harus inisialisasi sse driver', async () => {
      gatewayConfig.outboundDrivers = {
        testSse: { type: 'sse', url: 'http://localhost/sse' }
      };

      const mockInit = vi.fn().mockResolvedValue(undefined);
      const mockListTools = vi.fn().mockResolvedValue([{ name: 'tool3' }]);
      vi.mocked(SseDriver).mockImplementation(function() {
        return {
          name: 'testSse',
          prefix: 'testSse_',
          initialize: mockInit,
          listTools: mockListTools,
          callTool: vi.fn(),
          shutdown: vi.fn(),
        } as any;
      });

      await driverManager.initialize();

      expect(SseDriver).toHaveBeenCalledWith({
        name: 'testSse',
        prefix: 'testSse_',
        url: 'http://localhost/sse'
      });
      expect(mockInit).toHaveBeenCalled();

      const tools = await driverManager.getToolsList();
      expect(tools[0].name).toBe('testSse_tool3');
    });

    it('harus skip sse driver jika url kosong', async () => {
      gatewayConfig.outboundDrivers = {
        testSseBad: { type: 'sse' } as any
      };
      await driverManager.initialize();
      expect(SseDriver).not.toHaveBeenCalled();
    });

    it('harus skip tipe driver yang tidak dikenal', async () => {
      gatewayConfig.outboundDrivers = {
        unknownDriver: { type: 'magic' } as any
      };
      await driverManager.initialize();
      const tools = await driverManager.getToolsList();
      expect(tools).toHaveLength(0);
    });

    it('harus handle error jika driver gagal inisialisasi', async () => {
      gatewayConfig.outboundDrivers = {
        failDriver: { type: 'bigquery' }
      };

      const mockInit = vi.fn().mockRejectedValue(new Error('Init Failed'));
      vi.mocked(BigQueryDriver).mockImplementation(function() {
        return {
          name: 'failDriver',
          prefix: 'failDriver_',
          initialize: mockInit,
          listTools: vi.fn(),
          callTool: vi.fn(),
          shutdown: vi.fn(),
        } as any;
      });

      // Seharusnya tidak melempar error, tapi ditangkap di catch block dan di log
      await expect(driverManager.initialize()).resolves.toBeUndefined();
    });
  });

  describe('getToolsList & getDriverNameForTool', () => {
    beforeEach(async () => {
      gatewayConfig.outboundDrivers = {
        d1: { type: 'bigquery' },
        d2: { type: 'bigquery' }
      };
      vi.mocked(BigQueryDriver).mockImplementation(function(config: any) {
        return {
          name: config.name,
          prefix: config.prefix,
          initialize: vi.fn().mockResolvedValue(undefined),
          listTools: vi.fn().mockResolvedValue([{ name: 'toolA' }]),
          callTool: vi.fn(),
          shutdown: vi.fn(),
        } as any;
      });

      await driverManager.initialize();
    });

    it('harus filter tool berdasarkan allowedDrivers', async () => {
      const toolsD1 = await driverManager.getToolsList(['d1']);
      expect(toolsD1).toHaveLength(1);
      expect(toolsD1[0].name).toBe('d1_toolA');

      const toolsD2 = await driverManager.getToolsList(['d2']);
      expect(toolsD2).toHaveLength(1);
      expect(toolsD2[0].name).toBe('d2_toolA');
      
      const noTools = await driverManager.getToolsList(['d3']);
      expect(noTools).toHaveLength(0);
    });

    it('harus mengembalikan undefined untuk tool yang tidak dikenal', () => {
      expect(driverManager.getDriverNameForTool('unknown_tool')).toBeUndefined();
    });
  });

  describe('callTool', () => {
    let mockCallTool: any;

    beforeEach(async () => {
      mockCallTool = vi.fn().mockResolvedValue({ success: true });
      gatewayConfig.outboundDrivers = {
        mockD: { type: 'bigquery' }
      };
      vi.mocked(BigQueryDriver).mockImplementation(function() {
        return {
          name: 'mockD',
          prefix: 'mockD_',
          initialize: vi.fn().mockResolvedValue(undefined),
          listTools: vi.fn().mockResolvedValue([{ name: 'myTool' }]),
          callTool: mockCallTool,
          shutdown: vi.fn(),
        } as any;
      });

      await driverManager.initialize();
    });

    it('harus melempar error jika tool tidak terdaftar', async () => {
      await expect(driverManager.callTool('invalid_tool', {})).rejects.toThrow(/is not registered by any active driver/);
    });

    it('harus memanggil callTool pada driver dengan nama asli tool (tanpa prefix)', async () => {
      const result = await driverManager.callTool('mockD_myTool', { key: 'val' });
      expect(result).toEqual({ success: true });
      expect(mockCallTool).toHaveBeenCalledWith('myTool', { key: 'val' });
    });

    it('harus melempar error jika driver dihapus setelah inisialisasi', async () => {
      // simulate race condition / bug
      (driverManager as any).drivers.delete('mockD');
      await expect(driverManager.callTool('mockD_myTool', {})).rejects.toThrow(/Driver mockD is not active/);
    });
  });

  describe('shutdown', () => {
    it('harus memanggil shutdown di semua active drivers', async () => {
      const mockShutdown1 = vi.fn().mockResolvedValue(undefined);
      const mockShutdown2 = vi.fn().mockRejectedValue(new Error('Shutdown error'));
      
      gatewayConfig.outboundDrivers = {
        d1: { type: 'bigquery' },
        d2: { type: 'bigquery' }
      };

      vi.mocked(BigQueryDriver)
        .mockImplementationOnce(function() {
          return {
            name: 'd1',
            prefix: 'd1_',
            initialize: vi.fn().mockResolvedValue(undefined),
            listTools: vi.fn().mockResolvedValue([]),
            callTool: vi.fn(),
            shutdown: mockShutdown1,
          } as any;
        })
        .mockImplementationOnce(function() {
          return {
            name: 'd2',
            prefix: 'd2_',
            initialize: vi.fn().mockResolvedValue(undefined),
            listTools: vi.fn().mockResolvedValue([]),
            callTool: vi.fn(),
            shutdown: mockShutdown2,
          } as any;
        });

      await driverManager.initialize();
      await driverManager.shutdown();

      expect(mockShutdown1).toHaveBeenCalled();
      expect(mockShutdown2).toHaveBeenCalled(); // Shutdown should continue despite errors
    });
  });
});
