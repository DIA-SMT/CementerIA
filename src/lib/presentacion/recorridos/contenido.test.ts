import { describe, expect, it } from "vitest";
import { BIENVENIDA, RECORRIDOS, recorridoDePantalla } from "./contenido";
import { anclasDe, PERFILES, resolverPasos, textoPara } from "./motor";

const TODOS = [BIENVENIDA, ...Object.values(RECORRIDOS)];

describe("contenido de los recorridos", () => {
  it.each(TODOS.map((r) => [r.id, r] as const))("%s: de 4 a 8 pasos, ids únicos y versión positiva", (_id, r) => {
    expect(r.pasos.length).toBeGreaterThanOrEqual(4);
    expect(r.pasos.length).toBeLessThanOrEqual(8);
    expect(new Set(r.pasos.map((p) => p.id)).size).toBe(r.pasos.length);
    expect(Number.isInteger(r.version) && r.version > 0).toBe(true);
    expect(r.nombre.trim()).not.toBe("");
  });

  it("el id de cada recorrido es su clave", () => {
    for (const [clave, r] of Object.entries(RECORRIDOS)) expect(r.id).toBe(clave);
  });

  it("las anclas son nombres simples (lo que va en data-recorrido)", () => {
    for (const r of TODOS) for (const p of r.pasos) for (const a of anclasDe(p)) expect(a).toMatch(/^[a-z0-9_-]+$/);
  });

  it("textos cortos y sin restos (cada perfil que ve un paso tiene título y texto)", () => {
    for (const r of TODOS) {
      for (const p of r.pasos) {
        for (const perfil of PERFILES) {
          const titulo = textoPara(p.titulo, perfil);
          const texto = textoPara(p.texto, perfil);
          if (titulo === null || texto === null) continue;
          expect(titulo.length, `${r.id}/${p.id}`).toBeLessThanOrEqual(60);
          expect(texto.length, `${r.id}/${p.id}`).toBeLessThanOrEqual(280);
          expect(texto).not.toMatch(/\s{2,}|TODO|undefined/);
        }
      }
    }
  });

  it("cada perfil ve al menos un paso de la bienvenida y de su pantalla de inicio", () => {
    for (const perfil of PERFILES) expect(resolverPasos(BIENVENIDA, perfil, () => true).length).toBeGreaterThanOrEqual(4);
    expect(resolverPasos(RECORRIDOS.bandeja, "operador", () => true).length).toBeGreaterThanOrEqual(4);
    expect(resolverPasos(RECORRIDOS.panel, "direccion", () => true).length).toBeGreaterThanOrEqual(4);
  });

  it("textos por rol: la bienvenida nombra los módulos de cada uno", () => {
    const modulos = BIENVENIDA.pasos.find((p) => p.id === "modulos")!;
    expect(textoPara(modulos.texto, "mesa")).toContain("Nuevo expediente");
    expect(textoPara(modulos.texto, "operador")).not.toContain("Nuevo expediente");
    expect(textoPara(modulos.texto, "direccion")).toContain("Métricas");
    expect(textoPara(modulos.texto, "admin")).toContain("Administración");
  });

  it("los pasos de la bienvenida que son solo de operadores no tienen texto para Dirección", () => {
    // Dirección no tiene bandeja; los avisos y "Por confirmar" de la bienvenida son de los operadores.
    const avisos = BIENVENIDA.pasos.find((p) => p.id === "avisos")!;
    expect(textoPara(avisos.texto, "direccion")).toBeNull();
    expect(textoPara(avisos.texto, "mesa")).not.toBeNull();
  });

  it("una pantalla sin recorrido propio usa la bienvenida", () => {
    expect(recorridoDePantalla(null)).toBe(BIENVENIDA);
    expect(recorridoDePantalla("no-existe")).toBe(BIENVENIDA);
    expect(recorridoDePantalla("toString")).toBe(BIENVENIDA);
    expect(recorridoDePantalla("ficha")).toBe(RECORRIDOS.ficha);
  });
});
