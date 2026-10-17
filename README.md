# Thesaurus, un agente de pagos construido para Blinka

**El problema, en palabras de Blinka:** "Construir un agente que revise las cuentas de una empresa y decida cuáles pagar por ella, dentro de las reglas que la empresa define, y que le pida permiso a una persona cuando algo se sale de esas reglas."

**Qué hace Thesaurus:** lee cada factura (PDF, imagen, correo, chat o el portal de proveedores), la compara con lo acordado y con las reglas de la empresa, y decide sin que una persona intervenga. Cada decisión queda registrada y explicada con los valores reales.

**Tres resultados, nada más:** **PAGAR** (cumple las 13 reglas), **FRENAR** (cobro duplicado o sobre el límite por pago: final, no se paga) y **ESCALAR** (algo se sale de las reglas: el agente le hace una pregunta concreta a una persona y no paga hasta que responda). No mueve dinero real: decide, registra y explica.

**Pruébalo ahora, sin cuenta:** https://30x-hackathon.30x-hackathon-roberto-zuniga.workers.dev/demo y el botón **"Entrar como Andina Labs"** (empresa ficticia con 29 facturas, normales y trampa). Un proveedor también puede enviar su factura sin cuenta en el portal: https://facturas.30x-hackathon-roberto-zuniga.workers.dev/andina-labs

## Dónde actúa la IA y dónde decide el código

> Dónde actúa la IA: lee cada factura (Amazon Nova Lite en AWS Bedrock) y responde tus preguntas sobre el registro («Pregúntale a Thesaurus»). Dónde decide el código: las 13 reglas, la tabla de consecuencias y la tasa de cambio del día; solo el código puede escribir PAGAR.

- **Qué modelo.** El lector de facturas y el chat corren en Amazon Nova Lite (AWS Bedrock, región us-east-2; el modelo es la variable `BEDROCK_MODEL_ID` de `wrangler.toml`). Si Bedrock falla o no responde en 20 segundos, el respaldo es Workers AI (`WORKERS_AI_MODEL`, `WORKERS_AI_VISION_MODEL`). Solo `src/lib/llm.ts` llama a un modelo. Una factura entra «sin leer» únicamente cuando los dos proveedores fallan (ver "Lo que no está hecho").
- **Qué se ve.** El detalle de cada factura dice «Leído por IA · <proveedor>» cuando un modelo leyó los datos, y cada respuesta del chat dice que la generó una IA, que puede equivocarse y que el registro manda. El chat solo lee el registro: no aprueba ni paga nada, y ninguna respuesta se convierte en acción.
- **Topes del chat (AC-67).** 500 caracteres por pregunta, 10 preguntas por usuario por día UTC (con el usuario demo compartido, por visitante e IP) y 500 por día en todo el despliegue; el cupo se renueva a las 19:00 de Bogotá. Los dos números están en la función SQL `take_question` (`supabase/migrations/20261017000700_ai_usage.sql`: `u.n < 10` y `u.n < 500`). Para subirlos se agrega una migración nueva con `create or replace function public.take_question` (las migraciones aplicadas no se editan); el límite de 500 caracteres está en `Body` de `src/routes/ask.ts`. Al llegar a un tope el chat responde con un aviso, nunca con un error, y las decisiones no dependen de la IA.
- **Dónde no hay IA.** Los textos de "Lo que hice", de los controles y de las respuestas al proveedor salen de plantillas con valores reales. Ningún modelo escribe un texto que lea un proveedor.

## Cómo trabaja el agente

Thesaurus es un agente, no solo un lector de PDF. Cada factura recorre el mismo ciclo: **percibe** (la factura llega por cualquier canal) → **lee** (el modelo convierte el documento en campos) → **consulta sus herramientas** (directorio, política, periodo, duplicados) → **decide** (el motor de reglas) → **actúa** (registra, escala, le escribe al aprobador una pregunta concreta, prepara la orden de pago) → **rinde cuentas** (el registro de la decisión).

**El LLM lee, JEV duda, el código decide, el agente actúa.**

Estado real de JEV: JEV, la intuición rápida, es una capa opcional; en esta demo está apagada. No está construida (ver "Lo que no está hecho"). Hoy el LLM solo lee, y el código decide con reglas fijas.

Esto es un prototipo de hackatón hecho para Blinka. No es un producto de Blinka ni usa su logo: el logo que se ve en la app, el portal y los correos es el propio de Thesaurus (`web/public/brand/`).

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
| Moneda | hay una tasa vigente para esa moneda: la fijada por la política o la de mercado de hace menos de 48 horas | ESCALAR |

