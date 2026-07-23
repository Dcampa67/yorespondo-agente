// El turno completo, de un mensaje entrante a un mensaje saliente.
//
// Corre DESPUÉS de haberle contestado 200 a Meta (ver api/whatsapp.ts),
// así que aquí ya nadie nos está cronometrando. Si algo truena, truena
// en los logs de Vercel: el webhook ya quedó bien.

import {
  abrirConversacion,
  contextoDe,
  guardarMensaje,
  historial,
  negocioDe,
} from './datos.ts'
import { responder } from './agente.ts'
import { enviarTexto, marcarLeido, type MensajeEntrante } from './whatsapp.ts'

/** Cuando el dueño todavía no llena "Mi Agente", no hay nada que contestar. */
const SIN_CONFIGURAR =
  'Hola, gracias por escribir. En este momento no puedo darte información. ' +
  'Ya le avisé al dueño y te contesta en un rato.'

/** Por ahora el agente solo lee texto. */
const SOLO_TEXTO =
  'Perdón, por aquí solo puedo leer mensajes de texto. ' +
  '¿Me lo escribes y con gusto te ayudo?'

export async function procesar(mensaje: MensajeEntrante): Promise<void> {
  const negocio = await negocioDe(mensaje.phoneNumberId)

  if (!negocio) {
    // Llegó un mensaje a un número que no está conectado a ningún negocio.
    // Casi siempre significa que diste de alta el número en Meta pero se te
    // olvidó el `update` en Supabase. Callar es lo correcto: no sabemos a
    // nombre de quién estaríamos contestando.
    console.warn(`Número sin negocio: phone_number_id=${mensaje.phoneNumberId}`)
    return
  }

  if (!['trialing', 'active'].includes(negocio.subscription_status)) {
    console.warn(
      `${negocio.name} está en ${negocio.subscription_status}: no se contesta.`,
    )
    return
  }

  const conversacionId = await abrirConversacion(
    negocio.id,
    mensaje.de,
    mensaje.nombrePerfil,
  )

  // El anti-duplicados. Meta reintenta el webhook cuando no le contestamos
  // 200 a tiempo, así que el mismo mensaje puede llegar dos o tres veces.
  // Si este `wamid` ya estaba guardado, ya lo contestamos: nos salimos.
  const esNuevo = await guardarMensaje(
    conversacionId,
    'user',
    mensaje.texto ?? `[${mensaje.tipo}]`,
    mensaje.wamid,
  )

  if (!esNuevo) {
    console.log(`Duplicado, se ignora: ${mensaje.wamid}`)
    return
  }

  await marcarLeido(mensaje.phoneNumberId, mensaje.wamid)

  // Fotos, audios, ubicaciones. Todavía no.
  if (mensaje.texto === null) {
    await contestar(mensaje, conversacionId, SOLO_TEXTO)
    return
  }

  const contexto = await contextoDe(negocio.id)
  if (!contexto.trim()) {
    console.warn(`${negocio.name} no tiene generated_markdown.`)
    await contestar(mensaje, conversacionId, SIN_CONFIGURAR)
    return
  }

  const turnos = await historial(conversacionId)

  const { texto, rastro } = await responder(
    {
      negocio,
      telefono: mensaje.de,
      nombrePerfil: mensaje.nombrePerfil,
    },
    contexto,
    turnos,
  )

  // Puede pasar si el turno se fue entero en llamadas a herramientas y
  // Claude no escribió nada. Raro, pero dejar al cliente sin respuesta es peor.
  const salida =
    texto ||
    'Ya quedó registrado. Si necesitas otra cosa, aquí ando.'

  await contestar(mensaje, conversacionId, salida)

  console.log(
    `[${negocio.name}] ${mensaje.de}: ` +
      `${rastro.pedidosGuardados.length} pedido(s), ` +
      `${rastro.escalaciones.length} escalación(es)`,
  )
}

async function contestar(
  mensaje: MensajeEntrante,
  conversacionId: string,
  texto: string,
): Promise<void> {
  await enviarTexto(mensaje.phoneNumberId, mensaje.de, texto)
  await guardarMensaje(conversacionId, 'assistant', texto)
}
