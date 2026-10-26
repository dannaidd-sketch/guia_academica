<?php
declare(strict_types=1);

/**
 * Búsqueda de imágenes en repositorios libres mediante Openverse.
 * Agrega Flickr, museos y otros repositorios con licencias Creative Commons.
 * Se excluyen explícitamente los resultados de Wikipedia/Wikimedia.
 */

require_once __DIR__ . '/../lib/session.php';
require_once __DIR__ . '/../lib/cache.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
@set_time_limit(0);

$q = trim((string)($_GET['q'] ?? ''));
$n = max(1, min(24, (int)($_GET['n'] ?? 12)));

if ($q === '') {
    http_response_code(400);
    echo json_encode(['error' => 'Falta el término de búsqueda', 'images' => []], JSON_UNESCAPED_UNICODE);
    exit;
}

/* ---------- temas frecuentes: español -> inglés ---------- */
function translateTopic(string $q): string
{
    $map = [
        'inteligencia artificial'    => 'artificial intelligence',
        'aprendizaje automático'     => 'machine learning',
        'aprendizaje automatico'     => 'machine learning',
        'aprendizaje profundo'       => 'deep learning',
        'redes neuronales'           => 'neural network',
        'desarrollo de software'     => 'software development',
        'desarrollo web'             => 'web development',
        'aplicaciones móviles'       => 'mobile app development',
        'aplicaciones moviles'       => 'mobile app development',
        'base de datos'              => 'database',
        'bases de datos'             => 'database',
        'redes de computadoras'      => 'computer network',
        'redes de computadores'      => 'computer network',
        'redes'                      => 'computer network',
        'ciberseguridad'             => 'cybersecurity',
        'seguridad informática'      => 'computer security',
        'seguridad informatica'      => 'computer security',
        'computación en la nube'     => 'cloud computing',
        'computacion en la nube'     => 'cloud computing',
        'internet de las cosas'      => 'internet of things',
        'realidad virtual'           => 'virtual reality',
        'realidad aumentada'         => 'augmented reality',
        'robótica'                   => 'robotics',
        'robotica'                   => 'robotics',
        'cadena de bloques'          => 'blockchain',
        'programación'               => 'programming',
        'programacion'               => 'programming',
        'algoritmos'                 => 'algorithm',
        'estructuras de datos'       => 'data structure',
        'ingeniería de software'     => 'software engineering',
        'ingenieria de software'     => 'software engineering',
        'metodologías ágiles'        => 'agile software development',
        'metodologias agiles'        => 'agile software development',
        'análisis de datos'          => 'data analysis',
        'analisis de datos'          => 'data analysis',
        'inteligencia de negocios'   => 'business intelligence',
        'sistemas operativos'        => 'operating system',
        'arquitectura de software'   => 'software architecture',
        'pruebas de software'        => 'software testing',
        'calidad de software'        => 'software quality',
        'microservicios'             => 'microservices',
        'aplicaciones web'           => 'web application',
        'lenguajes de programación'  => 'programming language',
        'lenguajes de programacion'  => 'programming language',
        'bases de datos relacionales' => 'relational database',
        'big data'                   => 'big data',
        'devops'                     => 'devops',
        'scrum'                      => 'scrum software development',
        'java'                       => 'java programming',
        'python'                     => 'python programming',
        'javascript'                 => 'javascript programming',
        'blockchain'                 => 'blockchain',
        'cloud'                      => 'cloud computing',
        'iot'                        => 'internet of things',
    ];

    $low = mb_strtolower(trim($q));

    if (isset($map[$low])) {
        return $map[$low];
    }
    foreach ($map as $es => $en) {
        if (mb_strpos($low, $es) !== false) {
            return $en;
        }
    }
    return '';
}

