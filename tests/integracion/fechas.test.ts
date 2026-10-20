// Fechas con el proceso en TZ=UTC (propuesta, sección 6: fila "Tests" y apartado
// "Fechas"; 2.8, precision_fecha).
//
// El servidor corre con TZ de Tucumán, pero el código no puede depender de eso:
// la batería corre con TZ=UTC para que cualquier conversión que use la zona de
// la máquina se note. Acá queda fijado lo que garantiza la base y cómo llegan
// las fechas a JS, que es sobre lo que se apoya src/lib/fechas.ts (semana 2).

import { afterAll, describe, expect, it } from "vitest";
import { conActorEn, type Transaccion } from "@/lib/db/actor";
import { crearEscenario, crearExpediente, crearMovimiento, fila, sql } from "./escenario";
import { SISTEMA, clientePrisma, conPg, enTransaccion, fijarActor, type Rol } from "./helper";

const prisma = clientePrisma();
afterAll(async () => prisma.$disconnect());

/** Señal para deshacer la transacción de Prisma sin que sea un error del test. */
class Deshacer extends Error {}

/**
 * Corre `fn` dentro de conActorEn() y deshace todo al final: lo que se escribe
 * con Prisma no queda en la base (como enTransaccion() para pg).
 */
async function conPrismaYDeshacer<T>(fn: (tx: Transaccion) => Promise<T>): Promise<T> {
  let resultado: { valor: T } | undefined;
  await conActorEn(prisma, SISTEMA, "Prueba de fechas", async (tx) => {
    resultado = { valor: await fn(tx) };
    throw new Deshacer();
  }).catch((e: unknown) => {
    if (!(e instanceof Deshacer)) throw e;
  });
  if (!resultado) throw new Error("La transacción no llegó al final");
  return resultado.valor;
}

describe("zonas horarias", () => {
  it("el proceso de los tests corre en UTC", () => {
    expect(process.env.TZ).toBe("UTC");
    expect(new Date(2026, 6, 1).getTimezoneOffset()).toBe(0);
  });

  it.each<Rol>(["app", "owner"])("la sesión de %s está en hora de Tucumán (ALTER DATABASE … SET timezone)", async (rol) => {
    await conPg(rol, async (c) => {
      expect((await fila<{ TimeZone: string }>(c, "SHOW timezone")).TimeZone).toBe("America/Argentina/Tucuman");
    });
  });
});

describe("columnas date (sección 6: texto YYYY-MM-DD en el dominio)", () => {
  it("se leen como texto sin correrse de día", async () => {
    await enTransaccion("app", async (c) => {
      await fijarActor(c, SISTEMA);
      const exp = await crearExpediente(c, await crearEscenario(c), { fecha_inicio: "2019-03-15" });
      const r = await fila<{ fecha: string }>(c, "SELECT fecha_inicio::text AS fecha FROM public.expedientes WHERE id = $1", [exp.id]);
      expect(r.fecha).toBe("2019-03-15");
    });
  });

  it("Prisma las entrega como Date a medianoche UTC", async () => {
    const leido = await conPrismaYDeshacer(async (tx) => {
      await tx.$executeRaw`INSERT INTO public.feriados (fecha, descripcion, ambito) VALUES ('2032-07-09', 'Feriado ficticio', 'asueto')`;
      return tx.feriado.findUniqueOrThrow({ where: { fecha: new Date("2032-07-09T00:00:00Z") } });
    });
    expect(leido.fecha.toISOString()).toBe("2032-07-09T00:00:00.000Z");
  });

  it("Prisma guarda el día UTC del Date: uno armado con la hora de Tucumán a la noche cae al día siguiente", async () => {
    // Por esto el dominio no pasa Date a las columnas date: las 22:00 del 9/7 en
    // Tucumán son las 01:00 del 10/7 en UTC.
    const guardadas = await conPrismaYDeshacer(async (tx) => {
      await tx.feriado.create({ data: { fecha: new Date("2032-07-09T00:00:00Z"), descripcion: "Medianoche UTC", ambito: "asueto" } });
      await tx.feriado.create({ data: { fecha: new Date("2032-07-12T22:00:00-03:00"), descripcion: "Noche en Tucumán", ambito: "asueto" } });
      return tx.$queryRaw<Array<{ fecha: string; descripcion: string }>>`
        SELECT fecha::text AS fecha, descripcion FROM public.feriados
         WHERE fecha BETWEEN '2032-07-01' AND '2032-07-31' ORDER BY fecha`;
    });
    expect(guardadas).toEqual([
      { fecha: "2032-07-09", descripcion: "Medianoche UTC" },
      { fecha: "2032-07-13", descripcion: "Noche en Tucumán" },
    ]);
  });
});

