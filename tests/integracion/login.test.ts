// Login propio (27/10/2026; docs/api-dominio.md, sección 22) contra la base
// efímera: ingreso, rechazos, bloqueo y desbloqueo, cambio obligatorio,
// blanqueo, auditoría sin contraseñas y el admin inicial de producción.
//
// Las escrituras del ingreso van en sus propias transacciones (conActor), así
// que este archivo CONFIRMA lo que hace: cada test usa usuarios nuevos, con un
// CUIL ficticio único, y no mira conteos globales.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sembrar } from "../../prisma/semilla/sembrar";
import { RE_CLAVE_TEMPORAL, verificarClave } from "@/lib/auth/clave";
import { cambiarClave, ingresarConClave, mensajeDeRechazo, type DependenciasClave } from "@/lib/auth/ingreso-clave";
import { LimitePorIp } from "@/lib/auth/limite-intentos";
import { SELECCION_USUARIO, usuarioDeSesion } from "@/lib/auth/usuario";
import { conActorEn } from "@/lib/db/actor";
import type { UsuarioPermisos } from "@/lib/dominio/permisos";
import { cuilFicticio, servicioAdmin } from "./admin";
import { asegurarSemilla, idArea, usuario } from "./dominio";
import { SISTEMA, clientePrisma } from "./helper";

const prisma = clientePrisma();
let yo: UsuarioPermisos;
let mesa: number;
/** Usuarios que crea este archivo: se desactivan al final. */
const creados: number[] = [];

beforeAll(async () => {
  await asegurarSemilla(prisma);
  yo = await usuario(prisma, "ADMIN");
  mesa = await idArea(prisma, "MESA_ENTRADAS");
});

afterAll(async () => {
  await conActorEn(prisma, SISTEMA, "Fin de las pruebas del login propio", (tx) =>
    tx.usuario.updateMany({ where: { id: { in: creados } }, data: { activo: false, sesionVersion: { increment: 1 } } }),
  );
  await prisma.$disconnect();
});

/** Dependencias del ingreso con la base de prueba, un reloj que se puede mover y su propio límite por IP. */
function dependencias(reloj = { ahora: new Date() }): DependenciasClave & { reloj: { ahora: Date } } {
  return {
    leer: prisma,
    escribir: (u, m, fn) => conActorEn(prisma, u, m, fn),
    ahora: () => reloj.ahora,
    limiteIp: new LimitePorIp({ ahora: () => reloj.ahora.getTime() }),
    reloj,
  };
}

/** Un usuario nuevo dado de alta por el admin, con su contraseña temporal. */
async function alta(extra: { email?: string; apellido?: string } = {}): Promise<{ id: number; cuil: string; temporal: string }> {
  const cuil = cuilFicticio();
  const r = await servicioAdmin(prisma).altaUsuario(yo, { cuil, nombre: "Prueba", apellido: extra.apellido ?? "Login", email: extra.email ?? "", areaId: mesa, rol: "operador" });
  if (!r.claveTemporal) throw new Error("El alta no devolvió la contraseña temporal");
  creados.push(r.id);
  return { id: r.id, cuil, temporal: r.claveTemporal };
}

/** Lo que vería getUsuarioActual() con una cookie de esa versión. */
async function sesionVale(id: number, sesionVersion: number) {
  const fila = await prisma.usuario.findUniqueOrThrow({ where: { id }, select: SELECCION_USUARIO });
  return usuarioDeSesion(fila, { usuarioId: id, sesionVersion, emitidaEn: 0, inicio: 0 });
}

const NUEVA = "el mate de la tarde con tortillas";

