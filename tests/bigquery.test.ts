import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as bigquery from '../src/bigquery';

// Mock @google-cloud/bigquery
vi.mock('@google-cloud/bigquery', () => {
  const getMetadataMock = vi.fn().mockResolvedValue([{
    description: 'Mock Description',
    type: 'TABLE',
    numRows: '100',
    schema: {
      fields: [
        { name: 'id', type: 'STRING', mode: 'REQUIRED' },
        { name: 'created_at', type: 'TIMESTAMP', mode: 'NULLABLE' }
      ]
    },
    timePartitioning: { type: 'DAY', field: 'created_at' }
  }]);

  const createQueryJobMock = vi.fn().mockResolvedValue([
    {
      id: 'job_123',
      metadata: {
        statistics: {
          query: { totalBytesProcessed: '1073741824' } // 1 GB
        }
      },
      getQueryResults: vi.fn().mockResolvedValue([
        [{ id: '1', created_at: '2023-01-01T00:00:00Z' }]
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

describe('bigquery module', () => {
  beforeEach(() => {
    process.env.GCP_PROJECT_ID = 'test-project';
    process.env.ALLOWLIST_TABLES = 'dataset1.table1,project2.dataset2.table2';
    vi.clearAllMocks();
  });

  describe('isTableAllowlisted', () => {
    it('harus mengenali tabel tanpa project ID yang ada di allowlist', () => {
      expect(bigquery.isTableAllowlisted('dataset1', 'table1')).toBe(true);
    });

    it('harus mengenali tabel dengan project ID yang ada di allowlist', () => {
      expect(bigquery.isTableAllowlisted('dataset2', 'table2')).toBe(true);
    });

    it('harus mengabaikan case (case-insensitive)', () => {
      expect(bigquery.isTableAllowlisted('DATASET1', 'TABLE1')).toBe(true);
    });

    it('harus mengembalikan false untuk tabel yang tidak terdaftar', () => {
      expect(bigquery.isTableAllowlisted('dataset3', 'table3')).toBe(false);
    });
  });

  describe('listAllowedTables', () => {
    it('harus mengambil metadata dari tabel-tabel di allowlist', async () => {
      const tables = await bigquery.listAllowedTables();
      expect(tables.length).toBe(2);
      expect(tables[0].name).toBe('table1');
      expect(tables[0].dataset).toBe('dataset1');
      expect(tables[0].description).toBe('Mock Description');
      expect(tables[0].numRows).toBe(100);
    });
  });

  describe('describeTable', () => {
    it('harus membuang error jika tabel tidak terdaftar', async () => {
      await expect(bigquery.describeTable('dataset3', 'table3')).rejects.toThrow(/not in the allowlist/);
    });

    it('harus mengembalikan skema untuk tabel yang diizinkan', async () => {
      const schema = await bigquery.describeTable('dataset1', 'table1');
      expect(schema.table).toBe('dataset1.table1');
      expect(schema.fields.length).toBe(2);
      expect(schema.fields[0].name).toBe('id');
      expect(schema.partitionInfo?.type).toBe('TIME');
    });
  });

  describe('estimateQueryCost', () => {
    it('harus menghitung estimasi biaya berdasarkan dryRun', async () => {
      const estimate = await bigquery.estimateQueryCost('SELECT * FROM dataset1.table1');
      expect(estimate.valid).toBe(true);
      expect(estimate.bytesScanned).toBe(1073741824); // 1 GB
      expect(estimate.bytesScannedGb).toBe(1);
      expect(estimate.estimatedCostUsd).toBe(0.00625);
    });
  });

  describe('executeReadonlyQuery', () => {
    it('harus mengeksekusi query dan membatasi maxResults client-side', async () => {
      const results = await bigquery.executeReadonlyQuery('SELECT * FROM dataset1.table1');
      expect(results.length).toBe(1);
      expect(results[0].id).toBe('1');
    });
  });
});