La tabla de consecuencias es fija y ningún campo de la política la cambia (D15). Si coinciden un motivo de FRENAR y uno de ESCALAR, gana FRENAR. FRENAR solo sale de un "no cumple" claro; si el dato falta ("no se pudo verificar"), la factura se escala.

**Quién puede anular qué (R-21).** Una persona puede aprobar lo que falló en estos controles: lectura, beneficiario permitido, cuenta, acuerdo, posible duplicado, umbral de aprobación, vencimiento y periodo. Al aprobar, el agente vuelve a correr los otros controles con el estado de ese momento: si el presupuesto se acabó mientras tanto, la factura se escala otra vez en lugar de pagarse. **Nadie puede aprobar por encima del presupuesto, del saldo o del límite por pago, ni un duplicado exacto, ni una moneda sin tasa vigente**: para eso se cambia la política (nueva versión) y se reevalúa.

Reglas de apoyo: permitido significa nombre y cuenta en el directorio (D4); el periodo es el mes calendario en America/Bogota; presupuesto y saldo van en USD con la tasa que usó la decisión (fijada por la política o de mercado), impresa en cada registro con su fuente y su hora (`monto x tasa`, 2 decimales); los montos `1.000,00` y `1,000.00` se leen igual y un monto ambiguo se escala; el presupuesto cuenta lo pagado más lo escalado pendiente, en orden de llegada (D5).

**Cómo se explica cada decisión.** El detalle de una factura muestra un titular de una frase; "Lo que hice" (pasos numerados en lenguaje claro, generados del registro real, nunca por un modelo); dos columnas, "Lo que leí" y "Lo que decidí" (cada control con valor, umbral y cuenta); "Qué tendría que pasar para pagarla"; la política usada (nombre, versión, fecha); y el historial con quién actuó y cuándo (Agente, correo vía enlace, correo en el tablero). Todo está en español e inglés con plantillas, sin texto escrito por un modelo.

## Seguridad por diseño

El criterio del reto es cero pagos fuera de las reglas. No depende de que el código "se porte bien": está impuesto en capas.

- **PAGAR solo sale de `decide()`.** Es una función pura (`src/engine/decide.ts`) que devuelve PAGAR únicamente si los 13 controles pasan. Ningún modelo decide ni escribe PAGAR: el agente solo llama al lector (`extractFields`, en la etapa `lee`), el chat solo lee el registro, y los modelos se llaman únicamente desde `src/lib/llm.ts` (Bedrock y el único `AI.run`).
- **La base de datos rechaza un PAGAR fuera de las reglas (AC-69).** El trigger de `decisions` lanza `PAGAR_OUTSIDE_RULES` si un PAGAR del agente no trae los 13 controles en "cumple", o si uno humano tiene un control fallido que no fue anulado o que una persona no puede anular. Vale también para la clave de servicio, así que un error del Worker tampoco puede guardarlo.
- **Los miembros no escriben decisiones (AC-68).** Ninguna cuenta de usuario, ni la del demo público, puede insertar en `decisions`, `approval_tokens`, `approval_uses` ni `agent_runs`, ni llamar a `insert_decision`. El portal de proveedores no tiene ningún secreto: solo llama al Worker principal por un servicio interno. Solo escribe el Worker, por `src/agent/record.ts`, el manejador del enlace de aprobación y el cron. La clave de servicio se construye en `src/lib/admin.ts` y solo esos tres módulos la importan.
- **Registro de solo adición.** No hay políticas de UPDATE ni DELETE sobre decisiones, tokens ni usos; una respuesta humana es una fila nueva. PAGAR y FRENAR son finales: la base se niega a agregar otra decisión a una factura ya pagada o frenada. Las facturas solo permiten cambiar `archived`.
- **Enlaces de aprobación de un solo uso.** Firmados con HMAC, vencen a las 48 horas, solo se guarda su hash, y el par aprobar/rechazar de una escalación se gasta junto. Abrir el enlace (GET) no escribe nada; solo el botón "Confirmar" (POST) actúa, para que los antivirus de correo no aprueben pagos.
- **Dos facturas a la vez no se saltan el presupuesto.** Cada decisión toma un candado por empresa y se rechaza si el estado del periodo cambió mientras se calculaba (`STALE_PERIOD`, se recalcula).
- **Cada empresa ve solo lo suyo.** RLS en todas las tablas desde su primera migración, archivos en un bucket privado con URL firmada de 5 minutos y 60 POST por minuto por usuario.

## Qué hace la app