describe("ingreso con CUIL o correo y contraseña", () => {
  it("correcto (CUIL con guiones, o el correo): entra y queda el ingreso en auditoria.accesos", async () => {
    const correo = `prueba.${Date.now()}@ejemplo.invalid`;
    const u = await alta({ email: correo });
    const deps = dependencias();
    const conGuiones = `${u.cuil.slice(0, 2)}-${u.cuil.slice(2, 10)}-${u.cuil.slice(10)}`;
    const r = await ingresarConClave(deps, { identificador: conGuiones, clave: u.temporal }, "10.0.0.1");
    expect(r).toMatchObject({ ok: true, usuario: { id: u.id, debeCambiarClave: true } });
    expect((await ingresarConClave(deps, { identificador: correo.toUpperCase(), clave: u.temporal }, null)).ok).toBe(true);

    const accesos = await prisma.auditoriaAcceso.findMany({ where: { usuarioId: u.id, accion: "ingreso" } });
    expect(accesos).toHaveLength(2);
    expect(accesos[0]).toMatchObject({ ip: "10.0.0.1", detalle: { via: "clave", debe_cambiar_clave: true } });
  });

  it("incorrecto, inexistente e inactivo: el mismo mensaje; el motivo real queda en la auditoría", async () => {
    const u = await alta();
    const deps = dependencias();
    const incorrecta = await ingresarConClave(deps, { identificador: u.cuil, clave: "no-es-la-contraseña" }, null);
    const inexistente = await ingresarConClave(deps, { identificador: cuilFicticio(), clave: u.temporal }, null);
    await servicioAdmin(prisma).desactivarUsuario(yo, u.id, "Prueba del login con un usuario inactivo");
    const inactivo = await ingresarConClave(deps, { identificador: u.cuil, clave: u.temporal }, null);

    expect([incorrecta, inexistente, inactivo].map((r) => !r.ok && r.motivo)).toEqual(["clave_incorrecta", "sin_usuario", "inactivo"]);
    const mensajes = new Set([incorrecta, inexistente, inactivo].map((r) => (r.ok ? "" : mensajeDeRechazo(r.motivo))));
    expect([...mensajes]).toEqual(["CUIL, correo o contraseña incorrectos"]);

    const rechazos = await prisma.auditoriaAcceso.findMany({ where: { usuarioId: u.id, accion: "ingreso_rechazado" }, orderBy: { id: "asc" } });
    expect(rechazos.map((f) => (f.detalle as { motivo: string }).motivo)).toEqual(["clave_incorrecta", "inactivo"]);
  });

  it("cinco fallos seguidos bloquean 15 minutos (también con la correcta); vence solo, o lo desbloquea un admin", async () => {
    const u = await alta();
    const deps = dependencias({ ahora: new Date() });
    for (let i = 1; i <= 5; i++) {
      const r = await ingresarConClave(deps, { identificador: u.cuil, clave: `mal-${i}-contraseña` }, null);
      expect(r).toMatchObject({ ok: false, motivo: "clave_incorrecta", bloqueo: i === 5 });
    }
    const fila = await prisma.usuario.findUniqueOrThrow({ where: { id: u.id }, select: { intentosFallidos: true, bloqueadoHasta: true } });
    expect(fila.intentosFallidos).toBe(0);
    expect(fila.bloqueadoHasta?.getTime()).toBe(deps.reloj.ahora.getTime() + 15 * 60_000);
    expect(await prisma.auditoriaAcceso.count({ where: { usuarioId: u.id, accion: "bloqueo" } })).toBe(1);

    // Bloqueado: la correcta tampoco entra, con el mismo mensaje.
    expect(await ingresarConClave(deps, { identificador: u.cuil, clave: u.temporal }, null)).toMatchObject({ ok: false, motivo: "bloqueado" });
    // A los 15 minutos, sí.
    deps.reloj.ahora = new Date(deps.reloj.ahora.getTime() + 15 * 60_000);
    expect((await ingresarConClave(deps, { identificador: u.cuil, clave: u.temporal }, null)).ok).toBe(true);

    // Otra vez bloqueado, y esta vez lo desbloquea un admin.
    for (let i = 1; i <= 5; i++) await ingresarConClave(deps, { identificador: u.cuil, clave: `otra-mal-${i}` }, null);
    expect(await ingresarConClave(deps, { identificador: u.cuil, clave: u.temporal }, null)).toMatchObject({ motivo: "bloqueado" });
    const admin = servicioAdmin(prisma, () => deps.reloj.ahora);
    expect((await admin.listarUsuarios(yo)).usuarios.find((x) => x.id === u.id)?.bloqueadoHasta).not.toBeNull();
    expect(await admin.desbloquearUsuario(yo, u.id, "Llamó por teléfono")).toEqual({ repetido: false });
    expect(await admin.desbloquearUsuario(yo, u.id)).toEqual({ repetido: true });
    expect(await prisma.auditoriaAcceso.findFirst({ where: { usuarioId: yo.id, accion: "desbloqueo", detalle: { path: ["usuario_id"], equals: u.id } } })).not.toBeNull();
    expect((await ingresarConClave(deps, { identificador: u.cuil, clave: u.temporal }, null)).ok).toBe(true);
  });
});

