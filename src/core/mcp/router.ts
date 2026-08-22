import { writeAuditLog } from '../logging/audit';
import { validateQuerySafety } from './policy';
import { listAllowedTables, describeTable, estimateQueryCost, executeReadonlyQuery, searchAllowedTables } from '../../drivers/bigquery';

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

const handleToolsList = (id: any): McpResponse => {
  return {
    jsonrpc: '2.0',
    id,
    result: {
      tools: [
        {
          name: 'list_allowed_tables',
          description: 'List all BigQuery tables allowed for query execution.',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'describe_table',
          description: 'Get schema detail (columns, types, descriptions) of an allowed table.',
          inputSchema: {
            type: 'object',
            properties: {
              datasetId: { type: 'string', description: 'BigQuery dataset ID' },
              tableId: { type: 'string', description: 'BigQuery table ID' },
            },
            required: ['datasetId', 'tableId'],
          },
        },
        {
          name: 'estimate_query_cost',
          description: 'Dry-run a GoogleSQL SELECT query to estimate bytes scanned and cost projection.',
          inputSchema: {
            type: 'object',
            properties: {
              sql: { type: 'string', description: 'GoogleSQL SELECT query statement' },
            },
            required: ['sql'],
          },
        },
        {
          name: 'execute_readonly_query',
          description: 'Execute a read-only GoogleSQL SELECT query and retrieve rows. Enforces 1000 row capping and maximumBytesBilled.',
          inputSchema: {
            type: 'object',
            properties: {
              sql: { type: 'string', description: 'GoogleSQL SELECT query statement' },
            },
            required: ['sql'],
          },
        },
        {
          name: 'search_allowed_tables',
          description: "Search allowed tables and their schemas by a keyword (e.g., 'transaction', 'customer'). Returns table description, partitioning columns, clustering columns, and field schemas in one call.",
          inputSchema: {
            type: 'object',
            properties: {
              keyword: { type: 'string', description: 'The search keyword to filter table names and datasets' },
            },
            required: ['keyword'],
          },
        },
      ],
    },
  };
};

const handleQueryTool = async (
  id: any,
  userEmail: string,
  toolName: string,
  args: any,
  executeFn: (sql: string, safety: any) => Promise<any>,
  errorPrefix = 'Error'
): Promise<McpResponse> => {
  const { sql } = args;
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

  try {
    const resultText = await executeFn(sql, safety);
    return {
      jsonrpc: '2.0',
      id,
      result: {
        content: [{ type: 'text', text: resultText }],
      },
    };
  } catch (err: any) {
    writeAuditLog({
      requestId: id,
      userEmail,
      toolName,
      sql,
      tablesTouched: safety.detectedTables,
      status: 'FAILED',
      error: err.message,
    });
    return {
      jsonrpc: '2.0',
      id,
      result: {
        content: [{ type: 'text', text: `${errorPrefix}: ${err.message}` }],
        isError: true,
      },
    };
  }
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

  switch (toolName) {
    case 'list_allowed_tables': {
      try {
        const list = await listAllowedTables();
        writeAuditLog({
          requestId: id,
          userEmail,
          toolName: 'list_allowed_tables',
          status: 'SUCCESS',
          rowCount: list.length,
        });
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: JSON.stringify(list, null, 2) }],
          },
        };
      } catch (err: any) {
        writeAuditLog({
          requestId: id,
          userEmail,
          toolName: 'list_allowed_tables',
          status: 'FAILED',
          error: err.message,
        });
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: `Error: ${err.message}` }],
            isError: true,
          },
        };
      }
    }

    case 'describe_table': {
      const { datasetId, tableId } = args;
      if (!datasetId || !tableId) {
        writeAuditLog({
          requestId: id,
          userEmail,
          toolName: 'describe_table',
          status: 'REJECTED',
          denialReason: 'Error: Both datasetId and tableId are required.',
        });
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: 'Error: Both datasetId and tableId are required.' }],
            isError: true,
          },
        };
      }

      try {
        const schema = await describeTable(datasetId, tableId);
        writeAuditLog({
          requestId: id,
          userEmail,
          toolName: 'describe_table',
          tablesTouched: [`${datasetId}.${tableId}`],
          status: 'SUCCESS',
        });
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: JSON.stringify(schema, null, 2) }],
          },
        };
      } catch (err: any) {
        writeAuditLog({
          requestId: id,
          userEmail,
          toolName: 'describe_table',
          tablesTouched: [`${datasetId}.${tableId}`],
          status: 'FAILED',
          error: err.message,
        });
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: `Error: ${err.message}` }],
            isError: true,
          },
        };
      }
    }

    case 'estimate_query_cost': {
      return await handleQueryTool(id, userEmail, 'estimate_query_cost', args, async (sql, safety) => {
        const estimate = await estimateQueryCost(sql);
        if (estimate.valid) {
          writeAuditLog({
            requestId: id,
            userEmail,
            toolName: 'estimate_query_cost',
            sql,
            tablesTouched: safety.detectedTables,
            bytesEstimate: estimate.bytesScanned,
            status: 'SUCCESS',
          });
        } else {
          writeAuditLog({
            requestId: id,
            userEmail,
            toolName: 'estimate_query_cost',
            sql,
            tablesTouched: safety.detectedTables,
            status: 'FAILED',
            error: estimate.error,
          });
        }
        return JSON.stringify(estimate, null, 2);
      });
    }

    case 'execute_readonly_query': {
      return await handleQueryTool(id, userEmail, 'execute_readonly_query', args, async (sql, safety) => {
        const rows = await executeReadonlyQuery(sql);
        writeAuditLog({
          requestId: id,
          userEmail,
          toolName: 'execute_readonly_query',
          sql,
          tablesTouched: safety.detectedTables,
          status: 'SUCCESS',
          rowCount: rows.length,
        });
        return JSON.stringify(rows, null, 2);
      }, 'Database Error');
    }

    case 'search_allowed_tables': {
      const { keyword } = args;
      if (!keyword) {
        writeAuditLog({
          requestId: id,
          userEmail,
          toolName: 'search_allowed_tables',
          status: 'REJECTED',
          denialReason: 'Error: parameter "keyword" wajib diisi.',
        });
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: 'Error: parameter "keyword" wajib diisi.' }],
            isError: true,
          },
        };
      }
      try {
        const searchResults = await searchAllowedTables(keyword);
        writeAuditLog({
          requestId: id,
          userEmail,
          toolName: 'search_allowed_tables',
          status: 'SUCCESS',
        });
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: JSON.stringify(searchResults, null, 2) }],
          },
        };
      } catch (err: any) {
        writeAuditLog({
          requestId: id,
          userEmail,
          toolName: 'search_allowed_tables',
          status: 'FAILED',
          error: err.message,
        });
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: `Error: ${err.message}` }],
            isError: true,
          },
        };
      }
    }

    default: {
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Method not found: Tool "${toolName}" is not implemented` },
      };
    }
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
        return handleToolsList(id);

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
