# Thesaurus, un agente de pagos construido para Blinka

**El problema, en palabras de Blinka:** "Construir un agente que revise las cuentas de una empresa y decida cuáles pagar por ella, dentro de las reglas que la empresa define, y que le pida permiso a una persona cuando algo se sale de esas reglas."

**Qué hace Thesaurus:** lee cada factura (PDF, imagen, correo o chat), la compara con lo acordado y con las reglas de la empresa, y decide sin que una persona intervenga. Cada decisión queda registrada y explicada con los valores reales.

**Tres resultados, nada más:** **PAGAR** (cumple las 13 reglas), **FRENAR** (cobro duplicado o sobre el límite por pago: final, no se paga) y **ESCALAR** (algo se sale de las reglas: el agente le hace una pregunta concreta a una persona y no paga hasta que responda). No mueve dinero real: decide, registra y explica.

**Pruébalo ahora, sin cuenta:** https://30x-hackathon.30x-hackathon-roberto-zuniga.workers.dev/demo y el botón **"Entrar como Andina Labs"** (empresa ficticia con 29 facturas, normales y trampa).

## Cómo trabaja el agente

Thesaurus es un agente, no solo un lector de PDF. Cada factura recorre el mismo ciclo: **percibe** (la factura llega por cualquier canal) → **lee** (el LLM convierte el documento en campos) → **consulta sus herramientas** (directorio, política, periodo, duplicados) → **decide** (el motor de reglas) → **actúa** (registra, escala, le escribe al aprobador una pregunta concreta, prepara la orden de pago) → **rinde cuentas** (el registro de la decisión).

**El LLM lee, JEV duda, el código decide, el agente actúa.**

Estado real de JEV: JEV, la intuición rápida, es una capa opcional; en esta demo está apagada. No está construida (ver "Lo que no está hecho"). Hoy el LLM solo lee, y el código decide con reglas fijas.

Esto es un prototipo de hackatón hecho para Blinka. No es un producto de Blinka ni usa su logo.

## Cómo decide

Cada factura pasa por 13 controles. Cada uno guarda el valor real, el umbral, la cuenta que se hizo y el veredicto (cumple / no cumple / no se pudo verificar). **Solo se paga si los 13 cumplen.** Una regla vacía en la política cuenta como "no se pudo verificar": una política vacía nunca paga.

| Control | Qué compara | Si falla |
|---|---|---|
| Lectura | beneficiario, monto, moneda y número leídos con confianza de 0,8 o más | ESCALAR |
| Beneficiario permitido | el beneficiario está en el directorio | ESCALAR ("beneficiario nuevo") |
| Cuenta del beneficiario | la cuenta de la factura es la registrada | ESCALAR ("cuenta cambiada") |
| Acuerdo | el monto cuadra con el retainer, la suscripción o el tope por horas | ESCALAR |
| Duplicado exacto | mismo beneficiario y mismo número dentro de la ventana de duplicados | FRENAR |
| Posible duplicado | mismo beneficiario, concepto y mes, con otro número | ESCALAR |
| Límite por pago | monto en USD no supera el límite | FRENAR |
| Umbral de aprobación | monto en USD no supera el umbral que exige una persona | ESCALAR |
| Presupuesto del periodo | comprometido (pagado + escalado pendiente) + esta factura no supera el presupuesto del mes | ESCALAR |
| Saldo de la cuenta | lo pagado + esta factura no supera el saldo simulado | ESCALAR |
| Vencimiento | no está vencida (más los días de gracia) | ESCALAR |
| Periodo | llegó en el mes en curso (America/Bogota) | ESCALAR |
| Moneda | la política tiene tasa para esa moneda | ESCALAR |

La tabla de consecuencias es fija y ningún campo de la política la cambia (D15). Si coinciden un motivo de FRENAR y uno de ESCALAR, gana FRENAR. FRENAR solo sale de un "no cumple" claro; si el dato falta ("no se pudo verificar"), la factura se escala.

**Quién puede anular qué (R-21).** Una persona puede aprobar lo que falló en estos controles: lectura, beneficiario permitido, cuenta, acuerdo, posible duplicado, umbral de aprobación, vencimiento y periodo. Al aprobar, el agente vuelve a correr los otros controles con el estado de ese momento: si el presupuesto se acabó mientras tanto, la factura se escala otra vez en lugar de pagarse. **Nadie puede aprobar por encima del presupuesto, del saldo o del límite por pago, ni un duplicado exacto, ni una moneda sin tasa**: para eso se cambia la política (nueva versión) y se reevalúa.

