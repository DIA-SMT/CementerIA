/**
 * Límites de intentos del login propio (docs/api-dominio.md, sección 22). Puro,
 * con el reloj inyectado: lo prueban los tests sin esperar 15 minutos.
 *
 * Dos barreras, independientes:
 *
 * 1. Por usuario, en la base (`usuarios.intentos_fallidos` y
 *    `bloqueado_hasta`): cinco contraseñas incorrectas SEGUIDAS bloquean a ese
 *    usuario 15 minutos, aunque vengan de computadoras distintas. Un ingreso
 *    correcto vuelve el contador a 0. Lo puede levantar antes un admin
 *    ("Desbloquear"). Mientras dura, ni la contraseña correcta entra.
 *
 * 2. Por IP, en la MEMORIA DEL PROCESO: frena a quien prueba muchos usuarios
 *    distintos desde un mismo lugar (el bloqueo por usuario no lo ve). Es POR
 *    INSTANCIA: si algún día corren dos procesos de la app, cada uno lleva su
 *    cuenta, y un reinicio la borra. Alcanza para una sola instancia detrás de
 *    nginx (docs/despliegue.md); con varias, la cuenta tendría que ir a la base.
 *    El tope es holgado (30 fallos en 15 minutos) porque varias oficinas pueden
 *    salir por la misma IP.
 */

export const MAXIMO_FALLOS_USUARIO = 5;
export const BLOQUEO_USUARIO_MS = 15 * 60 * 1000;

export const MAXIMO_FALLOS_IP = 30;
export const VENTANA_IP_MS = 15 * 60 * 1000;

/** ¿Sigue bloqueado el usuario? */
export function estaBloqueado(bloqueadoHasta: Date | null | undefined, ahora: Date): boolean {
  return bloqueadoHasta != null && bloqueadoHasta.getTime() > ahora.getTime();
}

export interface EstadoFallos {
  intentosFallidos: number;
  bloqueadoHasta: Date | null;
  /** Este fallo fue el que bloqueó al usuario. */
  bloqueo: boolean;
}

/**
 * Lo que queda después de un fallo más. Al llegar al máximo, bloquea por 15
 * minutos y el contador vuelve a 0 (al vencer el bloqueo, empieza de nuevo).
 * Un bloqueo ya vencido no cuenta.
 */
export function siguienteFallo(intentosFallidos: number, ahora: Date): EstadoFallos {
  const intentos = Math.max(0, intentosFallidos) + 1;
  if (intentos >= MAXIMO_FALLOS_USUARIO) {
    return { intentosFallidos: 0, bloqueadoHasta: new Date(ahora.getTime() + BLOQUEO_USUARIO_MS), bloqueo: true };
  }
  return { intentosFallidos: intentos, bloqueadoHasta: null, bloqueo: false };
}

interface Cuenta {
  inicio: number;
  fallos: number;
}

/** Cuántas IP distintas se recuerdan como máximo (para que la memoria no crezca sin fin). */
const MAXIMO_IPS = 10_000;

/**
 * Fallos por IP en una ventana fija. `null` (sin IP conocida: un request que
 * no pasó por nginx) cuenta como una IP más.
 */
export class LimitePorIp {
  private readonly cuentas = new Map<string, Cuenta>();
  private readonly maximo: number;
  private readonly ventanaMs: number;
  private readonly reloj: () => number;

  constructor(opciones: { maximo?: number; ventanaMs?: number; ahora?: () => number } = {}) {
    this.maximo = opciones.maximo ?? MAXIMO_FALLOS_IP;
    this.ventanaMs = opciones.ventanaMs ?? VENTANA_IP_MS;
    this.reloj = opciones.ahora ?? Date.now;
  }

  private vigente(ip: string | null): Cuenta | null {
    const clave = ip ?? "sin-ip";
    const cuenta = this.cuentas.get(clave);
    if (!cuenta) return null;
    if (this.reloj() - cuenta.inicio >= this.ventanaMs) {
      this.cuentas.delete(clave);
      return null;
    }
    return cuenta;
  }

  /** ¿Esta IP ya llegó al tope en la ventana actual? */
  bloqueada(ip: string | null): boolean {
    return (this.vigente(ip)?.fallos ?? 0) >= this.maximo;
  }

  /** Suma un fallo; devuelve cuántos lleva en la ventana. */
  registrarFallo(ip: string | null): number {
    const cuenta = this.vigente(ip);
    if (cuenta) {
      cuenta.fallos += 1;
      return cuenta.fallos;
    }
    if (this.cuentas.size >= MAXIMO_IPS) this.podar();
    this.cuentas.set(ip ?? "sin-ip", { inicio: this.reloj(), fallos: 1 });
    return 1;
  }

  /** Saca las ventanas vencidas; si igual sobran, las más viejas. */
  private podar(): void {
    const ahora = this.reloj();
    for (const [clave, c] of this.cuentas) if (ahora - c.inicio >= this.ventanaMs) this.cuentas.delete(clave);
    while (this.cuentas.size >= MAXIMO_IPS) {
      const primera = this.cuentas.keys().next().value;
      if (primera === undefined) break;
      this.cuentas.delete(primera);
    }
  }

  /** Cuántas IP se están recordando (para los tests). */
  get tamano(): number {
    return this.cuentas.size;
  }
}

/**
 * El límite de la app: uno por proceso, colgado de `globalThis` para que el
 * hot reload de `next dev` (que re-evalúa los módulos) no lo reinicie.
 */
const global = globalThis as typeof globalThis & { __cementeriaLimiteIp?: LimitePorIp };
export function limiteIpDelProceso(): LimitePorIp {
  global.__cementeriaLimiteIp ??= new LimitePorIp();
  return global.__cementeriaLimiteIp;
}
