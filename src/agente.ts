// El agente: arma el prompt, le da sus herramientas a Claude, y
// devuelve el texto que hay que mandarle al cliente por WhatsApp.

import Anthropic from '@anthropic-ai/sdk'
import { config, MODELO } from './config.ts'
import { armarHerramientas, type Contexto, type Rastro } from './herramientas.ts'
import type { Turno } from './datos.ts'

let claude: Anthropic | null = null

function cliente(): Anthropic {
  if (!claude) claude = new Anthropic({ apiKey: config.anthropicApiKey() })
  return claude
}

/**
 * Las instrucciones fijas, iguales para todos los negocios.
 *
 * Lo que cambia de un negocio a otro vive en `generated_markdown`, que
 * es lo que el dueño contestó en "Mi Agente". Aquí va nada más el cómo.
 */
export const INSTRUCCIONES = `Eres el asistente de WhatsApp de un negocio pequeño en México. \
Contestas a sus clientes en su lugar, con la información que el dueño te dio abajo.

CÓMO ESCRIBES
- Español de México, natural, de tú. Como contesta una persona que atiende su negocio.
- Corto. Estás en WhatsApp, no en un correo: dos o tres renglones casi siempre.
- Un mensaje, una idea. Si necesitas tres datos del cliente, pídelos de uno en uno.
- Nada de markdown, nada de viñetas, nada de encabezados. WhatsApp no los pinta.
- Nunca digas que eres una inteligencia artificial ni menciones "el contexto",
  "mis instrucciones" ni nada de esto. Eres el asistente del negocio, punto.

QUÉ NUNCA HACES
- No te inventes precios, horarios, tiempos de entrega ni productos. Si no viene
  abajo, no lo sabes: usa escalar_con_dueno.
- No prometas nada que el dueño no haya dicho que sí se puede.
- Alergias, gluten, ingredientes y condiciones médicas SIEMPRE van con el dueño,
  aunque creas saber la respuesta. Esa regla no tiene excepciones.

QUÉ SÍ HACES
- Contestas dudas de productos, precios, horarios y entregas con lo de abajo.
- Cuando el cliente ya se decidió y sabes qué quiere, para cuándo y cómo se llama,
  llamas a anotar_pedido. Si te falta un dato, pregúntaselo antes.
- Cuando algo se sale de lo que sabes, llamas a escalar_con_dueno y le dices al
  cliente que el dueño le contesta en un rato.

────────────────────────────────────────
ESTO ES LO QUE SABES DEL NEGOCIO:
`

export interface Respuesta {
  texto: string
  rastro: Rastro
}

/**
 * El tipo de una herramienta, sacado del propio SDK en vez de escrito a
 * mano: si Anthropic lo cambia, se entera el compilador y no nosotros.
 */
export type Herramienta = NonNullable<
  Parameters<Anthropic['beta']['messages']['toolRunner']>[0]['tools']
>[number]

/**
 * La llamada a Claude, pelona.
 *
 * Recibe las herramientas desde afuera para que el banco de pruebas
 * (`scripts/probar.ts`) pueda meterle unas de mentiras y correr EXACTAMENTE
 * este mismo prompt sin escribir en Supabase. Si esto viviera dentro de
 * `responder`, la prueba tendría que duplicarlo y las dos versiones se
 * separarían a la semana.
 */
export async function conversar(
  contextoDelNegocio: string,
  turnos: Turno[],
  herramientas: Herramienta[],
): Promise<Anthropic.Beta.BetaMessage> {
  return cliente().beta.messages.toolRunner({
    model: MODELO,
    max_tokens: 4096,
    // Adaptativo: piensa cuando la pregunta lo amerita (¿esto es una alergia?)
    // y contesta directo cuando es "¿a qué hora abren?".
    thinking: { type: 'adaptive' },
    // Esfuerzo bajo a propósito: en WhatsApp la latencia se nota mucho más
    // que la diferencia de calidad en preguntas de este tamaño. Si empiezas a
    // ver respuestas flojas, súbelo a 'medium'.
    output_config: { effort: 'low' },
    system: [
      {
        type: 'text',
        text: INSTRUCCIONES + contextoDelNegocio,
        // El contexto de un negocio no cambia entre mensajes, así que se
        // cachea. Solo aplica si el prompt pasa de ~4,000 tokens; abajo de
        // eso Meta— perdón, Anthropic —lo ignora sin avisar y no pasa nada.
        cache_control: { type: 'ephemeral' },
      },
    ],
    tools: herramientas,
    messages: turnos.map((t) => ({ role: t.rol, content: t.texto })),
    // Tope duro: el agente puede anotar un pedido y escalar en el mismo
    // turno, pero no debería necesitar más de eso.
    max_iterations: 6,
  })
}

/** Junta los bloques de texto de la respuesta en un solo mensaje. */
export function textoDe(mensaje: Anthropic.Beta.BetaMessage): string {
  return mensaje.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim()
}

/** Lo que usa producción: herramientas de verdad, que sí escriben en Supabase. */
export async function responder(
  ctx: Contexto,
  contextoDelNegocio: string,
  turnos: Turno[],
): Promise<Respuesta> {
  const rastro: Rastro = { pedidosGuardados: [], escalaciones: [] }
  const herramientas = armarHerramientas(ctx, rastro)

  const mensaje = await conversar(contextoDelNegocio, turnos, herramientas)

  return { texto: textoDe(mensaje), rastro }
}