Reglas de apoyo: permitido significa nombre y cuenta en el directorio (D4); el periodo es el mes calendario en America/Bogota; presupuesto y saldo van en USD con la tasa fija de la política, impresa en cada registro que la usó (`monto x tasa`, 2 decimales); los montos `1.000,00` y `1,000.00` se leen igual y un monto ambiguo se escala; el presupuesto cuenta lo pagado más lo escalado pendiente, en orden de llegada (D5).

**Cómo se explica cada decisión.** El detalle de una factura muestra un titular de una frase; "Lo que hice" (pasos numerados en lenguaje claro, generados del registro real, nunca por un modelo); dos columnas, "Lo que leí" y "Lo que decidí" (cada control con valor, umbral y cuenta); "Qué tendría que pasar para pagarla"; la política usada (nombre, versión, fecha); y el historial con quién actuó y cuándo (Agente, correo vía enlace, correo en el tablero). Todo está en español e inglés con plantillas, sin texto escrito por un modelo.

## Seguridad por diseño

El criterio del reto es cero pagos fuera de las reglas. No depende de que el código "se porte bien": está impuesto en capas.

- **PAGAR solo sale de `decide()`.** Es una función pura (`src/engine/decide.ts`) que devuelve PAGAR únicamente si los 13 controles pasan. Ningún modelo decide ni escribe PAGAR: `src/agent` solo llama al lector (`extractFields`, en la etapa `lee`) y el único `AI.run` está en `src/lib/llm.ts`.
- **La base de datos rechaza un PAGAR fuera de las reglas (AC-69).** El trigger de `decisions` lanza `PAGAR_OUTSIDE_RULES` si un PAGAR del agente no trae los 13 controles en "cumple", o si uno humano tiene un control fallido que no fue anulado o que una persona no puede anular. Vale también para la clave de servicio, así que un error del Worker tampoco puede guardarlo.
- **Los miembros no escriben decisiones (AC-68).** Ninguna cuenta de usuario, ni la del demo público, puede insertar en `decisions`, `approval_tokens`, `approval_uses` ni `agent_runs`, ni llamar a `insert_decision`. Solo escribe el Worker, por `src/agent/record.ts`, el manejador del enlace de aprobación y el cron. La clave de servicio se construye en `src/lib/admin.ts` y solo esos tres módulos la importan.
- **Registro de solo adición.** No hay políticas de UPDATE ni DELETE sobre decisiones, tokens ni usos; una respuesta humana es una fila nueva. PAGAR y FRENAR son finales: la base se niega a agregar otra decisión a una factura ya pagada o frenada. Las facturas solo permiten cambiar `archived`.
- **Enlaces de aprobación de un solo uso.** Firmados con HMAC, vencen a las 48 horas, solo se guarda su hash, y el par aprobar/rechazar de una escalación se gasta junto. Abrir el enlace (GET) no escribe nada; solo el botón "Confirmar" (POST) actúa, para que los antivirus de correo no aprueben pagos.
- **Dos facturas a la vez no se saltan el presupuesto.** Cada decisión toma un candado por empresa y se rechaza si el estado del periodo cambió mientras se calculaba (`STALE_PERIOD`, se recalcula).
- **Cada empresa ve solo lo suyo.** RLS en todas las tablas desde su primera migración, archivos en un bucket privado con URL firmada de 5 minutos y 60 POST por minuto por usuario.

## Qué hace la app

