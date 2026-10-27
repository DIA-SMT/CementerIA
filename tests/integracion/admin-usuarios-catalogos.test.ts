import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { usuarioDeSesion, SELECCION_USUARIO } from "@/lib/auth/usuario";
import { traducirErrorBase } from "@/lib/dominio/admin";
import { ErrorDominio } from "@/lib/dominio/expedientes/errores";
import { leerCamposUbicacion } from "@/lib/dominio/expedientes/ubicacion";
import type { UsuarioPermisos } from "@/lib/dominio/permisos";
import { procesarCatalogo, procesarFeriado, procesarUsuario } from "@/lib/presentacion/acciones-admin";
import { codigoUnico, comoUsuario, conServiciosQueSeDeshacen, cuilFicticio } from "./admin";
import { asegurarSemilla, comando, datosAlta, idArea, servicio, usuario } from "./dominio";
import { clientePrisma } from "./helper";

// Semana 5: usuarios y catálogos desde la administración (2.1 a 2.4, 2.9,
// 2.13(d)). Todo corre en una transacción que se deshace (./admin.ts): los
// administradores activos, las áreas y los años de feriados los comparten
// todos los tests.

const prisma = clientePrisma();
let yo: UsuarioPermisos;

beforeAll(async () => {
  await asegurarSemilla(prisma);
  yo = await usuario(prisma, "ADMIN");
});
afterAll(() => prisma.$disconnect());

const codigoDe = (e: unknown) => (e instanceof ErrorDominio ? e.codigo : e instanceof Error ? e.name : String(e));

