import { NextResponse } from "next/server";

/**
 * Redirección a una ruta propia con `Location` RELATIVO (RFC 9110, 10.2.2).
 *
 * `NextResponse.redirect(new URL(ruta, request.url))` arma una URL absoluta, y
 * con el build standalone `request.url` trae el host y el puerto internos del
 * servidor (`https://localhost:3010`), no el `Host` que llegó por nginx: la
 * persona terminaba en localhost al salir o al volver de Cidituc. Con una ruta
 * relativa el navegador la resuelve contra el origen que está viendo, y no
 * depende de nginx (`proxy_redirect`) ni de APP_URL.
 *
 * Solo acepta rutas propias ("/algo"). Una ruta que empieza con "//" o "/\"
 * el navegador la toma como otro host, así que se descarta y se va al inicio:
 * esta función no puede convertirse en una redirección abierta.
 */
export function redirigirA(ruta: string, estado: 302 | 303 | 307 = 303): NextResponse {
  return new NextResponse(null, { status: estado, headers: { Location: rutaPropia(ruta) } });
}

export function rutaPropia(ruta: string): string {
  return /^\/(?![/\\])/.test(ruta) ? ruta : "/";
}
