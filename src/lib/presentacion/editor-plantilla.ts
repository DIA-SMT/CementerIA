import type { ErrorCampo } from "@/lib/dominio/expedientes/errores";
import {
  COMODIN_CEMENTERIO,
  destinoDePaso,
  PREFIJO_CAMPO,
  type CampoExtraPlantilla,
  type ConceptoPlantilla,
  type DefinicionPlantilla,
  type DocumentoPlantilla,
  type FiltroCementerios,
  type PasoPlantilla,
  type PersonaPlantilla,
  type SubtareaPlantilla,
} from "@/lib/dominio/plantillas/esquema";
import { resolverPorCementerio } from "@/lib/dominio/plantillas/resolver";

/**
 * El modelo del editor de plantillas (`/admin/plantillas/[codigo]/v/[version]`,
 * semana 5), sin React: armar y editar la definición, mantener las claves
 * únicas, mover pasos y subtareas, llevar cada error de `validar.ts` a su
 * pestaña y su campo, y la vista previa por cementerio con el resolver.
 *
 * Todo es inmutable: cada operación devuelve una definición nueva. Lo que se
 * edita tiene la forma de `DefinicionPlantilla` aunque los valores todavía no
 * sean válidos (ver plantillas/borrador.ts): el editor no inventa reglas,
 * "Validar" corre las de "Publicar".
 */

// ---------------------------------------------------------------------------
// Pestañas y errores
// ---------------------------------------------------------------------------

export const PESTANAS_EDITOR = ["general", "personas", "pasos", "documentacion", "conceptos", "campos_extra", "vista_previa"] as const;
export type PestanaEditor = (typeof PESTANAS_EDITOR)[number];

export const ETIQUETA_PESTANA_EDITOR: Record<PestanaEditor, string> = {
  general: "General",
  personas: "Personas",
  pasos: "Pasos",
  documentacion: "Documentación",
  conceptos: "Conceptos",
  campos_extra: "Campos extra",
  vista_previa: "Vista previa",
};

/**
 * La pestaña donde se corrige un error, por su ruta (`pasos[2].custodia` →
 * Pasos). Lo que no es de una lista (forma de pago, monumentos, el nombre, la
 * definición entera) va a General.
 */
