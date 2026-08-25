export interface OutboundDriverConfig {
  type: 'bigquery' | 'stdio' | 'sse';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
}

export interface InboundAdapterConfig {
  enabled: boolean;
  allowedDrivers: string[];
}

export interface GatewayConfig {
  outboundDrivers: Record<string, OutboundDriverConfig>;
  inboundAdapters: Record<string, InboundAdapterConfig>;
}
