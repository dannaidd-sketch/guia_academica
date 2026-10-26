<?php
declare(strict_types=1);

/**
 * Limpieza de HTML de los documentos guardados.
 *
 * Elimina etiquetas peligrosas y atributos activos (on*, javascript:, style
 * con url()/expression) para evitar XSS almacenado, conservando el formato
 * que produce el editor.
 */

function sanitize_document_html(string $html): string
{
    $html = trim($html);
    if ($html === '') {
        return '';
    }

    $doc = new DOMDocument('1.0', 'UTF-8');
    $erroresPrevios = libxml_use_internal_errors(true);

    $doc->loadHTML(
        '<?xml encoding="UTF-8"><div id="doc-root">' . $html . '</div>',
        LIBXML_HTML_NOIMPLIED | LIBXML_HTML_NODEFDTD
    );

    libxml_clear_errors();
    libxml_use_internal_errors($erroresPrevios);

    $root = $doc->getElementById('doc-root');
    if (!$root instanceof DOMElement) {
        return '';
    }

    $permitidas = [
        'p', 'div', 'span', 'br', 'hr',
        'section', 'article', 'header', 'footer', 'main', 'aside', 'nav',
        'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        'strong', 'b', 'em', 'i', 'u', 's', 'mark', 'small', 'sub', 'sup',
        'ul', 'ol', 'li', 'blockquote', 'code', 'pre',
        'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
        'figure', 'figcaption', 'img', 'a',
    ];

    $eliminar = [
        'script', 'style', 'iframe', 'object', 'embed', 'applet', 'frame', 'frameset',
        'form', 'input', 'button', 'textarea', 'select', 'option', 'optgroup',
        'svg', 'math', 'link', 'meta', 'base', 'template', 'noscript',
        'video', 'audio', 'source', 'track', 'canvas', 'portal',
    ];

    $atributos = [
        'class', 'href', 'src', 'alt', 'title', 'width', 'height',
        'colspan', 'rowspan', 'style', 'loading', 'rel', 'target',
    ];

    sanitize_children($root, $permitidas, $eliminar, $atributos);

    $out = '';
    foreach ($root->childNodes as $hijo) {
        $out .= $doc->saveHTML($hijo);
    }

    return trim($out);
}

function sanitize_children(DOMNode $padre, array $permitidas, array $eliminar, array $atributos): void
{
    $hijo = $padre->firstChild;

    while ($hijo !== null) {
        $siguiente = $hijo->nextSibling;

        if ($hijo instanceof DOMComment) {
            $padre->removeChild($hijo);
            $hijo = $siguiente;
            continue;
        }

        if (!($hijo instanceof DOMElement)) {
            $hijo = $siguiente;
            continue;
        }

        $tag = strtolower($hijo->tagName);

        if (in_array($tag, $eliminar, true)) {
            $padre->removeChild($hijo);
            $hijo = $siguiente;
            continue;
        }

        sanitize_attributes($hijo, $atributos);

        /* Primero limpiar los descendientes (así al desenvolver ya están limpios) */
        sanitize_children($hijo, $permitidas, $eliminar, $atributos);

        if (!in_array($tag, $permitidas, true)) {
            while ($hijo->firstChild !== null) {
                $padre->insertBefore($hijo->firstChild, $hijo);
            }
            $padre->removeChild($hijo);
        }

        $hijo = $siguiente;
    }
}

function sanitize_attributes(DOMElement $el, array $permitidos): void
{
    for ($i = $el->attributes->length - 1; $i >= 0; $i--) {
        $attr = $el->attributes->item($i);
        if (!$attr instanceof DOMAttr) {
            continue;
        }

        $nombre = strtolower($attr->name);
        $valor  = $attr->value;
        $ok     = in_array($nombre, $permitidos, true);

        if ($ok && str_starts_with($nombre, 'on')) {
            $ok = false;
        }

        if ($ok && preg_match('/javascript\s*:|vbscript\s*:|data:text\/html/i', $valor)) {
            $ok = false;
        }

        if ($ok && $nombre === 'style') {
            $ok = !preg_match('/expression|behavior|url\s*\(|@import|javascript\s*:/i', $valor);
        }

        if ($ok && ($nombre === 'src' || $nombre === 'href')) {
            $v = trim($valor);
            if ($nombre === 'src') {
                $ok = (bool) preg_match('#^(https?://|assets/|data:image/(png|jpe?g|webp|gif);base64,)#i', $v);
            } else {
                $ok = (bool) preg_match('#^(https?://|\#|mailto:)#i', $v);
            }
        }

        if ($ok && $nombre === 'target') {
            $ok = in_array($valor, ['_blank', '_self'], true);
        }

        if (!$ok) {
            $el->removeAttributeNode($attr);
        }
    }

    if (strtolower($el->tagName) === 'a' && $el->hasAttribute('target')) {
        $el->setAttribute('rel', 'noopener noreferrer');
    }
}
