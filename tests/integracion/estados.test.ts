// Los estados de la semana 4 (src/lib/dominio/expedientes/estados.ts) contra la
// base real: docs/propuesta-mvp.md, 3.1 y 2.13(a); docs/fuentes, punto 6.
// Concluir y archivar el recorrido completo de (a), archivar sin concluir desde
// la DIM, desarchivar, anular y reabrir, reiniciar con otra plantilla (precarga
// y enlace) y "archivar y abrir vinculado" con una plantilla de caducidad de
// prueba. Cada recorrido termina conciliando la proyección con el historial.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ErrorDominio, type ServicioExpedientes } from "@/lib/dominio/expedientes";
import { PermisoDenegado, type UsuarioPermisos } from "@/lib/dominio/permisos";
import type { DefinicionPlantillaEntrada } from "@/lib/dominio/plantillas/esquema";
import { hoyEnTucuman, sumarDias } from "@/lib/fechas";
import {
  asegurarSemilla,
  avanzar,
  comando,
  conciliacion,
  datosAlta,
  hastaElUltimoPaso,
  idArea,
  movimientos,
  plantillaDePrueba,
  proyeccion,
  servicio,
  usuario,
} from "./dominio";
import { clientePrisma } from "./helper";

const prisma = clientePrisma();
const exp: ServicioExpedientes = servicio(prisma);
let mesa: UsuarioPermisos;
let computo: UsuarioPermisos;
let legal: UsuarioPermisos;
let tributario: UsuarioPermisos;
let administrativo: UsuarioPermisos;
let direccion: UsuarioPermisos;
let admin: UsuarioPermisos;

beforeAll(async () => {
  await asegurarSemilla(prisma);
  [mesa, computo, legal, tributario, administrativo, direccion, admin] = await Promise.all([
    usuario(prisma, "MESA_ENTRADAS"),
    usuario(prisma, "COMPUTO"),
    usuario(prisma, "LEGAL"),
    usuario(prisma, "TRIBUTARIO"),
    usuario(prisma, "ADMINISTRATIVO"),
    usuario(prisma, "DIRECCION"),
    usuario(prisma, "ADMIN"),
  ]);
});

afterAll(async () => prisma.$disconnect());

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

