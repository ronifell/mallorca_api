import { Request, Response } from 'express';
import { authService } from './auth.service';
import {
  forgotPasswordSchema,
  loginSchema,
  refreshSchema,
  registerSchema,
  resendVerificationSchema,
  resetPasswordSchema,
  verifyEmailSchema,
} from './auth.schemas';

const VERIFIED_PAGE_HTML = `<!doctype html>
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
</style>
</head>
<body><div class="wrap"><div class="card">
  <div class="logo">Citas <span>Mallorca</span></div>
  <div class="ok">✓</div>
  <h1>¡Cuenta verificada!</h1>
  <p>Ya puedes volver a la app y empezar a conectar con la comunidad de Citas Mallorca.</p>
  <p style="font-size:13px;margin-top:18px">Your account has been verified. You can return to the app and start connecting.</p>
</div></div></body></html>`;

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
        res.status(400).type('html').send(
          VERIFIED_PAGE_HTML.replace('¡Cuenta verificada!', 'Enlace no válido')
            .replace(
              'Ya puedes volver a la app y empezar a conectar con la comunidad de Citas Mallorca.',
              'El enlace ha caducado o ya se ha utilizado. Solicita uno nuevo desde la app.',
            )
            .replace(
              'Your account has been verified. You can return to the app and start connecting.',
              'This link has expired or has already been used. Request a new one from the app.',
            )
            .replace('✓', '!'),
        );
      }
      return;
    }

    const accepts = (req.headers.accept ?? '').toString();
    if (accepts.includes('application/json')) {
      res.json({ verified: true });
    } else {
      res.type('html').send(VERIFIED_PAGE_HTML);
    }
  },

  async resendVerification(req: Request, res: Response) {
    const data = resendVerificationSchema.parse(req.body);
    await authService.resendVerification(data);
    res.status(204).send();
  },
};