- **Bandeja:** todas las facturas con su resultado y su razón en una línea, filtros por resultado y por beneficiario, "Nueva factura" (subir PDF o imagen, pegar un correo, pegar un chat), "Ejecutar agente" (con "Decidiendo facturas… n de m" mientras corre y el resumen "n PAGAR · n FRENAR · n ESCALAR" al terminar), la hora de la última revisión del agente ("automático" o "manual") y el aviso de que las facturas pagadas o frenadas no se reevalúan.
- **Detalle de decisión:** el registro completo descrito arriba, el documento original (PDF, imagen o texto) y, si se pagó, la orden de pago; en una factura escalada, la pregunta del agente, una nota opcional y los botones Aprobar y Rechazar.
- **Política:** formulario (nunca JSON) con los datos de la empresa (nombre, correo del aprobador, idioma), todas las reglas, la tabla de tasas y la lista de versiones; "Guardar como versión n" muestra qué facturas pendientes cambiarían de resultado sin escribir nada, y "Reevaluar pendientes" solo toca facturas pendientes o escaladas.
- **Beneficiarios:** el directorio ("lo acordado"): cuenta, ruta de pago y acuerdo.
- **Periodo:** selector de mes; presupuesto, saldo, pagado, comprometido, disponible, decisiones del mes, el desglose por beneficiario y las tres cifras del reto: Autonomía, Violaciones y Decisiones explicadas.
- **Aprobación por correo:** el aprobador recibe la pregunta y dos enlaces (`/approve/<token>`).
- **/demo:** página pública con el problema, el ciclo del agente, la Bandeja de solo lectura de Andina Labs y sus tres cifras, en español o inglés. "Entrar como Andina Labs" no pide código por correo; "Reiniciar demo" aparece solo con esa sesión.
- **Recorrido guiado:** 7 pasos (Bandeja, Nueva factura, Ejecutar agente, Detalle, Política, Beneficiarios, Periodo). Arranca solo en el primer ingreso (y siempre con la cuenta demo) y se repite con "Ver tutorial".

## Arquitectura

Cloudflare Workers (Hono) sirve la API y la app (Vite + React como assets estáticos). Supabase pone Postgres con RLS, Auth con código por correo y Storage. Workers AI solo lee documentos. AWS SES envía el correo.

| Etapa del agente | Archivo |
|---|---|
| percibe, lee, consulta, decide, actúa, rinde cuentas (el ciclo, en este orden) | `src/agent/loop.ts` (`runAgent`) |
| lee: documento a texto y campos con confianza | `src/lib/llm.ts` (único lugar donde se llama a un modelo), `src/prompts/extract.ts` |
| consulta: directorio, política, periodo, duplicados | `src/agent/tools.ts` |
| decide: los 13 controles y la tabla de consecuencias | `src/engine/decide.ts`, `src/engine/checks.ts` |
| actúa: guarda la decisión, crea los enlaces, hace la pregunta y escribe al aprobador | `src/agent/record.ts`, `src/agent/question.ts`, `src/lib/tokens.ts`, `src/lib/email.ts` |
| rinde cuentas: el registro y "Lo que hice" | `src/engine/explain.ts`, `src/agent/trace.ts`, y una fila en `agent_runs` por ejecución |
| el agente solo, cada 5 minutos | `src/agent/scheduled.ts`, con el cron `*/5 * * * *` de `wrangler.toml` |

Cada camino que decide una factura (subirla, "Ejecutar agente", el primer ingreso, "Reevaluar", "Reiniciar demo" y el cron) llama a `runAgent`. Con el cron, una factura pegada a las 02:00 se decide a las 02:05 sin nadie conectado. Si hay muchas facturas pendientes, las empresas se turnan entre pasadas. La Bandeja dice cuándo corrió el agente por última vez y si fue automático o manual.

Otras carpetas: `src/routes/` (API), `src/i18n/` (textos es/en), `web/pages/` (pantallas), `supabase/migrations/` (esquema, solo hacia adelante), `scripts/` (despliegue y semilla), `docs/demo/DATASET.md` (las 29 facturas de la demo con su resultado esperado y por qué).

## Cómo correrlo

```
npm ci
npm run lint && npm run typecheck && npm test && npm run build
bash scripts/tests/run.sh
```

Las pruebas usan Supabase y el modelo simulados; no necesitan red. `scripts/tests/run.sh` además aplica las migraciones a un Postgres 15+ local temporal si existe uno. Para correr la app necesitas un proyecto de Supabase y las variables de `.env.example` (nunca en un archivo versionado): `npm run build`, un `.dev.vars` local con `SUPABASE_SERVICE_ROLE_KEY` y `APPROVAL_HMAC_SECRET` (ignorado por git), y `npx wrangler dev`. Sin las claves de SES el correo no se envía: queda en el log y el registro dice que no se pudo enviar.

## Cómo desplegarlo

