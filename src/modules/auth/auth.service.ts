import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { query, withTransaction } from '../../config/database';
import { env } from '../../config/env';
import { sendMail } from '../../services/mailer';
import {
  googleWelcomeEmail,
  passwordResetEmail,
  welcomeVerificationEmail,
} from '../../services/emailTemplates';
import { BadRequest, Conflict, Unauthorized } from '../../utils/errors';
import {
  AccessTokenPayload,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from '../../utils/jwt';
import { hashPassword, isStrongPassword, verifyPassword } from '../../utils/password';
import {
  ForgotPasswordInput,
  GoogleLoginInput,
  LoginInput,
  RefreshInput,
  RegisterInput,
  ResendVerificationInput,
  ResetPasswordInput,
  VerifyEmailInput,
} from './auth.schemas';

const VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const PASSWORD_RESET_CODE_TTL_MS = 15 * 60 * 1000; // 15 min

function generatePasswordResetCode(): string {
  return String(crypto.randomInt(100000, 1000000));
}

function buildVerifyUrl(rawToken: string): string {
  const base = env.apiBaseUrl.replace(/\/$/, '');
  return `${base}/api/auth/verify-email?token=${encodeURIComponent(rawToken)}`;
}

function buildAppVerifyDeepLink(rawToken: string): string {
  return `${env.app.deepLinkScheme}://verify-email?token=${encodeURIComponent(rawToken)}`;
}

async function issueVerificationToken(userId: string): Promise<string> {
  const raw = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(raw).digest('hex');
  const expiresAt = new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS);
  await query(
    `INSERT INTO email_verifications (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3)`,
    [userId, tokenHash, expiresAt],
  );
  return raw;
}

async function sendVerificationEmail(
  userId: string,
  email: string,
  firstName: string | null,
): Promise<void> {
  const raw = await issueVerificationToken(userId);
  const verifyUrl = buildVerifyUrl(raw);
  const appVerifyUrl = buildAppVerifyDeepLink(raw);
  const tpl = welcomeVerificationEmail({ firstName, verifyUrl, appVerifyUrl });
  await sendMail({ to: email, subject: tpl.subject, html: tpl.html, text: tpl.text });
}

interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

interface AuthResult extends AuthTokens {
  user: {
    id: string;
    email: string;
    role: 'user' | 'admin';
    isPremium: boolean;
    profileComplete: boolean;
    emailVerified: boolean;
  };
}

function isAdminEmail(email: string): boolean {
  return env.admin.emails.includes(email.toLowerCase());
}

function hasGoogleConsent(input: GoogleLoginInput): boolean {
  return input.acceptedTerms === true && input.acceptedPrivacy === true;
}

async function verifyGoogleIdToken(
  idToken: string,
): Promise<{ sub: string; email: string; name: string | null; emailVerified: boolean }> {
  const audiences = [
    env.googleAuth.clientId,
    env.googleAuth.iosClientId,
    ...env.googleAuth.androidClientIds,
  ].filter(Boolean);
  if (audiences.length === 0) {
    throw BadRequest('El inicio de sesión con Google no está configurado en el servidor.');
  }

  const { OAuth2Client } = await import('google-auth-library');
  const client = new OAuth2Client();
  let payload;
  try {
    const ticket = await client.verifyIdToken({ idToken, audience: audiences });
    payload = ticket.getPayload();
  } catch {
    throw Unauthorized('El token de Google no es válido.');
  }

  if (!payload?.sub || !payload.email) {
    throw Unauthorized('El token de Google no es válido.');
  }

  const rawName =
    (typeof payload.given_name === 'string' && payload.given_name.trim()) ||
    (typeof payload.name === 'string' && payload.name.split(' ')[0]?.trim()) ||
    null;

  return {
    sub: payload.sub,
    email: payload.email.toLowerCase(),
    name: rawName || null,
    emailVerified: payload.email_verified === true,
  };
}

async function buildAuthResult(user: {
  id: string;
  email: string;
  role: 'user' | 'admin';
  is_premium: boolean;
  email_verified_at: Date | null;
}): Promise<AuthResult> {
  const tokens = await issueTokens({
    id: user.id,
    email: user.email,
    role: user.role,
    isPremium: user.is_premium,
  });

  return {
    ...tokens,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      isPremium: user.is_premium,
      profileComplete: await profileComplete(user.id),
      emailVerified: user.email_verified_at != null,
    },
  };
}

