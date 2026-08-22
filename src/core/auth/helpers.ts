import * as jose from 'jose';
import crypto from 'node:crypto';
import { validateEnv } from '../../config/gateway.config';

export const getSecretKey = (): Buffer => {
  validateEnv();
  const key = process.env.MASTER_SECRET_KEY;
  if (!key) {
    throw new Error('MASTER_SECRET_KEY environment variable is not set');
  }
  return Buffer.from(key, 'base64');
};

export const encryptJwe = async (payload: any, expiresIn?: string): Promise<string> => {
  const secretKey = getSecretKey();
  let jwt = new jose.EncryptJWT(payload)
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
    .setIssuedAt();
    
  if (expiresIn) {
    jwt = jwt.setExpirationTime(expiresIn);
  }
  return await jwt.encrypt(secretKey);
};

export const decryptJwe = async (token: string): Promise<any> => {
  const secretKey = getSecretKey();
  const { payload } = await jose.jwtDecrypt(token, secretKey);
  return payload;
};

export const signJwt = async (payload: any, expiresIn: string): Promise<string> => {
  const secretKey = getSecretKey();
  return await new jose.SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(secretKey);
};

export const verifyJwt = async (token: string): Promise<any> => {
  const secretKey = getSecretKey();
  const { payload } = await jose.jwtVerify(token, secretKey);
  return payload;
};

export const decodeJwtUnsafe = (token: string): any => {
  return jose.decodeJwt(token);
};

export const verifyPkceChallenge = (codeVerifier: string, codeChallenge: string, codeChallengeMethod: string): boolean => {
  let computedChallenge: string;

  if (codeChallengeMethod === 'S256') {
    computedChallenge = crypto
      .createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');
  } else {
    // Plain code challenge
    computedChallenge = codeVerifier;
  }

  return computedChallenge === codeChallenge;
};
