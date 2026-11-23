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

  // ---------- Dólares y TRM ----------
  const fmt2 = new Intl.NumberFormat('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtUSD = (n) => `US$ ${fmt2.format(Number(n) || 0)}`;
  const fmtTRM = (n) => `$ ${fmt2.format(Number(n) || 0)}`;
  /** "1.234,56" | "1,234.56" | "12.5" | "12,50" | "1.234" -> número (con decimales) */
  function aDecimal(txt) {
    let s = String(txt || '').replace(/[^\d.,]/g, '');
    if (!s) return 0;
    const ultimo = Math.max(s.lastIndexOf('.'), s.lastIndexOf(','));
    if (ultimo >= 0) {
      const sep = s[ultimo];
      const otros = s.split(sep).length - 1;
      const tras = s.length - ultimo - 1;
      // Es decimal si hay ambos separadores, o si aparece una sola vez con 1–2 dígitos (o hasta 4 en una tasa) detrás.
      const ambos = s.includes('.') && s.includes(',');
      const esDecimal = ambos || (otros === 1 && tras !== 3) || (otros === 1 && tras === 3 && /^0[.,]/.test(s));
      s = esDecimal ? `${s.slice(0, ultimo).replace(/[.,]/g, '')}.${s.slice(ultimo + 1)}` : s.replace(/[.,]/g, '');
    }
    const n = Number(s);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  /**
   * TRM (pesos por dólar) vigente en una fecha "AAAA-MM-DD".
   * 1) TRM oficial publicada en datos.gov.co (Superintendencia Financiera).
   * 2) Respaldo: tasa de mercado diaria del paquete abierto currency-api.
   * @returns {Promise<{valor:number, desde:string, fuente:string}>}
   */
  async function obtenerTRM(fecha) {
    const clave = `trm:${fecha}`;
    const guardada = store.get(clave);
    if (guardada) { try { return JSON.parse(guardada); } catch { /* recalcular */ } }
    const conTiempo = async (url) => {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 9000);
      try {
        const r = await fetch(url, { signal: ctl.signal, cache: 'no-store' });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return await r.json();
      } finally { clearTimeout(t); }
    };
    let res = null;
    try {
      const q = new URLSearchParams({
        $select: 'valor,vigenciadesde',
        $where: `vigenciadesde <= '${fecha}T00:00:00'`,
        $order: 'vigenciadesde DESC',
        $limit: '1',
      });
      const [d] = await conTiempo(`https://www.datos.gov.co/resource/32sa-8pi3.json?${q}`);
      if (d && Number(d.valor) > 0) res = { valor: Number(d.valor), desde: d.vigenciadesde.slice(0, 10), fuente: 'TRM oficial' };
    } catch (e) { console.warn('TRM oficial', e); }
    if (!res) {
      for (const url of [
        `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${fecha}/v1/currencies/usd.min.json`,
        `https://${fecha}.currency-api.pages.dev/v1/currencies/usd.min.json`,
      ]) {
        try {
          const d = await conTiempo(url);
          if (d?.usd?.cop > 0) { res = { valor: Math.round(d.usd.cop * 100) / 100, desde: d.date || fecha, fuente: 'tasa de mercado (aprox.)' }; break; }
        } catch (e) { console.warn('Tasa de respaldo', e); }
      }
    }
    if (!res) throw new Error('sin conexión con las fuentes de la TRM');
    // Solo se guarda si es la oficial de ese mismo día o de una fecha pasada (ya no cambia).
    if (res.fuente === 'TRM oficial' && fecha < ymd(new Date())) store.set(clave, JSON.stringify(res));
    return res;
  }

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
      await cargarHistorial();
    } catch (e) { fallo(e, 'No se pudieron cargar los datos'); }
    loading(false);
    ruta();
    setTimeout(chequearLimite, 1200); // ¿la nube está por llenarse? propone respaldo + limpieza
  }

  $('#logout').addEventListener('click', async () => {
    await sb.auth.signOut();
    S.gastos = []; S.pendientes = []; S.cats = []; S.urls.clear();
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

  // S.v3: la base ya tiene la migración 003 (n.º factura, NIT, CUFE y huella de archivos).
  S.v3 = true;
  let avisoMigracion = false;
  async function cargarGastos() {
    const todos = [];
    const paso = 1000;
    for (let desde = 0; ; desde += paso) {
      const { data, error } = await sb.from('gastos')
        .select(`*, adjuntos(id, ruta, nombre, tipo, tamano${S.v3 ? ', hash' : ''})`)
        .order('fecha', { ascending: false })
        .order('id', { ascending: false })
        .range(desde, desde + paso - 1);
      if (error && S.v3 && /42703|PGRST/.test(error.code || '') && /hash/.test(error.message || '')) {
        S.v3 = false;
        if (!avisoMigracion) { avisoMigracion = true; setTimeout(() => toast('Para detectar facturas repetidas por archivo y n.º de factura, ejecuta supabase/migraciones/003_entretenimiento_y_repetidos.sql en Supabase.', true), 800); }
        return cargarGastos();
      }
      if (error) throw error;
      todos.push(...data);
      if (data.length < paso) break;
    }
    const lista = todos.map((g) => ({
      ...g,
      monto: Number(g.monto),
      monto_original: g.monto_original == null ? null : Number(g.monto_original),
      tasa_cambio: g.tasa_cambio == null ? null : Number(g.tasa_cambio),
    }));
    // Pendientes (factura adjunta, datos sin confirmar): aparte, no cuentan en totales ni exportaciones.
    S.pendientes = lista.filter((g) => g.estado === 'pendiente');
    S.gastos = lista.filter((g) => g.estado !== 'pendiente');
    // S.v5: la base ya tiene la migración 005 (moneda, monto original y TRM).
    if (S.v5 === undefined) {
      if (todos.length) S.v5 = 'moneda' in todos[0];
      else S.v5 = !(await sb.from('gastos').select('moneda').limit(1)).error;
    }
    // S.v6: migración 006 (pendientes y fuente de la lectura).
    if (S.v6 === undefined) {
      if (todos.length) S.v6 = 'estado' in todos[0];
      else S.v6 = !(await sb.from('gastos').select('estado').limit(1)).error;
    }
    calcularRepetidos();
  }

  // ---------- Facturas repetidas ----------
  const normTxt = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const normNum = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^0+/, '');
  const normNit = (s) => String(s || '').replace(/\D/g, '').slice(0, 9); // sin dígito de verificación
  /** N.º de factura del gasto (campo propio o, en gastos antiguos, dentro de la descripción "Factura X"). */
  const numeroDe = (g) => normNum(g.numero_factura || (/factura\s+(?:n[°ºo.]?\s*)?([A-Z0-9-]{3,})/i.exec(g.descripcion || '') || [])[1]);
  const nitDe = (g) => normNit(g.nit || (/NIT\s+([\d.]+)/i.exec(g.descripcion || '') || [])[1]);
  const firmaItems = (items) => (items || []).filter((i) => i.descripcion || i.valor)
    .map((i) => `${normTxt(i.descripcion)}|${Number(i.cantidad) || 1}|${Math.round(Number(i.valor) || 0)}`).sort().join(';');

  /**
   * Busca gastos ya registrados que parezcan la misma factura que `c`.
   * c: { id?, fecha, monto, proveedor, numero_factura, nit, cufe, items, hashes: [] }
   * Devuelve [{ g, motivos: [] }] ordenado por número de coincidencias.
   */
  const todosLosGastos = () => [...S.gastos, ...(S.pendientes || [])];
  function buscarRepetidos(c, lista = todosLosGastos()) {
    const num = normNum(c.numero_factura);
    const nit = normNit(c.nit);
    const prov = normTxt(c.proveedor);
    const fi = firmaItems(c.items);
    const hashes = new Set((c.hashes || []).filter(Boolean));
    const res = [];
    for (const g of lista) {
      if (g.id === c.id) continue;
      const m = [];
      if (c.cufe && g.cufe && c.cufe.toLowerCase() === g.cufe.toLowerCase()) m.push('mismo CUFE de factura electrónica');
      const gNum = numeroDe(g);
      if (num && gNum && num === gNum) {
        const gNit = nitDe(g);
        const mismoEmisor = (nit && gNit) ? nit === gNit : (!prov || !normTxt(g.proveedor) || prov === normTxt(g.proveedor));
        if (mismoEmisor) m.push('mismo n.º de factura');
      }
      if (hashes.size && (g.adjuntos || []).some((a) => a.hash && hashes.has(a.hash))) m.push('mismo archivo de factura');
      if (g.fecha === c.fecha && Math.round(g.monto) === Math.round(c.monto)) {
        const mismoProv = prov && prov === normTxt(g.proveedor);
        const mismosItems = fi && fi === firmaItems(g.items);
        if (mismoProv && mismosItems) m.push('misma fecha, monto, proveedor y productos');
        else if (mismoProv) m.push('misma fecha, monto y proveedor');
        else if (mismosItems) m.push('misma fecha, monto y productos');
      }
      if (m.length) res.push({ g, motivos: m });
    }
    return res.sort((a, b) => b.motivos.length - a.motivos.length || b.g.id - a.g.id);
  }

  /** Marca en S.repetidos (id -> [{g, motivos}]) los gastos ya guardados que se repiten entre sí. */
  function calcularRepetidos() {
    S.repetidos = new Map();
    for (const g of S.gastos) {
      const r = buscarRepetidos({ ...g, hashes: (g.adjuntos || []).map((a) => a.hash) });
      if (r.length) S.repetidos.set(g.id, r);
    }
  }

  const resumenGasto = (g) => `${g.proveedor || catDe(g.categoria_id).nombre} · ${fechaCorta(g.fecha)} · ${fmt(g.monto)}${numeroDe(g) ? ` · Fact. ${g.numero_factura || numeroDe(g)}` : ''}`;

  /** HTML del aviso con enlaces "Ver" a cada gasto ya registrado. */
  function avisoRepetidoHTML(lista, titulo = '⚠️ Factura posiblemente ya registrada') {
    return `<div class="aviso-rep"><b>${esc(titulo)}</b>
      <ul>${lista.slice(0, 5).map(({ g, motivos }) => `<li>
        <button type="button" class="link-btn" data-ver-gasto="${g.id}">${esc(resumenGasto(g))}</button>
        <small>${esc(motivos.join(' · '))}</small></li>`).join('')}</ul></div>`;
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
        <div class="item-main"><div class="item-title">${esc(titulo)}</div><div class="item-sub">${S.repetidos?.has(g.id) ? '<span class="badge-rep">⚠️ repetido</span> ' : ''}${esc(sub)}</div></div>
        <div class="item-amount">${fmt(g.monto)}${g.moneda === 'USD' && g.monto_original ? `<span class="monto-usd">${fmtUSD(g.monto_original)}</span>` : ''}<small>${nAdj ? `📎 ${nAdj}` : g.archivado_en ? '📦 archivada' : 'sin factura'}</small></div>
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
    const nP = S.pendientes?.length || 0;
    $('#inicio-pend').hidden = !nP;
    $('#inicio-pend').textContent = `⏳ ${nP} gasto${nP === 1 ? '' : 's'} pendiente${nP === 1 ? '' : 's'} por confirmar`;
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
    $('#st-sinfac').textContent = actual.filter((g) => !g.adjuntos?.length && !g.archivado_en).length;

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

  // ---------- Pendientes por confirmar ----------
  function renderPendientes() {
    const P = (S.pendientes || []).slice().sort((a, b) => b.id - a.id);
    $('#card-pend').hidden = !P.length;
    $('#pend-n').textContent = P.length ? String(P.length) : '';
    $('#lista-pend').innerHTML = P.map((g) => {
      const c = g.categoria_id ? catDe(g.categoria_id) : null;
      const nAdj = g.adjuntos?.length || 0;
      const sub = [fechaCorta(g.fecha), c?.nombre, g.lectura && (/\bIA\b/.test(g.lectura) ? '✨ IA' : g.lectura)].filter(Boolean).join(' · ');
      return `<li class="item" data-pend="${g.id}">
        <span class="item-ico" style="background:${esc(c?.color || '#94a3b8')}22">${esc(c?.icono || '🧾')}</span>
        <div class="item-main"><div class="item-title">${esc(g.proveedor || g.descripcion || 'Factura sin datos')}</div>
          <div class="item-sub"><span class="badge-pend">⏳ por confirmar</span> ${esc(sub)}</div></div>
        <div class="item-amount">${g.monto ? fmt(g.monto) : '—'}${g.moneda === 'USD' && g.monto_original ? `<span class="monto-usd">${fmtUSD(g.monto_original)}</span>` : ''}<small>${nAdj ? `📎 ${nAdj}` : 'sin factura'}</small></div>
      </li>`;
    }).join('');
  }
  $('#lista-pend').addEventListener('click', (e) => {
    const li = e.target.closest('[data-pend]');
    const g = li && S.pendientes.find((x) => x.id === Number(li.dataset.pend));
    if (g) abrirFormulario(g);
  });

  function renderLista() {
    renderPendientes();
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
    // Enlace "ver gasto ya registrado" de los avisos de repetido
    const ver = e.target.closest('[data-ver-gasto]');
    if (ver) {
      e.preventDefault();
      // Si viene del formulario, el detalle se abre encima; al cerrarlo se vuelve al aviso/formulario.
      abrirDetalle(Number(ver.dataset.verGasto), { soloVer: $('#dlg-gasto').open });
    }
  });

  // ---------- Detalle ----------
  /** soloVer: se abre desde el formulario (aviso de repetido); oculta Editar/Eliminar para no perder lo que se está escribiendo. */
  async function abrirDetalle(id, { soloVer = false } = {}) {
    const g = todosLosGastos().find((x) => x.id === id);
    if (!g) return;
    // Un pendiente se abre directo en el formulario para confirmar sus datos.
    if (g.estado === 'pendiente' && !soloVer) { abrirFormulario(g); return; }
    S.detalle = g;
    const c = catDe(g.categoria_id);
    const adj = g.adjuntos || [];
    const rep = S.repetidos?.get(g.id) || [];
    $('#det-editar').hidden = $('#det-borrar').hidden = soloVer;
    $('#detalle-body').innerHTML = `
      ${soloVer ? '<p class="muted small">Gasto ya registrado (solo lectura). Cierra para volver al formulario.</p>' : ''}
      ${rep.length ? avisoRepetidoHTML(rep, '⚠️ Este gasto parece repetido de:') : ''}
      <div class="det-monto">${fmt(g.monto)}</div>
      ${g.moneda === 'USD' && g.monto_original ? `<p class="det-conv">💵 ${fmtUSD(g.monto_original)} × TRM ${fmtTRM(g.tasa_cambio)}</p>` : ''}
      <dl class="det-rows">
        <dt>Categoría</dt><dd>${esc(c.icono)} ${esc(c.nombre)}</dd>
        <dt>Fecha</dt><dd>${esc(fechaLarga(g.fecha))}</dd>
        ${g.proveedor ? `<dt>Proveedor</dt><dd>${esc(g.proveedor)}</dd>` : ''}
        ${g.numero_factura ? `<dt>N.º factura</dt><dd>${esc(g.numero_factura)}</dd>` : ''}
        ${g.nit ? `<dt>NIT</dt><dd>${esc(g.nit)}</dd>` : ''}
        ${g.metodo_pago ? `<dt>Pago</dt><dd>${esc(g.metodo_pago)}</dd>` : ''}
        ${g.archivado_en ? `<dt>Factura</dt><dd>📦 En tu respaldo local<br><small>${esc(g.archivo_respaldo || '')} · ${esc(new Date(g.archivado_en).toLocaleDateString('es-CO'))}</small></dd>` : ''}
        ${g.descripcion ? `<dt>Descripción</dt><dd>${esc(g.descripcion)}</dd>` : ''}
        ${g.lectura ? `<dt>Leída con</dt><dd>${/\bIA\b/.test(g.lectura) ? '<span class="lectura-ia">✨ ' + esc(g.lectura) + '</span>' : esc(g.lectura)}</dd>` : ''}
      </dl>
      ${itemsDe(g).length ? `<details class="prods det-prods"><summary><span>🛒 Productos</span><span class="muted">${itemsDe(g).length}</span></summary><div class="prods-body">${prodsHTML(itemsDe(g))}</div></details>` : ''}
      <div class="field">
        <span class="field-label">Facturas (${adj.length}) — toca para ver</span>
        <div class="adj-grid" id="det-adj">${adj.length ? adj.map(() => '<div class="adj"><div class="spinner"></div></div>').join('') : '<p class="muted">Sin facturas adjuntas.</p>'}</div>
      </div>`;
    if (!$('#dlg-detalle').open) $('#dlg-detalle').showModal();
    $('#dlg-detalle .sheet-body').scrollTo?.(0, 0);
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
          <span class="adj-badge">PDF</span>${a.nota ? `<span class="adj-ahorro">${esc(a.nota)}</span>` : ""}${del}</div>`;
      }
      const verImg = a.src && !/hei[cf]/i.test(a.tipo || '');
      return `<div class="adj" data-gal="${i}" title="${esc(a.nombre || 'Imagen')}">
        ${verImg ? `<img src="${esc(a.src)}" alt="${esc(a.nombre || 'Factura')}" loading="lazy">` : `<div class="adj-pdf"><b>🖼️</b>${esc(a.nombre || 'Imagen')}</div>`}${a.nota ? `<span class="adj-ahorro">${esc(a.nota)}</span>` : ''}${del}</div>`;
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

  $('#det-borrar').addEventListener('click', () => eliminarGasto(S.detalle));

  async function eliminarGasto(g) {
    const que = g?.estado === 'pendiente' ? `este gasto pendiente${g.proveedor ? ` de ${g.proveedor}` : ''}` : `este gasto de ${fmt(g?.monto)}`;
    if (!g || !confirm(`¿Eliminar ${que} y sus ${g.adjuntos?.length || 0} factura(s)? No se puede deshacer.`)) return;
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
      S.pendientes = (S.pendientes || []).filter((x) => x.id !== g.id);
      calcularRepetidos();
      if ($('#dlg-detalle').open) $('#dlg-detalle').close();
      if ($('#dlg-gasto').open && S.edit?.id === g.id) { S.edit.guardado = true; $('#dlg-gasto').close(); }
      toast('Gasto eliminado');
      refrescar();
    } catch (e) { fallo(e, 'No se pudo eliminar'); }
    loading(false);
  }

  // ---------- Formulario de gasto ----------
  const fG = $('#form-gasto');
  fG.metodo_pago.innerHTML = '<option value="">—</option>' + CFG.METODOS_PAGO.map((m) => `<option>${esc(m)}</option>`).join('');

  fG.monto.addEventListener('input', () => {
    if (S.edit?.moneda === 'USD') {
      // Mientras se escribe solo se limpia; al salir del campo se le da formato.
      const s = fG.monto.value.replace(/[^\d.,]/g, '').slice(0, 14);
      fG.monto.value = s ? `US$ ${s}` : '';
    } else {
      const d = digitos(fG.monto.value).slice(0, 13);
      fG.monto.value = d ? `$ ${fmtNum.format(Number(d))}` : '';
    }
    pintarConversion();
  });
  fG.monto.addEventListener('blur', () => {
    if (S.edit?.moneda === 'USD' && aDecimal(fG.monto.value)) fG.monto.value = fmtUSD(aDecimal(fG.monto.value));
  });

  // ---------- Moneda (COP / USD) ----------
  /** Monto en la moneda elegida (USD con decimales). */
  const montoOriginal = () => (S.edit?.moneda === 'USD' ? Math.round(aDecimal(fG.monto.value) * 100) / 100 : Number(digitos(fG.monto.value)));
  /** Monto en pesos: lo que se guarda en "monto" y suma en todos los totales. */
  const montoCOP = () => (S.edit?.moneda === 'USD' ? (S.edit.tasa ? Math.round(montoOriginal() * S.edit.tasa) : 0) : montoOriginal());

  function setMoneda(m) {
    const E = S.edit;
    if (!E || E.moneda === m) return;
    const antes = montoOriginal();
    E.moneda = m;
    const usd = m === 'USD';
    $$('#seg-moneda button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.moneda === m)));
    $('#monto-label').textContent = usd ? 'Monto (USD)' : 'Monto (COP)';
    fG.monto.placeholder = usd ? 'US$ 0,00' : '$ 0';
    fG.monto.inputMode = usd ? 'decimal' : 'numeric';
    // Se conserva la cifra escrita, reinterpretada en la nueva moneda.
    fG.monto.value = !antes ? '' : usd ? fmtUSD(antes) : `$ ${fmtNum.format(Math.round(antes))}`;
    $('#conversion').hidden = !usd;
    if (usd) actualizarTRM(); else pintarConversion();
  }

  function pintarConversion() {
    const E = S.edit;
    if (E?.moneda === 'USD') {
      const usd = montoOriginal();
      $('#conv-total').innerHTML = !E.tasa ? (E.buscandoTRM ? 'Buscando la TRM…' : 'Escribe la TRM para convertir')
        : usd ? `≈ ${fmt(montoCOP())} <small>COP</small>` : 'Escribe el monto en dólares';
      $('#conv-fecha').textContent = fG.fecha.value ? fechaCorta(fG.fecha.value) + ' ' + fG.fecha.value.slice(0, 4) : '';
    }
    actualizarSumaProds();
    comprobarLuego();
  }

  let turnoTRM = 0;
  async function actualizarTRM() {
    const E = S.edit;
    if (!E || E.moneda !== 'USD' || E.tasaManual || !fG.fecha.value) { pintarConversion(); return; }
    const turno = ++turnoTRM;
    const fecha = fG.fecha.value;
    E.buscandoTRM = true;
    E.tasa = null;
    fG.tasa.value = '';
    $('#conversion').classList.remove('err');
    $('#conv-nota').textContent = '';
    pintarConversion();
    try {
      const t = await obtenerTRM(fecha);
      if (turno !== turnoTRM || S.edit !== E || E.tasaManual) return;
      E.tasa = t.valor;
      fG.tasa.value = fmt2.format(t.valor);
      $('#conv-nota').textContent = `${t.fuente}${t.desde !== fecha ? ` · vigente desde el ${fechaCorta(t.desde)}` : ''}. Si tu banco usó otra tasa, puedes cambiarla.`;
    } catch (e) {
      if (turno !== turnoTRM || S.edit !== E) return;
      $('#conversion').classList.add('err');
      $('#conv-nota').textContent = `No pude consultar la TRM (${e.message || e}). Escríbela a mano.`;
    } finally {
      if (turno === turnoTRM && S.edit === E) { E.buscandoTRM = false; pintarConversion(); }
    }
  }

  $('#seg-moneda').addEventListener('click', (e) => {
    const b = e.target.closest('[data-moneda]');
    if (!b || !S.edit) return;
    S.edit.tocado.add('moneda');
    setMoneda(b.dataset.moneda);
  });
  fG.fecha.addEventListener('change', () => { if (S.edit?.moneda === 'USD') { S.edit.tasaManual = false; actualizarTRM(); } });
  fG.tasa.addEventListener('input', () => {
    const E = S.edit;
    if (!E) return;
    fG.tasa.value = fG.tasa.value.replace(/[^\d.,]/g, '').slice(0, 12);
    E.tasa = aDecimal(fG.tasa.value) || null;
    E.tasaManual = !!fG.tasa.value;
    $('#conversion').classList.remove('err');
    $('#conv-nota').textContent = E.tasaManual ? 'Tasa escrita a mano. Bórrala para volver a la TRM oficial.' : '';
    if (!E.tasaManual) actualizarTRM(); else pintarConversion();
  });
  fG.tasa.addEventListener('blur', () => { if (S.edit?.tasa) fG.tasa.value = fmt2.format(S.edit.tasa); });

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
      cufe: g?.cufe || null,
      repetidoAceptado: null, // ids de repetidos que el usuario decidió guardar igual
      moneda: 'COP',
      // Al editar un gasto en dólares se respeta la tasa guardada hasta que cambie la fecha.
      tasa: g?.moneda === 'USD' ? g.tasa_cambio : null,
      tasaManual: false,
      buscandoTRM: false,
      pendiente: g?.estado === 'pendiente', // se abre para confirmar sus datos
      lectura: g?.lectura || null, // con qué se leyó la factura (QR, PDF, OCR, IA)
    };
    $('#form-prods').open = false;
    renderProds();
    $$('.auto', fG).forEach((el) => el.classList.remove('auto'));
    banner(null);
    if (!S.cats.some((c) => c.id === S.edit.catId)) S.edit.catId = g ? null : S.cats[0]?.id ?? null;
    $('#form-title').textContent = !g ? 'Nuevo gasto' : S.edit.pendiente ? 'Confirmar gasto pendiente' : 'Editar gasto';
    $('#btn-pendiente').hidden = !(S.v6 && (!g?.id || S.edit.pendiente));
    $('#btn-guardar').textContent = S.edit.pendiente ? '✓ Confirmar' : 'Guardar';
    $('#btn-descartar').hidden = !S.edit.pendiente;
    // Con más botones, "Cancelar" sobra: la hoja ya tiene ✕ para cerrar.
    $('#btn-cancelar').hidden = !$('#btn-pendiente').hidden;
    fG.fecha.value = g?.fecha || ymd(new Date());
    // Moneda: se arranca en COP y, si el gasto es en dólares, se pasa a USD con su tasa.
    S.edit.moneda = null;
    fG.monto.value = '';
    const enUSD = g?.moneda === 'USD';
    if (enUSD) S.edit.tasaManual = !!g.tasa_cambio; // no consultar: ya tiene tasa
    setMoneda(enUSD ? 'USD' : 'COP');
    fG.monto.value = enUSD ? (g.monto_original ? fmtUSD(g.monto_original) : '') : g?.monto ? `$ ${fmtNum.format(g.monto)}` : '';
    if (enUSD) {
      S.edit.tasaManual = false;
      fG.tasa.value = S.edit.tasa ? fmt2.format(S.edit.tasa) : '';
      $('#conv-nota').textContent = S.edit.tasa ? 'Tasa guardada con este gasto. Si cambias la fecha se vuelve a consultar.' : '';
      if (!S.edit.tasa) actualizarTRM();
    } else $('#conv-nota').textContent = '';
    $('#conversion').classList.remove('err');
    pintarConversion();
    fG.metodo_pago.value = g?.metodo_pago || store.get('ultimoPago') || '';
    fG.proveedor.value = g?.proveedor || '';
    fG.descripcion.value = g?.descripcion || '';
    fG.numero_factura.value = g?.numero_factura || '';
    fG.nit.value = g?.nit || '';
    $('#proveedores').innerHTML = [...new Set(S.gastos.map((x) => x.proveedor).filter(Boolean))].slice(0, 200).map((p) => `<option value="${esc(p)}">`).join('');
    renderChips();
    actualizarSumaProds();
    renderAdjForm();
    comprobarRepetidoEnForm();
    $('#dlg-gasto').showModal();
    if (!g) setTimeout(() => fG.monto.focus(), 50);
    if (S.edit.pendiente) {
      const E = S.edit;
      const msg = `⏳ Gasto pendiente${E.lectura ? ` · leído con ${E.lectura}` : ''}. Revisa los datos y toca "Confirmar" para que cuente en tus totales.`;
      renderAdjForm().then(() => { if (S.edit === E && !E.leyendo) banner(msg); });
    }
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
    const monto = montoCOP();
    // En dólares cada producto se convierte por separado: se toleran diferencias de redondeo.
    const tolerancia = E.moneda === 'USD' && E.tasa ? Math.max(2, n * E.tasa * 0.01) : 1;
    const dif = n && monto && Math.abs(monto - total) > tolerancia;
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

  // ---------- Aviso de repetido en el formulario ----------
  function candidatoForm() {
    const E = S.edit;
    return {
      id: E.id,
      fecha: fG.fecha.value,
      monto: montoCOP(),
      proveedor: fG.proveedor.value,
      numero_factura: fG.numero_factura.value,
      nit: fG.nit.value,
      cufe: E.cufe,
      items: itemsLimpios(E.items),
      hashes: E.nuevos.map((n) => n.hash),
    };
  }
  function comprobarRepetidoEnForm() {
    if (!S.edit) return [];
    const rep = buscarRepetidos(candidatoForm());
    const box = $('#form-repetido');
    box.hidden = !rep.length;
    box.innerHTML = rep.length ? avisoRepetidoHTML(rep) : '';
    return rep;
  }
  let tRep;
  const comprobarLuego = () => { clearTimeout(tRep); tRep = setTimeout(comprobarRepetidoEnForm, 300); };
  ['monto', 'fecha', 'proveedor', 'numero_factura', 'nit'].forEach((k) => fG[k].addEventListener('input', comprobarLuego));
  $('#prods-filas').addEventListener('input', comprobarLuego);

  $('#rep-guardar').addEventListener('click', () => {
    S.edit.repetidoAceptado = $('#dlg-repetido').dataset.firma;
    $('#dlg-repetido').close();
    fG.requestSubmit();
  });

  async function sha256(file) {
    try {
      const buf = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
      return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
    } catch { return null; }
  }

  // ---------- Lectura automática de facturas ----------
  const CAMPOS_AUTO = ['monto', 'fecha', 'proveedor', 'descripcion', 'metodo_pago', 'cat', 'items', 'numero_factura', 'nit'];
  ['monto', 'fecha', 'proveedor', 'descripcion', 'metodo_pago', 'numero_factura', 'nit'].forEach((k) => {
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
    if (E.nuevos.length) return E.nuevos[E.nuevos.length - 1].original || E.nuevos[E.nuevos.length - 1].file;
    const a = E.existentes.find((x) => !E.borrar.includes(x.id));
    if (!a) return null;
    const { data, error } = await sb.storage.from(CFG.BUCKET).download(a.ruta);
    if (error) throw error;
    return new File([data], a.nombre || 'factura', { type: a.tipo || data.type });
  }

  // ---------- Lector local + IA (opcional) ----------
  /**
   * Analiza una factura con el lector local y, si está activa, también con la IA (en paralelo).
   * f: { original: archivo para el lector local, ia: archivo sin contraseña para la IA, clave }
   * Nunca falla por la IA: si se acaba el cupo o hay error, queda el resultado local (r.iaNota lo explica).
   */
  async function analizarFactura(f, progreso) {
    const conocidos = [...new Set(S.gastos.map((g) => g.proveedor).filter(Boolean))];
    const usarIA = !!window.IAFacturas?.activa();
    const pIA = usarIA
      ? IAFacturas.analizar(f.ia || f.original, { categorias: S.cats.map((c) => c.nombre) }).catch((e) => { console.warn('IA', e); return { error: e }; })
      : Promise.resolve(null);
    let local;
    try {
      local = await LectorFacturas.analizar(f.original, { conocidos, clave: f.clave, progreso });
    } catch (e) {
      console.warn('Lector local', e);
      local = { fuentes: [], error: e };
    }
    if (usarIA) progreso?.('Interpretando con IA…');
    const ia = await pIA;
    const r = combinarLecturas(local, ia, conocidos);
    if (!usarIA && IAFacturas?.config().activa && IAFacturas.config().llave && IAFacturas.uso().agotada) r.iaNota = 'IA sin cupo hoy: se usó el lector local';
    else if (ia?.error) r.iaNota = IAFacturas.uso().agotada ? 'Se acabó el cupo gratuito de la IA por hoy: se usó el lector local' : `la IA falló (${String(ia.error.message || ia.error).slice(0, 120)}); se usó el lector local`;
    if (local.error && !ia?.fuentes) throw local.error;
    return r;
  }

  /** Une lo leído localmente con lo de la IA. El QR de la factura electrónica (exacto) siempre gana. */
  function combinarLecturas(l, ia, conocidos = []) {
    if (!ia || ia.error) return l;
    const qr = (l.fuentes || []).includes('QR DIAN');
    const r = { ...l, fuentes: [...(l.fuentes || []), 'IA'] };
    // Datos de identificación: la IA suele leer mejor que el OCR; con QR se respeta el QR.
    for (const k of ['nit', 'numero', 'fecha']) if (ia[k] && !(qr && l[k])) r[k] = ia[k];
    // Proveedor: si el local reconoció uno de tus proveedores de siempre, se conserva ese nombre.
    const conocido = l.proveedor && conocidos.some((p) => normTxt(p) === normTxt(l.proveedor));
    if (ia.proveedor && !conocido) r.proveedor = ia.proveedor;
    for (const k of ['metodo_pago', 'categoria', 'descripcion']) if (ia[k]) r[k] = ia[k];
    if (ia.recurrente) r.recurrente = true;
    if (!qr && ia.monto) {
      r.monto = ia.monto;
      r.montoSeguro = true;
      if (ia.moneda === 'USD') r.moneda = 'USD'; else delete r.moneda;
    }
    // Productos: los de la IA (descripciones claras), en la misma moneda del monto elegido.
    if (ia.items?.length && ((ia.moneda === 'USD') === (r.moneda === 'USD'))) r.items = ia.items;
    return r;
  }

  // ---------- Pagos recurrentes (suscripciones, servicios, débitos automáticos) ----------
  /**
   * Si la factura es de un pago mensual, devuelve los datos de tu último gasto con ese comercio
   * (nombre, NIT, descripción, categoría y método de pago) para prellenar el nuevo.
   * Es recurrente si la factura lo indica (r.recurrente), si el comercio es típico de cobros mensuales
   * o si ya lo pagaste en 2 o más meses distintos.
   */
  function plantillaRecurrente({ proveedor, nit, recurrente, descripcion, categoria }, excluirId = null) {
    const nNit = normNit(nit), nProv = normTxt(proveedor);
    if (!nNit && !nProv) return null;
    const previos = S.gastos.filter((g) => g.id !== excluirId && ((nNit && normNit(g.nit) === nNit) || (nProv && normTxt(g.proveedor) === nProv)));
    const meses = new Set(previos.map((g) => g.fecha.slice(0, 7))).size;
    const tipico = window.LectorFacturas?.pareceRecurrente(proveedor || previos[0]?.proveedor || '');
    if (!(recurrente || tipico || meses >= 2)) return null;
    const ult = previos[0]; // S.gastos está ordenado del más reciente al más antiguo
    const limpiar = (s) => String(s || '').replace(/\s*·\s*(Factura|NIT|US\$)[^·]*/g, '').trim();
    const catNombre = ult ? catDe(ult.categoria_id).nombre : (categoria || '');
    const tipo = /entreten/i.test(catNombre) ? 'Suscripción mensual' : /servicio/i.test(catNombre) ? 'Servicio mensual' : 'Pago mensual';
    const prov = ult?.proveedor || proveedor || '';
    return {
      proveedor: prov,
      nit: ult?.nit || nit || '',
      descripcion: limpiar(ult?.descripcion) || descripcion || `${tipo}${prov ? ` · ${prov}` : ''}`,
      categoria_id: ult?.categoria_id ?? null,
      metodo_pago: ult?.metodo_pago || '',
      meses,
      desdeHistorial: !!ult,
    };
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
      // Si es un PDF que tenía contraseña, el lector abre el original con ella (conserva el texto real)
      // y la IA recibe la copia ya optimizada y sin contraseña.
      const n = E.nuevos.find((x) => x.original === file || x.file === file);
      const r = await analizarFactura({ original: file, ia: n?.file || file, clave: n?.clave },
        (m) => { if (S.edit === E) banner(m, { cargando: true }); });
      if (S.edit !== E) return;
      const llenos = await aplicarLectura(E, r, forzar);
      if (S.edit !== E) return;
      // Con qué se leyó: queda guardado en el gasto y se muestra en su detalle.
      E.lectura = r.fuentes.join(' + ');
      const cfgIA = window.IAFacturas?.config();
      const estadoIA = r.fuentes.includes('IA') ? '✓ con IA' : r.iaNota ? r.iaNota : cfgIA?.llave && cfgIA.activa ? 'sin IA' : 'IA desactivada';
      const fuente = `${E.lectura} · ${estadoIA}`;
      const rep = comprobarRepetidoEnForm();
      if (rep.length) {
        banner(`✨ Completé ${llenos.join(', ') || 'la lectura'} (${fuente}). ⚠️ Ojo: esta factura parece ya registrada (mira el aviso de arriba).`, { error: true });
        $('#form-repetido').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } else if (llenos.length) {
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

  async function aplicarLectura(E, r, forzar) {
    const llenos = [];
    const puede = (k) => !E.tocado.has(k) || (forzar && k !== 'cat' && !fG[k]?.value);
    const poner = (k, valor, etiqueta) => {
      if (valor == null || valor === '' || !puede(k)) return;
      fG[k].value = valor;
      fG[k].classList.add('auto');
      llenos.push(etiqueta);
    };
    // Moneda: una factura en dólares cambia el formulario a USD (si el usuario no eligió otra).
    const monedaLeida = r.moneda === 'USD' ? 'USD' : 'COP';
    if (r.monto && monedaLeida !== E.moneda && !E.tocado.has('moneda') && puede('monto')) {
      setMoneda(monedaLeida);
      $('#seg-moneda').classList.add('auto');
      if (monedaLeida === 'USD') llenos.push('moneda (USD)');
    }
    // El monto solo se pone si está en la moneda elegida (no mezclar dólares con pesos).
    if (r.monto && monedaLeida === E.moneda) poner('monto', E.moneda === 'USD' ? fmtUSD(r.monto) : `$ ${fmtNum.format(r.monto)}`, 'monto');
    const fechaAntes = fG.fecha.value;
    poner('fecha', r.fecha, 'fecha');
    poner('proveedor', r.proveedor, 'proveedor');
    poner('numero_factura', r.numero, 'n.º de factura');
    poner('nit', r.nit, 'NIT');
    if (r.cufe && !E.cufe) E.cufe = r.cufe;
    if (r.metodo_pago && CFG.METODOS_PAGO.includes(r.metodo_pago)) poner('metodo_pago', r.metodo_pago, 'método de pago');
    if (E.moneda === 'USD') {
      if (fG.fecha.value !== fechaAntes) E.tasaManual = false;
      if (!E.tasa || fG.fecha.value !== fechaAntes) await actualizarTRM();
      else pintarConversion();
    }

    if (r.items?.length && (!E.tocado.has('items') || (forzar && !itemsLimpios(E.items).length))
      && (monedaLeida === 'COP' || (E.moneda === 'USD' && E.tasa))) {
      // Productos en dólares: se convierten a pesos con la misma TRM del gasto.
      const k = monedaLeida === 'USD' ? E.tasa : 1;
      E.items = r.items.map((it) => ({ ...it, valor: Math.round((Number(it.valor) || 0) * k) }));
      renderProds();
      $('#form-prods').classList.add('auto');
      llenos.push(`${r.items.length} producto${r.items.length === 1 ? '' : 's'}`);
    }

    if (!E.tocado.has('cat')) {
      const cat = categoriaSugerida(r.proveedor, r.categoria);
      if (cat) {
        E.catId = cat.id;
        renderChips();
        $(`#form-cats [data-cat="${cat.id}"]`)?.classList.add('auto');
        llenos.push('categoría');
      }
    }

    // Pago recurrente: comercio, NIT y descripción como en tu último pago a ese comercio.
    const plan = plantillaRecurrente({ proveedor: fG.proveedor.value || r.proveedor, nit: fG.nit.value || r.nit, recurrente: r.recurrente, descripcion: r.descripcion, categoria: r.categoria }, E.id);
    if (plan) {
      aplicarPlantilla(E, plan, puede);
      llenos.push(plan.desdeHistorial ? `🔁 datos de tu pago mensual a ${plan.proveedor}` : '🔁 descripción de pago mensual');
      E.recurrente = plan;
    } else poner('descripcion', r.descripcion, 'descripción');
    return llenos;
  }

  /** Prellena comercio, NIT y descripción (y categoría/pago si vienen del historial). */
  function aplicarPlantilla(E, plan, puede = (k) => !E.tocado.has(k)) {
    const fijar = (k, v) => {
      if (!v || !puede(k)) return;
      fG[k].value = v;
      fG[k].classList.add('auto');
    };
    fijar('proveedor', plan.proveedor);
    fijar('nit', plan.nit);
    fijar('descripcion', plan.descripcion);
    if (plan.metodo_pago && CFG.METODOS_PAGO.includes(plan.metodo_pago)) fijar('metodo_pago', plan.metodo_pago);
    if (plan.categoria_id && !E.tocado.has('cat') && S.cats.some((c) => c.id === plan.categoria_id)) {
      E.catId = plan.categoria_id;
      renderChips();
      $(`#form-cats [data-cat="${plan.categoria_id}"]`)?.classList.add('auto');
    }
  }

  // Al escribir a mano un comercio de pago mensual, se prellenan NIT y descripción (si están vacíos).
  fG.proveedor.addEventListener('change', () => {
    const E = S.edit;
    if (!E || E.id || fG.nit.value || fG.descripcion.value) return;
    const plan = plantillaRecurrente({ proveedor: fG.proveedor.value });
    if (!plan || !plan.desdeHistorial) return;
    aplicarPlantilla(E, { ...plan, proveedor: null }, (k) => !E.tocado.has(k) || k === 'nit' || k === 'descripcion');
    E.recurrente = plan;
    const usados = [plan.nit && 'el NIT', plan.descripcion && 'la descripción', plan.categoria_id && 'la categoría'].filter(Boolean);
    banner(`🔁 Pago mensual: usé ${usados.join(', ').replace(/, ([^,]*)$/, ' y $1')} de tu último pago a ${plan.proveedor}.`);
    comprobarRepetidoEnForm();
  });

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
      ...E.nuevos.map((n) => ({ key: n.key, nombre: n.file.name, tipo: n.file.type, src: n.preview, nota: n.nota })),
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

  const presetCompresion = () => store.get('compresion') || 'equilibrado';

  // ---------- PDF con contraseña ----------
  const claves = {
    lista() { try { return JSON.parse(store.get('clavesPDF') || '[]'); } catch { return []; } },
    guardar(c) { store.set('clavesPDF', JSON.stringify([c, ...claves.lista().filter((x) => x !== c)].slice(0, 10))); },
    olvidar() { try { localStorage.removeItem('clavesPDF'); } catch { /* sin almacenamiento */ } },
  };
  let clavesSesion = []; // usadas en esta sesión (solo en memoria)

  function renderClaves() {
    const n = claves.lista().length;
    $('#claves-info').hidden = $('#claves-olvidar').hidden = !n;
    $('#claves-info').textContent = `${n} contraseña${n === 1 ? '' : 's'} de PDF recordada${n === 1 ? '' : 's'} en este dispositivo.`;
  }
  $('#claves-olvidar').addEventListener('click', () => {
    claves.olvidar();
    clavesSesion = [];
    renderClaves();
    toast('Contraseñas olvidadas');
  });

  // ---------- Ajustes: lectura con IA ----------
  function renderIA() {
    if (!window.IAFacturas) { $('#card-ia').hidden = true; return; }
    const c = IAFacturas.config();
    const u = IAFacturas.uso();
    $('#ia-activa').checked = c.activa;
    if (document.activeElement !== $('#ia-limite')) $('#ia-limite').value = c.limite;
    if (document.activeElement !== $('#ia-llave')) $('#ia-llave').value = c.llave ? '••••••••••••' + c.llave.slice(-4) : '';
    const pct = Math.min(100, (u.usadas / u.limite) * 100);
    $('#ia-relleno').style.width = `${pct}%`;
    $('#ia-barra').classList.toggle('alto', u.agotada || pct >= 90);
    $('#ia-usadas').textContent = c.llave ? `${u.usadas} de ~${u.limite} hoy` : 'Sin configurar';
    $('#ia-detalle').textContent = c.llave ? (u.agotada ? ' · sin cupo hasta mañana' : ` · quedan ~${Math.max(0, u.limite - u.usadas)} (se reinicia cada día a las 2–3 a. m.)`) : ' · pega tu llave para activarla';
    // Aviso: solo informa; los gastos se siguen registrando con el lector local.
    let aviso = '';
    if (c.llave && c.activa && u.agotada) aviso = '⚠️ Se agotó el cupo gratuito de la IA por hoy. Los gastos se siguen registrando normalmente; la lectura usa solo el lector local hasta que se reinicie el cupo.';
    else if (c.llave && c.activa && pct >= 90) aviso = `⚠️ Vas en ${u.usadas} de ~${u.limite} lecturas con IA de hoy. Al agotarse, la app seguirá con el lector local.`;
    else if (c.llave && u.ultimoError) aviso = `⚠️ Última lectura con IA: ${u.ultimoError}.`;
    $('#ia-aviso').hidden = !aviso;
    $('#ia-aviso').textContent = aviso;
  }
  window.addEventListener('ia-uso', () => { if (!$('#view-ajustes').hidden) renderIA(); });
  $('#ia-activa').addEventListener('change', (e) => {
    if (e.target.checked && !IAFacturas.config().llave) { e.target.checked = false; toast('Primero pega tu llave de Gemini', true); $('#ia-llave').focus(); return; }
    IAFacturas.guardarConfig({ activa: e.target.checked });
    renderIA();
  });
  $('#ia-limite').addEventListener('change', (e) => { IAFacturas.guardarConfig({ limite: Number(e.target.value) }); renderIA(); });
  $('#ia-llave').addEventListener('focus', (e) => { if (e.target.value.startsWith('••')) e.target.value = ''; });
  $('#ia-llave').addEventListener('blur', () => setTimeout(renderIA, 200));
  $('#ia-probar').addEventListener('click', async () => {
    const v = $('#ia-llave').value.trim();
    if (v && !v.startsWith('••')) IAFacturas.guardarConfig({ llave: v });
    if (!IAFacturas.config().llave) { toast('Pega la llave de Gemini', true); return; }
    const btn = $('#ia-probar');
    btn.disabled = true;
    btn.textContent = 'Probando…';
    try {
      const modelo = await IAFacturas.probar();
      IAFacturas.guardarConfig({ activa: true });
      toast(`✓ IA lista (${modelo})`);
    } catch (e) {
      toast(`La llave no funcionó: ${e.message || e}`, true);
    }
    btn.disabled = false;
    btn.textContent = 'Guardar y probar';
    renderIA();
  });

  /** Pide la contraseña de un PDF. Devuelve { clave, recordar } o null si el usuario lo omite. */
  function pedirClave(nombre, error = false) {
    const d = $('#dlg-clave');
    const f = $('#form-clave');
    f.reset();
    f.clave.type = 'password';
    $('#clave-archivo').textContent = nombre;
    $('#clave-error').hidden = !error;
    return new Promise((ok) => {
      let resp = null;
      const enviar = (e) => { e.preventDefault(); resp = { clave: f.clave.value, recordar: f.recordar.checked }; d.close(); };
      const cerrar = () => { f.removeEventListener('submit', enviar); d.removeEventListener('close', cerrar); ok(resp); };
      f.addEventListener('submit', enviar);
      d.addEventListener('close', cerrar);
      d.showModal();
      setTimeout(() => f.clave.focus(), 50);
    });
  }
  $('#clave-omitir').addEventListener('click', () => $('#dlg-clave').close());
  $('#clave-ver').addEventListener('click', () => {
    const i = $('#form-clave').clave;
    i.type = i.type === 'password' ? 'text' : 'password';
  });

  /**
   * Si el PDF tiene contraseña, la quita: prueba las recordadas y, si no sirven, la pide.
   * @returns {Promise<{file: File, clave?: string, desbloqueado?: boolean} | null>} null = omitido
   */
  async function abrirProtegido(f0, aviso) {
    if (!esPDF(f0.type) || !window.Compresor?.necesitaClave) return { file: f0 };
    let protegido = false;
    try { protegido = await Compresor.necesitaClave(f0); } catch (e) { console.warn('PDF', e); }
    if (!protegido) return { file: f0 };
    const intentar = async (c) => {
      try { return await Compresor.desbloquear(f0, c, presetCompresion()); } catch (e) { if (e.code === 'clave') return null; throw e; }
    };
    const conocidas = [...new Set([...clavesSesion, ...claves.lista()])];
    if (conocidas.length) aviso?.('Probando contraseñas recordadas…');
    for (const c of conocidas) {
      const f = await intentar(c);
      if (f) return { file: f, clave: c, desbloqueado: true };
    }
    for (let error = false; ; error = true) {
      const r = await pedirClave(f0.name, error);
      if (!r) return null;
      aviso?.('Quitando la contraseña…');
      const f = await intentar(r.clave);
      if (f) {
        clavesSesion = [r.clave, ...clavesSesion.filter((x) => x !== r.clave)];
        if (r.recordar) { claves.guardar(r.clave); renderClaves(); }
        return { file: f, clave: r.clave, desbloqueado: true };
      }
    }
  }

  /**
   * Deja un archivo listo para subir: quita la contraseña (si tiene) y lo optimiza.
   * @returns {Promise<object|null>} entrada para E.nuevos, o null si se omitió
   */
  async function prepararArchivo(f0, aviso) {
    if (!(f0.type.startsWith('image/') || esPDF(f0.type))) { toast(`${f0.name}: solo imágenes o PDF`, true); return null; }
    const ab = await abrirProtegido(f0, aviso);
    if (!ab) { toast(`${f0.name}: omitido (sin contraseña)`); return null; }
    let c;
    if (ab.desbloqueado) c = { file: ab.file, antes: f0.size, despues: ab.file.size, cambiado: false };
    else {
      aviso?.(`Optimizando ${esPDF(f0.type) ? 'PDF' : 'foto'}…`);
      c = window.Compresor ? await Compresor.comprimir(f0, presetCompresion()) : { file: f0, antes: f0.size, despues: f0.size, cambiado: false };
    }
    const f = c.file;
    if (f.size > MAX_FILE) { toast(`${f.name} pesa ${Compresor.formatoBytes(f.size)} incluso optimizado; el máximo es 10 MB`, true); return null; }
    // Para leer se usa el original (mejor resolución, con su clave); para subir, el optimizado y sin clave.
    // preview: URL local para miniatura y visor. hash: huella del original para reconocer repetidos.
    return {
      key: `n${Math.random().toString(36).slice(2)}`, file: f, original: f0, clave: ab.clave, preview: URL.createObjectURL(f), hash: await sha256(f0),
      nota: ab.desbloqueado ? '🔓' : c.cambiado ? `−${Math.round((1 - c.despues / c.antes) * 100)}%` : '',
      antes: c.antes, despues: c.despues,
    };
  }

  /** "separados" | "juntos" | null */
  function preguntarVarios(n) {
    const d = $('#dlg-varios');
    $('#varios-n').textContent = n;
    return new Promise((ok) => {
      let resp = null;
      const sep = () => { resp = 'separados'; d.close(); };
      const jun = () => { resp = 'juntos'; d.close(); };
      $('#varios-separados').addEventListener('click', sep);
      $('#varios-juntos').addEventListener('click', jun);
      d.addEventListener('close', () => {
        $('#varios-separados').removeEventListener('click', sep);
        $('#varios-juntos').removeEventListener('click', jun);
        ok(resp);
      }, { once: true });
      d.showModal();
    });
  }

  async function agregarArchivos(files) {
    const E = S.edit;
    // Varios archivos en un gasto nuevo y vacío: ¿un gasto por archivo?
    if (files.length > 1 && !E.id && !E.cola && !E.nuevos.length && !E.existentes.length) {
      const modo = await preguntarVarios(files.length);
      if (!modo || S.edit !== E) return;
      if (modo === 'separados') { $('#dlg-gasto').close(); agregarACola(files); return; }
    }
    const antes = E.nuevos.length;
    let totalAntes = 0, totalDespues = 0;
    for (const f0 of files) {
      const n = await prepararArchivo(f0, (m) => { if (S.edit === E && !E.leyendo) banner(m, { cargando: true }); });
      if (S.edit !== E) return;
      if (!n) continue;
      totalAntes += n.antes; totalDespues += n.despues;
      E.nuevos.push(n);
    }
    if (!E.leyendo) banner(null);
    if (totalDespues < totalAntes) toast(`Optimizado: ${Compresor.formatoBytes(totalAntes)} → ${Compresor.formatoBytes(totalDespues)}`);
    renderAdjForm();
    comprobarRepetidoEnForm();
    const agregado = S.edit.nuevos.length > antes ? S.edit.nuevos[S.edit.nuevos.length - 1] : null;
    // Lectura automática si el monto aún no lo escribió el usuario.
    if (agregado && !S.edit.tocado.has('monto')) leerFactura(agregado.original);
  }
  ['#in-camara', '#in-archivo'].forEach((s) => $(s).addEventListener('change', async (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    await agregarArchivos(files);
  }));

  const extension = (f) => (esPDF(f.type) ? 'pdf' : (f.type.split('/')[1] || 'bin').replace('jpeg', 'jpg'));

  // ---------- Guardado (formulario y cola) ----------
  /**
   * d: { fecha, moneda, montoOriginal, tasa, monto (COP), catId, proveedor, metodo_pago, descripcion,
   *      items, numero_factura, nit, cufe }
   * @returns {{ fila: object, sinV5: boolean }}
   */
  function filaDesde(d, teniaItems = false) {
    const usd = d.moneda === 'USD';
    const fila = {
      fecha: d.fecha,
      monto: d.monto,
      categoria_id: d.catId,
      proveedor: (d.proveedor || '').trim() || null,
      metodo_pago: d.metodo_pago || null,
      descripcion: (d.descripcion || '').trim() || null,
    };
    // Solo se envía "items" si hay productos (o había): así la app sigue funcionando
    // aunque aún no se haya ejecutado la migración 002_productos.sql.
    const items = itemsLimpios(d.items || []);
    if (items.length || teniaItems) fila.items = items;
    const num = (d.numero_factura || '').trim(), nit = (d.nit || '').trim();
    if (S.v3) {
      fila.numero_factura = num || null;
      fila.nit = nit || null;
      fila.cufe = d.cufe || null;
    } else if (num && !/factura/i.test(fila.descripcion || '')) {
      // Sin la migración 003: se conserva el n.º en la descripción para no perderlo.
      fila.descripcion = [fila.descripcion, `Factura ${num}`, nit && `NIT ${nit}`].filter(Boolean).join(' · ');
    }
    if (S.v5) {
      fila.moneda = d.moneda || 'COP';
      fila.monto_original = usd ? d.montoOriginal : null;
      fila.tasa_cambio = usd && d.tasa ? Math.round(d.tasa * 10000) / 10000 : null;
    } else if (usd) {
      // Sin la migración 005: el valor en dólares queda en la descripción para no perderlo.
      const nota = `${fmtUSD(d.montoOriginal)} × TRM ${fmtTRM(d.tasa)}`;
      if (!(fila.descripcion || '').includes('US$')) fila.descripcion = [fila.descripcion, nota].filter(Boolean).join(' · ');
    }
    if (S.v6) {
      fila.estado = d.estado || 'confirmado';
      fila.lectura = d.lectura || null;
    }
    return { fila, sinV5: usd && !S.v5 };
  }

  /**
   * Inserta o actualiza el gasto y sube/borra sus facturas.
   * t: { id?, nuevos: [], existentes?: [], borrar?: [] }. t.id y t.nuevos se actualizan sobre la marcha,
   * así un reintento no duplica el gasto ni las facturas ya subidas.
   */
  async function persistirGasto(fila, t) {
    if (t.id) {
      const { error } = await sb.from('gastos').update(fila).eq('id', t.id);
      if (error) throw error;
    } else {
      const { data, error } = await sb.from('gastos').insert(fila).select('id').single();
      if (error) throw error;
      t.id = data.id;
    }
    for (const n of [...t.nuevos]) {
      const ruta = `${S.user.id}/${t.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-o.${extension(n.file)}`;
      const up = await sb.storage.from(CFG.BUCKET).upload(ruta, n.file, { contentType: n.file.type, upsert: false });
      if (up.error) throw up.error;
      const ins = await sb.from('adjuntos').insert({ gasto_id: t.id, ruta, nombre: n.file.name, tipo: n.file.type, tamano: n.file.size, ...(S.v3 && n.hash ? { hash: n.hash } : {}) });
      if (ins.error) throw ins.error;
      URL.revokeObjectURL(n.preview);
      t.nuevos = t.nuevos.filter((x) => x !== n);
    }
    if (t.borrar?.length) {
      const quitar = t.existentes.filter((a) => t.borrar.includes(a.id));
      const r = await sb.storage.from(CFG.BUCKET).remove(quitar.map((a) => a.ruta));
      if (r.error) throw r.error;
      const d = await sb.from('adjuntos').delete().in('id', t.borrar);
      if (d.error) throw d.error;
      t.borrar = [];
    }
    store.set('ultimaCat', String(fila.categoria_id));
    if (fila.metodo_pago) store.set('ultimoPago', fila.metodo_pago);
    return t.id;
  }

  function falloGuardar(err) {
    if (/items/.test(err?.message || '') && /PGRST204|42703/.test(err?.code || '')) {
      toast('Para guardar productos falta actualizar la base de datos: ejecuta supabase/migraciones/002_productos.sql en el SQL Editor de Supabase.', true);
    } else fallo(err, 'No se pudo guardar');
  }
  const avisoSinV5 = () => toast('Guardado en pesos. Para conservar el valor en dólares aparte, ejecuta supabase/migraciones/005_moneda_usd.sql.', true);

  /** pendiente = true: guarda la factura con los datos que haya, sin exigir monto ni categoría. */
  async function guardarFormulario(pendiente = false) {
    const E = S.edit;
    if (!E) return;
    const usd = E.moneda === 'USD';
    if (pendiente && !S.v6) { toast('Para dejar gastos pendientes, ejecuta supabase/migraciones/006_pendientes_y_lectura.sql en Supabase.', true); return; }
    if (pendiente && !E.nuevos.length && !E.existentes.some((a) => !E.borrar.includes(a.id))) { toast('Adjunta la factura para dejarla pendiente', true); return; }
    if (!pendiente) {
      if (!fG.fecha.value) { toast('Elige la fecha', true); fG.fecha.focus(); return; }
      if (!montoOriginal()) { toast('Ingresa un monto', true); fG.monto.focus(); return; }
      if (usd && !E.tasa) { toast(E.buscandoTRM ? 'Espera un momento: estoy consultando la TRM' : 'Escribe la TRM para convertir a pesos', true); if (!E.buscandoTRM) fG.tasa.focus(); return; }
      if (!E.catId) { toast('Elige una categoría', true); return; }
    }
    const { fila, sinV5 } = filaDesde({
      fecha: fG.fecha.value || ymd(new Date()), moneda: E.moneda, montoOriginal: montoOriginal(), tasa: E.tasa, monto: montoCOP(), catId: E.catId,
      proveedor: fG.proveedor.value, metodo_pago: fG.metodo_pago.value, descripcion: fG.descripcion.value,
      items: E.items, numero_factura: fG.numero_factura.value, nit: fG.nit.value, cufe: E.cufe,
      estado: pendiente ? 'pendiente' : 'confirmado', lectura: E.lectura,
    }, E.teniaItems);

    // ¿Factura ya registrada? Avisar antes de confirmar (una vez por cada conjunto de coincidencias).
    if (!pendiente) {
      const rep = buscarRepetidos(candidatoForm());
      const firma = rep.map((r) => r.g.id).join(',');
      if (rep.length && E.repetidoAceptado !== firma) {
        $('#repetido-lista').innerHTML = avisoRepetidoHTML(rep, rep.length === 1 ? 'Coincide con:' : `Coincide con ${rep.length} gastos:`);
        $('#dlg-repetido').dataset.firma = firma;
        $('#dlg-repetido').showModal();
        return;
      }
    }
    const eraEdicion = !!E.id && !E.pendiente;
    const btns = [$('#btn-guardar'), $('#btn-pendiente')];
    btns.forEach((b) => { b.disabled = true; });
    loading(true);
    try {
      await persistirGasto(fila, E); // E tiene id, nuevos, existentes y borrar
      if (sinV5) avisoSinV5();
      await cargarGastos();
      E.guardado = true;
      if (E.cola) quitarDeCola(E.cola, false);
      // El evento "close" llega después: se espera para no mezclar este gasto con el siguiente de la cola.
      const cerrado = new Promise((r) => $('#dlg-gasto').addEventListener('close', r, { once: true }));
      $('#dlg-gasto').close();
      toast(pendiente ? '⏳ Guardado como pendiente' : E.pendiente ? '✓ Gasto confirmado' : eraEdicion ? 'Gasto actualizado' : 'Gasto guardado');
      if (!E.cola) setTimeout(chequearLimite, 800);
      refrescar();
      if (E.cola) cerrado.then(seguirCola);
    } catch (err) {
      falloGuardar(err);
      try { await cargarGastos(); } catch { /* ignorar */ }
    }
    btns.forEach((b) => { b.disabled = false; });
    loading(false);
  }
  fG.addEventListener('submit', (e) => { e.preventDefault(); guardarFormulario(false); });
  $('#btn-pendiente').addEventListener('click', () => guardarFormulario(true));
  $('#btn-descartar').addEventListener('click', () => eliminarGasto(S.pendientes.find((x) => x.id === S.edit?.id)));

  // ---------- Varias facturas: cola de revisión ----------
  // S.cola = { items: [{ key, nombre, n (archivo preparado), d (datos del gasto), estado, motivo }], pend: File[], corriendo, guardando, unoAUno }
  const ESTADOS = { leyendo: '⏳ Leyendo', listo: '✓ Lista', revisar: '✏️ Revisar', repetido: '⚠️ Repetida', guardando: '⏳ Guardando', error: '✕ Error' };
  const nuevaCola = () => (S.cola ||= { items: [], pend: [], corriendo: false, guardando: false, unoAUno: false });

  function categoriaSugerida(proveedor, categoria) {
    const n = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
    // 1) misma categoría que usaste antes con ese proveedor; 2) sugerencia por palabras clave
    const previo = proveedor && S.gastos.find((g) => n(g.proveedor) === n(proveedor) && g.categoria_id);
    return previo ? S.cats.find((c) => c.id === previo.categoria_id) : S.cats.find((c) => n(c.nombre) === n(categoria));
  }

  /** Datos del gasto a partir de la lectura de la factura. */
  async function borradorDe(r) {
    const usd = r.moneda === 'USD';
    const d = {
      fecha: r.fecha || ymd(new Date()),
      moneda: usd ? 'USD' : 'COP',
      montoOriginal: r.monto || 0,
      montoSeguro: r.montoSeguro !== false,
      tasa: null,
      proveedor: r.proveedor || '',
      numero_factura: r.numero || '',
      nit: r.nit || '',
      cufe: r.cufe || null,
      metodo_pago: CFG.METODOS_PAGO.includes(r.metodo_pago) ? r.metodo_pago : (store.get('ultimoPago') || ''),
      descripcion: r.descripcion || '',
      lectura: (r.fuentes || []).join(' + '),
      items: [],
    };
    if (usd) { try { d.tasa = (await obtenerTRM(d.fecha)).valor; } catch (e) { console.warn('TRM', e); } }
    const k = usd ? d.tasa : 1;
    if (k && r.items?.length) d.items = r.items.map((it) => ({ ...it, valor: Math.round((Number(it.valor) || 0) * k) }));
    d.monto = k ? Math.round(d.montoOriginal * k) : 0;
    const cat = categoriaSugerida(r.proveedor, r.categoria);
    d.catSugerida = !!cat;
    d.catId = cat?.id ?? (S.cats.find((c) => c.id === Number(store.get('ultimaCat'))) || S.cats.find((c) => /otros/i.test(c.nombre)) || S.cats[0])?.id ?? null;
    // Pago recurrente: comercio, NIT, descripción, categoría y pago como la última vez.
    const plan = plantillaRecurrente({ proveedor: d.proveedor, nit: d.nit, recurrente: r.recurrente, descripcion: r.descripcion, categoria: r.categoria });
    if (plan) {
      d.recurrente = true;
      d.proveedor = plan.proveedor || d.proveedor;
      d.nit = plan.nit || d.nit;
      d.descripcion = plan.descripcion || d.descripcion;
      if (plan.categoria_id && S.cats.some((c) => c.id === plan.categoria_id)) { d.catId = plan.categoria_id; d.catSugerida = true; }
      if (plan.metodo_pago && CFG.METODOS_PAGO.includes(plan.metodo_pago)) d.metodo_pago = plan.metodo_pago;
    }
    return d;
  }

  /** Repetidos contra lo ya guardado y contra las otras facturas de la cola. */
  function repetidosDeCola(it) {
    const d = it.d;
    const c = { fecha: d.fecha, monto: d.monto, proveedor: d.proveedor, numero_factura: d.numero_factura, nit: d.nit, cufe: d.cufe, items: d.items, hashes: [it.n?.hash] };
    const otros = S.cola.items.filter((x) => x !== it && x.d).map((x) => ({
      id: `cola-${x.key}`, enCola: true, fecha: x.d.fecha, monto: x.d.monto, proveedor: x.d.proveedor, numero_factura: x.d.numero_factura,
      nit: x.d.nit, cufe: x.d.cufe, items: x.d.items, adjuntos: [{ hash: x.n?.hash }],
    }));
    return [...buscarRepetidos(c), ...buscarRepetidos(c, otros)];
  }

  function evaluar(it) {
    if (!it.d) return;
    const d = it.d;
    const rep = repetidosDeCola(it);
    if (it.errorLectura) { it.estado = 'revisar'; it.motivo = 'No se pudo leer: complétala a mano'; }
    else if (!d.montoOriginal) { it.estado = 'revisar'; it.motivo = 'Falta el monto'; }
    else if (d.moneda === 'USD' && !d.tasa) { it.estado = 'revisar'; it.motivo = 'Falta la TRM'; }
    else if (rep.length) { it.estado = 'repetido'; it.motivo = rep[0].g.enCola ? 'Igual a otra factura de esta lista' : `Ya registrada: ${resumenGasto(rep[0].g)}`; }
    else if (!d.montoSeguro) { it.estado = 'revisar'; it.motivo = 'Verifica el monto'; }
    else if (!d.catId) { it.estado = 'revisar'; it.motivo = 'Elige una categoría'; }
    else { it.estado = 'listo'; it.motivo = d.catSugerida ? '' : 'Categoría por defecto'; }
  }

  function renderCola() {
    const C = S.cola;
    const btnPend = $('#cola-abrir');
    if (!C) { btnPend.hidden = true; return; }
    const items = C.items;
    const listos = items.filter((x) => x.estado === 'listo').length;
    const conDatos = items.filter((x) => x.d).length;
    btnPend.hidden = !items.length;
    btnPend.textContent = `📥 ${items.length} factura${items.length === 1 ? '' : 's'} por registrar`;
    $('#cola-titulo').textContent = `Facturas por registrar (${items.length})`;
    const leyendo = items.findIndex((x) => x.estado === 'leyendo');
    $('#cola-estado').textContent = !items.length ? 'No quedan facturas en la lista.'
      : C.guardando ? 'Guardando…'
        : C.corriendo ? `Leyendo ${leyendo + 1} de ${items.length + C.pend.length}… Puedes revisar las que ya estén listas.`
          : `${listos} lista${listos === 1 ? '' : 's'} para guardar${conDatos - listos ? ` · ${conDatos - listos} por revisar` : ''}. Toca una para revisarla.`;
    $('#cola-lista').innerHTML = items.map((it) => {
      const d = it.d;
      const usd = d?.moneda === 'USD';
      const img = it.n && it.n.file.type.startsWith('image/') ? `<img src="${esc(it.n.preview)}" alt="">` : '📄';
      const sub = d ? [fechaCorta(d.fecha), catDe(d.catId).nombre, it.motivo].filter(Boolean).join(' · ') : (it.motivo || '');
      return `<li class="item" data-cola="${it.key}">
        <span class="item-ico">${img}</span>
        <div class="item-main"><div class="item-title">${esc(d?.proveedor || it.nombre)}</div>
          <div class="item-sub"><span class="cola-est ${it.estado}">${ESTADOS[it.estado] || ''}</span>${d?.recurrente ? '<span class="badge-rec">🔁 mensual</span> ' : ''}${esc(sub)}</div></div>
        <div class="item-amount">${d && d.monto ? fmt(d.monto) : '—'}${usd && d.montoOriginal ? `<span class="monto-usd">${fmtUSD(d.montoOriginal)}</span>` : ''}</div>
        ${it.estado === 'leyendo' || it.estado === 'guardando' ? '' : `<button type="button" class="btn btn-icon cola-quitar" data-cola-quitar="${it.key}" aria-label="Descartar">✕</button>`}
      </li>`;
    }).join('');
    $('#cola-guardar').textContent = listos ? `Guardar ${listos} lista${listos === 1 ? '' : 's'}` : 'Guardar listas';
    $('#cola-guardar').disabled = !listos || C.guardando;
    $('#cola-revisar').disabled = !conDatos || C.guardando;
    $('#cola-pendientes').hidden = !S.v6 || !items.length || C.autoPendiente;
  }

  function abrirCola() {
    renderCola();
    if (!$('#dlg-cola').open) $('#dlg-cola').showModal();
  }

  function agregarACola(files) {
    const C = nuevaCola();
    C.pend.push(...files);
    abrirCola();
    if (!C.corriendo) procesarCola();
  }

  async function procesarCola() {
    const C = S.cola;
    C.corriendo = true;
    while (C.pend.length) {
      const f0 = C.pend.shift();
      const it = { key: `c${Math.random().toString(36).slice(2)}`, nombre: f0.name, estado: 'leyendo', motivo: 'Preparando…' };
      C.items.push(it);
      renderCola();
      let ultimo = 0;
      const aviso = (m) => { it.motivo = m; if (Date.now() - ultimo > 250) { ultimo = Date.now(); renderCola(); } };
      try {
        it.n = await prepararArchivo(f0, aviso);
        if (!it.n) { C.items = C.items.filter((x) => x !== it); renderCola(); continue; }
        let r;
        try {
          r = await analizarFactura({ original: it.n.original, ia: it.n.file, clave: it.n.clave }, aviso);
        } catch (e) { console.warn('Lectura', e); r = {}; }
        it.d = await borradorDe(r);
        if (!r.monto && !r.fecha && !r.proveedor) it.errorLectura = true;
        evaluar(it);
        if (C.autoPendiente) { renderCola(); await guardarItemPendiente(it); }
      } catch (e) {
        console.error(e);
        it.estado = 'error';
        it.motivo = e.message || String(e);
      }
      // Cada nueva factura puede volver repetida a otra: se re-evalúan todas.
      C.items.forEach((x) => x.d && x.estado !== 'error' && x.estado !== 'guardando' && evaluar(x));
      renderCola();
    }
    C.corriendo = false;
    renderCola();
    if (S.cola === C && !C.items.length) { S.cola = null; renderCola(); }
  }

  function quitarDeCola(key, liberar = true) {
    const C = S.cola;
    if (!C) return;
    const it = C.items.find((x) => x.key === key);
    if (!it || it.estado === 'leyendo' || it.estado === 'guardando') return;
    if (liberar && it.n?.preview) URL.revokeObjectURL(it.n.preview);
    C.items = C.items.filter((x) => x !== it);
    C.items.forEach((x) => x.d && x.estado !== 'error' && evaluar(x));
    renderCola();
  }

  /** Tras guardar una revisión: siguiente factura (modo uno por uno) o volver a la lista. */
  function seguirCola() {
    const C = S.cola;
    if (!C) return;
    if (!C.items.length && !C.corriendo) {
      S.cola = null;
      renderCola();
      if ($('#dlg-cola').open) $('#dlg-cola').close();
      toast('✓ Todas las facturas quedaron registradas');
      return;
    }
    if (C.unoAUno) {
      const sig = C.items.find((x) => x.d && x.estado !== 'guardando');
      if (sig) { revisarDeCola(sig.key); return; }
    }
    C.unoAUno = false;
    abrirCola();
  }

  /** Abre una factura de la cola en el formulario, con los datos leídos y su archivo. */
  function revisarDeCola(key) {
    const C = S.cola;
    const it = C?.items.find((x) => x.key === key);
    if (!it?.d) return;
    const d = it.d;
    if ($('#dlg-cola').open) $('#dlg-cola').close();
    abrirFormulario({
      fecha: d.fecha, monto: d.monto, categoria_id: d.catId, proveedor: d.proveedor, metodo_pago: d.metodo_pago, descripcion: d.descripcion,
      numero_factura: d.numero_factura, nit: d.nit, cufe: d.cufe, items: d.items, adjuntos: [],
      moneda: d.moneda, monto_original: d.moneda === 'USD' ? d.montoOriginal : null, tasa_cambio: d.tasa,
      lectura: d.lectura,
    });
    const E = S.edit;
    E.cola = key;
    E.nuevos = [it.n];
    const pos = C.items.indexOf(it) + 1;
    $('#form-title').textContent = `Revisar factura ${pos} de ${C.items.length}`;
    renderAdjForm().then(() => {
      if (S.edit === E && it.estado !== 'listo' && it.motivo) banner(`${ESTADOS[it.estado]}: ${it.motivo}`, { error: true });
    });
    comprobarRepetidoEnForm();
  }

  $('#in-varios').addEventListener('change', (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    if (files.length) agregarACola(files);
  });
  $('#in-cola-mas').addEventListener('change', (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    if (files.length) agregarACola(files);
  });
  $('#cola-abrir').addEventListener('click', abrirCola);
  $('#cola-lista').addEventListener('click', (e) => {
    const q = e.target.closest('[data-cola-quitar]');
    if (q) {
      quitarDeCola(q.dataset.colaQuitar);
      if (S.cola && !S.cola.items.length && !S.cola.corriendo) { S.cola = null; renderCola(); }
      return;
    }
    const li = e.target.closest('[data-cola]');
    if (li && !S.cola.guardando) { S.cola.unoAUno = false; revisarDeCola(li.dataset.cola); }
  });
  $('#cola-revisar').addEventListener('click', () => {
    const sig = S.cola?.items.find((x) => x.d);
    if (!sig) return;
    S.cola.unoAUno = true;
    revisarDeCola(sig.key);
  });

  // ---------- Cola → pendientes ("confirmar después") ----------
  /** Guarda una factura de la cola como gasto pendiente (con lo que se haya leído). */
  async function guardarItemPendiente(it) {
    const C = S.cola;
    if (!C || !it.d || it.estado === 'guardando') return false;
    it.estado = 'guardando';
    it.motivo = '';
    renderCola();
    try {
      it.t ||= { nuevos: [it.n] }; // conserva el id y las subidas si se reintenta
      await persistirGasto(filaDesde({ ...it.d, estado: 'pendiente' }).fila, it.t);
      C.items = C.items.filter((x) => x !== it);
      C.enviadosPendiente = (C.enviadosPendiente || 0) + 1;
      return true;
    } catch (err) {
      console.error(err);
      it.estado = 'error';
      it.motivo = `No se pudo guardar: ${err.message || err}`;
      return false;
    } finally {
      renderCola();
      if (!C.corriendo || !C.pend.length) terminarPendientes();
    }
  }

  let tPend;
  /** Cuando ya no queda nada por leer ni guardar: recarga, avisa y cierra la cola. */
  function terminarPendientes() {
    clearTimeout(tPend);
    const C = S.cola;
    tPend = setTimeout(async () => {
      if (!C?.autoPendiente || C.pend.length || C.items.some((x) => x.estado === 'leyendo' || x.estado === 'guardando')) return;
      try { await cargarGastos(); } catch (e) { console.warn(e); }
      refrescar();
      const n = C.enviadosPendiente || 0;
      if (n) toast(`⏳ ${n} factura${n === 1 ? '' : 's'} guardada${n === 1 ? '' : 's'} como pendiente${n === 1 ? '' : 's'}. Confírmalas en Gastos.`);
      C.enviadosPendiente = 0;
      if (!C.items.length) { if (S.cola === C) S.cola = null; renderCola(); if ($('#dlg-cola').open) $('#dlg-cola').close(); }
      else { C.autoPendiente = false; renderCola(); }
    }, 300);
  }

  $('#cola-pendientes').addEventListener('click', async () => {
    const C = S.cola;
    if (!C) return;
    if (!S.v6) { toast('Para dejar gastos pendientes, ejecuta supabase/migraciones/006_pendientes_y_lectura.sql en Supabase.', true); return; }
    // Las que ya se leyeron se guardan ahora; las que faltan, apenas terminen de leerse.
    C.autoPendiente = true;
    if (C.corriendo) toast('Las facturas que faltan se guardarán como pendientes al terminar de leerse; puedes cerrar esta ventana.');
    for (const it of C.items.filter((x) => x.d && x.estado !== 'guardando')) await guardarItemPendiente(it);
    terminarPendientes();
  });

  $('#cola-guardar').addEventListener('click', async () => {
    const C = S.cola;
    const listos = C?.items.filter((x) => x.estado === 'listo') || [];
    if (!listos.length || C.guardando) return;
    C.guardando = true;
    renderCola();
    let ok = 0, sinV5 = false;
    for (const it of listos) {
      it.estado = 'guardando';
      it.motivo = '';
      renderCola();
      try {
        it.t ||= { nuevos: [it.n] }; // conserva el id y las subidas si se reintenta
        const r = filaDesde(it.d);
        sinV5 ||= r.sinV5;
        await persistirGasto(r.fila, it.t);
        C.items = C.items.filter((x) => x !== it);
        ok++;
      } catch (err) {
        console.error(err);
        it.estado = 'error';
        it.motivo = `No se pudo guardar: ${err.message || err}`;
      }
    }
    C.guardando = false;
    try { await cargarGastos(); } catch (e) { console.warn(e); }
    C.items.forEach((x) => x.d && x.estado !== 'error' && evaluar(x));
    refrescar();
    if (sinV5) avisoSinV5();
    toast(`✓ ${ok} gasto${ok === 1 ? '' : 's'} guardado${ok === 1 ? '' : 's'}${C.items.length ? `; quedan ${C.items.length} por revisar` : ''}`);
    setTimeout(chequearLimite, 800);
    if (!C.items.length && !C.corriendo) { S.cola = null; renderCola(); $('#dlg-cola').close(); } else renderCola();
  });

  window.addEventListener('beforeunload', (e) => {
    if (S.cola?.items.length || S.cola?.pend.length) { e.preventDefault(); e.returnValue = ''; }
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
    renderAlmacenamiento();
    renderArchivoAjustes();
    renderClaves();
    renderIA();
    renderHistorial();
  }

  // ---------- Almacenamiento y compresión ----------
  const LIMITE_GRATIS = 1024 ** 3; // 1 GB de almacenamiento en el plan gratuito de Supabase
  const UMBRAL_OPT = 150 * 1024;
  // "-o" en la ruta = el archivo ya pasó por el compresor (al subirlo o al optimizar); no se repite.
  const porOptimizar = (a) => !/-o\.\w+$/.test(a.ruta) && (!a.tamano || a.tamano > UMBRAL_OPT);

  function renderAlmacenamiento() {
    const adj = todosLosGastos().flatMap((g) => g.adjuntos || []);
    const total = adj.reduce((a, x) => a + (Number(x.tamano) || 0), 0);
    const pct = Math.min(100, (total / LIMITE_GRATIS) * 100);
    $('#uso-relleno').style.width = `${Math.max(pct, total ? 0.8 : 0)}%`;
    $('.uso-barra').classList.toggle('alto', pct > 80);
    $('#uso-usado').textContent = `${Compresor.formatoBytes(total)} de 1 GB`;
    const prom = adj.length ? total / adj.length : 0;
    const restantes = prom ? Math.floor((LIMITE_GRATIS - total) / prom) : null;
    $('#uso-detalle').textContent = `${adj.length} factura${adj.length === 1 ? '' : 's'}${prom ? ` · promedio ${Compresor.formatoBytes(Math.round(prom))} · caben ~${fmtNum.format(restantes)} más` : ''}`;
    const actual = presetCompresion();
    $$('#seg-compresion button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.preset === actual)));
    const desc = {
      calidad: 'Fotos hasta 3200 px. Archivos más pesados; útil si fotografías facturas de letra muy pequeña.',
      equilibrado: 'Recomendado. Fotos hasta 2400 px: el texto se lee perfecto y cada foto queda en unos 200–500 KB.',
      ahorro: 'Fotos hasta 1800 px. Ocupa menos espacio; sigue siendo legible para tiquetes y facturas normales.',
    };
    $('#compresion-desc').textContent = desc[actual];
    const candidatas = adj.filter(porOptimizar).length;
    $('#btn-optimizar').disabled = !candidatas;
    $('#btn-optimizar').textContent = candidatas ? `✨ Optimizar facturas ya guardadas (${candidatas})` : '✓ Todas las facturas están optimizadas';
  }

  $('#seg-compresion').addEventListener('click', (e) => {
    const b = e.target.closest('[data-preset]');
    if (!b) return;
    store.set('compresion', b.dataset.preset);
    renderAlmacenamiento();
  });

  $('#btn-optimizar').addEventListener('click', async () => {
    const tareas = todosLosGastos().flatMap((g) => (g.adjuntos || []).map((a) => ({ g, a }))).filter(({ a }) => porOptimizar(a));
    if (!tareas.length) return;
    if (!confirm(`Se revisarán ${tareas.length} factura(s) guardadas y se reemplazarán por versiones más livianas cuando se ahorre al menos un 15 %.\n\nEl texto sigue siendo legible, pero los archivos originales se sustituyen y no se puede deshacer.\n\n¿Continuar?`)) return;
    const btn = $('#btn-optimizar');
    const prog = $('#optimizar-progreso');
    btn.disabled = true;
    prog.hidden = false;
    let ahorro = 0, optimizadas = 0, fallidas = 0, i = 0;
    for (const { g, a } of tareas) {
      prog.textContent = `Optimizando ${++i} de ${tareas.length}… (ahorrado: ${Compresor.formatoBytes(ahorro)})`;
      try {
        const { data, error } = await sb.storage.from(CFG.BUCKET).download(a.ruta);
        if (error) throw error;
        const orig = new File([data], a.nombre || 'factura', { type: a.tipo || data.type });
        const c = await Compresor.comprimir(orig, presetCompresion());
        if (c.cambiado && c.despues < c.antes * 0.85) {
          const ruta = `${S.user.id}/${g.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-o.${extension(c.file)}`;
          const up = await sb.storage.from(CFG.BUCKET).upload(ruta, c.file, { contentType: c.file.type, upsert: false });
          if (up.error) throw up.error;
          const upd = await sb.from('adjuntos').update({ ruta, tipo: c.file.type, tamano: c.file.size, nombre: c.file.name }).eq('id', a.id);
          if (upd.error) { await sb.storage.from(CFG.BUCKET).remove([ruta]); throw upd.error; }
          await sb.storage.from(CFG.BUCKET).remove([a.ruta]); // el original solo se borra cuando el nuevo ya quedó registrado
          ahorro += c.antes - c.despues;
          optimizadas++;
        } else if (!a.tamano) {
          await sb.from('adjuntos').update({ tamano: orig.size }).eq('id', a.id);
        }
      } catch (e) { console.error('Optimizar', a.ruta, e); fallidas++; }
    }
    try { await cargarGastos(); } catch { /* ignorar */ }
    renderAlmacenamiento();
    prog.textContent = `Listo: ${optimizadas} factura(s) optimizada(s), ${Compresor.formatoBytes(ahorro)} liberados${fallidas ? ` · ${fallidas} con error` : ''}.`;
    toast(`Liberaste ${Compresor.formatoBytes(ahorro)}`);
  });

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
  const esUSDg = (g) => g.moneda === 'USD' && g.monto_original > 0;
  const hayUSD = (lista) => lista.some(esUSDg);

  function construirLibro(lista, enlaces) {
    const maxFac = Math.max(1, ...lista.map((g) => g.adjuntos?.length || 0));
    const conUSD = hayUSD(lista);
    const cab = ['Fecha', 'Categoría', 'Proveedor', 'Descripción', 'Método de pago', 'Monto', 'Productos', 'N.º factura', 'NIT',
      ...(conUSD ? ['Monto USD', 'TRM'] : []),
      ...Array.from({ length: maxFac }, (_, i) => `Factura ${i + 1}`)];
    const MONEDA = '"$"#,##0';
    const filas = lista.map((g) => {
      const fac = enlaces(g).map((e) => ({ t: 's', v: e.texto, l: { Target: e.url, Tooltip: 'Abrir factura' } }));
      const usd = esUSDg(g);
      return [g.fecha, catDe(g.categoria_id).nombre, g.proveedor || '', g.descripcion || '', g.metodo_pago || '',
        { t: 'n', v: g.monto, z: MONEDA }, itemsDe(g).length || '', g.numero_factura || '', g.nit || '',
        ...(conUSD ? (usd ? [{ t: 'n', v: g.monto_original, z: '"US$" #,##0.00' }, { t: 'n', v: g.tasa_cambio, z: '#,##0.00' }] : ['', '']) : []),
        ...fac];
    });
    const ws = XLSX.utils.aoa_to_sheet([cab, ...filas,
      ['', '', '', '', 'TOTAL', { t: 'n', f: `SUM(F2:F${filas.length + 1})`, z: MONEDA }]]);
    ws['!cols'] = [{ wch: 11 }, { wch: 15 }, { wch: 24 }, { wch: 32 }, { wch: 14 }, { wch: 13 }, { wch: 10 }, { wch: 16 }, { wch: 14 },
      ...(conUSD ? [{ wch: 12 }, { wch: 11 }] : []), ...Array(maxFac).fill({ wch: 34 })];
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

  const cargarXLSX = () => LectorFacturas.cargar('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js');
  const cargarZip = () => LectorFacturas.cargar('https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js');
  const rangoDe = (lista) => ({ desde: lista[0]?.fecha || null, hasta: lista[lista.length - 1]?.fecha || null });
  const nFacturas = (lista) => lista.reduce((a, g) => a + (g.adjuntos?.length || 0), 0);

  // ---------- Historial de descargas ----------
  S.v4 = true;
  S.historial = [];
  async function cargarHistorial() {
    const { data, error } = await sb.from('exportaciones').select('*').order('created_at', { ascending: false }).limit(40);
    if (error) { S.v4 = false; S.historial = []; return; }
    S.v4 = true;
    S.historial = data;
  }

  /** Guarda la descarga en el historial (si la migración 004 está aplicada). */
  async function registrarExport(r) {
    if (!S.v4) return;
    const fila = { tipo: r.tipo, periodo: r.periodo, ...rangoDe(r.lista || []), gastos: r.lista?.length || 0, facturas: r.facturas ?? nFacturas(r.lista || []),
      tamano: r.tamano ?? null, liberado: r.liberado ?? null, nombre: r.nombre };
    const { data, error } = await sb.from('exportaciones').insert(fila).select().single();
    if (error) { console.warn('Historial', error); if (/exportaciones/.test(error.message || '')) S.v4 = false; return; }
    S.historial.unshift(data);
    if (!$('#view-ajustes').hidden) renderHistorial();
  }

  const ICONO_EXPORT = { xlsx: ['📊', 'Excel'], csv: ['🧾', 'CSV'], zip: ['📦', 'Excel + facturas'], archivo: ['🗄️', 'Respaldo y limpieza'] };
  function renderHistorial() {
    const ul = $('#lista-historial');
    if (!S.v4) {
      ul.innerHTML = '<li class="empty">Para guardar el historial, ejecuta <b>supabase/migraciones/004_historial_y_archivo.sql</b> en Supabase.</li>';
      return;
    }
    if (!S.historial.length) { ul.innerHTML = '<li class="empty">Aún no has descargado nada.</li>'; return; }
    ul.innerHTML = S.historial.map((h) => {
      const [ico, tipo] = ICONO_EXPORT[h.tipo] || ['⬇', h.tipo];
      const cuando = new Date(h.created_at).toLocaleString('es-CO', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
      const det = [h.periodo, `${h.gastos} gasto${h.gastos === 1 ? '' : 's'}`, h.facturas ? `${h.facturas} factura${h.facturas === 1 ? '' : 's'}` : null, h.tamano ? Compresor.formatoBytes(h.tamano) : null]
        .filter(Boolean).join(' · ');
      return `<li class="item hist">
        <span class="item-ico" style="background:var(--fill)">${ico}</span>
        <div class="item-main"><div class="item-title">${esc(tipo)}${h.liberado ? ` <span class="hist-lib">−${esc(Compresor.formatoBytes(h.liberado))} en la nube</span>` : ''}</div>
          <div class="item-sub">${esc(det)}</div><div class="item-sub">${esc(cuando)}${h.nombre ? ` · ${esc(h.nombre)}` : ''}</div></div>
      </li>`;
    }).join('');
  }

  // ---------- Exportaciones manuales ----------
  $('#exp-csv').addEventListener('click', async () => {
    const { nombre, lista } = gastosExport();
    if (!lista.length) return toast('No hay gastos para exportar', true);
    loading(true);
    try {
      const enlaces = await enlacesTemporales(lista);
      const maxFac = Math.max(0, ...lista.map((g) => g.adjuntos?.length || 0));
      const conUSD = hayUSD(lista);
      const cab = ['Fecha', 'Categoría', 'Proveedor', 'Descripción', 'Método de pago', 'Monto', 'Productos', 'N.º factura', 'NIT',
        ...(conUSD ? ['Monto USD', 'TRM'] : []),
        ...Array.from({ length: maxFac }, (_, i) => `Factura ${i + 1} (enlace 7 días)`)];
      const celda = (v) => (/[";\n\r]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v);
      const dec = (n) => String(n).replace('.', ','); // decimales con coma, como Excel en Colombia
      const filas = lista.map((g) => [g.fecha, catDe(g.categoria_id).nombre, g.proveedor || '', g.descripcion || '', g.metodo_pago || '',
        g.monto, textoProductos(g), g.numero_factura || '', g.nit || '',
        ...(conUSD ? (esUSDg(g) ? [dec(g.monto_original), dec(g.tasa_cambio)] : ['', '']) : []),
        ...enlaces(g).map((e) => e.url)]);
      // Separador ";" para que Excel en español (Colombia) lo abra en columnas.
      const csv = [cab, ...filas].map((f) => f.map(celda).join(';')).join('\r\n');
      const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
      descargar(blob, `${nombre}.csv`);
      registrarExport({ tipo: 'csv', periodo: nombre.replace('gastos_', ''), lista, tamano: blob.size, nombre: `${nombre}.csv` });
    } catch (err) { fallo(err, 'No se pudo exportar'); }
    loading(false);
  });

  $('#exp-xlsx').addEventListener('click', async () => {
    const { nombre, lista } = gastosExport();
    if (!lista.length) return toast('No hay gastos para exportar', true);
    loading(true);
    try {
      await cargarXLSX();
      const wb = construirLibro(lista, await enlacesTemporales(lista));
      const blob = new Blob([XLSX.write(wb, { type: 'array', bookType: 'xlsx' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      descargar(blob, `${nombre}.xlsx`);
      registrarExport({ tipo: 'xlsx', periodo: nombre.replace('gastos_', ''), lista, tamano: blob.size, nombre: `${nombre}.xlsx` });
    } catch (err) { fallo(err, 'No se pudo exportar'); }
    loading(false);
  });

  /**
   * Arma un ZIP con el Excel y las facturas de `lista`.
   * @returns {{ blob, incluidos: Map<adjuntoId, rutaEnZip>, fallidos: number }}
   */
  async function generarZip(lista, nombre, progreso, notaExtra = []) {
    await Promise.all([cargarXLSX(), cargarZip()]);
    const zip = new JSZip();
    const tareas = lista.flatMap((g) => (g.adjuntos || []).map((a, j) => ({ g, a, ruta: rutaEnZip(g, a, j) })));
    const fallidos = [];
    let hechos = 0;
    const cola = [...tareas];
    await Promise.all(Array.from({ length: Math.min(4, cola.length) }, async () => {
      while (cola.length) {
        const t = cola.shift();
        const { data, error } = await sb.storage.from(CFG.BUCKET).download(t.a.ruta);
        if (error || !data) fallidos.push(t); else zip.file(t.ruta, data);
        progreso(`Descargando facturas… ${++hechos} de ${tareas.length}`);
      }
    }));
    const incluidos = new Map(tareas.filter((t) => !fallidos.includes(t)).map((t) => [t.a.id, t.ruta]));
    const wb = construirLibro(lista, (g) => (g.adjuntos || []).filter((a) => incluidos.has(a.id))
      .map((a) => ({ texto: incluidos.get(a.id).split('/').pop(), url: incluidos.get(a.id) })));
    zip.file(`${nombre}.xlsx`, XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
    zip.file('LEEME.txt', [
      'Exportación de Mis Gastos',
      `Generado: ${new Date().toLocaleString('es-CO')}`,
      `Gastos: ${lista.length} · Total: ${fmt(suma(lista))} · Facturas: ${incluidos.size}`,
      ...notaExtra,
      '',
      '1. Descomprime TODO el .zip en una carpeta (no lo abras desde dentro del .zip).',
      `2. Abre ${nombre}.xlsx: en la hoja "Gastos", las columnas "Factura N" son vínculos que abren cada archivo.`,
      '3. La hoja "Productos" tiene el detalle de lo comprado en cada gasto.',
      ...(fallidos.length ? ['', `Atención: no se pudieron descargar ${fallidos.length} factura(s).`] : []),
    ].join('\r\n'));
    progreso('Comprimiendo…');
    const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
    return { blob, incluidos, fallidos: fallidos.length };
  }

  $('#exp-zip').addEventListener('click', async () => {
    const { nombre, lista } = gastosExport();
    if (!lista.length) return toast('No hay gastos para exportar', true);
    const btn = $('#exp-zip');
    btn.disabled = true;
    try {
      progresoExport('Preparando…');
      const r = await generarZip(lista, nombre, progresoExport);
      descargar(r.blob, `${nombre}.zip`);
      registrarExport({ tipo: 'zip', periodo: nombre.replace('gastos_', ''), lista, facturas: r.incluidos.size, tamano: r.blob.size, nombre: `${nombre}.zip` });
      progresoExport(r.fallidos ? `Listo, pero ${r.fallidos} factura(s) no se pudieron descargar.` : `Listo: ${lista.length} gastos y ${r.incluidos.size} facturas.`);
      setTimeout(() => progresoExport(null), 6000);
    } catch (err) {
      progresoExport(null);
      fallo(err, 'No se pudo exportar');
    }
    btn.disabled = false;
  });

  // ---------- Archivo: respaldo local + limpieza de la nube ----------
  const PREF = {
    get auto() { return store.get('archivoAuto') !== '0'; },
    get umbral() { return Number(store.get('archivoUmbral')) || 85; },
    get borrarGastos() { return store.get('archivoBorrarGastos') === '1'; },
  };
  const MAX_LOTE = 200 * 1024 * 1024; // tope por ZIP para no agotar la memoria del celular
  const usoNube = () => todosLosGastos().reduce((a, g) => a + (g.adjuntos || []).reduce((b, x) => b + (Number(x.tamano) || 0), 0), 0);
  const pesoGasto = (g) => (g.adjuntos || []).reduce((b, x) => b + (Number(x.tamano) || 0), 0);
  const nombreMesCorto = (k) => { const [y, m] = k.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('es-CO', { month: 'short', year: 'numeric' }); };

  /**
   * Elige los meses más antiguos con facturas en la nube.
   * hasta: 'AAAA-MM' (manual) o null (automático: liberar hasta dejar el uso en 60 %).
   * Nunca incluye el mes actual ni el anterior en modo automático.
   */
  function planArchivo(hasta = null) {
    const porMes = new Map();
    for (const g of S.gastos) {
      const k = g.fecha.slice(0, 7);
      if (!porMes.has(k)) porMes.set(k, []);
      porMes.get(k).push(g);
    }
    const limiteAuto = ym(sumarMeses(primeroDeMes(new Date()), -1));
    const meses = [...porMes.keys()].sort().filter((k) => (hasta ? k <= hasta : k < limiteAuto))
      .filter((k) => porMes.get(k).some((g) => g.adjuntos?.length));
    const objetivo = hasta ? Infinity : Math.max(0, usoNube() - LIMITE_GRATIS * 0.6);
    const elegidos = [];
    let bytes = 0;
    for (const k of meses) {
      const pesoMes = porMes.get(k).reduce((a, g) => a + pesoGasto(g), 0);
      if (elegidos.length && bytes + pesoMes > MAX_LOTE) break;
      elegidos.push(k);
      bytes += pesoMes;
      if (bytes >= objetivo) break;
    }
    const lista = elegidos.flatMap((k) => porMes.get(k)).sort((a, b) => a.fecha.localeCompare(b.fecha) || a.id - b.id);
    const periodo = elegidos.length ? (elegidos.length === 1 ? elegidos[0] : `${elegidos[0]} a ${elegidos[elegidos.length - 1]}`) : '';
    return { meses: elegidos, lista, bytes, facturas: nFacturas(lista), periodo, quedan: meses.length - elegidos.length };
  }

  const A = { paso: null, plan: null, zip: null, nombre: null };
  function abrirArchivo(plan, motivo) {
    if (!plan.lista.length || !plan.facturas) { toast('No hay facturas antiguas para archivar', true); return; }
    if (!S.v4 && !PREF.borrarGastos) { toast("Para archivar, primero ejecuta supabase/migraciones/004_historial_y_archivo.sql en Supabase.", true); return; }
    Object.assign(A, { paso: 'resumen', plan, motivo, zip: null, nombre: `gastos_archivo_${plan.periodo.replace(/ a /, '_a_')}` });
    pintarArchivo();
    if (!$('#dlg-archivo').open) $('#dlg-archivo').showModal();
  }

  function pintarArchivo(msg = '') {
    const p = A.plan;
    const body = $('#archivo-body');
    const pie = $('#archivo-pie');
    const rango = p.meses.length === 1 ? nombreMesCorto(p.meses[0]) : `${nombreMesCorto(p.meses[0])} – ${nombreMesCorto(p.meses[p.meses.length - 1])}`;
    const uso = usoNube();
    const pct = Math.round((uso / LIMITE_GRATIS) * 100);
    if (A.paso === 'resumen') {
      body.innerHTML = `
        ${A.motivo === 'auto' ? `<div class="aviso-rep"><b>Tu almacenamiento está al ${pct} %</b> (${Compresor.formatoBytes(uso)} de 1 GB). Para que sigan cabiendo facturas nuevas, conviene archivar las más antiguas.</div>` : ''}
        <dl class="det-rows">
          <dt>Periodo</dt><dd>${esc(rango)}</dd>
          <dt>Gastos</dt><dd>${p.lista.length}</dd>
          <dt>Facturas</dt><dd>${p.facturas}</dd>
          <dt>Espacio a liberar</dt><dd>${Compresor.formatoBytes(p.bytes)}</dd>
        </dl>
        <ol class="pasos">
          <li><b>Descarga local:</b> se guardará <i>${esc(A.nombre)}.zip</i> con el Excel y todas esas facturas.</li>
          <li><b>Confirmas</b> que el archivo quedó en tu equipo o celular.</li>
          <li><b>Limpieza de la nube:</b> ${PREF.borrarGastos ? 'se borran esos gastos y sus facturas' : 'se borran las facturas; los gastos se conservan marcados como "📦 archivada"'}.</li>
        </ol>
        ${p.quedan ? `<p class="muted small">Quedan ${p.quedan} mes(es) más antiguos; si aún falta espacio, la app te propondrá otro lote.</p>` : ''}`;
      pie.innerHTML = `<button class="btn" type="button" data-arch="despues">${A.motivo === 'auto' ? 'Más tarde' : 'Cancelar'}</button>
        <button class="btn btn-primary" type="button" data-arch="descargar">Descargar respaldo</button>`;
    } else if (A.paso === 'trabajando') {
      body.innerHTML = `<div class="arch-prog"><span class="spinner"></span><p>${esc(msg || 'Preparando…')}</p><p class="muted small">No cierres la app.</p></div>`;
      pie.innerHTML = '';
    } else if (A.paso === 'confirmar') {
      body.innerHTML = `
        <div class="arch-ok">⬇️</div>
        <p><b>Se descargó ${esc(A.nombre)}.zip</b> (${Compresor.formatoBytes(A.zip.blob.size)}) con ${A.zip.incluidos.size} factura(s).</p>
        ${A.zip.fallidos ? `<div class="aviso-rep">${A.zip.fallidos} factura(s) no se pudieron descargar y <b>no se borrarán</b> de la nube.</div>` : ''}
        <p class="muted">Revisa que el archivo esté en tu carpeta de <b>Descargas</b> (o en <b>Archivos</b> en iPhone). Cuando confirmes, se liberará el espacio en la nube. <b>Esto no se puede deshacer.</b></p>`;
      pie.innerHTML = `<button class="btn" type="button" data-arch="otra-vez">Descargar de nuevo</button>
        <button class="btn btn-danger" type="button" data-arch="liberar">Ya lo tengo, liberar espacio</button>`;
    } else if (A.paso === 'listo') {
      body.innerHTML = `<div class="arch-ok">✅</div><p style="text-align:center"><b>${esc(msg)}</b></p>
        <p class="muted small" style="text-align:center">El respaldo quedó registrado en el historial de descargas.</p>`;
      pie.innerHTML = '<button class="btn btn-primary" type="button" data-arch="cerrar">Listo</button>';
    }
  }

  $('#archivo-pie').addEventListener('click', async (e) => {
    const accion = e.target.closest('[data-arch]')?.dataset.arch;
    if (!accion) return;
    if (accion === 'despues') {
      if (A.motivo === 'auto') store.set('archivoPosponer', String(Date.now() + 24 * 3600 * 1000));
      $('#dlg-archivo').close();
    } else if (accion === 'cerrar') {
      $('#dlg-archivo').close();
    } else if (accion === 'otra-vez') {
      descargar(A.zip.blob, `${A.nombre}.zip`);
    } else if (accion === 'descargar') {
      A.paso = 'trabajando';
      pintarArchivo();
      try {
        A.zip = await generarZip(A.plan.lista, A.nombre, (m) => pintarArchivo(m), [
          `Respaldo de archivo: estas facturas se borraron de la nube el ${new Date().toLocaleDateString('es-CO')} para liberar espacio.`,
          'GUARDA ESTE ARCHIVO: es la única copia de esas facturas.',
        ]);
        descargar(A.zip.blob, `${A.nombre}.zip`);
        A.paso = 'confirmar';
        pintarArchivo();
      } catch (err) {
        A.paso = 'resumen';
        pintarArchivo();
        fallo(err, 'No se pudo crear el respaldo');
      }
    } else if (accion === 'liberar') {
      A.paso = 'trabajando';
      pintarArchivo('Liberando espacio en la nube…');
      try {
        const liberado = await limpiarNube(A.plan.lista, A.zip.incluidos, A.nombre);
        await registrarExport({ tipo: 'archivo', periodo: A.plan.periodo, lista: A.plan.lista, facturas: A.zip.incluidos.size,
          tamano: A.zip.blob.size, liberado, nombre: `${A.nombre}.zip` });
        A.zip = null; // libera memoria
        await cargarGastos();
        refrescar();
        A.paso = 'listo';
        pintarArchivo(`Se liberaron ${Compresor.formatoBytes(liberado)} en la nube`);
      } catch (err) {
        await cargarGastos().catch(() => {});
        A.paso = 'confirmar';
        pintarArchivo();
        fallo(err, 'La limpieza no terminó (lo ya respaldado se puede reintentar)');
      }
    }
  });

  /** Borra de la nube solo las facturas que quedaron dentro del ZIP. Devuelve los bytes liberados. */
  async function limpiarNube(lista, incluidos, nombre) {
    const adj = lista.flatMap((g) => (g.adjuntos || []).filter((a) => incluidos.has(a.id)).map((a) => ({ ...a, gasto_id: g.id })));
    let liberado = 0;
    for (let i = 0; i < adj.length; i += 100) {
      const lote = adj.slice(i, i + 100);
      const r = await sb.storage.from(CFG.BUCKET).remove(lote.map((a) => a.ruta));
      if (r.error) throw r.error;
      const d = await sb.from('adjuntos').delete().in('id', lote.map((a) => a.id));
      if (d.error) throw d.error;
      liberado += lote.reduce((s, a) => s + (Number(a.tamano) || 0), 0);
    }
    // Gastos cuyo respaldo quedó completo (todas sus facturas en el ZIP)
    const completos = lista.filter((g) => (g.adjuntos || []).every((a) => incluidos.has(a.id))).map((g) => g.id);
    const conFactura = lista.filter((g) => (g.adjuntos || []).some((a) => incluidos.has(a.id))).map((g) => g.id);
    for (let i = 0; i < Math.max(completos.length, conFactura.length); i += 200) {
      if (PREF.borrarGastos) {
        const ids = completos.slice(i, i + 200);
        if (ids.length) { const r = await sb.from('gastos').delete().in('id', ids); if (r.error) throw r.error; }
      } else {
        const ids = conFactura.slice(i, i + 200);
        if (ids.length && S.v4) {
          const r = await sb.from('gastos').update({ archivado_en: new Date().toISOString(), archivo_respaldo: `${nombre}.zip` }).in('id', ids);
          if (r.error) throw r.error;
        }
      }
    }
    return liberado;
  }

  /** Revisa el uso al abrir la app o al guardar; si pasó el umbral, propone archivar. */
  function chequearLimite() {
    if (!PREF.auto || $('#dlg-archivo').open || $('#dlg-gasto').open) return;
    if (Number(store.get('archivoPosponer') || 0) > Date.now()) return;
    if (usoNube() < LIMITE_GRATIS * (PREF.umbral / 100)) return;
    const plan = planArchivo(null);
    if (plan.facturas) abrirArchivo(plan, 'auto');
  }

  // Controles de Ajustes
  function renderArchivoAjustes() {
    $('#arch-auto').checked = PREF.auto;
    $('#arch-umbral').value = String(PREF.umbral);
    $('#arch-borrar').checked = PREF.borrarGastos;
    if (!$('#arch-hasta').value) $('#arch-hasta').value = ym(sumarMeses(primeroDeMes(new Date()), -2));
    const archivados = S.gastos.filter((g) => g.archivado_en).length;
    $('#arch-estado').textContent = `Umbral: ${PREF.umbral} % de 1 GB (${Compresor.formatoBytes(LIMITE_GRATIS * PREF.umbral / 100)}).${archivados ? ` ${archivados} gasto(s) con facturas archivadas.` : ''}`;
  }
  $('#arch-auto').addEventListener('change', (e) => { store.set('archivoAuto', e.target.checked ? '1' : '0'); renderArchivoAjustes(); });
  $('#arch-umbral').addEventListener('change', (e) => { store.set('archivoUmbral', e.target.value); renderArchivoAjustes(); });
  $('#arch-borrar').addEventListener('change', (e) => { store.set('archivoBorrarGastos', e.target.checked ? '1' : '0'); });
  $('#arch-ahora').addEventListener('click', () => {
    const hasta = $('#arch-hasta').value;
    if (!hasta) return toast('Elige hasta qué mes archivar', true);
    abrirArchivo(planArchivo(hasta), 'manual');
  });

  // ---------- Diálogos ----------
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-close]');
    if (b) b.closest('dialog').close();
  });
  // Cerrar tocando fuera del contenido
  $$('dialog').forEach((d) => d.addEventListener('click', (e) => { if (e.target === d) d.close(); }));
  $('#dlg-gasto').addEventListener('close', () => {
    const E = S.edit;
    if (E?.cola) {
      // Factura de la cola: su archivo sigue en la lista. Si se cerró sin guardar, se vuelve a la lista.
      if (!E.guardado && S.cola) { S.cola.unoAUno = false; abrirCola(); }
      return;
    }
    E?.nuevos.forEach((n) => n.preview && URL.revokeObjectURL(n.preview));
  });

  // ---------- PWA ----------
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* opcional */ });
  }

  iniciar().catch((e) => { fallo(e, 'Error al iniciar'); mostrarLogin(); });
})();
