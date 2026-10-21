import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RENOV_CONTADO } from "../../prisma/semilla/plantillas/renov-contado";
import type { ServicioAdmin } from "@/lib/dominio/admin";
import { ErrorDominio } from "@/lib/dominio/expedientes/errores";
import { PermisoDenegado, type UsuarioPermisos } from "@/lib/dominio/permisos";
import { definicionEditable } from "@/lib/dominio/plantillas/borrador";
import type { DefinicionPlantilla } from "@/lib/dominio/plantillas/esquema";
import { agregarSubtarea, cambiarSubtarea } from "@/lib/presentacion/editor-plantilla";
import { procesarNuevaPlantilla, procesarPublicar, procesarValidarBorrador } from "@/lib/presentacion/acciones-admin";
import { codigoUnico, conServiciosQueSeDeshacen, servicioAdmin } from "./admin";
import { asegurarSemilla, comando, datosAlta, idPlantilla, servicio, usuario } from "./dominio";
import { clientePrisma } from "./helper";

// Semana 5: plantillas desde la administración (2.5, 2.13(a)). Las plantillas
// de prueba tienen código único y quedan confirmadas; la v2 de RENOV_CONTADO
// (la que usan los demás tests) se publica dentro de una transacción que se
// deshace (./admin.ts).

const prisma = clientePrisma();
let admin: ServicioAdmin;
let yo: UsuarioPermisos;
let tipoRenovacion: number;

beforeAll(async () => {
  await asegurarSemilla(prisma);
  admin = servicioAdmin(prisma);
  yo = await usuario(prisma, "ADMIN");
  tipoRenovacion = (await prisma.tipoTramite.findUniqueOrThrow({ where: { codigo: "RENOVACION" } })).id;
});
afterAll(() => prisma.$disconnect());

const contenido = (nombre: string, definicion: DefinicionPlantilla) => ({ nombre, definicion });

/** RENOV_CONTADO con una subtarea más en Mesa de Entradas (lo que hace el editor). */
function conSubtareaEnMesa(def: DefinicionPlantilla, nombre = "Copia del recibo archivada"): DefinicionPlantilla {
  const d = agregarSubtarea(def, 0);
  return cambiarSubtarea(d, 0, d.pasos[0].subtareas.length - 1, { nombre, obligatoria: false });
}

