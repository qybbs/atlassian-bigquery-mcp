import { McpDriver } from '../core/mcp/driver';
import axios from 'axios';

export class SseDriver implements McpDriver {
  name = 'sse';
  prefix = 'sse_';

  private endpointUrl: string = '';
  private cachedTools: any[] | null = null;
  private messageCounter = 0;

  async initialize(): Promise<void> {
    const url = process.env.SSE_DRIVER_URL;
    if (!url) {
      throw new Error('SSE_DRIVER_URL is required to initialize SseDriver');
    }
    this.endpointUrl = url;

    // Optional: You could establish EventSource here if the downstream SSE server
    // pushes updates. For simple stateless request/response, HTTP POST might suffice 
    // depending on the target implementation. Assuming the target accepts POST /mcp.
    await this.fetchToolsFromDownstream();
  }

  private async sendRequest(method: string, params?: any): Promise<any> {
    const id = ++this.messageCounter;
    
    try {
      const response = await axios.post(this.endpointUrl, {
        jsonrpc: '2.0',
        id,
        method,
        params
      }, {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 10000 // 10 detik timeout
      });

      const data = response.data;
      if (data.error) {
        throw new Error(data.error.message || 'SSE downstream error');
      }

      return data.result;
    } catch (e: any) {
      console.error(`[SseDriver] Request failed for method ${method}:`, e.message);
      throw e;
    }
  }

  private async fetchToolsFromDownstream(): Promise<void> {
    const result = await this.sendRequest('tools/list');
    this.cachedTools = result.tools || [];
  }

  async listTools(): Promise<any[]> {
    if (!this.cachedTools) {
      await this.fetchToolsFromDownstream();
    }
    return this.cachedTools!;
  }

  async callTool(name: string, args: any): Promise<any> {
    const result = await this.sendRequest('tools/call', {
      name,
      arguments: args
    });
    
    if (result.isError) {
      throw new Error(result.content?.[0]?.text || 'Downstream tool execution failed');
    }
    
    if (result.content && Array.isArray(result.content)) {
      const text = result.content[0]?.text;
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    }
    
    return result;
  }

  async shutdown(): Promise<void> {
    // Tutup EventSource atau koneksi jika ada persistent connection
  }
}
