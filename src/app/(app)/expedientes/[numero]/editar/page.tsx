import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { randomUUID } from "node:crypto";
import { Aviso } from "@/components/aviso";
import { EncabezadoPagina } from "@/components/encabezado-pagina";
import { CLASE_BOTON_SECUNDARIO } from "@/components/formulario";
import { ipDeSolicitud } from "@/lib/auth/red";
import { exigirPantalla } from "@/lib/auth/sesion";
import { ErrorDominio, expedientes, type FormularioEdicion } from "@/lib/dominio/expedientes/servidor";
import { PermisoDenegado, type Decision } from "@/lib/dominio/permisos";
import { rutaFicha } from "@/lib/presentacion/enlaces";
import { valoresDesdeEdicion } from "@/lib/presentacion/formulario";
import { TEXTO_DENEGACION } from "@/lib/presentacion/textos";
import { FormularioExpediente } from "../../_formulario/formulario-expediente";

export async function generateMetadata(props: PageProps<"/expedientes/[numero]/editar">): Promise<Metadata> {
  const { numero } = await props.params;
  return { title: `Editar ${numero.toUpperCase()}` };
}

function aviso(parte: string, d: Decision): string | null {
  return d.permitido ? null : `${parte}: no los podés cambiar. ${TEXTO_DENEGACION[d.motivo]}`;
}

/**
 * Edición (sección 5, `/expedientes/[numero]/editar`): el formulario del alta
 * con los valores actuales (`formularioEdicion`). Lo que el usuario no puede
 * editar queda deshabilitado (3.2); si no puede editar nada, vuelve a la
 * ficha. `versionVista` viaja con el envío para el bloqueo optimista.
 */
export default async function PaginaEditar(props: PageProps<"/expedientes/[numero]/editar">) {
  const usuario = await exigirPantalla("expedientes");
  const { numero } = await props.params;

  let form: FormularioEdicion;
  try {
    form = await expedientes.formularioEdicion(usuario, numero, { ip: ipDeSolicitud(await headers()) });
  } catch (e) {
    if (e instanceof PermisoDenegado) redirect(rutaFicha(numero));
    if (e instanceof ErrorDominio && e.codigo === "no_encontrado") notFound();
    if (e instanceof ErrorDominio && e.codigo === "estado_no_admite") {
      return (
        <section aria-labelledby="titulo-pantalla" className="space-y-4">
          <EncabezadoPagina titulo={`Editar ${numero.toUpperCase()}`} volver={{ href: rutaFicha(numero), texto: "Volver a la ficha" }} />
          <Aviso tono="advertencia" role="alert">
            <p>{e.message}.</p>
          </Aviso>
          <Link href={rutaFicha(numero)} prefetch={false} className={CLASE_BOTON_SECUNDARIO}>
            Volver a la ficha
          </Link>
        </section>
      );
    }
    throw e;
  }

  const { contexto, acciones } = form;
  const avisos = [
    aviso("Datos identificatorios (personas, DNI, ubicación, padrón, N° municipal, fecha de inicio)", acciones.editarIdentificatorios),
    aviso("Contacto y observaciones", acciones.editarContacto),
    aviso("Datos del trámite", acciones.completarCamposExtra),
  ].filter((a): a is string => a !== null);
  // Los tipos de monumento que admite el esquema de edición (incluye el actual aunque ya no esté habilitado).
  const tiposMonumento = [
    ...contexto.tiposMonumento,
    ...form.esquema.tiposMonumento
      .filter((codigo) => !contexto.tiposMonumento.some((t) => t.codigo === codigo))
      .map((codigo) => ({ codigo, nombre: `${codigo} (ya no habilitado)` })),
  ];

  return (
    <section aria-labelledby="titulo-pantalla" className="space-y-5">
      <EncabezadoPagina
        titulo={
          <>
            Editar <span className="font-mono">{form.numero}</span>
          </>
        }
        antetitulo="Expedientes"
        volver={{ href: rutaFicha(form.numero), texto: "Volver a la ficha" }}
        descripcion="Cambiá lo que haga falta y guardá. Los campos con * son obligatorios."
      />
      <FormularioExpediente
        modo="edicion"
        numero={form.numero}
        version={form.version}
        comandoId={randomUUID()}
        definicion={contexto.definicion}
        esquema={form.esquema}
        camposUbicacion={contexto.camposUbicacion}
        tiposMonumento={tiposMonumento}
        cementerios={contexto.cementerios}
        hoy={contexto.hoy}
        plantilla={{
          id: contexto.plantilla.id,
          nombre: contexto.plantilla.nombre,
          version: contexto.plantilla.version,
          tipoTramite: contexto.plantilla.tipoTramite.nombre,
        }}
        cementerio={{ id: contexto.cementerio.id, nombre: contexto.cementerio.nombre }}
        valoresIniciales={valoresDesdeEdicion(form.valores)}
        permisos={{
          identificatorios: acciones.editarIdentificatorios.permitido,
          contacto: acciones.editarContacto.permitido,
          extras: acciones.completarCamposExtra.permitido,
        }}
        requiereMotivo={acciones.editarIdentificatorios.permitido && acciones.editarIdentificatorios.requiereMotivo}
        avisosPermiso={avisos}
      />
    </section>
  );
}
