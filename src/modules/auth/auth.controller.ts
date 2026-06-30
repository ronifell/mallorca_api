import { Request, Response } from 'express';
import { env } from '../../config/env';
import { authService } from './auth.service';
import {
  forgotPasswordSchema,
  googleLoginSchema,
  loginSchema,
  refreshSchema,
  registerSchema,
  resendVerificationSchema,
  resetPasswordSchema,
  verifyEmailSchema,
} from './auth.schemas';

function buildEmailVerifiedDeepLink(): string {
  return `${env.app.deepLinkScheme}://email-verified`;
}

function buildAndroidEmailVerifiedIntent(): string {
  return `intent://email-verified#Intent;scheme=${env.app.deepLinkScheme};package=es.citasmallorca.app;end`;
}

function buildVerifiedPageHtml(deepLink: string): string {
  const safeLink = deepLink.replace(/"/g, '&quot;');
  const androidIntent = buildAndroidEmailVerifiedIntent().replace(/"/g, '&quot;');
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Cuenta verificada · Citas Mallorca</title>
<style>
  body { margin:0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background:#F2EBE0; color:#3D2618; }
  .wrap { min-height:100vh; display:flex; align-items:center; justify-content:center; padding:24px; }
  .card { background:#fff; border-radius:24px; padding:32px 28px; max-width:420px; width:100%; box-shadow:0 8px 24px rgba(58,32,18,0.08); text-align:center; border:1px solid #E9DECE; }
  .logo { font-family: Georgia, serif; font-size:22px; }
  .logo span { color:#E8554E; }
  h1 { font-size:22px; margin:18px 0 6px; }
  p { color:#7A5640; line-height:22px; }
  .ok { width:64px; height:64px; border-radius:32px; background:#FEF0EE; display:inline-flex; align-items:center; justify-content:center; color:#E8554E; font-size:30px; font-weight:700; margin:8px 0 12px; }
  .btn { display:inline-block; margin-top:18px; padding:14px 26px; background:#E8554E; color:#fff; font-weight:700; text-decoration:none; border-radius:999px; font-size:15px; }
  .hint { font-size:13px; margin-top:14px; color:#7A5640; }
</style>
<script>
  (function () {
    var appLink = ${JSON.stringify(deepLink)};
    var androidIntent = ${JSON.stringify(buildAndroidEmailVerifiedIntent())};
    var target = /Android/i.test(navigator.userAgent) ? androidIntent : appLink;
    setTimeout(function () {
      window.location.replace(target);
    }, 400);
  })();
</script>
</head>
<body><div class="wrap"><div class="card">
  <div class="logo">Citas <span>Mallorca</span></div>
  <div class="ok">✓</div>
  <h1>¡Cuenta verificada!</h1>
  <p>Abriendo la app para continuar con tu perfil…</p>
  <p class="hint">Opening the app so you can continue setting up your profile…</p>
  <a class="btn" href="${safeLink}">Abrir la app · Open app</a>
  <p class="hint"><a href="${androidIntent}" style="color:#E8554E;text-decoration:none;">Android: abrir app</a></p>
</div></div></body></html>`;
}

function buildInvalidTokenPageHtml(): string {
  return buildVerifiedPageHtml(buildEmailVerifiedDeepLink())
    .replace('¡Cuenta verificada!', 'Enlace no válido')
    .replace(
      'Abriendo la app para continuar con tu perfil…',
      'El enlace ha caducado o ya se ha utilizado. Solicita uno nuevo desde la app.',
    )
    .replace(
      'Opening the app so you can continue setting up your profile…',
      'This link has expired or has already been used. Request a new one from the app.',
    )
    .replace('✓', '!')
    .replace(/<meta http-equiv="refresh"[^>]+>/, '')
    .replace(/<script>[\s\S]*?<\/script>/, '')
    .replace(/<a class="btn"[^>]*>[\s\S]*?<\/a>/, '');
}

export const authController = {
  async register(req: Request, res: Response) {
    const data = registerSchema.parse(req.body);
    const result = await authService.register(data);
    res.status(201).json(result);
  },

  async login(req: Request, res: Response) {
    const data = loginSchema.parse(req.body);
    const result = await authService.login(data);
    res.json(result);
  },

  async googleLogin(req: Request, res: Response) {
    const data = googleLoginSchema.parse(req.body);
    const result = await authService.loginWithGoogle(data);
    res.json(result);
  },

  async refresh(req: Request, res: Response) {
    const data = refreshSchema.parse(req.body);
    const tokens = await authService.refresh(data);
    res.json(tokens);
  },

  async logout(req: Request, res: Response) {
    const data = refreshSchema.parse(req.body);
    await authService.logout(data.refreshToken);
    res.status(204).send();
  },

  async forgotPassword(req: Request, res: Response) {
    const data = forgotPasswordSchema.parse(req.body);
    await authService.forgotPassword(data);
    // Always 204 to prevent email enumeration.
    res.status(204).send();
  },

  async resetPassword(req: Request, res: Response) {
    const data = resetPasswordSchema.parse(req.body);
    await authService.resetPassword(data);
    res.status(204).send();
  },

  /**
   * GET /auth/verify-email?token=...
   * Returns a friendly HTML page so the user can simply tap the link in
   * their inbox and see a confirmation. JSON is returned only when the
   * client explicitly asks for it (Accept: application/json).
   */
  async verifyEmail(req: Request, res: Response) {
    const token = String(req.query.token ?? req.body?.token ?? '');
    const data = verifyEmailSchema.parse({ token });
    try {
      await authService.verifyEmail(data);
    } catch (e) {
      const accepts = (req.headers.accept ?? '').toString();
      if (accepts.includes('application/json')) {
        res.status(400).json({ error: { code: 'BAD_REQUEST', message: (e as Error).message } });
      } else {
        res.status(400).type('html').send(buildInvalidTokenPageHtml());
      }
      return;
    }

    const accepts = (req.headers.accept ?? '').toString();
    if (accepts.includes('application/json')) {
      res.json({ verified: true, deepLink: buildEmailVerifiedDeepLink() });
    } else {
      res.type('html').send(buildVerifiedPageHtml(buildEmailVerifiedDeepLink()));
    }
  },

  async resendVerification(req: Request, res: Response) {
    const data = resendVerificationSchema.parse(req.body);
    await authService.resendVerification(data);
    res.status(204).send();
  },
};
