/**
 * Transporte HTTPS hacia el backend de Cidituc. Copia adaptada de UrbanIA
 * (lib/auth/identity/cidituc-https.ts): solo el transporte. La validación del
 * token y el parseo de la persona son propios (./validar.ts), porque UrbanIA
 * valida contra /usuarios/authStatus, que es el endpoint de ciudadanos.
 *
 * Por qué no alcanza `fetch`: estadisticas.smt.gob.ar:5000 sirve una cadena TLS
 * INCOMPLETA. Manda un solo certificado —la hoja *.smt.gob.ar— y nunca el
 * intermedio que la firma ("Sectigo Public Server Authentication CA DV R36").
 * En Windows no se nota, porque el store del sistema ya tiene ese intermedio y
 * completa la cadena solo; por eso en desarrollo el login anda. Node en el
 * Ubuntu del servidor usa su propio bundle de raíces (el de Mozilla), que trae
 * la RAÍZ (R46) pero ningún intermedio: el handshake muere con
 * UNABLE_TO_VERIFY_LEAF_SIGNATURE y la persona —que ya se autenticó bien en
 * Cidituc— vería "Cidituc no está disponible".
 *
 * La solución es adjuntar el intermedio nosotros. NO se apaga la verificación:
 * la cadena se valida entera contra las raíces del runtime más este certificado.
 * Si el backend cambia a un certificado que no encadena hasta una raíz
 * confiable, el handshake sigue fallando, como corresponde. Nunca
 * `rejectUnauthorized: false` ni NODE_TLS_REJECT_UNAUTHORIZED=0: el token
 * viajaría a un servidor sin verificar.
 *
 * TEMPORAL: en cuanto Sistemas sirva la cadena completa desde el servidor, este
 * archivo se borra y vuelve el `fetch` común.
 */

import http from "node:http";
import https from "node:https";
import tls from "node:tls";

/**
 * Intermedio de Sectigo que el backend omite. Emitido por "Sectigo Public
 * Server Authentication Root R46", que sí está en el bundle de Mozilla.
 * SHA-1: DD55B4520291E276588F0DD02FAFD83A7368E0FA — vence 2036-03-21.
 * Es un certificado público de una CA, no un secreto.
 */
const SECTIGO_PUBLIC_SERVER_AUTHENTICATION_CA_DV_R36 = `-----BEGIN CERTIFICATE-----
MIIGTDCCBDSgAwIBAgIQOXpmzCdWNi4NqofKbqvjsTANBgkqhkiG9w0BAQwFADBf
MQswCQYDVQQGEwJHQjEYMBYGA1UEChMPU2VjdGlnbyBMaW1pdGVkMTYwNAYDVQQD
Ey1TZWN0aWdvIFB1YmxpYyBTZXJ2ZXIgQXV0aGVudGljYXRpb24gUm9vdCBSNDYw
HhcNMjEwMzIyMDAwMDAwWhcNMzYwMzIxMjM1OTU5WjBgMQswCQYDVQQGEwJHQjEY
MBYGA1UEChMPU2VjdGlnbyBMaW1pdGVkMTcwNQYDVQQDEy5TZWN0aWdvIFB1Ymxp
YyBTZXJ2ZXIgQXV0aGVudGljYXRpb24gQ0EgRFYgUjM2MIIBojANBgkqhkiG9w0B
AQEFAAOCAY8AMIIBigKCAYEAljZf2HIz7+SPUPQCQObZYcrxLTHYdf1ZtMRe7Yeq
RPSwygz16qJ9cAWtWNTcuICc++p8Dct7zNGxCpqmEtqifO7NvuB5dEVexXn9RFFH
12Hm+NtPRQgXIFjx6MSJcNWuVO3XGE57L1mHlcQYj+g4hny90aFh2SCZCDEVkAja
EMMfYPKuCjHuuF+bzHFb/9gV8P9+ekcHENF2nR1efGWSKwnfG5RawlkaQDpRtZTm
M64TIsv/r7cyFO4nSjs1jLdXYdz5q3a4L0NoabZfbdxVb+CUEHfB0bpulZQtH1Rv
38e/lIdP7OTTIlZh6OYL6NhxP8So0/sht/4J9mqIGxRFc0/pC8suja+wcIUna0HB
pXKfXTKpzgis+zmXDL06ASJf5E4A2/m+Hp6b84sfPAwQ766rI65mh50S0Di9E3Pn
2WcaJc+PILsBmYpgtmgWTR9eV9otfKRUBfzHUHcVgarub/XluEpRlTtZudU5xbFN
xx/DgMrXLUAPaI60fZ6wA+PTAgMBAAGjggGBMIIBfTAfBgNVHSMEGDAWgBRWc1hk
lfmSGrASKgRieaFAFYghSTAdBgNVHQ4EFgQUaMASFhgOr872h6YyV6NGUV3LBycw
DgYDVR0PAQH/BAQDAgGGMBIGA1UdEwEB/wQIMAYBAf8CAQAwHQYDVR0lBBYwFAYI
KwYBBQUHAwEGCCsGAQUFBwMCMBsGA1UdIAQUMBIwBgYEVR0gADAIBgZngQwBAgEw
VAYDVR0fBE0wSzBJoEegRYZDaHR0cDovL2NybC5zZWN0aWdvLmNvbS9TZWN0aWdv
UHVibGljU2VydmVyQXV0aGVudGljYXRpb25Sb290UjQ2LmNybDCBhAYIKwYBBQUH
AQEEeDB2ME8GCCsGAQUFBzAChkNodHRwOi8vY3J0LnNlY3RpZ28uY29tL1NlY3Rp
Z29QdWJsaWNTZXJ2ZXJBdXRoZW50aWNhdGlvblJvb3RSNDYucDdjMCMGCCsGAQUF
BzABhhdodHRwOi8vb2NzcC5zZWN0aWdvLmNvbTANBgkqhkiG9w0BAQwFAAOCAgEA
YtOC9Fy+TqECFw40IospI92kLGgoSZGPOSQXMBqmsGWZUQ7rux7cj1du6d9rD6C8
ze1B2eQjkrGkIL/OF1s7vSmgYVafsRoZd/IHUrkoQvX8FZwUsmPu7amgBfaY3g+d
q1x0jNGKb6I6Bzdl6LgMD9qxp+3i7GQOnd9J8LFSietY6Z4jUBzVoOoz8iAU84OF
h2HhAuiPw1ai0VnY38RTI+8kepGWVfGxfBWzwH9uIjeooIeaosVFvE8cmYUB4TSH
5dUyD0jHct2+8ceKEtIoFU/FfHq/mDaVnvcDCZXtIgitdMFQdMZaVehmObyhRdDD
4NQCs0gaI9AAgFj4L9QtkARzhQLNyRf87Kln+YU0lgCGr9HLg3rGO8q+Y4ppLsOd
unQZ6ZxPNGIfOApbPVf5hCe58EZwiWdHIMn9lPP6+F404y8NNugbQixBber+x536
WrZhFZLjEkhp7fFXf9r32rNPfb74X/U90Bdy4lzp3+X1ukh1BuMxA/EEhDoTOS3l
7ABvc7BYSQubQ2490OcdkIzUh3ZwDrakMVrbaTxUM2p24N6dB+ns2zptWCva6jzW
r8IWKIMxzxLPv5Kt3ePKcUdvkBU/smqujSczTzzSjIoR5QqQA6lN1ZRSnuHIWCvh
JEltkYnTAH41QJ6SAWO66GrrUESwN/cgZzL4JLEqz1Y=
-----END CERTIFICATE-----`;

