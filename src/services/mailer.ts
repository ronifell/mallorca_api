import nodemailer, { Transporter } from 'nodemailer';
import { env, isProd } from '../config/env';
import { logger } from '../utils/logger';

let transporter: Transporter | null = null;

/**
 * Gmail and most consumer SMTP providers reject messages when the From address
 * does not match the authenticated account. Keep the display name but use
 * SMTP_USER as the envelope sender when they differ.
 */
function resolveFromAddress(): string {
  if (env.mail.provider === 'resend' && env.mail.resendFrom) {
    return env.mail.resendFrom;
  }

  const from = env.mail.from.trim();
  const user = env.mail.user.trim();
  if (!user) return from;

  const emailInFrom = from.match(/<([^>]+)>/)?.[1] ?? from;
  if (emailInFrom.toLowerCase() === user.toLowerCase()) return from;

  const displayName = from.match(/^(.+?)\s*<[^>]+>$/)?.[1]?.trim() ?? 'Citas Mallorca';
  return `${displayName} <${user}>`;
}

function getSmtpTransporter(): Transporter {
  if (transporter) return transporter;
  if (!env.mail.host) {
    transporter = nodemailer.createTransport({ jsonTransport: true });
    return transporter;
  }

  const secure = env.mail.secure;
  transporter = nodemailer.createTransport({
    host: env.mail.host,
    port: env.mail.port,
    secure,
    requireTLS: !secure && env.mail.port === 587,
    auth: env.mail.user ? { user: env.mail.user, pass: env.mail.pass } : undefined,
    tls: { minVersion: 'TLSv1.2' },
    connectionTimeout: 20_000,
    greetingTimeout: 20_000,
    socketTimeout: 20_000,
  });
  return transporter;
}

function extractVerificationUrl(text?: string, html?: string): string | undefined {
  const haystack = `${text ?? ''} ${html ?? ''}`;
  const match = haystack.match(/https?:\/\/[^\s"'<>]+\/api\/auth\/verify-email\?token=[^\s"'<>]+/);
  return match?.[0];
}

async function sendViaResend(opts: {
  from: string;
  to: string;
  subject: string;
  html: string;
  text?: string;
}): Promise<{ messageId: string }> {
  if (!env.mail.resendApiKey) {
    throw new Error('RESEND_API_KEY is required when EMAIL_PROVIDER=resend');
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.mail.resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: opts.from,
      to: [opts.to],
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Resend API error (${response.status}): ${body}`);
  }

  const data = (await response.json()) as { id?: string };
  return { messageId: data.id ?? 'resend' };
}

export async function sendMail(opts: { to: string; subject: string; html: string; text?: string }) {
  const from = resolveFromAddress();
  const verifyUrl = extractVerificationUrl(opts.text, opts.html);

  if (env.mail.provider === 'log') {
    logger.info('Email (log mode — not sent via SMTP)', {
      to: opts.to,
      subject: opts.subject,
      from,
      verifyUrl,
      text: opts.text,
    });
    return { messageId: 'log-mode' };
  }

  if (env.mail.provider === 'resend') {
    try {
      const info = await sendViaResend({ from, ...opts });
      logger.info('Email sent via Resend', {
        to: opts.to,
        subject: opts.subject,
        messageId: info.messageId,
      });
      return info;
    } catch (err) {
      logger.error('Resend email failed', {
        to: opts.to,
        subject: opts.subject,
        from,
        verifyUrl,
        err: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  // Default: SMTP
  if (!env.mail.host) {
    logger.info('Email (dev mode, SMTP not configured)', {
      to: opts.to,
      subject: opts.subject,
      verifyUrl,
      text: opts.text,
    });
    return { messageId: 'dev-mode' };
  }

  const t = getSmtpTransporter();
  try {
    const info = await t.sendMail({
      from,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
    });
    logger.info('Email sent via SMTP', {
      to: opts.to,
      subject: opts.subject,
      messageId: info.messageId,
    });
    return info;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('SMTP email failed', {
      to: opts.to,
      subject: opts.subject,
      from,
      host: env.mail.host,
      port: env.mail.port,
      verifyUrl,
      err: message,
    });
    if (!isProd && verifyUrl) {
      logger.warn('DEV: use this verification link manually', { email: opts.to, verifyUrl });
    }
    throw err;
  }
}
