// La semilla como función, para correrla desde prisma/seed.ts y desde los tests
// de integración contra la base efímera.
//
// IDEMPOTENTE: crea lo que falta y no toca lo que ya existe. Se puede correr
// sobre una base recién reseteada (db:reset) o sobre una con datos, las veces
// que haga falta: la segunda corrida no inserta nada y no deja filas en la
// auditoría. Lo que ya existe se reconoce por su clave natural (código de área,
// de cementerio, de tipo; fecha del feriado; año; CUIL; código y versión de la
// plantilla). "No tocar" es a propósito:
// - la app no tiene DELETE sobre los catálogos ni sobre usuarios, así que una
//   semilla que "sincroniza" igual no podría borrar lo que sobra;
// - una plantilla publicada está congelada (plantillas_congelar): si la v1 de
//   la base no coincide con la de la semilla, se avisa y se sigue. Para tomar
//   la semilla nueva: npm run db:reset.
//
// Escribe con el rol de la app y como SISTEMA (id 1), en UNA transacción: o
// queda todo o no queda nada.

import { isDeepStrictEqual } from "node:util";
import type { Prisma } from "../../src/generated/prisma/client";
import { conActorEn } from "../../src/lib/db/actor";
import type { Cliente, Transaccion } from "../../src/lib/db/crear-cliente";
import { cuilValido } from "../../src/lib/dominio/cuil";
import type { DefinicionPlantilla } from "../../src/lib/dominio/plantillas/esquema";
import { validarPublicacion } from "../../src/lib/dominio/plantillas/validar";
import { AREAS } from "./areas";
import { TIPOS_MONUMENTO, TIPOS_TRAMITE } from "./catalogos";
import { CEMENTERIOS } from "./cementerios";
import { ANIOS_FERIADOS, FERIADOS } from "./feriados";
import { NOTAS_CARGA_INICIAL, PLANTILLAS } from "./plantillas";
import { ADMIN_NOMBRE, USUARIOS_FICTICIOS } from "./usuarios";

/** Id del usuario técnico SISTEMA (lo inserta la migración reglas_base). */
export const SISTEMA = 1;

const MOTIVO = "Semilla (prisma/semilla)";

export interface OpcionesSemilla {
  /** CUIL del primer administrador (ADMIN_INICIAL_CUIL): 11 dígitos. */
  adminCuil: string;
  /** Un usuario ficticio por área. Solo desarrollo y staging. Por defecto, sí. */
  usuariosFicticios?: boolean;
}

export interface ResumenSemilla {
  /** Filas insertadas en esta corrida, por tabla (0 = ya estaban). */
  creados: {
    areas: number;
    tiposMonumento: number;
    tiposTramite: number;
    cementerios: number;
    feriados: number;
    feriadosAnios: number;
    usuarios: number;
    plantillas: number;
  };
  /** Lo que ya existía y no coincide con la semilla. */
  avisos: string[];
}

export async function sembrar(cliente: Cliente, opciones: OpcionesSemilla): Promise<ResumenSemilla> {
  const adminCuil = opciones.adminCuil.trim();
  const ficticios = opciones.usuariosFicticios ?? true;
  controlarUsuarios(adminCuil, ficticios);

  return conActorEn(
    cliente,
    SISTEMA,
    MOTIVO,
    async (tx) => {
      const avisos: string[] = [];
      const sistema = await tx.usuario.findUnique({ where: { id: SISTEMA } });
      if (!sistema || sistema.apellido !== "SISTEMA") {
        throw new Error("No está el usuario SISTEMA (id 1): ¿se aplicaron las migraciones? npm run db:deploy");
      }

      // --- Catálogos ------------------------------------------------------------
      const areas = await tx.area.createMany({ data: [...AREAS], skipDuplicates: true });
      const tiposMonumento = await tx.tipoMonumento.createMany({ data: [...TIPOS_MONUMENTO], skipDuplicates: true });
      const tiposTramite = await tx.tipoTramite.createMany({ data: [...TIPOS_TRAMITE], skipDuplicates: true });

      const idArea = await mapaDeIds(tx, "area");
      const cementerios = await tx.cementerio.createMany({
        data: CEMENTERIOS.map((c) => ({
          codigo: c.codigo,
          nombre: c.nombre,
          areaId: obtener(idArea, c.area, "área"),
          camposUbicacion: c.camposUbicacion,
          tiposMonumento: c.tiposMonumento,
        })),
        skipDuplicates: true,
      });

      // --- Feriados ---------------------------------------------------------------
      const feriados = await tx.feriado.createMany({
        // Prisma escribe un @db.Date con la fecha UTC del Date: medianoche UTC
        // de ese día, sea cual sea la zona del proceso.
        data: FERIADOS.map((f) => ({ ...f, fecha: new Date(`${f.fecha}T00:00:00.000Z`) })),
        skipDuplicates: true,
      });
      // Abiertos: falta lo que confirma la Dirección (ver feriados.ts).
      const feriadosAnios = await tx.feriadoAnio.createMany({
        data: ANIOS_FERIADOS.map((anio) => ({ anio, cerrado: false })),
        skipDuplicates: true,
      });

      // --- Usuarios ---------------------------------------------------------------
      let usuarios = 0;
      if (ficticios) {
        const r = await tx.usuario.createMany({
          data: USUARIOS_FICTICIOS.map((u) => ({
            cuil: u.cuil,
            nombre: u.nombre,
            apellido: u.apellido,
            areaId: obtener(idArea, u.area, "área"),
            rol: u.rol,
          })),
          skipDuplicates: true,
        });
        usuarios += r.count;
      }
      const admin = await tx.usuario.findUnique({ where: { cuil: adminCuil } });
      if (!admin) {
        await tx.usuario.create({ data: { cuil: adminCuil, ...ADMIN_NOMBRE, areaId: null, rol: "admin" } });
        usuarios += 1;
      } else if (admin.rol !== "admin" || !admin.activo) {
        avisos.push(`El CUIL de ADMIN_INICIAL_CUIL ya existe como ${admin.rol}${admin.activo ? "" : " inactivo"}: no se cambia.`);
      }

      // --- Plantillas -------------------------------------------------------------
      const plantillas = await sembrarPlantillas(tx, avisos);

      return {
        creados: {
          areas: areas.count,
          tiposMonumento: tiposMonumento.count,
          tiposTramite: tiposTramite.count,
          cementerios: cementerios.count,
          feriados: feriados.count,
          feriadosAnios: feriadosAnios.count,
          usuarios,
          plantillas,
        },
        avisos,
      };
    },
    // Unas 30 sentencias; el margen es para máquinas lentas o un antivirus.
    { timeout: 60_000 },
  );
}

