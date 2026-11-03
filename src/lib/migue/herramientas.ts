import type { Bandeja, ContadoresBandeja, Ficha, FilaBandeja, Panel, PestanaBandeja } from "@/lib/dominio/expedientes";
import { ErrorDominio } from "@/lib/dominio/expedientes/errores";
import { canonizarNumeroInterno } from "@/lib/dominio/expedientes/numero";
import { evaluarPermiso, PermisoDenegado, type UsuarioPermisos } from "@/lib/dominio/permisos";
import type { PlantillaResumen } from "@/lib/dominio/plantillas/resumen";
import { diaEnTucuman } from "@/lib/fechas";
import { log, resumenError } from "@/lib/log";
import type { Perfil } from "@/lib/presentacion/recorridos/motor";
import { ETIQUETA_FORMA_PAGO, ETIQUETA_SITUACION, etiquetaEstado } from "@/lib/presentacion/textos";
import { buscarEnLaGuia, palabras, parecidas } from "./ayuda-interna";
import type { DefinicionHerramienta, LlamadaHerramienta } from "./openrouter";

/**
 * Las herramientas del Migue del sistema (docs/api-dominio.md, 26.8): de SOLO
 * LECTURA, con function calling, como AppAmbiente.
 *
 * - **Cada una llama a una función del dominio que ya existe**, con el usuario
 *   de la sesión (el perfil efectivo, también con "Ver como…"): la ficha
 *   (`obtenerFicha`, que además deja el acceso en auditoria.accesos, como
 *   abrirla), la bandeja y sus contadores, el panel y el resumen de las
 *   plantillas publicadas. Nada de SQL propio que se saltee los permisos: lo
 *   que el dominio no le muestra a esa persona, Migue tampoco lo ve.
 * - **Nunca devuelven datos personales** (nombres, DNI, CUIL, CUIT, domicilios,
 *   teléfonos, ubicación de la sepultura, observaciones, motivos de
 *   devolución ni adjuntos). Dos barreras: cada salida se arma campo por
 *   campo, a mano, y además pasa por `soloCamposPermitidos`, que descarta toda
 *   clave que no esté en CAMPOS_PERMITIDOS. herramientas.test.ts lo prueba con
 *   una ficha llena de datos personales.
 * - Los errores del dominio (no encontrado, sin permiso) vuelven como un
 *   resultado `{ error }` que el modelo lee y le cuenta a la persona: no se
 *   reintenta por otro lado.
 */

export const NOMBRES_HERRAMIENTAS = ["estado_expediente", "mi_bandeja", "vencidos_y_demorados", "plantilla_tramite", "como_se_hace"] as const;
export type NombreHerramienta = (typeof NOMBRES_HERRAMIENTAS)[number];

const FILTROS_BANDEJA = ["todas", "por_confirmar", "en_mi_area", "afuera", "plazos", "demorados"] as const;
type FiltroBandeja = (typeof FILTROS_BANDEJA)[number];

/** Máximo de expedientes por lista, en cualquier herramienta. */
export const MAXIMO_EXPEDIENTES = 10;

