import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POR_PAGINA } from "@/lib/dominio/admin";
import { hoyEnTucuman, sumarDias } from "@/lib/fechas";
import type { UsuarioPermisos } from "@/lib/dominio/permisos";
import { responderExportacionAuditoria } from "@/lib/presentacion/acciones-admin";
import { conServiciosQueSeDeshacen, cuilFicticio } from "./admin";
import { asegurarSemilla, comando, datosAlta, idArea, usuario } from "./dominio";
import { clientePrisma } from "./helper";

// Semana 5: /admin/auditoria (2.10). Los accesos (con "Ver datos completos" y
// su motivo) y los cambios de configuración, filtrados y paginados, y el CSV
// registrado como `exportar`. En una transacción que se deshace.

const prisma = clientePrisma();
let yo: UsuarioPermisos;

beforeAll(async () => {
  await asegurarSemilla(prisma);
  yo = await usuario(prisma, "ADMIN");
});
afterAll(() => prisma.$disconnect());

describe("auditoría filtrada", () => {
  it("accesos por usuario, expediente, acción y fechas; ver_datos_completos con su motivo", async () => {
    const mesa = await usuario(prisma, "MESA_ENTRADAS");
    const legal = await usuario(prisma, "LEGAL");
    const datos = await datosAlta(prisma);
    await conServiciosQueSeDeshacen(prisma, async ({ admin, expedientes }) => {
      const { numero } = await expedientes.alta(mesa, datos, comando());
      await expedientes.obtenerFicha(legal, numero, { ip: "10.0.0.7" });
      await expedientes.verDatosCompletos(legal, numero, "Llamó el titular para consultar", { ip: "10.0.0.7" });
      await expedientes.datosCaratula(mesa, numero);

      const delExpediente = await admin.listarAccesos(yo, { numero });
      expect(delExpediente.total).toBe(3);
      expect(delExpediente.filas.map((f) => f.accion)).toEqual(["imprimir", "ver_datos_completos", "ver_expediente"]);
      const datosCompletos = await admin.listarAccesos(yo, { numero, accion: "ver_datos_completos" });
      expect(datosCompletos.filas).toEqual([
        expect.objectContaining({ accion: "ver_datos_completos", expediente: numero, motivo: "Llamó el titular para consultar", ip: "10.0.0.7", usuario: expect.objectContaining({ id: legal.id }) }),
      ]);
      // La forma corta del número también sirve; un número que no existe da vacío, sin error.
      const [n, a] = numero.replace("CEM-", "").split("-");
      expect((await admin.listarAccesos(yo, { numero: `${Number(a)}/${n}` })).total).toBe(3);
      expect(await admin.listarAccesos(yo, { numero: "CEM-1999-99999" })).toMatchObject({ total: 0, filas: [] });

      const deLegalHoy = await admin.listarAccesos(yo, { usuarioId: legal.id, desde: hoyEnTucuman(), hasta: hoyEnTucuman(), numero });
      expect(deLegalHoy.total).toBe(2);
      expect((await admin.listarAccesos(yo, { usuarioId: legal.id, desde: sumarDias(hoyEnTucuman(), 1), numero })).total).toBe(0);
      expect((await admin.listarAccesos(yo, { usuarioId: legal.id, hasta: sumarDias(hoyEnTucuman(), -1), numero })).total).toBe(0);
      await expect(admin.listarAccesos(yo, { accion: "borrar" })).rejects.toMatchObject({ codigo: "validacion", errores: [{ ruta: "accion" }] });
      await expect(admin.listarAccesos(yo, { desde: "2026-02-31" })).rejects.toMatchObject({ errores: [{ ruta: "desde" }] });
    });
  });

  it("paginado de a 50", async () => {
    await conServiciosQueSeDeshacen(prisma, async ({ admin, tx, comoActor }) => {
      await comoActor(yo.id);
      await tx.auditoriaAcceso.createMany({ data: Array.from({ length: POR_PAGINA + 5 }, () => ({ usuarioId: yo.id, accion: "ingreso", detalle: { prueba: true } })) });
      const p1 = await admin.listarAccesos(yo, { usuarioId: yo.id, accion: "ingreso" });
      expect(p1.porPagina).toBe(50);
      expect(p1.filas).toHaveLength(50);
      expect(p1.paginas).toBe(Math.ceil(p1.total / 50));
      const p2 = await admin.listarAccesos(yo, { usuarioId: yo.id, accion: "ingreso", pagina: 2 });
      expect(p2.pagina).toBe(2);
      expect(p2.filas.length).toBeGreaterThanOrEqual(5);
      expect(p2.filas.map((f) => f.id).some((id) => p1.filas.some((f) => f.id === id))).toBe(false);
    });
  });

  it("cambios de configuración con el antes y el después legibles, filtrados por tabla y usuario", async () => {
    const mesaArea = await idArea(prisma, "MESA_ENTRADAS");
    const computo = await idArea(prisma, "COMPUTO");
    await conServiciosQueSeDeshacen(prisma, async ({ admin, expedientes }) => {
      const { id } = await admin.altaUsuario(yo, { cuil: cuilFicticio(), nombre: "Eva", apellido: "Ficticia", areaId: mesaArea, rol: "operador" }, "Alta para la prueba");
      await admin.cambiarAccesoUsuario(yo, id, { areaId: computo, rol: "operador" }, "Cambio de área");
      await admin.desactivarUsuario(yo, id, "Baja de la prueba");
      await expedientes.cerrarAnioFeriados(yo, 2027, "Cerrar 2027 para la prueba");

      const usuarios = await admin.listarCambios(yo, { tabla: "usuarios", usuarioId: yo.id });
      const mios = usuarios.filas.filter((f) => f.diferencias.length > 0 && ["Alta para la prueba", "Cambio de área", "Baja de la prueba"].includes(f.motivo ?? ""));
      expect(mios.map((f) => [f.operacionEtiqueta, f.motivo, f.diferencias.map((d) => `${d.etiqueta}: ${d.antes} → ${d.despues}`).join("; ")])).toEqual([
        ["Cambio", "Baja de la prueba", "Activo: sí → no"],
        ["Cambio", "Cambio de área", `Área: Mesa de Entradas (${mesaArea}) → Cómputo (${computo})`],
        ["Alta", "Alta para la prueba", expect.stringContaining("Rol: — → operador")],
      ]);
      expect(mios[0].registro).toMatch(/^CUIL \d{11}$/);

      const anios = await admin.listarCambios(yo, { tabla: "feriados_anios", usuarioId: yo.id });
      expect(anios.filas[0]).toMatchObject({ tablaEtiqueta: "Año de feriados", registro: "Año 2027", motivo: "Cerrar 2027 para la prueba" });
      expect(anios.filas[0].diferencias.find((d) => d.campo === "cerrado")).toMatchObject({ antes: "no", despues: "sí" });
      expect(anios.filas[0].diferencias.find((d) => d.campo === "cerrado_por")?.despues).toContain(`(${yo.id})`);
      await expect(admin.listarCambios(yo, { tabla: "movimientos" })).rejects.toMatchObject({ errores: [{ ruta: "tabla" }] });
    });
  });
});

