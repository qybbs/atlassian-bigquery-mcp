import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import * as jose from 'jose';
import app from '../src/server';
import { DcrPersistenceMode } from '../src/core/auth/types';
import { driverManager } from '../src/core/mcp/driverManager';
import { McpDriverType } from '../src/core/mcp/driver';

describe('Express Server API', () => {
  beforeAll(async () => {
    process.env.MASTER_SECRET_KEY = 'a3N2ZHNkZnNkZmRzZnNkZnNkZmRzZnNkZnNkZnNkZmQ='; // valid base64 32 bytes (mock)
    process.env.GCP_PROJECT_ID = 'mock-project';
    process.env.ALLOWLIST_TABLES = 'dataset.mock_table';
    process.env.DCR_PERSISTENCE_MODE = DcrPersistenceMode.STATELESS;
    process.env.ACTIVE_DRIVERS = McpDriverType.BIGQUERY;
    process.env.AUTH_PROVIDER = 'MOCK';
    process.env.MOCK_USER_EMAIL = 'test@example.com';
    process.env.MOCK_USER_PASSWORD = 'password123';
    process.env.ALLOWED_CORS_ORIGINS = 'https://api.atlassian.com';

    await driverManager.initialize();
  });

  describe('GET /health', () => {
    it('harus merespon dengan status ok', async () => {
      const response = await request(app).get('/health');
      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        status: 'ok',
        service: 'Enterprise SaaS-to-MCP Gateway'
      });
    });
  });

  describe('GET /', () => {
    it('harus merespon dengan status ok pada root', async () => {
      const response = await request(app).get('/');
      expect(response.status).toBe(200);
      expect(response.body.status).toBe('ok');
    });
  });

  describe('CORS Middleware', () => {
    it('harus mengizinkan request dari origin yang diperbolehkan', async () => {
      const response = await request(app)
        .get('/health')
        .set('Origin', 'https://api.atlassian.com');
      expect(response.status).toBe(200);
      expect(response.headers['access-control-allow-origin']).toBe('https://api.atlassian.com');
    });

    it('harus menolak request dari origin yang tidak diperbolehkan', async () => {
      const response = await request(app)
        .get('/health')
        .set('Origin', 'http://malicious-site.com');
      expect(response.status).toBe(500);
      expect(response.text).toContain('Not allowed by CORS');
    });
  });

  describe('POST /mcp', () => {
    it('harus menolak request tanpa header Authorization', async () => {
      const response = await request(app)
        .post('/atlassian/mcp')
        .send({
          jsonrpc: '2.0',
          method: 'tools/list',
          id: 1
        });
      
      expect(response.status).toBe(401);
      expect(response.body.error.message).toContain('Missing or invalid Bearer token');
    });

    it('harus menolak request dengan token invalid', async () => {
      const response = await request(app)
        .post('/atlassian/mcp')
        .set('Authorization', 'Bearer invalid.token.here')
        .send({
          jsonrpc: '2.0',
          method: 'tools/list',
          id: 1
        });
      
      expect(response.status).toBe(401);
      expect(response.body.error.message).toContain('Unauthorized: Token validation failed');
    });

    it('harus menolak request jika jsonrpc bukan 2.0', async () => {
      const secret = Buffer.from('a3N2ZHNkZnNkZmRzZnNkZnNkZmRzZnNkZnNkZnNkZmQ=', 'base64');
      const token = await new jose.SignJWT({ email: 'test@example.com' })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(secret);

      const response = await request(app)
        .post('/atlassian/mcp')
        .set('Authorization', `Bearer ${token}`)
        .send({
          jsonrpc: '1.0',
          method: 'tools/list',
          id: 1
        });
      
      expect(response.status).toBe(400);
      expect(response.body.error.message).toContain('jsonrpc must be "2.0"');
    });

    it('harus merespon method not found untuk method yang tidak dikenal', async () => {
      const secret = Buffer.from('a3N2ZHNkZnNkZmRzZnNkZnNkZmRzZnNkZnNkZnNkZmQ=', 'base64');
      const token = await new jose.SignJWT({ email: 'test@example.com' })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(secret);

      const response = await request(app)
        .post('/atlassian/mcp')
        .set('Authorization', `Bearer ${token}`)
        .send({
          jsonrpc: '2.0',
          method: 'unknown_method',
          id: 1
        });
      
      expect(response.status).toBe(404);
      expect(response.body.error.message).toContain('Method not found');
    });

    it('harus merespon tool not found jika tools/call meminta tool yang tidak ada', async () => {
      const secret = Buffer.from('a3N2ZHNkZnNkZmRzZnNkZnNkZmRzZnNkZnNkZnNkZmQ=', 'base64');
      const token = await new jose.SignJWT({ email: 'test@example.com' })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(secret);

      const response = await request(app)
        .post('/atlassian/mcp')
        .set('Authorization', `Bearer ${token}`)
        .send({
          jsonrpc: '2.0',
          method: 'tools/call',
          id: 1,
          params: { name: 'unknown_tool', arguments: {} }
        });
      
      expect(response.status).toBe(404);
      expect(response.body.error.message).toContain('Method not found: Tool "unknown_tool" is not registered by any active driver.');
    });
  });
});
