/**
 * Branded email templates for Citas Mallorca.
 *
 * Bilingual (Spanish + English) HTML, mobile-friendly inline styles, brand
 * palette pulled from the marketing site. All templates accept the user's
 * first name (optional) and the action URL.
 */

/** Official outbound / support address shown in all transactional emails. */
const OFFICIAL_EMAIL = 'info@citasmallorca.es';

const BRAND = {
  background: '#F2EBE0',
  surface: '#FFFFFF',
  border: '#E9DECE',
  ink: '#3D2618',
  inkSoft: '#7A5640',
  coral: '#E8554E',
  coralSoft: '#FEF0EE',
  brand: '#B82E2E',
  white: '#FFFFFF',
};

interface VerifyEmailVars {
  firstName?: string | null;
  language?: string | null;
  /** HTTPS CTA — required; email clients block custom schemes. */
  verifyUrl: string;
  /** Custom-scheme deep link kept for text clients / future use. */
  appVerifyUrl: string;
}

function escape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#39;';
      default: return c;
    }
  });
}

type EmailLang = 'en' | 'es';

function resolveEmailLang(language?: string | null): EmailLang {
  if (typeof language === 'string' && language.toLowerCase().startsWith('en')) return 'en';
  return 'es';
}

function shell(innerHtml: string, lang: EmailLang, opts?: { disclaimer?: string | null }): string {
  const footer =
    lang === 'en'
      ? {
          help: `Need help? Email us at <a href="mailto:${OFFICIAL_EMAIL}" style="color:${BRAND.coral};text-decoration:none;">${OFFICIAL_EMAIL}</a>`,
          disclaimer: 'If you did not create this account you can safely ignore this email.',
        }
      : {
          help: `¿Necesitas ayuda? Escríbenos a <a href="mailto:${OFFICIAL_EMAIL}" style="color:${BRAND.coral};text-decoration:none;">${OFFICIAL_EMAIL}</a>`,
          disclaimer: 'Si no has creado esta cuenta puedes ignorar este mensaje.',
        };
  const disclaimer =
    opts?.disclaimer === null ? null : opts?.disclaimer ?? footer.disclaimer;
  const disclaimerHtml = disclaimer
    ? `<p style="margin:10px 0 0 0;">${disclaimer}</p>`
    : '';
  return `<!doctype html>
<html lang="${lang}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Citas Mallorca</title>
  </head>
  <body style="margin:0;padding:0;background:${BRAND.background};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${BRAND.ink};">
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.background};padding:32px 16px;">
      <tr><td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:${BRAND.surface};border-radius:20px;overflow:hidden;border:1px solid ${BRAND.border};box-shadow:0 4px 18px rgba(58,32,18,0.08);">
          <tr>
            <td align="center" style="background:${BRAND.brand};padding:28px 24px;">
              <div style="display:inline-block;background:${BRAND.surface};border-radius:24px;padding:8px 18px;">
                <span style="font-family:'Georgia',serif;font-size:22px;color:${BRAND.ink};">Citas</span>
                <span style="font-family:'Georgia',serif;font-size:22px;color:${BRAND.coral};">&nbsp;Mallorca</span>
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 32px 16px 32px;">
              ${innerHtml}
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:8px 24px 24px 24px;color:${BRAND.inkSoft};font-size:12px;line-height:18px;">
              <p style="margin:0;">Citas Mallorca · <a href="https://www.citasmallorca.es" style="color:${BRAND.coral};text-decoration:none;">www.citasmallorca.es</a></p>
              <p style="margin:6px 0 0 0;">${footer.help}</p>
              ${disclaimerHtml}
            </td>
          </tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

export function welcomeVerificationEmail(vars: VerifyEmailVars): {
  subject: string;
  html: string;
  text: string;
} {
  const lang = resolveEmailLang(vars.language);
  const name = vars.firstName?.trim() || null;
  const ctaUrl = escape(vars.verifyUrl);

  if (lang === 'en') {
    const greeting = name ? `Hi ${escape(name)},` : 'Hello,';
    const inner = `
    <h1 style="margin:0 0 12px 0;font-family:'Georgia',serif;font-size:24px;color:${BRAND.ink};">${greeting}</h1>
    <p style="margin:0 0 14px 0;font-size:15px;line-height:22px;color:${BRAND.ink};">
      Welcome to the <strong>Citas Mallorca</strong> community. We're glad to have you here.
      Tap the button below to confirm your account and open the app.
    </p>
    <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:20px 0;">
      <tr>
        <td align="center">
          <table cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td align="center" bgcolor="${BRAND.coral}" style="border-radius:999px;">
                <a href="${ctaUrl}" style="display:inline-block;padding:16px 36px;color:${BRAND.white};font-weight:700;text-decoration:none;font-size:16px;line-height:22px;border-radius:999px;min-width:240px;text-align:center;mso-padding-alt:16px 36px;">
                  Open the app
                </a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
    <p style="margin:0 0 10px 0;font-size:13px;color:${BRAND.inkSoft};">
      If the button does not work, copy and paste this link into your phone browser:<br />
      <a href="${ctaUrl}" style="color:${BRAND.coral};word-break:break-all;">${ctaUrl}</a>
    </p>
  `;
    return {
      subject: 'Confirm your account · Citas Mallorca',
      html: shell(inner, 'en'),
      text:
        `${greeting}\n\nWelcome to the Citas Mallorca community. ` +
        `Tap this link on your phone to confirm your account and open the app:\n\n` +
        `${vars.verifyUrl}\n\n` +
        `If you did not create this account you can safely ignore this email.\n\n` +
        `Need help? Email us at ${OFFICIAL_EMAIL}`,
    };
  }

  const greeting = name ? `¡Hola, ${escape(name)}!` : '¡Hola!';
  const inner = `
    <h1 style="margin:0 0 12px 0;font-family:'Georgia',serif;font-size:24px;color:${BRAND.ink};">${greeting}</h1>
    <p style="margin:0 0 14px 0;font-size:15px;line-height:22px;color:${BRAND.ink};">
      Bienvenido a la comunidad de <strong>Citas Mallorca</strong>. Nos alegra
      tenerte aquí. Pulsa el botón para confirmar tu cuenta y abrir la app.
    </p>
    <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:20px 0;">
      <tr>
        <td align="center">
          <table cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td align="center" bgcolor="${BRAND.coral}" style="border-radius:999px;">
                <a href="${ctaUrl}" style="display:inline-block;padding:16px 36px;color:${BRAND.white};font-weight:700;text-decoration:none;font-size:16px;line-height:22px;border-radius:999px;min-width:240px;text-align:center;mso-padding-alt:16px 36px;">
                  Abrir la app
                </a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
    <p style="margin:0 0 10px 0;font-size:13px;color:${BRAND.inkSoft};">
      Si el botón no funciona, copia y pega este enlace en el navegador del teléfono:<br />
      <a href="${ctaUrl}" style="color:${BRAND.coral};word-break:break-all;">${ctaUrl}</a>
    </p>
  `;

  return {
    subject: 'Confirma tu cuenta · Citas Mallorca',
    html: shell(inner, 'es'),
    text:
      `${greeting}\n\nBienvenido a la comunidad de Citas Mallorca. ` +
      `Pulsa este enlace en tu teléfono para confirmar tu cuenta y abrir la app:\n\n` +
      `${vars.verifyUrl}\n\n` +
      `Si no has creado esta cuenta puedes ignorar este mensaje.\n\n` +
      `¿Necesitas ayuda? Escríbenos a ${OFFICIAL_EMAIL}`,
  };
}

/**
 * Sent once, right after a user creates an account via "Continuar con Google".
 * Google verifies the email address for us so no verification link is needed —
 * this is a pure welcome / thank-you message.
 *
 * `openAppUrl` MUST be an HTTPS URL. Email clients block citasmallorca:// links;
 * the HTTPS page launches the installed Android app via Intent.
 */
export function googleWelcomeEmail(vars: {
  firstName?: string | null;
  openAppUrl: string;
}): {
  subject: string;
  html: string;
  text: string;
} {
  const greetingEs = vars.firstName ? `¡Hola, ${escape(vars.firstName)}!` : '¡Hola!';
  const ctaUrl = escape(vars.openAppUrl);
  const inner = `
    <h1 style="margin:0 0 12px 0;font-family:'Georgia',serif;font-size:24px;color:${BRAND.ink};">${greetingEs}</h1>
    <p style="margin:0 0 14px 0;font-size:15px;line-height:22px;color:${BRAND.ink};">
      ¡Bienvenido a <strong>Citas Mallorca</strong>! Tu cuenta se ha creado
      correctamente al conectarte con Google. A partir de ahora podrás iniciar
      sesión simplemente pulsando el botón <strong>«Continuar con Google»</strong>.
    </p>
    <p style="margin:0 0 14px 0;font-size:15px;line-height:22px;color:${BRAND.ink};">
      Nos alegra tenerte aquí. Completa tu perfil, añade tus fotos y empieza a
      descubrir gente con las mismas ganas de disfrutar de la isla.
    </p>
    <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:20px 0;">
      <tr>
        <td align="center">
          <table cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td align="center" bgcolor="${BRAND.coral}" style="border-radius:999px;">
                <a href="${ctaUrl}" style="display:inline-block;padding:16px 36px;color:${BRAND.white};font-weight:700;text-decoration:none;font-size:16px;line-height:22px;border-radius:999px;min-width:240px;text-align:center;">
                  Abrir la app
                </a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
    <p style="margin:0 0 10px 0;font-size:13px;color:${BRAND.inkSoft};">
      Si el botón no funciona, copia y pega este enlace en el navegador del teléfono:<br />
      <a href="${ctaUrl}" style="color:${BRAND.coral};word-break:break-all;">${ctaUrl}</a>
    </p>
    <p style="margin:18px 0 0 0;font-size:13px;color:${BRAND.inkSoft};">
      ¿Preguntas? Escríbenos a
      <a href="mailto:${OFFICIAL_EMAIL}" style="color:${BRAND.coral};text-decoration:none;">${OFFICIAL_EMAIL}</a>
      y estaremos encantados de ayudarte.
    </p>
  `;
  return {
    subject: '¡Bienvenido a Citas Mallorca!',
    html: shell(inner, 'es'),
    text:
      `${greetingEs}\n\n` +
      `¡Bienvenido a Citas Mallorca! Tu cuenta se ha creado correctamente al ` +
      `conectarte con Google.\n\n` +
      `Abre la app desde tu teléfono:\n${vars.openAppUrl}`,
  };
}

/**
 * Sent when a user successfully activates a Premium subscription (either
 * monthly or annual). Content: short thank-you, restating that Premium is
 * active — no call-to-action, this is a confirmation email.
 */
export function premiumWelcomeEmail(vars: {
  firstName?: string | null;
  language?: string | null;
  plan?: 'monthly_premium' | 'annual_premium' | null;
  expiryDate?: Date | null;
}): {
  subject: string;
  html: string;
  text: string;
} {
  const lang = resolveEmailLang(vars.language);
  const name = vars.firstName?.trim() || null;
  const locale = lang === 'en' ? 'en-GB' : 'es-ES';
  const planLabel =
    vars.plan === 'annual_premium'
      ? lang === 'en'
        ? 'Annual Premium'
        : 'Premium Anual'
      : vars.plan === 'monthly_premium'
        ? lang === 'en'
          ? 'Monthly Premium'
          : 'Premium Mensual'
        : 'Premium';
  const expiryLine = vars.expiryDate
    ? lang === 'en'
      ? `<p style="margin:0 0 14px 0;font-size:14px;color:${BRAND.inkSoft};">Renewal / expiry: <strong>${escape(
          vars.expiryDate.toLocaleDateString('en-GB', {
            day: '2-digit',
            month: 'long',
            year: 'numeric',
          }),
        )}</strong>.</p>`
      : `<p style="margin:0 0 14px 0;font-size:14px;color:${BRAND.inkSoft};">Renovación / caducidad: <strong>${escape(
          vars.expiryDate.toLocaleDateString('es-ES', {
            day: '2-digit',
            month: 'long',
            year: 'numeric',
          }),
        )}</strong>.</p>`
    : '';

  if (lang === 'en') {
    const greeting = name ? `Hi ${escape(name)},` : 'Hello,';
    const inner = `
    <h1 style="margin:0 0 12px 0;font-family:'Georgia',serif;font-size:24px;color:${BRAND.ink};">${greeting}</h1>
    <p style="margin:0 0 14px 0;font-size:15px;line-height:22px;color:${BRAND.ink};">
      Thank you for using <strong>Citas Mallorca</strong>! Your
      <strong>${escape(planLabel)}</strong> subscription is now active.
      We hope you have a wonderful experience and make a special connection.
      Thank you for being part of our community.
    </p>
    <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:20px 0;">
      <tr>
        <td align="center" style="background:${BRAND.coralSoft};border-radius:16px;padding:20px 24px;border:1px solid ${BRAND.border};">
          <p style="margin:0 0 6px 0;font-size:13px;color:${BRAND.inkSoft};letter-spacing:0.4px;">Your plan</p>
          <p style="margin:0;font-size:22px;font-weight:700;color:${BRAND.ink};">${escape(planLabel)}</p>
        </td>
      </tr>
    </table>
    ${expiryLine}
    <p style="margin:0 0 12px 0;font-size:13px;color:${BRAND.inkSoft};">
      You can manage or cancel your subscription at any time from your Google Play account.
    </p>
  `;
    const expiryText = vars.expiryDate
      ? `Renewal / expiry: ${vars.expiryDate.toLocaleDateString(locale)}\n\n`
      : '';
    return {
      subject: 'Your Premium is active! · Citas Mallorca',
      html: shell(inner, 'en', { disclaimer: null }),
      text:
        `${greeting}\n\n` +
        `Thank you for using Citas Mallorca! Your ${planLabel} subscription is now active. ` +
        `We hope you have a wonderful experience and make a special connection. ` +
        `Thank you for being part of our community.\n\n` +
        expiryText +
        `You can manage or cancel your subscription at any time from your Google Play account.\n\n` +
        `Need help? Email us at ${OFFICIAL_EMAIL}`,
    };
  }

  const greeting = name ? `¡Hola, ${escape(name)}!` : '¡Hola!';
  const inner = `
    <h1 style="margin:0 0 12px 0;font-family:'Georgia',serif;font-size:24px;color:${BRAND.ink};">${greeting}</h1>
    <p style="margin:0 0 14px 0;font-size:15px;line-height:22px;color:${BRAND.ink};">
      ¡Gracias por usar <strong>Citas Mallorca</strong>! Tu suscripción
      <strong>${escape(planLabel)}</strong> se ha activado correctamente.
      Esperamos que tengas una experiencia maravillosa y que crees una
      conexión especial. Gracias por formar parte de nuestra comunidad.
    </p>
    <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:20px 0;">
      <tr>
        <td align="center" style="background:${BRAND.coralSoft};border-radius:16px;padding:20px 24px;border:1px solid ${BRAND.border};">
          <p style="margin:0 0 6px 0;font-size:13px;color:${BRAND.inkSoft};letter-spacing:0.4px;">Tu plan</p>
          <p style="margin:0;font-size:22px;font-weight:700;color:${BRAND.ink};">${escape(planLabel)}</p>
        </td>
      </tr>
    </table>
    ${expiryLine}
    <p style="margin:0 0 12px 0;font-size:13px;color:${BRAND.inkSoft};">
      Puedes gestionar o cancelar tu suscripción en cualquier momento desde tu
      cuenta de Google Play.
    </p>
  `;
  const expiryText = vars.expiryDate
    ? `Renovación / caducidad: ${vars.expiryDate.toLocaleDateString(locale)}\n\n`
    : '';

  return {
    subject: '¡Tu Premium está activo! · Citas Mallorca',
    html: shell(inner, 'es', { disclaimer: null }),
    text:
      `${greeting}\n\n` +
      `¡Gracias por usar Citas Mallorca! Tu suscripción ${planLabel} se ha ` +
      `activado correctamente. Esperamos que tengas una experiencia ` +
      `maravillosa y que crees una conexión especial. Gracias por formar ` +
      `parte de nuestra comunidad.\n\n` +
      expiryText +
      `Puedes gestionar o cancelar tu suscripción en cualquier momento desde ` +
      `tu cuenta de Google Play.\n\n` +
      `¿Necesitas ayuda? Escríbenos a ${OFFICIAL_EMAIL}`,
  };
}

export function passwordResetEmail(vars: {
  firstName?: string | null;
  code: string;
  language?: string | null;
}): {
  subject: string;
  html: string;
  text: string;
} {
  const lang = resolveEmailLang(vars.language);
  const name = vars.firstName?.trim() || null;
  const safeCode = escape(vars.code);

  if (lang === 'en') {
    const greeting = name ? `Hi ${escape(name)},` : 'Hi there,';
    const inner = `
    <h1 style="margin:0 0 12px 0;font-family:'Georgia',serif;font-size:24px;color:${BRAND.ink};">${greeting}</h1>
    <p style="margin:0 0 14px 0;font-size:15px;line-height:22px;color:${BRAND.ink};">
      We received a request to reset your password for <strong>Citas Mallorca</strong>.
      Enter this code in the app. It expires in 15 minutes.
    </p>
    <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:20px 0;">
      <tr>
        <td align="center" style="background:${BRAND.coralSoft};border-radius:16px;padding:20px 24px;border:1px solid ${BRAND.border};">
          <p style="margin:0 0 8px 0;font-size:13px;color:${BRAND.inkSoft};letter-spacing:0.4px;">Your verification code</p>
          <p style="margin:0;font-size:34px;font-weight:700;letter-spacing:8px;color:${BRAND.ink};font-family:monospace;">${safeCode}</p>
        </td>
      </tr>
    </table>
    <p style="margin:0 0 10px 0;font-size:13px;color:${BRAND.inkSoft};">
      If you did not request this change, you can ignore this email.
    </p>
  `;
    return {
      subject: 'Reset your password · Citas Mallorca',
      html: shell(inner, 'en'),
      text:
        `${greeting}\n\nWe received a request to reset your password for Citas Mallorca. ` +
        `Enter this code in the app. It expires in 15 minutes.\n\n` +
        `Code: ${vars.code}\n\n` +
        `If you did not request this change, you can ignore this email.`,
    };
  }

  const greeting = name ? `¡Hola, ${escape(name)}!` : '¡Hola!';
  const inner = `
    <h1 style="margin:0 0 12px 0;font-family:'Georgia',serif;font-size:24px;color:${BRAND.ink};">${greeting}</h1>
    <p style="margin:0 0 14px 0;font-size:15px;line-height:22px;color:${BRAND.ink};">
      Hemos recibido una solicitud para restablecer tu contraseña en
      <strong>Citas Mallorca</strong>. Introduce este código en la app. Caduca en 15 minutos.
    </p>
    <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:20px 0;">
      <tr>
        <td align="center" style="background:${BRAND.coralSoft};border-radius:16px;padding:20px 24px;border:1px solid ${BRAND.border};">
          <p style="margin:0 0 8px 0;font-size:13px;color:${BRAND.inkSoft};letter-spacing:0.4px;">Tu código de verificación</p>
          <p style="margin:0;font-size:34px;font-weight:700;letter-spacing:8px;color:${BRAND.ink};font-family:monospace;">${safeCode}</p>
        </td>
      </tr>
    </table>
    <p style="margin:0 0 10px 0;font-size:13px;color:${BRAND.inkSoft};">
      Si no has solicitado este cambio, puedes ignorar este correo.
    </p>
  `;
  return {
    subject: 'Restablece tu contraseña · Citas Mallorca',
    html: shell(inner, 'es'),
    text:
      `${greeting}\n\nHemos recibido una solicitud para restablecer tu ` +
      `contraseña en Citas Mallorca. Introduce este código en la app. Caduca en 15 minutos.\n\n` +
      `Código: ${vars.code}\n\n` +
      `Si no has solicitado este cambio, puedes ignorar este correo.`,
  };
}
