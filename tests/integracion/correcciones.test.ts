// Correcciones de errores de carga (src/lib/dominio/expedientes/correcciones.ts)
// contra la base real: docs/propuesta-mvp.md, 2.13(b), tabla "Cómo se corrige
// cada error de carga". Cada corrección agrega un movimiento `correccion` con
// motivo; revertir deja la proyección IDÉNTICA a la que había antes del
// movimiento revertido (se compara con la foto tomada antes), y después de cada
// corrección la proyección coincide con la reconstrucción desde el historial.

import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearAlmacenEnDisco } from "@/lib/adjuntos/almacen";
import { ErrorDominio, type ServicioExpedientes } from "@/lib/dominio/expedientes";
import { leerItems } from "@/lib/dominio/expedientes/items";
import { PermisoDenegado, type UsuarioPermisos } from "@/lib/dominio/permisos";
import { hoyEnTucuman, inicioDelDiaEnTucuman, sumarDias } from "@/lib/fechas";
import {
  asegurarSemilla,
  avanzar,
  comando,
  completarPaso,
  conciliacion,
  datosAlta,
  flujo,
  movimientos,
  proyeccion,
  servicio,
  usuario,
} from "./dominio";
import { clientePrisma } from "./helper";

const prisma = clientePrisma();
let raiz: string;
let exp: ServicioExpedientes;
let mesa: UsuarioPermisos;
let computo: UsuarioPermisos;
let liquidacion: UsuarioPermisos;
let tributario: UsuarioPermisos;
let legal: UsuarioPermisos;
let admin: UsuarioPermisos;

const PDF = new TextEncoder().encode("%PDF-1.4\n% documento ficticio de prueba\n%%EOF\n");

function flujoDe(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(bytes);
      c.close();
    },
  });
}

beforeAll(async () => {
  await asegurarSemilla(prisma);
  raiz = await mkdtemp(join(tmpdir(), "cementeria-correcciones-"));
  exp = servicio(prisma, undefined, crearAlmacenEnDisco(raiz));
  [mesa, computo, liquidacion, tributario, legal, admin] = await Promise.all([
    usuario(prisma, "MESA_ENTRADAS"),
    usuario(prisma, "COMPUTO"),
    usuario(prisma, "LIQUIDACION"),
    usuario(prisma, "TRIBUTARIO"),
    usuario(prisma, "LEGAL"),
    usuario(prisma, "ADMIN"),
  ]);
});

afterAll(async () => {
  await prisma.$disconnect();
  await rm(raiz, { recursive: true, force: true });
});

async function errorDe(p: Promise<unknown>): Promise<ErrorDominio | PermisoDenegado> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ErrorDominio || e instanceof PermisoDenegado) return e;
    throw e;
  }
  throw new Error("se esperaba un error");
}

async function conciliar(numero: string): Promise<void> {
  const c = await conciliacion(prisma, numero);
  expect(c.actual).toEqual(c.reconstruida);
}

async function ultimo(numero: string) {
  const m = (await movimientos(prisma, numero)).at(-1);
  if (!m) throw new Error("sin movimientos");
  return m;
}