describe("usuarios", () => {
  it("alta por CUIL: dígito verificador, área interna, repetido y ya existe; auditado", async () => {
    const mesa = await idArea(prisma, "MESA_ENTRADAS");
    const dim = await idArea(prisma, "DIM");
    await conServiciosQueSeDeshacen(prisma, async ({ admin, tx }) => {
      const cuil = cuilFicticio();
      const malo = `${cuil.slice(0, 10)}${(Number(cuil[10]) + 1) % 10}`;
      await expect(admin.altaUsuario(yo, { cuil: malo, nombre: "Ana", apellido: "Ficticia", areaId: mesa, rol: "operador" })).rejects.toMatchObject({ codigo: "validacion", errores: [{ ruta: "cuil" }] });
      await expect(admin.altaUsuario(yo, { cuil, nombre: "Ana", apellido: "Ficticia", areaId: dim, rol: "operador" })).rejects.toMatchObject({ errores: [{ ruta: "areaId", mensaje: expect.stringContaining("área externa") }] });
      await expect(admin.altaUsuario(yo, { cuil, nombre: "Ana", apellido: "Ficticia", areaId: null, rol: "operador" })).rejects.toMatchObject({ errores: [{ ruta: "areaId" }] });

      const conGuiones = `${cuil.slice(0, 2)}-${cuil.slice(2, 10)}-${cuil.slice(10)}`;
      const r = await admin.altaUsuario(yo, { cuil: conGuiones, nombre: " Ana ", apellido: "Ficticia", email: "", areaId: mesa, rol: "operador" }, "Ingresa a Mesa de Entradas");
      expect(r.repetido).toBe(false);
      // Login propio: una contraseña temporal, que se devuelve una sola vez; en la base, el hash.
      expect(r.claveTemporal).toMatch(/^[a-z2-9]{4}(-[a-z2-9]{4}){3}$/);
      expect(await tx.usuario.findUniqueOrThrow({ where: { id: r.id }, select: { debeCambiarClave: true, claveHash: true } })).toEqual({
        debeCambiarClave: true,
        claveHash: expect.stringMatching(/^scrypt\$/),
      });
      expect(await tx.usuario.findUniqueOrThrow({ where: { id: r.id }, select: { cuil: true, nombre: true, email: true, activo: true, areaId: true } })).toEqual({ cuil, nombre: "Ana", email: null, activo: true, areaId: mesa });
      expect(await admin.altaUsuario(yo, { cuil, nombre: "Ana", apellido: "Ficticia", areaId: mesa, rol: "operador" })).toEqual({ id: r.id, repetido: true, claveTemporal: null });
      await expect(admin.altaUsuario(yo, { cuil, nombre: "Ana", apellido: "Ficticia", areaId: mesa, rol: "lectura" })).rejects.toMatchObject({ codigo: "ya_existe" });

      const audit = await tx.auditoriaCambio.findFirstOrThrow({ where: { tabla: "usuarios", registroId: String(r.id), operacion: "I" } });
      expect(audit).toMatchObject({ usuarioId: yo.id, motivo: "Ingresa a Mesa de Entradas", despues: { cuil, rol: "operador", activo: true, area_id: mesa, debe_cambiar_clave: true } });
      expect(JSON.stringify([audit.antes, audit.despues])).not.toContain("scrypt");
      // Un admin puede no tener área.
      expect((await admin.altaUsuario(yo, { cuil: cuilFicticio(), nombre: "Beto", apellido: "Ficticio", areaId: null, rol: "admin" })).repetido).toBe(false);
    });
  });

  it("desactivar corta la sesión (sesion_version + 1); no a uno mismo; reactivar; cambiar área o rol", async () => {
    const legal = await idArea(prisma, "LEGAL");
    await conServiciosQueSeDeshacen(prisma, async ({ admin, tx }) => {
      const { id } = await admin.altaUsuario(yo, { cuil: cuilFicticio(), nombre: "Carla", apellido: "Ficticia", areaId: legal, rol: "operador" });
      const antes = await tx.usuario.findUniqueOrThrow({ where: { id }, select: SELECCION_USUARIO });
      const sesion = { usuarioId: id, sesionVersion: antes.sesionVersion, inicio: 0, emitidaEn: 0 };
      expect(usuarioDeSesion(antes, sesion)).not.toBeNull();

      expect(await admin.desactivarUsuario(yo, id, "Pasó a otra repartición")).toEqual({ repetido: false });
      const despues = await tx.usuario.findUniqueOrThrow({ where: { id }, select: SELECCION_USUARIO });
      expect(despues).toMatchObject({ activo: false, sesionVersion: antes.sesionVersion + 1 });
      // La cookie que tenía ya no vale (en el request siguiente, getUsuarioActual da null).
      expect(usuarioDeSesion(despues, sesion)).toBeNull();
      // Repetir no vuelve a incrementar.
      expect(await admin.desactivarUsuario(yo, id)).toEqual({ repetido: true });
      expect((await tx.usuario.findUniqueOrThrow({ where: { id } })).sesionVersion).toBe(antes.sesionVersion + 1);

      expect(await admin.reactivarUsuario(yo, id)).toEqual({ repetido: false });
      expect(await admin.reactivarUsuario(yo, id)).toEqual({ repetido: true });
      // Reactivado, la sesión vieja sigue sin valer: entra de nuevo.
      expect(usuarioDeSesion(await tx.usuario.findUniqueOrThrow({ where: { id }, select: SELECCION_USUARIO }), sesion)).toBeNull();

      const computo = await idArea(prisma, "COMPUTO");
      expect(await admin.cambiarAccesoUsuario(yo, id, { areaId: computo, rol: "lectura" })).toEqual({ repetido: false });
      expect(await admin.cambiarAccesoUsuario(yo, id, { areaId: computo, rol: "lectura" })).toEqual({ repetido: true });
      await expect(admin.cambiarAccesoUsuario(yo, id, { areaId: await idArea(prisma, "CEM_OESTE"), rol: "lectura" })).rejects.toMatchObject({ errores: [{ ruta: "areaId" }] });

      // Uno mismo: ni desactivarse ni cambiarse el rol; el área sí.
      await expect(admin.desactivarUsuario(yo, yo.id)).rejects.toMatchObject({ message: "No podés desactivar tu propio usuario" });
      await expect(admin.cambiarAccesoUsuario(yo, yo.id, { areaId: null, rol: "operador" })).rejects.toMatchObject({ errores: [{ ruta: "rol" }] });
      // SISTEMA no se toca.
      await expect(admin.desactivarUsuario(yo, 1)).rejects.toMatchObject({ codigo: "no_encontrado" });

      const filas = await tx.auditoriaCambio.findMany({ where: { tabla: "usuarios", registroId: String(id) }, orderBy: { id: "asc" } });
      expect(filas.map((f) => f.operacion)).toEqual(["I", "U", "U", "U"]);
      expect(filas[1]).toMatchObject({ motivo: "Pasó a otra repartición", antes: { activo: true }, despues: { activo: false } });

      // La lista: sin SISTEMA, con el último ingreso y los admins activos.
      const lista = await admin.listarUsuarios(yo);
      expect(lista.usuarios.some((u) => u.id === 1)).toBe(false);
      expect(lista.usuarios.find((u) => u.id === id)).toMatchObject({ rol: "lectura", area: { codigo: "COMPUTO" }, activo: true });
      expect(lista.areas.every((a) => a.codigo !== "DIM")).toBe(true);
    });
  });

  it("no queda ningún admin activo: el último no se desactiva ni deja de ser admin", async () => {
    await conServiciosQueSeDeshacen(prisma, async ({ admin, tx, comoActor }) => {
      // Dos admins, A (yo) y B; los demás (de otros tests) se desactivan acá adentro.
      const b = await admin.altaUsuario(yo, { cuil: cuilFicticio(), nombre: "Bruno", apellido: "Ficticio", areaId: null, rol: "admin" });
      await comoActor(1, "Preparar el test del último admin");
      await tx.usuario.updateMany({ where: { rol: "admin", activo: true, id: { notIn: [yo.id, b.id] } }, data: { activo: false } });
      const adminB = await comoUsuario(tx, b.id);

      // B desactiva a A: queda B.
      expect(await admin.desactivarUsuario(adminB, yo.id)).toEqual({ repetido: false });
      // A, con una sesión todavía en vuelo (el pedido llegó antes de que se cortara), intenta desactivar a B.
      const e = await admin.desactivarUsuario(yo, b.id).catch((x: unknown) => x);
      expect(e).toMatchObject({ codigo: "en_uso", message: expect.stringContaining("último administrador activo") });
      // Tampoco se le puede sacar el rol de admin.
      await expect(admin.cambiarAccesoUsuario(yo, b.id, { areaId: await idArea(prisma, "MESA_ENTRADAS"), rol: "operador" })).rejects.toMatchObject({ codigo: "en_uso" });
      expect((await tx.usuario.findUniqueOrThrow({ where: { id: b.id } })).activo).toBe(true);
      // Reactivado A, ya se puede.
      expect(await admin.reactivarUsuario(adminB, yo.id)).toEqual({ repetido: false });
      expect(await admin.cambiarAccesoUsuario(yo, b.id, { areaId: await idArea(prisma, "MESA_ENTRADAS"), rol: "operador" })).toEqual({ repetido: false });
    });
  });

  it("la Server Action traduce los errores y los permisos", async () => {
    const mesa = await usuario(prisma, "MESA_ENTRADAS");
    await conServiciosQueSeDeshacen(prisma, async ({ admin }) => {
      expect(await procesarUsuario(admin, mesa, { accion: "desactivar", id: yo.id })).toMatchObject({ ok: false, codigo: "permiso" });
      expect(await procesarUsuario(admin, yo, { accion: "desactivar", id: "uno" })).toMatchObject({ ok: false, codigo: "validacion" });
      const alta = await procesarUsuario(admin, yo, { accion: "alta", datos: { cuil: cuilFicticio(), nombre: "Dora", apellido: "Ficticia", areaId: await idArea(prisma, "LIQUIDACION"), rol: "operador" } });
      expect(alta).toMatchObject({ ok: true, repetido: false, mensaje: expect.stringContaining("dado de alta"), claveTemporal: expect.stringMatching(/^[a-z2-9-]{19}$/) });
      // Blanquear: con motivo obligatorio, y devuelve la temporal nueva (una sola vez).
      const id = (await admin.listarUsuarios(yo)).usuarios.find((u) => u.nombre === "Dora" && u.apellido === "Ficticia")?.id ?? 0;
      expect(await procesarUsuario(admin, yo, { accion: "blanquear", id, motivo: "" })).toMatchObject({ ok: false, codigo: "motivo_requerido" });
      expect(await procesarUsuario(admin, yo, { accion: "blanquear", id, motivo: "Olvidó la contraseña" })).toMatchObject({ ok: true, claveTemporal: expect.stringMatching(/^[a-z2-9-]{19}$/) });
      expect(await procesarUsuario(admin, yo, { accion: "desbloquear", id })).toMatchObject({ ok: true, repetido: true });
      // La lista no trae el hash: solo si tiene contraseña.
      const fila = (await admin.listarUsuarios(yo)).usuarios.find((u) => u.id === id);
      expect(fila).toMatchObject({ conClave: true, debeCambiarClave: true, bloqueadoHasta: null });
      expect(fila).not.toHaveProperty("claveHash");
    });
  });
});

