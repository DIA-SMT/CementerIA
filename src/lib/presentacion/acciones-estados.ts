import { z } from "zod";
import type { ResultadoFilaTranscripcion, ServicioExpedientes } from "@/lib/dominio/expedientes";
import { ErrorDominio, errorValidacion } from "@/lib/dominio/expedientes/errores";
import type { UsuarioPermisos } from "@/lib/dominio/permisos";
import { BaseAccion, FechaAccion, leerEntrada, TextoAccion, vacioANull, type ResultadoFlujo } from "./acciones";
import { rutaFicha } from "./enlaces";
import { estadoDeError, type EstadoError } from "./errores";
import { rutaReinicio, textoUbicacion } from "./estados";
import { datosAltaVinculado } from "./formulario";
import { resumenTranscripcion } from "./transcripcion";
import { etiquetaEstado } from "./textos";

/**
 * La lógica de las Server Actions de la semana 4, sin Next (como
 * ./acciones.ts): estados (3.1), reiniciar y "archivar y abrir vinculado"
 * (2.13(a) y la caducidad), nota, correcciones y supresión (2.13(b)) y la
 * transcripción histórica (2.13(c)). Cada una vuelve a validar la forma de la
 * entrada (llega del navegador), llama al dominio y traduce sus errores. Las
 * reglas son del dominio.
 */

/** Las acciones que, al terminar, llevan a otra pantalla. */
export type ResultadoNavegacion = { ok: true; destino: string; mensaje: string } | EstadoError;

const Ubicacion = z.string().max(200).nullish();
const Motivo = TextoAccion.nullish();
const Id = z.string().regex(/^\d{1,19}$/);

// ---------------------------------------------------------------------------
// Estados (3.1)
// ---------------------------------------------------------------------------

export const ACCIONES_ESTADO = ["concluir", "archivar", "archivar_sin_concluir", "desarchivar", "anular", "reabrir", "ubicacion_archivo"] as const;

const EntradaEstado = BaseAccion.extend({
  accion: z.enum(ACCIONES_ESTADO),
  motivo: Motivo,
  ubicacionArchivo: Ubicacion,
  fechaEfectiva: FechaAccion,
  observacion: TextoAccion.nullish(),
});
export type EntradaEstado = z.input<typeof EntradaEstado>;

/** Concluir, archivar (también sin concluir), desarchivar, anular, reabrir y cambiar la ubicación de archivo. */
export async function procesarEstado(servicio: ServicioExpedientes, usuario: UsuarioPermisos, valor: unknown): Promise<ResultadoFlujo> {
  try {
    const d = leerEntrada(EntradaEstado, valor);
    const opciones = { fechaEfectiva: vacioANull(d.fechaEfectiva), observacion: vacioANull(d.observacion) };
    const motivo = vacioANull(d.motivo);
    const ubicacion = d.ubicacionArchivo ?? "";
    switch (d.accion) {
      case "concluir": {
        const r = await servicio.concluir(usuario, d.numero, d.versionVista, d.comandoId, opciones);
        return { ok: true, version: r.version, repetido: r.repetido, mensaje: "Expediente concluido. Ya se puede archivar." };
      }
      case "archivar": {
        const r = await servicio.archivar(usuario, d.numero, ubicacion, d.versionVista, d.comandoId, opciones);
        return { ok: true, version: r.version, repetido: r.repetido, mensaje: `Expediente archivado (${textoUbicacion(r.ubicacionArchivo)}).` };
      }
      case "archivar_sin_concluir": {
        const r = await servicio.archivarSinConcluir(usuario, d.numero, { motivo, ubicacionArchivo: ubicacion, ...opciones }, d.versionVista, d.comandoId);
        return {
          ok: true,
          version: r.version,
          repetido: r.repetido,
          mensaje: `Expediente archivado sin concluir (${textoUbicacion(r.ubicacionArchivo)}). El papel queda en ${r.areaActual.nombre}.`,
        };
      }
      case "desarchivar": {
        const r = await servicio.desarchivar(usuario, d.numero, motivo, d.versionVista, d.comandoId, opciones);
        return { ok: true, version: r.version, repetido: r.repetido, mensaje: `Expediente desarchivado: vuelve a ${etiquetaEstado(r.estado).toLowerCase()}, en ${r.paso.nombre}.` };
      }
      case "anular": {
        const r = await servicio.anular(usuario, d.numero, motivo, d.versionVista, d.comandoId, opciones);
        return { ok: true, version: r.version, repetido: r.repetido, mensaje: "Expediente anulado." };
      }
      case "reabrir": {
        const r = await servicio.reabrir(usuario, d.numero, motivo, d.versionVista, d.comandoId, opciones);
        return { ok: true, version: r.version, repetido: r.repetido, mensaje: `Expediente reabierto: vuelve a ${etiquetaEstado(r.estado).toLowerCase()}.` };
      }
      case "ubicacion_archivo": {
        const r = await servicio.cambiarUbicacionArchivo(usuario, d.numero, ubicacion, d.versionVista, d.comandoId, { motivo });
        return { ok: true, version: r.version, repetido: r.repetido, mensaje: `Ubicación de archivo: ${textoUbicacion(r.ubicacionArchivo)}.` };
      }
    }
  } catch (e) {
    return estadoDeError(e);
  }
}

