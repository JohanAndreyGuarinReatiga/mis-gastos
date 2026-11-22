/* Mis Gastos — app principal (JavaScript sin frameworks) */
(() => {
  'use strict';

  const CFG = window.APP_CONFIG;
  const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_KEY);
  const MAX_FILE = 10 * 1024 * 1024;

  // ---------- Estado ----------
  const S = {
    user: null,
    cats: [],
    gastos: [],
    mes: primeroDeMes(new Date()),
    edit: null,          // { id, catId, existentes:[], borrar:[], nuevos:[] }
    detalle: null,
    catEdit: null,
    charts: {},
    urls: new Map(),     // ruta -> { url, exp }
  };

  // ---------- Utilidades ----------
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const fmtCOP = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
  const fmt = (n) => fmtCOP.format(Math.round(Number(n) || 0));
  const fmtNum = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 });
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const ym = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  function primeroDeMes(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
  function sumarMeses(d, n) { return new Date(d.getFullYear(), d.getMonth() + n, 1); }
  const parseFecha = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const mayus = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const nombreMes = (d, corto = false) => mayus(d.toLocaleDateString('es-CO', corto ? { month: 'short' } : { month: 'long', year: 'numeric' }));
  const fechaLarga = (s) => mayus(parseFecha(s).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' }));
  const fechaCorta = (s) => parseFecha(s).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' });
  const digitos = (s) => String(s || '').replace(/\D/g, '');
  const catDe = (id) => S.cats.find((c) => c.id === id) || { nombre: 'Sin categoría', color: '#94a3b8', icono: '❔' };
  const esPDF = (tipo) => tipo === 'application/pdf';
  const cssVar = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } },
  };

  let toastT;
  function toast(msg, err = false) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.toggle('err', err);
    t.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => t.classList.remove('show'), err ? 4500 : 2500);
  }
  const loading = (on) => $('#loader').classList.toggle('show', on);
  function fallo(e, ctx) {
    console.error(ctx, e);
    toast(`${ctx}: ${e?.message || e}`, true);
  }

  // ---------- Autenticación ----------
  async function iniciar() {
    const { data } = await sb.auth.getSession();
    if (data.session) await entrar(data.session.user);
    else mostrarLogin();
    sb.auth.onAuthStateChange((ev, session) => {
      if (ev === 'SIGNED_OUT') mostrarLogin();
      else if (session?.user) S.user = session.user;
    });
  }

  function mostrarLogin() {
    S.user = null;
    $('#app').hidden = true;
    $('#view-login').hidden = false;
  }

  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const btn = $('button[type=submit]', f);
    $('#login-error').hidden = true;
    btn.disabled = true;
    const { data, error } = await sb.auth.signInWithPassword({ email: f.email.value.trim(), password: f.password.value });
    btn.disabled = false;
    if (error) {
      $('#login-error').textContent = error.message === 'Invalid login credentials' ? 'Correo o contraseña incorrectos' : error.message;
      $('#login-error').hidden = false;
      return;
    }
    f.reset();
    await entrar(data.user);
  });

  async function entrar(user) {
    S.user = user;
    $('#view-login').hidden = true;
    $('#app').hidden = false;
    $('#user-email').textContent = user.email;
    loading(true);
    try {
      await cargarCategorias();
      await cargarGastos();
    } catch (e) { fallo(e, 'No se pudieron cargar los datos'); }
    loading(false);
    ruta();
  }

  $('#logout').addEventListener('click', async () => {
    await sb.auth.signOut();
    S.gastos = []; S.cats = []; S.urls.clear();
  });

  // ---------- Datos ----------
  async function cargarCategorias() {
    let { data, error } = await sb.from('categorias').select('*').order('nombre');
    if (error) throw error;
    if (!data.length) {
      const ins = await sb.from('categorias').insert(CFG.CATEGORIAS_DEFECTO).select();
      if (ins.error) throw ins.error;
      data = ins.data.sort((a, b) => a.nombre.localeCompare(b.nombre));
    }
    S.cats = data;
  }

  async function cargarGastos() {
    const todos = [];
    const paso = 1000;
    for (let desde = 0; ; desde += paso) {
      const { data, error } = await sb.from('gastos')
        .select('*, adjuntos(id, ruta, nombre, tipo, tamano)')
        .order('fecha', { ascending: false })
        .order('id', { ascending: false })
        .range(desde, desde + paso - 1);
      if (error) throw error;
      todos.push(...data);
      if (data.length < paso) break;
    }
    S.gastos = todos.map((g) => ({ ...g, monto: Number(g.monto) }));
  }

  async function urlsFirmadas(rutas) {
    const ahora = Date.now();
    const faltan = rutas.filter((r) => !(S.urls.get(r)?.exp > ahora));
    if (faltan.length) {
      const { data, error } = await sb.storage.from(CFG.BUCKET).createSignedUrls(faltan, 3600);
      if (error) throw error;
      data.forEach((d) => { if (d.signedUrl) S.urls.set(d.path, { url: d.signedUrl, exp: ahora + 50 * 60 * 1000 }); });
    }
    return Object.fromEntries(rutas.map((r) => [r, S.urls.get(r)?.url]));
  }

  // ---------- Enrutamiento ----------
  const VISTAS = ['inicio', 'gastos', 'ajustes'];
  function ruta() {
    if (!S.user) return;
    const v = VISTAS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'inicio';
    VISTAS.forEach((x) => { $(`#view-${x}`).hidden = x !== v; });
    $$('.nav-item[data-view]').forEach((a) => a.classList.toggle('active', a.dataset.view === v));
    ({ inicio: renderInicio, gastos: renderLista, ajustes: renderAjustes })[v]();
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', ruta);
  const refrescar = () => ruta();

  // ---------- Vista: Inicio ----------
  $('#mes-prev').addEventListener('click', () => { S.mes = sumarMeses(S.mes, -1); renderInicio(); });
  $('#mes-next').addEventListener('click', () => { S.mes = sumarMeses(S.mes, 1); renderInicio(); });

  function gastosDelMes(d) {
    const k = ym(d);
    return S.gastos.filter((g) => g.fecha.startsWith(k));
  }
  const suma = (arr) => arr.reduce((a, g) => a + g.monto, 0);

  function itemHTML(g, conFecha = true) {
    const c = catDe(g.categoria_id);
    const titulo = g.proveedor || g.descripcion || c.nombre;
    const sub = [c.nombre, g.metodo_pago, conFecha ? fechaCorta(g.fecha) : null].filter(Boolean).join(' · ');
    const nAdj = g.adjuntos?.length || 0;
    const items = itemsDe(g);
    return `<li class="item-wrap">
      <div class="item" data-id="${g.id}">
        <span class="item-ico" style="background:${esc(c.color)}22">${esc(c.icono)}</span>
        <div class="item-main"><div class="item-title">${esc(titulo)}</div><div class="item-sub">${esc(sub)}</div></div>
        <div class="item-amount">${fmt(g.monto)}<small>${nAdj ? `📎 ${nAdj}` : 'sin factura'}</small></div>
      </div>
      ${items.length ? `<details class="prod-toggle"><summary>${items.length} producto${items.length === 1 ? '' : 's'}</summary>${prodsHTML(items)}</details>` : ''}
    </li>`;
  }

  const itemsDe = (g) => (Array.isArray(g.items) ? g.items : []);
  function prodsHTML(items) {
    const total = items.reduce((a, it) => a + (Number(it.valor) || 0), 0);
    return `<ul class="prod-lista">${items.map((it) => `<li><span>${esc(it.descripcion)}</span>${Number(it.cantidad) !== 1 ? `<span class="q">×${esc(fmtNum.format(it.cantidad))}</span>` : ''}<span class="v">${fmt(it.valor)}</span></li>`).join('')}
      <li class="tot"><span>Suma de productos</span><span class="v">${fmt(total)}</span></li></ul>`;
  }

  function renderInicio() {
    $('#mes-label').textContent = nombreMes(S.mes);
    const actual = gastosDelMes(S.mes);
    const total = suma(actual);
    const prev = suma(gastosDelMes(sumarMeses(S.mes, -1)));
    $('#st-total').textContent = fmt(total);
    if (prev > 0) {
      const v = ((total - prev) / prev) * 100;
      $('#st-var').textContent = `${v >= 0 ? '▲' : '▼'} ${Math.abs(v).toFixed(0)}% vs. mes anterior (${fmt(prev)})`;
    } else $('#st-var').textContent = 'Sin datos del mes anterior';
    $('#st-count').textContent = actual.length;
    const hoy = new Date();
    const esMesActual = ym(hoy) === ym(S.mes);
    const dias = esMesActual ? hoy.getDate() : new Date(S.mes.getFullYear(), S.mes.getMonth() + 1, 0).getDate();
    $('#st-prom').textContent = fmt(total / dias);
    $('#st-sinfac').textContent = actual.filter((g) => !g.adjuntos?.length).length;

    // Por categoría
    const porCat = new Map();
    actual.forEach((g) => porCat.set(g.categoria_id, (porCat.get(g.categoria_id) || 0) + g.monto));
    const filas = [...porCat.entries()].map(([id, v]) => ({ c: catDe(id), v })).sort((a, b) => b.v - a.v);
    $('#cat-legend').innerHTML = filas.length
      ? filas.map(({ c, v }) => `<li><span class="dot" style="background:${esc(c.color)}"></span>${esc(c.icono)} ${esc(c.nombre)}<span class="val">${fmt(v)}</span><span class="pct">${((v / total) * 100).toFixed(0)}%</span></li>`).join('')
      : '<li class="muted">Sin gastos este mes</li>';

    if (window.Chart) {
      Chart.defaults.color = cssVar('--muted');
      Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
      S.charts.cat?.destroy();
      S.charts.cat = new Chart($('#chart-cat'), {
        type: 'doughnut',
        data: {
          labels: filas.map((f) => f.c.nombre),
          datasets: [{ data: filas.map((f) => f.v), backgroundColor: filas.map((f) => f.c.color), borderColor: cssVar('--surface'), borderWidth: 2 }],
        },
        options: {
          maintainAspectRatio: false, cutout: '62%',
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: (x) => ` ${x.label}: ${fmt(x.raw)}` } } },
        },
      });

      const meses = Array.from({ length: 6 }, (_, i) => sumarMeses(S.mes, i - 5));
      S.charts.mes?.destroy();
      S.charts.mes = new Chart($('#chart-mes'), {
        type: 'bar',
        data: {
          labels: meses.map((m) => nombreMes(m, true)),
          datasets: [{
            data: meses.map((m) => suma(gastosDelMes(m))),
            backgroundColor: meses.map((_, i) => (i === 5 ? cssVar('--primary') : cssVar('--primary-soft'))),
            borderRadius: 6,
          }],
        },
        options: {
          maintainAspectRatio: false,
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: (x) => ` ${fmt(x.raw)}` } } },
          scales: {
            x: { grid: { display: false } },
            y: { grid: { color: cssVar('--border') }, ticks: { callback: (v) => (v >= 1e6 ? `${fmtNum.format(v / 1e6)} M` : v >= 1e3 ? `${fmtNum.format(v / 1e3)} k` : v) } },
          },
        },
      });
    }

    const rec = S.gastos.slice(0, 6);
    $('#recientes').innerHTML = rec.length ? rec.map((g) => itemHTML(g)).join('') : '<li class="empty">Aún no hay gastos. Toca <b>＋ Nuevo</b> para registrar el primero.</li>';
  }

  // ---------- Vista: Lista ----------
  $('#f-mes').value = ym(new Date());
  ['#f-buscar', '#f-mes', '#f-cat'].forEach((s) => $(s).addEventListener('input', renderLista));

  function gastosFiltrados() {
    const q = $('#f-buscar').value.trim().toLowerCase();
    const mes = $('#f-mes').value;
    const cat = $('#f-cat').value;
    return S.gastos.filter((g) =>
      (!mes || g.fecha.startsWith(mes)) &&
      (!cat || String(g.categoria_id) === cat) &&
      (!q || `${g.proveedor || ''} ${g.descripcion || ''} ${catDe(g.categoria_id).nombre}`.toLowerCase().includes(q)));
  }

  function renderLista() {
    const sel = $('#f-cat');
    const val = sel.value;
    sel.innerHTML = '<option value="">Todas las categorías</option>' + S.cats.map((c) => `<option value="${c.id}">${esc(c.icono)} ${esc(c.nombre)}</option>`).join('');
    sel.value = val;

    const lista = gastosFiltrados();
    $('#lista-total').textContent = `${lista.length} gasto${lista.length === 1 ? '' : 's'} · ${fmt(suma(lista))}`;
    if (!lista.length) {
      $('#lista-gastos').innerHTML = '<div class="card empty">No hay gastos con estos filtros.</div>';
      return;
    }
    const grupos = new Map();
    lista.forEach((g) => { if (!grupos.has(g.fecha)) grupos.set(g.fecha, []); grupos.get(g.fecha).push(g); });
    $('#lista-gastos').innerHTML = [...grupos.entries()].map(([f, gs]) => `
      <div class="day-group">
        <div class="day-head"><span>${esc(fechaLarga(f))}</span><span>${fmt(suma(gs))}</span></div>
        <ul class="list">${gs.map((g) => itemHTML(g, false)).join('')}</ul>
      </div>`).join('');
  }

  // Click en cualquier gasto => detalle
  document.addEventListener('click', (e) => {
    const it = e.target.closest('.item[data-id]');
    if (it) abrirDetalle(Number(it.dataset.id));
  });

  // ---------- Detalle ----------
  async function abrirDetalle(id) {
    const g = S.gastos.find((x) => x.id === id);
    if (!g) return;
    S.detalle = g;
    const c = catDe(g.categoria_id);
    const adj = g.adjuntos || [];
    $('#detalle-body').innerHTML = `
      <div class="det-monto">${fmt(g.monto)}</div>
      <dl class="det-rows">
        <dt>Categoría</dt><dd>${esc(c.icono)} ${esc(c.nombre)}</dd>
        <dt>Fecha</dt><dd>${esc(fechaLarga(g.fecha))}</dd>
        ${g.proveedor ? `<dt>Proveedor</dt><dd>${esc(g.proveedor)}</dd>` : ''}
        ${g.metodo_pago ? `<dt>Pago</dt><dd>${esc(g.metodo_pago)}</dd>` : ''}
        ${g.descripcion ? `<dt>Descripción</dt><dd>${esc(g.descripcion)}</dd>` : ''}
      </dl>
      ${itemsDe(g).length ? `<details class="prods det-prods"><summary><span>🛒 Productos</span><span class="muted">${itemsDe(g).length}</span></summary><div class="prods-body">${prodsHTML(itemsDe(g))}</div></details>` : ''}
      <div class="field">
        <span class="field-label">Facturas (${adj.length}) — toca para ver</span>
        <div class="adj-grid" id="det-adj">${adj.length ? adj.map(() => '<div class="adj"><div class="spinner"></div></div>').join('') : '<p class="muted">Sin facturas adjuntas.</p>'}</div>
      </div>`;
    $('#dlg-detalle').showModal();
    if (adj.length) {
      try {
        const urls = await urlsFirmadas(adj.map((a) => a.ruta));
        if (S.detalle !== g) return;
        pintarGaleria('det-adj', adj.map((a) => ({ nombre: a.nombre, tipo: a.tipo, src: urls[a.ruta] })));
      } catch (e) { fallo(e, 'No se pudieron cargar las facturas'); }
    }
  }

  // ---------- Miniaturas y galería ----------
  S.galerias = {};
  S.miniaturas = new Map(); // src -> dataURL de la 1.ª página del PDF

  /** items: [{ nombre, tipo, src, key? }] — key presente => se puede quitar (formulario) */
  function pintarGaleria(gridId, items) {
    S.galerias[gridId] = items;
    const grid = $(`#${gridId}`);
    grid.innerHTML = items.map((a, i) => {
      const del = a.key ? `<button type="button" class="adj-del" data-del="${esc(a.key)}" aria-label="Quitar">✕</button>` : '';
      if (esPDF(a.tipo)) {
        const mini = S.miniaturas.get(a.src);
        return `<div class="adj" data-gal="${i}" ${mini ? '' : `data-pdf="${esc(a.src || '')}"`} title="${esc(a.nombre || 'PDF')}">
          ${mini ? `<img class="adj-thumb" src="${mini}" alt="">` : `<div class="adj-pdf"><b>📄</b>${esc(a.nombre || 'PDF')}</div>`}
          <span class="adj-badge">PDF</span>${del}</div>`;
      }
      const verImg = a.src && !/hei[cf]/i.test(a.tipo || '');
      return `<div class="adj" data-gal="${i}" title="${esc(a.nombre || 'Imagen')}">
        ${verImg ? `<img src="${esc(a.src)}" alt="${esc(a.nombre || 'Factura')}" loading="lazy">` : `<div class="adj-pdf"><b>🖼️</b>${esc(a.nombre || 'Imagen')}</div>`}${del}</div>`;
    }).join('');
    miniaturasPDF(grid);
  }

  async function miniaturasPDF(grid) {
    const pendientes = $$('[data-pdf]', grid).filter((el) => el.dataset.pdf);
    if (!pendientes.length || !window.LectorFacturas) return;
    try {
      const pdfjs = await LectorFacturas.pdfjs();
      for (const el of pendientes) {
        const src = el.dataset.pdf;
        try {
          const pdf = await pdfjs.getDocument(src).promise;
          const page = await pdf.getPage(1);
          const vp0 = page.getViewport({ scale: 1 });
          const vp = page.getViewport({ scale: 240 / vp0.width });
          const cv = document.createElement('canvas');
          cv.width = vp.width; cv.height = vp.height;
          await page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
          const url = cv.toDataURL('image/jpeg', 0.8);
          S.miniaturas.set(src, url);
          pdf.destroy();
          if (!el.isConnected) continue;
          el.removeAttribute('data-pdf');
          $('.adj-pdf', el)?.replaceWith(Object.assign(document.createElement('img'), { className: 'adj-thumb', src: url, alt: '' }));
        } catch (e) { console.warn('Miniatura PDF', e); }
      }
    } catch (e) { console.warn('pdf.js', e); }
  }

  document.addEventListener('click', (e) => {
    const el = e.target.closest('.adj[data-gal]');
    if (!el || e.target.closest('.adj-del')) return;
    const grid = el.closest('.adj-grid');
    abrirVisor(S.galerias[grid?.id] || [], Number(el.dataset.gal));
  });

  // ---------- Visor (imágenes y PDF dentro de la app) ----------
  const V = { lista: [], i: 0, token: 0 };
  function abrirVisor(lista, i) {
    if (!lista.length) return;
    V.lista = lista;
    $('#dlg-visor').showModal();
    mostrarEnVisor(i);
  }

  async function mostrarEnVisor(i) {
    const n = V.lista.length;
    V.i = (i + n) % n;
    const a = V.lista[V.i];
    const token = ++V.token;
    const body = $('#visor-body');
    body.classList.remove('zoom');
    body.scrollTo(0, 0);
    $('#visor-nombre').textContent = a.nombre || (esPDF(a.tipo) ? 'Documento PDF' : 'Imagen');
    $('#visor-pos').textContent = n > 1 ? `${V.i + 1} de ${n}` : (esPDF(a.tipo) ? 'PDF' : 'Imagen');
    $('#visor-prev').hidden = $('#visor-next').hidden = n < 2;
    const bajar = $('#visor-bajar');
    bajar.href = a.src || '#';
    bajar.download = a.nombre || '';
    bajar.target = '_blank';
    bajar.rel = 'noopener';

    if (!a.src) { body.className = 'visor-body centrar'; body.innerHTML = '<p class="visor-msg">Archivo no disponible.</p>'; return; }

    if (!esPDF(a.tipo)) {
      body.className = 'visor-body centrar';
      body.innerHTML = '';
      const img = new Image();
      img.alt = a.nombre || 'Factura';
      img.onerror = () => { if (token === V.token) body.innerHTML = '<p class="visor-msg">Este formato no se puede previsualizar en el navegador (por ejemplo HEIC).<br>Usa ⬇ para descargarlo.</p>'; };
      img.src = a.src;
      body.appendChild(img);
      return;
    }

    body.className = 'visor-body';
    body.innerHTML = '<p class="visor-msg"><span class="spinner"></span><br>Abriendo PDF…</p>';
    try {
      const pdfjs = await LectorFacturas.pdfjs();
      const pdf = await pdfjs.getDocument(a.src).promise;
      if (token !== V.token) return pdf.destroy();
      body.innerHTML = '';
      const ancho = Math.min(body.clientWidth - 24, 900) * Math.min(window.devicePixelRatio || 1, 2) * 1.5;
      const paginas = Math.min(pdf.numPages, 30);
      for (let p = 1; p <= paginas; p++) {
        const page = await pdf.getPage(p);
        const vp = page.getViewport({ scale: ancho / page.getViewport({ scale: 1 }).width });
        const cv = document.createElement('canvas');
        cv.width = vp.width; cv.height = vp.height;
        if (token !== V.token) return pdf.destroy();
        body.appendChild(cv);
        await page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
      }
      if (pdf.numPages > paginas) body.insertAdjacentHTML('beforeend', `<p class="visor-msg">Mostrando ${paginas} de ${pdf.numPages} páginas. Descárgalo para ver el resto.</p>`);
    } catch (e) {
      console.error(e);
      if (token === V.token) body.innerHTML = `<p class="visor-msg">No se pudo mostrar el PDF (${esc(e.message || e)}).<br>Usa ⬇ para abrirlo.</p>`;
    }
  }

  $('#visor-prev').addEventListener('click', () => mostrarEnVisor(V.i - 1));
  $('#visor-next').addEventListener('click', () => mostrarEnVisor(V.i + 1));
  $('#visor-zoom').addEventListener('click', () => $('#visor-body').classList.toggle('zoom'));
  $('#visor-body').addEventListener('click', (e) => { if (e.target.tagName === 'IMG') $('#visor-body').classList.toggle('zoom'); });
  $('#dlg-visor').addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') mostrarEnVisor(V.i - 1);
    if (e.key === 'ArrowRight') mostrarEnVisor(V.i + 1);
  });
  $('#dlg-visor').addEventListener('close', () => { V.token++; $('#visor-body').innerHTML = ''; });
  // Deslizar a los lados para cambiar de factura (si no hay zoom)
  let toque = null;
  $('#visor-body').addEventListener('touchstart', (e) => { toque = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null; }, { passive: true });
  $('#visor-body').addEventListener('touchend', (e) => {
    if (!toque || V.lista.length < 2 || $('#visor-body').classList.contains('zoom') || (window.visualViewport?.scale || 1) > 1.05) return;
    const dx = e.changedTouches[0].clientX - toque.x;
    const dy = e.changedTouches[0].clientY - toque.y;
    if (Math.abs(dx) > 70 && Math.abs(dy) < 60) mostrarEnVisor(V.i + (dx < 0 ? 1 : -1));
    toque = null;
  }, { passive: true });

  $('#det-editar').addEventListener('click', () => {
    const g = S.detalle;
    $('#dlg-detalle').close();
    abrirFormulario(g);
  });

  $('#det-borrar').addEventListener('click', async () => {
    const g = S.detalle;
    if (!g || !confirm(`¿Eliminar este gasto de ${fmt(g.monto)} y sus ${g.adjuntos?.length || 0} factura(s)? No se puede deshacer.`)) return;
    loading(true);
    try {
      const rutas = (g.adjuntos || []).map((a) => a.ruta);
      if (rutas.length) {
        const r = await sb.storage.from(CFG.BUCKET).remove(rutas);
        if (r.error) throw r.error;
      }
      const { error } = await sb.from('gastos').delete().eq('id', g.id);
      if (error) throw error;
      S.gastos = S.gastos.filter((x) => x.id !== g.id);
      $('#dlg-detalle').close();
      toast('Gasto eliminado');
      refrescar();
    } catch (e) { fallo(e, 'No se pudo eliminar'); }
    loading(false);
  });

  // ---------- Formulario de gasto ----------
  const fG = $('#form-gasto');
  fG.metodo_pago.innerHTML = '<option value="">—</option>' + CFG.METODOS_PAGO.map((m) => `<option>${esc(m)}</option>`).join('');

  fG.monto.addEventListener('input', () => {
    const d = digitos(fG.monto.value).slice(0, 13);
    fG.monto.value = d ? `$ ${fmtNum.format(Number(d))}` : '';
  });

  $('#nav-add').addEventListener('click', () => abrirFormulario(null));

  function abrirFormulario(g) {
    fG.reset();
    S.edit = {
      id: g?.id || null,
      catId: g ? g.categoria_id : Number(store.get('ultimaCat')) || null,
      existentes: (g?.adjuntos || []).map((a) => ({ ...a, key: `e${a.id}` })),
      borrar: [],
      nuevos: [],
      // Campos que el usuario ya definió: la lectura automática no los sobrescribe.
      tocado: new Set(g ? CAMPOS_AUTO : []),
      leyendo: false,
      items: itemsDe(g || {}).map((it) => ({ ...it })),
      teniaItems: itemsDe(g || {}).length > 0,
    };
    $('#form-prods').open = false;
    renderProds();
    $$('.auto', fG).forEach((el) => el.classList.remove('auto'));
    banner(null);
    if (!S.cats.some((c) => c.id === S.edit.catId)) S.edit.catId = g ? null : S.cats[0]?.id ?? null;
    $('#form-title').textContent = g ? 'Editar gasto' : 'Nuevo gasto';
    fG.monto.value = g ? `$ ${fmtNum.format(g.monto)}` : '';
    fG.fecha.value = g?.fecha || ymd(new Date());
    fG.metodo_pago.value = g?.metodo_pago || store.get('ultimoPago') || '';
    fG.proveedor.value = g?.proveedor || '';
    fG.descripcion.value = g?.descripcion || '';
    $('#proveedores').innerHTML = [...new Set(S.gastos.map((x) => x.proveedor).filter(Boolean))].slice(0, 200).map((p) => `<option value="${esc(p)}">`).join('');
    renderChips();
    actualizarSumaProds();
    renderAdjForm();
    $('#dlg-gasto').showModal();
    if (!g) setTimeout(() => fG.monto.focus(), 50);
  }

  function renderChips() {
    $('#form-cats').innerHTML = S.cats.map((c) =>
      `<button type="button" class="chip" data-cat="${c.id}" style="--c:${esc(c.color)}" aria-pressed="${c.id === S.edit.catId}">${esc(c.icono)} ${esc(c.nombre)}</button>`).join('');
  }
  $('#form-cats').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cat]');
    if (!b) return;
    S.edit.catId = Number(b.dataset.cat);
    S.edit.tocado.add('cat');
    renderChips();
  });

  // ---------- Productos del gasto ----------
  function renderProds() {
    const E = S.edit;
    $('#prods-filas').innerHTML = E.items.map((it, i) => `
      <div class="prod-fila" data-i="${i}">
        <input data-campo="descripcion" value="${esc(it.descripcion || '')}" placeholder="Producto" autocomplete="off" aria-label="Producto">
        <input data-campo="cantidad" value="${esc(it.cantidad ?? 1)}" inputmode="decimal" aria-label="Cantidad">
        <input data-campo="valor" value="${it.valor ? `$ ${fmtNum.format(it.valor)}` : ''}" inputmode="numeric" placeholder="$ 0" aria-label="Valor">
        <button type="button" class="btn btn-icon" data-quitar="${i}" aria-label="Quitar producto">✕</button>
      </div>`).join('') || '<p class="muted small">Sin productos. Se llenan solos al leer la factura, o agrégalos a mano.</p>';
    actualizarSumaProds();
  }

  function actualizarSumaProds() {
    const E = S.edit;
    if (!E) return;
    const n = E.items.length;
    const total = E.items.reduce((a, it) => a + (Number(it.valor) || 0), 0);
    $('#prods-resumen').textContent = n ? `${n} · ${fmt(total)}` : 'opcional';
    const monto = Number(digitos(fG.monto.value));
    const dif = n && monto && Math.abs(monto - total) > 1;
    $('#prods-suma').innerHTML = n ? `Suma: <b>${fmt(total)}</b>${dif ? ` <span class="diff">(${monto > total ? 'faltan' : 'sobran'} ${fmt(Math.abs(monto - total))})</span>` : ''}` : '';
  }

  $('#prods-filas').addEventListener('input', (e) => {
    const fila = e.target.closest('.prod-fila');
    if (!fila) return;
    const it = S.edit.items[Number(fila.dataset.i)];
    // Ojo: los inputs de productos usan data-campo (no "name") para no chocar con fG.descripcion.
    const k = e.target.dataset.campo;
    if (k === 'valor') {
      const d = digitos(e.target.value).slice(0, 13);
      e.target.value = d ? `$ ${fmtNum.format(Number(d))}` : '';
      it.valor = Number(d) || 0;
    } else if (k === 'cantidad') {
      it.cantidad = Number(e.target.value.replace(',', '.')) || 1;
    } else it.descripcion = e.target.value;
    S.edit.tocado.add('items');
    $('#form-prods').classList.remove('auto');
    actualizarSumaProds();
  });
  $('#prods-filas').addEventListener('click', (e) => {
    const b = e.target.closest('[data-quitar]');
    if (!b) return;
    S.edit.items.splice(Number(b.dataset.quitar), 1);
    S.edit.tocado.add('items');
    renderProds();
  });
  $('#prod-add').addEventListener('click', () => {
    S.edit.items.push({ descripcion: '', cantidad: 1, valor: 0 });
    S.edit.tocado.add('items');
    renderProds();
    $$('#prods-filas .prod-fila input[data-campo=descripcion]').pop()?.focus();
  });
  fG.monto.addEventListener('input', actualizarSumaProds);

  const itemsLimpios = (items) => items
    .map((it) => ({ descripcion: String(it.descripcion || '').trim(), cantidad: Number(it.cantidad) || 1, valor: Math.round(Number(it.valor) || 0) }))
    .filter((it) => it.descripcion || it.valor);

  // ---------- Lectura automática de facturas ----------
  const CAMPOS_AUTO = ['monto', 'fecha', 'proveedor', 'descripcion', 'metodo_pago', 'cat', 'items'];
  ['monto', 'fecha', 'proveedor', 'descripcion', 'metodo_pago'].forEach((k) => {
    fG[k].addEventListener('input', () => { S.edit?.tocado.add(k); fG[k].classList.remove('auto'); });
  });

  function banner(msg, { cargando = false, error = false } = {}) {
    const E = S.edit;
    const hayArchivos = E && (E.nuevos.length || E.existentes.some((a) => !E.borrar.includes(a.id)));
    const b = $('#auto-banner');
    b.hidden = !msg && !hayArchivos;
    b.classList.toggle('err', error);
    $('#auto-msg').innerHTML = msg ? `${cargando ? '<span class="spinner"></span>' : ''}${esc(msg)}` : 'Puedes autocompletar los datos desde la factura.';
    $('#btn-leer').hidden = cargando;
  }

  $('#btn-leer').addEventListener('click', () => leerFactura(null, true));

  async function archivoParaLeer(E) {
    if (E.nuevos.length) return E.nuevos[E.nuevos.length - 1].file;
    const a = E.existentes.find((x) => !E.borrar.includes(x.id));
    if (!a) return null;
    const { data, error } = await sb.storage.from(CFG.BUCKET).download(a.ruta);
    if (error) throw error;
    return new File([data], a.nombre || 'factura', { type: a.tipo || data.type });
  }

  /** @param forzar si es true (botón), también rellena campos que el usuario no ha tocado pero ya tienen valor */
  async function leerFactura(file, forzar = false) {
    const E = S.edit;
    if (!E || E.leyendo || !window.LectorFacturas) return;
    E.leyendo = true;
    banner('Leyendo factura…', { cargando: true });
    try {
      file ||= await archivoParaLeer(E);
      if (!file) { banner('Primero agrega una foto o PDF de la factura.'); return; }
      const conocidos = [...new Set(S.gastos.map((g) => g.proveedor).filter(Boolean))];
      const r = await LectorFacturas.analizar(file, {
        conocidos,
        progreso: (m) => { if (S.edit === E) banner(m, { cargando: true }); },
      });
      if (S.edit !== E) return;
      const llenos = aplicarLectura(E, r, forzar);
      const fuente = r.fuentes.join(' + ');
      if (llenos.length) {
        banner(`✨ Completé ${llenos.join(', ')} (${fuente}).${r.montoSeguro === false ? ' El monto es una suposición:' : ''} Revisa antes de guardar.`);
      } else if (r.monto || r.fecha || r.proveedor) {
        banner(`Leí la factura (${fuente}), pero ya habías llenado esos campos.`);
      } else {
        banner('No encontré datos claros en la factura. Complétalos a mano o prueba con una foto más nítida.', { error: true });
      }
      console.info('Lectura de factura:', r);
    } catch (e) {
      console.error(e);
      if (S.edit === E) banner(`No se pudo leer la factura: ${e.message || e}`, { error: true });
    } finally {
      E.leyendo = false;
    }
  }

  function aplicarLectura(E, r, forzar) {
    const llenos = [];
    const puede = (k) => !E.tocado.has(k) || (forzar && k !== 'cat' && !fG[k]?.value);
    const poner = (k, valor, etiqueta) => {
      if (valor == null || valor === '' || !puede(k)) return;
      fG[k].value = valor;
      fG[k].classList.add('auto');
      llenos.push(etiqueta);
    };
    if (r.monto) poner('monto', `$ ${fmtNum.format(r.monto)}`, 'monto');
    poner('fecha', r.fecha, 'fecha');
    poner('proveedor', r.proveedor, 'proveedor');
    const desc = [r.numero && `Factura ${r.numero}`, r.nit && `NIT ${r.nit}`].filter(Boolean).join(' · ');
    poner('descripcion', desc, 'n.º de factura');
    if (r.metodo_pago && CFG.METODOS_PAGO.includes(r.metodo_pago)) poner('metodo_pago', r.metodo_pago, 'método de pago');

    if (r.items?.length && (!E.tocado.has('items') || (forzar && !itemsLimpios(E.items).length))) {
      E.items = r.items.map((it) => ({ ...it }));
      renderProds();
      $('#form-prods').classList.add('auto');
      llenos.push(`${r.items.length} producto${r.items.length === 1 ? '' : 's'}`);
    }

    if (!E.tocado.has('cat')) {
      const n = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
      // 1) misma categoría que usaste antes con ese proveedor; 2) sugerencia por palabras clave
      const previo = r.proveedor && S.gastos.find((g) => n(g.proveedor) === n(r.proveedor) && g.categoria_id);
      const cat = previo ? S.cats.find((c) => c.id === previo.categoria_id) : S.cats.find((c) => n(c.nombre) === n(r.categoria));
      if (cat) {
        E.catId = cat.id;
        renderChips();
        $(`#form-cats [data-cat="${cat.id}"]`)?.classList.add('auto');
        llenos.push('categoría');
      }
    }
    return llenos;
  }

  async function renderAdjForm() {
    const E = S.edit;
    const vivos = E.existentes.filter((a) => !E.borrar.includes(a.id));
    let urls = {};
    if (vivos.length) {
      try { urls = await urlsFirmadas(vivos.map((a) => a.ruta)); } catch (e) { fallo(e, 'No se pudieron cargar las facturas'); }
    }
    if (S.edit !== E) return;
    if (!E.leyendo && ($('#auto-banner').hidden || !(vivos.length || E.nuevos.length))) banner(null);
    pintarGaleria('form-adjuntos', [
      ...vivos.map((a) => ({ key: `e${a.id}`, nombre: a.nombre, tipo: a.tipo, src: urls[a.ruta] })),
      ...E.nuevos.map((n) => ({ key: n.key, nombre: n.file.name, tipo: n.file.type, src: n.preview })),
    ]);
  }

  $('#form-adjuntos').addEventListener('click', (e) => {
    const b = e.target.closest('[data-del]');
    if (!b) return;
    e.preventDefault();
    const k = b.dataset.del;
    if (k.startsWith('e')) S.edit.borrar.push(Number(k.slice(1)));
    else {
      const n = S.edit.nuevos.find((x) => x.key === k);
      if (n?.preview) URL.revokeObjectURL(n.preview);
      S.edit.nuevos = S.edit.nuevos.filter((x) => x.key !== k);
    }
    renderAdjForm();
  });

  async function agregarArchivos(files) {
    const antes = S.edit.nuevos.length;
    for (const f0 of files) {
      if (!(f0.type.startsWith('image/') || esPDF(f0.type))) { toast(`${f0.name}: solo imágenes o PDF`, true); continue; }
      const f = await comprimir(f0);
      if (f.size > MAX_FILE) { toast(`${f.name} supera 10 MB`, true); continue; }
      // Para leer usamos el original (mejor resolución); para subir, el comprimido.
      // preview: URL local para miniatura y visor (imágenes y PDF).
      S.edit.nuevos.push({ key: `n${Math.random().toString(36).slice(2)}`, file: f, original: f0, preview: URL.createObjectURL(f) });
    }
    renderAdjForm();
    const agregado = S.edit.nuevos.length > antes ? S.edit.nuevos[S.edit.nuevos.length - 1] : null;
    // Lectura automática si el monto aún no lo escribió el usuario.
    if (agregado && !S.edit.tocado.has('monto')) leerFactura(agregado.original);
  }
  ['#in-camara', '#in-archivo'].forEach((s) => $(s).addEventListener('change', async (e) => {
    await agregarArchivos([...e.target.files]);
    e.target.value = '';
  }));

  // Reduce fotos grandes (las de celular pesan 3–8 MB) a ~2000 px JPEG.
  async function comprimir(file) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 500 * 1024) return file;
    try {
      const bmp = await createImageBitmap(file);
      const max = 2000;
      const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
      const cv = document.createElement('canvas');
      cv.width = Math.round(bmp.width * k);
      cv.height = Math.round(bmp.height * k);
      cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
      const blob = await new Promise((r) => cv.toBlob(r, 'image/jpeg', 0.82));
      if (!blob || blob.size >= file.size) return file;
      return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
    } catch { return file; }
  }

  const extension = (f) => (esPDF(f.type) ? 'pdf' : (f.type.split('/')[1] || 'bin').replace('jpeg', 'jpg'));

  fG.addEventListener('submit', async (e) => {
    e.preventDefault();
    const E = S.edit;
    const monto = Number(digitos(fG.monto.value));
    if (!monto) { toast('Ingresa un monto', true); fG.monto.focus(); return; }
    if (!E.catId) { toast('Elige una categoría', true); return; }
    const fila = {
      fecha: fG.fecha.value,
      monto,
      categoria_id: E.catId,
      proveedor: fG.proveedor.value.trim() || null,
      metodo_pago: fG.metodo_pago.value || null,
      descripcion: fG.descripcion.value.trim() || null,
    };
    // Solo se envía "items" si hay productos (o había): así la app sigue funcionando
    // aunque aún no se haya ejecutado la migración 002_productos.sql.
    const items = itemsLimpios(E.items);
    if (items.length || E.teniaItems) fila.items = items;
    const eraEdicion = !!E.id;
    const btn = $('#btn-guardar');
    btn.disabled = true;
    loading(true);
    try {
      let id = E.id;
      if (id) {
        const { error } = await sb.from('gastos').update(fila).eq('id', id);
        if (error) throw error;
      } else {
        const { data, error } = await sb.from('gastos').insert(fila).select('id').single();
        if (error) throw error;
        id = data.id;
        E.id = id; // si falla una subida, reintentar no duplica el gasto
      }

      // Subir nuevas facturas
      for (const n of [...E.nuevos]) {
        const ruta = `${S.user.id}/${id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension(n.file)}`;
        const up = await sb.storage.from(CFG.BUCKET).upload(ruta, n.file, { contentType: n.file.type, upsert: false });
        if (up.error) throw up.error;
        const ins = await sb.from('adjuntos').insert({ gasto_id: id, ruta, nombre: n.file.name, tipo: n.file.type, tamano: n.file.size });
        if (ins.error) throw ins.error;
        URL.revokeObjectURL(n.preview);
        E.nuevos = E.nuevos.filter((x) => x !== n);
      }

      // Borrar facturas quitadas
      if (E.borrar.length) {
        const quitar = E.existentes.filter((a) => E.borrar.includes(a.id));
        const r = await sb.storage.from(CFG.BUCKET).remove(quitar.map((a) => a.ruta));
        if (r.error) throw r.error;
        const d = await sb.from('adjuntos').delete().in('id', E.borrar);
        if (d.error) throw d.error;
      }

      store.set('ultimaCat', String(E.catId));
      if (fila.metodo_pago) store.set('ultimoPago', fila.metodo_pago);
      await cargarGastos();
      $('#dlg-gasto').close();
      toast(eraEdicion ? 'Gasto actualizado' : 'Gasto guardado');
      refrescar();
    } catch (err) {
      if (/items/.test(err?.message || '') && /PGRST204|42703/.test(err?.code || '')) {
        toast('Para guardar productos falta actualizar la base de datos: ejecuta supabase/migraciones/002_productos.sql en el SQL Editor de Supabase.', true);
      } else fallo(err, 'No se pudo guardar');
      try { await cargarGastos(); } catch { /* ignorar */ }
    }
    btn.disabled = false;
    loading(false);
  });

  // ---------- Vista: Ajustes ----------
  function renderAjustes() {
    const conteo = new Map();
    S.gastos.forEach((g) => conteo.set(g.categoria_id, (conteo.get(g.categoria_id) || 0) + 1));
    $('#lista-cats').innerHTML = S.cats.map((c) => `
      <li class="item" data-cat-id="${c.id}">
        <span class="item-ico" style="background:${esc(c.color)}22">${esc(c.icono)}</span>
        <div class="item-main"><div class="item-title">${esc(c.nombre)}</div><div class="item-sub">${conteo.get(c.id) || 0} gastos</div></div>
        <span style="width:14px;height:14px;border-radius:50%;background:${esc(c.color)}"></span>
      </li>`).join('');
    if (!$('#exp-mes').value) $('#exp-mes').value = ym(new Date());
  }

  $('#lista-cats').addEventListener('click', (e) => {
    const li = e.target.closest('[data-cat-id]');
    if (li) abrirCategoria(S.cats.find((c) => c.id === Number(li.dataset.catId)));
  });
  $('#cat-add').addEventListener('click', () => abrirCategoria(null));

  const fC = $('#form-cat');
  function abrirCategoria(c) {
    S.catEdit = c;
    $('#cat-title').textContent = c ? 'Editar categoría' : 'Nueva categoría';
    fC.nombre.value = c?.nombre || '';
    fC.icono.value = c?.icono || '🏷️';
    fC.color.value = c?.color || '#0f766e';
    $('#cat-borrar').hidden = !c;
    $('#dlg-cat').showModal();
  }

  fC.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fila = { nombre: fC.nombre.value.trim(), icono: fC.icono.value.trim() || '🏷️', color: fC.color.value };
    if (!fila.nombre) return;
    loading(true);
    try {
      const q = S.catEdit ? sb.from('categorias').update(fila).eq('id', S.catEdit.id) : sb.from('categorias').insert(fila);
      const { error } = await q;
      if (error) throw error.code === '23505' ? new Error('Ya existe una categoría con ese nombre') : error;
      await cargarCategorias();
      $('#dlg-cat').close();
      toast('Categoría guardada');
      refrescar();
    } catch (err) { fallo(err, 'No se pudo guardar'); }
    loading(false);
  });

  $('#cat-borrar').addEventListener('click', async () => {
    const c = S.catEdit;
    const n = S.gastos.filter((g) => g.categoria_id === c.id).length;
    if (!confirm(`¿Eliminar la categoría "${c.nombre}"?${n ? ` Sus ${n} gastos quedarán "Sin categoría".` : ''}`)) return;
    loading(true);
    try {
      const { error } = await sb.from('categorias').delete().eq('id', c.id);
      if (error) throw error;
      S.gastos.forEach((g) => { if (g.categoria_id === c.id) g.categoria_id = null; });
      await cargarCategorias();
      $('#dlg-cat').close();
      toast('Categoría eliminada');
      refrescar();
    } catch (err) { fallo(err, 'No se pudo eliminar'); }
    loading(false);
  });

  // ---------- Exportar ----------
  function gastosExport() {
    const todo = $('#exp-todo').checked;
    const mes = $('#exp-mes').value;
    const lista = S.gastos.filter((g) => todo || !mes || g.fecha.startsWith(mes)).slice().sort((a, b) => a.fecha.localeCompare(b.fecha) || a.id - b.id);
    return { nombre: `gastos_${todo || !mes ? 'historial' : mes}`, lista };
  }

  const slug = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'gasto';
  /** Ruta del archivo dentro del ZIP: facturas/2026-11/2026-11-14_Exito_123_1.jpg */
  function rutaEnZip(g, a, j) {
    const ext = (a.ruta.split('.').pop() || 'bin').toLowerCase();
    const n = g.adjuntos.length;
    return `facturas/${g.fecha.slice(0, 7)}/${g.fecha}_${slug(g.proveedor || catDe(g.categoria_id).nombre)}_${g.id}${n > 1 ? `_${j + 1}` : ''}.${ext}`;
  }

  const textoProductos = (g) => itemsDe(g).map((it) => `${it.descripcion}${Number(it.cantidad) !== 1 ? ` x${it.cantidad}` : ''} ${fmt(it.valor)}`).join('; ');

  /** enlaces(g) -> [{ texto, url }] por cada factura del gasto */
  function construirLibro(lista, enlaces) {
    const maxFac = Math.max(1, ...lista.map((g) => g.adjuntos?.length || 0));
    const cab = ['Fecha', 'Categoría', 'Proveedor', 'Descripción', 'Método de pago', 'Monto', 'Productos',
      ...Array.from({ length: maxFac }, (_, i) => `Factura ${i + 1}`)];
    const MONEDA = '"$"#,##0';
    const filas = lista.map((g) => {
      const fac = enlaces(g).map((e) => ({ t: 's', v: e.texto, l: { Target: e.url, Tooltip: 'Abrir factura' } }));
      return [g.fecha, catDe(g.categoria_id).nombre, g.proveedor || '', g.descripcion || '', g.metodo_pago || '',
        { t: 'n', v: g.monto, z: MONEDA }, itemsDe(g).length || '', ...fac];
    });
    const ws = XLSX.utils.aoa_to_sheet([cab, ...filas,
      ['', '', '', '', 'TOTAL', { t: 'n', f: `SUM(F2:F${filas.length + 1})`, z: MONEDA }]]);
    ws['!cols'] = [{ wch: 11 }, { wch: 15 }, { wch: 24 }, { wch: 32 }, { wch: 14 }, { wch: 13 }, { wch: 10 }, ...Array(maxFac).fill({ wch: 34 })];
    ws['!autofilter'] = { ref: `A1:${XLSX.utils.encode_col(cab.length - 1)}${filas.length + 1}` };

    const prods = lista.flatMap((g) => itemsDe(g).map((it) => [g.fecha, g.proveedor || '', catDe(g.categoria_id).nombre, it.descripcion,
      { t: 'n', v: Number(it.cantidad) || 1 }, { t: 'n', v: Number(it.valor) || 0, z: MONEDA }]));
    const wsP = XLSX.utils.aoa_to_sheet([['Fecha', 'Proveedor', 'Categoría', 'Producto', 'Cantidad', 'Valor'], ...prods,
      ...(prods.length ? [['', '', '', 'TOTAL', '', { t: 'n', f: `SUM(F2:F${prods.length + 1})`, z: MONEDA }]] : [])]);
    wsP['!cols'] = [{ wch: 11 }, { wch: 24 }, { wch: 15 }, { wch: 36 }, { wch: 9 }, { wch: 13 }];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Gastos');
    XLSX.utils.book_append_sheet(wb, wsP, 'Productos');
    return wb;
  }

  const SIETE_DIAS = 7 * 24 * 3600;
  /** Enlaces firmados de larga duración (para Excel/CSV sin ZIP). */
  async function enlacesTemporales(lista) {
    const rutas = lista.flatMap((g) => (g.adjuntos || []).map((a) => a.ruta));
    const mapa = {};
    for (let i = 0; i < rutas.length; i += 100) {
      const { data, error } = await sb.storage.from(CFG.BUCKET).createSignedUrls(rutas.slice(i, i + 100), SIETE_DIAS);
      if (error) throw error;
      data.forEach((d) => { if (d.signedUrl) mapa[d.path] = d.signedUrl; });
    }
    return (g) => (g.adjuntos || []).map((a) => ({ texto: a.nombre || 'Ver factura', url: mapa[a.ruta] })).filter((e) => e.url);
  }

  function progresoExport(msg) {
    const p = $('#exp-progreso');
    p.hidden = !msg;
    p.textContent = msg || '';
  }

  function descargar(blob, nombre) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = nombre;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  $('#exp-csv').addEventListener('click', async () => {
    const { nombre, lista } = gastosExport();
    if (!lista.length) return toast('No hay gastos para exportar', true);
    loading(true);
    try {
      const enlaces = await enlacesTemporales(lista);
      const maxFac = Math.max(0, ...lista.map((g) => g.adjuntos?.length || 0));
      const cab = ['Fecha', 'Categoría', 'Proveedor', 'Descripción', 'Método de pago', 'Monto', 'Productos',
        ...Array.from({ length: maxFac }, (_, i) => `Factura ${i + 1} (enlace 7 días)`)];
      const celda = (v) => (/[";\n\r]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v);
      const filas = lista.map((g) => [g.fecha, catDe(g.categoria_id).nombre, g.proveedor || '', g.descripcion || '', g.metodo_pago || '',
        g.monto, textoProductos(g), ...enlaces(g).map((e) => e.url)]);
      // Separador ";" para que Excel en español (Colombia) lo abra en columnas.
      const csv = [cab, ...filas].map((f) => f.map(celda).join(';')).join('\r\n');
      descargar(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }), `${nombre}.csv`);
    } catch (err) { fallo(err, 'No se pudo exportar'); }
    loading(false);
  });

  const cargarXLSX = () => LectorFacturas.cargar('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js');
  const cargarZip = () => LectorFacturas.cargar('https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js');

  $('#exp-xlsx').addEventListener('click', async () => {
    const { nombre, lista } = gastosExport();
    if (!lista.length) return toast('No hay gastos para exportar', true);
    loading(true);
    try {
      await cargarXLSX();
      const wb = construirLibro(lista, await enlacesTemporales(lista));
      XLSX.writeFile(wb, `${nombre}.xlsx`);
    } catch (err) { fallo(err, 'No se pudo exportar'); }
    loading(false);
  });

  $('#exp-zip').addEventListener('click', async () => {
    const { nombre, lista } = gastosExport();
    if (!lista.length) return toast('No hay gastos para exportar', true);
    const btn = $('#exp-zip');
    btn.disabled = true;
    try {
      progresoExport('Preparando…');
      await Promise.all([cargarXLSX(), cargarZip()]);
      const zip = new JSZip();
      const tareas = lista.flatMap((g) => (g.adjuntos || []).map((a, j) => ({ g, a, ruta: rutaEnZip(g, a, j) })));
      const fallidos = [];
      let hechos = 0;
      // Descarga en paralelo (4 a la vez)
      const cola = [...tareas];
      await Promise.all(Array.from({ length: Math.min(4, cola.length) }, async () => {
        while (cola.length) {
          const t = cola.shift();
          const { data, error } = await sb.storage.from(CFG.BUCKET).download(t.a.ruta);
          if (error || !data) fallidos.push(t); else zip.file(t.ruta, data);
          progresoExport(`Descargando facturas… ${++hechos} de ${tareas.length}`);
        }
      }));
      const okRutas = new Map(tareas.filter((t) => !fallidos.includes(t)).map((t) => [t.a.id, t.ruta]));
      const wb = construirLibro(lista, (g) => (g.adjuntos || []).filter((a) => okRutas.has(a.id))
        .map((a) => ({ texto: okRutas.get(a.id).split('/').pop(), url: okRutas.get(a.id) })));
      zip.file(`${nombre}.xlsx`, XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
      zip.file('LEEME.txt', [
        'Exportación de Mis Gastos',
        `Generado: ${new Date().toLocaleString('es-CO')}`,
        `Gastos: ${lista.length} · Total: ${fmt(suma(lista))} · Facturas: ${okRutas.size}`,
        '',
        `1. Descomprime TODO el .zip en una carpeta (no lo abras desde dentro del .zip).`,
        `2. Abre ${nombre}.xlsx: en la hoja "Gastos", las columnas "Factura N" son vínculos que abren cada archivo.`,
        '3. La hoja "Productos" tiene el detalle de lo comprado en cada gasto.',
        ...(fallidos.length ? ['', `Atención: no se pudieron descargar ${fallidos.length} factura(s).`] : []),
      ].join('\r\n'));
      progresoExport('Comprimiendo…');
      const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
      descargar(blob, `${nombre}.zip`);
      progresoExport(fallidos.length ? `Listo, pero ${fallidos.length} factura(s) no se pudieron descargar.` : `Listo: ${lista.length} gastos y ${okRutas.size} facturas.`);
      setTimeout(() => progresoExport(null), 6000);
    } catch (err) {
      progresoExport(null);
      fallo(err, 'No se pudo exportar');
    }
    btn.disabled = false;
  });

  // ---------- Diálogos ----------
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-close]');
    if (b) b.closest('dialog').close();
  });
  // Cerrar tocando fuera del contenido
  $$('dialog').forEach((d) => d.addEventListener('click', (e) => { if (e.target === d) d.close(); }));
  $('#dlg-gasto').addEventListener('close', () => {
    S.edit?.nuevos.forEach((n) => n.preview && URL.revokeObjectURL(n.preview));
  });

  // ---------- PWA ----------
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* opcional */ });
  }

  iniciar().catch((e) => { fallo(e, 'Error al iniciar'); mostrarLogin(); });
})();
