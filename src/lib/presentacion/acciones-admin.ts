import { z } from "zod";
import type { ServicioAdmin } from "@/lib/dominio/admin";
import type { ServicioExpedientes } from "@/lib/dominio/expedientes";
import type { ErrorCampo } from "@/lib/dominio/expedientes/errores";
import type { UsuarioPermisos } from "@/lib/dominio/permisos";
import { leerEntrada, vacioANull } from "./acciones";
import { estadoDeError, type EstadoError } from "./errores";
import { leerFiltrosAuditoria } from "./auditoria";
import { parametrosDe } from "./exportar-http";
import { RUTA_PLANTILLAS, rutaVersionPlantilla } from "./rutas-admin";

/**
 * La lógica de las Server Actions de `/admin/*` (semana 5), sin Next, como
 * ./acciones.ts y ./acciones-estados.ts: cada una vuelve a validar la forma de
 * la entrada (llega del navegador: cualquiera puede mandar un POST a una
 * Server Action), llama al dominio de administración y traduce sus errores a
 * un estado serializable. Las reglas son del dominio. Los tests de integración
 * las llaman con el servicio de la base de prueba
 * (tests/integracion/pantallas-admin.test.ts).
 */

export { RUTA_PLANTILLAS, rutaVersionPlantilla };

export type ResultadoAdmin = { ok: true; mensaje: string; repetido: boolean } | EstadoError;

/**
 * Lo de un usuario: como ResultadoAdmin, más la contraseña temporal del alta o
 * del blanqueo, que la pantalla muestra UNA sola vez (no se guarda en ningún
 * lado: en la base queda solo el hash).
 */
export type ResultadoUsuarioAdmin = { ok: true; mensaje: string; repetido: boolean; claveTemporal?: string } | EstadoError;
export type ResultadoNavegacionAdmin = { ok: true; destino: string; mensaje: string } | EstadoError;

const Codigo = z.string().min(1).max(60);
const Version = z.int().min(1).max(32_767);
const Huella = z.string().max(100);
const Motivo = z.string().max(2000).nullish();

// ---------------------------------------------------------------------------
// Plantillas
// ---------------------------------------------------------------------------

const EntradaNueva = z.object({ codigo: z.string().max(80), tipoTramiteId: z.int().positive(), nombre: z.string().max(400) });
export type EntradaNuevaPlantilla = z.input<typeof EntradaNueva>;

/** "Nueva": crea el borrador v1 y lleva al editor. */
export async function procesarNuevaPlantilla(servicio: ServicioAdmin, usuario: UsuarioPermisos, valor: unknown): Promise<ResultadoNavegacionAdmin> {
  try {
    const d = leerEntrada(EntradaNueva, valor);
    const r = await servicio.crearPlantilla(usuario, d);
    return { ok: true, destino: rutaVersionPlantilla(r.codigo, r.version), mensaje: `Borrador ${r.codigo} v${r.version} creado.` };
  } catch (e) {
    return estadoDeError(e);
  }
}

const EntradaCodigo = z.object({ codigo: Codigo });

/** "Editar": el borrador v+1 (o el que ya había) y lleva al editor. */
export async function procesarEditarPlantilla(servicio: ServicioAdmin, usuario: UsuarioPermisos, valor: unknown): Promise<ResultadoNavegacionAdmin> {
  try {
    const d = leerEntrada(EntradaCodigo, valor);
    const r = await servicio.editarPlantilla(usuario, d.codigo);
    return { ok: true, destino: rutaVersionPlantilla(r.codigo, r.version), mensaje: r.repetido ? `Ya había un borrador: v${r.version}.` : `Borrador v${r.version} creado a partir de la versión publicada.` };
  } catch (e) {
    return estadoDeError(e);
  }
}

const EntradaContenido = z.object({
  codigo: Codigo,
  version: Version,
  nombre: z.string().max(400),
  /** La definición tal como está en el editor; el dominio le da la forma. */
  definicion: z.record(z.string(), z.unknown()),
  huella: Huella,
});
export type EntradaContenidoBorrador = z.input<typeof EntradaContenido>;

export type ResultadoGuardadoPantalla = { ok: true; huella: string; repetido: boolean; pendientes: number; mensaje: string } | EstadoError;

