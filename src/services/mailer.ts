import nodemailer, { Transporter } from 'nodemailer';
import { env } from '../config/env';
import { logger } from '../utils/logger';

let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (transporter) return transporter;
  if (!env.mail.host) {
    // Fallback: log emails instead of sending. Useful in dev / when SMTP isn't
    // configured. Real deployments must set SMTP_* env vars.
    transporter = nodemailer.createTransport({ jsonTransport: true });
  } else {
    transporter = nodemailer.createTransport({
      host: env.mail.host,
      port: env.mail.port,
      secure: env.mail.port === 465,
      auth: env.mail.user ? { user: env.mail.user, pass: env.mail.pass } : undefined,
    });
  }
  return transporter;
}

export async function sendMail(opts: { to: string; subject: string; html: string; text?: string }) {
  const t = getTransporter();
  const info = await t.sendMail({
    from: env.mail.from,
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
    text: opts.text,
  });
  if (!env.mail.host) {
    logger.info('Email (dev mode, not sent)', { to: opts.to, subject: opts.subject });
  }
  return info;
}