async function issueTokens(user: {
  id: string;
  email: string;
  role: 'user' | 'admin';
  isPremium: boolean;
}): Promise<AuthTokens> {
  const access = signAccessToken({
    sub: user.id,
    email: user.email,
    role: user.role,
    premium: user.isPremium,
  } satisfies Omit<AccessTokenPayload, 'iat' | 'exp'>);

  const jti = uuidv4();
  const refresh = signRefreshToken({ sub: user.id, jti });

  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // matches default
  await query(
    `INSERT INTO refresh_tokens (user_id, jti, expires_at) VALUES ($1, $2, $3)`,
    [user.id, jti, expiresAt],
  );

  return { accessToken: access, refreshToken: refresh };
}

async function profileComplete(userId: string): Promise<boolean> {
  const r = await query<{ ok: boolean }>(
    `
    SELECT
      (u.first_name IS NOT NULL
        AND u.birth_date IS NOT NULL
        AND u.gender IS NOT NULL
        AND u.city IS NOT NULL
        AND p.interested_in IS NOT NULL
        AND EXISTS (SELECT 1 FROM photos ph WHERE ph.user_id = u.id)
        AND EXISTS (SELECT 1 FROM user_relationship_goals rg WHERE rg.user_id = u.id)
      ) AS ok
    FROM users u
    LEFT JOIN user_preferences p ON p.user_id = u.id
    WHERE u.id = $1
    `,
    [userId],
  );
  return r.rows[0]?.ok ?? false;
}

