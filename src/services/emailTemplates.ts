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
  verifyUrl: string;
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

function shell(innerHtml: string): string {
  return `<!doctype html>
<html lang="es">
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
              <p style="margin:6px 0 0 0;">¿Necesitas ayuda? Escríbenos a <a href="mailto:${OFFICIAL_EMAIL}" style="color:${BRAND.coral};text-decoration:none;">${OFFICIAL_EMAIL}</a></p>
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
  const greetingEs = vars.firstName ? `¡Hola, ${escape(vars.firstName)}!` : '¡Hola!';
  const greetingEn = vars.firstName ? `Hi ${escape(vars.firstName)}!` : 'Hello!';
  const safeUrl = escape(vars.verifyUrl);

  const inner = `
    <h1 style="margin:0 0 12px 0;font-family:'Georgia',serif;font-size:24px;color:${BRAND.ink};">${greetingEs}</h1>
    <p style="margin:0 0 14px 0;font-size:15px;line-height:22px;color:${BRAND.ink};">
      Bienvenido a la comunidad de <strong>Citas Mallorca</strong>. Nos alegra
      tenerte aquí. Pulsa el botón para confirmar tu perfil y empezar a
      conectar con otras personas.
    </p>
    <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:20px 0;">
      <tr>
        <td align="center">
          <table cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td align="center" bgcolor="${BRAND.coral}" style="border-radius:999px;">
                <a href="${safeUrl}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:16px 36px;color:${BRAND.white};font-weight:700;text-decoration:none;font-size:16px;line-height:22px;border-radius:999px;min-width:240px;text-align:center;mso-padding-alt:16px 36px;">
                  Confirmar mi cuenta
                </a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
    <p style="margin:0 0 10px 0;font-size:13px;color:${BRAND.inkSoft};">
      Si el botón no funciona, copia y pega este enlace en tu navegador:<br />
      <a href="${safeUrl}" target="_blank" rel="noopener noreferrer" style="color:${BRAND.coral};word-break:break-all;">${safeUrl}</a>
    </p>
    <hr style="border:none;border-top:1px solid ${BRAND.border};margin:24px 0;" />
    <h2 style="margin:0 0 8px 0;font-size:16px;color:${BRAND.ink};">${greetingEn}</h2>
    <p style="margin:0 0 12px 0;font-size:14px;line-height:21px;color:${BRAND.ink};">
      Welcome to the <strong>Citas Mallorca</strong> community. We're glad to
      have you here. Click the link above to confirm your profile and start
      connecting with others.
    </p>
    <p style="margin:18px 0 0 0;font-size:12px;color:${BRAND.inkSoft};">
      Si no has creado esta cuenta puedes ignorar este mensaje. /
      If you didn't create this account you can safely ignore this email.
    </p>
  `;

  return {
    subject: 'Confirma tu cuenta · Citas Mallorca',
    html: shell(inner),
    text:
      `${greetingEs}\n\nBienvenido a la comunidad de Citas Mallorca. ` +
      `Nos alegra tenerte aquí. Pulsa el siguiente enlace para confirmar tu ` +
      `perfil y empezar a conectar con otras personas:\n\n${vars.verifyUrl}\n\n` +
      `${greetingEn}\nWelcome to the Citas Mallorca community. We're glad to ` +
      `have you here. Click the link above to confirm your profile and start ` +
      `connecting with others.\n\nwww.citasmallorca.es`,
  };
}

export function passwordResetEmail(vars: { firstName?: string | null; code: string }): {
  subject: string;
  html: string;
  text: string;
} {
  const greetingEs = vars.firstName ? `¡Hola, ${escape(vars.firstName)}!` : '¡Hola!';
  const safeCode = escape(vars.code);
  const inner = `
    <h1 style="margin:0 0 12px 0;font-family:'Georgia',serif;font-size:24px;color:${BRAND.ink};">${greetingEs}</h1>
    <p style="margin:0 0 14px 0;font-size:15px;line-height:22px;color:${BRAND.ink};">
      Hemos recibido una solicitud para restablecer tu contraseña en Citas
      Mallorca. Introduce este código en la app. Caduca en 15 minutos.
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
    <hr style="border:none;border-top:1px solid ${BRAND.border};margin:24px 0;" />
    <p style="margin:0 0 12px 0;font-size:14px;line-height:21px;color:${BRAND.ink};">
      We received a request to reset your password. Enter this code in the app.
      It expires in 15 minutes. If it wasn't you, please ignore this email.
    </p>
  `;
  return {
    subject: 'Restablece tu contraseña · Citas Mallorca',
    html: shell(inner),
    text:
      `${greetingEs}\n\nHemos recibido una solicitud para restablecer tu ` +
      `contraseña. Introduce este código en la app. Caduca en 15 minutos.\n\n` +
      `Código / Code: ${vars.code}\n\n` +
      `If you did not request this, ignore this email.`,
  };
}
