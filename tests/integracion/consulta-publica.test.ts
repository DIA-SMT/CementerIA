// Consulta pública del trámite (28/10/2026; docs/api-dominio.md, sección 24)
// contra la base real: el código de consulta en el alta, "Regenerar código de
// consulta", la consulta correcta e incorrecta, el límite de intentos por IP y
// por número, la purga de los intentos y el relleno de la migración
// *_consulta_publica sobre una base con expedientes.

import { randomInt } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { conActorEn } from "@/lib/db/actor";
import { ErrorDominio, esCodigoConsulta, formatearCodigoConsulta } from "@/lib/dominio/expedientes";
import { PermisoDenegado, type UsuarioPermisos } from "@/lib/dominio/permisos";
import {
  consultarTramite,
  MAXIMO_FALLOS_IP,
  MAXIMO_FALLOS_NUMERO,
  MENSAJE_LIMITE,
  MENSAJE_NO_ENCONTRADO,
  type DependenciasConsulta,
} from "@/lib/dominio/publico/consulta";
import { asegurarSemilla, comando, datosAlta, servicio, usuario } from "./dominio";
import { crearEscenario, crearExpediente } from "./escenario";
import { base, clientePrisma, conPg, enTransaccion, fijarActor, intentar, SISTEMA } from "./helper";

const prisma = clientePrisma();
const exp = servicio(prisma);
const deps: DependenciasConsulta = { leer: prisma, escribir: (usuarioId, motivo, fn) => conActorEn(prisma, usuarioId, motivo, fn) };
let mesa: UsuarioPermisos;
let admin: UsuarioPermisos;
let computo: UsuarioPermisos;

beforeAll(async () => {
  await asegurarSemilla(prisma);
  [mesa, admin, computo] = await Promise.all([usuario(prisma, "MESA_ENTRADAS"), usuario(prisma, "ADMIN"), usuario(prisma, "COMPUTO")]);
});

afterAll(async () => prisma.$disconnect());

/** Una IP de prueba que ningún otro test usa (TEST-NET-2, 198.51.100.0/24, no alcanza: se usa 10.x). */
function ipUnica(): string {
  return `10.${randomInt(0, 256)}.${randomInt(0, 256)}.${randomInt(1, 255)}`;
}

async function nuevoExpediente(): Promise<{ numero: string; codigo: string; id: bigint; version: number }> {
  const r = await exp.alta(mesa, await datosAlta(prisma), comando());
  const e = await prisma.expediente.findUniqueOrThrow({ where: { numeroInterno: r.numero }, select: { id: true, codigoConsulta: true, version: true } });
  return { numero: r.numero, codigo: e.codigoConsulta, id: e.id, version: e.version };
}

/** Un código válido que no es `codigo`. */
function otroCodigo(codigo: string): string {
  return (codigo[0] === "Z" ? "Y" : "Z") + codigo.slice(1);
}

describe("el código de consulta en el alta", () => {
  it("cada alta nace con un código válido y distinto, que no queda en el movimiento", async () => {
    const a = await nuevoExpediente();
    const b = await nuevoExpediente();
    expect(esCodigoConsulta(a.codigo)).toBe(true);
    expect(a.codigo).not.toBe(b.codigo);
    const alta = await prisma.movimiento.findFirstOrThrow({ where: { expedienteId: a.id, tipo: "alta" }, select: { datos: true } });
    expect(JSON.stringify(alta.datos)).not.toContain(a.codigo);
  });

  it("la ficha lo muestra, y el permiso de regenerarlo es de Mesa de Entradas y el admin", async () => {
    const a = await nuevoExpediente();
    const fichaMesa = await exp.obtenerFicha(mesa, a.numero);
    expect(fichaMesa.codigoConsulta).toBe(a.codigo);
    expect(fichaMesa.acciones.regenerarCodigoConsulta.permitido).toBe(true);
    expect((await exp.obtenerFicha(computo, a.numero)).acciones.regenerarCodigoConsulta.permitido).toBe(false);
  });

  it("el comprobante lleva número, trámite, cementerio, inicio y código, y registra la impresión", async () => {
    const a = await nuevoExpediente();
    const c = await exp.datosComprobante(mesa, a.numero, { ip: "10.1.2.3" });
    expect(c).toMatchObject({ numero: a.numero, codigoConsulta: a.codigo, cementerio: "Cementerio del Oeste" });
    expect(c.tipoTramite).toBeTruthy();
    const acceso = await prisma.auditoriaAcceso.findFirstOrThrow({ where: { expedienteId: a.id, accion: "imprimir" }, orderBy: { id: "desc" } });
    expect(acceso.detalle).toEqual({ hoja: "comprobante" });
    expect(acceso.ip).toBe("10.1.2.3");
  });
});

