// Los escenarios de la semilla de desarrollo (prisma/semilla/escenarios.ts):
// expedientes ficticios repartidos por todo el circuito, creados y movidos con
// las funciones del dominio por los usuarios de cada área. CONFIRMAN sus filas,
// como semilla-expedientes.test.ts; la base es compartida, así que las bandejas
// y el panel se miran filtrados por los expedientes de los escenarios.

import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearAlmacenEnDisco } from "@/lib/adjuntos/almacen";
import type { PestanaBandeja, ServicioExpedientes } from "@/lib/dominio/expedientes";
import type { UsuarioPermisos } from "@/lib/dominio/permisos";
import { comandoFicticio } from "../../prisma/semilla/expedientes";
import { ESCENARIOS, FUENTE_ESCENARIOS, sembrarEscenarios, type ResumenEscenarios } from "../../prisma/semilla/escenarios";
import { asegurarSemilla, conciliacion, servicio, usuario, type CodigoUsuario } from "./dominio";
import { clientePrisma } from "./helper";

const prisma = clientePrisma();
const exp: ServicioExpedientes = servicio(prisma);
let dir: string;
let primera: ResumenEscenarios;

beforeAll(async () => {
  await asegurarSemilla(prisma);
  // Los 30 no se siembran acá: semilla-expedientes.test.ts controla que SU
  // primera corrida los cree, y el orden de los archivos no está garantizado.
  dir = await mkdtemp(join(tmpdir(), "cementeria-escenarios-"));
  primera = await sembrarEscenarios(prisma, { almacen: crearAlmacenEnDisco(dir) });
}, 600_000);

afterAll(async () => {
  await prisma.$disconnect();
  if (dir) await rm(dir, { recursive: true, force: true });
});

function numero(clave: string): string {
  const e = primera.escenarios.find((x) => x.clave === clave);
  if (!e) throw new Error(`No hay escenario ${clave}`);
  return e.numero;
}

