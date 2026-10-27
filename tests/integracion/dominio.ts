// Ayudas para los tests del dominio de expedientes (semanas 2 a 4).
//
// A diferencia de escenario.ts, estos tests usan la semilla real (áreas con sus
// códigos, las plantillas, los usuarios ficticios por área): las reglas de
// permisos miran el código de área (MESA_ENTRADAS, COMPUTO…) y las plantillas
// apuntan a esas áreas. `asegurarSemilla()` la corre (es idempotente), así que
// el orden de los archivos no importa. Lo que se crea con el dominio se
// CONFIRMA: cada test usa nombres, padrones y números únicos y no cuenta filas
// globales.

import { randomUUID } from "node:crypto";
import type { AlmacenAdjuntos } from "@/lib/adjuntos/almacen";
import { sembrar } from "../../prisma/semilla/sembrar";
import { USUARIOS_FICTICIOS } from "../../prisma/semilla/usuarios";
import { conActorEn } from "@/lib/db/actor";
import type { Cliente, Transaccion } from "@/lib/db/crear-cliente";
import { crearServicioExpedientes, type DatosAlta, type PersonaEntrada, type ResultadoPase, type ServicioExpedientes } from "@/lib/dominio/expedientes";
import { digitoVerificadorCuil } from "@/lib/dominio/cuil";
import { esRol, type UsuarioPermisos } from "@/lib/dominio/permisos";
import { definicionDelExpediente } from "@/lib/dominio/expedientes/contexto";
import type { DefinicionPlantilla, DefinicionPlantillaEntrada } from "@/lib/dominio/plantillas/esquema";
import { fechaDesdeDb, hoyEnTucuman } from "@/lib/fechas";
import { leerItems } from "@/lib/dominio/expedientes/items";
import { cargarMovimientos, entornoReconstruccion } from "@/lib/dominio/expedientes/operacion";
import { proyeccionComparable, reconstruirProyeccion, type ProyeccionFlujo } from "@/lib/dominio/expedientes/reconstruccion";

/** El mismo CUIL de admin que usa semilla.test.ts. */
export const ADMIN_CUIL = "20000000001";

export async function asegurarSemilla(prisma: Cliente): Promise<void> {
  await sembrar(prisma, { adminCuil: ADMIN_CUIL });
}

export function servicio(prisma: Cliente, ahora?: () => Date, almacen?: AlmacenAdjuntos): ServicioExpedientes {
  return crearServicioExpedientes({
    leer: prisma,
    escribir: (usuarioId, motivo, fn) => conActorEn(prisma, usuarioId, motivo, fn),
    ahora,
    almacen,
  });
}

export type CodigoUsuario = "MESA_ENTRADAS" | "COMPUTO" | "LIQUIDACION" | "LEGAL" | "ADMINISTRATIVO" | "TRIBUTARIO" | "DIRECCION" | "ADMIN";

/** El usuario ficticio de la semilla para esa área (o el admin), como lo da getUsuarioActual(). */
export async function usuario(prisma: Cliente, codigo: CodigoUsuario): Promise<UsuarioPermisos> {
  const cuil = codigo === "ADMIN" ? ADMIN_CUIL : USUARIOS_FICTICIOS.find((u) => u.area === codigo)?.cuil;
  const fila = await prisma.usuario.findUniqueOrThrow({
    where: { cuil },
    select: { id: true, rol: true, activo: true, area: { select: { id: true, codigo: true } } },
  });
  if (!esRol(fila.rol)) throw new Error(`Rol desconocido: ${fila.rol}`);
  return { id: fila.id, rol: fila.rol, activo: fila.activo, area: fila.area };
}

export async function idArea(prisma: Cliente, codigo: string): Promise<number> {
  return (await prisma.area.findUniqueOrThrow({ where: { codigo }, select: { id: true } })).id;
}

export async function idPlantilla(prisma: Cliente, codigo: string): Promise<number> {
  return (await prisma.plantilla.findFirstOrThrow({ where: { codigo, estado: "publicada" }, select: { id: true } })).id;
}

export async function idCementerio(prisma: Cliente, codigo: string): Promise<number> {
  return (await prisma.cementerio.findUniqueOrThrow({ where: { codigo }, select: { id: true } })).id;
}

export const comando = (): string => randomUUID();

