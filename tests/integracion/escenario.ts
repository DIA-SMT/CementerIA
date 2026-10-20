// Datos mínimos para la batería de integración, insertados con SQL dentro de la
// transacción del test (que se revierte). No dependen de la semilla: cada test
// arma lo suyo con códigos únicos, así corre igual sobre una base vacía o
// sembrada. Todos los datos son ficticios.

import { randomBytes, randomInt } from "node:crypto";
import pg from "pg";
import { SISTEMA, base, conPg, unico } from "./helper";

// ---------------------------------------------------------------------------
// INSERT genérico
// ---------------------------------------------------------------------------

/** Una expresión SQL que va tal cual en el INSERT, en lugar de un parámetro. */
export class Sql {
  constructor(readonly texto: string) {}
}

export const sql = (texto: string): Sql => new Sql(texto);

/**
 * Para columnas jsonb. `pg` convierte los arrays de JS en arrays de PostgreSQL,
 * así que un jsonb que es un array tiene que viajar como texto.
 */
export const json = (valor: unknown): string => JSON.stringify(valor);

/** El actor de la transacción, leído como lo lee f_actor(). */
export const ACTOR = sql("nullif(current_setting('app.usuario_id', true), '')::integer");

/** Hoy en Tucumán: es contra lo que expedientes_preparar controla fecha_inicio. */
export const HOY_TUCUMAN = sql("(now() AT TIME ZONE 'America/Argentina/Tucuman')::date");

export type Columnas = Record<string, unknown>;

export async function insertar<F extends pg.QueryResultRow>(
  c: pg.Client,
  tabla: string,
  fila: Columnas,
): Promise<F> {
  if (!/^[a-z_]+\.[a-z_]+$/.test(tabla)) throw new Error(`Tabla inválida: ${tabla}`);
  const columnas: string[] = [];
  const valores: string[] = [];
  const params: unknown[] = [];
  for (const [columna, valor] of Object.entries(fila)) {
    if (valor === undefined) continue;
    if (!/^[a-z_]+$/.test(columna)) throw new Error(`Columna inválida: ${columna}`);
    columnas.push(columna);
    if (valor instanceof Sql) {
      valores.push(valor.texto);
    } else {
      params.push(valor);
      valores.push(`$${params.length}`);
    }
  }
  const r = await c.query<F>(
    `INSERT INTO ${tabla} (${columnas.join(", ")}) VALUES (${valores.join(", ")}) RETURNING *`,
    params,
  );
  return r.rows[0];
}

/** Una sola fila de una consulta; si no hay exactamente una, es un error del test. */
export async function fila<F extends pg.QueryResultRow>(c: pg.Client, consulta: string, params: unknown[] = []): Promise<F> {
  const r = await c.query<F>(consulta, params);
  if (r.rows.length !== 1) throw new Error(`Se esperaba una fila y llegaron ${r.rows.length}: ${consulta}`);
  return r.rows[0];
}

/** Lo contrario de fijarActor(): la transacción queda sin actor. */
export async function quitarActor(c: pg.Client): Promise<void> {
  await c.query("SELECT set_config('app.usuario_id', '', true), set_config('app.motivo', '', true)");
}

/** Código único con letras y guion bajo: tipos_monumento exige ^[A-Z_]+$. */
export function unicoLetras(prefijo: string): string {
  return unico(prefijo).replace(/[0-9]/g, (d) => "ABCDEFGHIJ"[Number(d)]);
}

// ---------------------------------------------------------------------------
// Filas (solo las columnas que miran los tests; bigint llega como string)
// ---------------------------------------------------------------------------

export interface FilaExpediente {
  id: string;
  numero_municipal_norm: string | null;
  padron_norm: string | null;
  ubicacion_clave: string | null;
  estado: string;
}

export interface FilaMovimiento {
  id: string;
  expediente_id: string;
  secuencia: number;
  tipo: string;
  usuario_id: number;
  area_usuario_id: number | null;
}

export interface FilaPersona {
  id: string;
  expediente_id: string;
  rol: string;
  orden: number;
  apellido: string | null;
  nombres: string | null;
  dni: string | null;
  vigente: boolean;
  reemplazada_por_id: string | null;
  creada_mov_id: string;
  suprimida_en: Date | null;
  nombre_norm: string;
}

export interface FilaPlantilla {
  id: number;
  codigo: string;
  version: number;
  estado: string;
}

// ---------------------------------------------------------------------------
// Catálogos y usuarios (se auditan: exigen el actor fijado)
// ---------------------------------------------------------------------------

export async function crearArea(c: pg.Client, columnas: Columnas = {}): Promise<number> {
  const f = await insertar<{ id: number }>(c, "public.areas", {
    codigo: unico("AREA"),
    nombre: "Área de prueba",
    tipo: "interna",
    ...columnas,
  });
  return f.id;
}