/**
 * Raíces del runtime más el intermedio que el servidor no manda.
 *
 * CIDITUC_CA_PEM permite reemplazar ese intermedio desde el entorno —tal como
 * recomienda la guía de integración de la Dirección de IA— para poder rotarlo
 * sin un despliegue. Si no está cargada se usa el embebido, así el login no
 * depende de acordarse de una variable.
 */
export function autoridadesConfiables(): string[] {
  const delEntorno = process.env.CIDITUC_CA_PEM?.trim();
  return [...tls.rootCertificates, delEntorno || SECTIGO_PUBLIC_SERVER_AUTHENTICATION_CA_DV_R36];
}

/** La respuesta esperada es un JSON de pocos kilobytes; el tope evita sorpresas. */
const MAX_BODY_BYTES = 1_000_000;

export type RespuestaCidituc = { status: number; body: string };

/**
 * GET al backend de Cidituc con la cadena de confianza completa.
 *
 * No sigue redirecciones ni las trata como error: un 3xx vuelve como status y el
 * llamador lo loguea, que es más útil que una excepción muda. Acepta http://
 * para un backend local de desarrollo.
 */
export function getDeCidituc(url: string, token: string, timeoutMs: number): Promise<RespuestaCidituc> {
  const destino = new URL(url);
  const esHttps = destino.protocol === "https:";
  const cliente = esHttps ? https : http;

  return new Promise((resolve, reject) => {
    const request = cliente.request(
      {
        protocol: destino.protocol,
        hostname: destino.hostname,
        port: destino.port || (esHttps ? 443 : 80),
        path: `${destino.pathname}${destino.search}`,
        method: "GET",
        // Cidituc espera el token crudo en Authorization, sin prefijo "Bearer":
        // con el prefijo responde 401 siempre, incluso con un token bueno.
        headers: { Accept: "application/json", Authorization: token },
        ...(esHttps ? { ca: autoridadesConfiables() } : {}),
      },
      (response) => {
        let body = "";
        let bytes = 0;
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          bytes += Buffer.byteLength(chunk);
          if (bytes > MAX_BODY_BYTES) {
            request.destroy(new Error("la respuesta de Cidituc supera el tamaño esperado"));
            return;
          }
          body += chunk;
        });
        response.on("end", () => resolve({ status: response.statusCode ?? 0, body }));
        response.on("error", reject);
      },
    );

    request.setTimeout(timeoutMs, () => {
      request.destroy(Object.assign(new Error(`Cidituc no respondió en ${timeoutMs} ms`), { code: "ETIMEDOUT" }));
    });
    request.on("error", reject);
    request.end();
  });
}

/**
 * Traduce el error a algo accionable para el log. "fetch failed" a secas no
 * sirve: la razón real vive en el `code` (ECONNREFUSED, ENOTFOUND, ETIMEDOUT o
 * un error de certificado).
 */
export function motivoDeFallo(error: unknown): string {
  const detalle = (typeof error === "object" && error !== null ? error : {}) as {
    code?: unknown;
    message?: unknown;
    cause?: { code?: unknown; message?: unknown };
  };
  const code =
    typeof detalle.code === "string"
      ? detalle.code
      : typeof detalle.cause?.code === "string"
        ? detalle.cause.code
        : undefined;

  if (
    code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" ||
    code === "SELF_SIGNED_CERT_IN_CHAIN" ||
    code === "CERT_HAS_EXPIRED" ||
    code === "ERR_TLS_CERT_ALTNAME_INVALID"
  ) {
    return `${code}: el certificado del backend no valida. Revisar el intermedio embebido en src/lib/auth/cidituc/https.ts o CIDITUC_CA_PEM.`;
  }

  if (code) return code;
  return typeof detalle.message === "string" ? detalle.message : "error desconocido";
}
