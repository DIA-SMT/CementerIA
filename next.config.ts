import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
