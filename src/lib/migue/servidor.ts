import "server-only";
import { after } from "next/server";
import { prisma } from "@/lib/db/cliente";
import { conActor } from "@/lib/db/transaccion";
import { expedientes } from "@/lib/dominio/expedientes/servidor";
import { resumenPlantillasPublicadas } from "@/lib/dominio/plantillas/resumen";
import { publico } from "@/lib/dominio/publico/servidor";
import { sitio } from "@/lib/dominio/sitio/servidor";
import { entorno } from "@/lib/entorno";
import { log, resumenError } from "@/lib/log";
import type { ContenidoSitioPublico } from "@/lib/dominio/sitio";
import { datosPublicosParaMigue, type DatosPublicosMigue } from "./datos-publicos";
import type { DependenciasMigueInterno } from "./interno";
import type { ConexionModelo } from "./openrouter";
import type { DependenciasMiguePublico } from "./publico";
import { registrarConsulta, type CanalMigue, type DatosConsulta } from "./registro";
import { armarReporte, enviarReporte } from "./reporte";
import type { DependenciasTope } from "./tope";

/**
 * Migue con lo de la app puesto (docs/api-dominio.md, 26): el entorno, el
 * cliente global, `conActor()` y los servicios del dominio. Es lo que importan
 * las dos rutas (/api/migue y /api/migue/interno). Nada se resuelve al
 * importar: `next build` importa esto sin entorno ni base.
 */

/** Con qué se habla con el modelo, desde el entorno (ConfigMigue de src/lib/entorno.ts). */
export function conexionModelo(): ConexionModelo {
  const e = entorno();
  return { clave: e.migue.clave, modelo: e.migue.modelo, url: e.migue.url, referer: e.appUrl?.origin ?? null };
}

function dependenciasTope(): DependenciasTope {
  const e = entorno();
  return { escribir: conActor, secreto: e.secretoSesion, topes: { persona: e.migue.topePersona, global: e.migue.topeGlobal } };
}

/** Sin datos del sitio (la base no respondió), como src/app/(publico)/datos.ts. */
const SITIO_VACIO: ContenidoSitioPublico = { cementerios: [], hayHorarios: false, recorridos: [], fechas: [], novedades: [], contacto: null, preguntas: [] };

/**
 * Los datos públicos que ya muestran las páginas. Si la base no responde, Migue
 * contesta igual sin ellos (y dice que no tiene el dato): no se cae el chat.
 */
async function datosPublicos(): Promise<DatosPublicosMigue> {
  const [contenido, landing] = await Promise.all([
    sitio.contenidoPublico().catch((error: unknown) => {
      log.error("migue.sitio_sin_datos", resumenError(error));
      return null;
    }),
    publico.datosLanding().catch((error: unknown) => {
      log.error("migue.tramites_sin_datos", resumenError(error));
      return null;
    }),
  ]);
  return datosPublicosParaMigue(contenido ?? SITIO_VACIO, landing);
}

export function dependenciasPublico(): DependenciasMiguePublico {
  return { conexion: conexionModelo(), tope: dependenciasTope(), datos: datosPublicos };
}

export function dependenciasInterno(): DependenciasMigueInterno {
  return {
    conexion: conexionModelo(),
    tope: dependenciasTope(),
    servicios: {
      obtenerFicha: (usuario, numero) => expedientes.obtenerFicha(usuario, numero),
      bandeja: (usuario, pestana) => expedientes.bandeja(usuario, pestana),
      contadoresBandeja: (usuario) => expedientes.contadoresBandeja(usuario),
      panel: (usuario) => expedientes.panel(usuario),
      plantillas: () => resumenPlantillasPublicadas(prisma),
    },
  };
}

/** El registro (auditoria.consultas_migue). Nunca tira. */
export function registrar(datos: DatosConsulta): Promise<void> {
  return registrarConsulta(conActor, datos);
}

/**
 * El reporte al tablero de organizacionDIA, después de contestar (`after()`):
 * no demora la respuesta. Sin MIGUE_API_KEY y MIGUE_DASHBOARD_URL, nada.
 */
export function reportarAlTablero(canal: CanalMigue, resuelta: boolean, empezo: Date): void {
  const tablero = entorno().migue.tablero;
  if (!tablero) return;
  const reporte = armarReporte({ canal, resuelta, empezo });
  const tarea = () => enviarReporte(reporte, tablero);
  try {
    after(tarea);
  } catch {
    // Fuera del contexto de un pedido after() no está: se manda igual, sin esperar (enviarReporte nunca tira).
    void tarea();
  }
}
