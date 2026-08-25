import { Router } from 'express';
import { registerClient, authorizeUser, handleOidcCallback, submitLogin, tokenExchange } from './oauth';
import { handleMcpRequest } from './mcp';

const atlassianRouter = Router();

// Dynamic Client Registration (DCR)
atlassianRouter.post('/register', registerClient);
atlassianRouter.post('/:driverName/register', registerClient);

// OAuth 2.1 Endpoints (Both prefixed and raw to support various client defaults)
atlassianRouter.get('/oauth/authorize', authorizeUser);
atlassianRouter.get('/:driverName/oauth/authorize', authorizeUser);
atlassianRouter.get('/authorize', authorizeUser);
atlassianRouter.get('/:driverName/authorize', authorizeUser);

atlassianRouter.get('/oauth/callback', handleOidcCallback);
atlassianRouter.get('/:driverName/oauth/callback', handleOidcCallback);
atlassianRouter.get('/callback', handleOidcCallback);
atlassianRouter.get('/:driverName/callback', handleOidcCallback);

atlassianRouter.post('/oauth/login', submitLogin);
atlassianRouter.post('/:driverName/oauth/login', submitLogin);
atlassianRouter.post('/login', submitLogin);
atlassianRouter.post('/:driverName/login', submitLogin);

atlassianRouter.post('/oauth/token', tokenExchange);
atlassianRouter.post('/:driverName/oauth/token', tokenExchange);
atlassianRouter.post('/token', tokenExchange);
atlassianRouter.post('/:driverName/token', tokenExchange);

// MCP Tool Execution Endpoint (Streamable HTTP Transport - handles both /mcp and root /)
// Provide a GET endpoint for Atlassian Admin UI's URL validation ping
atlassianRouter.get('/:driverName', (req, res) => res.status(200).json({ status: 'ok', driver: req.params.driverName }));
atlassianRouter.get('/:driverName/', (req, res) => res.status(200).json({ status: 'ok', driver: req.params.driverName }));
atlassianRouter.get('/:driverName/mcp', (req, res) => res.status(200).json({ status: 'ok', driver: req.params.driverName }));
atlassianRouter.get('/mcp', (req, res) => res.status(200).json({ status: 'ok' }));

atlassianRouter.post('/mcp', handleMcpRequest);
atlassianRouter.post('/:driverName/mcp', handleMcpRequest);
atlassianRouter.post('/', handleMcpRequest);
atlassianRouter.post('/:driverName', handleMcpRequest);
atlassianRouter.post('/:driverName/', handleMcpRequest);

export default atlassianRouter;
