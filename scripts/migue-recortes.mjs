// Recorta la hoja de personaje de Migue (docs/migue/hoja-personaje.webp): la cara para el avatar
// (retrato.webp, 320x320) y las cuatro vistas de cuerpo entero con fondo transparente (0..3.webp).
// Uso: node scripts/migue-recortes.mjs docs/migue/hoja-personaje.webp <carpeta de salida>
import { createRequire } from "node:module";
const sharp = createRequire(import.meta.url)("sharp");
const [hoja, salida] = process.argv.slice(2);

async function sinFondo(region, archivo, alto) {
  const { data, info } = await sharp(hoja).extract(region).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const claro = (i) => data[i] > 205 && data[i + 1] > 205 && data[i + 2] > 205 && Math.max(data[i], data[i+1], data[i+2]) - Math.min(data[i], data[i+1], data[i+2]) < 30;
  const visto = new Uint8Array(w * h);
  const pila = [];
  for (let x = 0; x < w; x++) pila.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) pila.push(y * w, y * w + w - 1);
  while (pila.length) {
    const p = pila.pop();
    if (visto[p]) continue;
    visto[p] = 1;
    if (!claro(p * 4)) continue;
    data[p * 4 + 3] = 0;
    const x = p % w, y = (p / w) | 0;
    if (x > 0) pila.push(p - 1);
    if (x < w - 1) pila.push(p + 1);
    if (y > 0) pila.push(p - w);
    if (y < h - 1) pila.push(p + w);
  }
  // Se queda con la figura (la mancha opaca más grande): saca restos del fondo y de las vistas vecinas.
  const grupo = new Int32Array(w * h).fill(-1);
  let mayor = -1, tamMayor = 0;
  for (let s = 0, g = 0; s < w * h; s++) {
    if (grupo[s] !== -1 || data[s * 4 + 3] === 0) continue;
    let tam = 0; const cola = [s]; grupo[s] = g;
    while (cola.length) {
      const p = cola.pop(); tam++;
      const x = p % w, y = (p / w) | 0;
      for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1])
        if (q >= 0 && grupo[q] === -1 && data[q * 4 + 3] !== 0) { grupo[q] = g; cola.push(q); }
    }
    if (tam > tamMayor) { tamMayor = tam; mayor = g; }
    g++;
  }
  for (let p = 0; p < w * h; p++) if (grupo[p] !== mayor) data[p * 4 + 3] = 0;
  await sharp(data, { raw: { width: w, height: h, channels: 4 } }).trim().resize({ height: alto }).webp({ quality: 88, alphaQuality: 90 }).toFile(`${salida}/${archivo}`);
}

await sharp(hoja).extract({ left: 745, top: 545, width: 440, height: 440 }).resize(320, 320).webp({ quality: 86 }).toFile(`${salida}/retrato.webp`);
const vistas = [[748, 168], [922, 150], [1080, 178], [1276, 145]];
for (const [i, [left, width]] of vistas.entries()) await sinFondo({ left, top: 20, width, height: 475 }, `${i}.webp`, 640);
