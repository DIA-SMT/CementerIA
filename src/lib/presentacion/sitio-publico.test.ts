import { describe, expect, it } from "vitest";
import {
  hrefComoLlegar,
  hrefCorreo,
  hrefTelefono,
  INVITACIONES,
  NAVEGACION_PUBLICA,
  PAGINAS_PUBLICAS,
  parrafosDe,
  partesFechaRecorrido,
  tituloCementerios,
  type RutaInterna,
} from "./sitio-publico";

describe("página pública: presentación del contenido del sitio", () => {
  it("la barra: una página por sección, en orden, con la consulta destacada", () => {
    expect(NAVEGACION_PUBLICA.map((s) => s.ruta)).toEqual(["/cementerios", "/horarios", "/recorridos", "/tramites", "/consulta", "/contacto"]);
    expect(NAVEGACION_PUBLICA.map((s) => s.etiqueta)).toEqual(["Cementerios", "Horarios de visita", "Recorridos", "Trámites", "Consultá tu trámite", "Contacto"]);
    expect(NAVEGACION_PUBLICA.filter((s) => s.destacada).map((s) => s.etiqueta)).toEqual(["Consultá tu trámite"]);
    // Cada página tiene su título (el h1), distinto de los demás, y su bajada.
    const titulos = Object.values(PAGINAS_PUBLICAS).map((p) => p.titulo);
    expect(new Set(titulos).size).toBe(titulos.length);
    expect(PAGINAS_PUBLICAS["/recorridos"].titulo).toBe("Recorridos históricos");
    for (const p of Object.values(PAGINAS_PUBLICAS)) expect(p.bajada).toMatch(/.$/);
  });

  it("las invitaciones al pie: dos por página, a otras páginas, y no la misma franja en todas", () => {
    const rutas = Object.keys(PAGINAS_PUBLICAS) as RutaInterna[];
    expect(Object.keys(INVITACIONES).sort()).toEqual([...rutas].sort());
    for (const r of rutas) {
      const [a, b] = INVITACIONES[r];
      expect(a).not.toBe(r);
      expect(b).not.toBe(r);
      expect(a).not.toBe(b);
    }
    expect(new Set(rutas.map((r) => INVITACIONES[r].join())).size).toBe(rutas.length);
    // Cada página recibe al menos una invitación desde otra.
    expect(new Set(rutas.flatMap((r) => INVITACIONES[r])).size).toBe(rutas.length);
  });

  it("el título de cementerios según cuántos hay", () => {
    expect(tituloCementerios(3)).toBe("Tres cementerios municipales");
    expect(tituloCementerios(1)).toBe("El cementerio municipal");
    expect(tituloCementerios(0)).toBe("Los cementerios municipales");
    expect(tituloCementerios(12)).toBe("Los cementerios municipales");
  });

  it("una fecha de recorrido en hora de Tucumán (UTC−3), aunque en UTC ya sea otro día", () => {
    // 2026-11-15 01:30 UTC es el sábado 14 a las 22:30 en Tucumán.
    expect(partesFechaRecorrido(new Date("2026-11-15T01:30:00Z"))).toEqual({ dia: "14", mes: "nov", texto: "sábado 14 de noviembre, 22:30 h" });
  });

  it("los párrafos: separados por una línea en blanco", () => {
    expect(parrafosDe("Uno\ndos\n\nTres")).toEqual(["Uno\ndos", "Tres"]);
    expect(parrafosDe(null)).toEqual([]);
  });

  it("los enlaces de contacto", () => {
    expect(hrefTelefono("0381 400-0000 (dato de prueba)")).toBe("tel:03814000000");
    expect(hrefTelefono("+54 381 400 0000")).toBe("tel:+543814000000");
    expect(hrefTelefono("int. 12")).toBeNull();
    expect(hrefTelefono(null)).toBeNull();
    expect(hrefCorreo("mesa@smt.gob.ar")).toBe("mailto:mesa@smt.gob.ar");
    expect(hrefCorreo(null)).toBeNull();
  });

  it("«Cómo llegar»: el enlace cargado o la búsqueda del domicilio; sin domicilio, nada", () => {
    expect(hrefComoLlegar("Calle 1", "https://maps.app.goo.gl/x")).toBe("https://maps.app.goo.gl/x");
    expect(hrefComoLlegar("Av. Siempre Viva 742", null)).toBe("https://www.google.com/maps/search/?api=1&query=Av.%20Siempre%20Viva%20742");
    expect(hrefComoLlegar(null, "https://maps.app.goo.gl/x")).toBeNull();
  });
});
