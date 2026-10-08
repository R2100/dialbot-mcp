# Comportamiento del navegador

Dialbot conserva el motor, perfil, red y APIs nativas de Chrome. Las peticiones de las páginas se realizan desde el navegador; el puente local transporta órdenes y resultados.

## Modos de interacción

- **fast** prioriza lectura DOM y acciones mediante selectores.
- **normal** utiliza capturas, ratón y teclado para interactuar con el contenido, y bloquea las herramientas DOM de la sesión MCP.

Los modos no modifican la identidad del navegador. Cambiar a normal no revierte acciones anteriores ni garantiza evitar detecciones.

La mirilla de diagnóstico es una superposición DOM observable, activada por defecto en fast. En normal se oculta salvo activación explícita. El movimiento humano utiliza ruido gaussiano suavizado, aceleración/frenado y corrección final; el warm-up opcional genera movimientos sin pulsaciones. Sus tiempos están acotados y no constituyen un modelo validado de comportamiento humano.

## Verificación

La prueba integral compara antes y después de las operaciones el User-Agent JavaScript, plataforma, Client Hints disponibles, idiomas, zona horaria, pantalla, canvas, representación de funciones y descriptor de `webdriver`. También contrasta el User-Agent HTTP de la navegación inicial con el de JavaScript.

Las pruebas comprueban que los eventos de entrada del navegador sean confiables, que los eventos construidos por la página sigan siendo no confiables, que las teclas canceladas no escriban y que la rueda cancelada no desplace. También verifican el desplazamiento de un contenedor interno.

El navegador de pruebas se inicia mediante automatización y puede declarar `webdriver=true`: se exige conservar su valor. El DOM utilizado como observador en los tests no se expone a las herramientas visuales.

## Alcance

Estas comprobaciones cubren compatibilidad y estabilidad de las propiedades medidas. No abarcan todas las superficies del navegador, no comprueban la huella TLS y no certifican indetectabilidad frente a servicios externos.

Dialbot no incorpora parches de identidad, rotación de perfiles ni resolución de CAPTCHA. La entrada mediante Chromium no mueve el cursor físico de Windows ni controla los diálogos del sistema.
