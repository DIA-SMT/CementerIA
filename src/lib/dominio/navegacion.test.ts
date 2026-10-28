import { describe, expect, it } from "vitest";
import { inicioPara, navegacionPara, puedeVerPantalla, type Pantalla } from "./navegacion";
import type { UsuarioPermisos } from "./permisos";

function usuario(rol: UsuarioPermisos["rol"], codigoArea: string | null, activo = true): UsuarioPermisos {
  return { id: 10, rol, activo, area: codigoArea ? { id: 1, codigo: codigoArea } : null };
}

const etiquetas = (u: UsuarioPermisos) => navegacionPara(u).map((item) => item.etiqueta);

describe("navegacionPara (sección 5)", () => {
  it("Mesa de Entradas: Bandeja · Nuevo expediente · Buscar · Panel", () => {
    expect(etiquetas(usuario("operador", "MESA_ENTRADAS"))).toEqual(["Bandeja", "Nuevo expediente", "Buscar", "Panel"]);
  });

  it.each(["COMPUTO", "LIQUIDACION", "LEGAL", "ADMINISTRATIVO", "TRIBUTARIO"])(
    "%s: Bandeja · Buscar · Panel",
    (area) => {
      expect(etiquetas(usuario("operador", area))).toEqual(["Bandeja", "Buscar", "Panel"]);
    },
  );

  it("Dirección: Panel · Métricas · Buscar · Sitio público", () => {
    expect(etiquetas(usuario("lectura", "DIRECCION"))).toEqual(["Panel", "Métricas", "Buscar", "Sitio público"]);
  });

  it("otro usuario de lectura: Panel · Buscar (sin Métricas)", () => {
    expect(etiquetas(usuario("lectura", "LEGAL"))).toEqual(["Panel", "Buscar"]);
  });

  it("Admin: Panel · Métricas · Buscar · Administración", () => {
    expect(etiquetas(usuario("admin", null))).toEqual(["Panel", "Métricas", "Buscar", "Administración"]);
  });

  it("cada ítem del menú es una pantalla que ese usuario puede ver", () => {
    const pantallas: Record<string, Pantalla> = {
      "/bandeja": "bandeja",
      "/expedientes/nuevo": "expedientes_nuevo",
      "/expedientes": "expedientes",
      "/panel": "panel",
      "/panel/metricas": "metricas",
      "/admin": "admin",
    };
    for (const u of [
      usuario("operador", "MESA_ENTRADAS"),
      usuario("operador", "COMPUTO"),
      usuario("lectura", "DIRECCION"),
      usuario("admin", null),
    ]) {
      for (const item of navegacionPara(u)) {
        expect(puedeVerPantalla(u, pantallas[item.href] ?? item.pantalla), `${u.rol} ${item.href}`).toBe(true);
      }
    }
  });
});

describe("inicioPara", () => {
  it("operadores a la bandeja; Dirección y admin al panel", () => {
    expect(inicioPara(usuario("operador", "COMPUTO"))).toBe("/bandeja");
    expect(inicioPara(usuario("operador", "MESA_ENTRADAS"))).toBe("/bandeja");
    expect(inicioPara(usuario("lectura", "DIRECCION"))).toBe("/panel");
    expect(inicioPara(usuario("admin", null))).toBe("/panel");
  });

  it("el inicio de cada uno es una pantalla que puede ver (no hay redirecciones en círculo)", () => {
    for (const u of [usuario("operador", "LEGAL"), usuario("lectura", "DIRECCION"), usuario("admin", null)]) {
      const pantalla = inicioPara(u) === "/bandeja" ? "bandeja" : "panel";
      expect(puedeVerPantalla(u, pantalla)).toBe(true);
    }
  });
});

describe("puedeVerPantalla", () => {
  it("la bandeja es solo de operadores", () => {
    expect(puedeVerPantalla(usuario("operador", "LEGAL"), "bandeja")).toBe(true);
    expect(puedeVerPantalla(usuario("lectura", "DIRECCION"), "bandeja")).toBe(false);
    expect(puedeVerPantalla(usuario("admin", null), "bandeja")).toBe(false);
  });

  it("el alta es de Mesa de Entradas y del admin", () => {
    expect(puedeVerPantalla(usuario("operador", "MESA_ENTRADAS"), "expedientes_nuevo")).toBe(true);
    expect(puedeVerPantalla(usuario("admin", null), "expedientes_nuevo")).toBe(true);
    expect(puedeVerPantalla(usuario("operador", "COMPUTO"), "expedientes_nuevo")).toBe(false);
  });

  it("Administración es solo del admin", () => {
    expect(puedeVerPantalla(usuario("admin", null), "admin")).toBe(true);
    expect(puedeVerPantalla(usuario("operador", "MESA_ENTRADAS"), "admin")).toBe(false);
    expect(puedeVerPantalla(usuario("lectura", "DIRECCION"), "admin")).toBe(false);
  });

  it("Métricas es de Dirección y del admin", () => {
    expect(puedeVerPantalla(usuario("lectura", "DIRECCION"), "metricas")).toBe(true);
    expect(puedeVerPantalla(usuario("admin", null), "metricas")).toBe(true);
    expect(puedeVerPantalla(usuario("operador", "MESA_ENTRADAS"), "metricas")).toBe(false);
    expect(puedeVerPantalla(usuario("operador", "COMPUTO"), "metricas")).toBe(false);
  });

  it("un inactivo no ve nada", () => {
    expect(puedeVerPantalla(usuario("admin", null, false), "panel")).toBe(false);
  });
});
