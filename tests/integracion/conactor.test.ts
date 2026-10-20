// conActorEn() (src/lib/db/actor.ts) contra la base real: la puerta de
// escritura de la propuesta (sección 2, "Convenciones").
//
// Lo que se escribe acá con Prisma se confirma: códigos únicos y sin contar
// filas globales.

import { afterAll, describe, expect, it } from "vitest";
import { conActorEn } from "@/lib/db/actor";
import { SISTEMA, clientePrisma, unico } from "./helper";

const prisma = clientePrisma();
afterAll(async () => prisma.$disconnect());

describe("conActorEn", () => {
  it("firma la escritura con el actor y el motivo (sin espacios de más)", async () => {
    const codigo = unico("TT");
    const tipo = await conActorEn(prisma, SISTEMA, "  Alta desde Prisma  ", (tx) =>
      tx.tipoTramite.create({ data: { codigo, nombre: "Trámite de prueba (Prisma)" } }),
    );
    const cambio = await prisma.auditoriaCambio.findFirst({ where: { tabla: "tipos_tramite", registroId: String(tipo.id) } });
    expect(cambio).toMatchObject({ operacion: "I", usuarioId: SISTEMA, motivo: "Alta desde Prisma" });
  });

  it("fuera de conActor la escritura falla en la base", async () => {
    await expect(prisma.tipoTramite.create({ data: { codigo: unico("TT"), nombre: "Sin actor" } })).rejects.toThrow(/Falta el actor/);
  });

  it("el actor no queda pegado a las conexiones del pool", async () => {
    for (let i = 0; i < 6; i++) {
      await conActorEn(prisma, SISTEMA, "Transacción previa", (tx) => tx.$queryRaw`SELECT 1`);
    }
    const lecturas = await Promise.all(
      Array.from({ length: 6 }, () =>
        prisma.$queryRaw<Array<{ actor: string | null; motivo: string | null }>>`
          SELECT current_setting('app.usuario_id', true) AS actor, current_setting('app.motivo', true) AS motivo`,
      ),
    );
    expect(lecturas.flat().map((f) => [f.actor ?? "", f.motivo ?? ""])).toEqual(Array.from({ length: 6 }, () => ["", ""]));
  });

  it("si algo falla adentro se deshace todo", async () => {
    const codigo = unico("TT");
    await expect(
      conActorEn(prisma, SISTEMA, "Prueba de atomicidad", async (tx) => {
        await tx.tipoTramite.create({ data: { codigo, nombre: "Se tiene que deshacer" } });
        await tx.$queryRaw`SELECT public.f_sumar_dias_habiles('2031-03-03', -1)`;
      }),
    ).rejects.toThrow(/no puede ser negativo/);
    expect(await prisma.tipoTramite.findUnique({ where: { codigo } })).toBeNull();
  });

  it.each([0, -1, 1.5, Number.NaN])("rechaza el usuarioId %s antes de ir a la base", async (usuarioId) => {
    await expect(conActorEn(prisma, usuarioId, null, async () => undefined)).rejects.toThrow(/usuarioId inválido/);
  });
});
