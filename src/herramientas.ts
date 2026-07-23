// Las dos cosas que el agente puede HACER, además de contestar.
//
// Se arman por conversación: cada herramienta ya trae dentro de qué
// negocio y con qué cliente está hablando, así Claude nunca tiene que
// adivinar (ni inventarse) un business_id.

import { betaTool } from '@anthropic-ai/sdk/helpers/beta/json-schema'
import { config } from './config.ts'
import { correoDelDueno, guardarPedido, type Negocio } from './datos.ts'

export interface Contexto {
  negocio: Negocio
  /** Teléfono del cliente final, sin el +. */
  telefono: string
  /** El nombre de su perfil de WhatsApp, si lo mandó Meta. */
  nombrePerfil: string
}

/** Lo que las herramientas dejaron hecho. El log lo cuenta después. */
export interface Rastro {
  pedidosGuardados: string[]
  escalaciones: string[]
}

export function armarHerramientas(ctx: Contexto, rastro: Rastro) {
  const anotarPedido = betaTool({
    name: 'anotar_pedido',
    description:
      'Anota un pedido o reservación en el sistema del negocio. Úsala SOLO cuando ' +
      'el cliente ya confirmó lo que quiere y tienes su nombre: qué pide, cuánto, ' +
      'y para cuándo. Si falta algún dato, pregúntaselo primero en tu respuesta en ' +
      'lugar de llamar esta herramienta. No la llames dos veces por el mismo pedido.',
    inputSchema: {
      type: 'object',
      properties: {
        nombre_cliente: {
          type: 'string',
          description: 'Cómo se llama el cliente. Pregúntaselo si no lo sabes.',
        },
        correo_cliente: {
          type: 'string',
          description: 'Su correo, solo si lo dio. Déjalo vacío si no.',
        },
        detalles: {
          type: 'object',
          description:
            'Los datos del pedido, en español y con llaves sencillas. Para comida ' +
            'por encargo: producto, cantidad, sabor, fecha_entrega, notas. Para ' +
            'academias: clase, fecha_hora, instructor. Incluye solo lo que el ' +
            'cliente sí dijo.',
          additionalProperties: { type: 'string' },
        },
      },
      required: ['nombre_cliente', 'detalles'],
    },
    run: async (entrada: unknown) => {
      const { nombre_cliente, correo_cliente, detalles } = entrada as {
        nombre_cliente: string
        correo_cliente?: string
        detalles: Record<string, string>
      }

      const id = await guardarPedido({
        businessId: ctx.negocio.id,
        nombre: nombre_cliente,
        telefono: ctx.telefono,
        correo: correo_cliente || null,
        detalles,
      })

      rastro.pedidosGuardados.push(id)
      return `Pedido anotado (folio ${id.slice(0, 8)}). Ya le aparece al dueño en su tablero.`
    },
  })

  const escalarConDueno = betaTool({
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
          description:
            'salud = alergias, gluten, ingredientes o condiciones médicas.',
        },
        resumen: {
          type: 'string',
          description:
            'Qué necesita el dueño saber, en dos o tres renglones. Incluye lo ' +
            'que preguntó el cliente, con sus palabras.',
        },
      },
      required: ['motivo', 'resumen'],
    },
    run: async (entrada: unknown) => {
      const { motivo, resumen } = entrada as { motivo: string; resumen: string }

      rastro.escalaciones.push(motivo)
      const enviado = await avisarAlDueno(ctx, motivo, resumen)

      return enviado
        ? 'Listo, el dueño ya tiene el aviso en su correo. Dile al cliente que le responden en un rato.'
        : 'Quedó registrado, pero el correo al dueño no salió. Dile igual al cliente que le responden en un rato.'
    },
  })

  return [anotarPedido, escalarConDueno]
}

// ─────────────────── El correo al dueño (Resend) ───────────────────

const ETIQUETAS: Record<string, string> = {
  salud: 'Pregunta de salud o ingredientes',
  fuera_de_contexto: 'Algo que el agente no sabía',
  queja: 'Una queja',
  pidio_humano: 'Pidió hablar contigo',
}

function escapar(texto: string): string {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

async function avisarAlDueno(
  ctx: Contexto,
  motivo: string,
  resumen: string,
): Promise<boolean> {
  const apiKey = config.resendApiKey()
  if (!apiKey) {
    console.warn('Sin RESEND_API_KEY: la escalación no se mandó por correo.')
    return false
  }

  const correo = await correoDelDueno(ctx.negocio.owner_id)
  if (!correo) {
    console.warn(`El negocio ${ctx.negocio.id} no tiene correo de dueño.`)
    return false
  }

  const quien = ctx.nombrePerfil || `+${ctx.telefono}`
  const etiqueta = ETIQUETAS[motivo] ?? 'Necesita tu atención'

  const html = `<!doctype html>
<html lang="es-MX">
<body style="margin:0;padding:24px;background:#FAF7FA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#241826;">
  <div style="max-width:640px;margin:0 auto;background:#FFFFFF;border:1px solid #EFE6F0;border-radius:16px;padding:32px;">
    <p style="margin:0 0 4px;font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#8E2A6B;">
      ${escapar(etiqueta)}
    </p>
    <h1 style="margin:0 0 24px;font-size:26px;line-height:1.2;">Tu agente te pasa un mensaje</h1>
    <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:28px;">
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #EFE6F0;color:#5E4F62;">Negocio</td>
        <td style="padding:10px 0;border-bottom:1px solid #EFE6F0;text-align:right;font-weight:700;">${escapar(ctx.negocio.name)}</td>
      </tr>
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #EFE6F0;color:#5E4F62;">Cliente</td>
        <td style="padding:10px 0;border-bottom:1px solid #EFE6F0;text-align:right;font-weight:700;">${escapar(quien)}</td>
      </tr>
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #EFE6F0;color:#5E4F62;">WhatsApp</td>
        <td style="padding:10px 0;border-bottom:1px solid #EFE6F0;text-align:right;">
          <a href="https://wa.me/${escapar(ctx.telefono)}" style="color:#8E2A6B;">Abrir la conversación</a>
        </td>
      </tr>
    </table>
    <p style="margin:0 0 8px;font-size:13px;color:#5E4F62;">Qué pasó</p>
    <div style="background:#FAF7FA;border-radius:12px;padding:16px;font-size:15px;line-height:1.6;white-space:pre-wrap;">${escapar(resumen)}</div>
  </div>
</body>
</html>`

  try {
    const respuesta = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: config.correoRemitente(),
        to: [correo],
        subject: `${etiqueta} — ${ctx.negocio.name}`,
        html,
      }),
    })

    if (!respuesta.ok) {
      console.error('Resend rechazó el aviso:', await respuesta.text())
      return false
    }
    return true
  } catch (error) {
    console.error('No se pudo mandar el aviso al dueño:', error)
    return false
  }
}
