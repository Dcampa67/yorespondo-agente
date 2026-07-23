# YoRespondo — agente de WhatsApp

El agente que contesta por los negocios. Vive en **Vercel**, habla con
**Claude** y con la **Cloud API de WhatsApp**, y escribe en el **mismo
Supabase** que la app web (`yorespondo`, que se queda en Netlify).

---

## Empieza por aquí: probar sin desplegar nada

Antes de tocar Meta, Vercel o Supabase, puedes platicar con el agente en
la terminal. **Lo único que necesitas es la llave de Claude.**

```bash
npm install
cp .env.example .env.local     # y pega tu ANTHROPIC_API_KEY
npm run probar
```

```
Agente de GalletaM
contexto: contextos/galletam.md · herramientas simuladas, no se escribe nada

> ¿tienes galletas de fresa?
```

Las preguntas trampa de un jalón:

```bash
npm run probar -- --trampa
```

Corre las cinco que importan: fresa (producto que no existe), gluten,
alergia a la nuez, entrega el mismo día, y un pedido completo. Las tres
primeras **deben** escalar con el dueño; la cuarta debe negarse; la
quinta debe anotar el pedido.

Esto usa **exactamente** el mismo prompt y las mismas descripciones de
herramientas que producción — solo que las herramientas imprimen en vez
de escribir en Supabase (`scripts/probar.ts`). Es la forma barata de
afinar `INSTRUCCIONES` en `src/agente.ts`: cambias, corres, ves. Sin
desplegar, sin WhatsApp, sin ensuciar la base.

Para probar con otro negocio, haz un `.md` nuevo en `contextos/` con el
mismo formato que escupe `compilarMarkdown` de la app web:

```bash
npm run probar -- contextos/mi-negocio.md
```

---

## Requisitos

- **Node 20 o más** (probado en v24). Los imports relativos llevan
  extensión `.ts` a propósito: Node 24 corre TypeScript nativo pero no
  traduce `./x.js` a `./x.ts`, y esbuild —el que compila en Vercel— sí
  resuelve `.ts`. Así el mismo código corre local y en producción.
- `npm run typecheck` antes de cada deploy.

---

## Cómo funciona

```
Cliente final                                            Dueño del negocio
     │                                                          ▲
     │ "¿tienes galletas de chocolate para el viernes?"          │ correo
     ▼                                                          │
  WhatsApp ──► Meta Cloud API ──► POST /api/whatsapp             │
                                        │                       │
                                        │ 1. verifica la firma   │
                                        │ 2. contesta 200 YA     │
                                        │ 3. waitUntil(...)      │
                                        ▼                       │
                                   src/procesar.ts              │
                                        │                       │
        phone_number_id ──► businesses ─┤                       │
        agent_config.generated_markdown ┤                       │
        wa_mensajes (historial)  ───────┤                       │
                                        ▼                       │
                                   src/agente.ts ──► Claude     │
                                        │                       │
                          ┌─────────────┴─────────────┐         │
                          ▼                           ▼         │
                   anotar_pedido              escalar_con_dueno ─┘
                   → records                  → Resend
                          │
                          ▼
                  respuesta ──► WhatsApp ──► Cliente
```

### Las tres piezas que hay que entender

**1. El enrutador es `phone_number_id`.** Meta no nos dice "esto es de
GalletaM": nos dice a qué número le escribieron, con un id numérico. La
columna `businesses.whatsapp_phone_number_id` es la que traduce ese id a
un negocio. Si no está poblada, el mensaje se ignora en silencio.

**2. Se contesta 200 antes de pensar.** Meta espera pocos segundos y, si
no le contestas, da el webhook por fallido y **lo reintenta** — y el
cliente recibe la respuesta dos veces. Claude se tarda más que eso, así
que `api/whatsapp.ts` responde 200 de inmediato y manda el trabajo a
`waitUntil`, que mantiene viva la función después de haber respondido.

**3. El anti-duplicados es el `wamid`.** Aun con lo anterior, Meta
reintenta de vez en cuando. `wa_mensajes.wamid` tiene un `unique`: si el
insert lo rebota (código `23505`), ya contestamos ese mensaje y nos
salimos.

### Los archivos

```
api/whatsapp.ts        GET (verificación) + POST (mensajes). La puerta.
src/config.ts          Variables de entorno, validadas al arrancar.
src/supabase.ts        Cliente con service_role (se salta RLS a propósito).
src/whatsapp.ts        Firma HMAC, leer el payload, enviar, marcar leído.
src/datos.ts           Negocio, contexto, conversación, historial, pedidos.
src/agente.ts          ★ El prompt y la llamada a Claude.
src/herramientas.ts    anotar_pedido · escalar_con_dueno (+ correo Resend).
src/procesar.ts        El turno completo, de mensaje entrante a saliente.
scripts/probar.ts      El banco de pruebas local (herramientas simuladas).
contextos/galletam.md  Negocio de ejemplo, generado con el compilarMarkdown real.
supabase/migracion-whatsapp.sql   Las 2 tablas nuevas + la columna nueva.
```

`src/agente.ts` está partido en dos a propósito: `conversar()` recibe las
herramientas desde afuera y `responder()` le mete las de verdad. Así el
banco de pruebas usa el mismo prompt sin duplicarlo — si estuviera todo
junto, la prueba y producción se separarían a la semana.

