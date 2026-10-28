import "server-only";
import { prisma } from "@/lib/db/cliente";
import { conActor } from "@/lib/db/transaccion";
import { consultarTramite, type EntradaConsulta } from "./consulta";
import { datosLanding } from "./landing";

/**
 * Lo público de la app (28/10/2026), con el cliente global y conActor(): la
 * página `/tramites` y la consulta de `/consulta`. Sin usuario: lo que se escribe
 * (intentos y consultas) lo firma SISTEMA.
 */
export const publico = {
  datosLanding: () => datosLanding(prisma),
  consultar: (entrada: EntradaConsulta, ip: string | null) => consultarTramite({ leer: prisma, escribir: conActor }, entrada, ip),
};

export {
  MAXIMO_FALLOS_IP,
  MAXIMO_FALLOS_NUMERO,
  MENSAJE_LIMITE,
  MENSAJE_NO_ENCONTRADO,
  VENTANA_MINUTOS,
  type ResultadoConsulta,
  type TramitePublico,
} from "./consulta";
export type { DatosLanding, DocumentoParaTraer, TramitePublicado } from "./landing";
