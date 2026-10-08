# Dialbot MCP

Controla tu navegador desde un agente mediante MCP. Dialbot combina una extensión para Chrome con un puente local en Node: usa el modo **fast** para tareas por selectores y el modo **normal** para trabajar con capturas, teclado y ratón. Cambia de modo desde el prompt sin perder las pestañas.

Estado: prototipo funcional para Windows y Chrome. El puente funciona en el equipo, sin paquetes de terceros ni servicios remotos. Las páginas web que abras pueden usar su propia red. No requiere cuentas de proveedores de IA.

Política de privacidad: [dialbot-mcp](https://r2100.github.io/dialbot-mcp/privacy/).

**Pensado primero para OpenCode.** Lleva a OpenCode un flujo de agente con navegador como el que buscas en ChatGPT/Codex: el agente trabaja sobre tus pestañas de Chrome mediante herramientas MCP locales.

## Instalación asistida desde OpenCode

Con Node.js 22 o posterior y Chrome instalados, puedes pedirle a OpenCode que prepare el servidor MCP local con un prompt. Un agente con acceso autorizado a la terminal y a la configuración de OpenCode puede clonar el proyecto, ejecutar el setup y añadir el servidor MCP sin que tengas que editar la configuración a mano. La extensión de Chrome se carga una vez por separado siguiendo [estos pasos](#instalación-en-modo-desarrollador-descomprimida).

Prompt de ejemplo:

> Instala Dialbot MCP para OpenCode en este equipo desde https://github.com/R2100/dialbot-mcp. Comprueba que tengo Windows y Node.js 22 o posterior; clona el repositorio en una ruta estable, ejecuta `npm run setup` y configura Dialbot como servidor MCP local stdio en mi configuración de OpenCode, usando la ruta absoluta al `src/mcp.mjs`. No reemplaces mi configuración existente. Después, indícame cómo cargar la extensión de Chrome desde la carpeta `extension` y conectarla. Cuando la haya conectado, verifica el estado con `opencode mcp list`.

El setup registra el host local en Windows y crea la credencial privada del puente. Permite al agente ejecutar comandos y modificar la configuración cuando te lo solicite. La extensión sigue siendo un paso separado que se carga en Chrome; el setup del MCP no instala extensiones del navegador.

OpenCode admite servidores MCP locales por stdio ([documentación oficial](https://opencode.ai/docs/mcp-servers/)) y Dialbot incluye ejemplos de configuración para OpenCode v1 y v2 en [`examples`](examples/). También funciona con Pi, probado por el usuario, y con otros harnesses que admitan MCP stdio y puedan ejecutar comandos locales con autorización.

Arquitectura: agente MCP → proceso Node por stdio → tubería local autenticada → proceso nativo → extensión Manifest V3 → pestaña.

## Instalación en Windows

Requisito: Node 22 o posterior y Chrome.

Descarga o clona el proyecto y abre una terminal en su carpeta. No necesitas `npm install`: el servidor solo usa módulos incluidos en Node. Si prefieres hacerlo manualmente, ejecuta `npm run setup`, carga la extensión en Chrome y configura el cliente MCP según los ejemplos.

1. Ejecuta `npm run setup` desde este directorio. Genera identidad propia, credencial local y registro del proceso nativo en HKCU.
2. Carga la extensión en Chrome en modo desarrollador (instrucciones detalladas más abajo).
3. Abre el botón **Dialbot MCP** y pulsa **Conectar**. Solo una instancia de la extensión puede ocupar el puente a la vez.
4. Configura un servidor MCP stdio en el agente que quieras usar:

```json
{
  "mcpServers": {
    "dialbot-mcp": {
      "command": "node",
      "args": ["<ruta-del-proyecto>/src/mcp.mjs"]
    }
  }
}
```

### Instalación en modo desarrollador (descomprimida)

La extensión se carga directamente desde la carpeta `extension` del proyecto:

1. **Descarga el proyecto.** Clona el repositorio o descarga el ZIP desde GitHub y descomprímelo en una carpeta definitiva (la extensión no debe moverse ni borrarse más tarde: Chrome referencia esa carpeta). Ejemplo: `C:\dialbot-mcp`.
2. **Abre la página de extensiones.** En Chrome, entra en `chrome://extensions` (o Menú ⋮ → Extensiones → *Gestionar extensiones*).
3. **Activa el modo de desarrollador.** Pulsa el interruptor «Modo de desarrollador» en la esquina superior derecha de esa página. Aparecerán tres botones adicionales arriba.
4. **Carga la extensión descomprimida.** Pulsa **Cargar descomprimida**, navega a la carpeta del proyecto y selecciona `<carpeta-del-proyecto>\extension` (la carpeta que contiene `manifest.json`, no la raíz del proyecto). La tarjeta **Dialbot MCP** aparecerá en el listado.
5. **Fíjala en la barra.** En el menú de la extensión (icono de la pieza 🧩), pulsa el pin junto a Dialbot MCP para tenerla siempre visible.
6. **Conéctala al puente.** Abre el botón **Dialbot MCP** y pulsa **Conectar**. Debe mostrar un estado de conexión JSON después de haber ejecutado `npm run setup`; si el host nativo no está registrado, la conexión fallará aunque la extensión esté cargada.

Notas del modo desarrollador:

- Al recargar la página de extensiones o pulsar **Recargar** (⟳) en la tarjeta de Dialbot tras actualizar archivos del proyecto, la conexión a veces se interrumpe: vuelve a **Conectar** en el botón. El reinicio del servidor MCP no es necesario solo al recargar, pero sí tras reiniciar el PC o Chrome.
- Si Chrome descarta la extensión al reiniciar (ocurre si desactivas el modo de desarrollador o usas un perfil con políticas restrictivas), repite los pasos 3-4; la configuración del puente en `.local` no se pierde.
- Con esta carga verás al conectar el aviso de Chrome sobre el depurador en las pestañas controladas; es normal y desaparecerá al desasociar el depurador.
- La versión mostrada en la tarjeta debe coincidir con `package.json`.

Sustituye `<ruta-del-proyecto>` por la ruta absoluta donde hayas guardado el proyecto. La envoltura de configuración depende de cada cliente. En `examples` hay configuraciones para OpenCode v1 y v2: combina la que corresponda con tu configuración existente. Otros agentes necesitan un cliente o adaptador que admita MCP stdio. Compatibilidad de protocolo implementada: revisiones 2024-11-05 a 2025-11-25 enumeradas en el servidor; no implementa el transporte HTTP. La conexión con pi.dev ha sido probada por el usuario. Las pruebas automatizadas usan un cliente MCP local; las nuevas funciones deben probarse también desde el agente después de actualizar.

El setup genera archivos exclusivos de tu equipo dentro de `.local`, que se excluyen de Git. La clave del manifiesto de la extensión es **pública** y estabiliza su identificador; no es una credencial. El nombre interno del proceso nativo sigue siendo `local.browser.bridge` para mantener la compatibilidad con instalaciones previas.

## Estructura

```text
extension/     Extensión Manifest V3, interfaz y operaciones del navegador
src/           Servidor MCP stdio, cliente del puente y proceso nativo
scripts/       Instalador del proceso nativo para Windows
examples/      Configuraciones de clientes MCP
tests/         Pruebas automatizadas del protocolo y componentes
docs/          Notas técnicas y páginas públicas de GitHub Pages
extension/icons/ Iconos necesarios para la extensión
```

## Herramientas

El modo predeterminado es **fast**. Se puede cambiar durante la conversación, sin editar configuración ni reiniciar:

| Modo | Comportamiento |
| --- | --- |
| fast | Prioriza lectura DOM y acciones directas por selectores. Capturas y entrada visual siguen disponibles cuando se necesiten. |
| normal | Usa capturas, ratón y teclado para el contenido. Bloquea lectura y selectores DOM, incluida subida por selector. Permite seleccionar archivos tras un clic por coordenadas y gestionar pestañas. |

Ejemplos de prompt: «Usa modo fast para rellenar este formulario», «Cambia a normal y continúa solo con visión, teclado y ratón», «Vuelve a fast», «¿Qué modo está activo?». El agente traduce la petición en `browser_mode` con `{"mode":"fast"}`, `{"mode":"normal"}` o `{}` para consultar. No se interpreta el texto del prompt dentro de la extensión: el cliente necesita un agente capaz de invocar herramientas MCP.

El catálogo de herramientas permanece estable para clientes que lo almacenan en caché; el modo limita su ejecución. La respuesta al cambio indica el estado y las herramientas permitidas. Cada proceso MCP mantiene su propio modo y afecta a todas sus pestañas; otros agentes mantienen el suyo, aunque las pestañas del navegador son compartidas. No es un aislamiento entre agentes. El cambio se rechaza mientras haya operaciones pendientes en esa sesión.

Normal no garantiza indetectabilidad ni borra acciones previas de fast. No incluye ejecución arbitraria de JavaScript. Si ya tienes `BROWSER_MODE` configurado, solo fija el modo inicial: se admiten fast/normal y los alias antiguos dom/visual. Puedes cambiarlo después con el prompt. Reinicia el servidor una vez para cargar esta actualización; los cambios de modo posteriores son inmediatos.

| Herramienta | Argumentos principales |
| --- | --- |
| browser_file_inputs | tabId; lista campos de archivo, solo fast |
| browser_upload | tabId, selector, files (rutas absolutas); solo fast |
| browser_upload_click | tabId, x, y, files; selector de archivos tras clic, ambos modos |
| browser_mode | mode opcional: fast o normal; sin argumentos consulta |
| browser_outline | tabId, offset y limit opcionales; solo fast |
| browser_activate | tabId |
| browser_behavior | cursor, motion, warmup y tabId opcionales; sin argumentos consulta |
| browser_warmup | tabId |
| browser_tabs | ninguno |
| browser_open | url, active opcional |
| browser_navigate | tabId, url |
| browser_close | tabId |
| browser_read | tabId, maxChars opcional |
| browser_click | tabId, selector |
| browser_fill | tabId, selector, text |
| browser_screenshot | tabId |
| browser_detach | tabId |
| browser_mouse_move | tabId, x, y, durationMs opcional |
| browser_mouse_click | tabId, x, y, button opcional, clickCount opcional |
| browser_mouse_drag | tabId, points (2–100 puntos x/y), button y durationMs opcionales |
| browser_scroll | tabId, x, y, deltaY, deltaX opcional |
| browser_sendkeys | tabId, keys |
| browser_type | tabId, text, delayMs opcional |
| browser_paste | tabId, text (hasta 100000 caracteres) |
| browser_batch | steps (1–20 pasos {name, arguments, pauseMs}), stopOnError opcional |
| browser_batch_status | ninguno |
| browser_batch_cancel | ninguno |

### Interacción visual

1. Llama a `browser_screenshot` con el `tabId`. Devuelve PNG y medidas del área visible e imagen.
2. Localiza visualmente el objetivo. Las coordenadas de entrada son **píxeles CSS desde la esquina superior izquierda del contenido visible**. Si la imagen mide el doble, divide las coordenadas observadas entre dos. Los factores exactos se devuelven en `imagePixelsPerCssPixel`; si tu visor reduce la imagen, considera también ese cambio de tamaño.
3. Llama a `browser_mouse_click` con `x` e `y` para enfocar. `button` acepta `left`, `right` y `middle`; `clickCount: 2` produce doble clic.
4. `browser_type` escribe en el foco actual. Por ejemplo: `{"tabId":123,"text":"Hola mundo","delayMs":40}`. No limpia el campo: para reemplazar usa antes `browser_sendkeys` con `keys: "Control+A"`.
5. `browser_sendkeys` acepta un acorde por llamada: `Enter`, `Tab`, `Shift+Tab`, `Control+A`, `Control+C`, `Control+V`, `Backspace`, `Delete`, `Escape`, `Home`, `End`, `PageUp`, `PageDown` y flechas. Las operaciones de portapapeles están sujetas a las restricciones del navegador. No acepta sintaxis de macros con llaves.
6. Para desplazar, usa `browser_scroll` con un punto dentro del contenido y `deltaY` positivo hacia abajo. Haz otra captura tras navegar o desplazar antes de reutilizar coordenadas.

### Lotes de acciones verificadas

`browser_batch` ejecuta de 2 a 20 acciones ya comprobadas en una sola llamada, sin consultas del agente entre ellas. Cada paso reutiliza la forma habitual `{name, arguments}`; la única novedad es `pauseMs`, la pausa en milisegundos tras cada paso (0 por defecto, 10000 como máximo):

```json
{
  "steps": [
    {"name": "browser_fill",  "arguments": {"tabId": 123, "selector": "#email", "text": "a@b.c"}},
    {"name": "browser_fill",  "arguments": {"tabId": 123, "selector": "#pass", "text": "secreta"}, "pauseMs": 300},
    {"name": "browser_click", "arguments": {"tabId": 123, "selector": "#submit"}, "pauseMs": 1500},
    {"name": "browser_read",  "arguments": {"tabId": 123, "maxChars": 5000}}
  ]
}
```

La respuesta incluye `results` por paso con `ok` y el `result` o `error` de cada uno, más `cancelled`, `stoppedOn` y `elapsedMs`. Todos los pasos se validan contra el catálogo del modo actual antes de ejecutar el primero: un lote rechazado no ejecuta nada. Con `stopOnError` (true por defecto) el primer fallo detiene el lote; los demás pasos no se realizan.

Úsalo solo con selectores, coordenadas y flujo verificados en esta sesión: es un repetidor de secuencias estables, no una forma de explorar. Encaja bien tras preparar un formulario con llamadas individuales y repetirlo después de un solo golpe. El lote se ejecuta en serie y con la cadencia marcada por las pausas; esa cadencia mecánica es un patrón observable por la página: añade pausas razonables y no trates el lote como indetectable. Las pestañas ocupadas y el límite de tiempo por paso conservan su comportamiento usual: un paso lento puede desbordar el tiempo del puente igual que una llamada individual.

Durante el lote, `browser_batch_status` consulta el paso en curso y los resultados parciales, y `browser_batch_cancel` cancela al terminar el paso que esté ejecutándose, incluida su pausa; ninguna de las dos interrumpe una acción a medio hacer. El estado del último lote queda disponible tras terminar. `browser_screenshot` no puede ser un paso: hazlo antes o después del lote.

### Insertar bloques grandes de texto

`browser_paste` pega el bloque completo con el portapapeles de Windows y `Control+V` de Chrome, en una sola llamada. Está disponible en **fast y normal**, admite hasta 100000 caracteres Unicode y sirve para código o texto multilínea. Primero enfoca el campo o editor; la inserción sustituye la selección actual o se añade en la posición del cursor. Para reemplazar todo el contenido, usa antes `browser_sendkeys` con `Control+A`.

```json
{
  "tabId": 123,
  "text": "function saludo() {\n  return 'Hola 🌍';\n}\n"
}
```

Los saltos de línea y la indentación se conservan en campos multilínea; los campos de una sola línea aplican las restricciones de Chrome. El puente coloca el texto en el portapapeles de Windows mediante PowerShell y la extensión envía el acorde `Control+V`, generando el evento nativo `paste`. El texto se entrega por stdin como datos, sin interpretarlo como un comando. El portapapeles del sistema queda con el bloque enviado; los pegados MCP simultáneos se rechazan para evitar mezclarlo entre sesiones. No se ejecuta una tecla Enter ni se envían teclas por carácter. `browser_type` mantiene la escritura carácter a carácter.

La respuesta `inserted` cuenta los caracteres enviados a Chrome. El campo debe estar enfocado y ser editable: la página puede cancelar la entrada, limitar su longitud o transformarla, por lo que hay que comprobar el resultado. La selección inicial se respeta; el warm-up opcional ocurre antes de la inserción.

### Arrastrar y dibujar

`browser_mouse_drag` pulsa en el primer punto, recorre los siguientes manteniendo el botón y suelta en el último. Funciona en **fast y normal** para sliders, canvas, selección y componentes que responden a eventos de ratón/puntero. Usa coordenadas CSS del viewport obtenidas de una captura reciente; todos los puntos deben estar dentro del área visible.

Para mover un slider basta con dos puntos. Para dibujar, añade esquinas o puntos intermedios:

```json
{
  "tabId": 123,
  "points": [{"x": 100, "y": 150}, {"x": 250, "y": 150}, {"x": 250, "y": 250}],
  "durationMs": 600
}
```

Admite de 2 a 100 puntos y los botones `left` (predeterminado), `right` y `middle`. `durationMs` es la duración total del movimiento con el botón pulsado: 600 ms por defecto, de 0 a 10000 ms. El recorrido se divide en tres partes de igual longitud, cada una con una duración aleatoria; las tres duraciones suman el total configurado. Esta distribución se calcula una vez por trazo, incluso si solo hay dos puntos o hay muchos segmentos. El acercamiento inicial, warm-up y pausa de pulsación son adicionales. Incluso con duración cero se envían movimientos intermedios.

El acercamiento inicial respeta la preferencia de movimiento; durante el trazo se siguen segmentos rectos sin ruido ni sobrepaso para conservar el dibujo. Las pausas compensan el tiempo de envío de las órdenes de Chrome para aproximarse a la duración indicada; un navegador lento puede superar ese objetivo. Cada llamada realiza una pulsación completa y mantiene la pestaña ocupada hasta soltar. Para varios trazos separados, usa varias llamadas. Si falla tras intentar pulsar, se intenta liberar el botón en la última posición conocida; si la conexión o pestaña se pierden no se puede confirmar la liberación. Las órdenes CDP sin respuesta tienen un límite de 5 segundos para permitir la limpieza y evitar un bloqueo permanente de la pestaña. La respuesta confirma el gesto enviado, no el resultado de la aplicación: comprueba una captura posterior.

Esta herramienta no entrega archivos ni datos externos a zonas de drop; ese flujo requiere soporte específico. La compatibilidad con drag and drop HTML5 no se ha verificado.

Ratón y teclas se envían al navegador mediante su protocolo de entrada: pulsación y liberación, modificadores y rueda. No mueve el cursor físico de Windows ni conoce sus movimientos manuales. La escritura alfanumérica usa eventos de tecla, incluyendo Shift para mayúsculas ASCII; otros caracteres, acentos y emoji usan inserción de texto tipo IME. El intervalo base es configurable, 40 ms por defecto. Se admiten 200 caracteres y un presupuesto de espera de 18 segundos por llamada; divide textos largos.

### Listado textual y activación

«Lista los enlaces y menús de esta página» llama a `browser_outline`: devuelve una representación textual numerada y elementos con nombre, destino, selector y estado abierto/cerrado o deshabilitado. Incluye elementos renderizados fuera del viewport, y omite los ocultos. No abre menús para descubrir su contenido oculto. La paginación usa `offset` y `limit` (100 por defecto, 300 como máximo). Los números son informativos; usa el selector devuelto con `browser_click`. Vuelve a listar después de cambios en la página. Solo cubre el documento principal, sin iframes ni shadow DOM.

«Activa la pestaña 123» llama a `browser_activate` con su `tabId` y enfoca también la ventana correspondiente.

### Mirilla y comportamiento por prompt

`browser_behavior` conserva preferencias por sesión MCP:

| Opción | Valores | Predeterminado |
| --- | --- | --- |
| cursor | auto, on, off | auto: visible en fast, oculta en normal |
| motion | auto, human, direct | auto: human en normal, direct en fast |
| warmup | true, false | false |

Ejemplos: «Activa el cursor visible», «Oculta la mirilla», «Activa movimiento humano y warm-up», «Desactiva el warm-up», «Vuelve al cursor automático». El agente traduce esto a argumentos como `{"cursor":"on","tabId":123}` o `{"motion":"human","warmup":true}`. Un ajuste explícito on/off o human/direct se mantiene al cambiar de modo; auto vuelve a seguir el modo.

La mirilla son dos líneas verdes puras, opacas, de un píxel, que abarcan todo el ancho y alto del viewport. Se cruzan en el puntero del agente y siguen únicamente sus movimientos, incluido el arrastre y el warm-up. Mover el ratón físico no desplaza la mirilla. En acciones DOM muestran el centro del elemento. Antes de conocer una posición se muestran en el centro de la pantalla. No interceptan clics. Se aplican a pestañas usadas por la sesión y a nuevas pestañas al actuar sobre ellas; incluye `tabId` para aplicarlas inmediatamente. Se reaplican en la siguiente operación después de navegar. Al salir de la sesión pueden permanecer hasta recargar la página o desactivarlas. Otros agentes comparten la página: prevalece la última configuración aplicada. La superposición modifica el DOM, es observable por la página y aparece en capturas; su activación en normal es explícita.

El movimiento human usa ruido gaussiano correlacionado, una curva de aceleración y frenado, sobrepaso limitado del objetivo y corrección antes de pulsar. Todas las coordenadas se limitan al viewport y el punto final coincide con el solicitado. Las pausas de movimiento, lectura y pulsación siguen distribuciones lognormales acotadas, no una distribución uniforme. `durationMs` permite fijar la duración de una trayectoria. El modo direct evita el ruido y las esperas de movimiento salvo duración explícita.

Warm-up automático hace tres movimientos ociosos desde una esquina y pausas simuladas antes de la primera entrada por sesión y carga de página. No pulsa ni escribe, aunque puede activar efectos hover. Se reinicia tras navegar o recargar. `browser_warmup` lo ejecuta expresamente incluso si el automático está desactivado. En fast, el warm-up puede preceder una acción DOM, pero motion human solo afecta a las herramientas de entrada, no convierte un clic DOM en entrada de ratón. Estas variaciones no se han calibrado contra movimientos humanos ni garantizan indetectabilidad.

Esto mejora compatibilidad con interfaces que esperan entrada del navegador, pero no convierte la sesión en indistinguible de una persona ni garantiza evitar detecciones. No hay simulación de un teclado físico con distribución española completa ni automatización de diálogos del sistema o de la barra de direcciones. No modifica señales de automatización. Las operaciones simultáneas en una misma pestaña se rechazan para evitar mezclar pulsaciones; espera la respuesta antes de continuar.

Las herramientas DOM opcionales actúan solo sobre el documento principal; no recorren iframes o shadow DOM. La interacción por coordenadas apunta al contenido visible, sin selectores. Abrir y navegar no esperan la carga; repite la captura cuando el documento esté disponible. Si una navegación activa un diálogo `beforeunload` por cambios sin guardar, Dialbot lo cancela para conservarlos, mantiene la página actual y devuelve un error en vez de dejar la pestaña ocupada. Las páginas internas restringen operaciones. La captura y los eventos de entrada adjuntan el depurador; `browser_detach` lo libera. Chrome puede mostrar su aviso de depuración.

No compartas `.local/config.json`: contiene la credencial del puente. La CSP de la extensión bloquea conexiones de red propias. El permiso de sitios permite actuar sobre las páginas elegidas por el agente. El token autentica procesos locales; no aísla agentes que operan como el mismo usuario. Las acciones pueden modificar páginas o cerrar pestañas.

## Archivos y vídeos

Puedes pedir «Adjunta este archivo y detente sin publicar». La selección se realiza mediante Chrome; los bytes del vídeo no pasan por MCP. En fast se usa un selector y en normal un clic observado en una captura. Seleccionar puede iniciar la transferencia al sitio: hay que comprobar la vista previa y el progreso para confirmar el resultado. Consulta [Subida de archivos](docs/file-uploads.md) para ejemplos, alternativas de Windows, limitaciones y flujos de plataformas.

## Pruebas

Las revisiones de esta línea se mantienen en **0.4.x**, incrementando el último número con los cambios. Mantén la misma versión en `package.json`, `extension/manifest.json` y `serverInfo` de `src/mcp.mjs`; Chrome muestra la versión cargada de la extensión y MCP informa de la suya al inicializar.

Las decisiones de comportamiento y sus límites están en [Comportamiento del navegador](docs/browser-behavior.md). Dialbot no promete indetectabilidad.

`npm test` ejecuta las pruebas automatizadas del protocolo MCP, framing, validación de argumentos y rutas, modos, lotes, movimiento, cursor, pegado y recuperación. No instala dependencias ni requiere configurar un navegador. La integración completa con la extensión instalada se comprueba manualmente; después de actualizar archivos, recarga la extensión desde Chrome y reinicia el servidor MCP.

## Desinstalar

Retira la extensión desde el navegador y elimina exclusivamente la clave `HKCU\Software\Google\Chrome\NativeMessagingHosts\local.browser.bridge`. El directorio `.local` contiene los archivos generados por setup. La extensión original no se modifica.