describe("ciclo de una plantilla nueva: crear, guardar, validar, publicar, editar, publicar v2, retirar", () => {
  it("todo el recorrido, con la auditoría de cada paso", async () => {
    const codigo = codigoUnico("PRUEBA_ADM");
    const r1 = await admin.crearPlantilla(yo, { codigo, tipoTramiteId: tipoRenovacion, nombre: "Prueba de administración" });
    expect(r1).toEqual({ codigo, version: 1, repetido: false });
    // Doble clic: el mismo pedido devuelve el borrador.
    expect(await admin.crearPlantilla(yo, { codigo, tipoTramiteId: tipoRenovacion, nombre: "Prueba de administración" })).toEqual({ codigo, version: 1, repetido: true });
    await expect(admin.crearPlantilla(yo, { codigo, tipoTramiteId: tipoRenovacion, nombre: "Otro nombre" })).rejects.toMatchObject({ codigo: "ya_existe" });

    const v1 = await admin.obtenerVersion(yo, codigo, 1);
    expect(v1).toMatchObject({ estado: "borrador", enCurso: 0, definicion: { pasos: [] } });
    // La plantilla nueva no se puede publicar sin pasos.
    expect((await admin.validarBorrador(yo, contenido(v1.nombre, v1.definicion))).errores).toEqual([{ ruta: "pasos", mensaje: "La plantilla tiene que tener al menos un paso" }]);

    // Guardar el recorrido de RENOV_CONTADO.
    const g = await admin.guardarBorrador(yo, codigo, 1, contenido("Prueba de administración", RENOV_CONTADO), v1.huella);
    expect(g).toMatchObject({ repetido: false, pendientes: 0 });
    // Guardar lo mismo otra vez (doble clic, aun con la huella vieja): no escribe.
    expect(await admin.guardarBorrador(yo, codigo, 1, contenido("Prueba de administración", RENOV_CONTADO), v1.huella)).toMatchObject({ repetido: true, huella: g.huella });
    // Otro contenido con la huella vieja: otro administrador guardó en el medio.
    await expect(admin.guardarBorrador(yo, codigo, 1, contenido("Cambio viejo", RENOV_CONTADO), v1.huella)).rejects.toMatchObject({ codigo: "conflicto_version" });

    // Publicar exige notas.
    await expect(admin.publicarBorrador(yo, codigo, 1, contenido("Prueba de administración", RENOV_CONTADO), g.huella, "corto")).rejects.toMatchObject({ codigo: "motivo_requerido" });
    const p1 = await admin.publicarBorrador(yo, codigo, 1, contenido("Prueba de administración", RENOV_CONTADO), g.huella, "Primera versión de la prueba");
    expect(p1).toEqual({ codigo, version: 1, repetido: false, retirada: null });
    expect(await admin.publicarBorrador(yo, codigo, 1, contenido("Prueba de administración", RENOV_CONTADO), g.huella, "Primera versión de la prueba")).toMatchObject({ repetido: true });
    // Congelada: no se guarda como borrador.
    await expect(admin.guardarBorrador(yo, codigo, 1, contenido("x", RENOV_CONTADO), g.huella)).rejects.toMatchObject({ codigo: "estado_no_admite" });

    // Un expediente en curso con la v1.
    const exp = servicio(prisma);
    const mesa = await usuario(prisma, "MESA_ENTRADAS");
    const id1 = await idPlantilla(prisma, codigo);
    const alta1 = await exp.alta(mesa, await datosAlta(prisma, { plantillaId: id1 }), comando());

    // Editar: borrador v2 copiando la publicada; Editar otra vez abre el mismo.
    expect(await admin.editarPlantilla(yo, codigo)).toEqual({ codigo, version: 2, repetido: false });
    expect(await admin.editarPlantilla(yo, codigo)).toEqual({ codigo, version: 2, repetido: true });
    const v2 = await admin.obtenerVersion(yo, codigo, 2);
    expect(v2.definicion).toEqual(RENOV_CONTADO);
    const nueva = conSubtareaEnMesa(v2.definicion);
    const g2 = await admin.guardarBorrador(yo, codigo, 2, contenido(v2.nombre, nueva), v2.huella);
    const p2 = await admin.publicarBorrador(yo, codigo, 2, contenido(v2.nombre, nueva), g2.huella, "Suma la copia del recibo en Mesa");
    expect(p2).toEqual({ codigo, version: 2, repetido: false, retirada: 1 });

    const versiones = await prisma.plantilla.findMany({ where: { codigo }, orderBy: { version: "asc" }, select: { version: true, estado: true, notasCambio: true, publicadoPor: true } });
    expect(versiones).toEqual([
      { version: 1, estado: "retirada", notasCambio: "Primera versión de la prueba", publicadoPor: yo.id },
      { version: 2, estado: "publicada", notasCambio: "Suma la copia del recibo en Mesa", publicadoPor: yo.id },
    ]);

    // El catálogo: publicada v2, sin borrador, 1 en curso con la v1.
    const fila = (await admin.catalogoPlantillas(yo)).find((f) => f.codigo === codigo);
    expect(fila).toMatchObject({ publicada: { version: 2, enCurso: 0 }, borrador: null });
    expect(fila?.versiones.find((v) => v.version === 1)).toMatchObject({ estado: "retirada", enCurso: 1, total: 1 });
    expect((await exp.obtenerFicha(mesa, alta1.numero)).plantilla).toMatchObject({ version: 1, hayVersionNueva: true });

    // Auditoría: el borrador, cada guardado y cada publicación, con las notas como motivo.
    const cambios = await prisma.auditoriaCambio.findMany({ where: { tabla: "plantillas", registroId: String(id1) }, orderBy: { id: "asc" } });
    expect(cambios.map((c) => c.operacion)).toEqual(["I", "U", "U", "U"]);
    expect(cambios.at(-1)?.motivo).toBe("Suma la copia del recibo en Mesa");
    expect(cambios.every((c) => c.usuarioId === yo.id)).toBe(true);

    // Retirar: con motivo; el código queda sin publicada y el alta lo rechaza.
    await expect(admin.retirarPlantilla(yo, codigo, 2, null)).rejects.toMatchObject({ codigo: "motivo_requerido" });
    expect(await admin.retirarPlantilla(yo, codigo, 2, "El trámite se dejó de usar")).toEqual({ repetido: false });
    expect(await admin.retirarPlantilla(yo, codigo, 2, "El trámite se dejó de usar")).toEqual({ repetido: true });
    const id2 = (await prisma.plantilla.findFirstOrThrow({ where: { codigo, version: 2 } })).id;
    await expect(exp.alta(mesa, await datosAlta(prisma, { plantillaId: id2 }), comando())).rejects.toMatchObject({ codigo: "plantilla_no_publicada" });
    // Editar un código retirado parte de la última versión.
    expect(await admin.editarPlantilla(yo, codigo)).toEqual({ codigo, version: 3, repetido: false });
    expect((await admin.obtenerVersion(yo, codigo, 3)).definicion.pasos[0].subtareas.at(-1)?.nombre).toBe("Copia del recibo archivada");
    // Descartar el borrador: se borra; descartarlo de nuevo no falla.
    expect(await admin.descartarBorrador(yo, codigo, 3)).toEqual({ repetido: false });
    expect(await admin.descartarBorrador(yo, codigo, 3)).toEqual({ repetido: true });
    await expect(admin.descartarBorrador(yo, codigo, 2)).rejects.toMatchObject({ codigo: "estado_no_admite" });
  });
});

