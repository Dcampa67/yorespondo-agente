// El webhook de WhatsApp. Es la única puerta de entrada del agente.
//
//   GET  /api/whatsapp   Meta lo llama UNA vez, cuando registras el webhook.
//   POST /api/whatsapp   Meta lo llama en cada mensaje que te mandan.
//
// La regla de oro del POST: contestar 200 rápido y procesar aparte.
// Meta espera unos segundos; si no le contestas, da el webhook por
// fallido y lo reintenta — y entonces el cliente recibe la respuesta
// dos veces. Claude se tarda más que eso, así que el trabajo real se
// va a `waitUntil`, que mantiene viva la función después de responder.

import { waitUntil } from '@vercel/functions'
import { config } from '../src/config.ts'
import { firmaValida, leerMensajes } from '../src/whatsapp.ts'
import { procesar } from '../src/procesar.ts'

// ──────────────────── Verificación (una sola vez) ────────────────────

export function GET(request: Request): Response {
  const url = new URL(request.url)
  const modo = url.searchParams.get('hub.mode')
  const token = url.searchParams.get('hub.verify_token')
  const challenge = url.searchParams.get('hub.challenge')

  if (modo === 'subscribe' && token === config.verifyToken() && challenge) {
    // Meta quiere el challenge de vuelta en texto plano, tal cual.
    return new Response(challenge, {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    })
  }

  console.warn('Verificación rechazada: el verify_token no coincide.')
  return new Response('Forbidden', { status: 403 })
}

// ─────────────────────── Mensajes entrantes ───────────────────────

export async function POST(request: Request): Promise<Response> {
  // El cuerpo CRUDO, sin parsear: la firma se calcula sobre estos bytes
  // exactos. Un JSON.parse + stringify de por medio la rompe.
  const crudo = await request.text()

  if (!firmaValida(crudo, request.headers.get('x-hub-signature-256'))) {
    console.warn('Firma inválida: alguien que no es Meta tocó el webhook.')
    return new Response('Forbidden', { status: 403 })
  }

  let payload: unknown
  try {
    payload = JSON.parse(crudo)
  } catch {
    return new Response('Bad Request', { status: 400 })
  }

  const mensajes = leerMensajes(payload)

  // El payload también trae acuses de entrega y de lectura. No son
  // mensajes: `leerMensajes` los filtra y aquí no queda nada que hacer.
  if (mensajes.length === 0) {
    return new Response('OK', { status: 200 })
  }

  // Aquí está el truco: se agenda el trabajo y se contesta 200 de
  // inmediato. Vercel mantiene la función corriendo hasta que la
  // promesa termina, pero Meta ya se fue tranquila.
  waitUntil(
    Promise.all(
      mensajes.map((mensaje) =>
        procesar(mensaje).catch((error) => {
          // Se traga el error a propósito: si esta promesa se rechaza,
          // los demás mensajes del mismo lote se caen con ella.
          console.error(`Falló el mensaje ${mensaje.wamid}:`, error)
        }),
      ),
    ),
  )

  return new Response('OK', { status: 200 })
}
