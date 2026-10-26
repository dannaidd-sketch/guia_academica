<?php
declare(strict_types=1);

/**
 * Sesión ligera para el token CSRF.
 *
 * La aplicación es de uso local y no tiene inicio de sesión: la sesión solo
 * sirve para que un sitio externo no pueda enviar formularios a la API.
 */

$configFile = __DIR__ . '/../config.php';

if (!is_file($configFile)) {
    http_response_code(500);
    header('Content-Type: text/plain; charset=utf-8');
    exit('Falta config.php. Copia config.example.php a config.php.');
}

require_once $configFile;

/* Los errores se registran en el log de Apache, nunca se muestran al navegador
   (evita filtrar rutas y romper las respuestas JSON). */
ini_set('display_errors', '0');
ini_set('log_errors', '1');
error_reporting(E_ALL);

if (session_status() !== PHP_SESSION_ACTIVE) {
    session_name(APP_SESSION_NAME);
    session_set_cookie_params([
        'lifetime' => 0,
        'path'     => '/',
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
    session_start();
}

function csrf_token(): string
{
    if (empty($_SESSION['csrf']) || !is_string($_SESSION['csrf'])) {
        $_SESSION['csrf'] = bin2hex(random_bytes(16));
    }
    return $_SESSION['csrf'];
}

function require_csrf(): void
{
    $token = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';

    if (!is_string($token) || $token === '' || !hash_equals(csrf_token(), $token)) {
        http_response_code(403);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['error' => 'Token de seguridad inválido. Recarga la página e inténtalo de nuevo.'], JSON_UNESCAPED_UNICODE);
        exit;
    }
}
