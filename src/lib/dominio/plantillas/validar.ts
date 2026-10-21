import {
  analizarDefinicion,
  destinoDePaso,
  type DefinicionPlantilla,
  type ErrorPlantilla,
  type FiltroCementerios,
  type ResultadoDefinicion,
} from "./esquema";

/**
 * Integridad interna de una plantilla: lo que "Publicar" exige además del
 * esquema (docs/propuesta-mvp.md, 2.13(a)). La definición es JSONB sin claves
 * foráneas y se congela al publicarse: un error que pase acá queda en todos los
 * expedientes de esa versión, así que se controla todo antes.
 *
 * Funciones puras: los catálogos los lee quien llama, dentro de la misma
 * transacción que publica.
 */

/** Lo que hace falta de cada área. Una fila de Prisma (`Area`) sirve tal cual. */
export interface AreaCatalogo {
  codigo: string;
  /** `interna` o `externa`. */
  tipo: string;
  activa: boolean;
  recibePases: boolean;
}

/** Una fila de Prisma (`TipoMonumento`) sirve tal cual. */
export interface TipoMonumentoCatalogo {
  codigo: string;
  activo: boolean;
}

/** Una fila de Prisma (`Cementerio`) sirve tal cual. */
export interface CementerioCatalogo {
  codigo: string;
  activo: boolean;
}

export interface CatalogosPlantilla {
  areas: readonly AreaCatalogo[];
  tiposMonumento: readonly TipoMonumentoCatalogo[];
  /** Para los filtros `solo_cementerios` y `excepto_cementerios`. */
  cementerios: readonly CementerioCatalogo[];
}

/**
 * Reglas de 2.13(a), más las marcadas "además", que la propuesta no lista pero
 * sin las cuales la plantilla no se puede usar:
 * - `claves_unicas`: cada clave es única en toda la definición; además, roles de
 *   persona únicos.
 * - `areas`: las áreas de los pasos existen y están activas; además, reciben pases.
 * - `custodia`: interna (activa y que recibe pases) en todo paso externo o con
 *   comodín, y null en los internos.
 * - `referencias`: `exigir_al_salir_de` y `conceptos[].paso` apuntan a pasos.
 * - `plazo`: `desde_subtarea` es una subtarea con `dato: fecha` de ese paso o
 *   de uno anterior; `hasta_subtarea` existe y, además, es de ese mismo paso
 *   (las subtareas solo se tildan en el paso actual) y distinta de la de inicio.
 * - `campo_cementerio`: `$CAMPO:x` apunta a un campo extra de tipo `cementerio`.
 * - `opciones`: los campos `opcion` tienen opciones; además, los demás no, y no
 *   se repiten.
 * - `dias_alerta`: todo paso tiene `dias_alerta` (entero, 1 o más).
 * - `ultimo_paso`: el último paso es de un área interna.
 * - `tipos_monumento`: existen; además, activos y sin repetir.
 * - `personas` (además): min ≤ max, y si `requiere_contacto` hay algún rol que
 *   pueda estar vivo para ser el contacto; un rol que admite persona jurídica
 *   no puede ser siempre fallecido.
 * - `subtareas` (además): `dato_obligatorio` exige que la subtarea pida un dato.
 * - `cementerios` (semana 4): los filtros `solo_cementerios` y
 *   `excepto_cementerios` nombran cementerios que existen y están activos, sin
 *   repetir, y no van los dos juntos. Las subtareas del plazo de un paso no
 *   se filtran: en algún cementerio el plazo no tendría cómo empezar o cumplirse.
 * - `juridica` (semana 4): `solo_si_juridica` nombra un rol de la plantilla que
 *   admite persona jurídica.
 */
export type ReglaIntegridad =
  | "claves_unicas"
  | "areas"
  | "custodia"
  | "referencias"
  | "plazo"
  | "campo_cementerio"
  | "opciones"
  | "dias_alerta"
  | "ultimo_paso"
  | "tipos_monumento"
  | "personas"
  | "subtareas"
  | "cementerios"
  | "juridica";

export interface ErrorIntegridad extends ErrorPlantilla {
  regla: ReglaIntegridad;
}

