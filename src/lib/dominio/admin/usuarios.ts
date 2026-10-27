import { z } from "zod";
import { generarClaveTemporal, hashearClave } from "@/lib/auth/clave";
import type { Transaccion } from "@/lib/db/crear-cliente";
import { cuilValido } from "../cuil";
import { ErrorDominio, errorValidacion, exigirMotivo, limpiarMotivo, type ErrorCampo } from "../expedientes/errores";
import { exigirPermiso, ROLES, type Rol, type UsuarioPermisos } from "../permisos";
import { enSerie, type DependenciasAdmin } from "./dependencias";
import { conErroresLegibles } from "./errores-base";

/**
 * Usuarios desde la administración (semana 5; docs/propuesta-mvp.md, 2.4, 3.2
 * y 6 "Autorización"): lista, alta por CUIL, cambiar área o rol, desactivar y
 * reactivar. No hay DELETE: la baja es `activo = false`.
 *
 * - Desactivar incrementa `sesion_version`: la cookie de sesión lleva la
 *   versión con la que se emitió y `usuarioDeSesion()` la compara en cada
 *   request, así que el acceso se corta en el request siguiente.
 * - Nadie se desactiva ni se cambia el rol a sí mismo (se quedaría afuera), y
 *   no puede quedar ningún administrador activo. Lo segundo se controla con las
 *   filas de los administradores bloqueadas (FOR UPDATE): dos administradores
 *   que se desactivan uno al otro a la vez se serializan, y el segundo ve que
 *   sería el último.
 * - El alta, el área, el rol, `activo` y `debe_cambiar_clave` quedan en
 *   `auditoria.cambios` por el trigger `auditar_cambio` (que en usuarios mira
 *   solo esas columnas: nunca el hash de la contraseña).
 * - Login propio (27/10/2026; docs/api-dominio.md, sección 22): el alta y
 *   "Blanquear contraseña" generan una contraseña TEMPORAL que se devuelve una
 *   sola vez (la pantalla la muestra y no se puede volver a ver: en la base
 *   queda solo el hash) y marcan `debe_cambiar_clave`. "Desbloquear" levanta
 *   el bloqueo por intentos fallidos. Nada de esto se manda por correo.
 *
 * Idempotencia: las acciones dicen el estado final (activo o no, tal área y
 * rol); repetirlas devuelve `repetido: true` sin escribir.
 */

/** Usuario técnico de la migración: no se lista ni se toca. */
const SISTEMA_ID = 1;

export interface FilaUsuarioAdmin {
  id: number;
  cuil: string;
  nombre: string;
  apellido: string;
  email: string | null;
  area: { id: number; codigo: string; nombre: string } | null;
  rol: Rol;
  activo: boolean;
  ultimoIngreso: Date | null;
  creadoEn: Date;
  /** Tiene contraseña (el hash no sale de acá). */
  conClave: boolean;
  /** Su contraseña es temporal: la tiene que cambiar al ingresar. */
  debeCambiarClave: boolean;
  /** Bloqueado por intentos fallidos hasta esta hora; null si no lo está. */
  bloqueadoHasta: Date | null;
}

export interface ListadoUsuarios {
  usuarios: FilaUsuarioAdmin[];
  /** Áreas internas activas: las que se pueden asignar. */
  areas: Array<{ id: number; codigo: string; nombre: string }>;
  adminsActivos: number;
}

function comoRol(v: string): Rol {
  return (ROLES as readonly string[]).includes(v) ? (v as Rol) : "lectura";
}