// ---------------------------------------------------------------------------
// Reiniciar con otra plantilla y archivar y abrir vinculado
// ---------------------------------------------------------------------------

const EntradaReinicio = BaseAccion.extend({ motivo: Motivo, plantillaId: z.int().positive() });
export type EntradaReinicio = z.input<typeof EntradaReinicio>;

/**
 * Reiniciar con otra plantilla (2.13(a)): anula con motivo y lleva al alta
 * precargada (`/expedientes/nuevo?desde=<numero>&plantilla=<id>`).
 */
export async function procesarReinicio(servicio: ServicioExpedientes, usuario: UsuarioPermisos, valor: unknown): Promise<ResultadoNavegacion> {
  try {
    const d = leerEntrada(EntradaReinicio, valor);
    const r = await servicio.reiniciar(usuario, d.numero, vacioANull(d.motivo), d.versionVista, d.comandoId);
    return { ok: true, destino: rutaReinicio(r.numero, d.plantillaId), mensaje: `${r.numero} quedó anulado para reiniciarlo.` };
  } catch (e) {
    return estadoDeError(e);
  }
}

const EntradaVinculado = BaseAccion.extend({
  motivo: Motivo,
  ubicacionArchivo: Ubicacion,
  plantillaId: z.int().positive(),
  fechaEfectiva: FechaAccion,
  observacion: TextoAccion.nullish(),
});
export type EntradaVinculado = z.input<typeof EntradaVinculado>;

/**
 * "Archivar y abrir vinculado" (la caducidad, docs/fuentes punto 6): el alta
 * del nuevo es la precarga del expediente acomodada a la plantilla elegida
 * (`datosAltaVinculado`); el dominio archiva sin concluir y da el alta en una
 * transacción. Lleva a la ficha del nuevo.
 */
export async function procesarVinculado(
  servicio: ServicioExpedientes,
  usuario: UsuarioPermisos,
  valor: unknown,
  ip: string | null,
): Promise<ResultadoNavegacion> {
  try {
    const d = leerEntrada(EntradaVinculado, valor);
    const precarga = await servicio.precargaAlta(usuario, d.numero, { ip });
    const ctx = await servicio.contextoAlta(usuario, d.plantillaId, precarga.datos.cementerioId);
    if (ctx.problemas.length > 0) throw new ErrorDominio("configuracion_incompleta", ctx.problemas.join(". "));
    const datos = datosAltaVinculado(precarga.datos, {
      plantillaId: d.plantillaId,
      definicion: ctx.definicion,
      hoy: ctx.hoy,
      tiposMonumento: ctx.tiposMonumento.map((t) => t.codigo),
      clavesUbicacion: ctx.camposUbicacion.map((c) => c.clave),
    });
    const r = await servicio.archivarYAbrirVinculado(
      usuario,
      d.numero,
      { motivo: vacioANull(d.motivo), ubicacionArchivo: d.ubicacionArchivo ?? "", fechaEfectiva: vacioANull(d.fechaEfectiva), observacion: vacioANull(d.observacion) },
      datos,
      d.versionVista,
      d.comandoId,
    );
    return { ok: true, destino: rutaFicha(r.nuevo.numero), mensaje: `${r.archivado.numero} quedó archivado y se abrió ${r.nuevo.numero}.` };
  } catch (e) {
    return estadoDeError(e);
  }
}

// ---------------------------------------------------------------------------
// Nota
// ---------------------------------------------------------------------------

const EntradaNota = BaseAccion.extend({ texto: TextoAccion.nullish(), fechaEfectiva: FechaAccion });
export type EntradaNota = z.input<typeof EntradaNota>;

export async function procesarNota(servicio: ServicioExpedientes, usuario: UsuarioPermisos, valor: unknown): Promise<ResultadoFlujo> {
  try {
    const d = leerEntrada(EntradaNota, valor);
    const r = await servicio.agregarNota(usuario, d.numero, vacioANull(d.texto), d.versionVista, d.comandoId, { fechaEfectiva: vacioANull(d.fechaEfectiva) });
    return { ok: true, version: r.version, repetido: r.repetido, mensaje: "Nota agregada al historial." };
  } catch (e) {
    return estadoDeError(e);
  }
}

// ---------------------------------------------------------------------------
// Correcciones (2.13(b))
// ---------------------------------------------------------------------------