/** "Guardar borrador": devuelve la huella nueva para el próximo guardado. */
export async function procesarGuardarBorrador(servicio: ServicioAdmin, usuario: UsuarioPermisos, valor: unknown): Promise<ResultadoGuardadoPantalla> {
  try {
    const d = leerEntrada(EntradaContenido, valor);
    const r = await servicio.guardarBorrador(usuario, d.codigo, d.version, { nombre: d.nombre, definicion: d.definicion }, d.huella);
    const pendientes = r.pendientes === 0 ? "Pasa la validación: se puede publicar." : `Para publicar ${r.pendientes === 1 ? "falta corregir 1 cosa" : `faltan corregir ${r.pendientes} cosas`} (Validar las muestra).`;
    return { ok: true, huella: r.huella, repetido: r.repetido, pendientes: r.pendientes, mensaje: `${r.repetido ? "No había cambios para guardar." : "Borrador guardado."} ${pendientes}` };
  } catch (e) {
    return estadoDeError(e);
  }
}

const EntradaValidar = z.object({ nombre: z.string().max(400), definicion: z.record(z.string(), z.unknown()) });

export type ResultadoValidacion = { ok: true; errores: ErrorCampo[]; mensaje: string } | EstadoError;

/** "Validar": los errores de "Publicar" para lo que está en pantalla (no guarda). */
export async function procesarValidarBorrador(servicio: ServicioAdmin, usuario: UsuarioPermisos, valor: unknown): Promise<ResultadoValidacion> {
  try {
    const d = leerEntrada(EntradaValidar, valor);
    const r = await servicio.validarBorrador(usuario, d);
    return {
      ok: true,
      errores: r.errores,
      mensaje: r.ok ? "La plantilla pasa la validación: se puede publicar." : `${r.errores.length === 1 ? "Hay 1 error" : `Hay ${r.errores.length} errores`}: están marcados en cada pestaña.`,
    };
  } catch (e) {
    return estadoDeError(e);
  }
}

const EntradaPublicar = EntradaContenido.extend({ notas: z.string().max(4000).nullish() });
export type EntradaPublicarBorrador = z.input<typeof EntradaPublicar>;

/** "Publicar" con sus notas de cambio; lleva a la versión publicada. */
export async function procesarPublicar(servicio: ServicioAdmin, usuario: UsuarioPermisos, valor: unknown): Promise<ResultadoNavegacionAdmin> {
  try {
    const d = leerEntrada(EntradaPublicar, valor);
    const r = await servicio.publicarBorrador(usuario, d.codigo, d.version, { nombre: d.nombre, definicion: d.definicion }, d.huella, vacioANull(d.notas));
    const retiro = r.retirada !== null ? ` La v${r.retirada} quedó retirada: sus expedientes en curso siguen con ella.` : "";
    return { ok: true, destino: rutaVersionPlantilla(r.codigo, r.version), mensaje: `${r.codigo} v${r.version} publicada: las altas nuevas la usan desde ahora.${retiro}` };
  } catch (e) {
    return estadoDeError(e);
  }
}

const EntradaVersion = z.object({ codigo: Codigo, version: Version });

/** "Descartar borrador": vuelve al catálogo. */
export async function procesarDescartar(servicio: ServicioAdmin, usuario: UsuarioPermisos, valor: unknown): Promise<ResultadoNavegacionAdmin> {
  try {
    const d = leerEntrada(EntradaVersion, valor);
    await servicio.descartarBorrador(usuario, d.codigo, d.version);
    return { ok: true, destino: RUTA_PLANTILLAS, mensaje: `Borrador ${d.codigo} v${d.version} descartado.` };
  } catch (e) {
    return estadoDeError(e);
  }
}

const EntradaRetirar = EntradaVersion.extend({ motivo: Motivo });
export type EntradaRetirarPlantilla = z.input<typeof EntradaRetirar>;

/** "Retirar" la versión publicada (con motivo). */
export async function procesarRetirar(servicio: ServicioAdmin, usuario: UsuarioPermisos, valor: unknown): Promise<ResultadoAdmin> {
  try {
    const d = leerEntrada(EntradaRetirar, valor);
    const r = await servicio.retirarPlantilla(usuario, d.codigo, d.version, vacioANull(d.motivo));
    return { ok: true, repetido: r.repetido, mensaje: `${d.codigo} v${d.version} retirada: ya no se ofrece en el alta. Sus expedientes en curso siguen igual.` };
  } catch (e) {
    return estadoDeError(e);
  }
}

// ---------------------------------------------------------------------------
// Usuarios
// ---------------------------------------------------------------------------

