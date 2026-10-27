import { z } from "zod";
import type { Transaccion } from "@/lib/db/crear-cliente";
import { errorValidacion } from "../expedientes/errores";
import { inicioPara } from "../navegacion";
import { AREA_DIRECCION, type Rol, type UsuarioPermisos } from "../permisos";
import type { DependenciasAdmin } from "./dependencias";
import { conErroresLegibles } from "./errores-base";

/**
 * Modo prueba: "Ver como…" (27/10/2026; docs/api-dominio.md, sección 23).
 *
 * Quien despliega pone en PERFILES_PRUEBA_CUILS los CUILs de las personas que
 * prueban el sistema, y esas personas, con su propio usuario, pasan de un
 * perfil a otro (Mesa de Entradas, Cómputo, Liquidación… como operador;
 * Dirección como lectura; Administrador sin área) para ver cada pantalla como
 * la ve cada área. No hay sesiones paralelas ni "impersonación": cambia el
 * área y el rol de SU PROPIA fila de `usuarios`, y todo lo demás (permisos,
 * bandeja, avisos, recorridos) lo sigue decidiendo el código de siempre a
 * partir de esa fila, en el request siguiente.
 *
 * Por qué es aceptable saltear las reglas de la administración de usuarios
 * ("nadie se cambia el rol a sí mismo", "no puede quedar sin administrador"):
 * - Es otro camino, explícito y separado (`cambiarAccesoUsuario` no cambia):
 *   solo existe con PERFILES_PRUEBA_CUILS definida y solo para esos CUILs, que
 *   se comprueban en el servidor en cada llamada contra el CUIL GUARDADO EN LA
 *   BASE (la fila se relee y se bloquea en la transacción), nunca contra algo
 *   que mande el navegador.
 * - Siempre se puede volver: "Administrador" está en la lista de perfiles de
 *   cualquier perfil, así que quien quedó como Liquidación (aunque sea el único
 *   admin) vuelve con un clic. La lista la controla quien despliega, no la
 *   pantalla: nadie se agrega a sí mismo.
 * - Todo queda en `auditoria.cambios` (trigger `auditar_cambio`: antes y
 *   después de `area_id` y `rol`, el autor y el motivo "Modo prueba: ver como
 *   …"). Si al dejar Administrador no queda otro administrador activo, el
 *   cambio se permite igual y el motivo lo dice.
 * - El riesgo que queda: borrar la variable con el usuario en otro perfil (el
 *   selector desaparece y puede quedar sin administrador). Por eso la
 *   documentación pide volver a Administrador antes de borrarla.
 *
 * No incrementa `sesion_version`: la sesión sigue (getUsuarioActual() relee
 * área y rol en cada request). Respeta los CHECK y triggers de siempre (el
 * admin va sin área; los demás con un área interna y activa:
 * `usuarios_area_check`, `usuarios_area_interna`).
 *
 * Como el resto del dominio, recibe sus dependencias: la app usa `perfilPrueba`
 * de ./servidor.ts (con `cuils` leídos de `entorno()`); los tests, sus propios
 * CUILs ficticios.
 */

/** La clave del perfil de administrador. Las de un área son `area:<CODIGO>`. */
export const CLAVE_PERFIL_ADMIN = "admin";

/** Lo que va delante de la etiqueta en el motivo de auditoria.cambios. */
export const PREFIJO_MOTIVO = "Modo prueba: ver como";

/** Lo que se agrega al motivo si al dejar Administrador no queda otro admin activo. */
export const NOTA_SIN_OTRO_ADMIN = "sin otro administrador activo mientras dure";

export interface PerfilPrueba {
  /** `admin` o `area:<CODIGO>`: lo que manda el selector. */
  clave: string;
  /** "Liquidación", "Dirección", "Administrador". */
  etiqueta: string;
  rol: Rol;
  /** null para el administrador (va sin área). */
  area: { id: number; codigo: string; nombre: string } | null;
}

export interface OpcionesPerfilPrueba {
  perfiles: PerfilPrueba[];
  /** La clave del perfil que tiene ahora, o null si su área y rol no son los de ningún perfil. */
  actual: string | null;
}

export interface ResultadoCambioPerfil {
  perfil: PerfilPrueba;
  /** El inicio de ese perfil: la bandeja (operadores) o el panel. */
  destino: "/bandeja" | "/panel";
  /** Ya tenía ese perfil: no se escribió nada. */
  repetido: boolean;
  /** Dejó Administrador sin otro administrador activo (se permitió igual y quedó en el motivo). */
  sinOtroAdmin: boolean;
}

