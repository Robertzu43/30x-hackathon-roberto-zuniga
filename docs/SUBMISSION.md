# Entrega: HackRadar "Mi proyecto"

Roberto solo copia y pega estos campos.

## Identidad del proyecto

**Nombre del proyecto:** Thesaurus

**Reto que resuelve:** Reto Blinka: Agentes que pagan por la empresa

**Descripción (lo que verá el jurado):** el texto entre las líneas de abajo, sin las líneas.

---
Thesaurus es el agente de cuentas por pagar, construido para Blinka. Revisa las facturas de una empresa, decide cuáles pagar dentro de sus reglas y, si algo se sale de ellas, le hace una pregunta concreta a una persona.

EL PROBLEMA
Hoy una factura llega por correo, PDF o chat. Alguien de finanzas la compara con lo acordado, busca los datos de quien cobra, pide aprobación por chat, crea el pago a mano y concilia en una hoja. Es manual, mensual y depende de una persona disponible. Falta confianza: que el agente pague solo lo que debe, lo explique y nunca se pase de sus límites.

QUÉ HACE, COMO AGENTE
Cada factura recorre un ciclo: percibe (PDF, imagen, correo o chat pegado, o el portal) → lee (Amazon Nova Lite en AWS Bedrock, con Workers AI de respaldo, en campos con confianza) → consulta (directorio, política, periodo, duplicados, tasa de cambio) → decide (el motor de reglas) → actúa (registra, escala, escribe al aprobador, prepara la orden de pago) → rinde cuentas (el registro).
Trabaja solo: cada 5 minutos revisa lo pendiente. Tiene tres resultados: PAGAR (cumple las 13 reglas), FRENAR (duplicado exacto o sobre el límite por pago) y ESCALAR (le pregunta a una persona: "Juan, la factura #2044 de Nube Sur LLC por 4.200 USD supera tu umbral de 2.500 USD. ¿La pago?", con Aprobar y Rechazar).
Usa la tasa de mercado (Yahoo Finance, respaldo open.er-api.com) o la de la política; sin tasa vigente, escala.
La IA se ve: «Leído por IA» en cada factura y «Pregúntale a Thesaurus», un chat que responde solo con el registro y no puede aprobar ni pagar nada.
Portal de proveedores: https://facturas.30x-hackathon-roberto-zuniga.workers.dev/andina-labs. El proveedor manda su factura sin cuenta y ve un estado en palabras fijas, nunca cuentas ni razones.

SEGURIDAD POR DISEÑO
El reto descalifica un pago fuera de las reglas, así que no confía en que el código se porte bien:
1. Ningún modelo decide ni escribe un pago. Solo la función pura decide() produce PAGAR, y solo si los 13 controles cumplen.
2. La base de datos rechaza un PAGAR fuera de las reglas, aunque el Worker tuviera un error. Honestidad: la consulta literal de AC-16 sin filtro devuelve 1, una fila que QA falsificó por REST antes del bloqueo; el agente no la escribió ni salió pago alguno.
3. Ningún usuario escribe decisiones, ni la cuenta pública de la demo: solo el agente del servidor.
4. El registro es de solo adición; PAGAR y FRENAR son finales.
5. Los enlaces de aprobación van firmados, vencen a las 48 horas y se usan una vez; abrirlos no actúa.
6. Dos facturas simultáneas no se pasan del presupuesto; nadie aprueba sobre el presupuesto, el saldo ni el límite por pago.
7. Un proveedor no es de confianza: el pago va solo a la cuenta del directorio.
No se mueve dinero real: el agente decide, registra y explica.

EXPLICABILIDAD
Cada factura tiene un registro legible sin abrir el código: un titular, "Lo que hice", "Lo que leí" y "Lo que decidí", qué tendría que pasar para pagarla, la política y quién actuó. Salen en español e inglés. Periodo muestra Autonomía, Violaciones y Decisiones explicadas sobre 29 facturas, normales y con trampa.

CÓMO PROBARLO
Abre https://30x-hackathon.30x-hackathon-roberto-zuniga.workers.dev/demo y pulsa «Probar con mi propia empresa»: copia privada de Andina Labs, sin correo ni cuenta; el agente decide las 29 facturas ante ti. «Entrar como Andina Labs» es la vista compartida. Sube /demo/invoices/01.pdf (FRENAR, duplicado exacto), pega el chat de un proveedor nuevo (ESCALAR), pregunta en «Pregúntale a Thesaurus», o rechaza la factura de Laura Méndez (cuenta cambiada) y aprueba la de Nube Sur (PAGAR).

LO QUE NO ESTÁ HECHO
SES: AWS negó el acceso de producción; el correo llega solo a direcciones verificadas (una: la del aprobador de la demo), así que ninguna puerta pide códigos. Los correos de «Guardar mi acceso» no se verifican. La entrada por correo, probada solo con correos de ejemplo, está apagada hasta agregar un dominio. JEV no existe. Cloudflare gratuito: ejecuciones grandes en lotes. Si Bedrock y el respaldo fallan, la factura entra «sin leer» y se escala. En fotos la guardia del monto solo ve lo que el modelo transcribe. Retenciones y descuentos en el total se escalan. El recorrido guiado muestra «Paso n de m» pero aún no ilumina el elemento de cada paso (AC-117). La tarjeta «Canales», «Subir factura» y la etiqueta de canal (AC-123 a AC-125) están especificadas; solo existen la tarjeta y la lógica, sin fusionar. Telegram (AC-126) no existe: hoy las facturas entran por el portal, subidas o pegadas. «Decidiendo… n de m» (AC-121) sale en la Bandeja en toda ejecución y en Periodo solo en el primer ingreso. A 2560 px (AC-122) las pantallas siguen el diseño de D45; sus filas de prueba no están registradas. La película de lanzamiento se hace aparte (D46): hasta entonces el video es el recorrido completo. Detalle en el README.
---

## Enlaces (los tres primeros son obligatorios)

- **Repositorio público de GitHub:** https://github.com/Robertzu43/30x-hackathon-roberto-zuniga (debe estar en público antes de enviar)
- **Demo (URL):** https://30x-hackathon.30x-hackathon-roberto-zuniga.workers.dev/demo
- **Video demo (URL):** https://30x-hackathon.30x-hackathon-roberto-zuniga.workers.dev/demo/thesaurus-launch.mp4 (película de lanzamiento, 150 s)
- **Recorrido completo sin editar:** https://30x-hackathon.30x-hackathon-roberto-zuniga.workers.dev/demo/happy-path.webm
- **Portal de proveedores:** https://facturas.30x-hackathon-roberto-zuniga.workers.dev/andina-labs
- **Diagrama de arquitectura:** https://30x-hackathon.30x-hackathon-roberto-zuniga.workers.dev/demo/architecture.png (SVG: https://30x-hackathon.30x-hackathon-roberto-zuniga.workers.dev/demo/architecture.svg)
