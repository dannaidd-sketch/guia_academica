<?php
declare(strict_types=1);

require_once __DIR__ . '/../lib/session.php';
require_csrf();

header('Content-Type: text/plain; charset=utf-8');
header('Cache-Control: no-cache, no-store, must-revalidate');
header('X-Accel-Buffering: no');

@ini_set('zlib.output_compression', '0');
while (ob_get_level() > 0) { ob_end_flush(); }
set_time_limit(0);
ignore_user_abort(false);

$raw  = file_get_contents('php://input');
$data = json_decode((string)$raw, true);

if (!is_array($data)) {
    http_response_code(400);
    echo '[ERROR] Solicitud inválida';
    exit;
}

$prompt = trim((string)($data['prompt'] ?? ''));
if ($prompt === '') {
    http_response_code(400);
    echo '[ERROR] Falta el prompt';
    exit;
}
if (mb_strlen($prompt) > 60000) {
    http_response_code(413);
    echo '[ERROR] El texto enviado es demasiado largo';
    exit;
}

$modelo = (string)($data['model'] ?? 'llama3.2:3b');
if (
    !preg_match('/^[A-Za-z0-9][A-Za-z0-9._:\/-]{0,79}$/', $modelo)
    || str_contains($modelo, '..')
    || str_starts_with($modelo, '/')
) {
    http_response_code(400);
    echo '[ERROR] Modelo no válido';
    exit;
}

$system = (string)($data['system'] ?? '');
if (mb_strlen($system) > 10000) {
    $system = mb_substr($system, 0, 10000);
}

$numPredict = (int)($data['num_predict'] ?? 800);
$numPredict = max(64, min(4096, $numPredict));

$temperatura = (float)($data['temperature'] ?? 0.5);
$temperatura = max(0.0, min(1.5, $temperatura));

$payload = [
    'model'  => $modelo,
    'prompt' => $prompt,
    'system' => $system,
    'stream' => true,
    'keep_alive' => '30m',
    'options' => [
        'temperature' => $temperatura,
        'top_p'       => 0.9,
        'num_ctx'     => 4096,
        'num_predict' => $numPredict,
        'repeat_penalty' => 1.1,
    ],
];

$ch = curl_init('http://127.0.0.1:11434/api/generate');
curl_setopt_array($ch, [
    CURLOPT_POST           => true,
    CURLOPT_POSTFIELDS     => json_encode($payload, JSON_UNESCAPED_UNICODE),
    CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
    CURLOPT_PROXY          => '',
    CURLOPT_TIMEOUT        => 0,
    CURLOPT_CONNECTTIMEOUT => 5,
    CURLOPT_RETURNTRANSFER => false,
    CURLOPT_WRITEFUNCTION  => function ($ch, string $chunk): int {
        static $buffer = '';

        $buffer .= $chunk;
        while (($pos = strpos($buffer, "\n")) !== false) {
            $line   = substr($buffer, 0, $pos);
            $buffer = substr($buffer, $pos + 1);

            $line = trim($line);
            if ($line === '') { continue; }

            $json = json_decode($line, true);
            if (!is_array($json)) { continue; }

            if (isset($json['error'])) {
                echo "\n[ERROR] " . $json['error'];
                flush();
                continue;
            }
            if (!empty($json['response'])) {
                echo $json['response'];
                flush();
            }
        }
        return strlen($chunk);
    },
]);

$ok   = curl_exec($ch);
$code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);

if ($ok === false) {
    echo "\n[ERROR] No se pudo conectar con Ollama (¿está abierto?). " . curl_error($ch);
} elseif ($code >= 400 && $code !== 200) {
    echo "\n[ERROR] Ollama respondió HTTP {$code}";
}
curl_close($ch);
