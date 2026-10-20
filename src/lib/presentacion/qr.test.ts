import { describe, expect, it } from "vitest";
import { svgQr } from "./qr";

describe("QR de la carátula", () => {
  it("es un SVG accesible, sin imágenes externas", async () => {
    const svg = await svgQr("http://localhost:3000/expedientes/CEM-2026-00001", "QR de CEM-2026-00001");
    expect(svg).toMatch(/^<svg role="img" aria-label="QR de CEM-2026-00001" width="100%" height="100%" xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    expect(svg).toContain("<path");
    expect(svg).not.toMatch(/<image|href=/);
  });

  it("escapa la etiqueta", async () => {
    const svg = await svgQr("x", 'a"<b>&');
    expect(svg).toContain('aria-label="a&quot;&lt;b&gt;&amp;"');
  });
});
