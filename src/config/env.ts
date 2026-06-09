import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const required = (key: string, fallback?: string): string => {
  const v = process.env[key] ?? fallback;
  if (v === undefined) {
    throw new Error(`Missing required env var: ${key}`);
  }
  return v;
};

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 4000),
  apiBaseUrl: process.env.API_BASE_URL ?? 'http://localhost:4000',
  corsOrigin: process.env.CORS_ORIGIN ?? '*',

  database: {
    url: required('DATABASE_URL', 'postgres://postgres:postgres@localhost:5432/mallorca_dating'),
    ssl: process.env.DATABASE_SSL === 'true',
  },

  jwt: {
    accessSecret: required('JWT_ACCESS_SECRET', 'dev_access_secret_change_me'),
    refreshSecret: required('JWT_REFRESH_SECRET', 'dev_refresh_secret_change_me'),
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? '15m',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '30d',
  },

  mail: {
    host: process.env.SMTP_HOST ?? '',
    port: Number(process.env.SMTP_PORT ?? 587),
    user: process.env.SMTP_USER ?? '',
    pass: process.env.SMTP_PASS ?? '',
    from: process.env.MAIL_FROM ?? 'no-reply@citasmallorca.es',
  },

  storage: {
    provider: (process.env.STORAGE_PROVIDER ?? 's3') as 's3' | 'r2',
    bucket: process.env.S3_BUCKET ?? '',
    region: process.env.S3_REGION ?? 'eu-west-1',
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
    endpoint: process.env.S3_ENDPOINT ?? '',
    publicBaseUrl: process.env.S3_PUBLIC_BASE_URL ?? '',
  },

  firebase: {
    projectId: process.env.FIREBASE_PROJECT_ID ?? '',
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL ?? '',
    privateKey: (process.env.FIREBASE_PRIVATE_KEY ?? '').replace(/\\n/g, '\n'),
  },

  googlePlay: {
    packageName: process.env.GOOGLE_PLAY_PACKAGE_NAME ?? '',
    serviceAccountJson: process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? '',
  },

  billing: {
    /**
     * If false (the default), the backend refuses to activate Premium in
     * the absence of real Play Store credentials. Set BILLING_ALLOW_MOCK=true
     * **only** in dev/staging when you want to exercise the gating without
     * real purchases.
     */
    allowMock: process.env.BILLING_ALLOW_MOCK === 'true',
  },

  publicWeb: {
    /** Marketing / legal site that hosts T&C + privacy policy. */
    url: process.env.PUBLIC_WEB_URL ?? 'https://www.citasmallorca.es',
  },

  contact: {
    info: process.env.CONTACT_INFO_EMAIL ?? 'info@citasmallorca.es',
    support: process.env.CONTACT_SUPPORT_EMAIL ?? 'soporte@citasmallorca.es',
  },

  rateLimit: {
    windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS ?? 15 * 60 * 1000),
    max: Number(process.env.RATE_LIMIT_MAX ?? 300),
  },

  admin: {
    emails: (process.env.ADMIN_EMAILS ?? '').split(',').map((e) => e.trim()).filter(Boolean),
  },
};

export const isProd = env.nodeEnv === 'production';
