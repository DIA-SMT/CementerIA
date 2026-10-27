/**
 * Recorridos guiados (docs/diseno.md, "Recorridos guiados"): la parte pura del
 * motor. Sin React ni DOM, para probarla con vitest:
 *
 * - qué pasos de un recorrido se muestran a quién (perfil) y en esta pantalla
 *   (si el elemento al que apunta el paso existe y se ve);
 * - qué texto lleva cada paso según el perfil;
 * - qué se recuerda en el navegador (localStorage) y cuándo se vuelve a invitar.
 *
 * No hay nada en la base: la preferencia es del navegador. Si no hay
 * localStorage (modo privado estricto, bloqueado por política), todo funciona
 * igual y la invitación vuelve a aparecer.
 */

// ---------------------------------------------------------------------------
// Perfiles
// ---------------------------------------------------------------------------

/**
 * A quién se le habla. Mesa de Entradas es un operador con más tareas (alta,
 * carga histórica); "direccion" es el rol de lectura (Dirección y otros
 * usuarios de consulta).
 */
export const PERFILES = ["mesa", "operador", "direccion", "admin"] as const;
export type Perfil = (typeof PERFILES)[number];

/** El perfil del usuario de la sesión (rol y área: lo mismo que decide el menú). */
export function perfilDe(usuario: { rol: string; area: { codigo: string } | null }): Perfil {
  if (usuario.rol === "admin") return "admin";
  if (usuario.rol === "lectura") return "direccion";
  return usuario.area?.codigo === "MESA_ENTRADAS" ? "mesa" : "operador";
}

/**
 * Un texto que cambia según el perfil. `todos` es el de cualquiera; Mesa de
 * Entradas, si no tiene uno propio, usa el de `operador`. Un perfil sin texto
 * (ni propio ni `todos`) no ve ese paso.
 */
export type TextoPorPerfil = { todos?: string } & Partial<Record<Perfil, string>>;
export type Texto = string | TextoPorPerfil;

/** El texto para ese perfil, o null si a ese perfil no le corresponde. */
export function textoPara(texto: Texto, perfil: Perfil): string | null {
  if (typeof texto === "string") return texto;
  return texto[perfil] ?? (perfil === "mesa" ? texto.operador : undefined) ?? texto.todos ?? null;
}

// ---------------------------------------------------------------------------
// Recorridos y pasos
// ---------------------------------------------------------------------------

export interface PasoRecorrido {
  /** Único dentro del recorrido (para las pruebas y para no perder el lugar al cambiar el ancho). */
  id: string;
  /**
   * El valor de `data-recorrido` del elemento que se resalta. Con varios, el
   * primero que esté y se vea (por ejemplo, la barra de "Confirmar
   * seleccionados" y, si no hay lote, el botón Confirmar). Sin ancla, el globo
   * va centrado y sin resaltar nada (una presentación).
   */
  ancla?: string | readonly string[];
  titulo: Texto;
  texto: Texto;
}

export interface Recorrido {
  id: string;
  /** El nombre de la pantalla, como lo dice la invitación ("Bandeja", "Ficha del expediente"). */
  nombre: string;
  /**
   * Subir la versión cuando cambia el contenido: la clave de lo recordado la
   * incluye, así que se vuelve a invitar a todos.
   */
  version: number;
  pasos: readonly PasoRecorrido[];
}

/** Un paso listo para mostrar: textos del perfil y el ancla que se encontró (o null si va centrado). */
export interface PasoResuelto {
  id: string;
  titulo: string;
  texto: string;
  ancla: string | null;
}

/** Las anclas de un paso, como lista. */
export function anclasDe(paso: PasoRecorrido): readonly string[] {
  if (paso.ancla === undefined) return [];
  return typeof paso.ancla === "string" ? [paso.ancla] : paso.ancla;
}

/**
 * Los pasos que se muestran: los que tienen texto para el perfil y cuyo
 * elemento está en la pantalla y se ve (`seVe(ancla)`, que en el navegador
 * mira el DOM). Un paso con ancla que no aparece se saltea solo: "Dar pase"
 * para Dirección, la barra lateral en el celular, "Plazos" para quien no tiene
 * expedientes en la DIM.
 */
export function resolverPasos(recorrido: Recorrido, perfil: Perfil, seVe: (ancla: string) => boolean): PasoResuelto[] {
  const pasos: PasoResuelto[] = [];
  for (const paso of recorrido.pasos) {
    const titulo = textoPara(paso.titulo, perfil);
    const texto = textoPara(paso.texto, perfil);
    if (titulo === null || texto === null) continue;
    const anclas = anclasDe(paso);
    if (anclas.length === 0) {
      pasos.push({ id: paso.id, titulo, texto, ancla: null });
      continue;
    }
    const ancla = anclas.find((a) => seVe(a));
    if (ancla !== undefined) pasos.push({ id: paso.id, titulo, texto, ancla });
  }
  return pasos;
}

/** "Paso 2 de 6" */
export function textoProgreso(indice: number, total: number): string {
  return `Paso ${indice + 1} de ${total}`;
}

// ---------------------------------------------------------------------------
// Lo que se recuerda en el navegador
// ---------------------------------------------------------------------------