describe("concluir y archivar: el recorrido completo de (a) RENOV_CONTADO", () => {
  it("del alta al archivo, con las validaciones de concluir y los permisos de cada paso", async () => {
    const alta = await exp.alta(mesa, await datosAlta(prisma, { fechaInicio: sumarDias(hoyEnTucuman(), -10) }), comando());
    // Concluir no existe antes del último paso.
    expect(await errorDe(exp.concluir(mesa, alta.numero, 0, comando()))).toMatchObject({ motivo: "no_es_paso_final" });

    await hastaElUltimoPaso(exp, prisma, alta.numero);
    const e = await proyeccion(prisma, alta.numero);
    expect(e).toMatchObject({ pasoClave: "ADM_ENTREGA", areaActual: { codigo: "ADMINISTRATIVO" } });

    // "Faltan N" de concluir: la subtarea del último paso.
    const ficha = await exp.obtenerFicha(administrativo, alta.numero);
    expect(ficha.acciones.concluir).toEqual({ permitido: true, requiereMotivo: false });
    expect(ficha.concluir.faltan.map((f) => f.clave)).toEqual(["ADM_ENTREGADO"]);
    const falta = await errorDe(exp.concluir(administrativo, alta.numero, e.version, comando()));
    expect(falta).toMatchObject({ codigo: "faltan_requisitos", errores: [{ ruta: "subtareas.ADM_ENTREGADO" }] });
    // Otra área no concluye.
    expect(await errorDe(exp.concluir(legal, alta.numero, e.version, comando()))).toMatchObject({ motivo: "no_es_responsable" });

    // En el último paso "Faltan N" del pase está vacío: se tilda a mano.
    const { version } = await exp.tildarSubtarea(administrativo, alta.numero, "ADM_ENTREGADO", hoyEnTucuman(), e.version, comando());
    const cmd = comando();
    const c = await exp.concluir(administrativo, alta.numero, version, cmd, { observacion: "Título entregado en mano" });
    expect(c).toMatchObject({ estado: "concluido", estadoPrevio: null, repetido: false, paso: { clave: "ADM_ENTREGA" } });
    // El mismo comando: lo de la primera vez.
    expect(await exp.concluir(administrativo, alta.numero, version, cmd)).toMatchObject({ repetido: true, movimientoId: c.movimientoId });
    const mc = (await movimientos(prisma, alta.numero)).at(-1);
    expect(mc).toMatchObject({ tipo: "estado", estadoAnterior: "en_tramite", estadoNuevo: "concluido", motivo: null, observacion: "Título entregado en mano" });

    // En concluido no hay pases, ni devoluciones, ni otro concluir (3.1).
    const fc = await exp.obtenerFicha(administrativo, alta.numero);
    expect(fc.acciones).toMatchObject({
      darPase: { permitido: false },
      devolver: { permitido: false },
      concluir: { permitido: false },
      archivar: { permitido: true },
      archivarSinConcluir: { permitido: false },
      anular: { permitido: false },
    });
    expect(await errorDe(exp.devolver(administrativo, alta.numero, "LEGAL", "No corresponde devolver", [], c.version, comando()))).toMatchObject({
      codigo: "estado_no_admite",
    });

    // Archivar: la ubicación es obligatoria y DESCONOCIDA es solo de la carga histórica.
    expect(await errorDe(exp.archivar(administrativo, alta.numero, "  ", c.version, comando()))).toMatchObject({ codigo: "validacion" });
    expect(await errorDe(exp.archivar(administrativo, alta.numero, "desconocida", c.version, comando()))).toMatchObject({ codigo: "validacion" });
    expect(await errorDe(exp.archivar(legal, alta.numero, "Caja 1", c.version, comando()))).toMatchObject({ motivo: "no_es_responsable" });
    const a = await exp.archivar(administrativo, alta.numero, "Caja 12 · Estante B", c.version, comando());
    expect(a).toMatchObject({ estado: "archivado", estadoPrevio: "concluido", ubicacionArchivo: "Caja 12 · Estante B" });
    expect((await movimientos(prisma, alta.numero)).at(-1)).toMatchObject({
      estadoAnterior: "concluido",
      estadoNuevo: "archivado",
      motivo: null,
      datos: { ubicacion_archivo: "Caja 12 · Estante B" },
    });

    // En archivado: no se edita, se cambia la caja (edición) y se desarchiva con motivo.
    expect(await errorDe(exp.editar(mesa, alta.numero, { observaciones: "otra" }, a.version, null, comando()))).toMatchObject({ codigo: "estado_no_admite" });
    const caja = await exp.cambiarUbicacionArchivo(mesa, alta.numero, "Caja 13", a.version, comando());
    expect(caja).toMatchObject({ ubicacionArchivo: "Caja 13", estado: "archivado" });
    expect((await movimientos(prisma, alta.numero)).at(-1)).toMatchObject({
      tipo: "edicion",
      datos: { cambios: { ubicacion_archivo: ["Caja 12 · Estante B", "Caja 13"] } },
    });
    expect(await errorDe(exp.cambiarUbicacionArchivo(mesa, alta.numero, "Caja 13", caja.version, comando()))).toMatchObject({ codigo: "sin_cambios" });

    expect(await errorDe(exp.desarchivar(mesa, alta.numero, "corto", caja.version, comando()))).toMatchObject({ codigo: "motivo_requerido" });
    expect(await errorDe(exp.desarchivar(computo, alta.numero, "Se pidió el expediente", caja.version, comando()))).toMatchObject({
      motivo: "area_no_habilitada",
    });
    const d = await exp.desarchivar(mesa, alta.numero, "Lo pidió Asesoría Legal para consulta", caja.version, comando());
    expect(d).toMatchObject({ estado: "concluido", estadoPrevio: null, ubicacionArchivo: null });
    await conciliar(alta.numero);
  });
});

