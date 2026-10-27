// Modo prueba, "Ver como…" (src/lib/dominio/admin/perfil-prueba.ts;
// docs/api-dominio.md, sección 23) contra la base real: el cambio de perfil de
// un CUIL habilitado, el rechazo de uno que no lo está, la auditoría, un pase
// hecho como Liquidación y que sin PERFILES_PRUEBA_CUILS la acción no existe.
//
// Todo lo del modo prueba corre en una transacción que se deshace (./admin.ts):
// los administradores activos los comparten todos los tests. Los CUILs son
// ficticios (cuilFicticio) y la lista de habilitados se arma acá, no se lee
// del entorno.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SELECCION_USUARIO, usuarioDeSesion } from "@/lib/auth/usuario";
import type { Transaccion } from "@/lib/db/crear-cliente";
import { crearServicioPerfilPrueba, ModoPruebaInexistente, PerfilPruebaDenegado, type ServicioPerfilPrueba } from "@/lib/dominio/admin";
import type { Escritor } from "@/lib/dominio/expedientes";
import { puede, type UsuarioPermisos } from "@/lib/dominio/permisos";
import { MENSAJE_PERFIL_DENEGADO, procesarCambioPerfilPrueba } from "@/lib/presentacion/acciones-perfil-prueba";
import { comoUsuario, conServiciosQueSeDeshacen, cuilFicticio } from "./admin";
import { asegurarSemilla, avanzar, comando, completarPaso, datosAlta, idArea, proyeccion, servicio, usuario } from "./dominio";
import { clientePrisma } from "./helper";

const prisma = clientePrisma();
let yo: UsuarioPermisos;
let mesa: UsuarioPermisos;
let liquidacion: number;

beforeAll(async () => {
  await asegurarSemilla(prisma);
  [yo, mesa] = await Promise.all([usuario(prisma, "ADMIN"), usuario(prisma, "MESA_ENTRADAS")]);
  liquidacion = await idArea(prisma, "LIQUIDACION");
});
afterAll(() => prisma.$disconnect());

/** El servicio del modo prueba sobre la transacción del test, con esos CUILs habilitados. */
function modoPrueba(tx: Transaccion, escribir: Escritor, cuils: string[]): ServicioPerfilPrueba {
  return crearServicioPerfilPrueba({ leer: tx, escribir, cuils: () => new Set(cuils) });
}

/** Un administrador nuevo (sin área), con un CUIL ficticio. */
async function adminDePrueba(alta: (entrada: unknown) => Promise<{ id: number }>): Promise<{ id: number; cuil: string }> {
  const cuil = cuilFicticio();
  const { id } = await alta({ cuil, nombre: "Probador", apellido: "Ficticio", areaId: null, rol: "admin" });
  return { id, cuil };
}

async function cambiosDe(tx: Transaccion, id: number) {
  return tx.auditoriaCambio.findMany({ where: { tabla: "usuarios", registroId: String(id), operacion: "U" }, orderBy: { id: "asc" } });
}

