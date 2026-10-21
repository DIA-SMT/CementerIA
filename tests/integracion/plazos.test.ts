// El plazo de 30 días hábiles de la DIM y los feriados (semana 4) contra la base
// real: docs/propuesta-mvp.md, 3.6 y 2.9. Vencimiento con f_sumar_dias_habiles,
// "faltan N", semáforo, vencimiento provisorio con el año sin cerrar, plazo
// cumplido, la pestaña Plazos y el ABM de feriados con "Cerrar año" (auditado).
//
// Los feriados y los años son configuración compartida por toda la batería:
// cada cambio se deshace al terminar el test.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ErrorDominio, type ServicioExpedientes } from "@/lib/dominio/expedientes";
import { PermisoDenegado, type UsuarioPermisos } from "@/lib/dominio/permisos";
import { diasEntre, hoyEnTucuman, inicioDelDiaEnTucuman, sumarDias, type FechaISO } from "@/lib/fechas";
import { asegurarSemilla, avanzar, comando, datosAlta, proyeccion, servicio, usuario } from "./dominio";
import { clientePrisma } from "./helper";

const prisma = clientePrisma();
const exp: ServicioExpedientes = servicio(prisma);
let mesa: UsuarioPermisos;
let tributario: UsuarioPermisos;
let legal: UsuarioPermisos;
let admin: UsuarioPermisos;
let numero: string;
const hoy = hoyEnTucuman();
const notificada = sumarDias(hoy, -2);

beforeAll(async () => {
  await asegurarSemilla(prisma);
  [mesa, tributario, legal, admin] = await Promise.all([
    usuario(prisma, "MESA_ENTRADAS"),
    usuario(prisma, "TRIBUTARIO"),
    usuario(prisma, "LEGAL"),
    usuario(prisma, "ADMIN"),
  ]);
  // Un expediente de (b) en la DIM, notificado hace 2 días.
  const alta = await exp.alta(mesa, await datosAlta(prisma, { plantilla: "RENOV_PLAN", fechaInicio: sumarDias(hoy, -20) }), comando());
  numero = alta.numero;
  for (let i = 0; i < 5; i++) await avanzar(exp, prisma, numero);
  await avanzar(exp, prisma, numero, { fecha: notificada });
});

afterAll(async () => prisma.$disconnect());

async function sql<T>(consulta: TemplateStringsArray, ...valores: unknown[]): Promise<T> {
  const [fila] = await prisma.$queryRaw<T[]>(consulta, ...valores);
  return fila;
}

async function venceSegunLaBase(): Promise<FechaISO> {
  return (await sql<{ v: string }>`SELECT public.f_sumar_dias_habiles(${notificada}::date, 30)::text AS v`).v;
}

async function errorDe(p: Promise<unknown>): Promise<ErrorDominio | PermisoDenegado> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ErrorDominio || e instanceof PermisoDenegado) return e;
    throw e;
  }
  throw new Error("se esperaba un error");
}

/** Un día hábil sin feriado entre mañana y el vencimiento. */
async function diaHabilLibre(hasta: FechaISO): Promise<FechaISO> {
  for (let d = sumarDias(hoy, 1); d < hasta; d = sumarDias(d, 1)) {
    const dow = new Date(`${d}T12:00:00Z`).getUTCDay();
    if (dow === 0 || dow === 6) continue;
    const f = await prisma.feriado.findUnique({ where: { fecha: new Date(`${d}T00:00:00Z`) } });
    if (!f) return d;
  }
  throw new Error("no hay un día hábil libre");
}