export function pestanaDeRuta(ruta: string): PestanaEditor {
  const raiz = ruta.split(/[.[]/, 1)[0];
  switch (raiz) {
    case "personas":
      return "personas";
    case "pasos":
      return "pasos";
    case "documentos":
      return "documentacion";
    case "conceptos":
      return "conceptos";
    case "campos_extra":
      return "campos_extra";
    default:
      return "general";
  }
}

export function erroresPorPestana(errores: readonly ErrorCampo[]): Record<PestanaEditor, number> {
  const r = Object.fromEntries(PESTANAS_EDITOR.map((p) => [p, 0])) as Record<PestanaEditor, number>;
  for (const e of errores) r[pestanaDeRuta(e.ruta)] += 1;
  return r;
}

/** Los mensajes de exactamente esa ruta. */
export function mensajesDe(errores: readonly ErrorCampo[], ruta: string): string[] | undefined {
  const m = errores.filter((e) => e.ruta === ruta).map((e) => e.mensaje);
  return m.length > 0 ? m : undefined;
}

/** Cuántos errores hay dentro de un elemento (`pasos[2]` cuenta los de sus subtareas). */
export function erroresDentroDe(errores: readonly ErrorCampo[], prefijo: string): number {
  return errores.filter((e) => e.ruta === prefijo || e.ruta.startsWith(`${prefijo}.`) || e.ruta.startsWith(`${prefijo}[`)).length;
}

/**
 * De la más precisa a la más general: `pasos[2].plazo.desde_subtarea`,
 * `pasos[2].plazo`, `pasos[2]`, `pasos`. El editor enfoca el primer control que
 * exista: un error de un objeto entero (`personas[1]`) va a su encabezado.
 */
export function rutasAncestras(ruta: string): string[] {
  const r: string[] = [];
  let actual = ruta;
  while (actual !== "") {
    r.push(actual);
    const corte = Math.max(actual.lastIndexOf("."), actual.lastIndexOf("["));
    actual = corte <= 0 ? "" : actual.slice(0, corte);
  }
  return r;
}

const NOMBRE_CAMPO: Record<string, string> = {
  nombre: "nombre",
  clave: "clave",
  etiqueta: "etiqueta",
  area: "área",
  custodia: "custodia",
  estado: "estado",
  dias_alerta: "días de alerta",
  instrucciones: "instrucciones",
  plazo: "plazo",
  dias_habiles: "días hábiles",
  desde_subtarea: "inicio",
  hasta_subtarea: "cumplimiento",
  dato: "dato",
  dato_obligatorio: "dato obligatorio",
  rol: "rol",
  min: "mínimo",
  max: "máximo",
  admite_juridica: "persona jurídica",
  exigir_al_salir_de: "cuándo se exige",
  solo_cementerios: "cementerios",
  excepto_cementerios: "cementerios",
  solo_si_juridica: "corresponde",
  opciones: "opciones",
  paso: "paso",
  via: "vía",
  tipo: "tipo",
  forma_pago: "Forma de pago",
  tipos_monumento: "Tipos de monumento",
  ubicacion_obligatoria: "Ubicación obligatoria",
  requiere_contacto: "Requiere contacto",
};

const LISTA: Record<string, string> = { pasos: "Paso", personas: "Rol", documentos: "Documento", conceptos: "Concepto", campos_extra: "Campo", subtareas: "subtarea" };

/**
 * Dónde está un error, en palabras, para el resumen de la validación:
 * `pasos[0].subtareas[1].nombre` → "Paso 1 (Mesa de Entradas), subtarea 2: nombre".
 * Los mensajes del esquema ("No puede quedar vacío") no dicen de qué campo son.
 */
export function ubicacionDeRuta(ruta: string, def: DefinicionPlantilla): string {
  if (ruta === "") return "La plantilla";
  if (ruta === "nombre") return "Nombre del trámite";
  const partes: string[] = [];
  const campos: string[] = [];
  let paso: PasoPlantilla | undefined;
  for (const m of ruta.matchAll(/([a-z_]+)(?:\[(\d+)\])?/g)) {
    const [, nombre, indice] = m;
    if (indice === undefined) {
      if (partes.length === 0) partes.push(NOMBRE_CAMPO[nombre] ?? (nombre in LISTA ? ETIQUETA_PESTANA_EDITOR[pestanaDeRuta(nombre)] : nombre));
      else campos.push(NOMBRE_CAMPO[nombre] ?? nombre);
      continue;
    }
    const i = Number(indice);
    if (nombre === "pasos") {
      paso = def.pasos[i];
      partes.push(`Paso ${i + 1}${paso?.nombre ? ` (${paso.nombre})` : ""}`);
    } else if (nombre === "subtareas") {
      const s = paso?.subtareas[i];
      partes.push(`subtarea ${i + 1}${s?.nombre ? ` (${s.nombre})` : ""}`);
    } else if (nombre === "personas") {
      partes.push(`Rol ${i + 1}${def.personas[i]?.etiqueta ? ` (${def.personas[i].etiqueta})` : ""}`);
    } else if (nombre === "documentos" || nombre === "conceptos" || nombre === "campos_extra") {
      const x = nombre === "documentos" ? def.documentos[i] : nombre === "conceptos" ? def.conceptos[i] : def.campos_extra[i];
      const titulo = x ? ("nombre" in x ? x.nombre : x.etiqueta) : "";
      partes.push(`${LISTA[nombre]} ${i + 1}${titulo ? ` (${titulo})` : ""}`);
    } else if (partes.length > 0) {
      // Un elemento de una lista de valores (un cementerio de un filtro, un tipo de monumento).
      campos.push(NOMBRE_CAMPO[nombre] ?? nombre);
    } else {
      partes.push(NOMBRE_CAMPO[nombre] ?? nombre);
    }
  }
  return `${partes.join(", ")}${campos.length > 0 ? `: ${[...new Set(campos)].join(", ")}` : ""}`;
}

/** El índice del paso de una ruta (`pasos[2].x` → 2), para abrir su panel. */
export function indiceDePaso(ruta: string): number | null {
  const m = /^pasos\[(\d+)\]/.exec(ruta);
  return m ? Number(m[1]) : null;
}

// ---------------------------------------------------------------------------
// Claves
// ---------------------------------------------------------------------------

/**
 * Todas las claves de la definición: una sola tabla, como en validar.ts
 * (`items` y los movimientos nombran las claves sin decir de qué son).
 */
export function clavesUsadas(def: DefinicionPlantilla): Map<string, string> {
  const r = new Map<string, string>();
  def.pasos.forEach((p, i) => {
    r.set(p.clave, `el paso ${i + 1}`);
    p.subtareas.forEach((s) => r.set(s.clave, `una subtarea de "${p.nombre || p.clave}"`));
  });
  def.documentos.forEach((d) => r.set(d.clave, "un documento"));
  def.conceptos.forEach((c) => r.set(c.clave, "un concepto"));
  def.campos_extra.forEach((c) => r.set(c.clave, "un campo extra"));
  r.delete("");
  return r;
}

/**
 * Una clave escrita a mano en el formato del esquema: sin acentos, espacios a
 * `_`, y mayúsculas (pasos, subtareas, documentos, conceptos) o minúsculas
 * (campos extra y roles de persona).
 */
export function normalizarClave(texto: string, minusculas: boolean): string {
  const sin = texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .replace(/[\s-]+/g, "_")
    .replace(/[^A-Za-z0-9_]/g, "");
  return minusculas ? sin.toLowerCase() : sin.toUpperCase();
}

/** `PASO_1`, `PASO_2`…: la primera que no se usa. */
export function claveLibre(def: DefinicionPlantilla, prefijo: string): string {
  const usadas = new Set([...clavesUsadas(def).keys(), ...def.personas.map((p) => p.rol)]);
  for (let n = 1; ; n += 1) {
    const clave = `${prefijo}_${n}`;
    if (!usadas.has(clave)) return clave;
  }
}

/** Qué clave se renombra. */
export type RefClave =
  | { tipo: "paso"; paso: number }
  | { tipo: "subtarea"; paso: number; subtarea: number }
  | { tipo: "documento"; indice: number }
  | { tipo: "concepto"; indice: number }
  | { tipo: "campo"; indice: number }
  | { tipo: "rol"; indice: number };

export type ResultadoRenombre = { ok: true; def: DefinicionPlantilla; clave: string } | { ok: false; mensaje: string };

function claveActual(def: DefinicionPlantilla, ref: RefClave): string {
  switch (ref.tipo) {
    case "paso":
      return def.pasos[ref.paso]?.clave ?? "";
    case "subtarea":
      return def.pasos[ref.paso]?.subtareas[ref.subtarea]?.clave ?? "";
    case "documento":
      return def.documentos[ref.indice]?.clave ?? "";
    case "concepto":
      return def.conceptos[ref.indice]?.clave ?? "";
    case "campo":
      return def.campos_extra[ref.indice]?.clave ?? "";
    case "rol":
      return def.personas[ref.indice]?.rol ?? "";
  }
}

/**
 * Cambia una clave y todo lo que la nombra, para que renombrar no deje
 * referencias colgadas:
 * - un paso: `exigir_al_salir_de` de documentos y campos extra y `paso` de los conceptos;
 * - una subtarea: el `desde_subtarea` y `hasta_subtarea` de los plazos;
 * - un campo extra: `$CAMPO:<clave>` en el área de los pasos;
 * - un rol: `solo_si_juridica` de los documentos.
 *
 * Se aplica al terminar de escribir (al salir del campo), no en cada tecla:
 * si a mitad de camino la clave coincidiera con otra, las referencias de las
 * dos quedarían mezcladas. Por lo mismo, una clave que ya usa otro elemento se
 * rechaza y la anterior queda como estaba.
 */
export function renombrarClave(def: DefinicionPlantilla, ref: RefClave, escrita: string): ResultadoRenombre {
  const minusculas = ref.tipo === "campo" || ref.tipo === "rol";
  const nueva = normalizarClave(escrita, minusculas);
  const vieja = claveActual(def, ref);
  if (nueva === vieja) return { ok: true, def, clave: nueva };
  if (nueva !== "") {
    if (ref.tipo === "rol") {
      if (def.personas.some((p, i) => i !== ref.indice && p.rol === nueva)) return { ok: false, mensaje: `Ya hay un rol "${nueva}"` };
    } else {
      const donde = clavesUsadas(def).get(nueva);
      if (donde !== undefined) return { ok: false, mensaje: `La clave ${nueva} ya la usa ${donde}: las claves no se repiten en toda la plantilla` };
    }
  }
  const cambiar = (v: string | null): string | null => (vieja !== "" && v === vieja ? nueva : v);

  switch (ref.tipo) {
    case "paso": {
      const pasos = def.pasos.map((p, i) => (i === ref.paso ? { ...p, clave: nueva } : p));
      return {
        ok: true,
        clave: nueva,
        def: {
          ...def,
          pasos,
          documentos: def.documentos.map((d) => ({ ...d, exigir_al_salir_de: cambiar(d.exigir_al_salir_de) })),
          campos_extra: def.campos_extra.map((c) => ({ ...c, exigir_al_salir_de: cambiar(c.exigir_al_salir_de) })),
          conceptos: def.conceptos.map((c) => ({ ...c, paso: cambiar(c.paso) ?? "" })),
        },
      };
    }
    case "subtarea": {
      const pasos = def.pasos.map((p, i) => ({
        ...p,
        subtareas: i === ref.paso ? p.subtareas.map((s, j) => (j === ref.subtarea ? { ...s, clave: nueva } : s)) : p.subtareas,
        plazo: p.plazo
          ? { ...p.plazo, desde_subtarea: cambiar(p.plazo.desde_subtarea) ?? "", hasta_subtarea: cambiar(p.plazo.hasta_subtarea) ?? "" }
          : null,
      }));
      return { ok: true, clave: nueva, def: { ...def, pasos } };
    }
    case "documento":
      return { ok: true, clave: nueva, def: { ...def, documentos: def.documentos.map((d, i) => (i === ref.indice ? { ...d, clave: nueva } : d)) } };
    case "concepto":
      return { ok: true, clave: nueva, def: { ...def, conceptos: def.conceptos.map((c, i) => (i === ref.indice ? { ...c, clave: nueva } : c)) } };
    case "campo": {
      const areaVieja = `${PREFIJO_CAMPO}${vieja}`;
      return {
        ok: true,
        clave: nueva,
        def: {
          ...def,
          campos_extra: def.campos_extra.map((c, i) => (i === ref.indice ? { ...c, clave: nueva } : c)),
          pasos: def.pasos.map((p) => (vieja !== "" && p.area === areaVieja ? { ...p, area: `${PREFIJO_CAMPO}${nueva}` } : p)),
        },
      };
    }
    case "rol":
      return {
        ok: true,
        clave: nueva,
        def: {
          ...def,
          personas: def.personas.map((p, i) => (i === ref.indice ? { ...p, rol: nueva } : p)),
          documentos: def.documentos.map((d) => ({ ...d, solo_si_juridica: cambiar(d.solo_si_juridica) })),
        },
      };
  }
}

// ---------------------------------------------------------------------------
// Listas: agregar, quitar, mover
// ---------------------------------------------------------------------------

/** Mueve un elemento `delta` lugares (−1 sube, +1 baja). Fuera de rango, la misma lista. */
export function mover<T>(lista: readonly T[], indice: number, delta: number): T[] {
  const destino = indice + delta;
  if (indice < 0 || indice >= lista.length || destino < 0 || destino >= lista.length) return [...lista];
  const r = [...lista];
  const [elemento] = r.splice(indice, 1);
  r.splice(destino, 0, elemento);
  return r;
}

function reemplazar<T>(lista: readonly T[], indice: number, cambios: Partial<NoInfer<T>>): T[] {
  return lista.map((x, i) => (i === indice ? { ...x, ...cambios } : x));
}

function quitar<T>(lista: readonly T[], indice: number): T[] {
  return lista.filter((_, i) => i !== indice);
}

export type CambiosGenerales = Partial<Pick<DefinicionPlantilla, "forma_pago" | "tipos_monumento" | "ubicacion_obligatoria" | "requiere_contacto">>;

export function cambiarGeneral(def: DefinicionPlantilla, cambios: CambiosGenerales): DefinicionPlantilla {
  return { ...def, ...cambios };
}

/** Marca o desmarca un tipo de monumento (ninguno marcado = todos los del cementerio). */
export function alternarMonumento(def: DefinicionPlantilla, codigo: string, marcado: boolean): DefinicionPlantilla {
  const sin = def.tipos_monumento.filter((c) => c !== codigo);
  return { ...def, tipos_monumento: marcado ? [...sin, codigo] : sin };
}

// --- Pasos --------------------------------------------------------------------

export function pasoNuevo(def: DefinicionPlantilla): PasoPlantilla {
  return {
    clave: claveLibre(def, "PASO"),
    nombre: "",
    area: "",
    custodia: null,
    estado: "en_tramite",
    omitible: false,
    dias_alerta: 5,
    instrucciones: null,
    plazo: null,
    subtareas: [],
  };
}

export function agregarPaso(def: DefinicionPlantilla): DefinicionPlantilla {
  return { ...def, pasos: [...def.pasos, pasoNuevo(def)] };
}

export function quitarPaso(def: DefinicionPlantilla, indice: number): DefinicionPlantilla {
  return { ...def, pasos: quitar(def.pasos, indice) };
}

export function moverPaso(def: DefinicionPlantilla, indice: number, delta: number): DefinicionPlantilla {
  return { ...def, pasos: mover(def.pasos, indice, delta) };
}

/** Lo que el editor necesita saber de un área para el paso (una fila de `areas` sirve). */
export interface AreaEditor {
  codigo: string;
  nombre: string;
  tipo: string;
  activa: boolean;
  recibePases: boolean;
}

/**
 * ¿El paso necesita custodia? Sí si va a un área externa o a un comodín (los
 * comodines siempre son un cementerio); no si es interna; `null` si el área
 * todavía no se eligió o no existe.
 */
export function necesitaCustodia(area: string, areas: readonly AreaEditor[]): boolean | null {
  if (area === "") return null;
  const destino = destinoDePaso(area);
  if (destino.tipo !== "area") return true;
  const a = areas.find((x) => x.codigo === destino.codigo);
  return a ? a.tipo !== "interna" : null;
}

/**
 * Cambia campos de un paso. Al elegir un área interna se vacía la custodia
 * (validar.ts la exige vacía ahí): así no queda un error que el editor ya
 * sabía cómo resolver.
 */
export function cambiarPaso(def: DefinicionPlantilla, indice: number, cambios: Partial<Omit<PasoPlantilla, "clave" | "subtareas">>, areas: readonly AreaEditor[] = []): DefinicionPlantilla {
  const pasos = reemplazar(def.pasos, indice, cambios);
  const paso = pasos[indice];
  if (paso && cambios.area !== undefined && necesitaCustodia(paso.area, areas) === false && paso.custodia !== null) {
    pasos[indice] = { ...paso, custodia: null };
  }
  return { ...def, pasos };
}

export function activarPlazo(def: DefinicionPlantilla, indice: number, activo: boolean): DefinicionPlantilla {
  const paso = def.pasos[indice];
  if (!paso) return def;
  const desde = paso.subtareas.find((s) => s.dato === "fecha")?.clave ?? "";
  const plazo = activo ? (paso.plazo ?? { dias_habiles: 30, desde_subtarea: desde, hasta_subtarea: paso.subtareas.at(-1)?.clave ?? "" }) : null;
  return { ...def, pasos: reemplazar(def.pasos, indice, { plazo }) };
}

// --- Subtareas ----------------------------------------------------------------

export function agregarSubtarea(def: DefinicionPlantilla, paso: number): DefinicionPlantilla {
  const p = def.pasos[paso];
  if (!p) return def;
  const base = normalizarClave(p.clave || "SUB", false).slice(0, 12) || "SUB";
  const nueva: SubtareaPlantilla = {
    clave: claveLibre(def, base),
    nombre: "",
    obligatoria: true,
    dato: null,
    dato_obligatorio: false,
    solo_cementerios: null,
    excepto_cementerios: null,
  };
  return { ...def, pasos: reemplazar(def.pasos, paso, { subtareas: [...p.subtareas, nueva] }) };
}

export function quitarSubtarea(def: DefinicionPlantilla, paso: number, subtarea: number): DefinicionPlantilla {
  const p = def.pasos[paso];
  if (!p) return def;
  return { ...def, pasos: reemplazar(def.pasos, paso, { subtareas: quitar(p.subtareas, subtarea) }) };
}

export function moverSubtarea(def: DefinicionPlantilla, paso: number, subtarea: number, delta: number): DefinicionPlantilla {
  const p = def.pasos[paso];
  if (!p) return def;
  return { ...def, pasos: reemplazar(def.pasos, paso, { subtareas: mover(p.subtareas, subtarea, delta) }) };
}

/**
 * Cambia campos de una subtarea. Sin dato no puede ser "dato obligatorio"
 * (validar.ts lo rechaza), así que quitar el dato también lo desmarca.
 */
export function cambiarSubtarea(def: DefinicionPlantilla, paso: number, subtarea: number, cambios: Partial<Omit<SubtareaPlantilla, "clave">>): DefinicionPlantilla {
  const p = def.pasos[paso];
  if (!p) return def;
  const subtareas = reemplazar(p.subtareas, subtarea, cambios);
  const s = subtareas[subtarea];
  if (s && s.dato === null && s.dato_obligatorio) subtareas[subtarea] = { ...s, dato_obligatorio: false };
  return { ...def, pasos: reemplazar(def.pasos, paso, { subtareas }) };
}

// --- Personas, documentos, conceptos y campos extra ------------------------------

/** `a`, `b`… `z`, `aa`: los roles solo admiten letras y `_` (el CHECK de expediente_personas.rol). */
function letras(n: number): string {
  let r = "";
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) r = "abcdefghijklmnopqrstuvwxyz"[(x - 1) % 26] + r;
  return r;
}