/**
 * Cada definición pasa la misma validación que "Publicar" (esquema e
 * integridad) contra los catálogos tal como quedaron en la base; si alguna
 * falla, la semilla entera se deshace.
 */
async function sembrarPlantillas(tx: Transaccion, avisos: string[]): Promise<number> {
  const catalogos = {
    areas: await tx.area.findMany(),
    tiposMonumento: await tx.tipoMonumento.findMany(),
  };
  const idTipoTramite = await mapaDeIds(tx, "tipoTramite");
  let creadas = 0;

  for (const p of PLANTILLAS) {
    const r = validarPublicacion(p.definicion, catalogos);
    if (!r.ok) {
      const detalle = r.errores.map((e) => `  - [${e.regla}] ${e.ruta}: ${e.mensaje}`).join("\n");
      throw new Error(`La plantilla ${p.codigo} de la semilla no pasa la validación de Publicar:\n${detalle}`);
    }
    const tipoTramiteId = obtener(idTipoTramite, p.tipoTramite, "tipo de trámite");

    const versiones = await tx.plantilla.findMany({ where: { codigo: p.codigo }, orderBy: { version: "asc" } });
    if (versiones.length > 0) {
      const v1 = versiones.find((v) => v.version === 1);
      if (!v1) {
        avisos.push(`La plantilla ${p.codigo} tiene versiones pero no la 1: no se toca.`);
      } else if (
        !isDeepStrictEqual(v1.definicion, r.definicion) ||
        v1.nombre !== p.nombre ||
        v1.tipoTramiteId !== tipoTramiteId
      ) {
        avisos.push(`La plantilla ${p.codigo} v1 de la base no coincide con la semilla (está congelada). Para tomar la nueva: npm run db:reset.`);
      }
      continue;
    }

    // Como lo hará "Publicar": primero el borrador y después la transición,
    // que es la que controla el trigger plantillas_congelar.
    const borrador = await tx.plantilla.create({
      data: {
        codigo: p.codigo,
        version: 1,
        tipoTramiteId,
        nombre: p.nombre,
        estado: "borrador",
        definicion: comoJson(r.definicion),
        notasCambio: NOTAS_CARGA_INICIAL,
        creadoPor: SISTEMA,
      },
    });
    await tx.plantilla.update({
      where: { id: borrador.id },
      data: { estado: "publicada", publicadoPor: SISTEMA, publicadoEn: new Date() },
    });
    creadas += 1;
  }
  return creadas;
}

/** Antes de abrir la transacción: un CUIL mal escrito no tiene que llegar a la base. */
function controlarUsuarios(adminCuil: string, ficticios: boolean): void {
  if (!/^[0-9]{11}$/.test(adminCuil)) {
    throw new Error(`ADMIN_INICIAL_CUIL tiene que ser de 11 dígitos, sin guiones (llegó "${adminCuil}")`);
  }
  if (!ficticios) return;
  for (const u of USUARIOS_FICTICIOS) {
    if (!cuilValido(u.cuil)) throw new Error(`CUIL ficticio con dígito verificador inválido: ${u.cuil}`);
    if (u.cuil === adminCuil) {
      throw new Error(`ADMIN_INICIAL_CUIL (${adminCuil}) es el de un usuario ficticio de la semilla: usá otro.`);
    }
  }
}

async function mapaDeIds(tx: Transaccion, tabla: "area" | "tipoTramite"): Promise<Map<string, number>> {
  const filas = tabla === "area" ? await tx.area.findMany() : await tx.tipoTramite.findMany();
  return new Map(filas.map((f) => [f.codigo, f.id]));
}

function obtener(mapa: Map<string, number>, codigo: string, que: string): number {
  const id = mapa.get(codigo);
  if (id === undefined) throw new Error(`La semilla usa el ${que} ${codigo}, que no existe`);
  return id;
}

function comoJson(definicion: DefinicionPlantilla): Prisma.InputJsonValue {
  return definicion;
}
