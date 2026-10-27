import { describe, expect, it, vi } from "vitest";
import { ErrorDominio } from "../expedientes/errores";
import {
  CLAVE_PERFIL_ADMIN,
  cambiarPerfilDePrueba,
  crearServicioPerfilPrueba,
  cuilHabilitado,
  ModoPruebaInexistente,
  motivoCambio,
  opcionesPerfilPrueba,
  perfilActualDe,
  perfilesDesdeAreas,
  PerfilPruebaDenegado,
  rolDelArea,
  type DependenciasPerfilPrueba,
} from "./perfil-prueba";

// Modo prueba ("Ver como…"): lo puro y la autorización con dependencias falsas.
// Contra la base real: tests/integracion/perfil-prueba.test.ts. Todos los CUIL
// son ficticios (los de la semilla de desarrollo).

const AREAS = [
  { id: 1, codigo: "MESA_ENTRADAS", nombre: "Mesa de Entradas" },
  { id: 2, codigo: "COMPUTO", nombre: "Cómputo" },
  { id: 3, codigo: "LIQUIDACION", nombre: "Liquidación" },
  { id: 4, codigo: "LEGAL", nombre: "Asesoría Legal" },
  { id: 5, codigo: "ADMINISTRATIVO", nombre: "Administrativo" },
  { id: 6, codigo: "TRIBUTARIO", nombre: "Departamento Tributario / Notificación" },
  { id: 7, codigo: "DIRECCION", nombre: "Dirección" },
];

const HABILITADO = "20000000001";
const OTRO = "27000000022";

interface FilaFalsa {
  cuil: string;
  activo: boolean;
  rol: string;
  area_id: number | null;
}

/** Dependencias falsas: una fila de usuario (id 50), las áreas y un conActor que registra lo que pasa. */
function depsFalsas(opciones: { cuils?: string[]; fila?: Partial<FilaFalsa>; otrosAdmins?: number } = {}) {
  const fila: FilaFalsa = { cuil: HABILITADO, activo: true, rol: "admin", area_id: null, ...opciones.fila };
  const escrituras: Array<{ areaId: number | null; rol: string }> = [];
  const motivos: string[] = [];
  const tx = {
    $queryRaw: vi.fn(async (partes: TemplateStringsArray) => {
      const texto = partes.join("?");
      if (texto.includes("FOR UPDATE")) return [fila];
      if (texto.includes("count(*)")) return [{ n: opciones.otrosAdmins ?? 1 }];
      throw new Error(`consulta inesperada: ${texto}`);
    }),
    $executeRaw: vi.fn(async (_partes: TemplateStringsArray, motivo: string) => {
      motivos.push(motivo);
      return 1;
    }),
    usuario: {
      update: vi.fn(async ({ data }: { data: { areaId: number | null; rol: string } }) => {
        escrituras.push(data);
        return {};
      }),
    },
  };
  const escribir = vi.fn(async (_usuarioId: number, motivo: string | null, fn: (t: typeof tx) => Promise<unknown>) => {
    motivos.push(motivo ?? "");
    return fn(tx);
  });
  const deps = {
    leer: {
      usuario: { findUnique: vi.fn(async () => ({ cuil: fila.cuil, activo: fila.activo })) },
      area: { findMany: vi.fn(async () => AREAS) },
    },
    escribir,
    cuils: () => new Set(opciones.cuils ?? [HABILITADO]),
  } as unknown as DependenciasPerfilPrueba;
  return { deps, escribir, escrituras, motivos, tx };
}

