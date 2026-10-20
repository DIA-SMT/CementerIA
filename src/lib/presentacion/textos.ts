import type { EstadoExpediente, MotivoDenegacion } from "@/lib/dominio/permisos";

/**
 * Textos de la pantalla para los códigos del dominio. Puro: lo usan los
 * Server Components y los Client Components.
 */

export const ETIQUETA_ESTADO: Record<EstadoExpediente, string> = {
  en_tramite: "En trámite",
  espera_pago_dim: "Espera de pago en la DIM",
  concluido: "Concluido",
  archivado: "Archivado",
  anulado: "Anulado",
};

/** Clases de Tailwind de la etiqueta de cada estado (sobrias, con contraste AA). */
export const COLOR_ESTADO: Record<EstadoExpediente, string> = {
  en_tramite: "bg-sky-50 text-sky-900 ring-sky-300",
  espera_pago_dim: "bg-amber-50 text-amber-900 ring-amber-300",
  concluido: "bg-emerald-50 text-emerald-900 ring-emerald-300",
  archivado: "bg-slate-100 text-slate-800 ring-slate-300",
  anulado: "bg-red-50 text-red-900 ring-red-300",
};

export function etiquetaEstado(estado: string): string {
  return (ETIQUETA_ESTADO as Record<string, string>)[estado] ?? estado;
}

export const ETIQUETA_SITUACION: Record<string, string> = {
  sin_confirmar: "Sin confirmar recepción",
  devuelto: "Devuelto",
  carga_historica: "Iniciado antes del sistema",
  reiniciado: "Reiniciado",
  plazo_por_vencer: "Plazo por vencer",
  plazo_vencido: "Plazo vencido",
};

export const ETIQUETA_FORMA_PAGO: Record<string, string> = {
  contado: "Contado",
  plan_pagos: "Plan de pagos",
  a_elegir: "A elegir",
  no_aplica: "No corresponde",
};

export const ETIQUETA_DOCUMENTO: Record<string, string> = {
  pendiente: "Pendiente",
  presentado: "Presentado",
  no_corresponde: "No corresponde",
  historico: "Presentado (antes del sistema)",
};

export const ETIQUETA_MOVIMIENTO: Record<string, string> = {
  alta: "Alta",
  recepcion: "Recepción",
  pase: "Pase",
  devolucion: "Devolución",
  subtarea: "Subtarea",
  documento: "Documentación",
  adjunto: "Adjunto",
  edicion: "Edición de datos",
  estado: "Cambio de estado",
  nota: "Nota",
  correccion: "Corrección",
};

export function etiquetaMovimiento(tipo: string): string {
  return ETIQUETA_MOVIMIENTO[tipo] ?? tipo;
}

/** Nombres de los campos que anota una edición (`datos.cambios`). */
export const ETIQUETA_CAMPO_EDICION: Record<string, string> = {
  tipo_monumento: "tipo de monumento",
  ubicacion: "ubicación",
  padron: "padrón",
  numero_municipal: "N° municipal",
  fecha_inicio: "fecha de inicio",
  observaciones: "observaciones",
  personas: "personas",
};

/** Por qué no se puede hacer algo, dicho para quien está en el mostrador. */
export const TEXTO_DENEGACION: Record<MotivoDenegacion, string> = {
  usuario_inactivo: "Tu usuario está inactivo.",
  solo_lectura: "Tu usuario es de solo lectura.",
  solo_admin: "Solo lo puede hacer el administrador.",
  admin_no_opera: "El administrador no opera expedientes.",
  area_no_habilitada: "Tu área no puede hacer esto.",
  no_es_responsable: "Lo puede hacer solo el área responsable del expediente.",
  estado_no_admite: "El estado del expediente no lo permite.",
  no_es_autor: "Solo lo puede hacer quien registró el movimiento.",
  plazo_vencido: "Venció el plazo para hacerlo.",
  requiere_expediente: "Falta el expediente.",
  requiere_movimiento: "Falta el movimiento.",
};

/** "APELLIDO, Nombres" o lo que haya. */
export function nombreCompleto(p: { apellido: string | null; nombres: string | null }): string {
  return [p.apellido, p.nombres].filter((x) => x && x.trim() !== "").join(", ") || "(sin nombre)";
}

/** "30.111.222" para mostrar un DNI guardado solo con dígitos. */
export function formatearDni(dni: string | null): string {
  if (!dni) return "";
  return /^\d+$/.test(dni) ? dni.replace(/\B(?=(\d{3})+(?!\d))/g, ".") : dni;
}