describe("revertir (el último movimiento que cambió el expediente)", () => {
  it("un pase, con la recepción implícita que lo precedió y la recepción y la nota posteriores: la proyección vuelve a la de antes", async () => {
    const alta = await exp.alta(mesa, await datosAlta(prisma), comando());
    await avanzar(exp, prisma, alta.numero); // a Cómputo, sin confirmar
    const version = await completarPaso(exp, prisma, alta.numero); // la recepción implícita de Cómputo
    const antes = await flujo(prisma, alta.numero);
    const busquedaAntes = (await proyeccion(prisma, alta.numero)).busqueda;

    const pase = await exp.darPase(computo, alta.numero, "LIQUIDACION", version, comando());
    const recibido = await exp.confirmarRecepcion(liquidacion, alta.numero, pase.version, comando());
    const nota = await exp.agregarNota(liquidacion, alta.numero, "Llegó sin la constancia", recibido.version, comando());

    // Solo el autor (o el admin), solo el último.
    expect(await errorDe(exp.revertir(liquidacion, alta.numero, pase.movimientoId, "Pase dado por error", nota.version, comando()))).toMatchObject({
      motivo: "no_es_autor",
    });
    expect(await errorDe(exp.revertir(computo, alta.numero, pase.movimientoId, "corto", nota.version, comando()))).toMatchObject({ codigo: "motivo_requerido" });
    const anterior = (await movimientos(prisma, alta.numero)).find((m) => m.tipo === "pase");
    expect(await errorDe(exp.revertir(mesa, alta.numero, String(anterior?.id), "No es el último pase", nota.version, comando()))).toMatchObject({
      codigo: "estado_no_admite",
    });
    // La ficha lo ofrece al autor.
    const ficha = await exp.obtenerFicha(computo, alta.numero);
    expect(ficha.historial.find((h) => h.id === pase.movimientoId)?.correcciones).toContain("revertir");
    expect(ficha.acciones.corregir).toBe(true);

    const r = await exp.revertir(computo, alta.numero, pase.movimientoId, "Pase dado por error: faltaba la constancia", nota.version, comando());
    expect(r.arrastrados).toEqual([recibido.movimientoId, nota.movimientoId]);
    expect(await ultimo(alta.numero)).toMatchObject({
      tipo: "correccion",
      corrigeMovimientoId: BigInt(pase.movimientoId),
      motivo: "Pase dado por error: faltaba la constancia",
      datos: { revertir: true, arrastra: [recibido.movimientoId, nota.movimientoId] },
    });
    expect(await flujo(prisma, alta.numero)).toEqual(antes);
    expect((await proyeccion(prisma, alta.numero)).busqueda).toBe(busquedaAntes);
    await conciliar(alta.numero);

    // La línea de tiempo lo muestra revertido, y Cómputo puede volver a dar el pase.
    const f = await exp.obtenerFicha(computo, alta.numero);
    expect(f.historial.filter((h) => h.revertido).map((h) => h.id)).toEqual([pase.movimientoId, recibido.movimientoId, nota.movimientoId]);
    expect(f.historial.find((h) => h.id === pase.movimientoId)?.corregidoPor).toEqual([r.movimientoId]);
    expect(f.pase.faltan).toEqual([]);
    await exp.darPase(computo, alta.numero, "LIQUIDACION", r.version, comando());
    await conciliar(alta.numero);
  });

  it("una devolución: vuelven las subtareas reiniciadas y el paso de retorno", async () => {
    const alta = await exp.alta(mesa, await datosAlta(prisma), comando());
    for (let i = 0; i < 3; i++) await avanzar(exp, prisma, alta.numero); // en Legal
    const v = await completarPaso(exp, prisma, alta.numero);
    const antes = await flujo(prisma, alta.numero);
    const d = await exp.devolver(legal, alta.numero, "LIQUIDACION", "Error en boleta: falta el arrendamiento", ["LIQ_BOLETA"], v, comando());
    expect(leerItems((await proyeccion(prisma, alta.numero)).items).subtareas.LIQ_BOLETA?.hecha).toBe(false);
    await exp.revertir(legal, alta.numero, d.movimientoId, "La devolución era de otro expediente", d.version, comando());
    expect(await flujo(prisma, alta.numero)).toEqual(antes);
    await conciliar(alta.numero);
  });

  it("concluir y archivar: se revierten en orden; un movimiento posterior que cambia el expediente lo impide", async () => {
    const alta = await exp.alta(mesa, await datosAlta(prisma), comando());
    for (let i = 0; i < 6; i++) await avanzar(exp, prisma, alta.numero);
    const administrativo = await usuario(prisma, "ADMINISTRATIVO");
    const t = await exp.tildarSubtarea(administrativo, alta.numero, "ADM_ENTREGADO", hoyEnTucuman(), (await proyeccion(prisma, alta.numero)).version, comando());
    const enCurso = await flujo(prisma, alta.numero);
    const c = await exp.concluir(administrativo, alta.numero, t.version, comando());
    const concluido = await flujo(prisma, alta.numero);
    const a = await exp.archivar(administrativo, alta.numero, "Caja 3", c.version, comando());
    // Archivado: solo el admin corrige.
    expect(await errorDe(exp.revertir(administrativo, alta.numero, a.movimientoId, "Archivado por error", a.version, comando()))).toMatchObject({
      motivo: "estado_no_admite",
    });
    const r1 = await exp.revertir(admin, alta.numero, a.movimientoId, "Archivado por error", a.version, comando());
    expect(await flujo(prisma, alta.numero)).toEqual(concluido);
    // Un documento marcado después del concluir tapa la reversión.
    const doc = await exp.marcarDocumento(administrativo, alta.numero, "INFORME_TECNICO", "pendiente", null, r1.version, comando());
    expect(await errorDe(exp.revertir(administrativo, alta.numero, c.movimientoId, "Concluido por error", doc.version, comando()))).toMatchObject({
      codigo: "estado_no_admite",
    });
    const alta2 = await exp.alta(mesa, await datosAlta(prisma), comando());
    for (let i = 0; i < 6; i++) await avanzar(exp, prisma, alta2.numero);
    const t2 = await exp.tildarSubtarea(administrativo, alta2.numero, "ADM_ENTREGADO", hoyEnTucuman(), (await proyeccion(prisma, alta2.numero)).version, comando());
    const antes2 = await flujo(prisma, alta2.numero);
    const c2 = await exp.concluir(administrativo, alta2.numero, t2.version, comando());
    await exp.revertir(administrativo, alta2.numero, c2.movimientoId, "Se concluyó antes de entregar", c2.version, comando());
    expect(await flujo(prisma, alta2.numero)).toEqual(antes2);
    expect(enCurso.estado).toBe("en_tramite");
    await conciliar(alta.numero);
    await conciliar(alta2.numero);
  });

  it("una subtarea del paso actual; el autor pasados 7 días ya no puede", async () => {
    const alta = await exp.alta(mesa, await datosAlta(prisma), comando());
    await avanzar(exp, prisma, alta.numero);
    const antes = await flujo(prisma, alta.numero);
    const s = await exp.tildarSubtarea(computo, alta.numero, "COMP_GRABADO", "R-1", (await proyeccion(prisma, alta.numero)).version, comando());
    const despues = await flujo(prisma, alta.numero);
    const enOchoDias = servicio(prisma, () => new Date(Date.now() + 8 * 24 * 60 * 60 * 1000));
    expect(await errorDe(enOchoDias.revertir(computo, alta.numero, s.movimientoId, "Tilde equivocado", s.version, comando()))).toMatchObject({
      motivo: "plazo_vencido",
    });
    expect(despues).not.toEqual(antes);
    await exp.revertir(computo, alta.numero, s.movimientoId, "Tilde equivocado", s.version, comando());
    // Incluida la recepción implícita que insertó el tilde.
    expect(await flujo(prisma, alta.numero)).toEqual(antes);
    await conciliar(alta.numero);
  });
});

