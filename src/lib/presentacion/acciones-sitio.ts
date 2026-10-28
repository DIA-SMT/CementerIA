import { z } from "zod";
import type { ServicioSitio } from "@/lib/dominio/sitio";
import type { UsuarioPermisos } from "@/lib/dominio/permisos";
import { leerEntrada, vacioANull } from "./acciones";
import type { ResultadoAdmin } from "./acciones-admin";
import { estadoDeError } from "./errores";

/**
 * La lógica de la Server Action de /admin/sitio-publico (28/10/2026), sin
 * Next, como ./acciones-admin.ts: vuelve a validar la forma de la entrada
 * (cualquiera puede mandar un POST a una Server Action), llama al dominio del
 * sitio (que controla el permiso `editar_sitio_publico` y los datos) y traduce
 * sus errores a un estado serializable. Los tests de integración la llaman con
 * el servicio de la base de prueba (tests/integracion/sitio-publico.test.ts).
 */

const Motivo = z.string().max(2000).nullish();
const Datos = z.record(z.string(), z.unknown());
const Id = z.int().positive();

const EntradaSitio = z.discriminatedUnion("accion", [
  z.object({ accion: z.literal("cementerio"), datos: Datos, motivo: Motivo }),
  z.object({ accion: z.literal("recorrido"), datos: Datos, motivo: Motivo }),
  z.object({ accion: z.literal("fecha"), datos: Datos, motivo: Motivo }),
  z.object({ accion: z.literal("quitar_fecha"), id: Id, motivo: Motivo }),
  z.object({ accion: z.literal("novedad"), datos: Datos, motivo: Motivo }),
  z.object({ accion: z.literal("quitar_novedad"), id: Id, motivo: Motivo }),
  z.object({ accion: z.literal("contacto"), datos: Datos, motivo: Motivo }),
  z.object({ accion: z.literal("pregunta"), datos: Datos, motivo: Motivo }),
]);
export type EntradaSitioAdmin = z.input<typeof EntradaSitio>;

const SIN_CAMBIOS = "No había cambios para guardar.";

export async function procesarSitio(servicio: ServicioSitio, usuario: UsuarioPermisos, valor: unknown): Promise<ResultadoAdmin> {
  try {
    const d = leerEntrada(EntradaSitio, valor);
    const motivo = vacioANull(d.motivo);
    switch (d.accion) {
      case "cementerio": {
        const r = await servicio.guardarCementerio(usuario, d.datos, motivo);
        return { ok: true, repetido: r.repetido, mensaje: r.repetido ? SIN_CAMBIOS : "Datos del cementerio guardados: ya se ven en la página pública." };
      }
      case "recorrido": {
        const r = await servicio.guardarRecorrido(usuario, d.datos, motivo);
        return { ok: true, repetido: r.repetido, mensaje: r.repetido ? SIN_CAMBIOS : r.creado ? "Recorrido dado de alta." : "Recorrido guardado." };
      }
      case "fecha":
        await servicio.agregarFecha(usuario, d.datos, motivo);
        return { ok: true, repetido: false, mensaje: "Fecha agregada." };
      case "quitar_fecha": {
        const r = await servicio.quitarFecha(usuario, d.id, motivo);
        return { ok: true, repetido: r.repetido, mensaje: r.repetido ? "Esa fecha ya no estaba." : "Fecha quitada." };
      }
      case "novedad": {
        const r = await servicio.guardarNovedad(usuario, d.datos, motivo);
        return { ok: true, repetido: r.repetido, mensaje: r.repetido ? SIN_CAMBIOS : r.creado ? "Novedad publicada (se ve en las fechas que elegiste)." : "Novedad guardada." };
      }
      case "quitar_novedad": {
        const r = await servicio.quitarNovedad(usuario, d.id, motivo);
        return { ok: true, repetido: r.repetido, mensaje: r.repetido ? "Esa novedad ya no estaba." : "Novedad quitada." };
      }
      case "contacto": {
        const r = await servicio.guardarContacto(usuario, d.datos, motivo);
        return { ok: true, repetido: r.repetido, mensaje: r.repetido ? SIN_CAMBIOS : "Contacto guardado: ya se ve en la página pública." };
      }
      case "pregunta": {
        const r = await servicio.guardarPregunta(usuario, d.datos, motivo);
        return { ok: true, repetido: r.repetido, mensaje: r.repetido ? SIN_CAMBIOS : r.creado ? "Pregunta agregada." : "Pregunta guardada." };
      }
    }
  } catch (e) {
    return estadoDeError(e);
  }
}
