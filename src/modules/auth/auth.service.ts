import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { query, withTransaction } from '../../config/database';
import { env } from '../../config/env';
import { sendMail } from '../../services/mailer';
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
  LoginInput,
  RefreshInput,
  RegisterInput,
  ResetPasswordInput,
} from './auth.schemas';

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
  };
}

function isAdminEmail(email: string): boolean {
  return env.admin.emails.includes(email.toLowerCase());
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
        'Password must be at least 8 characters with upper, lower and a digit',
      );
    }

    const existing = await query<{ id: string }>(
      'SELECT id FROM users WHERE email = $1',
      [input.email.toLowerCase()],
    );
    if (existing.rowCount && existing.rowCount > 0) {
      throw Conflict('Email is already registered');
    }

    const hash = await hashPassword(input.password);
    const role = isAdminEmail(input.email) ? 'admin' : 'user';

    const inserted = await withTransaction(async (client) => {
      const r = await client.query<{ id: string; email: string }>(
        `INSERT INTO users (email, password_hash, role, language)
         VALUES ($1, $2, $3, $4) RETURNING id, email`,
        [input.email.toLowerCase(), hash, role, input.language ?? 'en'],
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

    return {
      ...tokens,
      user: {
        id: inserted.id,
        email: inserted.email,
        role,
        isPremium: false,
        profileComplete: false,
      },
    };
  },

  async login(input: LoginInput): Promise<AuthResult> {
    const r = await query<{
      id: string;
      email: string;
      password_hash: string;
      is_premium: boolean;
      role: 'user' | 'admin';
      status: string;
    }>(
      `SELECT id, email, password_hash, is_premium, role, status
       FROM users WHERE email = $1`,
      [input.email.toLowerCase()],
    );
    const user = r.rows[0];
    if (!user) throw Unauthorized('Invalid credentials');
    if (user.status !== 'active') throw Unauthorized('Account is not active');

    const ok = await verifyPassword(input.password, user.password_hash);
    if (!ok) throw Unauthorized('Invalid credentials');

    await query('UPDATE users SET last_active_at = NOW() WHERE id = $1', [user.id]);

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
      },
    };
  },

  async refresh(input: RefreshInput): Promise<AuthTokens> {
    let payload;
    try {
      payload = verifyRefreshToken(input.refreshToken);
    } catch {
      throw Unauthorized('Invalid or expired refresh token');
    }

    const r = await query<{ id: string; revoked_at: Date | null }>(
      'SELECT id, revoked_at FROM refresh_tokens WHERE jti = $1',
      [payload.jti],
    );
    const stored = r.rows[0];
    if (!stored || stored.revoked_at) throw Unauthorized('Refresh token revoked');

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
    if (!user) throw Unauthorized('User no longer exists');

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
    const r = await query<{ id: string }>('SELECT id FROM users WHERE email = $1', [
      input.email.toLowerCase(),
    ]);
    const user = r.rows[0];
    // Always return success to avoid email enumeration. Only send email if exists.
    if (!user) return;

    const raw = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(raw).digest('hex');
    const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await query(
      `INSERT INTO password_resets (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3)`,
      [user.id, tokenHash, expires],
    );

    const resetUrl = `${env.apiBaseUrl.replace(/\/$/, '')}/reset-password?token=${raw}`;
    await sendMail({
      to: input.email,
      subject: 'Restablece tu contraseña / Reset your password',
      html: `
        <p>Hola,</p>
        <p>Hemos recibido una solicitud para restablecer tu contraseña en Citas Mallorca.</p>
        <p><a href="${resetUrl}">Restablecer contraseña</a></p>
        <p>Este enlace caduca en 1 hora.</p>
        <hr/>
        <p>Hello,</p>
        <p>We received a request to reset your Citas Mallorca password.</p>
        <p><a href="${resetUrl}">Reset password</a></p>
        <p>This link expires in 1 hour.</p>
      `,
    });
  },

  async resetPassword(input: ResetPasswordInput): Promise<void> {
    if (!isStrongPassword(input.password)) {
      throw BadRequest('Password is not strong enough');
    }
    const tokenHash = crypto.createHash('sha256').update(input.token).digest('hex');

    const r = await query<{ id: string; user_id: string; used_at: Date | null; expires_at: Date }>(
      `SELECT id, user_id, used_at, expires_at
       FROM password_resets
       WHERE token_hash = $1`,
      [tokenHash],
    );
    const row = r.rows[0];
    if (!row || row.used_at || row.expires_at.getTime() < Date.now()) {
      throw BadRequest('Invalid or expired token');
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
