<?php
declare(strict_types=1);

/**
 * Configuración local de Generador de Guías · ISTEL.
 *
 * Copia este archivo como config.php. La aplicación es de uso local
 * (solo este equipo), por eso no tiene inicio de sesión.
 */

/* Nombre de la cookie de sesión (se usa para el token CSRF) */
const APP_SESSION_NAME = 'guias_istel';

/* Límites de seguridad */
const MAX_DOCS        = 200;                  /* documentos guardados */
const MAX_HTML_BYTES  = 3 * 1024 * 1024;      /* 3 MB por documento */
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;     /* 10 MB por imagen */
const CACHE_MAX_FILES = 400;                  /* archivos por caché */
const CACHE_MAX_AGE   = 7 * 24 * 3600;        /* 7 días */
