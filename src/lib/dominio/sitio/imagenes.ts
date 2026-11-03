import { altoParaAncho, anchoDeVersion, type AnchoFoto } from "@/lib/imagenes/tipos";
import { fotoSitio, type FotoSitio } from "./validacion";

/**
 * La foto de un cementerio o de un recorrido tal como la muestra la página
 * pública (30/10/2026): una ilustrativa del kit (public/assets/cementeria) o
 * una que subió la Dirección (servida por /sitio/fotos/…). Puro: lo usan la
 * lectura (./lectura.ts), las páginas y la administración (vista previa).
 */
export interface ImagenSitio {
  /** La versión chica (960 px): el `src` y la vista previa. */
  src: string;
  /** Las dos versiones con su ancho real (`… 960w, … 1920w`); una sola si son del mismo ancho. */
  srcSet: string;
  /** Las medidas de la versión grande: `width` y `height` del `<img>` (reservan el lugar, sin saltos). */
  ancho: number;
  alto: number;
  alt: string;
  /** Las del kit: conceptuales, generadas con IA. Lo dice la página; las subidas no. */
  ilustrativa: boolean;
  /** El crédito o la descripción de una foto subida, si lo cargaron. */
  credito: string | null;
}

/** Lo que hace falta de una foto subida para mostrarla. */
export interface FotoSubidaParaMostrar {
  id: string;
  alt: string;
  credito: string | null;
  ancho: number;
  alto: number;
  sha256: string;
}

/** Cuántos caracteres del sha256 van en la URL: cambia si cambia la foto (la caché puede ser "immutable"). */
export const LARGO_VERSION_FOTO = 16;

/** La URL pública de una versión: `/sitio/fotos/<id>/<16 del sha256>-<960|1920>.webp`. */
export function urlFotoSitio(f: { id: string; sha256: string }, nominal: AnchoFoto): string {
  return `/sitio/fotos/${f.id}/${f.sha256.slice(0, LARGO_VERSION_FOTO)}-${nominal}.webp`;
}

export function imagenDeKit(f: FotoSitio): ImagenSitio {
  return {
    src: f.chica,
    srcSet: `${f.chica} 960w, ${f.grande} ${f.anchoGrande}w`,
    ancho: f.anchoGrande,
    alto: f.altoGrande,
    alt: f.alt,
    ilustrativa: true,
    credito: null,
  };
}

export function imagenSubida(f: FotoSubidaParaMostrar): ImagenSitio {
  const chica = anchoDeVersion(960, f.ancho);
  const grande = anchoDeVersion(1920, f.ancho);
  const src = urlFotoSitio(f, 960);
  return {
    src,
    srcSet: grande === chica ? `${src} ${chica}w` : `${src} ${chica}w, ${urlFotoSitio(f, 1920)} ${grande}w`,
    ancho: grande,
    alto: altoParaAncho(grande, f.ancho, f.alto),
    alt: f.alt,
    ilustrativa: false,
    credito: f.credito,
  };
}

/**
 * La imagen de una fila: la subida (si está activa) o la del kit, o ninguna.
 * La base no deja tener las dos (CHECK) ni apuntar a una dada de baja (trigger).
 */
export function imagenDeFila(foto: string | null | undefined, subida: (FotoSubidaParaMostrar & { activa: boolean }) | null | undefined): ImagenSitio | null {
  if (subida?.activa) return imagenSubida(subida);
  const kit = fotoSitio(foto);
  return kit ? imagenDeKit(kit) : null;
}

/**
 * Qué decir de las fotos de una lista: "todas" son ilustrativas (una frase
 * general, como hasta ahora), "algunas" (cada una lo dice al pie) o "ninguna".
 */
export function ilustrativasDe(imagenes: ReadonlyArray<ImagenSitio | null>): "todas" | "algunas" | "ninguna" {
  const con = imagenes.filter((i): i is ImagenSitio => i !== null);
  const ilustrativas = con.filter((i) => i.ilustrativa).length;
  if (ilustrativas === 0) return "ninguna";
  return ilustrativas === con.length ? "todas" : "algunas";
}
