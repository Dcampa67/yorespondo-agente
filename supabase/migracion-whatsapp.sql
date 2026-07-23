-- ═══════════════════════════════════════════════════════════════════
--  YoRespondo — WhatsApp
--
--  Cómo correrlo:
--    Supabase → tu proyecto → SQL Editor → pega esto → Run.
--    Es aditivo: no toca nada de lo que ya existe.
--
--  Qué agrega:
--    1. businesses.whatsapp_phone_number_id  ← el enrutador
--    2. wa_conversaciones                     ← un hilo por cliente final
--    3. wa_mensajes                           ← el historial y el anti-duplicados
-- ═══════════════════════════════════════════════════════════════════

-- ───────────────────── 1. El enrutador ─────────────────────
--
-- Cuando entra un mensaje, Meta nos dice a QUÉ número le escribieron,
-- con un id numérico (el `phone_number_id` de la Cloud API). Esa es la
-- única llave que tenemos para saber de qué negocio se trata.
--
-- `whatsapp_number` (que ya existía) es el número bonito que se le
-- enseña al dueño: +52 55 1234 5678. Este es el id interno de Meta.

alter table public.businesses
  add column if not exists whatsapp_phone_number_id text;

create unique index if not exists businesses_wa_phone_id_idx
  on public.businesses (whatsapp_phone_number_id)
  where whatsapp_phone_number_id is not null;

-- ──────────────────── 2. wa_conversaciones ────────────────────
-- Un hilo por cada (negocio, cliente final). WhatsApp no tiene
-- "sesiones": la conversación con doña Ana es una sola, para siempre.

create table if not exists public.wa_conversaciones (
  id                uuid primary key default gen_random_uuid(),
  business_id       uuid not null references public.businesses (id) on delete cascade,
  -- El `wa_id` que manda Meta: el teléfono en formato internacional sin +.
  customer_phone    text not null,
  -- El nombre del perfil de WhatsApp. Puede venir vacío.
  customer_name     text,
  ultimo_mensaje_at timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  unique (business_id, customer_phone)
);

create index if not exists wa_conv_negocio_idx
  on public.wa_conversaciones (business_id, ultimo_mensaje_at desc);

-- ─────────────────────── 3. wa_mensajes ───────────────────────
-- El historial que el agente relee en cada turno, y de paso el
-- anti-duplicados: Meta reintenta el webhook si no le contestamos
-- 200 a tiempo, así que el MISMO mensaje puede llegar dos o tres
-- veces. El unique sobre `wamid` es lo que evita contestar doble.

create table if not exists public.wa_mensajes (
  id              uuid primary key default gen_random_uuid(),
  conversacion_id uuid not null references public.wa_conversaciones (id) on delete cascade,
  -- El id que le pone Meta al mensaje (wamid.HBg...). Null en los nuestros.
  wamid           text unique,
  rol             text not null check (rol in ('user', 'assistant')),
  texto           text not null,
  created_at      timestamptz not null default now()
);

create index if not exists wa_msg_conv_idx
  on public.wa_mensajes (conversacion_id, created_at);

-- ═══════════════════════ ROW LEVEL SECURITY ═══════════════════════
-- Mismo criterio que el resto del esquema: el dueño ve lo suyo.
-- El agente NO pasa por aquí — entra con la service_role key, que se
-- salta RLS a propósito. Estas políticas son para que el dashboard
-- pueda enseñar las conversaciones más adelante.

alter table public.wa_conversaciones enable row level security;
alter table public.wa_mensajes       enable row level security;

drop policy if exists "dueño ve sus conversaciones" on public.wa_conversaciones;
create policy "dueño ve sus conversaciones"
  on public.wa_conversaciones for select
  using (exists (
    select 1 from public.businesses b
    where b.id = wa_conversaciones.business_id and b.owner_id = auth.uid()
  ));

drop policy if exists "dueño ve sus mensajes" on public.wa_mensajes;
create policy "dueño ve sus mensajes"
  on public.wa_mensajes for select
  using (exists (
    select 1
    from public.wa_conversaciones c
    join public.businesses b on b.id = c.business_id
    where c.id = wa_mensajes.conversacion_id and b.owner_id = auth.uid()
  ));

-- ═══════════════════════════════════════════════════════════════════
--  Después de correr esto, conecta el número de un negocio a mano:
--
--    update public.businesses
--       set whatsapp_phone_number_id = '123456789012345',
--           whatsapp_number          = '+52 55 1234 5678'
--     where name = 'GalletaM';
--
--  El id largo sale de WhatsApp Manager → Phone numbers → el engrane
--  del número, o de la pantalla de API Setup de tu app en Meta.
-- ═══════════════════════════════════════════════════════════════════
