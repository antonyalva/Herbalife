-- =====================================================================
--  Migración 01: varias fotos por producto + descripción
--  Pegar en Supabase > SQL Editor > New query > Run  (una sola vez)
-- =====================================================================

alter table public.products add column if not exists description text not null default '';
alter table public.products add column if not exists images text[] not null default '{}';

-- Los productos que ya tenían una foto la conservan como primera foto
update public.products
   set images = array[image_url]
 where image_url is not null and cardinality(images) = 0;
