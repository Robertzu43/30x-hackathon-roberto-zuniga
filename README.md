# Thesaurus

**Paga lo que debes. Frena lo que no. Pregunta cuando dudes.**

El agente de cuentas por pagar que decide con tus reglas. Construido para el reto de Blinka (Hackathon 30X). La IA lee la factura. El código decide **PAGAR**, **FRENAR** o **ESCALAR**. Postgres rechaza un PAGAR fuera de las reglas. No mueve dinero real.

La demo en vivo está en [https://30x-hackathon.30x-hackathon-roberto-zuniga.workers.dev/demo](https://30x-hackathon.30x-hackathon-roberto-zuniga.workers.dev/demo) («Probar con mi propia empresa», sin cuenta ni correo). Los comandos de [Cómo correrlo](#cómo-correrlo) ejecutan la suite de pruebas y el build. No arrancan un servidor local.

[![Demo](https://img.youtube.com/vi/z8IdL3_Skvg/maxresdefault.jpg)](https://www.youtube.com/watch?v=z8IdL3_Skvg)

> **Para el jurado**
>
> | | |
> |---|---|
> | **Reto** | Blinka · «Agentes que pagan por la empresa»: leer facturas, decidir dentro de reglas configurables y dejar un registro. |
> | **Demo** | [https://30x-hackathon.30x-hackathon-roberto-zuniga.workers.dev/demo](https://30x-hackathon.30x-hackathon-roberto-zuniga.workers.dev/demo) |
> | **Video** | [Película oficial en YouTube](https://www.youtube.com/watch?v=z8IdL3_Skvg). Copias alojadas: [lanzamiento, 150 s](https://30x-hackathon.30x-hackathon-roberto-zuniga.workers.dev/demo/thesaurus-launch.mp4) · [recorrido sin editar, 128 s](https://30x-hackathon.30x-hackathon-roberto-zuniga.workers.dev/demo/happy-path.webm) |
> | **Resultado** | **29/29.** 15 PAGAR, 3 FRENAR, 11 ESCALAR, iguales a la etiqueta de [`docs/demo/DATASET.md`](docs/demo/DATASET.md). Lo afirma `seed replay is 15 PAGAR, 3 FRENAR, 11 ESCALAR (29)` en [`src/engine/decide.test.ts`](src/engine/decide.test.ts). Las 11 ESCALAR son el resultado correcto. |
> | **Autonomía** | **18/29 (62 %).** Solo un PAGAR o un FRENAR de la primera decisión del agente que coincide con la etiqueta (`solo` en [`src/routes/screen.ts`](src/routes/screen.ts); `Math.round`). El mismo replay lo afirma con `autonomy on this replay is 18/29`. |
> | **Seguridad** | El agente no marca PAGAR una factura cuya etiqueta no es PAGAR. Un PAGAR del agente exige los 13 controles en `cumple`. Una persona solo puede desbloquear los 8 de `HUMAN_OVERRIDABLE`. El trigger está en [`supabase/migrations/20261018000300_pagar_check_ids.sql`](supabase/migrations/20261018000300_pagar_check_ids.sql). |
> | **Explicabilidad** | Registro «Lo que hice / Lo que leí / Lo que decidí» en español e inglés, con plantillas de [`src/engine/explain.ts`](src/engine/explain.ts). Ningún modelo redacta ese texto. |
> | **Arquitectura** | Workers decide, Nova Lite lee, Postgres impide. Prosa en [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). |
> | **Correrlo** | `npm ci && npm test`. Node >= 22.22 (see .nvmrc). Sin red ni claves. No es un servidor. |

**English.** Thesaurus is an accounts-payable agent for Blinka. An LLM only reads invoices into fields. `decide()` returns PAGAR, FRENAR or ESCALAR (the English UI says PAY, STOP, ESCALATE). On the 29-invoice dataset the labels are 15 / 3 / 11, and autonomy is 18/29. The live demo is at [/demo](https://30x-hackathon.30x-hackathon-roberto-zuniga.workers.dev/demo). The official film is on [YouTube](https://www.youtube.com/watch?v=z8IdL3_Skvg). `npm test` runs the suite; it does not start a local server.

## El problema

Una factura llega por correo, PDF o chat. Alguien de finanzas la compara con lo acordado, busca los datos de quien cobra, pide aprobación por chat, crea el pago a mano y concilia en una hoja. Es manual, se repite cada mes y depende de que haya alguien disponible. Lo que falta es confianza: que el agente pague solo lo que debe, explique cada decisión y nunca se pase de sus límites. El enunciado del reto está en [`docs/PROBLEM.md`](docs/PROBLEM.md).

## Qué hace Thesaurus

Cada factura recorre el mismo ciclo ([`src/agent/loop.ts`](src/agent/loop.ts)):

**percibe** (PDF, imagen, chat pegado o portal de proveedores) → **lee** (Amazon Nova Lite en AWS Bedrock, con Workers AI de respaldo) → **consulta** (directorio, política, periodo, duplicados, tasa) → **decide** (13 controles) → **actúa** (registra, escala, prepara la orden de pago) → **rinde cuentas** (el registro).

- **PAGAR**: los 13 controles están y cumplen, o una persona desbloqueó solo controles de `HUMAN_OVERRIDABLE` y el resto cumple.
- **FRENAR**: duplicado exacto o por encima del límite por pago. Es final. Un rechazo humano también queda FRENAR.
- **ESCALAR**: algo no cumple o no se pudo verificar. Pregunta, por ejemplo: *«La factura #2044 de Nube Sur LLC por 4.200 USD supera tu umbral de 2.500 USD. ¿La pago?»*, con Aprobar y Rechazar.

El cron del Worker es `*/5 * * * *` ([`wrangler.toml`](wrangler.toml)): revisa lo pendiente sin nadie conectado. También corre al llegar una factura, al entrar y al pulsar «Ejecutar agente» o «Reevaluar pendientes». No mueve dinero real.

**La IA lee, el código decide, una persona aprueba.** El modelo solo llena campos ([`src/lib/llm.ts`](src/lib/llm.ts)) y responde preguntas sobre el registro («Pregúntale a Thesaurus»). No puede aprobar ni pagar. Si el lector falla o falta un dato, la factura se escala.

## Pantallas

- **Bandeja**: cada factura con su resultado y su razón en una línea, «Nueva factura» y «Ejecutar agente».
- **Detalle**: «Lo que hice», «Lo que leí», «Lo que decidí» (valor, umbral y cuenta de cada control), qué tendría que pasar para pagarla, la política y quién actuó.
- **Política**: formulario, nunca JSON. Antes de guardar muestra qué pendientes cambiarían.
- **Periodo**: Autonomía, Violaciones y Decisiones del mes. Autonomía usa `solo`; una violación es un primer PAGAR del agente cuya etiqueta no es PAGAR.
- **Portal de proveedores** ([facturas.…/andina-labs](https://facturas.30x-hackathon-roberto-zuniga.workers.dev/andina-labs)): el proveedor envía la factura sin cuenta y solo ve un estado en palabras fijas.

## Cómo decide: 13 controles

Cada control guarda el valor, el umbral, la cuenta y el veredicto. Un dato que falta es «no se pudo verificar» y escala. Los ids, en orden, están en `CHECK_IDS` ([`src/engine/types.ts`](src/engine/types.ts)).

| Control | Si falla |
|---|---|
| Lectura con confianza ≥ 0,8 | ESCALAR |
| Beneficiario en el directorio | ESCALAR |
| Cuenta igual a la registrada | ESCALAR |
| Monto cuadra con el acuerdo | ESCALAR |
| Duplicado exacto | **FRENAR** |
| Posible duplicado (otro número, mismo concepto y mes) | ESCALAR |
| Límite por pago | **FRENAR** |
| Umbral de aprobación humana | ESCALAR |
| Presupuesto del periodo | ESCALAR |
| Saldo de la cuenta | ESCALAR |
| Vencimiento | ESCALAR |
| Periodo (mes en curso, America/Bogota) | ESCALAR |
| Tasa de cambio vigente | ESCALAR |

Código: [`src/engine/decide.ts`](src/engine/decide.ts), [`src/engine/checks.ts`](src/engine/checks.ts), [`src/engine/explain.ts`](src/engine/explain.ts).

Una persona puede desbloquear solo estos ocho (`HUMAN_OVERRIDABLE`): lectura, beneficiario, cuenta, acuerdo, posible duplicado, umbral, vencimiento y periodo. Nadie desbloquea el presupuesto, el saldo, el límite por pago, el duplicado exacto ni una moneda sin tasa.

## Seguridad por diseño

1. **Ningún modelo elige el resultado.** El único `return` de PAGAR está en `outcomeOf` ([`src/engine/decide.ts`](src/engine/decide.ts)). `decideWithOverrides` vuelve a llamar a `decide` y solo marca `overridden` en ids de `HUMAN_OVERRIDABLE`.
2. **La base se defiende sola.** [`decisions_guard`](supabase/migrations/20261018000300_pagar_check_ids.sql) rechaza un PAGAR del agente si no están los 13 ids distintos, todos en `cumple` y sin `overridden`. Un PAGAR humano solo tolera un veredicto distinto de `cumple` cuando `overridden` es un objeto y el id es uno de esos ocho. También con la clave de servicio. 13 copias del mismo id no bastan.
3. **Ningún miembro inserta decisiones.** El insert de `decisions` está revocado para `anon` y `authenticated`. Escribe el agente, con el rol de servicio.
4. **El registro es de solo adición.** PAGAR y FRENAR son finales (`FINAL_DECISION`). Un humano solo responde a un ESCALAR.
5. **Los enlaces de aprobación** van firmados con HMAC, vencen a las 48 horas (`TOKEN_TTL_MS` en [`src/lib/tokens.ts`](src/lib/tokens.ts)) y el par de una escalación se gasta una vez (`approval_uses`). Abrir el enlace no escribe nada ([`src/routes/approvals.ts`](src/routes/approvals.ts)).
6. **Concurrencia.** `insert_decision` toma `pg_advisory_xact_lock` sobre la empresa. Dos facturas no comprometen el mismo presupuesto. Si el mes cambió, el intento se repite con cifras nuevas.
7. **El proveedor no es de confianza.** La ruta de pago sale del directorio, no de la cuenta impresa en la factura. La guardia del monto ([`src/lib/amount-guard.ts`](src/lib/amount-guard.ts)) corre antes del modelo: una nota de crédito o un total que no cuadra deja el monto desconocido y la factura escala. RLS está activo en las 14 tablas de `public`.

El replay de las 29 no produce un PAGAR cuya etiqueta no sea PAGAR. Una fila que una prueba insertó por REST antes del trigger no es una decisión del agente; un insert igual, hoy, lo rechaza el trigger.

## Resultados

Medidos sobre las 29 facturas de Andina Labs ([`docs/demo/DATASET.md`](docs/demo/DATASET.md)):

- **Resultado correcto: 29/29.** 15 PAGAR, 3 FRENAR, 11 ESCALAR. El test corre en tres fechas (17 oct 2026, un minuto dentro de un mes, el último minuto de un mes de 31 días) con las tasas del 17 oct, y las 32 esquinas de ±20 % comparan cada factura con su etiqueta.
- **Autonomía: 18 de 29 (62 %).** 15 + 3. Una ESCALAR correcta no entra. `Math.round(100 * 18 / 29)` es 62.
- **Violaciones del agente: 0** en ese replay.
- **Pruebas:** `npm test` ejecuta **2332** pruebas de Vitest (Node 22.23.3, sin Playwright). Las suites de pantalla `scripts/ux-*.test.mjs` se omiten si Playwright no está instalado (`npm i -D playwright` para incluirlas). `bash scripts/tests/run.sh` corre el harness en bash y Python. Las dos órdenes están en [CI](.github/workflows/ci.yml).

## Cómo correrlo

Node >= 22.22 (see .nvmrc). En Node 22.14, `npm test` se cae en jsdom/undici. El archivo [`.nvmrc`](.nvmrc) fija la versión con la que corre CI.

```bash
npm ci
npm run lint && npm run typecheck && npm test && npm run build
bash scripts/tests/run.sh
```

Esas órdenes instalan, lintean, chequean tipos, corren la suite y construyen el cliente. No levantan un servidor y no hace falta una clave: Supabase, Bedrock, Workers AI y las tasas van simulados. Para ver el producto, abre la [demo en /demo](https://30x-hackathon.30x-hackathon-roberto-zuniga.workers.dev/demo).

**Desplegar** (Cloudflare Workers + Supabase): ajusta `account_id`, `APP_URL` y `SUPABASE_*` en [`wrangler.toml`](wrangler.toml); aplica las migraciones con `bash scripts/db-push.sh`; corre `npm run build && npx wrangler deploy` y luego `npx wrangler deploy -c portal/wrangler.toml`; sube los secretos con `bash scripts/worker-secrets.sh` (nombres en [`.env.example`](.env.example)); siembra la demo con `node scripts/seed-demo-user.mjs <URL>`.

## Arquitectura

Cloudflare Workers (Hono) sirve la API, la app (Vite + React) y los crones. El Worker `facturas` sirve el portal. Supabase pone Postgres con RLS, Auth y Storage. Amazon Nova Lite (Bedrock, us-east-2) lee; Workers AI es el respaldo. Yahoo Finance y open.er-api.com dan las tasas. El diagrama: [`docs/architecture/architecture.svg`](docs/architecture/architecture.svg). La prosa, con los límites de confianza, está en [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

| Ruta | Qué hay |
|---|---|
| [`src/agent/loop.ts`](src/agent/loop.ts) | ciclo del agente |
| [`src/engine/`](src/engine/) | los 13 controles, la tabla de consecuencias y las explicaciones |
| [`src/lib/llm.ts`](src/lib/llm.ts) | la única llamada a un modelo para leer o preguntar |
| [`src/lib/amount-guard.ts`](src/lib/amount-guard.ts) | guardia del monto, antes del modelo |
| [`web/`](web/) | la app |
| [`portal/`](portal/) | el portal de proveedores |
| [`supabase/migrations/`](supabase/migrations/) | esquema, RLS y triggers |
| [`docs/demo/DATASET.md`](docs/demo/DATASET.md) | las 29 facturas |

`.claude/` es el arnés con el que se construyó el repo, no el producto. El proceso largo está en la rama [`archive-full-main`](https://github.com/Robertzu43/30x-hackathon-roberto-zuniga/tree/archive-full-main).

## Tasas de cambio

Si la política no fija la moneda, el agente usa la tasa de mercado guardada, como máximo 48 horas antes de decidir (`FRESH_MS` en [`src/engine/checks.ts`](src/engine/checks.ts)). La cadena es Yahoo Finance y, si falla, open.er-api.com (`FX_PROVIDER` en [`wrangler.toml`](wrangler.toml); [`src/lib/fx.ts`](src/lib/fx.ts)). Sin tasa usable la factura escala: el control `moneda` no se puede desbloquear.

Para usar un número propio, la empresa lo escribe en Política (`fx_rates`). Eso es lo que hay hoy. No hay un conector a un banco, a una tesorería ni a una tasa de Blinka: la frase de la pantalla apunta aquí, y el camino construido es fijar la tasa en el formulario.

El set de la demo no fija tasas. Cada resultado esperado se mantiene dentro de ±20 % de las tasas del 17 oct 2026 (1 USD = 3.170,68 COP, 18,479 MXN, 5,0693 BRL, 1.517,5 ARS y 0,8895 EUR). El detalle está en [`docs/demo/DATASET.md`](docs/demo/DATASET.md).

## Facturas por correo

La entrada por correo está escrita y probada con correos de ejemplo ([`src/email/inbound.ts`](src/email/inbound.ts)). En el Worker desplegado `INBOUND_EMAIL_DOMAIN` está vacío ([`wrangler.toml`](wrangler.toml)), así que la ruta no recibe nada. Se enciende al poner el dominio al que Email Routing manda el catch-all; la dirección es `facturas+<slug>@<ese dominio>`.

El correo de escalación sale por Amazon SES ([`src/lib/email.ts`](src/lib/email.ts)). SES está en sandbox: solo llega a direcciones verificadas, y si faltan las claves la función anota el mensaje y sigue. Por eso la demo no pide un código por correo. Un fallo de envío no cambia la decisión.

## Lo que no está hecho

- **JEV** no está en el código de decisión. La pantalla `/demo` lo nombra y dice que está apagado.
- **Exportar a CSV** y **varias políticas por categoría** no están.
- **Telegram** no está. La pantalla Canales (portal, correo, Telegram) está descrita en [`docs/COPY.md`](docs/COPY.md) y no está en `src/i18n/`.
- **Fotos:** la guardia del monto solo ve el texto que transcribió el modelo.
- **Nota de crédito o total que no cuadra:** el monto queda desconocido y la factura escala.
- **Lectores caídos:** si Bedrock y el respaldo fallan, la factura entra sin leer y escala.
- **Celular:** las tarjetas reservan su altura ([`web/charts/lazy.tsx`](web/charts/lazy.tsx)) para que el gráfico no empuje la página. El aterrizaje en un teléfono todavía puede moverse un poco.

## Equipo

Roberto Zúñiga. Licencia [MIT](LICENSE).
