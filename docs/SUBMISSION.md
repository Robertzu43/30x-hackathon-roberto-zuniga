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
Trabaja solo: cada 5 minutos revisa lo pendiente. Tiene tres resultados: PAGAR (el agente solo si los 13 controles cumplen; una persona solo puede desbloquear ocho), FRENAR (duplicado exacto o sobre el límite por pago) y ESCALAR (le pregunta a una persona: "Juan, la factura #2044 de Nube Sur LLC por 4.200 USD supera tu umbral de 2.500 USD. ¿La pago?", con Aprobar y Rechazar).
Usa la tasa de mercado (Yahoo Finance, respaldo open.er-api.com) o la de la política; sin tasa vigente, escala.
La IA se ve: «Leído por IA» en cada factura y «Pregúntale a Thesaurus», un chat que responde solo con el registro y no puede aprobar ni pagar nada.
Portal de proveedores: https://facturas.30x-hackathon-roberto-zuniga.workers.dev/andina-labs. El proveedor manda su factura sin cuenta y ve un estado en palabras fijas, nunca cuentas ni razones.

SEGURIDAD POR DISEÑO
El reto descalifica un pago fuera de las reglas, así que no confía en que el código se porte bien:
1. Ningún modelo decide ni escribe un pago. El único PAGAR sale de outcomeOf() en src/engine/decide.ts. Un PAGAR del agente exige los 13 controles en «cumple», sin overrides. Una persona solo puede desbloquear ocho controles (HUMAN_OVERRIDABLE); presupuesto, saldo, límite por pago, duplicado exacto y moneda sin tasa siguen bloqueando.
2. La base de datos aplica esa misma regla (supabase/migrations/20261018000300_pagar_check_ids.sql), aunque escriba la clave de servicio. El replay de las 29 no tiene un PAGAR cuya etiqueta no sea PAGAR. Una fila que una prueba insertó por REST antes del trigger no es una decisión del agente; ese insert, hoy, lo rechaza el trigger.
3. Ningún usuario escribe decisiones, ni la cuenta pública de la demo: solo el agente del servidor.
4. El registro es de solo adición; PAGAR y FRENAR son finales.
5. Los enlaces de aprobación van firmados, vencen a las 48 horas y se usan una vez; abrirlos no actúa.
6. Dos facturas simultáneas no se pasan del presupuesto; nadie aprueba sobre el presupuesto, el saldo ni el límite por pago.
7. Un proveedor no es de confianza: el pago va solo a la cuenta del directorio.
No se mueve dinero real: el agente decide, registra y explica.

EXPLICABILIDAD
Cada factura tiene un registro legible sin abrir el código: un titular, "Lo que hice", "Lo que leí" y "Lo que decidí", qué tendría que pasar para pagarla, la política y quién actuó. Salen en español e inglés. Periodo muestra Autonomía, Violaciones y Decisiones explicadas sobre 29 facturas, normales y con trampa.

CÓMO PROBARLO
Vídeo oficial: https://www.youtube.com/watch?v=z8IdL3_Skvg
Abre https://30x-hackathon.30x-hackathon-roberto-zuniga.workers.dev/demo y pulsa «Probar con mi propia empresa»: copia privada de Andina Labs, sin correo ni cuenta; el agente decide las 29 facturas ante ti. «Entrar como Andina Labs» es la vista compartida. Sube /demo/invoices/01.pdf (FRENAR, duplicado exacto), pega el chat de un proveedor nuevo (ESCALAR), pregunta en «Pregúntale a Thesaurus», o rechaza la factura de Laura Méndez (cuenta cambiada) y aprueba la de Nube Sur (PAGAR). npm test corre la suite; no levanta un servidor.

LO QUE NO ESTÁ HECHO
SES está en sandbox (src/lib/email.ts): el correo de escalación solo llega a direcciones verificadas, y sin claves se anota y la decisión no cambia. Por eso la demo no pide un código. La entrada por correo está probada con ejemplos y apagada (INBOUND_EMAIL_DOMAIN vacío). JEV no está en el código de decisión. No hay CSV ni varias políticas por categoría. La pantalla Canales está en docs/COPY.md y no está en la app; Telegram no existe. En fotos la guardia del monto solo ve lo que el modelo transcribe. Una nota de crédito o un total que no cuadra escala. Si Bedrock y el respaldo fallan, la factura entra sin leer y escala. En el celular la página todavía puede moverse un poco al aterrizar; las tarjetas reservan altura para que el gráfico no empuje. La película oficial está en YouTube; el mp4 de 150 s y el recorrido de 128 s siguen en el Worker. Detalle en el README.
---

## Enlaces (los tres primeros son obligatorios)

- **Repositorio público de GitHub:** https://github.com/Robertzu43/30x-hackathon-roberto-zuniga (debe estar en público antes de enviar)
- **Demo (URL):** https://30x-hackathon.30x-hackathon-roberto-zuniga.workers.dev/demo
- **Video demo (URL):** https://www.youtube.com/watch?v=z8IdL3_Skvg (película oficial)
- **Copia alojada del lanzamiento (150 s):** https://30x-hackathon.30x-hackathon-roberto-zuniga.workers.dev/demo/thesaurus-launch.mp4
- **Recorrido completo sin editar (128 s):** https://30x-hackathon.30x-hackathon-roberto-zuniga.workers.dev/demo/happy-path.webm
- **Portal de proveedores:** https://facturas.30x-hackathon-roberto-zuniga.workers.dev/andina-labs
- **Diagrama de arquitectura:** https://30x-hackathon.30x-hackathon-roberto-zuniga.workers.dev/demo/architecture.png (SVG: https://30x-hackathon.30x-hackathon-roberto-zuniga.workers.dev/demo/architecture.svg)
