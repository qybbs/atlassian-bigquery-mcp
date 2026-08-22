import express from 'express';
import { verifyJwt } from '../../core/auth/helpers';
import { routeMcpRequest } from '../../core/mcp/router';
import { sanitizeLogString } from '../../core/logging/audit';

export const handleMcpRequest = async (req: express.Request, res: express.Response) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ jsonrpc: '2.0', error: { code: -32001, message: 'Unauthorized: Missing or invalid Bearer token' } });
  }

  const token = authHeader.split(' ')[1];
  let userEmail: string;

  // Validate OAuth 2.1 JWT Access Token
  try {
    const payload = await verifyJwt(token);
    userEmail = payload.email as string;
  } catch (e: any) {
    console.warn('[MCP Auth] Invalid token access attempt:', sanitizeLogString(e.message));
    return res.status(401).json({ jsonrpc: '2.0', error: { code: -32001, message: `Unauthorized: Token validation failed (${sanitizeLogString(e.message)})` } });
  }

  const { jsonrpc, id, method, params } = req.body;

  const safeEmail = sanitizeLogString(userEmail);
  const safeMethod = sanitizeLogString(method);
  const safeId = sanitizeLogString(id);
  console.log(`[MCP Router] User: ${safeEmail} | Method: ${safeMethod} | ID: ${safeId}`);
  console.log(`[MCP Router] Request length: ${req.body ? JSON.stringify(req.body).length : 0}`);

  const mcpResponse = await routeMcpRequest({ jsonrpc, id, method, params }, userEmail);
  
  if (mcpResponse === null) {
    return res.status(202).end();
  }

  let statusCode = 200;
  if (mcpResponse.error) {
    if (mcpResponse.error.code === -32600) statusCode = 400; // Invalid Request
    else if (mcpResponse.error.code === -32601) statusCode = 404; // Method not found
    else if (mcpResponse.error.code === -32602) statusCode = 400; // Invalid params
    else if (mcpResponse.error.code === -32603) statusCode = 500; // Internal error
  }

  return res.status(statusCode).json(mcpResponse);
};
