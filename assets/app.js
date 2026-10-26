/* =========================================================
   Generador de Guías · ISTEL
   ========================================================= */
(() => {
  'use strict';

  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const doc = $('#doc');

  const CSRF = document.querySelector('meta[name="csrf-token"]')?.content || '';

  /* Peticiones a la API: añade el token CSRF y detecta la sesión expirada */
  async function apiFetch(url, opts = {}) {
    const o = { ...opts };
    o.headers = new Headers(opts.headers || {});
    if (String(o.method || 'GET').toUpperCase() !== 'GET') {
      o.headers.set('X-CSRF-Token', CSRF);
    }
    const res = await window.fetch(url, o);
    return res;
  }

  const state = {
    model: localStorage.getItem('guias_model_v2') || 'qwen2.5:3b',
    busy: false,
    abort: null,
    steps: [],
    mode: 'academica',
    title: 'documento',
    chapters: [],
    activeSection: null,
    activeBlock: null,
    aiHtml: '',
    aiScope: 'section',
    docId: null,
    docName: '',
    docSource: null,
  };

  const SYS = 'Eres docente del Instituto Superior Tecnológico El Libertador (ISTEL), Ecuador. ' +
    'Redactas documentos académicos en español formal, claro y técnico. ' +
    'Devuelves SOLO el contenido solicitado: sin saludos, sin comentarios, sin bloques de código, sin marcas ```.';

  /* ---------------------------------------------------------
     Utilidades
     --------------------------------------------------------- */
  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function inline(s) {
    return esc(s)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');
  }

  function cleanAiText(text) {
    let t = String(text || '').replace(/\r/g, '');
    // quitar bloques de código
    t = t.replace(/```[a-zA-Z]*\n?/g, '').replace(/```/g, '');
    // quitar preámbulos típicos
    t = t.replace(/^\s*(aqu[ií] tienes|claro[,:]?|por supuesto[,:]?|a continuaci[oó]n[,:]?)[^\n]*\n/i, '');
    // quitar cierre típico
    t = t.replace(/\n\s*(espero que (esto|te)|si necesitas|¿quieres que)[^\n]*$/i, '');
    return t.trim();
  }

  function mdToHtml(raw) {
    const text = cleanAiText(raw);
    if (!text) return '';

    const lines = text.split('\n');
    const out = [];
    let buf = [];
    let list = null;

    const flushP = () => {
      if (buf.length) { out.push('<p>' + inline(buf.join(' ')) + '</p>'); buf = []; }
    };
    const closeList = () => {
      if (list) { out.push('</' + list + '>'); list = null; }
    };
    const isRow = (l) => /^\|.*\|$/.test(l);
    const isSep = (l) => /^\|[\s:|-]+\|$/.test(l) && l.includes('-');
    const cells = (l) => l.replace(/^\||\|$/g, '').split('|').map(c => c.trim());

    for (let i = 0; i < lines.length; i++) {
      const line = (lines[i] || '').trim();

      if (!line) { flushP(); closeList(); continue; }

      // tablas markdown
      if (isRow(line) && isRow((lines[i + 1] || '').trim()) && isSep((lines[i + 1] || '').trim())) {
        flushP(); closeList();
        const head = cells(line);
        i += 2;
        const body = [];
        while (i < lines.length && isRow((lines[i] || '').trim())) {
          body.push(cells((lines[i] || '').trim()));
          i++;
        }
        i--;
        out.push('<table><thead><tr>' +
          head.map(c => `<th>${inline(c)}</th>`).join('') +
          '</tr></thead><tbody>' +
          body.map(r => '<tr>' + r.map(c => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') +
          '</tbody></table>');
        continue;
      }

      // encabezados markdown
      let m = line.match(/^(#{1,6})\s+(.*)$/);
      if (m) {
        flushP(); closeList();
        const level = Math.min(4, Math.max(2, m[1].length + 1));
        out.push(`<h${level}>${inline(m[2])}</h${level}>`);
        continue;
      }

      // viñetas
      m = line.match(/^[-•–*]\s+(.*)$/);
      if (m) {
        flushP();
        if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; }
        out.push('<li>' + inline(m[1]) + '</li>');
        continue;
      }

      // listas numeradas
      m = line.match(/^(\d+)[.)]\s+(.*)$/);
      if (m) {
        flushP();
        if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol'; }
        out.push('<li>' + inline(m[2]) + '</li>');
        continue;
      }

      closeList();
      buf.push(line);
    }
    flushP(); closeList();
    return out.join('\n');
  }

  function el(tag, cls, html) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  function setBusy(v) {
    state.busy = v;
    document.body.classList.toggle('busy', v);
    doc.setAttribute('contenteditable', v ? 'false' : 'true');
  }

  function setProgress(done, total, label) {
    $('#progress-bar').style.width = total ? ((done / total) * 100).toFixed(1) + '%' : '0%';
    $('#progress-text').textContent = label || (done + '/' + total);
  }

  function scrollToEl(node) {
    const vp = $('#viewport');
    const r = node.getBoundingClientRect();
    const vr = vp.getBoundingClientRect();
    if (r.top < vr.top || r.bottom > vr.bottom) {
      vp.scrollTop += r.top - vr.top - 80;
    }
  }

  function autoScroll(node) {
    const vp = $('#viewport');
    const nearBottom = vp.scrollTop + vp.clientHeight >= vp.scrollHeight - 260;
    if (nearBottom) vp.scrollTop = vp.scrollHeight;
    else scrollToEl(node);
  }

  /* ---------------------------------------------------------
     Ollama
     --------------------------------------------------------- */
  async function loadModels() {
    const sel = $('#model');
    const status = $('#status');
    try {
      const r = await apiFetch('api/models.php', { cache: 'no-store' });
      const data = await r.json();
      if (!r.ok || !data.models) throw new Error(data.error || 'sin modelos');
      sel.innerHTML = data.models.map(m => `<option>${esc(m)}</option>`).join('');
      if (!data.models.includes(state.model)) state.model = data.models[0] || state.model;
      sel.value = state.model;
      status.textContent = 'Ollama conectado';
      status.className = 'status on';
    } catch (e) {
      sel.innerHTML = `<option>${esc(state.model)}</option>`;
      status.textContent = 'Ollama desconectado';
      status.className = 'status off';
      status.title = 'Abre la app de Ollama o ejecuta: ollama serve';
    }
    sel.onchange = () => {
      state.model = sel.value;
      localStorage.setItem('guias_model_v2', state.model);
    };
  }

  async function streamGenerate(prompt, opts, target) {
    const ctrl = new AbortController();
    state.abort = ctrl;

    const res = await apiFetch('api/generate.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: state.model,
        system: opts.system || SYS,
        prompt,
        num_predict: opts.num_predict || 800,
        temperature: opts.temperature ?? 0.5,
      }),
      signal: ctrl.signal,
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(txt || ('Error HTTP ' + res.status));
    }
    if (!res.body) throw new Error('Este navegador no permite lectura en streaming.');

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let full = '';

    target.textContent = '';
    target.classList.add('streaming');

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      full += dec.decode(value, { stream: true });
      target.textContent = full;
      autoScroll(target);
    }
    target.classList.remove('streaming');
    return full;
  }

  function extractError(text) {
    const m = /\[ERROR\]\s*([^\n]*)/.exec(text || '');
    return m ? m[1] : null;
  }

  /* ---------------------------------------------------------
     Flujo de generación
     --------------------------------------------------------- */
  async function runSteps(steps, options = {}) {
    state.steps = steps;
    state.docId = null;       /* documento nuevo: no sobrescribe el guardado */
    state.docName = '';
    state.docSource = null;
    fillRegenSelect(steps);
    setBusy(true);
    setProgress(0, steps.length, 'Iniciando…');
    let errores = 0;

    try {
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        const target = $(step.target);
        setProgress(i, steps.length, `${i + 1}/${steps.length} · ${step.label}`);
        scrollToEl(target);
        if (target) {
          target.innerHTML = '';
          try {
            const text = await streamGenerate(step.prompt, {
              num_predict: step.num_predict,
              temperature: step.temperature,
              system: step.system,
            }, target);

            const err = extractError(text);
            state.lastText = text;
            console.debug('[gen]', step.label, (text || '').slice(0, 600));
            if (err) {
              errores++;
              target.classList.remove('streaming');
              target.innerHTML = `<p class="section-error">No se pudo generar: ${esc(err)}</p>`;
            } else if (typeof step.render === 'function') {
              await step.render(target, text);
            } else {
              target.innerHTML = mdToHtml(text) || '<p class="section-error">La IA no devolvió contenido. Intenta regenerar.</p>';
            }
          } catch (e) {
            if (e.name === 'AbortError') throw e;
            errores++;
            target.classList.remove('streaming');
            target.innerHTML = `<p class="section-error">Error: ${esc(e.message)}</p>`;
          }
        }
      }

      if (errores) {
        setProgress(steps.length, steps.length,
          `Documento listo con ${errores} error(es) · revisa o regenera las secciones marcadas`);
      } else {
        let guardado = false;
        if (options.history && hasContent()) {
          setProgress(steps.length, steps.length, 'Guardando en el historial…');
          guardado = await saveHistory();
        }
        if (guardado) {
          setProgress(steps.length, steps.length, 'Documento listo y guardado en el historial');
        } else {
          setProgress(steps.length, steps.length, 'Documento listo · puedes editarlo');
          if (options.history && hasContent()) {
            flashStatus('Documento listo · no se pudo guardar en el historial', 6000);
          }
        }
      }
    } catch (e) {
      doc.querySelectorAll('.streaming').forEach(n => n.classList.remove('streaming'));
      if (e.name === 'AbortError') {
        setProgress(0, 1, 'Generación detenida');
        $('#progress-bar').style.width = '0%';
      } else {
        setProgress(0, 1, 'Error: ' + e.message);
        $('#progress-bar').style.width = '0%';
      }
    } finally {
      state.abort = null;
      setBusy(false);
    }
  }

  function fillRegenSelect(steps) {
    const sel = $('#regen');
    sel.innerHTML = '<option value="">Regenerar sección…</option>' +
      steps.map((s, i) => `<option value="${i}">${esc(s.label)}</option>`).join('');
  }

  /* ---------------------------------------------------------
     Datos de formularios
     --------------------------------------------------------- */
  function formData(form) {
    const o = {};
    new FormData(form).forEach((v, k) => { o[k] = String(v).trim(); });
    return o;
  }

  function chaptersFromUI() {
    const max = maxParciales();
    return $$('#chapters .chapter').map((c, idx) => ({
      titulo: ($('.ch-title', c)?.value || '').trim() || `Capítulo ${idx + 1}`,
      subtemas: ($('.ch-subs', c)?.value || '')
        .split('\n').map(s => s.trim()).filter(Boolean),
      parcial: Math.min(max, Math.max(1, parseInt($('.ch-parcial', c)?.value || '1', 10) || 1)),
    }));
  }

  function maxParciales() {
    return Math.max(1, Math.min(6, parseInt($('#parciales')?.value || '1', 10) || 1));
  }

  function syncParcialOptions() {
    const max = maxParciales();
    $$('#chapters .ch-parcial').forEach(sel => {
      const actual = Math.min(max, Math.max(1, parseInt(sel.value || '1', 10) || 1));
      sel.innerHTML = Array.from({ length: max }, (_, i) =>
        `<option value="${i + 1}">Parcial ${i + 1}</option>`).join('');
      sel.value = String(actual);
    });
  }

  function quizConfig(d) {
    return {
      includeUnit: d.quiz_unidad !== undefined,
      includeExam: d.quiz_parcial !== undefined,
      parciales: Math.max(1, Math.min(6, parseInt(d.parciales || '1', 10) || 1)),
    };
  }

  /* ---------------------------------------------------------
     Cuestionarios
     --------------------------------------------------------- */
  function renderParagraphs(target, text) {
    let clean = cleanAiText(text);
    /* Si el modelo repite el título como encabezado, se elimina:
       el título ya está en el documento. */
    clean = clean.replace(/^\s*#{1,6}\s+[^\n]*\n+/, '');
    target.innerHTML = mdToHtml(clean) ||
      '<p class="section-error">La IA no devolvió contenido. Intenta regenerar.</p>';
  }

  /* Dos párrafos por llamada. Si el modelo devuelve más, se agrupan
     en dos párrafos equilibrados para mantener la estructura pedida. */
  function renderParagraphPair(target, text) {
    let clean = cleanAiText(text);
    clean = clean.replace(/^\s*#{1,6}\s+[^\n]*\n+/, '');

    let parrafos = clean
      .split(/\n\s*\n/)
      .map(p => p.replace(/\s*\n\s*/g, ' ').trim())
      .filter(Boolean);

    if (parrafos.length > 2) {
      const conteo = parrafos.map(p => p.split(/\s+/).length);
      const total = conteo.reduce((a, b) => a + b, 0);
      let acumulado = 0;
      let corte = 1;
      for (let i = 0; i < parrafos.length; i++) {
        acumulado += conteo[i];
        if (acumulado >= total / 2) { corte = i + 1; break; }
      }
      corte = Math.min(Math.max(1, corte), parrafos.length - 1);
      parrafos = [
        parrafos.slice(0, corte).join(' '),
        parrafos.slice(corte).join(' '),
      ];
    } else if (parrafos.length === 1) {
      /* Si el modelo devolvió todo en un solo bloque, se divide en dos
         párrafos por el límite de oración más cercano a la mitad. */
      const oraciones = parrafos[0].match(/[^.!?]+[.!?]+(?:\s+|$)/g) || [];
      if (oraciones.length >= 4) {
        const cuenta = oraciones.map(o => o.trim().split(/\s+/).length);
        const totalOraciones = cuenta.reduce((a, b) => a + b, 0);
        let acumulado = 0;
        let corte = 1;
        for (let i = 0; i < oraciones.length; i++) {
          acumulado += cuenta[i];
          if (acumulado >= totalOraciones / 2) { corte = i + 1; break; }
        }
        corte = Math.min(Math.max(1, corte), oraciones.length - 1);
        parrafos = [
          oraciones.slice(0, corte).join(' ').replace(/\s+/g, ' ').trim(),
          oraciones.slice(corte).join(' ').replace(/\s+/g, ' ').trim(),
        ];
      }
    }

    target.innerHTML = parrafos.map(p => `<p>${inline(p)}</p>`).join('') ||
      '<p class="section-error">La IA no devolvió contenido. Intenta regenerar.</p>';
  }

  function renderQuiz(target, text, keyTarget, keyLabel, start = 1) {
    const clean = cleanAiText(text);
    let body = clean;
    let key = '';

    const km = clean.match(
      /^#{0,4}\s*\*{0,2}\s*(?:Clave(?: de respuestas)?|Respuestas)\b[^\n]*?(?::\s*|\n+)([\s\S]*)$/im
    );
    if (km) {
      body = clean.slice(0, km.index).trim();
      key = km[1].trim();
    }

    /* Normaliza "1." y "A)" para que el visor los muestre ordenados. */
    body = body
      .replace(/^(\s*)(\d{1,2})[.)]\s+/gm, '$1**$2.** ')
      .replace(/^(\s*)\*{0,2}([A-Da-d])\)\*{0,2}\s+/gm, '$1- **$2)** ');

    target.innerHTML = mdToHtml(body) ||
      '<p class="section-error">La IA no devolvió el cuestionario. Intenta regenerar.</p>';

    /* Renumera las preguntas por si el modelo reinicia la numeración. */
    let qn = start - 1;
    target.querySelectorAll('p').forEach(p => {
      const strong = p.firstElementChild;
      if (strong && strong.tagName === 'STRONG' && /^\d{1,2}\.$/.test(strong.textContent.trim())) {
        qn += 1;
        strong.textContent = `${qn}.`;
      }
    });

    const total = qn - start + 1;
    if (keyTarget && key) setQuizKey(keyTarget, keyLabel || 'Clave de respuestas', key, total, start);
    return key;
  }

  function normalizeQuizKey(key, total, start) {
    const respuestas = [...String(key).matchAll(/(\d{1,2})\s*[-–:.)]\s*([A-D])/gi)]
      .map(m => m[2].toUpperCase());
    if (respuestas.length && total) {
      return respuestas.slice(0, total).map((r, i) => `${start + i}-${r}`).join(', ');
    }
    return key.replace(/\s+/g, ' ').trim();
  }

  function setQuizKey(keyTarget, label, key, total, start = 1) {
    keyTarget.querySelectorAll('.quiz-key-line').forEach(n => {
      if (n.dataset.label === label || n.textContent.startsWith(label + ':')) n.remove();
    });
    keyTarget.insertAdjacentHTML('beforeend',
      `<p class="quiz-key-line" data-label="${esc(label)}"><strong>${esc(label)}:</strong> ` +
      `${inline(normalizeQuizKey(key, total, start))}</p>`);
  }

  /* Si el modelo no incluyó la clave, se le pide resolviendo las preguntas ya generadas. */
  async function generateQuizKey(target, keyTarget, label, start = 1) {
    const preguntas = target.innerText.trim();
    if (!preguntas) return;

    keyTarget.innerHTML = '<p class="quiz-key-line muted">Generando clave de respuestas…</p>';
    const holder = document.createElement('div');
    const prompt =
      `A continuación tienes un cuestionario de opción múltiple. Resuelve cada pregunta y ` +
      `devuelve SOLO la clave en una línea, con el formato "1-B, 2-C, 3-A, ...", sin explicaciones ` +
      `y sin repetir las preguntas:\n\n${preguntas}`;

    let res;
    try {
      res = await streamGenerate(prompt, { num_predict: 350, temperature: 0.1 }, holder);
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      keyTarget.innerHTML = '<p class="quiz-key-line muted">No se pudo generar la clave. Revisa las respuestas.</p>';
      return;
    }

    const pares = [...String(res).matchAll(/(\d{1,2})\s*[-–:.)]\s*([A-D])/gi)]
      .map(m => `${m[1]}-${m[2].toUpperCase()}`);
    const key = pares.length ? [...new Set(pares)].join(', ') : cleanAiText(res);
    const total = [...target.querySelectorAll('p > strong')]
      .filter(s => /^\d{1,2}\.$/.test(s.textContent.trim())).length;
    keyTarget.innerHTML = '';
    if (key) setQuizKey(keyTarget, label, key, total, start);
  }

  function unitQuizPrompt(ch, n, d) {
    const subs = ch.subtemas.length
      ? `Subtemas de la unidad: ${ch.subtemas.join('; ')}.`
      : '';

    return `Elabora un cuestionario de repaso de EXACTAMENTE 10 preguntas de opción múltiple ` +
      `sobre la Unidad ${n}: "${ch.titulo}" de la asignatura "${d.asignatura}" ` +
      `(carrera: ${d.carrera}, nivel: ${d.nivel}).\n` +
      `${subs}\n` +
      `Numera las preguntas del 1 al 10; la pregunta 10 también debe llevar el número 10 ` +
      `(no reinicies la numeración).\n` +
      `Usa exactamente este formato, sin introducción, sin conclusión y sin comentarios:\n` +
      `**1.** Enunciado de la pregunta\n` +
      `- **A)** opción A\n- **B)** opción B\n- **C)** opción C\n- **D)** opción D\n\n` +
      `Continúa igual hasta la pregunta 10.\n` +
      `Al final, en una línea aparte y de forma obligatoria, escribe:\n` +
      `## Clave de respuestas\n` +
      `1-B, 2-C, 3-A, ... con las 10 respuestas. No termines el cuestionario sin la clave.\n` +
      `Reglas: una sola respuesta correcta por pregunta; tres distractores plausibles; ` +
      `cada opción debe tener como máximo 15 palabras; no expliques las opciones incorrectas; ` +
      `no uses "todas las anteriores" ni "ninguna de las anteriores"; no repitas preguntas; ` +
      `incluye preguntas de definición, comprensión y aplicación; no inventes datos institucionales.`;
  }

  function addUnitQuiz(ch, n, d, steps) {
    const page = el('section', 'page quiz-page');
    page.innerHTML = `
      <h2 class="center">CUESTIONARIO DE REPASO · UNIDAD ${n}</h2>
      <p class="quiz-sub">${esc(d.asignatura)} · ${esc(ch.titulo)}</p>
      <p class="quiz-inst"><strong>Instrucciones:</strong> resuelve las 10 preguntas de opción múltiple. ` +
      `Cada pregunta tiene una sola respuesta correcta y vale 1 punto.</p>
      <div id="q-unit-${n}"></div>
      <div class="quiz-key" id="q-unit-${n}-key"></div>`;
    doc.appendChild(page);

    steps.push({
      label: `Repaso · Unidad ${n}: ${ch.titulo}`,
      target: `#q-unit-${n}`,
      num_predict: 2000,
      temperature: 0.35,
      prompt: unitQuizPrompt(ch, n, d),
      render: async (target, text) => {
        const key = renderQuiz(target, text, $(`#q-unit-${n}-key`), 'Clave de respuestas');
        if (!key) await generateQuizKey(target, $(`#q-unit-${n}-key`), 'Clave de respuestas');
      },
    });
  }

  function examBlockPrompt(d, p, units, from, to) {
    const desc = units.map(u =>
      `Unidad ${u.n} "${u.ch.titulo}"` +
      (u.ch.subtemas.length ? ` (subtemas: ${u.ch.subtemas.join('; ')})` : '')
    ).join('; ');

    return `Elabora las preguntas ${from} a ${to} de un examen de evaluación de 30 preguntas ` +
      `del PARCIAL ${p} de la asignatura "${d.asignatura}" ` +
      `(carrera: ${d.carrera}, nivel: ${d.nivel}).\n` +
      `Unidades que evalúa este parcial: ${desc}.\n` +
      `Elabora EXACTAMENTE ${to - from + 1} preguntas y numéralas del ${from} al ${to}, ` +
      `usando el número que corresponde a cada una (no reinicies la numeración).\n` +
      `Formato exacto, sin introducción ni conclusión:\n` +
      `**${from}.** Enunciado de la pregunta\n` +
      `- **A)** opción A\n- **B)** opción B\n- **C)** opción C\n- **D)** opción D\n\n` +
      `Continúa igual hasta la pregunta ${to}.\n` +
      `Al final, en una línea aparte y de forma obligatoria, escribe:\n` +
      `## Clave de respuestas (preguntas ${from}-${to})\n` +
      `${from}-B, ${from + 1}-C, ... con las respuestas de este bloque. No termines sin la clave.\n` +
      `Reglas: una sola respuesta correcta por pregunta; tres distractores plausibles; ` +
      `cada opción debe tener como máximo 15 palabras; no expliques las opciones incorrectas; ` +
      `no uses "todas las anteriores" ni "ninguna de las anteriores"; distribuye las preguntas ` +
      `de forma equilibrada entre las unidades; dificultad media; incluye aplicación y análisis; ` +
      `no repitas preguntas; no inventes datos institucionales.`;
  }

  function addPartialExams(chapters, d, cfg, steps) {
    const keyPages = [];

    for (let p = 1; p <= cfg.parciales; p++) {
      const units = chapters
        .map((ch, i) => ({ ch, n: i + 1 }))
        .filter(u => u.ch.parcial === p);
      if (!units.length) continue;

      const page = el('section', 'page quiz-page exam-page');
      page.innerHTML = `
        <h2 class="center">EXAMEN DE EVALUACIÓN · PARCIAL ${p}</h2>
        <p class="quiz-sub">${esc(d.asignatura)} · ${esc(d.carrera)} · ${esc(d.nivel)}</p>
        <p class="quiz-data"><strong>Nombre:</strong> ______________________________ &nbsp; ` +
        `<strong>Fecha:</strong> ____________ &nbsp; <strong>Nota:</strong> ______ / 30</p>
        <p class="quiz-inst"><strong>Instrucciones:</strong> resuelve las 30 preguntas de opción múltiple. ` +
        `Cada pregunta tiene una sola respuesta correcta y vale 1 punto.</p>` +
        [1, 2, 3].map(b => {
          const from = (b - 1) * 10 + 1;
          const to = b * 10;
          return `<h3 class="quiz-block-title">Preguntas ${from} a ${to}</h3>` +
            `<div id="q-exam-${p}-b${b}"></div>`;
        }).join('');
      doc.appendChild(page);

      const keyPage = el('section', 'page quiz-page key-page');
      keyPage.innerHTML = `
        <h2 class="center">CLAVE DE RESPUESTAS · PARCIAL ${p}</h2>
        <p class="quiz-sub">Documento para el docente · ${esc(d.asignatura)}</p>
        <div id="q-exam-key-${p}"></div>`;
      keyPages.push(keyPage);

      [1, 2, 3].forEach(b => {
        const from = (b - 1) * 10 + 1;
        const to = b * 10;
        steps.push({
          label: `Examen · Parcial ${p} (${from}-${to})`,
          target: `#q-exam-${p}-b${b}`,
          num_predict: 2000,
          temperature: 0.35,
          prompt: examBlockPrompt(d, p, units, from, to),
          render: async (target, text) => {
            const label = `Preguntas ${from}-${to}`;
            const key = renderQuiz(target, text, $(`#q-exam-key-${p}`), label, from);
            if (!key) await generateQuizKey(target, $(`#q-exam-key-${p}`), label, from);
          },
        });
      });
    }

    keyPages.forEach(kp => doc.appendChild(kp));
  }

  /* ---------------------------------------------------------
     GUÍA ACADÉMICA
     --------------------------------------------------------- */
  function buildAcademic(d) {
    state.mode = 'academica';
    state.title = 'Guia Academica - ' + (d.titulo || 'documento');
    state.topic = d.titulo || d.asignatura || 'tecnología';

    const chapters = chaptersFromUI();
    const steps = [];
    const conEjercicios = d.ejercicios !== undefined;
    const cfg = quizConfig(d);

    doc.innerHTML = '';

    /* --- portada --- */
    const cover = el('section', 'page cover');
    cover.innerHTML = `
      <img class="cover-bg" src="assets/img/portada-istel.png" alt="Portada institucional ISTEL">
      <div class="cover-body">
        <p class="cover-kicker">ELABORACIÓN DE LA GUÍA ACADÉMICA</p>
        <h1 class="cover-title">${esc(d.titulo)}</h1>
        <p class="cover-year">${esc(d.anio)}</p>
        <p class="cover-authors">${esc(d.autores)}</p>
        <p class="cover-career">${esc(d.carrera)}</p>
      </div>`;
    doc.appendChild(cover);

    /* --- presentación --- */
    const pPresent = el('section', 'page');
    pPresent.innerHTML = `
      <h2 class="center">PRESENTACIÓN</h2>
      <div id="a-presentacion"></div>
      <div class="img-slot">[ Imagen referente a la asignatura ]</div>`;
    doc.appendChild(pPresent);

    const capTitles = chapters.map((c, i) => `Capítulo ${i + 1}: ${c.titulo}`).join('; ');

    steps.push({
      label: 'Presentación',
      target: '#a-presentacion',
      num_predict: 1000,
      temperature: 0.55,
      prompt:
        `Redacta la sección PRESENTACIÓN de la guía académica de la asignatura "${d.asignatura}" ` +
        `(carrera: ${d.carrera}, nivel: ${d.nivel}).\n` +
        `Incluye exactamente estos cinco apartados. Cada apartado debe empezar con su título en negrita ` +
        `seguido de dos puntos, y luego un párrafo de 80 a 120 palabras:\n` +
        `**Descripción general:**\n**Importancia y relevancia:**\n**Principios y fundamentos:**\n` +
        `**Áreas de estudio:**\n**Enfoque metodológico:**\n` +
        `Contexto de los capítulos de la guía: ${capTitles}.\n` +
        `El enfoque metodológico declarado es: ${d.metodologia || 'clases teóricas y prácticas de laboratorio'}.\n` +
        `No repitas los títulos como encabezados tipo Markdown; usa el texto en negrita y luego el párrafo.`
    });

    /* --- capítulos --- */
    chapters.forEach((ch, i) => {
      const n = i + 1;
      const subtemas = ch.subtemas;
      const page = el('section', 'page');
      page.innerHTML = `
        <div class="img-slot">[ Imagen de presentación del capítulo ]</div>
        <h2>Capítulo ${n}. ${esc(ch.titulo)}</h2>
        <div id="a-intro-${i}"></div>` +
        (subtemas.length
          ? subtemas.map((s, j) =>
              `<h3>${n}.${j + 1} ${esc(s)}</h3>` +
              `<div id="a-sub-${i}-${j}-0"></div>` +
              `<div id="a-sub-${i}-${j}-1"></div>`).join('')
          : `<h3>Desarrollo</h3>` +
            `<div id="a-dev-${i}-0"></div>` +
            `<div id="a-dev-${i}-1"></div>`) +
        (conEjercicios
          ? `<h3>Ejercicio práctico de aplicación</h3><div id="a-ej-${i}"></div>`
          : '');
      doc.appendChild(page);

      const listaSubtemas = subtemas.length
        ? `Los subtemas del capítulo son: ${subtemas.join('; ')}.\n`
        : '';

      /* Introducción del capítulo: un solo párrafo */
      steps.push({
        label: `Capítulo ${n}: introducción`,
        target: `#a-intro-${i}`,
        num_predict: 500,
        temperature: 0.55,
        prompt:
          `Redacta la introducción del Capítulo ${n}: "${ch.titulo}" de la guía académica de la asignatura ` +
          `"${d.asignatura}" (carrera: ${d.carrera}, nivel: ${d.nivel}).\n` +
          `${listaSubtemas}` +
          `Escribe UN SOLO párrafo de 120 a 180 palabras que defina el tema central, su relevancia y el ` +
          `enfoque del capítulo.\n` +
          `No escribas títulos, encabezados, listas ni viñetas; empieza directamente con el texto. ` +
          `No inventes citas textuales ni datos falsos.`,
        render: renderParagraphs
      });

      /* Cada subtema: exactamente 4 párrafos, en dos llamadas de 2 párrafos */
      const desarrolloParrafos = (baseId, etiqueta, tema, titulo) => {
        const pares = [
          {
            num: '1-2',
            aspecto:
              `El primer párrafo presenta la definición y el contexto del concepto. ` +
              `El segundo explica cómo funciona, sus elementos o su proceso.`
          },
          {
            num: '3-4',
            aspecto:
              `El primer párrafo incluye un ejemplo aplicado a la carrera. ` +
              `El segundo cierra con buenas prácticas, errores comunes o recomendaciones.`
          }
        ];

        pares.forEach((par, k) => {
          steps.push({
            label: `${etiqueta} · párrafos ${par.num}`,
            target: `#${baseId}-${k}`,
            num_predict: 1000,
            temperature: 0.55,
            prompt:
              `Redacta los párrafos ${par.num} del ${titulo} del Capítulo ${n}: "${ch.titulo}" ` +
              `de la guía académica de la asignatura "${d.asignatura}" ` +
              `(carrera: ${d.carrera}, nivel: ${d.nivel}).\n` +
              `Tema a desarrollar: "${tema}".\n` +
              `${listaSubtemas}` +
              `Escribe EXACTAMENTE 2 párrafos. Cada párrafo debe tener entre 120 y 150 palabras ` +
              `(8 a 10 oraciones completas). No resumas ni acortes las ideas.\n` +
              `${par.aspecto}\n` +
              `No escribas el título del tema ni ningún encabezado; empieza directamente con el primer párrafo. ` +
              `No escribas etiquetas como "Párrafo 1:" ni numeración. ` +
              `Devuelve SOLO los 2 párrafos separados por una línea en blanco. ` +
              `No uses listas, viñetas, tablas ni bloques de código. ` +
              `No inventes citas textuales ni datos falsos.`,
            render: renderParagraphPair
          });
        });
      };

      if (subtemas.length) {
        subtemas.forEach((sub, j) => {
          desarrolloParrafos(
            `a-sub-${i}-${j}`,
            `Capítulo ${n}.${j + 1}: ${sub}`,
            sub,
            `subtema ${n}.${j + 1}`
          );
        });
      } else {
        desarrolloParrafos(`a-dev-${i}`, `Capítulo ${n}: desarrollo`, ch.titulo, 'tema central');
      }

      if (conEjercicios) {
        steps.push({
          label: `Ejercicio práctico · Capítulo ${n}`,
          target: `#a-ej-${i}`,
          num_predict: 950,
          temperature: 0.5,
          prompt:
            `Ejercicio práctico del Capítulo ${n}: "${ch.titulo}" ` +
            `(asignatura: "${d.asignatura}", carrera: ${d.carrera}, nivel: ${d.nivel}).\n` +
            `Subtemas del capítulo: ${ch.subtemas.join('; ')}.\n` +
            `Redacta el ejercicio con esta estructura exacta y empieza directamente en "**Objetivo del ejercicio:**":\n` +
            `**Objetivo del ejercicio:** una sola oración que empiece con un verbo en infinitivo ` +
            `(aplicar, implementar, diseñar, analizar) y describa lo que hará el estudiante.\n` +
            `**Escenario:** dos o tres líneas con una situación real y concreta.\n` +
            `**Requisitos previos:** lista de 3 a 5 viñetas (conocimientos, software, datos).\n` +
            `**Pasos:** lista numerada de 8 a 12 pasos; cada paso indica la acción, la herramienta y el resultado esperado.\n` +
            `**Criterios de verificación:** 3 o 4 viñetas para comprobar que el ejercicio quedó bien resuelto.\n` +
            `No repitas estas instrucciones, no copies el enunciado y no agregues introducción ni conclusión.`
        });
      }

      if (cfg.includeUnit) addUnitQuiz(ch, n, d, steps);
    });

    /* --- referencias --- */
    const pRefs = el('section', 'page');
    pRefs.innerHTML = `
      <h2>REFERENCIAS BIBLIOGRÁFICAS</h2>
      <p class="muted">Formato APA, séptima edición.</p>
      <div id="a-referencias"></div>`;
    doc.appendChild(pRefs);

    const refsInput = (d.referencias || '').trim();
    steps.push({
      label: 'Referencias bibliográficas',
      target: '#a-referencias',
      num_predict: 700,
      temperature: 0.3,
      prompt: refsInput
        ? `Ordena alfabéticamente y formatea estas referencias con normas APA 7ª edición. ` +
          `Devuelve una lista con viñetas ("- "), sin texto adicional:\n${refsInput}`
        : `Propón 8 referencias bibliográficas reales y verificables (libros, artículos y documentación ` +
          `oficial) sobre "${d.asignatura}" y "${d.titulo}". Formato APA 7ª edición, orden alfabético, ` +
          `una por línea comenzando con "- ". No inventes DOI ni URLs.`
    });

    /* --- anexos --- */
    const pAnex = el('section', 'page');
    pAnex.innerHTML = `
      <h2>ANEXOS</h2>
      <p>Las guías de prácticas de laboratorio y las fichas de trabajo se presentan en documentos independientes.</p>
      <ul>
        <li><strong>Anexo A.</strong> Guía de Prácticas en el Entorno Académico (ver documento adjunto).</li>
        <li><strong>Anexo B.</strong> Fichas de trabajo y material de apoyo de la asignatura.</li>
      </ul>
      <div class="img-slot">[ Espacio para anexos, capturas o fichas ]</div>`;
    doc.appendChild(pAnex);

    /* --- exámenes por parcial y claves --- */
    if (cfg.includeExam) addPartialExams(chapters, d, cfg, steps);

    /* --- hoja de vida --- */
    const hv = loadHV();
    const pHv = el('section', 'page');
    pHv.innerHTML = `
      <h2>SÍNTESIS DE LA HOJA DE VIDA</h2>
      <div class="photo-slot">Foto<br>carnet</div>
      <h3>${esc(hv.nombre || 'Nombre del autor')}</h3>
      <p><strong>Título profesional:</strong> ${esc(hv.titulo || '—')}</p>
      <p><strong>Correo:</strong> ${esc(hv.mail || '—')}</p>
      <p><strong>Teléfono:</strong> ${esc(hv.tel || '—')}</p>
      <p><strong>Experiencia:</strong> ${esc(hv.exp || '—')}</p>`;
    doc.appendChild(pHv);

    return steps;
  }

  /* Documento independiente: solo cuestionarios de repaso y exámenes. */
  function buildQuizDoc(d) {
    state.mode = 'cuestionarios';
    state.title = 'Cuestionarios - ' + (d.titulo || d.asignatura || 'documento');
    state.topic = d.titulo || d.asignatura || 'tecnología';

    const chapters = chaptersFromUI();
    const cfg = quizConfig(d);
    const steps = [];

    doc.innerHTML = '';

    const cover = el('section', 'page cover');
    cover.innerHTML = `
      <img class="cover-bg" src="assets/img/portada-istel.png" alt="Portada institucional ISTEL">
      <div class="cover-body">
        <p class="cover-kicker">CUESTIONARIOS DE REPASO Y EVALUACIÓN</p>
        <h1 class="cover-title">${esc(d.titulo || d.asignatura)}</h1>
        <p class="cover-year">${esc(d.anio)}</p>
        <p class="cover-authors">${esc(d.autores)}</p>
        <p class="cover-career">${esc(d.carrera)}</p>
      </div>`;
    doc.appendChild(cover);

    if (cfg.includeUnit) {
      chapters.forEach((ch, i) => addUnitQuiz(ch, i + 1, d, steps));
    }

    if (cfg.includeExam) {
      addPartialExams(chapters, d, cfg, steps);
    }

    return steps;
  }

  function loadHV() {
    const f = $('#form-academica');
    return {
      nombre: f.hv_nombre.value.trim(),
      titulo: f.hv_titulo.value.trim(),
      tel: f.hv_tel.value.trim(),
      mail: f.hv_mail.value.trim(),
      exp: f.hv_exp.value.trim(),
    };
  }

  /* ---------------------------------------------------------
     GUÍA DE PRÁCTICA
     --------------------------------------------------------- */
  function buildPractice(d) {
    state.mode = 'practica';
    state.title = 'Guia de Practica - ' + (d.titulo || 'documento');
    state.topic = d.titulo || d.asignatura || 'tecnología';
    const steps = [];

    const normas = (d.normas || '').split('\n').map(s => s.trim()).filter(Boolean);

    const rows = [
      ['Carrera', d.carrera],
      ['Asignatura', d.asignatura],
      ['Título de la práctica', d.titulo || '—'],
      ['Nivel Académico', d.nivel],
      ['Docente', d.docente],
      ['Semana Clase Práctica', d.semana],
      ['Nro. de la práctica', d.nro],
      ['Tiempo de duración', d.duracion],
      ['Fecha', d.fecha],
    ].map(([k, v]) => `<tr><th style="width:34%">${esc(k)}</th><td>${esc(v)}</td></tr>`).join('');

    doc.innerHTML = '';

    const page = el('section', 'page');
    page.innerHTML = `
      <div class="doc-head">
        <img src="assets/img/logo-istel.png" alt="Instituto Superior Tecnológico El Libertador">
      </div>
      <p class="center" style="font-size:10.5pt;margin-bottom:14px">${esc(d.carrera)}</p>
      <h1>GUÍA DE PRÁCTICAS EN EL ENTORNO ACADÉMICO</h1>

      <h2>Datos Informativos</h2>
      <table>${rows}</table>

      <h2>Fundamentos del desarrollo de la práctica</h2>
      <div id="p-fundamentos"></div>

      <h2>Objetivo General</h2>
      <div id="p-general"></div>

      <h2>Objetivos específicos</h2>
      <div id="p-especificos"></div>

      <h2>Preparación previa que debe hacer el estudiante</h2>
      <div id="p-preparacion"></div>

      <h2>Normas de seguridad</h2>
      <p>Siempre que se trabaje en el laboratorio se deben tener en cuenta las siguientes normas de seguridad:</p>
      <ul id="p-normas">${normas.map(n => `<li>${esc(n)}</li>`).join('')}</ul>

      <h2>Procedimiento a emplear</h2>
      <div id="p-procedimiento"></div>

      <h2>Materiales y equipos</h2>
      <div id="p-materiales"></div>

      <h2>Evaluación del aprendizaje</h2>
      <p>La evaluación de la práctica se realiza mediante la rúbrica de ejecución, considerando el desempeño
      demostrado durante el desarrollo de la actividad.</p>
      <h3>Rúbrica de la práctica</h3>
      <p><strong>Ejecución de la práctica (2 puntos)</strong></p>
      <div id="p-rubrica"></div>

      <h2>Firmas de responsabilidad</h2>
      <table class="sig-table">
        <tr>
          <th>Elaborado por</th><th>Revisado por</th><th>Aprobado por</th>
        </tr>
        <tr>
          <td>${esc(d.elaborado)}<br><span class="sig-role">Docente</span></td>
          <td>${esc(d.revisado)}<br><span class="sig-role">Coordinador de la Carrera</span></td>
          <td>${esc(d.aprobado)}<br><span class="sig-role">Responsable de Prácticas Preprofesionales</span></td>
        </tr>
        <tr>
          <th>Fecha de Elaboración</th><th>Fecha de Revisión</th><th>Fecha de Aprobación</th>
        </tr>
        <tr>
          <td>${esc(d.f_elab)}</td><td>${esc(d.f_rev)}</td><td>${esc(d.f_apro)}</td>
        </tr>
      </table>`;
    doc.appendChild(page);

    const ctx =
      `Asignatura: ${d.asignatura}. Carrera: ${d.carrera}. Nivel: ${d.nivel}. ` +
      `Título de la práctica: ${d.titulo}. Duración: ${d.duracion}. ` +
      (d.tema ? `Indicaciones del docente: ${d.tema}. ` : '');

    steps.push({
      label: 'Fundamentos',
      target: '#p-fundamentos',
      num_predict: 620,
      prompt:
        `Redacta la sección "Fundamentos del desarrollo de la práctica" para una guía de prácticas.\n${ctx}\n` +
        `Escribe 2 o 3 párrafos, aproximadamente 300 palabras en total, que expliquen el tema de la práctica, ` +
        `los conceptos clave, las herramientas o tecnologías implicadas y su aplicación profesional. ` +
        `Empieza directamente con el contenido: no repitas el título de la sección, no menciones la guía ni el curso. ` +
        `Texto continuo, sin títulos ni listas.`
    });

    steps.push({
      label: 'Objetivo general',
      target: '#p-general',
      num_predict: 200,
      prompt:
        `Formula UN objetivo general para la práctica.\n${ctx}\n` +
        `Debe ser una sola oración que inicie con un verbo en infinitivo de la Taxonomía de Bloom ` +
        `(aplicar, analizar, diseñar, implementar, evaluar) y sea medible. ` +
        `Devuelve solo la oración, sin numeración.`
    });

    steps.push({
      label: 'Objetivos específicos',
      target: '#p-especificos',
      num_predict: 300,
      prompt:
        `Formula exactamente 3 objetivos específicos para la práctica.\n${ctx}\n` +
        `Cada uno en una línea, numerados "1.", "2.", "3.", iniciando con verbo en infinitivo, ` +
        `medibles y directamente vinculados al objetivo general. Sin texto adicional.`
    });

    steps.push({
      label: 'Preparación previa',
      target: '#p-preparacion',
      num_predict: 500,
      prompt:
        `Describe la preparación previa que debe hacer el estudiante antes de la práctica ` +
        `(conocimientos teóricos, lecturas, software instalado, cuentas o datos necesarios).\n${ctx}\n` +
        `Devuelve una lista de 5 o 6 viñetas que comiencen con "- ". Cada viñeta de una o dos líneas.`
    });

    steps.push({
      label: 'Procedimiento',
      target: '#p-procedimiento',
      num_predict: 1000,
      prompt:
        `Enumera el procedimiento paso a paso para ejecutar la práctica.\n${ctx}\n` +
        `Devuelve entre 8 y 12 pasos numerados "1." "2." …, cada uno con una instrucción concreta ` +
        `(qué hacer, con qué herramienta o comando y qué resultado se espera). ` +
        `No incluyas introducción ni conclusión.`
    });

    steps.push({
      label: 'Materiales y equipos',
      target: '#p-materiales',
      num_predict: 350,
      prompt:
        `Lista los materiales, equipos y software necesarios para la práctica.\n${ctx}\n` +
        `Devuelve de 6 a 8 viñetas con "- ", incluyendo hardware de laboratorio y herramientas de software.`
    });

    steps.push({
      label: 'Rúbrica de evaluación',
      target: '#p-rubrica',
      num_predict: 320,
      temperature: 0.35,
      render: (target, text) => renderRubric(target, text),
      prompt:
        `Escribe 4 criterios de desempeño para evaluar la práctica de laboratorio.\n${ctx}\n` +
        `Responde con una lista numerada del 1 al 4, una sola línea por criterio, sin encabezados ni explicaciones. ` +
        `Cada criterio debe empezar con un verbo en tercera persona y tener máximo 18 palabras.`
    });

    return steps;
  }

  function parseRubric(text) {
    const cleaned = cleanAiText(text).replace(/\*\*/g, '').replace(/`/g, '');
    const lines = cleaned.split('\n').map(l => l.trim()).filter(Boolean);
    const rows = [];

    const cleanDesc = (s) => s.replace(/^[-•*–\s]+/, '').replace(/^\d+[.)]\s*/, '').trim();
    const isPoints = (s) => /^[\d.,]+\s*(puntos?|pts?|ptos?)?\.?$/i.test(s.trim());
    const pointsFrom = (s) => {
      const m = String(s).match(/(\d+(?:[.,]\d+)?)/);
      return m ? parseFloat(m[1].replace(',', '.')) : null;
    };

    for (const line of lines) {
      if (line.includes('|')) {
        const parts = line.split('|').map(p => p.trim()).filter(Boolean);
        const desc = cleanDesc(parts[0] || '');
        if (!desc) continue;
        const pts = parts.length > 1 ? pointsFrom(parts[1]) : null;
        rows.push({ desc, pts });
        continue;
      }

      // línea que solo contiene la puntuación (formato alterno)
      if (isPoints(line)) {
        if (rows.length && rows[rows.length - 1].pts == null) {
          rows[rows.length - 1].pts = pointsFrom(line);
        }
        continue;
      }

      // descriptor que termina con la puntuación entre paréntesis o separada
      const m = line.match(/^(.*?)[\s\-–(]+(\d+(?:[.,]\d+)?)\s*(?:puntos?|pts?)?\)?\.?$/i);
      if (m && cleanDesc(m[1]).length > 12) {
        rows.push({ desc: cleanDesc(m[1]), pts: parseFloat(m[2].replace(',', '.')) });
        continue;
      }

      const desc = cleanDesc(line);
      // descartar encabezados o frases de relleno
      if (!desc || /^(desempeño|criterio|puntuaci[oó]n|r[uú]brica|total|ejecuci[oó]n)/i.test(desc)) continue;
      if (desc.length < 12) continue;
      rows.push({ desc, pts: null });
    }

    // completar puntos faltantes y recortar a 4
    const final = rows.slice(0, 4).map(r => ({
      desc: r.desc,
      pts: (r.pts != null && isFinite(r.pts) ? r.pts : 0.5),
    }));

    return final;
  }

  function renderRubric(target, text) {
    const defaults = [
      'Sigue los pasos de la práctica de manera ordenada y lógica.',
      'Demuestra habilidad en la manipulación de herramientas o software.',
      'Relaciona la práctica con conceptos teóricos aprendidos.',
      'La presentación de los resultados es clara y estructurada.',
    ];

    const parsed = parseRubric(text);
    while (parsed.length < 4) parsed.push({ desc: defaults[parsed.length], pts: 0.5 });

    const fmt = (n) => n.toFixed(2).replace('.', ',');
    const total = parsed.reduce((a, r) => a + r.pts, 0);

    target.innerHTML = `<table>
      <tr><th>Desempeño</th><th style="width:120px">Puntuación</th></tr>
      ${parsed.map(r => `<tr><td>${esc(r.desc)}</td><td class="center">${fmt(r.pts)}</td></tr>`).join('')}
      <tr><th class="center">Total</th><th class="center">${fmt(total)}</th></tr>
    </table>`;
  }

  /* ---------------------------------------------------------
     Imágenes (repositorios libres y web)
     --------------------------------------------------------- */
  function currentTopic() {
    return state.topic || (doc.querySelector('h2, .cover-title')?.textContent || 'tecnología').trim();
  }

  function queryFromSlot(slot) {
    const page = slot.closest('.page');
    const h = page?.querySelector('h2, .cover-title');
    let q = (h?.textContent || currentTopic()).trim();
    q = q.replace(/^cap[ií]tulo\s+\d+[.:]\s*/i, '').replace(/[«»"“”]/g, '');
    return q.slice(0, 90) || currentTopic();
  }

  function imgSource() {
    return ($('#img-source') && $('#img-source').value) || 'free';
  }

  /* la búsqueda en repositorios libres (Openverse) no admite filtros de fecha */
  function imgEndpoint(q, n) {
    if (imgSource() === 'web') {
      const recent = $('#img-recent') && $('#img-recent').checked ? 1 : 0;
      const sort = ($('#img-sort') && $('#img-sort').value) || 'relevance';
      return 'api/web_images.php?q=' + encodeURIComponent(q) + '&n=' + n + '&recent=' + recent + '&sort=' + sort;
    }
    return 'api/images.php?q=' + encodeURIComponent(q) + '&n=' + n;
  }

  function sourceName(item) {
    return item.source || (imgSource() === 'free' ? 'Repositorio libre' : 'Web');
  }

  function figureHtml(item, srcPath) {
    const credit = [item.artist, item.license].filter(Boolean).join(' · ');
    const caption = `${item.title}${credit ? ' — ' + credit : ''}${item.year ? ' (' + item.year + ')' : ''}. Fuente: ${sourceName(item)}.`;
    return `<figure class="doc-img">\n  <img src="${esc(srcPath)}" alt="${esc(item.title)}">\n  <figcaption>${esc(caption)}</figcaption>\n</figure>`;
  }

  function openImages(query) {
    state.pendingSlot = state.pendingSlot || null;
    const modal = $('#img-modal');
    modal.hidden = false;
    const input = $('#img-query');
    input.value = query || currentTopic();
    $('#img-results').innerHTML = '<p class="muted">Escribe un tema y pulsa Buscar.</p>';
    $('#img-status').textContent = '';
    const replacing = !!(state.pendingFigure && doc.contains(state.pendingFigure));
    $('#img-replace-note').hidden = !replacing;
    $('#img-remove').hidden = !replacing;
    input.focus();
    if (input.value) searchImages(input.value);
  }

  function closeImages() {
    $('#img-modal').hidden = true;
    state.pendingSlot = null;
    state.pendingFigure = null;
    $('#img-replace-note').hidden = true;
    $('#img-remove').hidden = true;
  }

  /* Reintenta una vez si el repositorio responde «demasiadas peticiones» (429). */
  async function fetchImages(q, n, tries) {
    tries = tries || 2;
    let last = { error: 'Error al buscar' };
    for (let i = 0; i < tries; i++) {
      const r = await apiFetch(imgEndpoint(q, n), { cache: 'no-store' });
      const data = await r.json().catch(() => ({}));
      if (r.ok) return data;
      last = data;
      if (r.status === 429 && i < tries - 1) {
        $('#img-status').textContent = 'El repositorio está ocupado, reintentando…';
        await new Promise(res => setTimeout(res, 7000));
        continue;
      }
      break;
    }
    throw new Error(last.error || 'Error al buscar');
  }

  async function searchImages(q) {
    const status = $('#img-status');
    const results = $('#img-results');
    const source = imgSource();
    status.textContent = 'Buscando…';
    results.innerHTML = '<p class="muted">Buscando imágenes…</p>';
    try {
      const data = await fetchImages(q, 12);
      let list = data.images || [];
      let usedRepo = false;
      /* la búsqueda web a veces devuelve muy poco o resultados poco fiables:
         en ese caso se usan los repositorios libres */
      if (source === 'web' && list.length < 4) {
        try {
          const r2 = await apiFetch('api/images.php?q=' + encodeURIComponent(q) + '&n=12', { cache: 'no-store' });
          const d2 = await r2.json();
          if (r2.ok && Array.isArray(d2.images) && d2.images.length) {
            list = d2.images;
            usedRepo = true;
          }
        } catch (e) { /* seguir con lo obtenido */ }
      }
      if (!list.length) {
        results.innerHTML = '<p class="muted">Sin resultados. Prueba con otra palabra (en español o inglés).</p>';
        status.textContent = '';
        return;
      }
      results.innerHTML = '';
      list.forEach(item => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'img-item';
        b.title = state.pendingFigure ? 'Usar esta imagen en lugar de la actual' : 'Insertar esta imagen';
        const repo = !!(item.license || item.artist);
        const extra = repo
          ? [item.license || 'Licencia libre', item.source, item.year].filter(Boolean).join(' · ')
          : [item.source, item.year].filter(Boolean).join(' · ');
        b.innerHTML = `<img src="${esc(item.thumb)}" alt="" loading="lazy">
          <div class="meta"><strong>${esc(item.title)}</strong>${esc(extra)}</div>`;
        b.onclick = () => insertImage(item, b);
        results.appendChild(b);
      });
      const trans = data.query && data.query.toLowerCase() !== q.toLowerCase() ? ' · ' + data.query : '';
      const nota = usedRepo ? ' · repositorios libres' : '';
      status.textContent = list.length + ' resultados' + trans + nota;
    } catch (e) {
      results.innerHTML = `<p class="section-error">${esc(e.message)}</p>`;
      status.textContent = '';
    }
  }

  /* Descarga la imagen en el servidor probando primero la versión completa
     (mejor resolución) y, si falla, la miniatura como respaldo. */
  async function saveImage(item) {
    const candidates = [item.download || item.full || item.thumb, item.thumb].filter(Boolean);
    let lastError = 'No se pudo guardar la imagen';
    for (let i = 0; i < candidates.length; i++) {
      if (i > 0 && candidates[i] === candidates[0]) continue;
      try {
        const r = await apiFetch('api/save_image.php', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: candidates[i] }),
        });
        const data = await r.json();
        if (r.ok && data.path) return data;
        lastError = data.error || lastError;
      } catch (e) { lastError = e.message || lastError; }
    }
    throw new Error(lastError);
  }

  async function insertImage(item, btn) {
    const status = $('#img-status');
    if (btn) btn.disabled = true;
    status.textContent = 'Guardando imagen…';
    try {
      const data = await saveImage(item);

      const html = figureHtml(item, data.path);

      if (state.pendingFigure && doc.contains(state.pendingFigure)) {
        state.pendingFigure.outerHTML = html;
        state.pendingFigure = null;
      } else if (state.pendingSlot && doc.contains(state.pendingSlot)) {
        state.pendingSlot.outerHTML = html;
        state.pendingSlot = null;
      } else {
        insertAtCursor(html);
      }
      status.textContent = 'Imagen insertada';
      closeImages();
    } catch (e) {
      status.textContent = 'Error: ' + e.message;
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function insertAtCursor(html) {
    const sel = window.getSelection();
    if (sel && sel.rangeCount && doc.contains(sel.anchorNode)) {
      const range = sel.getRangeAt(0);
      range.deleteContents();
      const frag = range.createContextualFragment(html);
      const last = frag.lastChild;
      range.insertNode(frag);
      range.setStartAfter(last);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    } else {
      doc.insertAdjacentHTML('beforeend', html);
    }
    doc.focus();
  }

  async function autofillImages() {
    const slots = [...doc.querySelectorAll('.img-slot')];
    const status = $('#img-status');
    if (!slots.length) { status.textContent = 'No hay espacios de imagen en este documento.'; return; }

    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      if (!doc.contains(slot)) continue;
      status.textContent = `Imagen ${i + 1} de ${slots.length}…`;
      try {
        const q = queryFromSlot(slot);
        const r = await apiFetch(imgEndpoint(q, 3), { cache: 'no-store' });
        const data = await r.json();
        if (!data.images || !data.images.length) continue;
        const item = data.images[0];
        const saved = await saveImage(item);
        slot.outerHTML = figureHtml(item, saved.path);
      } catch (e) { /* continuar con la siguiente */ }
      /* pequeña pausa para no saturar el repositorio de imágenes */
      await new Promise(res => setTimeout(res, 900));
    }
    status.textContent = 'Imágenes insertadas';
  }

  /* ---------------------------------------------------------
     Asistente de IA: ampliar o cambiar el contenido
     --------------------------------------------------------- */
  const AI_SYS = SYS + ' Además aplicas instrucciones de edición: recibes un texto y devuelves ' +
    'su versión final lista para el documento, sin explicaciones, sin saludos y sin bloques de código. ' +
    'Usa encabezados markdown (##), listas (-) y tablas markdown (| col | col |) cuando aporten.';

  function sectionTitle(sec) {
    const h = sec && sec.querySelector('h1, h2, h3, .cover-title');
    return h ? h.textContent.trim() : '';
  }

  function sectionText(sec) {
    if (!sec) return '';
    const clone = sec.cloneNode(true);
    clone.querySelectorAll('figure.doc-img, .img-slot, .photo-slot, script').forEach(n => n.remove());
    return clone.innerText.replace(/\n{3,}/g, '\n\n').trim().slice(0, 6000);
  }

  function updateAiContextLabel() {
    const scope = $('#ai-scope') ? $('#ai-scope').value : 'section';
    const lbl = $('#ai-context');
    if (!lbl) return;
    if (scope === 'append') {
      lbl.textContent = 'Se agregará una sección nueva al final del documento.';
      return;
    }
    if (scope === 'block') {
      const b = state.activeBlock;
      lbl.textContent = b
        ? 'Párrafo: «' + b.innerText.trim().replace(/\s+/g, ' ').slice(0, 70) + '…»'
        : 'Coloca el cursor en un párrafo del documento.';
      return;
    }
    const s = state.activeSection;
    lbl.textContent = s
      ? 'Sección: ' + (sectionTitle(s) || '(sin título)')
      : 'Coloca el cursor en una sección del documento.';
  }

  function updateAiContext() {
    const sel = window.getSelection();
    const node = sel && sel.rangeCount ? sel.anchorNode : null;
    if (!node || !doc.contains(node)) return;
    const start = node.nodeType === 1 ? node : node.parentElement;
    if (!start) return;
    const block = start.closest('p, li, h1, h2, h3, h4, table, blockquote');
    if (block && doc.contains(block)) state.activeBlock = block;
    const sec = start.closest('section.page');
    if (sec && doc.contains(sec)) state.activeSection = sec;
    if ($('#ai-modal') && !$('#ai-modal').hidden) updateAiContextLabel();
  }

  function aiPrompt(scope, inst) {
    const docTitle = state.title || (doc.querySelector('.cover-title')?.textContent || '').trim() || 'Documento';

    if (scope === 'append') {
      const temas = $$('#doc section.page h1, #doc section.page h2, #doc section.page h3')
        .map(h => '· ' + h.textContent.trim()).slice(0, 20).join('\n');
      return `TÍTULO DEL DOCUMENTO: ${docTitle}\n` +
        `TEMAS YA TRATADOS:\n${temas || '(ninguno)'}\n\n` +
        `INSTRUCCIÓN: ${inst}\n\n` +
        'Redacta una sección NUEVA en formato académico: empieza con su título como encabezado markdown ' +
        '(## Título), desarrolla de 2 a 4 párrafos y agrega una lista o tabla si aporta valor. ' +
        'No repitas los temas ya tratados. Devuelve solo el contenido de la nueva sección.';
    }

    if (scope === 'block') {
      const b = state.activeBlock;
      if (!b) return null;
      return `FRAGMENTO ACTUAL DEL DOCUMENTO:\n<<<\n${b.innerText.trim()}\n>>>\n\n` +
        `INSTRUCCIÓN: ${inst}\n\n` +
        'Devuelve únicamente el fragmento ya modificado, conservando el mismo tipo de formato ' +
        '(párrafo, lista o tabla). No agregues comentarios.';
    }

    const sec = state.activeSection;
    if (!sec) return null;
    const title = sectionTitle(sec);
    const body = sectionText(sec);

    if (scope === 'section-add') {
      return `SECCIÓN DEL DOCUMENTO${title ? ' («' + title + '»)' : ''}:\n<<<\n${body}\n>>>\n\n` +
        `INSTRUCCIÓN: ${inst}\n\n` +
        'Redacta ÚNICAMENTE el contenido nuevo que se debe agregar al final de esta sección ' +
        '(párrafos, listas o tablas en markdown). No repitas lo ya escrito y no incluyas el título.';
    }

    return `SECCIÓN ACTUAL DEL DOCUMENTO${title ? ' («' + title + '»)' : ''}:\n<<<\n${body}\n>>>\n\n` +
      `INSTRUCCIÓN: ${inst}\n\n` +
      `Devuelve la sección COMPLETA ya modificada, empezando por su título como encabezado markdown ` +
      `(## ${title || 'Título'}). No agregues comentarios ni explicaciones.`;
  }

  function hideAiActions() {
    ['#ai-apply', '#ai-append', '#ai-copy'].forEach(s => { const b = $(s); if (b) b.hidden = true; });
  }

  function resetAiPreview() {
    state.aiHtml = '';
    hideAiActions();
    const st = $('#ai-status');
    if (st) st.textContent = '';
    const pv = $('#ai-preview');
    if (pv) pv.innerHTML = '<p class="muted">Escribe una instrucción o elige una acción rápida y pulsa <strong>Generar</strong>.</p>';
  }

  function showAiActions() {
    const scope = state.aiScope || 'section';
    const apply = $('#ai-apply');
    const append = $('#ai-append');
    apply.textContent = scope === 'append' ? 'Insertar sección'
      : scope === 'block' ? 'Reemplazar párrafo'
      : 'Reemplazar sección';
    apply.hidden = scope === 'section-add';
    append.textContent = 'Añadir al final de la sección';
    append.hidden = scope !== 'section-add';
    $('#ai-copy').hidden = false;
  }

  function openAi() {
    updateAiContext();
    $('#ai-modal').hidden = false;
    updateAiContextLabel();
    resetAiPreview();
    $('#ai-prompt').focus();
  }

  function closeAi() {
    if (state.abort) state.abort.abort();
    $('#ai-modal').hidden = true;
  }

  async function runAi() {
    if (state.busy) return;
    const preview = $('#ai-preview');
    const inst = $('#ai-prompt').value.trim();
    if (!inst) {
      preview.innerHTML = '<p class="section-error">Escribe qué quieres ampliar o cambiar.</p>';
      return;
    }
    const scope = $('#ai-scope').value;
    const prompt = aiPrompt(scope, inst);
    if (!prompt) {
      preview.innerHTML = '<p class="section-error">Coloca el cursor dentro de una sección o párrafo del documento y vuelve a intentar. También puedes usar «Nueva sección al final».</p>';
      return;
    }

    state.aiScope = scope;
    hideAiActions();
    setBusy(true);
    $('#ai-run').textContent = 'Detener';
    $('#ai-status').textContent = 'Generando…';
    setProgress(0, 1, 'IA: redactando');

    try {
      const text = await streamGenerate(prompt, { num_predict: 900, temperature: 0.5, system: AI_SYS }, preview);
      const err = extractError(text);
      state.lastText = text;
      if (err) {
        preview.innerHTML = `<p class="section-error">No se pudo generar: ${esc(err)}</p>`;
        return;
      }
      const html = mdToHtml(text);
      preview.innerHTML = html || '<p class="section-error">La IA no devolvió contenido.</p>';
      state.aiHtml = html;
      if (html) {
        showAiActions();
        $('#ai-status').textContent = 'Vista previa lista';
      }
    } catch (e) {
      if (e.name === 'AbortError') {
        preview.innerHTML = '<p class="muted">Generación detenida.</p>';
      } else {
        preview.innerHTML = `<p class="section-error">Error: ${esc(e.message)}</p>`;
      }
      state.aiHtml = '';
    } finally {
      state.abort = null;
      setBusy(false);
      $('#ai-run').textContent = 'Generar';
      setProgress(0, 1, 'Listo');
      $('#progress-bar').style.width = '0%';
    }
  }

  function applyAi(asAppend) {
    const html = state.aiHtml;
    const status = $('#ai-status');
    if (!html) return;
    const scope = state.aiScope || 'section';
    let target = null;

    if (scope === 'append') {
      const page = el('section', 'page');
      page.innerHTML = html;
      doc.appendChild(page);
      target = page;
    } else if (scope === 'section-add') {
      if (!state.activeSection || !doc.contains(state.activeSection)) { status.textContent = 'La sección ya no existe.'; return; }
      state.activeSection.insertAdjacentHTML('beforeend', html);
      target = state.activeSection;
    } else if (scope === 'block') {
      if (!state.activeBlock || !doc.contains(state.activeBlock)) { status.textContent = 'El párrafo ya no existe.'; return; }
      state.activeBlock.insertAdjacentHTML('afterend', html);
      state.activeBlock.remove();
      target = doc;
    } else {
      if (!state.activeSection || !doc.contains(state.activeSection)) { status.textContent = 'La sección ya no existe.'; return; }
      state.activeSection.innerHTML = html;
      target = state.activeSection;
    }

    if (target && target !== doc) scrollToEl(target);
    resetAiPreview();
    status.textContent = asAppend && scope !== 'section-add' ? 'Contenido agregado' : 'Cambios aplicados';
    setTimeout(() => { const s = $('#ai-status'); if (s) s.textContent = 'Listo'; }, 2200);
  }

  function initAi() {
    if (!$('#btn-ai')) return;
    $('#btn-ai').onclick = openAi;
    $('#ai-close').onclick = closeAi;
    $('#ai-modal').addEventListener('click', e => { if (e.target.id === 'ai-modal') closeAi(); });

    $$('.ai-chips .chip').forEach(c => {
      c.onclick = () => {
        if (state.busy) return;
        $('#ai-prompt').value = c.dataset.prompt || '';
        runAi();
      };
    });

    $('#ai-run').onclick = () => {
      if (state.busy) { if (state.abort) state.abort.abort(); return; }
      runAi();
    };
    $('#ai-prompt').addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); if (!state.busy) runAi(); }
    });
    $('#ai-scope').onchange = () => { resetAiPreview(); updateAiContextLabel(); };

    $('#ai-apply').onclick = () => applyAi(false);
    $('#ai-append').onclick = () => applyAi(true);
    $('#ai-copy').onclick = async () => {
      const txt = $('#ai-preview').innerText.trim();
      if (!txt) return;
      try {
        await navigator.clipboard.writeText(txt);
        $('#ai-status').textContent = 'Copiado';
      } catch (e) {
        $('#ai-status').textContent = 'No se pudo copiar';
      }
    };

    document.addEventListener('selectionchange', updateAiContext);
    doc.addEventListener('keyup', updateAiContext);
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && $('#ai-modal') && !$('#ai-modal').hidden) closeAi();
    });
  }

  /* ---------------------------------------------------------
     Guardar / abrir documentos
     --------------------------------------------------------- */
  const DRAFT_KEY = 'guias_draft_v1';
  let draftTimer = null;

  function hasContent() {
    return !!doc.querySelector('section.page');
  }

  function flashStatus(msg, ms) {
    const el = $('#progress-text');
    if (!el) return;
    el.textContent = msg;
    clearTimeout(flashStatus._t);
    flashStatus._t = setTimeout(() => {
      if (el.textContent === msg) el.textContent = 'Listo';
    }, ms || 4000);
  }

  function fmtDate(ts) {
    return new Date((ts || 0) * 1000).toLocaleString();
  }

  function fmtSize(n) {
    if (!n) return '';
    return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
  }

  function modeLabel(mode) {
    return mode === 'practica'
      ? 'Guía de práctica'
      : (mode === 'cuestionarios' ? 'Cuestionarios' : 'Guía académica');
  }

  /* ----- borrador automático (localStorage) ----- */
  function saveDraft() {
    if (!hasContent()) return;
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({
        html: doc.innerHTML,
        mode: state.mode,
        title: state.title,
        docId: state.docId,
        docName: state.docName,
        docSource: state.docSource,
        at: Date.now(),
      }));
    } catch (e) { /* sin espacio: ignorar */ }
    updateRestoreButton();
  }

  function scheduleDraft() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(saveDraft, 1200);
  }

  function readDraft() {
    try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch (e) { return null; }
  }

  function updateRestoreButton() {
    const b = $('#btn-restore');
    if (!b) return;
    const d = readDraft();
    b.hidden = !(d && d.html && !hasContent());
    if (d && d.at) b.title = 'Recuperar el borrador del ' + new Date(d.at).toLocaleString();
  }

  function restoreDraft() {
    const d = readDraft();
    if (!d || !d.html) return;
    doc.innerHTML = d.html;
    state.mode = ['practica', 'cuestionarios'].includes(d.mode) ? d.mode : 'academica';
    state.title = d.title || state.title;
    state.docId = d.docId || null;
    state.docName = d.docName || '';
    state.docSource = d.docSource || null;
    $('#btn-restore').hidden = true;
    flashStatus('Borrador restaurado');
  }

  /* ----- guardar / abrir ----- */
  function docPayload() {
    return {
      id: state.docId || '',
      name: (state.docName || state.title || 'Documento').trim(),
      mode: state.mode,
      title: state.title || '',
      source: state.docSource || 'manual',
      html: doc.innerHTML,
    };
  }

  function historyDocName() {
    const cover = doc.querySelector('.cover-title')?.textContent || '';
    let base = (cover || state.title || 'Documento').replace(/\s+/g, ' ').trim();
    base = base
      .replace(/^Gu[ií]a Acad[eé]mica\s*-\s*/i, '')
      .replace(/^Gu[ií]a de Pr[aá]ctica\s*-\s*/i, '')
      .replace(/^Cuestionarios\s*-\s*/i, '')
      .trim();
    return `${modeLabel(state.mode)} · ${base}`.slice(0, 120);
  }

  async function saveHistory() {
    if (!hasContent()) return false;
    try {
      const r = await apiFetch('api/docs.php?action=save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: '',
          name: historyDocName(),
          mode: state.mode,
          title: state.title || '',
          source: 'history',
          html: doc.innerHTML,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'No se pudo guardar');

      state.docId = data.id;
      state.docName = data.name || historyDocName();
      state.docSource = 'history';
      saveDraft();
      if ($('#history-modal') && !$('#history-modal').hidden) await refreshHistory();
      if ($('#docs-modal') && !$('#docs-modal').hidden) await refreshDocs();
      return true;
    } catch (e) {
      console.warn('[historial]', e);
      return false;
    }
  }

  async function saveDoc(asNew) {
    if (!hasContent()) { alert('Todavía no hay un documento para guardar. Genera o abre uno primero.'); return; }

    let name = (state.docName || state.title || 'Documento').trim();
    if (asNew || !state.docName) {
      const input = prompt('Nombre del documento:', name);
      if (input === null) return;
      name = (input || '').trim() || name;
    }

    const payload = docPayload();
    payload.name = name;
    if (asNew) {
      payload.id = '';
      payload.source = 'manual';
    }

    const btns = ['#btn-save', '#docs-save', '#docs-save-as'].map(s => $(s)).filter(Boolean);
    btns.forEach(b => { b.disabled = true; });
    const st = $('#docs-status');
    if (st) st.textContent = 'Guardando…';

    try {
      const r = await apiFetch('api/docs.php?action=save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'No se pudo guardar');

      state.docId = data.id;
      state.docName = data.name;
      state.docSource = payload.source || 'manual';
      if (st) st.textContent = 'Guardado ✔';
      flashStatus('Guardado · ' + new Date().toLocaleTimeString());
      updateRestoreButton();
      if ($('#docs-modal') && !$('#docs-modal').hidden) await refreshDocs();
      if ($('#history-modal') && !$('#history-modal').hidden) await refreshHistory();
    } catch (e) {
      if (st) st.textContent = 'Error: ' + e.message;
      else flashStatus('Error al guardar: ' + e.message, 6000);
    } finally {
      btns.forEach(b => { b.disabled = false; });
    }
  }

  function openDocs() {
    closeHistory();
    $('#docs-modal').hidden = false;
    $('#docs-status').textContent = '';
    refreshDocs();
  }

  function closeDocs() {
    $('#docs-modal').hidden = true;
  }

  async function refreshDocs() {
    const list = $('#docs-list');
    if (!list) return;
    list.innerHTML = '<p class="muted">Cargando…</p>';
    try {
      const r = await apiFetch('api/docs.php?action=list', { cache: 'no-store' });
      const data = await r.json();
      const docs = data.docs || [];
      if (!docs.length) {
        list.innerHTML = '<p class="muted">Todavía no hay documentos.</p>';
        return;
      }
      list.innerHTML = '';
      docs.forEach(d => list.appendChild(docRow(d)));
    } catch (e) {
      list.innerHTML = `<p class="section-error">No se pudo leer la lista: ${esc(e.message)}</p>`;
    }
  }

  /* ----- historial de documentos generados ----- */
  let historyDocs = [];

  function openHistory() {
    closeDocs();
    $('#history-modal').hidden = false;
    $('#history-status').textContent = '';
    $('#history-search').value = '';
    refreshHistory();
  }

  function closeHistory() {
    const modal = $('#history-modal');
    if (modal) modal.hidden = true;
  }

  async function refreshHistory() {
    const list = $('#history-list');
    if (!list) return;
    list.innerHTML = '<p class="muted">Cargando…</p>';
    const st = $('#history-status');
    if (st) st.textContent = '';
    try {
      const r = await apiFetch('api/docs.php?action=list', { cache: 'no-store' });
      const data = await r.json();
      historyDocs = data.docs || [];
      renderHistory();
    } catch (e) {
      list.innerHTML = `<p class="section-error">No se pudo leer el historial: ${esc(e.message)}</p>`;
    }
  }

  function renderHistory() {
    const list = $('#history-list');
    if (!list) return;

    const filtro = $('#history-filter')?.value || 'history';
    const q = ($('#history-search')?.value || '').trim().toLowerCase();

    let docs = historyDocs.filter(d =>
      filtro === 'all' || (d.source || 'manual') === filtro
    );

    if (q) {
      docs = docs.filter(d =>
        `${d.name || ''} ${modeLabel(d.mode)} ${fmtDate(d.savedAt)}`.toLowerCase().includes(q)
      );
    }

    if (!docs.length) {
      const mensaje = q
        ? 'No hay resultados para esa búsqueda.'
        : filtro === 'history'
          ? 'Todavía no hay documentos generados. Al terminar una guía aparecerá aquí. Si guardaste documentos antes, cambia el filtro a «Todos».'
          : filtro === 'manual'
            ? 'No hay documentos guardados manualmente.'
            : 'No hay documentos en el historial.';
      list.innerHTML = `<p class="muted">${mensaje}</p>`;
      return;
    }

    list.innerHTML = '';
    docs.forEach(d => list.appendChild(docRow(d)));
  }

  function docRow(d) {
    const row = document.createElement('div');
    row.className = 'doc-row' + (state.docId === d.id ? ' current' : '');
    const tipo = modeLabel(d.mode);
    const origen = (d.source || 'manual') === 'history'
      ? '<span class="doc-badge generated">Generado</span>'
      : '<span class="doc-badge">Guardado</span>';
    row.innerHTML = `<div class="info">
        <strong>${esc(d.name || 'Documento')}</strong>
        <div class="meta">${origen} ${esc(tipo)} · ${esc(fmtDate(d.savedAt))}${d.size ? ' · ' + esc(fmtSize(d.size)) : ''}</div>
      </div>
      <div class="actions">
        <button type="button" class="primary" data-open>Abrir</button>
        <button type="button" class="ghost danger" data-del>Eliminar</button>
      </div>`;
    row.querySelector('[data-open]').onclick = () => loadDoc(d.id);
    row.querySelector('[data-del]').onclick = () => removeDoc(d.id, d.name);
    return row;
  }

  async function loadDoc(id) {
    const st = ($('#history-modal') && !$('#history-modal').hidden)
      ? $('#history-status')
      : $('#docs-status');
    if (st) st.textContent = 'Abriendo…';
    try {
      const r = await apiFetch('api/docs.php?action=load&id=' + encodeURIComponent(id), { cache: 'no-store' });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'No se pudo abrir el documento');

      state.mode = ['practica', 'cuestionarios'].includes(data.mode) ? data.mode : 'academica';
      state.title = data.title || data.name || 'documento';
      state.docId = data.id;
      state.docName = data.name || '';
      state.docSource = data.source || 'manual';
      doc.innerHTML = data.html;

      setProgress(0, 1, 'Documento abierto');
      $('#progress-bar').style.width = '0%';
      saveDraft();
      flashStatus('Abierto: ' + (data.name || 'documento'));
      closeDocs();
      closeHistory();
    } catch (e) {
      if (st) st.textContent = 'Error: ' + e.message;
    }
  }

  async function removeDoc(id, name) {
    if (!confirm('¿Eliminar «' + (name || 'Documento') + '»? Esta acción no se puede deshacer.')) return;
    const st = ($('#history-modal') && !$('#history-modal').hidden)
      ? $('#history-status')
      : $('#docs-status');
    try {
      const r = await apiFetch('api/docs.php?action=delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'No se pudo eliminar');
      if (state.docId === id) {
        state.docId = null;
        state.docName = '';
        state.docSource = null;
      }
      if ($('#docs-modal') && !$('#docs-modal').hidden) await refreshDocs();
      if ($('#history-modal') && !$('#history-modal').hidden) await refreshHistory();
      if (st) st.textContent = 'Documento eliminado';
    } catch (e) {
      if (st) st.textContent = 'Error: ' + e.message;
    }
  }

  function initDocs() {
    if (!$('#btn-save')) return;

    $('#btn-save').onclick = () => saveDoc(false);
    $('#btn-open').onclick = openDocs;
    $('#btn-history').onclick = openHistory;
    $('#btn-restore').onclick = restoreDraft;
    $('#docs-close').onclick = closeDocs;
    $('#docs-modal').addEventListener('click', e => { if (e.target.id === 'docs-modal') closeDocs(); });
    $('#docs-save').onclick = () => saveDoc(false);
    $('#docs-save-as').onclick = () => saveDoc(true);
    $('#history-close').onclick = closeHistory;
    $('#history-modal').addEventListener('click', e => { if (e.target.id === 'history-modal') closeHistory(); });
    $('#history-refresh').onclick = () => refreshHistory();
    $('#history-search').addEventListener('input', renderHistory);
    $('#history-filter').addEventListener('change', renderHistory);

    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      if ($('#history-modal') && !$('#history-modal').hidden) closeHistory();
      else if ($('#docs-modal') && !$('#docs-modal').hidden) closeDocs();
    });

    document.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && String(e.key).toLowerCase() === 's') {
        e.preventDefault();
        saveDoc(false);
      }
    });

    new MutationObserver(scheduleDraft).observe(doc, { childList: true, subtree: true, characterData: true });
    updateRestoreButton();
  }

  /* ---------------------------------------------------------
     Exportar
     --------------------------------------------------------- */
  function fileName() {
    return state.title
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\w\s-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'documento';
  }

  async function toDataURL(src) {
    const r = await apiFetch(src, { cache: 'force-cache' });
    if (!r.ok) throw new Error('no');
    const b = await r.blob();
    return await new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(String(fr.result));
      fr.onerror = rej;
      fr.readAsDataURL(b);
    });
  }

  async function exportWord() {
    const btn = $('#btn-word');
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Preparando…';

    let body = doc.innerHTML;
    try {
      const clone = doc.cloneNode(true);
      const originals = [...doc.querySelectorAll('img')];
      const copies = [...clone.querySelectorAll('img')];
      for (let i = 0; i < originals.length; i++) {
        const src = originals[i].getAttribute('src') || '';
        if (!src || src.startsWith('data:')) continue;
        try {
          copies[i].setAttribute('src', await toDataURL(src));
        } catch (e) { /* si falla, queda la ruta original */ }
      }
      body = clone.innerHTML;
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }

    const css = `
      @page { size: A4; margin: 2.54cm; }
      body { font-family: Arial, Helvetica, sans-serif; font-size: 12pt; line-height: 1.5; color:#000; }
      h1 { font-size: 12pt; text-align: center; text-transform: uppercase; margin: 0 0 12pt; }
      h2 { font-size: 12pt; margin: 16pt 0 6pt; }
      h3 { font-size: 12pt; font-style: italic; margin: 12pt 0 6pt; }
      h4 { font-size: 12pt; font-weight: normal; margin: 10pt 0 4pt; }
      p { text-align: left; margin: 0 0 8pt; text-indent: 1.27cm; }
      p.center, .center p, figure p, td p, .muted, figcaption { text-indent: 0; }
      .center { text-align: center; }
      ul, ol { margin: 0 0 10pt 1.27cm; }
      li { text-align: left; }
      table { border-collapse: collapse; width: 100%; margin: 8pt 0 14pt; }
      th, td { border: 1px solid #333; padding: 6pt; vertical-align: top; font-size: 12pt; text-align: left; }
      th { background: #eef2f8; }
      .page { page-break-after: always; }
      .img-slot, .photo-slot { border: 1px dashed #999; color:#666; text-align:center; padding: 20pt; font-style: italic; }
      .photo-slot { float: right; width: 3.2cm; height: 4cm; margin-left: 12pt; }
      .cover { display: block; height: auto; padding: 0; text-align: center; }
      .cover-bg { position: static; display: block; width: 13cm; height: auto; margin: 0 auto; }
      .cover-body { display: block; height: auto; padding: 14pt 0 0; }
      .cover p { text-indent: 0; }
      .cover-kicker { font-size: 12pt; font-weight: bold; letter-spacing: 2pt; color: #1b5e20; margin-bottom: 6pt; }
      .cover-title { font-size: 20pt; font-weight: bold; margin: 0 0 6pt; }
      .cover-year { font-size: 12pt; font-weight: bold; margin-bottom: 12pt; }
      .cover-authors { font-size: 12pt; }
      .cover-career { font-size: 12pt; color: #333; margin-top: 10pt; }
      .doc-head { text-align: center; border-bottom: 1.2pt solid #1b5e20; padding-bottom: 8pt; margin-bottom: 12pt; }
      .doc-head img { width: 2.9cm; height: auto; }
      .sig-table td { height: 60pt; vertical-align: bottom; }
      .sig-role, .muted { font-size: 9.5pt; color:#333; }
      figure { margin: 10pt 0; text-align: center; }
      figure img { max-width: 90%; }
      figcaption { font-size: 10pt; color: #555; font-style: italic; text-align: center; }
    `;

    const html =
      '<html xmlns:o="urn:schemas-microsoft-com:office:office" ' +
      'xmlns:w="urn:schemas-microsoft-com:office:word" ' +
      'xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8">' +
      `<title>${esc(fileName())}</title><style>${css}</style></head><body>` +
      body + '</body></html>';

    const blob = new Blob(['\ufeff', html], { type: 'application/msword' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fileName() + '.doc';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  /* ---------------------------------------------------------
     Capítulos (UI)
     --------------------------------------------------------- */
  function addChapter(title = '', subs = '') {
    const wrap = $('#chapters');
    const idx = wrap.children.length + 1;
    const box = el('div', 'chapter');
    const max = maxParciales();
    box.innerHTML = `
      <div class="chapter-top">
        <input class="ch-title" placeholder="Título del capítulo ${idx}" value="${esc(title)}">
        <select class="ch-parcial" title="Parcial al que pertenece esta unidad" aria-label="Parcial">
          ${Array.from({ length: max }, (_, i) =>
            `<option value="${i + 1}">Parcial ${i + 1}</option>`).join('')}
        </select>
        <button type="button" class="ch-del" title="Eliminar">×</button>
      </div>
      <textarea class="ch-subs" rows="3" placeholder="Un subtema por línea">${esc(subs)}</textarea>`;
    $('.ch-del', box).onclick = () => { box.remove(); };
    wrap.appendChild(box);
  }

  /* ---------------------------------------------------------
     Eventos
     --------------------------------------------------------- */
  function initTabs() {
    $$('.tab').forEach(t => {
      t.onclick = () => {
        $$('.tab').forEach(x => x.classList.remove('active'));
        $$('.pane').forEach(x => x.classList.remove('active'));
        t.classList.add('active');
        $('#form-' + t.dataset.tab).classList.add('active');
      };
    });
  }

  function initImages() {
    $('#btn-images').onclick = () => {
      state.pendingSlot = null;
      state.pendingFigure = null;
      openImages(currentTopic());
    };
    $('#img-close').onclick = closeImages;
    $('#img-modal').addEventListener('click', e => {
      if (e.target.id === 'img-modal') closeImages();
    });
    $('#img-search').onclick = () => {
      const q = $('#img-query').value.trim();
      if (q) searchImages(q);
    };
    $('#img-query').addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); $('#img-search').click(); }
    });
    $('#img-autofill').onclick = autofillImages;
    $('#img-remove').onclick = () => {
      if (state.pendingFigure && doc.contains(state.pendingFigure)) state.pendingFigure.remove();
      closeImages();
    };
    /* fuente por defecto: repositorios libres (sin Wikipedia) */
    if ($('#img-source')) { $('#img-source').value = 'free'; }

    /* los filtros de fecha/orden solo aplican a la búsqueda web */
    const syncSource = () => {
      const web = imgSource() === 'web';
      document.querySelectorAll('.only-web').forEach(el => { el.hidden = !web; });
    };
    syncSource();
    ['#img-source', '#img-recent', '#img-sort'].forEach(sel => {
      const ctrl = $(sel);
      if (!ctrl) return;
      ctrl.addEventListener('change', () => {
        syncSource();
        if ($('#img-modal').hidden) return;
        const q = $('#img-query').value.trim();
        if (q) searchImages(q);
      });
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !$('#img-modal').hidden) closeImages();
    });
    doc.addEventListener('click', e => {
      const img = e.target.closest ? e.target.closest('figure.doc-img > img') : null;
      if (img) {
        state.pendingFigure = img.closest('figure');
        state.pendingSlot = null;
        openImages(img.getAttribute('alt') || currentTopic());
        return;
      }
      const slot = e.target.closest ? e.target.closest('.img-slot') : null;
      if (!slot) return;
      state.pendingFigure = null;
      state.pendingSlot = slot;
      openImages(queryFromSlot(slot));
    });
  }

  function initActions() {    $$('[data-stop]').forEach(b => {
      b.onclick = () => { if (state.abort) state.abort.abort(); };
    });

    $('#btn-print').onclick = () => {
      if (!doc.textContent.trim()) return;
      window.print();
    };

    $('#btn-word').onclick = () => {
      if (!doc.textContent.trim()) return;
      exportWord();
    };

    $('#btn-clear').onclick = () => {
      if (state.busy) return;
      if (hasContent() && !confirm('¿Limpiar el documento actual? Si no lo has guardado, se perderá.')) return;
      doc.innerHTML = `<div class="empty">
        <h1>Generador de documentos</h1>
        <p>Completa el formulario y pulsa <strong>Generar</strong>.</p>
        <p class="muted">El resultado aparecerá aquí y podrás editarlo antes de exportarlo a PDF o Word.</p>
      </div>`;
      state.docId = null;
      state.docName = '';
      state.docSource = null;
      try { localStorage.removeItem(DRAFT_KEY); } catch (e) { /* nada */ }
      updateRestoreButton();
      setProgress(0, 1, 'Listo');
      $('#progress-bar').style.width = '0%';
    };

    $('#regen').onchange = async (e) => {
      const i = e.target.value;
      e.target.value = '';
      if (state.busy || i === '') return;
      const step = state.steps[Number(i)];
      if (!step) return;
      const target = $(step.target);
      if (!target) return;

      setBusy(true);
      setProgress(0, 1, 'Regenerando: ' + step.label);
      scrollToEl(target);
      try {
        const text = await streamGenerate(step.prompt, {
          num_predict: step.num_predict,
          temperature: step.temperature,
          system: step.system,
        }, target);
        const err = extractError(text);
        state.lastText = text;
        if (err) {
          target.innerHTML = `<p class="section-error">No se pudo generar: ${esc(err)}</p>`;
        } else if (typeof step.render === 'function') {
          await step.render(target, text);
        } else {
          target.innerHTML = mdToHtml(text);
        }
        setProgress(1, 1, 'Sección regenerada');
      } catch (err) {
        if (err.name !== 'AbortError') {
          target.innerHTML = `<p class="section-error">Error: ${esc(err.message)}</p>`;
        }
      } finally {
        state.abort = null;
        setBusy(false);
      }
    };

    $('#add-chapter').onclick = () => addChapter();
  }

  function initForms() {
    $('#form-academica').onsubmit = async (e) => {
      e.preventDefault();
      if (state.busy) return;
      const d = formData(e.target);
      if (!d.titulo) { alert('Escribe el título de la guía.'); return; }
      if (!chaptersFromUI().length) { alert('Agrega al menos un capítulo.'); return; }
      const steps = buildAcademic(d);
      await runSteps(steps, { history: true });
    };

    $('#btn-quiz-doc').onclick = async () => {
      if (state.busy) return;
      const d = formData($('#form-academica'));
      if (!d.titulo) { alert('Escribe el título de la guía.'); return; }
      if (!chaptersFromUI().length) { alert('Agrega al menos un capítulo.'); return; }
      const cfg = quizConfig(d);
      if (!cfg.includeUnit && !cfg.includeExam) {
        alert('Marca al menos un tipo de cuestionario.');
        return;
      }
      const steps = buildQuizDoc(d);
      await runSteps(steps, { history: true });
    };

    $('#form-practica').onsubmit = async (e) => {
      e.preventDefault();
      if (state.busy) return;
      const d = formData(e.target);
      if (!d.titulo) { alert('Escribe el título de la práctica.'); return; }
      const steps = buildPractice(d);
      await runSteps(steps, { history: true });
    };
  }

  function initChapters() {
    const parciales = $('#parciales');
    if (parciales) parciales.addEventListener('input', syncParcialOptions);
    addChapter(
      'Tendencias actuales del desarrollo de software',
      'Evolución del desarrollo de software\n' +
      'Inteligencia artificial generativa en el desarrollo\n' +
      'Desarrollo en la nube y arquitecturas modernas\n' +
      'DevOps, CI/CD y automatización\n' +
      'Ciberseguridad en el ciclo de vida del software\n' +
      'Low-code, no-code y herramientas de productividad'
    );
  }

  /* ---------------------------------------------------------
     Arranque
     --------------------------------------------------------- */
  function init() {
    initTabs();
    initActions();
    initImages();
    initAi();
    initDocs();
    initForms();
    initChapters();
    loadModels();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Depuración (consola del navegador)
  window.__guias = {
    parse: (t) => parseRubric(t),
    last: () => state.lastText || '',
    normalizeKey: normalizeQuizKey,
    renderQuiz,
    renderParagraphs,
    renderParagraphPair,
    runSteps,
    buildAcademic,
    buildQuizDoc,
    chapters: chaptersFromUI,
  };
})();