export async function listarUsuarios(deps: DependenciasAdmin, usuario: UsuarioPermisos): Promise<ListadoUsuarios> {
  exigirPermiso("administrar", null, usuario);
  const [filas, areas] = await enSerie(
    () => deps.leer.usuario.findMany({
      where: { id: { not: SISTEMA_ID } },
      select: {
        id: true, cuil: true, nombre: true, apellido: true, email: true, rol: true, activo: true, ultimoIngreso: true, creadoEn: true,
        claveHash: true, debeCambiarClave: true, bloqueadoHasta: true,
        area: { select: { id: true, codigo: true, nombre: true } },
      },
      orderBy: [{ activo: "desc" }, { apellido: "asc" }, { nombre: "asc" }],
    }),
    () => deps.leer.area.findMany({ where: { tipo: "interna", activa: true }, select: { id: true, codigo: true, nombre: true }, orderBy: [{ orden: "asc" }, { nombre: "asc" }] }),
  );
  const ahora = deps.ahora?.() ?? new Date();
  // El hash se lee solo para saber si hay contraseña: no sale de esta función.
  const usuarios = filas.map(({ claveHash, bloqueadoHasta, ...f }) => ({
    ...f,
    rol: comoRol(f.rol),
    conClave: claveHash !== null,
    bloqueadoHasta: bloqueadoHasta && bloqueadoHasta.getTime() > ahora.getTime() ? bloqueadoHasta : null,
  }));
  return { usuarios, areas, adminsActivos: usuarios.filter((u) => u.rol === "admin" && u.activo).length };
}

// ---------------------------------------------------------------------------
// Entrada
// ---------------------------------------------------------------------------

const Texto = (etiqueta: string) =>
  z
    .string()
    .transform((v) => v.replace(/\s+/g, " ").trim())
    .pipe(z.string().min(1, `Escribí ${etiqueta}`).max(100, "Hasta 100 caracteres"));

const AreaId = z.int("Elegí un área").positive("Elegí un área").nullable();
const RolEntrada = z.enum(ROLES, "Elegí un rol: operador, lectura o admin");

const EntradaAlta = z.object({
  cuil: z.string().transform((v) => v.replace(/[\s.-]/g, "")),
  nombre: Texto("el nombre"),
  apellido: Texto("el apellido"),
  email: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v))
    .pipe(z.email("Correo inválido").max(200).nullable())
    .nullish(),
  areaId: AreaId,
  rol: RolEntrada,
});
export type EntradaAltaUsuario = z.input<typeof EntradaAlta>;

const EntradaAcceso = z.object({ areaId: AreaId, rol: RolEntrada });
export type EntradaAccesoUsuario = z.input<typeof EntradaAcceso>;

function leer<T extends z.ZodType>(esquema: T, valor: unknown): z.infer<T> {
  const r = esquema.safeParse(valor);
  if (r.success) return r.data;
  throw errorValidacion(r.error.issues.map((i) => ({ ruta: i.path.map(String).join("."), mensaje: i.message })));
}

/**
 * El área que se asigna: interna y activa (un usuario no puede ser de la DIM
 * ni de un cementerio: `usuarios_area_interna`). Solo el admin puede no tener
 * área (CHECK usuarios_area_check).
 */
async function controlarArea(tx: Transaccion, areaId: number | null, rol: Rol, errores: ErrorCampo[]): Promise<void> {
  if (areaId === null) {
    if (rol !== "admin") errores.push({ ruta: "areaId", mensaje: "Elegí el área: solo el administrador puede no tener" });
    return;
  }
  const area = await tx.area.findUnique({ where: { id: areaId } });
  if (!area) errores.push({ ruta: "areaId", mensaje: "No existe esa área" });
  else if (area.tipo !== "interna") errores.push({ ruta: "areaId", mensaje: `${area.nombre} es un área externa: un usuario solo puede ser de un área interna` });
  else if (!area.activa) errores.push({ ruta: "areaId", mensaje: `${area.nombre} está inactiva` });
}

/**
 * Bloquea a los administradores activos y dice cuántos quedarían si `id`
 * dejara de serlo. Con el bloqueo, dos cambios simultáneos se serializan.
 */
async function adminsActivosSin(tx: Transaccion, id: number): Promise<number> {
  const filas = await tx.$queryRaw<Array<{ id: number }>>`
    SELECT id FROM public.usuarios WHERE rol = 'admin' AND activo AND id <> ${SISTEMA_ID} ORDER BY id FOR UPDATE`;
  return filas.filter((f) => f.id !== id).length;
}