const EntradaCorreccion = BaseAccion.extend({
  tipo: z.enum(["revertir", "fecha", "observacion", "subtarea_dato", "subtarea_destildar", "retirar_adjunto", "purgar_adjunto"]),
  movimientoId: Id,
  motivo: Motivo,
  /** Corregir la fecha: `YYYY-MM-DD` o `datetime-local`. */
  fecha: z.string().max(40).nullish(),
  /** Corregir la observación (vacío: se borra). */
  observacion: TextoAccion.nullish(),
  /** Subtarea: la clave y el dato nuevo. */
  clave: z.string().min(1).max(80).nullish(),
  dato: z.string().max(400).nullish(),
  /** Purgar: la confirmación explícita del diálogo. */
  confirmado: z.boolean().optional(),
});
export type EntradaCorreccion = z.input<typeof EntradaCorreccion>;

const MENSAJE_CORRECCION: Record<z.infer<typeof EntradaCorreccion>["tipo"], string> = {
  revertir: "Movimiento revertido: el expediente volvió a como estaba antes.",
  fecha: "Fecha corregida.",
  observacion: "Observación corregida.",
  subtarea_dato: "Dato de la subtarea corregido.",
  subtarea_destildar: "Subtarea destildada.",
  retirar_adjunto: "Adjunto retirado (el archivo se conserva).",
  purgar_adjunto: "Adjunto purgado: el archivo se borró.",
};

export async function procesarCorreccion(servicio: ServicioExpedientes, usuario: UsuarioPermisos, valor: unknown): Promise<ResultadoFlujo> {
  try {
    const d = leerEntrada(EntradaCorreccion, valor);
    const motivo = vacioANull(d.motivo);
    const comunes = [d.versionVista, d.comandoId] as const;
    const clave = () => {
      if (!d.clave) throw errorValidacion([{ ruta: "clave", mensaje: "Falta la subtarea" }]);
      return d.clave;
    };
    let r;
    switch (d.tipo) {
      case "revertir":
        r = await servicio.revertir(usuario, d.numero, d.movimientoId, motivo, ...comunes);
        break;
      case "fecha":
        if (!d.fecha || d.fecha.trim() === "") throw errorValidacion([{ ruta: "fechaEfectiva", mensaje: "Indicá la fecha correcta" }], "Falta la fecha");
        r = await servicio.corregirFecha(usuario, d.numero, d.movimientoId, d.fecha.trim(), motivo, ...comunes);
        break;
      case "observacion":
        r = await servicio.corregirObservacion(usuario, d.numero, d.movimientoId, vacioANull(d.observacion), motivo, ...comunes);
        break;
      case "subtarea_dato":
        r = await servicio.corregirSubtarea(usuario, d.numero, clave(), { dato: vacioANull(d.dato) }, motivo, ...comunes);
        break;
      case "subtarea_destildar":
        r = await servicio.corregirSubtarea(usuario, d.numero, clave(), { hecha: false }, motivo, ...comunes);
        break;
      case "retirar_adjunto":
        r = await servicio.retirarAdjunto(usuario, d.numero, d.movimientoId, motivo, ...comunes);
        break;
      case "purgar_adjunto":
        if (d.confirmado !== true) throw errorValidacion([{ ruta: "confirmado", mensaje: "Confirmá que el archivo se borra y no se recupera" }], "Falta confirmar");
        r = await servicio.purgarAdjunto(usuario, d.numero, d.movimientoId, motivo, ...comunes);
        break;
    }
    return { ok: true, version: r.version, repetido: r.repetido, mensaje: MENSAJE_CORRECCION[d.tipo] };
  } catch (e) {
    return estadoDeError(e);
  }
}

const EntradaSupresion = BaseAccion.extend({ personaId: Id, motivo: Motivo, confirmado: z.boolean().optional() });
export type EntradaSupresion = z.input<typeof EntradaSupresion>;

/** Suprimir los datos de una persona (Ley 25.326, admin), con la confirmación explícita del diálogo. */
export async function procesarSupresion(servicio: ServicioExpedientes, usuario: UsuarioPermisos, valor: unknown): Promise<ResultadoFlujo> {
  try {
    const d = leerEntrada(EntradaSupresion, valor);
    if (d.confirmado !== true) throw errorValidacion([{ ruta: "confirmado", mensaje: "Confirmá que los datos se borran y no se recuperan" }], "Falta confirmar");
    const r = await servicio.suprimirPersona(usuario, d.numero, d.personaId, vacioANull(d.motivo), d.versionVista, d.comandoId);
    return { ok: true, version: r.version, repetido: r.repetido, mensaje: "Datos de la persona suprimidos. Queda el rol y la constancia." };
  } catch (e) {
    return estadoDeError(e);
  }
}