describe("catálogos", () => {
  it("áreas: alta, código fijo, y no se desactiva ni pasa a externa la que está en uso", async () => {
    await conServiciosQueSeDeshacen(prisma, async ({ admin, tx, comoActor }) => {
      const codigo = codigoUnico("AREA");
      const r = await admin.guardarArea(yo, { codigo: codigo.toLowerCase(), nombre: "Área de prueba", tipo: "interna", recibePases: true, activa: true, orden: 50 });
      expect(r).toMatchObject({ creado: true, repetido: false });
      expect(await admin.guardarArea(yo, { codigo, nombre: "Área de prueba", tipo: "interna", recibePases: true, activa: true, orden: 50 })).toMatchObject({ id: r.id, repetido: true });
      await expect(admin.guardarArea(yo, { codigo, nombre: "Otra", tipo: "interna", recibePases: true, activa: true, orden: 0 })).rejects.toMatchObject({ codigo: "ya_existe" });
      await expect(admin.guardarArea(yo, { id: r.id, codigo: "OTRO_CODIGO", nombre: "x", tipo: "interna", recibePases: true, activa: true, orden: 0 })).rejects.toMatchObject({ errores: [{ ruta: "codigo" }] });
      await expect(admin.guardarArea(yo, { codigo: codigoUnico("EXT"), nombre: "x", tipo: "externa", recibePases: false, activa: true, orden: 0 })).rejects.toMatchObject({ errores: [{ ruta: "recibePases" }] });

      const mesa = await tx.area.findUniqueOrThrow({ where: { codigo: "MESA_ENTRADAS" } });
      const base = { id: mesa.id, codigo: mesa.codigo, nombre: mesa.nombre, tipo: "interna", recibePases: true, activa: true, orden: mesa.orden };
      const desactivar = await admin.guardarArea(yo, { ...base, activa: false }).catch((e: unknown) => e);
      expect(desactivar).toMatchObject({ codigo: "en_uso" });
      const mensajes = desactivar instanceof ErrorDominio ? desactivar.errores.map((e) => e.mensaje).join(" | ") : "";
      expect(mensajes).toContain("usuario activo");
      expect(mensajes).toContain("RENOV_CONTADO");
      await expect(admin.guardarArea(yo, { ...base, tipo: "externa" })).rejects.toMatchObject({ codigo: "en_uso", errores: [{ ruta: "tipo" }] });
      const oeste = await tx.area.findUniqueOrThrow({ where: { codigo: "CEM_OESTE" } });
      await expect(admin.guardarArea(yo, { id: oeste.id, codigo: oeste.codigo, nombre: oeste.nombre, tipo: "interna", recibePases: true, activa: true, orden: oeste.orden })).rejects.toMatchObject({ errores: [{ ruta: "tipo", mensaje: expect.stringContaining("cementerio") }] });

      // Los triggers siguen siendo la barrera; su mensaje se muestra legible.
      await comoActor(yo.id);
      const crudo = await tx.$executeRawUnsafe("SAVEPOINT crudo").then(() => tx.usuario.create({ data: { cuil: cuilFicticio(), nombre: "x", apellido: "y", areaId: oeste.id, rol: "operador" } })).catch((e: unknown) => e);
      await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT crudo");
      expect(traducirErrorBase(crudo)).toMatchObject({ codigo: "validacion", message: "El área elegida es externa (la DIM o un cementerio): un usuario solo puede ser de un área interna" });
      expect(traducirErrorBase(new Error("otra cosa"))).toBeNull();

      // Un área nueva sin usar sí se desactiva; queda auditado con el motivo.
      expect(await admin.guardarArea(yo, { id: r.id, codigo, nombre: "Área de prueba", tipo: "interna", recibePases: true, activa: false, orden: 50 }, "Ya no existe")).toMatchObject({ repetido: false });
      expect(await tx.auditoriaCambio.findFirstOrThrow({ where: { tabla: "areas", registroId: String(r.id), operacion: "U" } })).toMatchObject({ motivo: "Ya no existe", antes: { activa: true }, despues: { activa: false } });
    });
  });

  it("cementerios: una clave de ubicación usada no se borra ni se renombra, se desactiva (2.13(d))", async () => {
    const exp = servicio(prisma);
    // Un expediente del Oeste con sección y lote, por si la base no tiene ninguno.
    await exp.alta(await usuario(prisma, "MESA_ENTRADAS"), await datosAlta(prisma), comando());
    await conServiciosQueSeDeshacen(prisma, async ({ admin, tx }) => {
      const c = await tx.cementerio.findUniqueOrThrow({ where: { codigo: "OESTE" } });
      const campos = leerCamposUbicacion(c.camposUbicacion, c.nombre);
      const base = { id: c.id, codigo: c.codigo, nombre: c.nombre, areaId: c.areaId, activo: true, tiposMonumento: c.tiposMonumento };

      const sinLote = await admin.guardarCementerio(yo, { ...base, camposUbicacion: campos.filter((x) => x.clave !== "lote") }).catch((e: unknown) => e);
      expect(sinLote).toMatchObject({ codigo: "en_uso", message: expect.stringContaining("La clave lote") });
      await expect(admin.guardarCementerio(yo, { ...base, camposUbicacion: campos.map((x) => (x.clave === "lote" ? { ...x, clave: "parcela" } : x)) })).rejects.toMatchObject({ codigo: "en_uso" });
      await expect(admin.guardarCementerio(yo, { ...base, camposUbicacion: campos.map((x) => (x.clave === "lote" ? { ...x, tipo: x.tipo === "entero" ? "texto" : "entero" } : x)) })).rejects.toMatchObject({ codigo: "en_uso" });

      const nuevos = [...campos.map((x) => (x.clave === "lote" ? { ...x, activo: false } : x)), { clave: "fila", etiqueta: "Fila", tipo: "entero", obligatorio: false, patron: null, activo: true, ayuda: "Un número" }];
      expect(await admin.guardarCementerio(yo, { ...base, camposUbicacion: nuevos }, "Nomenclatura nueva del Oeste")).toMatchObject({ repetido: false });
      const guardado = leerCamposUbicacion((await tx.cementerio.findUniqueOrThrow({ where: { id: c.id } })).camposUbicacion, c.nombre);
      expect(guardado.find((x) => x.clave === "lote")?.activo).toBe(false);
      expect(guardado.at(-1)).toMatchObject({ clave: "fila", tipo: "entero", ayuda: "Un número" });
      expect(await admin.guardarCementerio(yo, { ...base, camposUbicacion: nuevos })).toMatchObject({ repetido: true });

      const lista = await admin.listarCatalogos(yo);
      const oeste = lista.cementerios.find((x) => x.codigo === "OESTE");
      expect(oeste?.clavesUsadas.lote).toBeGreaterThan(0);
      expect(oeste?.clavesUsadas.fila).toBeUndefined();

      // Monumentos que no existen; un área interna como la de un cementerio; un área ya usada.
      await expect(admin.guardarCementerio(yo, { ...base, camposUbicacion: nuevos, tiposMonumento: [...c.tiposMonumento, "NO_EXISTE"] })).rejects.toMatchObject({ errores: [{ ruta: `tiposMonumento[${c.tiposMonumento.length}]` }] });
      const nuevo = { codigo: codigoUnico("CEM"), nombre: "Cementerio de prueba", activo: true, camposUbicacion: [], tiposMonumento: ["SEPULTURA"] };
      await expect(admin.guardarCementerio(yo, { ...nuevo, areaId: await idArea(prisma, "LEGAL") })).rejects.toMatchObject({ errores: [{ ruta: "areaId", mensaje: expect.stringContaining("interna") }] });
      await expect(admin.guardarCementerio(yo, { ...nuevo, areaId: c.areaId })).rejects.toMatchObject({ errores: [{ ruta: "areaId", mensaje: expect.stringContaining("ya es el área") }] });
      const area = await admin.guardarArea(yo, { codigo: codigoUnico("CEM_AREA"), nombre: "Cementerio de prueba (área)", tipo: "externa", recibePases: true, activa: true, orden: 90 });
      expect(await admin.guardarCementerio(yo, { ...nuevo, areaId: area.id, camposUbicacion: [{ clave: "sector", etiqueta: "Sector", tipo: "texto", obligatorio: true, patron: "[A-Z]", activo: true }] })).toMatchObject({ creado: true });
    });
  });

  it("tipos de monumento y de trámite: alta, código fijo, desactivar", async () => {
    await conServiciosQueSeDeshacen(prisma, async ({ admin }) => {
      const m = codigoUnico("MON");
      const r = await admin.guardarTipoMonumento(yo, { codigo: m, nombre: "Nicho doble", activo: true });
      expect(r.creado).toBe(true);
      await expect(admin.guardarTipoMonumento(yo, { codigo: "CON_1_NUMERO", nombre: "x", activo: true })).rejects.toMatchObject({ errores: [{ ruta: "codigo" }] });
      expect(await admin.guardarTipoMonumento(yo, { id: r.id, codigo: m, nombre: "Nicho doble", activo: false })).toMatchObject({ repetido: false });
      const t = codigoUnico("TRANSFERENCIA");
      const rt = await procesarCatalogo(admin, yo, { catalogo: "tipo_tramite", datos: { codigo: t, nombre: "Transferencia", activo: true } });
      expect(rt).toMatchObject({ ok: true, mensaje: "Tipo de trámite dado de alta." });
      expect(await procesarCatalogo(admin, yo, { catalogo: "tipo_tramite", datos: { codigo: t, nombre: "Transferencia", activo: true } })).toMatchObject({ ok: true, repetido: true });
      const lista = await admin.listarCatalogos(yo);
      expect(lista.tiposTramite.find((x) => x.codigo === "RENOVACION")?.plantillas).toEqual(expect.arrayContaining(["RENOV_CONTADO", "RENOV_PLAN"]));
    });
  });

  it("feriados: alta, modificación, quitar y cerrar el año 2026 (y reabrir con motivo), auditado", async () => {
    await conServiciosQueSeDeshacen(prisma, async ({ expedientes, tx }) => {
      const anio = 2026;
      const previo = await tx.feriadoAnio.findUnique({ where: { anio } });
      expect(previo?.cerrado ?? false).toBe(false);

      const fecha = "2026-11-27";
      expect(await procesarFeriado(expedientes, yo, { accion: "guardar", fecha, descripcion: "Asueto ficticio", ambito: "asueto", norma: "Decreto ficticio 1/2026" })).toMatchObject({ ok: true, mensaje: "Feriado agregado." });
      expect(await procesarFeriado(expedientes, yo, { accion: "guardar", fecha, descripcion: "Asueto ficticio", ambito: "asueto", norma: "Decreto ficticio 1/2026" })).toMatchObject({ ok: true, repetido: true });
      expect(await procesarFeriado(expedientes, yo, { accion: "guardar", fecha, descripcion: "Asueto ficticio (corregido)", ambito: "municipal" })).toMatchObject({ ok: true, mensaje: "Feriado modificado." });
      expect(await procesarFeriado(expedientes, yo, { accion: "guardar", fecha: "2026-13-01", descripcion: "x", ambito: "asueto" })).toMatchObject({ ok: false, codigo: "validacion", errores: [{ ruta: "fecha" }] });

      expect(await procesarFeriado(expedientes, yo, { accion: "cerrar", anio, motivo: "Cargados todos los de 2026" })).toMatchObject({ ok: true, mensaje: expect.stringContaining("2026 cerrado") });
      expect(await tx.feriadoAnio.findUniqueOrThrow({ where: { anio } })).toMatchObject({ cerrado: true, cerradoPor: yo.id });
      expect(await procesarFeriado(expedientes, yo, { accion: "cerrar", anio })).toMatchObject({ ok: true, repetido: true });
      // Agregar un feriado en un año cerrado se admite (un asueto decretado después).
      expect(await procesarFeriado(expedientes, yo, { accion: "guardar", fecha: "2026-12-11", descripcion: "Otro asueto ficticio", ambito: "asueto" })).toMatchObject({ ok: true });
      expect(await procesarFeriado(expedientes, yo, { accion: "reabrir", anio })).toMatchObject({ ok: false, codigo: "motivo_requerido" });
      expect(await procesarFeriado(expedientes, yo, { accion: "reabrir", anio, motivo: "Falta el asueto de diciembre" })).toMatchObject({ ok: true });
      expect(await procesarFeriado(expedientes, yo, { accion: "quitar", fecha })).toMatchObject({ ok: true, mensaje: "Feriado quitado." });
      expect(await procesarFeriado(expedientes, (await usuario(prisma, "DIRECCION")), { accion: "cerrar", anio })).toMatchObject({ ok: false, codigo: "permiso" });

      const anios = await tx.auditoriaCambio.findMany({ where: { tabla: "feriados_anios", registroId: String(anio), usuarioId: yo.id }, orderBy: { id: "asc" } });
      expect(anios.map((a) => a.motivo).slice(-2)).toEqual(["Cargados todos los de 2026", "Falta el asueto de diciembre"]);
      const feriados = await tx.auditoriaCambio.findMany({ where: { tabla: "feriados", registroId: fecha }, orderBy: { id: "asc" } });
      expect(feriados.map((f) => f.operacion).slice(-3)).toEqual(["I", "U", "D"]);
    });
    // Nada quedó.
    expect((await prisma.feriadoAnio.findUnique({ where: { anio: 2026 } }))?.cerrado ?? false).toBe(false);
    expect(await prisma.feriado.findUnique({ where: { fecha: new Date("2026-11-27T00:00:00Z") } })).toBeNull();
  });

  it("solo el admin", async () => {
    const mesa = await usuario(prisma, "MESA_ENTRADAS");
    await conServiciosQueSeDeshacen(prisma, async ({ admin }) => {
      expect(codigoDe(await admin.listarCatalogos(mesa).catch((e: unknown) => e))).toBe("PermisoDenegado");
      expect(await procesarCatalogo(admin, mesa, { catalogo: "area", datos: {} })).toMatchObject({ ok: false, codigo: "permiso" });
    });
  });
});
