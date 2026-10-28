// Los ESCENARIOS de desarrollo: un segundo grupo de expedientes ficticios,
// repartidos por todo el circuito, para ver el flujo en cada bandeja y en el
// panel (los 30 de expedientes.ts quedan todos en Mesa de Entradas).
//
// Van DESPUÉS de los 30 (CEM-2026-00031 en adelante en una base recién
// reseteada) y no los tocan: las pruebas de integración y de Playwright
// dependen de esos 30 y de su orden.
//
// Cómo se arman: SOLO con las funciones del dominio (alta, confirmarRecepcion,
// tildarSubtarea, marcarDocumento, darPase, devolver, concluir, archivar,
// archivarSinConcluir, anular, reiniciar, revertir, corregirFecha, agregarNota,
// subirAdjunto y la transcripción histórica), nunca con SQL suelto, y cada
// acción la hace el usuario ficticio del área que corresponde (usuarios.ts).
// Así el historial, la proyección y la auditoría quedan como si los hubieran
// trabajado las áreas: la proyección coincide con la que reconstruye el
// historial (lo controla tests/integracion/semilla-escenarios.test.ts).
//
// Fechas: cada escenario tiene su línea de tiempo en DÍAS HÁBILES hacia atrás
// desde el día en que corre la semilla (sábados, domingos y los feriados de la
// tabla `feriados` no cuentan, como en f_dias_habiles_entre), así que es
// determinista para un mismo día. Las fechas efectivas respetan las reglas del
// dominio: no retroceden, no son futuras y no tienen más de 30 días (por eso
// ningún día de un movimiento normal queda antes de hoy - 28 días corridos:
// `dia()` lo topea). Las horas son ficticias (desde las 8:30, de a 13 minutos)
// y lo que pasa hoy va con la hora real.
//
// Los dos plazos DIM "por vencer" y "vencido" necesitan una notificación de
// hace más de 25 días hábiles, que el límite de 30 días corridos no admite en
// un expediente normal: son expedientes "iniciados antes del sistema" (carga
// histórica) cuyo recorrido se transcribió de la ficha de papel, con la
// notificación tildada con su fecha, y después se terminó la carga histórica.
// Es el camino que el dominio tiene para lo anterior al sistema.
//
// IDEMPOTENTE como el resto de la semilla: cada acción tiene un `comando_id`
// fijo (escenario y número de acción) y el dominio devuelve lo de la primera
// vez sin validar nada. Las decisiones del guion (qué subtareas y documentos
// faltan) salen del propio guion y de la plantilla del expediente, no de la
// base, así que una segunda corrida repite exactamente los mismos comandos y no
// crea nada. Si una corrida se corta a la mitad, la siguiente completa lo que
// falte (el mismo día; otro día, las fechas nuevas pueden no encajar: npm run
// db:reset).
//
// TODOS FICTICIOS: apellidos que dicen que lo son, nombres "… Escenario", DNI
// de 9 dígitos 9999NNNNN (no existen: los DNI tienen 8; y así no chocan con los
// de las pruebas, de 8 dígitos), teléfonos 0381 000-5NNN, correos
// @ejemplo.test, domicilios en "Calle Ficticia" y asociaciones "… Ficticia …"
// con CUIT 30-99999NNN-D.

import { crearAlmacenEnDisco, raizAdjuntos, type AlmacenAdjuntos } from "../../src/lib/adjuntos/almacen";
import { conActorEn } from "../../src/lib/db/actor";
import type { Cliente } from "../../src/lib/db/crear-cliente";
import {
  codigoDeSemilla,
  crearServicioExpedientes,
  ErrorDominio,
  type DatosAlta,
  type EntradaFechaEfectiva,
  type PersonaEntrada,
  type ServicioExpedientes,
} from "../../src/lib/dominio/expedientes";
import { definicionDelExpediente, leerDefinicion } from "../../src/lib/dominio/expedientes/contexto";
import type { PrecargaAlta } from "../../src/lib/dominio/expedientes/estados";
import { esRol, PermisoDenegado, type UsuarioPermisos } from "../../src/lib/dominio/permisos";
import type { DefinicionPlantilla, PasoPlantilla } from "../../src/lib/dominio/plantillas/esquema";
import { resolverDefinicion } from "../../src/lib/dominio/plantillas/resolver";
import { fechaDesdeDb, hoyEnTucuman, sumarDias, type FechaISO } from "../../src/lib/fechas";
import { cuitFicticio } from "./expedientes";
import { USUARIOS_FICTICIOS } from "./usuarios";

/** De dónde sale lo transcripto de los "iniciados antes del sistema". */
export const FUENTE_ESCENARIOS = "Ficha papel (ficticia)";

/** Días corridos hacia atrás que admite una fecha efectiva normal es 30; se deja margen. */
const TOPE_DIAS_CORRIDOS = 28;

/**
 * `comando_id` fijo de la acción `accion` del escenario `escenario`: lo que hace
 * idempotente la semilla. Prefijo distinto del de los 30 (5eed0000-…).
 */
export function comandoEscenario(escenario: number, accion: number): string {
  return `5eed0e5c-${String(escenario).padStart(4, "0")}-4000-8000-${String(accion).padStart(12, "0")}`;
}

// ---------------------------------------------------------------------------
// Calendario: días hábiles hacia atrás
// ---------------------------------------------------------------------------

class Calendario {
  private readonly piso: FechaISO;

  constructor(
    readonly hoy: FechaISO,
    private readonly feriados: ReadonlySet<FechaISO>,
  ) {
    let piso = sumarDias(hoy, -TOPE_DIAS_CORRIDOS);
    while (!this.habil(piso)) piso = sumarDias(piso, 1);
    this.piso = piso;
  }

  habil(d: FechaISO): boolean {
    const dow = new Date(`${d}T12:00:00Z`).getUTCDay();
    return dow !== 0 && dow !== 6 && !this.feriados.has(d);
  }

  /**
   * El día hábil `d` tal que entre `d` (exclusive) y hoy (inclusive) hay `n`
   * días hábiles: `f_dias_habiles_entre(d, hoy) = n`. Sin tope (la transcripción).
   */
  atras(n: number): FechaISO {
    let d = this.hoy;
    let contados = 0;
    while (contados < n) {
      if (this.habil(d)) contados += 1;
      d = sumarDias(d, -1);
    }
    // Un fin de semana o feriado no cambia la cuenta: se va al hábil anterior.
    while (!this.habil(d)) d = sumarDias(d, -1);
    return d;
  }

  /** Como `atras`, pero nunca antes de hoy - 28 días corridos (el límite de 30 del dominio, con margen). */
  dia(n: number): FechaISO {
    const d = this.atras(n);
    return d < this.piso ? this.piso : d;
  }
}

// ---------------------------------------------------------------------------
// Personas, ubicación y datos ficticios
// ---------------------------------------------------------------------------

const APELLIDOS = ["SIMULADO", "MAQUETA", "BOCETO", "MODELO", "PILOTO", "SIMULACRO", "BORRADOR", "FIGURADO", "SUPUESTO", "HIPOTÉTICO"];
const NOMBRES = ["Alicia", "Benito", "Camila", "Darío", "Estela", "Federico", "Graciela", "Horacio", "Irene", "Joaquín", "Laura", "Mauro", "Norma", "Óscar"];
const SECCIONES_OESTE = "ABCDEFGH";
const SECCIONES_JARDIN = ["II", "III", "V", "VI", "VII", "IX", "X", "XII"];
const CUADROS_NORTE = "GHJKLM";

