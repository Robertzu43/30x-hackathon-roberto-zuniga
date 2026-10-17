-- Thesaurus lockdown (Task 2b: AC-68, AC-69, R-32, R-33). Forward-only and additive.
-- R-32: members never write the decision record; only the Worker's service role does (record.ts, approval link, cron).
-- The member insert policies of 000100 stay, inert without the table privilege.
revoke insert on public.decisions, public.approval_tokens, public.approval_uses, public.agent_runs from public, anon, authenticated;
revoke execute on function public.insert_decision(uuid, numeric, jsonb, int) from public, anon, authenticated;
grant execute on function public.insert_decision(uuid, numeric, jsonb, int) to service_role;

-- R-33: the 000200 guard plus the PAGAR invariant (D2, R-21), checked after FINAL_DECISION and NOT_ESCALATED.
-- Agent PAGAR: >= 13 checks, all cumple, none overridden. Human PAGAR: >= 13 checks, every non-cumple one overridden
-- (an object) and one of the 8 human-overridable checks of AC-34.
create or replace function public.decisions_guard() returns trigger language plpgsql set search_path = '' as $$
declare v_last public.decisions;
begin
  select * into v_last from public.decisions where invoice_id = new.invoice_id order by seq desc limit 1;
  if v_last.outcome in ('PAGAR', 'FRENAR') then raise exception 'FINAL_DECISION'; end if;
  if new.actor = 'human' and v_last.outcome is distinct from 'ESCALAR' then raise exception 'NOT_ESCALATED'; end if;
  if new.outcome = 'PAGAR' and not (jsonb_array_length(new.checks) >= 13 and case new.actor
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
