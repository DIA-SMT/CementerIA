import QRCode from "qrcode";

/**
 * El QR de la carátula, como SVG armado en el servidor (sección 5,
 * "Imprimibles": sin librería de PDF, sin imágenes externas). Corrección de
 * errores "M": aguanta una carátula algo gastada o con una mancha de birome.
 *
 * El SVG lo genera `qrcode` a partir de la URL (no hay texto del usuario
 * adentro): se puede insertar con `dangerouslySetInnerHTML`. Se le agregan
 * `role="img"` y un `aria-label` para los lectores de pantalla.
 */
export async function svgQr(texto: string, etiqueta: string): Promise<string> {
  const svg = await QRCode.toString(texto, { type: "svg", errorCorrectionLevel: "M", margin: 1 });
  const etiquetaSegura = etiqueta.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c] ?? c);
  return svg.replace(/^<svg\b/, `<svg role="img" aria-label="${etiquetaSegura}" width="100%" height="100%"`);
}