El **prompt** está en `src/agente.ts` (`INSTRUCCIONES`). Lo que cambia de
un negocio a otro **no** está ahí: sale de `agent_config.generated_markdown`,
que es lo que el dueño contestó en "Mi Agente" en la app web. Para cambiar
cómo suena el agente, tocas `INSTRUCCIONES`. Para cambiar lo que sabe de
un negocio, el dueño edita sus respuestas — no se toca código.

---

## Puesta en marcha

### 1. Supabase

SQL Editor → pega `supabase/migracion-whatsapp.sql` → Run. Es aditivo, no
toca nada de lo que ya existe.

### 2. Meta (WhatsApp)

Para desarrollar sirve el número de prueba que ya tienes
(**+1 555-173-2659**). Ten presentes sus dos límites:

- Solo puede escribirle a **5 números** que registres a mano en la pantalla
  de API Setup. A cualquier otro no le llega nada.
- **No sirve para clientes reales.** Para producción necesitas dar de alta
  un número mexicano de verdad y verificar el negocio con Meta.

Lo que hay que sacar de Meta:

| Qué | Dónde |
|---|---|
| `WHATSAPP_TOKEN` | Business Settings → Users → **System users** → Generate token, con `whatsapp_business_messaging` y `whatsapp_business_management`. **No** uses el de la pantalla de API Setup: ese dura 24 horas. |
| `META_APP_SECRET` | App Settings → Basic → App Secret |
| El `phone_number_id` | WhatsApp Manager → Phone numbers → el engrane del número |

`WHATSAPP_VERIFY_TOKEN` te lo inventas tú: una cadena larga y aleatoria.

### 3. Vercel

Sube este repo a GitHub, impórtalo en Vercel, y captura las variables de
`.env.example` en Project Settings → Environment Variables.

Vercel te da una URL. El webhook es:

```
https://<tu-proyecto>.vercel.app/api/whatsapp
```

### 4. Registrar el webhook en Meta

App → WhatsApp → Configuration → Webhook → Edit:

- **Callback URL**: la de arriba
- **Verify token**: el mismo `WHATSAPP_VERIFY_TOKEN` que capturaste en Vercel
- Verify and save → suscríbete al campo **`messages`**

Si te dice que no pudo verificar, es que el `verify_token` no coincide o
que el deploy todavía no terminaba. Los logs del `GET` están en Vercel →
tu proyecto → Logs.

### 5. Conectar un negocio a su número

```sql
update public.businesses
   set whatsapp_phone_number_id = '123456789012345',
       whatsapp_number          = '+1 555 173 2659'
 where name = 'GalletaM';
```

Y ya. Escríbele al número desde uno de los 5 teléfonos registrados.

---

## Costo

Cada mensaje que contesta el agente es una llamada a Claude Opus 4.8
($5 por millón de tokens de entrada, $25 de salida). Una conversación
normal de pedido —unos 10 turnos, con el contexto del negocio de por
medio— anda en centavos de dólar. Contra los $2,999 MXN al mes del plan
con WhatsApp, da holgado.

Dos perillas si quieres apretarlo, las dos en `src/agente.ts`:

- `output_config.effort` está en `'low'` a propósito: en WhatsApp la
  latencia se nota más que la diferencia de calidad. Súbelo a `'medium'`
  si ves respuestas flojas.
- `MODELO_CLAUDE=claude-sonnet-5` como variable de entorno lo baja a
  $3/$15 sin tocar código. Pruébalo con las preguntas trampa (fresa,
  gluten, alergias) antes de dejarlo.

El caché del prompt ya está puesto sobre el contexto del negocio, pero
solo entra en acción arriba de ~4,000 tokens. El `generated_markdown` de
un negocio chico probablemente no llega; no pasa nada, simplemente no
cachea.

---

## Sobre el número

Un número de VoIP o de reenvío (NumberBarn, Google Voice, y parecidos)
**no siempre pasa** el alta de WhatsApp Business. Antes de gastarle
tiempo, tres cosas:

1. El número tiene que poder **recibir** el código de verificación. Si
   está en "PROCESSING" o dice *"not configured"*, primero configúrale el
   reenvío a un teléfono tuyo de verdad; si no, el código se pierde.
2. Si el SMS no llega, pide **verificación por llamada** — con números de
   VoIP suele funcionar la llamada aunque falle el SMS.
3. El número **no puede estar ya registrado** en la app normal de
   WhatsApp. Si lo está, hay que darlo de baja primero.

Y ten presente que un (845) es de Estados Unidos: para practicar da
igual, pero a los clientes mexicanos de un negocio mexicano les va a
extrañar. Para los clientes de verdad, número +52.

---

## Lo que falta

- **Probarlo contra WhatsApp de verdad.** El agente ya compila y corre en
  el banco de pruebas; lo que no se ha ejercitado es el camino completo
  webhook → Supabase → respuesta.
- **Fotos y audios.** Ahorita el agente contesta "solo leo texto".
- **La ventana de 24 horas.** WhatsApp solo te deja escribir libre dentro
  de las 24h del último mensaje del cliente. Para un agente que solo
  responde, no estorba; el día que quieras que el agente escriba primero
  (confirmar un pedido, recordar una entrega), necesitas plantillas
  aprobadas por Meta.
- **Ver las conversaciones en el dashboard.** Las tablas y sus políticas
  de RLS ya están; falta la pantalla.
