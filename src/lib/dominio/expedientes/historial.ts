import { hoyEnTucuman, type FechaISO } from "@/lib/fechas";
import { exigirPermiso, type EstadoExpediente, type UsuarioPermisos } from "../permisos";
import { exigirNumero, registrarAcceso, type OpcionesAcceso } from "./acceso";
import type { DependenciasExpedientes } from "./dependencias";
import { armarFicha, type Ficha, type MovimientoFicha } from "./ficha";

/**
 * La hoja imprimible del historial (docs/propuesta-mvp.md, sección 5,
 * "Imprimibles"): todos los movimientos con ambas fechas, usuarios y
 * correcciones. Se agrega al expediente de papel al archivarlo.
 *
 * Como la carátula, no lleva teléfono, correo ni domicilio: de las personas
 * van el rol, el nombre y el DNI (o la razón social y el CUIT), para leer las altas y versiones nuevas de la
 * línea de tiempo. Pedirla registra `imprimir` (`detalle.hoja = "historial"`).
 */

export interface PersonaHistorial {
  id: string;
  etiquetaRol: string;
  apellido: string | null;
  nombres: string | null;
  dni: string | null;
  /** Persona jurídica. */
  razonSocial: string | null;
  cuit: string | null;
  vigente: boolean;
  suprimida: boolean;
}

export interface HojaHistorial {
  numero: string;
  numeroCorto: string;
  numeroMunicipal: string | null;
  estado: EstadoExpediente;
  /** "Renovación, pago de contado · v1 (hay v2)". */
  tramite: string;
  tipoTramite: string;
  cementerio: string;
  ubicacionTexto: string;
  padron: string | null;
  fechaInicio: FechaISO;
  cargaHistorica: boolean;
  paso: Ficha["paso"];
  areaActual: string;
  /** Vigentes e históricas, sin datos de contacto. */
  personas: PersonaHistorial[];
  /** Etiquetas de los campos extra, para leer las ediciones (`datos_extra.<clave>`). */
  camposExtra: Array<{ clave: string; etiqueta: string }>;
  /** Del más viejo al más nuevo, como en la ficha. */
  historial: MovimientoFicha[];
  /** Hoy en Tucumán: va al pie ("Emitida el …"). */
  emitidaEl: FechaISO;
}

/**
 * Los datos de la hoja del historial, con el registro de `imprimir`.
 *
 * @throws PermisoDenegado
 * @throws ErrorDominio `no_encontrado`
 */
export async function datosHistorial(
  deps: DependenciasExpedientes,
  usuario: UsuarioPermisos,
  numero: string,
  opciones: OpcionesAcceso = {},
): Promise<HojaHistorial> {
  exigirPermiso("imprimir", null, usuario);
  const numeroInterno = exigirNumero(numero);
  const hoy = hoyEnTucuman(deps.ahora?.() ?? new Date());

  return deps.escribir(usuario.id, null, async (tx) => {
    const { ficha, id } = await armarFicha(tx, usuario, numeroInterno, hoy);
    await registrarAcceso(tx, {
      usuarioId: usuario.id,
      accion: "imprimir",
      expedienteId: id,
      detalle: { hoja: "historial" },
      ip: opciones.ip,
    });
    const persona = (p: Ficha["personas"][number]): PersonaHistorial => ({
      id: p.id,
      etiquetaRol: p.etiquetaRol,
      apellido: p.apellido,
      nombres: p.nombres,
      dni: p.dni,
      razonSocial: p.razonSocial,
      cuit: p.cuit,
      vigente: p.vigente,
      suprimida: p.suprimida,
    });
    return {
      numero: ficha.numero,
      numeroCorto: ficha.numeroCorto,
      numeroMunicipal: ficha.numeroMunicipal,
      estado: ficha.estado,
      tramite: ficha.plantilla.texto,
      tipoTramite: ficha.tipoTramite.nombre,
      cementerio: ficha.cementerio.nombre,
      ubicacionTexto: ficha.ubicacionTexto,
      padron: ficha.padron,
      fechaInicio: ficha.fechaInicio,
      cargaHistorica: ficha.cargaHistorica,
      paso: ficha.paso,
      areaActual: ficha.areaActual.nombre,
      personas: [...ficha.personas, ...ficha.personasHistoricas].map(persona),
      camposExtra: ficha.datosExtra.map((c) => ({ clave: c.clave, etiqueta: c.etiqueta })),
      historial: ficha.historial,
      emitidaEl: hoy,
    };
  });
}