describe("Publicar rechaza lo que no pasa la integridad, sin cambiar nada", () => {
  it("un área que no existe, una custodia en un paso interno y un documento que apunta a un paso inexistente", async () => {
    const codigo = codigoUnico("PRUEBA_INT");
    await admin.crearPlantilla(yo, { codigo, tipoTramiteId: tipoRenovacion, nombre: "Prueba de integridad" });
    const v = await admin.obtenerVersion(yo, codigo, 1);
    const rota: DefinicionPlantilla = {
      ...RENOV_CONTADO,
      pasos: RENOV_CONTADO.pasos.map((p, i) => (i === 1 ? { ...p, area: "NO_EXISTE" } : i === 3 ? { ...p, custodia: "COMPUTO" } : p)),
      documentos: RENOV_CONTADO.documentos.map((d, i) => (i === 0 ? { ...d, exigir_al_salir_de: "NINGUNO" } : d)),
    };
    const g = await admin.guardarBorrador(yo, codigo, 1, contenido(v.nombre, rota), v.huella);
    expect(g.pendientes).toBe(3);

    const e = await admin.publicarBorrador(yo, codigo, 1, contenido(v.nombre, rota), g.huella, "Intento con errores").catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ErrorDominio);
    if (!(e instanceof ErrorDominio)) return;
    expect(e.codigo).toBe("validacion");
    expect(e.message).toBe("No se puede publicar: hay 3 errores (marcados en cada pestaña)");
    expect(e.errores.map((x) => x.ruta).sort()).toEqual(["documentos[0].exigir_al_salir_de", "pasos[1].area", "pasos[3].custodia"]);
    expect(await prisma.plantilla.findFirstOrThrow({ where: { codigo }, select: { estado: true, publicadoEn: true } })).toEqual({ estado: "borrador", publicadoEn: null });

    // La Server Action devuelve los mismos errores por ruta, para las pestañas.
    const accion = await procesarPublicar(admin, yo, { codigo, version: 1, nombre: v.nombre, definicion: rota as unknown as Record<string, unknown>, huella: g.huella, notas: "Intento con errores" });
    expect(accion).toMatchObject({ ok: false, codigo: "validacion" });
    if (!accion.ok) expect(accion.errores).toHaveLength(3);
    const validacion = await procesarValidarBorrador(admin, yo, { nombre: "", definicion: rota as unknown as Record<string, unknown> });
    expect(validacion.ok && validacion.errores.map((x) => x.ruta).sort()).toEqual(["documentos[0].exigir_al_salir_de", "nombre", "pasos[1].area", "pasos[3].custodia"]);
  });

  it("una forma rota en la base se puede abrir en el editor (definicionEditable) y no publicar", async () => {
    const r = await procesarNuevaPlantilla(admin, yo, { codigo: codigoUnico("PRUEBA_NUEVA").toLowerCase(), tipoTramiteId: tipoRenovacion, nombre: "  Desde la pantalla  " });
    expect(r).toMatchObject({ ok: true, destino: expect.stringMatching(/^\/admin\/plantillas\/PRUEBA_NUEVA_[A-Z_]+\/v\/1$/) });
    const sinTipo = await procesarNuevaPlantilla(admin, yo, { codigo: codigoUnico("PRUEBA_SIN_TIPO"), tipoTramiteId: 32_000, nombre: "x" });
    expect(sinTipo).toMatchObject({ ok: false, codigo: "validacion", errores: [{ ruta: "tipoTramiteId" }] });
  });

  it("solo el admin", async () => {
    const mesa = await usuario(prisma, "MESA_ENTRADAS");
    const direccion = await usuario(prisma, "DIRECCION");
    await expect(admin.catalogoPlantillas(mesa)).rejects.toBeInstanceOf(PermisoDenegado);
    await expect(admin.editarPlantilla(direccion, "RENOV_CONTADO")).rejects.toBeInstanceOf(PermisoDenegado);
  });
});