describe("modo prueba: cambiar de perfil", () => {
  it("un CUIL habilitado pasa a Liquidación y vuelve a Administrador; la sesión sigue; queda en auditoria.cambios", async () => {
    await conServiciosQueSeDeshacen(prisma, async ({ admin, tx, escribir }) => {
      const t = await adminDePrueba((e) => admin.altaUsuario(yo, e));
      const perfil = modoPrueba(tx, escribir, [t.cuil]);
      const antes = await tx.usuario.findUniqueOrThrow({ where: { id: t.id }, select: SELECCION_USUARIO });
      const sesion = { usuarioId: t.id, sesionVersion: antes.sesionVersion, inicio: 0, emitidaEn: 0 };

      const opciones = await perfil.opciones({ ...(await comoUsuario(tx, t.id)), cuil: t.cuil });
      expect(opciones?.actual).toBe("admin");
      // Las áreas internas de la semilla (en su orden) y Administrador al final; ni la DIM ni los cementerios.
      const claves = opciones?.perfiles.map((p) => p.clave) ?? [];
      const semilla = ["area:MESA_ENTRADAS", "area:COMPUTO", "area:LIQUIDACION", "area:LEGAL", "area:ADMINISTRATIVO", "area:TRIBUTARIO", "area:DIRECCION"];
      expect(claves.filter((c) => semilla.includes(c))).toEqual(semilla);
      expect(claves.at(-1)).toBe("admin");
      expect(claves).not.toContain("area:DIM");
      expect(opciones?.perfiles.find((p) => p.clave === "area:DIRECCION")?.rol).toBe("lectura");
      expect(opciones?.perfiles.find((p) => p.clave === "area:LIQUIDACION")?.rol).toBe("operador");

      const r = await procesarCambioPerfilPrueba(perfil, await comoUsuario(tx, t.id), { clave: "area:LIQUIDACION" });
      expect(r).toEqual({ ok: true, destino: "/bandeja", repetido: false, sinOtroAdmin: false, mensaje: "Ahora estás viendo como Liquidación." });

      const despues = await tx.usuario.findUniqueOrThrow({ where: { id: t.id }, select: SELECCION_USUARIO });
      expect(despues).toMatchObject({ rol: "operador", area: { id: liquidacion, codigo: "LIQUIDACION" }, activo: true });
      // No incrementa sesion_version: la cookie que tenía sigue valiendo, ahora como Liquidación.
      expect(despues.sesionVersion).toBe(antes.sesionVersion);
      expect(usuarioDeSesion(despues, sesion)).toMatchObject({ rol: "operador", area: { codigo: "LIQUIDACION" } });
      const comoLiquidacion = await comoUsuario(tx, t.id);
      expect(puede("ver_bandeja", null, comoLiquidacion)).toBe(true);
      expect(puede("administrar", null, comoLiquidacion)).toBe(false);
      expect((await perfil.opciones({ ...comoLiquidacion, cuil: t.cuil }))?.actual).toBe("area:LIQUIDACION");

      const [ida] = await cambiosDe(tx, t.id);
      expect(ida).toMatchObject({
        usuarioId: t.id,
        motivo: "Modo prueba: ver como Liquidación",
        antes: { id: t.id, cuil: t.cuil, rol: "admin", area_id: null, activo: true },
        despues: { id: t.id, cuil: t.cuil, rol: "operador", area_id: liquidacion, activo: true },
      });

      // Vuelta a Administrador (sin área), desde el perfil de operador.
      const vuelta = await procesarCambioPerfilPrueba(perfil, comoLiquidacion, { clave: "admin" });
      expect(vuelta).toMatchObject({ ok: true, destino: "/panel", repetido: false });
      expect(await tx.usuario.findUniqueOrThrow({ where: { id: t.id }, select: { rol: true, areaId: true, sesionVersion: true } })).toEqual({
        rol: "admin",
        areaId: null,
        sesionVersion: antes.sesionVersion,
      });
      const cambios = await cambiosDe(tx, t.id);
      expect(cambios).toHaveLength(2);
      expect(cambios[1]).toMatchObject({
        usuarioId: t.id,
        motivo: "Modo prueba: ver como Administrador",
        antes: { rol: "operador", area_id: liquidacion },
        despues: { rol: "admin", area_id: null },
      });

      // Repetir no escribe ni audita.
      expect(await procesarCambioPerfilPrueba(perfil, await comoUsuario(tx, t.id), { clave: "admin" })).toMatchObject({ ok: true, repetido: true });
      expect(await cambiosDe(tx, t.id)).toHaveLength(2);
    });
  });

  it("un CUIL que no está en la lista recibe permiso denegado, y nada cambia", async () => {
    await conServiciosQueSeDeshacen(prisma, async ({ admin, tx, escribir }) => {
      const habilitado = await adminDePrueba((e) => admin.altaUsuario(yo, e));
      const otro = await adminDePrueba((e) => admin.altaUsuario(yo, e));
      const perfil = modoPrueba(tx, escribir, [habilitado.cuil]);
      const u = await comoUsuario(tx, otro.id);

      expect(await perfil.opciones({ ...u, cuil: otro.cuil })).toBeNull();
      await expect(perfil.cambiar(u, "area:LIQUIDACION")).rejects.toBeInstanceOf(PerfilPruebaDenegado);
      expect(await procesarCambioPerfilPrueba(perfil, u, { clave: "area:LIQUIDACION" })).toEqual({
        ok: false,
        codigo: "permiso",
        mensaje: MENSAJE_PERFIL_DENEGADO,
        errores: [],
      });
      // El CUIL que vale es el de la base: un objeto que diga traer el habilitado no sirve.
      const conOtroCuil = { ...u, cuil: habilitado.cuil } as UsuarioPermisos;
      await expect(perfil.cambiar(conOtroCuil, "area:COMPUTO")).rejects.toBeInstanceOf(PerfilPruebaDenegado);
      expect(await tx.usuario.findUniqueOrThrow({ where: { id: otro.id }, select: { rol: true, areaId: true } })).toEqual({ rol: "admin", areaId: null });
      expect(await cambiosDe(tx, otro.id)).toEqual([]);
      // El seed: un operador de verdad tampoco.
      await expect(perfil.cambiar(mesa, "admin")).rejects.toBeInstanceOf(PerfilPruebaDenegado);
    });
  });

  it("perfiles que no existen o no se asignan: validación (el área externa no es un perfil)", async () => {
    await conServiciosQueSeDeshacen(prisma, async ({ admin, tx, escribir }) => {
      const t = await adminDePrueba((e) => admin.altaUsuario(yo, e));
      const perfil = modoPrueba(tx, escribir, [t.cuil]);
      const u = await comoUsuario(tx, t.id);
      for (const clave of ["area:DIM", "area:CEM_OESTE", "area:NO_EXISTE", "operador"]) {
        expect(await procesarCambioPerfilPrueba(perfil, u, { clave })).toMatchObject({ ok: false, codigo: "validacion" });
      }
      expect(await procesarCambioPerfilPrueba(perfil, u, { clave: 7 })).toMatchObject({ ok: false, codigo: "validacion" });
      expect(await cambiosDe(tx, t.id)).toEqual([]);
    });
  });

  it("sin otro administrador activo el cambio se permite igual y queda registrado en el motivo", async () => {
    await conServiciosQueSeDeshacen(prisma, async ({ admin, tx, escribir, comoActor }) => {
      const t = await adminDePrueba((e) => admin.altaUsuario(yo, e));
      // Dentro de la transacción que se deshace: el único admin activo es t.
      await comoActor(t.id, "Prueba: queda un solo administrador");
      await tx.usuario.updateMany({ where: { rol: "admin", activo: true, id: { notIn: [1, t.id] } }, data: { activo: false } });

      const perfil = modoPrueba(tx, escribir, [t.cuil]);
      const r = await procesarCambioPerfilPrueba(perfil, await comoUsuario(tx, t.id), { clave: "area:COMPUTO" });
      expect(r).toMatchObject({ ok: true, sinOtroAdmin: true, destino: "/bandeja" });
      expect(await tx.usuario.count({ where: { rol: "admin", activo: true, id: { not: 1 } } })).toBe(0);
      expect((await cambiosDe(tx, t.id)).at(-1)).toMatchObject({
        motivo: "Modo prueba: ver como Cómputo (sin otro administrador activo mientras dure)",
        despues: { rol: "operador" },
      });
      // Y vuelve: Administrador siempre está en la lista.
      expect(await procesarCambioPerfilPrueba(perfil, await comoUsuario(tx, t.id), { clave: "admin" })).toMatchObject({ ok: true, sinOtroAdmin: false });
      expect(await tx.usuario.count({ where: { rol: "admin", activo: true, id: { not: 1 } } })).toBe(1);
    });
  });

  it("como Dirección: rol lectura con el área de Dirección (CHECK y trigger de área interna)", async () => {
    await conServiciosQueSeDeshacen(prisma, async ({ admin, tx, escribir }) => {
      const t = await adminDePrueba((e) => admin.altaUsuario(yo, e));
      const perfil = modoPrueba(tx, escribir, [t.cuil]);
      expect(await procesarCambioPerfilPrueba(perfil, await comoUsuario(tx, t.id), { clave: "area:DIRECCION" })).toMatchObject({ ok: true, destino: "/panel" });
      const u = await comoUsuario(tx, t.id);
      expect(u).toMatchObject({ rol: "lectura", area: { codigo: "DIRECCION" } });
      expect(puede("ver_metricas", null, u)).toBe(true);
      expect(puede("ver_bandeja", null, u)).toBe(false);
    });
  });
});

