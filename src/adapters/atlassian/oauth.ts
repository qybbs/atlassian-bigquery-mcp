import express from 'express';
import { encryptJwe, decryptJwe, signJwt, decodeJwtUnsafe, verifyPkceChallenge } from '../../core/auth/helpers';

const parseCookies = (cookieHeader?: string): Record<string, string> => {
  const list: Record<string, string> = {};
  if (!cookieHeader) return list;
  cookieHeader.split(';').forEach(cookie => {
    const parts = cookie.split('=');
    const key = parts.shift()?.trim();
    if (key) list[key] = decodeURIComponent(parts.join('='));
  });
  return list;
};

const escapeHtml = (unsafe: any): string => {
  if (unsafe === undefined || unsafe === null) return '';
  return String(unsafe)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
};

// 1. Dynamic Client Registration (DCR - RFC 7591)
export const registerClient = async (req: express.Request, res: express.Response) => {
  try {
    const { client_name, redirect_uris } = req.body;
    if (!redirect_uris || !Array.isArray(redirect_uris) || redirect_uris.length === 0) {
      return res.status(400).json({ error: 'redirect_uris is required and must be a non-empty array' });
    }

    const allowedRedirectUris = process.env.ALLOWED_REDIRECT_URIS ? process.env.ALLOWED_REDIRECT_URIS.split(',').map(s => s.trim()) : [];
    if (allowedRedirectUris.length > 0) {
      const invalidUris = redirect_uris.filter((uri: string) => !allowedRedirectUris.includes(uri));
      if (invalidUris.length > 0) {
        return res.status(400).json({ error: 'invalid_redirect_uri', error_description: 'One or more redirect URIs are not allowed' });
      }
    }

    // Stateless Client ID: Encrypted JWE containing registration metadata
    const client_id = await encryptJwe({ client_name, redirect_uris });

    // Stateless Client Secret (dummy encrypted string to satisfy OAuth client configurations)
    const client_secret = await encryptJwe({ type: 'secret', client_name });

    const baseUrl = `${req.protocol}://${req.get('host')}`;

    console.log(`[DCR] Registered client statelessly.`);

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

    if (!/^[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+$/.test(client_id as string)) {
      return res.status(400).send('Invalid client_id format');
    }
    if (!/^[a-zA-Z0-9_-]{43,128}$/.test(code_challenge as string)) {
      return res.status(400).send('Invalid code_challenge format');
    }

    let clientMetadata: any;

    try {
      clientMetadata = await decryptJwe(client_id as string);
    } catch (e: any) {
      console.warn('Invalid client_id decryption attempt:', e.message);
      return res.status(400).send('Invalid client_id');
    }

    const matchedUri = clientMetadata.redirect_uris.find((uri: string) => uri === redirect_uri);
    if (!matchedUri) {
      return res.status(400).send('Redirect URI not registered for this client');
    }

    if (process.env.AUTH_PROVIDER === 'OIDC') {
      const oidcState = await encryptJwe({
        client_id,
        redirect_uri,
        response_type,
        state,
        code_challenge,
        code_challenge_method,
      }, '10m');

      const oidcAuthUrl = new URL(process.env.OIDC_AUTHORIZATION_ENDPOINT as string);
      oidcAuthUrl.searchParams.append('client_id', process.env.OIDC_CLIENT_ID as string);
      oidcAuthUrl.searchParams.append('redirect_uri', process.env.OIDC_REDIRECT_URI as string);
      oidcAuthUrl.searchParams.append('response_type', 'code');
      oidcAuthUrl.searchParams.append('scope', 'openid email profile');
      oidcAuthUrl.searchParams.append('state', oidcState);

      return res.redirect(oidcAuthUrl.toString());
    }

    const stateStr = typeof state === 'string' ? state : '';
    const flowToken = await encryptJwe({
      client_id,
      redirect_uri: matchedUri,
      state: stateStr,
      code_challenge,
      code_challenge_method: code_challenge_method === 'plain' ? 'plain' : 'S256',
    }, '15m');

    const isSecure = req.protocol === 'https' || req.secure;
    res.setHeader('Set-Cookie', `oauth_flow=${flowToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=900${isSecure ? '; Secure' : ''}`);

    const isError = req.query.error === 'login_failed';
    const errorMessage = isError ? '<div class="error-msg" style="padding:10px;background:rgba(248,81,73,0.1);border:1px solid rgba(248,81,73,0.4);border-radius:6px;margin-bottom:15px;text-align:center;">Otorisasi Gagal: Kredensial Salah</div>' : '';

    const html = `
      <!DOCTYPE html>
      <html lang="id">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Enterprise SaaS-to-MCP Gateway Otorisasi</title>
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
          <div class="logo">Corporate</div>
          <div class="title">Mock SSO Otorisasi</div>
          <div class="subtitle">Personal project test login</div>
          ${errorMessage}
          <form action="/oauth/login" method="POST">
            
            <div class="form-group">
              <label for="email">Email</label>
              <input type="email" id="email" name="email" value="${escapeHtml(process.env.MOCK_USER_EMAIL || 'user@example.com')}" required>
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

    let atlassianParams: any;

    try {
      atlassianParams = await decryptJwe(state as string);
    } catch (e: any) {
      console.warn('OIDC State decryption failed:', e.message);
      return res.status(400).send('Invalid state token');
    }

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
      await tokenResponse.text();
      console.error('OIDC Token Error: Provider returned failure status.');
      return res.status(500).send('Failed to exchange OIDC code');
    }

    const tokenData = await tokenResponse.json() as any;
    if (!tokenData.id_token) {
      return res.status(500).send('OIDC provider did not return an id_token');
    }

    const decodedIdToken = decodeJwtUnsafe(tokenData.id_token);
    const email = (decodedIdToken.email || decodedIdToken.preferred_username) as string;

    if (!email) {
      return res.status(500).send('Could not extract email from OIDC id_token');
    }

    const allowedDomainsStr = process.env.ALLOWED_EMAIL_DOMAINS;
    if (allowedDomainsStr) {
      const allowedDomains = allowedDomainsStr.split(',').map(d => d.trim().toLowerCase());
      const emailDomain = email.split('@')[1]?.toLowerCase();
      if (!emailDomain || !allowedDomains.includes(emailDomain)) {
        return res.status(403).send('Email domain not allowed');
      }
    }

    const authorization_code = await encryptJwe({
      client_id: atlassianParams.client_id,
      redirect_uri: atlassianParams.redirect_uri,
      email,
      code_challenge: atlassianParams.code_challenge,
      code_challenge_method: atlassianParams.code_challenge_method,
    }, '5m');

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
    const cookies = parseCookies(req.headers.cookie);
    const flowToken = cookies['oauth_flow'];
    
    if (!flowToken) {
      return res.status(400).send('Session expired or invalid flow. Please try logging in again.');
    }

    let flowData: any;

    try {
      flowData = await decryptJwe(flowToken);
    } catch (e: any) {
      console.warn('Flow token decryption failed:', e.message);
      return res.status(400).send('Invalid session state');
    }

    const { client_id, redirect_uri, state, code_challenge, code_challenge_method } = flowData;
    const { email, password } = req.body;

    const mockEmail = process.env.MOCK_USER_EMAIL || 'user@example.com';
    const mockPassword = process.env.MOCK_USER_PASSWORD || 'secret-password';

    if (email !== mockEmail || password !== mockPassword) {
      res.setHeader('Set-Cookie', 'oauth_flow=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
      const authorizeUrl = `/oauth/authorize?client_id=${encodeURIComponent(client_id)}&redirect_uri=${encodeURIComponent(redirect_uri)}&code_challenge=${encodeURIComponent(code_challenge)}&code_challenge_method=${encodeURIComponent(code_challenge_method)}&state=${encodeURIComponent(state)}&error=login_failed`;
      return res.redirect(authorizeUrl);
    }

    const authorization_code = await encryptJwe({
      client_id,
      redirect_uri,
      email,
      code_challenge,
      code_challenge_method,
    }, '5m');

    res.setHeader('Set-Cookie', 'oauth_flow=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');

    const redirectUrl = new URL(redirect_uri);
    redirectUrl.searchParams.append('code', authorization_code);
    if (state) {
      redirectUrl.searchParams.append('state', state);
    }

    console.log(`[Mock SSO] User logged in: ${email}. Redirecting back to client.`);
    return res.redirect(redirectUrl.toString());
  } catch (err: any) {
    console.error('Submit Login Error:', err);
    return res.status(500).send('Internal Server Error');
  }
};

// 4. OAuth 2.1 POST /oauth/token (Exchange Auth Code for JWT Access Token with PKCE Verification)
export const tokenExchange = async (req: express.Request, res: express.Response) => {
  try {
    let { grant_type, code, client_id, code_verifier } = req.body;

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

    let authCodePayload: any;

    try {
      authCodePayload = await decryptJwe(code);
    } catch (e: any) {
      console.warn('Auth Code Decryption Failed:', e.message);
      return res.status(400).json({ error: 'invalid_grant', error_description: 'Authorization code is invalid or expired' });
    }

    if (authCodePayload.client_id !== client_id) {
      return res.status(400).json({ error: 'invalid_grant', error_description: 'Client ID mismatch' });
    }

    const { code_challenge, code_challenge_method } = authCodePayload;
    
    if (!verifyPkceChallenge(code_verifier, code_challenge, code_challenge_method)) {
      console.warn('[PKCE] Verification failed. Challenge mismatch.');
      return res.status(400).json({ error: 'invalid_grant', error_description: 'PKCE code verifier does not match challenge' });
    }

    const user_email = authCodePayload.email;
    const access_token = await signJwt({
      email: user_email,
      client_id,
      scope: 'mcp:execute',
    }, process.env.TOKEN_EXPIRATION || '1h');

    console.log(`[OAuth] Issued Access Token for: ${user_email}`);

    return res.status(200).json({
      access_token,
      token_type: 'Bearer',
      expires_in: Number.parseInt(process.env.TOKEN_EXPIRATION_SECONDS || '3600', 10),
    });
  } catch (err: any) {
    console.error('Token Exchange Error:', err);
    return res.status(500).json({ error: 'server_error' });
  }
};
