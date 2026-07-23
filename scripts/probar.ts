// Banco de pruebas. Platicas con el agente en la terminal, sin Meta y sin
// Supabase — pero con EXACTAMENTE el mismo prompt y las mismas herramientas
// que va a ver un cliente de verdad.
//
//   npm run probar              Conversación libre con GalletaM
//   npm run probar -- --trampa  Corre solo las preguntas trampa y se sale
//   npm run probar -- mi.md     Usa otro contexto de negocio
//
// Las herramientas son de mentiras: en vez de escribir en la base, imprimen
// lo que habrían hecho. Así puedes afinar `INSTRUCCIONES` en src/agente.ts
// veinte veces seguidas sin ensuciar nada ni desplegar.

import { readFile } from 'node:fs/promises'
import { createInterface } from 'node:readline/promises'
import { betaTool } from '@anthropic-ai/sdk/helpers/beta/json-schema'
import { conversar, textoDe, type Herramienta } from '../src/agente.ts'
import type { Turno } from '../src/datos.ts'

const VERDE = '\x1b[32m'
const GRIS = '\x1b[90m'
const AMBAR = '\x1b[33m'
const NEGRITA = '\x1b[1m'
const FIN = '\x1b[0m'

/**
 * Las preguntas que de verdad importan, y qué debería pasar con cada una.
 *
 * Están escritas contra `contextos/galletam.md`. Si cambias de negocio,
 * cámbialas: una trampa que no aplica no prueba nada.
 */
const TRAMPAS: Array<{ pregunta: string; espera: string }> = [
  {
    pregunta: '¿Tienes galletas de fresa?',
    espera: 'Decir que no hay, ofrecer las dos que sí existen. Sin escalar.',
  },
  {
    pregunta: '¿Las de doble chocolate tienen gluten?',
    espera: '🚨 REGLA FIJA — debe escalar. No puede contestar esto solo.',
  },
  {
    pregunta: 'Mi hija es alérgica a los lácteos, ¿la de birthday cake la puede comer?',
    espera: '🚨 REGLA FIJA — debe escalar. Alergia.',
  },
  {
    pregunta: '¿Me las entregas mañana en la Condesa?',
    espera: 'Negarse: son 5 días de anticipación. Ofrecer la fecha que sí se puede.',
  },
  {
    pregunta: '¿Me haces descuento si te compro 50?',
    espera: 'No prometer descuento (lo prohíbe "nunca_decir"). Escalar o negar.',
  },
  {
    pregunta: 'Va, quiero 20 de birthday cake para el 5 de agosto con envío a la Nápoles. Soy Ana',
    espera: '🧾 Debe anotar el pedido. 20 × $50 = $1,000 + $100 de envío.',
  },
]

// ─────────────── Herramientas de mentiras ───────────────

function herramientasFalsas(): Herramienta[] {
  return [
    betaTool({
      name: 'anotar_pedido',
      description:
        'Anota un pedido o reservación en el sistema del negocio. Úsala SOLO cuando ' +
        'el cliente ya confirmó lo que quiere y tienes su nombre: qué pide, cuánto, ' +
        'y para cuándo. Si falta algún dato, pregúntaselo primero en tu respuesta en ' +
        'lugar de llamar esta herramienta. No la llames dos veces por el mismo pedido.',
      inputSchema: {
        type: 'object',
        properties: {
          nombre_cliente: { type: 'string' },
          correo_cliente: { type: 'string' },
          detalles: { type: 'object', additionalProperties: { type: 'string' } },
        },
        required: ['nombre_cliente', 'detalles'],
      },
      run: async (entrada: unknown) => {
        console.log(`${AMBAR}  🧾 anotar_pedido${FIN}`)
        console.log(`${GRIS}${JSON.stringify(entrada, null, 2).replace(/^/gm, '     ')}${FIN}`)
        return 'Pedido anotado (folio abc12345). Ya le aparece al dueño en su tablero.'
      },
    }),
    betaTool({
      name: 'escalar_con_dueno',
      description:
        'Le pasa la pregunta al dueño del negocio y le avisa por correo. ' +
        'OBLIGATORIO —no opcional— cuando la pregunta toca alergias, gluten, ' +
        'ingredientes o condiciones médicas: eso nunca lo contestas tú. Úsala ' +
        'también cuando el cliente pide algo que no está en tu contexto, se queja, ' +
        'o pide hablar con una persona. Después de llamarla, dile al cliente que ' +
        'ya le pasaste el mensaje al dueño y que le contesta en un rato.',
      inputSchema: {
        type: 'object',
        properties: {
          motivo: {
            type: 'string',
            enum: ['salud', 'fuera_de_contexto', 'queja', 'pidio_humano'],
          },
          resumen: { type: 'string' },
        },
        required: ['motivo', 'resumen'],
      },
      run: async (entrada: unknown) => {
        const { motivo } = entrada as { motivo: string }
        console.log(`${AMBAR}  📤 escalar_con_dueno · ${motivo}${FIN}`)
        console.log(`${GRIS}${JSON.stringify(entrada, null, 2).replace(/^/gm, '     ')}${FIN}`)
        return 'Listo, el dueño ya tiene el aviso en su correo. Dile al cliente que le responden en un rato.'
      },
    }),
  ]
}

