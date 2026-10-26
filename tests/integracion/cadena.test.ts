// La cadena de hash del historial (migración *_cadena_hash; 26/10/2026):
// cada movimiento lleva el SHA-256 de una lista explícita de sus campos y del
// hash del movimiento anterior del mismo expediente. Se forma sola (trigger
// movimientos_sellar) en toda acción del dominio; f_verificar_cadena la
// recalcula y encuentra el primer movimiento alterado, el hash_anterior
// cambiado y el movimiento borrado; el hash no depende de la zona horaria de la
// sesión; y el dominio verifica (ficha, admin) y lo deja en auditoria.accesos.
//
// Las alteraciones se simulan como superusuario deshabilitando
// movimientos_inmutables DENTRO de una transacción que se revierte: el trigger
// vuelve a estar como estaba y nada queda roto en la base compartida.

import { createHash, randomUUID } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ErrorDominio, type FilaTranscripcion, type ServicioExpedientes } from "@/lib/dominio/expedientes";
import { PermisoDenegado, type UsuarioPermisos } from "@/lib/dominio/permisos";
import { asegurarSemilla, avanzar, comando, completarPaso, conciliacion, datosAlta, movimientos, servicio, usuario } from "./dominio";
import { clientePrisma, conPg, fijarActor, intentar } from "./helper";

const prisma = clientePrisma();
let exp: ServicioExpedientes;
let mesa: UsuarioPermisos;
let computo: UsuarioPermisos;
let liquidacion: UsuarioPermisos;
let direccion: UsuarioPermisos;
let admin: UsuarioPermisos;

beforeAll(async () => {
  await asegurarSemilla(prisma);
  exp = servicio(prisma);
  [mesa, computo, liquidacion, direccion, admin] = await Promise.all([
    usuario(prisma, "MESA_ENTRADAS"),
    usuario(prisma, "COMPUTO"),
    usuario(prisma, "LIQUIDACION"),
    usuario(prisma, "DIRECCION"),
    usuario(prisma, "ADMIN"),
  ]);
});

afterAll(async () => prisma.$disconnect());

const RE_HASH = /^[0-9a-f]{64}$/;

async function errorDe(p: Promise<unknown>): Promise<ErrorDominio | PermisoDenegado> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ErrorDominio || e instanceof PermisoDenegado) return e;
    throw e;
  }
  throw new Error("se esperaba un error");
}

interface Cadena {
  integra: boolean;
  movimientos: number;
  hash_final: string | null;
  secuencia_rota: number | null;
  motivo: string | null;
}

async function cadena(c: pg.Client, numero: string): Promise<Cadena> {
  const r = await c.query<Cadena>(
    `SELECT v.* FROM public.expedientes e CROSS JOIN LATERAL public.f_verificar_cadena(e.id) v WHERE e.numero_interno = $1`,
    [numero],
  );
  return r.rows[0];
}

const sha256 = (texto: string) => createHash("sha256").update(texto, "utf8").digest("hex");

/** "2026-10-26 15:04:05.12+00" (timestamptz::text en una sesión UTC) → "2026-10-26T15:04:05.120000Z". */
function isoUtc(texto: string): string {
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(?:\.(\d+))?\+00$/.exec(texto);
  if (!m) throw new Error(`Fecha inesperada: ${texto}`);
  return `${m[1]}T${m[2]}.${(m[3] ?? "").padEnd(6, "0")}Z`;
}

/**
 * El formato canónico de la migración, escrito de nuevo en TypeScript a partir
 * del comentario de f_hash_movimiento: si alguien cambia la función sin
 * cambiar la documentación (o al revés), esto falla. Es lo que haría un
 * verificador externo con un export de la tabla.
 */
