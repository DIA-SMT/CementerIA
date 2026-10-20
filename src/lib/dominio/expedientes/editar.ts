import { isDeepStrictEqual } from "node:util";
import type { Prisma } from "@/generated/prisma/client";
import type { Transaccion } from "@/lib/db/crear-cliente";
import { diaEnTucuman, fechaDesdeDb, fechaParaDb, hoyEnTucuman, type FechaISO } from "@/lib/fechas";
import { armarBusqueda } from "../busqueda";
import { exigirPermiso, type UsuarioPermisos } from "../permisos";
import { exigirNumero, permisosDelExpediente } from "./acceso";
import { extrasBuscables, filaPersona, validarComando } from "./alta";
import { cargarCementerio, cargarContexto, cargarPlantilla } from "./contexto";
import type { DependenciasExpedientes } from "./dependencias";
import { buscarDuplicados, type AvisoDuplicado } from "./duplicados";
import { ErrorDominio, MENSAJE_CONFLICTO_VERSION, exigirMotivo, limpiarMotivo, noEncontrado } from "./errores";
import { construirEsquemaEdicion, validarCon, type PersonaValidada, type ValorCampoExtra } from "./esquemas";
import { claveDeUbicacion, textoDeUbicacion, type Ubicacion } from "./ubicacion";

/**
 * Edición de datos de un expediente (docs/propuesta-mvp.md, 2.7, 2.13(b) y 3.2).
 *
 * Inserta UN movimiento `edicion` con el antes y el después de cada campo del
 * expediente (`datos.cambios`) y, para las personas, solo ids (2.8):
 * `datos.personas.baja` (quitadas) y `datos.personas.reemplazadas` (versiones
 * viejas). Las altas y las versiones nuevas se obtienen por `creada_mov_id` y
 * `reemplazada_por_id`.
 *
 * Personas versionadas: una persona no se modifica. Se da de baja la versión
 * vieja (`vigente = false`), se inserta la nueva (vigente, con el mismo
 * `orden`) y recién después se enlaza `reemplazada_por_id`. Ese orden lo
 * exigen el índice único de vigentes por (rol, orden) y el de un solo
 * contacto vigente, y el trigger `expediente_personas_proteger` (la nueva
 * tiene que tener id mayor que la vieja). Las personas suprimidas (Ley 25.326)
 * no se editan ni se dan de baja desde acá.
 *
 * Permisos (3.2), según QUÉ cambia:
 * - identificatorios (personas: nombre, DNI, fallecimiento, vínculo, altas y
 *   bajas; ubicación, tipo de monumento, padrón, N° municipal, fecha de
 *   inicio): Mesa de Entradas, Cómputo si es la responsable, y admin. Después
 *   del primer pase exigen motivo.
 * - contacto (teléfono, WhatsApp, correo, domicilio, quién es el contacto) y
 *   observaciones: Mesa de Entradas, el área responsable y admin.
 * - campos extra: Mesa de Entradas, el área responsable y admin.
 *
 * No se edita un expediente archivado ni anulado (3.1). El bloqueo optimista
 * compara `version` con la que vio el usuario. La idempotencia va primero: si
 * el `comando_id` ya hizo una edición en este expediente, se devuelve eso.
 *
 * La forma de pago y el cementerio no se editan: cambian el recorrido; para
 * eso está "Reiniciar con otra plantilla" (semana 4).
 */

export interface ResultadoEdicion {
  numero: string;
  /** La versión nueva, para la próxima acción. */
  version: number;
  /** El `comando_id` ya se había usado en este expediente: no se cambió nada. */
  repetido: boolean;
  movimientoId: string;
  /** Qué cambió: `padron`, `ubicacion`, `datos_extra.concesion_hasta`, `personas`… */
  campos: string[];
  /** Si cambió la ubicación, el padrón o el N° municipal: otros expedientes que coinciden. */
  avisos: AvisoDuplicado[];
}

/** Campos de persona que son datos identificatorios (3.2). */
const PERSONA_IDENTIFICATORIOS = ["apellido", "nombres", "dni", "fallecido", "fechaDefuncion", "vinculo"] as const;
/** Campos de persona que son de contacto (decisión 13). */
const PERSONA_CONTACTO = ["telefono", "telefonoWhatsapp", "email", "domicilio", "esContacto"] as const;

const IDENTIFICATORIOS_EXPEDIENTE = new Set(["tipo_monumento", "ubicacion", "padron", "numero_municipal", "fecha_inicio"]);

type FilaPersonaDb = Awaited<ReturnType<Transaccion["expedientePersona"]["findMany"]>>[number];

function personaDeDb(p: FilaPersonaDb): Omit<PersonaValidada, "orden" | "id"> {
  return {
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
  };
}