const ULTIMO_ADMIN = "Es el último administrador activo: antes dale el rol de administrador a otro usuario";

async function cargar(tx: Transaccion, id: number) {
  if (!Number.isSafeInteger(id) || id === SISTEMA_ID) throw new ErrorDominio("no_encontrado", "No existe ese usuario");
  const u = await tx.usuario.findUnique({ where: { id } });
  if (!u) throw new ErrorDominio("no_encontrado", "No existe ese usuario");
  return u;
}

// ---------------------------------------------------------------------------
// Acciones
// ---------------------------------------------------------------------------

/**
 * El correo con el que se puede ingresar no puede ser de otro usuario: con dos
 * iguales, el ingreso por correo no sabría a quién elegir (se entra con el CUIL).
 */
async function controlarCorreo(tx: Transaccion, email: string | null, menosId: number | null, errores: ErrorCampo[]): Promise<void> {
  if (!email) return;
  const otros = await tx.usuario.findMany({
    where: { email: { equals: email, mode: "insensitive" }, ...(menosId !== null ? { id: { not: menosId } } : {}) },
    select: { email: true },
    take: 5,
  });
  if (otros.some((o) => o.email?.toLowerCase() === email.toLowerCase())) {
    errores.push({ ruta: "email", mensaje: "Ese correo ya lo tiene otro usuario: con el correo se puede ingresar, así que no se repite" });
  }
}

/** Una contraseña temporal nueva y su hash. La temporal se devuelve una sola vez; en la base queda el hash. */
async function nuevaTemporal(): Promise<{ clave: string; hash: string }> {
  const clave = generarClaveTemporal();
  return { clave, hash: await hashearClave(clave) };
}

/**
 * Alta por CUIL, con el dígito verificador (con el CUIL se ingresa: un error
 * de tipeo dejaría a la persona sin poder entrar). Genera una contraseña
 * temporal (`claveTemporal`, que se muestra una sola vez) y marca
 * `debe_cambiar_clave`. Si el usuario ya existía igual (`repetido`), no
 * genera nada: para una contraseña nueva está "Blanquear contraseña".
 *
 * @throws ErrorDominio `validacion`, `ya_existe`
 */
export async function altaUsuario(
  deps: DependenciasAdmin,
  usuario: UsuarioPermisos,
  entrada: unknown,
  motivo: string | null = null,
): Promise<{ id: number; repetido: boolean; claveTemporal: string | null }> {
  exigirPermiso("administrar", null, usuario);
  const d = leer(EntradaAlta, entrada);
  const errores: ErrorCampo[] = [];
  if (!cuilValido(d.cuil)) errores.push({ ruta: "cuil", mensaje: "CUIL inválido: 11 dígitos con el dígito verificador correcto (ej. 20-12345678-6)" });
  // Antes de la transacción: scrypt tarda (a propósito) y no tiene por qué tener una conexión tomada.
  const temporal = await nuevaTemporal();
  const ahora = deps.ahora?.() ?? new Date();
  return conErroresLegibles(
    () =>
      deps.escribir(usuario.id, limpiarMotivo(motivo) ?? "Alta de usuario", async (tx) => {
        await controlarArea(tx, d.areaId, d.rol, errores);
        const existente = await tx.usuario.findUnique({
          where: { cuil: d.cuil },
          select: { id: true, nombre: true, apellido: true, activo: true, areaId: true, rol: true },
        });
        if (!existente) await controlarCorreo(tx, d.email ?? null, null, errores);
        if (errores.length > 0) throw errorValidacion(errores);
        if (existente) {
          if (existente.activo && existente.areaId === d.areaId && existente.rol === d.rol) return { id: existente.id, repetido: true, claveTemporal: null };
          throw new ErrorDominio(
            "ya_existe",
            `Ya hay un usuario con el CUIL ${d.cuil} (${existente.nombre} ${existente.apellido}${existente.activo ? "" : ", inactivo"})${existente.activo ? "" : ": reactivalo desde la lista"}`,
            [{ ruta: "cuil", mensaje: "Ese CUIL ya tiene usuario" }],
          );
        }
        const nuevo = await tx.usuario.create({
          data: {
            cuil: d.cuil,
            nombre: d.nombre,
            apellido: d.apellido,
            email: d.email ?? null,
            areaId: d.areaId,
            rol: d.rol,
            claveHash: temporal.hash,
            debeCambiarClave: true,
            claveCambiadaEn: ahora,
          },
          select: { id: true },
        });
        return { id: nuevo.id, repetido: false, claveTemporal: temporal.clave };
      }),
    `Ya hay un usuario con el CUIL ${d.cuil}`,
  );
}