export function agregarPersona(def: DefinicionPlantilla): DefinicionPlantilla {
  const usados = new Set(def.personas.map((p) => p.rol));
  let n = 1;
  while (usados.has(`rol_${letras(n)}`)) n += 1;
  const persona: PersonaPlantilla = {
    rol: `rol_${letras(n)}`,
    etiqueta: "",
    min: 0,
    max: 1,
    fallecido: "no",
    pide_vinculo: false,
    admite_juridica: false,
  };
  return { ...def, personas: [...def.personas, persona] };
}

export const quitarPersona = (def: DefinicionPlantilla, i: number): DefinicionPlantilla => ({ ...def, personas: quitar(def.personas, i) });
export const moverPersona = (def: DefinicionPlantilla, i: number, delta: number): DefinicionPlantilla => ({ ...def, personas: mover(def.personas, i, delta) });
export const cambiarPersona = (def: DefinicionPlantilla, i: number, cambios: Partial<Omit<PersonaPlantilla, "rol">>): DefinicionPlantilla => ({
  ...def,
  personas: reemplazar(def.personas, i, cambios),
});

export function agregarDocumento(def: DefinicionPlantilla): DefinicionPlantilla {
  const doc: DocumentoPlantilla = {
    clave: claveLibre(def, "DOC"),
    nombre: "",
    origen: "concesionario",
    obligatorio: true,
    exigir_al_salir_de: null,
    adjunto: "no",
    solo_cementerios: null,
    excepto_cementerios: null,
    solo_si_juridica: null,
  };
  return { ...def, documentos: [...def.documentos, doc] };
}

