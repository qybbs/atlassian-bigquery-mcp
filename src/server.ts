import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { registerClient, authorizeUser, submitLogin, tokenExchange } from './oauth';
import { handleMcpRequest } from './mcp';

// Load environment variables
dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Dynamic Client Registration (DCR)
app.post('/register', registerClient);

// OAuth 2.1 Endpoints
app.get('/oauth/authorize', authorizeUser);
app.post('/oauth/login', submitLogin);
app.post('/oauth/token', tokenExchange);

// MCP Tool Execution Endpoint (Streamable HTTP Transport)
app.post('/mcp', handleMcpRequest);

// Simple Health Check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'SERSAN BigQuery MCP Server' });
});

// Start Server
app.listen(port, () => {
  console.log(`SERSAN BigQuery MCP Server is running at http://localhost:${port}`);
  console.log(`DCR Endpoint: http://localhost:${port}/register`);
  console.log(`OAuth Authorize Endpoint: http://localhost:${port}/oauth/authorize`);
  console.log(`OAuth Token Endpoint: http://localhost:${port}/oauth/token`);
  console.log(`MCP Transport Endpoint: http://localhost:${port}/mcp`);
});
