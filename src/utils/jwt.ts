import jwt, { JwtPayload, SignOptions } from 'jsonwebtoken';
import { env } from '../config/env';

export interface AccessTokenPayload extends JwtPayload {
  sub: string;
  email: string;
  role: 'user' | 'admin';
  premium: boolean;
}

export interface RefreshTokenPayload extends JwtPayload {
  sub: string;
  jti: string;
}

export function signAccessToken(payload: Omit<AccessTokenPayload, 'iat' | 'exp'>): string {
  const opts: SignOptions = { expiresIn: env.jwt.accessExpiresIn as SignOptions['expiresIn'] };
  return jwt.sign(payload, env.jwt.accessSecret, opts);
}

export function signRefreshToken(payload: Omit<RefreshTokenPayload, 'iat' | 'exp'>): string {
  const opts: SignOptions = { expiresIn: env.jwt.refreshExpiresIn as SignOptions['expiresIn'] };
  return jwt.sign(payload, env.jwt.refreshSecret, opts);
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, env.jwt.accessSecret) as AccessTokenPayload;
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  return jwt.verify(token, env.jwt.refreshSecret) as RefreshTokenPayload;
}