describe("perfiles", () => {
  it("uno por área interna (Dirección como lectura, el resto operador) y Administrador sin área al final", () => {
    const perfiles = perfilesDesdeAreas(AREAS);
    expect(perfiles.map((p) => [p.clave, p.rol])).toEqual([
      ["area:MESA_ENTRADAS", "operador"],
      ["area:COMPUTO", "operador"],
      ["area:LIQUIDACION", "operador"],
      ["area:LEGAL", "operador"],
      ["area:ADMINISTRATIVO", "operador"],
      ["area:TRIBUTARIO", "operador"],
      ["area:DIRECCION", "lectura"],
      ["admin", "admin"],
    ]);
    expect(perfiles.at(-1)).toEqual({ clave: CLAVE_PERFIL_ADMIN, etiqueta: "Administrador", rol: "admin", area: null });
    expect(perfiles[2]).toMatchObject({ etiqueta: "Liquidación", area: { id: 3, codigo: "LIQUIDACION" } });
    expect(rolDelArea("DIRECCION")).toBe("lectura");
    expect(rolDelArea("CUALQUIERA")).toBe("operador");
  });

  it("el perfil actual sale del rol y el área; el admin es Administrador aunque tenga área", () => {
    const perfiles = perfilesDesdeAreas(AREAS);
    expect(perfilActualDe({ rol: "operador", area: { id: 3 } }, perfiles)?.clave).toBe("area:LIQUIDACION");
    expect(perfilActualDe({ rol: "lectura", area: { id: 7 } }, perfiles)?.clave).toBe("area:DIRECCION");
    expect(perfilActualDe({ rol: "admin", area: null }, perfiles)?.clave).toBe("admin");
    expect(perfilActualDe({ rol: "admin", area: { id: 2 } }, perfiles)?.clave).toBe("admin");
    // Lectura en Liquidación no es ningún perfil de la lista.
    expect(perfilActualDe({ rol: "lectura", area: { id: 3 } }, perfiles)).toBeNull();
  });

  it("el motivo dice el perfil y, si corresponde, que no queda otro admin", () => {
    expect(motivoCambio({ etiqueta: "Liquidación" })).toBe("Modo prueba: ver como Liquidación");
    expect(motivoCambio({ etiqueta: "Liquidación" }, true)).toBe("Modo prueba: ver como Liquidación (sin otro administrador activo mientras dure)");
  });

  it("cuilHabilitado: solo los de la lista; con la lista vacía, nadie", () => {
    expect(cuilHabilitado(new Set([HABILITADO]), HABILITADO)).toBe(true);
    expect(cuilHabilitado(new Set([HABILITADO]), OTRO)).toBe(false);
    expect(cuilHabilitado(new Set(), HABILITADO)).toBe(false);
    expect(cuilHabilitado(new Set([HABILITADO]), null)).toBe(false);
  });
});

describe("opciones del selector", () => {
  const usuario = { id: 50, rol: "admin" as const, activo: true, area: null, cuil: HABILITADO };

  it("para un CUIL habilitado: los perfiles y el actual", async () => {
    const { deps } = depsFalsas();
    const o = await opcionesPerfilPrueba(deps, usuario);
    expect(o?.actual).toBe("admin");
    expect(o?.perfiles).toHaveLength(8);
  });

  it("null sin la variable, con otro CUIL o inactivo (y sin leer las áreas)", async () => {
    for (const [deps, u] of [
      [depsFalsas({ cuils: [] }).deps, usuario],
      [depsFalsas().deps, { ...usuario, cuil: OTRO }],
      [depsFalsas().deps, { ...usuario, activo: false }],
    ] as const) {
      expect(await opcionesPerfilPrueba(deps, u)).toBeNull();
      expect(deps.leer.area.findMany).not.toHaveBeenCalled();
    }
    expect(crearServicioPerfilPrueba(depsFalsas({ cuils: [] }).deps).activo()).toBe(false);
    expect(crearServicioPerfilPrueba(depsFalsas().deps).activo()).toBe(true);
  });
});

