/* Lector de facturas: extrae monto, fecha, proveedor, NIT, etc. de una imagen o PDF.
 * Todo corre en el navegador (nada se envía a terceros):
 *   1) QR de factura electrónica DIAN  -> datos exactos
 *   2) Texto embebido en PDF (pdf.js)  -> texto exacto
 *   3) OCR en español (Tesseract.js)   -> fotos y escaneos
 * Expone window.LectorFacturas = { analizar, parsearTexto, parsearQR }.
 */
(() => {
  'use strict';

  const LIBS = {
    tesseract: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js',
    pdfjs: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js',
    pdfWorker: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js',
    jsqr: 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js',
  };

  const cargados = {};
  function cargar(src) {
    return (cargados[src] ||= new Promise((ok, mal) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = ok;
      s.onerror = () => { delete cargados[src]; mal(new Error('No se pudo descargar una librería de lectura (¿sin conexión?)')); };
      document.head.appendChild(s);
    }));
  }

  // ---------- Normalización ----------
  const sinTildes = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
  const norm = (s) => sinTildes(String(s || '')).toLowerCase();
  const pad = (n) => String(n).padStart(2, '0');

  /** "1.234.567,50" | "1,234,567.50" | "$ 119000" | "119000.00" -> 1234568 */
  function aNumero(txt) {
    let s = String(txt).replace(/[^\d.,]/g, '');
    if (!s) return null;
    if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
    else if (/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(s)) s = s.replace(/,/g, '');
    else if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(',', '.');
    else if (/^\d+\.\d{1,2}$/.test(s)) { /* decimal normal */ }
    else if (/^\d+$/.test(s)) { /* entero */ }
    else s = s.replace(/[.,](?=\d{3}(\D|$))/g, '').replace(',', '.');
    const n = Number(s);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
  }

  const RE_MONTO = /\$?\s?\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\$?\s?\d{3,}(?:[.,]\d{1,2})?/g;
  function montosEn(linea) {
    return (linea.match(RE_MONTO) || [])
      .map((m) => ({ txt: m, n: aNumero(m), conPeso: m.includes('$') }))
      .filter((x) => x.n && x.n >= 50 && x.n < 1e11);
  }

  // ---------- Fechas ----------
  const MESES = { ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8, sep: 9, set: 9, oct: 10, nov: 11, dic: 12, jan: 1, apr: 4, aug: 8, dec: 12 };
  function fechaValida(y, m, d) {
    if (y < 100) y += 2000;
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    const f = new Date(y, m - 1, d);
    if (f.getMonth() !== m - 1) return null;
    const manana = new Date(); manana.setDate(manana.getDate() + 1);
    if (y < 2000 || f > manana) return null;
    return `${y}-${pad(m)}-${pad(d)}`;
  }
  function fechasEn(linea) {
    const l = norm(linea);
    const out = [];
    for (const m of l.matchAll(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/g)) out.push(fechaValida(+m[1], +m[2], +m[3]));
    for (const m of l.matchAll(/(?<!\d)(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})(?!\d)/g)) {
      // En Colombia el formato es día/mes/año; si el "mes" > 12 probamos mes/día.
      out.push(fechaValida(+m[3], +m[2], +m[1]) || fechaValida(+m[3], +m[1], +m[2]));
    }
    for (const m of l.matchAll(/(\d{1,2})\s*(?:de\s*|-|\/|\.)?\s*(ene|feb|mar|abr|may|jun|jul|ago|sep|set|oct|nov|dic|jan|apr|aug|dec)[a-z]*\.?\s*(?:de\s*|del\s*|-|\/|\.)?\s*(\d{4})/g)) {
      out.push(fechaValida(+m[3], MESES[m[2]], +m[1]));
    }
    return out.filter(Boolean);
  }

  // ---------- Pistas ----------
  const COMERCIOS = [
    'Éxito', 'Carulla', 'Jumbo', 'Olímpica', 'D1', 'Ara', 'Makro', 'Metro', 'Alkosto', 'Ktronix', 'PriceSmart', 'Euro', 'Surtimax', 'Isimo',
    'Farmatodo', 'Cruz Verde', 'Drogas La Rebaja', 'Locatel', 'Colsubsidio', 'Pasteur', 'Copidrogas',
    'Terpel', 'Primax', 'Biomax', 'Texaco', 'Esso', 'Mobil', 'Uber', 'DiDi', 'Cabify', 'inDrive', 'Avianca', 'LATAM', 'Wingo',
    'EPM', 'Codensa', 'Enel', 'Vanti', 'Gas Natural', 'Claro', 'Movistar', 'Tigo', 'WOM', 'ETB', 'UNE', 'DirecTV',
    'Homecenter', 'Easy', 'Falabella', 'Ikea', 'Tostao', 'Juan Valdez', 'Crepes & Waffles', 'Frisby', 'El Corral', 'McDonald\'s', 'KFC',
    'Rappi', 'Mercado Libre', 'Amazon', 'Netflix', 'Spotify', 'Sura', 'Sanitas', 'Compensar', 'Colmédica',
  ];
  const PISTAS_CATEGORIA = [
    ['Alimentación', /supermerc|mercado|restaur|panader|cafe|comida|almuerzo|exito|carulla|jumbo|olimpica|\bd1\b|\bara\b|makro|surtimax|isimo|tostao|juan valdez|crepes|frisby|corral|mcdonald|kfc|rappi|pizza|asadero|fruver|carnes|licor/],
    ['Transporte', /gasolin|combustib|acpm|diesel|corriente|peaje|parqueader|terpel|primax|biomax|texaco|esso|mobil|uber|didi|cabify|indrive|taxi|transmilenio|metro de|tiquete|avianca|latam|wingo|lavadero|soat|taller|llanta/],
    ['Servicios', /energia|acueducto|alcantarill|\bgas\b|internet|telefon|celular|epm|codensa|enel|vanti|claro|movistar|tigo|\bwom\b|\betb\b|\bune\b|directv|netflix|spotify|plan de datos|aseo|administracion/],
    ['Salud', /drog|farmac|medic|clinic|hospital|odontol|laborator|optica|eps|sura|sanitas|compensar|colmedica|cruz verde|farmatodo|locatel|pasteur|consulta/],
    ['Hogar', /homecenter|ferreter|\beasy\b|ikea|muebl|hogar|electrodom|alkosto|ktronix|falabella|aseo hogar|construc|pintur|decoraci/],
  ];
  const PISTAS_PAGO = [
    ['Nequi', /nequi/], ['Daviplata', /daviplata/], ['Crédito', /credito|visa|master\s*card|american express|amex|diners/],
    ['Débito', /debito|maestro|electron/], ['Transferencia', /transferencia|pse\b/], ['Efectivo', /efectivo|cambio\s*[:$]/],
  ];

  const RE_NO_PROVEEDOR = /factura|nit\b|n\.i\.t|tel[eé:.]|cel[:.]|direcc|calle|carrera|\bcra\b|\bcl\b|avenida|\bav\b|www|http|@|r[eé]gimen|responsable|\biva\b|resoluci|fecha|cliente|p[aá]gina|documento|equivalente|pos\b|caja|cajero|ticket|tiquete|original|copia|electr[oó]nica|venta|bogot|medell|cali\b|barranq|colombia/i;

  /** "LECHE ENTERA 1L" -> "Leche Entera 1L"; respeta medidas (1L, 500g), siglas cortas (AA) y S.A.S. */
  function titulo(s) {
    if (s !== s.toUpperCase()) return s.trim();
    const MENORES = new Set(['de', 'del', 'y', 'con', 'para', 'por']);
    return s.trim().split(/\s+/).map((w, i) => {
      if (/\d/.test(w) || /^(s\.?a\.?s?\.?|ltda\.?)$/i.test(w)) return w;
      const l = w.toLowerCase();
      if (i > 0 && MENORES.has(l)) return l;
      // Siglas cortas (AA, XL, KG) se dejan en mayúscula; palabras comunes no.
      if (w.length <= 2 && /^\p{L}+$/u.test(w) && i > 0 && !/^(el|la|lo|al|en|un|mi|su|tu|yo|me|se|le|ya|no|si)$/.test(l)) return w;
      return l.replace(/(^|[-&])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
    }).join(' ');
  }

  // ---------- Análisis de texto ----------
  function parsearTexto(texto, conocidos = []) {
    const lineas = String(texto || '').split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const res = {};
    const nTexto = norm(texto);

    // Monto total
    let mejor = null;
    const EXCLUIR = /sub\s*-?\s*total|total\s*(iva|impuesto|imp\b|descuento|dcto|items|articulos|unidades|cantidad|bolsa|base|retenc)|base\s*grav|cambio|efectivo\s*recibido|recibido|nit|tel|resoluci|cufe|autoriz|rango|desde|hasta/;
    const reglas = [
      [3, /total\s*a\s*pagar|neto\s*a\s*pagar|valor\s*a\s*pagar|total\s*factura|valor\s*total|total\s*neto|gran\s*total|total\s*pagado|total\s*venta|vr\.?\s*total|valor\s*factura/],
      [2, /\btotal\b|\btotai\b|\bt0tal\b/],
      [1, /a\s*pagar|importe|valor\b/],
    ];
    lineas.forEach((l, i) => {
      const n = norm(l);
      if (EXCLUIR.test(n)) return;
      const regla = reglas.find(([, re]) => re.test(n));
      if (!regla) return;
      let ms = montosEn(l);
      if (!ms.length && lineas[i + 1]) ms = montosEn(lineas[i + 1]);
      if (!ms.length) return;
      const m = ms[ms.length - 1];
      const cand = { n: m.n, score: regla[0] };
      if (!mejor || cand.score > mejor.score || (cand.score === mejor.score && cand.n > mejor.n)) mejor = cand;
    });
    if (!mejor) {
      const todos = lineas.filter((l) => !EXCLUIR.test(norm(l))).flatMap(montosEn);
      const conPeso = todos.filter((m) => m.conPeso);
      const pool = conPeso.length ? conPeso : todos.filter((m) => m.n < 1e8);
      if (pool.length) mejor = { n: Math.max(...pool.map((m) => m.n)), score: 0 };
    }
    if (mejor) { res.monto = mejor.n; res.montoSeguro = mejor.score >= 2; }

    // Fecha (prioriza líneas que dicen "fecha", evita vencimiento/resolución)
    const MALA_FECHA = /venc|limite|resoluci|vigencia|desde|hasta|autoriz|habilitac|nacimiento/;
    let fecha = null;
    for (const l of lineas) {
      const n = norm(l);
      if (/fecha|emisi|expedi|generaci/.test(n) && !MALA_FECHA.test(n)) { fecha = fechasEn(l)[0]; if (fecha) break; }
    }
    if (!fecha) for (const l of lineas) { if (MALA_FECHA.test(norm(l))) continue; fecha = fechasEn(l)[0]; if (fecha) break; }
    if (fecha) res.fecha = fecha;

    // NIT y número de factura
    const nit = /n\.?\s*i\.?\s*t\.?\s*[:.#]?\s*(\d{1,3}(?:[.,\s]?\d{3}){2,3})\s*-?\s*(\d)?/i.exec(texto);
    if (nit) res.nit = nit[1].replace(/\D/g, '').replace(/(\d)(?=(\d{3})+$)/g, '$1.') + (nit[2] ? `-${nit[2]}` : '');
    const num = /(?:factura[^\n]{0,40}?|fact\.?\s*|no\.?\s*factura\s*)(?:n[°ºo.]?|no\.?|n[uú]mero|#)\s*[:.]?\s*([A-Z]{0,6}\s?-?\s?\d{2,12})/i.exec(texto);
    if (num) res.numero = num[1].replace(/\s+/g, '');

    // Proveedor
    const nConocidos = conocidos.filter(Boolean).map((p) => ({ p, k: norm(p) })).filter((x) => x.k.length >= 2);
    // Posición de la palabra en el texto (-1 si no está). El nombre del comercio suele ir en el encabezado.
    const posicion = (k) => {
      const m = new RegExp(`(^|[^a-z0-9])${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).exec(nTexto);
      return m ? m.index : -1;
    };
    const elegir = (lista) => lista.map((x) => ({ ...x, pos: posicion(x.k) })).filter((x) => x.pos >= 0)
      .sort((a, b) => a.pos - b.pos || b.k.length - a.k.length)[0];
    const conocido = elegir(nConocidos);
    const comercio = !conocido && elegir(COMERCIOS.map((p) => ({ p, k: norm(p) })));
    if (conocido) res.proveedor = conocido.p;
    else if (comercio) res.proveedor = comercio.p;
    else {
      const linea = lineas.slice(0, 8).find((l) => {
        const letras = (l.match(/\p{L}/gu) || []).length;
        return l.length >= 3 && l.length <= 45 && letras / l.length > 0.6 && !RE_NO_PROVEEDOR.test(l);
      });
      if (linea) res.proveedor = titulo(linea.replace(/[^\p{L}\d&.' -]/gu, '').trim());
    }

    // Categoría y método de pago sugeridos
    const pistaCat = norm(`${res.proveedor || ''} ${texto}`);
    const cat = PISTAS_CATEGORIA.find(([, re]) => re.test(norm(res.proveedor || ''))) || PISTAS_CATEGORIA.find(([, re]) => re.test(pistaCat));
    if (cat) res.categoria = cat[0];
    const pago = PISTAS_PAGO.find(([, re]) => re.test(nTexto));
    if (pago) res.metodo_pago = pago[0];

    const items = parsearItems(lineas);
    if (items.length) res.items = items;

    return res;
  }

  /** Productos: líneas "descripción ... valor" antes del subtotal/total. */
  function parsearItems(lineas) {
    const FIN = /^(sub\s*-?\s*total|total|valor\s*total|neto|gran\s*total|base\s*grav|forma\s*de\s*pago|medio\s*de\s*pago)/;
    const NO_ITEM = /\biva\b|impuesto|imp\.?\s*consumo|descuento|dcto|propina|cambio|efectivo|recibido|tarjeta|nequi|daviplata|saldo|nit\b|n\.i\.t|tel[eé:.]|fecha|factura|resoluci|cufe|autoriz|cajer|caja\b|cliente|direcc|calle|carrera|régimen|regimen|responsable|pagina|página|hora|vence|limite|límite|valor a pagar|total/i;
    const items = [];
    for (const l of lineas) {
      const n = norm(l);
      if (FIN.test(n)) break;
      if (NO_ITEM.test(n)) continue;
      // [cantidad] descripción ... valor [letra de impuesto]
      const m = /^(?:(\d{1,3}(?:[.,]\d{1,3})?)\s*(?:x|un|und|uds?|kg|lb)?\s+)?(.*?\p{L}.*?)\s+\$?\s?(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{2})?|\d{3,}(?:[.,]\d{2})?)\s*[A-Z*]?$/iu.exec(l);
      if (!m) continue;
      const valor = aNumero(m[3]);
      let desc = m[2].replace(/^\d{6,}\s+/, '').replace(/\s{2,}/g, ' ').replace(/[\s.:$-]+$/, '').trim();
      // "2 x 4.950" al final de la descripción: cantidad × unitario
      let cantidad = m[1] ? Number(m[1].replace(',', '.')) : 1;
      const xu = /\s(\d{1,3})\s*[xX*]\s*\$?\s?[\d.,]+$/.exec(desc);
      if (xu) { cantidad = Number(xu[1]); desc = desc.slice(0, xu.index).trim(); }
      const letras = (desc.match(/\p{L}/gu) || []).length;
      if (!valor || valor < 50 || letras < 3 || desc.length > 60) continue;
      items.push({ descripcion: titulo(desc), cantidad: Number.isFinite(cantidad) && cantidad > 0 ? cantidad : 1, valor });
    }
    return items.slice(0, 60);
  }

  /** QR de factura electrónica DIAN: "NumFac: ... FecFac: ... NitFac: ... ValTolFac: ... CUFE: ..." */
  function parsearQR(txt) {
    if (!txt) return null;
    const campo = (k) => { const m = new RegExp(`${k}\\s*[:=]\\s*([^\\n\\r]+)`, 'i').exec(txt); return m ? m[1].trim() : null; };
    const total = campo('ValTolFac') || campo('ValTotFac') || campo('ValPag');
    const fac = campo('ValFac');
    const iva = campo('ValIva');
    const otro = campo('ValOtroIm');
    const res = {};
    const num = (s) => { const n = Number(String(s).replace(/,/g, '')); return Number.isFinite(n) ? n : 0; };
    if (total) res.monto = Math.round(num(total));
    else if (fac) res.monto = Math.round(num(fac) + num(iva) + num(otro));
    const f = campo('FecFac');
    if (f) { const d = fechasEn(f)[0]; if (d) res.fecha = d; }
    const nit = campo('NitFac');
    if (nit) res.nit = nit.replace(/\D/g, '').replace(/(\d)(?=(\d{3})+$)/g, '$1.');
    const n = campo('NumFac');
    if (n) res.numero = n;
    const cufe = campo('CUFE') || (/documentkey=([0-9a-f]{40,})/i.exec(txt) || [])[1];
    if (cufe) res.cufe = cufe;
    if (res.monto) res.montoSeguro = true;
    return Object.keys(res).length ? res : null;
  }

  // ---------- Imagen / PDF ----------
  function aCanvas(fuente, w, h, max = 2200, min = 1200) {
    let k = Math.min(1, max / Math.max(w, h));
    if (Math.max(w, h) * k < min) k = min / Math.max(w, h);
    const cv = document.createElement('canvas');
    cv.width = Math.round(w * k);
    cv.height = Math.round(h * k);
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.drawImage(fuente, 0, 0, cv.width, cv.height);
    return cv;
  }

  async function imagenACanvas(file) {
    let bmp;
    try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch {
      bmp = await new Promise((ok, mal) => {
        const img = new Image();
        img.onload = () => ok(img);
        img.onerror = () => mal(new Error('Formato de imagen no soportado (si es HEIC, toma la foto en JPG)'));
        img.src = URL.createObjectURL(file);
      });
    }
    return aCanvas(bmp, bmp.width, bmp.height);
  }

  async function buscarQR(canvas) {
    await cargar(LIBS.jsqr);
    const intentos = [1000, 1600, canvas.width];
    for (const ancho of intentos) {
      const k = Math.min(1, ancho / canvas.width);
      const cv = k === 1 ? canvas : aCanvas(canvas, canvas.width, canvas.height, Math.max(canvas.width, canvas.height) * k, 0);
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      const d = ctx.getImageData(0, 0, cv.width, cv.height);
      const r = window.jsQR(d.data, cv.width, cv.height, { inversionAttempts: 'attemptBoth' });
      if (r?.data) return r.data;
    }
    return null;
  }

  let worker;
  async function ocr(canvas, progreso) {
    await cargar(LIBS.tesseract);
    if (!worker) {
      worker = window.Tesseract.createWorker('spa', 1, {
        logger: (m) => { if (m.status === 'recognizing text') worker._prog?.(m.progress); },
      });
    }
    const w = await worker;
    worker._prog = (p) => progreso?.(`Leyendo texto… ${Math.round(p * 100)}%`);
    // Escala de grises para mejorar el OCR
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const px = img.data;
    for (let i = 0; i < px.length; i += 4) {
      const g = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
      px[i] = px[i + 1] = px[i + 2] = g;
    }
    ctx.putImageData(img, 0, 0);
    const { data } = await w.recognize(canvas);
    worker._prog = null;
    return data.text || '';
  }

  async function pdfTextoYCanvas(file) {
    await cargar(LIBS.pdfjs);
    const pdfjs = window.pdfjsLib;
    pdfjs.GlobalWorkerOptions.workerSrc = LIBS.pdfWorker;
    const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
    let texto = '';
    for (let p = 1; p <= Math.min(pdf.numPages, 3); p++) {
      const page = await pdf.getPage(p);
      const tc = await page.getTextContent();
      const items = tc.items.filter((it) => it.str?.trim())
        .map((it) => ({ s: it.str, x: it.transform[4], y: it.transform[5] }))
        .sort((a, b) => (Math.abs(b.y - a.y) > 3 ? b.y - a.y : a.x - b.x));
      let y = null;
      let linea = [];
      const lineas = [];
      for (const it of items) {
        if (y !== null && Math.abs(it.y - y) > 3) { lineas.push(linea.join(' ')); linea = []; }
        linea.push(it.s);
        y = it.y;
      }
      if (linea.length) lineas.push(linea.join(' '));
      texto += lineas.join('\n') + '\n';
    }
    const page1 = await pdf.getPage(1);
    const vp = page1.getViewport({ scale: 2.2 });
    const cv = document.createElement('canvas');
    cv.width = vp.width;
    cv.height = vp.height;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, cv.width, cv.height);
    await page1.render({ canvasContext: ctx, viewport: vp }).promise;
    return { texto, canvas: cv };
  }

  /**
   * Analiza una factura.
   * @param {File|Blob} file  imagen o PDF
   * @param {{conocidos?: string[], progreso?: (msg:string)=>void}} opts
   * @returns {Promise<{monto?, fecha?, proveedor?, nit?, numero?, cufe?, categoria?, metodo_pago?, fuentes:string[], texto:string}>}
   */
  async function analizar(file, opts = {}) {
    const progreso = opts.progreso || (() => {});
    const esPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
    let texto = '';
    let canvas;
    const fuentes = [];

    if (esPdf) {
      progreso('Abriendo PDF…');
      const r = await pdfTextoYCanvas(file);
      texto = r.texto;
      canvas = r.canvas;
      if (texto.replace(/\s/g, '').length >= 40) fuentes.push('texto del PDF');
    } else {
      progreso('Preparando imagen…');
      canvas = await imagenACanvas(file);
    }

    progreso('Buscando código QR…');
    let qr = null;
    try { qr = parsearQR(await buscarQR(canvas)); } catch (e) { console.warn('QR', e); }
    if (qr) fuentes.unshift('QR DIAN');

    if (!fuentes.includes('texto del PDF')) {
      progreso('Leyendo texto…');
      texto = await ocr(canvas, progreso);
      fuentes.push('OCR');
    }

    const deTexto = parsearTexto(texto, opts.conocidos || []);
    // Los datos del QR son exactos: tienen prioridad sobre el texto.
    return { ...deTexto, ...(qr || {}), fuentes, texto };
  }

  /** pdf.js listo para usar (lo reutiliza el visor de la app). */
  async function pdfjs() {
    await cargar(LIBS.pdfjs);
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = LIBS.pdfWorker;
    return window.pdfjsLib;
  }

  window.LectorFacturas = { analizar, parsearTexto, parsearQR, parsearItems, aNumero, pdfjs, cargar };
})();