describe("timestamptz y precisión de día (2.8)", () => {
  it("un movimiento con precisión de día se guarda a las 00:00 de Tucumán y conserva su día", async () => {
    await enTransaccion("app", async (c) => {
      await fijarActor(c, SISTEMA);
      const exp = await crearExpediente(c, await crearEscenario(c));
      const m = await crearMovimiento(c, exp.id, {
        fecha_efectiva: sql("timestamptz '2026-10-15 00:00 America/Argentina/Tucuman'"),
        precision_fecha: "dia",
      });
      const r = await fila<{ fecha_efectiva: Date; dia: string }>(
        c,
        "SELECT fecha_efectiva, fecha_efectiva::date::text AS dia FROM public.movimientos WHERE id = $1",
        [m.id],
      );
      expect(r.fecha_efectiva.toISOString()).toBe("2026-10-15T03:00:00.000Z");
      expect(r.dia).toBe("2026-10-15");
    });
  });

  it("cerca de la medianoche, el día lo da la sesión de Tucumán y no el reloj UTC", async () => {
    await enTransaccion("app", async (c) => {
      await fijarActor(c, SISTEMA);
      const exp = await crearExpediente(c, await crearEscenario(c));
      const m = await crearMovimiento(c, exp.id, { fecha_efectiva: sql("timestamptz '2026-10-15 23:30 America/Argentina/Tucuman'") });
      const consulta = `SELECT fecha_efectiva, fecha_efectiva::date::text AS dia,
                               (fecha_efectiva AT TIME ZONE 'America/Argentina/Tucuman')::date::text AS dia_tucuman
                          FROM public.movimientos WHERE id = $1`;
      const enTucuman = await fila<{ fecha_efectiva: Date; dia: string; dia_tucuman: string }>(c, consulta, [m.id]);
      expect(enTucuman.fecha_efectiva.toISOString()).toBe("2026-10-16T02:30:00.000Z");
      expect(enTucuman.dia).toBe("2026-10-15");

      // Una sesión en otra zona (un script, psql de otra máquina) vería otro
      // día con ::date; AT TIME ZONE explícito no depende de la sesión.
      await c.query("SET LOCAL TIME ZONE 'UTC'");
      const enUtc = await fila<{ dia: string; dia_tucuman: string }>(c, consulta, [m.id]);
      expect(enUtc).toMatchObject({ dia: "2026-10-16", dia_tucuman: "2026-10-15" });
    });
  });

  it("un Date de JS se guarda como el mismo instante, sin importar la zona del proceso", async () => {
    await enTransaccion("app", async (c) => {
      await fijarActor(c, SISTEMA);
      const exp = await crearExpediente(c, await crearEscenario(c));
      const instante = new Date("2026-10-15T14:05:00-03:00");
      const m = await crearMovimiento(c, exp.id, { fecha_efectiva: instante });
      const r = await fila<{ texto: string }>(
        c,
        "SELECT to_char(fecha_efectiva, 'YYYY-MM-DD HH24:MI') AS texto FROM public.movimientos WHERE id = $1",
        [m.id],
      );
      expect(r.texto).toBe("2026-10-15 14:05");
    });
  });
});
