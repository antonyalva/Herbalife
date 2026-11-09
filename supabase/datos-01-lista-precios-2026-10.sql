-- =====================================================================
--  Carga de productos: Lista de precios Herbalife Perú
--  (vigente desde el 17 de octubre de 2026) — 55 productos
--  Pegar completo en Supabase > SQL Editor > New query > Run
--
--  - Precio público = P.V.P. de la lista
--  - Costo          = columna 50% (Supervisor), con impuestos incluidos
--  - Si un producto ya existe (mismo nombre) se actualizan su precio,
--    costo y categoría; no se duplica ni se tocan sus fotos.
--  - Se puede ejecutar más de una vez sin problema.
-- =====================================================================

do $$
declare
  -- <<< tiendas (nombre corto del enlace del catálogo) donde cargar los productos.
  --     Para cargar también en otra, agrégala: array['antony-adrian-3', 'marilu']
  v_tiendas text[] := array['antony-adrian-3'];
  v_tienda text; v_owner uuid; v_nuevos int; v_actualizados int;
begin
  create temp table _lista (sku text, name text, category text, public_price numeric, cost numeric) on commit drop;

  insert into _lista (sku, name, category, public_price, cost) values
    -- Batido Nutricional F1
    ('0141', 'Fórmula 1 Batido Nutricional - Vainilla',            'Batidos Fórmula 1', 187.00, 104.90),
    ('0142', 'Fórmula 1 Batido Nutricional - Chocolate',           'Batidos Fórmula 1', 187.00, 104.90),
    ('0146', 'Fórmula 1 Batido Nutricional - Cookies and Cream',   'Batidos Fórmula 1', 187.00, 104.90),
    ('0143', 'Fórmula 1 Batido Nutricional - Fresa',               'Batidos Fórmula 1', 187.00, 104.90),
    ('187K', 'Fórmula 1 Batido Nutricional - Dulce de Leche',      'Batidos Fórmula 1', 187.00, 104.90),
    ('1134', 'Fórmula 1 Batido Nutricional - Naranja Crema',       'Batidos Fórmula 1', 187.00, 104.90),
    ('0884', 'Fórmula 1 Batido Nutricional - Chocoavellana',       'Batidos Fórmula 1', 187.00, 104.90),
    ('1522', 'Fórmula 1 Batido Nutricional - Banana Caramelo',     'Batidos Fórmula 1', 187.00, 104.90),
    ('395K', 'Fórmula 1 Nutri Soup - Pollo con Vegetales',         'Batidos Fórmula 1', 134.00,  76.91),
    -- Té Concentrado de Hierbas
    ('1638', 'Té Concentrado de Hierbas - Chai 51 g',              'Té Concentrado de Hierbas', 147.00,  82.60),
    ('0105', 'Té Concentrado de Hierbas - Frambuesa 51 g',         'Té Concentrado de Hierbas', 147.00,  82.60),
    ('0106', 'Té Concentrado de Hierbas - Original 102 g',         'Té Concentrado de Hierbas', 256.00, 143.49),
    ('0190', 'Té Concentrado de Hierbas - Durazno 102 g',          'Té Concentrado de Hierbas', 256.00, 143.49),
    ('0189', 'Té Concentrado de Hierbas - Frambuesa 102 g',        'Té Concentrado de Hierbas', 256.00, 143.49),
    ('0188', 'Té Concentrado de Hierbas - Limón 102 g',            'Té Concentrado de Hierbas', 256.00, 143.49),
    -- Herbal Aloe Concentrado
    ('0006', 'Herbal Aloe Concentrado - Original',                 'Herbal Aloe Concentrado', 183.00, 102.77),
    ('1065', 'Herbal Aloe Concentrado - Mango',                    'Herbal Aloe Concentrado', 183.00, 102.77),
    ('2631', 'Herbal Aloe Concentrado - Mandarina',                'Herbal Aloe Concentrado', 183.00, 102.77),
    ('1610', 'Herbal Aloe Concentrado - Uva',                      'Herbal Aloe Concentrado', 183.00, 102.77),
    -- Proteínas
    ('0242', 'Proteína Personalizada en Polvo',                    'Proteínas', 152.00,  85.51),
    ('2648', 'Proteína Personalizada en Polvo - Frutos Rojos',     'Proteínas', 152.00,  85.51),
    ('1122', 'Protein Drink Mix - Vainilla',                       'Proteínas', 238.00, 137.86),
    ('1250', 'Protein Drink Mix - Crema de Maní',                  'Proteínas', 238.00, 137.86),
    ('1119', 'Barra de Proteína Deluxe',                           'Proteínas', 136.00,  98.19),
    ('313K', 'Nutri Muffin',                                       'Proteínas', 149.00,  83.45),
    ('120K', 'Protein Crunch - Chocolate',                         'Proteínas', 189.00, 111.48),
    ('093K', 'Beverage Mix - Mix de Frutas',                       'Proteínas', 162.00,  98.43),
    -- Complementos
    ('0020', 'Xtra-Cal Advanced',                                  'Complementos',  77.00,  43.34),
    ('3122', 'Fórmula 2 - Complejo Multivitamínico',               'Complementos',  83.00,  46.45),
    ('0065', 'Herbalifeline',                                      'Complementos', 183.00, 102.72),
    ('0267', 'Beta Heart',                                         'Complementos', 239.00, 134.07),
    -- Nutrición Específica
    ('2864', 'Fibra Activa - Manzana',                             'Nutrición Específica', 174.00,  97.51),
    ('337K', 'Fibra Activa - Guayaba',                             'Nutrición Específica', 174.00,  97.51),
    ('3987', 'Collagen Beauty Drink',                              'Nutrición Específica', 207.00, 119.55),
    ('047K', 'Immunity Essentials',                                'Nutrición Específica', 181.00, 101.46),
    ('3150', 'Niteworks 15 Days',                                  'Nutrición Específica', 343.00, 192.43),
    ('044K', 'Té RLX Herbalife Infusión',                          'Nutrición Específica', 260.00, 146.10),
    ('101K', 'Memory Armour',                                      'Nutrición Específica', 200.00, 112.02),
    ('238K', 'Golden Beverage',                                    'Nutrición Específica', 159.00,  89.39),
    -- Deportes y Vida Activa
    ('0102', 'Té N.R.G.',                                          'Deportes y Vida Activa', 113.00,  63.54),
    ('075K', 'Té N.R.G. - Guaraná Tropical',                       'Deportes y Vida Activa', 113.00,  63.54),
    ('1417', 'Herbalife24 Rebuild Strength',                       'Deportes y Vida Activa', 301.00, 194.91),
    ('1478', 'Herbalife Drive',                                    'Deportes y Vida Activa', 146.00,  87.59),
    ('204K', 'LiftOff',                                            'Deportes y Vida Activa',  84.00,  48.36),
    ('386K', 'H24 Creatine',                                       'Deportes y Vida Activa', 154.00,  86.45),
    -- Herbalife SKIN
    ('0766', 'Herbalife SKIN - Limpiador Cítrico (Piel Normal a Grasa)',       'Herbalife SKIN', 128.00,  72.07),
    ('0767', 'Herbalife SKIN - Tonificador Energizante de Hierbas',            'Herbalife SKIN',  97.00,  54.65),
    ('0768', 'Herbalife SKIN - Sérum Reductor de Líneas',                      'Herbalife SKIN', 289.00, 162.26),
    ('0773', 'Herbalife SKIN - Mascarilla Purificadora de Arcilla con Menta',  'Herbalife SKIN', 109.00,  61.13),
    ('0772', 'Herbalife SKIN - Exfoliante Instantáneo con Arándanos',          'Herbalife SKIN', 101.00,  56.39),
    ('0899', 'Herbalife SKIN - Crema Humectante Protectora de Día FPS 30',     'Herbalife SKIN', 218.00, 122.24),
    ('3294', 'Herbalife SKIN - Programa Básico',                               'Herbalife SKIN', 444.00, 248.97),
    ('3295', 'Herbalife SKIN - Programa Avanzado',                             'Herbalife SKIN', 733.00, 411.23),
    -- Herbalife Aloe (cuidado corporal)
    ('2562', 'Herbal Aloe - Gel Refrescante Corporal',             'Herbal Aloe Cuidado Corporal',  66.00,  36.96),
    ('2563', 'Herbal Aloe - Crema para Manos y Cuerpo',            'Herbal Aloe Cuidado Corporal',  66.00,  36.96);

  foreach v_tienda in array v_tiendas loop
    select owner_id into v_owner from public.settings where slug = lower(trim(v_tienda));
    if v_owner is null then raise exception 'No existe la tienda "%"', v_tienda; end if;

    -- Productos que ya existen: se actualiza precio, costo y categoría
    update public.products p
       set public_price = l.public_price, cost = l.cost, category = l.category
      from _lista l
     where p.owner_id = v_owner and lower(p.name) = lower(l.name);
    get diagnostics v_actualizados = row_count;

    -- Productos nuevos
    insert into public.products (owner_id, name, category, public_price, cost, description)
    select v_owner, l.name, l.category, l.public_price, l.cost, 'Código Herbalife: ' || l.sku
      from _lista l
     where not exists (select 1 from public.products p where p.owner_id = v_owner and lower(p.name) = lower(l.name));
    get diagnostics v_nuevos = row_count;

    raise notice 'Tienda %: % productos nuevos, % actualizados', v_tienda, v_nuevos, v_actualizados;
  end loop;
end $$;

-- Resumen de lo cargado
select s.slug as tienda, p.category as categoria, count(*) as productos
  from public.products p join public.settings s on s.owner_id = p.owner_id
 group by s.slug, p.category
 order by s.slug, p.category;
