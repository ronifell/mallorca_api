import { Request } from 'express';
import { env } from '../config/env';

/**
 * Public origin reachable by clients (phones, emulators).
 * Prefer the incoming request Host so dev uploads work when API_BASE_URL is localhost
 * but the app calls the machine via LAN IP.
 */
export function requestPublicOrigin(req: Request): string {
  const host = req.get('x-forwarded-host') ?? req.get('host');
  if (host) {
    const proto = (req.get('x-forwarded-proto') ?? req.protocol ?? 'http')
      .split(',')[0]
      .trim();
    return `${proto}://${host}`;
  }
  return env.apiBaseUrl.replace(/\/$/, '');
}
