import { CLASE_FOCO } from "./formulario";

/**
 * Las clases de una pestaña (bandeja, administración, auditoría, catálogos,
 * editor de plantillas): subrayado azul de 2 px y texto `primario-oscuro` en la
 * actual (5,95:1 sobre el fondo tintado del hover, 6,72:1 sobre blanco), gris
 * en las demás. Va dentro de una lista con `border-b border-borde`. Sirve igual
 * para enlaces (`aria-current="page"`) y para `role="tab"` (`aria-selected`).
 */
export function clasePestana(actual: boolean): string {
  return `-mb-px inline-flex min-h-11 items-center gap-2 whitespace-nowrap rounded-t-control border-b-2 px-3 text-sm transition-colors duration-150 ${CLASE_FOCO} ${
    actual
      ? "border-primario font-semibold text-primario-oscuro"
      : "border-transparent font-medium text-texto-secundario hover:border-borde-control hover:bg-white hover:text-texto"
  }`;
}
