import { describe, expect, it } from "vitest";
import {
  ACCIONES,
  evaluarPermiso,
  exigirPermiso,
  PermisoDenegado,
  puede,
  type Accion,
  type ExpedientePermisos,
  type UsuarioPermisos,
} from "./permisos";

// Áreas con ids ficticios; lo que cuenta para las reglas es el código.
const AREAS = {
  MESA_ENTRADAS: { id: 1, codigo: "MESA_ENTRADAS" },
  COMPUTO: { id: 2, codigo: "COMPUTO" },
  LIQUIDACION: { id: 3, codigo: "LIQUIDACION" },
  LEGAL: { id: 4, codigo: "LEGAL" },
  TRIBUTARIO: { id: 6, codigo: "TRIBUTARIO" },
  DIRECCION: { id: 7, codigo: "DIRECCION" },
} as const;

let siguienteId = 100;
function usuario(rol: UsuarioPermisos["rol"], area: keyof typeof AREAS | null, activo = true): UsuarioPermisos {
  return { id: siguienteId++, rol, activo, area: area ? AREAS[area] : null };
}

const mesa = usuario("operador", "MESA_ENTRADAS");
const computo = usuario("operador", "COMPUTO");
const liquidacion = usuario("operador", "LIQUIDACION");
const legal = usuario("operador", "LEGAL");
const direccion = usuario("lectura", "DIRECCION");
const admin = usuario("admin", null);

/** Un expediente en Liquidación que pasó antes por Mesa de Entradas y Cómputo. */
function expediente(cambios: Partial<ExpedientePermisos> = {}): ExpedientePermisos {
  return {
    estado: "en_tramite",
    areaResponsableId: AREAS.LIQUIDACION.id,
    areasRecorridas: [AREAS.MESA_ENTRADAS.id, AREAS.COMPUTO.id, AREAS.LIQUIDACION.id],
    tuvoPases: true,
    ...cambios,
  };
}

describe("reglas que no necesitan expediente (semana 1)", () => {
  it("todos buscan, ven fichas y el panel", () => {
    for (const u of [mesa, computo, liquidacion, direccion, admin]) {
      expect(puede("ver_expediente", null, u)).toBe(true);
      expect(puede("ver_panel", null, u)).toBe(true);
    }
  });

  it("alta, carga histórica y reiniciar: Mesa de Entradas y admin", () => {
    for (const accion of ["alta", "carga_historica", "reiniciar_con_otra_plantilla"] as const) {
      expect(puede(accion, null, mesa)).toBe(true);
      expect(puede(accion, null, admin)).toBe(true);
      expect(evaluarPermiso(accion, null, computo)).toEqual({ permitido: false, motivo: "area_no_habilitada" });
      expect(evaluarPermiso(accion, null, direccion)).toEqual({ permitido: false, motivo: "solo_lectura" });
    }
  });

  it("archivar sin concluir, desarchivar y anular: Mesa de Entradas y admin", () => {
    for (const accion of ["archivar_sin_concluir", "desarchivar", "anular"] as const) {
      expect(puede(accion, expediente(), mesa)).toBe(true);
      expect(puede(accion, expediente(), admin)).toBe(true);
      expect(puede(accion, expediente(), liquidacion)).toBe(false);
      expect(puede(accion, expediente(), direccion)).toBe(false);
    }
  });

  it("reabrir, suprimir persona, purgar adjunto y administrar: solo admin", () => {
    for (const accion of ["reabrir", "suprimir_persona", "purgar_adjunto", "administrar"] as const) {
      expect(puede(accion, null, admin)).toBe(true);
      expect(evaluarPermiso(accion, null, mesa)).toEqual({ permitido: false, motivo: "solo_admin" });
      expect(evaluarPermiso(accion, null, direccion)).toEqual({ permitido: false, motivo: "solo_lectura" });
    }
  });

  it("exportar CSV: Dirección y admin", () => {
    expect(puede("exportar_csv", null, direccion)).toBe(true);
    expect(puede("exportar_csv", null, admin)).toBe(true);
    expect(puede("exportar_csv", null, mesa)).toBe(false);
    expect(puede("exportar_csv", null, computo)).toBe(false);
  });

  it("nota libre: todos menos lectura", () => {
    expect(puede("nota", expediente(), legal)).toBe(true);
    expect(puede("nota", expediente(), admin)).toBe(true);
    expect(evaluarPermiso("nota", expediente(), direccion)).toEqual({ permitido: false, motivo: "solo_lectura" });
  });

  it("Dirección (lectura) no hace ninguna acción que escriba", () => {
    const lecturas: readonly Accion[] = ["ver_expediente", "ver_datos_completos", "ver_panel", "exportar_csv"];
    for (const accion of ACCIONES) {
      if (lecturas.includes(accion)) continue;
      expect(puede(accion, expediente(), direccion), accion).toBe(false);
    }
  });

  it("un usuario inactivo no puede nada, ni ver", () => {
    const inactivo = usuario("admin", null, false);
    for (const accion of ACCIONES) {
      expect(evaluarPermiso(accion, expediente(), inactivo)).toEqual({ permitido: false, motivo: "usuario_inactivo" });
    }
  });

  it("toda acción de la lista tiene regla", () => {
    for (const accion of ACCIONES) {
      expect(() => evaluarPermiso(accion, expediente(), mesa)).not.toThrow();
    }
  });
});

