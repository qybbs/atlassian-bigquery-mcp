import express from 'express';
import * as jose from 'jose';
import { listAllowedTables, describeTable, estimateQueryCost, executeReadonlyQuery, isTableAllowlisted, searchAllowedTables } from './bigquery';

const getSecretKey = (): Buffer => {
  const key = process.env.MASTER_SECRET_KEY;
  if (!key) {
    throw new Error('MASTER_SECRET_KEY environment variable is not set');
  }
  return Buffer.from(key, 'base64');
};

// SQL Policy Engine: Strips comments, checks read-only SELECT, blocks DML/DDL, and checks allowlisted tables
export const validateQuerySafety = (sql: string): { safe: boolean; reason?: string; detectedTables: string[] } => {
  const cleanSql = sql.trim().toLowerCase();
  
  // 1. Remove comments (both block /* */ and inline -- comments) to prevent evasion without backtracking
  const sqlWithoutComments = cleanSql.replace(/\/\*(?:\*[^\/]|[^*])*\*\/|--.*/g, '').trim();
  
  // 2. Strip backticks to simplify matching and prevent backtracking
  const sqlCleaned = sqlWithoutComments.replace(/`/g, '');
  
  // Matches either `dataset.table`, `project.dataset.table`
  const pattern = /\b([a-zA-Z0-9_-]+)\.([a-zA-Z0-9_-]+)(?:\.([a-zA-Z0-9_-]+))?\b/g;
  let match;
  const detectedTables: string[] = [];
  while ((match = pattern.exec(sqlCleaned)) !== null) {
    const dataset = match[3] ? match[2] : match[1];
    const table = match[3] ? match[3] : match[2];
    detectedTables.push(`${dataset}.${table}`);
  }

  // 3. Must start with SELECT or WITH ... SELECT
  if (!sqlWithoutComments.startsWith('select') && !sqlWithoutComments.startsWith('with')) {
    return { safe: false, reason: 'Hanya query SELECT (atau WITH ... SELECT) yang diizinkan.', detectedTables };
  }

  // 4. Denylist DDL/DML/Scripting keywords
  const forbiddenKeywords = [
    'insert', 'update', 'delete', 'merge', 'create', 'drop', 'alter',
    'truncate', 'grant', 'revoke', 'declare', 'execute immediate', 'call'
  ];
  for (const word of forbiddenKeywords) {
    const regex = new RegExp(String.raw`\b${word}\b`, 'i');
    if (regex.test(sqlWithoutComments)) {
      return { safe: false, reason: `Query mengandung keyword terlarang: "${word}"`, detectedTables };
    }
  }

  // 5. Table Allowlist verification
  if (detectedTables.length === 0) {
    return { safe: false, reason: 'Tidak dapat mendeteksi tabel rujukan. Pastikan penulisan tabel menggunakan format `dataset.table`.', detectedTables };
  }

  for (const table of detectedTables) {
    const parts = table.split('.');
    if (!isTableAllowlisted(parts[0], parts[1])) {
      return { safe: false, reason: `Tabel "${table}" tidak terdaftar dalam allowlist.`, detectedTables };
    }
  }

  return { safe: true, detectedTables };
};

const sanitizeLogString = (val: any): string => {
  if (val === undefined || val === null) return '';
  return String(val).replace(/[\r\n]/g, '');
};

// Helper for structured JSON logging (auto-parsed by Google Cloud Logging)
const writeAuditLog = (log: {
  requestId: string | number;
  userEmail: string;
  toolName: string;
  sql?: string;
  bytesEstimate?: number;
  tablesTouched?: string[];
  status: 'SUCCESS' | 'FAILED' | 'REJECTED';
  denialReason?: string;
  error?: string;
  rowCount?: number;
}) => {
  const safeUserEmail = sanitizeLogString(log.userEmail);
  const safeToolName = sanitizeLogString(log.toolName);
  const safeStatus = sanitizeLogString(log.status);

  let severity: 'ERROR' | 'WARNING' | 'INFO' = 'INFO';
  if (log.status === 'FAILED') {
    severity = 'ERROR';
  } else if (log.status === 'REJECTED') {
    severity = 'WARNING';
  }

  const auditLogEntry = {
    timestamp: new Date().toISOString(),
    severity,
    message: `[MCP AUDIT] ${safeUserEmail} executed ${safeToolName} - ${safeStatus}`,
    audit: {
      requestId: sanitizeLogString(log.requestId),
      userEmail: safeUserEmail,
      toolName: safeToolName,
      status: safeStatus,
      sql: log.sql ? sanitizeLogString(log.sql) : undefined,
      denialReason: log.denialReason ? sanitizeLogString(log.denialReason) : undefined,
      error: log.error ? sanitizeLogString(log.error) : undefined,
      bytesEstimate: log.bytesEstimate,
      rowCount: log.rowCount,
      tablesTouched: log.tablesTouched ? log.tablesTouched.map(t => sanitizeLogString(t)) : undefined,
    },
  };
  console.log(JSON.stringify(auditLogEntry));
};

// Express handler to process Model Context Protocol (MCP) JSON-RPC requests

const handleInitialize = (id: any, userEmail: string, res: express.Response) => {
  writeAuditLog({
          requestId: id,
          userEmail,
          toolName: 'initialize',
          status: 'SUCCESS',
        });
        return res.status(200).json({
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: {
              tools: {},
            },
            serverInfo: {
              name: 'bigquery-mcp-server',
              version: '1.0.0',
            },
          },
        });
};

const handleToolsList = (id: any, res: express.Response) => {
  return res.status(200).json({
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
        });
};

const handleQueryTool = async (
  id: any,
  userEmail: string,
  toolName: string,
  args: any,
  res: express.Response,
  executeFn: (sql: string, safety: any) => Promise<any>,
  errorPrefix = 'Error'
) => {
  const { sql } = args;
  if (!sql) {
    writeAuditLog({
      requestId: id,
      userEmail,
      toolName,
      status: 'REJECTED',
      denialReason: 'Error: sql query parameter is required.',
    });
    return res.status(200).json({
      jsonrpc: '2.0',
      id,
      result: {
        content: [{ type: 'text', text: 'Error: sql query parameter is required.' }],
        isError: true,
      },
    });
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
    return res.status(200).json({
      jsonrpc: '2.0',
      id,
      result: {
        content: [{ type: 'text', text: `Rejected: ${safety.reason}` }],
        isError: true,
      },
    });
  }

  try {
    const resultText = await executeFn(sql, safety);
    return res.status(200).json({
      jsonrpc: '2.0',
      id,
      result: {
        content: [{ type: 'text', text: resultText }],
      },
    });
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
    return res.status(200).json({
      jsonrpc: '2.0',
      id,
      result: {
        content: [{ type: 'text', text: `${errorPrefix}: ${err.message}` }],
        isError: true,
      },
    });
  }
};

const handleToolsCall = async (id: any, userEmail: string, params: any, res: express.Response) => {
  const toolName = params?.name;
        const args = params?.arguments || {};

        if (!toolName) {
          return res.status(400).json({
            jsonrpc: '2.0',
            id,
            error: { code: -32602, message: 'Invalid Params: params.name is required' },
          });
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
              return res.status(200).json({
                jsonrpc: '2.0',
                id,
                result: {
                  content: [{ type: 'text', text: JSON.stringify(list, null, 2) }],
                },
              });
            } catch (err: any) {
              writeAuditLog({
                requestId: id,
                userEmail,
                toolName: 'list_allowed_tables',
                status: 'FAILED',
                error: err.message,
              });
              return res.status(200).json({
                jsonrpc: '2.0',
                id,
                result: {
                  content: [{ type: 'text', text: `Error: ${err.message}` }],
                  isError: true,
                },
              });
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
              return res.status(200).json({
                jsonrpc: '2.0',
                id,
                result: {
                  content: [{ type: 'text', text: 'Error: Both datasetId and tableId are required.' }],
                  isError: true,
                },
              });
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
              return res.status(200).json({
                jsonrpc: '2.0',
                id,
                result: {
                  content: [{ type: 'text', text: JSON.stringify(schema, null, 2) }],
                },
              });
            } catch (err: any) {
              writeAuditLog({
                requestId: id,
                userEmail,
                toolName: 'describe_table',
                tablesTouched: [`${datasetId}.${tableId}`],
                status: 'FAILED',
                error: err.message,
              });
              return res.status(200).json({
                jsonrpc: '2.0',
                id,
                result: {
                  content: [{ type: 'text', text: `Error: ${err.message}` }],
                  isError: true,
                },
              });
            }
          }

          case 'estimate_query_cost': {
            return await handleQueryTool(id, userEmail, 'estimate_query_cost', args, res, async (sql, safety) => {
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
            return await handleQueryTool(id, userEmail, 'execute_readonly_query', args, res, async (sql, safety) => {
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
              return res.status(200).json({
                jsonrpc: '2.0',
                id,
                result: {
                  content: [{ type: 'text', text: 'Error: parameter "keyword" wajib diisi.' }],
                  isError: true,
                },
              });
            }
            try {
              const searchResults = await searchAllowedTables(keyword);
              writeAuditLog({
                requestId: id,
                userEmail,
                toolName: 'search_allowed_tables',
                status: 'SUCCESS',
              });
              return res.status(200).json({
                jsonrpc: '2.0',
                id,
                result: {
                  content: [{ type: 'text', text: JSON.stringify(searchResults, null, 2) }],
                },
              });
            } catch (err: any) {
              writeAuditLog({
                requestId: id,
                userEmail,
                toolName: 'search_allowed_tables',
                status: 'FAILED',
                error: err.message,
              });
              return res.status(200).json({
                jsonrpc: '2.0',
                id,
                result: {
                  content: [{ type: 'text', text: `Error: ${err.message}` }],
                  isError: true,
                },
              });
            }
          }

          default: {
            return res.status(404).json({
              jsonrpc: '2.0',
              id,
              error: { code: -32601, message: `Method not found: Tool "${toolName}" is not implemented` },
            });
          }
        }
};

export const handleMcpRequest = async (req: express.Request, res: express.Response) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ jsonrpc: '2.0', error: { code: -32001, message: 'Unauthorized: Missing or invalid Bearer token' } });
  }

  const token = authHeader.split(' ')[1];
  const secretKey = getSecretKey();
  let userEmail: string;

  // Validate OAuth 2.1 JWT Access Token
  try {
    const { payload } = await jose.jwtVerify(token, secretKey);
    userEmail = payload.email as string;
  } catch (e: any) {
    console.warn('[MCP Auth] Invalid token access attempt:', sanitizeLogString(e.message));
    return res.status(401).json({ jsonrpc: '2.0', error: { code: -32001, message: `Unauthorized: Token validation failed (${sanitizeLogString(e.message)})` } });
  }

  const { jsonrpc, id, method, params } = req.body;


  if (jsonrpc !== '2.0') {
    return res.status(400).json({ jsonrpc: '2.0', id: id || null, error: { code: -32600, message: 'Invalid Request: jsonrpc must be "2.0"' } });
  }

  const safeEmail = sanitizeLogString(userEmail);
  const safeMethod = sanitizeLogString(method);
  const safeId = sanitizeLogString(id);
  console.log(`[MCP Router] User: ${safeEmail} | Method: ${safeMethod} | ID: ${safeId}`);
  console.log(`[MCP Router] Request length: ${req.body ? JSON.stringify(req.body).length : 0}`);

  try {
    switch (method) {
      // 0. MCP Connection Initialization
      
      case 'initialize':
        return handleInitialize(id, userEmail, res);

      case 'notifications/initialized':
        return res.status(202).end();

      case 'tools/list':
        return handleToolsList(id, res);

      case 'tools/call':
        return await handleToolsCall(id, userEmail, params, res);

      default: {
        return res.status(404).json({
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Method not found: "${method}"` },
        });
      }
    }
  } catch (err: any) {
    console.error('MCP Handler Exception:', err);
    return res.status(500).json({
      jsonrpc: '2.0',
      id: id || null,
      error: { code: -32603, message: `Internal server error: ${err.message}` },
    });
  }
};
