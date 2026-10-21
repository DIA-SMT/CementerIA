// Pantallas de la semana 4 contra la base real: la lógica de las Server
// Actions de estados, reinicio, "archivar y abrir vinculado", correcciones y
// transcripción (src/lib/presentacion/acciones-estados.ts) con la entrada que
// arman los diálogos y la grilla, y el Route Handler del CSV
// (src/lib/presentacion/exportar-http.ts) con un Request de verdad. Los
// route.ts y las acciones de src/app/(app)/expedientes/acciones.ts solo
// agregan la sesión, refresh() y redirect().

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ServicioExpedientes } from "@/lib/dominio/expedientes";
import type { UsuarioPermisos } from "@/lib/dominio/permisos";
import { hoyEnTucuman, sumarDias } from "@/lib/fechas";
import { procesarCorreccion, procesarEstado, procesarNota, procesarReinicio, procesarTerminarCarga, procesarTranscripcion, procesarVinculado } from "@/lib/presentacion/acciones-estados";
import { procesarPase } from "@/lib/presentacion/acciones";
import { responderExportacion } from "@/lib/presentacion/exportar-http";
import { datosAltaDesde, valoresDesdePrecarga } from "@/lib/presentacion/formulario";
import { erroresDeGrilla, filaNueva, loteParaEnviar, recorrerFilas, type FilaGrilla } from "@/lib/presentacion/transcripcion";
import { asegurarSemilla, avanzar, comando, conciliacion, datosAlta, hastaElUltimoPaso, idPlantilla, proyeccion, servicio, titular, usuario } from "./dominio";
import { clientePrisma } from "./helper";

const prisma = clientePrisma();
const exp: ServicioExpedientes = servicio(prisma);
let mesa: UsuarioPermisos;
let administrativo: UsuarioPermisos;
let direccion: UsuarioPermisos;
const BASE = "http://localhost:3000";

beforeAll(async () => {
  await asegurarSemilla(prisma);
  [mesa, administrativo, direccion] = await Promise.all([usuario(prisma, "MESA_ENTRADAS"), usuario(prisma, "ADMINISTRATIVO"), usuario(prisma, "DIRECCION")]);
});

afterAll(async () => prisma.$disconnect());

async function version(numero: string): Promise<number> {
  return (await proyeccion(prisma, numero)).version;
}

async function conciliar(numero: string): Promise<void> {
  const c = await conciliacion(prisma, numero);
  expect(c.actual).toEqual(c.reconstruida);
}

describe("estados desde los diálogos de la ficha", () => {
  it("concluir con 'Faltan N', archivar con la caja y desarchivar con motivo", async () => {
    const alta = await exp.alta(mesa, await datosAlta(prisma, { fechaInicio: sumarDias(hoyEnTucuman(), -10) }), comando());
    await hastaElUltimoPaso(exp, prisma, alta.numero);
    const numero = alta.numero;

    const falta = await procesarEstado(exp, administrativo, { accion: "concluir", numero, versionVista: await version(numero), comandoId: comando(), fechaEfectiva: "" });
    expect(falta).toMatchObject({ ok: false, codigo: "faltan_requisitos", errores: [{ ruta: "subtareas.ADM_ENTREGADO" }] });

    const t = await exp.tildarSubtarea(administrativo, numero, "ADM_ENTREGADO", hoyEnTucuman(), await version(numero), comando());
    const c = await procesarEstado(exp, administrativo, { accion: "concluir", numero, versionVista: t.version, comandoId: comando(), observacion: "Entregado" });
    expect(c).toMatchObject({ ok: true, version: t.version + 1, mensaje: "Expediente concluido. Ya se puede archivar." });
    if (!c.ok) return;

    const sinCaja = await procesarEstado(exp, mesa, { accion: "archivar", numero, versionVista: c.version, comandoId: comando(), ubicacionArchivo: "  " });
    expect(sinCaja).toMatchObject({ ok: false, codigo: "validacion", errores: [{ ruta: "ubicacionArchivo" }] });
    const a = await procesarEstado(exp, mesa, { accion: "archivar", numero, versionVista: c.version, comandoId: comando(), ubicacionArchivo: "Caja 12" });
    expect(a).toMatchObject({ ok: true, mensaje: "Expediente archivado (Caja 12)." });
    if (!a.ok) return;

    const corto = await procesarEstado(exp, mesa, { accion: "desarchivar", numero, versionVista: a.version, comandoId: comando(), motivo: "corto" });
    expect(corto).toMatchObject({ ok: false, codigo: "motivo_requerido" });
    const d = await procesarEstado(exp, mesa, { accion: "desarchivar", numero, versionVista: a.version, comandoId: comando(), motivo: "Lo pidió Asesoría Legal para revisar" });
    expect(d).toMatchObject({ ok: true, mensaje: "Expediente desarchivado: vuelve a concluido, en Administrativo: entrega." });
    expect((await proyeccion(prisma, numero)).estado).toBe("concluido");

    // Una entrada mal formada (cualquiera puede mandar un POST) es un error del formulario, no un 500.
    expect(await procesarEstado(exp, mesa, { accion: "inventada", numero, versionVista: 0, comandoId: comando() })).toMatchObject({ ok: false, codigo: "validacion" });
    await conciliar(numero);
  });
});

