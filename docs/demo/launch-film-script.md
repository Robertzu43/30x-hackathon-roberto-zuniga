# Thesaurus — film de lanzamiento v2 · guion y storyboard

Duración total: 107,2 s (1920x1080, 30 fps; máster 4K 3840x2160 si el tiempo lo permite). Idioma en pantalla y en voz: español. Inglés solo en los archivos de subtítulos `.en.vtt` / `.en.srt`. Objetivo de la v2 (18 oct, tarde): hook con pregunta en los primeros 12 s, producto antes del segundo 20, voz natural, música alegre y transiciones visibles.

Voz: **Workers AI, Deepgram Aura-2 español (`@cf/deepgram/aura-2-es`), locutora `celeste`** (femenina, colombiana, cálida y enérgica), elegida por Roberto entre celeste / javier / sirio / aquila (muestras en `out/samples/preview-aura-*.mp3`). Cada cue se genera en una sola llamada (texto completo con su puntuación; Aura-2 resuelve la prosodia de la frase). La duración real de cada MP3 fija la duración de su escena (`cues.json` → `timeline.mjs` → `timeline.json`); los inicios de frase dentro de cada cue (`marks`) se detectan por silencios y mueven los golpes del hook, la tagline del logo, el barrido de Lee, el clic de Escala, la pregunta de Rinde cuentas, las tres líneas de Confianza y las líneas del cierre. Sin recortes de texto: ningún cue tuvo que acortarse. Descartadas antes: es-CO-GonzaloNeural (v1, «muy robótica»), es-MX-DaliaNeural y es-US-AlonsoNeural con edge-tts frase por frase (muestras en `out/samples/`).