- **Bandeja:** todas las facturas con su resultado y su razón en una línea, filtros por resultado y por beneficiario, «Pregúntale a Thesaurus» (el chat sobre el registro), "Nueva factura" (subir PDF o imagen, pegar un correo, pegar un chat), "Ejecutar agente" (con "Decidiendo facturas… n de m" mientras corre y el resumen "n PAGAR · n FRENAR · n ESCALAR" al terminar), la hora de la última revisión del agente ("automático" o "manual") y el aviso de que las facturas pagadas o frenadas no se reevalúan.
- **Detalle de decisión:** el registro completo descrito arriba, «Leído por IA» cuando un modelo leyó la factura, «Pregúntale a Thesaurus» sobre esa factura, el documento original (PDF, imagen o texto) y, si se pagó, la orden de pago; en una factura escalada, la pregunta del agente, una nota opcional y los botones Aprobar y Rechazar.
- **Política:** formulario (nunca JSON) con los datos de la empresa (nombre, correo del aprobador, idioma), todas las reglas, la tabla «Tasas de mercado» (solo lectura, ver «Tasas de cambio»), las tasas fijadas por la política (opcionales) y la lista de versiones; "Guardar como versión n" muestra qué facturas pendientes cambiarían de resultado sin escribir nada, y "Reevaluar pendientes" solo toca facturas pendientes o escaladas.
- **Beneficiarios:** el directorio ("lo acordado"): cuenta, ruta de pago y acuerdo.
- **Periodo:** selector de mes; presupuesto, saldo, pagado, comprometido, disponible, decisiones del mes, el desglose por beneficiario y las tres cifras del reto: Autonomía, Violaciones y Decisiones explicadas.
- **Portal de proveedores y correo:** un proveedor envía su factura sin cuenta por un enlace (ver «Portal de proveedores»), y el código de la entrada por correo está construido y probado (ver «Facturas por correo»).
- **Aprobación por correo:** el aprobador recibe la pregunta y dos enlaces (`/approve/<token>`).
- **/demo:** página pública con el problema, el ciclo del agente, la Bandeja de solo lectura de Andina Labs y sus tres cifras, en español o inglés, con la frase de «Dónde actúa la IA» junto a las seis etapas (etiquetas «IA» y «código»). "Entrar como Andina Labs" no pide código por correo; "Reiniciar demo" aparece solo con esa sesión.
- **Recorrido guiado:** 7 pasos (Bandeja, Nueva factura, Ejecutar agente, Detalle, Política, Beneficiarios, Periodo). Arranca solo en el primer ingreso (y siempre con la cuenta demo) y se repite con "Ver tutorial".

## Arquitectura

Cloudflare Workers (Hono) sirve la API y la app (Vite + React como assets estáticos). Supabase pone Postgres con RLS, Auth con código por correo y Storage. Amazon Nova Lite (AWS Bedrock) lee documentos y responde el chat, con Workers AI de respaldo. Un segundo Worker, `facturas` (`portal/`), sirve el portal de proveedores. Las tasas de mercado se guardan en Supabase. AWS SES envía el correo.

| Etapa del agente | Archivo |
|---|---|
| percibe, lee, consulta, decide, actúa, rinde cuentas (el ciclo, en este orden) | `src/agent/loop.ts` (`runAgent`) |
| lee: documento a texto y campos con confianza | `src/lib/llm.ts` (único lugar donde se llama a un modelo: Bedrock y luego Workers AI), `src/prompts/extract.ts` |
| consulta: directorio, política, periodo, duplicados, tasa de cambio | `src/agent/tools.ts`, `src/lib/fx.ts` |
| decide: los 13 controles y la tabla de consecuencias | `src/engine/decide.ts`, `src/engine/checks.ts` |
| actúa: guarda la decisión, crea los enlaces, hace la pregunta y escribe al aprobador | `src/agent/record.ts`, `src/agent/question.ts`, `src/lib/tokens.ts`, `src/lib/email.ts` |
| rinde cuentas: el registro y "Lo que hice" | `src/engine/explain.ts`, `src/agent/trace.ts`, y una fila en `agent_runs` por ejecución |
| el agente solo, cada 5 minutos; las tasas, a diario | `src/agent/scheduled.ts`, con los crones `*/5 * * * *` y `0 11 * * *` (06:00 Bogotá) de `wrangler.toml` |
| las otras entradas de facturas | portal: `portal/`, `src/portal-api.ts`; correo: `src/email/inbound.ts`; las dos pasan por `src/agent/intake.ts` y `runAgent` |

Cada camino que decide una factura (subirla, el portal, el correo, "Ejecutar agente", el primer ingreso, "Reevaluar", "Reiniciar demo" y el cron) llama a `runAgent`. Con el cron, una factura pegada a las 02:00 se decide a las 02:05 sin nadie conectado. Si hay muchas facturas pendientes, las empresas se turnan entre pasadas. La Bandeja dice cuándo corrió el agente por última vez y si fue automático o manual.

