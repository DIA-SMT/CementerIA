import { describe, expect, it } from "vitest";
import { AREAS } from "../../../prisma/semilla/areas";
import { TIPOS_MONUMENTO } from "../../../prisma/semilla/catalogos";
import { CEMENTERIOS } from "../../../prisma/semilla/cementerios";
import { RENOV_CONTADO } from "../../../prisma/semilla/plantillas/renov-contado";
import { RENOV_PLAN } from "../../../prisma/semilla/plantillas/renov-plan";
import { definicionEditable, definicionInicial } from "../dominio/plantillas/borrador";
import { validarPublicacion } from "../dominio/plantillas/validar";
import {
  activarPlazo,
  agregarCampoExtra,
  agregarDocumento,
  agregarPaso,
  agregarPersona,
  agregarSubtarea,
  cambiarCampoExtra,
  cambiarPaso,
  cambiarSubtarea,
  claveLibre,
  clavesUsadas,
  erroresDentroDe,
  erroresPorPestana,
  filtroConCementerio,
  filtroConModo,
  indiceDePaso,
  modoFiltro,
  mover,
  moverPaso,
  moverSubtarea,
  normalizarClave,
  opcionesDesdeTexto,
  pestanaDeRuta,
  quitarPaso,
  renombrarClave,
  rutasAncestras,
  ubicacionDeRuta,
  vistaPrevia,
  type AreaEditor,
  type CementerioEditor,
} from "./editor-plantilla";

// El editor de plantillas (semana 5) sobre las plantillas reales de la semilla:
// lo que hace cada botón sobre la definición y cómo cada error de validar.ts
// llega a su pestaña y a su campo.

const AREAS_EDITOR: AreaEditor[] = AREAS.map((a) => ({ codigo: a.codigo, nombre: a.nombre, tipo: a.tipo, activa: true, recibePases: a.recibePases }));
const CATALOGOS = {
  areas: AREAS.map((a) => ({ ...a, activa: true })),
  tiposMonumento: TIPOS_MONUMENTO.map((t) => ({ ...t, activo: true })),
  cementerios: CEMENTERIOS.map((c) => ({ codigo: c.codigo, activo: true })),
};
const CEMENTERIO = (codigo: string): CementerioEditor => {
  const c = CEMENTERIOS.find((x) => x.codigo === codigo);
  if (!c) throw new Error(codigo);
  return { codigo: c.codigo, nombre: c.nombre, activo: true, area: AREAS.find((a) => a.codigo === c.area)?.nombre ?? c.area, tiposMonumento: [...c.tiposMonumento] };
};

const errores = (d: unknown) => {
  const r = validarPublicacion(d, CATALOGOS);
  return r.ok ? [] : r.errores;
};

