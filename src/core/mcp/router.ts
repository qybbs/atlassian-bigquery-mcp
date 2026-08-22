import { writeAuditLog } from '../logging/audit';
import { validateQuerySafety } from './policy';
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

const handleToolsList = async (id: any): Promise<McpResponse> => {
  const tools = await driverManager.getToolsList();
  return {
    jsonrpc: '2.0',
    id,
    result: {
      tools,
    },
  };
};

const handleToolsCall = async (id: any, userEmail: string, params: any): Promise<McpResponse> => {
  const toolName = params?.name;
  const args = params?.arguments || {};

  if (!toolName) {
    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32602, message: 'Invalid Params: params.name is required' },
    };
  }

  // Fase 4: Granular Policy Engine guardrails (untuk BigQuery sql-based tools)
  let tablesTouched: string[] | undefined = undefined;
  if (toolName === 'estimate_query_cost' || toolName === 'execute_readonly_query') {
    const sql = args.sql;
    if (!sql) {
      writeAuditLog({
        requestId: id,
        userEmail,
        toolName,
        status: 'REJECTED',
        denialReason: 'Error: sql query parameter is required.',
      });
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: 'Error: sql query parameter is required.' }],
          isError: true,
        },
      };
    }

    const safety = validateQuerySafety(sql);
    if (!safety.safe) {
      writeAuditLog({
        requestId: id,
        userEmail,
        toolName,
        sql,
        tablesTouched: safety.detectedTables,
        status: 'REJECTED',
        denialReason: safety.reason,
      });
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: `Rejected: ${safety.reason}` }],
          isError: true,
        },
      };
    }
    tablesTouched = safety.detectedTables;
  }

  try {
    const result = await driverManager.callTool(toolName, args);
    
    // Asumsi bahwa driver mengembalikan objek native JS/TS, kita format sebagai JSON string jika bukan string.
    const formattedResult = typeof result === 'string' ? result : JSON.stringify(result, null, 2);

    writeAuditLog({
      requestId: id,
      userEmail,
      toolName,
      status: 'SUCCESS',
      tablesTouched,
      // Jika butuh bytesEstimate atau rowCount, bisa diekstrak jika bentuk result dikenali.
      bytesEstimate: result && typeof result === 'object' && result.bytesScanned ? result.bytesScanned : undefined,
      rowCount: result && Array.isArray(result) ? result.length : undefined,
    });
    
    return {
      jsonrpc: '2.0',
      id,
      result: {
        content: [{ type: 'text', text: formattedResult }],
      },
    };
  } catch (err: any) {
    writeAuditLog({
      requestId: id,
      userEmail,
      toolName,
      status: 'FAILED',
      error: err.message,
      tablesTouched,
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

export const routeMcpRequest = async (request: McpRequest, userEmail: string): Promise<McpResponse | null> => {
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
        return await handleToolsList(id);

      case 'tools/call':
        return await handleToolsCall(id, userEmail, params);

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
