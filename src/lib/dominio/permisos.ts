/**
 * Quién puede hacer qué (docs/propuesta-mvp.md, sección 3.2).
 *
 * Función pura: recibe la acción, el expediente (o null) y el usuario, y
 * decide. La usan las Server Actions y los Route Handlers antes de escribir, y
 * las páginas para decidir qué botones y qué datos mostrar: una sola regla para
 * las dos cosas, así un botón visible nunca termina en un "no autorizado".
 *
 * Semana 1: están las reglas que se deciden con el rol y el área, y las de
 * "responsable" y "pasó por su área", que solo comparan áreas. Semana 2 (alta,
 * ficha, edición, carátula): imprimir, y que en archivado y anulado no se
 * editan datos ni personas (3.1). La semana 3 suma lo que depende del flujo
 * (carga histórica abierta, paso final) junto con los pases. Las validaciones
 * del pase (3.3) y del alta no van acá: son de la acción, no del permiso.
 */

export const ROLES = ["operador", "lectura", "admin"] as const;
export type Rol = (typeof ROLES)[number];

export function esRol(valor: unknown): valor is Rol {
  return typeof valor === "string" && (ROLES as readonly string[]).includes(valor);
}

/** Códigos de área con reglas propias (semilla, sección 2.1). */
export const AREA_MESA_ENTRADAS = "MESA_ENTRADAS";
export const AREA_COMPUTO = "COMPUTO";
export const AREA_DIRECCION = "DIRECCION";

export const ESTADOS_EXPEDIENTE = ["en_tramite", "espera_pago_dim", "concluido", "archivado", "anulado"] as const;
export type EstadoExpediente = (typeof ESTADOS_EXPEDIENTE)[number];
const ESTADOS_ACTIVOS: ReadonlySet<EstadoExpediente> = new Set(["en_tramite", "espera_pago_dim"]);
/** En archivado y anulado no se editan datos ni personas (3.1). */
const ESTADOS_SIN_EDICION: ReadonlySet<EstadoExpediente> = new Set(["archivado", "anulado"]);

/** Una fila por renglón de la tabla 3.2 (las que agrupan varias acciones, separadas). */
export const ACCIONES = [
  "ver_expediente", // Buscar y ver ficha e historial (queda en auditoria.accesos)
  "ver_datos_completos", // Ver contacto completo y adjuntos
  "alta",
  "carga_historica",
  "reiniciar_con_otra_plantilla",
  "confirmar_recepcion",
  "tildar_subtarea", // destildar exige motivo: lo pide la acción
  "marcar_documento",
  "adjuntar",
  "completar_campos_extra",
  "dar_pase",
  "devolver",
  "concluir",
  "editar_contacto", // contacto y observaciones
  "editar_identificatorios", // personas, DNI, ubicación, padrón, N° municipal, fecha de inicio
  "archivar_concluido",
  "archivar_sin_concluir",
  "desarchivar",
  "anular",
  "reabrir",
  "nota",
  "corregir_movimiento",
  "suprimir_persona",
  "purgar_adjunto",
  "ver_panel",
  "exportar_csv",
  "administrar", // plantillas, usuarios, catálogos, auditoría
  "imprimir", // carátula e historial (queda en auditoria.accesos)
] as const;
export type Accion = (typeof ACCIONES)[number];

/** Lo que el permiso necesita saber del usuario (lo da getUsuarioActual()). */
export interface UsuarioPermisos {
  id: number;
  rol: Rol;
  activo: boolean;
  area: { id: number; codigo: string } | null;
}

/** Lo que el permiso necesita saber del expediente. La semana 3 lo amplía. */
export interface ExpedientePermisos {
  estado: EstadoExpediente;
  /** `area_responsable_id`: quién lo opera (el área del paso, o su custodia). */
  areaResponsableId: number;
  /** Áreas por las que pasó: `movimientos.area_destino_id` y `area_usuario_id`. */
  areasRecorridas: readonly number[];
  /** Hubo al menos un pase: desde ahí, editar identificatorios exige motivo (3.2). */
  tuvoPases: boolean;
}

/** Para corregir un movimiento: su autor y cuándo se registró. */
export interface MovimientoPermisos {
  usuarioId: number;
  registradoEn: Date;
}

export interface ContextoPermiso {
  movimiento?: MovimientoPermisos;
  ahora?: Date;
}

