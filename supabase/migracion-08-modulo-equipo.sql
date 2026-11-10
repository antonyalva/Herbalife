-- =====================================================================
--  Migración 08: módulo "Equipo" (pestaña propia para los afiliados)
--  Pegar en Supabase > SQL Editor > New query > Run  (una sola vez)
--  (Requiere haber ejecutado antes las migraciones 01 a 07.)
--
--  - El resumen del equipo ahora se puede ver por mes (no solo el actual)
--    e incluye el WhatsApp de cada afiliado.
--  - Nuevo: qué productos vendió cada afiliado en el mes (para saber qué
--    te va a pedir). Nunca muestra los clientes del afiliado.
--  - Se puede ejecutar más de una vez sin problema.
-- =====================================================================

-- ---------- 1) Resumen del equipo por mes ----------
--  p_mes: cualquier día del mes a consultar (null = mes actual, hora de Perú)
--  ventas   = lo que el afiliado vendió a sus clientes
--  compras  = lo que eso le cuesta a precio de afiliado (lo que te paga a ti)
--  ganancia = tu ganancia: compras − tu costo real de esos productos
drop function if exists public.mi_equipo();
drop function if exists public.mi_equipo(date);

create function public.mi_equipo(p_mes date default null)
returns table (afiliado_id uuid, usuario text, tienda text, negocio text, whatsapp text, pedidos int, ventas numeric, compras numeric, ganancia numeric)
language sql stable security definer set search_path = public as $$
  with lim as (
    select (x.m at time zone 'America/Lima') as desde, ((x.m + interval '1 month') at time zone 'America/Lima') as hasta
      from (select coalesce(date_trunc('month', p_mes::timestamp), date_trunc('month', now() at time zone 'America/Lima')) as m) x
  ),
  yo as (select cost_discount_pct from settings where owner_id = auth.uid()),
  mes as (
    select o.id, o.owner_id, o.total, o.cost
      from orders o
      join settings s on s.owner_id = o.owner_id and s.sponsor_id = auth.uid()
     where o.status <> 'cancelado'
       and o.created_at >= (select desde from lim) and o.created_at < (select hasta from lim)
  ),
  tot as (select m.owner_id, count(*) as n, sum(m.total) as v, sum(m.cost) as c from mes m group by m.owner_id),
  gan as (
    select m.owner_id,
           sum(i.qty * (i.unit_cost - coalesce(p.cost, round(p.public_price * (1 - (select cost_discount_pct from yo) / 100.0), 2)))) as g
      from mes m
      join order_items i on i.order_id = m.id
      join products p on p.id = i.product_id and p.owner_id = auth.uid()
     group by m.owner_id
  )
  select s.owner_id,
         (case when u.email like '%@minegocio.app' then split_part(u.email, '@', 1) else u.email end)::text,
         s.slug, s.business_name, s.whatsapp,
         coalesce(t.n, 0)::int, coalesce(t.v, 0), coalesce(t.c, 0), coalesce(round(g.g, 2), 0)
    from settings s
    join auth.users u on u.id = s.owner_id
    left join tot t on t.owner_id = s.owner_id
    left join gan g on g.owner_id = s.owner_id
   where s.sponsor_id = auth.uid()
   order by 8 desc, 2;
$$;

-- ---------- 2) Productos que vendió un afiliado en el mes ----------
create or replace function public.ventas_afiliado(p_afiliado uuid, p_mes date default null)
returns table (producto text, cantidad int, compras numeric)
language sql stable security definer set search_path = public as $$
  with lim as (
    select (x.m at time zone 'America/Lima') as desde, ((x.m + interval '1 month') at time zone 'America/Lima') as hasta
      from (select coalesce(date_trunc('month', p_mes::timestamp), date_trunc('month', now() at time zone 'America/Lima')) as m) x
  )
  select i.product_name, sum(i.qty)::int, round(sum(i.qty * i.unit_cost), 2)
    from orders o
    join settings s on s.owner_id = o.owner_id and s.sponsor_id = auth.uid()   -- solo afiliados de quien consulta
    join order_items i on i.order_id = o.id
   where o.owner_id = p_afiliado
     and o.status <> 'cancelado'
     and o.created_at >= (select desde from lim) and o.created_at < (select hasta from lim)
   group by i.product_name
   order by 2 desc, 1;
$$;

revoke all on function public.mi_equipo(date)             from public, anon;
revoke all on function public.ventas_afiliado(uuid, date) from public, anon;
grant execute on function public.mi_equipo(date)             to authenticated;
grant execute on function public.ventas_afiliado(uuid, date) to authenticated;
