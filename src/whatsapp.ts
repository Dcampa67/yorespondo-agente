// Todo lo que habla con la Cloud API de Meta: verificar firmas,
// enviar mensajes, marcar como leído, y entender el payload del webhook.

import crypto from 'node:crypto'
import { config, GRAPH_VERSION } from './config.ts'

/** Máximo de un mensaje de texto en WhatsApp. Meta rechaza más largo. */
const LIMITE_TEXTO = 4096

// ───────────────────────── Firma ─────────────────────────

/**
 * Comprueba que el webhook viene de verdad de Meta.
 *
 * Meta firma el cuerpo CRUDO con HMAC-SHA256 usando tu App Secret y
 * lo manda en `X-Hub-Signature-256`. Hay que comparar contra los bytes
 * exactos que llegaron: si primero haces JSON.parse y luego stringify,
 * la firma ya no cuadra (cambian espacios y orden de llaves).
 */
export function firmaValida(cuerpoCrudo: string, encabezado: string | null): boolean {
  if (!encabezado?.startsWith('sha256=')) return false

  const esperada = crypto
    .createHmac('sha256', config.appSecret())
    .update(cuerpoCrudo, 'utf8')
    .digest('hex')

  const recibida = encabezado.slice('sha256='.length)

  // timingSafeEqual revienta si los buffers miden distinto, y Buffer.from
  // con 'hex' recorta en silencio en cuanto encuentra un carácter que no es
  // hexadecimal. O sea: comparar las cadenas no basta, hay que comparar los
  // buffers ya convertidos.
  const bufRecibida = Buffer.from(recibida, 'hex')
  const bufEsperada = Buffer.from(esperada, 'hex')
  if (bufRecibida.length !== bufEsperada.length) return false

  return crypto.timingSafeEqual(bufRecibida, bufEsperada)
}

// ──────────────────── Leer el webhook ────────────────────

export interface MensajeEntrante {
  /** El id de Meta (wamid.HBg...). Es la llave del anti-duplicados. */
  wamid: string
  /** A qué número le escribieron. Con esto sabemos de qué negocio es. */
  phoneNumberId: string
  /** Quién escribió: teléfono internacional sin el +. */
  de: string
  /** El nombre de su perfil de WhatsApp. Puede venir vacío. */
  nombrePerfil: string
  /** El texto. Si mandó una foto o un audio, esto viene null. */
  texto: string | null
  /** 'text', 'image', 'audio'… Para poder responder distinto. */
  tipo: string
}

/**
 * Saca los mensajes de un payload de webhook.
 *
 * Meta manda un objeto anidado que también trae acuses de entrega
 * (`statuses`) y a veces varios mensajes juntos. Aquí nos quedamos
 * solo con los mensajes de verdad.
 */
export function leerMensajes(payload: unknown): MensajeEntrante[] {
  const salida: MensajeEntrante[] = []
  const cuerpo = payload as {
    entry?: Array<{
      changes?: Array<{
        value?: {
          metadata?: { phone_number_id?: string }
          contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>
          messages?: Array<{
            id?: string
            from?: string
            type?: string
            text?: { body?: string }
          }>
        }
      }>
    }>
  }

  for (const entry of cuerpo.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value
      const phoneNumberId = value?.metadata?.phone_number_id
      if (!phoneNumberId) continue

      // Los nombres de perfil vienen en un arreglo aparte, indexado por wa_id.
      const nombres = new Map<string, string>()
      for (const c of value?.contacts ?? []) {
        if (c.wa_id && c.profile?.name) nombres.set(c.wa_id, c.profile.name)
      }

      for (const m of value?.messages ?? []) {
        if (!m.id || !m.from) continue
        salida.push({
          wamid: m.id,
          phoneNumberId,
          de: m.from,
          nombrePerfil: nombres.get(m.from) ?? '',
          texto: m.type === 'text' ? (m.text?.body ?? null) : null,
          tipo: m.type ?? 'desconocido',
        })
      }
    }
  }

  return salida
}

// ──────────────────────── Enviar ────────────────────────

async function llamarGraph(
  phoneNumberId: string,
  cuerpo: Record<string, unknown>,
): Promise<void> {
  const respuesta = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.whatsappToken()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(cuerpo),
    },
  )

  if (!respuesta.ok) {
    const detalle = await respuesta.text()
    throw new Error(`Cloud API ${respuesta.status}: ${detalle}`)
  }
}

/** Manda un mensaje de texto. Trunca si se pasa del límite de Meta. */
export async function enviarTexto(
  phoneNumberId: string,
  para: string,
  texto: string,
): Promise<void> {
  const cuerpo =
    texto.length > LIMITE_TEXTO ? `${texto.slice(0, LIMITE_TEXTO - 1)}…` : texto

  await llamarGraph(phoneNumberId, {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: para,
    type: 'text',
    text: { preview_url: false, body: cuerpo },
  })
}

/**
 * Pone las palomitas azules.
 *
 * No es cosmético: le dice al cliente que su mensaje sí llegó mientras
 * el agente piensa. Si falla, da igual — no vale la pena tirar el turno.
 */
export async function marcarLeido(
  phoneNumberId: string,
  wamid: string,
): Promise<void> {
  try {
    await llamarGraph(phoneNumberId, {
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: wamid,
    })
  } catch (error) {
    console.warn('No se pudo marcar como leído:', error)
  }
}
