import { describe, expect, it } from "vitest";
import { RENOV_CONTADO } from "../../../../prisma/semilla/plantillas/renov-contado";
import { descripcionRegistro, diferenciasCambio, diferenciasEnTexto, resumenDefinicion, textoValor } from "./diferencias";

// auditoria.cambios legible (semana 5): lo que guarda el trigger auditar_cambio
// (to_jsonb de la fila, o en usuarios solo id, cuil, área, rol y activo).

const AREAS = new Map([
  [1, "Mesa de Entradas"],
  [2, "Cómputo"],
]);

describe("diferenciasCambio", () => {
  it("usuarios: muestra solo lo que cambió, con el nombre del área y el rol en palabras", () => {
    const antes = { id: 5, cuil: "20000000036", area_id: 1, rol: "operador", activo: true };
    const despues = { ...antes, area_id: 2, activo: false };
    expect(diferenciasCambio("U", antes, despues, { areas: AREAS })).toEqual([
      { campo: "area_id", etiqueta: "Área", antes: "Mesa de Entradas (1)", despues: "Cómputo (2)" },
      { campo: "activo", etiqueta: "Activo", antes: "sí", despues: "no" },
    ]);
    expect(diferenciasCambio("I", null, { ...antes, rol: "admin", area_id: null }).map((d) => `${d.etiqueta}=${d.despues}`)).toEqual(["CUIL=20000000036", "Rol=administrador", "Activo=sí"]);
  });

  it("plantillas: la definición se resume en cantidades; publicar se ve como cambio de estado", () => {
    const fila = { id: 9, codigo: "RENOV_CONTADO", version: 2, estado: "borrador", definicion: RENOV_CONTADO, notas_cambio: null };
    const conSubtarea = { ...RENOV_CONTADO, pasos: RENOV_CONTADO.pasos.map((p, i) => (i === 0 ? { ...p, subtareas: [...p.subtareas, { ...p.subtareas[0], clave: "NUEVA" }] } : p)) };
    const r = diferenciasCambio("U", fila, { ...fila, definicion: conSubtarea });
    const subtareas = resumenDefinicion(RENOV_CONTADO).subtareas;
    expect(r).toEqual([{ campo: "definicion", etiqueta: "Definición", antes: expect.stringContaining(`${subtareas} subtareas`), despues: expect.stringContaining(`${subtareas + 1} subtareas`) }]);
    const publicada = diferenciasCambio("U", fila, { ...fila, estado: "publicada", notas_cambio: "Suma una subtarea en Mesa" });
    expect(publicada.map((d) => [d.etiqueta, d.antes, d.despues])).toEqual([
      ["Estado", "borrador", "publicada"],
      ["Notas de cambio", "—", "Suma una subtarea en Mesa"],
    ]);
    // Mismo tamaño, otro contenido.
    const renombrada = { ...RENOV_CONTADO, pasos: RENOV_CONTADO.pasos.map((p, i) => (i === 0 ? { ...p, nombre: "Otro nombre" } : p)) };
    expect(diferenciasCambio("U", fila, { ...fila, definicion: renombrada })[0]).toMatchObject({ antes: "(las mismas cantidades)", despues: "cambió el contenido" });
  });

  it("cementerios: los campos de ubicación en una línea; una baja muestra lo que había", () => {
    const campos = [{ clave: "seccion", etiqueta: "Sección", tipo: "texto", obligatorio: true, patron: "[A-H]", activo: true }];
    expect(textoValor("campos_ubicacion", campos)).toBe("Sección (seccion; obligatorio; patrón [A-H])");
    expect(textoValor("tipos_monumento", ["SEPULTURA", "PANTEON"])).toBe("SEPULTURA, PANTEON");
    expect(diferenciasCambio("D", { fecha: "2026-07-09", descripcion: "Independencia" }, null)).toEqual([
      { campo: "fecha", etiqueta: "Fecha", antes: "2026-07-09", despues: "—" },
      { campo: "descripcion", etiqueta: "Descripción", antes: "Independencia", despues: "—" },
    ]);
  });

  it("descripcionRegistro y el texto para el CSV", () => {
    expect(descripcionRegistro("plantillas", "9", null, { codigo: "RENOV_CONTADO", version: 2 })).toBe("RENOV_CONTADO v2");
    expect(descripcionRegistro("usuarios", "5", { cuil: "20000000036" }, null)).toBe("CUIL 20000000036");
    expect(descripcionRegistro("feriados", "2026-07-09", null, { descripcion: "Independencia" })).toBe("09/07/2026 (Independencia)");
    expect(descripcionRegistro("feriados_anios", "2026", null, {})).toBe("Año 2026");
    expect(descripcionRegistro("areas", "3", null, { codigo: "LEGAL", nombre: "Asesoría Legal" })).toBe("LEGAL (Asesoría Legal)");
    expect(diferenciasEnTexto([{ campo: "activo", etiqueta: "Activo", antes: "sí", despues: "no" }])).toBe("Activo: sí → no");
  });
});
