// Ayudas para los tests del dominio de expedientes (semana 2).
//
// A diferencia de escenario.ts, estos tests usan la semilla real (áreas con sus
// códigos, las 4 plantillas, los usuarios ficticios por área): las reglas de
// permisos miran el código de área (MESA_ENTRADAS, COMPUTO…) y las plantillas
// apuntan a esas áreas. `asegurarSemilla()` la corre (es idempotente), así que
// el orden de los archivos no importa. Lo que se crea con el dominio se
// CONFIRMA: cada test usa nombres, padrones y números únicos y no cuenta filas
// globales.

import { randomUUID } from "node:crypto";
import { sembrar } from "../../prisma/semilla/sembrar";
import { USUARIOS_FICTICIOS } from "../../prisma/semilla/usuarios";
import { conActorEn } from "@/lib/db/actor";
import type { Cliente, Transaccion } from "@/lib/db/crear-cliente";
import { crearServicioExpedientes, type DatosAlta, type PersonaEntrada, type ServicioExpedientes } from "@/lib/dominio/expedientes";
import { esRol, type UsuarioPermisos } from "@/lib/dominio/permisos";
import { hoyEnTucuman } from "@/lib/fechas";

/** El mismo CUIL de admin que usa semilla.test.ts. */
export const ADMIN_CUIL = "20000000001";

export async function asegurarSemilla(prisma: Cliente): Promise<void> {
  await sembrar(prisma, { adminCuil: ADMIN_CUIL });
}

export function servicio(prisma: Cliente, ahora?: () => Date): ServicioExpedientes {
  return crearServicioExpedientes({
    leer: prisma,
    escribir: (usuarioId, motivo, fn) => conActorEn(prisma, usuarioId, motivo, fn),
    ahora,
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

/** Un alta válida de RENOV_CONTADO en el Oeste, con hoy como fecha de inicio. */
export async function datosAlta(prisma: Cliente, cambios: Partial<DatosAlta> & { plantilla?: string; cementerio?: string } = {}): Promise<DatosAlta> {
  const { plantilla = "RENOV_CONTADO", cementerio = "OESTE", ...resto } = cambios;
  return {
    plantillaId: await idPlantilla(prisma, plantilla),
    cementerioId: await idCementerio(prisma, cementerio),
    tipoMonumento: "SEPULTURA",
    ubicacion: { seccion: String(1 + Math.floor(Math.random() * 900)), cuadro: unicoLetras("").slice(-2), lote: "7" },
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

/** Cambia el estado a mano (archivar y anular son de la semana 4). */
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