async function hashSegunDocumentacion(c: pg.Client, id: string): Promise<{ calculado: string; guardado: string }> {
  await c.query("SET TimeZone = 'UTC'");
  const r = await c.query<Record<string, string | null>>(
    `SELECT expediente_id::text, secuencia::text, tipo, fecha_efectiva::text, precision_fecha, registrado_en::text,
            usuario_id::text, area_usuario_id::text, paso_origen, paso_destino, area_origen_id::text, area_destino_id::text,
            estado_anterior, estado_nuevo, observacion, motivo, datos::text, corrige_movimiento_id::text,
            carga_historica::text, fuente, comando_id::text, hash_anterior, hash
       FROM public.movimientos WHERE id = $1`,
    [id],
  );
  const f = r.rows[0];
  const campos = [
    f.expediente_id,
    f.secuencia,
    f.tipo,
    isoUtc(f.fecha_efectiva ?? ""),
    f.precision_fecha,
    isoUtc(f.registrado_en ?? ""),
    f.usuario_id,
    f.area_usuario_id,
    f.paso_origen,
    f.paso_destino,
    f.area_origen_id,
    f.area_destino_id,
    f.estado_anterior,
    f.estado_nuevo,
    f.observacion,
    f.motivo,
    f.datos,
    f.corrige_movimiento_id,
    f.carga_historica,
    f.fuente,
    f.comando_id,
    f.hash_anterior,
  ];
  // Largo en caracteres (no en bytes), como char_length.
  const texto = "cementeria-mov-v1" + campos.map((v) => "|" + (v === null ? "-" : `${[...v].length}:${v}`)).join("");
  return { calculado: sha256(texto), guardado: f.hash ?? "" };
}

/** Cada movimiento encadena contra el anterior; el primero, contra el número interno. */
async function controlarEncadenado(numero: string): Promise<void> {
  const ms = await movimientos(prisma, numero);
  expect(ms.length).toBeGreaterThan(0);
  expect(ms.map((m) => m.secuencia)).toEqual(ms.map((_, i) => i + 1));
  expect(ms[0].hashAnterior).toBe(sha256(`cementeria-inicio-v1|${numero}`));
  for (let i = 0; i < ms.length; i++) {
    expect(ms[i].hash).toMatch(RE_HASH);
    if (i > 0) expect(ms[i].hashAnterior).toBe(ms[i - 1].hash);
  }
  const v = await exp.verificarIntegridad(mesa, numero);
  expect(v).toEqual({
    numero,
    integra: true,
    movimientos: ms.length,
    hashFinal: ms.at(-1)?.hash,
    huella: ms.at(-1)?.hash?.slice(0, 16),
    secuenciaRota: null,
    motivo: null,
  });
  const c = await conciliacion(prisma, numero);
  expect(c.actual).toEqual(c.reconstruida);
}

