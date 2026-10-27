import { z } from "zod";
import { log } from "@/lib/log";

/**
 * Variables de entorno de la app, validadas con zod.
 *
 * Se leen perezosamente (`entorno()`), nunca al importar: `next build` evalúa
 * los módulos del servidor sin el entorno de producción, y validar ahí rompería
 * el build. La validación que corta el arranque la hace `src/instrumentation.ts`
 * con `validarEntornoAlIniciar()`, que Next corre antes de atender el primer
 * request (y no durante el build).
 *
 * Los mensajes de error nombran la variable y la regla, nunca el valor: el
 * valor puede ser un secreto y el error termina en journald.
 */

const ESQUEMA = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  SESSION_SECRET: z
    .string({ error: "falta (32 caracteres o más, aleatorios)" })
    .min(32, "tiene que tener al menos 32 caracteres"),
  APP_URL: z.url({ protocol: /^https?$/, error: "tiene que ser una URL http(s)" }).optional(),
  AUTH_DEV_LOGIN: z.string().optional(),
  AUTH_DEV_LOGIN_STAGING: z.string().optional(),
  CIDITUC_HABILITADO: z.enum(["0", "1"], { error: "tiene que ser 0 o 1" }).default("0"),
  // Va el origen; el `#/login?next=…&state=…` lo arma el código (ver
  // cidituc/derivador.ts), así que un fragmento escrito acá se ignora.
  CIDITUC_DERIVADOR_URL: z
    .url({ protocol: /^https?$/, error: "tiene que ser una URL http(s)" })
    .default("https://cidituc.smt.gob.ar/"),
  CIDITUC_API_URL: z.url({ protocol: /^https?$/, error: "tiene que ser una URL http(s)" }).optional(),
  // `cementeria` en producción y `cementeria-staging` en staging: cada
  // instancia tiene su propia clave en el derivador (sección 6, punto 9).
  CIDITUC_CLAVE: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]*$/, "solo minúsculas, dígitos y guiones")
    .default("cementeria"),
  // `libre` acepta cualquier contraseña (1 a 128 caracteres) para probar. Por
  // defecto, la política estricta de src/lib/auth/clave.ts.
  CLAVE_POLITICA: z.enum(["estricta", "libre"], { error: "tiene que ser estricta o libre" }).default("estricta"),
});

export type PoliticaClave = "estricta" | "libre";

export type NodeEnv = "development" | "production" | "test";

export type ConfigCidituc =
  | { habilitado: false }
  | { habilitado: true; derivadorUrl: string; apiUrl: string; clave: string };

/**
 * Login simulado (/dev/login). `listaBlanca` en null = cualquier usuario activo
 * (solo fuera de producción).
 */
export type ConfigDevLogin = { habilitado: false } | { habilitado: true; listaBlanca: ReadonlySet<string> | null };

export interface Entorno {
  nodeEnv: NodeEnv;
  produccion: boolean;
  secretoSesion: string;
  /** Origen público de la app. Solo se exige con AUTH_DEV_LOGIN_STAGING en producción. */
  appUrl: URL | null;
  cidituc: ConfigCidituc;
  devLogin: ConfigDevLogin;
  /** Qué exige la contraseña nueva (CLAVE_POLITICA). */
  politicaClave: PoliticaClave;
}

export class EntornoInvalido extends Error {
  constructor(readonly problemas: readonly string[]) {
    super(`Configuración inválida:\n- ${problemas.join("\n- ")}`);
    this.name = "EntornoInvalido";
  }
}

/**
 * ¿El host es de staging? Tiene que llevar `staging` como palabra entera en su
 * nombre (cementeria-staging.smt.gob.ar, staging.cementerios.smt.gob.ar).
 *
 * Se decide por el nombre y no por una lista de hosts de producción porque el
 * dominio definitivo todavía no está confirmado (pregunta 6): una lista
 * incompleta dejaría pasar justo el host que faltó anotar. Así, por defecto,
 * todo host es producción.
 *
 * localhost y 127.0.0.1 NO son staging: detrás de nginx, el header Host que
 * compara devLoginPara() lo puede elegir el cliente, y con APP_URL en
 * localhost alcanzaría un `Host: localhost` para que el login simulado
 * apareciera en producción. Un build de producción se prueba en local sin
 * lista blanca, o con AUTH_DEV_LOGIN y NODE_ENV=development.
 */
