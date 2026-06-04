/**
 * Storage abstraction for AWS S3 / Cloudflare R2 (S3-compatible).
 *
 * In dev (no credentials configured), uploads are persisted to disk under
 * `uploads/` so the rest of the stack can be exercised end-to-end without
 * cloud credentials.
 */
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { env } from '../config/env';
import { logger } from '../utils/logger';

let s3: S3Client | null = null;

function getClient(): S3Client | null {
  if (!env.storage.accessKeyId || !env.storage.bucket) return null;
  if (s3) return s3;
  s3 = new S3Client({
    region: env.storage.region,
    endpoint: env.storage.endpoint || undefined,
    credentials: {
      accessKeyId: env.storage.accessKeyId,
      secretAccessKey: env.storage.secretAccessKey,
    },
    forcePathStyle: !!env.storage.endpoint,
  });
  return s3;
}

export interface StoredObject {
  key: string;
  url: string;
}

function publicUrlFor(key: string): string {
  if (env.storage.publicBaseUrl) {
    return `${env.storage.publicBaseUrl.replace(/\/$/, '')}/${key}`;
  }
  if (env.storage.endpoint) {
    return `${env.storage.endpoint.replace(/\/$/, '')}/${env.storage.bucket}/${key}`;
  }
  return `https://${env.storage.bucket}.s3.${env.storage.region}.amazonaws.com/${key}`;
}

const UPLOADS_PATH_RE = /\/uploads\/(.+?)(?:\?|#|$)/;

function extractUploadsKey(imageUrl: string): string | null {
  const m = imageUrl.match(UPLOADS_PATH_RE);
  return m ? decodeURIComponent(m[1]) : null;
}

function isLocalUploadUrl(imageUrl: string): boolean {
  return imageUrl.includes('/uploads/');
}

function isExternalMediaUrl(imageUrl: string): boolean {
  try {
    const host = new URL(imageUrl).hostname;
    if (host === 'picsum.photos' || host.endsWith('.picsum.photos')) return true;
    if (host.includes('.s3.') && host.endsWith('.amazonaws.com')) return true;
    if (env.storage.publicBaseUrl && imageUrl.startsWith(env.storage.publicBaseUrl)) return true;
    if (env.storage.endpoint && imageUrl.startsWith(env.storage.endpoint)) return true;
  } catch {
    return false;
  }
  return false;
}

function rewriteLegacyHost(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.pathname.includes('/uploads/')) {
      const key = extractUploadsKey(url);
      if (key) {
        return `${env.apiBaseUrl.replace(/\/$/, '')}/uploads/${key}`;
      }
    }
    const base = new URL(env.apiBaseUrl);
    const legacyHost =
      parsed.hostname === 'localhost' ||
      parsed.hostname === '127.0.0.1' ||
      /^192\.168\.\d{1,3}\.\d{1,3}$/.test(parsed.hostname) ||
      /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(parsed.hostname);
    if (legacyHost) {
      parsed.protocol = base.protocol;
      parsed.host = base.host;
      return parsed.toString();
    }
  } catch {
    /* keep original */
  }
  return url;
}

/**
 * Rebuilds a public URL using the current API/S3 config.
 * Fixes photos saved with localhost/LAN URLs or after moving servers.
 */
export function resolveStoredUrl(imageUrl: string, storageKey?: string | null): string {
  const trimmed = imageUrl.trim();
  if (!trimmed) return trimmed;

  const key = storageKey ?? extractUploadsKey(trimmed);

  if (key && isLocalUploadUrl(trimmed)) {
    return `${env.apiBaseUrl.replace(/\/$/, '')}/uploads/${key}`;
  }

  if (key && getClient()) {
    return publicUrlFor(key);
  }

  if (key && !getClient()) {
    return `${env.apiBaseUrl.replace(/\/$/, '')}/uploads/${key}`;
  }

  if (isExternalMediaUrl(trimmed)) {
    return trimmed;
  }

  return rewriteLegacyHost(trimmed);
}

export async function uploadImage(
  buffer: Buffer,
  mime: string,
  prefix = 'photos',
  publicOrigin?: string,
): Promise<StoredObject> {
  const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
  const key = `${prefix}/${new Date().toISOString().slice(0, 10)}/${uuidv4()}.${ext}`;

  const client = getClient();
  if (!client) {
    // Dev fallback: write to local uploads/ folder.
    const localDir = path.join(process.cwd(), 'uploads', path.dirname(key));
    await fs.mkdir(localDir, { recursive: true });
    await fs.writeFile(path.join(process.cwd(), 'uploads', key), buffer);
    const base = (publicOrigin ?? env.apiBaseUrl).replace(/\/$/, '');
    const url = `${base}/uploads/${key}`;
    logger.info('Image stored locally (dev mode)', { key, url });
    return { key, url };
  }

  await client.send(
    new PutObjectCommand({
      Bucket: env.storage.bucket,
      Key: key,
      Body: buffer,
      ContentType: mime,
      ACL: 'public-read',
    }),
  );
  return { key, url: publicUrlFor(key) };
}