interface PlanPersonas {
  /** Vigentes que se dan de baja sin reemplazo. */
  bajas: bigint[];
  /** Vigentes que se reemplazan por una versión nueva. */
  reemplazos: Array<{ vieja: FilaPersonaDb; nueva: PersonaValidada }>;
  /** Personas que no estaban. */
  nuevas: PersonaValidada[];
  identificatorio: boolean;
  contacto: boolean;
}

function planificarPersonas(vigentes: FilaPersonaDb[], entrada: PersonaValidada[]): PlanPersonas {
  const porId = new Map(vigentes.map((p) => [p.id.toString(), p]));
  const plan: PlanPersonas = { bajas: [], reemplazos: [], nuevas: [], identificatorio: false, contacto: false };
  const vistas = new Set<string>();

  entrada.forEach((p, i) => {
    if (p.id === null) {
      plan.nuevas.push(p);
      plan.identificatorio = true;
      return;
    }
    const vieja = porId.get(p.id);
    if (!vieja) {
      throw new ErrorDominio("conflicto_version", MENSAJE_CONFLICTO_VERSION, [
        { ruta: `personas[${i}].id`, mensaje: "Esta persona ya no está vigente" },
      ]);
    }
    if (vieja.suprimidaEn !== null) {
      throw new ErrorDominio("validacion", "Una persona suprimida no se edita", [
        { ruta: `personas[${i}]`, mensaje: "Sus datos fueron suprimidos: agregala como persona nueva si corresponde" },
      ]);
    }
    if (vieja.rol !== p.rol) {
      throw new ErrorDominio("validacion", "No se cambia el rol de una persona", [
        { ruta: `personas[${i}].rol`, mensaje: "Para cambiar el rol, quitala y agregala de nuevo con el rol correcto" },
      ]);
    }
    vistas.add(p.id);
    const antes = personaDeDb(vieja);
    const cambiaIdentificatorio = PERSONA_IDENTIFICATORIOS.some((c) => antes[c] !== p[c]);
    const cambiaContacto = PERSONA_CONTACTO.some((c) => antes[c] !== p[c]);
    if (cambiaIdentificatorio || cambiaContacto) {
      plan.reemplazos.push({ vieja, nueva: p });
      plan.identificatorio ||= cambiaIdentificatorio;
      plan.contacto ||= cambiaContacto;
    }
  });

  for (const p of vigentes) {
    // Las suprimidas quedan como constancia: la lista del formulario no las trae.
    if (!vistas.has(p.id.toString()) && p.suprimidaEn === null) {
      plan.bajas.push(p.id);
      plan.identificatorio = true;
    }
  }
  return plan;
}

function hayCambiosDePersonas(plan: PlanPersonas): boolean {
  return plan.bajas.length > 0 || plan.reemplazos.length > 0 || plan.nuevas.length > 0;
}

/**
 * Edita un expediente. Ver el comentario del módulo.
 *
 * @param numero número interno (`CEM-2026-00042`; también acepta `42/2026`).
 * @param cambios lo que manda el formulario (`CambiosEdicion`); se valida acá.
 * @param versionVista la `version` del expediente que el usuario tenía en pantalla.
 * @param motivo obligatorio (10 caracteres o más) si cambia un dato identificatorio después del primer pase.
 * @throws PermisoDenegado
 * @throws ErrorDominio `no_encontrado`, `estado_no_admite`, `conflicto_version`, `validacion`, `motivo_requerido`, `sin_cambios`
 */
