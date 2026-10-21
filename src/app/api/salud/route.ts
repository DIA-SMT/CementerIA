import { NextResponse, connection } from "next/server";
import { prisma } from "@/lib/db/cliente";
import { log, resumenError } from "@/lib/log";
import { comprobarSalud, versionDelBuild } from "./salud";

/**
 * GET /api/salud (sección 6, "Hosting"): 200 con la versión si la base
 * responde a un SELECT 1 y 503 si no. Sin sesión (queda fuera del matcher de
 * src/proxy.ts) y sin datos sensibles; la lógica está en ./salud.ts.
 */
export async function GET(): Promise<NextResponse> {
  // Que nunca se resuelva en el build ni quede cacheada: la respuesta es del
  // momento en que se pide.
  await connection();
  const { status, cuerpo } = await comprobarSalud(
    () => prisma.$queryRaw`SELECT 1`,
    versionDelBuild(),
    // El detalle va solo a journald: nombre, código y primera línea, nunca la
    // URL de conexión.
    (error) => log.error("salud.base_sin_respuesta", resumenError(error)),
  );
  return NextResponse.json(cuerpo, { status, headers: { "Cache-Control": "no-store" } });
}