describe("contraseña temporal y cambio obligatorio", () => {
  it("con la temporal la sesión existe pero solo sirve para cambiarla; al cambiarla se cierran las demás sesiones", async () => {
    const u = await alta({ apellido: "Ficticia" });
    const deps = dependencias();
    const r = await ingresarConClave(deps, { identificador: u.cuil, clave: u.temporal }, null);
    if (!r.ok) throw new Error("no entró");
    const v = r.usuario.sesionVersion;
    expect(await sesionVale(u.id, v)).toMatchObject({ id: u.id, debeCambiarClave: true });

    // La política: no el apellido.
    expect(await cambiarClave(deps, { usuarioId: u.id, sesionVersion: v }, { actual: u.temporal, nueva: "ficticia de corazón 2026", repetida: "ficticia de corazón 2026" }, null)).toMatchObject({
      ok: false,
      errores: [{ ruta: "nueva", mensaje: "No puede contener tu apellido." }],
    });
    const cambio = await cambiarClave(deps, { usuarioId: u.id, sesionVersion: v }, { actual: u.temporal, nueva: NUEVA, repetida: NUEVA }, "10.0.0.2");
    expect(cambio).toEqual({ ok: true, sesionVersion: v + 1 });
    // La cookie vieja ya no vale; la nueva (versión v + 1), sí, y sin cambio pendiente.
    expect(await sesionVale(u.id, v)).toBeNull();
    expect(await sesionVale(u.id, v + 1)).toMatchObject({ debeCambiarClave: false });
    // La temporal ya no sirve; la nueva sí.
    expect(await ingresarConClave(deps, { identificador: u.cuil, clave: u.temporal }, null)).toMatchObject({ ok: false, motivo: "clave_incorrecta" });
    expect(await ingresarConClave(deps, { identificador: u.cuil, clave: NUEVA }, null)).toMatchObject({ ok: true, usuario: { debeCambiarClave: false } });

    // auditoria.cambios: debe_cambiar_clave sí → no, firmado por el propio usuario.
    const cambios = await prisma.auditoriaCambio.findMany({ where: { tabla: "usuarios", registroId: String(u.id) }, orderBy: { id: "asc" } });
    expect(cambios.at(-1)).toMatchObject({ usuarioId: u.id, antes: { debe_cambiar_clave: true }, despues: { debe_cambiar_clave: false } });
    expect(await prisma.auditoriaAcceso.findFirst({ where: { usuarioId: u.id, accion: "cambio_clave" } })).toMatchObject({ ip: "10.0.0.2", detalle: { obligatorio: true } });
  });

  it("blanquear: temporal nueva, cierra todas sus sesiones, desbloquea y vuelve a pedir el cambio", async () => {
    const u = await alta();
    const deps = dependencias();
    const r = await ingresarConClave(deps, { identificador: u.cuil, clave: u.temporal }, null);
    if (!r.ok) throw new Error("no entró");
    await cambiarClave(deps, { usuarioId: u.id, sesionVersion: r.usuario.sesionVersion }, { actual: u.temporal, nueva: NUEVA, repetida: NUEVA }, null);
    const antes = await prisma.usuario.findUniqueOrThrow({ where: { id: u.id }, select: { sesionVersion: true } });
    for (let i = 1; i <= 5; i++) await ingresarConClave(deps, { identificador: u.cuil, clave: `mal-${i}-otra-vez` }, null);

    const admin = servicioAdmin(prisma);
    await expect(admin.blanquearClave(yo, u.id, "corto")).rejects.toMatchObject({ codigo: "motivo_requerido" });
    await expect(admin.blanquearClave(yo, yo.id, "Me olvidé mi contraseña")).rejects.toMatchObject({ codigo: "validacion" });
    const { claveTemporal } = await admin.blanquearClave(yo, u.id, "Olvidó la contraseña (pedido por teléfono)", { ip: "10.0.0.3" });
    expect(claveTemporal).toMatch(RE_CLAVE_TEMPORAL);

    const despues = await prisma.usuario.findUniqueOrThrow({ where: { id: u.id }, select: { sesionVersion: true, debeCambiarClave: true, bloqueadoHasta: true, intentosFallidos: true } });
    expect(despues).toEqual({ sesionVersion: antes.sesionVersion + 1, debeCambiarClave: true, bloqueadoHasta: null, intentosFallidos: 0 });
    expect(await sesionVale(u.id, antes.sesionVersion)).toBeNull();
    expect(await ingresarConClave(deps, { identificador: u.cuil, clave: NUEVA }, null)).toMatchObject({ ok: false, motivo: "clave_incorrecta" });
    expect(await ingresarConClave(deps, { identificador: u.cuil, clave: claveTemporal }, null)).toMatchObject({ ok: true, usuario: { debeCambiarClave: true } });

    expect(await prisma.auditoriaAcceso.findFirst({ where: { accion: "blanqueo_clave", detalle: { path: ["usuario_id"], equals: u.id } } })).toMatchObject({
      usuarioId: yo.id,
      ip: "10.0.0.3",
      detalle: { usuario_id: u.id, motivo: "Olvidó la contraseña (pedido por teléfono)" },
    });
    const cambio = await prisma.auditoriaCambio.findFirst({ where: { tabla: "usuarios", registroId: String(u.id), motivo: "Olvidó la contraseña (pedido por teléfono)" } });
    expect(cambio).toMatchObject({ usuarioId: yo.id, antes: { debe_cambiar_clave: false }, despues: { debe_cambiar_clave: true } });
  });

  it("ninguna contraseña ni hash queda en la auditoría", async () => {
    const u = await alta();
    const deps = dependencias();
    await ingresarConClave(deps, { identificador: u.cuil, clave: "una-incorrecta-para-buscar" }, null);
    await ingresarConClave(deps, { identificador: "una-contraseña-en-el-campo-equivocado", clave: u.temporal }, null);
    const r = await ingresarConClave(deps, { identificador: u.cuil, clave: u.temporal }, null);
    if (!r.ok) throw new Error("no entró");
    await cambiarClave(deps, { usuarioId: u.id, sesionVersion: r.usuario.sesionVersion }, { actual: u.temporal, nueva: NUEVA, repetida: NUEVA }, null);
    const { claveTemporal } = await servicioAdmin(prisma).blanquearClave(yo, u.id, "Prueba de que no queda la contraseña");

    const textos = [
      ...(await prisma.auditoriaAcceso.findMany({ select: { detalle: true } })).map((f) => JSON.stringify(f.detalle)),
      ...(await prisma.auditoriaCambio.findMany({ where: { tabla: "usuarios" }, select: { antes: true, despues: true } })).map((f) => JSON.stringify(f)),
    ].join("\n");
    for (const secreto of [u.temporal, NUEVA, claveTemporal, "una-incorrecta-para-buscar", "una-contraseña-en-el-campo-equivocado", "scrypt$"]) {
      expect({ secreto, aparece: textos.includes(secreto) }).toEqual({ secreto, aparece: false });
    }
  });
});

