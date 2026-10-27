import { z } from "zod";
import { enVercel, problemasAlmacen, tipoDeAlmacen } from "@/lib/adjuntos/config";
import { cuilValido } from "@/lib/dominio/cuil";
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
  // Modo prueba (27/10/2026): los CUILs que pueden usar "Ver como…" para entrar
  // a cada perfil con su propio usuario. Se valida en leerPerfilesPrueba().
  PERFILES_PRUEBA_CUILS: z.string().optional(),
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
  /**
   * Modo prueba (PERFILES_PRUEBA_CUILS): los CUILs, de 11 dígitos y sin
   * guiones, que pueden cambiar su propio perfil con "Ver como…". Vacío = el
   * selector no existe (ni en la pantalla ni en el servidor). Ver
   * src/lib/dominio/admin/perfil-prueba.ts.
   */
  perfilesPrueba: ReadonlySet<string>;
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

const SIN_PERFILES_PRUEBA: ReadonlySet<string> = new Set();

/**
 * PERFILES_PRUEBA_CUILS: CUILs separados por coma, con o sin guiones (también
 * puntos o espacios), cada uno con su dígito verificador. Ausente o vacía, el
 * conjunto vacío: modo prueba apagado. El mensaje de error no repite los
 * valores: son CUILs de personas y el error termina en el log.
 */
export function leerPerfilesPrueba(valor: string | undefined, problemas: string[]): ReadonlySet<string> {
  if (valor === undefined || valor.trim() === "") return SIN_PERFILES_PRUEBA;
  const cuils = valor
    .split(",")
    .map((c) => c.replace(/[\s.-]/g, ""))
    .filter(Boolean);
  const invalidos = cuils.filter((c) => !cuilValido(c)).length;
  if (cuils.length === 0 || invalidos > 0) {
    const cuantos = invalidos === 1 ? " (1 no lo es)" : invalidos > 1 ? ` (${invalidos} no lo son)` : "";
    problemas.push(
      `PERFILES_PRUEBA_CUILS: tiene que ser una lista de CUILs de 11 dígitos (con o sin guiones), separados por coma y con el dígito verificador correcto${cuantos}`,
    );
    return SIN_PERFILES_PRUEBA;
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
  // Permitida también en producción (el modo prueba se usa en Vercel); al
  // arrancar deja una advertencia en el log (validarEntornoAlIniciar).
  const perfilesPrueba = leerPerfilesPrueba(e.PERFILES_PRUEBA_CUILS, problemas);
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

  return {
    nodeEnv: e.NODE_ENV,
    produccion,
    secretoSesion: e.SESSION_SECRET,
    appUrl,
    cidituc,
    devLogin,
    politicaClave: e.CLAVE_POLITICA,
    perfilesPrueba,
  };
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

/** Largo mínimo de CRON_SECRET (como SESSION_SECRET; Vercel pide 16 o más). */
const MINIMO_CRON_SECRET = 32;

/**
 * Lo propio del despliegue que no es parte de `Entorno` (lo leen otros
 * módulos): CRON_SECRET y DB_POOL_MAX. Nombra variable y regla, nunca el valor.
 *
 * - CRON_SECRET: opcional en general (en el servidor municipal las tareas las
 *   corre systemd), pero en Vercel y en producción es obligatoria: vercel.json
 *   declara los crons y sin ella sus rutas responden 401 siempre
 *   (src/lib/cron/autorizacion.ts).
 * - DB_POOL_MAX: un entero chico (en Vercel, con el Transaction pooler, 3).
 */
export function problemasDespliegue(fuente: Readonly<Record<string, string | undefined>>, produccion: boolean): string[] {
  const problemas: string[] = [];
  const cron = fuente.CRON_SECRET?.trim();
  if (cron && cron.length < MINIMO_CRON_SECRET) {
    problemas.push(`CRON_SECRET: tiene que tener al menos ${MINIMO_CRON_SECRET} caracteres aleatorios`);
  } else if (!cron && produccion && enVercel(fuente)) {
    problemas.push("CRON_SECRET: falta (en Vercel, vercel.json declara los crons y Vercel la manda como Authorization: Bearer)");
  }
  const pool = fuente.DB_POOL_MAX?.trim();
  if (pool && !(/^\d+$/.test(pool) && Number(pool) >= 1 && Number(pool) <= 50)) {
    problemas.push("DB_POOL_MAX: tiene que ser un entero de 1 a 50");
  }
  return problemas;
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
  // Los adjuntos: el disco (ADJUNTOS_DIR, en producción obligatoria y
  // absoluta, fuera del webroot) o Supabase Storage (SUPABASE_URL y
  // SUPABASE_SECRET_KEY); ver src/lib/adjuntos/config.ts, que no usa
  // node:path porque este módulo también lo lee el proxy. Se exige al
  // arrancar y no en la primera subida.
  const problemas = [...problemasAlmacen(fuente, resultado.produccion), ...problemasDespliegue(fuente, resultado.produccion)];
  if (problemas.length > 0) throw new EntornoInvalido(problemas);
  log.info("entorno.validado", {
    nodeEnv: resultado.nodeEnv,
    vercel: enVercel(fuente),
    almacenAdjuntos: tipoDeAlmacen(fuente),
    cron: Boolean(fuente.CRON_SECRET?.trim()),
    cidituc: resultado.cidituc.habilitado,
    devLogin: resultado.devLogin.habilitado,
    devLoginListaBlanca: resultado.devLogin.habilitado ? (resultado.devLogin.listaBlanca?.size ?? null) : null,
    politicaClave: resultado.politicaClave,
    perfilesPrueba: resultado.perfilesPrueba.size,
  });
  // No impide arrancar (sirve para probar un despliegue), pero no puede pasar
  // desapercibido: con datos reales, una contraseña como 123456 se adivina al
  // primer intento y el bloqueo por intentos no la protege.
  if (resultado.produccion && resultado.politicaClave === "libre") {
    log.warn("entorno.clave_politica_libre", {
      aviso: "CLAVE_POLITICA=libre en producción: se aceptan contraseñas triviales. Volvé a estricta antes de cargar datos reales.",
    });
  }
  // Modo prueba: tampoco impide arrancar (se prueba en Vercel), pero queda a la
  // vista en el log en cualquier entorno, con la cantidad de CUILs y nunca los
  // números.
  if (resultado.perfilesPrueba.size > 0) {
    log.warn("entorno.modo_prueba_activo", {
      aviso:
        'PERFILES_PRUEBA_CUILS está definida: hay modo prueba ("Ver como…") y esos usuarios pueden cambiar su propia área y rol. Volvé a Administrador y borrala antes de cargar datos reales.',
      cuils: resultado.perfilesPrueba.size,
      produccion: resultado.produccion,
    });
  }
  return resultado;
}