describe("pasos", () => {
  it("moverPaso sube y baja; en los bordes no cambia nada", () => {
    const d = moverPaso(RENOV_CONTADO, 2, -1);
    expect(d.pasos.map((p) => p.clave).slice(0, 4)).toEqual(["MESA", "LIQUIDACION", "COMPUTO_ALTA", "LEGAL"]);
    expect(moverPaso(d, 1, 1).pasos).toEqual(RENOV_CONTADO.pasos);
    expect(moverPaso(RENOV_CONTADO, 0, -1).pasos).toEqual(RENOV_CONTADO.pasos);
    expect(moverPaso(RENOV_CONTADO, RENOV_CONTADO.pasos.length - 1, 1).pasos).toEqual(RENOV_CONTADO.pasos);
    // No muta la original.
    expect(RENOV_CONTADO.pasos[1].clave).toBe("COMPUTO_ALTA");
  });

  it("mover un paso interno al final mantiene la plantilla válida; uno externo al final da el error del último paso", () => {
    expect(errores(moverPaso(RENOV_CONTADO, 0, 0))).toEqual([]);
    const conDim = RENOV_PLAN.pasos.findIndex((p) => p.area === "DIM");
    let d = RENOV_PLAN;
    for (let i = conDim; i < d.pasos.length - 1; i += 1) d = moverPaso(d, i, 1);
    const e = errores(d);
    expect(e.some((x) => x.regla === "ultimo_paso" && x.ruta === `pasos[${d.pasos.length - 1}].area`)).toBe(true);
  });

  it("agregarPaso usa una clave libre, y la plantilla nueva arranca sin pasos", () => {
    const inicial = definicionInicial();
    expect(errores(inicial)).toEqual([{ regla: "esquema", ruta: "pasos", mensaje: "La plantilla tiene que tener al menos un paso" }]);
    const d = agregarPaso(agregarPaso(inicial));
    expect(d.pasos.map((p) => p.clave)).toEqual(["PASO_1", "PASO_2"]);
    expect(quitarPaso(d, 0).pasos.map((p) => p.clave)).toEqual(["PASO_2"]);
  });

  it("elegir un área interna vacía la custodia; una externa o un comodín la piden", () => {
    const i = RENOV_PLAN.pasos.findIndex((p) => p.area === "DIM");
    expect(RENOV_PLAN.pasos[i].custodia).toBe("TRIBUTARIO");
    const d = cambiarPaso(RENOV_PLAN, i, { area: "LEGAL" }, AREAS_EDITOR);
    expect(d.pasos[i].custodia).toBeNull();
    const e = cambiarPaso(cambiarPaso(d, i, { area: "$CEMENTERIO" }, AREAS_EDITOR), i, {}, AREAS_EDITOR);
    expect(e.pasos[i].custodia).toBeNull();
    expect(errores(e).find((x) => x.ruta === `pasos[${i}].custodia`)?.regla).toBe("custodia");
  });

  it("activar el plazo propone la primera subtarea con fecha y la última del paso", () => {
    const i = RENOV_CONTADO.pasos.findIndex((p) => p.clave === "LIQUIDACION");
    const d = activarPlazo(RENOV_CONTADO, i, true);
    const p = d.pasos[i];
    expect(p.plazo).toEqual({ dias_habiles: 30, desde_subtarea: p.subtareas.find((s) => s.dato === "fecha")?.clave ?? "", hasta_subtarea: p.subtareas.at(-1)?.clave });
    expect(activarPlazo(d, i, false).pasos[i].plazo).toBeNull();
  });
});

describe("subtareas", () => {
  it("agregarSubtarea crea una clave que no se usa en toda la plantilla", () => {
    const i = RENOV_CONTADO.pasos.findIndex((p) => p.clave === "LEGAL");
    const d = agregarSubtarea(agregarSubtarea(RENOV_CONTADO, i), i);
    const nuevas = d.pasos[i].subtareas.slice(-2);
    expect(nuevas.map((s) => s.clave)).toEqual(["LEGAL_1", "LEGAL_2"]);
    expect(nuevas[0]).toMatchObject({ nombre: "", obligatoria: true, dato: null, dato_obligatorio: false, solo_cementerios: null, excepto_cementerios: null });
    // Sin nombre no se puede publicar: el error va al campo de la subtarea.
    const e = errores(d);
    expect(e.map((x) => x.ruta)).toContain(`pasos[${i}].subtareas[${d.pasos[i].subtareas.length - 2}].nombre`);
    // Con nombre, pasa.
    const conNombre = cambiarSubtarea(cambiarSubtarea(d, i, d.pasos[i].subtareas.length - 2, { nombre: "Dictamen notificado" }), i, d.pasos[i].subtareas.length - 1, { nombre: "Visto bueno" });
    expect(errores(conNombre)).toEqual([]);
  });

  it("quitar el dato desmarca 'dato obligatorio' (validar.ts lo rechazaría)", () => {
    const i = RENOV_CONTADO.pasos.findIndex((p) => p.subtareas.some((s) => s.dato_obligatorio));
    const j = RENOV_CONTADO.pasos[i].subtareas.findIndex((s) => s.dato_obligatorio);
    expect(cambiarSubtarea(RENOV_CONTADO, i, j, { dato: null }).pasos[i].subtareas[j]).toMatchObject({ dato: null, dato_obligatorio: false });
  });

  it("moverSubtarea dentro de su paso", () => {
    const i = RENOV_CONTADO.pasos.findIndex((p) => p.subtareas.length >= 2);
    const antes = RENOV_CONTADO.pasos[i].subtareas.map((s) => s.clave);
    const d = moverSubtarea(RENOV_CONTADO, i, 1, -1);
    expect(d.pasos[i].subtareas.map((s) => s.clave)).toEqual([antes[1], antes[0], ...antes.slice(2)]);
    expect(d.pasos.filter((_, k) => k !== i)).toEqual(RENOV_CONTADO.pasos.filter((_, k) => k !== i));
  });
});