describe("archivar sin concluir desde la DIM y desarchivar", () => {
  it("el papel vuelve a Tributario en el mismo movimiento; desarchivar lo devuelve a la DIM con su plazo", async () => {
    const alta = await exp.alta(mesa, await datosAlta(prisma, { plantilla: "RENOV_PLAN", fechaInicio: sumarDias(hoyEnTucuman(), -20) }), comando());
    for (let i = 0; i < 6; i++) await avanzar(exp, prisma, alta.numero);
    const enDim = await proyeccion(prisma, alta.numero);
    expect(enDim).toMatchObject({ pasoClave: "DIM", estado: "espera_pago_dim", areaActual: { codigo: "DIM" }, areaResponsable: { codigo: "TRIBUTARIO" } });
    expect(enDim.plazoDesde).not.toBeNull();

    // Solo Mesa de Entradas y el admin; con motivo y ubicación.
    expect(await errorDe(exp.archivarSinConcluir(tributario, alta.numero, { motivo: "No pagó", ubicacionArchivo: "Caja 1" }, enDim.version, comando()))).toBeInstanceOf(
      ErrorDominio,
    );
    expect(
      await errorDe(exp.archivarSinConcluir(tributario, alta.numero, { motivo: "No pagó después de la notificación", ubicacionArchivo: "Caja 1" }, enDim.version, comando())),
    ).toMatchObject({ motivo: "area_no_habilitada" });

    const r = await exp.archivarSinConcluir(
      mesa,
      alta.numero,
      { motivo: "No pagó después de la notificación: pasa a caducidad", ubicacionArchivo: "Caja 40", fechaEfectiva: hoyEnTucuman() },
      enDim.version,
      comando(),
    );
    expect(r).toMatchObject({
      estado: "archivado",
      estadoPrevio: "espera_pago_dim",
      areaActual: { codigo: "TRIBUTARIO" },
      areaResponsable: { codigo: "TRIBUTARIO" },
      paso: { clave: "DIM" },
    });
    const m = (await movimientos(prisma, alta.numero)).at(-1);
    expect(m).toMatchObject({
      tipo: "estado",
      estadoAnterior: "espera_pago_dim",
      estadoNuevo: "archivado",
      motivo: "No pagó después de la notificación: pasa a caducidad",
      areaOrigenId: await idArea(prisma, "DIM"),
      areaDestinoId: await idArea(prisma, "TRIBUTARIO"),
      datos: { ubicacion_archivo: "Caja 40", regreso_papel: { area_id: await idArea(prisma, "TRIBUTARIO") } },
    });
    const archivado = await proyeccion(prisma, alta.numero);
    expect(archivado).toMatchObject({ plazoDesde: null, plazoDiasHabiles: null, recibidoEn: m?.fechaEfectiva });
    // Ya no está en Afuera ni en Plazos de Tributario.
    for (const pestana of ["afuera", "plazos"] as const) {
      expect((await exp.bandeja(tributario, pestana)).filas.map((f) => f.numero)).not.toContain(alta.numero);
    }
    await conciliar(alta.numero);

    const d = await exp.desarchivar(admin, alta.numero, "Se presentó y pagó: se retoma el trámite", r.version, comando());
    expect(d).toMatchObject({ estado: "espera_pago_dim", estadoPrevio: null, ubicacionArchivo: null, areaActual: { codigo: "DIM" }, paso: { clave: "DIM" } });
    const vuelto = await proyeccion(prisma, alta.numero);
    expect(vuelto.plazoDesde).toEqual(enDim.plazoDesde);
    expect(vuelto.plazoDiasHabiles).toBe(30);
    expect((await movimientos(prisma, alta.numero)).at(-1)).toMatchObject({
      estadoAnterior: "archivado",
      estadoNuevo: "espera_pago_dim",
      areaDestinoId: await idArea(prisma, "DIM"),
      datos: { ubicacion_archivo: "Caja 40" },
    });
    await conciliar(alta.numero);
  });
});

