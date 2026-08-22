import { describe, it, expect, vi, beforeAll } from 'vitest';
import request from 'supertest';
import * as jose from 'jose';
import app from '../src/server';
import { DcrPersistenceMode } from '../src/core/auth/types';
import { driverManager } from '../src/core/mcp/driverManager';
import { McpDriverType } from '../src/core/mcp/driver';

vi.mock('../src/config/gateway.config', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    gatewayConfig: {
      outboundDrivers: {
        bigquery: {
          type: 'bigquery'
        }
      }
    }
  };
});

vi.mock('@google-cloud/bigquery', () => {
  const getMetadataMock = vi.fn().mockResolvedValue([{
    description: 'Mock Description',
    type: 'TABLE',
    numRows: '100',
    schema: {
      fields: [
        { name: 'id', type: 'STRING', mode: 'REQUIRED' }
      ]
    }
  }]);

  const createQueryJobMock = vi.fn().mockResolvedValue([
    {
      id: 'job_123',
      metadata: {
        statistics: {
          query: { totalBytesProcessed: '1073741824' }
        }
      },
      getQueryResults: vi.fn().mockResolvedValue([
        [{ id: '1' }]
      ])
    }
  ]);

  const tableMock = vi.fn(() => ({
    getMetadata: getMetadataMock
  }));

  const datasetMock = vi.fn(() => ({
    table: tableMock
  }));

  class BigQueryMock {
    dataset = datasetMock;
    createQueryJob = createQueryJobMock;
  }

  return { BigQuery: BigQueryMock };
});