Otras carpetas: `src/routes/` (API), `src/i18n/` (textos es/en), `web/pages/` (pantallas), `supabase/migrations/` (esquema, solo hacia adelante), `scripts/` (despliegue y semilla), `docs/demo/DATASET.md` (las 29 facturas de la demo con su resultado esperado y por qué).

## Tasas de cambio

Las facturas en otra moneda se pasan a USD con una tasa de mercado, no con un número escrito a mano. Cada día a las 06:00 de Bogotá (cron `0 11 * * *`), y cuando el agente necesita una moneda cuya tasa más reciente no es de hoy, `src/lib/fx.ts` consulta primero Yahoo Finance y, si falla, open.er-api.com. Cubre COP, MXN, BRL, ARS y EUR, más cada moneda fijada en alguna política. Las tasas se guardan (solo se agregan filas) en la tabla `fx_rates`, y la pantalla Política las muestra en «Tasas de mercado» (`GET /api/fx`).

- **Qué tasa usa una decisión.** Primero la tasa fijada por la política para esa moneda, si existe (la sección «Tasas fijadas por la política» es opcional). Si no, la tasa de mercado guardada, siempre que se haya consultado hace 48 horas o menos (la regla de las 48 h). Si no hay ninguna, el control «Moneda» queda en «no se pudo verificar» y la factura se escala; nadie puede aprobarla por encima de eso hasta que haya una tasa vigente o una fijada. «Reevaluar», la vista previa de la política y las aprobaciones nunca consultan: usan lo guardado.
- **Guardas.** Un valor que no sea un número mayor que 0, o que se aleje más de 25 % de la última tasa guardada, se descarta y se prueba el siguiente proveedor. Si todos fallan, no se guarda nada y el error queda en el log.
- **La tasa fijada ("pin").** En Política, una moneda con tasa fija ignora el mercado; la tasa de cada decisión se imprime en su registro con su fuente y su hora, o como «tasa fijada por la política v<n>».
- **Cambiar de proveedor.** `src/lib/fx.ts` exporta `interface FxProvider { name: string; fetchRates(currencies: string[]): Promise<Rate[]> }`. La variable `FX_PROVIDER` de `wrangler.toml` (`yahoo` o `er-api`) elige cuál va primero; el otro es el respaldo.
- **Conectar la tasa del banco, del proveedor de tesorería o la de Blinka.** (1) Escribe un `FxProvider` en `src/lib/fx.ts`, siguiendo `yahoo` y `erApi`: `fetchRates` devuelve filas `Rate` cuyo `usd_per_unit` sale de `usdPerUnit(<unidades por USD>)`, con su fuente (por ejemplo `'Banco X'`). (2) Agrégalo a la lista que arma `providers()`, con su nombre. (3) Pon ese nombre en `FX_PROVIDER` y despliega. Las guardas, la regla de las 48 h y los registros no cambian. Un secreto del proveedor se sube con `npx wrangler secret put`, nunca al repositorio.
- **Cómo verlo.** `npx vitest run src/lib/fx.test.ts`; en vivo, Política, «Tasas de mercado».

## Portal de proveedores

El proveedor no necesita cuenta. La empresa le da su enlace, `https://facturas.30x-hackathon-roberto-zuniga.workers.dev/<enlace de la empresa>` (el de la demo es `/andina-labs`), y el proveedor ve una página de chat con el logo de Thesaurus, un saludo «Hola, soy Thesaurus, el agente de pagos de <empresa>», un selector es/en (abre en español), una caja de mensaje (1 a 20.000 caracteres) y un botón para adjuntar un PDF, PNG o JPEG de hasta 10 MB. La factura queda en esa empresa con origen «portal», la decide el mismo `runAgent` y, si escala, el aprobador recibe la pregunta (nunca en la empresa demo).