const EntradaUsuario = z.discriminatedUnion("accion", [
  z.object({ accion: z.literal("alta"), datos: z.record(z.string(), z.unknown()), motivo: Motivo }),
  z.object({ accion: z.literal("acceso"), id: z.int().positive(), datos: z.record(z.string(), z.unknown()), motivo: Motivo }),
  z.object({ accion: z.literal("desactivar"), id: z.int().positive(), motivo: Motivo }),
  z.object({ accion: z.literal("reactivar"), id: z.int().positive(), motivo: Motivo }),
  z.object({ accion: z.literal("blanquear"), id: z.int().positive(), motivo: Motivo }),
  z.object({ accion: z.literal("desbloquear"), id: z.int().positive(), motivo: Motivo }),
]);
export type EntradaUsuarioAdmin = z.input<typeof EntradaUsuario>;

export async function procesarUsuario(
  servicio: ServicioAdmin,
  usuario: UsuarioPermisos,
  valor: unknown,
  opciones: { ip?: string | null } = {},
): Promise<ResultadoUsuarioAdmin> {
  try {
    const d = leerEntrada(EntradaUsuario, valor);
    const motivo = vacioANull(d.motivo);
    switch (d.accion) {
      case "alta": {
        const r = await servicio.altaUsuario(usuario, d.datos, motivo);
        if (r.repetido || !r.claveTemporal) {
          return { ok: true, repetido: true, mensaje: "Ese usuario ya estaba dado de alta así. Si no puede ingresar, usá \"Blanquear contraseña\"." };
        }
        return {
          ok: true,
          repetido: false,
          mensaje: "Usuario dado de alta. Pasale la contraseña temporal: la va a tener que cambiar al ingresar.",
          claveTemporal: r.claveTemporal,
        };
      }
      case "acceso": {
        const r = await servicio.cambiarAccesoUsuario(usuario, d.id, d.datos, motivo);
        return { ok: true, repetido: r.repetido, mensaje: r.repetido ? "No había cambios." : "Área y rol actualizados: rigen desde su próxima acción." };
      }
      case "desactivar": {
        const r = await servicio.desactivarUsuario(usuario, d.id, motivo);
        return { ok: true, repetido: r.repetido, mensaje: r.repetido ? "Ya estaba desactivado." : "Usuario desactivado: su sesión se corta en su próxima acción." };
      }
      case "reactivar": {
        const r = await servicio.reactivarUsuario(usuario, d.id, motivo);
        return { ok: true, repetido: r.repetido, mensaje: r.repetido ? "Ya estaba activo." : "Usuario reactivado: puede volver a ingresar." };
      }
      case "blanquear": {
        const r = await servicio.blanquearClave(usuario, d.id, motivo, opciones);
        return {
          ok: true,
          repetido: false,
          mensaje: "Contraseña blanqueada: se cerraron sus sesiones. Pasale la temporal: la va a tener que cambiar al ingresar.",
          claveTemporal: r.claveTemporal,
        };
      }
      case "desbloquear": {
        const r = await servicio.desbloquearUsuario(usuario, d.id, motivo, opciones);
        return { ok: true, repetido: r.repetido, mensaje: r.repetido ? "No estaba bloqueado." : "Usuario desbloqueado: ya puede volver a intentar." };
      }
    }
  } catch (e) {
    return estadoDeError(e);
  }
}

// ---------------------------------------------------------------------------
// Catálogos y feriados
// ---------------------------------------------------------------------------

export const CATALOGOS = ["area", "cementerio", "tipo_monumento", "tipo_tramite"] as const;
export type CatalogoAdmin = (typeof CATALOGOS)[number];

const EntradaCatalogo = z.object({ catalogo: z.enum(CATALOGOS), datos: z.record(z.string(), z.unknown()), motivo: Motivo });
export type EntradaCatalogoAdmin = z.input<typeof EntradaCatalogo>;

const QUE: Record<CatalogoAdmin, string> = { area: "Área", cementerio: "Cementerio", tipo_monumento: "Tipo de monumento", tipo_tramite: "Tipo de trámite" };

export async function procesarCatalogo(servicio: ServicioAdmin, usuario: UsuarioPermisos, valor: unknown): Promise<ResultadoAdmin> {
  try {
    const d = leerEntrada(EntradaCatalogo, valor);
    const motivo = vacioANull(d.motivo);
    const r =
      d.catalogo === "area"
        ? await servicio.guardarArea(usuario, d.datos, motivo)
        : d.catalogo === "cementerio"
          ? await servicio.guardarCementerio(usuario, d.datos, motivo)
          : d.catalogo === "tipo_monumento"
            ? await servicio.guardarTipoMonumento(usuario, d.datos, motivo)
            : await servicio.guardarTipoTramite(usuario, d.datos, motivo);
    return { ok: true, repetido: r.repetido, mensaje: r.repetido ? "No había cambios para guardar." : `${QUE[d.catalogo]} ${r.creado ? "dado de alta" : "guardado"}.` };
  } catch (e) {
    return estadoDeError(e);
  }
}

