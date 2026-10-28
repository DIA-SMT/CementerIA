import { describe, expect, it } from "vitest";
import { CEMENTERIOS } from "../../../../prisma/semilla/cementerios";
import { SECCIONES_ADMIN, puedeVerPantalla } from "../navegacion";
import { leerCamposUbicacion } from "../expedientes/ubicacion";
import { controlarCamposUbicacion } from "./catalogos";

// 2.13(d): una clave de ubicación con valores en expedientes no se renombra, no
// se borra y no cambia de tipo; se desactiva.

const OESTE = leerCamposUbicacion(CEMENTERIOS.find((c) => c.codigo === "OESTE")?.camposUbicacion, "Oeste");
const USADAS = new Map([
  ["seccion", 12],
  ["lote", 12],
]);

describe("controlarCamposUbicacion", () => {
  it("desactivar una clave usada y agregar una nueva está bien", () => {
    const nuevos = [...OESTE.map((c) => (c.clave === "lote" ? { ...c, activo: false } : c)), { clave: "fila", etiqueta: "Fila", tipo: "entero", obligatorio: false, patron: "", activo: true, ayuda: "" }];
    const r = controlarCamposUbicacion(nuevos, OESTE, USADAS);
    expect(r.errores).toEqual([]);
    expect(r.campos.at(-1)).toEqual({ clave: "fila", etiqueta: "Fila", tipo: "entero", obligatorio: false, patron: null, activo: true, ayuda: null });
    expect(r.campos.find((c) => c.clave === "lote")?.activo).toBe(false);
  });

  it("borrar o renombrar una clave usada se rechaza con cuántos expedientes la tienen", () => {
    const renombrada = OESTE.map((c) => (c.clave === "seccion" ? { ...c, clave: "sector" } : c));
    const r = controlarCamposUbicacion(renombrada, OESTE, USADAS);
    expect(r.errores).toEqual([{ ruta: "camposUbicacion", mensaje: expect.stringContaining("La clave seccion") }]);
    expect(r.errores[0].mensaje).toContain("12 expedientes");
    expect(controlarCamposUbicacion(OESTE.filter((c) => c.clave !== "lote"), OESTE, USADAS).errores).toHaveLength(1);
    // Una clave sin valores sí se puede quitar.
    expect(controlarCamposUbicacion(OESTE.filter((c) => c.clave !== "lote"), OESTE, new Map([["seccion", 1]])).errores).toEqual([]);
  });

  it("cambiar el tipo de una clave usada, claves repetidas, patrones que no compilan y claves inválidas", () => {
    const i = OESTE.findIndex((c) => c.clave === "lote");
    const r = controlarCamposUbicacion(
      [...OESTE.map((c) => (c.clave === "lote" ? { ...c, tipo: c.tipo === "entero" ? "texto" : "entero" } : c)), { ...OESTE[0] }, { clave: "Mal Clave", etiqueta: "", tipo: "texto", obligatorio: false, patron: "[", activo: true }],
      OESTE,
      USADAS,
    );
    const rutas = r.errores.map((e) => e.ruta);
    expect(rutas).toContain(`camposUbicacion[${i}].tipo`);
    expect(rutas).toContain(`camposUbicacion[${OESTE.length}].clave`);
    expect(rutas).toContain(`camposUbicacion[${OESTE.length + 1}].clave`);
    const patron = controlarCamposUbicacion([{ clave: "x", etiqueta: "X", tipo: "texto", obligatorio: false, patron: "[", activo: true }], [], new Map());
    expect(patron.errores).toEqual([{ ruta: "camposUbicacion[0].patron", mensaje: "No es una expresión regular válida" }]);
  });
});

describe("Administración en la navegación (sección 5)", () => {
  it("las cinco secciones, solo para el admin; el Sitio público, también para Dirección", () => {
    expect(SECCIONES_ADMIN.map((s) => s.etiqueta)).toEqual(["Plantillas", "Usuarios", "Catálogos", "Auditoría", "Sitio público"]);
    expect(puedeVerPantalla({ id: 1, rol: "admin", activo: true, area: null }, "admin")).toBe(true);
    expect(puedeVerPantalla({ id: 2, rol: "lectura", activo: true, area: { id: 1, codigo: "DIRECCION" } }, "admin")).toBe(false);
    expect(puedeVerPantalla({ id: 3, rol: "operador", activo: true, area: { id: 2, codigo: "MESA_ENTRADAS" } }, "admin")).toBe(false);
    expect(puedeVerPantalla({ id: 1, rol: "admin", activo: true, area: null }, "sitio_publico")).toBe(true);
    expect(puedeVerPantalla({ id: 2, rol: "lectura", activo: true, area: { id: 1, codigo: "DIRECCION" } }, "sitio_publico")).toBe(true);
    expect(puedeVerPantalla({ id: 3, rol: "operador", activo: true, area: { id: 2, codigo: "MESA_ENTRADAS" } }, "sitio_publico")).toBe(false);
  });
});
