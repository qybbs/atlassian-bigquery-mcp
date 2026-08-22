import crypto from 'node:crypto';
import { Firestore } from '@google-cloud/firestore';
import { ClientRepository } from './clientRepository';
import { ClientMetadata } from './types';

export class FirestoreClientRepository implements ClientRepository {
  private firestore: Firestore;
  private collectionName: string;

  constructor() {
    this.firestore = new Firestore({
      projectId: process.env.GCP_PROJECT_ID,
      keyFilename: process.env.GCP_KEY_FILE_PATH, // Will be ignored by Firestore if undefined (ADC applies)
    });
    this.collectionName = process.env.FIRESTORE_DCR_COLLECTION || 'mcp_clients';
  }

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

    const docRef = this.firestore.collection(this.collectionName).doc(clientId);
    await docRef.set(client);

    return client;
  }

  async get(clientId: string): Promise<ClientMetadata | null> {
    const docRef = this.firestore.collection(this.collectionName).doc(clientId);
    const doc = await docRef.get();

    if (!doc.exists) {
      return null;
    }

    return doc.data() as ClientMetadata;
  }
}
