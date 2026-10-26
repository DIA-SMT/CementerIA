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
 * editan datos ni personas (3.1). Semana 3 (pases, recepción, devoluciones,
 * subtareas, documentos, adjuntos y bandejas): lo que depende del flujo. Las
 * acciones del área responsable van solo en estados activos; no hay pases ni
 * devoluciones con la carga histórica abierta; el último paso no da pase (se
 * concluye) y el primero no devuelve. Las validaciones del pase (3.3) y del
 * alta no van acá: son de la acción, no del permiso. Semana 4 (3.1): cada
 * cambio de estado desde el estado que lo admite (concluir desde el último
 * paso; archivar sin concluir, anular y reiniciar en estados activos;
 * desarchivar un archivado; reabrir un anulado), la ubicación de archivo, la
 * transcripción de la carga histórica y las correcciones en archivado y
 * anulado (solo el admin, salvo retirar un adjunto).
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

/** En trámite o en espera de pago en la DIM: los únicos estados en que el expediente se mueve (3.1). */
export function esEstadoActivo(estado: EstadoExpediente): boolean {
  return ESTADOS_ACTIVOS.has(estado);
}
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
  "ver_bandeja", // /bandeja: Por confirmar, En mi área y Afuera (operadores)
  // Semana 4
  "cambiar_ubicacion_archivo", // caja o estante de un archivado (3.1)
  "transcribir", // la transcripción de la ficha y "Terminar carga histórica" (2.13(c))
  // Métricas de gestión
  "ver_metricas", // /panel/metricas: tiempos, flujo, carga, devoluciones y línea de base (Dirección y admin)
] as const;
export type Accion = (typeof ACCIONES)[number];

/** Lo que el permiso necesita saber del usuario (lo da getUsuarioActual()). */
export interface UsuarioPermisos {
  id: number;
  rol: Rol;
  activo: boolean;
  area: { id: number; codigo: string } | null;
}

/**
 * Lo que el permiso necesita saber del expediente. Los campos del flujo
 * (semana 3) son opcionales para evaluar las reglas de las semanas 1 y 2 sin
 * ellos: si no vienen, el permiso no los controla, pero la acción igual los
 * valida. `permisosDelExpediente()` los completa siempre.
 */
export interface ExpedientePermisos {
  estado: EstadoExpediente;
  /** `area_responsable_id`: quién lo opera (el área del paso, o su custodia). */
  areaResponsableId: number;
  /** Áreas por las que pasó: `movimientos.area_destino_id` y `area_usuario_id`. */
  areasRecorridas: readonly number[];
  /** Hubo al menos un pase: desde ahí, editar identificatorios exige motivo (3.2). */
  tuvoPases: boolean;
  /** "Expediente iniciado antes del sistema" con la transcripción abierta: no hay pases ni devoluciones (3.3, punto 1). */
  cargaHistorica?: boolean;
  /** Está en el último paso: no da pase, se concluye (3.3, punto 2). */
  pasoFinal?: boolean;
  /** Está en el primer paso: no hay a dónde devolverlo (3.4). */
  primerPaso?: boolean;
}

/** Para corregir un movimiento: su autor y cuándo se registró. */
export interface MovimientoPermisos {
  usuarioId: number;
  registradoEn: Date;
}

export interface ContextoPermiso {
  movimiento?: MovimientoPermisos;
  ahora?: Date;
  /** La corrección es retirar un adjunto: el autor la puede hacer también en archivado y anulado (3.1). */
  retirarAdjunto?: boolean;
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
  | "requiere_movimiento"
  | "carga_historica_abierta"
  | "paso_final"
  | "primer_paso"
  /** Semana 4: se concluye solo desde el último paso (3.1). */
  | "no_es_paso_final"
  /** Semana 4: la transcripción es solo de un expediente con la carga histórica abierta (2.13(c)). */
  | "sin_carga_historica";

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
      if (admin || mesa) return SI;
      return no(lectura ? "solo_lectura" : "area_no_habilitada");

    case "reiniciar_con_otra_plantilla":
    case "archivar_sin_concluir":
    case "desarchivar":
    case "anular": {
      if (!admin && !mesa) return no(lectura ? "solo_lectura" : "area_no_habilitada");
      // Semana 4 (3.1): cada una desde su estado. Sin expediente decide el rol.
      if (!expediente) return SI;
      if (accion === "desarchivar") return expediente.estado === "archivado" ? SI : no("estado_no_admite");
      return ESTADOS_ACTIVOS.has(expediente.estado) ? SI : no("estado_no_admite");
    }

