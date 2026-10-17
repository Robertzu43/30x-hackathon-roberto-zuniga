# Entrega: HackRadar "Mi proyecto"

Roberto solo copia y pega estos campos.

## Identidad del proyecto

**Nombre del proyecto:** Thesaurus

**Reto que resuelve:** Reto Blinka: Agentes que pagan por la empresa

**Descripción (lo que verá el jurado):** el texto entre las líneas de abajo, sin las líneas.

---
Thesaurus es un agente de pagos para Blinka. Revisa las facturas de una empresa, decide cuáles pagar dentro de sus reglas y, cuando algo se sale de ellas, le hace una pregunta concreta a una persona.

EL PROBLEMA
Hoy una factura llega por correo, PDF o chat. Alguien de finanzas la compara con lo acordado, busca los datos de quien cobra, pide aprobación por chat, crea el pago a mano y concilia en una hoja. Es manual, se repite cada mes y depende de una persona disponible. Falta confianza: que el agente pague solo lo que debe, explique cada decisión y nunca se pase de sus límites.

QUÉ HACE, COMO AGENTE
Cada factura recorre un ciclo: percibe (llega por PDF, imagen, correo pegado o chat pegado) → lee (el LLM la convierte en campos con confianza) → consulta sus herramientas (directorio de beneficiarios, política, estado del periodo, duplicados) → decide (el motor de reglas) → actúa (registra, escala, le escribe al aprobador y prepara la orden de pago) → rinde cuentas (el registro de la decisión).
Trabaja solo: cada 5 minutos revisa las facturas pendientes de todas las empresas, sin nadie conectado. Tiene tres resultados: PAGAR (cumple las 13 reglas), FRENAR (duplicado exacto o sobre el límite por pago) y ESCALAR (el agente le pregunta a una persona, por ejemplo: "Juan, la factura #2044 de Nube Sur LLC por 4.200 USD supera tu umbral de aprobación de 2.500 USD. ¿La pago?" con los botones Aprobar y Rechazar, en pantalla y por correo).
La empresa configura sus reglas en un formulario (límite por pago, umbral de aprobación, presupuesto, saldo, ventana de duplicados, tolerancia, tasas de cambio y beneficiarios). Cada cambio es una versión nueva y se reevalúa lo pendiente.

SEGURIDAD POR DISEÑO
El reto descalifica un pago fuera de las reglas, así que no confía en que el código se porte bien:
1. El LLM solo lee. Solo la función pura decide() puede producir PAGAR, y solo si los 13 controles cumplen. Ningún modelo escribe un pago.
2. La base de datos rechaza un PAGAR fuera de las reglas, incluso si el Worker tuviera un error. Nota de honestidad: la consulta literal de AC-16 sin filtro devuelve 1 por una fila de prueba que QA falsificó por REST antes del bloqueo de la base; el agente nunca la escribió y ningún pago salió de ella. Consultas y detalles, en el README.
3. Ningún usuario puede escribir decisiones, ni la cuenta pública de la demo: solo el agente del servidor.
4. El registro es de solo adición: una aprobación humana es una fila nueva, nada se edita ni se borra. PAGAR y FRENAR son finales.
5. Los enlaces de aprobación van firmados, vencen a las 48 horas y se usan una sola vez; abrirlos no actúa.
6. Dos facturas simultáneas no pueden pasarse del presupuesto, y nadie aprueba por encima del presupuesto, del saldo ni del límite por pago.
No se mueve dinero real: el agente decide, registra y explica.

EXPLICABILIDAD
Cada factura tiene un registro que una persona entiende sin abrir el código: un titular de una frase, "Lo que hice", "Lo que leí" y "Lo que decidí" (cada control con el valor real, el umbral y la cuenta), qué tendría que pasar para pagarla, la política con su versión y quién actuó. Los textos salen de plantillas con valores reales, en español e inglés, no de un modelo. La pantalla Periodo muestra Autonomía, Violaciones (pagos fuera de las reglas) y Decisiones explicadas sobre un set de 29 facturas con casos normales y trampa: duplicados, beneficiario nuevo, cuenta cambiada, sobre el límite o el umbral, monto que no cuadra, presupuesto agotado, saldo insuficiente, ilegible, vencida y fuera del periodo.

CÓMO PROBARLO
Abre https://30x-hackathon.30x-hackathon-roberto-zuniga.workers.dev/demo y pulsa "Entrar como Andina Labs" (empresa ficticia). Sube /demo/invoices/01.pdf (sale FRENAR por duplicado exacto), pega un mensaje de chat de un proveedor nuevo (sale ESCALAR), cambia el límite por pago en Política y pulsa "Reevaluar pendientes", o prueba la aprobación: primero rechaza la factura de Laura Méndez (cuenta cambiada) y luego aprueba la de Nube Sur, que termina en PAGAR; si apruebas Nube Sur primero, el agente la vuelve a escalar por el presupuesto, y es lo correcto. "Reiniciar demo" lo deja como al inicio.

LO QUE NO ESTÁ HECHO
AWS negó el acceso de producción de SES: el correo solo llega a direcciones verificadas, y por eso la demo no lo necesita. La capa opcional JEV no está construida. La cuenta de Cloudflare es gratuita: las ejecuciones grandes se reparten en lotes. El lector gratuito da unas 250 lecturas diarias; si se agotan, una factura nueva entra como ESCALAR «sin leer». En las fotos la guardia del monto solo ve lo que el modelo transcribe. Retenciones y descuentos dentro del total se escalan. El repositorio sigue privado hasta que Roberto lo haga público. Ver el README.
---

## Enlaces (los tres son obligatorios)

- **Repositorio público de GitHub:** https://github.com/Robertzu43/30x-hackathon-roberto-zuniga (debe estar en público antes de enviar)
- **Demo (URL):** https://30x-hackathon.30x-hackathon-roberto-zuniga.workers.dev/demo
- **Video demo (URL):** PENDIENTE (lo llena la tarea 18)
