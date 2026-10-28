import type { NextConfig } from "next";

/**
 * Dos despliegues, elegidos por dónde se construye (docs/despliegue.md y
 * docs/despliegue-vercel.md):
 *
 * - Servidor municipal (nginx + systemd): `output: "standalone"` y los
 *   encabezados de seguridad los pone nginx
 *   (deploy/nginx/snippets/cementeria-seguridad.conf). La app no los repite:
 *   un add_header de nginx y el mismo encabezado desde Next saldrían dos veces.
 * - Vercel (VERCEL=1 en el build): sin standalone (Vercel empaqueta cada
 *   función con su propio rastreo de archivos) y sin nginx delante, así que
 *   los mismos encabezados los pone Next con `headers()`.
 *
 * ENCABEZADOS_SEGURIDAD=app fuerza los encabezados desde Next fuera de Vercel
 * (por ejemplo, otro hosting sin nginx). Las dos variables se leen en el
 * build: next.config se evalúa en `next build`.
 */
const enVercel = process.env.VERCEL === "1";
const encabezadosDesdeLaApp = enVercel || process.env.ENCABEZADOS_SEGURIDAD === "app";

/** Los de cementeria-seguridad.conf, con los mismos valores y las mismas razones. */
const ENCABEZADOS_SEGURIDAD = [
  // Solo https durante un año para este host; sin includeSubDomains ni preload.
  { key: "Strict-Transport-Security", value: "max-age=31536000" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // SAMEORIGIN y no DENY: el visor de adjuntos de la ficha es un <iframe> del mismo sitio.
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
];

/**
 * La CSP mínima de nginx. Sin connect-src: la subida directa a Supabase
 * Storage es un fetch a otro origen (si algún día se agrega connect-src, tiene
 * que incluir SUPABASE_URL).
 */
const CSP = "frame-ancestors 'self'; base-uri 'self'; object-src 'none'";

const nextConfig: NextConfig = {
  // Servidor municipal, sin npm en el servidor (sección 6, "Hosting"): `next
  // build` deja en .next/standalone un server.js con solo los node_modules que
  // usa. `npm run empaquetar` (scripts/empaquetar.mjs) le suma .next/static,
  // public, las migraciones y la CLI de Prisma. En Vercel no hace falta.
  output: enVercel ? undefined : "standalone",
  // "X-Powered-By: Next.js": no hace falta anunciarlo (en el servidor municipal nginx ya lo saca).
  poweredByHeader: false,
  // La app es 100 % autenticada y dinámica: cada página lee la cookie de sesión
  // y no hay nada que prerenderizar (sección 6, "Stack"). Con Cache Components
  // cada lectura de cookies() fuera de un <Suspense> rompe el build.
  // `partialPrefetching` exige Cache Components, así que se va con él.
  cacheComponents: false,
  logging: {
    // `next dev` loguea cada request con su query string, y la de
    // /auth/callback lleva el token de Cidituc (sección 6, punto 7: el token
    // nunca se loguea). En producción lo mismo lo resuelve nginx.
    // Sin `^`: según cómo llegue el request, `url` puede traer el origen.
    incomingRequests: { ignore: [/\/auth\/callback(?:[/?]|$)/] },
  },
  async headers() {
    // La consulta pública (28/10/2026), en los dos despliegues: nada de caché
    // (la respuesta es de un trámite) y sin Referer (la ruta lleva el número).
    // Va última: si coincide con la general, gana su Referrer-Policy. Detrás de
    // nginx, que agrega el suyo, la página lo repite con <meta name="referrer">.
    const consulta = [
      { key: "Cache-Control", value: "no-store, max-age=0" },
      { key: "Referrer-Policy", value: "no-referrer" },
    ];
    const deLaConsulta = [
      { source: "/consulta", headers: consulta },
      { source: "/consulta/:path*", headers: consulta },
    ];
    if (!encabezadosDesdeLaApp) return deLaConsulta;
    return [
      { source: "/:path*", headers: ENCABEZADOS_SEGURIDAD },
      // La CSP general, en todo salvo /adjuntos/…: esa ruta manda la suya
      // (`sandbox; default-src 'none'`, src/lib/presentacion/adjuntos-http.ts)
      // y en Next un encabezado de next.config le gana al del Route Handler
      // (send-response.js no lo agrega si ya está). Ahí el enmarcado lo sigue
      // limitando X-Frame-Options, como detrás de nginx.
      { source: "/:path((?!adjuntos/).*)", headers: [{ key: "Content-Security-Policy", value: CSP }] },
      ...deLaConsulta,
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
