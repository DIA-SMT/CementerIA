// Avisos en el sistema (26/10/2026; docs/api-dominio.md, sección 21).
//
// - Cada evento (pase, devolución, concluir, archivar) crea el aviso en la
//   misma transacción, para los operadores activos del área que corresponde y
//   para nadie más (ni quien actuó, ni otras áreas, ni Dirección, ni el admin,
//   ni un inactivo); un comando repetido no lo duplica.
// - La generación por tiempo (plazo DIM, sin confirmar, demorado) es
//   idempotente y cuenta días hábiles con los feriados.
// - Cada usuario marca leídos solo los suyos; la app no borra ni cambia otra
//   columna que `leido_en`.
//
// Casi todo corre en UNA transacción que se deshace al final (como
// admin.ts): los tests crean usuarios extra por área (uno activo y uno
// inactivo) y no pueden quedar confirmados (semilla.test.ts cuenta los
// usuarios). Los ayudantes de dominio.ts reciben esa transacción como cliente:
// solo leen con ella.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Cliente, Transaccion } from "@/lib/db/crear-cliente";
import { crearServicioAvisos, type ServicioAvisos } from "@/lib/dominio/avisos";
import { crearServicioExpedientes, type Escritor, type ServicioExpedientes } from "@/lib/dominio/expedientes";
import type { UsuarioPermisos } from "@/lib/dominio/permisos";
import { hoyEnTucuman, inicioDelDiaEnTucuman, sumarDias, type FechaISO } from "@/lib/fechas";
import { comoUsuario, cuilFicticio } from "./admin";
import { asegurarSemilla, avanzar, comando, completarPaso, datosAlta, hastaElUltimoPaso, idArea, proyeccion, usuario } from "./dominio";
import { crearEscenario, crearExpediente, fila, insertar } from "./escenario";
import { SISTEMA, clientePrisma, enTransaccion, fijarActor, intentar } from "./helper";

const prisma = clientePrisma();

