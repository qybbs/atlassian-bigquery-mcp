import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

export const validateEnv = (): void => {
  const errors: string[] = [];

  // 1. MASTER_SECRET_KEY
  const key = process.env.MASTER_SECRET_KEY;
  if (!key) {
    errors.push('MASTER_SECRET_KEY environment variable is not set. Please generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"');
  } else {
    try {
      const buffer = Buffer.from(key, 'base64');
      if (buffer.length !== 32) {
        errors.push(`MASTER_SECRET_KEY must be exactly 32 bytes (256-bit) when base64-decoded. Got ${buffer.length} bytes.`);
      }
    } catch {
      errors.push('Failed to decode MASTER_SECRET_KEY as base64.');
    }
  }

  // 2. GCP Configuration
  if (!process.env.GCP_PROJECT_ID) {
    errors.push('GCP_PROJECT_ID is not set.');
  }

  const keyPath = process.env.GCP_KEY_FILE_PATH;
  if (keyPath && keyPath !== './path-to-your-service-account-key.json') {
    if (!fs.existsSync(keyPath)) {
      errors.push(`GCP_KEY_FILE_PATH file does not exist: "${keyPath}"`);
    }
  }

  // 3. ALLOWLIST_TABLES
  const allowlistRaw = process.env.ALLOWLIST_TABLES;
  if (!allowlistRaw) {
    errors.push('ALLOWLIST_TABLES is not set.');
  } else {
    const tables = allowlistRaw.split(',').map(s => s.replace(/\s+/g, '')).filter(Boolean);
    if (tables.length === 0) {
      errors.push('ALLOWLIST_TABLES is empty.');
    } else {
      tables.forEach(t => {
        const parts = t.split('.');
        if (parts.length < 2 || parts.length > 3 || parts.some(p => !p)) {
          errors.push(`Invalid table format in ALLOWLIST_TABLES: "${t}". Expected "dataset.table" or "project.dataset.table".`);
        }
      });
    }
  }

  // 4. AUTH_PROVIDER
  const authProvider = process.env.AUTH_PROVIDER;
  if (!authProvider) {
    errors.push('AUTH_PROVIDER is not set (must be "MOCK" or "OIDC").');
  } else if (authProvider !== 'MOCK' && authProvider !== 'OIDC') {
    errors.push(`AUTH_PROVIDER must be "MOCK" or "OIDC". Got: "${authProvider}".`);
  } else {
    // 5. Auth Provider Specifics
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
  }

  // 6. Limits (Optional check)
  const validatePositiveInteger = (value: string | undefined, varName: string) => {
    if (value) {
      const num = Number(value);
      if (!Number.isInteger(num) || num <= 0) {
        errors.push(`${varName} must be a positive integer. Got: "${value}"`);
      }
    }
  };

  validatePositiveInteger(process.env.MAX_BYTES_BILLED, 'MAX_BYTES_BILLED');
  validatePositiveInteger(process.env.ROW_LIMIT, 'ROW_LIMIT');
  validatePositiveInteger(process.env.TOKEN_EXPIRATION_SECONDS, 'TOKEN_EXPIRATION_SECONDS');

  if (errors.length > 0) {
    throw new Error('Environment validation failed:\n' + errors.map(e => ` - ${e}`).join('\n'));
  }
};
