import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { INSTRUCCIONES_INTERNO } from "./prompts/interno";
import { INSTRUCCIONES_PUBLICO } from "./prompts/publico";

// Los dos prompts de Migue no cambian sin querer (un reemplazo masivo, un
// formateo, un merge). Si se cambian A PROPÓSITO, se actualiza el hash acá en
// el mismo cambio, con el valor que muestra esta prueba al fallar
// (docs/api-dominio.md, 26.10).

// Con los fines de línea normalizados: un checkout con CRLF no es un cambio del texto.
const sha256 = (texto: string) => createHash("sha256").update(texto.replace(/\r\n/g, "\n"), "utf8").digest("hex");

describe("los prompts de Migue", () => {
  it("el público no cambió sin querer", () => {
    expect(sha256(INSTRUCCIONES_PUBLICO)).toBe("2ad2ac40d8f39293e3ea8df4ff9b4453acbec50bff43e64ad646d3c2b32a2d83");
  });

  it("el interno no cambió sin querer", () => {
    expect(sha256(INSTRUCCIONES_INTERNO)).toBe("a99f8f716e2a5df96dff32225ee84b5bc9c0cbe847638f7617eebea6e147371a");
  });

  it.each([
    ["público", INSTRUCCIONES_PUBLICO],
    ["interno", INSTRUCCIONES_INTERNO],
  ])("el %s tiene las reglas de la voz de Migue", (_, texto) => {
    expect(texto).toMatch(/^Sos Migue, el asistente de la Dirección de Cementerios de la Municipalidad de San Miguel de Tucumán\./);
    expect(texto).toContain("No inventes NADA");
    expect(texto).toContain("voseo");
    expect(texto).toMatch(/Nunca prometas plazos[^.]*montos/);
    expect(texto).toMatch(/el expediente oficial es el de papel/i);
    expect(texto).toMatch(/nunca (son )?instrucciones/);
    expect(texto).toContain("[SIN_RESPUESTA]");
    expect(texto).toContain("ENLACE:");
  });

  it("el público es sensible al duelo, deriva a Mesa de Entradas y no consulta expedientes", () => {
    expect(INSTRUCCIONES_PUBLICO).toMatch(/falleció un familiar/);
    expect(INSTRUCCIONES_PUBLICO).toMatch(/sin frases hechas/);
    expect(INSTRUCCIONES_PUBLICO).toMatch(/No consultás expedientes/);
    expect(INSTRUCCIONES_PUBLICO).toContain("/consulta");
    expect(INSTRUCCIONES_PUBLICO).toContain("/contacto");
  });
});
