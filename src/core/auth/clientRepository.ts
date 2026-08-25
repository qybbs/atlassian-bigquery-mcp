import { ClientMetadata, DcrPersistenceMode } from './types';
import { StatelessClientRepository } from './statelessClientRepository';
import { MemoryClientRepository } from './memoryClientRepository';
import { FirestoreClientRepository } from './firestoreClientRepository';

export interface ClientRepository {
  register(clientName: string, redirectUris: string[]): Promise<ClientMetadata>;
  get(clientId: string): Promise<ClientMetadata | null>;
}

export class ClientRepositoryFactory {
  private static instance: ClientRepository | null = null;

  public static getRepository(): ClientRepository {
    if (this.instance) {
      return this.instance;
    }

    const mode = process.env.DCR_PERSISTENCE_MODE!.toUpperCase();

    switch (mode) {
      case DcrPersistenceMode.STATELESS:
        this.instance = new StatelessClientRepository();
        break;
      case DcrPersistenceMode.MEMORY:
        this.instance = new MemoryClientRepository();
        break;
      case DcrPersistenceMode.FIRESTORE:
        this.instance = new FirestoreClientRepository();
        break;
      default:
        console.warn(`[Auth] Unknown DCR_PERSISTENCE_MODE: ${mode}. Falling back to STATELESS.`);
        this.instance = new StatelessClientRepository();
    }

    return this.instance;
  }

  // Reset instance (useful for testing)
  public static reset() {
    this.instance = null;
  }
}