Antes de desplegar en otra cuenta, cambia en `wrangler.toml` lo que hoy apunta a las cuentas de Roberto: `account_id` (Cloudflare), el `id` del namespace KV (créalo con `npx wrangler kv namespace create KV`) y las variables `APP_URL` (la URL del Worker) y `SUPABASE_URL` (junto con `SUPABASE_ANON_KEY`, de tu proyecto de Supabase).

1. Variables de la sesión: las de `.env.example`. Los valores públicos (URL de Supabase, clave anónima, modelos) están en `wrangler.toml`.
2. Migraciones: `bash scripts/db-push.sh` (por la API de gestión de Supabase; solo aplica las que faltan).
3. Primer despliegue: `npm run build` y `npx wrangler deploy`. Crea el Worker y registra el cron de 5 minutos.
4. Secretos del Worker, ya con el Worker creado: `bash scripts/worker-secrets.sh` sube los que estén definidos en el entorno (`AWS_SES_ACCESS_KEY_ID`, `AWS_SES_SECRET_ACCESS_KEY`, `SES_FROM_EMAIL`, `SUPABASE_SERVICE_ROLE_KEY` y los opcionales) y no imprime valores. `APPROVAL_HMAC_SECRET` se genera una vez con `openssl rand -hex 32 | npx wrangler secret put APPROVAL_HMAC_SECRET`. Los secretos se leen en cada petición: no hace falta volver a desplegar.
5. `curl <URL>/api/health` debe responder `{"ok":true}`; luego `node scripts/seed-demo-user.mjs <URL>` crea (o repara) el acceso "Entrar como Andina Labs".

## Cómo conectar SES u otro servicio de correo

Todo correo que sale del Worker (la pregunta al aprobador) pasa por una función, `sendEmail` en `src/lib/email.ts`. Hoy firma SES v2 con SigV4 y, si faltan las claves, no envía y lo registra. Para usar otro proveedor se reemplaza el cuerpo de esa función; los llamadores no cambian y las pruebas la simulan. El código de 6 dígitos del ingreso lo envía Supabase Auth con su propio SMTP: ese se cambia en la configuración de autenticación de Supabase, no en este repo.

## Lo que no está hecho

Esta lista es honesta a propósito. Cada punto se verificó contra el código o el registro.