function simplify(string $q): string
{
    $stop = ['de','del','la','el','los','las','un','una','unos','unas','en','y','o','para','con','por',
             'sobre','al','actual','actuales','nuevas','nuevos','tendencias','guia','guía','capítulo','capitulo'];

    $clean = mb_strtolower(preg_replace('/[^\p{L}\p{N}\s]/u', ' ', $q), 'UTF-8');
    $words = preg_split('/\s+/u', trim($clean), -1, PREG_SPLIT_NO_EMPTY);
    $words = array_values(array_filter($words, static fn($w) => !in_array($w, $stop, true) && mb_strlen($w) > 2));

    if (!$words) { return ''; }
    if (count($words) > 3) { $words = array_slice($words, -3); }
    return implode(' ', $words);
}

function licenseLabel(string $license, string $version): string
{
    $license = strtolower(trim($license));
    if ($license === '') { return 'Licencia libre'; }
    if ($license === 'cc0') { return 'CC0'; }
    if (in_array($license, ['pdm', 'pd'], true)) { return 'Dominio público'; }
    $label = 'CC ' . strtoupper($license);
    if ($version !== '') { $label .= ' ' . $version; }
    return $label;
}

/* ---------- caché local para no repetir consultas ---------- */
function cacheDir(): string
{
    $dir = __DIR__ . '/../cache/search';
    if (!is_dir($dir)) { @mkdir($dir, 0777, true); }
    return $dir;
}

function cacheGet(string $term): ?array
{
    $file = cacheDir() . '/' . md5(mb_strtolower($term)) . '.json';
    if (!is_file($file) || (time() - filemtime($file)) > 86400) { return null; }
    $data = json_decode((string)@file_get_contents($file), true);
    return is_array($data) ? $data : null;
}

function cachePut(string $term, array $items): void
{
    if (!$items) { return; }
    @file_put_contents(
        cacheDir() . '/' . md5(mb_strtolower($term)) . '.json',
        json_encode($items, JSON_UNESCAPED_UNICODE)
    );
    limpiar_cache(cacheDir(), CACHE_MAX_FILES, CACHE_MAX_AGE);
}

