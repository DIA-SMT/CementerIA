import { LogoMunicipal } from "@/components/marca-municipal";

/**
 * El panel de la foto del ingreso (kit institucional, 30/10/2026): en
 * escritorio, el 55 % izquierdo con `login-patrimonio` (conceptual, generada
 * con IA; decorativa, `alt=""`) bajo el velo azul, el logo oficial (va sobre
 * azul) arriba y, abajo, el nombre de la Municipalidad y del sistema. Es la
 * imagen principal de la pantalla: carga con prioridad alta.
 *
 * En tablet y celular no se muestra (el formulario va primero): un
 * `<picture>` cuya fuente solo vale desde 1024 px, así el celular ni la
 * descarga (la imagen de respaldo es un GIF transparente de 1 × 1 en línea).
 * Un <img> común: nginx cierra /_next/image. La usan /login y /cambiar-clave
 * (docs/diseno.md, "Ingreso").
 */
export function FotoIngreso() {
  return (
    <div data-panel-foto="" className="relative isolate hidden shrink-0 overflow-hidden bg-institucional lg:flex lg:w-[55%] lg:flex-col">
      <picture>
        <source
          media="(min-width: 1024px)"
          srcSet="/assets/cementeria/login-patrimonio-960.webp 960w, /assets/cementeria/login-patrimonio.webp 1672w"
          sizes="55vw"
        />
        <img
          src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"
          width={1672}
          height={941}
          alt=""
          loading="eager"
          fetchPriority="high"
          decoding="async"
          className="absolute inset-0 -z-10 h-full w-full object-cover object-[50%_55%]"
        />
      </picture>
      {/* Más denso abajo y arriba, donde va el texto; medido para texto blanco (docs/diseno.md). */}
      <div aria-hidden="true" className="absolute inset-0 -z-10 bg-linear-to-t from-institucional/95 via-institucional/55 to-institucional/80" />
      <div className="flex h-full flex-col justify-between p-10 text-white xl:p-14">
        <LogoMunicipal alto={48} />
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white">Municipalidad de San Miguel de Tucumán</p>
          <p className="mt-3 max-w-lg text-3xl font-semibold leading-tight tracking-tight xl:text-4xl">
            Seguimiento de expedientes de la Dirección de Cementerios
          </p>
          <span aria-hidden="true" className="mt-6 block h-1 w-16 rounded-full bg-amarillo" />
          <p className="mt-6 text-xs text-institucional-texto">Imagen ilustrativa generada con IA.</p>
        </div>
      </div>
    </div>
  );
}

/**
 * En tablet y celular, arriba del formulario: una franja azul institucional
 * angosta con el logo oficial (que va sobre azul); el wordmark es el h1 de
 * abajo. En escritorio no se muestra: el logo está en el panel de la foto.
 */
export function FranjaMarcaIngreso() {
  return (
    <div className="flex items-center bg-institucional px-4 py-3 sm:px-8 lg:hidden">
      <LogoMunicipal alto={32} />
    </div>
  );
}
