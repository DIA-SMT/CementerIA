import type { Escritor } from "@/lib/dominio/expedientes/dependencias";
import { log, resumenError } from "@/lib/log";
import { LARGO_REGISTRO, recortar, taparNombresPresentados } from "./limites";

/**
 * El registro de lo que le preguntan a Migue (auditoria.consultas_migue,
 * docs/api-dominio.md, 26.5). Existe para mejorar las respuestas: cada
 * `sin_respuesta` es un tema que la gente busca y los datos no cubren.
 *
 * - Lo público no guarda nada que identifique a la persona (ni la IP: el tope
 *   la usa como HMAC, en otra tabla y sin forma de cruzarlas). Lo interno
 *   guarda el usuario, como el resto del sistema (TramitaCapital hace lo mismo).
 * - La pregunta y la respuesta van recortadas a 500 caracteres, y en la
 *   pregunta se tapan los nombres presentados («soy…»). Una pregunta con DNI,
 *   CUIL, teléfono o correo no llega acá: se rechazó antes y se anota sin el
 *   texto (`rechazada`).
 * - Solo inserción (trigger consultas_migue_proteger); 90 días y se borra
 *   sola con la limpieza de cada mañana (`f_purgar_migue`).
 *
 * **Nunca hace fallar la respuesta**: si el insert falla, se anota en el log
 * y sigue. Se espera el insert (es una fila) en vez de dispararlo suelto: en
 * Vercel la función puede terminar apenas se manda la respuesta.
 */

export const RESULTADOS_CONSULTA = ["respondida", "sin_respuesta", "fallback", "tope", "rechazada", "error"] as const;
export type ResultadoConsulta = (typeof RESULTADOS_CONSULTA)[number];

export type CanalMigue = "publico" | "interno";

export interface DatosConsulta {
  canal: CanalMigue;
  resultado: ResultadoConsulta;
  herramientas?: readonly string[];
  duracionMs: number;
  tokensEntrada?: number | null;
  tokensSalida?: number | null;
  modelo?: string | null;
  /** Solo en lo interno: el id de la pantalla (el de su recorrido guiado). */
  pantalla?: string | null;
  pregunta: string;
  respuesta: string;
  /** Solo en lo interno. */
  usuarioId?: number | null;
}

/** Lo que va a la base, ya acotado. Pura (se prueba sin base). */
export function filaDeConsulta(d: DatosConsulta) {
  const interno = d.canal === "interno";
  return {
    canal: d.canal,
    resultado: d.resultado,
    herramientas: interno ? [...(d.herramientas ?? [])].slice(0, 20) : [],
    duracionMs: Math.max(0, Math.round(d.duracionMs)),
    tokensEntrada: d.tokensEntrada ?? null,
    tokensSalida: d.tokensSalida ?? null,
    modelo: d.modelo ? d.modelo.slice(0, 100) : null,
    pantalla: interno && d.pantalla && /^[a-z][a-z0-9-]{0,39}$/.test(d.pantalla) ? d.pantalla : null,
    pregunta: d.resultado === "rechazada" ? "" : recortar(taparNombresPresentados(d.pregunta), LARGO_REGISTRO),
    respuesta: recortar(d.respuesta, LARGO_REGISTRO),
    usuarioId: interno ? (d.usuarioId ?? null) : null,
  };
}

const SISTEMA_ID = 1;

export async function registrarConsulta(escribir: Escritor, datos: DatosConsulta): Promise<void> {
  const fila = filaDeConsulta(datos);
  try {
    await escribir(fila.usuarioId ?? SISTEMA_ID, "Registro de Migue", (tx) => tx.consultaMigue.create({ data: fila, select: { id: true } }));
  } catch (error) {
    log.warn("migue.registro_fallo", { canal: datos.canal, resultado: datos.resultado, ...resumenError(error) });
  }
}
