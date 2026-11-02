-- =====================================================================
--  Migración 04: referidos (enlace personal por cliente)
--  Pegar en Supabase > SQL Editor > New query > Run  (una sola vez)
--  (Requiere haber ejecutado antes las migraciones 01, 02 y 03.)
-- =====================================================================

-- Código corto y único por cliente para su enlace: catalogo.html?ref=CODIGO
alter table public.customers add column if not exists ref_code text;
update public.customers set ref_code = substr(md5(id::text), 1, 6) where ref_code is null;
alter table public.customers alter column ref_code set default substr(md5(gen_random_uuid()::text), 1, 6);
alter table public.customers alter column ref_code set not null;
create unique index if not exists customers_ref_code_idx on public.customers (ref_code);

-- Pedido referido por un cliente
alter table public.orders add column if not exists referred_by uuid references public.customers(id) on delete set null;

-- La función del catálogo ahora acepta el código de referido
drop function if exists public.crear_pedido_catalogo(text, text, text, int, jsonb);

create or replace function public.crear_pedido_catalogo(
  p_nombre text, p_telefono text, p_nota text, p_descuento int, p_items jsonb, p_ref text default null
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_levels int[]; v_cost_pct int; v_d int; v_ref uuid;
  v_order_id uuid; v_number bigint;
  v_total numeric := 0; v_cost numeric := 0;
  it jsonb; v_p products%rowtype; v_qty int; v_price numeric; v_cost_u numeric;
begin
  if p_nombre is null or length(trim(p_nombre)) = 0 then raise exception 'Falta el nombre'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 50 then
    raise exception 'Pedido inválido';
  end if;

  select discount_levels, cost_discount_pct into v_levels, v_cost_pct from settings where id = 1;
  v_d := case when p_descuento = any(v_levels) then p_descuento else 0 end;

  if p_ref is not null and length(trim(p_ref)) > 0 then
    select id into v_ref from customers where ref_code = lower(trim(p_ref));
  end if;

  insert into orders (customer_name, customer_phone, discount_pct, note, source, status, referred_by)
  values (left(trim(p_nombre), 80), left(coalesce(p_telefono, ''), 30), v_d, left(coalesce(p_nota, ''), 300), 'catalogo', 'pendiente', v_ref)
  returning id, number into v_order_id, v_number;

  for it in select * from jsonb_array_elements(p_items) loop
    v_qty := (it->>'qty')::int;
    if v_qty is null or v_qty < 1 or v_qty > 999 then raise exception 'Cantidad inválida'; end if;
    select * into v_p from products where id = (it->>'product_id')::uuid and active;
    if not found then raise exception 'Producto no disponible'; end if;

    v_price  := coalesce((v_p.prices ->> v_d::text)::numeric, round(v_p.public_price * (1 - v_d / 100.0), 2));
    v_cost_u := coalesce(v_p.cost, round(v_p.public_price * (1 - v_cost_pct / 100.0), 2));

    insert into order_items (order_id, product_id, product_name, qty, public_price, unit_price, unit_cost)
    values (v_order_id, v_p.id, v_p.name, v_qty, v_p.public_price, v_price, v_cost_u);

    v_total := v_total + v_qty * v_price;
    v_cost  := v_cost  + v_qty * v_cost_u;
  end loop;

  update orders set total = round(v_total, 2), cost = round(v_cost, 2) where id = v_order_id;
  return v_number;
end $$;

revoke all on function public.crear_pedido_catalogo(text, text, text, int, jsonb, text) from public;
grant execute on function public.crear_pedido_catalogo(text, text, text, int, jsonb, text) to anon, authenticated;
