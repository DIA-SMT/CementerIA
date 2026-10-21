import { fechaDesdeDb, hoyEnTucuman, type FechaISO } from "@/lib/fechas";
import { exigirPermiso, type UsuarioPermisos } from "../permisos";
import { exigirNumero, registrarAcceso, type OpcionesAcceso } from "./acceso";
import { definicionDelExpediente } from "./contexto";
import type { DependenciasExpedientes } from "./dependencias";
import { ErrorDominio, noEncontrado } from "./errores";
import type { TipoPersona } from "./esquemas";
import { numeroCorto } from "./numero";
import { areasDelPaso } from "./proyeccion";
import { leerCamposUbicacion } from "./ubicacion";

/**
 * La carátula (docs/propuesta-mvp.md, sección 5, "Imprimibles"): se abrocha al
 * papel y reemplaza la ficha. Lleva el número grande, el QR a la ficha, N°
 * municipal, trámite, cementerio, ubicación, padrón, titular y solicitante
 * (SIN teléfono, correo ni domicilio: el papel circula por muchas manos;
 * de una persona jurídica, razón social y CUIT) y el recorrido previsto con
 * casilleros: las subtareas que corresponden al cementerio del expediente.
 *
 * El QR lo arma la pantalla con `rutaFicha` y la URL de la app (qrcode, SVG en
 * el servidor). Pedir la carátula registra `imprimir` en `auditoria.accesos`.
 */

export interface PersonaCaratula {
  tipo: TipoPersona;
  apellido: string | null;
  nombres: string | null;
  dni: string | null;
  razonSocial: string | null;
  cuit: string | null;
  fallecido: boolean;
  vinculo: string | null;
}

export interface PasoCaratula {
  orden: number;
  clave: string;
  nombre: string;
  /** El área donde estará el papel ("Liquidación", "Cementerio del Oeste"). */
  area: string;
  /** Quién lo sigue si el área es externa. */
  custodia: string | null;
  /** Para los casilleros. */
  subtareas: Array<{ clave: string; nombre: string; obligatoria: boolean }>;
}

export interface Caratula {
  numero: string;
  numeroCorto: string;
  numeroMunicipal: string | null;
  /** `/expedientes/CEM-2026-00042`: el destino del QR. */
  rutaFicha: string;
  tramite: { tipo: string; plantilla: string; version: number };
  cementerio: string;
  tipoMonumento: string;
  ubicacion: Array<{ etiqueta: string; valor: string }>;
  ubicacionTexto: string;
  padron: string | null;
  fechaInicio: FechaISO;
  cargaHistorica: boolean;
  titulares: PersonaCaratula[];
  solicitantes: PersonaCaratula[];
  recorrido: PasoCaratula[];
  /** Hoy en Tucumán: va al pie ("Emitida el …"). */
  emitidaEl: FechaISO;
}

/**
 * Los datos de la carátula, con el registro de `imprimir`.
 *
 * @throws PermisoDenegado
 * @throws ErrorDominio `no_encontrado`
 */
export async function datosCaratula(
  deps: DependenciasExpedientes,
  usuario: UsuarioPermisos,
  numero: string,
  opciones: OpcionesAcceso = {},
): Promise<Caratula> {
  exigirPermiso("imprimir", null, usuario);
  const numeroInterno = exigirNumero(numero);
  const hoy = hoyEnTucuman(deps.ahora?.() ?? new Date());

  return deps.escribir(usuario.id, null, async (tx) => {
    const e = await tx.expediente.findUnique({
      where: { numeroInterno },
      include: {
        tipoTramite: { select: { nombre: true } },
        plantilla: { select: { codigo: true, nombre: true, version: true, definicion: true } },
        cementerio: true,
        monumento: { select: { nombre: true } },
        personas: {
          where: { vigente: true, rol: { in: ["titular", "solicitante"] } },
          orderBy: [{ rol: "asc" }, { orden: "asc" }],
          select: { rol: true, tipoPersona: true, apellido: true, nombres: true, dni: true, razonSocial: true, cuit: true, fallecido: true, vinculo: true },
        },
      },
    });
    if (!e) throw noEncontrado(numeroInterno);
    const def = await definicionDelExpediente(tx, e, e.plantilla);
    const areas = await tx.area.findMany({ select: { id: true, codigo: true, nombre: true, tipo: true } });
    const cementerios = await tx.cementerio.findMany({ select: { codigo: true, nombre: true, areaId: true } });
    const areaPorId = new Map(areas.map((a) => [a.id, a]));
    const areaPorCodigo = new Map(areas.map((a) => [a.codigo, a]));

    const recorrido: PasoCaratula[] = def.pasos.map((p, i) => {
      let area = p.area;
      try {
        const r = areasDelPaso(p, {
          areas: areaPorCodigo,
          areaCementerioId: e.cementerio.areaId,
          areaDeCementerio: new Map(cementerios.map((c) => [c.codigo, c.areaId])),
          datosExtra: e.datosExtra as Record<string, unknown>,
        });
        area = areaPorId.get(r.areaActualId)?.nombre ?? p.area;
      } catch (error) {
        // Un paso a "$CAMPO:x" sin el campo completo: se imprime igual, sin el área.
        if (!(error instanceof ErrorDominio)) throw error;
        area = "A definir";
      }
      return {
        orden: i + 1,
        clave: p.clave,
        nombre: p.nombre,
        area,
        custodia: p.custodia === null ? null : (areaPorCodigo.get(p.custodia)?.nombre ?? p.custodia),
        subtareas: p.subtareas.map((s) => ({ clave: s.clave, nombre: s.nombre, obligatoria: s.obligatoria })),
      };
    });

    const valores = e.ubicacion as Record<string, string>;
    const campos = leerCamposUbicacion(e.cementerio.camposUbicacion, e.cementerio.nombre);
    const ubicacion = campos
      .filter((c) => valores[c.clave] !== undefined)
      .map((c) => ({ etiqueta: c.etiqueta, valor: valores[c.clave] }));

    const persona = (p: (typeof e.personas)[number]): PersonaCaratula => ({
      tipo: p.tipoPersona === "juridica" ? "juridica" : "fisica",
      apellido: p.apellido,
      nombres: p.nombres,
      dni: p.dni,
      razonSocial: p.razonSocial,
      cuit: p.cuit,
      fallecido: p.fallecido,
      vinculo: p.vinculo,
    });

    await registrarAcceso(tx, {
      usuarioId: usuario.id,
      accion: "imprimir",
      expedienteId: e.id,
      detalle: { hoja: "caratula" },
      ip: opciones.ip,
    });

    return {
      numero: e.numeroInterno,
      numeroCorto: numeroCorto(e.anio, e.secuencia),
      numeroMunicipal: e.numeroMunicipal,
      rutaFicha: `/expedientes/${e.numeroInterno}`,
      tramite: { tipo: e.tipoTramite.nombre, plantilla: e.plantilla.nombre, version: e.plantilla.version },
      cementerio: e.cementerio.nombre,
      tipoMonumento: e.monumento.nombre,
      ubicacion,
      ubicacionTexto: e.ubicacionTexto,
      padron: e.padron,
      fechaInicio: fechaDesdeDb(e.fechaInicio),
      cargaHistorica: e.cargaHistorica,
      titulares: e.personas.filter((p) => p.rol === "titular").map(persona),
      solicitantes: e.personas.filter((p) => p.rol === "solicitante").map(persona),
      recorrido,
      emitidaEl: hoy,
    };
  });
}
