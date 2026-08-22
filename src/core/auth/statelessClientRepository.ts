import { ClientRepository } from './clientRepository';
import { ClientMetadata } from './types';
import { encryptJwe, decryptJwe } from './helpers';

export class StatelessClientRepository implements ClientRepository {
  async register(clientName: string, redirectUris: string[]): Promise<ClientMetadata> {
    const issuedAt = Math.floor(Date.now() / 1000);
    
    const clientId = await encryptJwe({ 
      client_name: clientName, 
      redirect_uris: redirectUris,
      issuedAt
    });

    const clientSecret = await encryptJwe({ 
      type: 'secret', 
      client_name: clientName 
    });

    return {
      clientId,
      clientSecret,
      clientName,
      redirectUris,
      issuedAt
    };
  }

  async get(clientId: string): Promise<ClientMetadata | null> {
    try {
      const payload = await decryptJwe(clientId);
      if (!payload || !payload.client_name || !payload.redirect_uris) {
        return null;
      }

      return {
        clientId,
        clientSecret: '', // We don't reconstruct the dummy secret as it's not verified
        clientName: payload.client_name,
        redirectUris: payload.redirect_uris,
        issuedAt: payload.issuedAt || Math.floor(Date.now() / 1000)
      };
    } catch (err: any) {
      console.warn('[Auth] StatelessClientRepository failed to decrypt JWE clientId:', err.message);
      return null;
    }
  }
}