describe("la cadena se forma sola en cada acción del dominio", () => {
  it("alta, pases, recepción, nota, corrección de observación, revertir y devolución", async () => {
    const alta = await exp.alta(mesa, await datosAlta(prisma), comando());
    await controlarEncadenado(alta.numero);

    await avanzar(exp, prisma, alta.numero); // a Cómputo
    const v1 = await completarPaso(exp, prisma, alta.numero); // recepción implícita y tildes de Cómputo
    const pase = await exp.darPase(computo, alta.numero, "LIQUIDACION", v1, comando());
    const recibido = await exp.confirmarRecepcion(liquidacion, alta.numero, pase.version, comando());
    const nota = await exp.agregarNota(liquidacion, alta.numero, "Nota con | y : para el formato", recibido.version, comando());
    await controlarEncadenado(alta.numero);

    // Revertir el pase (arrastra la recepción y la nota).
    const r = await exp.revertir(computo, alta.numero, pase.movimientoId, "Pase dado por error: faltaba la constancia", nota.version, comando());
    await controlarEncadenado(alta.numero);

    // Una nota con la observación corregida.
    const nota2 = await exp.agregarNota(computo, alta.numero, "-", r.version, comando());
    const obs = await exp.corregirObservacion(computo, alta.numero, nota2.movimientoId, "Nota corregida", "La observación tenía un error", nota2.version, comando());
    await controlarEncadenado(alta.numero);

    // Y una devolución a Mesa.
    await exp.devolver(computo, alta.numero, "MESA", "Falta la fotocopia del DNI del titular", [], obs.version, comando());
    await controlarEncadenado(alta.numero);

    // El formato documentado en la migración da el mismo hash que la función, en todos.
    await conPg("app", async (c) => {
      for (const m of await movimientos(prisma, alta.numero)) {
        const { calculado, guardado } = await hashSegunDocumentacion(c, m.id.toString());
        expect(calculado).toBe(guardado);
      }
    });
  });

  it("la transcripción histórica (varias filas en una transacción) y un expediente con fecha de 2019", async () => {
    const alta = await exp.alta(mesa, await datosAlta(prisma, { cargaHistorica: true, fuente: "Ficha papel", fechaInicio: "2019-03-15" }), comando());
    const fila = (f: Partial<FilaTranscripcion> & Pick<FilaTranscripcion, "fecha" | "pasoDestino">): FilaTranscripcion => ({
      comandoId: randomUUID(),
      fuente: "Ficha papel",
      ...f,
    });
    const r = await exp.transcribir(
      mesa,
      alta.numero,
      [
        fila({ fecha: "2019-03-20", pasoDestino: "COMPUTO_ALTA" }),
        fila({ fecha: "2019-04-02", pasoDestino: "LIQUIDACION", observacion: "Con estado de cuenta" }),
        fila({ fecha: "2019-05-10", pasoDestino: "LEGAL", fuente: "Libro de pases de Legal" }),
      ],
      0,
    );
    expect(r.filas).toHaveLength(3);
    await controlarEncadenado(alta.numero);
    await conPg("app", async (c) => {
      for (const m of await movimientos(prisma, alta.numero)) {
        const { calculado, guardado } = await hashSegunDocumentacion(c, m.id.toString());
        expect(calculado).toBe(guardado);
      }
    });
  });

  it("lo que mande la app en hash y hash_anterior se pisa", async () => {
    const alta = await exp.alta(mesa, await datosAlta(prisma), comando());
    const e = await prisma.expediente.findUniqueOrThrow({ where: { numeroInterno: alta.numero }, select: { id: true } });
    await conPg("app", async (c) => {
      await c.query("BEGIN");
      try {
        await fijarActor(c, mesa.id);
        const falso = "0".repeat(64);
        const r = await c.query<{ hash: string; hash_anterior: string }>(
          `INSERT INTO public.movimientos (expediente_id, tipo, fecha_efectiva, usuario_id, comando_id, hash, hash_anterior)
           VALUES ($1, 'nota', now(), $2, gen_random_uuid(), $3, $3) RETURNING hash, hash_anterior`,
          [e.id.toString(), mesa.id, falso],
        );
        expect(r.rows[0].hash).not.toBe(falso);
        expect(r.rows[0].hash_anterior).not.toBe(falso);
        expect(await cadena(c, alta.numero)).toMatchObject({ integra: true, movimientos: 2 });
      } finally {
        await c.query("ROLLBACK");
      }
    });
  });
});