describe("vencimiento y semáforo (3.6)", () => {
  it("vence a los 30 días hábiles de la notificación, con 'faltan N' y provisorio con el año sin cerrar", async () => {
    const vence = await venceSegunLaBase();
    const faltan = (await sql<{ n: number }>`SELECT public.f_dias_habiles_entre(${hoy}::date, ${vence}::date) AS n`).n;
    const f = await exp.obtenerFicha(tributario, numero);
    expect(f.plazo).toMatchObject({ desde: notificada, diasHabiles: 30, cumplidoEn: null, vence, faltan, semaforo: "en_termino", provisorio: true });
    expect(f.plazo?.aniosSinCerrar).toContain(Number(vence.slice(0, 4)));
    expect(f.plazo?.texto).toMatch(/^vence \d\d\/\d\d · faltan \d+ días hábiles \(provisorio\)$/);
    // Saltea fines de semana y feriados: más de 30 días corridos.
    expect(diasEntre(notificada, vence)).toBeGreaterThan(30);
  });

  it("cerrar los años del plazo lo vuelve definitivo; reabrir, provisorio otra vez (auditado)", async () => {
    const vence = await venceSegunLaBase();
    const anios = [...new Set([Number(notificada.slice(0, 4)), Number(vence.slice(0, 4))])];
    const yaCerrados = new Set((await prisma.feriadoAnio.findMany({ where: { anio: { in: anios }, cerrado: true } })).map((a) => a.anio));
    const cerrar = anios.filter((a) => !yaCerrados.has(a));
    try {
      expect(await errorDe(exp.cerrarAnioFeriados(mesa, cerrar[0] ?? anios[0]))).toMatchObject({ motivo: "solo_admin" });
      for (const a of cerrar) {
        const r = await exp.cerrarAnioFeriados(admin, a, "Feriados verificados con el Boletín Oficial");
        expect(r).toMatchObject({ anio: a, cerrado: true, cerradoPor: { id: admin.id } });
        const aud = await prisma.auditoriaCambio.findFirst({ where: { tabla: "feriados_anios", registroId: String(a) }, orderBy: { id: "desc" } });
        expect(aud).toMatchObject({ operacion: "U", usuarioId: admin.id, motivo: "Feriados verificados con el Boletín Oficial" });
      }
      if (cerrar[0] !== undefined) expect(await errorDe(exp.cerrarAnioFeriados(admin, cerrar[0]))).toMatchObject({ codigo: "sin_cambios" });
      const f = await exp.obtenerFicha(tributario, numero);
      expect(f.plazo).toMatchObject({ provisorio: false, aniosSinCerrar: [] });
      expect(f.plazo?.texto).not.toMatch(/provisorio/);
      const fila = (await exp.bandeja(tributario, "plazos")).filas.find((x) => x.numero === numero);
      expect(fila?.etiquetas).toContainEqual(expect.objectContaining({ tipo: "plazo", provisorio: false }));
    } finally {
      for (const a of cerrar) await exp.reabrirAnioFeriados(admin, a, "Se deshace el cierre del test de integración");
    }
    expect(await errorDe(exp.reabrirAnioFeriados(admin, anios[0], null))).toMatchObject({ codigo: "motivo_requerido" });
    expect((await exp.obtenerFicha(tributario, numero)).plazo?.provisorio).toBe(true);
  });

  it("un asueto cargado después corre el vencimiento solo; quitarlo lo devuelve", async () => {
    const antes = await venceSegunLaBase();
    const dia = await diaHabilLibre(antes);
    expect(await errorDe(exp.guardarFeriado(legal, { fecha: dia, descripcion: "Asueto", ambito: "asueto" }))).toMatchObject({ motivo: "solo_admin" });
    expect(await errorDe(exp.guardarFeriado(admin, { fecha: dia, descripcion: "", ambito: "otro" }))).toMatchObject({ codigo: "validacion" });
    try {
      const g = await exp.guardarFeriado(admin, { fecha: dia, descripcion: "Asueto administrativo (prueba)", ambito: "asueto", norma: "Decreto ficticio 1/2026" }, "Decretado hoy");
      expect(g).toMatchObject({ creado: true, feriado: { fecha: dia, ambito: "asueto" } });
      expect(await errorDe(exp.guardarFeriado(admin, { fecha: dia, descripcion: "Asueto administrativo (prueba)", ambito: "asueto", norma: "Decreto ficticio 1/2026" }))).toMatchObject({
        codigo: "sin_cambios",
      });
      const modificado = await exp.guardarFeriado(admin, { fecha: dia, descripcion: "Asueto administrativo (prueba, corregido)", ambito: "asueto" });
      expect(modificado.creado).toBe(false);
      const despues = await venceSegunLaBase();
      expect(despues > antes).toBe(true);
      expect((await exp.obtenerFicha(tributario, numero)).plazo?.vence).toBe(despues);
      expect((await exp.listarFeriados(Number(dia.slice(0, 4)))).feriados).toContainEqual(expect.objectContaining({ fecha: dia, ambito: "asueto" }));
      const aud = await prisma.auditoriaCambio.findFirst({ where: { tabla: "feriados", operacion: "I" }, orderBy: { id: "desc" } });
      expect(aud).toMatchObject({ usuarioId: admin.id, motivo: "Decretado hoy" });
    } finally {
      await exp.quitarFeriado(admin, dia, "Se deshace el asueto del test de integración");
    }
    expect(await venceSegunLaBase()).toBe(antes);
    expect(await errorDe(exp.quitarFeriado(admin, dia))).toMatchObject({ codigo: "no_encontrado" });
  });

  it("ámbar con 5 días hábiles o menos y rojo vencido (con el reloj adelantado); la bandeja y el panel lo muestran", async () => {
    const vence = await venceSegunLaBase();
    const elDia = servicio(prisma, () => new Date(inicioDelDiaEnTucuman(vence).getTime() + 12 * 60 * 60 * 1000));
    const f = await elDia.obtenerFicha(tributario, numero);
    expect(f.plazo).toMatchObject({ faltan: 0, semaforo: "por_vencer" });
    expect(f.situaciones).toContain("plazo_por_vencer");
    const fila = (await elDia.bandeja(tributario, "plazos")).filas.find((x) => x.numero === numero);
    expect(fila?.etiquetas).toContainEqual(expect.objectContaining({ tipo: "plazo", semaforo: "por_vencer", faltan: 0 }));
    expect((await elDia.contadoresBandeja(tributario)).plazosAlerta).toBeGreaterThanOrEqual(1);
    expect((await elDia.panel(admin)).plazos.porVencer.filas.map((x) => x.numero)).toContain(numero);

    const despues = servicio(prisma, () => new Date(inicioDelDiaEnTucuman(sumarDias(vence, 10)).getTime() + 12 * 60 * 60 * 1000));
    const g = await despues.obtenerFicha(tributario, numero);
    expect(g.plazo?.semaforo).toBe("vencido");
    expect(g.plazo?.faltan).toBeLessThan(0);
    expect(g.situaciones).toContain("plazo_vencido");
    expect((await despues.panel(admin)).plazos.vencidos.filas.map((x) => x.numero)).toContain(numero);
    // Al vencer no cambia nada solo (3.6): sigue en espera de pago en la DIM.
    expect((await proyeccion(prisma, numero)).estado).toBe("espera_pago_dim");
  });

  it("la pestaña Plazos: la custodia lo trabaja; Mesa de Entradas lo consulta; las demás áreas no lo ven", async () => {
    const t = await exp.bandeja(tributario, "plazos");
    expect(t.filas.find((x) => x.numero === numero)).toMatchObject({ soloConsulta: false, paso: { clave: "DIM" } });
    const m = await exp.bandeja(mesa, "plazos");
    expect(m.filas.find((x) => x.numero === numero)).toMatchObject({ soloConsulta: true });
    expect((await exp.bandeja(legal, "plazos")).filas.map((x) => x.numero)).not.toContain(numero);
  });

  it("tildar DIM_PLAN_INICIADO cumple el plazo y apaga la alerta", async () => {
    const e = await proyeccion(prisma, numero);
    await exp.tildarSubtarea(tributario, numero, "DIM_PLAN_INICIADO", hoy, e.version, comando());
    const vence = await venceSegunLaBase();
    const despues = servicio(prisma, () => new Date(inicioDelDiaEnTucuman(sumarDias(vence, 10)).getTime() + 12 * 60 * 60 * 1000));
    const f = await despues.obtenerFicha(tributario, numero);
    expect(f.plazo).toMatchObject({ cumplidoEn: hoy, semaforo: "cumplido" });
    expect(f.plazo?.texto).toMatch(/cumplido/);
    expect(f.situaciones).not.toContain("plazo_vencido");
    expect((await despues.panel(admin)).plazos.vencidos.filas.map((x) => x.numero)).not.toContain(numero);
  });
});

describe("feriados: lectura y validaciones", () => {
  it("lista un año con su estado y rechaza fechas y años inválidos", async () => {
    const anio = Number(hoy.slice(0, 4));
    const l = await exp.listarFeriados(anio);
    expect(l.anio).toBe(anio);
    expect(l.feriados.length).toBeGreaterThan(5);
    expect(l.feriados.every((f) => f.fecha.startsWith(String(anio)))).toBe(true);
    expect((await exp.aniosDeFeriados()).map((a) => a.anio)).toContain(anio);
    expect(await errorDe(exp.listarFeriados(1800))).toMatchObject({ codigo: "validacion" });
    expect(await errorDe(exp.quitarFeriado(admin, "2026-02-30"))).toMatchObject({ codigo: "validacion" });
  });
});
