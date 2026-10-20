/**
 * Enlaces que arma la pantalla: la URL absoluta de la ficha (para el QR de la
 * carátula) y el enlace de WhatsApp (wa.me) de la ficha. Puro: sin Next ni
 * base, para probarlo y para usarlo también en el navegador.
 */

// ---------------------------------------------------------------------------
// URL absoluta de la ficha (QR de la carátula)
// ---------------------------------------------------------------------------

export interface DatosOrigen {
  /** `APP_URL` del entorno, si está configurada: manda siempre. */
  appUrl: URL | null;
  /** Header `Host` del request. */
  host: string | null;
  /** Header `X-Forwarded-Proto` (nginx), si viene. */
  protocoloReenviado?: string | null;
}

const RE_HOST = /^(?:[a-z0-9.-]+|\[[0-9a-f:.]+\])(?::\d{1,5})?$/i;

/**
 * El origen público de la app ("https://cementeria.smt.gob.ar"), o `null` si
 * no se puede saber.
 *
 * Con `APP_URL` se usa esa (es lo que corresponde en producción, detrás de
 * nginx). Sin ella, el host del request, como ya hacen los Route Handlers con
 * `new URL(ruta, request.url)`; el protocolo sale de `X-Forwarded-Proto` solo
 * si dice exactamente `http` o `https`, y si no, `http`. Un `Host` con algo
 * que no es un nombre de host no se usa: el QR no tiene que poder apuntar a
 * cualquier lado.
 */
export function origenPublico({ appUrl, host, protocoloReenviado }: DatosOrigen): string | null {
  if (appUrl) return appUrl.origin;
  const h = host?.trim() ?? "";
  if (h === "" || !RE_HOST.test(h)) return null;
  const proto = protocoloReenviado?.split(",")[0]?.trim().toLowerCase();
  const protocolo = proto === "https" || proto === "http" ? proto : "http";
  try {
    return new URL(`${protocolo}://${h}`).origin;
  } catch {
    return null;
  }
}

/**
 * La URL absoluta de una ruta de la app (`/expedientes/CEM-2026-00042`).
 * Sin origen conocido, devuelve la ruta tal cual: el QR sigue sirviendo para
 * leer el número.
 */
export function urlAbsoluta(ruta: string, origen: string | null): string {
  if (!ruta.startsWith("/")) throw new RangeError(`urlAbsoluta: se esperaba una ruta que empiece con "/" y llegó "${ruta}"`);
  return origen ? new URL(ruta, origen).toString() : ruta;
}

// ---------------------------------------------------------------------------
// WhatsApp (wa.me)
// ---------------------------------------------------------------------------

/** Característica de San Miguel de Tucumán: la que se supone si el número se escribió sin ella. */
export const CARACTERISTICA_LOCAL = "381";

/**
 * El número en el formato internacional que pide wa.me para un celular de
 * Argentina: `549` + característica sin 0 + número sin 15 (10 dígitos en
 * total después del 549). `null` si no se puede armar con seguridad: mejor
 * no ofrecer el enlace que mandar el mensaje a otra persona.
 *
 * Acepta las formas habituales: "0381 456-7890", "381 15 456-7890",
 * "+54 9 381 456-7890", "0054 381 4567890" y, sin característica,
 * "456-7890" o "15 456-7890" (se supone Tucumán).
 */
export function telefonoParaWhatsapp(telefono: string | null | undefined): string | null {
  let d = (telefono ?? "").replace(/\D/g, "");
  if (d === "") return null;
  if (d.startsWith("00")) d = d.slice(2);

  let nacional: string;
  if (d.startsWith("54") && d.length >= 12) {
    nacional = d.slice(2);
    if (nacional.startsWith("9")) nacional = nacional.slice(1);
    if (nacional.startsWith("0")) nacional = nacional.slice(1);
  } else {
    nacional = d.startsWith("0") ? d.slice(1) : d;
  }

  // El 15 de los celulares va después de la característica (de 2 a 4 dígitos).
  if (nacional.length === 12) {
    for (const largo of [2, 3, 4]) {
      if (nacional.slice(largo, largo + 2) === "15") {
        nacional = nacional.slice(0, largo) + nacional.slice(largo + 2);
        break;
      }
    }
  }
  // Sin característica: número local de Tucumán, con o sin el 15.
  if (nacional.length === 9 && nacional.startsWith("15")) nacional = CARACTERISTICA_LOCAL + nacional.slice(2);
  else if (nacional.length === 7) nacional = CARACTERISTICA_LOCAL + nacional;

  return /^[1-9]\d{9}$/.test(nacional) ? `549${nacional}` : null;
}

/**
 * El texto del mensaje. Lleva SOLO el N° interno y el área (sección 5): nada
 * del trámite ni de las personas, porque el chat queda en el teléfono del
 * vecino y en el de quien escribe.
 */
export function mensajeWhatsapp(numero: string, area: string): string {
  return `Hola. Le escribimos de la Dirección de Cementerios de la Municipalidad de San Miguel de Tucumán (${area}) por el expediente ${numero}.`;
}

/** `https://wa.me/549…?text=…`, o `null` si el teléfono no sirve para WhatsApp. */
export function enlaceWhatsapp(telefono: string | null | undefined, mensaje: string): string | null {
  const numero = telefonoParaWhatsapp(telefono);
  if (!numero) return null;
  return `https://wa.me/${numero}?text=${encodeURIComponent(mensaje)}`;
}

// ---------------------------------------------------------------------------
// Rutas de la app
// ---------------------------------------------------------------------------

export type Hoja = "caratula" | "historial";

export function rutaFicha(numero: string): string {
  return `/expedientes/${encodeURIComponent(numero)}`;
}

export function rutaEditar(numero: string): string {
  return `${rutaFicha(numero)}/editar`;
}

export function rutaImprimir(numero: string, hoja: Hoja): string {
  return `${rutaFicha(numero)}/imprimir?hoja=${hoja}`;
}

/** `?hoja=` de la página de imprimibles: la carátula si no dice otra cosa. */
export function leerHoja(valor: string | string[] | undefined): Hoja {
  const v = Array.isArray(valor) ? valor[0] : valor;
  return v === "historial" ? "historial" : "caratula";
}
