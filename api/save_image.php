<?php
declare(strict_types=1);

/**
 * Descarga una imagen de un repositorio público y la guarda en assets/cache.
 *
 * Protecciones:
 *  - Solo https (los enlaces http se elevan a https).
 *  - Sin redirecciones: cada URL se valida antes de descargar.
 *  - Se resuelve el dominio y se fija la IP pública con CURLOPT_RESOLVE
 *    (evita DNS rebinding y bloquea redes privadas).
 *  - Descarga en streaming con límite de tamaño.
 *  - Se verifica que el archivo sea realmente una imagen.
 */

require_once __DIR__ . '/../lib/session.php';
require_csrf();
require_once __DIR__ . '/../lib/cache.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

function fallar(string $mensaje, int $codigo): void
{
    http_response_code($codigo);
    echo json_encode(['error' => $mensaje], JSON_UNESCAPED_UNICODE);
    exit;
}

$raw  = file_get_contents('php://input');
$data = json_decode((string) $raw, true);
$url  = trim((string) ($data['url'] ?? ''));

if ($url === '' || !filter_var($url, FILTER_VALIDATE_URL)) {
    fallar('URL inválida', 400);
}

/* Solo https: si llega http, se intenta la versión segura */
$url = preg_replace('#^http://#i', 'https://', $url) ?? $url;

$partes = parse_url($url);
if (!is_array($partes)) {
    fallar('URL inválida', 400);
}

$scheme = strtolower((string) ($partes['scheme'] ?? ''));
$host   = strtolower(trim((string) ($partes['host'] ?? ''), '[]'));
$puerto = (int) ($partes['port'] ?? 443);

if ($scheme !== 'https') {
    fallar('Solo se permiten enlaces https', 400);
}
if ($host === '') {
    fallar('URL sin host', 400);
}
if (isset($partes['user']) || isset($partes['pass'])) {
    fallar('URL no permitida', 400);
}
if (!in_array($puerto, [443, 8443], true)) {
    fallar('Puerto no permitido', 400);
}

/* Resolver el dominio y exigir que todas sus IP sean públicas */
$ips = [];
if (filter_var($host, FILTER_VALIDATE_IP)) {
    $ips = [$host];
} else {
    $lista = @gethostbynamel($host);
    if (!is_array($lista) || $lista === []) {
        fallar('No se pudo resolver el dominio de la imagen', 400);
    }
    $ips = array_values(array_unique($lista));
}

foreach ($ips as $ip) {
    if (!filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)) {
        fallar('Origen no permitido', 400);
    }
}

$dir = __DIR__ . '/../assets/cache';
if (!is_dir($dir) && !mkdir($dir, 0775, true) && !is_dir($dir)) {
    fallar('No se pudo crear la carpeta de imágenes', 500);
}

$tmp = tempnam(sys_get_temp_dir(), 'istel_img_');
if ($tmp === false) {
    fallar('No se pudo preparar la descarga', 500);
}

$fh = fopen($tmp, 'wb');
if ($fh === false) {
    @unlink($tmp);
    fallar('No se pudo preparar la descarga', 500);
}

$escrito  = 0;
$excedido = false;

$ch = curl_init($url);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER    => false,
    CURLOPT_FOLLOWLOCATION    => false,
    CURLOPT_TIMEOUT           => 40,
    CURLOPT_CONNECTTIMEOUT    => 8,
    CURLOPT_USERAGENT         => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) GeneradorGuias/1.3',
    CURLOPT_PROTOCOLS         => CURLPROTO_HTTPS,
    CURLOPT_SSL_VERIFYPEER    => true,
    CURLOPT_SSL_VERIFYHOST    => 2,
    CURLOPT_RESOLVE           => filter_var($host, FILTER_VALIDATE_IP) ? [] : [$host . ':' . $puerto . ':' . $ips[0]],
    CURLOPT_WRITEFUNCTION     => static function ($ch, string $chunk) use ($fh, &$escrito, &$excedido): int {
        $len = strlen($chunk);
        $escrito += $len;

        if ($escrito > MAX_IMAGE_BYTES) {
            $excedido = true;
            return 0;
        }

        $n = fwrite($fh, $chunk);
        return $n === false ? 0 : $n;
    },
]);

$ok   = curl_exec($ch);
$code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);
fclose($fh);

if ($excedido) {
    @unlink($tmp);
    fallar('La imagen supera ' . (int) (MAX_IMAGE_BYTES / 1024 / 1024) . ' MB', 413);
}

if ($ok === false || $code !== 200 || $escrito === 0) {
    @unlink($tmp);
    fallar('No se pudo descargar la imagen', 502);
}

/* Verificar que sea una imagen real (no un HTML disfrazado) */
$info = @getimagesize($tmp);
$tipos = [
    IMAGETYPE_JPEG => 'jpg',
    IMAGETYPE_PNG  => 'png',
    IMAGETYPE_WEBP => 'webp',
];

$tipo = (int) ($info[2] ?? 0);
if (!isset($tipos[$tipo])) {
    @unlink($tmp);
    fallar('Formato no admitido (solo JPG, PNG o WebP)', 415);
}

$name = sha1($url) . '.' . $tipos[$tipo];
$path = $dir . '/' . $name;

if (!is_file($path)) {
    if (!@rename($tmp, $path)) {
        if (!@copy($tmp, $path)) {
            @unlink($tmp);
            fallar('No se pudo guardar la imagen', 500);
        }
    }
}

@unlink($tmp);
limpiar_cache($dir, CACHE_MAX_FILES, CACHE_MAX_AGE, imagenes_en_uso(__DIR__ . '/../docs'));

echo json_encode([
    'path'  => 'assets/cache/' . $name,
    'mime'  => $tipos[$tipo] === 'jpg' ? 'image/jpeg' : 'image/' . $tipos[$tipo],
    'bytes' => filesize($path) ?: $escrito,
], JSON_UNESCAPED_UNICODE);