describe("cambiarPerfilDePrueba: autorización", () => {
  it("sin PERFILES_PRUEBA_CUILS la acción no existe: ModoPruebaInexistente, sin leer ni escribir", async () => {
    const { deps, escribir } = depsFalsas({ cuils: [] });
    await expect(cambiarPerfilDePrueba(deps, { id: 50 }, "area:LIQUIDACION")).rejects.toBeInstanceOf(ModoPruebaInexistente);
    expect(deps.leer.usuario.findUnique).not.toHaveBeenCalled();
    expect(escribir).not.toHaveBeenCalled();
  });

  it("un CUIL que no está en la lista (el de la base, no otro): PerfilPruebaDenegado, sin escribir", async () => {
    const { deps, escribir } = depsFalsas({ fila: { cuil: OTRO } });
    await expect(cambiarPerfilDePrueba(deps, { id: 50 }, "area:LIQUIDACION")).rejects.toBeInstanceOf(PerfilPruebaDenegado);
    expect(escribir).not.toHaveBeenCalled();
    // Ni a un inactivo, ni a SISTEMA.
    await expect(cambiarPerfilDePrueba(depsFalsas({ fila: { activo: false } }).deps, { id: 50 }, "admin")).rejects.toBeInstanceOf(PerfilPruebaDenegado);
    await expect(cambiarPerfilDePrueba(depsFalsas().deps, { id: 1 }, "admin")).rejects.toBeInstanceOf(PerfilPruebaDenegado);
  });

  it("el CUIL se vuelve a mirar en la transacción: si cambió en el medio, no escribe", async () => {
    const f = depsFalsas();
    // La lectura de afuera ve el habilitado; la fila bloqueada, otro CUIL.
    f.tx.$queryRaw.mockImplementationOnce(async () => [{ cuil: OTRO, activo: true, rol: "admin", area_id: null }]);
    await expect(cambiarPerfilDePrueba(f.deps, { id: 50 }, "area:LIQUIDACION")).rejects.toBeInstanceOf(PerfilPruebaDenegado);
    expect(f.escrituras).toEqual([]);
  });

  it("un perfil que no existe: validación", async () => {
    const { deps, escribir } = depsFalsas();
    for (const destino of ["area:DIM", "area:NO_EXISTE", "", 42, null]) {
      const e = await cambiarPerfilDePrueba(deps, { id: 50 }, destino).catch((x: unknown) => x);
      expect(e).toBeInstanceOf(ErrorDominio);
      expect((e as ErrorDominio).codigo).toBe("validacion");
    }
    expect(escribir).not.toHaveBeenCalled();
  });

  it("habilitado: cambia solo área y rol de su fila, con el motivo; vuelve a Administrador sin área", async () => {
    const f = depsFalsas({ otrosAdmins: 1 });
    const r = await cambiarPerfilDePrueba(f.deps, { id: 50 }, "area:LIQUIDACION");
    expect(r).toMatchObject({ destino: "/bandeja", repetido: false, sinOtroAdmin: false, perfil: { clave: "area:LIQUIDACION" } });
    expect(f.escribir).toHaveBeenCalledWith(50, "Modo prueba: ver como Liquidación", expect.any(Function));
    expect(f.escrituras).toEqual([{ areaId: 3, rol: "operador" }]);
    expect(f.tx.usuario.update).toHaveBeenCalledWith({ where: { id: 50 }, data: { areaId: 3, rol: "operador" } });

    const g = depsFalsas({ fila: { rol: "operador", area_id: 3 } });
    expect(await cambiarPerfilDePrueba(g.deps, { id: 50 }, "admin")).toMatchObject({ destino: "/panel", repetido: false });
    expect(g.escrituras).toEqual([{ areaId: null, rol: "admin" }]);

    const d = depsFalsas({ fila: { rol: "operador", area_id: 3 } });
    expect(await cambiarPerfilDePrueba(d.deps, { id: 50 }, "area:DIRECCION")).toMatchObject({ destino: "/panel" });
    expect(d.escrituras).toEqual([{ areaId: 7, rol: "lectura" }]);
  });

  it("el mismo perfil: repetido, sin escribir", async () => {
    const f = depsFalsas({ fila: { rol: "operador", area_id: 3 } });
    expect(await cambiarPerfilDePrueba(f.deps, { id: 50 }, "area:LIQUIDACION")).toMatchObject({ repetido: true });
    expect(f.escrituras).toEqual([]);
  });

  it("sin otro administrador activo se permite igual, y el motivo lo dice", async () => {
    const f = depsFalsas({ otrosAdmins: 0 });
    const r = await cambiarPerfilDePrueba(f.deps, { id: 50 }, "area:COMPUTO");
    expect(r).toMatchObject({ repetido: false, sinOtroAdmin: true });
    expect(f.escrituras).toEqual([{ areaId: 2, rol: "operador" }]);
    expect(f.motivos.at(-1)).toBe("Modo prueba: ver como Cómputo (sin otro administrador activo mientras dure)");
  });
});