/** El autor corrige sus movimientos durante 7 días (2.13(b)). */
export const DIAS_CORRECCION_AUTOR = 7;

export type MotivoDenegacion =
  | "usuario_inactivo"
  | "solo_lectura"
  | "solo_admin"
  | "admin_no_opera"
  | "area_no_habilitada"
  | "no_es_responsable"
  | "estado_no_admite"
  | "no_es_autor"
  | "plazo_vencido"
  | "requiere_expediente"
  | "requiere_movimiento";

export type Decision = { permitido: true; requiereMotivo: boolean } | { permitido: false; motivo: MotivoDenegacion };

const SI: Decision = { permitido: true, requiereMotivo: false };
const CON_MOTIVO: Decision = { permitido: true, requiereMotivo: true };
const no = (motivo: MotivoDenegacion): Decision => ({ permitido: false, motivo });

function areaEs(usuario: UsuarioPermisos, codigo: string): boolean {
  return usuario.area?.codigo === codigo;
}

/**
 * "Responsable": el área del usuario es la responsable del expediente. Solo
 * actúan los operadores, así que la comparación se hace para ellos.
 */
function esResponsable(usuario: UsuarioPermisos, expediente: ExpedientePermisos): boolean {
  return usuario.rol === "operador" && usuario.area !== null && usuario.area.id === expediente.areaResponsableId;
}

/**
 * "Trabaja el expediente" (3.2): área responsable, área por la que pasó, Mesa
 * de Entradas, Dirección o admin. Es sobre el ÁREA, para ver; actuar es otra
 * cosa.
 */
function trabajaElExpediente(usuario: UsuarioPermisos, expediente: ExpedientePermisos): boolean {
  if (usuario.rol === "admin" || areaEs(usuario, AREA_MESA_ENTRADAS) || areaEs(usuario, AREA_DIRECCION)) return true;
  const area = usuario.area?.id;
  return area !== undefined && (area === expediente.areaResponsableId || expediente.areasRecorridas.includes(area));
}

/**
 * Decide si `usuario` puede hacer `accion` sobre `expediente`.
 *
 * `requiereMotivo` dice si la acción, permitida, tiene que llevar motivo (ver
 * datos completos sin haber trabajado el expediente, editar identificatorios
 * después del primer pase). Los motivos que exige el flujo (devolver, anular…)
 * los exigen la acción y los CHECKs de la base, no esta función.
 *
 * Las acciones sobre un expediente concreto devuelven `requiere_expediente` si
 * `expediente` es null y la decisión depende de él.
 */
