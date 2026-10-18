# Decisiones de producto (resumen)

El registro completo (`docs/DECISIONS.md`, `docs/LEDGER.md`, el plan y la especificación) está en la rama [`archive-full-main`](https://github.com/Robertzu43/30x-hackathon-roberto-zuniga/tree/archive-full-main). Esto es lo que cambia el producto.

## Tres resultados

- **PAGAR** solo si los 13 controles cumplen. Lo escribe únicamente `decide()` en `src/engine/decide.ts`.
- **FRENAR** (final) solo por duplicado exacto o por pasar el límite por pago (`FRENAR_ON`).
- **ESCALAR** en todo lo demás: dato que falta, regla que no cumple, o «no se pudo verificar». Si coinciden FRENAR y ESCALAR, gana FRENAR.

Una persona puede desbloquear lectura, beneficiario, cuenta, acuerdo, posible duplicado, umbral, vencimiento y periodo (`HUMAN_OVERRIDABLE`). Nadie aprueba por encima del presupuesto, del saldo o del límite por pago, ni un duplicado exacto, ni una moneda sin tasa: eso se cambia en la política y se reevalúa. PAGAR y FRENAR no se vuelven a decidir.

La IA lee facturas y responde preguntas sobre el registro. No escribe PAGAR.

## Autonomía y resultado correcto

Son dos cifras distintas, las dos sobre las 29 facturas de `docs/demo/DATASET.md`.

- **Resultado correcto: 29/29.** Cada fila tiene una etiqueta (`expected_outcome`). El motor llega a esa etiqueta (`src/engine/decide.test.ts`, tasas del 17 oct y las 32 esquinas de ±20 %). 15 PAGAR, 3 FRENAR, 11 ESCALAR. Las 11 escaladas son el resultado esperado, no un fallo.
- **Autonomía: 18/29 (62 %).** Solo cuentan las que el agente cierra solo (PAGAR o FRENAR) y que coinciden con la etiqueta, en la primera decisión (`solo` en `src/routes/screen.ts`). Una ESCALAR correcta no entra en el numerador.

Ninguna de las 11 se puede cerrar sola sin pagar fuera de las reglas o sin convertir en final un caso que las reglas dejan a una persona. No se recomienda cambiar la tabla de consecuencias.
