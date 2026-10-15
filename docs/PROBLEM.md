# The problem (DRY RUN, 15 Oct 2026: a fake company to exercise the harness; the real one replaces this file at kickoff)

## Company
Rutas del Norte S.A.S., Bogotá. Last-mile delivery for small e-commerce brands: about 120 deliveries a day with 9 motorcycle couriers. Problem owner: Carolina, operations lead and the only dispatcher.

## The problem in their words
"Asignamos los domicilios por WhatsApp. Cada mañana le mando a cada mensajero su lista en un chat, durante el día me escriben 'entregado' o 'no estaba', y a las 6pm no sé qué quedó pendiente. Los clientes llaman a preguntar por su pedido y yo tengo que buscar en nueve chats. Perdemos entre 5 y 10 pedidos a la semana porque nadie los reclamó."

## Who uses the result and how often
- Carolina (dispatcher): all day, laptop, in the office. Loads the day's orders, assigns and reassigns couriers, sees what is pending and what failed.
- 9 couriers: phone, on the street, 10 to 20 times a day. Need their list for today and a way to mark each delivery delivered or failed with a reason.
- Occasionally a brand's customer-service person asks Carolina for the status of one order.

## What they do today
A spreadsheet of the day's orders (CSV exported from the brands' stores), one WhatsApp chat per courier, a paper notebook for failed deliveries. No history once the day ends.

## What "working" means to them on Monday
"Que a las 6pm vea en una sola pantalla qué se entregó, qué falló y por qué, sin preguntar en ningún chat."

## Constraints they mentioned
- Couriers use cheap Android phones on mobile data. A web page that works on a phone is fine; no app store.
- Spanish only. Bogotá addresses, Colombian phone numbers (+57).
- Orders arrive as CSV from the brands with columns: pedido, cliente, telefono, direccion, barrio, valor. No API exists.
- No budget for the WhatsApp Business API this month. WhatsApp stays a fallback channel, not integrated.
- The dispatcher must be able to reassign a delivery to another courier during the day.

## Existing systems we may need to understand
(none; the CSV export is the only interface)