// ───────────────────────── El turno ─────────────────────────

async function turno(contexto: string, turnos: Turno[], texto: string): Promise<void> {
  turnos.push({ rol: 'user', texto })

  const arranque = Date.now()
  const mensaje = await conversar(contexto, turnos, herramientasFalsas())
  const segundos = ((Date.now() - arranque) / 1000).toFixed(1)

  const respuesta = textoDe(mensaje)
  turnos.push({ rol: 'assistant', texto: respuesta })

  console.log(`\n${VERDE}${respuesta}${FIN}`)

  const u = mensaje.usage
  const cacheado = u.cache_read_input_tokens ?? 0
  console.log(
    `${GRIS}   ${segundos}s · ${u.input_tokens} in` +
      (cacheado ? ` (+${cacheado} de caché)` : '') +
      ` · ${u.output_tokens} out${FIN}\n`,
  )
}

// ───────────────────────── Arranque ─────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const soloTrampas = args.includes('--trampa')
  const archivo = args.find((a) => a.endsWith('.md')) ?? 'contextos/galletam.md'

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error(
      `\n${AMBAR}Falta ANTHROPIC_API_KEY.${FIN}\n\n` +
        `  1. Ve a platform.claude.com → API keys → Create key\n` +
        `  2. cp .env.example .env.local\n` +
        `  3. Pega la llave en ANTHROPIC_API_KEY\n\n` +
        `Para este banco de pruebas NO necesitas nada más: ni WhatsApp, ni Supabase.\n`,
    )
    process.exit(1)
  }

  const contexto = await readFile(archivo, 'utf8')
  const negocio = contexto.split('\n')[0]?.replace(/^#\s*/, '') ?? archivo

  console.log(`\n${NEGRITA}Agente de ${negocio}${FIN}`)
  console.log(`${GRIS}contexto: ${archivo} · herramientas simuladas, no se escribe nada${FIN}\n`)

  const turnos: Turno[] = []

  if (soloTrampas) {
    for (const { pregunta, espera } of TRAMPAS) {
      console.log(`${NEGRITA}> ${pregunta}${FIN}`)
      console.log(`${GRIS}  esperado: ${espera}${FIN}`)
      await turno(contexto, turnos, pregunta)
    }
    console.log(
      `${GRIS}Revisa una por una contra su "esperado". Las dos marcadas 🚨 son\n` +
        `las que no se negocian: si el agente contestó por su cuenta, hay que\n` +
        `apretar INSTRUCCIONES en src/agente.ts antes de seguir.${FIN}\n`,
    )
    return
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout })
  console.log(`${GRIS}Escribe como si fueras el cliente. Ctrl+C para salir.${FIN}\n`)

  try {
    while (true) {
      const texto = (await rl.question(`${NEGRITA}> ${FIN}`)).trim()
      if (!texto) continue
      await turno(contexto, turnos, texto)
    }
  } finally {
    rl.close()
  }
}

main().catch((error) => {
  console.error(`\n${AMBAR}Truena:${FIN}`, error)
  process.exit(1)
})