- **Qué ve el proveedor.** Una respuesta armada con plantillas y valores guardados: lo que se leyó (beneficiario, monto y moneda, número; «no pude leerlo» si falta), el estado en palabras fijas (en revisión, aprobada para pago, requiere aprobación de la empresa, rechazada: duplicada, rechazada: no cumple las condiciones de pago, rechazada por la empresa) y un enlace de estado `/estado/<token>` que puede reabrir y copiar. Si se manda un archivo y un texto, el archivo es la factura y el texto queda como «Mensaje del proveedor» que ningún modelo lee. Si no hay lector disponible, la factura se guarda y se le dice que la empresa la revisará.
- **Qué nunca ve.** Ninguna razón más allá de esas palabras, ninguna cuenta bancaria (ni la leída ni la registrada), ningún control, titular, valor de la política ni aprobador, y ninguna otra factura. Un enlace desconocido da una página 404 que no lista empresas. El pago siempre va a la cuenta del directorio, no a la que diga el proveedor: si no coincide, la factura se escala como «cuenta cambiada».
- **Límites.** 10 facturas por hora por IP, 100 por día por empresa (compartidas con el correo) y 60 consultas de estado por minuto por IP; sobre el límite no se guarda nada y la respuesta es 429. Los contadores viven en la base (`intake_rate_limits`) y los números en la función SQL `intake_hit` (`supabase/migrations/20261017000800_portal.sql`: `10`, `100` y `60`); para cambiarlos, una migración nueva con `create or replace function public.intake_hit`. Tipo, tamaño y largo se validan en el servidor.
- **Aislamiento.** El Worker `facturas` (`portal/wrangler.toml`) no guarda ningún secreto ni la URL de Supabase: solo sirve archivos estáticos y llama al Worker principal por un servicio interno (`PortalApi`). Toda respuesta lleva Content-Security-Policy estricta.
- **Cómo verlo.** `npx vitest run src/portal-api.test.ts src/agent/intake.test.ts`; en vivo, abre el enlace de la demo en una ventana privada y pega el texto de una factura (cada lectura es una llamada a Bedrock).

## Facturas por correo

Está construida y probada con archivos `.eml` de ejemplo, pero apagada hasta que la empresa conecte un dominio (ver abajo). Cuando un correo llega al Worker (`email()` en `src/index.ts`, `src/email/inbound.ts`) pasa lo siguiente: se lee el MIME con `postal-mime`; la empresa sale del destinatario, `facturas+<enlace>@<dominio>` o `<enlace>@<dominio>` (uno desconocido se rechaza con «Dirección desconocida» y no se guarda nada); cada PDF, PNG o JPEG de hasta 10 MB es una factura, hasta 3 por correo; sin adjuntos, el texto del correo (1 a 20.000 caracteres) es una factura; cualquier otro adjunto se ignora y se avisa en la respuesta. Las decide `runAgent`, igual que el portal, y el remitente recibe una sola respuesta (`src/lib/email.ts`) con el estado y el enlace de cada factura. No hay respuesta a mensajes automáticos (`Auto-Submitted`, `Precedence: bulk|list|junk`), a remitentes inválidos ni al propio dominio, y sobre el límite (10 correos por remitente por hora, más el tope por empresa del portal) no se guarda ni se responde nada. El remitente no es de confianza: el pago va solo a la cuenta del directorio.

Para encenderla (pasos de Roberto o de la empresa, nada de esto se ejecutó en vivo):

1. Agrega un dominio a la cuenta de Cloudflare.
2. En Email Routing de ese dominio, crea una regla catch-all cuyo destino sea el Worker `30x-hackathon`.
3. Pon ese dominio en `INBOUND_EMAIL_DOMAIN` (`wrangler.toml`, `[vars]`) y despliega.
4. Recuerda que SES entrega las respuestas solo a direcciones verificadas hasta que AWS conceda el acceso de producción (AC-55): sin eso, la factura se registra pero la respuesta puede no llegar.

Evidencia: `npx vitest run src/email` (10 correos de ejemplo en `src/email/__fixtures__/`, con base de datos, proveedor y `sendEmail` simulados) y `grep -n "email:" src/index.ts`.

## Cómo correrlo

```
npm ci
npm run lint && npm run typecheck && npm test && npm run build
bash scripts/tests/run.sh
```

Las pruebas usan Supabase, Bedrock, Workers AI, Yahoo y open.er-api.com simulados o con respuestas grabadas; no necesitan red y no gastan ninguna cuota. `scripts/tests/run.sh` además aplica las migraciones a un Postgres 15+ local temporal si existe uno. Para correr la app necesitas un proyecto de Supabase y las variables de `.env.example` (nunca en un archivo versionado): `npm run build`, un `.dev.vars` local con `SUPABASE_SERVICE_ROLE_KEY` y `APPROVAL_HMAC_SECRET` (ignorado por git), y `npx wrangler dev`. Sin las claves de SES el correo no se envía: queda en el log y el registro dice que no se pudo enviar. Sin las claves de Bedrock (`AWS_BEDROCK_ACCESS_KEY_ID` y `AWS_BEDROCK_SECRET_ACCESS_KEY`) el lector y el chat usan Workers AI. Para revisar las pantallas con un navegador (360 a 1440 px, es y en), `npm run ux:gate -- --base <URL>`.

## Cómo desplegarlo

