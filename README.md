# Generador de Guías · ISTEL

Aplicación local (XAMPP + PHP 8 + Ollama) que genera con IA dos documentos académicos con el formato institucional:

- **Guía Académica**: portada, presentación, capítulos con introducción, subtemas desarrollados en **4 párrafos de ~8 líneas cada uno** y un ejercicio práctico paso a paso por capítulo, referencias APA 7, anexos y hoja de vida del autor. Opcionalmente incluye cuestionarios de repaso y exámenes por parcial.
- **Guía de Prácticas en el Entorno Académico**: datos informativos, fundamentos, objetivo general y específicos, preparación previa, normas de seguridad, procedimiento, materiales, rúbrica y firmas.

Está pensada para **usarse solo en este equipo**. La generación de texto se ejecuta localmente con Ollama; solo la búsqueda e inserción de imágenes usa internet.

## Requisitos

1. **XAMPP** con Apache iniciado (PHP 8.0 o superior).
2. **Ollama** instalado y en ejecución.
3. Un modelo descargado. El recomendado para este equipo es:

   ```powershell
   ollama pull qwen2.5:3b
   ```

## Uso

**Doble clic en el icono «Generador de Guias ISTEL» del escritorio.** El lanzador `iniciar_app.bat` inicia Apache y Ollama si están detenidos y abre el navegador en <http://localhost/guia_academica/>.

También puedes abrir directamente <http://localhost/guia_academica/> si Apache y Ollama ya están corriendo.

1. Elige la pestaña **Guía Académica** o **Guía de Práctica**.
2. Completa los datos y pulsa **Generar**.
3. El documento aparece en el panel derecho **en vivo y es editable**.
4. Usa **Imágenes** para buscar e insertar fotografías del tema.
5. Guarda con **Guardar** (o `Ctrl+S`); los documentos se abren desde **Abrir** y cada generación terminada aparece en **Historial**.
6. Exporta con **PDF** (imprimir) o **Word** (`.doc`).

## Cuestionarios

En la pestaña **Guía Académica** puedes incluir, con las casillas correspondientes:

- **Repaso por unidad:** un cuestionario de **10 preguntas de opción múltiple** (4 opciones) después de cada capítulo, con su clave de respuestas.
- **Examen por parcial:** un examen de **30 preguntas de opción múltiple** por cada parcial, dividido en 3 bloques de 10. Las preguntas y su clave quedan en una página aparte para el docente.

Configuración:

1. Indica el **número de parciales** (1 a 6).
2. En cada capítulo, elige a qué **parcial** pertenece con el selector de su tarjeta.
3. Marca las casillas **Cuestionario de repaso** y/o **Examen de evaluación**.
4. Pulsa **Generar guía académica** para incluir todo en la guía.
5. Pulsa **Solo cuestionarios** para crear un documento aparte con únicamente los cuestionarios y exámenes (misma portada institucional, también exportable a PDF/Word).

> La IA puede equivocarse en alguna respuesta. Revisa las preguntas y la clave antes de imprimirlas. Si una sección sale incompleta, usa el selector **Regenerar sección…** de la barra superior. Cada examen se genera en 3 bloques; puede tardar varios minutos.

## Historial

Cada generación que termina sin errores se guarda automáticamente en el **Historial**.

- Pulsa **Historial** en la barra superior para abrir la ventana.
- La lista muestra los documentos **Generados**, ordenados del más reciente al más antiguo, con tipo, fecha y tamaño.
- Puedes **buscar** por título, tipo o fecha y cambiar el filtro a **Guardados** o **Todos**.
- Desde cada fila puedes **Abrir** el documento para seguir editándolo o **Eliminar** la entrada.
- Si un documento generado se abre y luego se guarda con **Guardar**, se actualiza esa misma entrada. **Guardar como copia** crea un documento aparte, marcado como guardado manual.

El historial usa la misma carpeta `docs/` y el mismo límite de 200 documentos. Si se supera, se eliminan automáticamente los más antiguos. Si una generación termina con errores, no se guarda sola; puedes revisarla y guardarla manualmente.

## Contenido de los capítulos

Cada capítulo se genera por partes para que el texto no se corte:

