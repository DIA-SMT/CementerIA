import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { destinoSeguro } from "@/lib/auth/destino";
import { SISTEMA_ID } from "@/lib/auth/ingreso";
import { hostnameDeSolicitud } from "@/lib/auth/red";
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
    <main className="mx-auto w-full max-w-2xl flex-1 space-y-6 px-4 py-10">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Login simulado</h1>
        <p className="mt-1 text-sm text-slate-600">
          Solo para {devLogin.listaBlanca ? "staging, con usuarios de la lista blanca" : "desarrollo"}. Entra sin
          Cidituc como el usuario elegido; el ingreso queda registrado igual que uno real.
        </p>
      </div>

      {ordenados.length === 0 ? (
        <p className="rounded border border-slate-300 bg-white px-4 py-3 text-sm text-slate-700">
          No hay usuarios activos para elegir. En desarrollo, cargá la semilla con <code>npm run db:reset</code>.
        </p>
      ) : (
        ordenados.map(([area, grupo], indice) => (
          <section key={area} aria-labelledby={`area-${indice}`} className="space-y-2">
            <h2 id={`area-${indice}`} className="text-sm font-semibold text-slate-700">
              {area}
            </h2>
            <ul className="divide-y divide-slate-200 rounded border border-slate-300 bg-white">
              {grupo.usuarios.map((usuario) => (
                <li key={usuario.id} className="flex items-center justify-between gap-3 px-4 py-2">
                  <span className="text-sm text-slate-900">
                    {usuario.apellido}, {usuario.nombre}
                    <span className="ml-2 text-xs text-slate-500">{ETIQUETA_ROL[usuario.rol] ?? usuario.rol}</span>
                  </span>
                  <form action="/dev/login/entrar" method="post">
                    <input type="hidden" name="usuarioId" value={usuario.id} />
                    {destino ? <input type="hidden" name="volver" value={destino} /> : null}
                    <button
                      type="submit"
                      className="rounded border border-slate-300 px-3 py-1 text-sm text-slate-700 hover:bg-slate-100"
                    >
                      Entrar como…
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </main>
  );
}