- **Correo de producción de SES (AC-54, AC-55, SHOULD).** AWS negó el acceso de producción. SES está en modo de pruebas y solo entrega a direcciones verificadas, así que el código de ingreso y el correo de aprobación no llegan a cualquiera. El código de envío está probado con SES simulado (`src/lib/email.test.ts`); la entrega real a la dirección del aprobador no la verifiqué en vivo. Por eso el demo no necesita correo: "Entrar como Andina Labs" no pide código y la empresa demo nunca envía correos ni crea enlaces.
- **JEV no existe todavía.** La capa opcional (TypeSafe/JEV, SHOULD S2) no está construida: en el código solo existen la variable `JEV_ENABLED` (apagada) y su tipo. Por eso se dice "apagada". La seguridad no depende de ella.
- **Otras funciones SHOULD sin construir:** exportar el registro a CSV, "Pregúntale a Thesaurus" (chat sobre el registro), el botón "Invitar", varias políticas por categoría y exportar/importar la política en JSON. No hay rastro de ellas en `src/` ni `web/`.
- **Plan gratuito de Cloudflare.** La cuenta está en Workers Free (50 subrequests por invocación). Una ejecución del agente se reparte en lotes de como máximo 40 subrequests contados, y el navegador sigue pidiendo lotes hasta terminar ("Decidiendo facturas… n de m"). El cron hace lo mismo y las empresas se turnan. En un plan de pago se sube la constante `SUBREQUESTS` de `src/lib/supabase.ts`, el único valor que cambia. Efecto: con muchas facturas pendientes, parte de ellas espera al siguiente ciclo de 5 minutos.
- **Límite diario del lector (Workers AI gratuito).** En el plan gratuito de Cloudflare, Workers AI da unas 10.000 neuronas al día; una lectura gasta unas 39, así que el lector hace unas 250 lecturas diarias. El cupo se reinicia a las 00:00 UTC (19:00 en Bogotá). Cuando se acaba, o si el modelo falla o no responde en 20 segundos, si el lector no está disponible la factura entra como ESCALAR «sin leer»: el registro dice «factura sin leer: el lector de facturas no estaba disponible» (no «ilegible»), no se inventa ningún dato y nada se reintenta solo; hay que volver a ingresarla más tarde y rechazar la copia sin leer. Las facturas sembradas y las decisiones posteriores (aprobar, rechazar, reevaluar) nunca dependen del lector. Un plan de pago de Workers levanta el límite.
- **Guardia del monto en fotos.** La guardia del monto (nota crédito, total que no cuadra) revisa el texto exacto del PDF, del correo y del chat. En una foto solo ve lo que el modelo de visión transcribió: si la transcripción omite o cambia el total, la guardia no lo ve.
- **Licencia del modelo de visión, una vez por cuenta.** Las imágenes se leen con `@cf/meta/llama-3.2-11b-vision-instruct`, que exige aceptar su licencia una sola vez por cuenta de Cloudflare enviándole `{"prompt":"agree"}`. Sin esa aceptación, toda imagen entra como factura «sin leer».
- **Filas de prueba de QA en la base real.** Quedan empresas `qa-r202610162341-*` creadas durante las pruebas. No se pueden borrar (el proyecto no borra datos) y no se pueden falsificar más. Si consultas la tabla de decisiones sin filtro, verás filas de esas empresas.
- **Fechas de los PDF.** Los PDF de `/demo/invoices/` imprimen las fechas del día en que se generaron; las facturas sembradas llevan fechas relativas al momento de la siembra (para que los casos de vencida y fuera del periodo funcionen cualquier día). Pueden no coincidir.
- **Lectura con el modelo real.** Solo se comprobó el modelo con una llamada de verificación y con pruebas con un modelo simulado; no se midió su exactitud con facturas reales. Un PDF escaneado sin capa de texto, o una imagen que el modelo no lee, entra como ESCALAR "ilegible". Las facturas sembradas traen sus campos ya extraídos, así que la demo funciona aunque el modelo falle.
- **Revisión visual.** La interfaz se probó con pruebas automáticas; en el entorno de construcción no había navegador, así que no hubo revisión visual de las pantallas en un navegador real.
- **Una factura FRENAR corregida necesita un número nuevo (R-20).** FRENAR es final. Si el proveedor reenvía la misma factura con el mismo número, vuelve a salir FRENAR como duplicado exacto; con un número nuevo entra como posible duplicado y una persona decide.
- **Cambio de mes.** Una factura pendiente del mes anterior que el agente decide en el mes nuevo se escala por "fuera del periodo" (R-42). Es intencional.
- **Nota sobre una migración.** `supabase/migrations/20261015000000_files_bucket.sql` contiene el comentario inerte `-- delete from storage.buckets`. Se escribió antes de esta ejecución, ya está aplicada y las migraciones aplicadas no se editan; no es SQL ejecutable (AC-07).
- **Un solo usuario por empresa.** Operador y aprobador son la misma persona, y la clave del usuario demo es pública a propósito.
- **Preguntas abiertas para Roberto (`docs/QUESTIONS.md`, cada una con una decisión provisional):**
  - Q1: Autonomía cuenta solo PAGAR y FRENAR correctos de la primera decisión del agente, no las escaladas correctas.
  - Q2: la ventana de duplicados limita hasta dónde mira atrás el duplicado exacto.
  - Q3: una persona no puede aprobar por encima del presupuesto, el saldo o el límite por pago; se cambia la política.
  - Q4: la factura en COP que supera el límite en USD es FRENAR (límite por pago); el caso del umbral queda como extra.
  - Q5: los miembros no escriben decisiones; solo el Worker, y la base rechaza un PAGAR fuera de las reglas.
  - Q6: una factura escalada por falta de presupuesto sigue contando como comprometida (conservador); el video rechaza una antes de aprobar Nube Sur.
  - Q7: seguir en el plan gratuito de Cloudflare; subir de plan cuesta USD 5 al mes.

## Registro de decisiones y entrega

Cada tarea, cada debate y cada decisión, con su razón en lenguaje claro, están en [`docs/LEDGER.md`](docs/LEDGER.md). La especificación con los criterios de aceptación es `docs/SPEC.md`. Los textos para el formulario de entrega (descripción para el jurado, enlaces) están en [`docs/SUBMISSION.md`](docs/SUBMISSION.md).
