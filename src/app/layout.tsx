import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "CementerIA", template: "%s · CementerIA" },
  description: "Seguimiento de expedientes de la Dirección de Cementerios. Uso interno.",
  // Aplicación interna: nada de esto tiene que aparecer en un buscador.
  robots: { index: false, follow: false },
};

// Sin next/font/google: bajaría las fuentes de Google al compilar, y el build
// para los servidores municipales no tiene por qué depender de salir a internet.
// La tipografía del sistema alcanza para una herramienta interna.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className="h-full antialiased">
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