type Cementerio = "OESTE" | "NORTE" | "JARDIN_NORTE";

/** Quiénes son las personas del alta. */
type Personas =
  /** Solo el titular, que es el contacto. */
  | "titular"
  /** Titular y solicitante distinto (el contacto). */
  | "solicitante"
  /** Una asociación con panteón (persona jurídica) y quien la preside (el contacto). */
  | "juridica"
  /** Renovación sin perjuicio de tercero: titular fallecido y solicitante (el contacto). */
  | "spt";

/** DNI de 9 dígitos, 9999NNNNN: no existe (los DNI tienen 8) y no choca con los de las pruebas. */
function dniEscenario(e: number, k: number): string {
  return `9999${String(e * 10 + k).padStart(5, "0")}`;
}

function contacto(e: number, k: number): Partial<PersonaEntrada> {
  const i = e * 10 + k;
  return {
    telefono: `0381 000-${5000 + i}`,
    telefonoWhatsapp: i % 2 === 0,
    email: e % 3 === 0 ? `escenario${i}@ejemplo.test` : null,
    domicilio: `Calle Ficticia ${700 + i}`,
  };
}

function fisica(e: number, k: number, rol: string, extra: Partial<PersonaEntrada> = {}): PersonaEntrada {
  return {
    rol,
    apellido: APELLIDOS[(e + k * 3) % APELLIDOS.length],
    nombres: `${NOMBRES[(e * 2 + k) % NOMBRES.length]} Escenario`,
    dni: dniEscenario(e, k),
    ...extra,
  };
}

const VINCULOS = ["hija", "hijo", "cónyuge", "nieto", "apoderada", "sobrina"];

function personasDe(e: number, tipo: Personas, difuntos: number, fechaDefuncion: FechaISO = "2026-08-30"): PersonaEntrada[] {
  const vinculo = VINCULOS[e % VINCULOS.length];
  let personas: PersonaEntrada[];
  switch (tipo) {
    case "titular":
      personas = [fisica(e, 0, "titular", { ...contacto(e, 0), esContacto: true })];
      break;
    case "solicitante":
      personas = [
        fisica(e, 0, "titular", contacto(e, 0)),
        fisica(e, 1, "solicitante", { vinculo, ...contacto(e, 1), esContacto: true }),
      ];
      break;
    case "juridica":
      personas = [
        { rol: "titular", tipo: "juridica", razonSocial: `Asociación Ficticia Escenario N° ${e}`, cuit: cuitFicticio(700 + e), ...contacto(e, 0) },
        fisica(e, 1, "solicitante", { vinculo: "presidente de la comisión directiva", ...contacto(e, 1), esContacto: true }),
      ];
      break;
    case "spt":
      personas = [
        fisica(e, 0, "titular", { fallecido: true, fechaDefuncion: e % 2 === 0 ? "2019-05-14" : null }),
        fisica(e, 1, "solicitante", { vinculo, ...contacto(e, 1), esContacto: true }),
      ];
      break;
  }
  for (let i = 0; i < difuntos; i++) {
    personas.push(fisica(e, 2 + i, "difunto", { fallecido: true, fechaDefuncion }));
  }
  return personas;
}

/** La ubicación según la nomenclatura de cada cementerio (cementerios.ts), con lotes que no usan los 30. */
function ubicacionDe(e: number, cementerio: Cementerio): Record<string, string> {
  const lote = String(200 + e);
  const numero = String(50 + e);
  if (cementerio === "OESTE") return { seccion: SECCIONES_OESTE[e % SECCIONES_OESTE.length], lote, numero };
  if (cementerio === "JARDIN_NORTE") return { seccion: SECCIONES_JARDIN[e % SECCIONES_JARDIN.length], lote, numero };
  return { seccion: String(10 + (e % 9)), cuadro: CUADROS_NORTE[e % CUADROS_NORTE.length], lote, numero };
}

