# Mi Negocio Herbalife — app móvil (PWA)

App web instalable para gestionar **productos, precios, clientes y pedidos**, con un **catálogo público** que puedes compartir por WhatsApp.

## Cómo funciona el precio

| Concepto | Cálculo | Ejemplo (precio público S/ 238) |
|---|---|---|
| Tu costo | precio público − tu descuento de mayorista (50%) | S/ 119.00 |
| Precio al cliente | precio público − descuento del cliente (35 / 20 / 10 / 0 %) | S/ 154.70 / 190.40 / 214.20 / 238.00 |
| Tu ganancia | precio al cliente − tu costo | S/ 35.70 / 71.40 / 95.20 / 119.00 |

Los porcentajes se cambian en **Ajustes** dentro de la app.

## Archivos

```
index.html        → la app (solo tú, con usuario y contraseña)
catalogo.html     → catálogo público para tus clientes
js/config.js      → aquí van la URL y la clave de Supabase  ← ÚNICO archivo que debes editar
js/app.js         → lógica de la app
js/catalogo.js    → lógica del catálogo
js/pricing.js     → cálculo de precios
css/style.css     → diseño
supabase/schema.sql → base de datos (se pega en Supabase una sola vez)
sw.js, manifest.webmanifest, icons/ → para que se instale como app
```

## Puesta en marcha (una sola vez)

### 1. Crear la base de datos en Supabase
1. Crea cuenta y proyecto gratis en https://supabase.com.
2. En el proyecto: **SQL Editor → New query**, pega todo el contenido de `supabase/schema.sql` y presiona **Run**.
3. **Project Settings → API**: copia *Project URL* y *anon public key* y pégalos en `js/config.js`:
   ```js
   export const SUPABASE_URL = "https://xxxx.supabase.co";
   export const SUPABASE_ANON_KEY = "eyJ...";
   ```
4. **Authentication → Users → Add user → Create new user**: el usuario y contraseña para entrar a la app.
   - Puedes entrar con un **usuario corto** en vez de un correo: en Supabase crea el usuario con el correo `TUUSUARIO@minegocio.app` (ej. `antony@minegocio.app`) y marca **Auto Confirm User**. En la app escribes solo `antony`. (El dominio `minegocio.app` es interno; no necesita existir.)
   - Si prefieres un correo real, créalo con ese correo y en la app escríbelo completo.
5. (Recomendado) **Authentication → Providers → Email**: desactiva *"Allow new users to sign up"* para que nadie más pueda registrarse.

### 2. Publicar la app en internet (gratis)
La app está publicada en **Cloudflare Workers** (gratis, sin marca de agua), conectada al repositorio de GitHub:
- Enlace público: https://herbalife.antony-adrian-3.workers.dev
- Cada vez que se sube un cambio a la rama `main`, Cloudflare lo publica solo en 1-2 minutos. La configuración está en `wrangler.jsonc` (sitio estático, sin compilación) y `.assetsignore` (archivos que no se publican).
- El sitio antiguo `herbalife-beta.netlify.app` sigue existiendo solo para redirigir al nuevo enlace (archivo `netlify.toml`), así los enlaces y QR ya compartidos siguen funcionando.

Si se cambia de dominio, actualizar las etiquetas `og:url` / `og:image` en `index.html` y `catalogo.html` (vista previa en WhatsApp).

### 3. Instalar en tu celular
- Abre el enlace en Chrome (Android) o Safari (iPhone).
- Android: menú ⋮ → **"Agregar a pantalla de inicio"** / **"Instalar app"**.
- iPhone: botón Compartir → **"Agregar a inicio"**.

### Varios usuarios (cada uno con sus datos)
Cada usuario creado en **Authentication → Users** tiene sus propios productos, clientes, pedidos y ajustes; nadie ve lo de otro. Arriba a la derecha de la app se muestra el usuario conectado (toca para bloquear o cerrar sesión).
- Cada usuario tiene un **nombre corto** (Ajustes → "Nombre corto de mi catálogo") que va en sus enlaces: `catalogo.html?t=NOMBRE&d=35`. Se propone automáticamente a partir del usuario.
- Los enlaces antiguos sin `?t=` abren la **tienda principal** (el primer usuario que configuró la app).
- Si la base ya existía antes de esta versión, ejecuta `supabase/migracion-05-multiusuario.sql` (en el archivo puedes indicar a qué usuario se asignan los datos actuales).

### Afiliados (equipo de venta)
Un afiliado es otro usuario que vende **tu** catálogo: no tiene productos propios, hereda los tuyos (nombres, fotos y precios al público) y te compra a **precio de afiliado** (precio público menos el % que fijas en Ajustes → "Descuento para mis afiliados", 25% por defecto).

| Quién | Qué precios ve |
|---|---|
| Cliente final (catálogo público) | Solo el precio público |
| Afiliado (en la app) | Precio público y su precio de afiliado (aparece como "Tu costo") |
| Tú (dueño) | Precio público, precio de afiliado y tu costo real |

Para sumar un afiliado:
1. Ejecuta una sola vez `supabase/migracion-06-afiliados.sql` en Supabase → SQL Editor.
2. Crea su usuario en **Authentication → Users** (ej. `maria@minegocio.app`, con *Auto Confirm User*).
3. En la app: **Ajustes → Mi equipo → Agregar afiliado**, escribe `maria`.

El afiliado entra con su usuario, pone su WhatsApp en Ajustes y comparte su propio enlace (`catalogo.html?t=maria`); los pedidos de ese enlace le llegan a él. En **Mi equipo** ves, por afiliado y por mes, cuánto vendió, cuánto te compra a precio de afiliado y tu ganancia. Solo hay un nivel: un afiliado no puede tener afiliados.

### 4. Compartir el catálogo con clientes
En **Ajustes → Compartir catálogo** hay un enlace por cada nivel de descuento. Envíale a cada cliente el que le corresponde; verá los productos con *sus* precios y podrá armar su pedido y enviártelo por WhatsApp (al número que pongas en Ajustes).

## Probar en la computadora
Desde la carpeta del proyecto:
```
python -m http.server 8080
```
y abre http://localhost:8080 en el navegador.
