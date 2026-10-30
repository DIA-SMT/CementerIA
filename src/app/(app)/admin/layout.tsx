import { redirect } from "next/navigation";
import { exigirUsuario } from "@/lib/auth/sesion";
import { inicioPara, puedeVerPantalla, RUTA_SITIO_PUBLICO, SECCIONES_ADMIN } from "@/lib/dominio/navegacion";
import { NavegacionAdmin } from "./navegacion-admin";

/**
 * Las pantallas de Administración (sección 5, solo admin) con su menú:
 * Plantillas · Usuarios · Catálogos · Auditoría · Sitio público. No es la
 * barrera (cada página vuelve a llamar a exigirPantalla y cada acción al
 * dominio, que exige `administrar` o `editar_sitio_publico`): solo evita armar
 * el menú para quien igual va a ser redirigido.
 *
 * Sitio público (28/10/2026) es también de Dirección: entra acá solo por esa
 * sección, y el menú le muestra solo esa (sin Inicio ni las demás).
 *
 * Arriba, una banda angosta con la foto `avenida-azul` (decorativa, `alt=""`)
 * bajo el velo institucional de la portada del panel (el mismo que se midió
 * para texto blanco, docs/diseno.md) y el menú de secciones. No sale en papel.
 */
export default async function LayoutAdmin({ children }: { children: React.ReactNode }) {
  const usuario = await exigirUsuario();
  const esAdmin = puedeVerPantalla(usuario, "admin");
  if (!esAdmin && !puedeVerPantalla(usuario, "sitio_publico")) redirect(inicioPara(usuario));
  const secciones = SECCIONES_ADMIN.filter((s) => esAdmin || s.href === RUTA_SITIO_PUBLICO).map(({ href, etiqueta }) => ({ href, etiqueta }));
  return (
    <div className="space-y-5">
      <div className="relative overflow-hidden rounded-tarjeta bg-institucional shadow-tarjeta print:hidden">
        {/* eslint-disable-next-line @next/next/no-img-element -- nginx cierra /_next/image: archivo estático de public/assets. */}
        <img
          src="/assets/cementeria/banner-patrimonio-960.webp"
          srcSet="/assets/cementeria/banner-patrimonio-960.webp 960w, /assets/cementeria/banner-patrimonio.webp 1672w"
          sizes="(min-width: 1024px) calc(100vw - 20rem), 100vw"
          width={1672}
          height={941}
          alt=""
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover object-[50%_55%]"
        />
        <div aria-hidden="true" className="absolute inset-0 bg-linear-to-r from-institucional/95 via-institucional/90 to-institucional/75" />
        <div className="relative flex flex-col gap-3 px-4 py-3.5 sm:px-5 lg:flex-row lg:items-center lg:justify-between">
          <p className="flex items-center gap-2.5 text-sm font-semibold text-white">
            <span aria-hidden="true" className="h-5 w-1 rounded-full bg-amarillo" />
            {esAdmin ? "Administración del sistema" : "Administración del sitio público"}
          </p>
          <NavegacionAdmin secciones={secciones} conInicio={esAdmin} />
        </div>
      </div>
      {children}
    </div>
  );
}
