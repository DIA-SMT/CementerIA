import { redirect } from "next/navigation";
import { exigirUsuario } from "@/lib/auth/sesion";
import { inicioPara } from "@/lib/dominio/navegacion";

/**
 * `/` no tiene contenido propio: cada uno empieza donde trabaja. Operadores en
 * su bandeja; Dirección y el admin en el panel (sección 5).
 */
export default async function Inicio() {
  const usuario = await exigirUsuario();
  redirect(inicioPara(usuario));
}
