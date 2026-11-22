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
- **Lectura automática de facturas ✨:** al agregar una foto o PDF, la app llena sola el monto, la fecha, el proveedor, el número de factura, el NIT, el método de pago y la categoría. Usa, en orden de exactitud:
  1. el **QR de la factura electrónica DIAN** (total, fecha, NIT y número exactos);
  2. el **texto del PDF**;
  3. **OCR en español** (Tesseract.js) para fotos de tiquetes y facturas en papel.

  Todo corre en el navegador: las facturas no se envían a ningún servicio externo. Los campos que ya escribiste no se sobrescriben, y la categoría se aprende de tus gastos anteriores con el mismo proveedor.
- Resumen mensual: total, variación frente al mes anterior, promedio diario, gastos sin factura, gráfico por categoría y tendencia de 6 meses.
- Lista con búsqueda y filtros por mes y categoría.
- Categorías editables, con ícono y color.
- Exportar a Excel (.xlsx) o CSV.
- PWA 

## Configuración (una sola vez)
1. **Base de datos:** en Supabase ve a **SQL Editor → New query**, pega el contenido de
   [`supabase/schema.sql`](supabase/schema.sql) y pulsa **Run**.
2. **Tu usuario:** ve a **Authentication → Users → Add user → Create new user**, escribe tu correo y contraseña
   y marca **Auto Confirm User**.
3. **Cerrar registros:** ve a **Authentication → Sign In / Providers** y desactiva **Allow new users to sign up**,
   para que nadie más pueda crear cuenta.
4. La URL del proyecto y la *publishable key* están en [`js/config.js`](js/config.js).

## Probar en local
```bash
powershell -ExecutionPolicy Bypass -File tools/serve.ps1
```
Abre http://localhost:8080

Las pruebas del lector de facturas están en http://localhost:8080/tools/lector-test.html. Generan facturas de ejemplo (texto, PDF, foto con QR y foto solo OCR) y verifican lo extraído.

## Estructura
```
index.html            Interfaz (vistas y modales)
css/styles.css        Estilos responsivos (claro/oscuro)
js/config.js          URL y llave pública de Supabase, categorías por defecto
js/app.js             Lógica de la app
js/lector.js          Lectura automática de facturas (QR DIAN, PDF, OCR)
sw.js                 Service worker (PWA)
manifest.webmanifest  Datos de instalación de la PWA
supabase/schema.sql   Tablas, reglas de seguridad y bucket de facturas
tools/serve.ps1       Servidor local de prueba
```
