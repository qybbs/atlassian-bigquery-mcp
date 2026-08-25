import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { SseDriver } from '../src/drivers/sseDriver';

vi.mock('axios');

describe('SseDriver', () => {
  const mockConfig = {
    name: 'testSse',
    prefix: '/test-sse',
    url: 'http://localhost:8080/mcp'
  };

  let driver: SseDriver;

  beforeEach(() => {
    vi.clearAllMocks();
    driver = new SseDriver(mockConfig);
  });

  describe('initialize', () => {
    it('harus throw error jika url kosong', async () => {
      const invalidDriver = new SseDriver({ ...mockConfig, url: '' });
      await expect(invalidDriver.initialize()).rejects.toThrow(/URL is required/);
    });

    it('harus memanggil fetchToolsFromDownstream dan mengisi cachedTools', async () => {
      vi.mocked(axios.post).mockResolvedValueOnce({
        data: {
          result: {
            tools: [{ name: 'test_tool' }]
          }
        }
      });

      await driver.initialize();
      expect(axios.post).toHaveBeenCalledWith(
        mockConfig.url,
        expect.objectContaining({ method: 'tools/list' }),
        expect.any(Object)
      );
      
      const tools = await driver.listTools();
      expect(tools).toEqual([{ name: 'test_tool' }]);
    });
  });

  describe('listTools', () => {
    it('harus mengembalikan cachedTools jika sudah ada', async () => {
      vi.mocked(axios.post).mockResolvedValueOnce({
        data: { result: { tools: [{ name: 'cached_tool' }] } }
      });
      await driver.initialize(); // fetch and cache

      vi.mocked(axios.post).mockClear();

      const tools = await driver.listTools();
      expect(tools).toEqual([{ name: 'cached_tool' }]);
      expect(axios.post).not.toHaveBeenCalled();
    });

    it('harus fetchToolsFromDownstream jika cachedTools belum ada', async () => {
      vi.mocked(axios.post).mockResolvedValueOnce({
        data: { result: { tools: [{ name: 'fetched_tool' }] } }
      });
      
      const tools = await driver.listTools();
      expect(tools).toEqual([{ name: 'fetched_tool' }]);
      expect(axios.post).toHaveBeenCalledTimes(1);
    });
  });

  describe('sendRequest error handling', () => {
    it('harus melempar error jika response berisi error dari downstream', async () => {
      vi.mocked(axios.post).mockResolvedValueOnce({
        data: {
          error: { message: 'Something went wrong' }
        }
      });

      await expect(driver.listTools()).rejects.toThrow('Something went wrong');
    });

    it('harus melempar error jika request axios gagal', async () => {
      vi.mocked(axios.post).mockRejectedValueOnce(new Error('Network Error'));

      await expect(driver.listTools()).rejects.toThrow('Network Error');
    });
  });

  describe('callTool', () => {
    it('harus parse JSON content dari result', async () => {
      vi.mocked(axios.post).mockResolvedValueOnce({
        data: {
          result: {
            content: [{ text: '{"success":true}' }]
          }
        }
      });

      const res = await driver.callTool('some_tool', { arg: 1 });
      expect(res).toEqual({ success: true });
      expect(axios.post).toHaveBeenCalledWith(
        mockConfig.url,
        expect.objectContaining({
          method: 'tools/call',
          params: { name: 'some_tool', arguments: { arg: 1 } }
        }),
        expect.any(Object)
      );
    });

    it('harus melempar error jika result.isError true', async () => {
      vi.mocked(axios.post).mockResolvedValueOnce({
        data: {
          result: {
            isError: true,
            content: [{ text: 'Tool failed internally' }]
          }
        }
      });

      await expect(driver.callTool('bad_tool', {})).rejects.toThrow('Tool failed internally');
    });

    it('harus mengembalikan string mentah jika JSON parse gagal', async () => {
      vi.mocked(axios.post).mockResolvedValueOnce({
        data: {
          result: {
            content: [{ text: 'Not JSON format' }]
          }
        }
      });

      const res = await driver.callTool('text_tool', {});
      expect(res).toBe('Not JSON format');
    });

    it('harus mengembalikan seluruh result jika content kosong', async () => {
      vi.mocked(axios.post).mockResolvedValueOnce({
        data: {
          result: { ok: 1 }
        }
      });

      const res = await driver.callTool('void_tool', {});
      expect(res).toEqual({ ok: 1 });
    });
  });

  describe('shutdown', () => {
    it('harus selesai dengan aman', async () => {
      await expect(driver.shutdown()).resolves.toBeUndefined();
    });
  });
});
