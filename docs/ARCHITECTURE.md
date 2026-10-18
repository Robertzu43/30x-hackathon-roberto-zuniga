# Arquitectura

Thesaurus separa leer, decidir e impedir. Un modelo no puede escribir PAGAR.

## Oficio de cada pieza

1. **Leer.** [`src/lib/llm.ts`](../src/lib/llm.ts) es el único sitio que llama a un modelo para una factura o una pregunta. Amazon Nova Lite en Bedrock (us-east-2) va primero; Workers AI es el respaldo. La salida son campos con confianza. [`src/lib/amount-guard.ts`](../src/lib/amount-guard.ts) corre sobre el texto antes de fiarse del monto: nota de crédito o total que no cuadra dejan el monto desconocido.
2. **Decidir.** [`src/agent/loop.ts`](../src/agent/loop.ts) recorre percibe → lee → consulta → decide → actúa → rinde cuentas, en orden de llegada. No elige herramientas ni resultados con un modelo. El resultado sale de [`src/engine/decide.ts`](../src/engine/decide.ts): 13 controles puros y una tabla fija. FRENAR (duplicado exacto o límite por pago) gana. PAGAR solo con los 13 en `cumple`, o con una persona que desbloqueó únicamente `HUMAN_OVERRIDABLE`. Todo lo demás es ESCALAR.
3. **Impedir.** Postgres aplica la misma regla en [`decisions_guard`](../supabase/migrations/20261018000300_pagar_check_ids.sql), también si escribe el rol de servicio. Los miembros no pueden insertar decisiones. PAGAR y FRENAR son finales. RLS está activo en las 14 tablas de `public`.
4. **Explicar.** [`src/engine/explain.ts`](../src/engine/explain.ts) rellena plantillas en español (es-CO) e inglés. El texto del registro no lo escribe un modelo. «Pregúntale a Thesaurus» responde con ese registro y no aprueba ni paga.
5. **Avisar.** Un ESCALAR nuevo de una empresa que no es la demo ni una prueba manda un par de enlaces HMAC, 48 horas, un solo uso. Abrir el enlace no actúa. Si SES no envía, la decisión queda igual ([`src/lib/email.ts`](../src/lib/email.ts)).

## Dónde corre

| Pieza | Dónde | Qué no hace |
|---|---|---|
| Worker `30x-hackathon` | Cloudflare Workers, Hono, [`src/index.ts`](../src/index.ts) | No mueve dinero |
| App | Vite + React, servida por el mismo Worker | No decide |
| Cron | `*/5 * * * *` decide pendientes; `0 11 * * *` (06:00 America/Bogota) refresca tasas | «Reevaluar» no baja tasas nuevas |
| Worker `facturas` | [`portal/wrangler.toml`](../portal/wrangler.toml) | El proveedor no ve cuentas ni razones |
| Postgres | Supabase: datos, Auth, Storage | Un cliente no inserta `decisions` |
| Tasas | Yahoo Finance, respaldo open.er-api.com, o la cifra fijada en la política | Sin tasa vigente, escala |

El candado es `pg_advisory_xact_lock` sobre el id de la empresa, dentro de `insert_decision`. Si otro intento ya movió el comprometido del mes, este relee y vuelve a decidir.

## Límites de confianza

- Confianza del campo bajo 0,8, forma mala o `read_error`: el campo no existe para los controles.
- El beneficiario de confianza es la fila del directorio cuyo nombre coincide con el nombre ya aceptado. La ruta de pago es la de esa fila.
- Una persona no aprueba por encima del presupuesto, del saldo o del límite por pago, ni un duplicado exacto, ni una moneda sin tasa.
- La demo pública y las empresas de prueba no mandan correo de escalación.

Diagrama: [`architecture/architecture.svg`](architecture/architecture.svg) (el mismo archivo está en `web/public/demo/` para la página `/demo`). Texto del diagrama: [`architecture/architecture.txt`](architecture/architecture.txt).

**English.** A Worker runs a fixed loop. Nova Lite reads fields. `decide()` is the only function that returns PAGAR. A Postgres trigger rejects any other PAGAR, including one written with the service role. Explanations are templates. No real money moves.
