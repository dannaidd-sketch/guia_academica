<?php
declare(strict_types=1);

require_once __DIR__ . '/lib/session.php';

header('Cache-Control: no-store, no-cache, must-revalidate');

$d = [
    'instituto' => 'Instituto Superior Tecnológico El Libertador',
    'carrera'   => 'Tecnología Superior en Desarrollo de Software',
    'asignatura'=> 'Tendencias Actuales de Desarrollo de Software',
    'nivel'     => 'IV',
    'docente'   => 'Ing. Diana Ramirez Garófalo',
    'semana'    => 'Semanas 1-2',
    'nro'       => '1',
    'duracion'  => '3 horas',
    'elaborado' => 'Ing. Diana Ramirez Garófalo',
    'revisado'  => 'Coordinador de la Carrera de Desarrollo de Software',
    'aprobado'  => 'Ing. Jhony Pozo',
    'normas'    => "Está estrictamente prohibido comer o beber en el laboratorio\nUso adecuado de sillas y mesas\nManejo adecuado de equipos y accesorios del laboratorio\nGuardar y respaldar datos\nConocer las rutas de evacuación\nUso responsable de internet y redes\nNo obstruir pasillos y salidas de emergencia",
];
function h($s): string { return htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8'); }
?>
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="csrf-token" content="<?= h(csrf_token()) ?>">
<title>Generador de Guías · ISTEL</title>
<link rel="stylesheet" href="assets/styles.css?v=<?= @filemtime(__DIR__ . '/assets/styles.css') ?: time() ?>">
</head>
<body>

<header class="topbar">
  <div class="brand">
    <span class="badge">IA</span>
    <div>
      <strong>Generador de Guías</strong>
      <small>Guía Académica · Guía de Prácticas</small>
    </div>
  </div>
  <div class="topbar-right">
    <label class="model-pick">
      <span>Modelo</span>
      <select id="model"></select>
    </label>
    <span id="status" class="status" title="Estado de Ollama">verificando…</span>
  </div>
</header>

<main class="layout">
  <!-- ============ PANEL DE FORMULARIO ============ -->
  <aside class="sidebar">
    <div class="tabs">
      <button class="tab active" data-tab="academica">Guía Académica</button>
      <button class="tab" data-tab="practica">Guía de Práctica</button>
    </div>

    <!-- ---------- ACADÉMICA ---------- -->
    <form id="form-academica" class="pane active" autocomplete="off">
      <div class="grid2">
        <label>Institución<input name="instituto" value="<?= h($d['instituto']) ?>"></label>
        <label>Carrera<input name="carrera" value="<?= h($d['carrera']) ?>"></label>
      </div>
      <div class="grid2">
        <label>Asignatura<input name="asignatura" value="<?= h($d['asignatura']) ?>"></label>
        <label>Nivel<input name="nivel" value="<?= h($d['nivel']) ?>"></label>
      </div>
      <div class="grid2">
        <label>Título de la guía<input name="titulo" value="<?= h($d['asignatura']) ?>"></label>
        <label>Año<input name="anio" value="<?= date('Y') ?>"></label>
      </div>
      <label>Autor(es)<input name="autores" value="<?= h($d['docente']) ?>"></label>

      <label>Enfoque metodológico
        <textarea name="metodologia" rows="2">Clases teóricas, prácticas de laboratorio y aprendizaje basado en proyectos.</textarea>
      </label>

      <div class="section-head">
        <span>Capítulos y contenidos</span>
        <button type="button" id="add-chapter" class="mini">+ Capítulo</button>
      </div>
      <div id="chapters"></div>

      <label>Parciales
        <input type="number" name="parciales" id="parciales" min="1" max="6" step="1" value="2">
        <span class="hint">Asigna cada capítulo a un parcial en su tarjeta. Los parciales sin capítulos no generan examen.</span>
      </label>

      <label class="check">
        <input type="checkbox" name="quiz_unidad" checked>
        <span>Cuestionario de repaso (10 preguntas) después de cada unidad</span>
      </label>
      <label class="check">
        <input type="checkbox" name="quiz_parcial" checked>
        <span>Examen de evaluación (30 preguntas) por cada parcial</span>
      </label>

      <label class="check">
        <input type="checkbox" name="ejercicios" checked>
        <span>Incluir un ejercicio práctico paso a paso en cada capítulo</span>
      </label>

      <label>Referencias (una por línea, opcional)
        <textarea name="referencias" rows="3" placeholder="Si lo dejas vacío, la IA propondrá referencias que deberás verificar."></textarea>
      </label>

      <details class="hv">
        <summary>Hoja de vida del autor</summary>
        <label>Nombres y apellidos<input name="hv_nombre" value="<?= h($d['docente']) ?>"></label>
        <div class="grid2">
          <label>Título profesional<input name="hv_titulo" value="Ingeniera en Sistemas"></label>
          <label>Teléfono<input name="hv_tel" placeholder="09xxxxxxxx"></label>
        </div>
        <label>Correo<input name="hv_mail" placeholder="correo@ejemplo.com"></label>
        <label>Experiencia (breve)
          <textarea name="hv_exp" rows="2" placeholder="Docente de la carrera de Desarrollo de Software…"></textarea>
        </label>
      </details>

      <div class="actions">
        <button type="submit" class="primary" id="btn-academica">Generar guía académica</button>
        <button type="button" class="ghost" id="btn-quiz-doc" title="Generar un documento solo con los cuestionarios">Solo cuestionarios</button>
        <button type="button" class="ghost stop" data-stop>Detener</button>
      </div>
      <span class="hint">Cada subtema se redacta en dos llamadas para obtener 4 párrafos completos. La generación puede tardar varios minutos.</span>
    </form>

    <!-- ---------- PRÁCTICA ---------- -->
    <form id="form-practica" class="pane" autocomplete="off">
      <div class="grid2">
        <label>Carrera<input name="carrera" value="<?= h($d['carrera']) ?>"></label>
        <label>Asignatura<input name="asignatura" value="<?= h($d['asignatura']) ?>"></label>
      </div>
      <label>Título de la práctica<input name="titulo" placeholder="Ej.: Implementación de una API REST con Node.js"></label>
      <div class="grid2">
        <label>Nivel académico<input name="nivel" value="<?= h($d['nivel']) ?>"></label>
        <label>Nro. de práctica<input name="nro" value="<?= h($d['nro']) ?>"></label>
      </div>
      <div class="grid2">
        <label>Docente<input name="docente" value="<?= h($d['docente']) ?>"></label>
        <label>Semana clase práctica<input name="semana" value="<?= h($d['semana']) ?>"></label>
      </div>
      <div class="grid2">
        <label>Tiempo de duración<input name="duracion" value="<?= h($d['duracion']) ?>"></label>
        <label>Fechas<input name="fecha" value="<?= date('d-m-Y') ?> a <?= date('d-m-Y', strtotime('+14 days')) ?>"></label>
      </div>

      <label>Indicaciones para la IA (tema, herramientas, enfoque)
        <textarea name="tema" rows="3" placeholder="Ej.: Consumir una API pública desde PHP, manejar errores y mostrar resultados en una tabla."></textarea>
      </label>

      <label>Normas de seguridad (una por línea)
        <textarea name="normas" rows="5"><?= h($d['normas']) ?></textarea>
      </label>

      <details class="hv">
        <summary>Firmas de responsabilidad</summary>
        <label>Elaborado por<input name="elaborado" value="<?= h($d['elaborado']) ?>"></label>
        <label>Revisado por<input name="revisado" value="<?= h($d['revisado']) ?>"></label>
        <label>Aprobado por<input name="aprobado" value="<?= h($d['aprobado']) ?>"></label>
        <div class="grid2">
          <label>Fecha elaboración<input name="f_elab" value="<?= date('d-m-Y') ?>"></label>
          <label>Fecha revisión<input name="f_rev" value="<?= date('d-m-Y') ?>"></label>
        </div>
        <label>Fecha aprobación<input name="f_apro" value="<?= date('d-m-Y') ?>"></label>
      </details>

      <div class="actions">
        <button type="submit" class="primary" id="btn-practica">Generar guía de práctica</button>
        <button type="button" class="ghost stop" data-stop>Detener</button>
      </div>
    </form>
  </aside>

  <!-- ============ ÁREA DE DOCUMENTO ============ -->
  <section class="workspace">
    <div class="toolbar">
      <div class="progress-wrap">
        <div class="progress"><div id="progress-bar"></div></div>
        <span id="progress-text">Listo</span>
      </div>
      <div class="tools">
        <select id="regen" title="Regenerar una sección con IA">
          <option value="">Regenerar sección…</option>
        </select>
        <span class="edit-hint" title="Haz clic en el documento para editarlo">✎ Editable</span>
        <button type="button" class="ghost" id="btn-ai" title="Ampliar o cambiar el contenido con IA">IA</button>
        <button type="button" class="ghost" id="btn-images" title="Buscar imágenes del tema">Imágenes</button>
        <button type="button" class="ghost" id="btn-save" title="Guardar el documento (Ctrl+S)">Guardar</button>
        <button type="button" class="ghost" id="btn-open" title="Abrir un documento guardado">Abrir</button>
        <button type="button" class="ghost" id="btn-restore" title="Recuperar el borrador no guardado" hidden>Borrador</button>
        <button type="button" class="ghost" id="btn-print" title="Imprimir o guardar como PDF">PDF</button>
        <button type="button" class="ghost" id="btn-word" title="Descargar en Word">Word</button>
        <button type="button" class="ghost" id="btn-clear">Limpiar</button>
      </div>
    </div>

    <div id="viewport">
      <div id="doc" class="doc" contenteditable="true" spellcheck="false">
        <div class="empty">
          <h1>Generador de documentos</h1>
          <p>Completa el formulario y pulsa <strong>Generar</strong>.</p>
          <p class="muted">El resultado aparecerá aquí y podrás editarlo antes de exportarlo a PDF o Word.</p>
        </div>
      </div>
    </div>
  </section>
</main>

<div id="img-modal" class="modal" hidden>
  <div class="modal-card">
    <header class="modal-head">
      <div>
        <h3>Imágenes del tema</h3>
        <p class="muted">Openverse · repositorios libres (Flickr y otros, sin Wikipedia)</p>
      </div>
      <button type="button" class="icon" id="img-close" title="Cerrar">×</button>
    </header>

    <div class="modal-search">
      <input id="img-query" placeholder="Ej.: inteligencia artificial, redes de computadoras, bases de datos…">
      <button type="button" class="primary" id="img-search">Buscar</button>
    </div>

    <div class="modal-tools">
      <label class="img-opt">Fuente:
        <select id="img-source">
          <option value="free" selected>Repositorios libres</option>
          <option value="web">Web (imágenes actuales)</option>
        </select>
      </label>
      <label class="img-opt only-web" hidden><input type="checkbox" id="img-recent" checked> Solo recientes (5 años)</label>
      <label class="img-opt only-web" hidden>Orden:
        <select id="img-sort">
          <option value="relevance">Relevancia</option>
          <option value="recent">Más recientes</option>
        </select>
      </label>
      <button type="button" class="ghost" id="img-autofill">Rellenar los capítulos</button>
      <button type="button" class="ghost danger" id="img-remove" hidden>Quitar imagen actual</button>
      <span id="img-status"></span>
    </div>
    <p id="img-replace-note" class="muted" hidden style="padding:0 18px 6px">Elige otra imagen de la lista para reemplazar la que está en el documento.</p>

    <div id="img-results" class="img-grid">
      <p class="muted">Escribe un tema y pulsa Buscar. Haz clic en una imagen para insertarla.</p>
    </div>
  </div>
</div>

<!-- ============ ASISTENTE DE IA ============ -->
<div id="ai-modal" class="modal" hidden>
  <div class="modal-card">
    <header class="modal-head">
      <div>
        <h3>Asistente de redacción (IA)</h3>
        <p class="muted">Amplía, resume, reescribe o cambia el contenido del documento</p>
      </div>
      <button type="button" class="icon" id="ai-close" title="Cerrar">×</button>
    </header>

    <div class="modal-tools">
      <label class="img-opt">Alcance:
        <select id="ai-scope">
          <option value="section" selected>Sección actual (reescribir)</option>
          <option value="section-add">Ampliar la sección actual</option>
          <option value="block">Párrafo o lista bajo el cursor</option>
          <option value="append">Nueva sección al final</option>
        </select>
      </label>
      <span id="ai-context" class="muted"></span>
    </div>

    <div class="ai-chips">
      <button type="button" class="chip" data-prompt="Amplía con más detalle, definiciones y un ejemplo práctico de aplicación.">Ampliar</button>
      <button type="button" class="chip" data-prompt="Agrega una tabla comparativa con ventajas, desventajas y usos.">Tabla</button>
      <button type="button" class="chip" data-prompt="Agrega ejemplos concretos y actuales relacionados con el tema.">Ejemplos</button>
      <button type="button" class="chip" data-prompt="Reescribe con un lenguaje académico formal, claro y directo.">Reescribir</button>
      <button type="button" class="chip" data-prompt="Resume manteniendo las ideas principales.">Resumir</button>
      <button type="button" class="chip" data-prompt="Corrige la ortografía, la puntuación y la redacción sin cambiar las ideas.">Ortografía</button>
      <button type="button" class="chip" data-prompt="Agrega una lista de ventajas y otra de desventajas.">Ventajas</button>
    </div>

    <div class="modal-search">
      <input id="ai-prompt" placeholder="Ej.: amplía la sección con un ejemplo de aplicación y una tabla comparativa">
      <button type="button" class="primary" id="ai-run">Generar</button>
    </div>
    <p class="muted" style="padding:0 18px 6px">La IA no modifica el documento hasta que pulses un botón de la vista previa.</p>

    <div id="ai-preview" class="ai-preview">
      <p class="muted">Escribe una instrucción o elige una acción rápida y pulsa <strong>Generar</strong>.</p>
    </div>

    <div class="modal-tools ai-actions">
      <button type="button" class="primary" id="ai-apply" hidden>Reemplazar</button>
      <button type="button" class="ghost" id="ai-append" hidden>Añadir al final</button>
      <button type="button" class="ghost" id="ai-copy" hidden>Copiar</button>
      <span id="ai-status"></span>
    </div>
  </div>
</div>

<!-- ============ DOCUMENTOS GUARDADOS ============ -->
<div id="docs-modal" class="modal" hidden>
  <div class="modal-card">
    <header class="modal-head">
      <div>
        <h3>Documentos guardados</h3>
        <p class="muted">Ábrelos para seguir editándolos, o elimínalos</p>
      </div>
      <button type="button" class="icon" id="docs-close" title="Cerrar">×</button>
    </header>

    <div id="docs-list" class="docs-list">
      <p class="muted">Cargando…</p>
    </div>

    <div class="modal-tools ai-actions">
      <button type="button" class="primary" id="docs-save">Guardar el documento actual</button>
      <button type="button" class="ghost" id="docs-save-as">Guardar como copia</button>
      <span id="docs-status"></span>
    </div>
  </div>
</div>

<script src="assets/app.js?v=<?= @filemtime(__DIR__ . '/assets/app.js') ?: time() ?>"></script>
</body>
</html>
