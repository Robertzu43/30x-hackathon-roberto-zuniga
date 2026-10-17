# Entrega: HackRadar "Mi proyecto"

Roberto solo copia y pega estos campos.

## Identidad del proyecto

**Nombre del proyecto:** Thesaurus

**Reto que resuelve:** Reto Blinka: Agentes que pagan por la empresa

**Descripción (lo que verá el jurado):** el texto entre las líneas de abajo, sin las líneas.

---
Thesaurus es un agente de pagos construido para Blinka. Revisa las facturas de una empresa, decide cuáles pagar dentro de las reglas que la empresa define y, cuando algo se sale de esas reglas, le hace una pregunta concreta a una persona.

EL PROBLEMA
Hoy llega una factura por correo, PDF o chat. Alguien de finanzas la compara con lo acordado, busca los datos de quien cobra, pide aprobación por chat, crea el pago a mano y concilia en una hoja de cálculo. Es manual, se repite cada mes y depende de que una persona esté disponible. Lo que falta resolver es la confianza: que el agente pague solo lo que debe, explique cada decisión y nunca se pase de los límites que le pusieron.

QUÉ HACE, COMO AGENTE
Cada factura recorre un ciclo: percibe (llega por PDF, imagen, correo pegado o chat pegado) → lee (el LLM la convierte en campos con confianza) → consulta sus herramientas (directorio de beneficiarios, política, estado del periodo, duplicados) → decide (el motor de reglas) → actúa (registra, escala, le escribe al aprobador y prepara la orden de pago) → rinde cuentas (el registro de la decisión).
Trabaja solo: cada 5 minutos revisa las facturas pendientes de todas las empresas, aunque nadie esté conectado. Tiene tres resultados: PAGAR (cumple las 13 reglas), FRENAR (duplicado exacto o sobre el límite por pago, final) y ESCALAR (el agente le pregunta a una persona, por ejemplo: "Juan, la factura #2044 de Nube Sur LLC por 4.200 USD supera tu umbral de aprobación de 2.500 USD. ¿La pago?" con los botones Aprobar y Rechazar, en pantalla y por correo).
La empresa configura sus reglas en un formulario: límite por pago, umbral de aprobación, presupuesto del periodo, saldo, ventana de duplicados, tolerancia del acuerdo, tasas de cambio y beneficiarios permitidos. Cada cambio es una versión nueva y se puede reevaluar lo pendiente.

SEGURIDAD POR DISEÑO
El reto descalifica un pago fuera de las reglas, así que no depende de que el código se porte bien:
1. El LLM solo lee. Solo la función pura decide() puede producir PAGAR, y solo si los 13 controles cumplen. Ningún modelo ni prompt escribe un pago.
2. La base de datos rechaza un PAGAR fuera de las reglas, incluso si el Worker tuviera un error.
3. Ningún usuario puede escribir decisiones: solo el agente del servidor. Ni siquiera la cuenta pública de la demo.
4. El registro es de solo adición: una aprobación humana es una fila nueva, nada se edita ni se borra. PAGAR y FRENAR son finales.
5. Los enlaces de aprobación van firmados, vencen a las 48 horas y se usan una sola vez; abrirlos no actúa, solo el botón Confirmar.
6. Dos facturas simultáneas no pueden pasarse del presupuesto. Una persona no puede aprobar por encima del presupuesto, del saldo ni del límite por pago.
No se mueve dinero real ni se toca ninguna plataforma de pagos: el agente decide, registra y explica.

EXPLICABILIDAD
Cada factura tiene un registro que una persona entiende sin abrir el código: un titular de una frase, "Lo que hice" (los pasos del agente), "Lo que leí" y "Lo que decidí" (cada control con el valor real, el umbral y la cuenta), qué tendría que pasar para pagarla, la política y su versión, y el historial de quién actuó. Los textos salen de plantillas con valores reales, en español e inglés, nunca de un modelo. La pantalla Periodo muestra Autonomía, Violaciones (pagos fuera de las reglas) y Decisiones explicadas sobre un set de 29 facturas con casos normales y trampa: duplicado exacto y con otro número, beneficiario nuevo, cuenta cambiada, sobre el límite, sobre el umbral, monto que no cuadra con el acuerdo, COP sobre el límite, presupuesto agotado, saldo insuficiente, factura ilegible, vencida y fuera del periodo.

CÓMO PROBARLO
Abre https://30x-hackathon.30x-hackathon-roberto-zuniga.workers.dev/demo y pulsa "Entrar como Andina Labs" (empresa ficticia, sin cuenta ni código). Sube /demo/invoices/01.pdf (sale FRENAR por duplicado exacto), pega un mensaje de chat de un proveedor nuevo (sale ESCALAR), cambia el límite por pago en Política y pulsa "Reevaluar pendientes", o aprueba la factura de Nube Sur. "Reiniciar demo" deja todo como al inicio.

LO QUE NO ESTÁ HECHO
AWS negó el acceso de producción de SES: el correo solo llega a direcciones verificadas, y por eso la demo no lo necesita. La capa opcional JEV no está construida. La cuenta de Cloudflare es gratuita, así que las ejecuciones grandes se reparten en lotes. El README lo detalla.
---

## Enlaces (los tres son obligatorios)

- **Repositorio público de GitHub:** https://github.com/Robertzu43/30x-hackathon-roberto-zuniga (debe estar en público antes de enviar)
- **Demo (URL):** https://30x-hackathon.30x-hackathon-roberto-zuniga.workers.dev/demo
- **Video demo (URL):** PENDIENTE (lo llena la tarea 18)