export const quitarDocumento = (def: DefinicionPlantilla, i: number): DefinicionPlantilla => ({ ...def, documentos: quitar(def.documentos, i) });
export const moverDocumento = (def: DefinicionPlantilla, i: number, delta: number): DefinicionPlantilla => ({ ...def, documentos: mover(def.documentos, i, delta) });
export const cambiarDocumento = (def: DefinicionPlantilla, i: number, cambios: Partial<Omit<DocumentoPlantilla, "clave">>): DefinicionPlantilla => ({
  ...def,
  documentos: reemplazar(def.documentos, i, cambios),
});

export function agregarConcepto(def: DefinicionPlantilla): DefinicionPlantilla {
  const c: ConceptoPlantilla = { clave: claveLibre(def, "CONCEPTO"), nombre: "", via: "boleta", paso: "", solo_cementerios: null, excepto_cementerios: null };
  return { ...def, conceptos: [...def.conceptos, c] };
}

export const quitarConcepto = (def: DefinicionPlantilla, i: number): DefinicionPlantilla => ({ ...def, conceptos: quitar(def.conceptos, i) });
export const moverConcepto = (def: DefinicionPlantilla, i: number, delta: number): DefinicionPlantilla => ({ ...def, conceptos: mover(def.conceptos, i, delta) });
export const cambiarConcepto = (def: DefinicionPlantilla, i: number, cambios: Partial<Omit<ConceptoPlantilla, "clave">>): DefinicionPlantilla => ({
  ...def,
  conceptos: reemplazar(def.conceptos, i, cambios),
});

