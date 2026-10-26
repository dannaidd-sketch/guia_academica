<?php
declare(strict_types=1);

require_once __DIR__ . '/../lib/session.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

$q = trim((string)($_GET['q'] ?? ''));
$n = max(1, min(30, (int)($_GET['n'] ?? 12)));

if ($q === '') {
    http_response_code(400);
    echo json_encode(['error' => 'Falta el término de búsqueda', 'images' => []], JSON_UNESCAPED_UNICODE);
    exit;
}

$url = 'https://www.bing.com/images/search?' . http_build_query([
    'q'        => $q,
    'first'    => 1,
    'count'    => 35,
    'setlang'  => 'es',
]);

$ch = curl_init($url);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_MAXREDIRS      => 3,
    CURLOPT_TIMEOUT        => 25,
    CURLOPT_CONNECTTIMEOUT => 8,
    CURLOPT_PROTOCOLS      => CURLPROTO_HTTPS,
    CURLOPT_USERAGENT      => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    CURLOPT_HTTPHEADER     => [
        'Accept-Language: es-ES,es;q=0.9,en;q=0.8',
        'Accept: text/html,application/xhtml+xml',
    ],
]);

$html = curl_exec($ch);
$code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
$err  = curl_error($ch);
curl_close($ch);

if ($html === false || $code !== 200) {
    http_response_code(502);
    echo json_encode([
        'error'  => 'No se pudo consultar la búsqueda web' . ($err ? ': ' . $err : ''),
        'images' => [],
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

$items = [];
if (preg_match_all('/m="(\{[^"]+\})"/', (string)$html, $matches)) {
    foreach ($matches[1] as $raw) {
        $json = html_entity_decode($raw, ENT_QUOTES | ENT_HTML5, 'UTF-8');
        $data = json_decode($json, true);
        if (!is_array($data)) { continue; }

        $full = (string)($data['murl'] ?? '');
        $thumb = (string)($data['turl'] ?? '');
        $page = (string)($data['purl'] ?? '');
        if ($full === '' || $thumb === '') { continue; }
        if (!preg_match('#^https?://#i', $full) || !preg_match('#^https?://#i', $thumb)) { continue; }
        if (preg_match('/\.svg(\?|$)/i', $full)) { continue; }

        $host = strtolower((string)parse_url($page !== '' ? $page : $full, PHP_URL_HOST));
        $host = preg_replace('/^www\./', '', $host) ?: '';

        $title = trim((string)($data['t'] ?? ''));
        if ($title === '') {
            $path  = (string)parse_url($full, PHP_URL_PATH);
            $title = urldecode(basename($path));
            $title = preg_replace('/\.[a-z0-9]{2,5}$/i', '', $title);
        }
        $title = preg_replace('/[_\-]+/', ' ', $title);
        $title = trim(preg_replace('/\s+/u', ' ', (string)$title));
        if ($title === '') { $title = 'Imagen del tema'; }

        $year = 0;
        if (preg_match('#/(20\d{2})/\d{1,2}/#', $full, $m)) {
            $year = (int)$m[1];
        } elseif (preg_match('#(20\d{2})#', $full, $m)) {
            $year = (int)$m[1];
        }

        $items[] = [
            'title'   => mb_substr($title, 0, 90),
            'thumb'   => $thumb,
            'full'    => $full,
            'page'    => $page,
            'source'  => $host,
            'year'    => $year,
            'artist'  => '',
            'license' => '',
        ];

        if (count($items) >= 40) { break; }
    }
}

/* quitar repetidas */
$seen = [];
$out  = [];
foreach ($items as $img) {
    $key = $img['full'];
    if (isset($seen[$key])) { continue; }
    $seen[$key] = true;
    $out[] = $img;
}

echo json_encode([
    'query'  => $q,
    'source' => 'web',
    'images' => array_slice($out, 0, $n),
], JSON_UNESCAPED_UNICODE);
