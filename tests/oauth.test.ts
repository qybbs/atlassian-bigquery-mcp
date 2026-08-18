import { describe, it, expect, beforeAll, vi } from 'vitest';
import request from 'supertest';
import * as jose from 'jose';
import app from '../src/server';

describe('OAuth Endpoints', () => {
  beforeAll(() => {
    process.env.MASTER_SECRET_KEY = 'a3N2ZHNkZnNkZmRzZnNkZnNkZmRzZnNkZnNkZnNkZmQ='; // valid base64 32 bytes (mock)
    process.env.AUTH_PROVIDER = 'MOCK';
    process.env.MOCK_USER_EMAIL = 'test@example.com';
    process.env.MOCK_USER_PASSWORD = 'password123';
    process.env.GCP_PROJECT_ID = 'mock-project';
    process.env.ALLOWLIST_TABLES = 'dataset.mock_table';
  });

  let clientId: string;
  let clientSecret: string;
  let redirectUri = 'http://localhost/callback';

  describe('POST /register', () => {
    it('harus meregistrasi client dan mengembalikan client_id terenkripsi', async () => {
      const response = await request(app)
        .post('/register')
        .send({
          client_name: 'Test Client',
          redirect_uris: [redirectUri]
        });
      
      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('client_id');
      expect(response.body).toHaveProperty('client_secret');
      expect(response.body.redirect_uris).toContain(redirectUri);

      clientId = response.body.client_id;
      clientSecret = response.body.client_secret;
    });

    it('harus menolak registrasi tanpa redirect_uris', async () => {
      const response = await request(app)
        .post('/register')
        .send({
          client_name: 'Test Client'
        });
      
      expect(response.status).toBe(400);
      expect(response.body.error).toContain('redirect_uris is required');
    });
  });

  describe('GET /oauth/authorize', () => {
    it('harus menampilkan halaman otorisasi dan set cookie oauth_flow', async () => {
      const response = await request(app)
        .get('/oauth/authorize')
        .query({
          client_id: clientId,
          redirect_uri: redirectUri,
          response_type: 'code',
          state: 'xyz123',
          code_challenge: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ123',
          code_challenge_method: 'S256'
        });
      
      expect(response.status).toBe(200);
      expect(response.text).toContain('<form action="/oauth/login"');
      
      // Verify cookie is set
      const cookies = response.headers['set-cookie'];
      expect(cookies).toBeDefined();
      expect(cookies[0]).toContain('oauth_flow=');
    });

    it('harus menolak permintaan jika client_id invalid', async () => {
      const response = await request(app)
        .get('/oauth/authorize')
        .query({
          client_id: 'invalid-client-id-format',
          redirect_uri: redirectUri,
          response_type: 'code',
          code_challenge: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ123'
        });
      
      expect(response.status).toBe(400);
      expect(response.text).toContain('Invalid client_id format');
    });
  });

  describe('POST /oauth/login', () => {
    it('harus menolak login jika cookie oauth_flow tidak ada', async () => {
      const response = await request(app)
        .post('/oauth/login')
        .send({
          email: 'test@example.com',
          password: 'password123'
        });
      
      expect(response.status).toBe(400);
      expect(response.text).toContain('Session expired or invalid flow');
    });

    it('harus berhasil login dengan kredensial yang benar', async () => {
      const authResponse = await request(app)
        .get('/oauth/authorize')
        .query({
          client_id: clientId,
          redirect_uri: redirectUri,
          response_type: 'code',
          state: 'xyz123',
          code_challenge: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ123',
          code_challenge_method: 'S256'
        });
      
      const cookie = authResponse.headers['set-cookie'][0].split(';')[0];

      const loginResponse = await request(app)
        .post('/oauth/login')
        .set('Cookie', cookie)
        .send({
          email: 'test@example.com',
          password: 'password123'
        });

      expect(loginResponse.status).toBe(302);
      expect(loginResponse.headers.location).toContain('code=');
      expect(loginResponse.headers.location).toContain('state=xyz123');
    });

    it('harus menolak login dan redirect kembali jika kredensial salah', async () => {
      const authResponse = await request(app)
        .get('/oauth/authorize')
        .query({
          client_id: clientId,
          redirect_uri: redirectUri,
          response_type: 'code',
          state: 'xyz123',
          code_challenge: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ123',
          code_challenge_method: 'S256'
        });
      
      const cookie = authResponse.headers['set-cookie'][0].split(';')[0];

      const loginResponse = await request(app)
        .post('/oauth/login')
        .set('Cookie', cookie)
        .send({
          email: 'test@example.com',
          password: 'wrong-password'
        });

      expect(loginResponse.status).toBe(302);
      expect(loginResponse.headers.location).toContain('error=login_failed');
    });
  });

  describe('POST /oauth/token', () => {
    it('harus menolak jika grant_type bukan authorization_code', async () => {
      const response = await request(app)
        .post('/oauth/token')
        .send({
          grant_type: 'client_credentials'
        });
      
      expect(response.status).toBe(400);
      expect(response.body.error).toBe('unsupported_grant_type');
    });

    it('harus menolak jika code tidak ada', async () => {
      const response = await request(app)
        .post('/oauth/token')
        .send({
          grant_type: 'authorization_code'
        });
      
      expect(response.status).toBe(400);
      expect(response.body.error).toBe('invalid_request');
    });

    it('harus sukses menukarkan authorization code dengan access token', async () => {
      const authResponse = await request(app)
        .get('/oauth/authorize')
        .query({
          client_id: clientId,
          redirect_uri: redirectUri,
          response_type: 'code',
          state: 'xyz123',
          code_challenge: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ123',
          code_challenge_method: 'plain'
        });
      
      const cookie = authResponse.headers['set-cookie'][0].split(';')[0];

      const loginResponse = await request(app)
        .post('/oauth/login')
        .set('Cookie', cookie)
        .send({
          email: 'test@example.com',
          password: 'password123'
        });
      
      const redirectUrl = new URL(loginResponse.headers.location);
      const code = redirectUrl.searchParams.get('code') || '';

      const tokenResponse = await request(app)
        .post('/oauth/token')
        .send({
          grant_type: 'authorization_code',
          code,
          client_id: clientId,
          code_verifier: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ123',
          redirect_uri: redirectUri
        });

      expect(tokenResponse.status).toBe(200);
      expect(tokenResponse.body).toHaveProperty('access_token');
      expect(tokenResponse.body.token_type).toBe('Bearer');
    });

    it('harus mendukung Basic Auth header untuk client_id', async () => {
      const authResponse = await request(app)
        .get('/oauth/authorize')
        .query({
          client_id: clientId,
          redirect_uri: redirectUri,
          response_type: 'code',
          state: 'xyz123',
          code_challenge: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ123',
          code_challenge_method: 'plain'
        });
      
      const cookie = authResponse.headers['set-cookie'][0].split(';')[0];

      const loginResponse = await request(app)
        .post('/oauth/login')
        .set('Cookie', cookie)
        .send({
          email: 'test@example.com',
          password: 'password123'
        });
      
      const redirectUrl = new URL(loginResponse.headers.location);
      const code = redirectUrl.searchParams.get('code') || '';

      const credentials = Buffer.from(`${clientId}:`).toString('base64');
      const tokenResponse = await request(app)
        .post('/oauth/token')
        .set('Authorization', `Basic ${credentials}`)
        .send({
          grant_type: 'authorization_code',
          code,
          code_verifier: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ123',
          redirect_uri: redirectUri
        });

      expect(tokenResponse.status).toBe(200);
      expect(tokenResponse.body).toHaveProperty('access_token');
    });
  });

  describe('GET /oauth/callback (OIDC Callback)', () => {
    it('harus memproses callback OIDC dengan sukses', async () => {
      const masterSecret = 'a3N2ZHNkZnNkZmRzZnNkZnNkZmRzZnNkZnNkZnNkZmQ=';
      const secretKey = Buffer.from(masterSecret, 'base64');
      const stateToken = await new jose.EncryptJWT({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        state: 'xyz123',
        code_challenge: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ123',
        code_challenge_method: 'S256',
      })
        .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
        .setIssuedAt()
        .setExpirationTime('10m')
        .encrypt(secretKey);

      const idToken = await new jose.SignJWT({
        email: 'test@example.com',
      })
        .setProtectedHeader({ alg: 'HS256' })
        .sign(secretKey);

      const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(() => {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ id_token: idToken }),
        } as any);
      });

      process.env.OIDC_TOKEN_ENDPOINT = 'http://mock-provider.com/token';
      process.env.OIDC_CLIENT_ID = 'oidc-client-id';
      process.env.OIDC_CLIENT_SECRET = 'oidc-client-secret';
      process.env.OIDC_REDIRECT_URI = 'http://localhost/callback';

      const response = await request(app)
        .get('/oauth/callback')
        .query({
          code: 'oidc-auth-code',
          state: stateToken
        });

      expect(response.status).toBe(302);
      expect(response.headers.location).toContain('code=');
      expect(response.headers.location).toContain('state=xyz123');

      fetchSpy.mockRestore();
    });

    it('harus menolak callback jika code atau state tidak ada', async () => {
      const response = await request(app)
        .get('/oauth/callback')
        .query({
          code: 'oidc-auth-code'
        });
      expect(response.status).toBe(400);
      expect(response.text).toContain('Missing code or state');
    });

    it('harus menolak callback jika state invalid', async () => {
      const response = await request(app)
        .get('/oauth/callback')
        .query({
          code: 'oidc-auth-code',
          state: 'invalid-state-token'
        });
      expect(response.status).toBe(400);
      expect(response.text).toContain('Invalid state token');
    });
  });
});