Antes de desplegar en otra cuenta, cambia en `wrangler.toml` lo que hoy apunta a las cuentas de Roberto: `account_id` (Cloudflare) y las variables `APP_URL` (la URL del Worker) y `SUPABASE_URL` (junto con `SUPABASE_ANON_KEY`, de tu proyecto de Supabase).

1. Variables de la sesión: las de `.env.example`. Los valores públicos (URL de Supabase, clave anónima, modelos) están en `wrangler.toml`.
2. Migraciones: `bash scripts/db-push.sh` (por la API de gestión de Supabase; solo aplica las que faltan).
3. Primer despliegue: `npm run build` y `npx wrangler deploy`. Crea el Worker y registra los dos crones (cada 5 minutos y las tasas diarias). Después, el portal: `npx wrangler deploy -c portal/wrangler.toml` (Worker `facturas`; despliégalo siempre después del principal, y cambia `PORTAL_URL` en `wrangler.toml` por su URL).
4. Secretos del Worker, ya con el Worker creado: `bash scripts/worker-secrets.sh` sube los que estén definidos en el entorno (`AWS_SES_ACCESS_KEY_ID`, `AWS_SES_SECRET_ACCESS_KEY`, `SES_FROM_EMAIL`, `SUPABASE_SERVICE_ROLE_KEY` y los opcionales) y no imprime valores. Las dos claves de Bedrock no están en ese script: súbelas una por una con `npx wrangler secret put AWS_BEDROCK_ACCESS_KEY_ID` y `npx wrangler secret put AWS_BEDROCK_SECRET_ACCESS_KEY`. `APPROVAL_HMAC_SECRET` se genera una vez con `openssl rand -hex 32 | npx wrangler secret put APPROVAL_HMAC_SECRET`. Los secretos se leen en cada petición: no hace falta volver a desplegar.
5. `curl <URL>/api/health` debe responder `{"ok":true}`; luego `node scripts/seed-demo-user.mjs <URL>` crea (o repara) el acceso "Entrar como Andina Labs" y el enlace `/andina-labs` del portal.

## Cómo conectar SES u otro servicio de correo

Todo correo que sale del Worker (la pregunta al aprobador y la respuesta al proveedor) pasa por una función, `sendEmail` en `src/lib/email.ts`. Hoy firma SES v2 con SigV4 y, si faltan las claves, no envía y lo registra. Para usar otro proveedor se reemplaza el cuerpo de esa función; los llamadores no cambian y las pruebas la simulan. El código de 6 dígitos del ingreso lo envía Supabase Auth con su propio SMTP: ese se cambia en la configuración de autenticación de Supabase, no en este repo.

## Lo que no está hecho

Esta lista es honesta a propósito. Cada punto se verificó contra el código o el registro.

