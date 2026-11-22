# 🧾 Mis Gastos

App web (instalable en el celular) para registrar gastos en pesos colombianos y guardar
las facturas en foto o PDF de cada uno.

- **Interfaz:** HTML + CSS + JavaScript, sin frameworks y sin compilación. Responsiva y con modo oscuro automático.
- **Datos y archivos:** [Supabase](https://supabase.com). La base de datos es Postgres; las facturas van en un almacenamiento **privado** y cada usuario solo ve lo suyo gracias a reglas RLS.
- **Hosting:** GitHub Pages. Se actualiza solo con cada `git push`.

## Funciones
- Inicio de sesión con correo y contraseña.
- Registrar, editar y eliminar gastos: monto, fecha, categoría, proveedor, método de pago y descripción.
- Adjuntar facturas tomando la foto con la cámara del celular o subiendo imágenes o PDF (varios por gasto). Las fotos se comprimen antes de subirse.
- Resumen mensual: total, variación frente al mes anterior, promedio diario, gastos sin factura, gráfico por categoría y tendencia de 6 meses.
- Lista con búsqueda y filtros por mes y categoría.
- Categorías editables, con ícono y color.
- Exportar a Excel (.xlsx) o CSV.
- PWA: se puede "Agregar a pantalla de inicio" en Android e iPhone.

## Configuración (una sola vez)
1. **Base de datos:** en Supabase ve a **SQL Editor → New query**, pega el contenido de
   [`supabase/schema.sql`](supabase/schema.sql) y pulsa **Run**.
2. **Tu usuario:** ve a **Authentication → Users → Add user → Create new user**, escribe tu correo y contraseña
   y marca **Auto Confirm User**.
3. **Cerrar registros:** ve a **Authentication → Sign In / Providers** y desactiva **Allow new users to sign up**,
   para que nadie más pueda crear cuenta.
4. La URL del proyecto y la *publishable key* están en [`js/config.js`](js/config.js).
   **Nunca pongas ahí la *secret key*.**

## Probar en local
```bash
powershell -ExecutionPolicy Bypass -File tools/serve.ps1
```
Abre http://localhost:8080

## Estructura
```
index.html            Interfaz (vistas y modales)
css/styles.css        Estilos responsivos (claro/oscuro)
js/config.js          URL y llave pública de Supabase, categorías por defecto
js/app.js             Lógica de la app
sw.js                 Service worker (PWA)
manifest.webmanifest  Datos de instalación de la PWA
supabase/schema.sql   Tablas, reglas de seguridad y bucket de facturas
tools/serve.ps1       Servidor local de prueba
```
