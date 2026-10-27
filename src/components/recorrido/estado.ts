import { almacenDisponible, PREFIJO_CLAVE, type Almacen } from "@/lib/presentacion/recorridos/motor";

/**
 * Estado de los recorridos del lado del navegador, fuera de React (se lee con
 * `useSyncExternalStore`): qué pantalla está a la vista (la marca cada página
 * con `<PantallaConRecorrido id=… />`) y el localStorage. Así la invitación se
 * calcula sin efectos que pongan estado y sin diferencias entre el HTML del
 * servidor y la primera pintura (en el servidor no hay pantalla ni almacén:
 * no se invita).
 */

type Oyente = () => void;

/** La pantalla a la vista y su número de "vista" (cada vez que se monta una página, uno nuevo). */
export interface PantallaVista {
  id: string;
  vista: number;
}

const oyentes = new Set<Oyente>();
let pantalla: PantallaVista | null = null;
let vistas = 0;

function alCambiarStorage(e: StorageEvent) {
  // Otra pestaña contestó una invitación o reinició los recorridos.
  if (e.key === null || e.key.startsWith(PREFIJO_CLAVE)) avisar();
}

export function suscribir(oyente: Oyente): () => void {
  if (oyentes.size === 0) window.addEventListener("storage", alCambiarStorage);
  oyentes.add(oyente);
  return () => {
    oyentes.delete(oyente);
    if (oyentes.size === 0) window.removeEventListener("storage", alCambiarStorage);
  };
}

/** Avisa que algo cambió (una respuesta guardada, un reinicio): React vuelve a leer. */
export function avisar(): void {
  for (const oyente of [...oyentes]) oyente();
}

/** La marca una página al montarse. Devuelve su número de vista, para desmarcarla. */
export function marcarPantalla(id: string): number {
  vistas += 1;
  pantalla = { id, vista: vistas };
  avisar();
  return vistas;
}

/** Al desmontarse; si ya se marcó otra (la página nueva), no la pisa. */
export function desmarcarPantalla(vista: number): void {
  if (pantalla?.vista !== vista) return;
  pantalla = null;
  avisar();
}

export function pantallaActual(): PantallaVista | null {
  return pantalla;
}

let almacenCache: Almacen | null | undefined;

/** El localStorage si se puede usar (se prueba una sola vez por carga de página), o null. */
export function almacenDelNavegador(): Almacen | null {
  if (almacenCache === undefined) almacenCache = almacenDisponible(() => window.localStorage);
  return almacenCache;
}
