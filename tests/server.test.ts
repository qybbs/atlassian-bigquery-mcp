import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import app from '../src/server';

describe('Express Server API', () => {
  beforeAll(() => {
    process.env.MASTER_SECRET_KEY = 'a3N2ZHNkZnNkZmRzZnNkZnNkZmRzZnNkZnNkZnNkZmQ='; // valid base64 32 bytes (mock)
  });

  describe('GET /health', () => {
    it('harus merespon dengan status ok', async () => {
      const response = await request(app).get('/health');
      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        status: 'ok',
        service: 'Atlassian BigQuery MCP Server'
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

  describe('POST /mcp', () => {
    it('harus menolak request tanpa header Authorization', async () => {
      const response = await request(app)
        .post('/mcp')
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
        .post('/mcp')
        .set('Authorization', 'Bearer invalid.token.here')
        .send({
          jsonrpc: '2.0',
          method: 'tools/list',
          id: 1
        });
      
      expect(response.status).toBe(401);
      expect(response.body.error.message).toContain('Unauthorized: Token validation failed');
    });
  });
});
