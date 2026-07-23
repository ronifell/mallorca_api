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

const ANDROID_PACKAGE = 'es.citasmallorca.app';
const PLAY_STORE_URL = `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE}`;

function buildEmailVerifiedDeepLink(): string {
  return `${env.app.deepLinkScheme}://email-verified`;
}

/**
 * Android Intent URL — more reliable than custom schemes when launching the
 * app from a browser / Gmail WebView after the user taps an HTTPS email link.
 */
function buildAndroidOpenAppIntent(host = 'email-verified', query = ''): string {
  const path = query ? `${host}?${query}` : host;
  return (
    `intent://${path}#Intent;` +
    `scheme=${env.app.deepLinkScheme};` +
    `package=${ANDROID_PACKAGE};` +
    `S.browser_fallback_url=${encodeURIComponent(PLAY_STORE_URL)};` +
    `end`
  );
}

function buildOpenAppPageHtml(
  deepLink: string,
  opts?: {
    title?: string;
    heading?: string;
    message?: string;
    androidIntent?: string;
  },
): string {
  const androidIntent = opts?.androidIntent ?? buildAndroidOpenAppIntent();
  const title = opts?.title ?? 'Cuenta verificada · Citas Mallorca';
  const heading = opts?.heading ?? '¡Cuenta verificada!';
  const message =
    opts?.message ??
    'Pulsa el botón para abrir Citas Mallorca. Si la app no se abre sola, usa el botón de abajo.';

  // Escape for HTML attributes
  const safeDeepLink = deepLink.replace(/"/g, '&quot;');
  const safeIntent = androidIntent.replace(/"/g, '&quot;');

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<style>
  body { margin:0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background:#F2EBE0; color:#3D2618; }
  .wrap { min-height:100vh; display:flex; align-items:center; justify-content:center; padding:24px; }
  .card { background:#fff; border-radius:24px; padding:32px 28px; max-width:420px; width:100%; box-shadow:0 8px 24px rgba(58,32,18,0.08); text-align:center; border:1px solid #E9DECE; }
  .logo { font-family: Georgia, serif; font-size:22px; }
  .logo span { color:#E8554E; }
  h1 { font-size:22px; margin:18px 0 6px; }
  p { color:#7A5640; line-height:22px; }
  .ok { width:64px; height:64px; border-radius:32px; background:#FEF0EE; display:inline-flex; align-items:center; justify-content:center; color:#E8554E; font-size:30px; font-weight:700; margin:8px 0 12px; }
  .btn { display:inline-block; margin-top:18px; padding:16px 28px; background:#E8554E; color:#fff !important; font-weight:700; text-decoration:none; border-radius:999px; font-size:16px; }
  .btn-secondary { display:inline-block; margin-top:12px; padding:12px 22px; background:#fff; color:#E8554E !important; font-weight:700; text-decoration:none; border-radius:999px; font-size:14px; border:2px solid #E8554E; }
  .hint { font-size:13px; margin-top:16px; color:#7A5640; }
</style>
<script>
  (function () {
    var isAndroid = /Android/i.test(navigator.userAgent);
    var intentUrl = ${JSON.stringify(androidIntent)};
    var deepLink = ${JSON.stringify(deepLink)};
    function openApp() {
      try {
        window.location.href = isAndroid ? intentUrl : deepLink;
      } catch (e) {}
    }
    // Auto-open as soon as the page loads (works in Chrome / many mail apps).
    setTimeout(openApp, 250);
    // Retry once — some WebViews need a second kick after paint.
    setTimeout(openApp, 900);
  })();
</script>
</head>
<body><div class="wrap"><div class="card">
  <div class="logo">Citas <span>Mallorca</span></div>
  <div class="ok">✓</div>
  <h1>${heading}</h1>
  <p>${message}</p>
  <a class="btn" id="open-btn" href="${safeIntent}">Abrir la app</a>
  <br />
  <a class="btn-secondary" href="${safeDeepLink}">Abrir con enlace directo</a>
  <p class="hint">Si no tienes la app instalada, <a href="${PLAY_STORE_URL}" style="color:#E8554E;">descárgala en Google Play</a>.</p>
</div></div>
<script>
  document.getElementById('open-btn').addEventListener('click', function (e) {
    // Keep default Intent navigation; also try deep link as backup.
    setTimeout(function () {
      try { window.location.href = ${JSON.stringify(deepLink)}; } catch (err) {}
    }, 600);
  });
</script>
</body></html>`;
}

function buildVerifiedPageHtml(deepLink: string): string {
  return buildOpenAppPageHtml(deepLink, {
    androidIntent: buildAndroidOpenAppIntent('email-verified'),
  });
}

function buildInvalidTokenPageHtml(): string {
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Enlace no válido · Citas Mallorca</title>
<style>
  body { margin:0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background:#F2EBE0; color:#3D2618; }
  .wrap { min-height:100vh; display:flex; align-items:center; justify-content:center; padding:24px; }
  .card { background:#fff; border-radius:24px; padding:32px 28px; max-width:420px; width:100%; box-shadow:0 8px 24px rgba(58,32,18,0.08); text-align:center; border:1px solid #E9DECE; }
  .logo { font-family: Georgia, serif; font-size:22px; }
  .logo span { color:#E8554E; }
  h1 { font-size:22px; margin:18px 0 6px; }
  p { color:#7A5640; line-height:22px; }
  .ok { width:64px; height:64px; border-radius:32px; background:#FEF0EE; display:inline-flex; align-items:center; justify-content:center; color:#E8554E; font-size:30px; font-weight:700; margin:8px 0 12px; }
  .btn { display:inline-block; margin-top:18px; padding:16px 28px; background:#E8554E; color:#fff !important; font-weight:700; text-decoration:none; border-radius:999px; font-size:16px; }
</style>
</head>
<body><div class="wrap"><div class="card">
  <div class="logo">Citas <span>Mallorca</span></div>
  <div class="ok">!</div>
  <h1>Enlace no válido</h1>
  <p>El enlace ha caducado o ya se ha utilizado. Solicita uno nuevo desde la app.</p>
  <a class="btn" href="${buildAndroidOpenAppIntent().replace(/"/g, '&quot;')}">Abrir la app</a>
</div></div></body></html>`;
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
   * Verifies the account, then returns an HTML bridge that launches the app
   * via Android Intent (custom schemes are blocked by most email clients).
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
      res.type('html').send(
        buildOpenAppPageHtml(buildEmailVerifiedDeepLink(), {
          title: 'Cuenta verificada · Citas Mallorca',
          heading: '¡Cuenta verificada!',
          message: 'Tu cuenta está confirmada. Abriendo Citas Mallorca…',
          androidIntent: buildAndroidOpenAppIntent('email-verified'),
        }),
      );
    }
  },

  async resendVerification(req: Request, res: Response) {
    const data = resendVerificationSchema.parse(req.body);
    await authService.resendVerification(data);
    res.status(204).send();
  },

  /**
   * GET /auth/open-app
   * HTTPS landing page for welcome emails. Email clients only allow https
   * links reliably; this page then launches the installed Android app.
   */
  async openApp(_req: Request, res: Response) {
    res.type('html').send(
      buildOpenAppPageHtml(buildEmailVerifiedDeepLink(), {
        title: 'Bienvenido · Citas Mallorca',
        heading: '¡Bienvenido a Citas Mallorca!',
        message: 'Abriendo la app para continuar…',
        androidIntent: buildAndroidOpenAppIntent('email-verified'),
      }),
    );
  },
};
