# Migue: las imágenes

Migue es el asistente con IA de los sistemas municipales. El de CementerIA
tiene su propia ilustración: la **hoja de personaje que aportó el municipio
para CementerIA** (`docs/migue/hoja-personaje.webp`, 1536×1024: Migue con el
chaleco azul marino con el logo "Ciudad San Miguel de Tucumán", camisa celeste
y pantalón beige, en cuatro vistas y un primer plano sobre un cementerio
desenfocado). Los dos archivos de esta carpeta salen de esa hoja:

| Archivo | Qué es | SHA-256 |
|---|---|---|
| `retrato.webp` | La cara, 320×320, **opaca**: el fondo es el cementerio desenfocado de la ilustración. Para el avatar del botón flotante y de la cabecera del chat | `2a69346f52cbdcd582cdbda91bacb451b785d9f11571fa4766bdf95d64919ea2` |
| `cuerpo.webp` | La vista de frente de cuerpo entero, 243×640, **con transparencia**. Para la bienvenida del chat vacío | `087dd82c4a9051e272ec7bed5706868425d612f039d1465aa6a8295682e6ca37` |

Los usan `src/components/migue/retrato-migue.tsx` (`RetratoMigue` y
`CuerpoMigue`) en `src/components/migue/chat-migue.tsx`, en la página pública
y en el sistema. El `alt` va vacío: el botón y el panel ya dicen "Migue".

## Cómo se regeneran

```bash
node scripts/migue-recortes.mjs docs/migue/hoja-personaje.webp <carpeta de salida>
```

Recorta la cara (`retrato.webp`) y las cuatro vistas de cuerpo entero con el
fondo sacado por relleno desde los bordes (`0.webp` a `3.webp`; la de frente es
`cuerpo.webp`). Es reproducible: con la misma hoja da los mismos archivos (los
SHA-256 de arriba). Las cuatro vistas son también las del tablero de Migues de
la Dirección de IA (organizacionDIA, `public/migue/cementeria/0..3.webp`), que
se entregan aparte.

Si se cambia algún archivo, se mantienen las medidas (los componentes declaran
`width` y `height`). Se sirven con un `<img>` común, sin el optimizador de
Next; si alguna vez pasan por `/_next/image`, en desarrollo la caché del
optimizador guarda la versión vieja dentro de `.next`: borrarla y levantar de
nuevo.
