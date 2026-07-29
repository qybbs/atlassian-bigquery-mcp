import express from 'express';
import * as jose from 'jose';
import crypto from 'crypto';

// Master secret key used for symmetric JWE (encryption) and JWS (signing)
const getSecretKey = (): Buffer => {
  const key = process.env.MASTER_SECRET_KEY;
  if (!key) {
    throw new Error('MASTER_SECRET_KEY environment variable is not set');
  }
  return Buffer.from(key, 'base64');
};

// 1. Dynamic Client Registration (DCR - RFC 7591)
export const registerClient = async (req: express.Request, res: express.Response) => {
  try {
    const { client_name, redirect_uris } = req.body;
    if (!redirect_uris || !Array.isArray(redirect_uris) || redirect_uris.length === 0) {
      return res.status(400).json({ error: 'redirect_uris is required and must be a non-empty array' });
    }

    const secretKey = getSecretKey();

    // Stateless Client ID: Encrypted JWE containing registration metadata
    const client_id = await new jose.EncryptJWT({ client_name, redirect_uris })
      .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
      .setIssuedAt()
      .encrypt(secretKey);

    // Stateless Client Secret (dummy encrypted string to satisfy OAuth client configurations)
    const client_secret = await new jose.EncryptJWT({ type: 'secret', client_name })
      .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
      .setIssuedAt()
      .encrypt(secretKey);

    const baseUrl = `${req.protocol}://${req.get('host')}`;

    console.log(`[DCR] Registered client "${client_name}" statelessly.`);

    return res.status(201).json({
      client_id,
      client_secret,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      grant_types: ['authorization_code'],
      redirect_uris,
      token_endpoint: `${baseUrl}/oauth/token`,
      authorization_endpoint: `${baseUrl}/oauth/authorize`,
      response_types: ['code'],
    });
  } catch (err: any) {
    console.error('DCR Error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};

// 2. OAuth 2.1 GET /oauth/authorize (Presents Mock Login Form)
export const authorizeUser = async (req: express.Request, res: express.Response) => {
  try {
    const {
      client_id,
      redirect_uri,
      response_type,
      state,
      code_challenge,
      code_challenge_method,
    } = req.query;

    if (!client_id || !redirect_uri || !code_challenge) {
      return res.status(400).send('Missing required OAuth parameters (client_id, redirect_uri, code_challenge)');
    }

    const secretKey = getSecretKey();
    let clientMetadata: any;

    // Decrypt client_id to validate it was registered by this server
    try {
      const { payload } = await jose.jwtDecrypt(client_id as string, secretKey);
      clientMetadata = payload;
    } catch (e) {
      return res.status(400).send('Invalid client_id');
    }

    // Verify requested redirect_uri matches registered URIs
    const isRedirectUriRegistered = clientMetadata.redirect_uris.includes(redirect_uri as string);
    if (!isRedirectUriRegistered) {
      return res.status(400).send('Redirect URI not registered for this client');
    }

    if (process.env.AUTH_PROVIDER === 'OIDC') {
      // Encrypt Atlassian OAuth state to preserve it across OIDC flow
      const oidcState = await new jose.EncryptJWT({
        client_id,
        redirect_uri,
        response_type,
        state,
        code_challenge,
        code_challenge_method,
      })
        .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
        .setIssuedAt()
        .setExpirationTime('10m')
        .encrypt(secretKey);

      const oidcAuthUrl = new URL(process.env.OIDC_AUTHORIZATION_ENDPOINT as string);
      oidcAuthUrl.searchParams.append('client_id', process.env.OIDC_CLIENT_ID as string);
      oidcAuthUrl.searchParams.append('redirect_uri', process.env.OIDC_REDIRECT_URI as string);
      oidcAuthUrl.searchParams.append('response_type', 'code');
      oidcAuthUrl.searchParams.append('scope', 'openid email profile');
      oidcAuthUrl.searchParams.append('state', oidcState);

      return res.redirect(oidcAuthUrl.toString());
    }

    // Render simple, premium-looking login form (Corporate theme: Sleek Dark / Blue accents)
    const html = `
      <!DOCTYPE html>
      <html lang="id">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>SERSAN MCP Otorisasi</title>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
        <style>
          body {
            font-family: 'Inter', sans-serif;
            background-color: #0d1117;
            color: #c9d1d9;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
          }
          .card {
            background-color: #161b22;
            border: 1px solid #30363d;
            border-radius: 12px;
            padding: 32px;
            width: 100%;
            max-width: 400px;
            box-shadow: 0 8px 24px rgba(0,0,0,0.5);
          }
          .logo {
            text-align: center;
            font-weight: 700;
            font-size: 24px;
            color: #58a6ff;
            margin-bottom: 24px;
          }
          .title {
            font-size: 18px;
            font-weight: 600;
            margin-bottom: 8px;
            text-align: center;
          }
          .subtitle {
            font-size: 14px;
            color: #8b949e;
            text-align: center;
            margin-bottom: 24px;
          }
          .form-group {
            margin-bottom: 16px;
          }
          label {
            display: block;
            font-size: 12px;
            font-weight: 500;
            margin-bottom: 6px;
            color: #8b949e;
          }
          input {
            width: 100%;
            box-sizing: border-box;
            background-color: #0d1117;
            border: 1px solid #30363d;
            border-radius: 6px;
            padding: 10px 12px;
            color: #c9d1d9;
            font-size: 14px;
            transition: border-color 0.2s;
          }
          input:focus {
            outline: none;
            border-color: #58a6ff;
          }
          .btn {
            width: 100%;
            background-color: #1f6feb;
            border: 1px solid rgba(240,246,252,0.1);
            border-radius: 6px;
            color: #ffffff;
            padding: 12px;
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
            transition: background-color 0.2s;
            margin-top: 12px;
          }
          .btn:hover {
            background-color: #388bfd;
          }
          .error-msg {
            color: #f85149;
            font-size: 12px;
            margin-top: 8px;
            text-align: center;
          }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="logo">Corporate SERSAN</div>
          <div class="title">Mock SSO Otorisasi</div>
          <div class="subtitle">Personal project test login</div>
          <form action="/oauth/login" method="POST">
            <!-- Hidden OAuth state -->
            <input type="hidden" name="client_id" value="${client_id}">
            <input type="hidden" name="redirect_uri" value="${redirect_uri}">
            <input type="hidden" name="state" value="${state || ''}">
            <input type="hidden" name="code_challenge" value="${code_challenge}">
            <input type="hidden" name="code_challenge_method" value="${code_challenge_method || 'S256'}">
            
            <div class="form-group">
              <label for="email">Email</label>
              <input type="email" id="email" name="email" value="${process.env.MOCK_USER_EMAIL || 'user@example.com'}" required>
            </div>
            
            <div class="form-group">
              <label for="password">Password</label>
              <input type="password" id="password" name="password" required placeholder="••••••••">
            </div>
            
            <button type="submit" class="btn">Otorisasi & Masuk</button>
          </form>
        </div>
      </body>
      </html>
    `;

    return res.status(200).send(html);
  } catch (err: any) {
    console.error('Authorize Error:', err);
    return res.status(500).send('Internal Server Error');
  }
};

// 2.5 OAuth 2.1 GET /oauth/callback (OIDC Callback Handler)
export const handleOidcCallback = async (req: express.Request, res: express.Response) => {
  try {
    const { code, state } = req.query;
    if (!code || !state) {
      return res.status(400).send('Missing code or state from OIDC provider');
    }

    const secretKey = getSecretKey();
    let atlassianParams: any;

    try {
      const { payload } = await jose.jwtDecrypt(state as string, secretKey);
      atlassianParams = payload;
    } catch (e) {
      return res.status(400).send('Invalid state token');
    }

    // Exchange OIDC code for ID Token
    const tokenResponse = await fetch(process.env.OIDC_TOKEN_ENDPOINT as string, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: process.env.OIDC_CLIENT_ID as string,
        client_secret: process.env.OIDC_CLIENT_SECRET as string,
        code: code as string,
        redirect_uri: process.env.OIDC_REDIRECT_URI as string,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenResponse.ok) {
      const errText = await tokenResponse.text();
      console.error('OIDC Token Error:', errText);
      return res.status(500).send('Failed to exchange OIDC code');
    }

    const tokenData = await tokenResponse.json() as any;
    if (!tokenData.id_token) {
      return res.status(500).send('OIDC provider did not return an id_token');
    }

    // Decode ID Token to get user info
    const decodedIdToken = jose.decodeJwt(tokenData.id_token);
    const email = decodedIdToken.email || decodedIdToken.preferred_username;

    if (!email) {
      return res.status(500).send('Could not extract email from OIDC id_token');
    }

    // Generate SERSAN stateless authorization code
    const authorization_code = await new jose.EncryptJWT({
      client_id: atlassianParams.client_id,
      redirect_uri: atlassianParams.redirect_uri,
      email,
      code_challenge: atlassianParams.code_challenge,
      code_challenge_method: atlassianParams.code_challenge_method,
    })
      .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
      .setIssuedAt()
      .setExpirationTime('5m')
      .encrypt(secretKey);

    // Redirect user back to Atlassian redirect URI
    const redirectUrl = new URL(atlassianParams.redirect_uri);
    redirectUrl.searchParams.append('code', authorization_code);
    if (atlassianParams.state) {
      redirectUrl.searchParams.append('state', atlassianParams.state);
    }

    console.log(`[OIDC] User logged in: ${email}. Redirecting back to Atlassian.`);
    return res.redirect(redirectUrl.toString());

  } catch (err: any) {
    console.error('OIDC Callback Error:', err);
    return res.status(500).send('Internal Server Error');
  }
};

// 3. OAuth 2.1 POST /oauth/login (Handles Mock Login submission & redirects with Auth Code)
export const submitLogin = async (req: express.Request, res: express.Response) => {
  try {
    const {
      client_id,
      redirect_uri,
      state,
      code_challenge,
      code_challenge_method,
      email,
      password,
    } = req.body;

    const mockEmail = process.env.MOCK_USER_EMAIL || 'user@example.com';
    const mockPassword = process.env.MOCK_USER_PASSWORD || 'secret-password';

    // Verify mock credentials
    if (email !== mockEmail || password !== mockPassword) {
      return res.status(401).send(`
        <h3>Otorisasi Gagal: Kredensial Salah</h3>
        <a href="/oauth/authorize?client_id=${encodeURIComponent(client_id)}&redirect_uri=${encodeURIComponent(redirect_uri)}&code_challenge=${encodeURIComponent(code_challenge)}&code_challenge_method=${encodeURIComponent(code_challenge_method)}&state=${encodeURIComponent(state)}">Coba Lagi</a>
      `);
    }

    const secretKey = getSecretKey();

    // Stateless Authorization Code: Encrypted short-lived JWE (valid for 5 minutes)
    const authorization_code = await new jose.EncryptJWT({
      client_id,
      redirect_uri,
      email,
      code_challenge,
      code_challenge_method,
    })
      .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
      .setIssuedAt()
      .setExpirationTime('5m') // Auth code expires in 5 minutes
      .encrypt(secretKey);

    // Redirect user back to Atlassian redirect URI with auth code & state
    const redirectUrl = new URL(redirect_uri);
    redirectUrl.searchParams.append('code', authorization_code);
    if (state) {
      redirectUrl.searchParams.append('state', state);
    }

    console.log(`[OAuth] User logged in: ${email}. Redirecting back to Atlassian.`);
    return res.redirect(redirectUrl.toString());
  } catch (err: any) {
    console.error('Submit Login Error:', err);
    return res.status(500).send('Internal Server Error');
  }
};

// 4. OAuth 2.1 POST /oauth/token (Exchange Auth Code for JWT Access Token with PKCE Verification)
export const tokenExchange = async (req: express.Request, res: express.Response) => {
  try {
    let { grant_type, code, redirect_uri, client_id, code_verifier } = req.body;

    // Support HTTP Basic Auth for client_id (Atlassian sometimes uses this instead of body parameter)
    if (!client_id && req.headers.authorization?.startsWith('Basic ')) {
      const base64Credentials = req.headers.authorization.split(' ')[1];
      const decodedCredentials = Buffer.from(base64Credentials, 'base64').toString('utf-8');
      client_id = decodedCredentials.split(':')[0];
    }

    if (grant_type !== 'authorization_code') {
      return res.status(400).json({ error: 'unsupported_grant_type', error_description: 'Only authorization_code is supported' });
    }

    if (!code || !code_verifier || !client_id) {
      return res.status(400).json({ error: 'invalid_request', error_description: 'Missing code, code_verifier, or client_id' });
    }

    const secretKey = getSecretKey();
    let authCodePayload: any;

    // Decrypt and verify the stateless authorization code JWE
    try {
      const { payload } = await jose.jwtDecrypt(code, secretKey);
      authCodePayload = payload;
    } catch (e: any) {
      console.warn('Auth Code Decryption Failed:', e.message);
      return res.status(400).json({ error: 'invalid_grant', error_description: 'Authorization code is invalid or expired' });
    }

    // Verify client_id matches the code issuer
    if (authCodePayload.client_id !== client_id) {
      return res.status(400).json({ error: 'invalid_grant', error_description: 'Client ID mismatch' });
    }

    // PKCE Verification
    const { code_challenge, code_challenge_method } = authCodePayload;
    let computedChallenge: string;

    if (code_challenge_method === 'S256') {
      // SHA-256 Base64URL hash of code_verifier
      computedChallenge = crypto
        .createHash('sha256')
        .update(code_verifier)
        .digest('base64url');
    } else {
      // Plain code challenge
      computedChallenge = code_verifier;
    }

    if (computedChallenge !== code_challenge) {
      console.warn('[PKCE] Verification failed. Challenge mismatch.');
      return res.status(400).json({ error: 'invalid_grant', error_description: 'PKCE code verifier does not match challenge' });
    }

    // PKCE matches! Generate symmetric JWS signed JWT Access Token
    const user_email = authCodePayload.email;
    const access_token = await new jose.SignJWT({
      email: user_email,
      client_id,
      scope: 'mcp:execute',
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('1h') // Token valid for 1 hour
      .sign(secretKey);

    console.log(`[OAuth] Issued Access Token for: ${user_email}`);

    return res.status(200).json({
      access_token,
      token_type: 'Bearer',
      expires_in: 3600,
    });
  } catch (err: any) {
    console.error('Token Exchange Error:', err);
    return res.status(500).json({ error: 'server_error' });
  }
};