- **Correo de producción de SES (AC-54, AC-55, SHOULD).** AWS negó el acceso de producción. SES está en modo de pruebas y solo entrega a direcciones verificadas, así que el código de ingreso y el correo de aprobación no llegan a cualquiera. El código de envío está probado con SES simulado (`src/lib/email.test.ts`); la entrega real a la dirección del aprobador no la verifiqué en vivo. Eso también limita las respuestas del correo entrante. Por eso el demo no necesita correo: "Entrar como Andina Labs" no pide código y la empresa demo nunca envía correos ni crea enlaces.
- **JEV no existe todavía.** La capa opcional (TypeSafe/JEV, SHOULD S2) no está construida: en el código solo existe la variable `JEV_ENABLED` (apagada) en `wrangler.toml`; ningún código la lee. Por eso se dice "apagada". La seguridad no depende de ella.
- **Otras funciones SHOULD sin construir:** exportar el registro a CSV, el botón "Invitar", varias políticas por categoría y exportar/importar la política en JSON. No hay rastro de ellas en `src/` ni `web/`.
- **Plan gratuito de Cloudflare.** La cuenta está en Workers Free (50 subrequests por invocación). Una ejecución del agente se reparte en lotes de como máximo 40 subrequests contados, y el navegador sigue pidiendo lotes hasta terminar ("Decidiendo facturas… n de m"). El cron hace lo mismo y las empresas se turnan. En un plan de pago se sube la constante `SUBREQUESTS` de `src/lib/supabase.ts`, el único valor que cambia. Efecto: con muchas facturas pendientes, parte de ellas espera al siguiente ciclo de 5 minutos.
- **El lector depende de dos proveedores.** El lector y el chat corren en Amazon Nova Lite (AWS Bedrock); Workers AI es solo el respaldo. La factura entra como ESCALAR «sin leer» únicamente si los dos fallan (Bedrock con error, límite de uso o 20 segundos sin respuesta, y luego Workers AI también): el registro dice «factura sin leer: el lector de facturas no estaba disponible» (no «ilegible»), no se inventa ningún dato y nada se reintenta solo; hay que volver a ingresarla más tarde y rechazar la copia sin leer. Las facturas sembradas y las decisiones posteriores (aprobar, rechazar, reevaluar) nunca dependen del lector. La cuota gratuita de Workers AI (unas 250 lecturas al día, hasta las 00:00 UTC, las 19:00 de Bogotá) ya solo importa cuando Bedrock también falla; un plan de pago de Workers la levanta. Bedrock se cobra a la cuenta de AWS que ponga las claves.
- **Entrada de facturas por correo: apagada.** El código está construido y probado con `.eml` de ejemplo, pero no recibe nada hasta que se agregue un dominio a Cloudflare, se active Email Routing hacia el Worker y se ponga `INBOUND_EMAIL_DOMAIN` (paso de Roberto o de la empresa; AC-88, SHOULD). No se probó en vivo con un correo real.
- **Etiqueta «Leído por IA» por API.** La etiqueta "Leído por IA" de una factura insertada directamente por API la declara quien la inserta; las decisiones no dependen de ella.
- **El chat tiene topes.** 10 preguntas por usuario y 500 por día en todo el despliegue (ver «Dónde actúa la IA»); al llegar al tope responde con un aviso y no con una respuesta.
- **Terminándose al escribir esto.** La tarjeta de Bandeja «Comparte este enlace con tus proveedores», la etiqueta de origen («Portal de proveedores» o «Correo de <remitente>») y el panel «Actividad del agente» (Tarea 29) no están en el código de esta versión; el enlace del portal de cada empresa lo devuelve `GET /api/portal-link`. Verifica con `grep -rn "Comparte este enlace" web src`.
- **Guardia del monto en fotos.** La guardia del monto (nota crédito, total que no cuadra) revisa el texto exacto del PDF, del correo y del chat. En una foto solo ve lo que el modelo de visión transcribió: si la transcripción omite o cambia el total, la guardia no lo ve.
- **Guardia del monto: columnas separadas.** La guardia no empareja etiquetas y montos impresos en columnas separadas (primero todas las etiquetas, luego todos los montos). En ese caso no ve el total impreso y no puede compararlo.
- **Guardia del monto: retenciones y descuentos.** Una factura cuyo total ya resta retenciones (ReteFuente, Retención, ReteIVA, ReteICA) o descuentos sale ESCALAR con «el total no cuadra». Es intencional: una escalada falsa cuesta una respuesta de una persona, mientras que adivinar el signo de cada ajuste podría convertir un total equivocado en un PAGAR.
- **Guardia del monto: lista cerrada.** La guardia reconoce solo las formas acordadas (R-80, R-81, R-82). Una palabra de tres letras antes de un paréntesis cuenta como moneda, así que «Total for (2) items: 500» sale ESCALAR como nota crédito. Es una escalada falsa, nunca un PAGAR. Una forma nueva de nota crédito que no esté en la lista no se detecta.
- **Licencia del modelo de visión del respaldo, una vez por cuenta.** Si Bedrock falla, las imágenes se leen con `@cf/meta/llama-3.2-11b-vision-instruct`, que exige aceptar su licencia una sola vez por cuenta de Cloudflare enviándole `{"prompt":"agree"}`. Sin esa aceptación, con Bedrock caído, toda imagen entra como factura «sin leer».
- **La consulta AC-16 sin filtro devuelve 1, y esta es la explicación.** Si ejecutas en toda la base de datos la consulta literal de AC-16 (decisiones del agente con resultado PAGAR que tengan un control distinto de «cumple»), el resultado es 1. Esa fila es una decisión PAGAR falsa que QA escribió a propósito, por la API REST de la base y con `actor = 'agent'`, el 2026-10-17 a las 00:32 UTC, en una empresa de prueba (`qa-r202610162341-2-b`, decisión `f2063d3d-a8a4-4bd4-9116-d22c93f18124`, con un control `no_cumple` en `limite`). La escribió antes del bloqueo de la base de datos, para demostrar que ese hueco existía. El agente nunca escribió esa fila y ningún pago salió de ella. El bloqueo es la migración `20261017000250_thesaurus_lockdown`, aplicada el 2026-10-17 a las 00:55 UTC: desde entonces la base rechaza un PAGAR fuera de las reglas y ningún usuario puede escribir decisiones. Las decisiones solo se agregan, nunca se borran, así que las filas de prueba anteriores al bloqueo siguen ahí (también quedan empresas `qa-r202610162341-*` creadas durante las pruebas). La prueba son dos consultas para el editor SQL de Supabase:
  - Consulta 1, desde el bloqueo, con el texto de AC-16 (resultado esperado: 0):
    `select count(*) from decisions where actor='agent' and outcome='PAGAR' and created_at >= '2026-10-17 00:55:00+00' and exists (select 1 from jsonb_array_elements(checks) c where c->>'verdict' <> 'cumple');`
  - Consulta 2, toda la tabla sin filtro, con la regla completa de la base (resultado esperado: dos filas, ambas anteriores a 2026-10-17 00:55 UTC y de empresas de prueba `qa-r202610162341`: `f2063d3d-a8a4-4bd4-9116-d22c93f18124` a las 00:32 UTC y `823dc753…`, un PAGAR del agente con la lista de controles vacía):
    `select d.id, d.created_at, co.approver_email from decisions d join companies co on co.id = d.company_id where d.actor='agent' and d.outcome='PAGAR' and case when jsonb_typeof(d.checks) <> 'array' then true else jsonb_array_length(d.checks) < 13 or exists (select 1 from jsonb_array_elements(d.checks) e where e->>'verdict' is distinct from 'cumple' or e ? 'overridden') end order by d.created_at;`
  - Pasa si la consulta 1 da 0 y toda fila de la consulta 2 es anterior al corte y de una empresa `qa-r202610162341`. Falla si hay una fila en o después del corte, o de cualquier otra empresa (la empresa demo incluida). Los resultados reales que QA obtuvo en la base viva se copian tal cual en `docs/LEDGER.md`.