export async function crearCementerio(c: pg.Client, areaExterna: number, tiposMonumento: string[] = []): Promise<number> {
  const f = await insertar<{ id: number }>(c, "public.cementerios", {
    codigo: unico("CEM"),
    nombre: "Cementerio de prueba",
    area_id: areaExterna,
    campos_ubicacion: json([
      { clave: "seccion", etiqueta: "Sección", tipo: "texto", obligatorio: true, patron: null, activo: true },
      { clave: "lote", etiqueta: "Lote", tipo: "entero", obligatorio: true, patron: null, activo: true },
    ]),
    tipos_monumento: tiposMonumento,
  });
  return f.id;
}

export async function crearTipoMonumento(c: pg.Client): Promise<string> {
  const f = await insertar<{ codigo: string }>(c, "public.tipos_monumento", {
    codigo: unicoLetras("TM"),
    nombre: "Monumento de prueba",
  });
  return f.codigo;
}

export async function crearTipoTramite(c: pg.Client): Promise<number> {
  const f = await insertar<{ id: number }>(c, "public.tipos_tramite", {
    codigo: unico("TT"),
    nombre: "Trámite de prueba",
  });
  return f.id;
}

/** Una definición chica pero con la forma de la sección 2.5. */
export const DEFINICION_MINIMA = {
  forma_pago: "contado",
  tipos_monumento: [],
  ubicacion_obligatoria: true,
  requiere_contacto: true,
  personas: [{ rol: "titular", etiqueta: "Titular", min: 1, max: 1, fallecido: "no", pide_vinculo: false }],
  campos_extra: [],
  documentos: [],
  conceptos: [],
  pasos: [
    {
      clave: "MESA",
      nombre: "Mesa de Entradas",
      area: "MESA_ENTRADAS",
      custodia: null,
      estado: "en_tramite",
      omitible: false,
      dias_alerta: 5,
      instrucciones: null,
      plazo: null,
      subtareas: [],
    },
  ],
};

/**
 * Una plantilla en el estado pedido (por defecto publicada). Como hace la app,
 * nace borrador (plantillas_congelar no deja insertar otra cosa) y llega a
 * publicada o retirada por las transiciones permitidas.
 */
export async function crearPlantilla(
  c: pg.Client,
  tipoTramite: number,
  columnas: Columnas = {},
): Promise<FilaPlantilla> {
  const { estado: estadoPedido, ...resto } = columnas;
  const estado = typeof estadoPedido === "string" ? estadoPedido : "publicada";
  const p = await insertar<FilaPlantilla>(c, "public.plantillas", {
    codigo: unico("PL"),
    version: 1,
    tipo_tramite_id: tipoTramite,
    nombre: "Plantilla de prueba",
    definicion: json(DEFINICION_MINIMA),
    creado_por: SISTEMA,
    ...resto,
    // Un estado inválido se pasa tal cual, para que lo rechace el CHECK.
    estado: estado === "publicada" || estado === "retirada" ? "borrador" : estado,
  });
  if (estado !== "publicada" && estado !== "retirada") return p;
  await c.query(
    `UPDATE public.plantillas
        SET estado = 'publicada', publicado_por = $2, publicado_en = now(),
            notas_cambio = coalesce(notas_cambio, 'Versión inicial de prueba')
      WHERE id = $1`,
    [p.id, SISTEMA],
  );
  if (estado === "retirada") await c.query("UPDATE public.plantillas SET estado = 'retirada' WHERE id = $1", [p.id]);
  return fila<FilaPlantilla>(c, "SELECT * FROM public.plantillas WHERE id = $1", [p.id]);
}

/** CUIL ficticio de 11 dígitos (empieza con 27 y no es el de SISTEMA). */
export function cuilFicticio(): string {
  return `27${String(randomInt(0, 1_000_000_000)).padStart(9, "0")}`;
}

export async function crearUsuario(c: pg.Client, columnas: Columnas = {}): Promise<number> {
  const f = await insertar<{ id: number }>(c, "public.usuarios", {
    cuil: cuilFicticio(),
    nombre: "Usuaria",
    apellido: "De Prueba",
    email: "usuaria@ejemplo.test",
    rol: "operador",
    ...columnas,
  });
  return f.id;
}

// ---------------------------------------------------------------------------
// Escenario: todo lo que hace falta para tener un expediente
// ---------------------------------------------------------------------------

export interface Escenario {
  /** Área interna del operador (hace de Mesa de Entradas). */
  areaInterna: number;
  /** Otra área interna, destino de pases. */
  areaDestino: number;
  /** Área externa del cementerio: sin usuarios. */
  areaExterna: number;
  cementerio: number;
  tipoMonumento: string;
  tipoTramite: number;
  /** Plantilla publicada. */
  plantilla: number;
  /** Operador del área interna. */
  operador: number;
}

