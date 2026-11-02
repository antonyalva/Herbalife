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
4. **Authentication → Users → Add user → Create new user**: tu correo y contraseña para entrar a la app.
5. (Recomendado) **Authentication → Providers → Email**: desactiva *"Allow new users to sign up"* para que nadie más pueda registrarse.

### 2. Publicar la app en internet (gratis)
La forma más simple es **Netlify Drop**:
1. Entra a https://app.netlify.com/drop (crea cuenta gratis si te la pide).
2. Arrastra la carpeta completa `HERBALIFE` a la página.
3. Te dará un enlace tipo `https://algo-aleatorio.netlify.app`. Puedes cambiarle el nombre en *Site settings → Change site name* (ej. `minegocio-herbalife.netlify.app`).

Cada vez que haya una nueva versión de la app, vuelves a arrastrar la carpeta en *Deploys*.

### 3. Instalar en tu celular
- Abre el enlace en Chrome (Android) o Safari (iPhone).
- Android: menú ⋮ → **"Agregar a pantalla de inicio"** / **"Instalar app"**.
- iPhone: botón Compartir → **"Agregar a inicio"**.

### 4. Compartir el catálogo con clientes
En **Ajustes → Compartir catálogo** hay un enlace por cada nivel de descuento. Envíale a cada cliente el que le corresponde; verá los productos con *sus* precios y podrá armar su pedido y enviártelo por WhatsApp (al número que pongas en Ajustes).

## Probar en la computadora
Desde la carpeta del proyecto:
```
python -m http.server 8080
```
y abre http://localhost:8080 en el navegador.
