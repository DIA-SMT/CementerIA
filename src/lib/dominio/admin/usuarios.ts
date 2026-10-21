import { z } from "zod";
import type { Transaccion } from "@/lib/db/crear-cliente";
import { cuilValido } from "../cuil";
import { ErrorDominio, errorValidacion, limpiarMotivo, type ErrorCampo } from "../expedientes/errores";
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
 * - El alta, el área, el rol y `activo` quedan en `auditoria.cambios` por el
 *   trigger `auditar_cambio` (que en usuarios mira solo cuil, área, rol y
 *   activo); el nombre y el correo los actualiza Cidituc en cada ingreso.
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
      select: { id: true, cuil: true, nombre: true, apellido: true, email: true, rol: true, activo: true, ultimoIngreso: true, creadoEn: true, area: { select: { id: true, codigo: true, nombre: true } } },
      orderBy: [{ activo: "desc" }, { apellido: "asc" }, { nombre: "asc" }],
    }),
    () => deps.leer.area.findMany({ where: { tipo: "interna", activa: true }, select: { id: true, codigo: true, nombre: true }, orderBy: [{ orden: "asc" }, { nombre: "asc" }] }),
  );
  const usuarios = filas.map((f) => ({ ...f, rol: comoRol(f.rol) }));
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
 * Alta por CUIL: con el dígito verificador (un error de tipeo dejaría a la
 * persona sin poder entrar, porque Cidituc manda el CUIL real). El nombre y el
 * apellido se actualizan desde Cidituc en el primer ingreso.
 *
 * @throws ErrorDominio `validacion`, `ya_existe`
 */
export async function altaUsuario(deps: DependenciasAdmin, usuario: UsuarioPermisos, entrada: unknown, motivo: string | null = null): Promise<{ id: number; repetido: boolean }> {
  exigirPermiso("administrar", null, usuario);
  const d = leer(EntradaAlta, entrada);
  const errores: ErrorCampo[] = [];
  if (!cuilValido(d.cuil)) errores.push({ ruta: "cuil", mensaje: "CUIL inválido: 11 dígitos con el dígito verificador correcto (ej. 20-12345678-6)" });
  return conErroresLegibles(
    () =>
      deps.escribir(usuario.id, limpiarMotivo(motivo) ?? "Alta de usuario", async (tx) => {
        await controlarArea(tx, d.areaId, d.rol, errores);
        if (errores.length > 0) throw errorValidacion(errores);
        const existente = await tx.usuario.findUnique({ where: { cuil: d.cuil } });
        if (existente) {
          if (existente.activo && existente.areaId === d.areaId && existente.rol === d.rol) return { id: existente.id, repetido: true };
          throw new ErrorDominio(
            "ya_existe",
            `Ya hay un usuario con el CUIL ${d.cuil} (${existente.nombre} ${existente.apellido}${existente.activo ? "" : ", inactivo"})${existente.activo ? "" : ": reactivalo desde la lista"}`,
            [{ ruta: "cuil", mensaje: "Ese CUIL ya tiene usuario" }],
          );
        }
        const nuevo = await tx.usuario.create({
          data: { cuil: d.cuil, nombre: d.nombre, apellido: d.apellido, email: d.email ?? null, areaId: d.areaId, rol: d.rol },
          select: { id: true },
        });
        return { id: nuevo.id, repetido: false };
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
 * desactivarlo): entra de nuevo con Cidituc.
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