describe("reglas del área responsable", () => {
  const acciones = ["confirmar_recepcion", "tildar_subtarea", "dar_pase", "devolver", "concluir"] as const;

  it("las hace el área responsable", () => {
    for (const accion of acciones) expect(puede(accion, expediente(), liquidacion)).toBe(true);
  });

  it("Mesa de Entradas, solo si es la responsable", () => {
    for (const accion of acciones) {
      expect(evaluarPermiso(accion, expediente(), mesa)).toEqual({ permitido: false, motivo: "no_es_responsable" });
      expect(puede(accion, expediente({ areaResponsableId: AREAS.MESA_ENTRADAS.id }), mesa)).toBe(true);
    }
  });

  it("el admin no da pases ordinarios", () => {
    for (const accion of acciones) {
      expect(evaluarPermiso(accion, expediente(), admin)).toEqual({ permitido: false, motivo: "admin_no_opera" });
    }
  });

  it("sin expediente no se puede decidir", () => {
    expect(evaluarPermiso("dar_pase", null, liquidacion)).toEqual({ permitido: false, motivo: "requiere_expediente" });
  });

  it("documentación y adjuntos: responsable, y Mesa de Entradas en estados activos", () => {
    expect(puede("adjuntar", expediente(), liquidacion)).toBe(true);
    expect(puede("adjuntar", expediente(), mesa)).toBe(true);
    expect(evaluarPermiso("marcar_documento", expediente({ estado: "archivado" }), mesa)).toEqual({
      permitido: false,
      motivo: "estado_no_admite",
    });
    expect(puede("adjuntar", expediente(), computo)).toBe(false);
    expect(puede("adjuntar", expediente(), admin)).toBe(false);
  });

  it("campos extra y contacto: Mesa, responsable y admin", () => {
    for (const accion of ["completar_campos_extra", "editar_contacto"] as const) {
      expect(puede(accion, expediente(), mesa)).toBe(true);
      expect(puede(accion, expediente(), liquidacion)).toBe(true);
      expect(puede(accion, expediente(), admin)).toBe(true);
      expect(puede(accion, expediente(), computo)).toBe(false);
    }
  });

  it("archivar un concluido: solo si está concluido", () => {
    expect(puede("archivar_concluido", expediente({ estado: "concluido" }), liquidacion)).toBe(true);
    expect(evaluarPermiso("archivar_concluido", expediente(), mesa)).toEqual({
      permitido: false,
      motivo: "estado_no_admite",
    });
  });
});