describe("corregir la fecha o la observación de un movimiento", () => {
  it("la fecha de un pase: mueve en_area_desde, sin pasar al anterior ni al siguiente", async () => {
    const hoy = hoyEnTucuman();
    const alta = await exp.alta(mesa, await datosAlta(prisma, { fechaInicio: sumarDias(hoy, -10) }), comando());
    const v = await completarPaso(exp, prisma, alta.numero);
    const pase = await exp.darPase(mesa, alta.numero, "COMPUTO_ALTA", v, comando(), { fechaEfectiva: sumarDias(hoy, -5), observacion: "Con carátula" });
    expect(await errorDe(exp.corregirFecha(mesa, alta.numero, pase.movimientoId, sumarDias(hoy, -11), "La fecha era otra", pase.version, comando()))).toMatchObject({
      codigo: "validacion",
    });
    const r = await exp.corregirFecha(mesa, alta.numero, pase.movimientoId, sumarDias(hoy, -3), "Salió el miércoles, no el lunes", pase.version, comando());
    expect((await proyeccion(prisma, alta.numero)).enAreaDesde).toEqual(inicioDelDiaEnTucuman(sumarDias(hoy, -3)));
    expect(await ultimo(alta.numero)).toMatchObject({ tipo: "correccion", datos: { precision: ["dia", "dia"] } });
    // "En el área desde" toma la precisión de la fecha corregida (sin "00:00").
    expect((await exp.obtenerFicha(mesa, alta.numero)).enAreaDesdePrecision).toBe("dia");
    // Una recepción posterior no puede quedar antes de la fecha corregida.
    const rec = await exp.confirmarRecepcion(computo, alta.numero, r.version, comando(), { fechaEfectiva: sumarDias(hoy, -2) });
    expect(await errorDe(exp.corregirFecha(mesa, alta.numero, pase.movimientoId, sumarDias(hoy, -1), "La fecha era otra", rec.version, comando()))).toMatchObject({
      codigo: "validacion",
    });
    const f = await exp.obtenerFicha(mesa, alta.numero);
    const h = f.historial.find((x) => x.id === pase.movimientoId);
    expect(h?.fechaCorregida).toEqual({ fechaEfectiva: inicioDelDiaEnTucuman(sumarDias(hoy, -3)), precisionFecha: "dia" });
    expect(h?.corregidoPor).toEqual([r.movimientoId]);

    // La observación.
    const o = await exp.corregirObservacion(mesa, alta.numero, pase.movimientoId, "Con carátula y constancia", "Faltaba la constancia en la nota", rec.version, comando());
    expect(await errorDe(exp.corregirObservacion(mesa, alta.numero, pase.movimientoId, "Con carátula y constancia", "Otra vez lo mismo", o.version, comando()))).toMatchObject({
      codigo: "sin_cambios",
    });
    const f2 = await exp.obtenerFicha(mesa, alta.numero);
    expect(f2.historial.find((x) => x.id === pase.movimientoId)).toMatchObject({
      observacion: "Con carátula",
      observacionCorregida: { valor: "Con carátula y constancia" },
    });
    // El alta no se corrige por fecha (es la de inicio).
    const altaMov = (await movimientos(prisma, alta.numero))[0];
    expect(await errorDe(exp.corregirFecha(admin, alta.numero, String(altaMov.id), hoy, "La fecha era otra", o.version, comando()))).toMatchObject({
      codigo: "estado_no_admite",
    });
    await conciliar(alta.numero);
  });
});

