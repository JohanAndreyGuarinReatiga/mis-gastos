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
    return `<li class="item" data-id="${g.id}">
      <span class="item-ico" style="background:${esc(c.color)}22">${esc(c.icono)}</span>
      <div class="item-main"><div class="item-title">${esc(titulo)}</div><div class="item-sub">${esc(sub)}</div></div>
      <div class="item-amount">${fmt(g.monto)}<small>${nAdj ? `📎 ${nAdj}` : 'sin factura'}</small></div>
    </li>`;
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
      <div class="field">
        <span class="field-label">Facturas (${adj.length})</span>
        <div class="adj-grid" id="det-adj">${adj.length ? adj.map(() => '<div class="adj"><div class="spinner"></div></div>').join('') : '<p class="muted">Sin facturas adjuntas.</p>'}</div>
      </div>`;
    $('#dlg-detalle').showModal();
    if (adj.length) {
      try {
        const urls = await urlsFirmadas(adj.map((a) => a.ruta));
        if (S.detalle !== g) return;
        $('#det-adj').innerHTML = adj.map((a) => adjHTML(a, urls[a.ruta])).join('');
      } catch (e) { fallo(e, 'No se pudieron cargar las facturas'); }
    }
  }

  function adjHTML(a, url, borrable = false) {
    const del = borrable ? `<button type="button" class="adj-del" data-del="${esc(a.key)}" aria-label="Quitar">✕</button>` : '';
    if (esPDF(a.tipo)) {
      return `<a class="adj" href="${esc(url || '#')}" target="_blank" rel="noopener"><div class="adj-pdf"><b>📄</b>${esc(a.nombre || 'PDF')}</div>${del}</a>`;
    }
    return `<div class="adj" data-img="${esc(url || '')}"><img src="${esc(url || '')}" alt="${esc(a.nombre || 'Factura')}" loading="lazy">${del}</div>`;
  }

  document.addEventListener('click', (e) => {
    const im = e.target.closest('.adj[data-img]');
    if (im && !e.target.closest('.adj-del') && im.dataset.img) {
      $('#visor-img').src = im.dataset.img;
      $('#dlg-visor').showModal();
    }
  });

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
    };
    if (!S.cats.some((c) => c.id === S.edit.catId)) S.edit.catId = g ? null : S.cats[0]?.id ?? null;
    $('#form-title').textContent = g ? 'Editar gasto' : 'Nuevo gasto';
    fG.monto.value = g ? `$ ${fmtNum.format(g.monto)}` : '';
    fG.fecha.value = g?.fecha || ymd(new Date());
    fG.metodo_pago.value = g?.metodo_pago || store.get('ultimoPago') || '';
    fG.proveedor.value = g?.proveedor || '';
    fG.descripcion.value = g?.descripcion || '';
    $('#proveedores').innerHTML = [...new Set(S.gastos.map((x) => x.proveedor).filter(Boolean))].slice(0, 200).map((p) => `<option value="${esc(p)}">`).join('');
    renderChips();
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
    renderChips();
  });

  async function renderAdjForm() {
    const E = S.edit;
    const vivos = E.existentes.filter((a) => !E.borrar.includes(a.id));
    let urls = {};
    if (vivos.length) {
      try { urls = await urlsFirmadas(vivos.map((a) => a.ruta)); } catch (e) { fallo(e, 'No se pudieron cargar las facturas'); }
    }
    if (S.edit !== E) return;
    $('#form-adjuntos').innerHTML =
      vivos.map((a) => adjHTML(a, urls[a.ruta], true)).join('') +
      E.nuevos.map((n) => adjHTML({ key: n.key, tipo: n.file.type, nombre: n.file.name }, n.preview, true)).join('');
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
    for (const f0 of files) {
      if (!(f0.type.startsWith('image/') || esPDF(f0.type))) { toast(`${f0.name}: solo imágenes o PDF`, true); continue; }
      const f = await comprimir(f0);
      if (f.size > MAX_FILE) { toast(`${f.name} supera 10 MB`, true); continue; }
      const puedePrevisualizar = f.type.startsWith('image/') && !/hei[cf]/.test(f.type);
      S.edit.nuevos.push({ key: `n${Math.random().toString(36).slice(2)}`, file: f, preview: puedePrevisualizar ? URL.createObjectURL(f) : '' });
    }
    renderAdjForm();
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
      fallo(err, 'No se pudo guardar');
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
  function filasExport() {
    const todo = $('#exp-todo').checked;
    const mes = $('#exp-mes').value;
    const lista = S.gastos.filter((g) => todo || !mes || g.fecha.startsWith(mes)).slice().sort((a, b) => a.fecha.localeCompare(b.fecha));
    return {
      nombre: `gastos_${todo || !mes ? 'historial' : mes}`,
      filas: lista.map((g) => ({
        Fecha: g.fecha,
        Categoría: catDe(g.categoria_id).nombre,
        Proveedor: g.proveedor || '',
        Descripción: g.descripcion || '',
        'Método de pago': g.metodo_pago || '',
        Monto: g.monto,
        Facturas: g.adjuntos?.length || 0,
      })),
    };
  }

  function descargar(blob, nombre) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = nombre;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  $('#exp-csv').addEventListener('click', () => {
    const { nombre, filas } = filasExport();
    if (!filas.length) return toast('No hay gastos para exportar', true);
    const cols = Object.keys(filas[0]);
    const celda = (v) => (/[";\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v);
    // Separador ";" para que Excel en español (Colombia) lo abra en columnas.
    const csv = [cols.join(';'), ...filas.map((f) => cols.map((c) => celda(f[c])).join(';'))].join('\r\n');
    descargar(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }), `${nombre}.csv`);
  });

  let xlsxCargado;
  const cargarXLSX = () => (xlsxCargado ||= new Promise((ok, mal) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
    s.onload = ok;
    s.onerror = () => { xlsxCargado = null; mal(new Error('No se pudo cargar la librería de Excel')); };
    document.head.appendChild(s);
  }));

  $('#exp-xlsx').addEventListener('click', async () => {
    const { nombre, filas } = filasExport();
    if (!filas.length) return toast('No hay gastos para exportar', true);
    loading(true);
    try {
      await cargarXLSX();
      const ws = XLSX.utils.json_to_sheet(filas);
      ws['!cols'] = [{ wch: 11 }, { wch: 16 }, { wch: 24 }, { wch: 32 }, { wch: 15 }, { wch: 14 }, { wch: 9 }];
      const total = filas.length + 1;
      XLSX.utils.sheet_add_aoa(ws, [['', '', '', '', 'TOTAL', { t: 'n', f: `SUM(F2:F${total})` }]], { origin: -1 });
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Gastos');
      XLSX.writeFile(wb, `${nombre}.xlsx`);
    } catch (err) { fallo(err, 'No se pudo exportar'); }
    loading(false);
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
