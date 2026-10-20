import { isIP } from "node:net";

/**
 * Datos de red del request para la auditoría de accesos.
 */

/**
 * La IP del cliente, o `null`. Detrás de nginx (sección 6, "Hosting") la
 * conexión llega siempre desde 127.0.0.1: la IP real viene en X-Real-IP, que
 * nginx pisa con `$remote_addr`. X-Forwarded-For se usa solo si no está, porque
 * su primer valor lo puede escribir el cliente. Se valida para que un header
 * raro no haga fallar el INSERT en la columna `inet` y se pierda el registro.
 */
export function ipDeSolicitud(headers: Headers): string | null {
  const candidatos = [headers.get("x-real-ip"), headers.get("x-forwarded-for")?.split(",")[0]];
  for (const candidato of candidatos) {
    const ip = candidato?.trim();
    if (ip && isIP(ip) !== 0) return ip;
  }
  return null;
}

/**
 * El nombre de host al que se dirigió el request, sin puerto, o "" si no se
 * puede leer. Con IPv6 queda entre corchetes ("[::1]"), igual que
 * `URL.hostname`.
 *
 * Solo `Host`. Ojo: con `proxy_set_header Host $host`, nginx reenvía el Host
 * que mandó el cliente (y si el server block es el default, cualquiera). Por
 * eso el pedido a Sistemas (docs/pedidos-dia-1.md, A4) es un default_server
 * que corte (444) todo host que no sea el nuestro, y por eso esto no alcanza
 * para decidir solo: devLoginPara() exige además que APP_URL sea de staging,
 * validado al arrancar. X-Forwarded-Host no se mira nunca: nginx lo deja pasar
 * tal como lo mande el cliente.
 */
export function hostnameDeSolicitud(headers: Headers): string {
  const host = headers.get("host")?.trim();
  if (!host) return "";
  try {
    return new URL(`http://${host}`).hostname;
  } catch {
    return "";
  }
}

/**
 * ¿El POST viene de una página de este sitio? Si el navegador manda `Origin`,
 * su host tiene que ser el nuestro. Se compara el host y no el origen
 * completo: detrás de nginx Next ve http aunque el navegador esté en https.
 *
 * Sin `Origin` se acepta: los navegadores lo mandan en todo POST, así que su
 * ausencia es un cliente que no es un navegador, al que SameSite=Lax ya le
 * impide usar una cookie ajena.
 *
 * Contra `Host` y no X-Forwarded-Host, como hostnameDeSolicitud(): detrás de
 * nginx eso exige `proxy_set_header Host $host` (pedido A4); con el default de
 * nginx llegaría 127.0.0.1:3010 y Salir respondería 403.
 */
export function mismoOrigen(headers: Headers): boolean {
  const origen = headers.get("origin");
  if (!origen) return true;
  const host = headers.get("host")?.trim();
  if (!host) return false;
  try {
    return new URL(origen).host === host;
  } catch {
    return false;
  }
}