describe("f_verificar_cadena encuentra la alteración", () => {
  it("un campo cambiado, un hash_anterior cambiado, un movimiento borrado y una cadena recalculada desde el medio", async () => {
    const alta = await exp.alta(mesa, await datosAlta(prisma), comando());
    let v = (await exp.obtenerFicha(mesa, alta.numero)).version;
    for (const texto of ["Primera nota", "Segunda nota", "Tercera nota"]) {
      v = (await exp.agregarNota(mesa, alta.numero, texto, v, comando())).version;
    }
    const ms = await movimientos(prisma, alta.numero);
    expect(ms.map((m) => m.tipo)).toEqual(["alta", "nota", "nota", "nota"]);
    const id = (secuencia: number) => ms[secuencia - 1].id.toString();

    await conPg("superusuario", async (c) => {
      await c.query("BEGIN");
      try {
        // Sin deshabilitar el trigger, ni el superusuario puede tocarlo.
        expect(await intentar(c, "UPDATE public.movimientos SET observacion = 'x' WHERE id = $1", [id(2)])).toMatchObject({ ok: false });
        await c.query("ALTER TABLE public.movimientos DISABLE TRIGGER movimientos_inmutables");
        expect(await cadena(c, alta.numero)).toEqual({ integra: true, movimientos: 4, hash_final: ms[3].hash, secuencia_rota: null, motivo: null });

        // a) Un campo cambiado: el hash guardado ya no es el de la fila.
        await c.query("SAVEPOINT caso");
        await c.query("UPDATE public.movimientos SET observacion = 'Nota adulterada' WHERE id = $1", [id(2)]);
        expect(await cadena(c, alta.numero)).toMatchObject({ integra: false, movimientos: 4, secuencia_rota: 2, motivo: "hash_distinto" });
        await c.query("ROLLBACK TO SAVEPOINT caso");

        // También la fecha efectiva (un segundo) o el autor.
        await c.query("UPDATE public.movimientos SET fecha_efectiva = fecha_efectiva + interval '1 second' WHERE id = $1", [id(3)]);
        expect(await cadena(c, alta.numero)).toMatchObject({ integra: false, secuencia_rota: 3, motivo: "hash_distinto" });
        await c.query("ROLLBACK TO SAVEPOINT caso");

        // b) Un hash_anterior cambiado.
        await c.query("UPDATE public.movimientos SET hash_anterior = $2 WHERE id = $1", [id(3), "f".repeat(64)]);
        expect(await cadena(c, alta.numero)).toMatchObject({ integra: false, secuencia_rota: 3, motivo: "hash_anterior_distinto" });
        await c.query("ROLLBACK TO SAVEPOINT caso");

        // c) Un movimiento borrado del medio.
        await c.query("DELETE FROM public.movimientos WHERE id = $1", [id(2)]);
        expect(await cadena(c, alta.numero)).toMatchObject({ integra: false, movimientos: 3, secuencia_rota: 2, motivo: "secuencia_faltante" });
        await c.query("ROLLBACK TO SAVEPOINT caso");

        // d) Quien cambia un movimiento y recalcula su hash rompe el siguiente.
        await c.query(
          `UPDATE public.movimientos m SET observacion = 'Nota adulterada' WHERE id = $1;
           UPDATE public.movimientos m SET hash = public.f_hash_movimiento(m) WHERE id = $1`.replaceAll("$1", id(2)),
        );
        expect(await cadena(c, alta.numero)).toMatchObject({ integra: false, secuencia_rota: 3, motivo: "hash_anterior_distinto" });
        await c.query("ROLLBACK TO SAVEPOINT caso");

        // Lo que la cadena sola no ve: borrar el último. Para eso está la huella impresa.
        await c.query("DELETE FROM public.movimientos WHERE id = $1", [id(4)]);
        expect(await cadena(c, alta.numero)).toEqual({ integra: true, movimientos: 3, hash_final: ms[2].hash, secuencia_rota: null, motivo: null });
        await c.query("ROLLBACK TO SAVEPOINT caso");
      } finally {
        await c.query("ROLLBACK");
      }
    });

    // El ROLLBACK dejó el trigger como estaba y la cadena íntegra.
    await conPg("superusuario", async (c) => {
      const t = await c.query<{ tgenabled: string }>("SELECT tgenabled FROM pg_trigger WHERE tgname = 'movimientos_inmutables'");
      expect(t.rows).toEqual([{ tgenabled: "A" }]);
      expect(await cadena(c, alta.numero)).toMatchObject({ integra: true, movimientos: 4 });
    });
  });

  it("el CHECK no deja una fila sin hash, ni un hash que no sea hex de 64", async () => {
    const alta = await exp.alta(mesa, await datosAlta(prisma), comando());
    await conPg("superusuario", async (c) => {
      await c.query("BEGIN");
      try {
        await c.query("ALTER TABLE public.movimientos DISABLE TRIGGER movimientos_inmutables");
        const filtro = "expediente_id = (SELECT id FROM public.expedientes WHERE numero_interno = $1)";
        const nulo = await intentar(c, `UPDATE public.movimientos SET hash = NULL WHERE ${filtro}`, [alta.numero]);
        expect(nulo).toMatchObject({ ok: false });
        if (!nulo.ok) expect(nulo.error).toMatch(/movimientos_hash_check/);
        const mayusculas = await intentar(c, `UPDATE public.movimientos SET hash_anterior = upper(hash_anterior) WHERE ${filtro}`, [alta.numero]);
        expect(mayusculas).toMatchObject({ ok: false });
      } finally {
        await c.query("ROLLBACK");
      }
    });
  });
});

