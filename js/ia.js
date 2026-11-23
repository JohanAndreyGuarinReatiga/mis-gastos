/* Lectura de facturas con IA (opcional): Google Gemini, plan gratuito.
 *
 * - Usa la llave (API key) que el usuario crea en Google AI Studio; se guarda solo
 *   en este dispositivo (localStorage) y nunca se sube al repositorio ni a Supabase.
 * - Elige sola el modelo "Flash-Lite" más reciente disponible para la llave
 *   (el que más solicitudes gratuitas permite al día).
 * - Cuenta las solicitudes del día (la cuota de Google se reinicia a medianoche,
 *   hora del Pacífico). Si la cuota se agota, deja de llamarla hasta el día
 *   siguiente: la app sigue funcionando con el lector local.
 *
 * Expone window.IAFacturas = { config, guardarConfig, activa, uso, analizar, probar, modelo }.
 */
(() => {
  'use strict';

  const API = 'https://generativelanguage.googleapis.com/v1beta';
  const MODELO_RESPALDO = 'gemini-flash-lite-latest';
  const LIMITE_DEFECTO = 500; // solicitudes/día que Google suele dar gratis a Flash-Lite (puede cambiar)

  const ls = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* sin almacenamiento */ } },
  };
  const json = (k, def) => { try { return JSON.parse(ls.get(k)) ?? def; } catch { return def; } };

  /** Día de la cuota de Google (medianoche del Pacífico). */
  const diaCuota = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });

  function config() {
    return { llave: ls.get('iaLlave') || '', activa: ls.get('iaActiva') === '1', limite: Number(ls.get('iaLimite')) || LIMITE_DEFECTO };
  }
  function guardarConfig({ llave, activa, limite } = {}) {
    if (llave !== undefined) { if (llave) ls.set('iaLlave', llave.trim()); else ls.del('iaLlave'); ls.del('iaModelo'); }
    if (activa !== undefined) ls.set('iaActiva', activa ? '1' : '0');
    if (limite !== undefined) ls.set('iaLimite', String(Math.max(1, Math.round(limite) || LIMITE_DEFECTO)));
  }

  /** { dia, usadas, agotada, limite, ultimoError } */
  function uso() {
    const u = json('iaUso', {});
    const hoy = diaCuota();
    const c = config();
    if (u.dia !== hoy) return { dia: hoy, usadas: 0, agotada: false, limite: c.limite, ultimoError: u.ultimoError || null };
    return { dia: hoy, usadas: u.usadas || 0, agotada: !!u.agotada, limite: c.limite, ultimoError: u.ultimoError || null };
  }
  function registrar(cambios) {
    const u = { ...uso(), ...cambios };
    ls.set('iaUso', JSON.stringify({ dia: u.dia, usadas: u.usadas, agotada: u.agotada, ultimoError: u.ultimoError }));
    window.dispatchEvent(new CustomEvent('ia-uso'));
  }

  /** ¿Se puede usar ahora? (configurada, activada y con cupo hoy) */
  function activa() {
    const c = config();
    return !!(c.llave && c.activa && !uso().agotada);
  }

  async function pedir(url, opts = {}, ms = 60000) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ms);
    try {
      const r = await fetch(url, { ...opts, signal: ctl.signal, headers: { 'x-goog-api-key': config().llave, ...(opts.headers || {}) } });
      const cuerpo = await r.json().catch(() => ({}));
      if (!r.ok) {
        const e = new Error(cuerpo.error?.message || `HTTP ${r.status}`);
        e.status = r.status;
        e.detalle = cuerpo.error;
        throw e;
      }
      return cuerpo;
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('La IA tardó demasiado en responder');
      throw e;
    } finally { clearTimeout(t); }
  }

  /** Modelo Flash-Lite más reciente que acepta esta llave (se recuerda 7 días). */
  async function modelo() {
    const guardado = json('iaModelo', null);
    if (guardado && Date.now() - guardado.t < 7 * 864e5) return guardado.nombre;
    let nombre = MODELO_RESPALDO;
    try {
      const d = await pedir(`${API}/models?pageSize=1000`, {}, 15000);
      const version = (n) => Number((/gemini-(\d+(?:\.\d+)?)/.exec(n) || [])[1]) || 0;
      const cand = (d.models || [])
        .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
        .map((m) => m.name.replace(/^models\//, ''))
        .filter((n) => /flash-lite/.test(n) && !/preview|exp|tts|image|live|audio|thinking/.test(n))
        .sort((a, b) => version(b) - version(a) || a.length - b.length);
      if (cand[0]) nombre = cand[0];
    } catch (e) { console.warn('IA: no se pudo listar modelos', e); }
    ls.set('iaModelo', JSON.stringify({ nombre, t: Date.now() }));
    return nombre;
  }

  const aBase64 = async (blob) => {
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return btoa(s);
  };

  function esquema(categorias) {
    return {
      type: 'OBJECT',
      properties: {
        proveedor: { type: 'STRING', description: 'Nombre comercial del emisor (no la razón social completa si hay un nombre comercial claro)' },
        nit: { type: 'STRING', description: 'NIT o identificación tributaria del emisor, con dígito de verificación si aparece' },
        numero_factura: { type: 'STRING' },
        fecha: { type: 'STRING', description: 'Fecha de la factura en formato AAAA-MM-DD' },
        moneda: { type: 'STRING', enum: ['COP', 'USD'] },
        total: { type: 'NUMBER', description: 'Total pagado. COP sin decimales; USD con centavos' },
        metodo_pago: { type: 'STRING', enum: ['Efectivo', 'Débito', 'Crédito', 'Transferencia', 'Nequi', 'Daviplata', 'Otro'] },
        categoria: { type: 'STRING', ...(categorias.length ? { enum: categorias } : {}) },
        descripcion: { type: 'STRING', description: 'Resumen corto del gasto en español, máximo 60 caracteres' },
        recurrente: { type: 'BOOLEAN', description: 'true si es una suscripción, servicio público, plan de telefonía/internet, cuota o débito automático que se cobra cada mes' },
        productos: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              descripcion: { type: 'STRING', description: 'Nombre claro del producto o servicio en español, sin abreviaturas' },
              cantidad: { type: 'NUMBER' },
              valor: { type: 'NUMBER', description: 'Valor total de la línea (cantidad × unitario), en la moneda de la factura' },
            },
            required: ['descripcion', 'valor'],
          },
        },
      },
      required: ['productos'],
    };
  }

  const PROMPT = `Analiza esta factura, tiquete de compra o recibo (normalmente de Colombia) y extrae sus datos.
Reglas:
- Lista TODOS los productos o servicios cobrados, uno por línea, con una descripción clara en español: expande las abreviaturas del tiquete (por ejemplo "LCH ENT ALQ 1L" → "Leche entera Alquería 1 L") sin inventar marcas que no aparezcan.
- "valor" es el total de cada línea. No incluyas como productos el subtotal, el IVA, descuentos globales, propinas ni el total.
- Montos como números sin separadores de miles (12500, no "12.500").
- Si un dato no aparece en el documento, déjalo vacío; no lo inventes.
- "descripcion": de qué fue el gasto, en pocas palabras (por ejemplo "Mercado de la semana", "Plan Premium mensual", "Energía y acueducto de octubre").`;

  const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

  /**
   * Interpreta una factura con IA.
   * @param {File|Blob} file  imagen o PDF (sin contraseña)
   * @param {{categorias?: string[]}} opts
   * @returns {Promise<object|null>} datos con el mismo formato del lector local, o null si no está activa
   */
  async function analizar(file, opts = {}) {
    if (!activa()) return null;
    const tipo = file.type || (/\.pdf$/i.test(file.name || '') ? 'application/pdf' : 'image/jpeg');
    if (file.size > 18 * 1024 * 1024) throw new Error('archivo muy grande para la IA');
    let nombre = await modelo();
    const categorias = opts.categorias || [];
    const cuerpo = {
      contents: [{ role: 'user', parts: [{ inline_data: { mime_type: tipo, data: await aBase64(file) } }, { text: PROMPT + formato(categorias) }] }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: esquema(categorias) },
    };
    let reintentoMinuto = false, reintentoServidor = false, reintentoModelo = false;
    for (;;) {
      try {
        const d = await pedir(`${API}/models/${nombre}:generateContent`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo),
        });
        registrar({ usadas: uso().usadas + 1 });
        const r = normalizar(leerJSON(d));
        registrar({ ultimoError: null, ultimoOk: new Date().toISOString() });
        return r;
      } catch (e) {
        const msg = e.message || String(e);
        if (e.status === 429) {
          const det = JSON.stringify(e.detalle || {});
          const porDia = /PerDay|per day|daily/i.test(det) || /PerDay/i.test(msg);
          const espera = Number((/"retryDelay":"(\d+)/.exec(det) || [])[1]) || 20;
          // Límite por minuto: se espera lo que indica Google y se reintenta (una vez).
          if (!porDia && !reintentoMinuto && espera <= 60) { reintentoMinuto = true; await esperar(espera * 1000 + 500); continue; }
          if (porDia) registrar({ agotada: true, usadas: Math.max(uso().usadas, uso().limite), ultimoError: 'Se agotó la cuota gratuita de hoy' });
          else registrar({ ultimoError: 'Demasiadas solicitudes seguidas; se usó el lector local' });
          throw Object.assign(new Error(porDia ? 'sin cupo hoy' : 'demasiadas solicitudes seguidas'), { status: 429 });
        }
        if ((e.status === 400 || e.status === 403) && /API key|API_KEY|permission|PERMISSION_DENIED/i.test(msg)) {
          registrar({ ultimoError: 'La llave no es válida o no tiene permiso' });
          throw Object.assign(new Error('la llave no es válida'), { status: e.status });
        }
        // Formato de respuesta no aceptado por este modelo: se reintenta sin el esquema
        // (las instrucciones del formato ya van en el texto).
        if (e.status === 400 && cuerpo.generationConfig.responseSchema) { delete cuerpo.generationConfig.responseSchema; continue; }
        if (e.status === 404 && !reintentoModelo) { reintentoModelo = true; ls.del('iaModelo'); nombre = MODELO_RESPALDO; continue; }
        // Google saturado (500/503) o respuesta ilegible: un reintento corto.
        if ((e.status >= 500 || e.sinTexto) && !reintentoServidor) { reintentoServidor = true; await esperar(2500); continue; }
        registrar({ ultimoError: msg });
        throw e;
      }
    }
  }

  /** Extrae el JSON de la respuesta (tolera ```json ... ``` y texto alrededor). */
  function leerJSON(d) {
    const c = d.candidates?.[0];
    const txt = (c?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || '').join('').trim();
    if (!txt) {
      const motivo = c?.finishReason || d.promptFeedback?.blockReason || 'respuesta vacía';
      throw Object.assign(new Error(`la IA no devolvió datos (${motivo})`), { sinTexto: true });
    }
    try { return JSON.parse(txt); } catch { /* sigue */ }
    const m = /\{[\s\S]*\}/.exec(txt.replace(/```(?:json)?/g, ''));
    if (m) { try { return JSON.parse(m[0]); } catch { /* sigue */ } }
    throw Object.assign(new Error('la IA respondió en un formato que no se pudo leer'), { sinTexto: true });
  }

  /** Formato pedido, en texto (sirve también cuando el modelo no acepta el esquema). */
  const formato = (categorias) => `
Responde SOLO con un objeto JSON con estas claves (omite las que no apliquen):
{"proveedor": texto, "nit": texto, "numero_factura": texto, "fecha": "AAAA-MM-DD", "moneda": "COP" o "USD", "total": número,
 "metodo_pago": uno de Efectivo|Débito|Crédito|Transferencia|Nequi|Daviplata|Otro,${categorias.length ? ` "categoria": uno de ${categorias.join('|')},` : ''}
 "descripcion": texto corto, "recurrente": true o false, "productos": [{"descripcion": texto, "cantidad": número, "valor": número}]}`;

  const num = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; };

  /** Al formato del lector local. */
  function normalizar(j) {
    const usd = j.moneda === 'USD';
    const r = { fuentes: ['IA'] };
    if (j.proveedor) r.proveedor = String(j.proveedor).trim();
    if (j.nit) r.nit = String(j.nit).trim();
    if (j.numero_factura) r.numero = String(j.numero_factura).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(j.fecha || '')) r.fecha = j.fecha;
    if (usd) r.moneda = 'USD';
    const total = num(j.total);
    if (total) { r.monto = usd ? Math.round(total * 100) / 100 : Math.round(total); r.montoSeguro = true; }
    if (j.metodo_pago) r.metodo_pago = j.metodo_pago;
    if (j.categoria) r.categoria = j.categoria;
    if (j.descripcion) r.descripcion = String(j.descripcion).trim().slice(0, 80);
    if (j.recurrente) r.recurrente = true;
    const items = (j.productos || []).map((p) => ({
      descripcion: String(p.descripcion || '').trim().slice(0, 80),
      cantidad: num(p.cantidad) || 1,
      valor: usd ? Math.round((num(p.valor) || 0) * 100) / 100 : Math.round(num(p.valor) || 0),
    })).filter((p) => p.descripcion && p.valor);
    if (items.length) r.items = items.slice(0, 80);
    return r;
  }

  /** Verifica la llave con una solicitud mínima. */
  async function probar() {
    const nombre = await modelo();
    await pedir(`${API}/models/${nombre}:generateContent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: 'Responde solo: ok' }] }], generationConfig: { maxOutputTokens: 5 } }),
    }, 20000);
    registrar({ usadas: uso().usadas + 1, ultimoError: null });
    return nombre;
  }

  window.IAFacturas = { config, guardarConfig, activa, uso, analizar, probar, modelo, LIMITE_DEFECTO };
})();
