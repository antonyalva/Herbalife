-- =====================================================================
--  Migración 02: costo real y precios fijos por producto
--  + los clientes del catálogo ya no pueden leer tus costos
--  Pegar en Supabase > SQL Editor > New query > Run  (una sola vez)
--  (Si aún no ejecutaste la migración 01, ejecútala primero.)
-- =====================================================================

alter table public.products add column if not exists cost numeric(10,2) check (cost is null or cost >= 0);
alter table public.products add column if not exists prices jsonb not null default '{}'::jsonb;

-- Columnas visibles para visitantes anónimos (catálogo): sin costo
revoke select on public.products from anon;
grant select (id, name, category, public_price, prices, image_url, images, description, active, created_at)
  on public.products to anon;

revoke select on public.settings from anon;
grant select (id, business_name, whatsapp, discount_levels) on public.settings to anon;