describe("el hash no depende de la zona horaria de la sesión", () => {
  it("un movimiento insertado en hora de Tucumán (psql) se verifica igual desde una sesión en UTC (la app) o en otra zona", async () => {
    const alta = await exp.alta(mesa, await datosAlta(prisma), comando());
    const e = await prisma.expediente.findUniqueOrThrow({ where: { numeroInterno: alta.numero }, select: { id: true } });

    // La sesión de pg sin opciones toma la zona de la base: Tucumán, como psql.
    await conPg("app", async (c) => {
      expect((await c.query<{ z: string }>("SELECT current_setting('TimeZone') AS z")).rows[0].z).toBe("America/Argentina/Tucuman");
      await c.query("BEGIN");
      await fijarActor(c, mesa.id);
      await c.query(
        `INSERT INTO public.movimientos (expediente_id, tipo, fecha_efectiva, precision_fecha, usuario_id, observacion, comando_id)
         VALUES ($1, 'nota', (current_date::timestamp AT TIME ZONE 'America/Argentina/Tucuman'), 'dia', $2, 'Desde psql', gen_random_uuid())`,
        [e.id.toString(), mesa.id],
      );
      await c.query("COMMIT");
    });

    const hashes = new Set<string>();
    for (const zona of ["UTC", "America/Argentina/Tucuman", "Asia/Tokyo", "Pacific/Kiritimati"]) {
      await conPg("app", async (c) => {
        await c.query(`SET TimeZone = '${zona}'`);
        expect(await cadena(c, alta.numero)).toMatchObject({ integra: true, movimientos: 2 });
        const r = await c.query<{ h: string }>(
          `SELECT string_agg(public.f_hash_movimiento(m), ',' ORDER BY m.secuencia) AS h FROM public.movimientos m WHERE m.expediente_id = $1`,
          [e.id.toString()],
        );
        hashes.add(r.rows[0].h);
      });
    }
    expect(hashes.size).toBe(1);
    // Y desde la app (Prisma, sesión en UTC).
    expect(await exp.verificarIntegridad(mesa, alta.numero)).toMatchObject({ integra: true, movimientos: 2 });
  });
});

