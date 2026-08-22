import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import atlassianRouter from './adapters/atlassian/routes';
import { validateEnv } from './config/gateway.config';
import { driverManager } from './core/mcp/driverManager';

// Load environment variables
dotenv.config();

const app = express();
app.disable('x-powered-by'); // Prevent Express version disclosure
const port = process.env.PORT || 3000;

// Trust proxy to correctly identify HTTPS protocol when running behind reverse proxies like ngrok
app.set('trust proxy', true);

// Middleware
const allowedOrigins = (process.env.ALLOWED_CORS_ORIGINS || '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

app.use(cors((req, callback) => {
  const origin = req.header('Origin');
  const host = req.header('Host');
  
  let isAllowed = false;
  if (!origin) {
    // Allow requests with no origin (e.g., curl, backend-to-backend)
    isAllowed = true;
  } else if (allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
    isAllowed = true;
  } else if (host && origin.includes(host)) {
    // Allow requests where the Origin matches our own Host (e.g., form submissions on the same domain)
    isAllowed = true;
  }

  if (isAllowed) {
    callback(null, { origin: true });
  } else {
    callback(new Error('Not allowed by CORS'), { origin: false });
  }
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Simple Request Logging Middleware for debugging
app.use((req, res, next) => {
  const safeUrl = String(req.url || '').replace(/[\r\n]/g, '');
  const safeMethod = String(req.method || '').replace(/[\r\n]/g, '');
  console.log(`[HTTP] ${safeMethod} ${safeUrl}`);
  next();
});

// OAuth 2.0 / OIDC Discovery Endpoints (RFC 8414)
// Atlassian checks these on the root domain when setting up an external MCP server
app.get(['/.well-known/oauth-authorization-server', '/.well-known/openid-configuration'], (req, res) => {
  const baseUrl = `${req.protocol}://${req.get('host')}/atlassian`;
  res.json({
    issuer: baseUrl,
    registration_endpoint: `${baseUrl}/register`,
    authorization_endpoint: `${baseUrl}/oauth/authorize`,
    token_endpoint: `${baseUrl}/oauth/token`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256', 'plain']
  });
});

app.use('/.well-known/oauth-protected-resource', (req, res) => {
  res.json({
    authorization_server: `${req.protocol}://${req.get('host')}`
  });
});

// Mount Atlassian Adapter Routes
app.use('/atlassian', atlassianRouter);

// Simple Health Check
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'Enterprise SaaS-to-MCP Gateway' });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'Enterprise SaaS-to-MCP Gateway' });
});

// Start Server
if (process.env.NODE_ENV !== 'test') {
  (async () => {
    try {
      validateEnv();
      await driverManager.initialize();
    } catch (error: any) {
      console.error(`[FATAL] Startup validation/initialization failed: ${error.message}`);
      process.exit(1);
    }

    app.listen(port, () => {
      console.log(`Enterprise SaaS-to-MCP Gateway is running at http://localhost:${port}`);
      console.log(`DCR Endpoint: http://localhost:${port}/register`);
      console.log(`OAuth Authorize Endpoint: http://localhost:${port}/oauth/authorize`);
      console.log(`OAuth Token Endpoint: http://localhost:${port}/oauth/token`);
      console.log(`MCP Transport Endpoint: http://localhost:${port}/mcp`);
    });
  })();
}

export default app;
