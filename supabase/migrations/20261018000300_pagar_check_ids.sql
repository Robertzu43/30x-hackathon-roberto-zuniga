-- Safety invariant of public.decisions_guard(), the database half of src/engine/decide.ts:
-- - PAGAR and FRENAR are final (FINAL_DECISION). A human row is allowed only after an ESCALAR (NOT_ESCALATED).
-- - An agent PAGAR needs the 13 engine check ids, each distinct, every verdict 'cumple', and no `overridden` key.
--   Length alone is not enough: 13 copies of one passing check are PAGAR_OUTSIDE_RULES.
-- - A human PAGAR may leave a verdict other than 'cumple' only when `overridden` is an object and the id is one of
--   umbral_aprobacion, beneficiario_permitido, beneficiario_cuenta, acuerdo, duplicado_probable, vencimiento,
--   periodo, lectura. Budget, balance, per-payment limit, exact duplicate and moneda cannot be overridden.
-- Forward-only: replaces decisions_guard; no drop, delete or truncate.
create or replace function public.decisions_guard() returns trigger language plpgsql set search_path = '' as $$
declare
  v_last public.decisions;
  v_ids text[] := array[
    'lectura', 'beneficiario_permitido', 'beneficiario_cuenta', 'acuerdo', 'duplicado_exacto', 'duplicado_probable',
    'limite_pago', 'umbral_aprobacion', 'presupuesto_periodo', 'saldo_cuenta', 'vencimiento', 'periodo', 'moneda'
  ];
begin
  select * into v_last from public.decisions where invoice_id = new.invoice_id order by seq desc limit 1;
  if v_last.outcome in ('PAGAR', 'FRENAR') then raise exception 'FINAL_DECISION'; end if;
  if new.actor = 'human' and v_last.outcome is distinct from 'ESCALAR' then raise exception 'NOT_ESCALATED'; end if;
  if new.outcome = 'PAGAR' and not (jsonb_array_length(new.checks) >= 13
      and (select count(distinct c ->> 'id') from jsonb_array_elements(new.checks) c where c ->> 'id' = any (v_ids)) = 13
      and case new.actor
      when 'agent' then not exists (select 1 from jsonb_array_elements(new.checks) c
        where c ->> 'verdict' is distinct from 'cumple' or c ? 'overridden')
      when 'human' then not exists (select 1 from jsonb_array_elements(new.checks) c
        where c ->> 'verdict' is distinct from 'cumple'
          and (jsonb_typeof(c -> 'overridden') is distinct from 'object'
            or coalesce(c ->> 'id', '') not in ('umbral_aprobacion', 'beneficiario_permitido', 'beneficiario_cuenta',
              'acuerdo', 'duplicado_probable', 'vencimiento', 'periodo', 'lectura')))
      else false end) then
    raise exception 'PAGAR_OUTSIDE_RULES';
  end if;
  new.seq := coalesce(v_last.seq, 0) + 1;
  new.company_id := (select company_id from public.invoices where id = new.invoice_id);
  return new;
end $$;