export async function editar(
  deps: DependenciasExpedientes,
  usuario: UsuarioPermisos,
  numero: string,
  cambios: unknown,
  versionVista: number,
  motivo: string | null,
  comandoId: string,
): Promise<ResultadoEdicion> {
  const comando = validarComando(comandoId);
  const numeroInterno = exigirNumero(numero);
  const motivoLimpio = limpiarMotivo(motivo);
  const ahora = deps.ahora?.() ?? new Date();
  const hoy = hoyEnTucuman(ahora);

  return deps.escribir(usuario.id, motivoLimpio, async (tx) => {
    // FOR UPDATE antes que nada: serializa con cualquier otra acción sobre el
    // expediente, y la idempotencia y la versión se miran con el lock tomado.
    const bloqueado = await tx.$queryRaw<Array<{ id: bigint }>>`
      SELECT id FROM public.expedientes WHERE numero_interno = ${numeroInterno} FOR UPDATE`;
    const id = bloqueado[0]?.id;
    if (id === undefined) throw noEncontrado(numeroInterno);

    const previo = await tx.movimiento.findUnique({
      where: { expedienteId_comandoId_tipo: { expedienteId: id, comandoId: comando, tipo: "edicion" } },
      select: { id: true },
    });
    const exp = await tx.expediente.findUniqueOrThrow({ where: { id } });
    if (previo) {
      return { numero: numeroInterno, version: exp.version, repetido: true, movimientoId: previo.id.toString(), campos: [], avisos: [] };
    }

    if (exp.estado === "archivado" || exp.estado === "anulado") {
      throw new ErrorDominio("estado_no_admite", `El expediente está ${exp.estado}: no se editan sus datos`);
    }
    if (exp.version !== versionVista) throw new ErrorDominio("conflicto_version", MENSAJE_CONFLICTO_VERSION);

    const plantilla = await cargarPlantilla(tx, exp.plantillaId);
    const cementerio = await cargarCementerio(tx, exp.cementerioId);
    if (!plantilla || !cementerio) throw new ErrorDominio("configuracion_incompleta", "Falta la plantilla o el cementerio del expediente");
    const contexto = await cargarContexto(tx, plantilla, cementerio, hoy);
    const ubicacionAnterior = exp.ubicacion as Ubicacion;
    const v = validarCon(
      construirEsquemaEdicion({
        ...contexto.esquema,
        // El tipo que ya tiene sigue valiendo aunque después se haya deshabilitado en el cementerio.
        tiposMonumento: [...new Set([...contexto.esquema.tiposMonumento, exp.tipoMonumento])],
        ubicacionAnterior,
        cargaHistorica: exp.cargaHistorica,
      }),
      cambios,
    );
    const def = plantilla.definicion;

    // --- Qué cambia en el expediente ----------------------------------------
    const diferencias: Record<string, [unknown, unknown]> = {};
    const anotar = (campo: string, antes: unknown, despues: unknown): void => {
      if (!isDeepStrictEqual(antes, despues)) diferencias[campo] = [antes, despues];
    };
    const fechaInicioAntes = fechaDesdeDb(exp.fechaInicio);
    if (v.tipoMonumento !== undefined) anotar("tipo_monumento", exp.tipoMonumento, v.tipoMonumento);
    if (v.ubicacion !== undefined) anotar("ubicacion", ubicacionAnterior, v.ubicacion);
    if (v.padron !== undefined) anotar("padron", exp.padron, v.padron);
    if (v.numeroMunicipal !== undefined) anotar("numero_municipal", exp.numeroMunicipal, v.numeroMunicipal);
    if (v.fechaInicio !== undefined) anotar("fecha_inicio", fechaInicioAntes, v.fechaInicio);
    if (v.observaciones !== undefined) anotar("observaciones", exp.observaciones, v.observaciones);
    const extrasAntes = exp.datosExtra as Record<string, ValorCampoExtra>;
    const extrasDespues: Record<string, ValorCampoExtra> = { ...extrasAntes };
    for (const [clave, valor] of Object.entries(v.datosExtra ?? {})) {
      anotar(`datos_extra.${clave}`, extrasAntes[clave] ?? null, valor);
      if (valor === null) delete extrasDespues[clave];
      else extrasDespues[clave] = valor;
    }

    // --- Qué cambia en las personas -----------------------------------------
    const vigentes = await tx.expedientePersona.findMany({
      where: { expedienteId: id, vigente: true },
      orderBy: [{ rol: "asc" }, { orden: "asc" }],
    });
    const plan = v.personas ? planificarPersonas(vigentes, v.personas) : null;
    const cambianPersonas = plan !== null && hayCambiosDePersonas(plan);

    const campos = Object.keys(diferencias);
    if (cambianPersonas) campos.push("personas");
    if (campos.length === 0) throw new ErrorDominio("sin_cambios", "No hay cambios para guardar");

    // --- Permisos -----------------------------------------------------------
    const permisos = await permisosDelExpediente(tx, exp);
    const identificatorio = campos.some((c) => IDENTIFICATORIOS_EXPEDIENTE.has(c)) || (plan?.identificatorio ?? false);
    const contacto = "observaciones" in diferencias || (plan?.contacto ?? false);
    const extras = campos.some((c) => c.startsWith("datos_extra."));
    let motivoFinal: string | null = motivoLimpio;
    if (identificatorio) {
      const { requiereMotivo } = exigirPermiso("editar_identificatorios", permisos, usuario);
      if (requiereMotivo) motivoFinal = exigirMotivo(motivo, "Cambiar datos identificatorios después del primer pase");
    }
    if (contacto) exigirPermiso("editar_contacto", permisos, usuario);
    if (extras) exigirPermiso("completar_campos_extra", permisos, usuario);

    // La fecha de inicio no puede quedar después de que el papel ya se movió.
    if (v.fechaInicio !== undefined && "fecha_inicio" in diferencias) {
      const primerMovimiento = await tx.movimiento.findFirst({
        where: { expedienteId: id, tipo: { in: ["recepcion", "pase", "devolucion", "estado"] } },
        orderBy: { fechaEfectiva: "asc" },
        select: { fechaEfectiva: true },
      });
      const limite: FechaISO | null = primerMovimiento ? diaEnTucuman(primerMovimiento.fechaEfectiva) : null;
      if (limite !== null && v.fechaInicio > limite) {
        throw new ErrorDominio("validacion", "Revisá los datos marcados", [
          { ruta: "fechaInicio", mensaje: `Fecha de inicio: no puede ser posterior al primer pase (${limite})` },
        ]);
      }
    }

    // --- Escritura ------------------------------------------------------------
    const movimiento = await tx.movimiento.create({
      data: {
        expedienteId: id,
        tipo: "edicion",
        fechaEfectiva: ahora,
        precisionFecha: "minuto",
        usuarioId: usuario.id,
        motivo: motivoFinal,
        datos: {
          cambios: diferencias as Prisma.InputJsonObject,
          personas: {
            baja: (plan?.bajas ?? []).map(Number),
            reemplazadas: (plan?.reemplazos ?? []).map((r) => Number(r.vieja.id)),
          },
        },
        comandoId: comando,
      },
      select: { id: true },
    });

    if (plan && cambianPersonas) {
      // 1. Baja de todo lo que se va o se reemplaza: libera los lugares de los
      //    índices únicos (rol, orden) y de contacto.
      const salen = [...plan.bajas, ...plan.reemplazos.map((r) => r.vieja.id)];
      if (salen.length > 0) {
        await tx.expedientePersona.updateMany({ where: { id: { in: salen } }, data: { vigente: false } });
      }
      // 2. Las versiones nuevas (mismo orden que la vieja) y las personas nuevas
      //    (el siguiente orden libre de su rol).
      const ordenMaximo = new Map<string, number>();
      for (const p of vigentes) ordenMaximo.set(p.rol, Math.max(ordenMaximo.get(p.rol) ?? 0, p.orden));
      for (const r of plan.reemplazos) {
        const nueva = await tx.expedientePersona.create({ data: filaPersona(r.nueva, id, movimiento.id, r.vieja.orden), select: { id: true } });
        // 3. Recién ahora el enlace: el trigger exige que la nueva ya exista.
        await tx.expedientePersona.update({ where: { id: r.vieja.id }, data: { reemplazadaPorId: nueva.id } });
      }
      for (const p of plan.nuevas) {
        const orden = (ordenMaximo.get(p.rol) ?? 0) + 1;
        ordenMaximo.set(p.rol, orden);
        await tx.expedientePersona.create({ data: filaPersona(p, id, movimiento.id, orden) });
      }
    }

    const ubicacion = v.ubicacion ?? ubicacionAnterior;
    const ubicacionTexto = "ubicacion" in diferencias ? textoDeUbicacion(cementerio.camposUbicacion, ubicacion) : exp.ubicacionTexto;
    const padron = v.padron !== undefined ? v.padron : exp.padron;
    const numeroMunicipal = v.numeroMunicipal !== undefined ? v.numeroMunicipal : exp.numeroMunicipal;
    const personasVigentes = await tx.expedientePersona.findMany({
      where: { expedienteId: id, vigente: true, suprimidaEn: null },
      select: { apellido: true, nombres: true, dni: true },
      orderBy: [{ rol: "asc" }, { orden: "asc" }],
    });
    const cementerios = await tx.cementerio.findMany({ select: { codigo: true, nombre: true } });
    const busqueda = armarBusqueda({
      anio: exp.anio,
      secuencia: exp.secuencia,
      numeroMunicipal,
      padron,
      cementerio: cementerio.nombre,
      ubicacionTexto,
      personas: personasVigentes,
      extrasBuscables: extrasBuscables(def, extrasDespues, new Map(cementerios.map((c) => [c.codigo, c.nombre]))),
    });

    const actualizado = await tx.expediente.update({
      where: { id },
      data: {
        tipoMonumento: v.tipoMonumento ?? exp.tipoMonumento,
        // La clave de ubicación la arma el trigger cuando cambia `ubicacion`.
        ubicacion,
        ubicacionTexto,
        padron,
        numeroMunicipal,
        fechaInicio: fechaParaDb(v.fechaInicio ?? fechaInicioAntes),
        observaciones: v.observaciones !== undefined ? v.observaciones : exp.observaciones,
        datosExtra: extrasDespues,
        busqueda,
        version: { increment: 1 },
      },
      select: { version: true },
    });

    const tocaDuplicados = ["ubicacion", "padron", "numero_municipal"].some((c) => c in diferencias);
    const avisos = tocaDuplicados
      ? await buscarDuplicados(tx, {
          cementerioId: cementerio.id,
          ubicacionClave: claveDeUbicacion(ubicacion),
          padron,
          numeroMunicipal,
          excluirId: id,
        })
      : [];

    return {
      numero: numeroInterno,
      version: actualizado.version,
      repetido: false,
      movimientoId: movimiento.id.toString(),
      campos,
      avisos,
    };
  });
}