export function agregarCampoExtra(def: DefinicionPlantilla): DefinicionPlantilla {
  const c: CampoExtraPlantilla = {
    clave: claveLibre(def, "campo"),
    etiqueta: "",
    tipo: "texto",
    obligatorio: false,
    exigir_al_salir_de: null,
    buscable: false,
    opciones: null,
  };
  return { ...def, campos_extra: [...def.campos_extra, c] };
}

export const quitarCampoExtra = (def: DefinicionPlantilla, i: number): DefinicionPlantilla => ({ ...def, campos_extra: quitar(def.campos_extra, i) });
export const moverCampoExtra = (def: DefinicionPlantilla, i: number, delta: number): DefinicionPlantilla => ({ ...def, campos_extra: mover(def.campos_extra, i, delta) });

/**
 * Cambia un campo extra. Las opciones van solo con `tipo: opcion` (validar.ts):
 * al pasar a opción aparece la lista vacía para completar, y al salir se quita.
 */
export function cambiarCampoExtra(def: DefinicionPlantilla, i: number, cambios: Partial<Omit<CampoExtraPlantilla, "clave">>): DefinicionPlantilla {
  const campos = reemplazar(def.campos_extra, i, cambios);
  const c = campos[i];
  if (c && cambios.tipo !== undefined) campos[i] = { ...c, opciones: c.tipo === "opcion" ? (c.opciones ?? []) : null };
  return { ...def, campos_extra: campos };
}