describe("anular y reabrir", () => {
  it("Mesa anula con motivo; solo el admin reabre, al mismo paso y área", async () => {
    const alta = await exp.alta(mesa, await datosAlta(prisma), comando());
    const p = await avanzar(exp, prisma, alta.numero);
    expect(await errorDe(exp.anular(computo, alta.numero, "Cargado dos veces", p.version, comando()))).toMatchObject({ motivo: "area_no_habilitada" });
    expect(await errorDe(exp.anular(mesa, alta.numero, null, p.version, comando()))).toMatchObject({ codigo: "motivo_requerido" });
    expect(await errorDe(exp.anular(mesa, alta.numero, "Cargado dos veces", p.version - 1, comando()))).toMatchObject({ codigo: "conflicto_version" });
    const a = await exp.anular(mesa, alta.numero, "Cargado dos veces por error", p.version, comando());
    expect(a).toMatchObject({ estado: "anulado", estadoPrevio: "en_tramite", areaActual: { codigo: "COMPUTO" } });

    // Anulado: no hay pases, ni ediciones, ni documentos; sí notas.
    expect(await errorDe(exp.darPase(computo, alta.numero, "LIQUIDACION", a.version, comando()))).toMatchObject({ codigo: "estado_no_admite" });
    expect(await errorDe(exp.marcarDocumento(mesa, alta.numero, "DNI", "presentado", null, a.version, comando()))).toMatchObject({ codigo: "estado_no_admite" });
    const nota = await exp.agregarNota(computo, alta.numero, "Se encontró el duplicado", a.version, comando());
    expect(await errorDe(exp.agregarNota(direccion, alta.numero, "algo", nota.version, comando()))).toMatchObject({ motivo: "solo_lectura" });
    // El buscador lo excluye salvo que se pida.
    expect((await exp.buscar(mesa, { q: alta.numeroCorto })).resultados).toEqual([]);
    expect((await exp.buscar(mesa, { q: alta.numeroCorto, filtros: { incluirAnulados: true } })).resultados.map((x) => x.numero)).toEqual([alta.numero]);

    expect(await errorDe(exp.reabrir(mesa, alta.numero, "No era un duplicado", nota.version, comando()))).toMatchObject({ motivo: "solo_admin" });
    const r = await exp.reabrir(admin, alta.numero, "No era un duplicado: era otro espacio", nota.version, comando());
    expect(r).toMatchObject({ estado: "en_tramite", estadoPrevio: null, areaActual: { codigo: "COMPUTO" }, paso: { clave: "COMPUTO_ALTA" } });
    expect((await movimientos(prisma, alta.numero)).at(-1)).toMatchObject({ estadoAnterior: "anulado", estadoNuevo: "en_tramite" });
    // Reabrir no depende de que la anulación sea el último movimiento (había una nota después).
    await conciliar(alta.numero);
  });
});