describe("Regenerar código de consulta", () => {
  it("Mesa de Entradas, con motivo: el código cambia, queda en auditoria.accesos y el expediente no se mueve", async () => {
    const a = await nuevoExpediente();
    const movimientosAntes = await prisma.movimiento.count({ where: { expedienteId: a.id } });
    const r = await exp.regenerarCodigoConsulta(mesa, a.numero, "El concesionario perdió el comprobante", { ip: "10.9.8.7" });
    expect(esCodigoConsulta(r.codigoConsulta)).toBe(true);
    expect(r.codigoConsulta).not.toBe(a.codigo);
    const despues = await prisma.expediente.findUniqueOrThrow({ where: { id: a.id }, select: { codigoConsulta: true, version: true } });
    expect(despues.codigoConsulta).toBe(r.codigoConsulta);
    // No es un movimiento: ni la versión ni el historial (ni su cadena de hash) cambian.
    expect(despues.version).toBe(a.version);
    expect(await prisma.movimiento.count({ where: { expedienteId: a.id } })).toBe(movimientosAntes);
    expect((await exp.verificarIntegridad(mesa, a.numero)).integra).toBe(true);
    const acceso = await prisma.auditoriaAcceso.findFirstOrThrow({ where: { expedienteId: a.id, accion: "regenerar_codigo_consulta" } });
    expect(acceso).toMatchObject({ usuarioId: mesa.id, ip: "10.9.8.7", detalle: { motivo: "El concesionario perdió el comprobante" } });
    expect(JSON.stringify(acceso.detalle)).not.toContain(a.codigo);
    expect(JSON.stringify(acceso.detalle)).not.toContain(r.codigoConsulta);
    // El viejo ya no sirve; el nuevo, sí.
    expect((await consultarTramite(deps, { numero: a.numero, codigo: a.codigo }, ipUnica())).ok).toBe(false);
    expect((await consultarTramite(deps, { numero: a.numero, codigo: r.codigoConsulta }, ipUnica())).ok).toBe(true);
  });

  it("el admin también; sin motivo no, y Cómputo no puede", async () => {
    const a = await nuevoExpediente();
    await expect(exp.regenerarCodigoConsulta(admin, a.numero, "Se filtró en una captura")).resolves.toMatchObject({ numero: a.numero });
    await expect(exp.regenerarCodigoConsulta(mesa, a.numero, "corto")).rejects.toSatisfy((e) => e instanceof ErrorDominio && e.codigo === "motivo_requerido");
    await expect(exp.regenerarCodigoConsulta(computo, a.numero, "El concesionario perdió el comprobante")).rejects.toBeInstanceOf(PermisoDenegado);
  });

  it("nadie cambia el código con un UPDATE suelto, ni la app ni el owner: hace falta pedirlo para ese expediente y con motivo", async () => {
    const a = await nuevoExpediente();
    const otro = await nuevoExpediente();
    const actualizar = "UPDATE public.expedientes SET codigo_consulta = $2 WHERE id = $1";
    for (const rol of ["app", "owner"] as const) {
      await enTransaccion(rol, async (c) => {
        await fijarActor(c, SISTEMA, "Prueba de integración");
        const r = await intentar(c, actualizar, [a.id.toString(), "AAAABBBB"]);
        expect(r).toMatchObject({ ok: false });
        if (!r.ok) expect(r.error).toMatch(/solo cambia con "Regenerar código de consulta"/);
      });
    }
    await enTransaccion("app", async (c) => {
      const pedir = (id: bigint) => c.query("SELECT set_config('app.regenerar_codigo_consulta', $1, true)", [id.toString()]);
      // Pedido para otro expediente: no vale para este.
      await fijarActor(c, SISTEMA, "Prueba de integración");
      await pedir(otro.id);
      expect(await intentar(c, actualizar, [a.id.toString(), "AAAABBBB"])).toMatchObject({ ok: false });
      // Sin motivo, no.
      await fijarActor(c, SISTEMA, null);
      await pedir(a.id);
      const sinMotivo = await intentar(c, actualizar, [a.id.toString(), "AAAABBBB"]);
      expect(sinMotivo).toMatchObject({ ok: false });
      if (!sinMotivo.ok) expect(sinMotivo.error).toMatch(/motivo/);
      // Con motivo, pero un código con otra forma: el CHECK.
      await fijarActor(c, SISTEMA, "Prueba de integración");
      await pedir(a.id);
      expect(await intentar(c, actualizar, [a.id.toString(), "UUUUUUUU"])).toMatchObject({ ok: false });
      // Bien pedido: cambia, deja la constancia y el pedido no sirve para un segundo cambio.
      await pedir(a.id);
      expect(await intentar(c, actualizar, [a.id.toString(), "AAAABBBB"])).toMatchObject({ ok: true });
      const constancia = await c.query("SELECT accion, detalle FROM auditoria.accesos WHERE expediente_id = $1 AND accion = 'regenerar_codigo_consulta'", [
        a.id.toString(),
      ]);
      expect(constancia.rows).toEqual([{ accion: "regenerar_codigo_consulta", detalle: { motivo: "Prueba de integración" } }]);
      expect(await intentar(c, actualizar, [a.id.toString(), "CCCCDDDD"])).toMatchObject({ ok: false });
    });
  });
});