Música: **«Life of Riley», Kevin MacLeod (incompetech.com)**, ~104 BPM, tonalidad mayor, ukelele y percusión ligera. Licencia **Creative Commons: By Attribution 4.0** (https://creativecommons.org/licenses/by/4.0/); crédito obligatorio en la descripción del video: `"Life of Riley" Kevin MacLeod (incompetech.com) — Licensed under Creative Commons: By Attribution 4.0 License`. Se intentó primero freepd.com (CC0): el sitio está cerrado («FreePD.com - Site Closed», 18 oct 2026) y las búsquedas CC0 en archive.org / Wikimedia Commons fallaron a través del proxy, por eso se tomó la pista CC BY de incompetech (cambiarla es solo re-ensamblar). Plan de música por escena (`bed.mjs`): hook, pulso grave sintetizado cada 2 s (60 Hz, muy bajo) y silencio bajo «¿Cuáles?»; en el logo, un riser de ruido filtrado de 0,9 s y la pista entra a volumen pleno 1,2 s antes de la voz; escenas de producto, pista a -5 dB con *ducking* por cadena lateral de la voz (~-12 dB, ataque 20 ms, liberación 300 ms) para que respire entre frases, con paso alto a 120 Hz y un hueco de -4 dB en 3 kHz para dejar sitio a la voz; Confianza (trust1/trust2), pista a -10 dB y paso bajo a 500 Hz (cama); recorrido (w2/w4/w6), pista a -8 dB; cierre, la pista resuelve y se funde a silencio con el logo. Máster: -16 LUFS integrados, TP -1,5 dB (loudnorm en dos pasadas); música bajo la voz ≤ -28 LUFS (medido, ver informe de entrega).

Transiciones (`storyboard.html`, `scene()`): fundido desde negro (0,9 s) al inicio; entre escenas, fundido cruzado de 0,6 s con escala 1,02 → 1,00 (1,1 s) en las escenas de producto; *push* horizontal de 0,6 s entre los planos del recorrido (w2 → w4 → w6); fundido a negro de 1,2 s al final. Los subtítulos (`#caps`) siguen `timeline.json` y no se ven afectados.

Tipografía: Newsreader (Google Fonts, OFL) para titulares y wordmark, Inter Display (OFL) como sustituto libre de SF Pro Display para texto de apoyo y UI, Geist Mono (OFL) para cifras, índices y URL. Paleta: canvas #fbfbfa, tinta #111111, tinta 2 #6d6c69, línea #eaeaea, acento #346538, acento-bg #edf3ec; rojo FRENAR #8f2f2f y ocre ESCALAR #9a6a12 como en la app (sobre negro, en el hook, se aclaran a #c9463d y #d49a2a para que se lean).

## Escenas

| # | id | Escena | Inicio → fin (s) | Voz (es) | En pantalla |
|---|----|--------|------------------|----------|-------------|
| 1 | hook | Hook, tipografía cinética sobre negro | 0,0 → 12,2 | Veintinueve facturas. Cuatro monedas. Una persona, revisándolas a mano. Tres no deberían pagarse. Once necesitan una aprobación. ¿Cuáles? | Un golpe por frase: «29 facturas.» «4 monedas.» «1 persona.» «3 no deberían pagarse.» (el 3 en rojo FRENAR) «11 necesitan a alguien.» (el 11 en ocre ESCALAR) «¿Cuáles?» grande, sostenido ~1 s en silencio |
| 2 | logo | Revelado del logo (letras de izquierda a derecha) | 12,2 → 22,6 | Thesaurus. Lo sabe en segundos. Y explica por qué. El agente de cuentas por pagar que decide con tus reglas. | Riser + pista a volumen pleno 1,2 s; marca T + «Thesaurus» letra a letra; tagline «El agente de cuentas por pagar que decide con tus reglas.» |
| 3 | lee | 01/04 Lee | 22,6 → 39,6 | Recibe cada factura, por portal, PDF o correo. Y la inteligencia artificial la lee: beneficiario, monto, moneda, cuenta y fechas, con su nivel de confianza. | Documento con barrido + campos con confianza (97/97/99/95/95/96 %); «Leído por IA · Amazon Nova Lite» |
| 4 | verifica | 02/04 Verifica | 39,6 → 45,7 | El código verifica trece reglas, con la tasa de cambio del día. | Las 13 reglas marcándose, contador «13 de 13 cumplen», «Tasa de mercado del día · Yahoo Finance» |
| 5 | decide | Decide | 45,7 → 52,9 | Y decide: pagar, frenar o escalar. Pagar solo se escribe cuando las trece se cumplen. | PAGAR / FRENAR / ESCALAR; «PAGAR solo cuando las 13 reglas se cumplen. Y solo lo escribe el código.» |
| 6 | escala | 03/04 Escala | 52,9 → 60,5 | Si algo se sale de las reglas, hace una pregunta concreta. Una persona aprueba en un clic. | Tarjeta «Necesito tu respuesta» (#2044, Nube Sur LLC, 4.200 USD > 2.500 USD), cursor, clic en Aprobar, sello «Aprobada · PAGAR» |
| 7 | rinde | 04/04 Rinde cuentas | 60,5 → 65,9 | Cada decisión queda con su registro. Y se le puede preguntar. | «Lo que hice» (5 pasos reales de #1042) + «Pregúntale a Thesaurus» con pregunta tecleada |
| 8 | trust1 | Confianza | 65,9 → 71,4 | La IA lee. El código decide. Una persona aprueba. | Las tres líneas sobre negro; música en cama |
| 9 | trust2 | Garantías | 71,4 → 77,4 | Veintinueve facturas de ejemplo. Cero pagos fuera de las reglas. | Tres columnas + «Andina Labs, 29 facturas de ejemplo: 15 PAGAR, 3 FRENAR, 11 ESCALAR. 0 pagos fuera de las reglas.» |
| 10 | w2 | Recorrido 1/3: Bandeja | 77,4 → 84,7 | Así se ve en producción. La bandeja muestra qué se paga, qué espera aprobación, y la autonomía del agente. | Portátil: Bandeja real (Por pagar hoy · Esperando tu aprobación 13 · Frenadas 3 · Autonomía 62 %, «Necesita tu respuesta») |
| 11 | w4 | Recorrido 2/3: factura ESCALAR | 84,7 → 92,3 | Cuando una factura supera el umbral, la pregunta es concreta, y la respuesta es un clic. | Portátil (push): «NO CUMPLE · Umbral de aprobación: 4.200 USD > 2.500 USD» → «Qué tendría que pasar para pagarla» + «Necesito tu respuesta», Aprobar / Rechazar |
| 12 | w6 | Recorrido 3/3: portal | 92,3 → 99,2 | Y los proveedores envían sus facturas desde un portal propio, también desde el celular. | Teléfono (push): portal facturas…/andina-labs («Facturas para Andina Labs Inc.») + «Portal de proveedores» |
| 13 | close | Cierre | 99,2 → 107,2 | Thesaurus. Listo para conectarse a Blinka. Pruébelo hoy con su propia empresa. | Logo, «Listo para conectarse a Blinka.», URL /demo, botón «Probar con mi propia empresa»; fundido a negro |

Los tiempos exactos (inicio, entrada de voz, fin, `marks`) están en `timeline.json`; los subtítulos `.vtt/.srt` se generan de ese archivo con la duración real de cada cue.

## Fuente de cada número y afirmación

- **29 facturas, 4 monedas, 3 FRENAR, 11 ESCALAR** (hook, trust2): README y docs/demo/DATASET.md («29 facturas de la demo: 15 PAGAR, 3 FRENAR y 11 ESCALAR … 0 diferencias»); las cuatro monedas del conjunto de ejemplo son USD, EUR, COP y MXN (BRL y ARS aparecen solo en facturas FRENAR/ESCALAR del mismo conjunto; la Bandeja real muestra además BRL, por eso «cuatro monedas» se refiere a lo que se paga). «Una persona revisándolas a mano»: docs/PROBLEM.md (revisión manual).
- **13 reglas** (verifica, decide): README «las 13 reglas … solo el código puede escribir PAGAR»; registro real de la factura #1042 («Verifiqué 13 reglas: 13 cumplen»).
- **Campos y confianzas de Lee** (Laura Méndez, 2.500, USD, 1042, 15 de noviembre de 2026, Bancolombia ···4821; 97/97/99/95/95/96 %): registro real de «PAGAR · 2.500 USD a Laura Méndez» en el sitio desplegado (18 oct).
- **Pasos de «Lo que hice»**: el mismo registro, textos literales (el paso 5 se abrevia a «Preparé la orden de pago.»).
- **Pregunta de Escala** (#2044, Nube Sur LLC, 4.200 USD, umbral 2.500 USD): registro real «ESCALAR · 4.200 USD a Nube Sur LLC» en el sitio desplegado.
- **Amazon Nova Lite**: README («Amazon Nova Lite en AWS Bedrock»). **Yahoo Finance** (tasa del día): brief del producto y README.
- **Autonomía 62 % (18 de 29)**: Bandeja del sitio desplegado («Autonomía 62%», «18 de 29 facturas decididas solas y correctamente», captura del 18 oct 13:10 UTC) y README.
- **Aislamiento por empresa, registro inmutable, nunca paga fuera de las reglas**: brief del producto (D46) y README.
- **Tagline y slogan** («El agente de cuentas por pagar que decide con tus reglas.»): página /demo desplegada (versión 33a6d910).
- **URL**: https://30x-hackathon.30x-hackathon-roberto-zuniga.workers.dev/demo · portal https://facturas.30x-hackathon-roberto-zuniga.workers.dev/andina-labs

## Recorrido real (capturas Playwright del sitio desplegado, UI en español, es-CO)

Capturado el 18 oct 2026 ~13:10 UTC contra el Worker desplegado (versión 33a6d910). Navegación solamente; nunca Aprobar/Rechazar/Reiniciar ni subir facturas; el tutorial se cierra con «Saltar»; cada pantalla se captura tras 2,5-3 s de reposo (sin spinners ni estados «Decidiendo…»). Portátil 1440x900 @3x (página completa), teléfono 390x844 @3x. Único retoque en el DOM capturado: ocultar con CSS el cursor de texto y el correo de la cuenta. El visor de PDF de Chrome headless pinta su barra con el título «about:blank»; el paneo de w4 rodea esa zona y nunca la muestra.

1. `bandeja.png` (w2): tras «Entrar como Andina Labs» → «Saltar» → Bandeja; página completa. Paneo: (0,0, z1,00) → (48,170, z1,07), termina con las cuatro tarjetas y «Necesita tu respuesta».
2. `escalar.png` (w4): factura «ESCALAR · 4.200 USD a Nube Sur LLC: supera el umbral de aprobación de 2.500 USD» (#2044). Paneo vertical en la columna derecha: reglas con «NO CUMPLE» (645,1120, z1,6) → «Necesito tu respuesta» con Aprobar / Rechazar (645,1690, z1,6).
3. `portal.png` (w6): portal `facturas…/andina-labs` en el teléfono, composer vacío.

Estado real del sitio ese día (no es el conjunto de ejemplo puro): dos facturas de prueba enviadas por el portal («ESCALAR · 10.000 BRL a Ana Souza», 17 oct) hacen que la Bandeja muestre «Esperando tu aprobación 13». Lo que la voz afirma sigue siendo cierto en pantalla: «18 de 29», Autonomía 62 %, #2044 4.200 > 2.500.

## Pipeline

`cues.json` (texto, pads) → `gen-aura.mjs` (Workers AI Aura-2 `celeste`, un MP3 por cue + `marks` por silencios; alternativa `gen-voice2.mjs` con edge-tts frase por frase) → `timeline.mjs` (timeline.json/js) → `storyboard.html` (Web Animations API, determinista, `window.seek(s)`; transiciones en `scene()`) → `render.mjs` (Playwright, cuadro a cuadro a 30 fps; `--dpr 1` = 1080p, `--dpr 2` = 4K nativo) → `bed.mjs` (cama musical por escena, ducking por cadena lateral) → `assemble2.sh` (voz + cama + loudnorm, H.264/AAC, subtítulos, póster, miniatura; 4K si se pasa `raw-4k.mp4`).
