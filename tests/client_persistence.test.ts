import { describe, it, expect, beforeAll } from 'vitest';
import { StatelessClientRepository } from '../src/core/auth/statelessClientRepository';
import { MemoryClientRepository } from '../src/core/auth/memoryClientRepository';
import { DcrPersistenceMode } from '../src/core/auth/types';

describe('Client Persistence Repositories', () => {
  beforeAll(() => {
    process.env.MASTER_SECRET_KEY = 'a3N2ZHNkZnNkZmRzZnNkZnNkZmRzZnNkZnNkZnNkZmQ='; // mock 32 bytes
    process.env.GCP_PROJECT_ID = 'mock-project';
    process.env.ALLOWLIST_TABLES = 'dataset.mock_table';
    process.env.AUTH_PROVIDER = 'MOCK';
    process.env.MOCK_USER_EMAIL = 'test@example.com';
    process.env.MOCK_USER_PASSWORD = 'password123';
    process.env.DCR_PERSISTENCE_MODE = DcrPersistenceMode.STATELESS;
  });

  describe('StatelessClientRepository', () => {
    it('should generate JWE-based client_id and decrypt it back successfully', async () => {
      const repo = new StatelessClientRepository();
      
      const clientName = 'Stateless Test Client';
      const redirectUris = ['http://localhost/callback'];
      
      const client = await repo.register(clientName, redirectUris);
      
      expect(client.clientId).toBeDefined();
      expect(client.clientSecret).toBeDefined();
      expect(client.clientName).toBe(clientName);
      expect(client.redirectUris).toEqual(redirectUris);
      expect(client.issuedAt).toBeGreaterThan(0);

      // Get client back
      const retrievedClient = await repo.get(client.clientId);
      
      expect(retrievedClient).not.toBeNull();
      expect(retrievedClient?.clientName).toBe(clientName);
      expect(retrievedClient?.redirectUris).toEqual(redirectUris);
      expect(retrievedClient?.issuedAt).toBe(client.issuedAt);
      expect(retrievedClient?.clientId).toBe(client.clientId);
    });

    it('should return null for invalid client_id format', async () => {
      const repo = new StatelessClientRepository();
      const retrievedClient = await repo.get('invalid-jwe-format');
      expect(retrievedClient).toBeNull();
    });
  });

  describe('MemoryClientRepository', () => {
    it('should generate random string client_id and store in memory', async () => {
      const repo = new MemoryClientRepository();
      
      const clientName = 'Memory Test Client';
      const redirectUris = ['http://localhost/callback'];
      
      const client = await repo.register(clientName, redirectUris);
      
      expect(client.clientId).toMatch(/^client_/);
      expect(client.clientSecret).toMatch(/^secret_/);
      expect(client.clientName).toBe(clientName);
      
      const retrievedClient = await repo.get(client.clientId);
      
      expect(retrievedClient).not.toBeNull();
      expect(retrievedClient).toEqual(client);
    });

    it('should return null for non-existent client_id', async () => {
      const repo = new MemoryClientRepository();
      const retrievedClient = await repo.get('client_nonexistent');
      expect(retrievedClient).toBeNull();
    });
  });
});
