import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { destinoSeguro } from "@/lib/auth/destino";
import { SISTEMA_ID } from "@/lib/auth/ingreso";
import { hostnameDeSolicitud } from "@/lib/auth/red";
import { FlaskConical, LogIn } from "lucide-react";
import { CLASE_BOTON_SECUNDARIO } from "@/components/formulario";
import { MarcaMunicipal } from "@/components/marca-municipal";
import { prisma } from "@/lib/db/cliente";
import { devLoginPara, entorno } from "@/lib/entorno";

export const metadata: Metadata = { title: "Login simulado", robots: { index: false, follow: false } };

const ETIQUETA_ROL: Record<string, string> = { operador: "Operador", lectura: "Solo lectura", admin: "Administrador" };

/**
 * /dev/login: entrar como un usuario activo sin pasar por Cidituc (sección 5).
 *
 * Solo en desarrollo con AUTH_DEV_LOGIN=1, o en staging con la lista blanca de
 * AUTH_DEV_LOGIN_STAGING; en cualquier otro caso responde 404, como si no
 * existiera. El ingreso queda registrado igual que uno real, con
 * `via: dev_login`.
 */
export default async function PaginaDevLogin({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await connection();
  const devLogin = devLoginPara(entorno(), hostnameDeSolicitud(await headers()));
  if (!devLogin) notFound();

  const { volver } = await searchParams;
  const destino = destinoSeguro(typeof volver === "string" ? volver : null);

  const usuarios = await prisma.usuario.findMany({
    where: {
      activo: true,
      id: { not: SISTEMA_ID },
      ...(devLogin.listaBlanca ? { cuil: { in: [...devLogin.listaBlanca] } } : {}),
    },
    select: {
      id: true,
      nombre: true,
      apellido: true,
      rol: true,
      area: { select: { nombre: true, orden: true } },
    },
    orderBy: [{ apellido: "asc" }, { nombre: "asc" }],
  });

  // Agrupados por área, en el orden de la semilla; el admin sin área, al final.
  const grupos = new Map<string, { orden: number; usuarios: typeof usuarios }>();
  for (const usuario of usuarios) {
    const nombre = usuario.area?.nombre ?? "Sin área";
    const grupo = grupos.get(nombre) ?? { orden: usuario.area?.orden ?? Number.MAX_SAFE_INTEGER, usuarios: [] };
    grupo.usuarios.push(usuario);
    grupos.set(nombre, grupo);
  }
  const ordenados = [...grupos.entries()].sort(([a, x], [b, y]) => x.orden - y.orden || a.localeCompare(b, "es"));

  return (
    <main className="flex-1 bg-fondo">
      <div className="mx-auto w-full max-w-2xl space-y-6 px-4 py-10">
        <MarcaMunicipal />
        <div className="flex gap-3 rounded-tarjeta border border-advertencia-borde bg-advertencia-fondo px-4 py-3">
          <FlaskConical className="mt-0.5 h-5 w-5 shrink-0 text-advertencia" aria-hidden="true" />
          <div>
            <h1 className="text-lg font-semibold text-texto">Login simulado</h1>
            <p className="mt-0.5 text-sm text-texto">
              Solo para {devLogin.listaBlanca ? "staging, con usuarios de la lista blanca" : "desarrollo"}. Entra sin
              Cidituc como el usuario elegido; el ingreso queda registrado igual que uno real.
            </p>
          </div>
        </div>
  
        {ordenados.length === 0 ? (
          <p className="tarjeta px-4 py-3 text-sm text-texto">
            No hay usuarios activos para elegir. En desarrollo, cargá la semilla con <code>npm run db:reset</code>.
          </p>
        ) : (
          ordenados.map(([area, grupo], indice) => (
            <section key={area} aria-labelledby={`area-${indice}`} className="space-y-2">
              <h2 id={`area-${indice}`} className="text-xs font-semibold uppercase tracking-wide text-texto-secundario">
                {area}
              </h2>
              <ul className="tarjeta divide-y divide-borde overflow-hidden">
                {grupo.usuarios.map((usuario) => (
                  <li key={usuario.id} className="flex items-center justify-between gap-3 px-4 py-2 transition-colors duration-150 hover:bg-superficie-azul/40">
                    <span className="text-sm text-texto">
                      {usuario.apellido}, {usuario.nombre}
                      <span className="ml-2 text-xs text-texto-secundario">{ETIQUETA_ROL[usuario.rol] ?? usuario.rol}</span>
                    </span>
                    <form action="/dev/login/entrar" method="post">
                      <input type="hidden" name="usuarioId" value={usuario.id} />
                      {destino ? <input type="hidden" name="volver" value={destino} /> : null}
                      <button type="submit" className={CLASE_BOTON_SECUNDARIO}>
                        <LogIn className="h-4 w-4" aria-hidden="true" />
                        Entrar como…
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </main>
  );
}
