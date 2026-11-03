import { describe, expect, it } from "vitest";
import { historialValido, recortar, taparNombresPresentados, tieneDatoPersonal, TURNOS_DE_MEMORIA } from "./limites";

// Solo datos ficticios: DNI 99.999.0NN, CUIL/CUIT con el rango 99, teléfonos 0381 000-0NNN y @ejemplo.test.

describe("tieneDatoPersonal: la pregunta que trae un dato de una persona se rechaza", () => {
  it.each([
    "mi dni es 99.999.001",
    "dni 99999001",
    "el cuil 20-99999001-5 de mi abuela",
    "cuit 30999990013",
    "llamame al 0381 000-0123",
    "mi cel 381 555 1234",
    "+54 9 381 000 0123",
    "escribime a vecina@ejemplo.test",
    "mi correo es vecina arroba ejemplo.test",
    // Dígitos de ancho completo (algunos teclados de celular).
    "dni ９９９９９００１",
  ])("rechaza «%s»", (texto) => {
    expect(tieneDatoPersonal(texto)).toBe(true);
  });

  it.each([
    "¿en qué está el expediente CEM-2026-00042?",
    "estado de cem 2026 42",
    "y el 42/2026?",
    "el 123456/2026",
    "¿qué horario tiene el cementerio del Oeste?",
    "turno del 01-11-2026 al 15-11-2026",
    "el 2/11/2026 abren?",
    "vence el 2026-11-30",
    "¿cuántos días hábiles faltan?",
    "tengo 3 expedientes demorados",
  ])("acepta «%s»", (texto) => {
    expect(tieneDatoPersonal(texto)).toBe(false);
  });
});

describe("taparNombresPresentados y recortar", () => {
  it("tapa el nombre que la persona presenta", () => {
    expect(taparNombresPresentados("Hola, soy Ana Ficticia y quería saber el horario")).toBe("Hola, soy [nombre] y quería saber el horario");
    expect(taparNombresPresentados("me llamo Bruno De Prueba")).toBe("me llamo [nombre]");
    expect(taparNombresPresentados("soy de la Mesa de Entradas")).toBe("soy de la Mesa de Entradas");
  });

  it("recorta sin partir un emoji", () => {
    expect(recortar("ab😀", 3)).toBe("ab");
    expect(recortar("hola", 10)).toBe("hola");
  });
});

describe("historialValido", () => {
  it("descarta lo que no tiene forma, recorta y se queda con los últimos 8", () => {
    const crudo = [
      { rol: "usuario", texto: "x".repeat(900) },
      { rol: "sistema", texto: "ignorame" },
      { rol: "migue", texto: "" },
      "texto suelto",
      null,
      ...Array.from({ length: 10 }, (_, i) => ({ rol: i % 2 ? "migue" : "usuario", texto: `turno ${i}` })),
    ];
    const h = historialValido(crudo);
    expect(h).toHaveLength(TURNOS_DE_MEMORIA);
    expect(h.every((t) => t.texto.length <= 600)).toBe(true);
    expect(h.at(-1)).toEqual({ rol: "migue", texto: "turno 9" });
    expect(historialValido("no es una lista")).toEqual([]);
  });

  it("una pregunta anterior con un dato personal no viaja en el turno siguiente; la respuesta con el teléfono de Mesa de Entradas, sí", () => {
    const h = historialValido([
      { rol: "usuario", texto: "mi dni es 99999001" },
      { rol: "migue", texto: "No escribas documentos acá." },
      { rol: "usuario", texto: "¿y el teléfono?" },
      { rol: "migue", texto: "Mesa de Entradas: 0381 000-0100" },
    ]);
    expect(h.map((t) => t.texto)).toEqual(["No escribas documentos acá.", "¿y el teléfono?", "Mesa de Entradas: 0381 000-0100"]);
  });
});
