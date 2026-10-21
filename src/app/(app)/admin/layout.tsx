import { exigirPantalla } from "@/lib/auth/sesion";
import { SECCIONES_ADMIN } from "@/lib/dominio/navegacion";
import { NavegacionAdmin } from "./navegacion-admin";

/**
 * Las pantallas de Administración (sección 5, solo admin) con su menú:
 * Plantillas · Usuarios · Catálogos · Auditoría. No es la barrera (cada página
 * vuelve a llamar a exigirPantalla y cada acción al dominio, que exige
 * `administrar`): solo evita armar el menú para quien igual va a ser redirigido.
 */
export default async function LayoutAdmin({ children }: { children: React.ReactNode }) {
  await exigirPantalla("admin");
  return (
    <div className="space-y-5">
      <NavegacionAdmin secciones={SECCIONES_ADMIN.map(({ href, etiqueta }) => ({ href, etiqueta }))} />
      {children}
    </div>
  );
}
