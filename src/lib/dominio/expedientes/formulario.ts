import { fechaDesdeDb, hoyEnTucuman } from "@/lib/fechas";
import { evaluarPermiso, exigirPermiso, PermisoDenegado, type Decision, type UsuarioPermisos } from "../permisos";
import { exigirNumero, permisosDelExpediente, registrarAcceso, type OpcionesAcceso } from "./acceso";
import { cargarCementerio, cargarContexto, cargarPlantilla, type ContextoFormulario } from "./contexto";
import type { DependenciasExpedientes } from "./dependencias";
import { ErrorDominio, errorValidacion, noEncontrado } from "./errores";
import type { CambiosEdicion, ContextoEdicion, PersonaEntrada, ValorCampoExtra } from "./esquemas";
import type { Ubicacion } from "./ubicacion";

/**
 * Lo que necesitan los formularios de alta y de edición para armarse: la
 * plantilla, el cementerio con sus campos de ubicación, los tipos de monumento
 * admitidos y, en la edición, los valores actuales. Con `contexto.esquema` la
 * pantalla arma el mismo esquema zod que usa el servidor
 * (`construirEsquemaAlta` / `construirEsquemaEdicion`).
 */

/**
 * Contexto del alta para una plantilla y un cementerio. Si
 * `contexto.problemas` no está vacío, el formulario lo muestra en lugar de
 * las listas vacías ("Falta configurar el cementerio…").
 *
 * @throws PermisoDenegado (no es Mesa de Entradas ni admin)
 * @throws ErrorDominio `validacion` (no existe), `plantilla_no_publicada`
 */
export async function contextoAlta(
  deps: DependenciasExpedientes,
  usuario: UsuarioPermisos,
  plantillaId: number,
  cementerioId: number,
): Promise<ContextoFormulario> {
  exigirPermiso("alta", null, usuario);
  const plantilla = await cargarPlantilla(deps.leer, plantillaId);
  if (!plantilla) throw errorValidacion([{ ruta: "plantillaId", mensaje: "No existe ese trámite" }]);
  if (plantilla.estado !== "publicada") {
    throw new ErrorDominio("plantilla_no_publicada", `La plantilla ${plantilla.codigo} v${plantilla.version} no está publicada`);
  }
  const cementerio = await cargarCementerio(deps.leer, cementerioId);
  if (!cementerio || !cementerio.activo) throw errorValidacion([{ ruta: "cementerioId", mensaje: "Elegí un cementerio activo" }]);
  return cargarContexto(deps.leer, plantilla, cementerio, hoyEnTucuman(deps.ahora?.() ?? new Date()));
}

export interface FormularioEdicion {
  numero: string;
  /** Va de vuelta en `editar(…, versionVista, …)`. */
  version: number;
  contexto: ContextoFormulario;
  /** Para `construirEsquemaEdicion()`. */
  esquema: ContextoEdicion;
  /** Los valores actuales, con la forma de `CambiosEdicion` (personas vigentes con su `id`). */
  valores: Required<Omit<CambiosEdicion, "personas" | "ubicacion" | "datosExtra">> & {
    ubicacion: Ubicacion;
    datosExtra: Record<string, ValorCampoExtra>;
    personas: PersonaEntrada[];
  };
  /** Las personas suprimidas: no se editan y no van en `personas`. */
  personasSuprimidas: Array<{ id: string; rol: string; orden: number }>;
  /** Qué partes puede editar el usuario (deshabilitar lo demás). */
  acciones: {
    editarIdentificatorios: Decision;
    editarContacto: Decision;
    completarCamposExtra: Decision;
  };
}

/**
 * Contexto y valores actuales para el formulario de edición. Trae el contacto
 * completo: solo lo piden quienes pueden editar algo, y todos ellos trabajan el
 * expediente. Igual queda registrado como `ver_expediente` (detalle `editar`).
 *
 * @throws PermisoDenegado si el usuario no puede editar nada del expediente.
 * @throws ErrorDominio `no_encontrado`, `estado_no_admite`
 */
