-- =====================================================================
--  Migración 07: enlaces de descuento seguros + pago y entrega separados
--  Pegar en Supabase > SQL Editor > New query > Run  (una sola vez)
--  (Requiere haber ejecutado antes las migraciones 01 a 06.)
--
--  1) Antes el descuento iba escrito en el enlace (&d=35) y cualquiera podía
--     cambiar el número. Ahora cada nivel de descuento tiene un código secreto
--     (&p=CODIGO) que solo conoce quien recibe el enlace.
--     OJO: los enlaces y QR antiguos con "&d=" pasan a mostrar precio público;
--     hay que volver a enviar los nuevos (Ajustes > Compartir catálogo).
--  2) Cada pedido tiene dos marcas independientes: pagado y entregado.
--  - Se puede ejecutar más de una vez sin problema.
-- =====================================================================

-- ---------- 1) Código secreto por nivel de descuento ----------
alter table public.settings add column if not exists level_codes jsonb not null default '{}'::jsonb;   -- {"35": "a1b2c3d4e5", "20": "..."}

-- Se generan solos para cada nivel (mayor a 0) que aún no tenga código
create or replace function public.settings_level_codes() returns trigger
language plpgsql as $$
declare d int;
begin
  new.level_codes := coalesce(new.level_codes, '{}'::jsonb);
  foreach d in array new.discount_levels loop
    if d > 0 and not (new.level_codes ? d::text) then
      new.level_codes := new.level_codes || jsonb_build_object(d::text, substr(md5(gen_random_uuid()::text), 1, 10));
    end if;
  end loop;
  return new;
end $$;
drop trigger if exists settings_codes on public.settings;
create trigger settings_codes before insert or update on public.settings
  for each row execute function public.settings_level_codes();

update public.settings set level_codes = level_codes;   -- genera los códigos de los ajustes que ya existen

-- El catálogo pregunta qué descuento corresponde a un código (nunca ve la lista de códigos)
create or replace function public.nivel_catalogo(p_tienda text, p_codigo text) returns int
language sql stable security definer set search_path = public as $$
  select coalesce((
    select kv.key::int
      from settings s, jsonb_each_text(s.level_codes) kv
     where (case when coalesce(trim(p_tienda), '') <> '' then s.slug = lower(trim(p_tienda)) else s.is_default end)
       and kv.value = trim(p_codigo)
       and kv.key::int = any(s.discount_levels)
     limit 1), 0);
$$;
revoke all on function public.nivel_catalogo(text, text) from public;
grant execute on function public.nivel_catalogo(text, text) to anon, authenticated;

-- ---------- 2) Pago y entrega por separado ----------
alter table public.orders add column if not exists paid boolean not null default false;
alter table public.orders add column if not exists delivered boolean not null default false;

-- Pedidos existentes: "pagado" contaba como pagado y entregado; "entregado" como entregado sin pagar
update public.orders set paid = true, delivered = true where status = 'pagado' and not (paid and delivered);
update public.orders set delivered = true where status = 'entregado' and not delivered;

-- El estado se calcula solo a partir de las dos marcas (cancelado se respeta)
create or replace function public.orders_sync_status() returns trigger
language plpgsql as $$
begin
  if new.status = 'cancelado' then return new; end if;
  if tg_op = 'UPDATE' and new.status is distinct from old.status and old.status <> 'cancelado'
     and new.paid = old.paid and new.delivered = old.delivered then
    -- versión anterior de la app: solo cambió el estado
    new.paid := new.status = 'pagado';
    new.delivered := new.status in ('entregado', 'pagado');
  end if;
  new.status := case when new.paid then 'pagado' when new.delivered then 'entregado' else 'pendiente' end;
  return new;
end $$;
drop trigger if exists orders_status on public.orders;
create trigger orders_status before insert or update on public.orders
  for each row execute function public.orders_sync_status();

-- ---------- 3) Pedidos desde el catálogo: el descuento sale del código, no del número ----------
drop function if exists public.crear_pedido_catalogo(text, text, text, int, jsonb, text, text);

