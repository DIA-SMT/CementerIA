import { formatearFechaHora } from "@/lib/fechas";

/**
 * `auditoria.cambios` legible (semana 5, `/admin/auditoria`): qué tabla, qué
 * registro y qué cambió, campo por campo, con el antes y el después en
 * palabras. Puro: lo usan la pantalla y el CSV.
 *
 * El trigger `auditar_cambio` guarda la fila entera (`to_jsonb`) antes y
 * después; en usuarios, solo id, cuil, área, rol, activo y debe_cambiar_clave
 * (nunca el hash de la contraseña). Acá se comparan las
 * columnas una por una y se muestran las que cambiaron. La definición de una
 * plantilla es grande: se resume en cantidades (pasos, subtareas, documentos…)
 * en vez de volcar el JSON.
 */

export const ETIQUETA_TABLA: Record<string, string> = {
  plantillas: "Plantilla",
  areas: "Área",
  cementerios: "Cementerio",
  tipos_monumento: "Tipo de monumento",
  tipos_tramite: "Tipo de trámite",
  feriados: "Feriado",
  feriados_anios: "Año de feriados",
  usuarios: "Usuario",
  // Sitio público (28/10/2026, migración *_sitio_publico).
  sitio_cementerios: "Sitio: cementerio",
  sitio_recorridos: "Sitio: recorrido",
  sitio_recorrido_fechas: "Sitio: fecha de recorrido",
  sitio_novedades: "Sitio: novedad",
  sitio_contacto: "Sitio: contacto",
  sitio_preguntas: "Sitio: pregunta frecuente",
};

export const ETIQUETA_OPERACION: Record<string, string> = { I: "Alta", U: "Cambio", D: "Baja" };

const ETIQUETA_COLUMNA: Record<string, string> = {
  codigo: "Código",
  nombre: "Nombre",
  tipo: "Tipo",
  recibe_pases: "Recibe pases",
  activa: "Activa",
  activo: "Activo",
  orden: "Orden",
  area_id: "Área",
  campos_ubicacion: "Campos de ubicación",
  tipos_monumento: "Tipos de monumento",
  cuil: "CUIL",
  rol: "Rol",
  version: "Versión",
  tipo_tramite_id: "Tipo de trámite",
  estado: "Estado",
  definicion: "Definición",
  notas_cambio: "Notas de cambio",
  creado_por: "Creada por",
  publicado_por: "Publicada por",
  creado_en: "Creada el",
  publicado_en: "Publicada el",
  fecha: "Fecha",
  descripcion: "Descripción",
  ambito: "Ámbito",
  norma: "Norma",
  anio: "Año",
  cerrado: "Cerrado",
  cerrado_por: "Cerrado por",
  cerrado_en: "Cerrado el",
  debe_cambiar_clave: "Debe cambiar la contraseña",
  // Sitio público (28/10/2026).
  cementerio_id: "Cementerio",
  visible: "Visible",
  domicilio: "Domicilio",
  mapa_url: "Enlace al mapa",
  que_tiene: "Qué tiene",
  horario_semana: "Lunes a viernes",
  horario_fin_de_semana: "Sábados, domingos y feriados",
  horario_especial: "Fechas especiales",
  foto: "Foto",
  dias_hora: "Días y hora",
  duracion: "Duración",
  punto_encuentro: "Punto de encuentro",
  cupo: "Cupo",
  inscripcion: "Cómo inscribirse",
  inscripcion_url: "Enlace de inscripción",
  recorrido_id: "Recorrido",
  nota: "Nota",
  titulo: "Título",
  texto: "Texto",
  desde: "Desde",
  hasta: "Hasta",
  horario: "Horario",
  telefono: "Teléfono",
  correo: "Correo",
  pregunta: "Pregunta",
  respuesta: "Respuesta",
  actualizado_en: "Actualizado el",
};

/** Columnas que no dicen nada al leer el cambio (la clave, que ya está en "Registro"). */
const SIN_INTERES = new Set(["id"]);

export interface NombresAuditoria {
  /** id → nombre, para `area_id`. */
  areas?: ReadonlyMap<number, string>;
  /** id → nombre, para `creado_por`, `publicado_por`, `cerrado_por`. */
  usuarios?: ReadonlyMap<number, string>;
  /** id → nombre, para `tipo_tramite_id`. */
  tiposTramite?: ReadonlyMap<number, string>;
}

export interface Diferencia {
  campo: string;
  etiqueta: string;
  antes: string;
  despues: string;
}

type Fila = Record<string, unknown> | null;

