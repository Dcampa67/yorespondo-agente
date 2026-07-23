// Las lecturas y escrituras contra Supabase: de qué negocio es el
// mensaje, qué sabe el agente, y qué se ha dicho hasta ahora.

import { sb } from './supabase.ts'
import { TURNOS_DE_HISTORIAL } from './config.ts'

export interface Negocio {
  id: string
  name: string
  type: string
  owner_id: string
  subscription_status: string
  whatsapp_phone_number_id: string
}

export interface Turno {
  rol: 'user' | 'assistant'
  texto: string
}

// ────────────────── De qué negocio es el mensaje ──────────────────

/**
 * El enrutador. Meta nos dice a qué número le escribieron; nosotros
 * buscamos qué negocio tiene ese número conectado.
 *
 * Devuelve null si el número no está dado de alta — pasa cuando alguien
 * apunta su webhook al nuestro por error, o cuando conectaste un número
 * en Meta pero se te olvidó el `update` en Supabase.
 */
export async function negocioDe(phoneNumberId: string): Promise<Negocio | null> {
  const { data, error } = await sb()
    .from('businesses')
    .select('id, name, type, owner_id, subscription_status, whatsapp_phone_number_id')
    .eq('whatsapp_phone_number_id', phoneNumberId)
    .maybeSingle()

  if (error) throw new Error(`No se pudo buscar el negocio: ${error.message}`)
  return (data as Negocio | null) ?? null
}

/**
 * Lo que el dueño contestó en "Mi Agente", ya compilado a markdown por
 * la app web. Es, tal cual, el contexto que el agente carga.
 */
export async function contextoDe(businessId: string): Promise<string> {
  const { data } = await sb()
    .from('agent_config')
    .select('generated_markdown')
    .eq('business_id', businessId)
    .maybeSingle()

  return (data?.generated_markdown as string | undefined) ?? ''
}

/** El correo del dueño, para escalarle. Vive en auth.users, no en businesses. */
export async function correoDelDueno(ownerId: string): Promise<string | null> {
  const { data } = await sb().auth.admin.getUserById(ownerId)
  return data?.user?.email ?? null
}

// ─────────────────────── La conversación ───────────────────────

/** Encuentra el hilo con este cliente, o lo abre si es la primera vez. */
export async function abrirConversacion(
  businessId: string,
  telefono: string,
  nombre: string,
): Promise<string> {
  const { data, error } = await sb()
    .from('wa_conversaciones')
    .upsert(
      {
        business_id: businessId,
        customer_phone: telefono,
        // Solo pisamos el nombre si Meta nos mandó uno.
        ...(nombre ? { customer_name: nombre } : {}),
        ultimo_mensaje_at: new Date().toISOString(),
      },
      { onConflict: 'business_id,customer_phone' },
    )
    .select('id')
    .single()

  if (error) throw new Error(`No se pudo abrir la conversación: ${error.message}`)
  return data.id as string
}

/**
 * Guarda un mensaje. Devuelve false si ese `wamid` ya estaba.
 *
 * Aquí vive el anti-duplicados: Meta reintenta el webhook si tardamos
 * en contestarle 200, así que el mismo mensaje llega dos o tres veces.
 * El unique de la tabla lo rebota y nosotros nos salimos sin responder
 * de nuevo. El código 23505 es "unique_violation" de Postgres.
 */
export async function guardarMensaje(
  conversacionId: string,
  rol: 'user' | 'assistant',
  texto: string,
  wamid?: string,
): Promise<boolean> {
  const { error } = await sb().from('wa_mensajes').insert({
    conversacion_id: conversacionId,
    wamid: wamid ?? null,
    rol,
    texto,
  })

  if (error?.code === '23505') return false
  if (error) throw new Error(`No se pudo guardar el mensaje: ${error.message}`)
  return true
}

/** Los últimos turnos, en orden cronológico, para dárselos a Claude. */
export async function historial(conversacionId: string): Promise<Turno[]> {
  const { data, error } = await sb()
    .from('wa_mensajes')
    .select('rol, texto')
    .eq('conversacion_id', conversacionId)
    .order('created_at', { ascending: false })
    .limit(TURNOS_DE_HISTORIAL)

  if (error) throw new Error(`No se pudo leer el historial: ${error.message}`)

  // Vinieron del más nuevo al más viejo porque así se ordena bien el
  // límite; Claude los quiere al revés.
  return ((data ?? []) as Turno[]).reverse()
}

// ───────────────────────── Los pedidos ─────────────────────────

export interface PedidoNuevo {
  businessId: string
  nombre: string
  telefono: string
  correo?: string | null
  detalles: Record<string, unknown>
}

/** Escribe en `records`. Es lo que aparece en la pestaña Pedidos del dashboard. */
export async function guardarPedido(pedido: PedidoNuevo): Promise<string> {
  const { data, error } = await sb()
    .from('records')
    .insert({
      business_id: pedido.businessId,
      customer_name: pedido.nombre,
      customer_phone: pedido.telefono,
      customer_email: pedido.correo ?? null,
      status: 'confirmed',
      source: 'whatsapp',
      details: pedido.detalles,
    })
    .select('id')
    .single()

  if (error) throw new Error(`No se pudo guardar el pedido: ${error.message}`)
  return data.id as string
}
