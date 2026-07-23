// Las variables de entorno, en un solo lugar y validadas al arrancar.
//
// Si falta una, quiero enterarme con un mensaje claro en los logs de Vercel,
// no con un `undefined` que revienta tres archivos más adelante.

function requerida(nombre: string): string {
  const valor = process.env[nombre]
  if (!valor) {
    throw new Error(
      `Falta la variable de entorno ${nombre}. ` +
        `Captúrala en Vercel → Project Settings → Environment Variables.`,
    )
  }
  return valor
}

export const config = {
  // ── Claude ──
  anthropicApiKey: () => requerida('ANTHROPIC_API_KEY'),

  // ── WhatsApp Cloud API ──
  // OJO: este token debe ser el PERMANENTE de un System User, no el
  // temporal de 24 horas que Meta enseña en la pantalla de API Setup.
  whatsappToken: () => requerida('WHATSAPP_TOKEN'),
  // Una cadena que tú te inventas. Meta te la va a regresar cuando
  // registres el webhook, para comprobar que el endpoint es tuyo.
  verifyToken: () => requerida('WHATSAPP_VERIFY_TOKEN'),
  // El "App Secret" de tu app en Meta. Firma cada webhook: sin esto
  // cualquiera que sepa la URL podría mandarnos mensajes falsos.
  appSecret: () => requerida('META_APP_SECRET'),

  // ── Supabase ──
  // La service_role key se salta RLS a propósito: el agente escribe
  // pedidos a nombre de negocios que no son de nadie con sesión.
  supabaseUrl: () => requerida('SUPABASE_URL'),
  supabaseServiceKey: () => requerida('SUPABASE_SERVICE_ROLE_KEY'),

  // ── Avisos al dueño (Resend) ──
  // Opcionales: sin ellas, escalar solo deja el registro en la base y
  // le avisa al cliente. Nada se rompe.
  resendApiKey: () => process.env.RESEND_API_KEY,
  correoRemitente: () =>
    process.env.CORREO_REMITENTE ?? 'YoRespondo <avisos@respondo.com>',
}

/** Versión de la Graph API. Meta saca una nueva cada trimestre. */
export const GRAPH_VERSION = process.env.GRAPH_VERSION ?? 'v23.0'

/** El modelo. Opus 4.8 con esfuerzo bajo: en WhatsApp la latencia se ve. */
export const MODELO = process.env.MODELO_CLAUDE ?? 'claude-opus-4-8'

/** Cuántos mensajes del historial le pasamos a Claude en cada turno. */
export const TURNOS_DE_HISTORIAL = 20