describe('MCP Transport Endpoint (POST /mcp)', () => {
  let token: string;
  const masterSecret = 'a3N2ZHNkZnNkZmRzZnNkZnNkZmRzZnNkZnNkZnNkZmQ=';

  beforeAll(async () => {
    process.env.MASTER_SECRET_KEY = masterSecret;
    process.env.GCP_PROJECT_ID = 'test-project';
    process.env.ALLOWLIST_TABLES = 'dataset1.table1,project2.dataset2.table2';
    process.env.DCR_PERSISTENCE_MODE = DcrPersistenceMode.STATELESS;
    process.env.ACTIVE_DRIVERS = McpDriverType.BIGQUERY;

    await driverManager.initialize();

    const secretKey = Buffer.from(masterSecret, 'base64');
    token = await new jose.SignJWT({
      email: 'test@example.com',
      client_id: 'some-client-id',
      scope: 'mcp:execute',
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(secretKey);
  });

  it('harus menolak request jika token tidak valid', async () => {
    const res = await request(app)
      .post('/atlassian/mcp')
      .set('Authorization', 'Bearer invalid-token')
      .send({
        jsonrpc: '2.0',
        id: '1',
        method: 'initialize'
      });
    expect(res.status).toBe(401);
  });

  it('harus berhasil menginisialisasi koneksi MCP', async () => {
    const res = await request(app)
      .post('/atlassian/mcp')
      .set('Authorization', `Bearer ${token}`)
      .send({
        jsonrpc: '2.0',
        id: '1',
        method: 'initialize'
      });
    expect(res.status).toBe(200);
    expect(res.body.result.serverInfo.name).toBe('enterprise-mcp-gateway');
  });

  it('harus merespon 202 pada notifications/initialized', async () => {
    const res = await request(app)
      .post('/atlassian/mcp')
      .set('Authorization', `Bearer ${token}`)
      .send({
        jsonrpc: '2.0',
        id: '2',
        method: 'notifications/initialized'
      });
    expect(res.status).toBe(202);
  });

  it('harus mendaftar semua tools pada tools/list', async () => {
    const res = await request(app)
      .post('/atlassian/mcp')
      .set('Authorization', `Bearer ${token}`)
      .send({
        jsonrpc: '2.0',
        id: '3',
        method: 'tools/list'
      });
    expect(res.status).toBe(200);
    expect(res.body.result.tools).toBeDefined();
    expect(res.body.result.tools.length).toBeGreaterThan(0);
  });

  describe('tools/call', () => {
    it('harus memanggil bigquery_list_allowed_tables', async () => {
      const res = await request(app)
        .post('/atlassian/mcp')
        .set('Authorization', `Bearer ${token}`)
        .send({
          jsonrpc: '2.0',
          id: '4',
          method: 'tools/call',
          params: {
            name: 'bigquery_list_allowed_tables'
          }
        });
      expect(res.status).toBe(200);
      expect(res.body.result.content[0].text).toContain('table1');
    });

    it('harus memanggil bigquery_describe_table', async () => {
      const res = await request(app)
        .post('/atlassian/mcp')
        .set('Authorization', `Bearer ${token}`)
        .send({
          jsonrpc: '2.0',
          id: '5',
          method: 'tools/call',
          params: {
            name: 'bigquery_describe_table',
            arguments: {
              datasetId: 'dataset1',
              tableId: 'table1'
            }
          }
        });
      expect(res.status).toBe(200);
      expect(res.body.result.content[0].text).toContain('Mock Description');
    });

    it('harus menolak bigquery_describe_table jika parameter kurang', async () => {
      const res = await request(app)
        .post('/atlassian/mcp')
        .set('Authorization', `Bearer ${token}`)
        .send({
          jsonrpc: '2.0',
          id: '6',
          method: 'tools/call',
          params: {
            name: 'bigquery_describe_table',
            arguments: {
              datasetId: 'dataset1'
            }
          }
        });
      expect(res.status).toBe(200);
      expect(res.body.result.isError).toBe(true);
      expect(res.body.result.content[0].text).toContain('required');
    });

    it('harus memanggil bigquery_estimate_query_cost', async () => {
      const res = await request(app)
        .post('/atlassian/mcp')
        .set('Authorization', `Bearer ${token}`)
        .send({
          jsonrpc: '2.0',
          id: '7',
          method: 'tools/call',
          params: {
            name: 'bigquery_estimate_query_cost',
            arguments: {
              sql: 'SELECT * FROM `dataset1.table1` LIMIT 10'
            }
          }
        });
      expect(res.status).toBe(200);
      expect(res.body.result.content[0].text).toContain('bytesScanned');
    });

    it('harus menolak bigquery_estimate_query_cost jika query tidak aman', async () => {
      const res = await request(app)
        .post('/atlassian/mcp')
        .set('Authorization', `Bearer ${token}`)
        .send({
          jsonrpc: '2.0',
          id: '8',
          method: 'tools/call',
          params: {
            name: 'bigquery_estimate_query_cost',
            arguments: {
              sql: 'DROP TABLE `dataset1.table1`'
            }
          }
        });
      expect(res.status).toBe(200);
      expect(res.body.result.isError).toBe(true);
      expect(res.body.result.content[0].text).toContain('Rejected');
    });

    it('harus memanggil bigquery_execute_readonly_query', async () => {
      const res = await request(app)
        .post('/atlassian/mcp')
        .set('Authorization', `Bearer ${token}`)
        .send({
          jsonrpc: '2.0',
          id: '9',
          method: 'tools/call',
          params: {
            name: 'bigquery_execute_readonly_query',
            arguments: {
              sql: 'SELECT * FROM `dataset1.table1` LIMIT 10'
            }
          }
        });
      expect(res.status).toBe(200);
      expect(res.body.result.content[0].text).toContain('"id": "1"');
    });

    it('harus memanggil bigquery_search_allowed_tables', async () => {
      const res = await request(app)
        .post('/atlassian/mcp')
        .set('Authorization', `Bearer ${token}`)
        .send({
          jsonrpc: '2.0',
          id: '10',
          method: 'tools/call',
          params: {
            name: 'bigquery_search_allowed_tables',
            arguments: {
              keyword: 'table1'
            }
          }
        });
      expect(res.status).toBe(200);
      expect(res.body.result.content[0].text).toContain('table1');
    });

    it('harus menolak bigquery_search_allowed_tables jika keyword kosong', async () => {
      const res = await request(app)
        .post('/atlassian/mcp')
        .set('Authorization', `Bearer ${token}`)
        .send({
          jsonrpc: '2.0',
          id: '11',
          method: 'tools/call',
          params: {
            name: 'bigquery_search_allowed_tables',
            arguments: {}
          }
        });
      expect(res.status).toBe(200);
      expect(res.body.result.isError).toBe(true);
    });
  });
});
