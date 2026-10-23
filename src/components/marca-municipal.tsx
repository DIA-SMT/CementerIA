/**
 * Marca de CementerIA: el lugar del logo municipal y los textos
 * "CementerIA" / "Dirección de Cementerios" / "Municipalidad de San Miguel de
 * Tucumán".
 *
 * TODAVÍA NO HAY LOGO OFICIAL. Mientras tanto se muestra un monograma
 * tipográfico "SMT", con borde punteado a propósito: es provisorio y no
 * pretende ser un escudo ni un isotipo. Para poner el oficial (docs/diseno.md,
 * "Marca"):
 *
 * 1. Copiar el archivo que entregue Comunicación a `public/imagenes/marca/`
 *    (SVG si lo hay; si no, PNG o WebP de al menos 160 px de alto). Si hay una
 *    versión para fondo oscuro, también.
 * 2. Completar `LOGO_OFICIAL` acá abajo con las rutas y la proporción.
 *
 * No hace falta tocar nada más: la barra lateral, el ingreso y las demás
 * pantallas usan este componente.
 */

interface LogoOficial {
  /** Para fondos claros (ingreso, encabezados blancos). */
  claro: string;
  /** Para el azul institucional (barra lateral). Si no hay, se usa `claro`. */
  oscuro?: string;
  /** Ancho / alto del archivo, para reservar el lugar sin saltos. */
  proporcion: number;
}

/** Hoy vacío: no hay logo oficial disponible. */
const LOGO_OFICIAL: LogoOficial | null = null;

type Variante = "clara" | "oscura";

const ESTILOS: Record<Variante, { sistema: string; detalle: string; monograma: string }> = {
  clara: {
    sistema: "text-institucional",
    detalle: "text-texto-secundario",
    monograma: "border-borde-control text-institucional bg-white",
  },
  oscura: {
    sistema: "text-white",
    detalle: "text-institucional-texto",
    monograma: "border-institucional-texto/70 text-white bg-white/5",
  },
};

/** El lugar del logo: el oficial si está configurado; si no, el monograma provisorio. */
export function LogoMunicipal({ variante = "clara", tamano = 40 }: { variante?: Variante; tamano?: number }) {
  if (LOGO_OFICIAL) {
    const src = variante === "oscura" ? (LOGO_OFICIAL.oscuro ?? LOGO_OFICIAL.claro) : LOGO_OFICIAL.claro;
    return (
      // eslint-disable-next-line @next/next/no-img-element -- nginx cierra /_next/image; es un archivo estático de public/.
      <img
        src={src}
        alt=""
        height={tamano}
        width={Math.round(tamano * LOGO_OFICIAL.proporcion)}
        className="shrink-0"
        style={{ height: tamano, width: "auto" }}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      data-logo-provisorio=""
      title="Lugar reservado para el logo oficial"
      className={`inline-flex shrink-0 items-center justify-center rounded-control border border-dashed font-semibold tracking-wide ${ESTILOS[variante].monograma}`}
      style={{ width: tamano, height: tamano, fontSize: Math.round(tamano * 0.3) }}
    >
      SMT
    </span>
  );
}

/**
 * Logo y textos. `titulo` pone "CementerIA" como `<h1>` (el ingreso); si no,
 * va como texto. `detalle`: "completo" agrega la Municipalidad. `claseTexto`
 * va en el bloque de textos (la barra lateral colapsada lo deja solo para
 * lectores de pantalla y queda el monograma).
 */
export function MarcaMunicipal({
  variante = "clara",
  tamano = "normal",
  titulo = false,
  detalle = "completo",
  claseTexto = "",
}: {
  variante?: Variante;
  tamano?: "normal" | "grande";
  titulo?: boolean;
  detalle?: "completo" | "breve";
  claseTexto?: string;
}) {
  const e = ESTILOS[variante];
  const grande = tamano === "grande";
  const Sistema = titulo ? "h1" : "span";
  return (
    <div className={`flex items-center ${grande ? "gap-4" : "gap-3"}`}>
      <LogoMunicipal variante={variante} tamano={grande ? 56 : 40} />
      <div className={`flex min-w-0 flex-col leading-tight ${claseTexto}`}>
        <Sistema className={`${grande ? "text-3xl" : "text-lg"} font-bold tracking-tight ${e.sistema}`}>CementerIA</Sistema>
        <span className={`${grande ? "text-base" : "text-xs"} font-medium ${e.detalle}`}>Dirección de Cementerios</span>
        {detalle === "completo" ? (
          <span className={`${grande ? "text-sm" : "text-[0.6875rem]"} ${e.detalle}`}>Municipalidad de San Miguel de Tucumán</span>
        ) : null}
      </div>
    </div>
  );
}