describe("una v2 de RENOV_CONTADO (2.13(a)): el expediente en curso sigue con la v1 y el alta nueva toma la v2", () => {
  it("todo en una transacción que se deshace", async () => {
    const mesaId = (await usuario(prisma, "MESA_ENTRADAS")).id;
    const datosPrevios = await datosAlta(prisma);
    const resultado = await conServiciosQueSeDeshacen(prisma, async ({ admin: adm, expedientes, tx }) => {
      const mesa = { ...(await usuario(prisma, "MESA_ENTRADAS")), id: mesaId };
      const v1 = await tx.plantilla.findFirstOrThrow({ where: { codigo: "RENOV_CONTADO", estado: "publicada" } });
      const enCurso = await expedientes.alta(mesa, { ...datosPrevios, plantillaId: v1.id }, comando());

      const borrador = await adm.editarPlantilla(yo, "RENOV_CONTADO");
      const v = await adm.obtenerVersion(yo, "RENOV_CONTADO", borrador.version);
      const nueva = conSubtareaEnMesa(v.definicion, "Constancia de atención archivada");
      const g = await adm.guardarBorrador(yo, "RENOV_CONTADO", v.version, contenido(v.nombre, nueva), v.huella);
      const p = await adm.publicarBorrador(yo, "RENOV_CONTADO", v.version, contenido(v.nombre, nueva), g.huella, "Agrega la constancia de atención en Mesa");

      const opciones = await expedientes.opcionesAlta();
      const ofrecida = opciones.plantillas.find((x) => x.codigo === "RENOV_CONTADO");
      const altaNueva = await expedientes.alta(mesa, { ...(await datosAlta(prisma)), plantillaId: ofrecida?.id ?? 0 }, comando());
      // La v1 ya no se ofrece: un formulario abierto antes recibe plantilla_no_publicada.
      const vieja = await expedientes.alta(mesa, { ...(await datosAlta(prisma)), plantillaId: v1.id }, comando()).catch((e: unknown) => e);

      const fichaVieja = await expedientes.obtenerFicha(mesa, enCurso.numero);
      const fichaNueva = await expedientes.obtenerFicha(mesa, altaNueva.numero);
      const estados = await tx.plantilla.findMany({ where: { codigo: "RENOV_CONTADO" }, orderBy: { version: "asc" }, select: { version: true, estado: true } });
      const subtareasMesa = (f: typeof fichaVieja) => f.recorrido[0].subtareas.map((s) => s.nombre);
      return { v1: v1.version, p, ofrecida, estados, fichaVieja: fichaVieja.plantilla, fichaNueva: fichaNueva.plantilla, mesaVieja: subtareasMesa(fichaVieja), mesaNueva: subtareasMesa(fichaNueva), vieja };
    });

    expect(resultado.v1).toBe(1);
    expect(resultado.p).toEqual({ codigo: "RENOV_CONTADO", version: 2, repetido: false, retirada: 1 });
    expect(resultado.estados).toEqual([
      { version: 1, estado: "retirada" },
      { version: 2, estado: "publicada" },
    ]);
    expect(resultado.ofrecida).toMatchObject({ version: 2 });
    expect(resultado.fichaVieja).toMatchObject({ version: 1, versionPublicada: 2, hayVersionNueva: true, texto: "Renovación, pago de contado · v1 (hay v2)" });
    expect(resultado.fichaNueva).toMatchObject({ version: 2, hayVersionNueva: false });
    expect(resultado.mesaVieja).not.toContain("Constancia de atención archivada");
    expect(resultado.mesaNueva).toContain("Constancia de atención archivada");
    expect(resultado.vieja).toMatchObject({ codigo: "plantilla_no_publicada" });

    // Nada quedó: la publicada sigue siendo la v1 de la semilla.
    expect(await prisma.plantilla.findMany({ where: { codigo: "RENOV_CONTADO" }, select: { version: true, estado: true } })).toEqual([{ version: 1, estado: "publicada" }]);
    expect(definicionEditable((await prisma.plantilla.findFirstOrThrow({ where: { codigo: "RENOV_CONTADO" } })).definicion)).toEqual(RENOV_CONTADO);
  });
});
