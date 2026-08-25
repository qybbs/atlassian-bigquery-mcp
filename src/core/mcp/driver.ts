export enum McpDriverType {
  BIGQUERY = 'bigquery',
  STDIO = 'stdio',
  SSE = 'sse',
}

export interface McpDriver {
  /**
   * The logical name of the driver (e.g. 'bigquery', 'stdio', 'sse')
   */
  name: string;
  
  /**
   * The prefix used to namespace tools from this driver.
   * If empty string, tools are exposed without prefix.
   */
  prefix: string;

  /**
   * Initializes the driver (e.g. starting a subprocess, establishing a connection)
   */
  initialize(): Promise<void>;

  /**
   * Returns a list of tools exposed by this driver.
   */
  listTools(): Promise<any[]>;

  /**
   * Executes a specific tool by name with the given arguments.
   */
  callTool(name: string, args: any): Promise<any>;

  /**
   * Cleanly shuts down the driver.
   */
  shutdown(): Promise<void>;
}
