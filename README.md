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
- **Lectura con IA ✨ (opcional):** con una llave gratuita de **Google Gemini** (se crea en [aistudio.google.com/apikey](https://aistudio.google.com/apikey), sin tarjeta), la app interpreta la factura con IA. Lista los productos con descripciones claras (por ejemplo, "LCH ENT ALQ 1L" → "Leche entera Alquería 1 L") y completa comercio, NIT, fecha, total y descripción.
  - Usa el modelo **Flash-Lite** más reciente disponible para tu llave. Suele permitir unas **500 lecturas gratis al día** y 10–15 por minuto. Google puede cambiar estas cifras, así que el límite se puede ajustar.
  - La cuota se reinicia cada día a medianoche hora del Pacífico, que son las 2–3 a. m. en Colombia.
  - Corre en paralelo con el lector local. El QR de la factura electrónica siempre tiene prioridad porque es exacto.
  - Si se acaba el cupo, **los gastos se siguen registrando** con el lector local. Solo aparece un aviso en **Ajustes → Lectura con IA**, junto con el contador de uso del día.
  - La llave se guarda solo en el dispositivo. En el plan gratuito, Google puede usar lo que se le envía para mejorar sus productos; la lectura local no envía nada.
- **Pagos mensuales 🔁:** suscripciones, servicios públicos, planes de celular o internet y débitos automáticos se reconocen por el texto de la factura (por ejemplo "suscripción", "débito automático", "periodo facturado"), por ser comercios típicos (Netflix, EPM, Claro…) o porque ya los pagaste en dos o más meses. Al agregar una factura de ese tipo, o al escribir el comercio a mano, se prellenan el **nombre del comercio, el NIT y la descripción** de tu último pago, además de la categoría y el método de pago.
- **PDF con contraseña 🔓:** si una factura en PDF está protegida (por ejemplo, con tu cédula), la app pide la contraseña y guarda una copia **sin contraseña**. Con el PDF original y su contraseña, la lectura automática usa el texto real. Puedes elegir que la recuerde en tu celular para abrir sola los siguientes PDF; se olvida desde **Ajustes → Cuenta**. La contraseña nunca se sube a la nube.
- **Varias facturas a la vez 📚:** en **Gastos → Registrar varias facturas a la vez**, o eligiendo varios archivos en un gasto nuevo, cada archivo se vuelve un gasto. La app los lee uno tras otro y los pone en una **lista de revisión**:
  - **✓ Lista:** se leyó bien el monto y no está repetida.
  - **✏️ Revisar:** falta el monto o la TRM, o el monto es dudoso.
  - **⚠️ Repetida:** ya registrada, o igual a otra factura de la misma lista.

  Con **"Guardar N listas"** se guardan de una vez todas las que están listas; con **"Revisar uno por uno"** se abre cada una en el formulario y, al guardarla, pasa sola a la siguiente. Toca una para corregirla, o ✕ para descartarla. Si cierras la lista, el botón "📥 N facturas por registrar" la vuelve a abrir.
- **Gastos en dólares 💵:** con el selector **COP / USD** se escribe el monto en dólares y la app lo convierte a pesos con la **TRM oficial vigente en la fecha del pago** (datos.gov.co, Superintendencia Financiera). Los fines de semana y festivos usa la TRM vigente ese día. Si tu banco cobró con otra tasa, la puedes cambiar. Se guardan el valor en USD y la tasa usada; los totales, gráficos y exportaciones van en pesos, y el Excel y el CSV agregan las columnas "Monto USD" y "TRM". Las facturas en dólares (con "USD" o "US$", o recibos en inglés) se detectan solas al leerlas.
- **Visor integrado:** las fotos y los PDF se ven dentro de la app, a pantalla completa, con zoom, todas las páginas del PDF, flechas o deslizamiento para pasar de una factura a otra, y botón de descarga. Los PDF muestran una miniatura de su primera página.
- **Productos del gasto:** cada gasto puede tener su lista de productos (cantidad y valor), que se llena sola al leer la factura o se edita a mano. Se muestra la suma y si cuadra con el monto. En la lista de gastos aparece como un desplegable oculto, "▸ N productos".
- **Facturas repetidas ⚠️:** si un gasto coincide con uno ya registrado, la app avisa en el formulario y otra vez antes de guardar, con un enlace al gasto existente para revisarlo. Cuenta como coincidencia:
  - el mismo CUFE;
  - el mismo n.º de factura del mismo emisor;
  - el mismo archivo de factura;
  - la misma fecha y monto, con el mismo proveedor o los mismos productos.

  Los gastos repetidos ya guardados se marcan "⚠️ repetido" en la lista y en su detalle.
- **Ahorro de espacio 🗜️:** las facturas se optimizan en el celular antes de subirse.
  - **Fotos:** se ajustan a la resolución necesaria para leerlas y se guardan en WebP o JPEG, el que pese menos. Una foto de 12 MP pasa de unos 5 MB a unos 350 KB. También se borran los metadatos, incluida la ubicación GPS.
  - **PDF:** se re-guardan optimizados. Si son escaneados, se rearman con las páginas comprimidas. Los PDF con texto real no se tocan.
  - En **Ajustes → Almacenamiento** se ve cuánto espacio queda del plan gratuito (1 GB) y se puede elegir el nivel de compresión: Calidad, Equilibrado o Ahorro. El botón **"Optimizar facturas ya guardadas"** reduce las que se subieron antes.
- **Historial de descargas:** cada Excel, CSV o ZIP queda registrado con fecha, periodo, cantidad de gastos y facturas, y peso.
- **Respaldo y limpieza de la nube 🗄️:** cuando el almacenamiento llega al umbral (85 % del GB gratuito por defecto), la app propone archivar los meses más antiguos.
  1. Descarga en tu equipo un ZIP con el Excel y las facturas.
  2. Pide que confirmes que el archivo quedó guardado.
  3. Borra de la nube **solo las facturas que quedaron dentro del ZIP**.

  Por defecto los gastos se conservan, marcados "📦 archivada" con el nombre del respaldo, así los gráficos y el historial siguen completos; hay una opción para borrarlos también. Nunca toca el mes actual ni el anterior, y se puede archivar a mano hasta un mes elegido.
- Categorías por defecto: Alimentación, Transporte, Servicios, Salud, Hogar, Entretenimiento y Otros.
- Resumen mensual: total, variación frente al mes anterior, promedio diario, gastos sin factura, gráfico por categoría y tendencia de 6 meses.
- Lista con búsqueda y filtros por mes y categoría.
- Categorías editables, con ícono y color.
- Exportar:
  - **Excel + facturas (.zip):** trae los archivos de las facturas en `facturas/AAAA-MM/`. En el Excel, las columnas "Factura N" son vínculos que abren cada archivo (funcionan sin internet) y hay una hoja "Productos".
  - **Solo Excel / Solo CSV:** las facturas van como enlaces en línea que vencen en 7 días.
- PWA 

## Configuración (una sola vez)
1. **Base de datos:** en Supabase ve a **SQL Editor → New query**, pega el contenido de
   [`supabase/schema.sql`](supabase/schema.sql) y pulsa **Run**.
2. **Tu usuario:** ve a **Authentication → Users → Add user → Create new user**, escribe tu correo y contraseña
   y marca **Auto Confirm User**.
3. **Cerrar registros:** ve a **Authentication → Sign In / Providers** y desactiva **Allow new users to sign up**,
   para que nadie más pueda crear cuenta.
4. **Actualizaciones de la base de datos:** si tu base se creó con una versión anterior, ejecuta en el SQL Editor los archivos de [`supabase/migraciones/`](supabase/migraciones) que falten. Por ejemplo, `002_productos.sql` agrega la lista de productos, `003_entretenimiento_y_repetidos.sql` agrega la categoría Entretenimiento y los datos para detectar facturas repetidas, `004_historial_y_archivo.sql` agrega el historial de descargas y el archivado, y `005_moneda_usd.sql` agrega los gastos en dólares.
5. La URL del proyecto y la *publishable key* están en [`js/config.js`](js/config.js).

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
js/compresor.js       Optimización de fotos y PDF, y PDF con contraseña
js/ia.js              Lectura opcional con IA (Google Gemini, plan gratuito)
sw.js                 Service worker (PWA)
manifest.webmanifest  Datos de instalación de la PWA
supabase/schema.sql   Tablas, reglas de seguridad y bucket de facturas
tools/serve.ps1       Servidor local de prueba
```
