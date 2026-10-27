// npm run dev:supabase — levanta `next dev` conectado a la base de Supabase.
//
// Toma DATABASE_URL (el rol cementeria_app) y DATABASE_CA_FILE de
// .env.supabase.local y los pasa por el entorno del proceso, que en Next manda
// sobre los archivos .env: así .env.local sigue apuntando a la base local y no
// hay que editarlo para cambiar de base.
//
// El login simulado queda APAGADO (AUTH_DEV_LOGIN=0): contra la base real no
// puede existir una puerta para entrar como cualquier usuario sin contraseña.
//
// Uso: npm run dev:supabase [-- --port 3005]

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { parse } from "dotenv";

const RAIZ = path.resolve(import.meta.dirname, "..");
const ARCHIVO = path.join(RAIZ, ".env.supabase.local");
const CA_POR_DEFECTO = "certs/supabase-prod-ca-2021.crt";

function salir(mensaje) {
  console.error(`✗ ${mensaje}`);
  process.exit(1);
}

if (!existsSync(ARCHIVO)) salir("No existe .env.supabase.local. Ver docs/despliegue.md, sección Base en Supabase.");
const env = parse(readFileSync(ARCHIVO));

const urlArchivo = env.DATABASE_URL?.trim();
if (!urlArchivo) salir("Falta DATABASE_URL en .env.supabase.local: corré npm run supabase:sql o npm run supabase:preparar.");
// Por el Transaction pooler (6543), como en Vercel: el Session pooler (5432)
// reserva una conexión fija por cliente, y entre next dev (que puede tener
// varios clientes de Prisma vivos) y las funciones de Vercel se agotan los
// lugares del pooler ("max clients reached in session mode"). Con --sesion se
// fuerza el 5432.
const transaccion = !process.argv.includes("--sesion");
const destino = new URL(urlArchivo);
if (transaccion && destino.port === "5432") destino.port = "6543";
const url = destino.toString();
if (!decodeURIComponent(new URL(url).username).startsWith("cementeria_app.")) {
  // La app nunca entra como postgres ni como deploy: perdería la protección por
  // permisos del historial.
  salir("DATABASE_URL de .env.supabase.local no es el rol cementeria_app.");
}

const ca = env.DATABASE_CA_FILE?.trim() || CA_POR_DEFECTO;
if (!existsSync(path.resolve(RAIZ, ca))) {
  salir(
    `Falta el certificado de Supabase en ${ca}. Bajalo del panel (Project Settings → Database → ` +
      "SSL Configuration → Download certificate) y guardalo ahí.",
  );
}

const argumentos = process.argv.slice(2).filter((a) => a !== "--sesion");
const puerto = argumentos.includes("--port") ? [] : ["--port", "3005"];

console.log(
  `» next dev contra Supabase (rol cementeria_app por el ${transaccion ? "Transaction pooler, 6543" : "Session pooler, 5432"}, TLS con la CA de Supabase, sin login simulado)`,
);
const hijo = spawn(process.execPath, [path.join(RAIZ, "node_modules", "next", "dist", "bin", "next"), "dev", ...puerto, ...argumentos], {
  cwd: RAIZ,
  stdio: "inherit",
  env: {
    ...process.env,
    DATABASE_URL: url,
    DATABASE_CA_FILE: ca,
    DB_POOL_MAX: process.env.DB_POOL_MAX ?? "3",
    AUTH_DEV_LOGIN: "0",
    AUTH_DEV_LOGIN_STAGING: "",
  },
});
hijo.on("exit", (codigo) => process.exit(codigo ?? 0));
