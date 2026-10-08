# Comportamiento del navegador

Dialbot conserva el motor, perfil, red y APIs nativas de Chrome. Las peticiones de las páginas se realizan desde el navegador; el puente local transporta órdenes y resultados.

## Modos de interacción

- **fast** prioriza lectura DOM y acciones mediante selectores.
- **normal** utiliza capturas, ratón y teclado para interactuar con el contenido, y bloquea las herramientas DOM de la sesión MCP.

Los modos no modifican la identidad del navegador. Cambiar a normal no revierte acciones anteriores ni garantiza evitar detecciones.

La mirilla de diagnóstico es una superposición DOM observable, activada por defecto en fast. En normal se oculta salvo activación explícita. El movimiento humano utiliza ruido gaussiano suavizado, aceleración/frenado y corrección final; el warm-up opcional genera movimientos sin pulsaciones. Sus tiempos están acotados y no constituyen un modelo validado de comportamiento humano.

## Pruebas y alcance

Las pruebas automatizadas cubren lógica, validación y protocolo mediante dobles de prueba; la integración completa con Chrome se verifica manualmente. No abarcan todas las superficies del navegador ni certifican compatibilidad con todos los sitios o indetectabilidad frente a servicios externos.

Dialbot no incorpora parches de identidad, rotación de perfiles ni resolución de CAPTCHA. La entrada enviada por el navegador no mueve el cursor físico de Windows ni controla los diálogos del sistema.