/** El dato de texto que anota cada subtarea (los números que pide la plantilla), ficticio. */
function textoDe(clave: string, e: number): string | null {
  switch (clave) {
    case "COMP_GRABADO":
      return `REG-2026-${4100 + e}`;
    case "LIQ_BOLETA":
    case "LIQ_BOLETA_JARDIN":
      return `Boleta 0045-${String(20_000 + e * 37).padStart(8, "0")}`;
    case "LEG_DICTAMEN":
      return `Dictamen ${310 + e}/2026`;
    case "ADM_PROTOCOLO":
      return `Res. ${1250 + e}/2026`;
    case "ADM_TIT_CONF":
      return `Título ${5200 + e}`;
    case "MESA_HORARIO":
      return `Día hábil siguiente, ${8 + (e % 4)}:30 h (informado por teléfono)`;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Adjuntos mínimos, generados en memoria
// ---------------------------------------------------------------------------

/** Un PNG de 1×1, el mismo que usan las pruebas de punta a punta. */
const PNG_MINIMO = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

/** Un PDF de una página con una línea de texto, con su tabla xref bien armada. */
function pdfMinimo(texto: string): Buffer {
  const contenido = `BT /F1 12 Tf 20 60 Td (${texto.replace(/[()\\]/g, "")}) Tj ET`;
  const objetos = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 420 120] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${Buffer.byteLength(contenido, "latin1")} >>\nstream\n${contenido}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const posiciones: number[] = [];
  objetos.forEach((o, i) => {
    posiciones.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`;
  for (const p of posiciones) pdf += `${String(p).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

function flujoDe(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(c) {
      c.enqueue(bytes);
      c.close();
    },
  });
}

// ---------------------------------------------------------------------------
// El guion de un escenario
// ---------------------------------------------------------------------------

interface PlantillaPublicada {
  id: number;
  definicion: DefinicionPlantilla;
}

export interface Contexto {
  cliente: Cliente;
  servicio: ServicioExpedientes;
  calendario: Calendario;
  usuarios: ReadonlyMap<string, UsuarioPermisos>;
  plantillas: ReadonlyMap<string, PlantillaPublicada>;
  cementerios: ReadonlyMap<string, number>;
}

interface Alta {
  plantilla: string;
  cementerio: Cementerio;
  monumento: string;
  /** Días hábiles atrás de la fecha de inicio. */
  inicio: number;
  personas: Personas;
  difuntos?: number;
  /** Días hábiles atrás de la fecha de defunción (por defecto, una fija de agosto). */
  defuncion?: number;
  /** Documentos de Mesa que NO se reciben en el alta (se marcan después). */
  sinDocumentos?: readonly string[];
  observaciones?: string;
  /** "Iniciado antes del sistema": `inicio` sin el tope de 30 días, con fuente. */
  historica?: boolean;
}

/**
 * Las acciones de un escenario, en orden, cada una con su comando fijo y el
 * usuario del área que la hace. Lleva la versión, el paso y lo hecho: lo que
 * hace falta para la próxima acción sin volver a leer la base.
 */
export class Guion {
  numero = "";
  version = 0;
  repetido = false;
  private def: DefinicionPlantilla | null = null;
  private orden = 1;
  private ordenAntesDelPase = 1;
  private accion = 0;
  private readonly hechas = new Set<string>();
  private readonly presentados = new Set<string>();
  private readonly minutos = new Map<FechaISO, number>();
  /** El movimiento del último pase (para corregirlo o revertirlo). */
  ultimoPase = "";

  constructor(
    private readonly c: Contexto,
    readonly escenario: number,
  ) {}

  // --- Ayudas ---------------------------------------------------------------

  private comando(): string {
    this.accion += 1;
    return comandoEscenario(this.escenario, this.accion);
  }

  private get definicion(): DefinicionPlantilla {
    if (!this.def) throw new Error("El escenario todavía no tiene alta");
    return this.def;
  }

  private get paso(): PasoPlantilla {
    return this.definicion.pasos[this.orden - 1];
  }

  private usuario(area: string): UsuarioPermisos {
    const u = this.c.usuarios.get(area);
    if (!u) throw new Error(`Falta el usuario ficticio de ${area}: los escenarios van después de la semilla con usuarios ficticios`);
    return u;
  }

  /** El área responsable del paso actual (en un paso externo, la custodia). */
  private responsable(): UsuarioPermisos {
    const p = this.paso;
    return this.usuario(p.custodia ?? p.area);
  }

  private ordenDe(clave: string): number {
    const i = this.definicion.pasos.findIndex((p) => p.clave === clave);
    if (i < 0) throw new Error(`El paso ${clave} no es de la plantilla`);
    return i + 1;
  }

  /** El día de hace `n` días hábiles (con el tope de 30 días del dominio). */
  dia(n: number): FechaISO {
    return this.c.calendario.dia(n);
  }

  /**
   * La fecha efectiva de una acción ese día: una hora ficticia que avanza con
   * cada acción del escenario, o nada (ahora) si es hoy.
   */
  private en(n: number): EntradaFechaEfectiva {
    const d = this.dia(n);
    if (d >= this.c.calendario.hoy) return undefined;
    const k = this.minutos.get(d) ?? 0;
    this.minutos.set(d, k + 1);
    const total = 8 * 60 + 30 + Math.min(k, 40) * 13;
    return `${d}T${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
  }

  private dato(clave: string, n: number): string | null {
    const s = this.definicion.pasos.flatMap((p) => p.subtareas).find((x) => x.clave === clave);
    if (!s || s.dato === null) return null;
    return s.dato === "fecha" ? this.dia(n) : textoDe(clave, this.escenario);
  }

  // --- Alta -----------------------------------------------------------------

  async alta(a: Alta): Promise<void> {
    const plantilla = this.c.plantillas.get(a.plantilla);
    const cementerioId = this.c.cementerios.get(a.cementerio);
    if (!plantilla || cementerioId === undefined) {
      throw new Error(`Falta la plantilla ${a.plantilla} publicada o el cementerio ${a.cementerio}: corré primero la semilla base`);
    }
    const e = this.escenario;
    const nueva = a.plantilla === "NUEVA_CONC_CONTADO";
    const inicio = a.historica ? this.c.calendario.atras(a.inicio) : this.dia(a.inicio);
    const datos: DatosAlta = {
      plantillaId: plantilla.id,
      cementerioId,
      tipoMonumento: a.monumento,
      ubicacion: ubicacionDe(e, a.cementerio),
      padron: `PE-${String(e).padStart(4, "0")}`,
      numeroMunicipal: e % 2 === 0 ? `${2000 + e}/${inicio.slice(0, 4)}` : null,
      personas: personasDe(e, a.personas, a.difuntos ?? 0, a.defuncion === undefined ? undefined : this.c.calendario.atras(a.defuncion)),
      datosExtra: nueva ? { resolucion_caducidad: `Res. ficticia ${600 + e}/2025`, expediente_caducidad: `EF-${700 + e}/2024` } : {},
      documentosRecibidos: [],
      observaciones: a.observaciones ?? null,
      fechaInicio: inicio,
      cargaHistorica: a.historica ?? false,
      fuente: a.historica ? FUENTE_ESCENARIOS : null,
    };
    await this.altaCon(a.plantilla, datos, a.cementerio, a.personas === "juridica", a.sinDocumentos ?? []);
  }

  /** El alta con datos ya armados (también la del reinicio, desde la precarga). */
  async altaCon(plantillaCodigo: string, datos: DatosAlta, cementerio: string, juridica: boolean, sinDocumentos: readonly string[] = []): Promise<void> {
    const plantilla = this.c.plantillas.get(plantillaCodigo);
    if (!plantilla) throw new Error(`Falta la plantilla ${plantillaCodigo} publicada`);
    // Los documentos que se reciben en Mesa de Entradas: los que se exigen al salir de Mesa.
    const resuelta = resolverDefinicion(plantilla.definicion, { cementerio, rolesJuridicos: juridica ? ["titular"] : [] });
    const documentos = resuelta.documentos.filter((d) => d.exigir_al_salir_de === "MESA" && !sinDocumentos.includes(d.clave)).map((d) => d.clave);
    const r = await this.c.servicio.alta(this.usuario("MESA_ENTRADAS"), { ...datos, plantillaId: plantilla.id, documentosRecibidos: documentos }, this.comando());
    this.numero = r.numero;
    this.version = r.version;
    this.repetido = r.repetido;
    for (const d of documentos) this.presentados.add(d);
    // La definición del expediente, como la ve el dominio (su versión, su cementerio y sus personas).
    const exp = await this.c.cliente.expediente.findUniqueOrThrow({
      where: { numeroInterno: r.numero },
      select: { id: true, cementerioId: true, plantilla: { select: { definicion: true, codigo: true, version: true } } },
    });
    this.def = await definicionDelExpediente(this.c.cliente, exp, exp.plantilla);
    this.orden = 1;
  }

  // --- El flujo -------------------------------------------------------------

  async confirmar(n: number): Promise<void> {
    const r = await this.c.servicio.confirmarRecepcion(this.responsable(), this.numero, this.version, this.comando(), { fechaEfectiva: this.en(n) });
    this.version = r.version;
  }

  /** Tilda una subtarea del paso actual, como el responsable (`dato` por defecto: el día o el número ficticio). */
  async tildar(clave: string, n: number, dato?: string | null): Promise<void> {
    const valor = dato === undefined ? this.dato(clave, n) : dato;
    const r = await this.c.servicio.tildarSubtarea(this.responsable(), this.numero, clave, valor, this.version, this.comando(), { fechaEfectiva: this.en(n) });
    this.version = r.version;
    this.hechas.add(clave);
  }

  async marcar(clave: string, n: number, estado: "presentado" | "no_corresponde" = "presentado", observacion: string | null = null): Promise<void> {
    const r = await this.c.servicio.marcarDocumento(this.responsable(), this.numero, clave, estado, observacion, this.version, this.comando(), {
      fechaEfectiva: this.en(n),
    });
    this.version = r.version;
    this.presentados.add(clave);
  }

  /** Lo que falta para salir del paso actual: sus subtareas obligatorias y los documentos que se exigen al salir de él. */
  async completar(n: number): Promise<void> {
    const def = this.definicion;
    const paso = this.paso;
    for (const s of paso.subtareas) {
      if (s.obligatoria && !this.hechas.has(s.clave)) await this.tildar(s.clave, n);
    }
    const ultimo = this.orden === def.pasos.length;
    for (const d of def.documentos) {
      const exigible = d.exigir_al_salir_de === paso.clave || (ultimo && d.exigir_al_salir_de === null);
      if (d.obligatorio && exigible && !this.presentados.has(d.clave)) await this.marcar(d.clave, n);
    }
  }

  /** El pase, como el responsable, al paso siguiente (o a `destino`). */
  async pase(n: number, destino?: string, motivo?: string): Promise<void> {
    const clave = destino ?? this.definicion.pasos[this.orden]?.clave;
    if (!clave) throw new Error("El último paso no tiene pase: se concluye");
    const r = await this.c.servicio.darPase(this.responsable(), this.numero, clave, this.version, this.comando(), {
      fechaEfectiva: this.en(n),
      motivo: motivo ?? null,
    });
    this.version = r.version;
    this.ultimoPase = r.movimientoId;
    this.ordenAntesDelPase = this.orden;
    this.orden = this.ordenDe(clave);
  }

  /**
   * Completa el paso y da el pase al siguiente el día `n`; si se indica
   * `confirma`, el área que lo recibe confirma la recepción ese día. Sin
   * `confirma`, queda "sin confirmar" (en un paso externo llega recibido).
   */
  async avanzar(n: number, confirma?: number): Promise<void> {
    await this.completar(n);
    await this.pase(n);
    if (confirma !== undefined) await this.confirmar(confirma);
  }

  /** Varios tramos seguidos: `[diaPase, diaConfirma]` (sin confirma en un paso externo). */
  async recorrer(tramos: ReadonlyArray<readonly [number, number?]>): Promise<void> {
    for (const [pase, confirma] of tramos) await this.avanzar(pase, confirma);
  }

  async devolver(n: number, destino: string, motivo: string, rehacer: readonly string[] = []): Promise<void> {
    const r = await this.c.servicio.devolver(this.responsable(), this.numero, destino, motivo, rehacer, this.version, this.comando(), {
      fechaEfectiva: this.en(n),
    });
    this.version = r.version;
    this.orden = this.ordenDe(destino);
    for (const s of rehacer) this.hechas.delete(s);
  }

  async nota(n: number, area: string, texto: string): Promise<void> {
    const r = await this.c.servicio.agregarNota(this.usuario(area), this.numero, texto, this.version, this.comando(), { fechaEfectiva: this.en(n) });
    this.version = r.version;
  }

  async adjuntar(documento: string, nombre: string, contenido: Uint8Array): Promise<void> {
    const r = await this.c.servicio.subirAdjunto(this.responsable(), this.numero, flujoDe(contenido), { nombre, documento }, this.version, this.comando());
    this.version = r.version;
  }

  // --- Correcciones -----------------------------------------------------------

  /** Corrige la fecha del último pase (como su autor): `n` días hábiles atrás. */
  async corregirFechaDelPase(n: number, area: string, motivo: string): Promise<void> {
    const r = await this.c.servicio.corregirFecha(this.usuario(area), this.numero, this.ultimoPase, this.en(n) ?? this.dia(n), motivo, this.version, this.comando());
    this.version = r.version;
  }

  /** Revierte el último pase (como su autor): el expediente vuelve al paso anterior, como estaba. */
  async revertirPase(area: string, motivo: string): Promise<void> {
    const r = await this.c.servicio.revertir(this.usuario(area), this.numero, this.ultimoPase, motivo, this.version, this.comando());
    this.version = r.version;
    this.orden = this.ordenAntesDelPase;
  }

  // --- Estados ----------------------------------------------------------------

  async concluir(n: number): Promise<void> {
    const r = await this.c.servicio.concluir(this.responsable(), this.numero, this.version, this.comando(), { fechaEfectiva: this.en(n) });
    this.version = r.version;
  }

  async archivar(n: number, area: string, caja: string): Promise<void> {
    const r = await this.c.servicio.archivar(this.usuario(area), this.numero, caja, this.version, this.comando(), { fechaEfectiva: this.en(n) });
    this.version = r.version;
  }

  async archivarSinConcluir(n: number, motivo: string, caja: string): Promise<void> {
    const r = await this.c.servicio.archivarSinConcluir(
      this.usuario("MESA_ENTRADAS"),
      this.numero,
      { motivo, ubicacionArchivo: caja, fechaEfectiva: this.en(n) },
      this.version,
      this.comando(),
    );
    this.version = r.version;
  }

  async anular(n: number, motivo: string): Promise<void> {
    const r = await this.c.servicio.anular(this.usuario("MESA_ENTRADAS"), this.numero, motivo, this.version, this.comando(), { fechaEfectiva: this.en(n) });
    this.version = r.version;
  }

  async reiniciar(n: number, motivo: string): Promise<PrecargaAlta> {
    const r = await this.c.servicio.reiniciar(this.usuario("MESA_ENTRADAS"), this.numero, motivo, this.version, this.comando(), { fechaEfectiva: this.en(n) });
    this.version = r.version;
    return r.precarga;
  }

  // --- Carga histórica --------------------------------------------------------

  /** Transcribe pases de la ficha de papel: `[paso, días hábiles atrás]`, sin el tope de 30 días. */
  async transcribir(filas: ReadonlyArray<readonly [string, number]>): Promise<void> {
    const r = await this.c.servicio.transcribir(
      this.usuario("MESA_ENTRADAS"),
      this.numero,
      filas.map(([paso, n]) => ({ comandoId: this.comando(), fecha: this.c.calendario.atras(n), pasoDestino: paso, fuente: FUENTE_ESCENARIOS })),
      this.version,
    );
    this.version = r.version;
    this.orden = this.ordenDe(filas[filas.length - 1][0]);
  }

  /** Tilda en la transcripción una subtarea con la fecha de la ficha (`n` días hábiles atrás, sin tope). */
  async tildarHistorica(clave: string, n: number): Promise<void> {
    const fecha = this.c.calendario.atras(n);
    const s = this.definicion.pasos.flatMap((p) => p.subtareas).find((x) => x.clave === clave);
    const dato = s?.dato === "fecha" ? fecha : s?.dato === "texto" ? textoDe(clave, this.escenario) : null;
    const r = await this.c.servicio.tildarSubtareaHistorica(
      this.usuario("MESA_ENTRADAS"),
      this.numero,
      clave,
      dato,
      { fecha, fuente: FUENTE_ESCENARIOS },
      this.version,
      this.comando(),
    );
    this.version = r.version;
    this.hechas.add(clave);
  }

  async terminarCargaHistorica(): Promise<void> {
    const r = await this.c.servicio.terminarCargaHistorica(this.usuario("MESA_ENTRADAS"), this.numero, this.version, this.comando());
    this.version = r.version;
  }
}

// ---------------------------------------------------------------------------
// Los escenarios
// ---------------------------------------------------------------------------

/** Con qué usuario de /dev/login conviene entrar para ver el escenario. */
export type EntrarComo = "MESA_ENTRADAS" | "COMPUTO" | "LIQUIDACION" | "LEGAL" | "ADMINISTRATIVO" | "TRIBUTARIO" | "DIRECCION";

export interface Escenario {
  /** Corto y estable: "C1", "L3", "D2"… Es lo que nombran el README y el test. */
  clave: string;
  entrarComo: EntrarComo;
  /** Qué muestra, para el README y los mensajes de error. */
  descripcion: string;
  guion: (g: Guion) => Promise<void>;
  /** Expedientes que el escenario abre además del suyo (el alta del reinicio). */
  extra?: (g: Guion, c: Contexto, numero: number) => Promise<string[]>;
}

const CAJA = (n: number) => `Archivo de la Dirección · Caja 2026-${String(n).padStart(2, "0")}`;

/**
 * Los escenarios, en el orden en que se crean (y se numeran). El último abre
 * un expediente más (el reinicio), así que la numeración de los demás no
 * depende de él.
 */
export const ESCENARIOS: readonly Escenario[] = [
  // --- Cómputo ----------------------------------------------------------------
  {
    clave: "C1",
    entrarComo: "COMPUTO",
    descripcion: "Renovación de contado (Norte) enviada a Cómputo hace 4 días hábiles y sin confirmar: Por confirmar y el panel (sin confirmar)",
    guion: async (g) => {
      await g.alta({ plantilla: "RENOV_CONTADO", cementerio: "NORTE", monumento: "SOTANITO", inicio: 6, personas: "solicitante" });
      await g.avanzar(4);
    },
  },
  {
    clave: "C2",
    entrarComo: "COMPUTO",
    descripcion: "Renovación sin perjuicio de tercero (Jardín) que llegó ayer a Cómputo: final, sin confirmar",
    guion: async (g) => {
      await g.alta({ plantilla: "RENOV_SPT_CONTADO", cementerio: "JARDIN_NORTE", monumento: "SEPULTURA", inicio: 17, personas: "spt" });
      await g.recorrer([[16, 15], [13, 13], [10, 9], [6, 6], [1]]);
    },
  },
  {
    clave: "C3",
    entrarComo: "COMPUTO",
    descripcion:
      "Renovación de contado (Oeste) en Cómputo: alta, con la grabación tildada y la constancia pendiente (a medias), demorada; Mesa corrigió la fecha de su pase",
    guion: async (g) => {
      await g.alta({ plantilla: "RENOV_CONTADO", cementerio: "OESTE", monumento: "CAPILLA", inicio: 9, personas: "titular" });
      await g.avanzar(7);
      await g.corregirFechaDelPase(8, "MESA_ENTRADAS", "El pase se hizo el día anterior y se cargó con la fecha equivocada");
      await g.confirmar(7);
      await g.tildar("COMP_GRABADO", 5);
    },
  },
  {
    clave: "C4",
    entrarComo: "COMPUTO",
    descripcion: "Renovación de contado (Jardín) en Cómputo: final, confirmada y con los datos faltantes sin grabar",
    guion: async (g) => {
      await g.alta({ plantilla: "RENOV_CONTADO", cementerio: "JARDIN_NORTE", monumento: "SEPULTURA", inicio: 16, personas: "titular" });
      await g.recorrer([[15, 14], [12, 12], [9, 8], [5, 5], [2, 1]]);
    },
  },

  // --- Liquidación ------------------------------------------------------------
  {
    clave: "L1",
    entrarComo: "LIQUIDACION",
    descripcion: "Renovación sin perjuicio de tercero (Norte) enviada a Liquidación hace 2 días hábiles, sin confirmar",
    guion: async (g) => {
      await g.alta({ plantilla: "RENOV_SPT_CONTADO", cementerio: "NORTE", monumento: "MAUSOLEO", inicio: 7, personas: "spt" });
      await g.recorrer([[6, 5], [2]]);
    },
  },
  {
    clave: "L2",
    entrarComo: "LIQUIDACION",
    descripcion: "Nueva concesión (Jardín) con un difunto a inhumar, enviada hoy a Liquidación, sin confirmar",
    guion: async (g) => {
      await g.alta({ plantilla: "NUEVA_CONC_CONTADO", cementerio: "JARDIN_NORTE", monumento: "SEPULTURA", inicio: 4, personas: "titular", difuntos: 1 });
      await g.recorrer([[3, 3], [0]]);
    },
  },
  {
    clave: "L3",
    entrarComo: "LIQUIDACION",
    descripcion:
      "Renovación de contado de un panteón de una asociación (persona jurídica, Oeste): boleta emitida, esperando el pago; con una nota",
    guion: async (g) => {
      await g.alta({ plantilla: "RENOV_CONTADO", cementerio: "OESTE", monumento: "PANTEON", inicio: 12, personas: "juridica" });
      await g.recorrer([[11, 10], [8, 8]]);
      await g.tildar("LIQ_DEBITOS", 7);
      await g.tildar("LIQ_BOLETA", 7);
      for (const d of ["ESTADO_CUENTA", "CONST_PERIODOS", "CONSERVACION"]) await g.marcar(d, 7);
      await g.nota(6, "LIQUIDACION", "Boleta entregada al presidente de la asociación. Se espera el pago y el informe técnico del cementerio.");
    },
  },
  {
    clave: "L4",
    entrarComo: "LIQUIDACION",
    descripcion: "Renovación de contado (Norte) con todo listo en Liquidación (pago verificado y comprobante adjunto en PNG): Dar pase rápido",
    guion: async (g) => {
      await g.alta({ plantilla: "RENOV_CONTADO", cementerio: "NORTE", monumento: "SEPULTURA", inicio: 10, personas: "titular" });
      await g.recorrer([[9, 8], [5, 5]]);
      await g.adjuntar("COMPROBANTE_PAGO", "comprobante-pago-rapipago.png", PNG_MINIMO);
      await g.completar(3);
    },
  },
  {
    clave: "L5",
    entrarComo: "LIQUIDACION",
    descripcion: "Nueva concesión (Norte) con dos difuntos y apoderado, confirmada en Liquidación y sin empezar",
    guion: async (g) => {
      await g.alta({ plantilla: "NUEVA_CONC_CONTADO", cementerio: "NORTE", monumento: "CAPILLA", inicio: 6, personas: "solicitante", difuntos: 2 });
      await g.recorrer([[5, 4], [3, 2]]);
    },
  },
  {
    clave: "L6",
    entrarComo: "LIQUIDACION",
    descripcion: "Renovación sin perjuicio de tercero (Oeste): Liquidación dio el pase a Legal por error y lo revirtió (corrección del mes); queda lista",
    guion: async (g) => {
      await g.alta({ plantilla: "RENOV_SPT_CONTADO", cementerio: "OESTE", monumento: "SEPULTURA", inicio: 11, personas: "spt" });
      await g.recorrer([[10, 10], [7, 6]]);
      await g.avanzar(1);
      await g.revertirPase("LIQUIDACION", "Pase cargado por error: el papel sigue en Liquidación hasta que firme el jefe");
    },
  },
  {
    clave: "L7",
    entrarComo: "LIQUIDACION",
    descripcion: "Renovación de contado (Jardín) devuelta por Asesoría Legal a Liquidación con motivo y la boleta para rehacer (fila roja)",
    guion: async (g) => {
      await g.alta({ plantilla: "RENOV_CONTADO", cementerio: "JARDIN_NORTE", monumento: "SEPULTURA", inicio: 13, personas: "solicitante" });
      await g.recorrer([[12, 11], [9, 9], [6, 5]]);
      await g.devolver(3, "LIQUIDACION", "Error en boleta: falta el arrendamiento del período 2026-2031", ["LIQ_BOLETA_JARDIN"]);
      await g.confirmar(2);
    },
  },

  // --- Asesoría Legal ---------------------------------------------------------
  {
    clave: "G1",
    entrarComo: "LEGAL",
    descripcion: "Renovación de contado (Oeste) en Asesoría Legal hace 12 días hábiles (demorada: alerta a los 10), con una nota",
    guion: async (g) => {
      await g.alta({ plantilla: "RENOV_CONTADO", cementerio: "OESTE", monumento: "MAUSOLEO", inicio: 17, personas: "solicitante" });
      await g.recorrer([[16, 16], [14, 13], [12, 11]]);
      await g.nota(4, "LEGAL", "Se pidió al cementerio un informe ampliatorio sobre la titularidad antes de dictaminar.");
    },
  },
  {
    clave: "G2",
    entrarComo: "LEGAL",
    descripcion:
      "Renovación sin perjuicio de tercero (Jardín) en Legal con el vínculo acreditado y el dictamen pendiente; las actas de vínculo, \"no corresponde\" (hijo de crianza)",
    guion: async (g) => {
      await g.alta({ plantilla: "RENOV_SPT_CONTADO", cementerio: "JARDIN_NORTE", monumento: "SEPULTURA", inicio: 9, personas: "spt", sinDocumentos: ["ACTAS_VINCULO"] });
      await g.marcar("ACTAS_VINCULO", 9, "no_corresponde", "Hijo de crianza: no hay acta. Asesoría Legal acredita el vínculo.");
      await g.recorrer([[8, 8], [6, 6], [4, 3]]);
      await g.tildar("LEG_VINCULO", 2);
    },
  },
  {
    clave: "G3",
    entrarComo: "LEGAL",
    descripcion: "Nueva concesión (Oeste) que volvió del cementerio y llegó ayer a Legal, sin confirmar",
    guion: async (g) => {
      await g.alta({ plantilla: "NUEVA_CONC_CONTADO", cementerio: "OESTE", monumento: "SOTANITO", inicio: 14, personas: "titular" });
      await g.recorrer([[13, 12], [10, 10], [7]]);
      await g.tildar("CEM_CONOCIMIENTO", 6);
      await g.avanzar(1);
    },
  },

  // --- Administrativo ---------------------------------------------------------
  {
    clave: "A1",
    entrarComo: "ADMINISTRATIVO",
    descripcion: "Renovación de contado (Norte): resolución confeccionada, falta la firma del Director",
    guion: async (g) => {
      await g.alta({ plantilla: "RENOV_CONTADO", cementerio: "NORTE", monumento: "SEPULTURA", inicio: 15, personas: "titular" });
      await g.recorrer([[14, 14], [12, 11], [9, 9], [5, 5]]);
      await g.tildar("ADM_RES_CONF", 3);
    },
  },
  {
    clave: "A2",
    entrarComo: "ADMINISTRATIVO",
    descripcion: "Renovación con plan de pagos (Oeste) que volvió de la DIM con la deuda cancelada: título confeccionado, falta la firma",
    guion: async (g) => {
      await g.alta({ plantilla: "RENOV_PLAN", cementerio: "OESTE", monumento: "SOTANITO", inicio: 18, personas: "titular" });
      await g.recorrer([[17, 17], [15, 15], [13, 13], [11, 11], [10, 10], [8]]);
      await g.tildar("DIM_PLAN_INICIADO", 6);
      await g.tildar("DIM_DEUDA_CANCELADA", 3);
      await g.pase(3);
      await g.confirmar(2);
      await g.tildar("ADM_TIT_CONF", 1);
    },
  },
  {
    clave: "A3",
    entrarComo: "ADMINISTRATIVO",
    descripcion: "Nueva concesión (Jardín) con un difunto en Administrativo: entrega, esperando que el concesionario retire el título",
    guion: async (g) => {
      await g.alta({ plantilla: "NUEVA_CONC_CONTADO", cementerio: "JARDIN_NORTE", monumento: "SEPULTURA", inicio: 18, personas: "titular", difuntos: 1 });
      await g.recorrer([[17, 16], [14, 14], [12], [9, 8], [6, 6], [4, 4], [3, 3]]);
    },
  },
  {
    clave: "A4",
    entrarComo: "ADMINISTRATIVO",
    descripcion: "Renovación sin perjuicio de tercero (Norte) con el título entregado: lista para concluir",
    guion: async (g) => {
      await g.alta({ plantilla: "RENOV_SPT_CONTADO", cementerio: "NORTE", monumento: "CAPILLA", inicio: 18, personas: "spt" });
      await g.recorrer([[17, 17], [15, 14], [12, 12], [9, 8], [5, 5], [3, 2]]);
      await g.tildar("ADM_ENTREGADO", 1);
    },
  },
  {
    clave: "A5",
    entrarComo: "ADMINISTRATIVO",
    descripcion: "Renovación de contado (Jardín) con dictamen, enviada ayer a Administrativo y sin confirmar",
    guion: async (g) => {
      await g.alta({ plantilla: "RENOV_CONTADO", cementerio: "JARDIN_NORTE", monumento: "SEPULTURA", inicio: 12, personas: "titular" });
      await g.recorrer([[11, 11], [9, 8], [5, 5], [1]]);
    },
  },

  // --- Tributario y la DIM ------------------------------------------------------
  {
    clave: "T1",
    entrarComo: "TRIBUTARIO",
    descripcion: "Renovación con plan de pagos (Norte) con la resolución protocolizada, enviada ayer a Tributario y sin confirmar",
    guion: async (g) => {
      await g.alta({ plantilla: "RENOV_PLAN", cementerio: "NORTE", monumento: "SEPULTURA", inicio: 14, personas: "solicitante" });
      await g.recorrer([[13, 13], [11, 10], [8, 8], [5, 4], [1]]);
    },
  },
  {
    clave: "T2",
    entrarComo: "TRIBUTARIO",
    descripcion: "Renovación con plan de pagos (Jardín) en Tributario: resolución notificada, faltan los débitos y la remisión a la DIM",
    guion: async (g) => {
      await g.alta({ plantilla: "RENOV_PLAN", cementerio: "JARDIN_NORTE", monumento: "SEPULTURA", inicio: 16, personas: "titular" });
      await g.recorrer([[15, 15], [13, 12], [10, 10], [7, 7], [4, 4]]);
      await g.tildar("TRIB_NOTIFICADA", 2);
    },
  },
  {
    clave: "D1",
    entrarComo: "TRIBUTARIO",
    descripcion: "Renovación con plan de pagos de una asociación (persona jurídica, panteón en el Oeste) en la DIM: plazo en término",
    guion: async (g) => {
      await g.alta({ plantilla: "RENOV_PLAN", cementerio: "OESTE", monumento: "PANTEON", inicio: 18, personas: "juridica" });
      await g.recorrer([[17, 17], [15, 15], [13, 12], [10, 10], [7, 7]]);
      await g.tildar("TRIB_NOTIFICADA", 5);
      await g.avanzar(4);
    },
  },
  {
    clave: "D2",
    entrarComo: "TRIBUTARIO",
    descripcion:
      "Renovación con plan de pagos (Norte) iniciada antes del sistema (transcripta hasta Tributario, notificada hace 27 días hábiles) y remitida a la DIM: plazo por vencer",
    guion: async (g) => {
      await g.alta({ plantilla: "RENOV_PLAN", cementerio: "NORTE", monumento: "MAUSOLEO", inicio: 45, personas: "titular", historica: true });
      await g.transcribir([
        ["COMPUTO_ALTA", 43],
        ["LIQUIDACION", 39],
        ["LEGAL", 35],
        ["ADM_RESOLUCION", 31],
        ["TRIBUTARIO", 28],
      ]);
      await g.tildarHistorica("TRIB_NOTIFICADA", 27);
      await g.terminarCargaHistorica();
      await g.tildar("TRIB_DEBITOS", 16);
      await g.avanzar(15);
    },
  },
  {
    clave: "D3",
    entrarComo: "TRIBUTARIO",
    descripcion:
      "Renovación con plan de pagos (Jardín) iniciada antes del sistema, transcripta hasta la DIM (notificada hace 34 días hábiles): plazo vencido; con una nota",
    guion: async (g) => {
      await g.alta({ plantilla: "RENOV_PLAN", cementerio: "JARDIN_NORTE", monumento: "SEPULTURA", inicio: 55, personas: "solicitante", historica: true });
      await g.transcribir([
        ["COMPUTO_ALTA", 52],
        ["LIQUIDACION", 48],
        ["LEGAL", 44],
        ["ADM_RESOLUCION", 40],
        ["TRIBUTARIO", 37],
      ]);
      await g.tildarHistorica("TRIB_NOTIFICADA", 34);
      await g.tildarHistorica("TRIB_DEBITOS", 34);
      await g.tildarHistorica("TRIB_REMITIDO", 33);
      await g.transcribir([["DIM", 33]]);
      await g.terminarCargaHistorica();
      await g.nota(2, "TRIBUTARIO", "Se volvió a llamar al concesionario: no inició el plan de pagos. Venció el plazo.");
    },
  },

  // --- Mesa de Entradas -----------------------------------------------------------
  {
    clave: "M1",
    entrarComo: "MESA_ENTRADAS",
    descripcion: "Nueva concesión (Norte) en el cementerio (Afuera, custodia de Mesa) que ya tomó conocimiento; con una nota",
    guion: async (g) => {
      await g.alta({ plantilla: "NUEVA_CONC_CONTADO", cementerio: "NORTE", monumento: "SEPULTURA", inicio: 13, personas: "titular" });
      await g.recorrer([[12, 12], [10, 9], [6]]);
      await g.tildar("CEM_CONOCIMIENTO", 4);
      await g.nota(2, "MESA_ENTRADAS", "Se consultó al cementerio por teléfono: el registro sale esta semana.");
    },
  },
  {
    clave: "M2",
    entrarComo: "MESA_ENTRADAS",
    descripcion: "Nueva concesión (Jardín) con un difunto, enviada al cementerio hace 2 días hábiles (Afuera)",
    guion: async (g) => {
      await g.alta({ plantilla: "NUEVA_CONC_CONTADO", cementerio: "JARDIN_NORTE", monumento: "SEPULTURA", inicio: 8, personas: "solicitante", difuntos: 1 });
      await g.recorrer([[7, 7], [5, 4], [2]]);
    },
  },
  {
    clave: "M3",
    entrarComo: "MESA_ENTRADAS",
    descripcion: "Renovación de contado (Oeste) devuelta por Cómputo a Mesa (\"Falta documentación\"), sin confirmar hace 3 días hábiles",
    guion: async (g) => {
      await g.alta({ plantilla: "RENOV_CONTADO", cementerio: "OESTE", monumento: "SEPULTURA", inicio: 6, personas: "titular" });
      await g.recorrer([[5, 5]]);
      await g.devolver(3, "MESA", "Falta documentación: la fotocopia del DNI del titular es ilegible");
    },
  },

  // --- Estados --------------------------------------------------------------------
  {
    clave: "K1",
    entrarComo: "DIRECCION",
    descripcion: "Renovación de contado (Oeste) concluida, con el informe técnico adjunto en PDF",
    guion: async (g) => {
      await g.alta({ plantilla: "RENOV_CONTADO", cementerio: "OESTE", monumento: "CAPILLA", inicio: 18, personas: "solicitante" });
      await g.recorrer([[17, 17], [15, 14]]);
      await g.adjuntar("INFORME_TECNICO", "informe-tecnico-cementerio.pdf", pdfMinimo("Informe tecnico ficticio - escenario K1"));
      await g.recorrer([[12, 12], [10, 9], [6, 6], [4, 3]]);
      await g.tildar("ADM_ENTREGADO", 2);
      await g.concluir(2);
    },
  },
  {
    clave: "K2",
    entrarComo: "DIRECCION",
    descripcion: "Nueva concesión (Norte) concluida",
    guion: async (g) => {
      await g.alta({ plantilla: "NUEVA_CONC_CONTADO", cementerio: "NORTE", monumento: "SOTANITO", inicio: 18, personas: "titular" });
      await g.recorrer([[17, 16], [14, 14], [12], [9, 8], [6, 6], [4, 4], [3, 3]]);
      await g.tildar("ADM_ENTREGADO", 2);
      await g.concluir(1);
    },
  },
  {
    clave: "K3",
    entrarComo: "DIRECCION",
    descripcion: "Renovación sin perjuicio de tercero (Jardín) concluida y archivada con caja",
    guion: async (g) => {
      await g.alta({ plantilla: "RENOV_SPT_CONTADO", cementerio: "JARDIN_NORTE", monumento: "SEPULTURA", inicio: 17, personas: "spt" });
      await g.recorrer([[16, 16], [14, 13], [11, 11], [9, 8], [6, 6], [5, 4]]);
      await g.tildar("ADM_ENTREGADO", 3);
      await g.concluir(3);
      await g.archivar(1, "ADMINISTRATIVO", CAJA(14));
    },
  },
  {
    clave: "X1",
    entrarComo: "MESA_ENTRADAS",
    descripcion: "Nueva concesión (Oeste) archivada sin concluir desde el cementerio (el solicitante desistió), con el regreso del papel y caja",
    guion: async (g) => {
      await g.alta({ plantilla: "NUEVA_CONC_CONTADO", cementerio: "OESTE", monumento: "CAPILLA", inicio: 15, personas: "titular" });
      await g.recorrer([[14, 14], [12, 11], [8]]);
      await g.tildar("CEM_CONOCIMIENTO", 7);
      await g.archivarSinConcluir(2, "El solicitante desistió: el cementerio informó que la parcela tiene una inhumación reciente", CAJA(15));
    },
  },
  {
    clave: "Y1",
    entrarComo: "MESA_ENTRADAS",
    descripcion: "Renovación de contado (Norte) anulada por alta duplicada",
    guion: async (g) => {
      await g.alta({ plantilla: "RENOV_CONTADO", cementerio: "NORTE", monumento: "SEPULTURA", inicio: 5, personas: "titular" });
      await g.anular(4, "Alta duplicada: el mismo trámite ya estaba iniciado con otro número");
    },
  },
  {
    clave: "R1",
    entrarComo: "MESA_ENTRADAS",
    descripcion:
      "Renovación de contado (Oeste) reiniciada desde Liquidación como renovación con plan de pagos: el anterior anulado y el nuevo en Mesa, enlazados",
    guion: async (g) => {
      await g.alta({ plantilla: "RENOV_CONTADO", cementerio: "OESTE", monumento: "SEPULTURA", inicio: 10, personas: "solicitante" });
      await g.recorrer([[9, 9], [7, 6]]);
    },
    extra: async (g, c, numero) => {
      const precarga = await g.reiniciar(4, "El concesionario pidió pagar el arrendamiento en cuotas: va como solicitud de forma de pago");
      // Sus comandos van aparte (escenario + 100): es otro expediente.
      const nuevo = new Guion(c, numero + 100);
      // La precarga del alta, como la usa /expedientes/nuevo?desde=: la plantilla
      // la elige Mesa (altaCon pone el id de RENOV_PLAN), la forma de pago la fija
      // la plantilla nueva y los documentos se reciben de nuevo.
      await nuevo.altaCon(
        "RENOV_PLAN",
        { ...precarga.datos, plantillaId: 0, formaPago: null, fechaInicio: nuevo.dia(4), expedienteAnteriorId: precarga.desde.id },
        "OESTE",
        false,
      );
      await nuevo.tildar("MESA_CARATULA", 3);
      return [nuevo.numero];
    },
  },

  // --- Inhumación (27/10/2026) ------------------------------------------------------
  // Después de R1 (y de su reinicio) para no cambiar la numeración de los de
  // arriba en una base ya sembrada. Las inhumaciones se hacen en uno o dos días:
  // la defunción es de pocos días antes y los días de alerta son cortos.
  {
    clave: "I1",
    entrarComo: "LIQUIDACION",
    descripcion:
      "Inhumación con pago en la Dirección (Jardín): boleta emitida con la apertura, esperando el pago; demorada (alerta al día hábil)",
    guion: async (g) => {
      await g.alta({ plantilla: "INHUMACION_DIRECCION", cementerio: "JARDIN_NORTE", monumento: "SEPULTURA", inicio: 3, personas: "titular", difuntos: 1, defuncion: 4 });
      await g.avanzar(3, 2);
      await g.tildar("LIQ_DEBITOS", 2);
      await g.tildar("LIQ_BOLETA_JARDIN", 2);
    },
  },
  {
    clave: "I2",
    entrarComo: "MESA_ENTRADAS",
    descripcion:
      "Inhumación con pago en la empresa fúnebre (Oeste, sotanito): horario informado al cementerio, en el cementerio (Afuera) con los comprobantes presentados",
    guion: async (g) => {
      await g.alta({ plantilla: "INHUMACION_EMPRESA", cementerio: "OESTE", monumento: "SOTANITO", inicio: 1, personas: "solicitante", difuntos: 1, defuncion: 2 });
      await g.avanzar(1);
      await g.tildar("CEM_COMPROBANTES", 0);
    },
  },
  {
    clave: "I3",
    entrarComo: "MESA_ENTRADAS",
    descripcion:
      "Inhumación con pago en la Dirección (Norte, capilla) que el cementerio ya hizo y devolvió: en Conocimiento y archivo, falta tildar el conocimiento para concluir y archivar",
    guion: async (g) => {
      await g.alta({ plantilla: "INHUMACION_DIRECCION", cementerio: "NORTE", monumento: "CAPILLA", inicio: 5, personas: "titular", difuntos: 1, defuncion: 6 });
      await g.recorrer([[5, 4], [3]]);
      await g.tildar("CEM_REALIZADA", 2);
      await g.avanzar(1);
    },
  },
];

// ---------------------------------------------------------------------------
// Sembrar
// ---------------------------------------------------------------------------

export interface ResumenEscenarios {
  creados: number;
  /** Ya estaban (comando del alta ya usado). */
  existentes: number;
  /** Cada escenario con su expediente (y los que abrió, como el reinicio). */
  escenarios: Array<{ clave: string; numero: string; extra: string[] }>;
  numeros: string[];
}

export interface OpcionesEscenarios {
  /** Dónde guardar los adjuntos. Por defecto, el de la app: ADJUNTOS_DIR o ./.data/adjuntos. */
  almacen?: AlmacenAdjuntos;
  /** Solo para los tests: el reloj. */
  ahora?: () => Date;
}

async function cargarContexto(cliente: Cliente, opciones: OpcionesEscenarios): Promise<Contexto> {
  const usuarios = new Map<string, UsuarioPermisos>();
  for (const u of USUARIOS_FICTICIOS) {
    const fila = await cliente.usuario.findUnique({
      where: { cuil: u.cuil },
      select: { id: true, rol: true, activo: true, area: { select: { id: true, codigo: true } } },
    });
    if (fila && esRol(fila.rol) && fila.area) usuarios.set(fila.area.codigo, { id: fila.id, rol: fila.rol, activo: fila.activo, area: fila.area });
  }
  const plantillas = new Map<string, PlantillaPublicada>();
  for (const p of await cliente.plantilla.findMany({ where: { estado: "publicada" }, select: { id: true, codigo: true, version: true, definicion: true } })) {
    plantillas.set(p.codigo, { id: p.id, definicion: leerDefinicion(p.definicion, p.codigo, p.version) });
  }
  const cementerios = new Map((await cliente.cementerio.findMany({ select: { id: true, codigo: true } })).map((c) => [c.codigo, c.id]));
  const feriados = new Set((await cliente.feriado.findMany({ select: { fecha: true } })).map((f) => fechaDesdeDb(f.fecha)));
  const servicio = crearServicioExpedientes({
    leer: cliente,
    escribir: (usuarioId, motivo, fn) => conActorEn(cliente, usuarioId, motivo, fn),
    ahora: opciones.ahora,
    almacen: opciones.almacen ?? crearAlmacenEnDisco(raizAdjuntos()),
    // Códigos de consulta deterministas (28/10/2026): los del README, para probar /consulta.
    generarCodigoConsulta: codigoDeSemilla,
  });
  const hoy = hoyEnTucuman(opciones.ahora?.() ?? new Date());
  return { cliente, servicio, calendario: new Calendario(hoy, feriados), usuarios, plantillas, cementerios };
}

/**
 * Crea (o completa) los escenarios. Necesita la semilla base con los usuarios
 * ficticios y, para que la numeración quede después de ellos, corre después de
 * los 30 expedientes ficticios (prisma/seed.ts).
 */
export async function sembrarEscenarios(cliente: Cliente, opciones: OpcionesEscenarios = {}): Promise<ResumenEscenarios> {
  const c = await cargarContexto(cliente, opciones);
  const resumen: ResumenEscenarios = { creados: 0, existentes: 0, escenarios: [], numeros: [] };
  for (const [i, e] of ESCENARIOS.entries()) {
    const g = new Guion(c, i + 1);
    try {
      await e.guion(g);
      const extra = e.extra ? await e.extra(g, c, i + 1) : [];
      resumen.escenarios.push({ clave: e.clave, numero: g.numero, extra });
      resumen.numeros.push(g.numero, ...extra);
      const nuevos = 1 + extra.length;
      if (g.repetido) resumen.existentes += nuevos;
      else resumen.creados += nuevos;
    } catch (error) {
      // Con el detalle por campo: sin él, "Revisá los datos marcados" no dice qué.
      const detalle = error instanceof ErrorDominio ? error.errores.map((x) => `\n  - ${x.ruta}: ${x.mensaje}`).join("") : "";
      const permiso = error instanceof PermisoDenegado ? ` (${error.accion}: ${error.motivo})` : "";
      throw new Error(
        `Escenario ${e.clave}${g.numero ? ` (${g.numero})` : ""}: ${error instanceof Error ? error.message : String(error)}${permiso}${detalle}`,
        { cause: error },
      );
    }
  }
  return resumen;
}
