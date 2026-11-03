import { atajoPublico, buscarEnDatosPublicos, responderAtajo } from "./atajos-publicos";
import { datosEnTexto, PAGINAS_PARA_MIGUE, urlsDeLosDatos, type DatosPublicosMigue } from "./datos-publicos";
import { interpretarRespuesta, normalizarHref, type EnlaceMigue } from "./enlaces";
import type { RespuestaMigue } from "./interno";
import { MENSAJE_DATO_PERSONAL_PUBLICO, tieneDatoPersonal, type Turno } from "./limites";
import { armarMensajes, pedirAlModelo, type ConexionModelo } from "./openrouter";
import { INSTRUCCIONES_PUBLICO } from "./prompts/publico";
import type { ResultadoConsulta } from "./registro";
import { contarConsulta, type DependenciasTope } from "./tope";

/**
 * Una pregunta al Migue de la página pública, de punta a punta
 * (docs/api-dominio.md, 26.9). Abierto, sin sesión. Tres caminos, en este
 * orden, como El Sanmiguelino:
 *
 * 1. **Rechazo**: una pregunta con DNI, CUIL, teléfono o correo no viaja ni se
 *    guarda.
 * 2. **Atajos** sin modelo (saludo, qué trámites hay, horarios, contacto, y
 *    siempre la consulta del trámite, que explica /consulta): exactos y gratis.
 * 3. **El modelo**, con los datos públicos inyectados en el prompt dentro de
 *    `<datos>…</datos>` y sin herramientas, dentro del tope por IP y global.
 * 4. **El buscador** por palabras sobre los mismos datos si no hay clave, si el
 *    modelo falla o si se pasó el tope.
 *
 * Nunca consulta un expediente: no hay forma, no tiene con qué.
 */

/** Como el diario: Migue contesta consultas de vecinos, no escribe ensayos. */
export const MAXIMO_TOKENS_PUBLICO = 400;

export interface DependenciasMiguePublico {
  conexion: ConexionModelo;
  tope: DependenciasTope;
  /** Los datos públicos (sitio y trámites), ya acotados a la lista cerrada. */
  datos: () => Promise<DatosPublicosMigue>;
}

export interface PedidoPublico {
  pregunta: string;
  historial: Turno[];
}

/** Las páginas del sitio y las URL que cargó la Dirección: los únicos enlaces que se muestran. */
export function validadorPublico(d: DatosPublicosMigue) {
  const paginas = new Map(PAGINAS_PARA_MIGUE.map((p) => [p.ruta as string, p.nombre]));
  const externas = urlsDeLosDatos(d);
  return (href: string): string | null => {
    if (paginas.has(href)) return paginas.get(href) ?? null;
    for (const url of externas) if (normalizarHref(url) === href) return /inscrip/i.test(href) ? "Inscripción" : "Abrir el enlace";
    return null;
  };
}

export async function responderPublico(deps: DependenciasMiguePublico, pedido: PedidoPublico, ip: string | null): Promise<RespuestaMigue> {
  const base = { herramientas: [] as string[], modelo: null, tokensEntrada: null, tokensSalida: null };
  if (tieneDatoPersonal(pedido.pregunta)) {
    return { respuesta: MENSAJE_DATO_PERSONAL_PUBLICO, enlaces: [{ href: "/consulta", etiqueta: "Consultá tu trámite" }], resultado: "rechazada", resuelta: false, ...base };
  }
  const datos = await deps.datos();

  const atajo = atajoPublico(pedido.pregunta, pedido.historial.length === 0);
  if (atajo) {
    const r = responderAtajo(atajo, datos, pedido.pregunta);
    return { respuesta: r.texto, enlaces: r.enlaces, resultado: r.resuelta ? "respondida" : "sin_respuesta", resuelta: r.resuelta, ...base };
  }

  let resultado: ResultadoConsulta = "fallback";
  if (deps.conexion.clave) {
    const tope = await contarConsulta(deps.tope, { tipo: "ip", ip });
    if (!tope.permitido) {
      resultado = "tope";
    } else {
      const r = await pedirAlModelo(deps.conexion, {
        mensajes: armarMensajes([INSTRUCCIONES_PUBLICO, datosEnTexto(datos)], pedido.historial, pedido.pregunta),
        maxTokens: MAXIMO_TOKENS_PUBLICO,
      });
      if (r?.contenido) {
        const interpretada = interpretarRespuesta(r.contenido, validadorPublico(datos));
        if (interpretada.texto) {
          return {
            respuesta: interpretada.texto,
            enlaces: interpretada.enlaces.length || !interpretada.sinRespuesta ? interpretada.enlaces : [{ href: "/contacto", etiqueta: "Contacto" }],
            resultado: interpretada.sinRespuesta ? "sin_respuesta" : "respondida",
            resuelta: !interpretada.sinRespuesta,
            herramientas: [],
            modelo: r.modelo,
            tokensEntrada: r.tokensEntrada,
            tokensSalida: r.tokensSalida,
          };
        }
      }
      // Si el modelo no contestó, el buscador, a propósito.
    }
  }

  const b = buscarEnDatosPublicos(pedido.pregunta, datos);
  return { respuesta: b.texto, enlaces: b.enlaces as EnlaceMigue[], resultado, resuelta: b.resuelta, ...base };
}
