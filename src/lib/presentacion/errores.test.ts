import { describe, expect, it } from "vitest";
import { ErrorDominio } from "@/lib/dominio/expedientes/errores";
import { PermisoDenegado } from "@/lib/dominio/permisos";
import { erroresPorRuta, estadoDeError, idDeCampo, idDeError } from "./errores";

describe("estado de error de los formularios", () => {
  it("un ErrorDominio pasa con su código, su mensaje y sus errores por campo", () => {
    const e = new ErrorDominio("validacion", "Revisá los datos marcados", [{ ruta: "personas[0].dni", mensaje: "DNI: …" }]);
    expect(estadoDeError(e)).toEqual({ ok: false, codigo: "validacion", mensaje: "Revisá los datos marcados", errores: [{ ruta: "personas[0].dni", mensaje: "DNI: …" }] });
  });

  it("un permiso denegado se dice en castellano", () => {
    expect(estadoDeError(new PermisoDenegado("alta", "area_no_habilitada"))).toEqual({
      ok: false,
      codigo: "permiso",
      mensaje: "No podés hacer esto. Tu área no puede hacer esto.",
      errores: [],
    });
  });

  it("cualquier otro error es un defecto y sube", () => {
    expect(() => estadoDeError(new Error("se cayó la base"))).toThrow("se cayó la base");
  });
});

describe("errores junto al campo", () => {
  it("agrupa por ruta", () => {
    const m = erroresPorRuta([
      { ruta: "fechaInicio", mensaje: "a" },
      { ruta: "fechaInicio", mensaje: "b" },
      { ruta: "", mensaje: "c" },
    ]);
    expect(m.get("fechaInicio")).toEqual(["a", "b"]);
    expect(m.get("")).toEqual(["c"]);
  });

  it("ids válidos y estables a partir de la ruta", () => {
    expect(idDeCampo("personas[1].dni")).toBe("campo-personas-1-dni");
    expect(idDeCampo("ubicacion.lote")).toBe("campo-ubicacion-lote");
    expect(idDeCampo("")).toBe("campo-formulario");
    expect(idDeError("fechaInicio")).toBe("campo-fechaInicio-error");
  });
});