/** Exige el actor fijado (fijarActor): los catálogos se auditan. */
export async function crearEscenario(c: pg.Client): Promise<Escenario> {
  const areaInterna = await crearArea(c);
  const areaDestino = await crearArea(c);
  const areaExterna = await crearArea(c, { tipo: "externa" });
  const tipoMonumento = await crearTipoMonumento(c);
  const cementerio = await crearCementerio(c, areaExterna, [tipoMonumento]);
  const tipoTramite = await crearTipoTramite(c);
  const plantilla = (await crearPlantilla(c, tipoTramite)).id;
  const operador = await crearUsuario(c, { area_id: areaInterna });
  return { areaInterna, areaDestino, areaExterna, cementerio, tipoMonumento, tipoTramite, plantilla, operador };
}

export async function crearExpediente(c: pg.Client, e: Escenario, columnas: Columnas = {}): Promise<FilaExpediente> {
  // (anio, secuencia) y numero_interno son únicos; al azar para no chocar con
  // lo que otro test haya confirmado.
  const secuencia = randomInt(100_000, 2_000_000_000);
  return insertar<FilaExpediente>(c, "public.expedientes", {
    anio: 2026,
    secuencia,
    numero_interno: `CEM-2026-${secuencia}`,
    fecha_inicio: HOY_TUCUMAN,
    tipo_tramite_id: e.tipoTramite,
    plantilla_id: e.plantilla,
    cementerio_id: e.cementerio,
    tipo_monumento: e.tipoMonumento,
    forma_pago: "contado",
    paso_clave: "MESA",
    paso_orden: 1,
    area_actual_id: e.areaInterna,
    area_responsable_id: e.areaInterna,
    en_area_desde: sql("now()"),
    recibido_en: sql("now()"),
    creado_por: SISTEMA,
    ...columnas,
  });
}

/** Por defecto una `nota` del actor de la transacción, con fecha efectiva now(). */
export async function crearMovimiento(
  c: pg.Client,
  expedienteId: string,
  columnas: Columnas = {},
): Promise<FilaMovimiento> {
  return insertar<FilaMovimiento>(c, "public.movimientos", {
    expediente_id: expedienteId,
    tipo: "nota",
    fecha_efectiva: sql("now()"),
    usuario_id: ACTOR,
    comando_id: sql("gen_random_uuid()"),
    ...columnas,
  });
}

/**
 * Persona con todos los datos personales cargados (ficticios). Si no se pasa
 * `creada_mov_id`, primero inserta el movimiento `alta` que la crea, como hace
 * la app (sección 2.7).
 */
export async function crearPersona(c: pg.Client, expedienteId: string, columnas: Columnas = {}): Promise<FilaPersona> {
  const creadaMovId =
    columnas.creada_mov_id ?? (await crearMovimiento(c, expedienteId, { tipo: "alta" })).id;
  return insertar<FilaPersona>(c, "public.expediente_personas", {
    expediente_id: expedienteId,
    rol: "titular",
    orden: 1,
    apellido: "PRUEBA",
    nombres: "Persona Ficticia",
    dni: "99000001",
    vinculo: "apoderado",
    telefono: "0381 000-0000",
    email: "persona@ejemplo.test",
    domicilio: "Calle Ficticia 123",
    ...columnas,
    creada_mov_id: creadaMovId,
  });
}

// ---------------------------------------------------------------------------
// Roles de prueba (para session_replication_role = replica)
// ---------------------------------------------------------------------------

export interface RolDePrueba {
  nombre: string;
  url: string;
}

/**
 * Crea, como superusuario, un rol LOGIN de prueba. `permisos` son sentencias
 * GRANT con `{rol}` en lugar del nombre. Los roles son globales del clúster:
 * borrarlo con borrarRolDePrueba() en un afterAll.
 */
export async function crearRolDePrueba(prefijo: string, permisos: string[]): Promise<RolDePrueba> {
  const nombre = `cementeria_it_${prefijo}_${randomBytes(4).toString("hex")}`;
  const clave = randomBytes(18).toString("hex");
  await conPg("superusuario", async (c) => {
    await c.query(`CREATE ROLE ${nombre} LOGIN NOSUPERUSER PASSWORD '${clave}'`);
    await c.query(`GRANT CONNECT ON DATABASE cementeria TO ${nombre}`);
    for (const p of permisos) await c.query(p.replaceAll("{rol}", nombre));
  });
  return { nombre, url: `postgresql://${nombre}:${clave}@localhost:${base().puerto}/cementeria` };
}

export async function borrarRolDePrueba(rol: RolDePrueba | undefined): Promise<void> {
  if (!rol) return;
  await conPg("superusuario", async (c) => {
    await c.query(`DROP OWNED BY ${rol.nombre}`);
    await c.query(`DROP ROLE ${rol.nombre}`);
  });
}

/** Como enTransaccion(), pero con una URL cualquiera (un rol de prueba). */
export async function enTransaccionCon<T>(url: string, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    await c.query("BEGIN");
    try {
      return await fn(c);
    } finally {
      await c.query("ROLLBACK");
    }
  } finally {
    await c.end();
  }
}

/** Mensaje de un intento fallido, o "" si salió bien (para toMatch). */
export function errorDe(r: { ok: true } | { ok: false; error: string }): string {
  return r.ok ? "" : r.error;
}
