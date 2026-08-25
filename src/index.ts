// Export Express handlers for MCP
export { handleMcpRequest } from './adapters/atlassian/mcp';
export { validateQuerySafety } from './drivers/bigqueryPolicy';

// Export Configuration Validation
export { validateEnv } from './config/gateway.config';

// Export OAuth & DCR handlers
export { 
  registerClient, 
  authorizeUser, 
  tokenExchange, 
  handleOidcCallback,
  submitLogin
} from './adapters/atlassian/oauth';

// Export BigQuery core tools
export { 
  listAllowedTables, 
  describeTable, 
  estimateQueryCost, 
  executeReadonlyQuery, 
  searchAllowedTables 
} from './drivers/bigquery';