describe("claves únicas", () => {
  it("clavesUsadas junta pasos, subtareas, documentos, conceptos y campos extra", () => {
    const usadas = clavesUsadas(RENOV_CONTADO);
    for (const c of ["MESA", "LIQ_PAGO", "DNI", "DERECHO_OFICINA", "concesion_hasta"]) expect(usadas.has(c)).toBe(true);
    expect(claveLibre(RENOV_CONTADO, "DOC")).toBe("DOC_1");
  });

  it("normalizarClave: sin acentos ni espacios, en mayúsculas o minúsculas", () => {
    expect(normalizarClave(" Liquidación final ", false)).toBe("LIQUIDACION_FINAL");
    expect(normalizarClave("Cementerio de destino", true)).toBe("cementerio_de_destino");
    expect(normalizarClave("año-2", false)).toBe("ANO_2");
  });

  it("renombrar un paso arrastra documentos, campos extra y conceptos que lo nombran", () => {
    const i = RENOV_CONTADO.pasos.findIndex((p) => p.clave === "MESA");
    const r = renombrarClave(RENOV_CONTADO, { tipo: "paso", paso: i }, "mesa entrada");
    if (!r.ok) throw new Error(r.mensaje);
    expect(r.clave).toBe("MESA_ENTRADA");
    expect(r.def.documentos.filter((d) => d.exigir_al_salir_de === "MESA")).toEqual([]);
    expect(r.def.documentos.filter((d) => d.exigir_al_salir_de === "MESA_ENTRADA").length).toBe(RENOV_CONTADO.documentos.filter((d) => d.exigir_al_salir_de === "MESA").length);
    expect(errores(r.def)).toEqual([]);
  });

  it("renombrar una subtarea arrastra el plazo; un campo de cementerio arrastra $CAMPO; un rol arrastra solo_si_juridica", () => {
    const iDim = RENOV_PLAN.pasos.findIndex((p) => p.plazo !== null);
    const desde = RENOV_PLAN.pasos[iDim].plazo?.desde_subtarea ?? "";
    const iDesde = RENOV_PLAN.pasos.findIndex((p) => p.subtareas.some((s) => s.clave === desde));
    const jDesde = RENOV_PLAN.pasos[iDesde].subtareas.findIndex((s) => s.clave === desde);
    const r = renombrarClave(RENOV_PLAN, { tipo: "subtarea", paso: iDesde, subtarea: jDesde }, "NOTIFICADA_EL");
    if (!r.ok) throw new Error(r.mensaje);
    expect(r.def.pasos[iDim].plazo?.desde_subtarea).toBe("NOTIFICADA_EL");
    expect(errores(r.def)).toEqual([]);

    let d = agregarCampoExtra(RENOV_CONTADO);
    const k = d.campos_extra.length - 1;
    d = cambiarCampoExtra(d, k, { tipo: "cementerio", etiqueta: "Cementerio de destino" });
    d = cambiarPaso(d, 0, {});
    d = { ...d, pasos: d.pasos.map((p, n) => (n === 1 ? { ...p, area: `$CAMPO:${d.campos_extra[k].clave}`, custodia: "MESA_ENTRADAS" } : p)) };
    const c = renombrarClave(d, { tipo: "campo", indice: k }, "Cementerio_Destino");
    if (!c.ok) throw new Error(c.mensaje);
    expect(c.def.pasos[1].area).toBe("$CAMPO:cementerio_destino");

    const titular = RENOV_CONTADO.personas.findIndex((p) => p.rol === "titular");
    const t = renombrarClave(RENOV_CONTADO, { tipo: "rol", indice: titular }, "concesionario");
    if (!t.ok) throw new Error(t.mensaje);
    expect(t.def.documentos.filter((x) => x.solo_si_juridica !== null).every((x) => x.solo_si_juridica === "concesionario")).toBe(true);
  });

  it("una clave que ya usa otro elemento (de cualquier tipo) se rechaza y no cambia nada", () => {
    const i = RENOV_CONTADO.pasos.findIndex((p) => p.clave === "LEGAL");
    const r = renombrarClave(RENOV_CONTADO, { tipo: "paso", paso: i }, "dni");
    expect(r).toEqual({ ok: false, mensaje: expect.stringContaining("La clave DNI ya la usa un documento") });
    const d = agregarDocumento(RENOV_CONTADO);
    const doc = renombrarClave(d, { tipo: "documento", indice: d.documentos.length - 1 }, "LIQ_PAGO");
    expect(doc.ok).toBe(false);
    const p = agregarPersona(RENOV_CONTADO);
    expect(p.personas.at(-1)?.rol).toBe("rol_a");
    expect(renombrarClave(p, { tipo: "rol", indice: p.personas.length - 1 }, "titular").ok).toBe(false);
  });
});

