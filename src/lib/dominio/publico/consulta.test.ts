import { describe, expect, it, vi } from "vitest";
import { RENOV_CONTADO } from "../../../../prisma/semilla/plantillas/renov-contado";
import {
  armarTramitePublico,
  codigosIguales,
  consultarTramite,
  MAXIMO_FALLOS_IP,
  MAXIMO_FALLOS_NUMERO,
  MENSAJE_LIMITE,
  MENSAJE_NO_ENCONTRADO,
  type DependenciasConsulta,
  type FilaConsulta,
} from "./consulta";

/** Una fila como la que podría traer la base, con datos personales de más: no tienen que salir. */
function filaConDatosDeMas(): FilaConsulta & Record<string, unknown> {
  return {
    id: BigInt(42),
    numeroInterno: "CEM-2026-00042",
    codigoConsulta: "K7QM3XZP",
    fechaInicio: new Date("2026-10-01T00:00:00Z"),
    estado: "en_tramite",
    pasoClave: RENOV_CONTADO.pasos[2].clave,
    pasoOrden: 3,
    enAreaDesde: new Date("2026-10-20T13:30:00Z"),
    tipoTramite: { nombre: "Renovación" },
    cementerio: { nombre: "Cementerio del Oeste" },
    plantilla: { codigo: "RENOV_CONTADO", version: 1, definicion: RENOV_CONTADO },
    areaActual: { id: 3, nombre: "Liquidación" },
    // Lo que nunca va en la respuesta.
    personas: [{ apellido: "PÉREZ", nombres: "Juana", dni: "30111222", telefono: "0381 000-5000", domicilio: "Calle Falsa 123" }],
    ubicacion: { seccion: "B", fila: "4", numero: "12" },
    ubicacionTexto: "Sección B · Fila 4 · N° 12",
    observaciones: "Trae la boleta el lunes",
    padron: "998877",
    numeroMunicipal: "12345/2026",
    creadoPor: 7,
    motivo: "Falta documentación",
  };
}

describe("armarTramitePublico", () => {
  it("lleva solo los campos de la lista: número, trámite, cementerio, inicio, estado, área, avance y último movimiento", () => {
    const t = armarTramitePublico(filaConDatosDeMas(), { cementerioDelArea: null, ultimoMovimiento: new Date("2026-10-21T15:00:00Z") });
    expect(Object.keys(t).sort()).toEqual(["area", "cementerio", "estado", "fechaInicio", "numero", "paso", "tipoTramite", "ultimoMovimiento"]);
    expect(Object.keys(t.area).sort()).toEqual(["desde", "nombre"]);
    expect(Object.keys(t.paso).sort()).toEqual(["nombre", "orden", "total"]);
    expect(t).toEqual({
      numero: "CEM-2026-00042",
      tipoTramite: "Renovación",
      cementerio: "Cementerio del Oeste",
      fechaInicio: "2026-10-01",
      estado: "en_tramite",
      area: { nombre: "Liquidación", desde: "2026-10-20" },
      paso: { orden: 3, total: RENOV_CONTADO.pasos.length, nombre: RENOV_CONTADO.pasos[2].nombre },
      ultimoMovimiento: "2026-10-21",
    });
  });

  it("no incluye datos personales, ubicación, observaciones, motivos ni el código", () => {
    const texto = JSON.stringify(armarTramitePublico(filaConDatosDeMas(), { cementerioDelArea: null, ultimoMovimiento: null }));
    for (const prohibido of ["PÉREZ", "Juana", "30111222", "0381", "Calle Falsa", "Sección B", "Trae la boleta", "998877", "12345/2026", "Falta documentación", "K7QM3XZP"]) {
      expect(texto).not.toContain(prohibido);
    }
  });

  it("un área que es la de un cementerio se nombra como el cementerio", () => {
    const fila = { ...filaConDatosDeMas(), areaActual: { id: 9, nombre: "Área del cementerio (interna)" } };
    expect(armarTramitePublico(fila, { cementerioDelArea: "Cementerio Jardín Norte", ultimoMovimiento: null }).area.nombre).toBe("Cementerio Jardín Norte");
  });

  it("las fechas son días de Tucumán (una madrugada en UTC es el día anterior allá)", () => {
    const fila = { ...filaConDatosDeMas(), enAreaDesde: new Date("2026-10-21T02:00:00Z") };
    const t = armarTramitePublico(fila, { cementerioDelArea: null, ultimoMovimiento: new Date("2026-10-22T01:00:00Z") });
    expect(t.area.desde).toBe("2026-10-20");
    expect(t.ultimoMovimiento).toBe("2026-10-21");
  });
});

describe("codigosIguales", () => {
  it("compara exacto y sin cortar antes (tiempo constante)", () => {
    expect(codigosIguales("K7QM3XZP", "K7QM3XZP")).toBe(true);
    expect(codigosIguales("K7QM3XZQ", "K7QM3XZP")).toBe(false);
    expect(codigosIguales(null, "K7QM3XZP")).toBe(false);
    expect(codigosIguales("K7QM", "K7QM3XZP")).toBe(false);
  });
});

