import { canonizarNumeroInterno } from "@/lib/dominio/expedientes/numero";
import { navegacionPara } from "@/lib/dominio/navegacion";
import type { UsuarioPermisos } from "@/lib/dominio/permisos";
import { formatearFecha, hoyEnTucuman } from "@/lib/fechas";
import type { Perfil } from "@/lib/presentacion/recorridos/motor";
import { ayudaDePantalla, buscarEnLaGuia, guiaDelSistema, simplificar } from "./ayuda-interna";
import { interpretarRespuesta, type EnlaceMigue } from "./enlaces";
import {
  DEFINICIONES,
  ejecutarHerramienta,
  interpretarLlamada,
  type ContextoHerramienta,
  type LlamadaInterpretada,
  type ResultadoHerramienta,
  type ServiciosHerramientas,
} from "./herramientas";
import { MENSAJE_DATO_PERSONAL_INTERNO, tieneDatoPersonal, type Turno } from "./limites";
import { armarMensajes, pedirAlModelo, type ConexionModelo, type MensajeModelo } from "./openrouter";
import { INSTRUCCIONES_INTERNO } from "./prompts/interno";
import type { ResultadoConsulta } from "./registro";
import { contarConsulta, type DependenciasTope } from "./tope";

/**
 * Una pregunta al Migue del sistema, de punta a punta (docs/api-dominio.md,
 * 26.11). "Explica y consulta":
 *
 * 1. La pregunta con un DNI, CUIL, CUIT, teléfono o correo se rechaza (no
 *    viaja ni se guarda). El número de expediente sí se acepta.
 * 2. Con modelo y dentro del tope del usuario: el modelo, con la guía del
 *    sistema y las herramientas de solo lectura. Pide herramientas; el
 *    servidor las corre con el usuario de la sesión (src/lib/migue/herramientas.ts)
 *    y le devuelve lo que se puede ver; así hasta que contesta, con un máximo
 *    de vueltas y de tiempo.
 * 3. Sin modelo (sin clave, falló o se pasó el tope): las mismas herramientas,
 *    elegidas por palabras, y la respuesta armada acá; si no corresponde
 *    ninguna, la guía. Migue contesta peor, pero contesta.
 *
 * Las preguntas de cada pantalla (ayuda-interna.ts) no llegan acá: se
 * contestan en el navegador con su texto escrito.
 */

/** Vueltas con el modelo por pregunta (cada pedido de herramientas es una). */
const VUELTAS_MAXIMAS = 4;
/** La pregunta entera: la función de Vercel tiene 60 s (maxDuration de la ruta). */
const PLAZO_MS = 40_000;
/** Con menos que esto por delante no se empieza otra vuelta. */
const MINIMO_PARA_UNA_VUELTA_MS = 8_000;
/** Lo interno contesta un poco más que lo público: una lista de expedientes no entra en 400. */
export const MAXIMO_TOKENS_INTERNO = 700;

export interface DependenciasMigueInterno {
  conexion: ConexionModelo;
  tope: DependenciasTope;
  servicios: ServiciosHerramientas;
  ahora?: () => Date;
}

export interface PedidoInterno {
  pregunta: string;
  historial: Turno[];
  /** El id de la pantalla a la vista (el de su recorrido), ya validado. */
  pantalla: string | null;
}

export interface RespuestaMigue {
  respuesta: string;
  enlaces: EnlaceMigue[];
  resultado: ResultadoConsulta;
  /** Hubo una respuesta con contenido (para el tablero). */
  resuelta: boolean;
  herramientas: string[];
  modelo: string | null;
  tokensEntrada: number | null;
  tokensSalida: number | null;
}

/** El perfil en palabras, para el modelo: rol y área, nunca el nombre de la persona. */
function quienPregunta(usuario: UsuarioPermisos & { area: { nombre?: string; codigo: string } | null }, perfil: Perfil): string {
  const area = usuario.area ? (usuario.area.nombre ?? usuario.area.codigo) : "sin área";
  const rol = usuario.rol === "admin" ? "administración del sistema" : usuario.rol === "lectura" ? "solo lectura" : "operador";
  const perfilTexto = { mesa: "Mesa de Entradas", operador: "un área que opera expedientes", direccion: "la Dirección (consulta)", admin: "administración" }[perfil];
  return `Con quién hablás: una persona del personal (${perfilTexto}), con rol ${rol} y área ${area}. No sabés su nombre ni hace falta.`;
}

