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

export async function uploadImage(buffer: Buffer, mime: string, prefix = 'photos'): Promise<StoredObject> {
  const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
  const key = `${prefix}/${new Date().toISOString().slice(0, 10)}/${uuidv4()}.${ext}`;

  const client = getClient();
  if (!client) {
    // Dev fallback: write to local uploads/ folder.
    const localDir = path.join(process.cwd(), 'uploads', path.dirname(key));
    await fs.mkdir(localDir, { recursive: true });
    await fs.writeFile(path.join(process.cwd(), 'uploads', key), buffer);
    const url = `${env.apiBaseUrl.replace(/\/$/, '')}/uploads/${key}`;
    logger.info('Image stored locally (dev mode)', { key });
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