describe("reiniciar con otra plantilla (2.13(a))", () => {
  it("anula, devuelve la precarga y el alta nueva queda enlazada con la anterior", async () => {
    const original = await datosAlta(prisma, { padron: "PAD-REINICIO", numeroMunicipal: `${Date.now() % 100000}/2026` });
    const alta = await exp.alta(mesa, original, comando());
    const p = await avanzar(exp, prisma, alta.numero);
    expect(await errorDe(exp.reiniciar(computo, alta.numero, "Pasa a plan de pagos", p.version, comando()))).toMatchObject({ motivo: "area_no_habilitada" });

    const r = await exp.reiniciar(mesa, alta.numero, "El concesionario pasa de contado a plan de pagos", p.version, comando());
    expect(r).toMatchObject({ estado: "anulado", precarga: { desde: { numero: alta.numero, estado: "anulado", reiniciable: true } } });
    expect((await movimientos(prisma, alta.numero)).at(-1)).toMatchObject({ estadoNuevo: "anulado", datos: { reinicio: true } });
    const d = r.precarga.datos;
    expect(d).toMatchObject({
      plantillaId: null,
      cementerioId: original.cementerioId,
      tipoMonumento: original.tipoMonumento,
      ubicacion: original.ubicacion,
      padron: "PAD-REINICIO",
      numeroMunicipal: original.numeroMunicipal,
      fechaInicio: hoyEnTucuman(),
      expedienteAnteriorId: r.precarga.desde.id,
    });
    // Las personas vigentes, con el contacto completo (la precarga es de Mesa de Entradas).
    expect(d.personas).toEqual([expect.objectContaining({ rol: "titular", dni: original.personas[0].dni, telefono: original.personas[0].telefono })]);
    // precargaAlta() trae lo mismo y registra el acceso.
    const pre = await exp.precargaAlta(mesa, alta.numero);
    expect(pre.datos).toEqual(d);
    const acceso = await prisma.auditoriaAcceso.findFirst({
      where: { usuarioId: mesa.id, accion: "ver_expediente", expediente: { numeroInterno: alta.numero } },
      orderBy: { id: "desc" },
    });
    expect(acceso?.detalle).toEqual({ para: "precargar_alta" });

    // El alta nueva, con otra plantilla.
    const plan = await prisma.plantilla.findFirstOrThrow({ where: { codigo: "RENOV_PLAN", estado: "publicada" }, select: { id: true } });
    const nueva = await exp.alta(mesa, { ...d, plantillaId: plan.id, formaPago: null }, comando());
    expect(nueva.avisos.map((a) => a.numero)).not.toContain(alta.numero);
    const fNueva = await exp.obtenerFicha(mesa, nueva.numero);
    expect(fNueva).toMatchObject({
      expedienteAnterior: alta.numero,
      enlaces: { anterior: { numero: alta.numero, estado: "anulado", vinculo: "reinicio" }, siguientes: [] },
      paso: { orden: 1 },
    });
    expect(fNueva.situaciones).toContain("reiniciado");
    const fVieja = await exp.obtenerFicha(mesa, alta.numero);
    expect(fVieja.enlaces).toEqual({ anterior: null, siguientes: [expect.objectContaining({ numero: nueva.numero, vinculo: "reinicio" })] });
    expect(fVieja.expedientesSiguientes).toEqual([nueva.numero]);
    expect((await movimientos(prisma, nueva.numero))[0]).toMatchObject({ tipo: "alta", datos: { expediente_anterior: alta.numero, vinculo: "reinicio" } });

    // Un solo siguiente por reinicio, y solo de un anulado por reinicio.
    expect(await errorDe(exp.alta(mesa, { ...d, plantillaId: plan.id, formaPago: null }, comando()))).toMatchObject({
      codigo: "validacion",
      errores: [{ ruta: "expedienteAnteriorId" }],
    });
    const otra = await exp.alta(mesa, await datosAlta(prisma), comando());
    const anulada = await exp.anular(mesa, otra.numero, "Anulado sin reiniciar", 0, comando());
    expect(anulada.estado).toBe("anulado");
    expect(await errorDe(exp.alta(mesa, { ...(await datosAlta(prisma)), expedienteAnteriorId: (await proyeccion(prisma, otra.numero)).id.toString() }, comando()))).toMatchObject({
      errores: [{ ruta: "expedienteAnteriorId", mensaje: expect.stringMatching(/sin reiniciarlo/) }],
    });
    const enCurso = await exp.alta(mesa, await datosAlta(prisma), comando());
    expect(await errorDe(exp.alta(mesa, { ...(await datosAlta(prisma)), expedienteAnteriorId: (await proyeccion(prisma, enCurso.numero)).id.toString() }, comando()))).toMatchObject({
      errores: [{ ruta: "expedienteAnteriorId", mensaje: expect.stringMatching(/no está anulado/) }],
    });
    await conciliar(alta.numero);
    await conciliar(nueva.numero);
  });
});

