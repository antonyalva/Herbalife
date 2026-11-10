-- =====================================================================
--  Migración 06: afiliados (equipo de venta)
--  Pegar en Supabase > SQL Editor > New query > Run  (una sola vez)
--  (Requiere haber ejecutado antes las migraciones 01 a 05.)
--
--  - Un usuario (el dueño) puede tener afiliados: otros usuarios que venden
--    SU catálogo. El afiliado no tiene productos propios: hereda los del dueño
--    (mismos nombres, fotos y precios al público).
--  - El costo del afiliado es el "precio de afiliado": precio público menos el
--    % que fija el dueño en Ajustes (25% por defecto).
--  - El afiliado nunca ve el costo real del dueño; el cliente final nunca ve
--    el precio de afiliado.
--  - Se puede ejecutar más de una vez sin problema.
-- =====================================================================

-- ---------- 1) Columnas nuevas en los ajustes ----------
alter table public.settings add column if not exists sponsor_id uuid references auth.users(id) on delete set null;   -- dueño del que este usuario es afiliado (null = independiente)
alter table public.settings add column if not exists affiliate_discount_pct int not null default 25;                -- % de descuento que este usuario da a SUS afiliados
alter table public.settings drop constraint if exists settings_affiliate_pct_check;
alter table public.settings add constraint settings_affiliate_pct_check check (affiliate_discount_pct between 0 and 100);
create index if not exists settings_sponsor_idx on public.settings (sponsor_id);

-- ---------- 2) Nadie puede cambiarse de equipo por su cuenta ----------
-- Desde la app solo se pueden escribir estas columnas; sponsor_id solo cambia
-- con las funciones agregar_afiliado / quitar_afiliado de más abajo.
revoke insert, update on public.settings from authenticated;
grant insert (slug, business_name, whatsapp, cost_discount_pct, discount_levels, affiliate_discount_pct, updated_at)
  on public.settings to authenticated;
grant update (slug, business_name, whatsapp, cost_discount_pct, discount_levels, affiliate_discount_pct, updated_at)
  on public.settings to authenticated;

-- El catálogo público necesita saber de quién son los productos de una tienda afiliada
grant select (sponsor_id) on public.settings to anon;

-- ---------- 3) Catálogo que ve el afiliado dentro de la app ----------
-- Productos activos del dueño; "cost" es el precio de afiliado (nunca el costo real del dueño).
create or replace function public.catalogo_afiliado()
returns table (
  id uuid, name text, category text, public_price numeric, cost numeric, prices jsonb,
  description text, image_url text, images text[], active boolean, created_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select p.id, p.name, p.category, p.public_price,
         round(p.public_price * (1 - sp.affiliate_discount_pct / 100.0), 2),
         p.prices, p.description, p.image_url, p.images, p.active, p.created_at
    from settings me
    join settings sp on sp.owner_id = me.sponsor_id
    join products p  on p.owner_id = me.sponsor_id and p.active
   where me.owner_id = auth.uid()
   order by p.name;
$$;

-- Datos del proveedor (dueño) que ve el afiliado
create or replace function public.mi_proveedor()
returns table (negocio text, whatsapp text, descuento int)
language sql stable security definer set search_path = public as $$
  select sp.business_name, sp.whatsapp, sp.affiliate_discount_pct
    from settings me join settings sp on sp.owner_id = me.sponsor_id
   where me.owner_id = auth.uid();
$$;

-- ---------- 4) Agregar / quitar afiliados (lo hace el dueño desde Ajustes > Mi equipo) ----------
-- El usuario del afiliado debe existir antes (Authentication > Users) y estar "nuevo": sin productos propios.
create or replace function public.agregar_afiliado(p_usuario text) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid(); v_email text; v_target uuid; v_sponsor uuid; v_slug text; v_base text;
begin
  if v_me is null then raise exception 'Debes iniciar sesión'; end if;
  if not exists (select 1 from settings where owner_id = v_me) then raise exception 'Primero configura tu negocio'; end if;
  if exists (select 1 from settings where owner_id = v_me and sponsor_id is not null) then
    raise exception 'Un afiliado no puede tener afiliados propios';
  end if;

  v_email := lower(trim(coalesce(p_usuario, '')));
  if length(v_email) = 0 then raise exception 'Escribe el usuario del afiliado'; end if;
  if position('@' in v_email) = 0 then v_email := v_email || '@minegocio.app'; end if;

  select id into v_target from auth.users where lower(email) = v_email;
  if v_target is null then
    raise exception 'No existe el usuario "%". Créalo primero en Supabase > Authentication > Users', split_part(v_email, '@', 1);
  end if;
  if v_target = v_me then raise exception 'No puedes agregarte a ti mismo'; end if;
  if exists (select 1 from settings where sponsor_id = v_target) then raise exception 'Ese usuario ya tiene su propio equipo'; end if;
  if exists (select 1 from products where owner_id = v_target) then
    raise exception 'Ese usuario ya tiene productos propios; solo se pueden agregar usuarios nuevos';
  end if;

  select sponsor_id into v_sponsor from settings where owner_id = v_target;
  if v_sponsor is not null and v_sponsor <> v_me then raise exception 'Ese usuario ya pertenece a otro equipo'; end if;

  if exists (select 1 from settings where owner_id = v_target) then
    update settings set sponsor_id = v_me, discount_levels = '{10,5,0}', updated_at = now() where owner_id = v_target;
  else
    v_base := left(trim(both '-' from regexp_replace(split_part(v_email, '@', 1), '[^a-z0-9]+', '-', 'g')), 24);
    if length(v_base) < 2 then v_base := 'tienda'; end if;
    v_slug := v_base;
    while exists (select 1 from settings where slug = v_slug) loop
      v_slug := v_base || '-' || substr(md5(random()::text), 1, 4);
    end loop;
    insert into settings (owner_id, slug, sponsor_id, discount_levels) values (v_target, v_slug, v_me, '{10,5,0}');
  end if;
  return split_part(v_email, '@', 1);