    case "transcribir": {
      if (!admin && !mesa) return no(lectura ? "solo_lectura" : "area_no_habilitada");
      if (!expediente) return SI;
      if (!expediente.cargaHistorica) return no("sin_carga_historica");
      return expediente.estado === "anulado" ? no("estado_no_admite") : SI;
    }

    case "confirmar_recepcion":
    case "tildar_subtarea":
    case "dar_pase":
    case "devolver":
    case "concluir": {
      // El admin no da pases ordinarios (3.2).
      const decision = delResponsable();
      if (!decision.permitido || !expediente) return decision;
      // No hay pases en concluido, archivado ni anulado (3.1): el expediente se
      // mueve y se trabaja solo en trámite o en espera de pago en la DIM.
      if (!ESTADOS_ACTIVOS.has(expediente.estado)) return no("estado_no_admite");
      if ((accion === "dar_pase" || accion === "devolver" || accion === "concluir") && expediente.cargaHistorica) {
        return no("carga_historica_abierta");
      }
      if (accion === "dar_pase" && expediente.pasoFinal) return no("paso_final");
      // Se concluye desde el último paso (3.1); sin `pasoFinal` informado no se controla acá.
      if (accion === "concluir" && expediente.pasoFinal === false) return no("no_es_paso_final");
      if (accion === "devolver" && expediente.primerPaso) return no("primer_paso");
      return decision;
    }

    case "ver_bandeja":
      // La bandeja es de las áreas que operan: Dirección y el admin van al panel (sección 5).
      if (lectura) return no("solo_lectura");
      if (admin) return no("admin_no_opera");
      return usuario.area ? SI : no("area_no_habilitada");

    case "marcar_documento":
    case "adjuntar": {
      if (lectura) return no("solo_lectura");
      if (admin) return no("admin_no_opera");
      if (!expediente) return no("requiere_expediente");
      // En archivado y anulado solo se admiten notas y correcciones (3.1).
      if (ESTADOS_SIN_EDICION.has(expediente.estado)) return no("estado_no_admite");
      if (esResponsable(usuario, expediente)) return SI;
      if (mesa) return ESTADOS_ACTIVOS.has(expediente.estado) ? SI : no("estado_no_admite");
      return no("no_es_responsable");
    }

    case "completar_campos_extra":
    case "editar_contacto":
    case "archivar_concluido":
    case "cambiar_ubicacion_archivo": {
      if (lectura) return no("solo_lectura");
      if (accion === "archivar_concluido" && expediente && expediente.estado !== "concluido") {
        return no("estado_no_admite");
      }
      // La caja o el estante de un archivado (3.1): los mismos que archivan un concluido.
      if (accion === "cambiar_ubicacion_archivo") {
        if (expediente && expediente.estado !== "archivado") return no("estado_no_admite");
        if (admin || mesa) return SI;
        if (!expediente) return no("requiere_expediente");
        return esResponsable(usuario, expediente) ? SI : no("no_es_responsable");
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
      // En archivado y anulado solo corrige el admin (3.1), salvo retirar un
      // adjunto, que la propuesta admite en esos estados.
      if (expediente && ESTADOS_SIN_EDICION.has(expediente.estado) && !contexto.retirarAdjunto) return no("estado_no_admite");
      const movimiento = contexto.movimiento;
      if (!movimiento) return no("requiere_movimiento");
      if (movimiento.usuarioId !== usuario.id) return no("no_es_autor");
      const ahora = contexto.ahora ?? new Date();
      const limite = movimiento.registradoEn.getTime() + DIAS_CORRECCION_AUTOR * 24 * 60 * 60 * 1000;
      return ahora.getTime() <= limite ? SI : no("plazo_vencido");
    }

    case "reabrir":
      if (!admin) return no(lectura ? "solo_lectura" : "solo_admin");
      return !expediente || expediente.estado === "anulado" ? SI : no("estado_no_admite");

    case "suprimir_persona":
    case "purgar_adjunto":
    case "administrar":
      return admin ? SI : no(lectura ? "solo_lectura" : "solo_admin");

    case "exportar_csv":
      // Dirección y admin; el CSV sale sin teléfono, correo ni domicilio.
      return admin || areaEs(usuario, AREA_DIRECCION) ? SI : no("area_no_habilitada");

    case "ver_metricas":
      // Las métricas de gestión son de la conducción: Dirección y admin. Son
      // agregados sin datos personales, pero no hacen al trabajo de cada área.
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