describe("exportar CSV (registrado como exportar)", () => {
  it("el Route Handler: CSV de lo filtrado, `exportar` en auditoria.accesos, 401 y 403", async () => {
    const direccion = await usuario(prisma, "DIRECCION");
    await conServiciosQueSeDeshacen(prisma, async ({ admin, expedientes, tx }) => {
      await expedientes.cerrarAnioFeriados(yo, 2027, "Cierre; con punto y coma");
      const pedido = new Request(`http://localhost/admin/auditoria/exportar?vista=cambios&tabla=feriados_anios&usuario=${yo.id}`);
      const r = await responderExportacionAuditoria(admin, yo, pedido, "10.0.0.9");
      expect(r.status).toBe(200);
      expect(r.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
      expect(r.headers.get("Content-Disposition")).toMatch(/^attachment; filename="auditoria-cambios-\d{4}-\d{2}-\d{2}\.csv"/);
      expect(r.headers.get("Cache-Control")).toBe("private, no-store");
      // text() se come el BOM: se decodifica a mano para verlo.
      const texto = new TextDecoder("utf-8", { ignoreBOM: true }).decode(await r.arrayBuffer());
      expect(texto.charCodeAt(0)).toBe(0xfeff);
      const lineas = texto.slice(1).split("\r\n");
      expect(lineas[0]).toBe("Fecha y hora;Usuario;Tabla;Registro;Operación;Motivo;Cambios");
      expect(lineas[1]).toContain(';Año de feriados;Año 2027;Cambio;"Cierre; con punto y coma";"Cerrado: no → sí; Cerrado el: — → ');
      expect(lineas[1]).toMatch(/Cerrado el: — → \d{2}\/\d{2}\/\d{4} \d{2}:\d{2};/);

      const registro = await tx.auditoriaAcceso.findFirstOrThrow({ where: { usuarioId: yo.id, accion: "exportar" }, orderBy: { id: "desc" } });
      expect(registro).toMatchObject({ expedienteId: null, ip: "10.0.0.9", detalle: { formato: "csv", origen: "auditoria", vista: "cambios", filtros: { tabla: "feriados_anios", usuarioId: yo.id }, filas: Number(r.headers.get("X-Filas")), truncado: false } });

      // Lo exportado aparece en la vista de accesos.
      const exportaciones = await admin.listarAccesos(yo, { usuarioId: yo.id, accion: "exportar" });
      expect(exportaciones.filas[0].detalle).toMatchObject({ origen: "auditoria" });

      const accesos = await responderExportacionAuditoria(admin, yo, new Request(`http://localhost/admin/auditoria/exportar?vista=accesos&accion=exportar&usuario=${yo.id}`), null);
      expect((await accesos.text()).split("\r\n")[0]).toBe("Fecha y hora;Usuario;CUIL;Acción;Expediente;Motivo;Detalle;IP");

      expect((await responderExportacionAuditoria(admin, null, pedido, null)).status).toBe(401);
      expect((await responderExportacionAuditoria(admin, direccion, pedido, null)).status).toBe(403);
      expect((await responderExportacionAuditoria(admin, yo, new Request("http://localhost/admin/auditoria/exportar?vista=accesos&desde=2026-99-01"), null)).status).toBe(422);
    });
  });
});