describe("el dominio", () => {
  it("verificarIntegridad: quien puede ver la ficha (también Dirección), queda en auditoria.accesos con el resultado", async () => {
    const alta = await exp.alta(mesa, await datosAlta(prisma), comando());
    const r = await exp.verificarIntegridad(direccion, alta.numero.replace(/^CEM-(\d{4})-0*(\d+)$/, "$2/$1"), { ip: "10.0.0.7" });
    expect(r).toMatchObject({ numero: alta.numero, integra: true, movimientos: 1, secuenciaRota: null, motivo: null });
    expect(r.huella).toBe(r.hashFinal?.slice(0, 16));

    const e = await prisma.expediente.findUniqueOrThrow({ where: { numeroInterno: alta.numero }, select: { id: true } });
    const accesos = await prisma.auditoriaAcceso.findMany({ where: { expedienteId: e.id, accion: "verificar_historial" } });
    expect(accesos).toHaveLength(1);
    expect(accesos[0]).toMatchObject({
      usuarioId: direccion.id,
      ip: "10.0.0.7",
      detalle: { alcance: "expediente", integra: true, movimientos: 1, hash_final: r.hashFinal, secuencia_rota: null, motivo: null },
    });

    expect(await errorDe(exp.verificarIntegridad(mesa, "CEM-1999-99999"))).toMatchObject({ codigo: "no_encontrado" });
  });

  it("verificarIntegridadTodos: solo el admin, con resumen y registro", async () => {
    const alta = await exp.alta(mesa, await datosAlta(prisma), comando());
    expect(await errorDe(exp.verificarIntegridadTodos(mesa))).toBeInstanceOf(PermisoDenegado);
    expect(await errorDe(exp.verificarIntegridadTodos(direccion))).toBeInstanceOf(PermisoDenegado);

    const r = await exp.verificarIntegridadTodos(admin);
    const total = await prisma.expediente.count();
    expect(r.expedientes).toBe(total);
    expect(r.integros).toBe(total);
    expect(r.rotos).toEqual([]);
    expect(r.movimientos).toBe(await prisma.movimiento.count());
    const acceso = await prisma.auditoriaAcceso.findFirstOrThrow({
      where: { usuarioId: admin.id, accion: "verificar_historial", expedienteId: null },
      orderBy: { id: "desc" },
    });
    expect(acceso.detalle).toMatchObject({ alcance: "todos", origen: "admin", expedientes: total, integros: total, cantidad_rotos: 0, rotos: [] });
    expect(alta.numero).toBeTruthy();
  });

  it("los imprimibles llevan la huella del último movimiento y la ficha, el historial agrupado por paso", async () => {
    const alta = await exp.alta(mesa, await datosAlta(prisma), comando());
    await avanzar(exp, prisma, alta.numero); // a Cómputo, sin confirmar
    const v = await completarPaso(exp, prisma, alta.numero); // recepción implícita y tildes
    await exp.agregarNota(computo, alta.numero, "Nota en Cómputo", v, comando());
    const ultimo = (await movimientos(prisma, alta.numero)).at(-1);

    const caratula = await exp.datosCaratula(mesa, alta.numero);
    expect(caratula.integridad).toMatchObject({ integra: true, hashFinal: ultimo?.hash, huella: ultimo?.hash?.slice(0, 16) });
    const hoja = await exp.datosHistorial(mesa, alta.numero);
    expect(hoja.integridad.huella).toBe(ultimo?.hash?.slice(0, 16));
    expect(hoja.integridad.movimientos).toBe(hoja.historial.length);

    const ficha = await exp.obtenerFicha(mesa, alta.numero);
    expect(ficha.tramos.map((t) => [t.orden, t.paso?.clave, t.area?.codigo, t.actual])).toEqual([
      [1, "MESA", "MESA_ENTRADAS", false],
      [2, "COMPUTO_ALTA", "COMPUTO", true],
    ]);
    // Todos los movimientos están en un tramo, en el orden del historial.
    expect(ficha.tramos.flatMap((t) => t.movimientos)).toEqual(ficha.historial.map((m) => m.id));
    expect(ficha.tramos[0].hasta).toEqual(ficha.tramos[1].desde);
    expect(ficha.tramos[1].hasta).toBeNull();
    for (const t of ficha.tramos) expect(t.diasHabiles).toBeGreaterThanOrEqual(0);
    expect(hoja.tramos).toEqual(ficha.tramos);
  });
});