export const DEFINICIONES: DefinicionHerramienta[] = [
  {
    type: "function",
    function: {
      name: "estado_expediente",
      description:
        "El estado de un expediente por su número: tipo de trámite, estado, paso y área actuales, desde cuándo está en el área, qué falta para dar el pase, alertas y plazo de la DIM. Nunca trae personas.",
      strict: true,
      parameters: {
        type: "object",
        properties: { numero: { type: "string", description: "El número del expediente, como CEM-2026-00042 o 42/2026." } },
        required: ["numero"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "mi_bandeja",
      description:
        "La bandeja de la persona (solo operadores con área): cuántos hay en cada pestaña y los primeros 10 de la lista pedida, con número, trámite, estado, días en el área y si está demorado.",
      strict: true,
      parameters: {
        type: "object",
        properties: {
          filtro: {
            type: "string",
            enum: [...FILTROS_BANDEJA],
            description: "Qué lista: todas (por confirmar y en mi área), por_confirmar, en_mi_area, afuera, plazos o demorados.",
          },
        },
        required: ["filtro"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "vencidos_y_demorados",
      description:
        "Los expedientes demorados y los plazos de la DIM vencidos o por vencer que le tocan a la persona: los de su área si tiene bandeja; si no (Dirección, administración), los del panel general.",
      strict: true,
      parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "plantilla_tramite",
      description: "Los pasos (con el área que hace cada uno y sus subtareas) y los documentos de un tipo de trámite publicado.",
      strict: true,
      parameters: {
        type: "object",
        properties: { tipo: { type: "string", description: "El nombre del trámite, como lo dijo la persona (por ejemplo «renovación» o «inhumación»)." } },
        required: ["tipo"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "como_se_hace",
      description: "Cómo se hace algo en el sistema, según la guía de cada pantalla (los mismos textos de los recorridos guiados).",
      strict: true,
      parameters: {
        type: "object",
        properties: { tema: { type: "string", description: "Qué quiere hacer o saber, en pocas palabras (por ejemplo «confirmar recepción»)." } },
        required: ["tema"],
        additionalProperties: false,
      },
    },
  },
];

// ── La lista cerrada ────────────────────────────────────────────────────

/**
 * Todas las claves que puede tener la salida de una herramienta, en cualquier
 * nivel. Sumar una es una decisión: si es un dato de una persona, no va.
 */
export const CAMPOS_PERMITIDOS: ReadonlySet<string> = new Set([
  // Comunes
  "error",
  "mensaje",
  "numero",
  "numeroCorto",
  "tramite",
  "modalidad",
  "estado",
  "paso",
  "orden",
  "total",
  "nombre",
  "areaActual",
  "areaResponsable",
  "diasEnArea",
  "diasAlerta",
  "demorado",
  // estado_expediente
  "enAreaDesde",
  "recibido",
  "alertas",
  "plazo",
  "vence",
  "faltanDiasHabiles",
  "semaforo",
  "texto",
  "faltaParaElPase",
  "tipo",
  "puedeDarPase",
  "puedeConfirmarRecepcion",
  // mi_bandeja
  "area",
  "filtro",
  "conteos",
  "porConfirmar",
  "enMiArea",
  "afuera",
  "plazos",
  "cargaHistorica",
  "expedientes",
  "hayMas",
  // vencidos_y_demorados
  "alcance",
  "demorados",
  "plazosVencidos",
  "plazosPorVencer",
  "cantidad",
  // plantilla_tramite
  "tramites",
  "disponibles",
  "tipoTramite",
  "formaPago",
  "pasos",
  "custodia",
  "esperaPagoDim",
  "omitible",
  "plazoDiasHabiles",
  "subtareas",
  "obligatoria",
  "documentos",
  "origen",
  "obligatorio",
  // como_se_hace
  "encontrado",
  "pantalla",
  "titulo",
]);

/**
 * La segunda barrera: copia el valor dejando solo las claves de la lista (en
 * cualquier nivel). Lo que no es un objeto plano, un array, un texto, un
 * número, un booleano o null, se descarta.
 */
export function soloCamposPermitidos(valor: unknown): unknown {
  if (valor === null || typeof valor === "string" || typeof valor === "number" || typeof valor === "boolean") return valor;
  if (Array.isArray(valor)) return valor.map(soloCamposPermitidos).filter((v) => v !== undefined);
  if (typeof valor === "object" && Object.getPrototypeOf(valor) === Object.prototype) {
    const salida: Record<string, unknown> = {};
    for (const [clave, v] of Object.entries(valor)) {
      if (!CAMPOS_PERMITIDOS.has(clave)) continue;
      const limpio = soloCamposPermitidos(v);
      if (limpio !== undefined) salida[clave] = limpio;
    }
    return salida;
  }
  return undefined;
}

// ── Lo que pide el modelo ───────────────────────────────────────────────

export type LlamadaInterpretada =
  | { ok: true; id: string; nombre: "estado_expediente"; argumentos: { numero: string } }
  | { ok: true; id: string; nombre: "mi_bandeja"; argumentos: { filtro: FiltroBandeja } }
  | { ok: true; id: string; nombre: "vencidos_y_demorados"; argumentos: Record<string, never> }
  | { ok: true; id: string; nombre: "plantilla_tramite"; argumentos: { tipo: string } }
  | { ok: true; id: string; nombre: "como_se_hace"; argumentos: { tema: string } }
  | { ok: false; id: string; nombre: string; error: string };

function textoCorto(valor: unknown, largo: number): string | null {
  if (typeof valor !== "string") return null;
  const t = valor.replace(/\s+/g, " ").trim();
  return t && t.length <= largo ? t : null;
}

/**
 * Lee un pedido de herramienta del modelo: el nombre tiene que ser uno de los
 * ofrecidos y los argumentos, JSON válido con la forma de su esquema. Pura.
 */
export function interpretarLlamada(llamada: LlamadaHerramienta): LlamadaInterpretada {
  const { id } = llamada;
  const nombre = llamada.function.name;
  if (!(NOMBRES_HERRAMIENTAS as readonly string[]).includes(nombre)) return { ok: false, id, nombre, error: `No hay ninguna herramienta «${nombre.slice(0, 40)}».` };
  let args: unknown;
  try {
    args = JSON.parse(llamada.function.arguments || "{}");
  } catch {
    return { ok: false, id, nombre, error: "Los argumentos no son JSON válido. Volvé a pedirla." };
  }
  if (typeof args !== "object" || args === null || Array.isArray(args)) return { ok: false, id, nombre, error: "Los argumentos tienen que ser un objeto." };
  const a = args as Record<string, unknown>;
  switch (nombre as NombreHerramienta) {
    case "estado_expediente": {
      const numero = typeof a.numero === "string" ? canonizarNumeroInterno(a.numero) : null;
      return numero
        ? { ok: true, id, nombre: "estado_expediente", argumentos: { numero } }
        : { ok: false, id, nombre, error: "Ese no es un número de expediente: tiene que ser como CEM-2026-00042 o 42/2026." };
    }
    case "mi_bandeja": {
      const filtro = a.filtro === undefined || a.filtro === "" ? "todas" : a.filtro;
      return (FILTROS_BANDEJA as readonly unknown[]).includes(filtro)
        ? { ok: true, id, nombre: "mi_bandeja", argumentos: { filtro: filtro as FiltroBandeja } }
        : { ok: false, id, nombre, error: `El filtro tiene que ser uno de: ${FILTROS_BANDEJA.join(", ")}.` };
    }
    case "vencidos_y_demorados":
      return { ok: true, id, nombre: "vencidos_y_demorados", argumentos: {} };
    case "plantilla_tramite": {
      const tipo = textoCorto(a.tipo, 100);
      return tipo ? { ok: true, id, nombre: "plantilla_tramite", argumentos: { tipo } } : { ok: false, id, nombre, error: "Falta el tipo de trámite (hasta 100 letras)." };
    }
    case "como_se_hace": {
      const tema = textoCorto(a.tema, 200);
      return tema ? { ok: true, id, nombre: "como_se_hace", argumentos: { tema } } : { ok: false, id, nombre, error: "Falta el tema (hasta 200 letras)." };
    }
  }
}

// ── Lo que hacen ────────────────────────────────────────────────────────

/** Las funciones del dominio que usan (la app pasa las de los servicios; las pruebas, las suyas). */
export interface ServiciosHerramientas {
  obtenerFicha: (usuario: UsuarioPermisos, numero: string) => Promise<Ficha>;
  bandeja: (usuario: UsuarioPermisos, pestana: PestanaBandeja) => Promise<Bandeja>;
  contadoresBandeja: (usuario: UsuarioPermisos) => Promise<ContadoresBandeja>;
  panel: (usuario: UsuarioPermisos) => Promise<Panel>;
  plantillas: () => Promise<PlantillaResumen[]>;
}

export interface ContextoHerramienta {
  usuario: UsuarioPermisos;
  /** Para los textos de la guía (como_se_hace). */
  perfil: Perfil;
  servicios: ServiciosHerramientas;
}

export interface ResultadoHerramienta {
  /** Lo que lee el modelo, ya filtrado por la lista cerrada. */
  datos: Record<string, unknown>;
  /** Los números de expediente que devolvió: los únicos que pueden ir como enlace a su ficha. */
  numeros: string[];
}

const TEXTO_ALERTA: Record<string, string> = { ...ETIQUETA_SITUACION, demorado: "Demorado" };

function fecha(valor: Date | null): string | null {
  return valor ? diaEnTucuman(valor) : null;
}

/** estado_expediente, campo por campo. Exportada para la prueba de la lista cerrada. */
export function salidaEstado(f: Ficha): Record<string, unknown> {
  const tramoActual = f.tramos.find((t) => t.actual) ?? null;
  const pasoActual = f.recorrido.find((p) => p.situacion === "actual") ?? null;
  const diasEnArea = tramoActual?.diasHabiles ?? null;
  const diasAlerta = pasoActual?.diasAlerta ?? null;
  const activo = f.estado === "en_tramite" || f.estado === "espera_pago_dim";
  const demorado = activo && !f.cargaHistorica && diasEnArea !== null && diasAlerta !== null && diasEnArea >= diasAlerta;
  const alertas = [...f.situaciones, ...(demorado ? ["demorado"] : [])].map((s) => TEXTO_ALERTA[s] ?? s);
  return {
    numero: f.numero,
    numeroCorto: f.numeroCorto,
    tramite: f.tipoTramite.nombre,
    modalidad: f.plantilla.nombre,
    estado: etiquetaEstado(f.estado),
    paso: { orden: f.paso.orden, total: f.paso.total, nombre: f.paso.nombre },
    areaActual: f.areaActual.nombre,
    areaResponsable: f.areaResponsable.nombre,
    enAreaDesde: fecha(f.enAreaDesde),
    recibido: f.recibidoEn !== null,
    diasEnArea,
    diasAlerta,
    demorado,
    alertas,
    plazo: f.plazo ? { vence: f.plazo.vence, faltanDiasHabiles: f.plazo.faltan, semaforo: f.plazo.semaforo, texto: f.plazo.texto } : null,
    // Solo el tipo y el nombre de lo que falta (los de la plantilla); nunca el `mensaje` ni las observaciones.
    faltaParaElPase: f.pase.faltan.map((x) => ({ tipo: x.tipo, nombre: x.tipo === "campo_extra" ? x.etiqueta : x.nombre })),
    puedeDarPase: f.acciones.darPase.permitido,
    puedeConfirmarRecepcion: f.acciones.confirmarRecepcion.permitido && f.situaciones.includes("sin_confirmar"),
  };
}

/** Una fila de la bandeja, sin el titular ni la devolución (su motivo). */
export function salidaFilaBandeja(f: FilaBandeja): Record<string, unknown> {
  return { numero: f.numero, tramite: f.tramite.tipo, estado: etiquetaEstado(f.estado), diasEnArea: f.diasEnArea, demorado: f.demorado };
}

const PESTANA_DE_FILTRO: Record<Exclude<FiltroBandeja, "todas" | "demorados">, PestanaBandeja> = {
  por_confirmar: "por_confirmar",
  en_mi_area: "en_mi_area",
  afuera: "afuera",
  plazos: "plazos",
};

const SIN_BANDEJA = "Tu perfil no tiene bandeja (es de los operadores con área). Mirá el Panel, o preguntame por los vencidos y demorados.";

function unicas(filas: FilaBandeja[]): FilaBandeja[] {
  const vistos = new Set<string>();
  return filas.filter((f) => (vistos.has(f.numero) ? false : (vistos.add(f.numero), true)));
}

async function miBandeja(ctx: ContextoHerramienta, filtro: FiltroBandeja): Promise<ResultadoHerramienta> {
  if (!evaluarPermiso("ver_bandeja", null, ctx.usuario).permitido || !ctx.usuario.area) return { datos: { error: SIN_BANDEJA }, numeros: [] };
  const c = await ctx.servicios.contadoresBandeja(ctx.usuario);
  const pestanas: PestanaBandeja[] =
    filtro === "todas" ? ["por_confirmar", "en_mi_area"] : filtro === "demorados" ? ["en_mi_area", "afuera", "plazos"] : [PESTANA_DE_FILTRO[filtro]];
  const bandejas = await Promise.all(pestanas.map((p) => ctx.servicios.bandeja(ctx.usuario, p)));
  let filas = unicas(bandejas.flatMap((b) => b.filas));
  if (filtro === "demorados") filas = filas.filter((f) => f.demorado);
  const lista = filas.slice(0, MAXIMO_EXPEDIENTES);
  return {
    datos: {
      filtro,
      conteos: { porConfirmar: c.por_confirmar, enMiArea: c.en_mi_area, afuera: c.afuera, plazos: c.plazos, cargaHistorica: c.carga_historica },
      total: filas.length,
      expedientes: lista.map(salidaFilaBandeja),
      hayMas: filas.length > MAXIMO_EXPEDIENTES || bandejas.some((b) => b.hayMas),
    },
    numeros: lista.map((f) => f.numero),
  };
}

async function vencidosYDemorados(ctx: ContextoHerramienta): Promise<ResultadoHerramienta> {
  const conBandeja = evaluarPermiso("ver_bandeja", null, ctx.usuario).permitido && ctx.usuario.area !== null;
  if (conBandeja) {
    const bandejas = await Promise.all((["en_mi_area", "afuera", "plazos"] as const).map((p) => ctx.servicios.bandeja(ctx.usuario, p)));
    const filas = unicas(bandejas.flatMap((b) => b.filas));
    const demorados = filas.filter((f) => f.demorado);
    const conPlazo = filas.flatMap((f) => f.etiquetas.filter((e) => e.tipo === "plazo").map((e) => ({ f, e })));
    const vencidos = conPlazo.filter((x) => x.e.semaforo === "vencido");
    const porVencer = conPlazo.filter((x) => x.e.semaforo === "por_vencer");
    const conPlazoSalida = (x: (typeof conPlazo)[number]) => ({ numero: x.f.numero, tramite: x.f.tramite.tipo, vence: x.e.vence, faltanDiasHabiles: x.e.faltan });
    const listas = [demorados.slice(0, MAXIMO_EXPEDIENTES).map((f) => f.numero), vencidos.slice(0, MAXIMO_EXPEDIENTES).map((x) => x.f.numero), porVencer.slice(0, MAXIMO_EXPEDIENTES).map((x) => x.f.numero)];
    return {
      datos: {
        alcance: "los expedientes de tu área (tu bandeja: en tu área, afuera y plazos)",
        demorados: {
          cantidad: demorados.length,
          expedientes: demorados.slice(0, MAXIMO_EXPEDIENTES).map((f) => ({ numero: f.numero, tramite: f.tramite.tipo, paso: f.paso.nombre, areaActual: f.areaActual.nombre, diasEnArea: f.diasEnArea, diasAlerta: f.diasAlerta })),
        },
        plazosVencidos: { cantidad: vencidos.length, expedientes: vencidos.slice(0, MAXIMO_EXPEDIENTES).map(conPlazoSalida) },
        plazosPorVencer: { cantidad: porVencer.length, expedientes: porVencer.slice(0, MAXIMO_EXPEDIENTES).map(conPlazoSalida) },
      },
      numeros: [...new Set(listas.flat())],
    };
  }
  if (!evaluarPermiso("ver_panel", null, ctx.usuario).permitido) return { datos: { error: "Con tu usuario no podés ver el panel." }, numeros: [] };
  const p = await ctx.servicios.panel(ctx.usuario);
  const fila = (f: Panel["demorados"]["filas"][number]) => ({ numero: f.numero, tramite: f.tramite, paso: f.paso, areaActual: f.areaActual.nombre, diasEnArea: f.diasEnArea, diasAlerta: f.diasAlerta });
  const conPlazo = (f: Panel["plazos"]["vencidos"]["filas"][number]) => ({ numero: f.numero, tramite: f.tramite, vence: f.plazo.vence, faltanDiasHabiles: f.plazo.faltan });
  const demorados = p.demorados.filas.slice(0, MAXIMO_EXPEDIENTES);
  const vencidos = p.plazos.vencidos.filas.slice(0, MAXIMO_EXPEDIENTES);
  const porVencer = p.plazos.porVencer.filas.slice(0, MAXIMO_EXPEDIENTES);
  return {
    datos: {
      alcance: "todo el circuito (el panel general)",
      demorados: { cantidad: p.demorados.cantidad, expedientes: demorados.map(fila) },
      plazosVencidos: { cantidad: p.plazos.vencidos.cantidad, expedientes: vencidos.map(conPlazo) },
      plazosPorVencer: { cantidad: p.plazos.porVencer.cantidad, expedientes: porVencer.map(conPlazo) },
    },
    numeros: [...new Set([...demorados, ...vencidos, ...porVencer].map((f) => f.numero))],
  };
}

/** Los trámites que más palabras comparten con lo pedido (nombre, tipo o código). */
export function elegirPlantillas(tipo: string, plantillas: PlantillaResumen[]): PlantillaResumen[] {
  const buscadas = palabras(tipo).filter((p) => !["tramite", "tramites", "plantilla"].includes(p));
  const puntuadas = plantillas
    .map((p) => {
      const propias = palabras(`${p.nombre} ${p.tipoTramite} ${p.codigo.replace(/_/g, " ")}`);
      return { p, puntaje: buscadas.filter((b) => propias.some((x) => parecidas(x, b))).length };
    })
    .filter((x) => x.puntaje > 0)
    .sort((a, b) => b.puntaje - a.puntaje);
  const mejor = puntuadas[0]?.puntaje ?? 0;
  return puntuadas.filter((x) => x.puntaje === mejor).slice(0, 3).map((x) => x.p);
}

function salidaPlantilla(p: PlantillaResumen): Record<string, unknown> {
  return {
    nombre: p.nombre,
    tipoTramite: p.tipoTramite,
    formaPago: ETIQUETA_FORMA_PAGO[p.formaPago] ?? p.formaPago,
    pasos: p.pasos.map((x) => ({
      orden: x.orden,
      nombre: x.nombre,
      area: x.area,
      custodia: x.custodia,
      esperaPagoDim: x.esperaPagoDim,
      omitible: x.omitible,
      diasAlerta: x.diasAlerta,
      plazoDiasHabiles: x.plazoDiasHabiles,
      subtareas: x.subtareas.map((s) => ({ nombre: s.nombre, obligatoria: s.obligatoria })),
    })),
    documentos: p.documentos.map((d) => ({ nombre: d.nombre, origen: d.origen === "concesionario" ? "lo trae el concesionario" : "lo hace la Dirección", obligatorio: d.obligatorio })),
  };
}

async function correr(llamada: Extract<LlamadaInterpretada, { ok: true }>, ctx: ContextoHerramienta): Promise<ResultadoHerramienta> {
  switch (llamada.nombre) {
    case "estado_expediente": {
      const ficha = await ctx.servicios.obtenerFicha(ctx.usuario, llamada.argumentos.numero);
      return { datos: salidaEstado(ficha), numeros: [ficha.numero] };
    }
    case "mi_bandeja":
      return miBandeja(ctx, llamada.argumentos.filtro);
    case "vencidos_y_demorados":
      return vencidosYDemorados(ctx);
    case "plantilla_tramite": {
      const todas = await ctx.servicios.plantillas();
      const elegidas = elegirPlantillas(llamada.argumentos.tipo, todas);
      return elegidas.length
        ? { datos: { tramites: elegidas.map(salidaPlantilla) }, numeros: [] }
        : { datos: { mensaje: "No encontré un trámite publicado con ese nombre.", disponibles: [...new Set(todas.map((p) => p.nombre))] }, numeros: [] };
    }
    case "como_se_hace": {
      const encontrado = buscarEnLaGuia(llamada.argumentos.tema, ctx.perfil);
      return {
        datos: encontrado.length
          ? { encontrado: encontrado.map((e) => ({ pantalla: e.pantalla, titulo: e.titulo, texto: e.texto })) }
          : { encontrado: [], mensaje: "La guía no dice nada sobre eso." },
        numeros: [],
      };
    }
  }
}

/**
 * Corre una herramienta ya interpretada y devuelve lo que lee el modelo,
 * filtrado. Nunca tira: un error del dominio es un resultado más.
 */
export async function ejecutarHerramienta(llamada: LlamadaInterpretada, ctx: ContextoHerramienta): Promise<ResultadoHerramienta> {
  if (!llamada.ok) return { datos: { error: llamada.error }, numeros: [] };
  try {
    const r = await correr(llamada, ctx);
    return { datos: soloCamposPermitidos(r.datos) as Record<string, unknown>, numeros: r.numeros };
  } catch (error) {
    if (error instanceof PermisoDenegado) return { datos: { error: "Con tu usuario no podés ver eso." }, numeros: [] };
    if (error instanceof ErrorDominio && error.codigo === "no_encontrado") {
      const numero = llamada.nombre === "estado_expediente" ? llamada.argumentos.numero : "";
      return { datos: { error: `No encontré el expediente ${numero}.`.replace(" .", ".") }, numeros: [] };
    }
    log.warn("migue.herramienta_fallo", { herramienta: llamada.nombre, ...resumenError(error) });
    return { datos: { error: "No pude consultar eso ahora. Probá de nuevo en un rato." }, numeros: [] };
  }
}