function openverseSearch(string $term, int $limit, ?string &$error = null): array
{
    $cached = cacheGet($term);
    if ($cached !== null) { return $cached; }

    /* las peticiones anónimas de Openverse admiten page_size <= 20 */
    $url = 'https://api.openverse.org/v1/images/?' . http_build_query([
        'q'          => $term,
        'page_size'  => max(10, min(20, $limit * 3)),
        'mature'     => 'false',
    ]);

    $options = [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS      => 3,
        CURLOPT_TIMEOUT        => 20,
        CURLOPT_CONNECTTIMEOUT => 8,
        // la red local no tiene IPv6: forzar IPv4 evita el error de conexión
        CURLOPT_IPRESOLVE      => CURL_IPRESOLVE_V4,
        CURLOPT_USERAGENT      => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) GeneradorGuias/1.2 (uso educativo)',
        CURLOPT_HTTPHEADER     => ['Accept: application/json'],
    ];

    $res = false;
    $code = 0;
    $waits = [1, 3];   /* si hay límite de peticiones, reintentar con espera corta */
    for ($try = 0; $try <= count($waits); $try++) {
        $ch = curl_init($url);
        curl_setopt_array($ch, $options);
        $res  = curl_exec($ch);
        $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($code !== 429) { break; }
        if ($try < count($waits)) { sleep($waits[$try]); }
    }

    if ($code === 429) {
        $error = 'rate-limit';
        return [];
    }
    if ($res === false || $code !== 200) {
        $error = $error ?: 'unavailable';
        return [];
    }

    $data = json_decode((string)$res, true);
    /* Cloudflare puede responder 200 con una página de verificación en lugar de JSON */
    if (!is_array($data)) {
        $error = 'rate-limit';
        return [];
    }
    if (isset($data['detail'])) {          /* la API rechazó la consulta */
        $error = 'unavailable';
        return [];
    }
    $rows = $data['results'] ?? [];

    $out = [];
    $usedTitles = [];
    foreach ($rows as $r) {
        $full  = (string)($r['url'] ?? '');
        $thumb = (string)($r['thumbnail'] ?? '');
        $page  = (string)($r['foreign_landing_url'] ?? '');

        if ($full === '' || $thumb === '') { continue; }
        if (!preg_match('#^https?://#i', $full)) { continue; }

        $source = strtolower((string)($r['source'] ?? $r['provider'] ?? ''));
        $pageHost = strtolower((string)parse_url($page !== '' ? $page : $full, PHP_URL_HOST));

        /* sin Wikipedia / Wikimedia */
        if (str_contains($source, 'wikimedia') || str_contains($source, 'wikipedia')) { continue; }
        if (str_contains($pageHost, 'wikimedia.org') || str_contains($pageHost, 'wikipedia.org')) { continue; }

        $width  = (int)($r['width'] ?? 0);
        $height = (int)($r['height'] ?? 0);
        if ($width > 0 && $width < 600) { continue; }

        $title = trim((string)($r['title'] ?? ''));
        if ($title === '') {
            $path  = (string)parse_url($full, PHP_URL_PATH);
            $title = urldecode(basename($path));
            $title = preg_replace('/\.[a-z0-9]{2,5}$/i', '', $title);
        }
        $title = trim(preg_replace('/\s+/u', ' ', (string)$title));
        if ($title === '') { $title = 'Imagen del tema'; }

        $year = 0;
        if (!empty($r['indexed_on'])) {
            $year = (int)substr((string)$r['indexed_on'], 0, 4);
        }

        /* limitar las fotos del mismo título (p. ej. un mismo evento) */
        $tkey = mb_strtolower($title);
        $usedTitles[$tkey] = ($usedTitles[$tkey] ?? 0) + 1;
        if ($usedTitles[$tkey] > 2) { continue; }

        $out[] = [
            'title'      => mb_substr($title, 0, 90),
            'thumb'      => $thumb,
            'full'       => $full,
            'download'   => $full,
            'page'       => $page,
            'width'      => $width,
            'height'     => $height,
            'artist'     => trim((string)($r['creator'] ?? '')),
            'license'    => licenseLabel((string)($r['license'] ?? ''), (string)($r['license_version'] ?? '')),
            'licenseUrl' => (string)($r['license_url'] ?? ''),
            'source'     => $source !== '' ? ucfirst($source) : 'Repositorio libre',
            'year'       => $year,
        ];

        if (count($out) >= $limit * 2) { break; }
    }

    cachePut($term, $out);
    return $out;
}

function mergeUnique(array $base, array $more): array
{
    $seen = [];
    foreach ($base as $img) { $seen[$img['full']] = true; }
    foreach ($more as $img) {
        if (!isset($seen[$img['full']])) {
            $base[] = $img;
            $seen[$img['full']] = true;
        }
    }
    return $base;
}

/* ---------- búsqueda ---------- */
$term   = translateTopic($q);
$usedQ  = $term !== '' ? $term : $q;
$error  = null;
$images = openverseSearch($usedQ, $n, $error);

if (!$error && count($images) < 4 && $usedQ !== $q) {
    $images = mergeUnique($images, openverseSearch($q, $n, $error));
}
if (!$error && count($images) < 4) {
    $simple = simplify($q);
    if ($simple !== '' && mb_strtolower($simple) !== mb_strtolower($q)) {
        $images = mergeUnique($images, openverseSearch($simple, $n, $error));
    }
}

$images = array_slice($images, 0, $n);

if ($error && !$images) {
    http_response_code($error === 'rate-limit' ? 429 : 502);
    echo json_encode([
        'error'  => $error === 'rate-limit'
            ? 'El repositorio limitó las peticiones. Espera un minuto y vuelve a intentar.'
            : 'No se pudo consultar el repositorio de imágenes. Revisa la conexión e inténtalo de nuevo.',
        'source' => 'openverse',
        'images' => [],
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

echo json_encode([
    'query'  => $usedQ,
    'source' => 'openverse',
    'images' => $images,
], JSON_UNESCAPED_UNICODE);
