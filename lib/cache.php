<?php
declare(strict_types=1);

/**
 * Limpieza de cachés: borra archivos viejos y limita la cantidad total.
 *
 * @param string[] $protegidos Nombres de archivo que no deben borrarse
 *                            (por ejemplo, imágenes usadas por documentos guardados).
 */
function limpiar_cache(string $dir, int $maxFiles, int $maxAge, array $protegidos = []): void
{
    if (!is_dir($dir)) {
        return;
    }

    $archivos = @glob($dir . '/*');
    if (!is_array($archivos) || $archivos === []) {
        return;
    }

    $ahora = time();
    $vigentes = [];

    foreach ($archivos as $archivo) {
        if (!is_file($archivo)) {
            continue;
        }

        if (in_array(basename($archivo), $protegidos, true)) {
            $vigentes[] = ['ruta' => $archivo, 'mtime' => @filemtime($archivo) ?: $ahora];
            continue;
        }

        $mtime = @filemtime($archivo);
        if ($mtime === false) {
            continue;
        }

        if ($maxAge > 0 && ($ahora - $mtime) > $maxAge) {
            @unlink($archivo);
            continue;
        }

        $vigentes[] = ['ruta' => $archivo, 'mtime' => $mtime];
    }

    if ($maxFiles > 0 && count($vigentes) > $maxFiles) {
        usort($vigentes, static fn(array $a, array $b): int => $a['mtime'] <=> $b['mtime']);
        $sobrantes = count($vigentes) - $maxFiles;
        for ($i = 0; $i < $sobrantes; $i++) {
            if (in_array(basename($vigentes[$i]['ruta']), $protegidos, true)) {
                continue;
            }
            @unlink($vigentes[$i]['ruta']);
        }
    }
}

/**
 * Imágenes de assets/cache referenciadas por documentos guardados.
 * Se excluyen de la limpieza para que los documentos antiguos no pierdan fotos.
 *
 * @return string[]
 */
function imagenes_en_uso(string $docsDir): array
{
    $usadas = [];

    $archivos = @glob($docsDir . '/*.json');
    if (!is_array($archivos)) {
        return [];
    }

    foreach ($archivos as $archivo) {
        $contenido = (string) @file_get_contents($archivo);
        if ($contenido === '') {
            continue;
        }
        if (preg_match_all('#assets/cache/([A-Za-z0-9._-]+)#', $contenido, $m)) {
            foreach ($m[1] as $nombre) {
                $usadas[$nombre] = true;
            }
        }
    }

    return array_keys($usadas);
}