/** Las opciones como las escribe el editor: una por renglón (los renglones vacíos no cuentan). */
export function opcionesDesdeTexto(texto: string): string[] {
  return texto.split(/\r?\n/).map((o) => o.trim()).filter((o) => o !== "");
}

// ---------------------------------------------------------------------------
// Filtros por cementerio
// ---------------------------------------------------------------------------

export type ModoFiltro = "todos" | "solo" | "excepto";

export function modoFiltro(f: FiltroCementerios): ModoFiltro {
  if (f.solo_cementerios !== null) return "solo";
  if (f.excepto_cementerios !== null) return "excepto";
  return "todos";
}

/** Los cementerios marcados del filtro (los de `solo` o los de `excepto`). */
export function cementeriosDelFiltro(f: FiltroCementerios): string[] {
  return f.solo_cementerios ?? f.excepto_cementerios ?? [];
}

/** Cambiar de modo conserva los cementerios marcados. */
export function filtroConModo(f: FiltroCementerios, modo: ModoFiltro): FiltroCementerios {
  const marcados = cementeriosDelFiltro(f);
  if (modo === "todos") return { solo_cementerios: null, excepto_cementerios: null };
  return modo === "solo" ? { solo_cementerios: marcados, excepto_cementerios: null } : { solo_cementerios: null, excepto_cementerios: marcados };
}

