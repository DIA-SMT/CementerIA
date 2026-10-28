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
//
// Contraseñas (login propio, 27/10/2026):
// - con los usuarios ficticios (desarrollo y staging), ellos y el admin tienen
//   CLAVE_DESARROLLO (./usuarios.ts, documentada en el README), sin cambio
//   obligatorio: así se prueba el formulario real además de /dev/login;
// - sin ficticios (producción), el admin inicial nace con una contraseña
//   TEMPORAL y `debe_cambiar_clave`. La semilla la devuelve
//   (`claveAdminInicial`) y prisma/seed.ts la escribe en un archivo local y la
//   imprime una sola vez. En la base queda solo el hash.
// Lo que ya tiene contraseña no se toca. A un usuario de la semilla que exista
// SIN contraseña (una base anterior al login propio) se le pone la que
// corresponde.

import { isDeepStrictEqual } from "node:util";
import type { Prisma } from "../../src/generated/prisma/client";
import { generarClaveTemporal, hashearClave } from "../../src/lib/auth/clave";
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
import { sembrarPreguntasFrecuentes } from "./sitio-publico";
import { ADMIN_NOMBRE, CLAVE_DESARROLLO, USUARIOS_FICTICIOS } from "./usuarios";

/** Id del usuario técnico SISTEMA (lo inserta la migración reglas_base). */
export const SISTEMA = 1;

const MOTIVO = "Semilla (prisma/semilla)";

export interface OpcionesSemilla {
  /** CUIL del primer administrador (ADMIN_INICIAL_CUIL): 11 dígitos. */
  adminCuil: string;
  /** Un usuario ficticio por área. Solo desarrollo y staging. Por defecto, sí. */
  usuariosFicticios?: boolean;
  /** La contraseña de los usuarios de desarrollo (con ficticios). Por defecto, CLAVE_DESARROLLO. */
  claveDesarrollo?: string;
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
    /** Las preguntas frecuentes de la página pública (28/10/2026, ./sitio-publico.ts). */
    preguntasFrecuentes: number;
  };
  /** Lo que ya existía y no coincide con la semilla. */
  avisos: string[];
  /**
   * Sin ficticios (producción): la contraseña TEMPORAL que se le acaba de poner
   * al admin inicial, para mostrarla una sola vez. `null` si no se le puso
   * ninguna (ya tenía, o es desarrollo).
   */
  claveAdminInicial: string | null;
}

export async function sembrar(cliente: Cliente, opciones: OpcionesSemilla): Promise<ResumenSemilla> {
  const adminCuil = opciones.adminCuil.trim();
  const ficticios = opciones.usuariosFicticios ?? true;
  controlarUsuarios(adminCuil, ficticios);

  // Los hashes antes de la transacción: scrypt tarda (a propósito). Uno por
  // usuario, cada uno con su sal. Si después resulta que ya tenían, se descartan.
  const claveDesarrollo = opciones.claveDesarrollo ?? CLAVE_DESARROLLO;
  const hashesFicticios = ficticios ? await Promise.all(USUARIOS_FICTICIOS.map(() => hashearClave(claveDesarrollo))) : [];
  const claveAdmin = ficticios ? claveDesarrollo : generarClaveTemporal();
  const hashAdmin = await hashearClave(claveAdmin);
  const ahora = new Date();

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
      // Los que ya estaban no se tocan (pueden haberse editado en Catálogos),
      // pero se avisa si la semilla cambió: la nomenclatura y los monumentos de
      // la semana 4 (docs/fuentes) no llegan a una base sembrada antes.
      for (const c of await tx.cementerio.findMany({ where: { codigo: { in: CEMENTERIOS.map((x) => x.codigo) } } })) {
        const semilla = CEMENTERIOS.find((x) => x.codigo === c.codigo);
        if (semilla && (!isDeepStrictEqual(c.camposUbicacion, semilla.camposUbicacion) || !isDeepStrictEqual(c.tiposMonumento, semilla.tiposMonumento))) {
          avisos.push(`El cementerio ${c.codigo} de la base no coincide con la semilla (nomenclatura o tipos de monumento): no se cambia. Para tomar la nueva: npm run db:reset.`);
        }
      }

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
          data: USUARIOS_FICTICIOS.map((u, i) => ({
            cuil: u.cuil,
            nombre: u.nombre,
            apellido: u.apellido,
            areaId: obtener(idArea, u.area, "área"),
            rol: u.rol,
            claveHash: hashesFicticios[i],
            claveCambiadaEn: ahora,
          })),
          skipDuplicates: true,
        });
        usuarios += r.count;
        // Una base de antes del login propio: los ficticios sin contraseña reciben la de desarrollo.
        for (const [i, u] of USUARIOS_FICTICIOS.entries()) {
          await tx.usuario.updateMany({ where: { cuil: u.cuil, claveHash: null }, data: { claveHash: hashesFicticios[i], claveCambiadaEn: ahora } });
        }
      }
      // Desarrollo: la de desarrollo, sin cambio obligatorio. Producción: una temporal.
      const datosClaveAdmin = { claveHash: hashAdmin, debeCambiarClave: !ficticios, claveCambiadaEn: ahora };
      let claveAdminInicial: string | null = null;
      const admin = await tx.usuario.findUnique({ where: { cuil: adminCuil } });
      if (!admin) {
        await tx.usuario.create({ data: { cuil: adminCuil, ...ADMIN_NOMBRE, areaId: null, rol: "admin", ...datosClaveAdmin } });
        usuarios += 1;
        claveAdminInicial = ficticios ? null : claveAdmin;
      } else if (admin.rol !== "admin" || !admin.activo) {
        avisos.push(`El CUIL de ADMIN_INICIAL_CUIL ya existe como ${admin.rol}${admin.activo ? "" : " inactivo"}: no se cambia.`);
      } else if (admin.claveHash === null) {
        // Un admin de antes del login propio, sin contraseña: no podría ingresar.
        await tx.usuario.update({ where: { id: admin.id }, data: datosClaveAdmin });
        claveAdminInicial = ficticios ? null : claveAdmin;
      }

      // --- Plantillas -------------------------------------------------------------
      const plantillas = await sembrarPlantillas(tx, avisos);

      // --- Sitio público (28/10/2026) ---------------------------------------------
      // Solo las preguntas frecuentes: lo demás lo carga la Dirección.
      const preguntasFrecuentes = await sembrarPreguntasFrecuentes(tx);

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
          preguntasFrecuentes,
        },
        avisos,
        claveAdminInicial,
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
    cementerios: await tx.cementerio.findMany(),
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
        notasCambio: p.notasCambio ?? NOTAS_CARGA_INICIAL,
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
