<?php
declare(strict_types=1);

require_once __DIR__ . '/../lib/session.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

$ch = curl_init('http://127.0.0.1:11434/api/tags');
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_PROXY          => '',
    CURLOPT_TIMEOUT        => 6,
    CURLOPT_CONNECTTIMEOUT => 3,
]);

$res  = curl_exec($ch);
$code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
$err  = curl_error($ch);
curl_close($ch);

if ($res === false || $code !== 200) {
    http_response_code(503);
    echo json_encode([
        'error'  => 'No se puede conectar con Ollama' . ($err ? ': ' . $err : ''),
        'models' => [],
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

$data   = json_decode((string)$res, true);
$models = [];

foreach (($data['models'] ?? []) as $m) {
    if (!empty($m['name'])) {
        $models[] = $m['name'];
    }
}
sort($models);

echo json_encode(['models' => $models], JSON_UNESCAPED_UNICODE);