describe("reiniciar con otra plantilla y archivar y abrir vinculado", () => {
  it("reiniciar anula y lleva al alta precargada; el alta nueva queda enlazada", async () => {
    const anterior = await exp.alta(mesa, await datosAlta(prisma), comando());
    const plan = await idPlantilla(prisma, "RENOV_PLAN");
    const r = await procesarReinicio(exp, mesa, { numero: anterior.numero, versionVista: anterior.version, comandoId: comando(), motivo: "Corresponde plan de pagos", plantillaId: plan });
    expect(r).toEqual({ ok: true, destino: `/expedientes/nuevo?desde=${anterior.numero}&plantilla=${plan}`, mensaje: `${anterior.numero} quedó anulado para reiniciarlo.` });

    // Lo que hace /expedientes/nuevo?desde=: precarga, valores del formulario y alta con el anterior.
    const precarga = await exp.precargaAlta(mesa, anterior.numero);
    expect(precarga.desde).toMatchObject({ numero: anterior.numero, estado: "anulado", reiniciable: true });
    const ctx = await exp.contextoAlta(mesa, plan, precarga.datos.cementerioId);
    const claves = ctx.camposUbicacion.map((c) => c.clave);
    const { valores } = valoresDesdePrecarga(precarga.datos, ctx.definicion, { hoy: ctx.hoy, tiposMonumento: ctx.tiposMonumento.map((t) => t.codigo), clavesUbicacion: claves });
    const datos = datosAltaDesde(valores, { plantillaId: plan, cementerioId: precarga.datos.cementerioId, definicion: ctx.definicion, clavesUbicacion: claves });
    datos.expedienteAnteriorId = precarga.datos.expedienteAnteriorId;
    const nuevo = await exp.alta(mesa, datos, comando());
    const ficha = await exp.obtenerFicha(mesa, nuevo.numero);
    expect(ficha.enlaces.anterior).toMatchObject({ numero: anterior.numero, vinculo: "reinicio", estado: "anulado" });
    expect(ficha.situaciones).toContain("reiniciado");
  });

  it("archivar y abrir vinculado: el anterior archivado sin concluir y el nuevo con sus datos, en una transacción", async () => {
    const anterior = await exp.alta(mesa, await datosAlta(prisma, { personas: [titular({ apellido: "VINCULADO FICTICIO" })] }), comando());
    const plan = await idPlantilla(prisma, "RENOV_PLAN");
    const sinCaja = await procesarVinculado(exp, mesa, { numero: anterior.numero, versionVista: anterior.version, comandoId: comando(), motivo: "No pagó: se tramita la caducidad", plantillaId: plan }, null);
    expect(sinCaja).toMatchObject({ ok: false, codigo: "validacion", errores: [{ ruta: "ubicacionArchivo" }] });
    expect((await proyeccion(prisma, anterior.numero)).estado).toBe("en_tramite");

    const r = await procesarVinculado(
      exp,
      mesa,
      { numero: anterior.numero, versionVista: anterior.version, comandoId: comando(), motivo: "No pagó: se tramita la caducidad", plantillaId: plan, ubicacionArchivo: "Caja C-1" },
      null,
    );
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    const nuevoNumero = r.destino.replace("/expedientes/", "");
    expect(await proyeccion(prisma, anterior.numero)).toMatchObject({ estado: "archivado", ubicacionArchivo: "Caja C-1" });
    const ficha = await exp.obtenerFicha(mesa, nuevoNumero);
    expect(ficha.enlaces.anterior).toMatchObject({ numero: anterior.numero, vinculo: "vinculado", estado: "archivado" });
    expect(ficha.personas[0]).toMatchObject({ apellido: "VINCULADO FICTICIO" });
    expect(ficha.plantilla.codigo).toBe("RENOV_PLAN");
  });
});