export function evaluarPermiso(
  accion: Accion,
  expediente: ExpedientePermisos | null,
  usuario: UsuarioPermisos,
  contexto: ContextoPermiso = {},
): Decision {
  if (!usuario.activo) return no("usuario_inactivo");

  const admin = usuario.rol === "admin";
  const lectura = usuario.rol === "lectura";
  const operador = usuario.rol === "operador";
  const mesa = operador && areaEs(usuario, AREA_MESA_ENTRADAS);

  /** Para las acciones del área responsable (Mesa incluida, solo si es la responsable). */
  const delResponsable = (): Decision => {
    if (lectura) return no("solo_lectura");
    if (admin) return no("admin_no_opera");
    if (!expediente) return no("requiere_expediente");
    return esResponsable(usuario, expediente) ? SI : no("no_es_responsable");
  };

  switch (accion) {
    case "ver_expediente":
    case "ver_panel":
    case "imprimir":
      // Los imprimibles son de todos (sección 5); la carátula no lleva teléfono ni domicilio.
      return SI;

    case "ver_datos_completos": {
      if (admin || areaEs(usuario, AREA_MESA_ENTRADAS) || areaEs(usuario, AREA_DIRECCION)) return SI;
      if (!expediente) return no("requiere_expediente");
      // El resto lo ve enmascarado y puede abrirlo dando un motivo, que queda
      // en auditoria.accesos (decisión 13).
      return trabajaElExpediente(usuario, expediente) ? SI : CON_MOTIVO;
    }

    case "alta":
    case "carga_historica":
    case "reiniciar_con_otra_plantilla":
    case "archivar_sin_concluir":
    case "desarchivar":
    case "anular":
      if (admin || mesa) return SI;
      return no(lectura ? "solo_lectura" : "area_no_habilitada");

    case "confirmar_recepcion":
    case "tildar_subtarea":
    case "dar_pase":
    case "devolver":
    case "concluir":
      // El admin no da pases ordinarios (3.2).
      return delResponsable();

    case "marcar_documento":
    case "adjuntar": {
      if (lectura) return no("solo_lectura");
      if (admin) return no("admin_no_opera");
      if (!expediente) return no("requiere_expediente");
      if (esResponsable(usuario, expediente)) return SI;
      if (mesa) return ESTADOS_ACTIVOS.has(expediente.estado) ? SI : no("estado_no_admite");
      return no("no_es_responsable");
    }

    case "completar_campos_extra":
    case "editar_contacto":
    case "archivar_concluido": {
      if (lectura) return no("solo_lectura");
      if (accion === "archivar_concluido" && expediente && expediente.estado !== "concluido") {
        return no("estado_no_admite");
      }
      if (accion !== "archivar_concluido" && expediente && ESTADOS_SIN_EDICION.has(expediente.estado)) {
        return no("estado_no_admite");
      }
      if (admin || mesa) return SI;
      if (!expediente) return no("requiere_expediente");
      return esResponsable(usuario, expediente) ? SI : no("no_es_responsable");
    }

    case "editar_identificatorios": {
      if (lectura) return no("solo_lectura");
      if (!expediente) return admin || mesa ? SI : no("requiere_expediente");
      if (ESTADOS_SIN_EDICION.has(expediente.estado)) return no("estado_no_admite");
      // De las áreas responsables, solo Cómputo edita identificatorios.
      const habilitado = admin || mesa || (esResponsable(usuario, expediente) && areaEs(usuario, AREA_COMPUTO));
      if (!habilitado) return no(esResponsable(usuario, expediente) ? "area_no_habilitada" : "no_es_responsable");
      return expediente.tuvoPases ? CON_MOTIVO : SI;
    }

    case "nota":
      return lectura ? no("solo_lectura") : SI;

    case "corregir_movimiento": {
      if (admin) return SI;
      if (lectura) return no("solo_lectura");
      const movimiento = contexto.movimiento;
      if (!movimiento) return no("requiere_movimiento");
      if (movimiento.usuarioId !== usuario.id) return no("no_es_autor");
      const ahora = contexto.ahora ?? new Date();
      const limite = movimiento.registradoEn.getTime() + DIAS_CORRECCION_AUTOR * 24 * 60 * 60 * 1000;
      return ahora.getTime() <= limite ? SI : no("plazo_vencido");
    }

    case "reabrir":
    case "suprimir_persona":
    case "purgar_adjunto":
    case "administrar":
      return admin ? SI : no(lectura ? "solo_lectura" : "solo_admin");

    case "exportar_csv":
      // Dirección y admin; el CSV sale sin teléfono, correo ni domicilio.
      return admin || areaEs(usuario, AREA_DIRECCION) ? SI : no("area_no_habilitada");

    default: {
      // Si se agrega una acción a ACCIONES sin su regla, esto no compila.
      const sinRegla: never = accion;
      throw new Error(`Acción sin regla de permiso: ${String(sinRegla)}`);
    }
  }
}

export function puede(
  accion: Accion,
  expediente: ExpedientePermisos | null,
  usuario: UsuarioPermisos,
  contexto?: ContextoPermiso,
): boolean {
  return evaluarPermiso(accion, expediente, usuario, contexto).permitido;
}

export class PermisoDenegado extends Error {
  constructor(
    readonly accion: Accion,
    readonly motivo: MotivoDenegacion,
  ) {
    super(`Permiso denegado: ${accion} (${motivo})`);
    this.name = "PermisoDenegado";
  }
}

/**
 * Lo que llaman las Server Actions y los Route Handlers antes de escribir.
 *
 * @returns si la acción tiene que llevar motivo.
 * @throws PermisoDenegado
 */
export function exigirPermiso(
  accion: Accion,
  expediente: ExpedientePermisos | null,
  usuario: UsuarioPermisos,
  contexto?: ContextoPermiso,
): { requiereMotivo: boolean } {
  const decision = evaluarPermiso(accion, expediente, usuario, contexto);
  if (!decision.permitido) throw new PermisoDenegado(accion, decision.motivo);
  return { requiereMotivo: decision.requiereMotivo };
}
