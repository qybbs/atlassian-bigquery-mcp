import { writeAuditLog } from '../logging/audit';
import { PolicyError } from './policy';
import { driverManager } from './driverManager';

export interface McpRequest {
  jsonrpc: string;
  id?: any;
  method: string;
  params?: any;
}

export interface McpResponse {
  jsonrpc: string;
  id: any;
  result?: any;
  error?: {
    code: number;
    message: string;
  };
}

const handleInitialize = (id: any, userEmail: string): McpResponse => {
  writeAuditLog({
    requestId: id,
    userEmail,
    toolName: 'initialize',
    status: 'SUCCESS',
  });
  return {
    jsonrpc: '2.0',
    id,
    result: {
      protocolVersion: '2024-11-05',
      capabilities: {
        tools: {},
      },
      serverInfo: {
        name: 'enterprise-mcp-gateway',
        version: '1.0.0',
      },
    },
  };
};

const handleToolsList = async (id: any, allowedDrivers?: string[]): Promise<McpResponse> => {
  const tools = await driverManager.getToolsList(allowedDrivers);
  return {
    jsonrpc: '2.0',
    id,
    result: {
      tools,
    },
  };
};

const handleToolsCall = async (id: any, userEmail: string, params: any, allowedDrivers?: string[]): Promise<McpResponse> => {
  const toolName = params?.name;
  const args = params?.arguments || {};

  if (!toolName) {
    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32602, message: 'Invalid Params: params.name is required' },
    };
  }

  if (allowedDrivers) {
    const driverName = driverManager.getDriverNameForTool(toolName);
    if (!driverName || !allowedDrivers.includes(driverName)) {
      writeAuditLog({
        requestId: id,
        userEmail,
        toolName,
        status: 'REJECTED',
        denialReason: `Access Denied: You do not have permission to use tools from driver ${driverName || 'unknown'}. Allowed drivers: ${allowedDrivers.join(', ')}`,
      });
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32000, message: `Access Denied: You do not have permission to use tools from driver ${driverName || 'unknown'}.` },
      };
    }
  }

  try {
    const result = await driverManager.callTool(toolName, args);
    
    let metadata: Record<string, any> | undefined = undefined;
    if (typeof result === 'object' && result !== null && '_audit' in result) {
      metadata = result._audit;
      delete result._audit;
    }

    // Asumsi bahwa driver mengembalikan objek native JS/TS, kita format sebagai JSON string jika bukan string.
    const formattedResult = typeof result === 'string' ? result : JSON.stringify(result, null, 2);

    writeAuditLog({
      requestId: id,
      userEmail,
      toolName,
      status: 'SUCCESS',
      metadata,
    });
    
    return {
      jsonrpc: '2.0',
      id,
      result: {
        content: [{ type: 'text', text: formattedResult }],
      },
    };
  } catch (err: any) {
    if (err instanceof PolicyError) {
      writeAuditLog({
        requestId: id,
        userEmail,
        toolName,
        status: 'REJECTED',
        denialReason: err.message,
        metadata: err.metadata,
      });
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: `Rejected: ${err.message}` }],
          isError: true,
        },
      };
    }

    writeAuditLog({
      requestId: id,
      userEmail,
      toolName,
      status: 'FAILED',
      error: err.message,
    });
    
    if (err.message.includes('Method not found:')) {
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: err.message },
      };
    }
    
    return {
      jsonrpc: '2.0',
      id,
      result: {
        content: [{ type: 'text', text: `Error: ${err.message}` }],
        isError: true,
      },
    };
  }
};

export const routeMcpRequest = async (request: McpRequest, userEmail: string, allowedDrivers?: string[]): Promise<McpResponse | null> => {
  const { jsonrpc, id, method, params } = request;

  if (jsonrpc !== '2.0') {
    return { jsonrpc: '2.0', id: id || null, error: { code: -32600, message: 'Invalid Request: jsonrpc must be "2.0"' } };
  }

  try {
    switch (method) {
      case 'initialize':
        return handleInitialize(id, userEmail);

      case 'notifications/initialized':
        // Notifications don't have responses
        return null;

      case 'tools/list':
        return await handleToolsList(id, allowedDrivers);

      case 'tools/call':
        return await handleToolsCall(id, userEmail, params, allowedDrivers);

      default: {
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Method not found: "${method}"` },
        };
      }
    }
  } catch (err: any) {
    console.error('MCP Router Exception:', err);
    return {
      jsonrpc: '2.0',
      id: id || null,
      error: { code: -32603, message: `Internal server error: ${err.message}` },
    };
  }
};
