import { describe, expect, it } from "vitest";
import { ESTADOS_EXPEDIENTE } from "@/lib/dominio/permisos";
import {
  AVISO_ORIENTATIVO,
  codigoDelFragmento,
  rutaConsulta,
  TEXTO_ESTADO_CIUDADANO,
  textoAvance,
  textoEstadoCiudadano,
  urlConsultaConCodigo,
} from "./consulta-publica";

describe("estado en lenguaje del ciudadano", () => {
  it.each([
    ["en_tramite", "En trámite"],
    ["espera_pago_dim", "Esperando el pago en la DIM"],
    ["concluido", "Finalizado: acercate a Mesa de Entradas"],
    ["archivado", "Archivado"],
    ["anulado", "Sin curso: acercate a Mesa de Entradas"],
  ])("%s → %s", (estado, texto) => {
    expect(textoEstadoCiudadano(estado)).toBe(texto);
  });

  it("cubre todos los estados y no usa la jerga de la oficina", () => {
    expect(Object.keys(TEXTO_ESTADO_CIUDADANO).sort()).toEqual([...ESTADOS_EXPEDIENTE].sort());
    for (const texto of Object.values(TEXTO_ESTADO_CIUDADANO)) {
      expect(texto).not.toMatch(/concluido|anulado|espera de pago|_/i);
    }
  });

  it("un estado desconocido se muestra como en trámite (no se inventa otro)", () => {
    expect(textoEstadoCiudadano("otro")).toBe("En trámite");
  });

  it("el aviso de que la información es orientativa", () => {
    expect(AVISO_ORIENTATIVO).toBe("Información orientativa: el expediente oficial es el de papel.");
  });
});

describe("textoAvance", () => {
  it("paso X de N y el nombre", () => {
    expect(textoAvance({ orden: 3, total: 7, nombre: "Liquidación" })).toBe("Paso 3 de 7: Liquidación");
  });
});

describe("enlaces de la consulta", () => {
  it("la ruta lleva el número y nunca el código", () => {
    expect(rutaConsulta("CEM-2026-00042")).toBe("/consulta/CEM-2026-00042");
  });

  it("el QR lleva el código en el fragmento, no en la query", () => {
    const url = urlConsultaConCodigo("https://cementeria.ejemplo.invalid", "CEM-2026-00042", "K7QM3XZP");
    expect(url).toBe("https://cementeria.ejemplo.invalid/consulta/CEM-2026-00042#K7QM3XZP");
    const u = new URL(url);
    expect(u.search).toBe("");
    expect(u.pathname).not.toContain("K7QM3XZP");
    expect(u.hash).toBe("#K7QM3XZP");
  });

  it("sin origen, la ruta relativa", () => {
    expect(urlConsultaConCodigo(null, "CEM-2026-00042", "K7QM3XZP")).toBe("/consulta/CEM-2026-00042#K7QM3XZP");
  });

  it.each([
    ["#K7QM3XZP", "K7QM3XZP"],
    ["#k7qm-3xzp", "K7QM3XZP"],
    ["K7QM3XZP", "K7QM3XZP"],
    ["#K7QM%2D3XZP", "K7QM3XZP"],
    ["", null],
    ["#", null],
    ["#hola", null],
    ["#%E0%A4%A", null],
    [`#${"A".repeat(41)}`, null],
  ])("codigoDelFragmento(%s) → %s", (hash, esperado) => {
    expect(codigoDelFragmento(hash)).toBe(esperado);
  });
});
