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
    // Semana 4: cada una desde su estado (desarchivar, desde archivado).
    for (const accion of ["archivar_sin_concluir", "desarchivar", "anular"] as const) {
      const exp = expediente(accion === "desarchivar" ? { estado: "archivado" } : {});
      expect(puede(accion, exp, mesa)).toBe(true);
      expect(puede(accion, exp, admin)).toBe(true);
      expect(puede(accion, exp, liquidacion)).toBe(false);
      expect(puede(accion, exp, direccion)).toBe(false);
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

  it("métricas de gestión: Dirección y admin", () => {
    expect(puede("ver_metricas", null, direccion)).toBe(true);
    expect(puede("ver_metricas", null, admin)).toBe(true);
    expect(evaluarPermiso("ver_metricas", null, mesa)).toEqual({ permitido: false, motivo: "area_no_habilitada" });
    expect(evaluarPermiso("ver_metricas", null, computo)).toEqual({ permitido: false, motivo: "area_no_habilitada" });
    // Un usuario de lectura que no es de Dirección, tampoco.
    expect(puede("ver_metricas", null, usuario("lectura", "LEGAL"))).toBe(false);
  });

  it("nota libre: todos menos lectura", () => {
    expect(puede("nota", expediente(), legal)).toBe(true);
    expect(puede("nota", expediente(), admin)).toBe(true);
    expect(evaluarPermiso("nota", expediente(), direccion)).toEqual({ permitido: false, motivo: "solo_lectura" });
  });

  it("Dirección (lectura) no hace ninguna acción que escriba", () => {
    const lecturas: readonly Accion[] = ["ver_expediente", "ver_datos_completos", "ver_panel", "exportar_csv", "imprimir", "ver_metricas"];
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

describe("semana 2: alta, ficha, edición y carátula", () => {
  it("imprimir (carátula, historial): todos, también Dirección", () => {
    for (const u of [mesa, computo, legal, direccion, admin]) {
      expect(evaluarPermiso("imprimir", expediente(), u)).toEqual({ permitido: true, requiereMotivo: false });
    }
  });

  it("en archivado y anulado no se editan datos, contacto ni campos extra (3.1), ni siquiera Mesa o el admin", () => {
    const acciones = ["editar_identificatorios", "editar_contacto", "completar_campos_extra"] as const;
    for (const estado of ["archivado", "anulado"] as const) {
      for (const accion of acciones) {
        for (const u of [mesa, admin]) {
          expect(evaluarPermiso(accion, expediente({ estado }), u), `${accion} ${estado}`).toEqual({
            permitido: false,
            motivo: "estado_no_admite",
          });
        }
      }
    }
  });

  it("en concluido y en espera de pago en la DIM sí se editan", () => {
    for (const estado of ["concluido", "espera_pago_dim"] as const) {
      expect(puede("editar_identificatorios", expediente({ estado }), mesa)).toBe(true);
      expect(puede("editar_contacto", expediente({ estado }), liquidacion)).toBe(true);
      expect(puede("completar_campos_extra", expediente({ estado }), admin)).toBe(true);
    }
  });

  it("observaciones y contacto: no los edita un área que no es la responsable, aunque haya pasado por ella", () => {
    expect(evaluarPermiso("editar_contacto", expediente(), computo)).toEqual({ permitido: false, motivo: "no_es_responsable" });
    expect(evaluarPermiso("completar_campos_extra", expediente(), legal)).toEqual({ permitido: false, motivo: "no_es_responsable" });
  });

  it("el alta sin expediente: el primer pase todavía no existe, no pide motivo", () => {
    expect(evaluarPermiso("editar_identificatorios", null, mesa)).toEqual({ permitido: true, requiereMotivo: false });
    expect(evaluarPermiso("editar_identificatorios", null, computo)).toEqual({ permitido: false, motivo: "requiere_expediente" });
  });

  it("Cómputo responsable: identificatorios sí, y con motivo si ya hubo pases", () => {
    const enComputo = expediente({ areaResponsableId: AREAS.COMPUTO.id, tuvoPases: true });
    expect(evaluarPermiso("editar_identificatorios", enComputo, computo)).toEqual({ permitido: true, requiereMotivo: true });
    // Pero el contacto lo edita por ser la responsable, sin motivo.
    expect(evaluarPermiso("editar_contacto", enComputo, computo)).toEqual({ permitido: true, requiereMotivo: false });
  });
});

describe("semana 3: pases, recepción, subtareas, documentos, adjuntos y bandejas", () => {
  const flujo = ["confirmar_recepcion", "tildar_subtarea", "dar_pase", "devolver"] as const;

  it("las acciones del flujo, solo en trámite o en espera de pago en la DIM (3.1)", () => {
    for (const accion of flujo) {
      expect(puede(accion, expediente({ estado: "espera_pago_dim" }), liquidacion), accion).toBe(true);
      for (const estado of ["concluido", "archivado", "anulado"] as const) {
        expect(evaluarPermiso(accion, expediente({ estado }), liquidacion), `${accion} ${estado}`).toEqual({
          permitido: false,
          motivo: "estado_no_admite",
        });
      }
    }
  });

  it("con la carga histórica abierta no hay pases ni devoluciones, pero sí recepción y subtareas", () => {
    const historico = expediente({ cargaHistorica: true });
    expect(evaluarPermiso("dar_pase", historico, liquidacion)).toEqual({ permitido: false, motivo: "carga_historica_abierta" });
    expect(evaluarPermiso("devolver", historico, liquidacion)).toEqual({ permitido: false, motivo: "carga_historica_abierta" });
    expect(puede("confirmar_recepcion", historico, liquidacion)).toBe(true);
    expect(puede("tildar_subtarea", historico, liquidacion)).toBe(true);
  });

  it("el último paso no da pase (se concluye) y el primero no devuelve", () => {
    expect(evaluarPermiso("dar_pase", expediente({ pasoFinal: true }), liquidacion)).toEqual({ permitido: false, motivo: "paso_final" });
    expect(puede("devolver", expediente({ pasoFinal: true }), liquidacion)).toBe(true);
    expect(evaluarPermiso("devolver", expediente({ primerPaso: true }), liquidacion)).toEqual({ permitido: false, motivo: "primer_paso" });
    expect(puede("dar_pase", expediente({ primerPaso: true }), liquidacion)).toBe(true);
  });

  it("antes que el estado, el área: quien no es responsable recibe no_es_responsable", () => {
    expect(evaluarPermiso("dar_pase", expediente({ estado: "archivado" }), legal)).toEqual({ permitido: false, motivo: "no_es_responsable" });
    expect(evaluarPermiso("dar_pase", expediente({ cargaHistorica: true }), admin)).toEqual({ permitido: false, motivo: "admin_no_opera" });
  });

  it("la custodia de un paso externo es la responsable: Tributario opera lo que está en la DIM", () => {
    const tributario = usuario("operador", "TRIBUTARIO");
    const enDim = expediente({ estado: "espera_pago_dim", areaResponsableId: AREAS.TRIBUTARIO.id });
    for (const accion of [...flujo, "marcar_documento", "adjuntar"] as const) expect(puede(accion, enDim, tributario), accion).toBe(true);
    expect(puede("dar_pase", enDim, liquidacion)).toBe(false);
  });

  it("documentación y adjuntos: nunca en archivado ni anulado; el responsable, también en concluido", () => {
    for (const accion of ["marcar_documento", "adjuntar"] as const) {
      for (const estado of ["archivado", "anulado"] as const) {
        expect(evaluarPermiso(accion, expediente({ estado }), liquidacion)).toEqual({ permitido: false, motivo: "estado_no_admite" });
        expect(evaluarPermiso(accion, expediente({ estado }), mesa)).toEqual({ permitido: false, motivo: "estado_no_admite" });
      }
      expect(puede(accion, expediente({ estado: "concluido" }), liquidacion)).toBe(true);
      expect(evaluarPermiso(accion, expediente({ estado: "concluido" }), mesa)).toEqual({ permitido: false, motivo: "estado_no_admite" });
      expect(puede(accion, expediente({ estado: "espera_pago_dim" }), mesa)).toBe(true);
    }
  });

  it("la bandeja: operadores con área; Dirección y el admin, no", () => {
    for (const u of [mesa, computo, liquidacion, legal]) expect(puede("ver_bandeja", null, u)).toBe(true);
    expect(evaluarPermiso("ver_bandeja", null, direccion)).toEqual({ permitido: false, motivo: "solo_lectura" });
    expect(evaluarPermiso("ver_bandeja", null, admin)).toEqual({ permitido: false, motivo: "admin_no_opera" });
  });

  it("exigirPermiso tira con el motivo del flujo", () => {
    expect(() => exigirPermiso("dar_pase", expediente({ pasoFinal: true }), liquidacion)).toThrow(PermisoDenegado);
    expect(exigirPermiso("devolver", expediente(), liquidacion)).toEqual({ requiereMotivo: false });
  });
});

describe("semana 4: estados, transcripción y correcciones (3.1, 3.2)", () => {
  it("concluir: el responsable, solo desde el último paso y sin la carga histórica abierta", () => {
    expect(puede("concluir", expediente({ pasoFinal: true }), liquidacion)).toBe(true);
    expect(evaluarPermiso("concluir", expediente({ pasoFinal: false }), liquidacion)).toEqual({ permitido: false, motivo: "no_es_paso_final" });
    expect(evaluarPermiso("concluir", expediente({ pasoFinal: true, cargaHistorica: true }), liquidacion)).toEqual({
      permitido: false,
      motivo: "carga_historica_abierta",
    });
    expect(evaluarPermiso("concluir", expediente({ pasoFinal: true }), mesa)).toEqual({ permitido: false, motivo: "no_es_responsable" });
    expect(evaluarPermiso("concluir", expediente({ pasoFinal: true }), admin)).toEqual({ permitido: false, motivo: "admin_no_opera" });
    expect(evaluarPermiso("concluir", expediente({ pasoFinal: true, estado: "concluido" }), liquidacion)).toEqual({
      permitido: false,
      motivo: "estado_no_admite",
    });
  });

  it("archivar un concluido: responsable, Mesa y admin; no un expediente en trámite", () => {
    const concluido = expediente({ estado: "concluido" });
    for (const u of [liquidacion, mesa, admin]) expect(puede("archivar_concluido", concluido, u)).toBe(true);
    expect(puede("archivar_concluido", concluido, legal)).toBe(false);
    expect(evaluarPermiso("archivar_concluido", expediente(), mesa)).toEqual({ permitido: false, motivo: "estado_no_admite" });
  });

  it("archivar sin concluir, anular y reiniciar: solo en estados activos; desarchivar, solo un archivado", () => {
    for (const accion of ["archivar_sin_concluir", "anular", "reiniciar_con_otra_plantilla"] as const) {
      expect(puede(accion, expediente({ estado: "espera_pago_dim" }), mesa)).toBe(true);
      for (const estado of ["concluido", "archivado", "anulado"] as const) {
        expect(evaluarPermiso(accion, expediente({ estado }), admin)).toEqual({ permitido: false, motivo: "estado_no_admite" });
      }
    }
    expect(evaluarPermiso("desarchivar", expediente(), mesa)).toEqual({ permitido: false, motivo: "estado_no_admite" });
    expect(puede("desarchivar", expediente({ estado: "archivado" }), admin)).toBe(true);
    expect(evaluarPermiso("desarchivar", expediente({ estado: "archivado" }), liquidacion)).toEqual({ permitido: false, motivo: "area_no_habilitada" });
  });

  it("reabrir: solo el admin y solo un anulado", () => {
    expect(puede("reabrir", expediente({ estado: "anulado" }), admin)).toBe(true);
    expect(evaluarPermiso("reabrir", expediente({ estado: "archivado" }), admin)).toEqual({ permitido: false, motivo: "estado_no_admite" });
    expect(evaluarPermiso("reabrir", expediente({ estado: "anulado" }), mesa)).toEqual({ permitido: false, motivo: "solo_admin" });
    expect(evaluarPermiso("reabrir", expediente({ estado: "anulado" }), direccion)).toEqual({ permitido: false, motivo: "solo_lectura" });
  });

  it("cambiar la ubicación de archivo: un archivado, quien archiva", () => {
    const archivado = expediente({ estado: "archivado" });
    for (const u of [mesa, admin, liquidacion]) expect(puede("cambiar_ubicacion_archivo", archivado, u)).toBe(true);
    expect(puede("cambiar_ubicacion_archivo", archivado, legal)).toBe(false);
    expect(evaluarPermiso("cambiar_ubicacion_archivo", expediente(), mesa)).toEqual({ permitido: false, motivo: "estado_no_admite" });
  });

  it("transcribir: Mesa y admin, con la carga histórica abierta", () => {
    const abierta = expediente({ cargaHistorica: true });
    expect(puede("transcribir", abierta, mesa)).toBe(true);
    expect(puede("transcribir", { ...abierta, estado: "archivado" }, admin)).toBe(true);
    expect(evaluarPermiso("transcribir", expediente(), mesa)).toEqual({ permitido: false, motivo: "sin_carga_historica" });
    expect(evaluarPermiso("transcribir", abierta, liquidacion)).toEqual({ permitido: false, motivo: "area_no_habilitada" });
    expect(evaluarPermiso("transcribir", { ...abierta, estado: "anulado" }, mesa)).toEqual({ permitido: false, motivo: "estado_no_admite" });
  });

  it("corregir en archivado y anulado: solo el admin, salvo retirar un adjunto propio", () => {
    const ahora = new Date("2026-10-20T12:00:00Z");
    const propio = { movimiento: { usuarioId: liquidacion.id, registradoEn: new Date("2026-10-19T12:00:00Z") }, ahora };
    expect(puede("corregir_movimiento", expediente(), liquidacion, propio)).toBe(true);
    for (const estado of ["archivado", "anulado"] as const) {
      expect(evaluarPermiso("corregir_movimiento", expediente({ estado }), liquidacion, propio)).toEqual({ permitido: false, motivo: "estado_no_admite" });
      expect(puede("corregir_movimiento", expediente({ estado }), liquidacion, { ...propio, retirarAdjunto: true })).toBe(true);
      expect(puede("corregir_movimiento", expediente({ estado }), admin)).toBe(true);
    }
  });

  it("nota: todos menos Dirección", () => {
    for (const u of [mesa, liquidacion, legal, admin]) expect(puede("nota", expediente({ estado: "anulado" }), u)).toBe(true);
    expect(puede("nota", expediente(), direccion)).toBe(false);
  });
});