let contador = 0;
/** Letras únicas para apellidos y padrones (sin dígitos: no se confunden con números en la búsqueda). */
export function unicoLetras(prefijo = ""): string {
  contador += 1;
  const n = `${Date.now().toString(36)}${process.pid.toString(36)}${contador.toString(36)}`;
  return `${prefijo}${n.replace(/[0-9]/g, (d) => "QWERTYUIOP"[Number(d)]).toUpperCase()}`;
}

let lote = 0;
/** Un lote ficticio único (entero), para que dos altas no caigan en el mismo espacio. */
export function loteUnico(): string {
  lote += 1;
  return String(100_000 + ((Date.now() % 800_000) * 10 + lote) % 900_000);
}

let cuit = 0;
/**
 * Un CUIT ficticio de persona jurídica único, 30-98NNNNNN-D, con dígito
 * verificador válido (lo exige la base). El rango 30-98… no está asignado.
 */
export function cuitUnico(): string {
  for (;;) {
    cuit += 1;
    const base = `3098${String(((Date.now() % 100_000) * 10 + cuit) % 1_000_000).padStart(6, "0")}`;
    const digito = digitoVerificadorCuil(base);
    if (digito !== null) return `${base}${digito}`;
  }
}

let dni = 0;
/** DNI ficticio único en el rango 98.xxx.xxx. */
export function dniUnico(): string {
  dni += 1;
  return String(98_000_000 + ((Date.now() % 900_000) * 10 + dni) % 1_000_000);
}

export function titular(extra: Partial<PersonaEntrada> = {}): PersonaEntrada {
  return {
    rol: "titular",
    apellido: unicoLetras("FICTICIO "),
    nombres: "Titular Prueba",
    dni: dniUnico(),
    telefono: "0381 000-1234",
    telefonoWhatsapp: true,
    email: "titular@ejemplo.test",
    domicilio: "Calle Ficticia 123",
    ...extra,
  };
}

/**
 * Una ubicación válida en la nomenclatura de cada cementerio (docs/fuentes):
 * Oeste, sección A a H; Jardín, en romanos; Norte, la provisoria con cuadro.
 * El lote, único, evita avisos de duplicado entre tests.
 */
export function ubicacionDe(cementerio: string): Record<string, string> {
  const lote = loteUnico();
  if (cementerio === "OESTE") return { seccion: "ABCDEFGH"[Math.floor(Math.random() * 8)], lote };
  if (cementerio === "JARDIN_NORTE") return { seccion: ["I", "IV", "IX", "XII", "XXX"][Math.floor(Math.random() * 5)], lote };
  return { seccion: String(1 + Math.floor(Math.random() * 900)), cuadro: unicoLetras("").slice(-2), lote };
}

/** Un alta válida de RENOV_CONTADO en el Oeste, con hoy como fecha de inicio. */
export async function datosAlta(prisma: Cliente, cambios: Partial<DatosAlta> & { plantilla?: string; cementerio?: string } = {}): Promise<DatosAlta> {
  const { plantilla = "RENOV_CONTADO", cementerio = "OESTE", ...resto } = cambios;
  return {
    plantillaId: await idPlantilla(prisma, plantilla),
    cementerioId: await idCementerio(prisma, cementerio),
    tipoMonumento: "SEPULTURA",
    ubicacion: ubicacionDe(cementerio),
    padron: unicoLetras("PAD-"),
    personas: [titular()],
    fechaInicio: hoyEnTucuman(),
    ...resto,
  };
}

/**
 * Simula un pase (la semana 3 lo hace de verdad): inserta el movimiento `pase`
 * y mueve la proyección al paso destino, como lo haría la acción.
 */
export async function simularPase(
  prisma: Cliente,
  numero: string,
  quien: UsuarioPermisos,
  paso: { clave: string; orden: number; area: string },
  fechaEfectiva: Date = new Date(),
): Promise<void> {
  await conActorEn(prisma, quien.id, "Pase simulado en un test", async (tx: Transaccion) => {
    const e = await tx.expediente.findUniqueOrThrow({ where: { numeroInterno: numero } });
    const destino = await tx.area.findUniqueOrThrow({ where: { codigo: paso.area } });
    const ahora = fechaEfectiva;
    await tx.movimiento.create({
      data: {
        expedienteId: e.id,
        tipo: "pase",
        fechaEfectiva: ahora,
        usuarioId: quien.id,
        pasoOrigen: e.pasoClave,
        pasoDestino: paso.clave,
        areaOrigenId: e.areaActualId,
        areaDestinoId: destino.id,
        comandoId: randomUUID(),
      },
    });
    await tx.expediente.update({
      where: { id: e.id },
      data: {
        pasoClave: paso.clave,
        pasoOrden: paso.orden,
        areaActualId: destino.id,
        areaResponsableId: destino.id,
        enAreaDesde: ahora,
        recibidoEn: null,
        version: { increment: 1 },
      },
    });
  });
}

