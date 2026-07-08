import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

// Always load Backend/.env even when pm2 starts from another cwd.
// (verify-push.ts works because it is run from Backend/; the API often is not.)
const backendRoot = path.resolve(__dirname, '..', '..');
const backendEnvPath = path.join(backendRoot, '.env');
if (fs.existsSync(backendEnvPath)) {
  dotenv.config({ path: backendEnvPath });
} else {
  dotenv.config({ path: path.resolve(process.cwd(), '.env') });
}

const required = (key: string, fallback?: string): string => {
  const v = process.env[key] ?? fallback;
  if (v === undefined) {
    throw new Error(`Missing required env var: ${key}`);
  }
  return v;
};

/** Normalize PEM key from .env / pm2 (quoted strings, literal \\n sequences). */
function normalizePrivateKey(raw: string): string {
  let key = raw.trim();
  if (
    (key.startsWith('"') && key.endsWith('"')) ||
    (key.startsWith("'") && key.endsWith("'"))
  ) {
    key = key.slice(1, -1);
  }
  return key.replace(/\\n/g, '\n');
}

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
    from: process.env.MAIL_FROM ?? 'Citas Mallorca <info@citasmallorca.es>',
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
    privateKey: normalizePrivateKey(process.env.FIREBASE_PRIVATE_KEY ?? ''),
  },

  googlePlay: {
    packageName: process.env.GOOGLE_PLAY_PACKAGE_NAME ?? '',
    serviceAccountJson: process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? '',
    /**
     * Shared secret appended as `?token=...` to the Pub/Sub push
     * subscription URL. Rotate whenever the URL is rotated.
     */
    rtdnToken: process.env.GOOGLE_PLAY_RTDN_TOKEN ?? '',
  },

  googleAuth: {
    /**
     * Web OAuth client ID — used to verify Google ID tokens from the mobile app.
     * The mobile app configures Google Sign-In with this same web client ID as
     * the token audience, so it MUST match. Client IDs are not secrets (they
     * ship inside the app), so we default to the app's public web client ID to
     * avoid Google login silently failing when GOOGLE_CLIENT_ID is unset.
     */
    clientId:
      process.env.GOOGLE_CLIENT_ID ??
      '348711983822-7tp79tt59u3vrsusl2iave6o0taqpaiv.apps.googleusercontent.com',
    /** Optional iOS client ID (additional allowed audience for verifyIdToken). */
    iosClientId: process.env.GOOGLE_IOS_CLIENT_ID ?? '',
    /** Android client ID — accepted as an audience for robustness. */
    androidClientId:
      process.env.GOOGLE_ANDROID_CLIENT_ID ??
      '348711983822-t881asjhgq217qmiv1dle7gm00plvd0g.apps.googleusercontent.com',
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

  app: {
    /** Custom URL scheme used to return users to the mobile app after email verification. */
    deepLinkScheme: (process.env.APP_DEEP_LINK_SCHEME ?? 'citasmallorca').replace(/:$/, ''),
  },

  contact: {
    info: process.env.CONTACT_INFO_EMAIL ?? 'info@citasmallorca.es',
    support: process.env.CONTACT_SUPPORT_EMAIL ?? 'support@citasmallorca.es',
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
