import { describe, expect, it } from "vitest";
import { ErrorDominio } from "@/lib/dominio/expedientes/errores";
import { PermisoDenegado } from "@/lib/dominio/permisos";
import {
  comparacion,
  leerFiltrosMetricas,
  parametrosMetricas,
  responderExportacionMetricas,
  rotuloPeriodo,
  rutaExportarMetricas,
  textoDiasHabiles,
  textoPeriodo,
  textoPorcentaje,
} from "./metricas";

describe("filtros de /panel/metricas en la URL", () => {
  it("lee lo bien formado e ignora lo demás", () => {
    expect(leerFiltrosMetricas({ desde: "2026-05-01", hasta: "2026-10-26", tramite: "2", plantilla: "RENOV_CONTADO", cementerio: "3", agrupar: "semana", historicos: "incluir" })).toEqual({
      filtros: { desde: "2026-05-01", hasta: "2026-10-26", tipoTramiteId: 2, plantillaCodigo: "RENOV_CONTADO", cementerioId: 3, agrupar: "semana", historicos: "incluir" },
      valores: { desde: "2026-05-01", hasta: "2026-10-26", tramite: "2", plantilla: "RENOV_CONTADO", cementerio: "3", agrupar: "semana", historicos: "incluir" },
    });
    expect(leerFiltrosMetricas({ desde: "2026-02-30", tramite: "x", plantilla: "malo; DROP", agrupar: "año", historicos: "si" }).filtros).toEqual({ agrupar: "mes", historicos: "excluir" });
  });

  it("arma la URL de vuelta y la del CSV", () => {
    const f = { desde: "2026-05-01", hasta: "2026-10-26", tipoTramiteId: 2, historicos: "excluir" as const, agrupar: "mes" as const };
    expect(parametrosMetricas(f).toString()).toBe("desde=2026-05-01&hasta=2026-10-26&tramite=2");
    expect(rutaExportarMetricas("pasos", { ...f, historicos: "incluir", agrupar: "semana" })).toBe(
      "/panel/metricas/exportar?desde=2026-05-01&hasta=2026-10-26&tramite=2&agrupar=semana&historicos=incluir&tabla=pasos",
    );
  });
});

describe("textos", () => {
  it("días hábiles, porcentajes y períodos", () => {
    expect(textoDiasHabiles(1)).toBe("1 día hábil");
    expect(textoDiasHabiles(12.5)).toBe("12,5 días hábiles");
    expect(textoDiasHabiles(null)).toBe("—");
    expect(textoPorcentaje(0.125)).toBe("12,5 %");
    expect(textoPorcentaje(null)).toBe("—");
    const mes = { clave: "2026-10", agrupacion: "mes" as const, desde: "2026-10-01", hasta: "2026-10-26" };
    expect(textoPeriodo(mes)).toBe("octubre de 2026");
    expect(rotuloPeriodo(mes)).toBe("oct 26");
    const semana = { clave: "2026-10-05", agrupacion: "semana" as const, desde: "2026-10-05", hasta: "2026-10-11" };
    expect(textoPeriodo(semana)).toBe("semana del 05/10/2026");
    expect(rotuloPeriodo(semana)).toBe("05/10");
  });

  it("la comparación con antes del sistema: menos es mejor", () => {
    expect(comparacion(12, 20)).toEqual({ texto: "−8 días hábiles (−40 %) respecto de antes del sistema", mejora: true });
    expect(comparacion(25, 20)).toEqual({ texto: "+5 días hábiles (+25 %) respecto de antes del sistema", mejora: false });
    expect(comparacion(20, 20)).toEqual({ texto: "igual que antes del sistema", mejora: null });
    expect(comparacion(12, null)).toBeNull();
  });
});

describe("CSV de las métricas (Route Handler)", () => {
  const usuario = { id: 5, rol: "lectura" as const, activo: true, area: { id: 9, codigo: "DIRECCION" } };
  const pedido = (q: string) => new Request(`http://localhost/panel/metricas/exportar?${q}`);
  const servicio = (r: (...args: unknown[]) => Promise<unknown>) => ({ exportarCsv: r }) as unknown as Parameters<typeof responderExportacionMetricas>[0];

  it("200 con el archivo como attachment", async () => {
    let recibido: unknown[] = [];
    const s = servicio(async (...args: unknown[]) => {
      recibido = args;
      return { nombreArchivo: "metricas-pasos-2026-10-26.csv", tipo: "text/csv; charset=utf-8", contenido: "﻿a;b\r\n", filas: 0 };
    });
    const r = await responderExportacionMetricas(s, usuario, pedido("tabla=pasos&desde=2026-05-01"), "10.0.0.1");
    expect(r.status).toBe(200);
    expect(r.headers.get("Content-Disposition")).toContain('attachment; filename="metricas-pasos-2026-10-26.csv"');
    expect(r.headers.get("Cache-Control")).toBe("private, no-store");
    expect(recibido).toEqual([usuario, { desde: "2026-05-01", agrupar: "mes", historicos: "excluir" }, "pasos", { ip: "10.0.0.1" }]);
  });

  it("401 sin sesión, 404 con una tabla que no existe, 403 sin permiso y 422 con un período inválido", async () => {
    const nunca = servicio(async () => {
      throw new Error("no debería llamarse");
    });
    expect((await responderExportacionMetricas(nunca, null, pedido("tabla=pasos"), null)).status).toBe(401);
    expect((await responderExportacionMetricas(nunca, usuario, pedido("tabla=otra"), null)).status).toBe(404);
    const sinPermiso = servicio(async () => {
      throw new PermisoDenegado("ver_metricas", "area_no_habilitada");
    });
    expect((await responderExportacionMetricas(sinPermiso, usuario, pedido("tabla=flujo"), null)).status).toBe(403);
    const invalido = servicio(async () => {
      throw new ErrorDominio("validacion", "La fecha desde tiene que ser anterior o igual a la fecha hasta");
    });
    const r = await responderExportacionMetricas(invalido, usuario, pedido("tabla=flujo&desde=2026-10-01&hasta=2026-09-01"), null);
    expect(r.status).toBe(422);
    expect(await r.text()).toBe("La fecha desde tiene que ser anterior o igual a la fecha hasta");
  });
});
