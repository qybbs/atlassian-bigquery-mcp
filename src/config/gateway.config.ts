import fs from 'node:fs';
import dotenv from 'dotenv';
import { DcrPersistenceMode } from '../core/auth/types';
import { McpDriverType } from '../core/mcp/driver';

dotenv.config();

const validateMasterSecretKey = (errors: string[]) => {
  const key = process.env.MASTER_SECRET_KEY;
  if (!key) {
    errors.push('MASTER_SECRET_KEY environment variable is not set. Please generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"');
    return;
  }
  try {
    const buffer = Buffer.from(key, 'base64');
    if (buffer.length !== 32) {
      errors.push(`MASTER_SECRET_KEY must be exactly 32 bytes (256-bit) when base64-decoded. Got ${buffer.length} bytes.`);
    }
  } catch {
    errors.push('Failed to decode MASTER_SECRET_KEY as base64.');
  }
};

const validateGcpConfig = (errors: string[]) => {
  if (!process.env.GCP_PROJECT_ID) {
    errors.push('GCP_PROJECT_ID is not set.');
  }
  const keyPath = process.env.GCP_KEY_FILE_PATH;
  if (keyPath && keyPath !== './path-to-your-service-account-key.json') {
    if (!fs.existsSync(keyPath)) {
      errors.push(`GCP_KEY_FILE_PATH file does not exist: "${keyPath}"`);
    }
  }
};

const validateAllowlistTables = (errors: string[]) => {
  const allowlistRaw = process.env.ALLOWLIST_TABLES;
  if (!allowlistRaw) {
    errors.push('ALLOWLIST_TABLES is not set.');
    return;
  }
  const tables = allowlistRaw.split(',').map(s => s.replace(/\s+/g, '')).filter(Boolean);
  if (tables.length === 0) {
    errors.push('ALLOWLIST_TABLES is empty.');
    return;
  }
  tables.forEach(t => {
    const parts = t.split('.');
    if (parts.length < 2 || parts.length > 3 || parts.some(p => !p)) {
      errors.push(`Invalid table format in ALLOWLIST_TABLES: "${t}". Expected "dataset.table" or "project.dataset.table".`);
    }
  });
};

const validateAuthProvider = (errors: string[]) => {
  const authProvider = process.env.AUTH_PROVIDER;
  if (!authProvider) {
    errors.push('AUTH_PROVIDER is not set (must be "MOCK" or "OIDC").');
    return;
  }
  
  if (authProvider !== 'MOCK' && authProvider !== 'OIDC') {
    errors.push(`AUTH_PROVIDER must be "MOCK" or "OIDC". Got: "${authProvider}".`);
    return;
  }

  if (authProvider === 'MOCK') {
    const email = process.env.MOCK_USER_EMAIL;
    if (!email) {
      errors.push('MOCK_USER_EMAIL is required when AUTH_PROVIDER is MOCK.');
    } else if (!email.includes('@')) {
      errors.push(`Invalid email format in MOCK_USER_EMAIL: "${email}"`);
    }
    if (!process.env.MOCK_USER_PASSWORD) {
      errors.push('MOCK_USER_PASSWORD is required when AUTH_PROVIDER is MOCK.');
    }
  } else if (authProvider === 'OIDC') {
    if (!process.env.OIDC_CLIENT_ID) {
      errors.push('OIDC_CLIENT_ID is required when AUTH_PROVIDER is OIDC.');
    }
    if (!process.env.OIDC_CLIENT_SECRET) {
      errors.push('OIDC_CLIENT_SECRET is required when AUTH_PROVIDER is OIDC.');
    }
    
    const validateUrl = (url: string | undefined, varName: string) => {
      if (!url) {
        errors.push(`${varName} is required when AUTH_PROVIDER is OIDC.`);
      } else if (!url.startsWith('http://') && !url.startsWith('https://')) {
        errors.push(`Invalid URL format in ${varName}: "${url}"`);
      }
    };

    validateUrl(process.env.OIDC_AUTHORIZATION_ENDPOINT, 'OIDC_AUTHORIZATION_ENDPOINT');
    validateUrl(process.env.OIDC_TOKEN_ENDPOINT, 'OIDC_TOKEN_ENDPOINT');
    validateUrl(process.env.OIDC_REDIRECT_URI, 'OIDC_REDIRECT_URI');
  }
};

const validatePositiveInteger = (value: string | undefined, varName: string, errors: string[]) => {
  if (value) {
    const num = Number(value);
    if (!Number.isInteger(num) || num <= 0) {
      errors.push(`${varName} must be a positive integer. Got: "${value}"`);
    }
  }
};

const validateDcrPersistenceMode = (errors: string[]) => {
  const mode = process.env.DCR_PERSISTENCE_MODE;
  const validModes = Object.values(DcrPersistenceMode) as string[];
  if (!mode) {
    errors.push(`DCR_PERSISTENCE_MODE is required. Must be one of: ${validModes.join(', ')}.`);
  } else if (!validModes.includes(mode.toUpperCase())) {
    errors.push(`DCR_PERSISTENCE_MODE must be one of: ${validModes.join(', ')}. Got: "${mode}".`);
  }
};

const validateDriversConfig = (errors: string[]) => {
  const activeDriversRaw = process.env.ACTIVE_DRIVERS;
  if (!activeDriversRaw) {
    errors.push(`ACTIVE_DRIVERS is not set. It must contain at least one valid driver (e.g., ${Object.values(McpDriverType).join(', ')}).`);
    return;
  }
  
  const drivers = activeDriversRaw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (drivers.length === 0) {
    errors.push('ACTIVE_DRIVERS is empty.');
    return;
  }

  const validDriverTypes = Object.values(McpDriverType) as string[];
  drivers.forEach(driver => {
    if (!validDriverTypes.includes(driver)) {
      errors.push(`Invalid driver in ACTIVE_DRIVERS: "${driver}". Supported drivers are: ${validDriverTypes.join(', ')}.`);
    }
  });

  if (drivers.includes('stdio')) {
    if (!process.env.STDIO_DRIVER_COMMAND) {
      errors.push('STDIO_DRIVER_COMMAND is required when "stdio" driver is active.');
    }
  }

  if (drivers.includes('sse')) {
    if (!process.env.SSE_DRIVER_URL) {
      errors.push('SSE_DRIVER_URL is required when "sse" driver is active.');
    } else if (!process.env.SSE_DRIVER_URL.startsWith('http://') && !process.env.SSE_DRIVER_URL.startsWith('https://')) {
      errors.push(`Invalid URL format in SSE_DRIVER_URL: "${process.env.SSE_DRIVER_URL}"`);
    }
  }
};

export const validateEnv = (): void => {
  const errors: string[] = [];

  validateMasterSecretKey(errors);
  validateGcpConfig(errors);
  validateAllowlistTables(errors);
  validateAuthProvider(errors);
  validateDcrPersistenceMode(errors);
  validateDriversConfig(errors);
  
  validatePositiveInteger(process.env.MAX_BYTES_BILLED, 'MAX_BYTES_BILLED', errors);
  validatePositiveInteger(process.env.ROW_LIMIT, 'ROW_LIMIT', errors);
  validatePositiveInteger(process.env.TOKEN_EXPIRATION_SECONDS, 'TOKEN_EXPIRATION_SECONDS', errors);

  if (errors.length > 0) {
    throw new Error('Environment validation failed:\n' + errors.map(e => ` - ${e}`).join('\n'));
  }
};
