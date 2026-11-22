/* Compresor de facturas: reduce el peso de fotos y PDF antes de subirlos,
 * manteniendo la legibilidad. Todo ocurre en el navegador.
 *
 *  Fotos: corrige la orientación, limita la resolución a lo necesario para leer
 *         la factura y prueba WebP y JPEG para quedarse con el más liviano.
 *         Al re-codificar se eliminan los metadatos EXIF (incluida la ubicación GPS).
 *  PDF:   1) re-guardado optimizado (object streams) sin tocar el contenido;
 *         2) si es un escaneo (casi sin texto), re-arma el PDF con las páginas
 *            comprimidas. Los PDF con texto real NO se rasterizan.
 *
 * Expone window.Compresor = { comprimir, PRESETS, formatoBytes }.
 */
(() => {
  'use strict';

  /** max: lado largo en px · mp: megapíxeles máx. · q: calidad (0–1) · pdf: px del lado largo al rasterizar */
  const PRESETS = {
    calidad:     { nombre: 'Máxima calidad', max: 3200, mp: 8,   q: 0.9,  pdf: 3000 },
    equilibrado: { nombre: 'Equilibrado',    max: 2400, mp: 4.5, q: 0.82, pdf: 2400 },
    ahorro:      { nombre: 'Máximo ahorro',  max: 1800, mp: 2.5, q: 0.72, pdf: 1800 },
  };
  const MIN_IMG = 150 * 1024; // por debajo no vale la pena recomprimir (salvo que exceda la resolución)
  const MIN_PDF = 400 * 1024;

  const formatoBytes = (b) => {
    if (!Number.isFinite(b)) return '—';
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
    if (b < 1024 ** 3) return `${(b / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
    return `${(b / 1024 ** 3).toFixed(2).replace('.', ',')} GB`;
  };
  const baseNombre = (n) => String(n || 'factura').replace(/\.[^.]+$/, '');
  const toBlob = (cv, tipo, q) => new Promise((r) => cv.toBlob(r, tipo, q));

  let webpOK; // ¿el navegador codifica WebP? (Safari no siempre)
  async function soportaWebP() {
    if (webpOK !== undefined) return webpOK;
    const cv = document.createElement('canvas'); cv.width = cv.height = 2;
    const b = await toBlob(cv, 'image/webp', 0.8);
    return (webpOK = !!b && b.type === 'image/webp');
  }

  async function decodificar(file) {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* sigue */ }
    return new Promise((ok, mal) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => { URL.revokeObjectURL(url); ok(img); };
      img.onerror = () => { URL.revokeObjectURL(url); mal(new Error('formato no soportado')); };
      img.src = url;
    });
  }

  /** Dibuja la imagen escalada; devuelve el canvas o null si no hace falta reducir. */
  function escalar(fuente, w, h, p) {
    const k = Math.min(1, p.max / Math.max(w, h), Math.sqrt((p.mp * 1e6) / (w * h)));
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(w * k));
    cv.height = Math.max(1, Math.round(h * k));
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff'; // las facturas no necesitan transparencia
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(fuente, 0, 0, cv.width, cv.height);
    return { cv, reducida: k < 1 };
  }

  async function comprimirImagen(file, p) {
    const bmp = await decodificar(file);
    const w = bmp.width, h = bmp.height;
    const excede = Math.max(w, h) > p.max || w * h > p.mp * 1e6;
    if (!excede && file.size < MIN_IMG) return null;
    const { cv } = escalar(bmp, w, h, p);
    bmp.close?.();
    const candidatos = [await toBlob(cv, 'image/jpeg', p.q)];
    if (await soportaWebP()) candidatos.push(await toBlob(cv, 'image/webp', p.q));
    const mejor = candidatos.filter((b) => b && b.size > 0).sort((a, b) => a.size - b.size)[0];
    if (!mejor) return null;
    // Si no se redujo la resolución y el ahorro es pequeño, se deja el original.
    if (!excede && mejor.size > file.size * 0.85) return null;
    if (mejor.size >= file.size) return null;
    const ext = mejor.type === 'image/webp' ? 'webp' : 'jpg';
    return new File([mejor], `${baseNombre(file.name)}.${ext}`, { type: mejor.type, lastModified: Date.now() });
  }

  // ---------- PDF ----------
  const PDFLIB = 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js';

  async function textoPorPagina(pdf) {
    const n = Math.min(pdf.numPages, 3);
    let chars = 0;
    for (let i = 1; i <= n; i++) {
      const tc = await (await pdf.getPage(i)).getTextContent();
      chars += tc.items.reduce((a, it) => a + (it.str || '').trim().length, 0);
    }
    return chars / n;
  }

  async function rasterizar(pdf, p) {
    const { PDFDocument } = window.PDFLib;
    const nuevo = await PDFDocument.create();
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const vp1 = page.getViewport({ scale: 1 });
      const escala = Math.min(p.pdf / Math.max(vp1.width, vp1.height), 4);
      const vp = page.getViewport({ scale: escala });
      const cv = document.createElement('canvas');
      cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
      const ctx = cv.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      const jpg = await toBlob(cv, 'image/jpeg', p.q);
      const img = await nuevo.embedJpg(await jpg.arrayBuffer());
      const pag = nuevo.addPage([vp1.width, vp1.height]); // mismo tamaño físico de página
      pag.drawImage(img, { x: 0, y: 0, width: vp1.width, height: vp1.height });
    }
    return nuevo.save({ useObjectStreams: true });
  }

  async function comprimirPDF(file, p) {
    if (file.size < MIN_PDF || !window.LectorFacturas) return null;
    const buf = await file.arrayBuffer();
    await LectorFacturas.cargar(PDFLIB);
    const candidatos = [];

    // 1) Re-guardado sin pérdida
    try {
      const doc = await window.PDFLib.PDFDocument.load(buf.slice(0), { ignoreEncryption: false, updateMetadata: false });
      candidatos.push(await doc.save({ useObjectStreams: true }));
    } catch (e) { console.info('PDF no re-guardable (¿protegido?)', e.message); return null; }

    // 2) Escaneos: re-armar con páginas comprimidas (solo si casi no hay texto)
    try {
      const pdfjs = await LectorFacturas.pdfjs();
      const pdf = await pdfjs.getDocument({ data: buf.slice(0) }).promise;
      if (pdf.numPages <= 40 && (await textoPorPagina(pdf)) < 60) candidatos.push(await rasterizar(pdf, p));
      pdf.destroy();
    } catch (e) { console.info('No se pudo rasterizar el PDF', e.message); }

    const mejor = candidatos.sort((a, b) => a.byteLength - b.byteLength)[0];
    if (!mejor || mejor.byteLength > file.size * 0.85) return null;
    return new File([mejor], `${baseNombre(file.name)}.pdf`, { type: 'application/pdf', lastModified: Date.now() });
  }

  /**
   * Comprime una factura. Nunca lanza error: si algo falla, devuelve el original.
   * @returns {Promise<{ file: File, antes: number, despues: number, cambiado: boolean }>}
   */
  async function comprimir(file, presetId = 'equilibrado') {
    const p = PRESETS[presetId] || PRESETS.equilibrado;
    let r = null;
    try {
      if (file.type === 'application/pdf') r = await comprimirPDF(file, p);
      else if (file.type.startsWith('image/')) r = await comprimirImagen(file, p);
    } catch (e) { console.info('Compresión omitida:', e.message); }
    const out = r || file;
    return { file: out, antes: file.size, despues: out.size, cambiado: !!r };
  }

  window.Compresor = { comprimir, PRESETS, formatoBytes };
})();