describe("errores por pestaña", () => {
  it("cada ruta va a su pestaña", () => {
    expect(pestanaDeRuta("pasos[6].custodia")).toBe("pasos");
    expect(pestanaDeRuta("pasos")).toBe("pasos");
    expect(pestanaDeRuta("personas[1]")).toBe("personas");
    expect(pestanaDeRuta("documentos[0].solo_cementerios[1]")).toBe("documentacion");
    expect(pestanaDeRuta("conceptos[2].paso")).toBe("conceptos");
    expect(pestanaDeRuta("campos_extra[0].opciones")).toBe("campos_extra");
    expect(pestanaDeRuta("tipos_monumento[0]")).toBe("general");
    expect(pestanaDeRuta("nombre")).toBe("general");
    expect(pestanaDeRuta("")).toBe("general");
  });

  it("los errores reales de validar.ts se cuentan en su pestaña y en su elemento", () => {
    let d = definicionEditable(RENOV_CONTADO);
    d = cambiarPaso(d, 3, { custodia: "COMPUTO" }, AREAS_EDITOR); // interna con custodia
    d = { ...d, documentos: d.documentos.map((x, i) => (i === 0 ? { ...x, exigir_al_salir_de: "NO_EXISTE" } : x)) };
    d = { ...d, personas: d.personas.map((p, i) => (i === 1 ? { ...p, min: 3, max: 1 } : p)) };
    d = { ...d, tipos_monumento: [...d.tipos_monumento, "INEXISTENTE"] };
    const e = errores(d);
    expect(erroresPorPestana(e)).toMatchObject({ general: 1, personas: 1, pasos: 1, documentacion: 1, conceptos: 0, campos_extra: 0, vista_previa: 0 });
    expect(erroresDentroDe(e, "pasos[3]")).toBe(1);
    expect(erroresDentroDe(e, "pasos[2]")).toBe(0);
  });

  it("ubicacionDeRuta dice en palabras dónde está el error (los mensajes del esquema no lo dicen)", () => {
    expect(ubicacionDeRuta("pasos[0].subtareas[0].nombre", RENOV_CONTADO)).toBe("Paso 1 (Mesa de Entradas), subtarea 1 (Carátula impresa y agregada al expediente): nombre");
    expect(ubicacionDeRuta("pasos[2].plazo.desde_subtarea", RENOV_CONTADO)).toBe("Paso 3 (Liquidación y boleta): plazo, inicio");
    expect(ubicacionDeRuta("documentos[0].solo_cementerios[1]", RENOV_CONTADO)).toMatch(/^Documento 1 \(.+\): cementerios$/);
    expect(ubicacionDeRuta("personas[1]", RENOV_CONTADO)).toBe("Rol 2 (Solicitante)");
    expect(ubicacionDeRuta("tipos_monumento[3]", RENOV_CONTADO)).toBe("Tipos de monumento");
    expect(ubicacionDeRuta("pasos", RENOV_CONTADO)).toBe("Pasos");
    expect(ubicacionDeRuta("documentos", RENOV_CONTADO)).toBe("Documentación");
    expect(ubicacionDeRuta("nombre", RENOV_CONTADO)).toBe("Nombre del trámite");
    expect(ubicacionDeRuta("", RENOV_CONTADO)).toBe("La plantilla");
  });

  it("rutasAncestras va del campo al elemento y a la lista; indiceDePaso abre el paso", () => {
    expect(rutasAncestras("pasos[2].plazo.desde_subtarea")).toEqual(["pasos[2].plazo.desde_subtarea", "pasos[2].plazo", "pasos[2]", "pasos"]);
    expect(rutasAncestras("personas")).toEqual(["personas"]);
    expect(indiceDePaso("pasos[12].subtareas[0].clave")).toBe(12);
    expect(indiceDePaso("documentos[1]")).toBeNull();
  });
});