const EntradaFeriado = z.discriminatedUnion("accion", [
  z.object({
    accion: z.literal("guardar"),
    fecha: z.string().max(20),
    descripcion: z.string().max(400),
    ambito: z.string().max(20),
    norma: z.string().max(400).nullish(),
    motivo: Motivo,
  }),
  z.object({ accion: z.literal("quitar"), fecha: z.string().max(20), motivo: Motivo }),
  z.object({ accion: z.literal("cerrar"), anio: z.int(), motivo: Motivo }),
  z.object({ accion: z.literal("reabrir"), anio: z.int(), motivo: Motivo }),
]);
export type EntradaFeriadoAdmin = z.input<typeof EntradaFeriado>;

/**
 * Feriados (pestaña de Catálogos): la API de feriados de la semana 4, tal cual.
 * `sin_cambios` (cargarlo igual, cerrar uno cerrado) se toma como repetido.
 */
export async function procesarFeriado(servicio: ServicioExpedientes, usuario: UsuarioPermisos, valor: unknown): Promise<ResultadoAdmin> {
  try {
    const d = leerEntrada(EntradaFeriado, valor);
    const motivo = vacioANull(d.motivo);
    switch (d.accion) {
      case "guardar": {
        const r = await servicio.guardarFeriado(usuario, { fecha: d.fecha, descripcion: d.descripcion, ambito: d.ambito, norma: vacioANull(d.norma) }, motivo);
        return { ok: true, repetido: false, mensaje: r.creado ? "Feriado agregado." : "Feriado modificado." };
      }
      case "quitar":
        await servicio.quitarFeriado(usuario, d.fecha, motivo);
        return { ok: true, repetido: false, mensaje: "Feriado quitado." };
      case "cerrar":
        await servicio.cerrarAnioFeriados(usuario, d.anio, motivo);
        return { ok: true, repetido: false, mensaje: `${d.anio} cerrado: sus vencimientos dejan de ser provisorios.` };
      case "reabrir":
        await servicio.reabrirAnioFeriados(usuario, d.anio, motivo);
        return { ok: true, repetido: false, mensaje: `${d.anio} reabierto: sus vencimientos vuelven a ser provisorios.` };
    }
  } catch (e) {
    const r = estadoDeError(e);
    if (r.codigo === "sin_cambios") return { ok: true, repetido: true, mensaje: r.mensaje };
    return r;
  }
}

// ---------------------------------------------------------------------------
// CSV de auditoría (Route Handler GET /admin/auditoria/exportar)
// ---------------------------------------------------------------------------

const HEADERS_TEXTO = { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } as const;

/**
 * La respuesta del Route Handler: el CSV de lo filtrado como `attachment`, o
 * un error en texto plano (401 sin sesión, 403 sin permiso, 422 con filtros
 * inválidos). Los filtros se leen igual que en la pantalla.
 */
export async function responderExportacionAuditoria(servicio: ServicioAdmin, usuario: UsuarioPermisos | null, request: Request, ip: string | null): Promise<Response> {
  if (!usuario) return new Response("Tu sesión venció: volvé a ingresar.", { status: 401, headers: HEADERS_TEXTO });
  try {
    const f = leerFiltrosAuditoria(parametrosDe(new URL(request.url).searchParams));
    const pedido = f.vista === "accesos" ? { vista: "accesos" as const, filtros: f.accesos } : { vista: "cambios" as const, filtros: f.cambios };
    const csv = await servicio.exportarAuditoria(usuario, pedido, { ip });
    return new Response(csv.contenido, {
      status: 200,
      headers: {
        "Content-Type": csv.tipo,
        "Content-Disposition": `attachment; filename="${csv.nombreArchivo}"; filename*=UTF-8''${encodeURIComponent(csv.nombreArchivo)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Filas": String(csv.filas),
        "X-Truncado": csv.truncado ? "1" : "0",
      },
    });
  } catch (e) {
    const error = estadoDeError(e);
    return new Response(error.mensaje, { status: error.codigo === "permiso" ? 403 : 422, headers: HEADERS_TEXTO });
  }
}