// ---------------------------------------------------------------------------
// Transcripción histórica (2.13(c))
// ---------------------------------------------------------------------------

const EntradaTranscripcion = z.object({
  numero: z.string().min(1).max(40),
  versionVista: z.int().min(0),
  filas: z
    .array(
      z.object({
        comandoId: z.string().max(100),
        fecha: z.string().max(40),
        precision: z.enum(["dia", "minuto"]).optional(),
        pasoDestino: z.string().max(80),
        observacion: TextoAccion.nullish(),
        fuente: z.string().max(400).nullish(),
        motivo: TextoAccion.nullish(),
      }),
    )
    .max(100),
});
export type EntradaTranscripcion = z.input<typeof EntradaTranscripcion>;

export type ResultadoTranscripcionPantalla =
  | { ok: true; version: number; mensaje: string; filas: ResultadoFilaTranscripcion[] }
  | EstadoError;

/** "Registrar lote": las filas de la grilla en una transacción. */
export async function procesarTranscripcion(servicio: ServicioExpedientes, usuario: UsuarioPermisos, valor: unknown): Promise<ResultadoTranscripcionPantalla> {
  try {
    const d = leerEntrada(EntradaTranscripcion, valor);
    const filas = d.filas.map((f) => ({ ...f, fuente: f.fuente ?? null, observacion: vacioANull(f.observacion), motivo: vacioANull(f.motivo) }));
    const r = await servicio.transcribir(usuario, d.numero, filas, d.versionVista);
    return { ok: true, version: r.version, mensaje: resumenTranscripcion(r.filas, r.paso.nombre), filas: r.filas };
  } catch (e) {
    return estadoDeError(e);
  }
}

const EntradaSubtareaHistorica = BaseAccion.extend({
  clave: z.string().min(1).max(80),
  dato: z.string().max(400).nullish(),
  fecha: z.string().max(40).nullish(),
  fuente: z.string().max(400).nullish(),
  observacion: TextoAccion.nullish(),
});
export type EntradaSubtareaHistorica = z.input<typeof EntradaSubtareaHistorica>;

export async function procesarSubtareaHistorica(servicio: ServicioExpedientes, usuario: UsuarioPermisos, valor: unknown): Promise<ResultadoFlujo> {
  try {
    const d = leerEntrada(EntradaSubtareaHistorica, valor);
    const r = await servicio.tildarSubtareaHistorica(
      usuario,
      d.numero,
      d.clave,
      vacioANull(d.dato),
      { fecha: vacioANull(d.fecha), fuente: vacioANull(d.fuente), observacion: vacioANull(d.observacion) },
      d.versionVista,
      d.comandoId,
    );
    return { ok: true, version: r.version, repetido: r.repetido, mensaje: "Subtarea tildada en la transcripción." };
  } catch (e) {
    return estadoDeError(e);
  }
}

const EntradaEstadoHistorico = BaseAccion.extend({
  estado: z.enum(["concluido", "archivado"]),
  fecha: z.string().max(40),
  precision: z.enum(["dia", "minuto"]).optional(),
  fuente: z.string().max(400).nullish(),
  ubicacionArchivo: Ubicacion,
  motivo: Motivo,
  observacion: TextoAccion.nullish(),
});
export type EntradaEstadoHistorico = z.input<typeof EntradaEstadoHistorico>;

export async function procesarEstadoHistorico(servicio: ServicioExpedientes, usuario: UsuarioPermisos, valor: unknown): Promise<ResultadoFlujo> {
  try {
    const d = leerEntrada(EntradaEstadoHistorico, valor);
    const r = await servicio.transcribirEstado(
      usuario,
      d.numero,
      {
        estado: d.estado,
        fecha: d.fecha,
        precision: d.precision,
        fuente: vacioANull(d.fuente),
        ubicacionArchivo: vacioANull(d.ubicacionArchivo),
        motivo: vacioANull(d.motivo),
        observacion: vacioANull(d.observacion),
      },
      d.versionVista,
      d.comandoId,
    );
    return { ok: true, version: r.version, repetido: r.repetido, mensaje: d.estado === "concluido" ? "Quedó concluido según la ficha." : "Quedó archivado según la ficha." };
  } catch (e) {
    return estadoDeError(e);
  }
}

/** "Terminar carga histórica": desde ahí rigen las reglas normales; vuelve a la ficha. */
export async function procesarTerminarCarga(servicio: ServicioExpedientes, usuario: UsuarioPermisos, valor: unknown): Promise<ResultadoNavegacion> {
  try {
    const d = leerEntrada(BaseAccion, valor);
    const r = await servicio.terminarCargaHistorica(usuario, d.numero, d.versionVista, d.comandoId);
    return { ok: true, destino: rutaFicha(r.numero), mensaje: "Carga histórica terminada." };
  } catch (e) {
    return estadoDeError(e);
  }
}
