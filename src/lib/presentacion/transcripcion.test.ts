import { describe, expect, it } from "vitest";
import {
  cambiarPrecision,
  erroresDeGrilla,
  filaNueva,
  filaVacia,
  FUENTE_POR_DEFECTO,
  loteParaEnviar,
  MAXIMO_FILAS_LOTE,
  recorrerFilas,
  resumenTranscripcion,
  siguienteCelda,
  type FilaGrilla,
} from "./transcripcion";

// Una plantilla de 5 pasos: MESA(1) COMPUTO(2) LIQ(3) LEGAL(4) ADM(5).
const ORDEN: Record<string, number> = { MESA: 1, COMPUTO: 2, LIQ: 3, LEGAL: 4, ADM: 5 };
const ordenDe = (c: string) => ORDEN[c] ?? null;

function fila(id: string, cambios: Partial<FilaGrilla> = {}): FilaGrilla {
  return { ...filaNueva(id), ...cambios };
}

describe("grilla de transcripción (2.13(c))", () => {
  it("una fila nueva copia la fuente, la precisión y la fecha de la anterior", () => {
    expect(filaNueva("a")).toEqual({ id: "a", fecha: "", precision: "dia", pasoDestino: "", observacion: "", fuente: FUENTE_POR_DEFECTO, motivo: "" });
    const anterior = fila("a", { fecha: "2019-03-15T10:00", precision: "minuto", pasoDestino: "LIQ", fuente: "Libro de Legal", observacion: "x" });
    expect(filaNueva("b", anterior)).toEqual({ id: "b", fecha: "2019-03-15T10:00", precision: "minuto", pasoDestino: "", observacion: "", fuente: "Libro de Legal", motivo: "" });
  });

  it("cambiar la precisión lleva la fecha al formato del control", () => {
    expect(cambiarPrecision(fila("a", { fecha: "2019-03-15" }), "minuto").fecha).toBe("2019-03-15T00:00");
    expect(cambiarPrecision(fila("a", { fecha: "2019-03-15T14:30", precision: "minuto" }), "dia").fecha).toBe("2019-03-15");
    expect(cambiarPrecision(fila("a", { fecha: "" }), "minuto").fecha).toBe("");
  });

  it("pase hacia adelante, devolución hacia atrás (respecto de la fila anterior) y los errores", () => {
    const filas = [
      fila("1", { pasoDestino: "LIQ" }), // 1 → 3: pase (saltea Cómputo)
      fila("2", { pasoDestino: "COMPUTO" }), // 3 → 2: devolución
      fila("3", { pasoDestino: "COMPUTO" }), // ya está ahí
      fila("4", { pasoDestino: "" }), // sin paso
      fila("5", { pasoDestino: "ADM" }), // 2 → 5: pase
    ];
    expect(recorrerFilas(filas, 1, ordenDe)).toEqual([
      { tipo: "pase", ordenFinal: 3 },
      { tipo: "devolucion", ordenFinal: 2 },
      { tipo: "mismo_paso", ordenFinal: 2 },
      { tipo: "sin_paso", ordenFinal: 2 },
      { tipo: "pase", ordenFinal: 5 },
    ]);
  });

  it("el lote: sin las filas vacías, la fecha según la precisión y el motivo solo en las devoluciones", () => {
    const filas = [
      fila("1", { fecha: "2019-03-15", pasoDestino: "LEGAL", observacion: "  a Legal ", motivo: "no va" }),
      fila("2"), // vacía: la fuente y la precisión copiadas no cuentan
      fila("3", { fecha: "2019-05-02T09:15", precision: "minuto", pasoDestino: "LIQ", motivo: "Faltaba la boleta firmada", fuente: "  " }),
    ];
    expect(filaVacia(filas[1])).toBe(true);
    const lote = loteParaEnviar(filas, recorrerFilas(filas, 1, ordenDe));
    expect(lote.indices).toEqual([0, 2]);
    expect(lote.filas).toEqual([
      { comandoId: "1", fecha: "2019-03-15", precision: "dia", pasoDestino: "LEGAL", observacion: "a Legal", fuente: FUENTE_POR_DEFECTO, motivo: null },
      { comandoId: "3", fecha: "2019-05-02T09:15", precision: "minuto", pasoDestino: "LIQ", observacion: null, fuente: null, motivo: "Faltaba la boleta firmada" },
    ]);
    // Con precisión de día, una fecha con hora va solo con el día.
    const dia = [fila("x", { fecha: "2019-03-15T10:00", precision: "dia", pasoDestino: "LIQ" })];
    expect(loteParaEnviar(dia, recorrerFilas(dia, 1, ordenDe)).filas[0].fecha).toBe("2019-03-15");
  });

  it("los errores del dominio (filas[i] del lote) van a la celda de la fila de la grilla", () => {
    const filas = [fila("1", { fecha: "2019-03-15", pasoDestino: "LIQ" }), fila("2"), fila("3", { fecha: "2019-01-01", pasoDestino: "LEGAL" })];
    const g = erroresDeGrilla(
      [
        { ruta: "filas[1].fecha", mensaje: "No puede ser anterior a la fila anterior" },
        { ruta: "filas[0].fuente", mensaje: "Indicá la fuente" },
        { ruta: "filas[1].comandoId", mensaje: "Fila sin identificador" },
        { ruta: "filas", mensaje: "Hay filas repetidas" },
      ],
      filas,
      [0, 2],
    );
    expect(g.celdas.get("3")).toEqual({ fecha: ["No puede ser anterior a la fila anterior"] });
    expect(g.celdas.get("1")).toEqual({ fuente: ["Indicá la fuente"] });
    expect(g.celdas.has("2")).toBe(false);
    expect(g.generales).toEqual(["Fila sin identificador", "Hay filas repetidas"]);
  });

  it("teclado: Enter baja (en la última agrega una fila), Mayús+Enter sube", () => {
    expect(siguienteCelda({ fila: 0, columna: "fecha" }, "abajo", 3)).toEqual({ fila: 1, columna: "fecha", agregarFila: false });
    expect(siguienteCelda({ fila: 2, columna: "pasoDestino" }, "abajo", 3)).toEqual({ fila: 3, columna: "pasoDestino", agregarFila: true });
    expect(siguienteCelda({ fila: 2, columna: "fuente" }, "arriba", 3)).toEqual({ fila: 1, columna: "fuente", agregarFila: false });
    expect(siguienteCelda({ fila: 0, columna: "fuente" }, "arriba", 3)).toEqual({ fila: 0, columna: "fuente", agregarFila: false });
    expect(siguienteCelda({ fila: MAXIMO_FILAS_LOTE - 1, columna: "fecha" }, "abajo", MAXIMO_FILAS_LOTE).agregarFila).toBe(false);
  });

  it("el aviso después de registrar", () => {
    expect(resumenTranscripcion([{ repetida: false }, { repetida: false }, { repetida: false }], "Asesoría Legal")).toBe("Se registraron 3 filas. El expediente quedó en Asesoría Legal.");
    expect(resumenTranscripcion([{ repetida: false }, { repetida: true }], "Cómputo")).toBe("Se registró 1 fila (1 ya estaba registrada). El expediente quedó en Cómputo.");
    expect(resumenTranscripcion([{ repetida: true }, { repetida: true }], "Cómputo")).toBe("No había filas nuevas: las 2 ya estaban registradas. El expediente está en Cómputo.");
  });
});