export function filtroConCementerio(f: FiltroCementerios, codigo: string, marcado: boolean): FiltroCementerios {
  const modo = modoFiltro(f);
  if (modo === "todos") return f;
  const sin = cementeriosDelFiltro(f).filter((c) => c !== codigo);
  const lista = marcado ? [...sin, codigo] : sin;
  return modo === "solo" ? { solo_cementerios: lista, excepto_cementerios: null } : { solo_cementerios: null, excepto_cementerios: lista };
}

// ---------------------------------------------------------------------------
// Vista previa por cementerio (con el resolver)
// ---------------------------------------------------------------------------

export interface CementerioEditor {
  codigo: string;
  nombre: string;
  activo: boolean;
  /** El nombre de su área externa (a donde va un paso `$CEMENTERIO`). */
  area: string;
  tiposMonumento: string[];
}

export interface VistaPrevia {
  cementerio: string;
  monumentos: string[];
  pasos: Array<{
    numero: number;
    clave: string;
    nombre: string;
    destino: string;
    custodia: string | null;
    omitible: boolean;
    plazo: string | null;
    subtareas: Array<{ clave: string; nombre: string; obligatoria: boolean; dato: string | null }>;
  }>;
  documentos: Array<{ clave: string; nombre: string; origen: string; obligatorio: boolean; soloSiJuridica: string | null }>;
  conceptos: Array<{ clave: string; nombre: string; via: string; paso: string }>;
  /** Lo que el filtro saca en este cementerio, para que se vea la diferencia. */
  excluidos: string[];
}

