# Números y afirmaciones de la película (AC-111, R-156)

Cada número y cada afirmación de producto que aparece en pantalla tiene aquí una fila con su fuente. `npx vitest run scripts/film` falla si un dígito de `docs/film/cues.json` no está en la primera columna de una fila con fuente. Los números de la diapositiva de métricas son los mismos, con la misma fuente, que README «Resultados» (R-160); si README cambia, cambian aquí y en `cues.json` en el mismo commit.

## Números

| Número | Dónde en la película | Fuente |
|---|---|---|
| 13 | «Verifica»: «13 controles y la tasa de cambio del día, en cada factura.» | `src/engine/types.ts` líneas 7-10 (`CHECK_IDS`, 13 ids) y `src/engine/decide.ts` línea 1; en vivo, la captura `captures/verifica.png` (fase B) |
| 29 | Métricas: «29 facturas de demostración», y el alcance de autonomía y violaciones | `docs/demo/DATASET.md` línea 5; README «Resultados», primera línea |
| 15 | Métricas: «15 PAGAR» | `docs/demo/DATASET.md` línea 5; `docs/LEDGER.md` línea 540 («QA 1/2 Tasks 21 + 23»: «15 PAGAR / 3 FRENAR / 11 ESCALAR with 0 mismatches») |
| 3 | Métricas: «3 FRENAR» | La misma fila de `docs/LEDGER.md` línea 540 y `docs/demo/DATASET.md` línea 5 |
| 11 | Métricas: «11 ESCALAR» | La misma fila de `docs/LEDGER.md` línea 540 y `docs/demo/DATASET.md` línea 5 |
| 62 % | Métricas: «62 % de autonomía» | `docs/LEDGER.md` línea 357 («QA part A rerun», ítem 10: «autonomy 62 %»); README «Resultados», línea «Autonomía 62 %» |
| 18 | Métricas: «18 de las 29 facturas, resueltas por el agente sin una persona» | 15 PAGAR + 3 FRENAR de `docs/LEDGER.md` línea 357 (ítem 10: «15/3/11»); README «Resultados», línea «Autonomía 62 %» |
| 0 | Métricas: «0 violaciones» | `docs/LEDGER.md` líneas 357 («violations 0») y 540 («Violaciones 0»); README «Resultados», línea «Violaciones 0»; en vivo, Periodo después de «Reiniciar demo» (`captures/controla-periodo.png`, fase B) |
| 2.283 | Métricas: «2.283 pruebas automáticas» | README «Resultados», línea «Pruebas automáticas» (`npm test -- --run` completo en el commit `456fa71`, 18 oct 2026 02:42 UTC). Se actualiza con README si la Tarea 35c refresca la cifra |
| 62 | Métricas: «en 62 archivos» | README «Resultados», línea «Pruebas automáticas» (la misma corrida) |
| 30 | El enlace del cierre, `30x-hackathon.30x-hackathon-roberto-zuniga.workers.dev/demo` | Parte del nombre del Worker, no una cantidad: `wrangler.toml` línea 1 (`name = "30x-hackathon"`) y la cuenta `30x-hackathon-roberto-zuniga` |

## Afirmaciones

| Afirmación en pantalla | Dónde | Fuente |
|---|---|---|
| «el agente de cuentas por pagar para empresas globales» | Título | `docs/PROBLEM.md` línea 31 (empresas que operan en varios países; sus equipos de finanzas pagan facturas); texto de D44a en `docs/DECISIONS.md` |
| Las tres frases del contexto | Contexto | `docs/PROBLEM.md` línea 9 («Llega una factura … por correo, PDF o chat», «Concilia en una hoja de cálculo», «Todo eso es manual») y línea 31 (varios países); texto exacto elegido por product en AC-111 |
| «Portal de proveedores y carga directa. El correo se activa con un dominio propio.» | Recibe | Capturas `recibe-envio`, `recibe-respuesta` y `recibe-carga` (fase B); el correo entrante está construido e inactivo sin dominio (`docs/architecture/architecture.svg`, «construido, inactivo: sin dominio») |
| «La IA extrae beneficiario, monto, moneda y fecha.» | Lee | Captura `lee` con «Leído por IA · Amazon Nova Lite» (fase B) |
| «… la tasa de cambio del día …» | Verifica | Captura `verifica`: la línea de moneda con Yahoo Finance y su hora (fase B); `docs/DECISIONS.md` D28 |
| «Paga, frena o escala a una persona. Siempre con su razón.» | Decide | Capturas `decide-bandeja` (PAGAR, FRENAR y ESCALAR), `decide-pagar`, `decide-escalar` y `decide-aprobado` (fase B). El registro PAGAR es uno sembrado y ningún texto lo liga al portal (R-157) |
| «Cada decisión queda registrada y explicada en lenguaje claro.» | Rinde cuentas | Capturas `rinde-registro` y `rinde-pregunta` (fase B) |
| «Políticas, límites por periodo y autonomía medida. Cero violaciones.» | Controla | Capturas `controla-politica` (sin el campo del aprobador en pantalla, R-160) y `controla-periodo` con «Violaciones 0» (fase B). Sin `controla-politica`, la línea pierde «Políticas» |
| «La IA lee. El código decide. Una persona aprueba.» | Gobierno | `src/engine/decide.ts` línea 1 (PAGAR solo sale de `decide()`); AC-16 y AC-69 en `docs/SPEC.md`; README «Dónde actúa la IA» |
| «Aislamiento por empresa» | Gobierno | AC-04 en `docs/SPEC.md` (RLS: el usuario de una empresa no lee ni escribe filas de otra) |
| «Registro inmutable» | Gobierno | AC-05 en `docs/SPEC.md` (las decisiones no se actualizan ni se borran; una respuesta humana es una fila nueva) |
| «Nunca paga fuera de las reglas» | Gobierno | «Violaciones 0» en Periodo, en vivo después de «Reiniciar demo» (`captures/controla-periodo.png`, fase B); AC-69 (la base rechaza un PAGAR fuera de las reglas) |
| Las cinco zonas de la arquitectura | Arquitectura | `docs/architecture/architecture.svg` (Tarea 55): los mismos títulos de zona y los mismos iconos de `docs/architecture/icons/` |
| «Listo para conectarse a Blinka» | Cierre | La orden de pago en la forma de Blinka (beneficiario, ruta, moneda, monto): `src/engine/decide.ts` líneas 24-26 y la prueba «PAGAR with the payment in Blinka shape» en `src/engine/decide.test.ts` línea 50; `docs/DECISIONS.md` línea 22. No hay conexión con Blinka (`docs/PROBLEM.md` línea 40) y la película no muestra ninguna |
| «Probar con mi propia empresa» | Cierre | La etiqueta del botón de `/demo`: `src/i18n/features/trial.ts` línea 3 |