/** Dónde queda cada escenario: paso, estado, área actual y si la recepción está confirmada. */
const ESPERADO: Record<string, { paso: string; estado: string; area: string; responsable?: string; recibido?: boolean }> = {
  C1: { paso: "COMPUTO_ALTA", estado: "en_tramite", area: "COMPUTO", recibido: false },
  C2: { paso: "COMPUTO_FINAL", estado: "en_tramite", area: "COMPUTO", recibido: false },
  C3: { paso: "COMPUTO_ALTA", estado: "en_tramite", area: "COMPUTO", recibido: true },
  C4: { paso: "COMPUTO_FINAL", estado: "en_tramite", area: "COMPUTO", recibido: true },
  L1: { paso: "LIQUIDACION", estado: "en_tramite", area: "LIQUIDACION", recibido: false },
  L2: { paso: "LIQUIDACION", estado: "en_tramite", area: "LIQUIDACION", recibido: false },
  L3: { paso: "LIQUIDACION", estado: "en_tramite", area: "LIQUIDACION", recibido: true },
  L4: { paso: "LIQUIDACION", estado: "en_tramite", area: "LIQUIDACION", recibido: true },
  L5: { paso: "LIQUIDACION", estado: "en_tramite", area: "LIQUIDACION", recibido: true },
  L6: { paso: "LIQUIDACION", estado: "en_tramite", area: "LIQUIDACION", recibido: true },
  L7: { paso: "LIQUIDACION", estado: "en_tramite", area: "LIQUIDACION", recibido: true },
  G1: { paso: "LEGAL", estado: "en_tramite", area: "LEGAL", recibido: true },
  G2: { paso: "LEGAL", estado: "en_tramite", area: "LEGAL", recibido: true },
  G3: { paso: "LEGAL", estado: "en_tramite", area: "LEGAL", recibido: false },
  A1: { paso: "ADM_RESOLUCION", estado: "en_tramite", area: "ADMINISTRATIVO", recibido: true },
  A2: { paso: "ADM_TITULO", estado: "en_tramite", area: "ADMINISTRATIVO", recibido: true },
  A3: { paso: "ADM_ENTREGA", estado: "en_tramite", area: "ADMINISTRATIVO", recibido: true },
  A4: { paso: "ADM_ENTREGA", estado: "en_tramite", area: "ADMINISTRATIVO", recibido: true },
  A5: { paso: "ADM_RESOLUCION", estado: "en_tramite", area: "ADMINISTRATIVO", recibido: false },
  T1: { paso: "TRIBUTARIO", estado: "en_tramite", area: "TRIBUTARIO", recibido: false },
  T2: { paso: "TRIBUTARIO", estado: "en_tramite", area: "TRIBUTARIO", recibido: true },
  D1: { paso: "DIM", estado: "espera_pago_dim", area: "DIM", responsable: "TRIBUTARIO", recibido: true },
  D2: { paso: "DIM", estado: "espera_pago_dim", area: "DIM", responsable: "TRIBUTARIO", recibido: true },
  D3: { paso: "DIM", estado: "espera_pago_dim", area: "DIM", responsable: "TRIBUTARIO", recibido: true },
  M1: { paso: "CEMENTERIO", estado: "en_tramite", area: "CEM_NORTE", responsable: "MESA_ENTRADAS", recibido: true },
  M2: { paso: "CEMENTERIO", estado: "en_tramite", area: "CEM_JARDIN_NORTE", responsable: "MESA_ENTRADAS", recibido: true },
  M3: { paso: "MESA", estado: "en_tramite", area: "MESA_ENTRADAS", recibido: false },
  K1: { paso: "ADM_ENTREGA", estado: "concluido", area: "ADMINISTRATIVO" },
  K2: { paso: "ADM_ENTREGA", estado: "concluido", area: "ADMINISTRATIVO" },
  K3: { paso: "ADM_ENTREGA", estado: "archivado", area: "ADMINISTRATIVO" },
  // Archivado sin concluir desde el cementerio: el papel volvió a la custodia.
  X1: { paso: "CEMENTERIO", estado: "archivado", area: "MESA_ENTRADAS", responsable: "MESA_ENTRADAS" },
  Y1: { paso: "MESA", estado: "anulado", area: "MESA_ENTRADAS" },
  R1: { paso: "LIQUIDACION", estado: "anulado", area: "LIQUIDACION" },
};

/** Lo que cada área ve de los escenarios en cada pestaña de su bandeja. */
const BANDEJAS: Record<Exclude<CodigoUsuario, "DIRECCION" | "ADMIN">, Partial<Record<PestanaBandeja, string[]>>> = {
  MESA_ENTRADAS: {
    por_confirmar: ["M3"],
    en_mi_area: ["M3", "R1+"],
    afuera: ["M1", "M2", "D1", "D2", "D3"],
    plazos: ["D1", "D2", "D3"],
    carga_historica: [],
  },
  COMPUTO: { por_confirmar: ["C1", "C2"], en_mi_area: ["C1", "C2", "C3", "C4"], afuera: [], plazos: [] },
  LIQUIDACION: { por_confirmar: ["L1", "L2"], en_mi_area: ["L1", "L2", "L3", "L4", "L5", "L6", "L7"], afuera: [], plazos: [] },
  LEGAL: { por_confirmar: ["G3"], en_mi_area: ["G1", "G2", "G3"], afuera: [], plazos: [] },
  ADMINISTRATIVO: { por_confirmar: ["A5"], en_mi_area: ["A1", "A2", "A3", "A4", "A5"], afuera: [], plazos: [] },
  TRIBUTARIO: { por_confirmar: ["T1"], en_mi_area: ["T1", "T2"], afuera: ["D1", "D2", "D3"], plazos: ["D1", "D2", "D3"] },
};

