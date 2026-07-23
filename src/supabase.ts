// Cliente de Supabase con la service_role key.
//
// Esta llave se salta RLS a propósito. Vive SOLO aquí, del lado del
// servidor, nunca en el navegador. El agente escribe pedidos a nombre
// de negocios cuyo dueño no tiene sesión abierta en ese momento.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { config } from './config.ts'

let cliente: SupabaseClient | null = null

export function sb(): SupabaseClient {
  if (!cliente) {
    cliente = createClient(config.supabaseUrl(), config.supabaseServiceKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  }
  return cliente
}
