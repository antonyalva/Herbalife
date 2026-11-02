-- =====================================================================
--  Esquema de base de datos para la app "Mi Negocio Herbalife"
--  Pegar completo en Supabase > SQL Editor > New query > Run
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------- Ajustes del negocio (una sola fila) ----------
create table if not exists public.settings (
  id int primary key default 1 check (id = 1),
  business_name text not null default 'Mi Negocio Herbalife',
  whatsapp text not null default '',
  cost_discount_pct int not null default 50 check (cost_discount_pct between 0 and 100),
  discount_levels int[] not null default '{35,20,10,0}',
  updated_at timestamptz not null default now()
);
insert into public.settings (id) values (1) on conflict (id) do nothing;

-- ---------- Productos ----------
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null default '',
  public_price numeric(10,2) not null check (public_price >= 0),
  image_url text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------- Clientes ----------
create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text not null default '',
  discount_pct int not null default 20 check (discount_pct between 0 and 100),
  notes text not null default '',
  created_at timestamptz not null default now()
);

-- ---------- Pedidos ----------
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers(id) on delete set null,
  customer_name text not null default '',
  discount_pct int not null default 0,
  status text not null default 'pendiente'
    check (status in ('pendiente','entregado','pagado','cancelado')),
  note text not null default '',
  total numeric(10,2) not null default 0,
  cost numeric(10,2) not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  product_name text not null,
  qty int not null check (qty > 0),
  public_price numeric(10,2) not null,
  unit_price numeric(10,2) not null,
  unit_cost numeric(10,2) not null
);

create index if not exists orders_created_idx on public.orders (created_at desc);
create index if not exists order_items_order_idx on public.order_items (order_id);

-- ---------- Seguridad (RLS) ----------
alter table public.settings    enable row level security;
alter table public.products    enable row level security;
alter table public.customers   enable row level security;
alter table public.orders      enable row level security;
alter table public.order_items enable row level security;

-- Cualquiera (clientes con el enlace) puede ver el catálogo y los datos básicos del negocio
drop policy if exists "catalogo publico" on public.products;
create policy "catalogo publico" on public.products
  for select to anon using (active = true);

drop policy if exists "ajustes publicos" on public.settings;
create policy "ajustes publicos" on public.settings
  for select to anon using (true);

-- Solo el dueño (usuario autenticado) puede ver y modificar todo
drop policy if exists "dueno settings" on public.settings;
create policy "dueno settings" on public.settings
  for all to authenticated using (true) with check (true);

drop policy if exists "dueno products" on public.products;
create policy "dueno products" on public.products
  for all to authenticated using (true) with check (true);

drop policy if exists "dueno customers" on public.customers;
create policy "dueno customers" on public.customers
  for all to authenticated using (true) with check (true);

drop policy if exists "dueno orders" on public.orders;
create policy "dueno orders" on public.orders
  for all to authenticated using (true) with check (true);

drop policy if exists "dueno order_items" on public.order_items;
create policy "dueno order_items" on public.order_items
  for all to authenticated using (true) with check (true);

-- ---------- Fotos de productos (Storage) ----------
insert into storage.buckets (id, name, public)
  values ('productos', 'productos', true)
  on conflict (id) do nothing;

drop policy if exists "fotos publicas" on storage.objects;
create policy "fotos publicas" on storage.objects
  for select to anon, authenticated using (bucket_id = 'productos');

drop policy if exists "subir fotos" on storage.objects;
create policy "subir fotos" on storage.objects
  for insert to authenticated with check (bucket_id = 'productos');

drop policy if exists "editar fotos" on storage.objects;
create policy "editar fotos" on storage.objects
  for update to authenticated using (bucket_id = 'productos');

drop policy if exists "borrar fotos" on storage.objects;
create policy "borrar fotos" on storage.objects
  for delete to authenticated using (bucket_id = 'productos');
