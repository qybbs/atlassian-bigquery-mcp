import crypto from 'node:crypto';
import { ClientRepository } from './clientRepository';
import { ClientMetadata } from './types';

export class MemoryClientRepository implements ClientRepository {
  private clients: Map<string, ClientMetadata> = new Map();

  async register(clientName: string, redirectUris: string[]): Promise<ClientMetadata> {
    const clientId = `client_${crypto.randomUUID().replace(/-/g, '')}`;
    const clientSecret = `secret_${crypto.randomBytes(32).toString('hex')}`;
    const issuedAt = Math.floor(Date.now() / 1000);

    const client: ClientMetadata = {
      clientId,
      clientSecret,
      clientName,
      redirectUris,
      issuedAt
    };

    this.clients.set(clientId, client);
    return client;
  }

  async get(clientId: string): Promise<ClientMetadata | null> {
    const client = this.clients.get(clientId);
    return client || null;
  }
}