describe("datos identificatorios", () => {
  it("Mesa de Entradas y admin; de las áreas responsables, solo Cómputo", () => {
    const enComputo = expediente({ areaResponsableId: AREAS.COMPUTO.id, tuvoPases: false });
    expect(puede("editar_identificatorios", enComputo, computo)).toBe(true);
    expect(puede("editar_identificatorios", enComputo, mesa)).toBe(true);
    expect(puede("editar_identificatorios", enComputo, admin)).toBe(true);
    expect(evaluarPermiso("editar_identificatorios", expediente(), liquidacion)).toEqual({
      permitido: false,
      motivo: "area_no_habilitada",
    });
    // Cómputo, pero el expediente ya no está en Cómputo.
    expect(evaluarPermiso("editar_identificatorios", expediente(), computo)).toEqual({
      permitido: false,
      motivo: "no_es_responsable",
    });
  });

  it("después del primer pase, exige motivo", () => {
    expect(evaluarPermiso("editar_identificatorios", expediente({ tuvoPases: false }), mesa)).toEqual({
      permitido: true,
      requiereMotivo: false,
    });
    expect(evaluarPermiso("editar_identificatorios", expediente({ tuvoPases: true }), mesa)).toEqual({
      permitido: true,
      requiereMotivo: true,
    });
  });
});

describe("ver contacto completo y adjuntos", () => {
  it("Mesa de Entradas, Dirección y admin, siempre", () => {
    for (const u of [mesa, direccion, admin]) {
      expect(evaluarPermiso("ver_datos_completos", null, u)).toEqual({ permitido: true, requiereMotivo: false });
    }
  });

  it("el área responsable y las áreas por las que pasó, sin motivo", () => {
    expect(evaluarPermiso("ver_datos_completos", expediente(), liquidacion)).toEqual({
      permitido: true,
      requiereMotivo: false,
    });
    expect(evaluarPermiso("ver_datos_completos", expediente(), computo)).toEqual({
      permitido: true,
      requiereMotivo: false,
    });
  });

  it("otro operador, con motivo (queda en auditoria.accesos)", () => {
    expect(evaluarPermiso("ver_datos_completos", expediente(), legal)).toEqual({
      permitido: true,
      requiereMotivo: true,
    });
  });
});

describe("corregir un movimiento propio", () => {
  const ahora = new Date("2026-10-19T12:00:00Z");
  const hace = (dias: number) => new Date(ahora.getTime() - dias * 24 * 60 * 60 * 1000);

  it("el autor, durante 7 días", () => {
    const movimiento = { usuarioId: legal.id, registradoEn: hace(7) };
    expect(puede("corregir_movimiento", expediente(), legal, { movimiento, ahora })).toBe(true);
    expect(
      evaluarPermiso("corregir_movimiento", expediente(), legal, {
        movimiento: { ...movimiento, registradoEn: hace(7.01) },
        ahora,
      }),
    ).toEqual({ permitido: false, motivo: "plazo_vencido" });
  });

  it("nadie más, salvo el admin", () => {
    const movimiento = { usuarioId: legal.id, registradoEn: hace(1) };
    expect(evaluarPermiso("corregir_movimiento", expediente(), mesa, { movimiento, ahora })).toEqual({
      permitido: false,
      motivo: "no_es_autor",
    });
    expect(puede("corregir_movimiento", expediente(), admin, { movimiento: { ...movimiento, registradoEn: hace(90) }, ahora })).toBe(
      true,
    );
  });

  it("sin el movimiento no se puede decidir", () => {
    expect(evaluarPermiso("corregir_movimiento", expediente(), legal)).toEqual({
      permitido: false,
      motivo: "requiere_movimiento",
    });
  });
});

describe("exigirPermiso", () => {
  it("devuelve si hace falta motivo", () => {
    expect(exigirPermiso("alta", null, mesa)).toEqual({ requiereMotivo: false });
    expect(exigirPermiso("ver_datos_completos", expediente(), legal)).toEqual({ requiereMotivo: true });
  });

  it("tira PermisoDenegado con la acción y el motivo", () => {
    expect(() => exigirPermiso("administrar", null, mesa)).toThrow(PermisoDenegado);
    let atrapado: unknown = null;
    try {
      exigirPermiso("dar_pase", expediente(), admin);
    } catch (error) {
      atrapado = error;
    }
    expect(atrapado).toBeInstanceOf(PermisoDenegado);
    expect(atrapado).toMatchObject({ accion: "dar_pase", motivo: "admin_no_opera" });
  });
});