export interface DependenciasPerfilPrueba extends DependenciasAdmin {
  /**
   * Los CUILs habilitados (PERFILES_PRUEBA_CUILS ya validada). Es una función
   * para leerlos recién al usarlos: `entorno()` no se evalúa al importar.
   */
  cuils: () => ReadonlySet<string>;
}

/** El usuario para el selector: lo que da getUsuarioActual() (el CUIL viene de la base). */
export type UsuarioPerfilPrueba = UsuarioPermisos & { cuil: string };

/**
 * El modo prueba está apagado (PERFILES_PRUEBA_CUILS vacía o ausente): la
 * Server Action responde como si no existiera (404).
 */
export class ModoPruebaInexistente extends Error {
  constructor() {
    super("El modo prueba no está habilitado");
    this.name = "ModoPruebaInexistente";
  }
}

/** El CUIL guardado en la base no está en PERFILES_PRUEBA_CUILS, o el usuario no está activo. */
export class PerfilPruebaDenegado extends Error {
  constructor() {
    super("Permiso denegado: modo prueba (el CUIL no está habilitado)");
    this.name = "PerfilPruebaDenegado";
  }
}

/** ¿Ese CUIL (de la base) está habilitado? Con la lista vacía, nadie. */
export function cuilHabilitado(cuils: ReadonlySet<string>, cuil: string | null | undefined): boolean {
  return typeof cuil === "string" && cuils.has(cuil);
}

export function claveDeArea(codigo: string): string {
  return `area:${codigo}`;
}

/** Dirección mira (rol lectura, 2.4); las demás áreas internas operan. */
export function rolDelArea(codigo: string): Rol {
  return codigo === AREA_DIRECCION ? "lectura" : "operador";
}

/**
 * Los perfiles a partir de las áreas internas activas (en su orden): una
 * entrada por área, y Administrador al final. Pura.
 */
export function perfilesDesdeAreas(areas: ReadonlyArray<{ id: number; codigo: string; nombre: string }>): PerfilPrueba[] {
  return [
    ...areas.map((a) => ({ clave: claveDeArea(a.codigo), etiqueta: a.nombre, rol: rolDelArea(a.codigo), area: { id: a.id, codigo: a.codigo, nombre: a.nombre } })),
    { clave: CLAVE_PERFIL_ADMIN, etiqueta: "Administrador", rol: "admin", area: null },
  ];
}

/**
 * El perfil que corresponde al área y rol de ahora. El administrador es el
 * perfil Administrador aunque tenga un área (el CHECK lo admite); los demás,
 * el de su área si el rol coincide. Pura.
 */
export function perfilActualDe(usuario: { rol: string; area: { id: number } | null }, perfiles: readonly PerfilPrueba[]): PerfilPrueba | null {
  if (usuario.rol === "admin") return perfiles.find((p) => p.clave === CLAVE_PERFIL_ADMIN) ?? null;
  return perfiles.find((p) => p.area !== null && p.area.id === usuario.area?.id && p.rol === usuario.rol) ?? null;
}

/** El motivo que queda en auditoria.cambios. */
export function motivoCambio(perfil: Pick<PerfilPrueba, "etiqueta">, sinOtroAdmin = false): string {
  return `${PREFIJO_MOTIVO} ${perfil.etiqueta}${sinOtroAdmin ? ` (${NOTA_SIN_OTRO_ADMIN})` : ""}`;
}

/** Las áreas internas activas, en su orden: las que pueden tener usuarios. */
export async function perfilesDisponibles(deps: Pick<DependenciasAdmin, "leer">): Promise<PerfilPrueba[]> {
  const areas = await deps.leer.area.findMany({
    where: { tipo: "interna", activa: true },
    select: { id: true, codigo: true, nombre: true },
    orderBy: [{ orden: "asc" }, { nombre: "asc" }],
  });
  return perfilesDesdeAreas(areas);
}

/**
 * Lo que necesita el selector del encabezado, o null si para este usuario no
 * existe (modo prueba apagado, CUIL no habilitado o usuario inactivo). El CUIL
 * es el de `getUsuarioActual()`, que lo lee de la base en cada request.
 */
export async function opcionesPerfilPrueba(deps: DependenciasPerfilPrueba, usuario: UsuarioPerfilPrueba): Promise<OpcionesPerfilPrueba | null> {
  if (!usuario.activo || !cuilHabilitado(deps.cuils(), usuario.cuil)) return null;
  const perfiles = await perfilesDisponibles(deps);
  return { perfiles, actual: perfilActualDe(usuario, perfiles)?.clave ?? null };
}

const Destino = z.string().min(1, "Elegí un perfil").max(80, "Elegí un perfil");

interface FilaPropia {
  cuil: string;
  activo: boolean;
  rol: string;
  area_id: number | null;
}