create or replace function public.crear_pedido_catalogo(
  p_nombre text, p_telefono text, p_nota text, p_descuento int, p_items jsonb,
  p_ref text default null, p_tienda text default null, p_codigo text default null
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid; v_levels int[]; v_cost_pct int; v_codes jsonb; v_d int; v_ref uuid;
  v_sponsor uuid; v_catalog uuid; v_aff_pct int;
  v_order_id uuid; v_number bigint;
  v_total numeric := 0; v_cost numeric := 0;
  it jsonb; v_p products%rowtype; v_qty int; v_price numeric; v_cost_u numeric;
begin
  if p_nombre is null or length(trim(p_nombre)) = 0 then raise exception 'Falta el nombre'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 50 then
    raise exception 'Pedido inválido';
  end if;

  if p_tienda is not null and length(trim(p_tienda)) > 0 then
    select owner_id, discount_levels, cost_discount_pct, sponsor_id, level_codes into v_owner, v_levels, v_cost_pct, v_sponsor, v_codes
      from settings where slug = lower(trim(p_tienda));
  else
    select owner_id, discount_levels, cost_discount_pct, sponsor_id, level_codes into v_owner, v_levels, v_cost_pct, v_sponsor, v_codes
      from settings where is_default;
  end if;
  if v_owner is null then raise exception 'Tienda no encontrada'; end if;

  -- p_descuento ya no se usa (se conserva para no romper versiones anteriores del catálogo)
  if p_codigo is not null and length(trim(p_codigo)) > 0 then
    select kv.key::int into v_d from jsonb_each_text(v_codes) kv
     where kv.value = trim(p_codigo) and kv.key::int = any(v_levels) limit 1;
  end if;
  v_d := coalesce(v_d, 0);

  v_catalog := coalesce(v_sponsor, v_owner);   -- de quién son los productos
  if v_sponsor is not null then
    select affiliate_discount_pct into v_aff_pct from settings where owner_id = v_sponsor;
  end if;

  if p_ref is not null and length(trim(p_ref)) > 0 then
    select id into v_ref from customers where ref_code = lower(trim(p_ref)) and owner_id = v_owner;
  end if;

  insert into orders (owner_id, customer_name, customer_phone, discount_pct, note, source, status, referred_by)
  values (v_owner, left(trim(p_nombre), 80), left(coalesce(p_telefono, ''), 30), v_d, left(coalesce(p_nota, ''), 300), 'catalogo', 'pendiente', v_ref)
  returning id, number into v_order_id, v_number;

  for it in select * from jsonb_array_elements(p_items) loop
    v_qty := (it->>'qty')::int;
    if v_qty is null or v_qty < 1 or v_qty > 999 then raise exception 'Cantidad inválida'; end if;
    select * into v_p from products where id = (it->>'product_id')::uuid and active and owner_id = v_catalog;
    if not found then raise exception 'Producto no disponible'; end if;

    v_price := coalesce((v_p.prices ->> v_d::text)::numeric, round(v_p.public_price * (1 - v_d / 100.0), 2));
    if v_sponsor is not null then
      v_cost_u := round(v_p.public_price * (1 - coalesce(v_aff_pct, 25) / 100.0), 2);
    else
      v_cost_u := coalesce(v_p.cost, round(v_p.public_price * (1 - v_cost_pct / 100.0), 2));
    end if;

    insert into order_items (order_id, product_id, product_name, qty, public_price, unit_price, unit_cost)
    values (v_order_id, v_p.id, v_p.name, v_qty, v_p.public_price, v_price, v_cost_u);

    v_total := v_total + v_qty * v_price;
    v_cost  := v_cost  + v_qty * v_cost_u;
  end loop;

  update orders set total = round(v_total, 2), cost = round(v_cost, 2) where id = v_order_id;
  return v_number;
end $$;

revoke all on function public.crear_pedido_catalogo(text, text, text, int, jsonb, text, text, text) from public;
grant execute on function public.crear_pedido_catalogo(text, text, text, int, jsonb, text, text, text) to anon, authenticated;