/**
 * Cómo queda la plantilla en un cementerio: lo que calcula
 * `resolverPorCementerio()` (lo mismo que verá el alta), con nombres en vez de
 * códigos. Los documentos que dependen de una persona jurídica quedan, con su
 * condición: se deciden con las personas de cada expediente.
 */
export function vistaPrevia(
  def: DefinicionPlantilla,
  cementerio: CementerioEditor,
  catalogos: { areas: readonly AreaEditor[]; tiposMonumento: ReadonlyArray<{ codigo: string; nombre: string }> },
): VistaPrevia {
  const r = resolverPorCementerio(def, cementerio.codigo);
  const nombreArea = (codigo: string | null): string | null => (codigo === null ? null : (catalogos.areas.find((a) => a.codigo === codigo)?.nombre ?? codigo));
  const nombrePaso = (clave: string): string => def.pasos.find((p) => p.clave === clave)?.nombre || clave;
  const habilitados = cementerio.tiposMonumento;
  const pedidos = def.tipos_monumento.length === 0 ? habilitados : def.tipos_monumento.filter((t) => habilitados.includes(t));
  const destino = (area: string): string => {
    if (area === COMODIN_CEMENTERIO) return `${cementerio.area} (el cementerio del expediente)`;
    const d = destinoDePaso(area);
    if (d.tipo === "campo") return `El cementerio elegido en "${def.campos_extra.find((c) => c.clave === d.clave)?.etiqueta || d.clave}"`;
    return nombreArea(area) ?? "(sin área)";
  };

  const enResuelta = new Set([...r.documentos.map((d) => d.clave), ...r.conceptos.map((c) => c.clave), ...r.pasos.flatMap((p) => p.subtareas.map((s) => s.clave))]);
  const excluidos = [
    ...def.documentos.filter((d) => !enResuelta.has(d.clave)).map((d) => `Documento: ${d.nombre || d.clave}`),
    ...def.conceptos.filter((c) => !enResuelta.has(c.clave)).map((c) => `Concepto: ${c.nombre || c.clave}`),
    ...def.pasos.flatMap((p) => p.subtareas.filter((s) => !enResuelta.has(s.clave)).map((s) => `Subtarea de ${p.nombre || p.clave}: ${s.nombre || s.clave}`)),
  ];

  return {
    cementerio: cementerio.nombre,
    monumentos: pedidos.map((c) => catalogos.tiposMonumento.find((t) => t.codigo === c)?.nombre ?? c),
    pasos: r.pasos.map((p, i) => ({
      numero: i + 1,
      clave: p.clave,
      nombre: p.nombre || p.clave,
      destino: destino(p.area),
      custodia: nombreArea(p.custodia),
      omitible: p.omitible,
      plazo: p.plazo ? `${p.plazo.dias_habiles} días hábiles desde ${p.plazo.desde_subtarea} hasta ${p.plazo.hasta_subtarea}` : null,
      subtareas: p.subtareas.map((s) => ({ clave: s.clave, nombre: s.nombre || s.clave, obligatoria: s.obligatoria, dato: s.dato })),
    })),
    documentos: r.documentos.map((d) => ({ clave: d.clave, nombre: d.nombre || d.clave, origen: d.origen, obligatorio: d.obligatorio, soloSiJuridica: d.solo_si_juridica })),
    conceptos: r.conceptos.map((c) => ({ clave: c.clave, nombre: c.nombre || c.clave, via: c.via, paso: nombrePaso(c.paso) })),
    excluidos,
  };
}