/** Devuelve todos los errores (no corta en el primero): el editor los muestra juntos. */
export function validarIntegridad(def: DefinicionPlantilla, catalogos: CatalogosPlantilla): ErrorIntegridad[] {
  const errores: ErrorIntegridad[] = [];
  const error = (regla: ReglaIntegridad, ruta: string, mensaje: string): void => {
    errores.push({ regla, ruta, mensaje });
  };

  const areas = new Map(catalogos.areas.map((a) => [a.codigo, a]));
  const monumentos = new Map(catalogos.tiposMonumento.map((t) => [t.codigo, t]));
  const ordenDePaso = new Map(def.pasos.map((p, i) => [p.clave, i]));
  const campos = new Map(def.campos_extra.map((c) => [c.clave, c]));

  // --- Claves únicas en toda la definición -----------------------------------
  // Una sola tabla de claves: `items` del expediente y los movimientos las
  // nombran sin decir de qué tipo son.
  const vistas = new Map<string, string>();
  const registrarClave = (clave: string, ruta: string): void => {
    const anterior = vistas.get(clave);
    if (anterior !== undefined) {
      error("claves_unicas", ruta, `La clave "${clave}" está repetida (ya se usa en ${anterior})`);
    } else {
      vistas.set(clave, ruta);
    }
  };
  def.pasos.forEach((p, i) => {
    registrarClave(p.clave, `pasos[${i}]`);
    p.subtareas.forEach((s, j) => registrarClave(s.clave, `pasos[${i}].subtareas[${j}]`));
  });
  def.documentos.forEach((d, i) => registrarClave(d.clave, `documentos[${i}]`));
  def.conceptos.forEach((c, i) => registrarClave(c.clave, `conceptos[${i}]`));
  def.campos_extra.forEach((c, i) => registrarClave(c.clave, `campos_extra[${i}]`));

  const roles = new Set<string>();
  def.personas.forEach((p, i) => {
    if (roles.has(p.rol)) error("claves_unicas", `personas[${i}].rol`, `El rol "${p.rol}" está repetido`);
    roles.add(p.rol);
  });

  // --- Personas ----------------------------------------------------------------
  def.personas.forEach((p, i) => {
    if (p.min > p.max) {
      error("personas", `personas[${i}]`, `El rol "${p.rol}" tiene mínimo ${p.min} y máximo ${p.max}`);
    }
    if (p.admite_juridica && p.fallecido === "si") {
      error("personas", `personas[${i}].admite_juridica`, `El rol "${p.rol}" es siempre fallecido: no puede ser una persona jurídica`);
    }
  });

  // --- Filtros por cementerio y por persona jurídica -----------------------------
  const cementerios = new Map(catalogos.cementerios.map((c) => [c.codigo, c]));
  const controlarFiltro = (filtro: FiltroCementerios, ruta: string, que: string): void => {
    if (filtro.solo_cementerios !== null && filtro.excepto_cementerios !== null) {
      error("cementerios", ruta, `${que}: usá solo_cementerios o excepto_cementerios, no los dos`);
    }
    for (const campo of ["solo_cementerios", "excepto_cementerios"] as const) {
      const lista = filtro[campo];
      if (lista === null) continue;
      lista.forEach((codigo, j) => {
        const r = `${ruta}.${campo}[${j}]`;
        if (lista.indexOf(codigo) !== j) error("cementerios", r, `${que}: el cementerio ${codigo} está repetido`);
        const c = cementerios.get(codigo);
        if (!c) error("cementerios", r, `${que}: no existe el cementerio ${codigo}`);
        else if (!c.activo) error("cementerios", r, `${que}: el cementerio ${codigo} está inactivo`);
      });
    }
  };
  const rolesPlantilla = new Map(def.personas.map((p) => [p.rol, p]));
  def.documentos.forEach((d, i) => {
    controlarFiltro(d, `documentos[${i}]`, `El documento "${d.clave}"`);
    if (d.solo_si_juridica !== null) {
      const rol = rolesPlantilla.get(d.solo_si_juridica);
      if (!rol) {
        error("juridica", `documentos[${i}].solo_si_juridica`, `El documento "${d.clave}" depende del rol "${d.solo_si_juridica}", que la plantilla no tiene`);
      } else if (!rol.admite_juridica) {
        error("juridica", `documentos[${i}].solo_si_juridica`, `El documento "${d.clave}" depende de que "${rol.rol}" sea persona jurídica, pero ese rol no la admite`);
      }
    }
  });
  def.conceptos.forEach((c, i) => controlarFiltro(c, `conceptos[${i}]`, `El concepto "${c.clave}"`));
  def.pasos.forEach((p, i) => {
    p.subtareas.forEach((s, j) => controlarFiltro(s, `pasos[${i}].subtareas[${j}]`, `La subtarea "${s.clave}"`));
  });
  const filtradas = new Set(
    def.pasos.flatMap((p) => p.subtareas.filter((s) => s.solo_cementerios !== null || s.excepto_cementerios !== null).map((s) => s.clave)),
  );
  def.pasos.forEach((p, i) => {
    if (!p.plazo) return;
    for (const campo of ["desde_subtarea", "hasta_subtarea"] as const) {
      if (filtradas.has(p.plazo[campo])) {
        error("cementerios", `pasos[${i}].plazo.${campo}`, `El plazo del paso "${p.clave}" usa "${p.plazo[campo]}", que no está en todos los cementerios`);
      }
    }
  });
  if (def.requiere_contacto && !def.personas.some((p) => p.fallecido !== "si")) {
    error(
      "personas",
      "personas",
      "La plantilla exige un contacto, pero no tiene ningún rol de persona que pueda estar viva",
    );
  }

  // --- Tipos de monumento --------------------------------------------------------
  const monumentosVistos = new Set<string>();
  def.tipos_monumento.forEach((codigo, i) => {
    const ruta = `tipos_monumento[${i}]`;
    if (monumentosVistos.has(codigo)) error("tipos_monumento", ruta, `El tipo de monumento ${codigo} está repetido`);
    monumentosVistos.add(codigo);
    const tipo = monumentos.get(codigo);
    if (!tipo) error("tipos_monumento", ruta, `No existe el tipo de monumento ${codigo}`);
    else if (!tipo.activo) error("tipos_monumento", ruta, `El tipo de monumento ${codigo} está inactivo`);
  });

  // --- Campos extra ----------------------------------------------------------------
  def.campos_extra.forEach((c, i) => {
    const ruta = `campos_extra[${i}]`;
    if (c.tipo === "opcion") {
      if (c.opciones === null || c.opciones.length === 0) {
        error("opciones", `${ruta}.opciones`, `El campo "${c.clave}" es de tipo opción y no tiene opciones`);
      } else {
        const repetidas = c.opciones.filter((o, j) => c.opciones?.indexOf(o) !== j);
        if (repetidas.length > 0) {
          error("opciones", `${ruta}.opciones`, `El campo "${c.clave}" repite opciones: ${repetidas.join(", ")}`);
        }
      }
    } else if (c.opciones !== null) {
      error("opciones", `${ruta}.opciones`, `El campo "${c.clave}" es de tipo ${c.tipo}: no lleva opciones`);
    }
    if (c.exigir_al_salir_de !== null && !ordenDePaso.has(c.exigir_al_salir_de)) {
      error("referencias", `${ruta}.exigir_al_salir_de`, `El campo "${c.clave}" se exige al salir de "${c.exigir_al_salir_de}", que no es un paso de la plantilla`);
    }
  });

  // --- Documentos y conceptos ------------------------------------------------------
  def.documentos.forEach((d, i) => {
    if (d.exigir_al_salir_de !== null && !ordenDePaso.has(d.exigir_al_salir_de)) {
      error("referencias", `documentos[${i}].exigir_al_salir_de`, `El documento "${d.clave}" se exige al salir de "${d.exigir_al_salir_de}", que no es un paso de la plantilla`);
    }
  });
  def.conceptos.forEach((c, i) => {
    if (!ordenDePaso.has(c.paso)) {
      error("referencias", `conceptos[${i}].paso`, `El concepto "${c.clave}" se liquida en "${c.paso}", que no es un paso de la plantilla`);
    }
  });

  // --- Pasos -------------------------------------------------------------------------
  def.pasos.forEach((p, i) => {
    const ruta = `pasos[${i}]`;
    const destino = destinoDePaso(p.area);

    // Si el área no existe no se sabe si es externa: la custodia se controla
    // igual si viene, pero no se exige.
    let necesitaCustodia: boolean | null;
    if (destino.tipo === "area") {
      const area = areas.get(destino.codigo);
      if (!area) {
        error("areas", `${ruta}.area`, `El paso "${p.clave}" va al área ${destino.codigo}, que no existe`);
        necesitaCustodia = null;
      } else {
        if (!area.activa) error("areas", `${ruta}.area`, `El paso "${p.clave}" va al área ${area.codigo}, que está inactiva`);
        if (!area.recibePases) error("areas", `${ruta}.area`, `El paso "${p.clave}" va al área ${area.codigo}, que no recibe pases`);
        necesitaCustodia = area.tipo !== "interna";
      }
    } else {
      if (destino.tipo === "campo") {
        const campo = campos.get(destino.clave);
        if (!campo) {
          error("campo_cementerio", `${ruta}.area`, `El paso "${p.clave}" usa ${p.area}, pero no hay un campo extra "${destino.clave}"`);
        } else if (campo.tipo !== "cementerio") {
          error("campo_cementerio", `${ruta}.area`, `El paso "${p.clave}" usa ${p.area}, pero ese campo es de tipo ${campo.tipo} y no cementerio`);
        }
      }
      // Los comodines siempre resuelven a un área externa (la del cementerio).
      necesitaCustodia = true;
    }

    if (p.custodia === null) {
      if (necesitaCustodia === true) {
        error("custodia", `${ruta}.custodia`, `El paso "${p.clave}" va a un área externa (${p.area}) y no tiene custodia`);
      }
    } else {
      const custodia = areas.get(p.custodia);
      if (necesitaCustodia === false) {
        error("custodia", `${ruta}.custodia`, `El paso "${p.clave}" va a un área interna: la custodia tiene que quedar vacía`);
      }
      if (!custodia) {
        error("custodia", `${ruta}.custodia`, `La custodia del paso "${p.clave}" es ${p.custodia}, que no existe`);
      } else {
        if (custodia.tipo !== "interna") error("custodia", `${ruta}.custodia`, `La custodia del paso "${p.clave}" es ${custodia.codigo}, que no es un área interna`);
        if (!custodia.activa) error("custodia", `${ruta}.custodia`, `La custodia del paso "${p.clave}" es ${custodia.codigo}, que está inactiva`);
        if (!custodia.recibePases) error("custodia", `${ruta}.custodia`, `La custodia del paso "${p.clave}" es ${custodia.codigo}, que no recibe pases`);
      }
    }

    // El esquema ya lo exige; se repite porque la definición puede venir de la
    // base sin haber pasado por él (un borrador viejo, un script).
    if (!Number.isInteger(p.dias_alerta) || p.dias_alerta < 1) {
      error("dias_alerta", `${ruta}.dias_alerta`, `El paso "${p.clave}" no tiene días de alerta válidos (un entero, 1 o más)`);
    }

    p.subtareas.forEach((s, j) => {
      if (s.dato_obligatorio && s.dato === null) {
        error("subtareas", `${ruta}.subtareas[${j}]`, `La subtarea "${s.clave}" exige un dato pero no dice cuál (fecha o texto)`);
      }
    });

    if (p.plazo) {
      const { desde_subtarea: desde, hasta_subtarea: hasta } = p.plazo;
      const pasoDesde = def.pasos.findIndex((q) => q.subtareas.some((s) => s.clave === desde));
      const subDesde = pasoDesde >= 0 ? def.pasos[pasoDesde].subtareas.find((s) => s.clave === desde) : undefined;
      if (!subDesde) {
        error("plazo", `${ruta}.plazo.desde_subtarea`, `El plazo del paso "${p.clave}" empieza en "${desde}", que no es una subtarea de la plantilla`);
      } else if (pasoDesde > i) {
        error("plazo", `${ruta}.plazo.desde_subtarea`, `El plazo del paso "${p.clave}" empieza en "${desde}", que es de un paso posterior`);
      } else if (subDesde.dato !== "fecha") {
        error("plazo", `${ruta}.plazo.desde_subtarea`, `El plazo del paso "${p.clave}" empieza en "${desde}", que no pide una fecha`);
      }
      if (!p.subtareas.some((s) => s.clave === hasta)) {
        const existe = def.pasos.some((q) => q.subtareas.some((s) => s.clave === hasta));
        error(
          "plazo",
          `${ruta}.plazo.hasta_subtarea`,
          existe
            ? `El plazo del paso "${p.clave}" se cumple con "${hasta}", que es de otro paso: tiene que ser una subtarea de "${p.clave}"`
            : `El plazo del paso "${p.clave}" se cumple con "${hasta}", que no es una subtarea de la plantilla`,
        );
      }
      if (desde === hasta) {
        error("plazo", `${ruta}.plazo`, `El plazo del paso "${p.clave}" empieza y se cumple con la misma subtarea`);
      }
    }
  });

  // --- Último paso -------------------------------------------------------------------
  // Concluir lo hace el área responsable del paso final: tiene que tener usuarios.
  const ultimo = def.pasos.at(-1);
  if (!ultimo) {
    error("ultimo_paso", "pasos", "La plantilla no tiene pasos");
  } else {
    const destino = destinoDePaso(ultimo.area);
    const area = destino.tipo === "area" ? areas.get(destino.codigo) : undefined;
    if (destino.tipo !== "area" || (area && area.tipo !== "interna")) {
      error("ultimo_paso", `pasos[${def.pasos.length - 1}].area`, `El último paso ("${ultimo.clave}") tiene que ser de un área interna, no de ${ultimo.area}`);
    }
  }

  return errores;
}

/**
 * Todo lo que exige "Publicar": el esquema y, si la forma es válida, la
 * integridad. Con errores de forma no se corre la integridad: daría errores
 * derivados que confunden.
 */
export function validarPublicacion(valor: unknown, catalogos: CatalogosPlantilla): ResultadoDefinicion {
  const forma = analizarDefinicion(valor);
  if (!forma.ok) return forma;
  const errores = validarIntegridad(forma.definicion, catalogos);
  return errores.length === 0 ? forma : { ok: false, errores };
}