/**
 * Cambiar el área o el rol. Rige en el request siguiente: la sesión vuelve a
 * leer área y rol de la base en cada request.
 *
 * @throws ErrorDominio `validacion`, `no_encontrado`, `en_uso` (el último admin)
 */
export async function cambiarAccesoUsuario(
  deps: DependenciasAdmin,
  usuario: UsuarioPermisos,
  id: number,
  entrada: unknown,
  motivo: string | null = null,
): Promise<{ repetido: boolean }> {
  exigirPermiso("administrar", null, usuario);
  const d = leer(EntradaAcceso, entrada);
  return conErroresLegibles(() =>
    deps.escribir(usuario.id, limpiarMotivo(motivo), async (tx) => {
      const u = await cargar(tx, id);
      if (u.areaId === d.areaId && u.rol === d.rol) return { repetido: true };
      if (u.id === usuario.id && u.rol !== d.rol) {
        throw errorValidacion([{ ruta: "rol", mensaje: "No podés cambiar tu propio rol: pedíselo a otro administrador" }], "No podés cambiar tu propio rol");
      }
      const errores: ErrorCampo[] = [];
      await controlarArea(tx, d.areaId, d.rol, errores);
      if (errores.length > 0) throw errorValidacion(errores);
      if (u.rol === "admin" && d.rol !== "admin" && u.activo && (await adminsActivosSin(tx, u.id)) === 0) {
        throw new ErrorDominio("en_uso", ULTIMO_ADMIN);
      }
      await tx.usuario.update({ where: { id: u.id }, data: { areaId: d.areaId, rol: d.rol } });
      return { repetido: false };
    }),
  );
}

/**
 * Desactivar: corta el acceso en el request siguiente (`sesion_version` + 1).
 *
 * @throws ErrorDominio `validacion` (uno mismo), `no_encontrado`, `en_uso` (el último admin)
 */
export async function desactivarUsuario(deps: DependenciasAdmin, usuario: UsuarioPermisos, id: number, motivo: string | null = null): Promise<{ repetido: boolean }> {
  exigirPermiso("administrar", null, usuario);
  if (id === usuario.id) throw errorValidacion([], "No podés desactivar tu propio usuario");
  return conErroresLegibles(() =>
    deps.escribir(usuario.id, limpiarMotivo(motivo), async (tx) => {
      const u = await cargar(tx, id);
      if (!u.activo) return { repetido: true };
      if (u.rol === "admin" && (await adminsActivosSin(tx, u.id)) === 0) throw new ErrorDominio("en_uso", ULTIMO_ADMIN);
      await tx.usuario.update({ where: { id: u.id }, data: { activo: false, sesionVersion: { increment: 1 } } });
      return { repetido: false };
    }),
  );
}

/**
 * Reactivar. Las sesiones viejas siguen sin valer (la versión ya cambió al
 * desactivarlo): vuelve a ingresar con su contraseña (si no la recuerda,
 * "Blanquear contraseña").
 *
 * @throws ErrorDominio `validacion` (su área ya no es asignable), `no_encontrado`
 */