/**
 * Pasa al usuario de la sesión al perfil `destino` (`admin` o `area:<CODIGO>`).
 * Solo cambia SU fila (`usuario.id`), solo `area_id` y `rol`, dentro de
 * `conActor` con el motivo "Modo prueba: ver como <perfil>".
 *
 * @throws ModoPruebaInexistente con PERFILES_PRUEBA_CUILS vacía.
 * @throws PerfilPruebaDenegado si su CUIL (el de la base) no está en la lista o está inactivo.
 * @throws ErrorDominio `validacion` si el perfil no existe (o lo rechaza un trigger).
 */
export async function cambiarPerfilDePrueba(deps: DependenciasPerfilPrueba, usuario: Pick<UsuarioPermisos, "id">, destino: unknown): Promise<ResultadoCambioPerfil> {
  const cuils = deps.cuils();
  if (cuils.size === 0) throw new ModoPruebaInexistente();
  if (!Number.isSafeInteger(usuario.id) || usuario.id <= 1) throw new PerfilPruebaDenegado();

  // Antes de mirar el destino: a quien no está habilitado no se le dice nada más.
  const propia = await deps.leer.usuario.findUnique({ where: { id: usuario.id }, select: { cuil: true, activo: true } });
  if (!propia || !propia.activo || !cuilHabilitado(cuils, propia.cuil)) throw new PerfilPruebaDenegado();

  const clave = Destino.safeParse(destino);
  const perfiles = await perfilesDisponibles(deps);
  const perfil = clave.success ? perfiles.find((p) => p.clave === clave.data) : undefined;
  if (!perfil) throw errorValidacion([{ ruta: "perfil", mensaje: "Ese perfil no existe" }], "Ese perfil no existe: recargá la página");

  return conErroresLegibles(() =>
    deps.escribir(usuario.id, motivoCambio(perfil), async (tx) => {
      // La fila propia, bloqueada: el CUIL se vuelve a comprobar acá, contra la
      // base, en la misma transacción que escribe.
      const [fila] = await tx.$queryRaw<FilaPropia[]>`
        SELECT cuil, activo, rol, area_id FROM public.usuarios WHERE id = ${usuario.id} FOR UPDATE`;
      if (!fila || !fila.activo || !cuilHabilitado(cuils, fila.cuil)) throw new PerfilPruebaDenegado();

      const areaId = perfil.area?.id ?? null;
      if (fila.rol === perfil.rol && (fila.area_id ?? null) === areaId) {
        return { perfil, destino: inicioPara(perfil), repetido: true, sinOtroAdmin: false };
      }

      // Dejar Administrador sin otro admin activo se permite, pero queda dicho
      // en el motivo (siempre puede volver: Administrador está en la lista).
      const sinOtroAdmin = fila.rol === "admin" && perfil.rol !== "admin" && (await otrosAdminsActivos(tx, usuario.id)) === 0;
      if (sinOtroAdmin) await fijarMotivo(tx, motivoCambio(perfil, true));

      await tx.usuario.update({ where: { id: usuario.id }, data: { areaId, rol: perfil.rol } });
      return { perfil, destino: inicioPara(perfil), repetido: false, sinOtroAdmin };
    }),
  );
}

/** Los administradores activos que no son `id` (ni SISTEMA). */
async function otrosAdminsActivos(tx: Transaccion, id: number): Promise<number> {
  const [r] = await tx.$queryRaw<Array<{ n: number }>>`
    SELECT count(*)::int AS n FROM public.usuarios WHERE rol = 'admin' AND activo AND id <> 1 AND id <> ${id}`;
  return r?.n ?? 0;
}

/** Cambia el motivo de esta transacción (el que lee `auditar_cambio`), como lo fija conActor. */
async function fijarMotivo(tx: Transaccion, motivo: string): Promise<void> {
  await tx.$executeRaw`SELECT set_config('app.motivo', ${motivo}, true)`;
}

export function crearServicioPerfilPrueba(deps: DependenciasPerfilPrueba) {
  return {
    /** ¿Hay modo prueba? Sin PERFILES_PRUEBA_CUILS, el selector y su acción no existen. */
    activo: () => deps.cuils().size > 0,
    perfilesDisponibles: () => perfilesDisponibles(deps),
    opciones: (usuario: UsuarioPerfilPrueba) => opcionesPerfilPrueba(deps, usuario),
    cambiar: (usuario: Pick<UsuarioPermisos, "id">, destino: unknown) => cambiarPerfilDePrueba(deps, usuario, destino),
  };
}

export type ServicioPerfilPrueba = ReturnType<typeof crearServicioPerfilPrueba>;