/** Cambia el estado a mano (los tests de las semanas 2 y 3; la semana 4 tiene las acciones). */
export async function forzarEstado(prisma: Cliente, numero: string, estado: "archivado" | "anulado" | "concluido"): Promise<void> {
  await conActorEn(prisma, 1, "Estado forzado en un test", (tx) =>
    tx.expediente.update({
      where: { numeroInterno: numero },
      data: {
        estado,
        estadoPrevio: estado === "concluido" ? null : "en_tramite",
        ubicacionArchivo: estado === "archivado" ? "Caja de prueba" : null,
      },
    }),
  );
}

// ---------------------------------------------------------------------------
// Semana 3: recorrer el flujo con el dominio
// ---------------------------------------------------------------------------

/** El usuario de la semilla del área responsable del expediente (en un paso externo, la custodia). */
export async function responsable(prisma: Cliente, numero: string): Promise<UsuarioPermisos> {
  const e = await prisma.expediente.findUniqueOrThrow({
    where: { numeroInterno: numero },
    select: { areaResponsable: { select: { codigo: true } } },
  });
  return usuario(prisma, e.areaResponsable.codigo as CodigoUsuario);
}

/** La definición del expediente como la ve el dominio: resuelta para su cementerio y sus personas. */
export async function definicionDe(prisma: Cliente, numero: string): Promise<DefinicionPlantilla> {
  const e = await prisma.expediente.findUniqueOrThrow({
    where: { numeroInterno: numero },
    select: { id: true, cementerioId: true, plantilla: { select: { definicion: true, codigo: true, version: true } } },
  });
  return definicionDelExpediente(prisma, e, e.plantilla);
}

export interface OpcionesPaso {
  /** Fecha para las subtareas con `dato: fecha` (por defecto, hoy). */
  fecha?: string;
}

/**
 * Hace, como el responsable, lo que falta para salir del paso actual: tilda
 * las subtareas (con fecha o con un texto) y marca presentados los
 * documentos. Devuelve la versión final.
 */
export async function completarPaso(exp: ServicioExpedientes, prisma: Cliente, numero: string, opciones: OpcionesPaso = {}): Promise<number> {
  const quien = await responsable(prisma, numero);
  const def = await definicionDe(prisma, numero);
  const v = await exp.validarPase(quien, numero);
  let version = v.version;
  for (const f of v.faltan) {
    if (f.tipo === "subtarea") {
      const s = def.pasos.flatMap((p) => p.subtareas).find((x) => x.clave === f.clave);
      const dato = s?.dato === "fecha" ? (opciones.fecha ?? hoyEnTucuman()) : s?.dato === "texto" ? `N-${f.clave}` : null;
      version = (await exp.tildarSubtarea(quien, numero, f.clave, dato, version, comando())).version;
    } else if (f.tipo === "documento") {
      version = (await exp.marcarDocumento(quien, numero, f.clave, "presentado", null, version, comando())).version;
    } else {
      throw new Error(`completarPaso: falta el campo extra ${f.clave}`);
    }
  }
  return version;
}

/** Completa el paso y da el pase al siguiente, como el responsable. */
export async function avanzar(
  exp: ServicioExpedientes,
  prisma: Cliente,
  numero: string,
  opciones: OpcionesPaso & { fechaPase?: string } = {},
): Promise<ResultadoPase> {
  const version = await completarPaso(exp, prisma, numero, opciones);
  const quien = await responsable(prisma, numero);
  const v = await exp.validarPase(quien, numero);
  const siguiente = v.destinos.find((d) => d.tipo === "siguiente");
  if (!siguiente) throw new Error(`avanzar: ${numero} no tiene paso siguiente`);
  return exp.darPase(quien, numero, siguiente.clave, version, comando(), { fechaEfectiva: opciones.fechaPase });
}

