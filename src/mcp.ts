import express from 'express';
import * as jose from 'jose';
import { listAllowedTables, describeTable, estimateQueryCost, executeReadonlyQuery, isTableAllowlisted } from './bigquery';

const getSecretKey = (): Buffer => {
  const key = process.env.MASTER_SECRET_KEY;
  if (!key) {
    throw new Error('MASTER_SECRET_KEY environment variable is not set');
  }
  return Buffer.from(key, 'base64');
};

// SQL Policy Engine: Strips comments, checks read-only SELECT, blocks DML/DDL, and checks allowlisted tables
export const validateQuerySafety = (sql: string): { safe: boolean; reason?: string } => {
  const cleanSql = sql.trim().toLowerCase();
  
  // 1. Remove comments (both block /* */ and inline -- comments) to prevent evasion
  const sqlWithoutComments = cleanSql.replace(/\/\*[\s\S]*?\*\/|--.*$/gm, '').trim();
  
  // 2. Must start with SELECT or WITH ... SELECT
  if (!sqlWithoutComments.startsWith('select') && !sqlWithoutComments.startsWith('with')) {
    return { safe: false, reason: 'Hanya query SELECT (atau WITH ... SELECT) yang diizinkan.' };
  }

  // 3. Denylist DDL/DML/Scripting keywords
  const forbiddenKeywords = [
    'insert', 'update', 'delete', 'merge', 'create', 'drop', 'alter',
    'truncate', 'grant', 'revoke', 'declare', 'execute immediate', 'call'
  ];
  for (const word of forbiddenKeywords) {
    const regex = new RegExp(`\\b${word}\\b`, 'i');
    if (regex.test(sqlWithoutComments)) {
      return { safe: false, reason: `Query mengandung keyword terlarang: "${word}"` };
    }
  }

  // 4. Table Allowlist verification
  const allowlist = (process.env.ALLOWLIST_TABLES || '')
    .split(',')
    .map(s => s.trim().toLowerCase());

  // Matches either `dataset.table`, `project.dataset.table`, or backticked versions: `dataset.table`
  const pattern = /`?([a-zA-Z0-9_-]+)\.([a-zA-Z0-9_-]+)(?:\.([a-zA-Z0-9_-]+))?`?/g;
  let match;
  const detectedTables: string[] = [];
  while ((match = pattern.exec(sqlWithoutComments)) !== null) {
    const dataset = match[3] ? match[2] : match[1];
    const table = match[3] ? match[3] : match[2];
    detectedTables.push(`${dataset}.${table}`);
  }

  if (detectedTables.length === 0) {
    return { safe: false, reason: 'Tidak dapat mendeteksi tabel rujukan. Pastikan penulisan tabel menggunakan format `dataset.table`.' };
  }

  for (const table of detectedTables) {
    const parts = table.split('.');
    if (!isTableAllowlisted(parts[0], parts[1])) {
      return { safe: false, reason: `Tabel "${table}" tidak terdaftar dalam allowlist.` };
    }
  }

  return { safe: true };
};

// Express handler to process Model Context Protocol (MCP) JSON-RPC requests
export const handleMcpRequest = async (req: express.Request, res: express.Response) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
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
    console.warn('[MCP Auth] Invalid token access attempt:', e.message);
    return res.status(401).json({ jsonrpc: '2.0', error: { code: -32001, message: `Unauthorized: Token validation failed (${e.message})` } });
  }

  const { jsonrpc, id, method, params } = req.body;

  if (jsonrpc !== '2.0') {
    return res.status(400).json({ jsonrpc: '2.0', id: id || null, error: { code: -32600, message: 'Invalid Request: jsonrpc must be "2.0"' } });
  }

  console.log(`[MCP Router] User: ${userEmail} | Method: ${method} | ID: ${id}`);

  try {
    switch (method) {
      // 1. List Available Tools
      case 'tools/list': {
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
            ],
          },
        });
      }

      // 2. Call Tool Execution
      case 'tools/call': {
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
            const list = await listAllowedTables();
            return res.status(200).json({
              jsonrpc: '2.0',
              id,
              result: {
                content: [{ type: 'text', text: JSON.stringify(list, null, 2) }],
              },
            });
          }

          case 'describe_table': {
            const { datasetId, tableId } = args;
            if (!datasetId || !tableId) {
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
              return res.status(200).json({
                jsonrpc: '2.0',
                id,
                result: {
                  content: [{ type: 'text', text: JSON.stringify(schema, null, 2) }],
                },
              });
            } catch (err: any) {
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
            const { sql } = args;
            if (!sql) {
              return res.status(200).json({
                jsonrpc: '2.0',
                id,
                result: {
                  content: [{ type: 'text', text: 'Error: sql query parameter is required.' }],
                  isError: true,
                },
              });
            }

            // Policy Engine verification
            const safety = validateQuerySafety(sql);
            if (!safety.safe) {
              return res.status(200).json({
                jsonrpc: '2.0',
                id,
                result: {
                  content: [{ type: 'text', text: `Rejected: ${safety.reason}` }],
                  isError: true,
                },
              });
            }

            const estimate = await estimateQueryCost(sql);
            return res.status(200).json({
              jsonrpc: '2.0',
              id,
              result: {
                content: [{ type: 'text', text: JSON.stringify(estimate, null, 2) }],
              },
            });
          }

          case 'execute_readonly_query': {
            const { sql } = args;
            if (!sql) {
              return res.status(200).json({
                jsonrpc: '2.0',
                id,
                result: {
                  content: [{ type: 'text', text: 'Error: sql query parameter is required.' }],
                  isError: true,
                },
              });
            }

            // Policy Engine verification
            const safety = validateQuerySafety(sql);
            if (!safety.safe) {
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
              // Custom Audit Enrichment Log
              console.log(`[AUDIT] User: ${userEmail} | Executing Query: ${sql.replace(/\n/g, ' ')}`);

              const rows = await executeReadonlyQuery(sql);
              return res.status(200).json({
                jsonrpc: '2.0',
                id,
                result: {
                  content: [{ type: 'text', text: JSON.stringify(rows, null, 2) }],
                },
              });
            } catch (err: any) {
              console.error(`[BigQuery Error] Executed by ${userEmail}:`, err.message);
              return res.status(200).json({
                jsonrpc: '2.0',
                id,
                result: {
                  content: [{ type: 'text', text: `Database Error: ${err.message}` }],
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
      }

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