export function esHostDeStaging(hostname: string): boolean {
  return /(^|[.-])staging([.-]|$)/i.test(hostname);
}

/** CUILs separados por coma; `null` si la variable no está o está vacía. */
function leerListaBlanca(valor: string | undefined, problemas: string[]): ReadonlySet<string> | null {
  if (valor === undefined || valor.trim() === "") return null;
  const cuils = valor
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
  const invalidos = cuils.filter((c) => !/^\d{11}$/.test(c));
  if (invalidos.length > 0 || cuils.length === 0) {
    problemas.push(
      "AUTH_DEV_LOGIN_STAGING: tiene que ser la lista blanca de CUILs de 11 dígitos, separados por coma",
    );
    return null;
  }
  return new Set(cuils);
}

/**
 * Lee y valida el entorno. Pura: recibe las variables, así se prueba sin tocar
 * `process.env`.
 *
 * @throws EntornoInvalido con todos los problemas juntos, no solo el primero.
 */
export function leerEntorno(fuente: Readonly<Record<string, string | undefined>>): Entorno {
  // `AUTH_DEV_LOGIN=` en un .env la deja vacía pero DEFINIDA, y la regla de
  // producción es sobre estar definida: se mira antes de limpiar los vacíos.
  const devLoginDefinida = fuente.AUTH_DEV_LOGIN !== undefined;

  const limpia: Record<string, string> = {};
  for (const clave of Object.keys(ESQUEMA.shape)) {
    const valor = fuente[clave]?.trim();
    if (valor) limpia[clave] = valor;
  }

  const problemas: string[] = [];
  const resultado = ESQUEMA.safeParse(limpia);
  if (!resultado.success) {
    for (const issue of resultado.error.issues) {
      problemas.push(`${issue.path.join(".") || "(entorno)"}: ${issue.message}`);
    }
    throw new EntornoInvalido(problemas);
  }
  const e = resultado.data;
  const produccion = e.NODE_ENV === "production";
  const appUrl = e.APP_URL ? new URL(e.APP_URL) : null;

  if (produccion && devLoginDefinida) {
    problemas.push(
      "AUTH_DEV_LOGIN: no puede estar definida en producción, ni vacía. El login simulado deja entrar como cualquier usuario sin Cidituc.",
    );
  }

  const listaBlanca = leerListaBlanca(e.AUTH_DEV_LOGIN_STAGING, problemas);
  if (produccion && listaBlanca) {
    if (!appUrl) {
      problemas.push("APP_URL: hace falta con AUTH_DEV_LOGIN_STAGING, para comprobar que este host no es el de producción");
    } else if (!esHostDeStaging(appUrl.hostname)) {
      problemas.push(
        `AUTH_DEV_LOGIN_STAGING: el host ${appUrl.hostname} no es de staging (tiene que llevar "staging" en el nombre). En producción no hay login simulado.`,
      );
    } else if (appUrl.protocol !== "https:") {
      problemas.push("APP_URL: con AUTH_DEV_LOGIN_STAGING tiene que ser https (staging va detrás de nginx con TLS)");
    }
  }

  let cidituc: ConfigCidituc = { habilitado: false };
  if (e.CIDITUC_HABILITADO === "1") {
    if (!e.CIDITUC_API_URL) {
      problemas.push("CIDITUC_API_URL: hace falta con CIDITUC_HABILITADO=1");
    } else if (produccion && !e.CIDITUC_API_URL.startsWith("https:")) {
      problemas.push("CIDITUC_API_URL: en producción tiene que ser https (el token viaja en esa consulta)");
    } else {
      cidituc = {
        habilitado: true,
        derivadorUrl: e.CIDITUC_DERIVADOR_URL,
        apiUrl: e.CIDITUC_API_URL.replace(/\/+$/, ""),
        clave: e.CIDITUC_CLAVE,
      };
    }
  }

  if (problemas.length > 0) throw new EntornoInvalido(problemas);

  let devLogin: ConfigDevLogin = { habilitado: false };
  if (listaBlanca) {
    devLogin = { habilitado: true, listaBlanca };
  } else if (!produccion && e.AUTH_DEV_LOGIN === "1") {
    devLogin = { habilitado: true, listaBlanca: null };
  }

  return { nodeEnv: e.NODE_ENV, produccion, secretoSesion: e.SESSION_SECRET, appUrl, cidituc, devLogin, politicaClave: e.CLAVE_POLITICA };
}

