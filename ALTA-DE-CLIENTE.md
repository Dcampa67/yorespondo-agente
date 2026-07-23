# Dar de alta un cliente

Del correo de "nuevo cliente" a un agente contestando. **No lleva código.**

Este documento es el borrador del skill. Cada paso trae una marca:

- ✅ **probado** — se hizo y funcionó
- ⏳ **por probar** — escrito de la documentación, todavía no lo ejercitamos

Cuando todos estén en ✅, esto se convierte en el skill.

---

## Lo que NO hay que hacer

Vale la pena decirlo primero, porque es el error caro:

| ❌ No | ✅ Sí |
|---|---|
| Un repo por cliente | Un repo para todos |
| Un proyecto de Vercel por cliente | Un deploy para todos |
| Meter el markdown del cliente al código | Ya está en Supabase, el agente lo lee solo |
| Tocar `INSTRUCCIONES` para un cliente | `INSTRUCCIONES` es el *cómo*; el *qué* sale de Mi Agente |

Un cliente nuevo son **dos acciones humanas**: conectar su número en Meta y correr un `UPDATE` de una línea. Nada más.

---

## Paso 0 — El cliente llena Mi Agente ✅

Ya funciona, y es automático. El cliente se registra en la web, contesta las preguntas, y al guardar:

1. `compilarMarkdown()` convierte sus respuestas a markdown y le pega la `REGLA_FIJA`.
2. Se guarda en `agent_config.generated_markdown`.
3. La función `aviso-cliente` te manda el correo con ese markdown adentro.

**Ese correo es tu señal de arranque.** Cuando llega, el cerebro del agente ya está listo; solo le falta un número por dónde hablar.

> Probado con GalletaM el 23 jul 2026: llegó el correo con el markdown completo.

---

## Paso 1 — Revisar el markdown ✅

Antes de conectar nada, léelo. Es lo único que el agente va a saber, y los dueños contestan de prisa.

Busca:

- **Campos vacíos** (`_(sin responder)_`). Cada uno es una pregunta que el agente va a tener que escalar. Si son muchos, háblale al cliente antes de prender nada.
- **Precios sin unidad.** "50" no dice si es por galleta o por paquete.
- **Contradicciones.** "Entrego a toda la ciudad" + "solo se recoge en el local".
- **Qué puso en *nunca decir*.** Es la regla que más se le olvida al agente; conviene probarla explícitamente.

Cópialo a `contextos/<cliente>.md` y pruébalo antes de que llegue un cliente real:

```bash
npm run probar -- contextos/<cliente>.md
```

Arma 5 o 6 preguntas trampa **de ese negocio** (ver `scripts/probar.ts`): un producto que no vende, una de salud, una que rompa su regla de anticipación, una que pida lo que puso en *nunca decir*, y un pedido completo que sí deba anotar.

> Probado con GalletaM: el markdown venía completo y sin contradicciones.
> Su *nunca decir* es "Descuentos" — trampa #5.

---

## Paso 2 — Conectar su número en Meta ⏳

Es el paso lento y el único que depende de terceros.

1. WhatsApp Manager → Phone numbers → **Add phone number**.
2. Verificar por SMS o llamada. Con números VoIP suele fallar el SMS y sí pasar la llamada.
3. Copiar el **`phone_number_id`** (el número largo, no el teléfono).

**Requisitos del número:**

- Tiene que poder recibir el código. Si es de reenvío, configura el reenvío antes.
- No puede estar ya registrado en la app normal de WhatsApp.
- Para clientes mexicanos, un +52.

**Cuánto tarda:** la verificación son minutos; la verificación del negocio ante Meta puede llevar días. Descuéntalo de lo que le prometas al cliente.

> ⏳ Pendiente. Falta hacerlo una vez y anotar aquí lo que de verdad pidió Meta.

---

## Paso 3 — El UPDATE ⏳

Supabase → SQL Editor:

```sql
update public.businesses
   set whatsapp_phone_number_id = '<el id largo de Meta>',
       whatsapp_number          = '<+52 55 ...>'   -- el bonito, para el dashboard
 where name = '<nombre del negocio>';
```

Con eso el agente ya contesta. En serio: no hay deploy, no hay reinicio, no hay nada más.

**Comprobación:**

```sql
select name, whatsapp_phone_number_id, subscription_status
  from public.businesses
 where whatsapp_phone_number_id is not null;
```

`subscription_status` tiene que estar en `trialing` o `active`; si no, `procesar.ts` no contesta a propósito.

> ⏳ Pendiente.

---

## Paso 4 — La prueba de fuego ⏳

Escríbele al número desde un teléfono cualquiera y comprueba las cuatro cosas:

| Qué | Cómo se ve bien |
|---|---|
| Contesta | Llega respuesta en menos de ~10 s |
| Sabe del negocio | Un precio o un horario correcto, no inventado |
| Escala salud | Pregúntale por alergias — debe pasártelo, no contestar |
| Anota pedidos | Cierra un pedido y revisa que aparezca en el dashboard |

Si algo falla, los logs están en Vercel → tu proyecto → Logs. Los mensajes están en español y dicen exactamente en qué paso se rompió.

> ⏳ Pendiente.

---

## Cuando algo no jala

| Síntoma | Casi siempre es |
|---|---|
| No contesta nada | El `UPDATE` del paso 3 no se hizo, o el id quedó mal. Log: `Número sin negocio` |
| Contesta pero no sabe nada | El cliente no ha llenado Mi Agente. Log: `no tiene generated_markdown` |
| Contesta dos veces | El webhook está tardando y Meta reintenta. Revisa que el 200 salga rápido |
| Meta no verifica el webhook | El `WHATSAPP_VERIFY_TOKEN` de Vercel y el de Meta no son idénticos |
| Dejó de contestar de golpe | ¿Venció la API key de Claude? ¿Se acabó el crédito? ¿Venció el token de Meta? |
| Se salta la regla de salud | Aprieta `INSTRUCCIONES` en `src/agente.ts` — y súbele el `effort` a `medium` |