describe("correcciones desde el menú del historial", () => {
  it("revertir un pase deja el historial marcado; corregir la fecha muestra la nueva", async () => {
    const alta = await exp.alta(mesa, await datosAlta(prisma), comando());
    const pase = await avanzar(exp, prisma, alta.numero);
    const r = await procesarCorreccion(exp, mesa, { tipo: "revertir", numero: alta.numero, versionVista: pase.version, comandoId: comando(), movimientoId: pase.movimientoId, motivo: "Se dio el pase por error" });
    expect(r).toMatchObject({ ok: true, mensaje: "Movimiento revertido: el expediente volvió a como estaba antes." });
    const f1 = await exp.obtenerFicha(mesa, alta.numero);
    expect(f1.historial.find((m) => m.id === pase.movimientoId)).toMatchObject({ revertido: true });
    expect(f1.paso.clave).toBe("MESA");

    // Otra vez el pase (ya está todo tildado) y una nota; se corrige la fecha de la nota.
    const otro = await procesarPase(exp, mesa, { numero: alta.numero, pasoDestino: "COMPUTO_ALTA", versionVista: f1.version, comandoId: comando() });
    expect(otro).toMatchObject({ ok: true });
    if (!otro.ok) return;
    const nota = await procesarNota(exp, mesa, { numero: alta.numero, versionVista: otro.version, comandoId: comando(), texto: "Llamó el concesionario" });
    expect(nota).toMatchObject({ ok: true, mensaje: "Nota agregada al historial." });
    if (!nota.ok) return;
    const f2 = await exp.obtenerFicha(mesa, alta.numero);
    const mNota = f2.historial.find((m) => m.tipo === "nota");
    expect(mNota?.correcciones).toContain("fecha");
    const sinFecha = await procesarCorreccion(exp, mesa, { tipo: "fecha", numero: alta.numero, versionVista: nota.version, comandoId: comando(), movimientoId: mNota?.id ?? "0", motivo: "La llamada fue el día anterior" });
    expect(sinFecha).toMatchObject({ ok: false, errores: [{ ruta: "fechaEfectiva" }] });
    const fecha = await procesarCorreccion(exp, mesa, {
      tipo: "fecha",
      numero: alta.numero,
      versionVista: nota.version,
      comandoId: comando(),
      movimientoId: mNota?.id ?? "0",
      fecha: hoyEnTucuman(),
      motivo: "La llamada fue a primera hora",
    });
    expect(fecha).toMatchObject({ ok: true, mensaje: "Fecha corregida." });
    const f3 = await exp.obtenerFicha(mesa, alta.numero);
    expect(f3.historial.find((m) => m.id === mNota?.id)).toMatchObject({ fechaCorregida: { precisionFecha: "dia" } });
    await conciliar(alta.numero);
  });

  it("purgar un adjunto sin la confirmación explícita no llega al dominio", async () => {
    const r = await procesarCorreccion(exp, mesa, { tipo: "purgar_adjunto", numero: "CEM-2026-00001", versionVista: 0, comandoId: comando(), movimientoId: "1", motivo: "Datos de un tercero" });
    expect(r).toMatchObject({ ok: false, codigo: "validacion", errores: [{ ruta: "confirmado" }] });
  });
});

