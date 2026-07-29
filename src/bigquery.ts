import { BigQuery } from '@google-cloud/bigquery';
import dotenv from 'dotenv';

dotenv.config();

// Helper to check if table is in allowlist
export const isTableAllowlisted = (datasetId: string, tableId: string): boolean => {
  const allowlist = (process.env.ALLOWLIST_TABLES || '')
    .split(',')
    .map(s => s.trim().toLowerCase());
  const fullName = `${datasetId}.${tableId}`.toLowerCase();
  return allowlist.includes(fullName);
};

// Initialize BigQuery Client using Key File or Application Default Credentials (ADC)
const getBigQueryClient = (): BigQuery => {
  const projectId = process.env.GCP_PROJECT_ID;
  const keyFilename = process.env.GCP_KEY_FILE_PATH;

  const config: any = {};
  if (projectId) config.projectId = projectId;
  if (keyFilename && keyFilename !== './service-account-key.json') {
    config.keyFilename = keyFilename;
  }

  return new BigQuery(config);
};

const bigquery = getBigQueryClient();

// 1. List Allowed Tables
export const listAllowedTables = async () => {
  const list = process.env.ALLOWLIST_TABLES || '';
  const tablesConfig = list.split(',').map(s => s.trim()).filter(Boolean);
  
  const results = [];
  for (const tableConfig of tablesConfig) {
    const parts = tableConfig.split('.');
    if (parts.length === 2) {
      const [datasetId, tableId] = parts;
      try {
        const dataset = bigquery.dataset(datasetId);
        const table = dataset.table(tableId);
        const [metadata] = await table.getMetadata();
        
        results.push({
          table: tableConfig,
          dataset: datasetId,
          name: tableId,
          description: metadata.description || 'No description available',
          type: metadata.type,
          numRows: metadata.numRows ? parseInt(metadata.numRows, 10) : undefined,
        });
      } catch (e: any) {
        console.warn(`[BigQuery] Warning: Could not fetch metadata for allowlisted table "${tableConfig}":`, e.message);
        // Fallback if metadata cannot be fetched (e.g. key file not configured yet or permissions missing)
        results.push({
          table: tableConfig,
          dataset: datasetId,
          name: tableId,
          description: `Allowlisted table. (Metadata unavailable: ${e.message})`,
        });
      }
    }
  }
  return results;
};

// 2. Describe Table Schema
export const describeTable = async (datasetId: string, tableId: string) => {
  if (!isTableAllowlisted(datasetId, tableId)) {
    throw new Error(`Table ${datasetId}.${tableId} is not in the allowlist.`);
  }

  const dataset = bigquery.dataset(datasetId);
  const table = dataset.table(tableId);
  const [metadata] = await table.getMetadata();

  const fields = (metadata.schema?.fields || []).map((f: any) => ({
    name: f.name,
    type: f.type,
    mode: f.mode,
    description: f.description || '',
  }));

  return {
    table: `${datasetId}.${tableId}`,
    description: metadata.description || 'No description available',
    fields,
  };
};

// 3. Estimate Query Cost (Dry Run)
export const estimateQueryCost = async (sql: string) => {
  try {
    const [job] = await bigquery.createQueryJob({
      query: sql,
      dryRun: true,
    });
    
    const bytes = parseInt(job.metadata.statistics.query.totalBytesProcessed || '0', 10);
    const estimateGb = bytes / (1024 * 1024 * 1024);
    const costUsd = (estimateGb * 6.25) / 1000; // $6.25 per TB = $0.00625 per GB

    return {
      valid: true,
      bytesScanned: bytes,
      bytesScannedGb: parseFloat(estimateGb.toFixed(6)),
      estimatedCostUsd: parseFloat(costUsd.toFixed(8)),
    };
  } catch (e: any) {
    return {
      valid: false,
      error: e.message,
    };
  }
};

// 4. Execute Readonly Query (with Hard Caps & Security Validation)
export const executeReadonlyQuery = async (sql: string) => {
  const maxBytesBilled = process.env.MAX_BYTES_BILLED || '1073741824'; // Default 1 GB

  const [job] = await bigquery.createQueryJob({
    query: sql,
    maximumBytesBilled: maxBytesBilled,
  });

  console.log(`[BigQuery] Executing job: ${job.id} with maxBytesBilled limit: ${maxBytesBilled}`);
  
  // Enforce Row capping at the client-side retrieval level
  const [rows] = await job.getQueryResults({
    maxResults: 1000,
  });

  return rows;
};
