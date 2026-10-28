import { normalizarCodigoConsulta } from "@/lib/dominio/expedientes/codigo-consulta";
import type { EstadoExpediente } from "@/lib/dominio/permisos";

/**
 * Textos y enlaces de la consulta pública (28/10/2026). Puro: lo usan la
 * página, el formulario (en el navegador) y el comprobante.
 */

/**
 * El estado en lenguaje del ciudadano, no el de la oficina. [C] "Finalizado:
 * acercate a Mesa de Entradas" (concluido) y el de anulado (que el pedido no
 * nombraba) los tiene que confirmar la Dirección: docs/propuesta-mvp.md,
 * sección 5, "Consulta pública".
 */
export const TEXTO_ESTADO_CIUDADANO: Record<EstadoExpediente, string> = {
  en_tramite: "En trámite",
  espera_pago_dim: "Esperando el pago en la DIM",
  concluido: "Finalizado: acercate a Mesa de Entradas", // [C]
  archivado: "Archivado",
  anulado: "Sin curso: acercate a Mesa de Entradas", // [C]
};

/** Una línea que va siempre con el resultado. */
export const AVISO_ORIENTATIVO = "Información orientativa: el expediente oficial es el de papel.";

export function textoEstadoCiudadano(estado: string): string {
  return (TEXTO_ESTADO_CIUDADANO as Record<string, string>)[estado] ?? "En trámite";
}

/** "Paso 3 de 7: Liquidación". */
export function textoAvance(paso: { orden: number; total: number; nombre: string }): string {
  return `Paso ${paso.orden} de ${paso.total}: ${paso.nombre}`;
}

export const RUTA_CONSULTA = "/consulta";

/** `/consulta/CEM-2026-00042`: sin el código, que nunca va en la ruta ni en la query. */
export function rutaConsulta(numero: string): string {
  return `${RUTA_CONSULTA}/${encodeURIComponent(numero)}`;
}

/**
 * La URL del QR del comprobante: `{origen}/consulta/{NUMERO}#{CODIGO}`. El
 * código va en el fragmento: el navegador no lo manda al servidor (no queda en
 * los logs de nginx ni de Vercel); la página lo lee del lado del cliente y lo
 * manda por POST. Sin origen conocido, la ruta relativa.
 */
export function urlConsultaConCodigo(origen: string | null, numero: string, codigo: string): string {
  const ruta = `${rutaConsulta(numero)}#${encodeURIComponent(codigo)}`;
  return origen ? `${origen}${ruta}` : ruta;
}

/** El código del fragmento (`#K7QM3XZP`, `#k7qm-3xzp`), normalizado, o `null`. */
export function codigoDelFragmento(hash: string): string | null {
  const crudo = hash.startsWith("#") ? hash.slice(1) : hash;
  if (crudo === "" || crudo.length > 40) return null;
  let texto: string;
  try {
    texto = decodeURIComponent(crudo);
  } catch {
    return null;
  }
  return normalizarCodigoConsulta(texto);
}