end $$;

create or replace function public.quitar_afiliado(p_afiliado uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update settings set sponsor_id = null, updated_at = now()
   where owner_id = p_afiliado and sponsor_id = auth.uid();
  if not found then raise exception 'Ese usuario no es tu afiliado'; end if;
end $$;

-- ---------- 5) Resumen del equipo para el dueño (ventas del mes de cada afiliado) ----------
--  ventas   = lo que el afiliado vendió a sus clientes
--  compras  = lo que eso le cuesta al afiliado a precio de afiliado (lo que te paga a ti)
--  ganancia = tu ganancia: compras − tu costo real de esos productos
create or replace function public.mi_equipo()
returns table (afiliado_id uuid, usuario text, tienda text, negocio text, pedidos int, ventas numeric, compras numeric, ganancia numeric)
language sql stable security definer set search_path = public as $$
  with yo as (select cost_discount_pct from settings where owner_id = auth.uid()),
  mes as (
    select o.id, o.owner_id, o.total, o.cost
      from orders o
      join settings s on s.owner_id = o.owner_id and s.sponsor_id = auth.uid()
     where o.status <> 'cancelado'
       and o.created_at >= (date_trunc('month', now() at time zone 'America/Lima') at time zone 'America/Lima')
  ),
  tot as (select m.owner_id, count(*) as n, sum(m.total) as ventas, sum(m.cost) as compras from mes m group by m.owner_id),
  gan as (
    select m.owner_id,
           sum(i.qty * (i.unit_cost - coalesce(p.cost, round(p.public_price * (1 - (select cost_discount_pct from yo) / 100.0), 2)))) as g
      from mes m
      join order_items i on i.order_id = m.id
      join products p on p.id = i.product_id and p.owner_id = auth.uid()
     group by m.owner_id
  )
  select s.owner_id, split_part(u.email, '@', 1)::text, s.slug, s.business_name,
         coalesce(t.n, 0)::int, coalesce(t.ventas, 0), coalesce(t.compras, 0), coalesce(round(g.g, 2), 0)
    from settings s
    join auth.users u on u.id = s.owner_id
    left join tot t on t.owner_id = s.owner_id
    left join gan g on g.owner_id = s.owner_id
   where s.sponsor_id = auth.uid()
   order by 2;
$$;

revoke all on function public.catalogo_afiliado()    from public, anon;
revoke all on function public.mi_proveedor()         from public, anon;
revoke all on function public.agregar_afiliado(text) from public, anon;
revoke all on function public.quitar_afiliado(uuid)  from public, anon;
revoke all on function public.mi_equipo()            from public, anon;
grant execute on function public.catalogo_afiliado()    to authenticated;
grant execute on function public.mi_proveedor()         to authenticated;
grant execute on function public.agregar_afiliado(text) to authenticated;
grant execute on function public.quitar_afiliado(uuid)  to authenticated;
grant execute on function public.mi_equipo()            to authenticated;

-- ---------- 6) Pedidos desde el catálogo de un afiliado ----------
-- El pedido queda en la cuenta del afiliado, con los productos del dueño y
-- el precio de afiliado como costo.
create or replace function public.crear_pedido_catalogo(
  p_nombre text, p_telefono text, p_nota text, p_descuento int, p_items jsonb,
  p_ref text default null, p_tienda text default null
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid; v_levels int[]; v_cost_pct int; v_d int; v_ref uuid;
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
    select owner_id, discount_levels, cost_discount_pct, sponsor_id into v_owner, v_levels, v_cost_pct, v_sponsor
      from settings where slug = lower(trim(p_tienda));
  else
    select owner_id, discount_levels, cost_discount_pct, sponsor_id into v_owner, v_levels, v_cost_pct, v_sponsor
      from settings where is_default;
  end if;
  if v_owner is null then raise exception 'Tienda no encontrada'; end if;
  v_d := case when p_descuento = any(v_levels) then p_descuento else 0 end;

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

revoke all on function public.crear_pedido_catalogo(text, text, text, int, jsonb, text, text) from public;
grant execute on function public.crear_pedido_catalogo(text, text, text, int, jsonb, text, text) to anon, authenticated;
