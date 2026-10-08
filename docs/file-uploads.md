# Selección de archivos y subida de medios

Dialbot 0.3.0 incorpora tres herramientas genéricas. No necesita un adaptador ni URLs fijas para cada plataforma.

| Herramienta | Modo | Uso |
| --- | --- | --- |
| `browser_file_inputs` | fast | Enumera inputs de archivo del documento principal, incluso ocultos, con selector, accept, multiple y disabled. |
| `browser_upload` | fast | Recibe tabId, selector único y files con rutas absolutas. |
| `browser_upload_click` | ambos | Recibe tabId, x, y y files; pulsa el botón observado en una captura y responde al selector de archivos de Chrome. |

Ejemplo fast, usando el selector devuelto por el listado:

```json
{"tabId":123,"selector":"input[type=file]","files":["C:/Users/tu-usuario/Documentos/prueba.png"]}
```

Ejemplo normal, sustituyendo las coordenadas por las de una captura reciente:

```json
{"tabId":123,"x":240,"y":350,"files":["C:/Users/tu-usuario/Videos/demo.mp4"]}
```

Prompt: «Adjunta este archivo en el compositor, espera a ver la miniatura y detente sin publicar». Para normal: «Usa modo normal, localiza el botón de medios en una captura y adjunta este archivo». El agente convierte estas peticiones en llamadas MCP; la extensión no interpreta lenguaje natural.

## Implementación elegida

El proceso nativo valida que cada ruta sea absoluta, existente, legible y un archivo regular. Se rechazan rutas UNC y directorios. Admite entre uno y diez archivos; el campo debe admitir selección múltiple para recibir más de uno. No inspecciona el contenido ni impone límites de tamaño o códec: corresponden al sitio. Usa únicamente archivos que el usuario haya autorizado enviar a esa página.

Chrome recibe las rutas mediante `DOM.setFileInputFiles` y se encarga de exponer los archivos al sitio. Los bytes no atraviesan MCP ni se codifican en base64. En fast se resuelve el input por selector; no es necesario que sea visible. En normal, `Page.setInterceptFileChooserDialog` captura el selector generado por el clic de ratón y entrega su backendNodeId, sin buscar selectores ni leer la página. El diálogo de Windows no llega a mostrarse. La interceptación y el listener se retiran en finally, también al fallar. El clic debe abrir el selector en unos segundos; si no lo hace, se devuelve un error y hay que comprobar el estado antes de repetir.

El resultado `selectionSent: true` significa que Chrome aceptó la selección. `uploadComplete: "unknown"` recuerda que no acredita transferencia, procesamiento ni publicación. El sitio puede vaciar el input al procesar el archivo, por lo que el estado de la página es la comprobación válida. La herramienta no pulsa botones de publicación; entregar archivos ya puede enviarlos al servidor o desencadenar otras acciones propias de la página.

La selección reemplaza los archivos del input. El sitio puede mantener adjuntos anteriores en su propio estado: revisa la composición antes y después. `accept` se informa como orientación; no se considera una validación definitiva del formato. Los selectores de fast cubren solo el documento principal. No hay soporte garantizado para iframes de otro proceso, shadow DOM, selección de carpetas o selectores que no se basen en input file.

## Alternativas evaluadas

| Técnica | Evaluación |
| --- | --- |
| Asignar una ruta a input.value desde JavaScript | El navegador impide seleccionar archivos locales así. |
| File + DataTransfer y eventos desde JavaScript | Requiere obtener y transportar los bytes, consume memoria con vídeos y produce eventos sintéticos; no es la vía elegida. |
| Selector nativo de Chrome mediante CDP | Implementado: transfiere rutas, permite inputs ocultos y conserva el flujo del sitio. |
| Diálogo de Windows con UI Automation y SendInput | Posible alternativa futura: identificar el diálogo perteneciente a Chrome, rellenar Nombre de archivo y pulsar Abrir. Requiere controlar foco, ventanas, nivel de integridad y tiempos; no implementado. |
| Arrastrar desde el Explorador | Requiere coordinar dos ventanas y el destino. No aporta ventaja cuando existe un selector de archivos; no implementado. |

## Flujo por plataforma

En X: abrir el compositor, identificar el control de medios, seleccionar el archivo, esperar miniatura o fin de progreso y detenerse antes de Publicar. Los formatos y límites pueden variar por cuenta y tipo de medio.

En YouTube Studio: Crear, Subir vídeos, seleccionar archivo, completar detalles y audiencia, esperar transferencia y comprobaciones, revisar visibilidad. Subir y publicar son pasos distintos, pero abandonar el flujo puede dejar un vídeo privado en el canal; no asumir que cerrar equivale a borrar.

En TikTok: abrir la pantalla de subida de escritorio, seleccionar vídeo, esperar su procesamiento, revisar descripción y privacidad y detenerse antes de publicar. La compatibilidad concreta debe verificarse con la cuenta y el vídeo elegidos.

Para los tres flujos ya existen lectura o capturas, clic, teclado y activación de pestañas. La pieza nueva es la selección de archivos. El progreso se consulta con lecturas o capturas sucesivas; las llamadas de selección no permanecen abiertas durante toda la transferencia. No se ha añadido publicación automática ni un sistema genérico para interpretar el porcentaje de cada sitio.

## Verificación

La integración automatizada recorre MCP, proceso nativo, extensión y Chromium aislado. Comprueba bytes reales recibidos por el servidor local, nombre Unicode, evento change confiable, campo oculto, selección por clic en normal, restricciones de modo, errores de selector/ruta/directorio/múltiples y restauración del selector tras un timeout. Estas pruebas no demuestran por sí solas una subida en un servicio externo.

Después de actualizar, recarga la extensión y reinicia el cliente MCP para obtener las 22 herramientas. No requiere nuevos permisos de Chrome ni instalar dependencias.