export async function reactivarUsuario(deps: DependenciasAdmin, usuario: UsuarioPermisos, id: number, motivo: string | null = null): Promise<{ repetido: boolean }> {
  exigirPermiso("administrar", null, usuario);
  return conErroresLegibles(() =>
    deps.escribir(usuario.id, limpiarMotivo(motivo), async (tx) => {
      const u = await cargar(tx, id);
      if (u.activo) return { repetido: true };
      const errores: ErrorCampo[] = [];
      await controlarArea(tx, u.areaId, comoRol(u.rol), errores);
      if (errores.length > 0) throw errorValidacion(errores, `${errores[0].mensaje}: cambiale el área antes de reactivarlo`);
      await tx.usuario.update({ where: { id: u.id }, data: { activo: true } });
      return { repetido: false };
    }),
  );
}

/**
 * "Blanquear contraseña": una temporal nueva (se devuelve una sola vez),
 * `debe_cambiar_clave`, cierra todas sus sesiones (`sesion_version` + 1) y lo
 * desbloquea. Con motivo obligatorio: queda en auditoria.accesos
 * (`blanqueo_clave`, firmado por el admin, con el usuario en el detalle) y, si
 * pasa a tener que cambiarla, en auditoria.cambios. La propia se cambia desde
 * /cambiar-clave.
 *
 * @throws ErrorDominio `validacion` (uno mismo), `motivo_requerido`, `no_encontrado`
 */
export async function blanquearClave(
  deps: DependenciasAdmin,
  usuario: UsuarioPermisos,
  id: number,
  motivo: string | null,
  opciones: { ip?: string | null } = {},
): Promise<{ claveTemporal: string }> {
  exigirPermiso("administrar", null, usuario);
  if (id === usuario.id) throw errorValidacion([], 'Tu propia contraseña la cambiás desde "Cambiar contraseña": no se blanquea');
  const m = exigirMotivo(motivo, "Blanquear la contraseña");
  const temporal = await nuevaTemporal();
  const ahora = deps.ahora?.() ?? new Date();
  return conErroresLegibles(() =>
    deps.escribir(usuario.id, m, async (tx) => {
      const u = await cargar(tx, id);
      await tx.usuario.update({
        where: { id: u.id },
        data: {
          claveHash: temporal.hash,
          debeCambiarClave: true,
          claveCambiadaEn: ahora,
          intentosFallidos: 0,
          bloqueadoHasta: null,
          sesionVersion: { increment: 1 },
        },
      });
      await tx.auditoriaAcceso.create({
        data: { usuarioId: usuario.id, accion: "blanqueo_clave", ip: opciones.ip ?? null, detalle: { usuario_id: u.id, motivo: m } },
      });
      return { claveTemporal: temporal.clave };
    }),
  );
}

/**
 * "Desbloquear": levanta el bloqueo por intentos fallidos (y pone el contador
 * en 0) antes de los 15 minutos. Queda `desbloqueo` en auditoria.accesos,
 * firmado por el admin, con el usuario en el detalle.
 *
 * @throws ErrorDominio `no_encontrado`
 */
export async function desbloquearUsuario(
  deps: DependenciasAdmin,
  usuario: UsuarioPermisos,
  id: number,
  motivo: string | null = null,
  opciones: { ip?: string | null } = {},
): Promise<{ repetido: boolean }> {
  exigirPermiso("administrar", null, usuario);
  const ahora = deps.ahora?.() ?? new Date();
  const m = limpiarMotivo(motivo);
  return conErroresLegibles(() =>
    deps.escribir(usuario.id, m ?? "Desbloqueo", async (tx) => {
      const u = await cargar(tx, id);
      const bloqueado = u.bloqueadoHasta !== null && u.bloqueadoHasta.getTime() > ahora.getTime();
      if (!bloqueado && u.intentosFallidos === 0) return { repetido: true };
      await tx.usuario.update({ where: { id: u.id }, data: { intentosFallidos: 0, bloqueadoHasta: null } });
      await tx.auditoriaAcceso.create({
        data: { usuarioId: usuario.id, accion: "desbloqueo", ip: opciones.ip ?? null, detalle: { usuario_id: u.id, ...(m ? { motivo: m } : {}) } },
      });
      return { repetido: false };
    }),
  );
}