describe("admin inicial de producción (semilla --sin-ficticios)", () => {
  it("nace con una contraseña temporal (que se devuelve una vez) y debe_cambiar_clave; la segunda corrida no la cambia", async () => {
    const cuil = cuilFicticio();
    const r = await sembrar(prisma, { adminCuil: cuil, usuariosFicticios: false });
    const admin = await prisma.usuario.findUniqueOrThrow({ where: { cuil }, select: { id: true, rol: true, activo: true, debeCambiarClave: true, claveHash: true } });
    creados.push(admin.id);
    expect(r.claveAdminInicial).toMatch(RE_CLAVE_TEMPORAL);
    expect(admin).toMatchObject({ rol: "admin", activo: true, debeCambiarClave: true, claveHash: expect.stringMatching(/^scrypt\$32768\$8\$3\$/) });
    expect((await verificarClave(r.claveAdminInicial as string, admin.claveHash)).ok).toBe(true);

    // Ingresa con ella y queda obligado a cambiarla.
    const ingreso = await ingresarConClave(dependencias(), { identificador: cuil, clave: r.claveAdminInicial as string }, null);
    expect(ingreso).toMatchObject({ ok: true, usuario: { rol: "admin", debeCambiarClave: true } });

    const segunda = await sembrar(prisma, { adminCuil: cuil, usuariosFicticios: false });
    expect(segunda.claveAdminInicial).toBeNull();
    expect((await prisma.usuario.findUniqueOrThrow({ where: { cuil }, select: { claveHash: true } })).claveHash).toBe(admin.claveHash);
  });

  it("un admin de antes del login propio (sin contraseña) recibe una temporal", async () => {
    const cuil = cuilFicticio();
    const id = await conActorEn(prisma, SISTEMA, "Admin sin contraseña (prueba)", async (tx) =>
      (await tx.usuario.create({ data: { cuil, nombre: "Admin", apellido: "Viejo", rol: "admin" }, select: { id: true } })).id,
    );
    creados.push(id);
    const r = await sembrar(prisma, { adminCuil: cuil, usuariosFicticios: false });
    expect(r.claveAdminInicial).toMatch(RE_CLAVE_TEMPORAL);
    expect(await prisma.usuario.findUniqueOrThrow({ where: { id }, select: { debeCambiarClave: true } })).toEqual({ debeCambiarClave: true });
  });
});