describe("la consulta pública", () => {
  it("correcta: devuelve solo lo público y deja la consulta sin usuario", async () => {
    const a = await nuevoExpediente();
    const ip = ipUnica();
    const r = await consultarTramite(deps, { numero: a.numero.toLowerCase(), codigo: formatearCodigoConsulta(a.codigo).toLowerCase() }, ip);
    if (!r.ok) throw new Error(r.mensaje);
    expect(r.tramite).toMatchObject({ numero: a.numero, cementerio: "Cementerio del Oeste", estado: "en_tramite", area: { nombre: "Mesa de Entradas" } });
    expect(Object.keys(r.tramite).sort()).toEqual(["area", "cementerio", "estado", "fechaInicio", "numero", "paso", "tipoTramite", "ultimoMovimiento"]);
    expect(r.tramite.paso.orden).toBe(1);
    const acceso = await prisma.auditoriaAcceso.findFirstOrThrow({ where: { expedienteId: a.id, accion: "consulta_publica" } });
    expect(acceso).toMatchObject({ usuarioId: null, ip, detalle: {} });
  });

  it("incorrecta: el mismo mensaje para un número que no existe y un código que no es, y queda el intento", async () => {
    const a = await nuevoExpediente();
    const ip = ipUnica();
    const inexistente = await consultarTramite(deps, { numero: "CEM-1998-00001", codigo: a.codigo }, ip);
    const malCodigo = await consultarTramite(deps, { numero: a.numero, codigo: otroCodigo(a.codigo) }, ip);
    expect(inexistente).toEqual({ ok: false, motivo: "no_encontrado", mensaje: MENSAJE_NO_ENCONTRADO });
    expect(malCodigo).toEqual(inexistente);
    const intentos = await conPg("owner", async (c) => (await c.query("SELECT numero, resultado FROM auditoria.intentos_consulta WHERE ip = $1 ORDER BY id", [ip])).rows);
    expect(intentos).toEqual([
      { numero: "CEM-1998-00001", resultado: "fallido" },
      { numero: a.numero, resultado: "fallido" },
    ]);
  });

  it(`límite por IP: con ${MAXIMO_FALLOS_IP} fallidos, la siguiente (aun correcta) se bloquea`, async () => {
    const a = await nuevoExpediente();
    const ip = ipUnica();
    for (let i = 0; i < MAXIMO_FALLOS_IP; i++) {
      const r = await consultarTramite(deps, { numero: `CEM-1998-${String(randomInt(1, 99_999)).padStart(5, "0")}`, codigo: "ZZZZZZZZ" }, ip);
      expect(r).toMatchObject({ ok: false, motivo: "no_encontrado" });
    }
    expect(await consultarTramite(deps, { numero: a.numero, codigo: a.codigo }, ip)).toEqual({ ok: false, motivo: "limite", mensaje: MENSAJE_LIMITE });
    // Desde otra IP, el mismo expediente se consulta.
    expect((await consultarTramite(deps, { numero: a.numero, codigo: a.codigo }, ipUnica())).ok).toBe(true);
  });

  it(`límite por número: con ${MAXIMO_FALLOS_NUMERO} fallidos (desde IP distintas), la siguiente (aun correcta) se bloquea`, async () => {
    const a = await nuevoExpediente();
    for (let i = 0; i < MAXIMO_FALLOS_NUMERO; i++) {
      expect((await consultarTramite(deps, { numero: a.numero, codigo: otroCodigo(a.codigo) }, ipUnica())).ok).toBe(false);
    }
    const ip = ipUnica();
    expect(await consultarTramite(deps, { numero: a.numero, codigo: a.codigo }, ip)).toEqual({ ok: false, motivo: "limite", mensaje: MENSAJE_LIMITE });
    const bloqueo = await conPg("owner", async (c) => (await c.query("SELECT numero, resultado FROM auditoria.intentos_consulta WHERE ip = $1", [ip])).rows);
    expect(bloqueo).toEqual([{ numero: a.numero, resultado: "bloqueado" }]);
    // Otro número, desde la misma IP, sí.
    const b = await nuevoExpediente();
    expect((await consultarTramite(deps, { numero: b.numero, codigo: b.codigo }, ip)).ok).toBe(true);
  });

  it("los intentos no se modifican ni se borran antes de los 7 días (tampoco el owner); la purga borra los vencidos", async () => {
    for (const rol of ["app", "owner"] as const) {
      await enTransaccion(rol, async (c) => {
        await c.query("INSERT INTO auditoria.intentos_consulta (ip, numero, resultado) VALUES ('10.0.0.1', NULL, 'fallido')");
        const update = await intentar(c, "UPDATE auditoria.intentos_consulta SET resultado = 'bloqueado'");
        expect(update).toMatchObject({ ok: false });
        const borrar = await intentar(c, "DELETE FROM auditoria.intentos_consulta WHERE en > now() - interval '1 hour'");
        expect(borrar).toMatchObject({ ok: false });
        if (!borrar.ok) expect(borrar.error).toMatch(/más de 7 días/);
        expect(await intentar(c, "TRUNCATE auditoria.intentos_consulta")).toMatchObject({ ok: false });
      });
    }
    await enTransaccion("app", async (c) => {
      const viejo = await c.query<{ id: string }>(
        "INSERT INTO auditoria.intentos_consulta (en, ip, numero, resultado) VALUES (now() - interval '8 days', '10.0.0.1', NULL, 'fallido') RETURNING id",
      );
      const nuevo = await c.query<{ id: string }>("INSERT INTO auditoria.intentos_consulta (ip, numero, resultado) VALUES ('10.0.0.1', NULL, 'fallido') RETURNING id");
      const borrados = (await c.query<{ n: number }>("SELECT public.f_purgar_intentos_consulta() AS n")).rows[0].n;
      expect(borrados).toBeGreaterThanOrEqual(1);
      const quedan = (await c.query("SELECT id FROM auditoria.intentos_consulta WHERE id = ANY($1::bigint[])", [[viejo.rows[0].id, nuevo.rows[0].id]])).rows;
      expect(quedan).toEqual([{ id: nuevo.rows[0].id }]);
    });
  });
});

