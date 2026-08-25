export enum DcrPersistenceMode {
  STATELESS = 'STATELESS',
  MEMORY = 'MEMORY',
  FIRESTORE = 'FIRESTORE'
}

export interface ClientMetadata {
  clientId: string;
  clientSecret: string;
  clientName: string;
  redirectUris: string[];
  issuedAt: number;
}