describe("corregir una subtarea de un paso cerrado", () => {
  it("el dato de la notificación con el expediente en la DIM mueve el plazo; el tilde se puede sacar", async () => {
    const hoy = hoyEnTucuman();
    const alta = await exp.alta(mesa, await datosAlta(prisma, { plantilla: "RENOV_PLAN", fechaInicio: sumarDias(hoy, -20) }), comando());
    for (let i = 0; i < 5; i++) await avanzar(exp, prisma, alta.numero);
    await avanzar(exp, prisma, alta.numero, { fecha: sumarDias(hoy, -2) }); // TRIBUTARIO → DIM, notificada hace 2 días
    expect((await proyeccion(prisma, alta.numero)).pasoClave).toBe("DIM");
    const e = await proyeccion(prisma, alta.numero);
    // Del paso actual no: se tilda desde el paso.
    expect(await errorDe(exp.corregirSubtarea(tributario, alta.numero, "DIM_PLAN_INICIADO", { dato: hoy }, "Fecha equivocada", e.version, comando()))).toMatchObject({
      codigo: "estado_no_admite",
    });
    // Otra área no es la autora del tilde.
    expect(await errorDe(exp.corregirSubtarea(legal, alta.numero, "TRIB_NOTIFICADA", { dato: hoy }, "Fecha equivocada", e.version, comando()))).toMatchObject({
      motivo: "no_es_autor",
    });
    const r = await exp.corregirSubtarea(tributario, alta.numero, "TRIB_NOTIFICADA", { dato: sumarDias(hoy, -1) }, "Se notificó un día después", e.version, comando());
    const p = await proyeccion(prisma, alta.numero);
    expect(p.plazoDesde?.toISOString().slice(0, 10)).toBe(sumarDias(hoy, -1));
    expect(leerItems(p.items).subtareas.TRIB_NOTIFICADA).toMatchObject({ hecha: true, dato: sumarDias(hoy, -1), mov: Number(r.movimientoId) });
    expect(await ultimo(alta.numero)).toMatchObject({ datos: { subtarea: "TRIB_NOTIFICADA", dato: [sumarDias(hoy, -2), sumarDias(hoy, -1)] } });
    // Sacar el tilde (el autor ahora es la corrección, del mismo usuario).
    await exp.corregirSubtarea(tributario, alta.numero, "TRIB_NOTIFICADA", { hecha: false }, "No se había notificado todavía", r.version, comando());
    const q = await proyeccion(prisma, alta.numero);
    expect(q.plazoDesde).toBeNull();
    expect(leerItems(q.items).subtareas.TRIB_NOTIFICADA?.hecha).toBe(false);
    await conciliar(alta.numero);
  });
});