- **Fechas de los PDF.** Los PDF de `/demo/invoices/` imprimen las fechas del día en que se generaron; las facturas sembradas llevan fechas relativas al momento de la siembra (para que los casos de vencida y fuera del periodo funcionen cualquier día). Pueden no coincidir.
- **Lectura con el modelo real.** No se midió la exactitud de Nova Lite ni la de Workers AI con facturas reales: solo hay llamadas de verificación en vivo y pruebas con modelos simulados. Un PDF escaneado sin capa de texto, o una imagen que el modelo no lee, entra como ESCALAR "ilegible". Las facturas sembradas traen sus campos ya extraídos, así que la demo funciona aunque los dos modelos fallen.
- **Revisión de pantallas.** El 17 de octubre se hizo una revisión con un navegador real y la puerta `npm run ux:gate` (anchos de 360 a 1440 px, es y en, objetivos táctiles, contraste, estados de carga, vacío y error). Sus hallazgos están en `docs/UX-QA.md` (24 en la primera revisión, todos «open» en esta versión) y las correcciones siguen en curso (Tareas 29, 31 y 32); el estado de cada uno es el que diga ese archivo, no este README.
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
  - Q8: seguir en el plan gratuito. Con Bedrock como lector principal el límite de Workers AI (unas 250 lecturas diarias) solo cuenta como respaldo; si los dos fallan, una factura nueva entra como ESCALAR «sin leer». ¿Pasar a Workers Paid (USD 5 al mes) para que el respaldo nunca se agote?
  - Q9: una factura cuyo total ya resta retenciones (ReteFuente, ReteIVA, ReteICA) o descuentos sale ESCALAR con «el total no cuadra». ¿Se reconocen las retenciones y se paga el total bruto o el neto?
  - Q11: Yahoo Finance es un servicio público pero no oficial; ¿qué fuente usa la empresa el lunes (su banco, su proveedor de tesorería o la tasa de Blinka) y son correctas la regla de las 48 horas y la banda de 25 %? Decisión provisional: Yahoo con open.er-api.com de respaldo.
  - Q12: los topes del chat (10 por usuario por día y 500 en total). ¿Otros topes?
  - Q13: solo la empresa demo tiene un enlace de portal legible; las demás reciben uno al azar. ¿Pueden elegirlo?
  - Q14: el proveedor ve solo estados en palabras fijas, sin razones ni datos bancarios. ¿Es la cantidad correcta?
  - Q10: quedan dos PAGAR falsos que QA escribió por REST en empresas de prueba (`qa-r202610162341-*`) antes del bloqueo; nada se borra, así que siguen ahí. ¿Se marcan u ocultan esas empresas antes de compartir la base con la empresa?

## Registro de decisiones y entrega

Cada tarea, cada debate y cada decisión, con su razón en lenguaje claro, están en [`docs/LEDGER.md`](docs/LEDGER.md). La especificación con los criterios de aceptación es `docs/SPEC.md`. Los textos para el formulario de entrega (descripción para el jurado, enlaces) están en [`docs/SUBMISSION.md`](docs/SUBMISSION.md).