describe("archivar y abrir vinculado (caducidad, docs/fuentes punto 6)", () => {
  // La Dirección todavía no pasó el circuito de caducidad: esta plantilla es de prueba.
  const CADUCIDAD: DefinicionPlantillaEntrada = {
    forma_pago: "no_aplica",
    tipos_monumento: [],
    ubicacion_obligatoria: true,
    requiere_contacto: false,
    personas: [{ rol: "titular", etiqueta: "Último titular conocido", min: 0, max: 1, fallecido: "opcional", pide_vinculo: false, admite_juridica: true }],
    campos_extra: [],
    documentos: [],
    conceptos: [],
    pasos: [
      { clave: "MESA", nombre: "Inicio de oficio", area: "MESA_ENTRADAS", custodia: null, estado: "en_tramite", omitible: false, dias_alerta: 2, plazo: null, subtareas: [] },
      {
        clave: "LEGAL",
        nombre: "Trámite de caducidad",
        area: "LEGAL",
        custodia: null,
        estado: "en_tramite",
        omitible: false,
        dias_alerta: 30,
        plazo: null,
        subtareas: [{ clave: "LEG_INTIMACION", nombre: "Intimación notificada", obligatoria: true, dato: "fecha", dato_obligatorio: true }],
      },
    ],
  };

  it("archiva sin concluir (sin anular) y abre el nuevo con expediente_anterior_id, en una transacción", async () => {
    const plantillaId = await plantillaDePrueba(prisma, CADUCIDAD, "Caducidad (prueba)");
    const alta = await exp.alta(mesa, await datosAlta(prisma, { plantilla: "RENOV_PLAN", fechaInicio: sumarDias(hoyEnTucuman(), -20) }), comando());
    for (let i = 0; i < 6; i++) await avanzar(exp, prisma, alta.numero);
    const enDim = await proyeccion(prisma, alta.numero);

    const pre = await exp.precargaAlta(mesa, alta.numero);
    expect(pre.datos.expedienteAnteriorId).toBeNull();
    const datos = { ...pre.datos, plantillaId, formaPago: null, observaciones: "Caducidad por falta de pago" };
    const entrada = { motivo: "No pagó después de la notificación: caducidad", ubicacionArchivo: "Caja 41" };

    // Si el alta nueva falla, no se archiva nada.
    const roto = await errorDe(exp.archivarYAbrirVinculado(mesa, alta.numero, entrada, { ...datos, tipoMonumento: "NO_EXISTE" }, enDim.version, comando()));
    expect(roto).toMatchObject({ codigo: "validacion" });
    expect((await proyeccion(prisma, alta.numero)).estado).toBe("espera_pago_dim");
    expect(await errorDe(exp.archivarYAbrirVinculado(tributario, alta.numero, entrada, datos, enDim.version, comando()))).toMatchObject({
      motivo: "area_no_habilitada",
    });

    const cmd = comando();
    const r = await exp.archivarYAbrirVinculado(mesa, alta.numero, entrada, datos, enDim.version, cmd);
    expect(r.archivado).toMatchObject({ estado: "archivado", estadoPrevio: "espera_pago_dim", areaActual: { codigo: "TRIBUTARIO" } });
    expect(r.nuevo).toMatchObject({ repetido: false, version: 0 });
    // Un reintento devuelve lo mismo.
    expect(await exp.archivarYAbrirVinculado(mesa, alta.numero, entrada, datos, enDim.version, cmd)).toMatchObject({
      archivado: { repetido: true },
      nuevo: { numero: r.nuevo.numero, repetido: true },
    });

    expect((await movimientos(prisma, alta.numero)).at(-1)).toMatchObject({
      estadoNuevo: "archivado",
      datos: { ubicacion_archivo: "Caja 41", abre_vinculado: true, regreso_papel: { area_id: await idArea(prisma, "TRIBUTARIO") } },
    });
    const nuevo = await proyeccion(prisma, r.nuevo.numero);
    expect(nuevo).toMatchObject({ plantillaId, pasoClave: "MESA", estado: "en_tramite", expedienteAnteriorId: enDim.id, formaPago: null });
    // El anterior NO está anulado: es un trámite real que terminó así.
    expect((await proyeccion(prisma, alta.numero)).estado).toBe("archivado");
    const f = await exp.obtenerFicha(mesa, r.nuevo.numero);
    expect(f.enlaces.anterior).toEqual({ numero: alta.numero, estado: "archivado", plantilla: expect.any(String), vinculo: "vinculado" });
    const fv = await exp.obtenerFicha(mesa, alta.numero);
    expect(fv.enlaces.siguientes).toEqual([expect.objectContaining({ numero: r.nuevo.numero, vinculo: "vinculado" })]);
    // El vínculo no se puede pedir desde el formulario: no es un reinicio.
    expect(await errorDe(exp.alta(mesa, { ...datos, expedienteAnteriorId: enDim.id.toString() }, comando()))).toMatchObject({ codigo: "validacion" });
    // Revertir el archivo con el vinculado abierto no se permite.
    const archivo = (await movimientos(prisma, alta.numero)).at(-1);
    expect(await errorDe(exp.revertir(admin, alta.numero, String(archivo?.id), "Se archivó por error", fv.version, comando()))).toMatchObject({
      codigo: "estado_no_admite",
      message: expect.stringMatching(/continúa en/),
    });
    await conciliar(alta.numero);
    await conciliar(r.nuevo.numero);
  });
});