describe("modo prueba: lo que se hace como otro perfil", () => {
  it("un pase dado como Liquidación queda con area_usuario_id de Liquidación y el usuario de prueba como autor", async () => {
    // El expediente, confirmado (como en pases.test.ts): alta en Mesa y dos pases hasta Liquidación.
    const exp = servicio(prisma);
    const alta = await exp.alta(mesa, await datosAlta(prisma), comando());
    await avanzar(exp, prisma, alta.numero);
    await avanzar(exp, prisma, alta.numero);
    expect((await proyeccion(prisma, alta.numero)).areaResponsable.codigo).toBe("LIQUIDACION");
    const version = await completarPaso(exp, prisma, alta.numero);

    await conServiciosQueSeDeshacen(prisma, async ({ admin, expedientes, tx, escribir }) => {
      const t = await adminDePrueba((e) => admin.altaUsuario(yo, e));
      const perfil = modoPrueba(tx, escribir, [t.cuil]);
      // Como admin no opera (3.2)…
      await expect(expedientes.validarPase(await comoUsuario(tx, t.id), alta.numero)).resolves.toMatchObject({ permiso: { permitido: false } });
      // …como Liquidación, sí.
      expect(await procesarCambioPerfilPrueba(perfil, await comoUsuario(tx, t.id), { clave: "area:LIQUIDACION" })).toMatchObject({ ok: true });
      const comoLiquidacion = await comoUsuario(tx, t.id);
      const v = await expedientes.validarPase(comoLiquidacion, alta.numero);
      const siguiente = v.destinos.find((d) => d.tipo === "siguiente");
      expect(siguiente).toBeDefined();
      await expedientes.darPase(comoLiquidacion, alta.numero, siguiente?.clave ?? "", version, comando());

      const e = await tx.expediente.findUniqueOrThrow({ where: { numeroInterno: alta.numero }, select: { id: true } });
      const pase = await tx.movimiento.findFirstOrThrow({ where: { expedienteId: e.id, tipo: "pase" }, orderBy: { secuencia: "desc" } });
      expect(pase).toMatchObject({ usuarioId: t.id, areaUsuarioId: liquidacion, areaOrigenId: liquidacion });
    });
  });
});

describe("modo prueba apagado", () => {
  it("sin PERFILES_PRUEBA_CUILS la acción no existe: ni opciones ni cambio, y la acción no lo traduce (responde 404)", async () => {
    await conServiciosQueSeDeshacen(prisma, async ({ admin, tx, escribir }) => {
      const t = await adminDePrueba((e) => admin.altaUsuario(yo, e));
      const perfil = modoPrueba(tx, escribir, []);
      const u = await comoUsuario(tx, t.id);
      expect(perfil.activo()).toBe(false);
      expect(await perfil.opciones({ ...u, cuil: t.cuil })).toBeNull();
      await expect(perfil.cambiar(u, "area:LIQUIDACION")).rejects.toBeInstanceOf(ModoPruebaInexistente);
      // La lógica de la Server Action la deja subir: la acción hace notFound() antes.
      await expect(procesarCambioPerfilPrueba(perfil, u, { clave: "area:LIQUIDACION" })).rejects.toBeInstanceOf(ModoPruebaInexistente);
      expect(await cambiosDe(tx, t.id)).toEqual([]);
    });
  });
});