function objeto(v: unknown): Fila {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** Cuántos de cada cosa tiene una definición: el resumen que se compara. */
export function resumenDefinicion(v: unknown): Record<string, number> {
  const d = objeto(v) ?? {};
  const largo = (x: unknown): number => (Array.isArray(x) ? x.length : 0);
  const pasos = Array.isArray(d.pasos) ? d.pasos : [];
  return {
    pasos: pasos.length,
    subtareas: pasos.reduce<number>((n, p) => n + largo(objeto(p)?.subtareas), 0),
    documentos: largo(d.documentos),
    conceptos: largo(d.conceptos),
    personas: largo(d.personas),
    "campos extra": largo(d.campos_extra),
  };
}

function textoDefinicion(v: unknown): string {
  if (v === null || v === undefined) return "—";
  return Object.entries(resumenDefinicion(v))
    .map(([k, n]) => `${n} ${k}`)
    .join(", ");
}

function textoCamposUbicacion(v: unknown): string {
  if (!Array.isArray(v)) return "—";
  if (v.length === 0) return "(ninguno)";
  return v
    .map((c) => {
      const o = objeto(c) ?? {};
      const marcas = [o.obligatorio === true ? "obligatorio" : null, o.activo === false ? "inactivo" : null, typeof o.patron === "string" && o.patron !== "" ? `patrón ${o.patron}` : null].filter(Boolean);
      return `${String(o.etiqueta ?? o.clave)} (${String(o.clave)}${marcas.length > 0 ? `; ${marcas.join("; ")}` : ""})`;
    })
    .join(" · ");
}

const ROLES: Record<string, string> = { admin: "administrador", operador: "operador", lectura: "lectura" };
const RE_INSTANTE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/** Un valor de una columna, en palabras. */
export function textoValor(columna: string, v: unknown, nombres: NombresAuditoria = {}): string {
  if (v === null || v === undefined) return "—";
  if (columna === "definicion") return textoDefinicion(v);
  if (columna === "campos_ubicacion") return textoCamposUbicacion(v);
  if (typeof v === "boolean") return v ? "sí" : "no";
  if (typeof v === "number") {
    const mapa = columna === "area_id" ? nombres.areas : columna === "tipo_tramite_id" ? nombres.tiposTramite : columna.endsWith("_por") ? nombres.usuarios : undefined;
    const nombre = mapa?.get(v);
    return nombre ? `${nombre} (${v})` : String(v);
  }
  if (typeof v === "string") {
    if (columna === "rol") return ROLES[v] ?? v;
    // Los timestamptz llegan de to_jsonb en ISO con zona: en hora de Tucumán, como el resto de la app.
    if (RE_INSTANTE.test(v)) {
      const instante = new Date(v);
      if (!Number.isNaN(instante.getTime())) return formatearFechaHora(instante);
    }
    return v;
  }
  if (Array.isArray(v) && v.every((x) => typeof x === "string" || typeof x === "number")) return v.length === 0 ? "(ninguno)" : v.join(", ");
  const json = JSON.stringify(v);
  return json.length > 300 ? `${json.slice(0, 297)}…` : json;
}

/**
 * Lo que cambió, columna por columna. En un alta, todo lo que tiene valor; en
 * una baja, todo lo que tenía. Una definición que cambió de contenido pero no
 * de cantidades dice "cambió el contenido".
 */
export function diferenciasCambio(operacion: string, antes: unknown, despues: unknown, nombres: NombresAuditoria = {}): Diferencia[] {
  const a = objeto(antes);
  const d = objeto(despues);
  const columnas = [...new Set([...Object.keys(a ?? {}), ...Object.keys(d ?? {})])].filter((c) => !SIN_INTERES.has(c));
  const r: Diferencia[] = [];
  for (const campo of columnas) {
    const va = a?.[campo] ?? null;
    const vd = d?.[campo] ?? null;
    if (operacion === "U" && JSON.stringify(va) === JSON.stringify(vd)) continue;
    if (operacion === "I" && vd === null) continue;
    if (operacion === "D" && va === null) continue;
    let textoAntes = operacion === "I" ? "—" : textoValor(campo, va, nombres);
    let textoDespues = operacion === "D" ? "—" : textoValor(campo, vd, nombres);
    if (campo === "definicion" && operacion === "U" && textoAntes === textoDespues) {
      textoAntes = "(las mismas cantidades)";
      textoDespues = "cambió el contenido";
    }
    r.push({ campo, etiqueta: ETIQUETA_COLUMNA[campo] ?? campo, antes: textoAntes, despues: textoDespues });
  }
  return r;
}

/** Qué registro es, en palabras: "RENOV_CONTADO v2", "CUIL 20…", "MESA_ENTRADAS", "09/07/2026". */
export function descripcionRegistro(tabla: string, registroId: string, antes: unknown, despues: unknown): string {
  const f = objeto(despues) ?? objeto(antes) ?? {};
  switch (tabla) {
    case "plantillas":
      return typeof f.codigo === "string" ? `${f.codigo} v${String(f.version)}` : `#${registroId}`;
    case "usuarios":
      return typeof f.cuil === "string" ? `CUIL ${f.cuil}` : `#${registroId}`;
    case "feriados": {
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(registroId);
      return m ? `${m[3]}/${m[2]}/${m[1]}${typeof f.descripcion === "string" ? ` (${f.descripcion})` : ""}` : registroId;
    }
    case "feriados_anios":
      return `Año ${registroId}`;
    // Sitio público (28/10/2026): lo que lo nombra para quien lee la auditoría.
    case "sitio_cementerios":
      return `Cementerio #${registroId}`;
    case "sitio_recorridos":
    case "sitio_preguntas":
    case "sitio_novedades": {
      const nombre = f.nombre ?? f.pregunta ?? f.titulo;
      return typeof nombre === "string" ? nombre : `#${registroId}`;
    }
    case "sitio_recorrido_fechas":
      return typeof f.fecha === "string" ? `Fecha ${textoValor("fecha", f.fecha)} (recorrido #${String(f.recorrido_id)})` : `#${registroId}`;
    case "sitio_contacto":
      return "Mesa de Entradas";
    default:
      return typeof f.codigo === "string" ? `${f.codigo}${typeof f.nombre === "string" ? ` (${f.nombre})` : ""}` : `#${registroId}`;
  }
}

/** Las diferencias en una línea, para el CSV. */
export function diferenciasEnTexto(diferencias: readonly Diferencia[]): string {
  return diferencias.map((x) => `${x.etiqueta}: ${x.antes} → ${x.despues}`).join("; ");
}
