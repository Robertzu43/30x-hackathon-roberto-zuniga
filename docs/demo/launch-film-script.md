# Thesaurus — film de lanzamiento · guion y storyboard

Duración total: 150,0 s (1920x1080 y 3840x2160, 30 fps). Idioma en pantalla y en voz: español (Colombia, registro neutro e institucional). Inglés solo en los archivos de subtítulos `.en.vtt` / `.en.srt`.

Voz: **Microsoft Edge neural TTS, voz `es-CO-GonzaloNeural`**, generada con `edge-tts` 7.3.1 (`--rate=-6% --pitch=-2Hz`), un archivo por escena (`vo/<id>.mp3`); la duración real de cada archivo (ffprobe) fija la duración de su escena (`cues.json` → `timeline.mjs` → `timeline.json`). Candidatas probadas: es-CO-GonzaloNeural, es-CO-SalomeNeural, es-MX-JorgeNeural, es-ES-AlvaroNeural; se eligió Gonzalo por ser la voz masculina colombiana neutra (acento del brief) con cadencia más pausada a -6 %.

Cama sonora: pad ambiental sintetizado con ffmpeg (`aevalsrc`, cuatro senos A2-E3-A3-C#4 con LFO lentos, paso bajo 900 Hz, eco suave, fundidos de 4 s y 6 s). Nivel medido (ebur128, antes de la normalización): voz -22,6 LUFS integrados, cama -39,3 LUFS, es decir la cama queda ~17 LU por debajo de la voz (≈ -33 LUFS en la mezcla final; corrige la cifra «-31 dB» de la versión anterior del guion, que no correspondía a la medición). Sin música de terceros. Loudness final: -16 LUFS (loudnorm en dos pasadas, TP -1,5 dB).

Tipografía: Newsreader (Google Fonts, OFL) para titulares y wordmark, Inter Display (OFL, instalada en el contenedor) como sustituto libre de SF Pro Display para texto de apoyo y UI, Geist Mono (OFL) para cifras, índices y URL. Paleta: la aprobada en `web/styles.css` (D37): canvas #fbfbfa, tinta #111111, tinta 2 #6d6c69, línea #eaeaea, acento #346538, acento-bg #edf3ec; rojo FRENAR #8f2f2f y ocre ESCALAR #9a6a12 como en la app.

## Escenas

| # | id | Escena | Inicio → fin (s) | Voz (es) | En pantalla |
|---|----|--------|------------------|----------|-------------|
| 1 | hook | Hook, tipografía cinética sobre negro | 0,0 → 11,5 | Las empresas globales pagan facturas en varios países y monedas, revisadas a mano, cada mes. Basta un pago fuera de las reglas para perder el control. | «Varios países.» «Varias monedas.» «A mano.» «Cada mes.» «Un pago fuera de las reglas.» / «y se pierde el control» |
| 2 | p1 | Problema 01/03 | 11,5 → 16,4 | Las facturas llegan por correo, en PDF o por chat. | Chips Correo · PDF · Chat + enunciado |
| 3 | p2 | Problema 02/03 | 16,4 → 24,0 | Alguien las compara con lo acordado, pide aprobación por chat y crea el pago a mano, en otra moneda y otro país. | Proceso Comparar → Aprobar por chat → Pagar a mano → Otra moneda, otro país |
| 4 | p3 | Problema 03/03 | 24,0 → 30,3 | Se concilia en una hoja de cálculo, cada mes, si hay alguien disponible. | Cuadrícula de hoja de cálculo + enunciado |
| 5 | logo | Revelado del logo (letras de izquierda a derecha) | 30,3 → 37,0 | Thesaurus. El agente de cuentas por pagar para empresas globales. | Marca T + «Thesaurus» letra a letra + tagline |
| 6 | recibe | 01/06 Recibe | 37,0 → 44,5 | Recibe cada factura: portal de proveedores, carga directa, texto pegado o correo. | Cuatro fuentes convergen en la Bandeja (Nube Sur LLC · Escalar, Laura Méndez · Pagar, Ana Souza · Frenar) |
| 7 | lee | 02/06 Lee | 44,5 → 53,9 | La inteligencia artificial la lee: beneficiario, monto, moneda, cuenta y fechas, con su nivel de confianza. | Documento con barrido + campos con confianza; «Leído por IA · Amazon Nova Lite» |
| 8 | verifica | 03/06 Verifica | 53,9 → 61,4 | El código verifica trece reglas, del beneficiario al presupuesto, con la tasa de cambio del día. | Las 13 reglas marcándose una a una, contador «13 de 13 cumplen», «Tasa de mercado del día · Yahoo Finance» |
| 9 | decide | 04/06 Decide | 61,4 → 70,2 | Y decide: pagar, frenar o escalar. Pagar solo se escribe cuando las trece reglas se cumplen. | PAGAR / FRENAR / ESCALAR; «PAGAR solo cuando las 13 reglas se cumplen. Y solo lo escribe el código.» |
| 10 | escala | 05/06 Escala | 70,2 → 78,0 | Cuando algo se sale de las reglas, hace una pregunta concreta. Una persona aprueba en un clic. | Tarjeta «Necesito tu respuesta» (factura #2044, Nube Sur LLC, 4.200 USD > umbral 2.500 USD), cursor, clic en Aprobar, sello «Aprobada · PAGAR» |
| 11 | rinde | 06/06 Rinde cuentas | 78,0 → 87,0 | Cada decisión queda con su registro: lo que leyó, lo que decidió y la aritmética. Y se le puede preguntar. | Registro «Lo que hice» (5 pasos reales) + «Pregúntale a Thesaurus» con pregunta tecleada |
| 12 | trust1 | Confianza | 87,0 → 93,5 | La IA lee. El código decide. Una persona aprueba. | Las tres líneas sobre negro |
| 13 | trust2 | Garantías | 93,5 → 101,6 | Aislamiento por empresa. Registro inmutable. Nunca paga fuera de las reglas. | Tres columnas + «Andina Labs, 29 facturas de ejemplo: 15 PAGAR, 3 FRENAR, 11 ESCALAR. 0 pagos fuera de las reglas.» |
| 14 | w1 | Recorrido 1/6: /demo | 101,6 → 108,3 | Así se ve en producción: Andina Labs, una empresa de ejemplo con veintinueve facturas. | Portátil: página /demo (hero a dos columnas: «Paga lo que debes. Frena lo que no. Pregunta cuando dudes.», video incrustado, «Entrar como Andina Labs») |
| 15 | w2 | Recorrido 2/6: Bandeja | 108,3 → 114,4 | La bandeja muestra qué hay por pagar, qué espera aprobación y la autonomía del agente. | Portátil: Bandeja (tarjetas Por pagar hoy · Esperando tu aprobación 13 · Frenadas 3 · Autonomía 62 %, «Necesita tu respuesta») |
| 16 | w3 | Recorrido 3/6: factura PAGAR | 114,4 → 121,6 | En cada factura: lo que leyó, con su confianza, y las trece reglas con su aritmética. | Portátil: campos de «Lo que leí» con su confianza (97/97/99/95/95/95/93/96 %) → «Lo que decidí», 13 de 13 reglas cumplen |
| 17 | w4 | Recorrido 4/6: factura ESCALAR | 121,6 → 127,8 | Cuando una factura supera el umbral, la pregunta es concreta y la respuesta es un clic. | Portátil: regla «NO CUMPLE · Umbral de aprobación: 4.200 USD > 2.500 USD» → «Qué tendría que pasar para pagarla» y «Necesito tu respuesta» con Aprobar / Rechazar |
| 18 | w5 | Recorrido 5/6: Periodo | 127,8 → 134,2 | El periodo rinde cuentas: autonomía del sesenta y dos por ciento y cero violaciones. | Portátil: Periodo octubre de 2026, de la página completa a las tarjetas «Autonomía 62%» (18 de 29) y «Violaciones 0» |
| 19 | w6 | Recorrido 6/6: portal | 134,2 → 140,9 | Y los proveedores envían sus facturas desde un portal propio, también desde el celular. | Teléfono: facturas.…/andina-labs («Facturas para Andina Labs Inc.», pasos 1-2-3, saludo del agente, composer vacío) + «Portal de proveedores» |
| 20 | close | Cierre | 140,9 → 150,0 | Thesaurus. Listo para conectarse a Blinka. Pruébelo con su propia empresa. | Logo, «Listo para conectarse a Blinka.», URL /demo, botón «Probar con mi propia empresa» |

Los tiempos exactos (inicio, entrada de voz, fin) están en `timeline.json`; los subtítulos `.vtt/.srt` se generan de ese archivo.

## Fuente de cada número y afirmación

- **13 reglas** (verifica, decide, rinde, w3): README «las 13 reglas … solo el código puede escribir PAGAR»; registro real de la factura #1042 («Verifiqué 13 reglas: 13 cumplen»).
- **Campos y confianzas de Lee** (Laura Méndez, 2.500, USD, 1042, 15 de noviembre de 2026, Bancolombia ···4821; 97/97/99/95/95/96 %): registro real `/invoices/…` de «PAGAR · 2.500 USD a Laura Méndez» en el sitio desplegado (18 oct).
- **Pasos de «Lo que hice»**: el mismo registro, textos literales (el paso 5 se abrevia a «Preparé la orden de pago.»).
- **Pregunta de Escala** (#2044, Nube Sur LLC, 4.200 USD, umbral 2.500 USD): registro real «ESCALAR · 4.200 USD a Nube Sur LLC» en el sitio desplegado; el nombre del aprobador se omite en la tarjeta.
- **Filas de la Bandeja en Recibe** (Nube Sur LLC 4.200 USD #2044 Escalar; Laura Méndez 2.500 USD #1042 Pagar; Ana Souza 1.800 USD #AS-0087 Frenar): Bandeja real de Andina Labs (18 oct).
- **Amazon Nova Lite**: README («Amazon Nova Lite en AWS Bedrock»). **Yahoo Finance** (tasa del día): brief del producto y README («Yahoo Finance»).
- **29 facturas, 15 PAGAR, 3 FRENAR, 11 ESCALAR, 0 pagos fuera de las reglas**: README «29 facturas de la demo: 15 PAGAR, 3 FRENAR y 11 ESCALAR … 0 diferencias», «Violaciones 0» (docs/demo/DATASET.md, docs/LEDGER.md).
- **Autonomía 62 % (18 de 29)**: pantalla Periodo del sitio desplegado («Autonomía 62%» · «18 de 29 facturas decididas solas y correctamente», captura del 18 oct 13:10 UTC) y README.
- **Aislamiento por empresa, registro inmutable, nunca paga fuera de las reglas**: brief del producto (D46) y README («solo el código puede escribir PAGAR»).
- **Entrada por correo**: construida; el README la marca como inactiva hasta tener dominio, por eso aparece como canal en la lista pero el recorrido no la muestra.
- **URL**: https://30x-hackathon.30x-hackathon-roberto-zuniga.workers.dev/demo · portal https://facturas.30x-hackathon-roberto-zuniga.workers.dev/andina-labs
- **Hook**: enunciados sin cifras, tomados de docs/PROBLEM.md (facturas en varios países y monedas, revisión manual mensual, la necesidad de pedir permiso cuando algo se sale de las reglas).

## Recorrido real (shot list de la captura final, Playwright, UI en español, es-CO)

Capturado el 18 oct 2026 ~13:10 UTC contra el Worker desplegado (versión 33a6d910, layout refinado: contenido a 1280-1440 px, hero de /demo a dos columnas con video incrustado, tarjetas numeradas, tour «Paso n de m»). Navegación solamente; nunca Aprobar/Rechazar/Reiniciar ni subir facturas; el tutorial se cierra con «Saltar»; cada pantalla se captura tras 2,5-3 s de reposo (sin spinners ni estados «Decidiendo…»). Portátil 1440x900 @3x (página completa), teléfono 390x844 @3x. Único retoque en el DOM capturado: ocultar con CSS el correo de la cuenta en la barra superior (ya no aparece en el layout nuevo) y el cursor de texto. El visor de PDF de Chrome headless pinta su barra con el título «about:blank»; en lugar de retocar nada, los paneos de w3 y w4 rodean esa zona (x 48-636, y 773-940 de la captura) y nunca la muestran.

1. `demo.png`: `/demo` tal cual. Paneo: (0,0, z1,00) → (72,60, z1,10).
2. `bandeja.png`: tras «Entrar como Andina Labs» → «Saltar» → Bandeja; página completa (12.840 px). Paneo: (0,0, z1,00) → (48,170, z1,07), termina con las cuatro tarjetas y «Necesita tu respuesta».
3. `pagar.png`: factura «PAGAR · 2.500 USD a Laura Méndez, retainer de octubre, dentro de reglas» (#1042). Paneo en tres tramos: campos de «Lo que leí» con confianza (30,1330, z2,0; se sostiene 2 s) → derecha (645,1300, z1,6) → arriba hasta «Lo que decidí · 13 de 13 reglas cumplen» (645,690, z1,6).
4. `escalar.png`: factura «ESCALAR · 4.200 USD a Nube Sur LLC: supera el umbral de aprobación de 2.500 USD» (#2044). Paneo vertical en la columna derecha: reglas con «NO CUMPLE · Umbral de aprobación» (645,1120, z1,6) → «Qué tendría que pasar para pagarla» + «Necesito tu respuesta» con Aprobar / Rechazar (645,1690, z1,6).
5. `periodo.png`: Periodo, octubre de 2026. Paneo: página completa (0,100, z1,00) → tarjetas «Autonomía 62%» y «Violaciones 0» (48,300, z1,40).
6. `portal.png`: portal `facturas…/andina-labs` en el teléfono, composer vacío; deriva vertical mínima (24 px → 6 px). `portal-typed.png` (mensaje tecleado, nunca enviado) queda como alternativa no usada.

Estado real del sitio el 18 oct a las 13:10 UTC (no es el conjunto de ejemplo puro): hay dos facturas de prueba enviadas por el portal («ESCALAR · 10.000 BRL a Ana Souza», 17 oct), por eso la Bandeja muestra «Esperando tu aprobación 13», el gráfico de 30 días dice «31 facturas … ESCALAR 13» y el Periodo «PAGAR: 15 FRENAR: 3 ESCALAR: 12». Lo que la voz afirma sigue siendo cierto en pantalla: 29 facturas de ejemplo («18 de 29»), Autonomía 62 %, Violaciones 0, #1042 13 de 13, #2044 4.200 > 2.500. La línea «ESCALAR: 12» aparece en el plano final de w5 (dato real del producto); la cifra «11 ESCALAR» de la escena de garantías es la del conjunto de ejemplo (README / DATASET.md). Ninguna frase de la voz dejó de ser verdadera; no se regeneró ningún MP3.

## Pipeline

`cues.json` (texto + voz) → `edge-tts` (vo/*.mp3) → `timeline.mjs` (timeline.json/js) → `storyboard.html` (Web Animations API, determinista, `window.seek(s)`) → `render.mjs` (Playwright, captura cuadro a cuadro a 30 fps; `--dpr 1` = 1080p, `--dpr 2` = 4K nativo) → `assemble.sh` (voz + cama + loudnorm, H.264/AAC, subtítulos, póster, miniatura). El 4K se renderiza en dos partes (`raw-4k-A.mp4` 0 → 101,6 s, `raw-4k-B.mp4` 101,6 s → fin) y se une con `concat4k.sh` antes de `assemble.sh`. `laptopShot` acepta una lista de keyframes {x,y,z,at} para que un paneo pueda rodear una zona.
