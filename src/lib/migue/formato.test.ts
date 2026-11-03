import { describe, expect, it } from "vitest";
import { bloquesDe, trozosDe } from "./formato";

describe("el formato de las respuestas de Migue", () => {
  it("negrita, cursiva y código, sin los signos", () => {
    expect(trozosDe("Tocá **Dar pase** y después *Confirmar* en `Bandeja`.")).toEqual([
      { tipo: "texto", texto: "Tocá " },
      { tipo: "negrita", texto: "Dar pase" },
      { tipo: "texto", texto: " y después " },
      { tipo: "cursiva", texto: "Confirmar" },
      { tipo: "texto", texto: " en Bandeja." },
    ]);
    expect(trozosDe("__Ojo__: _importante_")).toEqual([
      { tipo: "negrita", texto: "Ojo" },
      { tipo: "texto", texto: ": " },
      { tipo: "cursiva", texto: "importante" },
    ]);
  });

  it("no toca los guiones bajos de una palabra ni deja asteriscos sueltos", () => {
    expect(trozosDe("la pestaña carga_historica")).toEqual([{ tipo: "texto", texto: "la pestaña carga_historica" }]);
    expect(trozosDe("**Plantillas sin cerrar")).toEqual([{ tipo: "texto", texto: "Plantillas sin cerrar" }]);
    expect(trozosDe("5 * 3 = 15")).toEqual([{ tipo: "texto", texto: "5 * 3 = 15" }]);
  });

  it("la respuesta de la captura: un párrafo y una lista con negritas", () => {
    const texto = [
      "Para manejar las plantillas, tenés que tener en cuenta lo siguiente:",
      "",
      "- **Plantillas de trámite**: Definen un trámite.",
      "",
      "- **Nueva plantilla**: Para crear un trámite nuevo.",
    ].join("\n");
    expect(bloquesDe(texto)).toEqual([
      { tipo: "parrafo", lineas: [[{ tipo: "texto", texto: "Para manejar las plantillas, tenés que tener en cuenta lo siguiente:" }]] },
      {
        tipo: "lista",
        ordenada: false,
        items: [
          [
            { tipo: "negrita", texto: "Plantillas de trámite" },
            { tipo: "texto", texto: ": Definen un trámite." },
          ],
          [
            { tipo: "negrita", texto: "Nueva plantilla" },
            { tipo: "texto", texto: ": Para crear un trámite nuevo." },
          ],
        ],
      },
    ]);
  });

  it("listas numeradas, títulos, citas, separadores y continuaciones", () => {
    const bloques = bloquesDe("### Cómo se hace\n1. Abrí la ficha\n2) Tocá Dar pase\n   y elegí el destino\n---\n> Listo.");
    expect(bloques).toEqual([
      { tipo: "titulo", trozos: [{ tipo: "texto", texto: "Cómo se hace" }] },
      {
        tipo: "lista",
        ordenada: true,
        items: [
          [{ tipo: "texto", texto: "Abrí la ficha" }],
          [
            { tipo: "texto", texto: "Tocá Dar pase" },
            { tipo: "texto", texto: " " },
            { tipo: "texto", texto: "y elegí el destino" },
          ],
        ],
      },
      { tipo: "parrafo", lineas: [[{ tipo: "texto", texto: "Listo." }]] },
    ]);
  });

  it("después de una lista con renglones en blanco, un párrafo la cierra", () => {
    expect(bloquesDe("- uno\n\n- dos\n\nY eso es todo.").map((b) => b.tipo)).toEqual(["lista", "parrafo"]);
    expect(bloquesDe("- uno\n\n1. dos").map((b) => b.tipo)).toEqual(["lista", "lista"]);
  });

  it("las líneas seguidas quedan en el mismo párrafo, con su salto", () => {
    expect(bloquesDe("Hola.\nTe cuento.")).toEqual([
      {
        tipo: "parrafo",
        lineas: [[{ tipo: "texto", texto: "Hola." }], [{ tipo: "texto", texto: "Te cuento." }]],
      },
    ]);
  });

  it("lo que parece HTML queda como texto (el chat nunca inserta HTML)", () => {
    expect(trozosDe("<b>hola</b>")).toEqual([{ tipo: "texto", texto: "<b>hola</b>" }]);
  });
});