describe("la migración *_consulta_publica sobre una base con expedientes", () => {
  it("rellena un código válido y distinto en cada uno, sin tocar actualizado_en, y después no se cambia", async () => {
    const b = base();
    const nombre = `cementeria_relleno_${randomInt(1_000_000, 9_999_999)}`;
    const urlCon = (url: string) => {
      const u = new URL(url);
      u.pathname = `/${nombre}`;
      return u.toString();
    };
    const raiz = path.resolve(__dirname, "..", "..");
    const carpeta = path.join(raiz, "prisma", "migrations");
    const migraciones = readdirSync(carpeta, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    const nueva = migraciones.find((m) => m.endsWith("_consulta_publica"));
    if (!nueva) throw new Error("No está la migración *_consulta_publica");
    const anteriores = migraciones.filter((m) => m < nueva);

    const superusuario = new pg.Client({ connectionString: b.urlSuperusuario });
    await superusuario.connect();
    try {
      await superusuario.query(`CREATE DATABASE ${nombre} OWNER cementeria_owner ENCODING 'UTF8' TEMPLATE template0`);
      await superusuario.query(`ALTER DATABASE ${nombre} SET timezone TO 'America/Argentina/Tucuman'`);
      await superusuario.query(`GRANT CONNECT ON DATABASE ${nombre} TO cementeria_app, cementeria_deploy`);

      const correr = async (url: string, sql: string): Promise<void> => {
        const c = new pg.Client({ connectionString: url });
        await c.connect();
        try {
          await c.query("BEGIN");
          await c.query(sql);
          await c.query("COMMIT");
        } finally {
          await c.end();
        }
      };
      for (const m of anteriores) await correr(urlCon(b.urlDeploy), readFileSync(path.join(carpeta, m, "migration.sql"), "utf8"));

      // Expedientes cargados antes de la migración (como la app, firmados por SISTEMA).
      const app = new pg.Client({ connectionString: urlCon(b.urlApp) });
      await app.connect();
      const CANTIDAD = 40;
      try {
        await app.query("BEGIN");
        await fijarActor(app, SISTEMA, "Prueba de integración: expedientes anteriores a la consulta pública");
        const e = await crearEscenario(app);
        for (let i = 0; i < CANTIDAD; i++) await crearExpediente(app, e);
        await app.query("COMMIT");
      } finally {
        await app.end();
      }
      const leer = async <F extends pg.QueryResultRow>(sql: string): Promise<F> => {
        const c = new pg.Client({ connectionString: urlCon(b.urlDeploy) });
        await c.connect();
        try {
          return (await c.query<F>(sql)).rows[0];
        } finally {
          await c.end();
        }
      };
      const antes = await leer<{ ultimo: Date }>("SELECT max(actualizado_en) AS ultimo FROM public.expedientes");

      await correr(urlCon(b.urlDeploy), readFileSync(path.join(carpeta, nueva, "migration.sql"), "utf8"));

      const despues = await leer<{ n: number; validos: number; distintos: number; ultimo: Date }>(
        `SELECT count(*)::int AS n, count(*) FILTER (WHERE codigo_consulta ~ '^[0-9A-HJKMNP-TV-Z]{8}$')::int AS validos,
                count(DISTINCT codigo_consulta)::int AS distintos, max(actualizado_en) AS ultimo FROM public.expedientes`,
      );
      expect(despues).toMatchObject({ n: CANTIDAD, validos: CANTIDAD, distintos: CANTIDAD });
      expect(despues.ultimo.getTime()).toBe(antes.ultimo.getTime());
      const trigger = await leer<{ tgenabled: string }>(
        "SELECT tgenabled FROM pg_trigger WHERE tgrelid = 'public.expedientes'::regclass AND tgname = 'expedientes_preparar'",
      );
      expect(trigger.tgenabled).toBe("A");

      const appDespues = new pg.Client({ connectionString: urlCon(b.urlApp) });
      await appDespues.connect();
      try {
        await appDespues.query("BEGIN");
        await fijarActor(appDespues, SISTEMA, "Prueba de integración");
        const r = await intentar(appDespues, "UPDATE public.expedientes SET codigo_consulta = 'AAAABBBB'");
        expect(r).toMatchObject({ ok: false });
        await appDespues.query("ROLLBACK");
      } finally {
        await appDespues.end();
      }
    } finally {
      await superusuario.query(`DROP DATABASE IF EXISTS ${nombre} WITH (FORCE)`);
      await superusuario.end();
    }
  }, 120_000);
});
