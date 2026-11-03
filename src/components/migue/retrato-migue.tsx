/**
 * Las imágenes de Migue (public/migue/, sacadas de la hoja de personaje de
 * CementerIA; la procedencia y cómo se regeneran están en
 * public/migue/LEEME.md). Como en El Sanmiguelino
 * (src/components/migue/retrato-migue.tsx), pero con un `<img>` común: en el
 * servidor municipal nginx cierra /_next/image (docs/diseno.md, "Imágenes").
 *
 * El `alt` va vacío a propósito: Migue acompaña siempre a un texto que ya dice
 * "Migue" (el nombre accesible del botón, el título del panel), y un lector de
 * pantalla que anuncia "Migue" dos veces seguidas estorba.
 */

/**
 * La cara (retrato.webp, 320×320). Es **opaca**: el fondo es el cementerio
 * desenfocado de la ilustración, así que recortada en círculo es una foto
 * redonda que se ve igual en el modo claro y en el oscuro (no queda un
 * cuadrado blanco detrás).
 */
export function RetratoMigue({ className = "", prioridad = false }: { className?: string; prioridad?: boolean }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- nginx cierra /_next/image: archivo estático de public/migue.
    <img
      src="/migue/retrato.webp"
      alt=""
      width={320}
      height={320}
      loading={prioridad ? "eager" : "lazy"}
      decoding="async"
      className={`shrink-0 rounded-full object-cover ${className}`}
    />
  );
}

/**
 * Migue entero, de frente (cuerpo.webp, 243×640, con transparencia), para cuando
 * hay lugar: la bienvenida del chat vacío, como en El Sanmiguelino. El ancho y
 * el alto son los del archivo: si no coinciden, se deforma.
 */
export function CuerpoMigue({ className = "" }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- nginx cierra /_next/image: archivo estático de public/migue.
    <img src="/migue/cuerpo.webp" alt="" width={243} height={640} loading="lazy" decoding="async" className={`shrink-0 object-contain ${className}`} />
  );
}
