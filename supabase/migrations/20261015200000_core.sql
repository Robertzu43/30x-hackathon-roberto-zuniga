-- Core schema (AC-01, AC-02, AC-06). The Worker writes with service_role; policies are defence in depth.
create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  full_name text not null,
  role text not null check (role in ('dispatcher','courier'))
);
create table public.deliveries (
  id uuid primary key default gen_random_uuid(),
  delivery_date date not null,
  pedido text not null,
  cliente text not null,
  telefono text not null check (telefono ~ '^\+57[0-9]{10}$'),
  direccion text not null,
  barrio text not null default '',
  valor integer not null check (valor >= 0),
  status text not null default 'pendiente' check (status in ('pendiente','asignado','entregado','fallido')),
  courier_id uuid references public.profiles(id),
  failure_reason text check (failure_reason in ('no_estaba','direccion_errada','rechazado','otro')),
  updated_at timestamptz not null default now(),
  unique (delivery_date, pedido)
);
create index deliveries_date_courier_idx on public.deliveries (delivery_date, courier_id);

alter table public.profiles enable row level security;
alter table public.deliveries enable row level security;
create policy profiles_select_own on public.profiles for select using (id = auth.uid());
create policy deliveries_select on public.deliveries for select using (
  courier_id = auth.uid()
  or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'dispatcher')
);
-- down
-- drop table public.deliveries;
-- drop table public.profiles;