beforeAll(async () => {
  await asegurarSemilla(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

class Deshacer extends Error {}

interface Contexto {
  tx: Transaccion;
  /** La transacción como "cliente", para los ayudantes de dominio.ts (solo leen). */
  db: Cliente;
  exp: ServicioExpedientes;
  avisos: ServicioAvisos;
  /** Los mismos servicios con el reloj en ese instante. */
  conReloj: (ahora: Date) => { exp: ServicioExpedientes; avisos: ServicioAvisos };
  comoActor: (usuarioId: number, motivo?: string | null) => Promise<void>;
}

/** Corre `fn` con los servicios sobre una transacción que se deshace al final (cada escritura, en un SAVEPOINT). */
async function enTransaccionQueSeDeshace<T>(fn: (c: Contexto) => Promise<T>): Promise<T> {
  let resultado: { valor: T } | undefined;
  await prisma
    .$transaction(
      async (tx) => {
        let n = 0;
        const comoActor = async (usuarioId: number, motivo: string | null = null) => {
          await tx.$executeRaw`SELECT set_config('app.usuario_id', ${String(usuarioId)}, true), set_config('app.motivo', ${motivo?.trim() ?? ""}, true)`;
        };
        const escribir: Escritor = async (usuarioId, motivo, f) => {
          n += 1;
          const punto = `sp_avisos_${n}`;
          await tx.$executeRawUnsafe(`SAVEPOINT ${punto}`);
          try {
            await comoActor(usuarioId, motivo);
            const r = await f(tx);
            await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${punto}`);
            return r;
          } catch (e) {
            await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${punto}`);
            throw e;
          }
        };
        const conReloj = (ahora: Date) => ({
          exp: crearServicioExpedientes({ leer: tx, escribir, ahora: () => ahora }),
          avisos: crearServicioAvisos({ leer: tx, escribir, ahora: () => ahora }),
        });
        const contexto: Contexto = {
          tx,
          db: tx as unknown as Cliente,
          exp: crearServicioExpedientes({ leer: tx, escribir }),
          avisos: crearServicioAvisos({ leer: tx, escribir }),
          conReloj,
          comoActor,
        };
        resultado = { valor: await fn(contexto) };
        throw new Deshacer();
      },
      { timeout: 180_000, maxWait: 10_000 },
    )
    .catch((e: unknown) => {
      if (!(e instanceof Deshacer)) throw e;
    });
  if (!resultado) throw new Error("La transacción del test no llegó al final");
  return resultado.valor;
}

/** Un operador extra del área (activo o no), creado en la transacción. */
async function operadorExtra(c: Contexto, area: string, activo = true): Promise<UsuarioPermisos> {
  await c.comoActor(SISTEMA, "Usuario de prueba de avisos");
  const u = await c.tx.usuario.create({
    data: { cuil: cuilFicticio(), nombre: "Prueba", apellido: activo ? "Avisos Activo" : "Avisos Inactivo", areaId: await idArea(c.db, area), rol: "operador", activo },
    select: { id: true },
  });
  return comoUsuario(c.tx, u.id);
}

/** Los avisos de un expediente: quién, de qué tipo y de qué movimiento. */
async function avisosDe(c: Contexto, numero: string) {
  return c.tx.aviso.findMany({
    where: { expediente: { numeroInterno: numero } },
    orderBy: [{ usuarioId: "asc" }, { id: "asc" }],
    select: { usuarioId: true, tipo: true, prioridad: true, titulo: true, texto: true, enlace: true, movimientoId: true, clave: true, leidoEn: true },
  });
}

/** Un instante de ese día (mediodía de Tucumán), para el reloj de la generación. */
function mediodia(fecha: FechaISO): Date {
  return new Date(inicioDelDiaEnTucuman(fecha).getTime() + 12 * 60 * 60 * 1000);
}

/** `f_sumar_dias_habiles(desde, n)`, con los feriados que vea la transacción. */
async function sumarHabiles(c: Contexto, desde: FechaISO, n: number): Promise<FechaISO> {
  const [r] = await c.tx.$queryRaw<Array<{ dia: string }>>`SELECT public.f_sumar_dias_habiles(${desde}::date, ${n}::int)::text AS dia`;
  return r!.dia;
}

describe("avisos por evento", () => {
  it("un pase avisa 'llegó' a los operadores activos del área de destino, en la misma transacción, sin duplicar", async () => {
    await enTransaccionQueSeDeshace(async (c) => {
      const mesa = await usuario(c.db, "MESA_ENTRADAS");
      const computo = await usuario(c.db, "COMPUTO");
      const extra = await operadorExtra(c, "COMPUTO");
      const inactivo = await operadorExtra(c, "COMPUTO", false);
      const datos = await datosAlta(c.db);
      const alta = await c.exp.alta(mesa, datos, comando());

      const version = await completarPaso(c.exp, c.db, alta.numero);
      // Una versión vieja no da el pase: tampoco hay aviso (nada sin pase).
      await expect(c.exp.darPase(mesa, alta.numero, "COMPUTO_ALTA", version - 1, comando())).rejects.toMatchObject({ codigo: "conflicto_version" });
      expect(await avisosDe(c, alta.numero)).toEqual([]);

      const cmd = comando();
      const pase = await c.exp.darPase(mesa, alta.numero, "COMPUTO_ALTA", version, cmd);
      const avisos = await avisosDe(c, alta.numero);
      expect(avisos.map((a) => a.usuarioId)).toEqual([computo.id, extra.id].sort((a, b) => a - b));
      for (const a of avisos) {
        expect(a).toMatchObject({
          tipo: "llego",
          prioridad: "normal",
          titulo: `Llegó ${alta.numero}`,
          enlace: `/expedientes/${alta.numero}`,
          movimientoId: BigInt(pase.movimientoId),
          clave: `llego:${pase.movimientoId}`,
          leidoEn: null,
        });
        expect(a.texto).toContain("desde Mesa de Entradas");
        // Sin datos personales: ni el titular ni su DNI.
        const titular = datos.personas[0]!;
        expect(a.texto).not.toContain(String(titular.apellido));
        expect(a.texto).not.toContain(String(titular.dni));
      }
      expect(avisos.some((a) => a.usuarioId === mesa.id || a.usuarioId === inactivo.id)).toBe(false);

      // El mismo comando: la acción devuelve lo de la primera vez y no hay otro aviso.
      expect(await c.exp.darPase(mesa, alta.numero, "COMPUTO_ALTA", version, cmd)).toMatchObject({ repetido: true });
      expect(await avisosDe(c, alta.numero)).toHaveLength(2);
    });
  });

  it("una devolución avisa 'te devolvieron' con el motivo y prioridad alta (sin 'llegó'), al área de destino", async () => {
    await enTransaccionQueSeDeshace(async (c) => {
      const mesa = await usuario(c.db, "MESA_ENTRADAS");
      const computo = await usuario(c.db, "COMPUTO");
      const liquidacion = await usuario(c.db, "LIQUIDACION");
      const alta = await c.exp.alta(mesa, await datosAlta(c.db), comando());
      await avanzar(c.exp, c.db, alta.numero);
      await avanzar(c.exp, c.db, alta.numero);
      const e = await proyeccion(c.db, alta.numero);
      expect(e.pasoClave).toBe("LIQUIDACION");

      const motivo = "Falta documentación: el comprobante del último pago";
      const dev = await c.exp.devolver(liquidacion, alta.numero, "COMPUTO_ALTA", motivo, [], e.version, comando());
      const deLaDevolucion = (await avisosDe(c, alta.numero)).filter((a) => a.movimientoId === BigInt(dev.movimientoId));
      expect(deLaDevolucion).toEqual([
        expect.objectContaining({
          usuarioId: computo.id,
          tipo: "devuelto",
          prioridad: "alta",
          titulo: `Te devolvieron ${alta.numero}`,
          texto: expect.stringContaining(`Liquidación lo devolvió a Cómputo: alta: ${motivo}`),
          clave: `devuelto:${dev.movimientoId}`,
        }),
      ]);
    });
  });

  it("un pase a un paso externo (la DIM) avisa a la custodia; y el plazo DIM por vencer y vencido, a ella también", async () => {
    await enTransaccionQueSeDeshace(async (c) => {
      const mesa = await usuario(c.db, "MESA_ENTRADAS");
      const tributario = await usuario(c.db, "TRIBUTARIO");
      const otroTributario = await operadorExtra(c, "TRIBUTARIO");
      const hoy = hoyEnTucuman();
      const notificada = sumarDias(hoy, -2);
      const alta = await c.exp.alta(mesa, await datosAlta(c.db, { plantilla: "RENOV_PLAN", fechaInicio: sumarDias(hoy, -20) }), comando());
      for (let i = 0; i < 5; i++) await avanzar(c.exp, c.db, alta.numero);
      const version = await completarPaso(c.exp, c.db, alta.numero, { fecha: notificada });
      const pase = await c.exp.darPase(tributario, alta.numero, "DIM", version, comando());

      const llegada = (await avisosDe(c, alta.numero)).filter((a) => a.movimientoId === BigInt(pase.movimientoId));
      // Quien remitió no se avisa a sí mismo; el otro operador de la custodia, sí.
      expect(llegada).toEqual([
        expect.objectContaining({
          usuarioId: otroTributario.id,
          tipo: "llego",
          titulo: `${alta.numero} está en Dirección de Ingresos Municipales (DIM)`,
          texto: expect.stringContaining("lo custodia tu área"),
        }),
      ]);

      // El plazo empezó con la notificación. Faltando 3 días hábiles: por vencer.
      const porVencer = await sumarHabiles(c, notificada, 27);
      const r1 = await c.conReloj(mediodia(porVencer)).avisos.generarPorTiempo();
      expect(r1.dia).toBe(porVencer);
      const plazo1 = (await avisosDe(c, alta.numero)).filter((a) => a.tipo.startsWith("plazo"));
      expect(plazo1.map((a) => [a.usuarioId, a.tipo, a.prioridad])).toEqual(
        [tributario.id, otroTributario.id].sort((a, b) => a - b).map((id) => [id, "plazo_por_vencer", "normal"]),
      );
      expect(plazo1[0]?.texto).toMatch(/faltan 3 días hábiles/);

      // Vencido: otro aviso (prioridad alta); el de "por vencer" no se repite.
      const vencido = await sumarHabiles(c, notificada, 31);
      await c.conReloj(mediodia(vencido)).avisos.generarPorTiempo();
      const plazo2 = (await avisosDe(c, alta.numero)).filter((a) => a.tipo.startsWith("plazo"));
      expect(plazo2.filter((a) => a.tipo === "plazo_por_vencer")).toHaveLength(2);
      expect(plazo2.filter((a) => a.tipo === "plazo_vencido").map((a) => a.prioridad)).toEqual(["alta", "alta"]);
    });
  });

  it("concluir y archivar avisan a Mesa de Entradas (informativo); con la preferencia apagada, no", async () => {
    await enTransaccionQueSeDeshace(async (c) => {
      const mesa = await usuario(c.db, "MESA_ENTRADAS");
      const administrativo = await usuario(c.db, "ADMINISTRATIVO");
      const otraMesa = await operadorExtra(c, "MESA_ENTRADAS");
      const alta = await c.exp.alta(mesa, await datosAlta(c.db, { fechaInicio: sumarDias(hoyEnTucuman(), -10) }), comando());
      await hastaElUltimoPaso(c.exp, c.db, alta.numero);
      const e = await proyeccion(c.db, alta.numero);
      const { version } = await c.exp.tildarSubtarea(administrativo, alta.numero, "ADM_ENTREGADO", hoyEnTucuman(), e.version, comando());

      // La preferencia: solo "cerrado" se puede apagar.
      expect(await c.avisos.cambiarPreferencia(otraMesa, "devuelto", false)).toBe(false);
      expect(await c.avisos.preferencias(otraMesa)).toEqual([{ tipo: "cerrado", etiqueta: "Concluido o archivado", activo: true }]);

      const concluido = await c.exp.concluir(administrativo, alta.numero, version, comando());
      const cierre = (await avisosDe(c, alta.numero)).filter((a) => a.tipo === "cerrado");
      expect(cierre).toEqual(
        [mesa.id, otraMesa.id]
          .sort((a, b) => a - b)
          .map((usuarioId) =>
            expect.objectContaining({ usuarioId, prioridad: "baja", titulo: `Concluido: ${alta.numero}`, texto: expect.stringContaining("lo concluyó Administrativo") }),
          ),
      );

      expect(await c.avisos.cambiarPreferencia(otraMesa, "cerrado", false)).toBe(true);
      expect(await c.avisos.preferencias(otraMesa)).toEqual([expect.objectContaining({ tipo: "cerrado", activo: false })]);
      const archivado = await c.exp.archivar(administrativo, alta.numero, "Caja 7", concluido.version, comando());
      const delArchivo = (await avisosDe(c, alta.numero)).filter((a) => a.movimientoId === BigInt(archivado.movimientoId));
      expect(delArchivo).toEqual([expect.objectContaining({ usuarioId: mesa.id, titulo: `Archivado: ${alta.numero}`, texto: expect.stringContaining("ubicación Caja 7") })]);
    });
  });
});

describe("avisos por tiempo", () => {
  it("sin confirmar (más de 2 días hábiles) al área que lo envió y demorado al área, una vez; idempotente", async () => {
    await enTransaccionQueSeDeshace(async (c) => {
      const mesa = await usuario(c.db, "MESA_ENTRADAS");
      const computo = await usuario(c.db, "COMPUTO");
      const inactivo = await operadorExtra(c, "COMPUTO", false);
      const alta = await c.exp.alta(mesa, await datosAlta(c.db), comando());
      const pase = await avanzar(c.exp, c.db, alta.numero);
      expect(pase.sinConfirmar).toBe(true);
      const hoy = hoyEnTucuman();
      const deTiempo = async () => (await avisosDe(c, alta.numero)).filter((a) => a.tipo === "sin_confirmar" || a.tipo === "demorado");

      // 2 días hábiles: todavía no.
      await c.conReloj(mediodia(await sumarHabiles(c, hoy, 2))).avisos.generarPorTiempo();
      expect(await deTiempo()).toEqual([]);

      // 3: "sin confirmar" a Mesa, que lo envió (no a Cómputo, que lo tiene).
      const d3 = mediodia(await sumarHabiles(c, hoy, 3));
      await c.conReloj(d3).avisos.generarPorTiempo();
      expect(await deTiempo()).toEqual([
        expect.objectContaining({ usuarioId: mesa.id, tipo: "sin_confirmar", movimientoId: BigInt(pase.movimientoId), texto: expect.stringMatching(/^Tu área lo envió a Cómputo hace 3 días hábiles/) }),
      ]);
      // Otra vez el mismo día, y al día siguiente: nada nuevo.
      const repetida = await c.conReloj(d3).avisos.generarPorTiempo();
      expect(repetida.creados).toBe(0);
      await c.conReloj(mediodia(await sumarHabiles(c, hoy, 4))).avisos.generarPorTiempo();
      expect(await deTiempo()).toHaveLength(1);

      // 5 (dias_alerta de "Cómputo: alta"): demorado a Cómputo, no al inactivo; uno solo aunque pasen días.
      await c.conReloj(mediodia(await sumarHabiles(c, hoy, 5))).avisos.generarPorTiempo();
      await c.conReloj(mediodia(await sumarHabiles(c, hoy, 8))).avisos.generarPorTiempo();
      const demorados = (await deTiempo()).filter((a) => a.tipo === "demorado");
      expect(demorados).toEqual([expect.objectContaining({ usuarioId: computo.id, texto: expect.stringMatching(/^5 días hábiles en Cómputo \(la alerta del paso es a los 5\)/) })]);
      expect((await avisosDe(c, alta.numero)).some((a) => a.usuarioId === inactivo.id)).toBe(false);

      // Cada corrida queda anotada por día.
      const corrida = await c.tx.avisoCorrida.findUnique({ where: { dia: new Date(`${await sumarHabiles(c, hoy, 3)}T00:00:00Z`) } });
      expect(corrida).not.toBeNull();
    });
  });

  it("respeta los feriados: con un feriado en el medio, 3 días corridos hábiles son 2", async () => {
    await enTransaccionQueSeDeshace(async (c) => {
      const mesa = await usuario(c.db, "MESA_ENTRADAS");
      const alta = await c.exp.alta(mesa, await datosAlta(c.db), comando());
      await avanzar(c.exp, c.db, alta.numero);
      const hoy = hoyEnTucuman();
      const tercero = await sumarHabiles(c, hoy, 3);
      // El día hábil siguiente pasa a ser feriado (en la transacción que se deshace).
      const manana = await sumarHabiles(c, hoy, 1);
      await c.comoActor(SISTEMA, "Feriado de prueba de avisos");
      await c.tx.feriado.create({ data: { fecha: new Date(`${manana}T00:00:00Z`), descripcion: "Feriado ficticio de prueba", ambito: "asueto" } });

      await c.conReloj(mediodia(tercero)).avisos.generarPorTiempo();
      expect((await avisosDe(c, alta.numero)).filter((a) => a.tipo === "sin_confirmar")).toEqual([]);
      // Un día hábil más (contando el feriado): ahora sí.
      await c.conReloj(mediodia(await sumarHabiles(c, hoy, 3))).avisos.generarPorTiempo();
      expect((await avisosDe(c, alta.numero)).filter((a) => a.tipo === "sin_confirmar")).toHaveLength(1);
    });
  });

  it("generarSiHaceFalta corre una sola vez por día", async () => {
    await enTransaccionQueSeDeshace(async (c) => {
      // Un día sin corrida: dentro de un año.
      const dia = sumarDias(hoyEnTucuman(), 370);
      const { avisos } = c.conReloj(mediodia(dia));
      const primera = await avisos.generarSiHaceFalta();
      expect(primera).toMatchObject({ dia });
      expect(await avisos.generarSiHaceFalta()).toBeNull();
      const corrida = await c.tx.avisoCorrida.findUnique({ where: { dia: new Date(`${dia}T00:00:00Z`) } });
      expect(corrida?.avisos).toBe(primera?.creados);
    });
  });
});

describe("lo que ve cada usuario", () => {
  it("marca leídos solo los propios; contador, todos, no leído, lista con filtros; Dirección y el admin no reciben", async () => {
    await enTransaccionQueSeDeshace(async (c) => {
      const mesa = await usuario(c.db, "MESA_ENTRADAS");
      const computo = await usuario(c.db, "COMPUTO");
      const direccion = await usuario(c.db, "DIRECCION");
      const admin = await usuario(c.db, "ADMIN");
      const nuevo = await operadorExtra(c, "COMPUTO");
      expect(await c.avisos.contarNoLeidos(nuevo)).toBe(0);

      const a1 = await c.exp.alta(mesa, await datosAlta(c.db), comando());
      const a2 = await c.exp.alta(mesa, await datosAlta(c.db), comando());
      await avanzar(c.exp, c.db, a1.numero);
      await avanzar(c.exp, c.db, a2.numero);
      expect(await c.avisos.contarNoLeidos(nuevo)).toBe(2);
      const resumen = await c.avisos.resumen(nuevo);
      expect(resumen.noLeidos).toBe(2);
      expect(resumen.ultimos.map((a) => a.numero).sort()).toEqual([a1.numero, a2.numero].sort());
      const [delNuevo] = resumen.ultimos;

      // El de otro: el id no alcanza.
      const deComputo = (await c.avisos.resumen(computo)).ultimos.find((a) => a.numero === a1.numero)!;
      expect(await c.avisos.marcarLeidos(nuevo, [deComputo.id])).toBe(0);
      expect((await c.tx.aviso.findUniqueOrThrow({ where: { id: BigInt(deComputo.id) } })).leidoEn).toBeNull();
      // Basura: nada.
      expect(await c.avisos.marcarLeidos(nuevo, ["x", "-1", null])).toBe(0);

      expect(await c.avisos.marcarLeidos(nuevo, [delNuevo!.id])).toBe(1);
      expect(await c.avisos.marcarLeidos(nuevo, [delNuevo!.id])).toBe(0);
      expect(await c.avisos.contarNoLeidos(nuevo)).toBe(1);
      expect(await c.avisos.marcarNoLeidos(nuevo, [delNuevo!.id])).toBe(1);
      expect(await c.avisos.contarNoLeidos(nuevo)).toBe(2);

      const soloNoLeidos = await c.avisos.listar(nuevo, { soloNoLeidos: true });
      expect(soloNoLeidos).toMatchObject({ total: 2, pagina: 1, paginas: 1, noLeidos: 2 });
      expect((await c.avisos.listar(nuevo, { tipo: "devuelto" })).total).toBe(0);
      expect((await c.avisos.listar(nuevo, { tipo: "llego", pagina: 9 })).pagina).toBe(1);

      expect(await c.avisos.marcarTodosLeidos(nuevo)).toBe(2);
      expect(await c.avisos.contarNoLeidos(nuevo)).toBe(0);
      expect((await c.avisos.listar(nuevo, { soloNoLeidos: true })).total).toBe(0);
      // Lo de Cómputo sigue sin leer.
      expect((await c.tx.aviso.findUniqueOrThrow({ where: { id: BigInt(deComputo.id) } })).leidoEn).toBeNull();

      for (const quien of [direccion, admin]) {
        expect(await c.avisos.resumen(quien)).toEqual({ noLeidos: 0, ultimos: [] });
        expect(await c.avisos.marcarTodosLeidos(quien)).toBe(0);
        expect(await c.tx.aviso.count({ where: { usuarioId: quien.id } })).toBe(0);
      }
    });
  });
});

describe("la tabla", () => {
  it("la app inserta y cambia leido_en; no cambia otra columna ni borra; CHECKs de tipo y enlace", async () => {
    await enTransaccion("app", async (pg) => {
      await fijarActor(pg, SISTEMA, "Prueba de avisos");
      const e = await crearEscenario(pg);
      const exp = await crearExpediente(pg, e);
      const base = { usuario_id: e.operador, expediente_id: exp.id, tipo: "llego", titulo: "Llegó CEM-1999-1", texto: "Prueba", enlace: "/expedientes/CEM-1999-1" };
      const a = await insertar<{ id: string }>(pg, "public.avisos", { ...base, clave: "prueba:1" });

      expect(await intentar(pg, "UPDATE public.avisos SET leido_en = now() WHERE id = $1", [a.id])).toMatchObject({ ok: true });
      expect(await intentar(pg, "UPDATE public.avisos SET titulo = 'Otro' WHERE id = $1", [a.id])).toMatchObject({ ok: false, codigo: "42501" });
      expect(await intentar(pg, "UPDATE public.avisos SET usuario_id = usuario_id WHERE id = $1", [a.id])).toMatchObject({ ok: false, codigo: "42501" });
      expect(await intentar(pg, "DELETE FROM public.avisos WHERE id = $1", [a.id])).toMatchObject({ ok: false, codigo: "42501" });

      // No duplicar: la misma clave para el mismo usuario.
      const insertarAviso = (cambios: Record<string, string>) => {
        const f: Record<string, unknown> = { ...base, clave: `prueba:${Object.values(cambios).join(":")}`, ...cambios };
        const columnas = Object.keys(f);
        return intentar(pg, `INSERT INTO public.avisos (${columnas.join(", ")}) VALUES (${columnas.map((_, i) => `$${i + 1}`).join(", ")})`, Object.values(f));
      };
      expect(await insertarAviso({ clave: "prueba:1" })).toMatchObject({ ok: false, codigo: "23505" });
      // CHECKs.
      for (const [columna, valor] of [
        ["tipo", "otro"],
        ["prioridad", "urgente"],
        ["enlace", "https://otro.ejemplo/x"],
        ["enlace", "//otro.ejemplo"],
        ["enlace", "javascript:alert(1)"],
        ["titulo", ""],
      ] as const) {
        expect(await insertarAviso({ [columna]: valor }), `${columna} = ${valor}`).toMatchObject({ ok: false, codigo: "23514" });
      }
      // La preferencia: solo el canal sistema.
      expect(await intentar(pg, "INSERT INTO public.avisos_preferencias (usuario_id, tipo, canal, activo) VALUES ($1, 'cerrado', 'whatsapp', false)", [e.operador])).toMatchObject({
        ok: false,
        codigo: "23514",
      });
      expect(await fila(pg, "SELECT count(*)::int AS n FROM public.avisos WHERE clave LIKE 'prueba:%'")).toEqual({ n: 1 });
    });
  });
});
