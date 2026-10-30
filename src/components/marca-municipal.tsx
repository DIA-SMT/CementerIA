/**
 * Marca de CementerIA: el logo oficial de la Municipalidad ("Ciudad San
 * Miguel de Tucumán") y el wordmark "CementerIA" con "Dirección de
 * Cementerios" (docs/diseno.md, "Marca").
 *
 * El logo (public/assets/cementeria/logo-municipal.png, 910 × 297) es el que
 * entregó el usuario con el kit institucional del 30/10/2026: no se redibuja
 * ni se recolorea. Su texto viene en BLANCO sobre transparente, así que va
 * solo sobre superficies azules u oscuras (la barra pública, el panel de la
 * foto del ingreso, la barra lateral y el pie). En una superficie clara va
 * dentro de un bloque azul institucional (`variante="clara"`): nunca suelto
 * sobre blanco, donde el texto desaparece. Siempre con su proporción.
 *
 * El wordmark es texto HTML: "Cementer" + "IA" destacada, en celeste sobre
 * el azul (5,57:1) y en `primario` sobre blanco (4,62:1; el celeste ahí da
 * 2,38 y no llega).
 */

/** El archivo y su tamaño real (ancho / alto, para reservar el lugar sin saltos). */
export const LOGO_MUNICIPAL = {
  src: "/assets/cementeria/logo-municipal.png",
  ancho: 910,
  alto: 297,
  alt: "Ciudad San Miguel de Tucumán",
} as const;

type Variante = "clara" | "oscura";

/**
 * El logo oficial. `alto` en px (el ancho sale de la proporción). Con
 * `variante="clara"` va dentro de un bloque azul institucional. `decorativo`
 * deja el `alt` vacío cuando al lado ya está escrito el nombre (por ejemplo,
 * dentro de un enlace que ya se llama "CementerIA…"). `className` va en la
 * imagen (la barra lateral contraída la achica al ancho de la franja).
 */
export function LogoMunicipal({
  variante = "oscura",
  alto = 40,
  decorativo = false,
  className = "",
}: {
  variante?: Variante;
  alto?: number;
  decorativo?: boolean;
  className?: string;
}) {
  const ancho = Math.round((alto * LOGO_MUNICIPAL.ancho) / LOGO_MUNICIPAL.alto);
  const imagen = (
    // eslint-disable-next-line @next/next/no-img-element -- nginx cierra /_next/image: archivo estático de public/assets.
    <img
      src={LOGO_MUNICIPAL.src}
      alt={decorativo ? "" : LOGO_MUNICIPAL.alt}
      width={ancho}
      height={alto}
      decoding="async"
      className={`block h-auto max-w-full shrink-0 ${className}`}
      style={{ width: ancho }}
    />
  );
  if (variante === "oscura") return imagen;
  return <span className="inline-flex shrink-0 rounded-control bg-institucional px-3 py-2 shadow-tarjeta">{imagen}</span>;
}

/**
 * "CementerIA" como texto: "IA" en celeste sobre fondos oscuros y en
 * `primario` sobre claros. El nombre accesible es la palabra entera (el span
 * de "IA" no la corta).
 */
export function Wordmark({ variante = "oscura", className = "" }: { variante?: Variante; className?: string }) {
  return (
    <span className={`font-extrabold tracking-tight ${variante === "oscura" ? "text-white" : "text-institucional"} ${className}`}>
      Cementer<span className={variante === "oscura" ? "text-celeste" : "text-primario"}>IA</span>
    </span>
  );
}

const DETALLE: Record<Variante, string> = {
  clara: "text-texto-secundario",
  oscura: "text-institucional-texto",
};

/**
 * Logo y textos. `titulo` pone "CementerIA" como `<h1>` (el ingreso); si no,
 * va como texto. `disposicion`: "fila" (logo, filete y textos en línea: la
 * barra pública, el pie) o "columna" (el logo arriba: la barra lateral, el
 * ingreso). `detalle`: "completo" agrega la Municipalidad. `claseTexto` va en
 * el bloque de textos (la barra lateral contraída lo deja solo para lectores
 * de pantalla) y `claseLogo` en la imagen.
 */
export function MarcaMunicipal({
  variante = "clara",
  tamano = "normal",
  titulo = false,
  detalle = "breve",
  disposicion = "columna",
  claseTexto = "",
  claseLogo = "",
}: {
  variante?: Variante;
  tamano?: "normal" | "grande";
  titulo?: boolean;
  detalle?: "completo" | "breve";
  disposicion?: "fila" | "columna";
  claseTexto?: string;
  claseLogo?: string;
}) {
  const grande = tamano === "grande";
  const Sistema = titulo ? "h1" : "span";
  const fila = disposicion === "fila";
  return (
    <div className={fila ? "flex items-center gap-3 sm:gap-4" : `flex flex-col items-start ${grande ? "gap-5" : "gap-3"}`}>
      <LogoMunicipal variante={variante} alto={grande ? 44 : fila ? 34 : 36} decorativo={false} className={claseLogo} />
      {fila ? <span aria-hidden="true" className={`hidden h-9 w-px sm:block ${variante === "oscura" ? "bg-white/25" : "bg-borde"} ${claseTexto}`} /> : null}
      <div className={`flex min-w-0 flex-col leading-tight ${claseTexto}`}>
        <Sistema className={grande ? "text-[2rem] leading-none sm:text-[2.25rem]" : "text-lg leading-tight"}>
          <Wordmark variante={variante} />
        </Sistema>
        <span className={`${grande ? "mt-1.5 text-base" : "text-xs"} font-medium ${DETALLE[variante]}`}>Dirección de Cementerios</span>
        {detalle === "completo" ? (
          <span className={`${grande ? "text-sm" : "text-[0.6875rem]"} ${DETALLE[variante]}`}>Municipalidad de San Miguel de Tucumán</span>
        ) : null}
      </div>
    </div>
  );
}
