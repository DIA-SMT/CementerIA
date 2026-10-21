// Los 30 expedientes ficticios de la semilla (prisma/semilla/expedientes.ts):
// docs/propuesta-mvp.md, sección 6, "Desarrollo local". Se crean con la función
// de alta del dominio y CONFIRMAN sus filas, como semilla.test.ts.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CANTIDAD_EXPEDIENTES_FICTICIOS,
  comandoFicticio,
  sembrarExpedientes,
  type ResumenExpedientesFicticios,
} from "../../prisma/semilla/expedientes";
import { asegurarSemilla } from "./dominio";
import { clientePrisma } from "./helper";

const prisma = clientePrisma();
const COMANDOS = Array.from({ length: CANTIDAD_EXPEDIENTES_FICTICIOS }, (_, i) => comandoFicticio(i + 1));
let primera: ResumenExpedientesFicticios;

beforeAll(async () => {
  await asegurarSemilla(prisma);
  primera = await sembrarExpedientes(prisma);
});

afterAll(async () => prisma.$disconnect());

async function expedientesFicticios() {
  const altas = await prisma.movimiento.findMany({ where: { tipo: "alta", comandoId: { in: COMANDOS } }, select: { expedienteId: true } });
  return prisma.expediente.findMany({
    where: { id: { in: altas.map((a) => a.expedienteId) } },
    include: {
      plantilla: { select: { codigo: true } },
      cementerio: { select: { codigo: true } },
      areaActual: { select: { codigo: true } },
      personas: true,
      movimientos: true,
    },
    orderBy: { secuencia: "asc" },
  });
}

describe("expedientes ficticios de la semilla", () => {
  it("la primera corrida crea los 30 con la función de alta", () => {
    expect(primera).toMatchObject({ creados: 30, existentes: 0 });
    expect(new Set(primera.numeros).size).toBe(30);
  });

  it("repartidos entre las 4 plantillas y los 3 cementerios, todos en el primer paso", async () => {
    const lista = await expedientesFicticios();
    expect(lista).toHaveLength(30);
    const contar = (claves: string[]) => Object.fromEntries([...new Set(claves)].map((k) => [k, claves.filter((x) => x === k).length]));
    expect(contar(lista.map((e) => e.plantilla.codigo))).toEqual({ RENOV_CONTADO: 9, RENOV_PLAN: 8, RENOV_SPT_CONTADO: 7, NUEVA_CONC_CONTADO: 6 });
    expect(contar(lista.map((e) => e.cementerio.codigo))).toEqual({ OESTE: 10, NORTE: 10, JARDIN_NORTE: 10 });
    for (const e of lista) {
      expect(e).toMatchObject({ pasoClave: "MESA", pasoOrden: 1, estado: "en_tramite", version: 0, areaActual: { codigo: "MESA_ENTRADAS" } });
      expect(e.movimientos.map((m) => m.tipo)).toEqual(["alta"]);
      expect(e.busqueda).not.toBe("");
    }
  });

  it("algunos con solicitante distinto del titular, alguno histórico y alguno con difuntos", async () => {
    const lista = await expedientesFicticios();
    const conSolicitante = lista.filter((e) => e.personas.some((p) => p.rol === "solicitante"));
    expect(conSolicitante.length).toBeGreaterThanOrEqual(5);
    for (const e of conSolicitante) {
      const t = e.personas.find((p) => p.rol === "titular");
      const s = e.personas.find((p) => p.rol === "solicitante");
      expect(`${s?.apellido} ${s?.nombres}`).not.toBe(`${t?.apellido} ${t?.nombres}`);
      expect(s?.vinculo).not.toBeNull();
    }
    const historicos = lista.filter((e) => e.cargaHistorica);
    expect(historicos.length).toBeGreaterThanOrEqual(1);
    for (const e of historicos) expect(e.movimientos[0]).toMatchObject({ cargaHistorica: true, fuente: "Ficha papel (ficticia)" });
    expect(lista.some((e) => e.personas.some((p) => p.rol === "difunto"))).toBe(true);
  });

  it("todas las personas son claramente ficticias", async () => {
    const personas = (await expedientesFicticios()).flatMap((e) => e.personas);
    for (const p of personas.filter((x) => x.tipoPersona === "fisica")) {
      expect(p.dni ?? "").toMatch(/^99999\d{3}$/);
      expect(p.nombres).toMatch(/ Prueba$/);
      if (p.email) expect(p.email).toMatch(/@ejemplo\.test$/);
      if (p.telefono) expect(p.telefono).toMatch(/^0381 000-/);
      if (p.domicilio) expect(p.domicilio).toMatch(/^Calle Ficticia /);
    }
    // Las asociaciones con panteón (semana 4): "Ficticia" en el nombre y CUIT
    // 30-99999NNN-D, el mismo rango reservado que los DNI 99.999.NNN.
    const juridicas = personas.filter((x) => x.tipoPersona === "juridica");
    expect(juridicas.length).toBeGreaterThanOrEqual(1);
    for (const p of juridicas) {
      expect(p.razonSocial).toMatch(/Ficticia/);
      expect(p.cuit ?? "").toMatch(/^3099999\d{4}$/);
      expect([p.apellido, p.nombres, p.dni]).toEqual([null, null, null]);
      if (p.email) expect(p.email).toMatch(/@ejemplo\.test$/);
    }
  });

  it("la ubicación sigue la nomenclatura de cada cementerio, normalizada (docs/fuentes)", async () => {
    const lista = await expedientesFicticios();
    for (const e of lista) {
      const seccion = (e.ubicacion as Record<string, string>).seccion;
      if (e.cementerio.codigo === "OESTE") expect(seccion).toMatch(/^[A-H]$/);
      else if (e.cementerio.codigo === "JARDIN_NORTE") expect(seccion).toMatch(/^[IVXL]+$/);
      else expect(seccion).toMatch(/^\d+$/);
      if (e.cementerio.codigo === "JARDIN_NORTE") expect(e.tipoMonumento).toBe("SEPULTURA");
    }
    // Las asociaciones, con panteón en el Oeste.
    const conAsociacion = lista.filter((e) => e.personas.some((p) => p.tipoPersona === "juridica"));
    expect(conAsociacion.map((e) => [e.cementerio.codigo, e.tipoMonumento])).toEqual([
      ["OESTE", "PANTEON"],
      ["OESTE", "PANTEON"],
    ]);
  });

  it("es idempotente: la segunda corrida no crea nada y devuelve los mismos números", async () => {
    const segunda = await sembrarExpedientes(prisma);
    expect(segunda).toEqual({ creados: 0, existentes: 30, numeros: primera.numeros });
  });
});
