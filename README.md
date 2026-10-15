# Rutas del Norte: despacho de domicilios

Rutas del Norte (Bogotá) asigna unos 120 domicilios diarios a 9 mensajeros por WhatsApp, un chat por mensajero.
Al final del día nadie sabe con certeza qué se entregó, qué falló ni por qué, y se pierden de 5 a 10 pedidos por semana.
Esta aplicación web reemplaza esos chats: Carolina (despacho) carga el CSV de las marcas, asigna cada entrega a un mensajero
y a las 6 p. m. ve en una sola pantalla qué se entregó, qué falló y por qué.
Cada mensajero abre su lista del día en el celular y marca cada entrega como entregada o fallida, con el motivo.

URL en producción: https://30x-hackathon.30x-hackathon-roberto-zuniga.workers.dev (demo: `/demo`)

Proyecto de prueba (dry run) del 30X Hackathon; empresa ficticia. Bitácora de decisiones: `docs/LEDGER.md`.

## El problema, en palabras de la empresa

> "Asignamos los domicilios por WhatsApp. Cada mañana le mando a cada mensajero su lista en un chat, durante el día me escriben 'entregado' o 'no estaba', y a las 6pm no sé qué quedó pendiente. Los clientes llaman a preguntar por su pedido y yo tengo que buscar en nueve chats. Perdemos entre 5 y 10 pedidos a la semana porque nadie los reclamó."
>
> Carolina, jefe de operaciones y única despachadora

Lo que significa "funciona" para ellos el lunes: "Que a las 6pm vea en una sola pantalla qué se entregó, qué falló y por qué, sin preguntar en ningún chat."

## Qué se construyó

- **Despacho (`/`)**, en el computador: inicio de sesión; importación del CSV del día (`pedido, cliente, telefono, direccion, barrio, valor`, separado por `,` o `;`) con vista previa: las filas válidas y, aparte, las omitidas con su motivo (falta teléfono, falta dirección, pedido duplicado, teléfono inválido, valor inválido). Nada se guarda hasta "Confirmar".
- Tablero con las entregas de hoy (fecha de Bogotá), asignación y reasignación de mensajero (una entrega `entregado` ya no se reasigna).
- **Cierre del día**: entregados, fallidos y pendientes (pendiente + asignado), que suman el total del día, y la lista de fallidos con mensajero y motivo.
- **Mensajero (`/mensajero`)**, en el celular (360 px): solo sus entregas de hoy, teléfono que se toca para llamar, botones "Entregado" y "Fallido" (este exige un motivo: no estaba, dirección errada, rechazado, otro). Una entrega ya marcada no se puede cambiar desde el celular; solo despacho la reabre reasignándola.
- **Demo (`/demo`)**, sin sesión: qué hace el producto, las cuentas de prueba y los totales de hoy.
- Seguridad: cada endpoint de `/api` exige sesión y rol (401 / 403); un mensajero no ve ni cambia entregas de otro; todas las tablas tienen RLS.
- Pila: Cloudflare Workers (Hono + React/Vite en la misma URL), Supabase (Postgres y Auth). Teléfonos en E.164 (`+57...`), valores en COP sin decimales (`$ 45.000`), fechas `dd/mm/aaaa`.

## Cuentas de demostración

Contraseña para las tres: `Demo2026!` (son datos de prueba, públicos a propósito; los crea `scripts/seed.mjs`).

| Rol | Nombre | Correo | Entra por |
|---|---|---|---|
| Despacho | Carolina Gómez | `carolina@rutasdelnorte.demo` | `/` |
| Mensajero | Andrés Pérez | `andres@rutasdelnorte.demo` | `/mensajero` |
| Mensajero | Luisa Martínez | `luisa@rutasdelnorte.demo` | `/mensajero` |

Después de `npm run seed`, hoy tiene 12 entregas: 2 pendientes, 4 asignadas, 4 entregadas y 2 fallidas (una "no estaba", una "dirección errada"). El cierre del día muestra 4 / 2 / 6.

## Cómo correrlo localmente

Requisitos: Node 22, y en el entorno (nunca en un archivo del repo) `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.

```bash
npm ci
npm run lint && npm run typecheck && npm test   # pruebas unitarias y de API
# La prueba test/seed.test.ts contra Supabase real es opcional (RUN_LIVE_SEED_TEST=1) y borra todos los pedidos de hoy; sin esa variable se omite.
npm run build && npx wrangler dev               # http://localhost:8787 (el Worker local necesita SUPABASE_SERVICE_ROLE_KEY en .dev.vars, que git ignora)
npm run seed                                    # deja hoy exactamente con los 12 pedidos de demostración
```

`npm run seed` borra todas las entregas con fecha de hoy (Bogotá), incluidas las importadas por CSV, y vuelve a crear las 12 de demostración. No toca otros días.

## Cómo desplegar

```bash
bash scripts/db-push.sh          # migraciones de supabase/migrations/ (idempotente)
npm run deploy                   # vite build + wrangler deploy; imprime la URL
bash scripts/worker-secrets.sh   # sube SUPABASE_SERVICE_ROLE_KEY y demás secretos al Worker (la primera vez)
npm run seed                     # datos de demostración con la fecha de hoy
```

La configuración pública (URL de Supabase, clave anon) está en `wrangler.toml`; los secretos solo van con `wrangler secret put`.

## Recorrido grabado (happy path)

`docs/demo/happy-path.webm`: Carolina entra, sube `docs/demo/pedidos-ejemplo.csv` (la vista previa muestra 2 filas omitidas), confirma, asigna dos pedidos a Andrés; Andrés entra en un celular de 360 px, marca uno entregado y otro fallido ("no estaba"); Carolina abre el cierre del día y ve 5 / 3 / 9 y el motivo. Para volver a grabarlo (resiembra los datos antes de empezar):

```bash
BASE_URL=https://30x-hackathon.30x-hackathon-roberto-zuniga.workers.dev npx playwright test e2e/happy-path.spec.ts
npm run seed   # deja la demo limpia otra vez
```

## Qué no está hecho

- **AC-28 (SHOULD), correo de cierre a las 6 p. m.**: construido (cron `0 23 * * *`, que son las 6 p. m. en Bogotá, en `src/cron.ts`; envío por `src/lib/email.ts`). Una prueba automatizada lo verifica con Resend simulado. Pero el remitente es una dirección `@resend.dev`: el envío real a Carolina requiere un dominio verificado en Resend y `RESEND_FROM` con esa dirección (`wrangler secret put`). El cron en vivo nunca se vio enviando un correo.
- El motivo "otro" no tiene campo de texto libre (decisión R-09).
- Sin registro de usuarios ni cambio de contraseña: las cuentas las crea el seed o se crean en Supabase Auth con su fila en `profiles`.
- Sin integración con WhatsApp ni con las tiendas de las marcas (fuera de alcance): el CSV es la única entrada.
- La página `/demo` muestra los totales de hoy de toda la base, no solo de las cuentas de demostración.
