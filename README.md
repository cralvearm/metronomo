# Metrónomo

Secuenciador de tempos y poliritmos para practicar piezas con cambios de pulso.

- Programa los tempos de una pieza como secciones (nombre, BPM y compás).
- Avance cíclico: «Cambio de pulso» pasa a la siguiente sección y del último vuelve al primero; también hacia atrás y con saltos directos (botones de BPM o teclas 1–9).
- Poliritmos configurables por sección: N notas contra M repartidas en un espacio de S tiempos, con varias capas simultáneas; cada una se activa o desactiva con un clic en su ficha.
- Piezas guardadas en el navegador y exportación/importación en JSON.
- Tema claro y oscuro, monocromático.
- PWA: se puede instalar y funciona sin conexión.

## Atajos de teclado

Espacio o → : cambio de pulso · ← : pulso anterior · Enter: iniciar o pausar · 1–9: ir directo a esa sección

## Desarrollo

Sin herramientas de compilación: `index.html`, `app.js`, `app.css`, `sw.js` y `manifest.webmanifest`. Publicado en GitHub Pages.

Los iconos `icon-192.png`, `icon-512.png` y `icon-512-maskable.png` se agregan aparte en la raíz del repositorio.