describe("adjuntos: retirar y purgar", () => {
  it("retirar: deja de verse y el archivo queda; purgar (admin): borra el archivo y deja nombre, tamaño y sha256", async () => {
    const alta = await exp.alta(mesa, await datosAlta(prisma), comando());
    const a = await exp.subirAdjunto(mesa, alta.numero, flujoDe(PDF), { nombre: "informe-equivocado.pdf", documento: "INFORME_TECNICO" }, 0, comando());
    const movAdj = (await movimientos(prisma, alta.numero)).find((m) => m.tipo === "adjunto");
    const ruta = join(raiz, ...String((movAdj?.datos as { ruta: string }).ruta).split("/"));
    await access(ruta);

    expect(await errorDe(exp.retirarAdjunto(computo, alta.numero, a.movimientoId, "No es de este expediente", a.version, comando()))).toMatchObject({
      motivo: "no_es_autor",
    });
    const r = await exp.retirarAdjunto(mesa, alta.numero, a.movimientoId, "No es de este expediente", a.version, comando());
    expect(leerItems((await proyeccion(prisma, alta.numero)).items).adjuntos[a.movimientoId]).toEqual({ documento: "INFORME_TECNICO", vigente: false, purgado: false });
    await access(ruta); // se conserva
    expect(await errorDe(exp.leerAdjunto(mesa, a.movimientoId))).toMatchObject({ codigo: "no_encontrado" });
    expect((await exp.obtenerFicha(mesa, alta.numero)).cantidadAdjuntos).toBe(0);

    // La purga: solo el admin, con motivo; el archivo se borra del disco.
    expect(await errorDe(exp.purgarAdjunto(mesa, alta.numero, a.movimientoId, "Datos de un tercero", r.version, comando()))).toMatchObject({
      motivo: "solo_admin",
    });
    await exp.purgarAdjunto(admin, alta.numero, a.movimientoId, "Datos de un tercero cargados por error (Ley 25.326)", r.version, comando());
    await expect(access(ruta)).rejects.toThrow();
    expect(leerItems((await proyeccion(prisma, alta.numero)).items).adjuntos[a.movimientoId]).toMatchObject({ vigente: false, purgado: true });
    expect((await prisma.movimiento.findUniqueOrThrow({ where: { id: BigInt(a.movimientoId) } })).datos).toMatchObject({
      nombre: "informe-equivocado.pdf",
      bytes: PDF.byteLength,
      sha256: a.sha256,
    });
    expect(await ultimo(alta.numero)).toMatchObject({ datos: { retirar_adjunto: a.movimientoId, purgar: true } });
    await conciliar(alta.numero);
  });

  it("el autor retira su adjunto también con el expediente anulado", async () => {
    const alta = await exp.alta(mesa, await datosAlta(prisma), comando());
    const a = await exp.subirAdjunto(mesa, alta.numero, flujoDe(PDF), { nombre: "x.pdf", documento: null }, 0, comando());
    const n = await exp.anular(mesa, alta.numero, "Cargado dos veces por error", a.version, comando());
    const r = await exp.retirarAdjunto(mesa, alta.numero, a.movimientoId, "Era de otro expediente", n.version, comando());
    expect(r.repetido).toBe(false);
    await conciliar(alta.numero);
  });
});

describe("suprimir persona (Ley 25.326)", () => {
  it("solo el admin, con motivo: quedan el rol y la constancia, y la búsqueda ya no la encuentra", async () => {
    const datos = await datosAlta(prisma);
    const dni = datos.personas[0].dni ?? "";
    const alta = await exp.alta(mesa, datos, comando());
    const persona = await prisma.expedientePersona.findFirstOrThrow({ where: { expediente: { numeroInterno: alta.numero } } });
    expect((await exp.buscar(mesa, { q: dni })).resultados.map((r) => r.numero)).toContain(alta.numero);

    expect(await errorDe(exp.suprimirPersona(mesa, alta.numero, persona.id.toString(), "Tercero cargado por error", 0, comando()))).toMatchObject({
      motivo: "solo_admin",
    });
    expect(await errorDe(exp.suprimirPersona(admin, alta.numero, persona.id.toString(), null, 0, comando()))).toMatchObject({ codigo: "motivo_requerido" });
    const r = await exp.suprimirPersona(admin, alta.numero, persona.id.toString(), "Tercero cargado por error (Ley 25.326)", 0, comando());
    expect(r.corrigeMovimientoId).toBe(persona.creadaMovId.toString());
    const p = await prisma.expedientePersona.findUniqueOrThrow({ where: { id: persona.id } });
    expect(p).toMatchObject({ apellido: null, nombres: null, dni: null, telefono: null, email: null, domicilio: null, rol: "titular" });
    expect(p.suprimidaEn).not.toBeNull();
    expect((await exp.buscar(mesa, { q: dni })).resultados.map((x) => x.numero)).not.toContain(alta.numero);
    expect((await exp.obtenerFicha(mesa, alta.numero)).personas[0]).toMatchObject({ suprimida: true, dni: null });
    expect(await errorDe(exp.suprimirPersona(admin, alta.numero, persona.id.toString(), "Otra vez la misma", r.version, comando()))).toMatchObject({
      codigo: "sin_cambios",
    });
    await conciliar(alta.numero);
  });
});