export async function formularioEdicion(
  deps: DependenciasExpedientes,
  usuario: UsuarioPermisos,
  numero: string,
  opciones: OpcionesAcceso = {},
): Promise<FormularioEdicion> {
  exigirPermiso("ver_expediente", null, usuario);
  const numeroInterno = exigirNumero(numero);
  const hoy = hoyEnTucuman(deps.ahora?.() ?? new Date());

  return deps.escribir(usuario.id, null, async (tx) => {
    const e = await tx.expediente.findUnique({ where: { numeroInterno } });
    if (!e) throw noEncontrado(numeroInterno);
    if (e.estado === "archivado" || e.estado === "anulado") {
      throw new ErrorDominio("estado_no_admite", `El expediente está ${e.estado}: no se editan sus datos`);
    }
    const permisos = await permisosDelExpediente(tx, e);
    const acciones = {
      editarIdentificatorios: evaluarPermiso("editar_identificatorios", permisos, usuario),
      editarContacto: evaluarPermiso("editar_contacto", permisos, usuario),
      completarCamposExtra: evaluarPermiso("completar_campos_extra", permisos, usuario),
    };
    const alguna = Object.values(acciones).find((d) => d.permitido);
    if (!alguna) {
      const d = acciones.editarIdentificatorios;
      throw new PermisoDenegado("editar_identificatorios", d.permitido ? "no_es_responsable" : d.motivo);
    }

    const plantilla = await cargarPlantilla(tx, e.plantillaId);
    const cementerio = await cargarCementerio(tx, e.cementerioId);
    if (!plantilla || !cementerio) throw new ErrorDominio("configuracion_incompleta", "Falta la plantilla o el cementerio del expediente");
    const contexto = await cargarContexto(tx, plantilla, cementerio, hoy);
    const ubicacion = e.ubicacion as Ubicacion;
    const personas = await tx.expedientePersona.findMany({
      where: { expedienteId: e.id, vigente: true },
      orderBy: [{ rol: "asc" }, { orden: "asc" }],
    });
    const ordenRol = new Map(plantilla.definicion.personas.map((r, i) => [r.rol, i]));
    personas.sort((a, b) => (ordenRol.get(a.rol) ?? 99) - (ordenRol.get(b.rol) ?? 99) || a.orden - b.orden);

    await registrarAcceso(tx, {
      usuarioId: usuario.id,
      accion: "ver_expediente",
      expedienteId: e.id,
      detalle: { para: "editar" },
      ip: opciones.ip,
    });

    return {
      numero: e.numeroInterno,
      version: e.version,
      contexto,
      esquema: {
        ...contexto.esquema,
        tiposMonumento: [...new Set([...contexto.esquema.tiposMonumento, e.tipoMonumento])],
        ubicacionAnterior: ubicacion,
        cargaHistorica: e.cargaHistorica,
      },
      valores: {
        tipoMonumento: e.tipoMonumento,
        ubicacion,
        padron: e.padron,
        numeroMunicipal: e.numeroMunicipal,
        fechaInicio: fechaDesdeDb(e.fechaInicio),
        observaciones: e.observaciones,
        datosExtra: e.datosExtra as Record<string, ValorCampoExtra>,
        personas: personas
          .filter((p) => p.suprimidaEn === null)
          .map((p) => ({
            id: p.id.toString(),
            rol: p.rol,
            apellido: p.apellido ?? "",
            nombres: p.nombres ?? "",
            dni: p.dni,
            fallecido: p.fallecido,
            fechaDefuncion: fechaDesdeDb(p.fechaDefuncion),
            vinculo: p.vinculo,
            telefono: p.telefono,
            telefonoWhatsapp: p.telefonoWhatsapp,
            email: p.email,
            domicilio: p.domicilio,
            esContacto: p.esContacto,
          })),
      },
      personasSuprimidas: personas
        .filter((p) => p.suprimidaEn !== null)
        .map((p) => ({ id: p.id.toString(), rol: p.rol, orden: p.orden })),
      acciones,
    };
  });
}