describe("escenarios de la semilla de desarrollo", () => {
  it("crea un expediente por escenario, más el del reinicio, sin tocar los 30", async () => {
    expect(primera.escenarios.map((e) => e.clave)).toEqual(ESCENARIOS.map((e) => e.clave));
    expect(primera).toMatchObject({ creados: ESCENARIOS.length + 1, existentes: 0 });
    expect(new Set(primera.numeros).size).toBe(ESCENARIOS.length + 1);
    // Ningún escenario usa los comandos de los 30 (prisma/seed.ts siembra los 30 antes, así que quedan numerados después).
    const deLos30 = await prisma.movimiento.findMany({
      where: { tipo: "alta", comandoId: { in: Array.from({ length: 30 }, (_, i) => comandoFicticio(i + 1)) } },
      select: { expediente: { select: { numeroInterno: true } } },
    });
    for (const a of deLos30) expect(primera.numeros).not.toContain(a.expediente.numeroInterno);
  });

  it("cada escenario queda en su paso, estado y área", async () => {
    for (const [clave, esperado] of Object.entries(ESPERADO)) {
      const e = await prisma.expediente.findUniqueOrThrow({
        where: { numeroInterno: numero(clave) },
        include: { areaActual: { select: { codigo: true } }, areaResponsable: { select: { codigo: true } } },
      });
      expect({ clave, paso: e.pasoClave, estado: e.estado, area: e.areaActual.codigo, carga: e.cargaHistorica }).toEqual({
        clave,
        paso: esperado.paso,
        estado: esperado.estado,
        area: esperado.area,
        carga: false,
      });
      if (esperado.responsable) expect(e.areaResponsable.codigo).toBe(esperado.responsable);
      if (esperado.recibido !== undefined) expect({ clave, recibido: e.recibidoEn !== null }).toEqual({ clave, recibido: esperado.recibido });
    }
  });

  it("cada área tiene algo en cada pestaña que le corresponde", async () => {
    const numeros = new Map<string, string>(primera.escenarios.flatMap((e) => [[e.numero, e.clave] as const, ...e.extra.map((n) => [n, `${e.clave}+`] as const)]));
    for (const [area, pestanas] of Object.entries(BANDEJAS)) {
      const u = await usuario(prisma, area as CodigoUsuario);
      for (const [pestana, claves] of Object.entries(pestanas)) {
        const b = await exp.bandeja(u, pestana as PestanaBandeja);
        const vistos = b.filas.filter((f) => numeros.has(f.numero)).map((f) => numeros.get(f.numero));
        // Mesa de Entradas acumula lo de toda la batería; los escenarios son de los más viejos (van primero).
        if (!b.hayMas) expect({ area, pestana, vistos: vistos.sort() }).toEqual({ area, pestana, vistos: [...claves].sort() });
      }
    }
  });

  it("las filas dicen lo que muestran: devuelto, pase rápido, demoras y semáforo del plazo", async () => {
    const [liquidacion, computo, legal, tributario, mesa] = await Promise.all(
      (["LIQUIDACION", "COMPUTO", "LEGAL", "TRIBUTARIO", "MESA_ENTRADAS"] as const).map((a) => usuario(prisma, a)),
    );
    const fila = async (u: UsuarioPermisos, pestana: PestanaBandeja, clave: string) => {
      const f = (await exp.bandeja(u, pestana)).filas.find((x) => x.numero === numero(clave));
      if (!f) throw new Error(`${clave} no está en ${pestana}`);
      return f;
    };
    const devuelto = await fila(liquidacion, "en_mi_area", "L7");
    expect(devuelto.etiquetas).toContainEqual(
      expect.objectContaining({ tipo: "devuelto", porArea: "Asesoría Legal", motivo: expect.stringMatching(/^Error en boleta/) }),
    );
    expect((await fila(liquidacion, "en_mi_area", "L4")).paseRapido).toMatchObject({ clave: "LEGAL" });
    expect((await fila(liquidacion, "en_mi_area", "L6")).paseRapido).toMatchObject({ clave: "LEGAL" });
    expect((await fila(liquidacion, "en_mi_area", "L3")).paseRapido).toBeNull();
    expect((await fila(computo, "en_mi_area", "C3")).demorado).toBe(true);
    expect((await fila(legal, "en_mi_area", "G1")).demorado).toBe(true);
    expect((await fila(mesa, "por_confirmar", "M3")).etiquetas.map((x) => x.tipo)).toEqual(expect.arrayContaining(["devuelto", "sin_confirmar"]));
    const semaforo = async (clave: string) => {
      const p = (await fila(tributario, "plazos", clave)).etiquetas.find((x) => x.tipo === "plazo");
      return p && p.tipo === "plazo" ? p.semaforo : null;
    };
    expect([await semaforo("D1"), await semaforo("D2"), await semaforo("D3")]).toEqual(["en_termino", "por_vencer", "vencido"]);
  });

  it("el panel de Dirección tiene números en cada sección", async () => {
    const p = await exp.panel(await usuario(prisma, "DIRECCION"));
    for (const c of p.conteos) expect({ estado: c.estado, hay: c.cantidad > 0 }).toEqual({ estado: c.estado, hay: true });
    const nums = (filas: Array<{ numero: string }>) => filas.map((f) => f.numero);
    expect(nums(p.plazos.porVencer.filas)).toContain(numero("D2"));
    expect(nums(p.plazos.vencidos.filas)).toContain(numero("D3"));
    expect(nums(p.sinConfirmar.filas)).toEqual(expect.arrayContaining([numero("C1"), numero("M3")]));
    expect(nums(p.demorados.filas)).toEqual(expect.arrayContaining([numero("C3"), numero("G1")]));
    expect(nums(p.correcciones.filas)).toEqual(expect.arrayContaining([numero("C3"), numero("L6")]));
    expect(nums(p.diferidos.filas).some((n) => primera.numeros.includes(n))).toBe(true);
    const areasConCeldas = new Set(p.matriz.areas.map((a) => a.codigo));
    for (const a of ["MESA_ENTRADAS", "COMPUTO", "LIQUIDACION", "LEGAL", "ADMINISTRATIVO", "TRIBUTARIO", "DIM"]) expect(areasConCeldas).toContain(a);
    expect(p.matriz.tipos.map((t) => t.codigo).sort()).toEqual(["NUEVA_CONCESION", "RENOVACION", "RENOVACION_SPT"]);
  });

  it("la proyección de cada expediente coincide con la reconstrucción desde sus movimientos", async () => {
    for (const n of primera.numeros) {
      const c = await conciliacion(prisma, n);
      expect({ n, ...c.actual }).toEqual({ n, ...c.reconstruida });
    }
  });

  it("estados: concluidos, archivados con caja, anulado con motivo y reinicio enlazado", async () => {
    const estado = (clave: string) => prisma.expediente.findUniqueOrThrow({ where: { numeroInterno: numero(clave) } });
    expect(await estado("K3")).toMatchObject({ estado: "archivado", estadoPrevio: "concluido", ubicacionArchivo: expect.stringMatching(/Caja/) });
    expect(await estado("X1")).toMatchObject({ estado: "archivado", estadoPrevio: "en_tramite", ubicacionArchivo: expect.stringMatching(/Caja/) });
    const x1 = await estado("X1");
    const archivo = await prisma.movimiento.findFirstOrThrow({ where: { expedienteId: x1.id, tipo: "estado", estadoNuevo: "archivado" } });
    expect(archivo.motivo).toMatch(/desistió/);
    expect(archivo.datos).toMatchObject({ regreso_papel: expect.any(Object) });
    const y1 = await estado("Y1");
    const anulacion = await prisma.movimiento.findFirstOrThrow({ where: { expedienteId: y1.id, tipo: "estado", estadoNuevo: "anulado" } });
    expect(anulacion.motivo).toMatch(/duplicada/);
    const r1 = primera.escenarios.find((e) => e.clave === "R1");
    expect(r1?.extra).toHaveLength(1);
    const nuevo = await prisma.expediente.findUniqueOrThrow({
      where: { numeroInterno: r1?.extra[0] },
      include: { plantilla: { select: { codigo: true } }, expedienteAnterior: { select: { numeroInterno: true } } },
    });
    expect(nuevo).toMatchObject({ estado: "en_tramite", pasoClave: "MESA", plantilla: { codigo: "RENOV_PLAN" }, expedienteAnterior: { numeroInterno: numero("R1") } });
  });

  it("variedad: cementerios, plantillas, persona jurídica, solicitante, correcciones, notas, adjuntos y transcripción", async () => {
    const lista = await prisma.expediente.findMany({
      where: { numeroInterno: { in: primera.numeros } },
      include: { cementerio: { select: { codigo: true } }, plantilla: { select: { codigo: true } }, personas: true, movimientos: true },
    });
    expect(new Set(lista.map((e) => e.cementerio.codigo))).toEqual(new Set(["OESTE", "NORTE", "JARDIN_NORTE"]));
    expect(new Set(lista.map((e) => e.plantilla.codigo))).toEqual(new Set(["RENOV_CONTADO", "RENOV_PLAN", "RENOV_SPT_CONTADO", "NUEVA_CONC_CONTADO"]));
    const juridicas = lista.filter((e) => e.personas.some((p) => p.tipoPersona === "juridica"));
    expect(juridicas.length).toBeGreaterThanOrEqual(1);
    for (const e of juridicas) expect([e.cementerio.codigo, e.tipoMonumento]).toEqual(["OESTE", "PANTEON"]);
    expect(lista.filter((e) => e.personas.some((p) => p.rol === "solicitante")).length).toBeGreaterThanOrEqual(5);
    const tipos = lista.flatMap((e) => e.movimientos.map((m) => m.tipo));
    for (const t of ["recepcion", "subtarea", "documento", "pase", "devolucion", "estado", "correccion", "nota", "adjunto"]) expect(tipos).toContain(t);
    const transcriptos = lista.flatMap((e) => e.movimientos).filter((m) => m.cargaHistorica && m.tipo === "pase");
    expect(transcriptos.length).toBeGreaterThan(0);
    for (const m of transcriptos) expect(m.fuente).toBe(FUENTE_ESCENARIOS);
    // Cada acción la hizo el usuario del área (nadie actúa como SISTEMA ni como el admin).
    const autores = new Set(lista.flatMap((e) => e.movimientos.map((m) => m.usuarioId)));
    const operadores = await prisma.usuario.findMany({ where: { id: { in: [...autores] } }, select: { rol: true } });
    expect(new Set(operadores.map((u) => u.rol))).toEqual(new Set(["operador"]));
    // Los dos adjuntos quedaron en el almacén.
    const anios = await readdir(dir);
    expect(anios.filter((a) => a !== "tmp").length).toBeGreaterThan(0);
  });

  it("todas las personas son claramente ficticias", async () => {
    const personas = await prisma.expedientePersona.findMany({ where: { expediente: { numeroInterno: { in: primera.numeros } } } });
    for (const p of personas.filter((x) => x.tipoPersona === "fisica")) {
      // 9 dígitos: no existe un DNI así, y no choca con los de 8 dígitos de las pruebas.
      expect(p.dni ?? "").toMatch(/^9999\d{5}$/);
      expect(p.nombres).toMatch(/ Escenario$/);
      if (p.email) expect(p.email).toMatch(/@ejemplo\.test$/);
      if (p.telefono) expect(p.telefono).toMatch(/^0381 000-5\d{3}$/);
      if (p.domicilio) expect(p.domicilio).toMatch(/^Calle Ficticia /);
    }
    for (const p of personas.filter((x) => x.tipoPersona === "juridica")) {
      expect(p.razonSocial).toMatch(/Ficticia/);
      expect(p.cuit ?? "").toMatch(/^3099999\d{4}$/);
    }
  });

  it("es idempotente: la segunda corrida no crea ni mueve nada", async () => {
    const contar = () => prisma.movimiento.count({ where: { expediente: { numeroInterno: { in: primera.numeros } } } });
    const antes = await contar();
    const segunda = await sembrarEscenarios(prisma, { almacen: crearAlmacenEnDisco(dir) });
    expect(segunda).toEqual({ ...primera, creados: 0, existentes: primera.creados });
    expect(await contar()).toBe(antes);
  }, 300_000);
});
