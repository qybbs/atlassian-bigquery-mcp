import { Router } from 'express';
import { registerClient, authorizeUser, handleOidcCallback, submitLogin, tokenExchange } from './oauth';
import { handleMcpRequest } from './mcp';

const atlassianRouter = Router();

// Dynamic Client Registration (DCR)
atlassianRouter.post('/register', registerClient);

// OAuth 2.1 Endpoints (Both prefixed and raw to support various client defaults)
atlassianRouter.get('/oauth/authorize', authorizeUser);
atlassianRouter.get('/authorize', authorizeUser);

atlassianRouter.get('/oauth/callback', handleOidcCallback);
atlassianRouter.get('/callback', handleOidcCallback);

atlassianRouter.post('/oauth/login', submitLogin);
atlassianRouter.post('/login', submitLogin);

atlassianRouter.post('/oauth/token', tokenExchange);
atlassianRouter.post('/token', tokenExchange);

// MCP Tool Execution Endpoint (Streamable HTTP Transport - handles both /mcp and root /)
atlassianRouter.post('/mcp', handleMcpRequest);
atlassianRouter.post('/', handleMcpRequest);

export default atlassianRouter;
