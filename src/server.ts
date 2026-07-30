import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { registerClient, authorizeUser, submitLogin, tokenExchange, handleOidcCallback } from './oauth';
import { handleMcpRequest } from './mcp';

// Load environment variables
dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// Trust proxy to correctly identify HTTPS protocol when running behind reverse proxies like ngrok
app.set('trust proxy', true);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Simple Request Logging Middleware for debugging
app.use((req, res, next) => {
  console.log(`[HTTP] ${req.method} ${req.url}`);
  next();
});

// Dynamic Client Registration (DCR)
app.post('/register', registerClient);

// OAuth 2.1 Endpoints (Both prefixed and raw to support various client defaults)
app.get('/oauth/authorize', authorizeUser);
app.get('/authorize', authorizeUser);

app.get('/oauth/callback', handleOidcCallback);
app.get('/callback', handleOidcCallback);

app.post('/oauth/login', submitLogin);
app.post('/login', submitLogin);

app.post('/oauth/token', tokenExchange);
app.post('/token', tokenExchange);

// MCP Tool Execution Endpoint (Streamable HTTP Transport - handles both /mcp and root /)
app.post('/mcp', handleMcpRequest);
app.post('/', handleMcpRequest);

// Simple Health Check
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'Atlassian BigQuery MCP Server' });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'Atlassian BigQuery MCP Server' });
});

// Start Server
if (process.env.NODE_ENV !== 'test') {
  app.listen(port, () => {
    console.log(`Atlassian BigQuery MCP Server is running at http://localhost:${port}`);
    console.log(`DCR Endpoint: http://localhost:${port}/register`);
    console.log(`OAuth Authorize Endpoint: http://localhost:${port}/oauth/authorize`);
    console.log(`OAuth Token Endpoint: http://localhost:${port}/oauth/token`);
    console.log(`MCP Transport Endpoint: http://localhost:${port}/mcp`);
  });
}

export default app;
