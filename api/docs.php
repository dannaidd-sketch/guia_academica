<?php
declare(strict_types=1);

/**
 * Guardado y recuperación de documentos generados.
 *
 * Acciones:
 *   POST ?action=save    { id?, name, mode, title, html }  -> { id, savedAt }
 *   GET  ?action=list                                      -> { docs: [...] }
 *   GET  ?action=load&id=xxxxxxxxxxxxxxxx                   -> { id, name, mode, title, html, savedAt }
 *   POST ?action=delete  { id }                             -> { ok: true }
 */

require_once __DIR__ . '/../lib/session.php';
require_once __DIR__ . '/../lib/html_sanitizer.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
@set_time_limit(0);

const MAX_HTML = MAX_HTML_BYTES;

$dir = __DIR__ . '/../docs';
if (!is_dir($dir)) { @mkdir($dir, 0777, true); }
$idxFile = $dir . '/index.json';

function send(array $data, int $code = 200): void
{
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

function readIndex(string $idxFile): array
{
    if (!is_file($idxFile)) { return []; }

    $fh = @fopen($idxFile, 'rb');
    if (!$fh) { return []; }

    @flock($fh, LOCK_SH);
    $raw = stream_get_contents($fh);
    @flock($fh, LOCK_UN);
    fclose($fh);

    $d = json_decode((string) $raw, true);
    return is_array($d) ? $d : [];
}

/**
 * Abre el índice con bloqueo exclusivo, permite modificarlo y lo reescribe.
 * Devuelve false si no se pudo abrir el archivo.
 */
function updateIndex(string $idxFile, callable $fn): bool
{
    $fh = @fopen($idxFile, 'c+');
    if (!$fh) { return false; }

    @flock($fh, LOCK_EX);
    $raw = stream_get_contents($fh);
    $idx = json_decode((string) $raw, true);
    if (!is_array($idx)) { $idx = []; }

    $fn($idx);

    @ftruncate($fh, 0);
    @rewind($fh);
    $ok = @fwrite($fh, json_encode(array_values($idx), JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT)) !== false;
    @fflush($fh);
    @flock($fh, LOCK_UN);
    fclose($fh);

    return $ok;
}

function validId($id): bool
{
    return is_string($id) && preg_match('/^[a-f0-9]{16}$/', $id) === 1;
}

$action = (string) ($_GET['action'] ?? '');
$raw    = file_get_contents('php://input');
$body   = $raw ? json_decode($raw, true) : [];
if (!is_array($body)) { $body = []; }

if (in_array($action, ['save', 'delete'], true)) {
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
        send(['error' => 'Método no permitido.'], 405);
    }
    require_csrf();
}

switch ($action) {

    case 'save': {
        $name = trim((string) ($body['name'] ?? ''));
        if ($name === '') { $name = 'Documento sin título'; }
        $name = mb_substr($name, 0, 120);

        $mode  = (string) ($body['mode'] ?? 'academica');
        if (!in_array($mode, ['academica', 'practica', 'cuestionarios'], true)) {
            $mode = 'academica';
        }
        $title = mb_substr(trim((string) ($body['title'] ?? '')), 0, 200);

        /* Se limpia el HTML: sin scripts, iframes ni atributos activos */
        $html = sanitize_document_html((string) ($body['html'] ?? ''));

        if (trim(strip_tags($html)) === '') {
            send(['error' => 'El documento está vacío.'], 400);
        }
        if (strlen($html) > MAX_HTML) {
            send(['error' => 'El documento es demasiado grande para guardarlo.'], 413);
        }

        $id = (string) ($body['id'] ?? '');
        if (!validId($id) || !is_file($dir . '/' . $id . '.json')) {
            $id = bin2hex(random_bytes(8));
        }

        $savedAt = time();
        $doc = [
            'id'      => $id,
            'name'    => $name,
            'mode'    => $mode,
            'title'   => $title,
            'savedAt' => $savedAt,
            'html'    => $html,
        ];

        if (@file_put_contents($dir . '/' . $id . '.json', json_encode($doc, JSON_UNESCAPED_UNICODE)) === false) {
            send(['error' => 'No se pudo escribir el archivo. Revisa los permisos de la carpeta docs/.'], 500);
        }

        $ok = updateIndex($idxFile, static function (array &$idx) use ($id, $name, $mode, $title, $savedAt, $html, $dir): void {
            $idx = array_values(array_filter($idx, static fn(array $d): bool => ($d['id'] ?? '') !== $id));
            $idx[] = [
                'id'      => $id,
                'name'    => $name,
                'mode'    => $mode,
                'title'   => $title,
                'savedAt' => $savedAt,
                'size'    => strlen($html),
            ];

            /* Límite de documentos: se eliminan los más antiguos */
            if (count($idx) > MAX_DOCS) {
                usort($idx, static fn(array $a, array $b): int => ($b['savedAt'] ?? 0) <=> ($a['savedAt'] ?? 0));
                $sobrantes = array_slice($idx, MAX_DOCS);
                $idx = array_slice($idx, 0, MAX_DOCS);
                foreach ($sobrantes as $viejo) {
                    $viejoId = (string) ($viejo['id'] ?? '');
                    if (validId($viejoId)) {
                        @unlink($dir . '/' . $viejoId . '.json');
                    }
                }
            }
        });

        if (!$ok) {
            @unlink($dir . '/' . $id . '.json');
            send(['error' => 'No se pudo actualizar el índice de documentos.'], 500);
        }

        send(['ok' => true, 'id' => $id, 'name' => $name, 'savedAt' => $savedAt]);
    }

    case 'list': {
        $idx = readIndex($idxFile);
        usort($idx, static fn(array $a, array $b): int => ($b['savedAt'] ?? 0) <=> ($a['savedAt'] ?? 0));
        send(['docs' => $idx]);
    }

    case 'load': {
        $id = (string) ($_GET['id'] ?? '');
        if (!validId($id)) { send(['error' => 'Identificador no válido.'], 400); }
        $file = $dir . '/' . $id . '.json';
        if (!is_file($file)) { send(['error' => 'El documento no existe.'], 404); }
        $doc = json_decode((string) @file_get_contents($file), true);
        if (!is_array($doc) || !isset($doc['html'])) { send(['error' => 'El archivo está dañado.'], 500); }
        send([
            'id'      => $doc['id'] ?? $id,
            'name'    => $doc['name'] ?? 'Documento',
            'mode'    => $doc['mode'] ?? 'academica',
            'title'   => $doc['title'] ?? '',
            'savedAt' => $doc['savedAt'] ?? 0,
            'html'    => sanitize_document_html((string) $doc['html']),
        ]);
    }

    case 'delete': {
        $id = (string) ($body['id'] ?? ($_GET['id'] ?? ''));
        if (!validId($id)) { send(['error' => 'Identificador no válido.'], 400); }

        $file = $dir . '/' . $id . '.json';
        if (is_file($file)) { @unlink($file); }

        updateIndex($idxFile, static function (array &$idx) use ($id): void {
            $idx = array_values(array_filter($idx, static fn(array $d): bool => ($d['id'] ?? '') !== $id));
        });

        send(['ok' => true]);
    }

    default:
        send(['error' => 'Acción no reconocida.'], 400);
}