/** Dependencias falsas: la cuenta de fallos, el expediente y lo que se escribe. */
function depsFalsas(opciones: { porIp?: number; porNumero?: number; fila?: ReturnType<typeof filaConDatosDeMas> | null } = {}) {
  const intentos: Array<{ ip: string | null; numero: string | null; resultado: string }> = [];
  const accesos: Array<Record<string, unknown>> = [];
  const tx = {
    intentoConsulta: { create: vi.fn(async ({ data }: { data: (typeof intentos)[number] }) => intentos.push(data)) },
    auditoriaAcceso: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => accesos.push(data)) },
  };
  const fila = opciones.fila === undefined ? filaConDatosDeMas() : opciones.fila;
  const deps = {
    leer: {
      $queryRaw: vi.fn(async () => [{ por_ip: opciones.porIp ?? 0, por_numero: opciones.porNumero ?? 0 }]),
      expediente: { findUnique: vi.fn(async ({ where }: { where: { numeroInterno: string } }) => (fila && where.numeroInterno === fila.numeroInterno ? fila : null)) },
      cementerio: { findFirst: vi.fn(async () => null) },
      movimiento: { findFirst: vi.fn(async () => ({ fechaEfectiva: new Date("2026-10-21T15:00:00Z") })) },
    },
    escribir: vi.fn(async (_usuario: number, _motivo: string | null, fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  } as unknown as DependenciasConsulta;
  return { deps, intentos, accesos };
}

describe("consultarTramite", () => {
  it("con número y código correctos devuelve el trámite y deja la consulta sin usuario", async () => {
    const { deps, intentos, accesos } = depsFalsas();
    const r = await consultarTramite(deps, { numero: "cem-2026-42", codigo: "k7qm-3xzp" }, "200.1.2.3");
    expect(r).toMatchObject({ ok: true, tramite: { numero: "CEM-2026-00042", estado: "en_tramite" } });
    expect(intentos).toEqual([]);
    expect(accesos).toEqual([{ usuarioId: null, accion: "consulta_publica", expedienteId: BigInt(42), detalle: {}, ip: "200.1.2.3" }]);
  });

  it("el mismo mensaje para un número que no existe, un código incorrecto y un código con otra forma", async () => {
    const casos = [
      { numero: "CEM-2026-99999", codigo: "K7QM3XZP" },
      { numero: "CEM-2026-00042", codigo: "K7QM3XZQ" },
      { numero: "CEM-2026-00042", codigo: "hola" },
      { numero: "cualquier cosa", codigo: "K7QM3XZP" },
    ];
    for (const entrada of casos) {
      const { deps, intentos, accesos } = depsFalsas();
      const r = await consultarTramite(deps, entrada, "200.1.2.3");
      expect(r).toEqual({ ok: false, motivo: "no_encontrado", mensaje: MENSAJE_NO_ENCONTRADO });
      expect(intentos).toHaveLength(1);
      expect(intentos[0].resultado).toBe("fallido");
      expect(accesos).toEqual([]);
    }
    expect(MENSAJE_NO_ENCONTRADO).toBe("No encontramos un trámite con ese número y código");
  });

  it("guarda el número canónico (o nada si no tenía forma) y la IP solo si es una IP", async () => {
    const a = depsFalsas();
    await consultarTramite(a.deps, { numero: "42/2026", codigo: "XXXXXXXX" }, "no-es-ip");
    expect(a.intentos[0]).toEqual({ ip: null, numero: "CEM-2026-00042", resultado: "fallido" });
    const b = depsFalsas();
    await consultarTramite(b.deps, { numero: "hola", codigo: "XXXXXXXX" }, "::1");
    expect(b.intentos[0]).toEqual({ ip: "::1", numero: null, resultado: "fallido" });
  });

  it(`con ${MAXIMO_FALLOS_IP} fallidos de la IP o ${MAXIMO_FALLOS_NUMERO} del número, ni busca: bloqueado`, async () => {
    for (const cuenta of [{ porIp: MAXIMO_FALLOS_IP }, { porNumero: MAXIMO_FALLOS_NUMERO }]) {
      const { deps, intentos } = depsFalsas(cuenta);
      const r = await consultarTramite(deps, { numero: "CEM-2026-00042", codigo: "K7QM3XZP" }, "200.1.2.3");
      expect(r).toEqual({ ok: false, motivo: "limite", mensaje: MENSAJE_LIMITE });
      expect(intentos).toEqual([{ ip: "200.1.2.3", numero: "CEM-2026-00042", resultado: "bloqueado" }]);
      expect(deps.leer.expediente.findUnique).not.toHaveBeenCalled();
    }
  });

  it("un fallido menos que el tope todavía consulta", async () => {
    const { deps } = depsFalsas({ porIp: MAXIMO_FALLOS_IP - 1, porNumero: MAXIMO_FALLOS_NUMERO - 1 });
    expect((await consultarTramite(deps, { numero: "CEM-2026-00042", codigo: "K7QM3XZP" }, null)).ok).toBe(true);
  });
});