/** Los enlaces que puede llevar una respuesta: las pantallas de su menú y la ficha de los expedientes que devolvió una herramienta. */
export function validadorInterno(usuario: UsuarioPermisos, numeros: ReadonlySet<string>) {
  const pantallas = new Map(navegacionPara(usuario).map((i) => [i.href, i.etiqueta]));
  pantallas.set("/avisos", "Avisos");
  return (href: string): string | null => {
    const sinQuery = href.split(/[?#]/)[0];
    if (pantallas.has(sinQuery) && sinQuery === href) return pantallas.get(sinQuery) ?? null;
    const m = /^\/expedientes\/([^/?#]+)$/.exec(href);
    if (m) {
      const numero = canonizarNumeroInterno(decodeURIComponent(m[1]));
      return numero && numeros.has(numero) && `/expedientes/${numero}` === href ? `Abrir ${numero}` : null;
    }
    return null;
  };
}

/** El enlace a la ficha de un expediente devuelto. */
function enlaceFicha(numero: string): EnlaceMigue {
  return { href: `/expedientes/${numero}`, etiqueta: `Abrir ${numero}` };
}

// ── Sin modelo: la herramienta, elegida por palabras ──────────────────

/** Qué herramienta corresponde a la pregunta, sin modelo. Pura. */
export function herramientaSinModelo(pregunta: string): LlamadaInterpretada | null {
  const simple = simplificar(pregunta);
  const numero = /\bcem\W{0,3}\d{4}\W{1,3}\d{1,6}\b/.exec(simple)?.[0] ?? /\b\d{1,6}\s*\/\s*(?:19|20)\d{2}\b/.exec(simple)?.[0] ?? null;
  const canonico = numero ? canonizarNumeroInterno(numero.replace(/\s+/g, "")) : null;
  if (canonico) return { ok: true, id: "local", nombre: "estado_expediente", argumentos: { numero: canonico } };
  if (/\b(vencid[oa]s?|demorad[oa]s?|atrasad[oa]s?|por vencer)\b/.test(simple)) return { ok: true, id: "local", nombre: "vencidos_y_demorados", argumentos: {} };
  if (/\b(bandeja|por confirmar|pendientes?|que tengo|cuantos tengo)\b/.test(simple)) {
    const filtro = /\bpor confirmar\b/.test(simple) ? "por_confirmar" : /\bafuera\b/.test(simple) ? "afuera" : "todas";
    return { ok: true, id: "local", nombre: "mi_bandeja", argumentos: { filtro } };
  }
  if (/\b(pasos|circuito|documentos?|requisitos|quien hace)\b/.test(simple) && /\b(tramite|renovacion|inhumacion|concesion|plantilla)\w*/.test(simple)) {
    return { ok: true, id: "local", nombre: "plantilla_tramite", argumentos: { tipo: pregunta.slice(0, 100) } };
  }
  return null;
}

type Datos = Record<string, unknown>;
const lista = (x: unknown): Datos[] => (Array.isArray(x) ? (x as Datos[]) : []);

/** La respuesta en palabras de lo que devolvió una herramienta, sin modelo. Pura. */
export function textoDeResultado(nombre: string, d: Datos): string {
  if (typeof d.error === "string") return d.error;
  switch (nombre) {
    case "estado_expediente": {
      const paso = d.paso as { orden: number; total: number; nombre: string };
      const partes = [
        `${d.numero} (${d.tramite}): ${String(d.estado).toLowerCase()}, en el paso ${paso.orden} de ${paso.total} («${paso.nombre}»).`,
        `Está en ${d.areaActual}${d.enAreaDesde ? ` desde el ${formatearFecha(String(d.enAreaDesde))}` : ""}${typeof d.diasEnArea === "number" ? ` (${d.diasEnArea} días hábiles${d.cuentaDesde ? `, contados desde el ${formatearFecha(String(d.cuentaDesde))}, cuando se terminó la carga histórica` : ""})` : ""}${d.recibido ? "" : ", sin confirmar la recepción"}.`,
      ];
      const alertas = (d.alertas as string[] | undefined) ?? [];
      if (alertas.length) partes.push(`Alertas: ${alertas.join(", ")}.`);
      const plazo = d.plazo as { texto?: string } | null;
      if (plazo?.texto) partes.push(`Plazo de la DIM: ${plazo.texto}.`);
      const falta = lista(d.faltaParaElPase);
      partes.push(falta.length ? `Para el pase falta: ${falta.map((f) => f.nombre).join("; ")}.` : "No falta nada para el pase.");
      return partes.join(" ");
    }
    case "mi_bandeja": {
      const c = d.conteos as Record<string, number>;
      const exps = lista(d.expedientes);
      const cabeza = `En tu bandeja: ${c.porConfirmar} por confirmar, ${c.enMiArea} en tu área, ${c.afuera} afuera y ${c.plazos} con plazo.`;
      if (!exps.length) return `${cabeza} No hay expedientes en esa lista.`;
      return `${cabeza} Los primeros:\n${exps.map((e) => `- ${e.numero} (${e.tramite}): ${e.diasEnArea} días hábiles en el área${e.demorado ? ", demorado" : ""}`).join("\n")}`;
    }
    case "vencidos_y_demorados": {
      const bloque = (titulo: string, b: Datos, linea: (e: Datos) => string) => {
        const exps = lista(b.expedientes);
        return `${titulo}: ${b.cantidad}${exps.length ? `\n${exps.map((e) => `- ${linea(e)}`).join("\n")}` : ""}`;
      };
      return [
        `Mirando ${d.alcance}.`,
        bloque("Demorados", d.demorados as Datos, (e) => `${e.numero} (${e.tramite}): ${e.diasEnArea} días hábiles en ${e.areaActual}, el límite es ${e.diasAlerta}`),
        bloque("Plazos de la DIM vencidos", d.plazosVencidos as Datos, (e) => `${e.numero} (${e.tramite}): venció el ${e.vence ? formatearFecha(String(e.vence)) : "-"}`),
        bloque("Por vencer", d.plazosPorVencer as Datos, (e) => `${e.numero} (${e.tramite}): faltan ${e.faltanDiasHabiles} días hábiles`),
      ].join("\n");
    }
    case "plantilla_tramite": {
      const tramites = lista(d.tramites);
      if (!tramites.length) return `${d.mensaje ?? "No encontré ese trámite."} Los publicados: ${(d.disponibles as string[] | undefined)?.join(", ") ?? "-"}.`;
      return tramites
        .map((t) => `${t.nombre}: ${lista(t.pasos).map((p) => `${p.orden}. ${p.nombre} (${p.area})`).join("; ")}.`)
        .join("\n");
    }
    case "como_se_hace": {
      const encontrado = lista(d.encontrado);
      return encontrado.length ? encontrado.map((e) => `${e.titulo} (${e.pantalla}): ${e.texto}`).join("\n\n") : String(d.mensaje ?? "La guía no dice nada sobre eso.");
    }
  }
  return "";
}

const RESPALDO_SIN_GUIA =
  "Esa no la tengo. Mirá las preguntas de esta pantalla, que tienen la respuesta escrita, o el botón «?» del encabezado. Para un expediente, preguntame por su número (CEM-2026-00042 o 42/2026).";

async function sinModelo(
  pregunta: string,
  ctx: ContextoHerramienta,
): Promise<{ respuesta: string; enlaces: EnlaceMigue[]; resuelta: boolean; herramientas: string[] }> {
  const llamada = herramientaSinModelo(pregunta);
  if (llamada?.ok) {
    const r = await ejecutarHerramienta(llamada, ctx);
    const enlaces = r.numeros.slice(0, 3).map(enlaceFicha);
    return { respuesta: textoDeResultado(llamada.nombre, r.datos), enlaces, resuelta: typeof r.datos.error !== "string", herramientas: [llamada.nombre] };
  }
  const guia = buscarEnLaGuia(pregunta, ctx.perfil, 2);
  if (guia.length) {
    return { respuesta: guia.map((e) => `${e.titulo} (${e.pantalla}): ${e.texto}`).join("\n\n"), enlaces: [], resuelta: true, herramientas: ["como_se_hace"] };
  }
  return { respuesta: RESPALDO_SIN_GUIA, enlaces: [], resuelta: false, herramientas: [] };
}

// ── La pregunta ────────────────────────────────────────────────────────

export async function responderInterno(
  deps: DependenciasMigueInterno,
  usuario: UsuarioPermisos & { area: { id: number; codigo: string; nombre?: string } | null },
  perfil: Perfil,
  pedido: PedidoInterno,
): Promise<RespuestaMigue> {
  const vacia = { herramientas: [] as string[], modelo: null, tokensEntrada: null, tokensSalida: null };
  if (tieneDatoPersonal(pedido.pregunta)) {
    return { respuesta: MENSAJE_DATO_PERSONAL_INTERNO, enlaces: [], resultado: "rechazada", resuelta: false, ...vacia };
  }
  const ctx: ContextoHerramienta = { usuario, perfil, servicios: deps.servicios };

  let resultadoSinModelo: ResultadoConsulta = "fallback";
  if (deps.conexion.clave) {
    const tope = await contarConsulta(deps.tope, { tipo: "usuario", id: usuario.id });
    if (!tope.permitido) {
      resultadoSinModelo = "tope";
    } else {
      const conModelo = await conElModelo(deps, ctx, pedido);
      if (conModelo) return conModelo;
    }
  }
  const r = await sinModelo(pedido.pregunta, ctx);
  const aviso = resultadoSinModelo === "tope" ? "Por esta hora ya hice muchas consultas al modelo; te contesto con lo que tengo a mano.\n\n" : "";
  return { respuesta: `${aviso}${r.respuesta}`, enlaces: r.enlaces, resultado: resultadoSinModelo, resuelta: r.resuelta, herramientas: r.herramientas, modelo: null, tokensEntrada: null, tokensSalida: null };
}

/** El bucle con el modelo. null si el modelo no respondió (y se cae al camino sin modelo). */
async function conElModelo(deps: DependenciasMigueInterno, ctx: ContextoHerramienta, pedido: PedidoInterno): Promise<RespuestaMigue | null> {
  const ahora = deps.ahora?.() ?? new Date();
  const empezo = Date.now();
  const pantalla = ayudaDePantalla(pedido.pantalla, ctx.perfil);
  const mensajes: MensajeModelo[] = armarMensajes(
    [
      INSTRUCCIONES_INTERNO,
      `${quienPregunta(ctx.usuario, ctx.perfil)}\nHoy es ${formatearFecha(hoyEnTucuman(ahora))}. Está en la pantalla «${pantalla.nombre}»: si dice «acá» o «esta pantalla», es ésa.`,
      `GUÍA DEL SISTEMA (lo que dicen los recorridos guiados de cada pantalla para este perfil):\n\n${guiaDelSistema(ctx.perfil)}`,
    ],
    pedido.historial,
    pedido.pregunta,
  );
  const herramientas: string[] = [];
  const numeros = new Set<string>();
  let tokensEntrada = 0;
  let tokensSalida = 0;
  let huboTokens = false;
  let modelo: string | null = null;
  let ultimos: Array<{ nombre: string; r: ResultadoHerramienta }> = [];

  for (let vuelta = 0; vuelta < VUELTAS_MAXIMAS; vuelta++) {
    if (Date.now() - empezo > PLAZO_MS - MINIMO_PARA_UNA_VUELTA_MS) break;
    const r = await pedirAlModelo(deps.conexion, { mensajes, herramientas: DEFINICIONES, maxTokens: MAXIMO_TOKENS_INTERNO });
    if (!r) return null;
    modelo = r.modelo;
    if (r.tokensEntrada !== null || r.tokensSalida !== null) huboTokens = true;
    tokensEntrada += r.tokensEntrada ?? 0;
    tokensSalida += r.tokensSalida ?? 0;

    if (r.llamadas.length) {
      mensajes.push({ role: "assistant", content: r.contenido, tool_calls: r.llamadas });
      ultimos = [];
      for (const llamada of r.llamadas.slice(0, 4)) {
        const interpretada = interpretarLlamada(llamada);
        const resultado = await ejecutarHerramienta(interpretada, ctx);
        if (interpretada.ok) herramientas.push(interpretada.nombre);
        for (const n of resultado.numeros) numeros.add(n);
        ultimos.push({ nombre: interpretada.nombre, r: resultado });
        mensajes.push({ role: "tool", tool_call_id: llamada.id, content: JSON.stringify(resultado.datos) });
      }
      // Las llamadas de más (más de 4 en una vuelta) se contestan vacías: el formato exige una respuesta por cada una.
      for (const llamada of r.llamadas.slice(4)) mensajes.push({ role: "tool", tool_call_id: llamada.id, content: JSON.stringify({ error: "Demasiadas consultas juntas: pedí de a una." }) });
      continue;
    }

    const interpretada = interpretarRespuesta(r.contenido ?? "", validadorInterno(ctx.usuario, numeros));
    if (!interpretada.texto) return null;
    return {
      respuesta: interpretada.texto,
      enlaces: interpretada.enlaces,
      resultado: interpretada.sinRespuesta ? "sin_respuesta" : "respondida",
      resuelta: !interpretada.sinRespuesta,
      herramientas,
      modelo,
      tokensEntrada: huboTokens ? tokensEntrada : null,
      tokensSalida: huboTokens ? tokensSalida : null,
    };
  }
  // Se quedó pidiendo herramientas sin contestar: lo último que consultó, en palabras.
  if (ultimos.length) {
    return {
      respuesta: ultimos.map((u) => textoDeResultado(u.nombre, u.r.datos)).join("\n\n"),
      enlaces: [...numeros].slice(0, 3).map(enlaceFicha),
      resultado: "fallback",
      resuelta: true,
      herramientas,
      modelo,
      tokensEntrada: huboTokens ? tokensEntrada : null,
      tokensSalida: huboTokens ? tokensSalida : null,
    };
  }
  return null;
}