/** La fila del expediente, para mirar la proyección. */
export function proyeccion(prisma: Cliente, numero: string) {
  return prisma.expediente.findUniqueOrThrow({
    where: { numeroInterno: numero },
    include: { areaActual: { select: { codigo: true } }, areaResponsable: { select: { codigo: true } } },
  });
}

/** Los movimientos del expediente, en orden. */
export async function movimientos(prisma: Cliente, numero: string) {
  const e = await prisma.expediente.findUniqueOrThrow({ where: { numeroInterno: numero }, select: { id: true } });
  return prisma.movimiento.findMany({ where: { expedienteId: e.id }, orderBy: { secuencia: "asc" } });
}

// ---------------------------------------------------------------------------
// Semana 4
// ---------------------------------------------------------------------------

/**
 * La proyección del flujo tal como está en la base y tal como la reconstruye
 * el historial (reconstruccion.ts), en la misma forma, para compararlas:
 * `expect(c.actual).toEqual(c.reconstruida)`. Es la conciliación por replay
 * de la fase 2, en chico: si una acción escribe la proyección distinto de lo
 * que dice su movimiento, acá se ve.
 */
export async function conciliacion(prisma: Cliente, numero: string) {
  const e = await prisma.expediente.findUniqueOrThrow({ where: { numeroInterno: numero } });
  const def = await definicionDe(prisma, numero);
  const p = reconstruirProyeccion(def, await cargarMovimientos(prisma, e.id), await entornoReconstruccion(prisma));
  const actual: ProyeccionFlujo = {
    estado: e.estado,
    estadoPrevio: e.estadoPrevio,
    ubicacionArchivo: e.ubicacionArchivo,
    pasoClave: e.pasoClave,
    pasoOrden: e.pasoOrden,
    pasoRetornoClave: e.pasoRetornoClave,
    areaActualId: e.areaActualId,
    areaResponsableId: e.areaResponsableId,
    enAreaDesde: e.enAreaDesde,
    recibidoEn: e.recibidoEn,
    plazoDesde: fechaDesdeDb(e.plazoDesde),
    plazoDiasHabiles: e.plazoDiasHabiles,
    plazoCumplidoEn: fechaDesdeDb(e.plazoCumplidoEn),
    items: leerItems(e.items),
    cargaHistorica: e.cargaHistorica,
  };
  return { actual: proyeccionComparable(actual), reconstruida: proyeccionComparable({ ...p, items: leerItems(p.items) }) };
}

/** Las columnas del flujo de la proyección, para comparar "antes" y "después" de una corrección. */
export async function flujo(prisma: Cliente, numero: string) {
  return (await conciliacion(prisma, numero)).actual;
}

/** Publica una plantilla de prueba (código único) con esa definición. */
export async function plantillaDePrueba(prisma: Cliente, definicion: DefinicionPlantillaEntrada, nombre: string, tipoTramite = "RENOVACION"): Promise<number> {
  const codigo = `PRUEBA_${Date.now().toString(36).toUpperCase()}_${unicoLetras()}`.slice(0, 60);
  const tipo = await prisma.tipoTramite.findUniqueOrThrow({ where: { codigo: tipoTramite }, select: { id: true } });
  return conActorEn(prisma, 1, "Plantilla de prueba", async (tx) => {
    const p = await tx.plantilla.create({
      data: { codigo, version: 1, tipoTramiteId: tipo.id, nombre, definicion: definicion as object, creadoPor: 1 },
      select: { id: true },
    });
    await tx.plantilla.update({
      where: { id: p.id },
      data: { estado: "publicada", publicadoEn: new Date(), publicadoPor: 1, notasCambio: "Prueba de integración" },
    });
    return p.id;
  });
}

/** Lleva un expediente hasta su último paso, como los responsables. */
export async function hastaElUltimoPaso(exp: ServicioExpedientes, prisma: Cliente, numero: string, opciones: OpcionesPaso = {}): Promise<number> {
  const total = (await definicionDe(prisma, numero)).pasos.length;
  let e = await proyeccion(prisma, numero);
  while (e.pasoOrden < total) {
    await avanzar(exp, prisma, numero, opciones);
    e = await proyeccion(prisma, numero);
  }
  return e.version;
}
