import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

// Always load Backend/.env even when pm2 starts from another cwd.
// (verify-push.ts works because it is run from Backend/; the API often is not.)
const backendRoot = path.resolve(__dirname, '..', '..');
const backendEnvPath = path.join(backendRoot, '.env');
// override: true ensures Backend/.env wins over stale shell/pm2 env vars
// (e.g. an old BILLING_ALLOW_MOCK=true left in the process environment).
if (fs.existsSync(backendEnvPath)) {
  dotenv.config({ path: backendEnvPath, override: true });
} else {
  dotenv.config({ path: path.resolve(process.cwd(), '.env'), override: true });
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

/**
 * Resolve Google Play service-account credentials.
 * Prefer inline GOOGLE_SERVICE_ACCOUNT_JSON; otherwise load from
 * GOOGLE_SERVICE_ACCOUNT_JSON_PATH (absolute or relative to Backend/).
 */
function resolveGooglePlayServiceAccountJson(): string {
  const inline = (process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? '').trim();
  if (inline) return inline;

  const filePathRaw = (process.env.GOOGLE_SERVICE_ACCOUNT_JSON_PATH ?? '').trim();
  if (!filePathRaw) return '';

  const resolved = path.isAbsolute(filePathRaw)
    ? filePathRaw
    : path.join(backendRoot, filePathRaw);

  if (!fs.existsSync(resolved)) {
    console.warn(
      `[env] GOOGLE_SERVICE_ACCOUNT_JSON_PATH not found: ${resolved}`,
    );
    return '';
  }

  try {
    return fs.readFileSync(resolved, 'utf8').trim();
  } catch (err) {
    console.warn(
      `[env] Failed to read GOOGLE_SERVICE_ACCOUNT_JSON_PATH: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return '';
  }
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
    packageName: (process.env.GOOGLE_PLAY_PACKAGE_NAME ?? '').trim(),
    serviceAccountJson: resolveGooglePlayServiceAccountJson(),
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
      '528899539521-sk200iq6bf4pa3rga03bnr03sqo8k6be.apps.googleusercontent.com',
    /** Optional iOS client ID (additional allowed audience for verifyIdToken). */
    iosClientId: process.env.GOOGLE_IOS_CLIENT_ID ?? '',
    /**
     * Android OAuth client IDs (comma-separated). Accepted as additional audiences
     * when Google returns an Android-client-scoped ID token. Include both the EAS
     * upload-key client and the Play App Signing client when they differ.
     */
    androidClientIds: (
      process.env.GOOGLE_ANDROID_CLIENT_IDS ??
      process.env.GOOGLE_ANDROID_CLIENT_ID ??
      [
        '528899539521-uqicjas911s0c6a1oqsom665bksdd594.apps.googleusercontent.com',
        '528899539521-0rm1ctk4vaucdeg52n41ifhrr3gcnfbo.apps.googleusercontent.com',
      ].join(',')
    )
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  },

  billing: {
    /**
     * If false (the default), the backend refuses to activate Premium in
     * the absence of real Play Store credentials. Set BILLING_ALLOW_MOCK=true
     * **only** in dev/staging when you want to exercise the gating without
     * real purchases.
     */
    allowMock: ['true', '1', 'yes'].includes(
      (process.env.BILLING_ALLOW_MOCK ?? '').trim().toLowerCase(),
    ),
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
