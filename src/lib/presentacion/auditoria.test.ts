import { describe, expect, it } from "vitest";
import { detalleAcceso, leerFiltrosAuditoria, rutaAuditoria, rutaExportarAuditoria } from "./auditoria";

describe("auditoría en la URL", () => {
  it("lee la vista, los filtros y la página; lo inválido queda vacío", () => {
    const f = leerFiltrosAuditoria({ vista: "accesos", usuario: "12", expediente: " 42/2026 ", accion: "ver_datos_completos", desde: "2026-10-01", pagina: "3", tabla: "usuarios" });
    expect(f.vista).toBe("accesos");
    expect(f.accesos).toEqual({ usuarioId: 12, numero: "42/2026", accion: "ver_datos_completos", desde: "2026-10-01", hasta: null, pagina: 3 });
    expect(leerFiltrosAuditoria({ vista: "otra", usuario: "x" }).accesos.usuarioId).toBeNull();
    expect(leerFiltrosAuditoria({ vista: "cambios", tabla: ["usuarios", "areas"] }).cambios.tabla).toBe("usuarios");
  });

  it("arma la URL de la pantalla y la del CSV con los mismos filtros (el CSV sin página)", () => {
    const f = leerFiltrosAuditoria({ vista: "cambios", tabla: "feriados_anios", usuario: "3", pagina: "2" });
    expect(rutaAuditoria("cambios", f.cambios)).toBe("/admin/auditoria?vista=cambios&usuario=3&tabla=feriados_anios&pagina=2");
    expect(rutaExportarAuditoria("cambios", f.cambios)).toBe("/admin/auditoria/exportar?vista=cambios&usuario=3&tabla=feriados_anios");
    const vuelta = leerFiltrosAuditoria(Object.fromEntries(new URL(`http://x${rutaAuditoria("cambios", f.cambios)}`).searchParams));
    expect(vuelta.cambios).toEqual(f.cambios);
  });

  it("el detalle de un acceso en palabras, sin el motivo", () => {
    expect(detalleAcceso({ motivo: "Consulta del titular", hoja: "caratula" })).toBe("hoja: caratula");
    expect(detalleAcceso({ formato: "csv", filas: 12, truncado: false, filtros: { q: "perez", estado: [] } })).toBe("formato: csv · filas: 12 · truncado: no · filtros: q=perez");
  });
});