export const authService = {
  async register(input: RegisterInput): Promise<AuthResult> {
    if (!isStrongPassword(input.password)) {
      throw BadRequest(
        'La contraseña debe tener al menos 8 caracteres, incluyendo una mayúscula, una minúscula y un número.',
      );
    }

    const existing = await query<{ id: string }>(
      'SELECT id FROM users WHERE email = $1',
      [input.email.toLowerCase()],
    );
    if (existing.rowCount && existing.rowCount > 0) {
      throw Conflict('Este correo electrónico ya está registrado.');
    }

    const hash = await hashPassword(input.password);
    const role = isAdminEmail(input.email) ? 'admin' : 'user';

    const acceptedPrivacy = input.acceptedPrivacy === true;
    const inserted = await withTransaction(async (client) => {
      const r = await client.query<{ id: string; email: string }>(
        `INSERT INTO users (
            email, password_hash, role, language,
            terms_accepted_at, privacy_accepted_at
         )
         VALUES ($1, $2, $3, $4, NOW(), $5)
         RETURNING id, email`,
        [
          input.email.toLowerCase(),
          hash,
          role,
          input.language ?? 'en',
          acceptedPrivacy ? new Date() : null,
        ],
      );
      const u = r.rows[0];
      await client.query(
        `INSERT INTO notification_settings (user_id) VALUES ($1)
         ON CONFLICT (user_id) DO NOTHING`,
        [u.id],
      );
      return u;
    });

    const tokens = await issueTokens({
      id: inserted.id,
      email: inserted.email,
      role,
      isPremium: false,
    });

    // Send welcome / verification email in the background so a slow or
    // misconfigured SMTP server cannot delay (or break) registration.
    void sendVerificationEmail(inserted.id, inserted.email, null).catch(() => undefined);

    return {
      ...tokens,
      user: {
        id: inserted.id,
        email: inserted.email,
        role,
        isPremium: false,
        profileComplete: false,
        emailVerified: false,
      },
    };
  },

  async login(input: LoginInput): Promise<AuthResult> {
    const r = await query<{
      id: string;
      email: string;
      password_hash: string | null;
      is_premium: boolean;
      role: 'user' | 'admin';
      status: string;
      email_verified_at: Date | null;
    }>(
      `SELECT id, email, password_hash, is_premium, role, status, email_verified_at
       FROM users WHERE email = $1`,
      [input.email.toLowerCase()],
    );
    const user = r.rows[0];
    if (!user) throw Unauthorized('Correo o contraseña incorrectos.');
    if (user.status !== 'active') throw Unauthorized('Esta cuenta no está activa.');
    if (!user.password_hash) {
      throw Unauthorized(
        'Esta cuenta está conectada a Google. Toca el botón «Continuar con Google» para acceder a ella.',
      );
    }

    const ok = await verifyPassword(input.password, user.password_hash);
    if (!ok) throw Unauthorized('Correo o contraseña incorrectos.');

    await query('UPDATE users SET last_active_at = NOW() WHERE id = $1', [user.id]);

    return buildAuthResult(user);
  },

  async loginWithGoogle(input: GoogleLoginInput): Promise<AuthResult> {
    const google = await verifyGoogleIdToken(input.idToken);

    const byGoogle = await query<{
      id: string;
      email: string;
      is_premium: boolean;
      role: 'user' | 'admin';
      status: string;
      email_verified_at: Date | null;
    }>(
      `SELECT id, email, is_premium, role, status, email_verified_at
       FROM users WHERE google_sub = $1`,
      [google.sub],
    );
    let user = byGoogle.rows[0];

    if (!user) {
      const byEmail = await query<{
        id: string;
        email: string;
        password_hash: string | null;
        google_sub: string | null;
        is_premium: boolean;
        role: 'user' | 'admin';
        status: string;
        email_verified_at: Date | null;
      }>(
        `SELECT id, email, password_hash, google_sub, is_premium, role, status, email_verified_at
         FROM users WHERE email = $1`,
        [google.email],
      );
      const existing = byEmail.rows[0];

      if (existing) {
        if (existing.google_sub && existing.google_sub !== google.sub) {
          throw Conflict('Este correo está vinculado a otra cuenta de Google.');
        }

        if (existing.password_hash && !existing.google_sub && !google.emailVerified) {
          throw Unauthorized(
            'Tu correo de Google debe estar verificado antes de vincularlo a tu cuenta existente.',
          );
        }

        await query(
          `UPDATE users
           SET google_sub = $1,
               email_verified_at = CASE
                 WHEN $2 OR password_hash IS NOT NULL THEN COALESCE(email_verified_at, NOW())
                 ELSE email_verified_at
               END,
               last_active_at = NOW(),
               updated_at = NOW()
           WHERE id = $3`,
          [google.sub, google.emailVerified, existing.id],
        );
        user = existing;
      } else {
        if (!hasGoogleConsent(input)) {
          throw BadRequest('Debes aceptar los Términos y la Política de Privacidad.');
        }

        const role = isAdminEmail(google.email) ? 'admin' : 'user';
        const inserted = await withTransaction(async (client) => {
          const r = await client.query<{
            id: string;
            email: string;
            is_premium: boolean;
            role: 'user' | 'admin';
            email_verified_at: Date | null;
          }>(
            `INSERT INTO users (
                email, google_sub, role, language, first_name,
                terms_accepted_at, privacy_accepted_at,
                email_verified_at, last_active_at
             )
             VALUES ($1, $2, $3, $4, $5, NOW(), NOW(), $6, NOW())
             RETURNING id, email, is_premium, role, email_verified_at`,
            [
              google.email,
              google.sub,
              role,
              input.language ?? 'es',
              google.name,
              google.emailVerified ? new Date() : null,
            ],
          );
          const u = r.rows[0];
          await client.query(
            `INSERT INTO notification_settings (user_id) VALUES ($1)
             ON CONFLICT (user_id) DO NOTHING`,
            [u.id],
          );
          return u;
        });

        // Fire-and-forget welcome email so a slow SMTP server doesn't block
        // the sign-in response. Google verifies the address for us, so this
        // is a pure welcome / thank-you rather than a verification email.
        void sendMail({
          to: inserted.email,
          ...googleWelcomeEmail({ firstName: google.name }),
        }).catch(() => undefined);

        return {
          ...(await issueTokens({
            id: inserted.id,
            email: inserted.email,
            role: inserted.role,
            isPremium: inserted.is_premium,
          })),
          user: {
            id: inserted.id,
            email: inserted.email,
            role: inserted.role,
            isPremium: inserted.is_premium,
            profileComplete: false,
            emailVerified: inserted.email_verified_at != null,
          },
        };
      }
    }

    if (user.status !== 'active') throw Unauthorized('Esta cuenta no está activa.');

    await query('UPDATE users SET last_active_at = NOW() WHERE id = $1', [user.id]);

    return buildAuthResult(user);
  },

  async verifyEmail(input: VerifyEmailInput): Promise<{ verified: boolean }> {
    const tokenHash = crypto.createHash('sha256').update(input.token).digest('hex');
    const r = await query<{
      id: string;
      user_id: string;
      used_at: Date | null;
      expires_at: Date;
    }>(
      `SELECT id, user_id, used_at, expires_at
         FROM email_verifications
         WHERE token_hash = $1`,
      [tokenHash],
    );
    const row = r.rows[0];
    if (!row || row.used_at || row.expires_at.getTime() < Date.now()) {
      throw BadRequest('El enlace de verificación no es válido o ha caducado.');
    }
    await withTransaction(async (client) => {
      await client.query(
        `UPDATE email_verifications SET used_at = NOW() WHERE id = $1`,
        [row.id],
      );
      await client.query(
        `UPDATE users SET email_verified_at = COALESCE(email_verified_at, NOW())
           WHERE id = $1`,
        [row.user_id],
      );
    });
    return { verified: true };
  },

  async resendVerification(input: ResendVerificationInput): Promise<void> {
    const r = await query<{
      id: string;
      email: string;
      first_name: string | null;
      email_verified_at: Date | null;
    }>(
      `SELECT id, email, first_name, email_verified_at FROM users WHERE email = $1`,
      [input.email.toLowerCase()],
    );
    const user = r.rows[0];
    // Always succeed (no enumeration). Skip if missing or already verified.
    if (!user || user.email_verified_at) return;
    try {
      await sendVerificationEmail(user.id, user.email, user.first_name);
    } catch {
      // best effort
    }
  },

  async refresh(input: RefreshInput): Promise<AuthTokens> {
    let payload;
    try {
      payload = verifyRefreshToken(input.refreshToken);
    } catch {
      throw Unauthorized('Tu sesión ha caducado. Inicia sesión de nuevo.');
    }

    const r = await query<{ id: string; revoked_at: Date | null }>(
      'SELECT id, revoked_at FROM refresh_tokens WHERE jti = $1',
      [payload.jti],
    );
    const stored = r.rows[0];
    if (!stored || stored.revoked_at) throw Unauthorized('Tu sesión ha caducado. Inicia sesión de nuevo.');

    const userR = await query<{
      id: string;
      email: string;
      is_premium: boolean;
      role: 'user' | 'admin';
    }>(
      `SELECT id, email, is_premium, role FROM users WHERE id = $1`,
      [payload.sub],
    );
    const user = userR.rows[0];
    if (!user) throw Unauthorized('Tu cuenta ya no existe.');

    // Rotate: revoke old, issue new
    await query('UPDATE refresh_tokens SET revoked_at = NOW() WHERE jti = $1', [
      payload.jti,
    ]);

    return issueTokens({
      id: user.id,
      email: user.email,
      role: user.role,
      isPremium: user.is_premium,
    });
  },

  async logout(refreshToken: string): Promise<void> {
    try {
      const payload = verifyRefreshToken(refreshToken);
      await query('UPDATE refresh_tokens SET revoked_at = NOW() WHERE jti = $1', [
        payload.jti,
      ]);
    } catch {
      // If invalid, treat as already logged out.
    }
  },

  async forgotPassword(input: ForgotPasswordInput): Promise<void> {
    const r = await query<{ id: string; password_hash: string | null }>(
      'SELECT id, password_hash FROM users WHERE email = $1',
      [input.email.toLowerCase()],
    );
    const user = r.rows[0];
    // Always return success to avoid email enumeration. Only send email if exists.
    if (!user || !user.password_hash) return;

    const code = generatePasswordResetCode();
    const tokenHash = crypto.createHash('sha256').update(code).digest('hex');
    const expires = new Date(Date.now() + PASSWORD_RESET_CODE_TTL_MS);

    await withTransaction(async (client) => {
      await client.query(
        `UPDATE password_resets SET used_at = NOW()
         WHERE user_id = $1 AND used_at IS NULL`,
        [user.id],
      );
      await client.query(
        `INSERT INTO password_resets (user_id, token_hash, expires_at)
         VALUES ($1, $2, $3)`,
        [user.id, tokenHash, expires],
      );
    });

    const tpl = passwordResetEmail({ firstName: null, code });
    await sendMail({
      to: input.email,
      subject: tpl.subject,
      html: tpl.html,
      text: tpl.text,
    });
  },

  async resetPassword(input: ResetPasswordInput): Promise<void> {
    if (!isStrongPassword(input.password)) {
      throw BadRequest(
        'La contraseña no es lo bastante segura. Usa al menos 8 caracteres con mayúscula, minúscula y un número.',
      );
    }
    const codeHash = crypto.createHash('sha256').update(input.code).digest('hex');

    const r = await query<{ id: string; user_id: string; used_at: Date | null; expires_at: Date }>(
      `SELECT pr.id, pr.user_id, pr.used_at, pr.expires_at
       FROM password_resets pr
       JOIN users u ON u.id = pr.user_id
       WHERE u.email = $1 AND pr.token_hash = $2 AND pr.used_at IS NULL
       ORDER BY pr.created_at DESC
       LIMIT 1`,
      [input.email.toLowerCase(), codeHash],
    );
    const row = r.rows[0];
    if (!row || row.expires_at.getTime() < Date.now()) {
      throw BadRequest('El código no es válido o ha caducado.');
    }

    const newHash = await hashPassword(input.password);
    await withTransaction(async (client) => {
      await client.query(
        `UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`,
        [newHash, row.user_id],
      );
      await client.query(`UPDATE password_resets SET used_at = NOW() WHERE id = $1`, [
        row.id,
      ]);
      // revoke all refresh tokens for safety
      await client.query(
        `UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL`,
        [row.user_id],
      );
    });
  },
};