/**
 * El login simulado para un request a `hostname`, o `null` si no corresponde
 * (/dev/login y /dev/login/entrar responden 404).
 *
 * En producción, además del APP_URL que se validó al arrancar, el request tiene
 * que venir a ESE host: si la instancia de staging quedara atendiendo también
 * otro dominio (un server_name de más en nginx), el login simulado no aparece
 * ahí.
 */
export function devLoginPara(e: Entorno, hostname: string): Extract<ConfigDevLogin, { habilitado: true }> | null {
  if (!e.devLogin.habilitado) return null;
  if (e.produccion && (!e.appUrl || e.appUrl.hostname !== hostname.toLowerCase())) return null;
  return e.devLogin;
}

let enCache: Entorno | undefined;

/** El entorno del proceso, validado la primera vez que se pide. */
export function entorno(): Entorno {
  enCache ??= leerEntorno(process.env);
  return enCache;
}

/**
 * Valida la configuración al arrancar y tira si no sirve. La llama
 * validarOTerminar() (src/lib/arranque.ts) desde `register()` de
 * src/instrumentation.ts; es esa función la que, en producción, termina el
 * proceso, que es lo que pide la sección 6 para AUTH_DEV_LOGIN.
 */
export function validarEntornoAlIniciar(fuente: Readonly<Record<string, string | undefined>> = process.env): Entorno {
  const resultado = leerEntorno(fuente);
  if (!fuente.DATABASE_URL?.trim()) {
    throw new EntornoInvalido(["DATABASE_URL: falta (rol cementeria_app)"]);
  }
  // Los adjuntos van a una carpeta fuera del webroot (sección 6, "Adjuntos").
  // En desarrollo hay un valor por defecto (./.data/adjuntos); en producción
  // se exige al arrancar y no en la primera subida.
  const adjuntos = fuente.ADJUNTOS_DIR?.trim();
  if (resultado.produccion && !adjuntos) {
    throw new EntornoInvalido(["ADJUNTOS_DIR: falta (carpeta de los adjuntos, fuera del webroot, por ejemplo /var/lib/cementeria/adjuntos)"]);
  }
  // Absoluta en POSIX (`/var/…`) o en Windows (`C:\…`), sin importar node:path:
  // este módulo también lo lee el proxy.
  if (resultado.produccion && adjuntos && !/^(\/|[A-Za-z]:[\\/])/.test(adjuntos)) {
    throw new EntornoInvalido(["ADJUNTOS_DIR: en producción tiene que ser una ruta absoluta"]);
  }
  log.info("entorno.validado", {
    nodeEnv: resultado.nodeEnv,
    cidituc: resultado.cidituc.habilitado,
    devLogin: resultado.devLogin.habilitado,
    devLoginListaBlanca: resultado.devLogin.habilitado ? (resultado.devLogin.listaBlanca?.size ?? null) : null,
    politicaClave: resultado.politicaClave,
  });
  // No impide arrancar (sirve para probar un despliegue), pero no puede pasar
  // desapercibido: con datos reales, una contraseña como 123456 se adivina al
  // primer intento y el bloqueo por intentos no la protege.
  if (resultado.produccion && resultado.politicaClave === "libre") {
    log.warn("entorno.clave_politica_libre", {
      aviso: "CLAVE_POLITICA=libre en producción: se aceptan contraseñas triviales. Volvé a estricta antes de cargar datos reales.",
    });
  }
  return resultado;
}