describe("la grilla de transcripción", () => {
  it("3 filas: el error de una fila vuelve a su celda; corregida, se registra el lote y se termina la carga", async () => {
    const alta = await exp.alta(mesa, await datosAlta(prisma, { cargaHistorica: true, fuente: "Ficha papel", fechaInicio: "2019-03-15" }), comando());
    const ficha = await exp.obtenerFicha(mesa, alta.numero);
    const ordenDe = (c: string) => ficha.recorrido.find((p) => p.clave === c)?.orden ?? null;
    // Cada fila con su comandoId, generado al agregarla.
    const filas: FilaGrilla[] = [
      { ...filaNueva(comando()), fecha: "2019-03-20", pasoDestino: "COMPUTO_ALTA" },
      { ...filaNueva(comando()), fecha: "2019-03-10", pasoDestino: "LIQUIDACION" }, // antes de la anterior
      { ...filaNueva(comando()), fecha: "2019-05-02", pasoDestino: "LEGAL", observacion: "Para dictamen" },
    ];
    let lote = loteParaEnviar(filas, recorrerFilas(filas, ficha.paso.orden, ordenDe));
    const mal = await procesarTranscripcion(exp, mesa, { numero: alta.numero, versionVista: ficha.version, filas: lote.filas });
    expect(mal).toMatchObject({ ok: false });
    if (mal.ok) return;
    const celdas = erroresDeGrilla(mal.errores, filas, lote.indices);
    expect(celdas.celdas.get(filas[1].id)?.fecha?.length).toBe(1);

    filas[1] = { ...filas[1], fecha: "2019-04-01" };
    lote = loteParaEnviar(filas, recorrerFilas(filas, ficha.paso.orden, ordenDe));
    const ok = await procesarTranscripcion(exp, mesa, { numero: alta.numero, versionVista: ficha.version, filas: lote.filas });
    expect(ok).toMatchObject({ ok: true, version: ficha.version + 1, mensaje: "Se registraron 3 filas. El expediente quedó en Asesoría Legal." });
    if (!ok.ok) return;
    // Reintentar el mismo lote no repite nada.
    const otra = await procesarTranscripcion(exp, mesa, { numero: alta.numero, versionVista: ok.version, filas: lote.filas });
    expect(otra).toMatchObject({ ok: true, mensaje: "No había filas nuevas: las 3 ya estaban registradas. El expediente está en Asesoría Legal." });

    const fin = await procesarTerminarCarga(exp, mesa, { numero: alta.numero, versionVista: ok.version, comandoId: comando() });
    expect(fin).toEqual({ ok: true, destino: `/expedientes/${alta.numero}`, mensaje: "Carga histórica terminada." });
    expect((await proyeccion(prisma, alta.numero)).cargaHistorica).toBe(false);
    await conciliar(alta.numero);
  });
});

describe("GET /expedientes/exportar (CSV del buscador)", () => {
  it("Dirección: el CSV de la búsqueda, con BOM y acentos, sin teléfono, correo ni domicilio, y registrado", async () => {
    const apellido = "EXPORTACIÓN FICTICIA";
    const alta = await exp.alta(mesa, await datosAlta(prisma, { personas: [titular({ apellido, nombres: "Señora Ñandú" })] }), comando());
    const antes = await prisma.auditoriaAcceso.count({ where: { usuarioId: direccion.id, accion: "exportar" } });
    const r = await responderExportacion(exp, direccion, new Request(`${BASE}/expedientes/exportar?q=${encodeURIComponent(alta.numero)}`), "127.0.0.1");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(r.headers.get("content-disposition")).toBe(
      `attachment; filename="expedientes-${hoyEnTucuman()}.csv"; filename*=UTF-8''expedientes-${hoyEnTucuman()}.csv`,
    );
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    expect(r.headers.get("x-filas")).toBe("1");
    const bytes = new Uint8Array(await r.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const texto = new TextDecoder("utf-8").decode(bytes); // quita el BOM
    expect(texto.split("\r\n")[0]).toBe("N° interno;N° municipal;Estado;Fecha de inicio;Tipo de trámite;Plantilla;Versión;Cementerio;Ubicación;Paso;Área actual;Titular;Carga histórica");
    expect(texto).toContain(`${apellido}, Señora Ñandú`);
    expect(texto).toContain("En trámite");
    expect(texto).not.toMatch(/0381|titular@ejemplo\.test|Calle Ficticia/);
    expect(await prisma.auditoriaAcceso.count({ where: { usuarioId: direccion.id, accion: "exportar" } })).toBe(antes + 1);
  });

  it("sin sesión 401, un operador 403, un filtro inválido 422", async () => {
    const req = () => new Request(`${BASE}/expedientes/exportar?desde=2026-13-45`);
    expect((await responderExportacion(exp, null, req(), null)).status).toBe(401);
    const operador = await responderExportacion(exp, mesa, new Request(`${BASE}/expedientes/exportar`), null);
    expect(operador.status).toBe(403);
    expect(await operador.text()).toMatch(/^No podés hacer esto/);
    expect((await responderExportacion(exp, direccion, req(), null)).status).toBe(422);
  });
});
