import type { Metadata } from "next";
// Inter autoalojada: el paquete trae los .woff2 y Next los sirve desde
// /_next/static. Sin next/font/google, que bajaría las fuentes de Google al
// compilar: el build para los servidores municipales no sale a internet.
import "@fontsource-variable/inter";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "CementerIA", template: "%s · CementerIA" },
  description: "Seguimiento de expedientes de la Dirección de Cementerios. Uso interno.",
  // Aplicación interna: nada de esto tiene que aparecer en un buscador.
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className="h-full antialiased">
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
