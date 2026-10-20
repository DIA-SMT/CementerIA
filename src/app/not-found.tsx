import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "No encontrada" };

/**
 * 404 de toda la app. También es lo que ve quien abre /dev/login donde el login
 * simulado no está habilitado: a propósito, nada indica que esa ruta exista.
 */
export default function NoEncontrada() {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="max-w-md space-y-3 text-center">
        <h1 className="text-lg font-semibold text-slate-900">No encontramos esa página</h1>
        <p className="text-sm text-slate-600">Revisá la dirección, o volvé al inicio.</p>
        <Link href="/" className="inline-block text-sm text-slate-700 underline underline-offset-2 hover:text-slate-900">
          Ir al inicio
        </Link>
      </div>
    </main>
  );
}