/** Lo que el motor usa de `localStorage` (así se prueba con uno de mentira). */
export interface Almacen {
  getItem(clave: string): string | null;
  setItem(clave: string, valor: string): void;
  removeItem(clave: string): void;
  readonly length: number;
  key(indice: number): string | null;
}

/** El prefijo de todas las claves de los recorridos. */
export const PREFIJO_CLAVE = "cementeria:recorrido";

/** Las claves de un usuario (para reiniciar sin tocar las de otro que use la misma computadora). */
export function prefijoUsuario(usuarioId: number): string {
  return `${PREFIJO_CLAVE}:${usuarioId}:`;
}

/** `cementeria:recorrido:12:bandeja:v1`: por usuario, pantalla y versión del recorrido. */
export function claveRecorrido(usuarioId: number, recorrido: Pick<Recorrido, "id" | "version">): string {
  return `${prefijoUsuario(usuarioId)}${recorrido.id}:v${recorrido.version}`;
}

/**
 * Qué contestó la persona:
 * - `visto`: empezó el recorrido (desde la invitación o desde el "?");
 * - `descartado`: "No volver a mostrar";
 * - `pospuesto:AAAA-MM-DD`: "Ahora no" ese día; se vuelve a invitar otro día.
 */
export type Decision = "empezado" | "ahora_no" | "no_mostrar";

/**
 * El localStorage del navegador, si se puede usar. Algunos navegadores tiran
 * error con solo leer `window.localStorage` (cookies bloqueadas) o al
 * escribir (cuota, modo privado): se prueba una escritura y, si falla, null.
 */
export function almacenDisponible(obtener: () => Almacen | null | undefined): Almacen | null {
  try {
    const almacen = obtener();
    if (!almacen) return null;
    const prueba = `${PREFIJO_CLAVE}:prueba`;
    almacen.setItem(prueba, "1");
    almacen.removeItem(prueba);
    return almacen;
  } catch {
    return null;
  }
}

/**
 * ¿Se invita a este recorrido? Sí, salvo que ya lo haya empezado, que haya
 * pedido no volver a verlo o que hoy haya dicho "Ahora no". Sin almacén (o si
 * leerlo falla), sí: es mejor volver a invitar que no invitar nunca.
 */
export function debeInvitar(almacen: Almacen | null, usuarioId: number, recorrido: Pick<Recorrido, "id" | "version">, hoy: string): boolean {
  if (!almacen) return true;
  let valor: string | null;
  try {
    valor = almacen.getItem(claveRecorrido(usuarioId, recorrido));
  } catch {
    return true;
  }
  if (valor === null) return true;
  if (valor === "visto" || valor === "descartado") return false;
  if (valor.startsWith("pospuesto:")) return valor.slice("pospuesto:".length) !== hoy;
  // Un valor que no se entiende (de otra versión del código): se vuelve a invitar.
  return true;
}

/** Guarda la decisión. Devuelve false si no se pudo (sin almacén o lleno): la pantalla sigue igual. */
export function registrarDecision(
  almacen: Almacen | null,
  usuarioId: number,
  recorrido: Pick<Recorrido, "id" | "version">,
  decision: Decision,
  hoy: string,
): boolean {
  if (!almacen) return false;
  const valor = decision === "empezado" ? "visto" : decision === "no_mostrar" ? "descartado" : `pospuesto:${hoy}`;
  try {
    almacen.setItem(claveRecorrido(usuarioId, recorrido), valor);
    return true;
  } catch {
    return false;
  }
}

/**
 * "Reiniciar los recorridos": borra lo recordado de ese usuario (todas las
 * pantallas y versiones, también la bienvenida), así cada pantalla vuelve a
 * invitar. Devuelve cuántas claves borró (o null si no hay almacén).
 */
export function reiniciarRecorridos(almacen: Almacen | null, usuarioId: number): number | null {
  if (!almacen) return null;
  try {
    const prefijo = prefijoUsuario(usuarioId);
    const claves: string[] = [];
    for (let i = 0; i < almacen.length; i++) {
      const clave = almacen.key(i);
      if (clave?.startsWith(prefijo)) claves.push(clave);
    }
    for (const clave of claves) almacen.removeItem(clave);
    return claves.length;
  } catch {
    return null;
  }
}

/**
 * Qué invitación mostrar en esta vista: primero la bienvenida (una sola vez,
 * al primer ingreso) y, si ya se contestó, la de la pantalla. Null si ninguna.
 * La bienvenida no se pospone: cualquier respuesta la cierra para siempre
 * (quien la quiera ver de nuevo, "Reiniciar los recorridos").
 */
export function invitacionPara(
  almacen: Almacen | null,
  usuarioId: number,
  candidatos: { bienvenida: Recorrido | null; pantalla: Recorrido | null },
  hoy: string,
): Recorrido | null {
  if (candidatos.bienvenida && debeInvitar(almacen, usuarioId, candidatos.bienvenida, hoy)) return candidatos.bienvenida;
  if (candidatos.pantalla && debeInvitar(almacen, usuarioId, candidatos.pantalla, hoy)) return candidatos.pantalla;
  return null;
}

/** El día local (AAAA-MM-DD) para "Ahora no": se vuelve a invitar cuando cambia. */
export function diaLocal(fecha: Date): string {
  const d = (n: number) => String(n).padStart(2, "0");
  return `${fecha.getFullYear()}-${d(fecha.getMonth() + 1)}-${d(fecha.getDate())}`;
}
