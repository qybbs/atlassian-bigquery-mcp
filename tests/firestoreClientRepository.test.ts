import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FirestoreClientRepository } from '../src/core/auth/firestoreClientRepository';

// Mock the Firestore module
vi.mock('@google-cloud/firestore', () => {
  const setMock = vi.fn().mockResolvedValue(true);
  const getMock = vi.fn();
  
  const docMock = vi.fn(() => ({
    set: setMock,
    get: getMock
  }));
  
  const collectionMock = vi.fn(() => ({
    doc: docMock
  }));

  const FirestoreMock = vi.fn().mockImplementation(function() {
    return {
      collection: collectionMock
    };
  });

  return {
    Firestore: FirestoreMock,
    _setMock: setMock,
    _getMock: getMock,
    _docMock: docMock,
    _collectionMock: collectionMock
  };
});

describe('FirestoreClientRepository', () => {
  let repository: FirestoreClientRepository;
  let getMock: any;
  let setMock: any;
  let docMock: any;
  let collectionMock: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    
    // Import the mocks that we exposed
    const firestoreMod = await import('@google-cloud/firestore');
    getMock = (firestoreMod as any)._getMock;
    setMock = (firestoreMod as any)._setMock;
    docMock = (firestoreMod as any)._docMock;
    collectionMock = (firestoreMod as any)._collectionMock;

    process.env.FIRESTORE_DCR_COLLECTION = 'test_clients';
    repository = new FirestoreClientRepository();
  });

  describe('register', () => {
    it('harus membuat UUID client dan menyimpannya di Firestore', async () => {
      const clientName = 'Test App';
      const redirectUris = ['http://localhost/callback'];
      
      const client = await repository.register(clientName, redirectUris);
      
      expect(client.clientId).toMatch(/^client_[a-f0-9]{32}$/);
      expect(client.clientSecret).toMatch(/^secret_[a-f0-9]{64}$/);
      expect(client.clientName).toBe(clientName);
      expect(client.redirectUris).toEqual(redirectUris);
      expect(client.issuedAt).toBeTypeOf('number');

      expect(collectionMock).toHaveBeenCalledWith('test_clients');
      expect(docMock).toHaveBeenCalledWith(client.clientId);
      expect(setMock).toHaveBeenCalledWith(client);
    });
  });

  describe('get', () => {
    it('harus mengembalikan ClientMetadata jika doc exists', async () => {
      const mockData = {
        clientId: 'client_123',
        clientSecret: 'secret_abc',
        clientName: 'App',
        redirectUris: ['http://app'],
        issuedAt: 123456
      };

      getMock.mockResolvedValueOnce({
        exists: true,
        data: () => mockData
      });

      const result = await repository.get('client_123');

      expect(collectionMock).toHaveBeenCalledWith('test_clients');
      expect(docMock).toHaveBeenCalledWith('client_123');
      expect(getMock).toHaveBeenCalled();
      
      expect(result).toEqual(mockData);
    });

    it('harus mengembalikan null jika doc tidak exists', async () => {
      getMock.mockResolvedValueOnce({
        exists: false
      });

      const result = await repository.get('client_unknown');
      
      expect(result).toBeNull();
    });
  });
});