- Una **introducción** de 120 a 180 palabras.
- Cada **subtema** con **exactamente 4 párrafos**, generados en dos llamadas de dos párrafos. Cada párrafo debe tener **8 a 10 oraciones** (aproximadamente **120 a 150 palabras**, unas 8 líneas):
  1. Definición y contexto.
  2. Cómo funciona, sus elementos o su proceso.
  3. Ejemplo aplicado a la carrera.
  4. Buenas prácticas, errores comunes o recomendaciones.
- Un **ejercicio práctico** paso a paso, si está marcada la casilla.

Como cada subtema se genera en dos llamadas, la guía tarda más que antes, pero el contenido llega completo. Si el modelo devuelve más de dos párrafos en una llamada, la aplicación los agrupa en dos párrafos equilibrados para conservar la estructura de cuatro. Si un subtema sale corto o incompleto, regenéralo desde **Regenerar sección…**.

> Para que la IA respete mejor la extensión, se recomienda `llama3.2:3b` (`ollama pull llama3.2:3b`). Con `qwen2.5:3b` también funciona, pero suele dividir el texto en más párrafos; el agrupado automático los normaliza.

## Seguridad

No hay pantalla de inicio de sesión: el acceso está limitado al propio equipo.

- **Solo localhost**: `.htaccess` acepta únicamente `127.0.0.1` / `::1`. La IP de red (`192.168.x.x`) responde `403`.
- **Token CSRF** invisible en todas las operaciones que guardan, borran o generan.
- **Saneado del HTML** al guardar y al abrir: se eliminan `<script>`, `<iframe>`, manejadores `on*`, `javascript:` y estilos peligrosos.
- **Descarga de imágenes**: solo `https`, exige IP pública (bloquea `127.0.0.1`, `192.168.x.x`, etc.), sin redirecciones, con límite de 10 MB y verificación real de imagen.
- **Directorios protegidos** por `.htaccess`: `docs/`, `cache/`, `lib/` y `config.php` no son accesibles por HTTP.
- **Límites**: 200 documentos, 3 MB por documento, 400 archivos de caché y 7 días de antigüedad.

> Si en el futuro quieres abrir la aplicación desde otro equipo de la red, comenta la línea `Require ip 127.0.0.1 ::1` en `.htaccess`. En ese caso conviene volver a poner una contraseña de acceso.

## Internet

| Función | ¿Usa internet? |
|---|---|
| Generar el texto | No (Ollama en `127.0.0.1:11434`) |
| Guardar, abrir y exportar | No |
| Buscar imágenes (Openverse / Web) | Sí |
| Descargar la imagen elegida | Sí |

Sin conexión, la generación y la exportación siguen funcionando; solo falla la búsqueda de imágenes.

## Estructura

```
guia_academica/
├─ index.php              Interfaz principal
├─ iniciar_app.bat        Lanzador (Apache + Ollama + navegador)
├─ config.php             Configuración local (no versionada)
├─ config.example.php     Plantilla de configuración
├─ api/                   Endpoints (token CSRF)
│  ├─ generate.php        Puente con Ollama (streaming)
│  ├─ models.php          Modelos disponibles
│  ├─ docs.php            Guardar / listar / abrir / borrar documentos
│  ├─ images.php          Búsqueda en Openverse
│  ├─ web_images.php      Búsqueda web (Bing)
│  └─ save_image.php      Descarga y almacena imágenes
├─ lib/                   Sesión/CSRF, saneado y caché
├─ assets/                CSS, JS, imágenes e icono
├─ assets/cache/          Imágenes descargadas (se limpian solas)
├─ cache/search/          Caché de búsquedas (se limpia sola)
└─ docs/                  Documentos guardados (JSON)
```

## Límites configurables

En `config.php`:

| Constante | Valor por defecto | Significado |
|---|---|---|
| `MAX_DOCS` | 200 | Documentos guardados |
| `MAX_HTML_BYTES` | 3 MB | Tamaño máximo por documento |
| `MAX_IMAGE_BYTES` | 10 MB | Tamaño máximo por imagen |
| `CACHE_MAX_FILES` | 400 | Archivos por caché |
| `CACHE_MAX_AGE` | 7 días | Antigüedad máxima en caché |

## Requisitos del servidor

- Apache con `mod_headers` y `AllowOverride All` (XAMPP lo trae así).
- Extensiones PHP: `curl`, `dom`, `fileinfo`, `json`, `mbstring`.
