/**
 * La foto del ingreso (decorativa, `alt` vacío) con el velo azul: mitad
 * izquierda en escritorio, con el nombre de la Municipalidad; en tablet y
 * celular, una franja angosta arriba, sin texto. Un <img> común con srcset:
 * nginx cierra /_next/image. La usan /login y /cambiar-clave
 * (docs/diseno.md, "Ingreso").
 */
export function FotoIngreso() {
  return (
    <div className="relative h-24 shrink-0 overflow-hidden sm:h-36 lg:h-auto lg:w-[57%]">
      {/* eslint-disable-next-line @next/next/no-img-element -- nginx cierra /_next/image: archivo estático de public/imagenes. */}
      <img
        src="/imagenes/ingreso-paseo-sereno-960.webp"
        srcSet="/imagenes/ingreso-paseo-sereno-960.webp 960w, /imagenes/ingreso-paseo-sereno-1600.webp 1600w"
        sizes="(min-width: 1024px) 57vw, 100vw"
        width={1600}
        height={900}
        alt=""
        loading="eager"
        fetchPriority="high"
        decoding="async"
        className="absolute inset-0 h-full w-full object-cover object-[50%_60%]"
      />
      <div aria-hidden="true" className="absolute inset-0 bg-linear-to-t from-institucional/90 via-institucional/55 to-primario/25" />
      <div className="relative hidden h-full flex-col justify-end p-10 text-white lg:flex xl:p-14">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white">Municipalidad de San Miguel de Tucumán</p>
        <p className="mt-3 max-w-lg text-3xl font-semibold leading-tight tracking-tight xl:text-4xl">
          Seguimiento de expedientes de la Dirección de Cementerios
        </p>
        <span aria-hidden="true" className="mt-6 block h-1 w-16 rounded-full bg-amarillo" />
      </div>
    </div>
  );
}