describe("campos extra, filtros y vista previa", () => {
  it("pasar a opción agrega la lista de opciones; salir de opción la quita", () => {
    let d = agregarCampoExtra(RENOV_CONTADO);
    const k = d.campos_extra.length - 1;
    expect(d.campos_extra[k].clave).toBe("campo_1");
    d = cambiarCampoExtra(d, k, { tipo: "opcion" });
    expect(d.campos_extra[k].opciones).toEqual([]);
    d = cambiarCampoExtra(d, k, { opciones: opcionesDesdeTexto("Inhumación\n\n Exhumación \n") });
    expect(d.campos_extra[k].opciones).toEqual(["Inhumación", "Exhumación"]);
    expect(cambiarCampoExtra(d, k, { tipo: "texto" }).campos_extra[k].opciones).toBeNull();
  });

  it("el filtro por cementerio cambia de modo sin perder los marcados", () => {
    let f = filtroConModo({ solo_cementerios: null, excepto_cementerios: null }, "solo");
    expect(f).toEqual({ solo_cementerios: [], excepto_cementerios: null });
    f = filtroConCementerio(filtroConCementerio(f, "OESTE", true), "JARDIN_NORTE", true);
    expect(filtroConModo(f, "excepto")).toEqual({ solo_cementerios: null, excepto_cementerios: ["OESTE", "JARDIN_NORTE"] });
    expect(modoFiltro(filtroConModo(f, "todos"))).toBe("todos");
    expect(filtroConCementerio(f, "OESTE", false)).toEqual({ solo_cementerios: ["JARDIN_NORTE"], excepto_cementerios: null });
  });

  it("la vista previa resuelve la plantilla por cementerio: Jardín sin inspección técnica, con sus monumentos", () => {
    const jardin = vistaPrevia(RENOV_CONTADO, CEMENTERIO("JARDIN_NORTE"), { areas: AREAS_EDITOR, tiposMonumento: [...TIPOS_MONUMENTO] });
    const oeste = vistaPrevia(RENOV_CONTADO, CEMENTERIO("OESTE"), { areas: AREAS_EDITOR, tiposMonumento: [...TIPOS_MONUMENTO] });
    expect(jardin.conceptos.map((c) => c.clave)).not.toContain("INSPECCION_TECNICA");
    expect(oeste.conceptos.map((c) => c.clave)).toContain("INSPECCION_TECNICA");
    expect(jardin.excluidos).toContain("Concepto: Inspección técnica");
    expect(jardin.monumentos).toHaveLength(1);
    expect(oeste.monumentos.length).toBeGreaterThan(1);
    expect(jardin.pasos.map((p) => p.clave)).toEqual(RENOV_CONTADO.pasos.map((p) => p.clave));
    expect(jardin.documentos.find((d) => d.clave === "PERSONERIA")?.soloSiJuridica).toBe("titular");
  });

  it("mover sobre listas sueltas (campos de ubicación de Catálogos)", () => {
    expect(mover(["a", "b", "c"], 2, -2)).toEqual(["c", "a", "b"]);
    expect(mover(["a"], 0, 1)).toEqual(["a"]);
  });
});
