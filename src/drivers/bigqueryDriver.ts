import { McpDriver } from '../core/mcp/driver';
import { 
  listAllowedTables, 
  describeTable, 
  estimateQueryCost, 
  executeReadonlyQuery, 
  searchAllowedTables 
} from './bigquery';
import { validateQuerySafety } from './bigqueryPolicy';
import { PolicyError } from '../core/mcp/policy';

export class BigQueryDriver implements McpDriver {
  name: string;
  prefix: string;

  constructor(config?: { name?: string; prefix?: string }) {
    this.name = config?.name || 'bigquery';
    this.prefix = config?.prefix || 'bigquery_';
  }

  async initialize(): Promise<void> {
    // Klien BigQuery diinisialisasi secara sinkron di './bigquery',
    // sehingga tidak ada operasi asinkron yang perlu dilakukan di sini.
  }

  async listTools(): Promise<any[]> {
    return [
      {
        name: 'list_allowed_tables',
        description: 'List all BigQuery tables allowed for query execution.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'describe_table',
        description: 'Get schema detail (columns, types, descriptions) of an allowed table.',
        inputSchema: {
          type: 'object',
          properties: {
            datasetId: { type: 'string', description: 'BigQuery dataset ID' },
            tableId: { type: 'string', description: 'BigQuery table ID' },
          },
          required: ['datasetId', 'tableId'],
        },
      },
      {
        name: 'estimate_query_cost',
        description: 'Dry-run a GoogleSQL SELECT query to estimate bytes scanned and cost projection.',
        inputSchema: {
          type: 'object',
          properties: {
            sql: { type: 'string', description: 'GoogleSQL SELECT query statement' },
          },
          required: ['sql'],
        },
      },
      {
        name: 'execute_readonly_query',
        description: 'Execute a read-only GoogleSQL SELECT query and retrieve rows. Enforces 1000 row capping and maximumBytesBilled.',
        inputSchema: {
          type: 'object',
          properties: {
            sql: { type: 'string', description: 'GoogleSQL SELECT query statement' },
          },
          required: ['sql'],
        },
      },
      {
        name: 'search_allowed_tables',
        description: "Search allowed tables and their schemas by a keyword (e.g., 'transaction', 'customer'). Returns table description, partitioning columns, clustering columns, and field schemas in one call.",
        inputSchema: {
          type: 'object',
          properties: {
            keyword: { type: 'string', description: 'The search keyword to filter table names and datasets' },
          },
          required: ['keyword'],
        },
      },
    ];
  }

  async callTool(name: string, args: any): Promise<any> {
    switch (name) {
      case 'list_allowed_tables': {
        const result = await listAllowedTables();
        (result as any)._audit = { rowCount: result.length };
        return result;
      }
      
      case 'describe_table': {
        const { datasetId, tableId } = args;
        if (!datasetId || !tableId) {
          throw new Error('Both datasetId and tableId are required.');
        }
        return await describeTable(datasetId, tableId);
      }
      
      case 'estimate_query_cost': {
        const { sql } = args;
        if (!sql) throw new Error('sql query parameter is required.');
        const safety = validateQuerySafety(sql);
        if (!safety.safe) throw new PolicyError(safety.reason!, { tablesTouched: safety.detectedTables, sql });

        const estimate = await estimateQueryCost(sql);
        if (!estimate.valid) {
          throw new Error(estimate.error);
        }
        (estimate as any)._audit = { tablesTouched: safety.detectedTables, bytesEstimate: estimate.bytesScanned, sql };
        return estimate;
      }
      
      case 'execute_readonly_query': {
        const { sql } = args;
        if (!sql) throw new Error('sql query parameter is required.');
        const safety = validateQuerySafety(sql);
        if (!safety.safe) throw new PolicyError(safety.reason!, { tablesTouched: safety.detectedTables, sql });

        const result = await executeReadonlyQuery(sql);
        (result as any)._audit = { tablesTouched: safety.detectedTables, rowCount: result.length, sql };
        return result;
      }

      case 'search_allowed_tables': {
        const { keyword } = args;
        if (!keyword) throw new Error('keyword is required.');
        const result = await searchAllowedTables(keyword);
        (result as any)._audit = { rowCount: result.length };
        return result;
      }

      default:
        throw new Error(`Tool ${name} is not implemented in BigQueryDriver`);
    }
  }

  async shutdown(): Promise<void> {
    // Tidak ada resource persisten yang perlu ditutup secara manual untuk bigquery client di sini.
  }
}
