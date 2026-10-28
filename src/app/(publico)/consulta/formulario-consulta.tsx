"use client";

import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { CircleAlert, Search } from "lucide-react";
import { CLASE_BOTON_PRIMARIO } from "@/components/formulario";
import { formatearFecha } from "@/lib/fechas";
import { AVISO_ORIENTATIVO, codigoDelFragmento, textoAvance, textoEstadoCiudadano } from "@/lib/presentacion/consulta-publica";
import { accionConsultar, type EstadoConsulta } from "./acciones";
import type { TramitePublico } from "@/lib/dominio/publico/consulta";

/**
 * Los campos, como CLASE_CONTROL (src/components/formulario.tsx) pero con los
 * tokens del sitio público: sirven en claro y en oscuro.
 */
const CLASE_CAMPO =
  "w-full min-h-10 rounded-control border border-pub-borde-control bg-pub-superficie px-3 py-2 text-sm text-pub-texto shadow-xs " +
  "placeholder:text-pub-texto-secundario transition-colors duration-150 hover:border-pub-texto-secundario " +
  "focus-visible:border-pub-foco focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pub-foco " +
  "aria-invalid:border-pub-error aria-invalid:bg-pub-error-fondo";

/**
 * El formulario de la consulta pública (28/10/2026): número de expediente y
 * código de consulta, y el resultado debajo. Lo usan `/consulta` y
 * `/consulta/[numero]` (el inicio, `/`, solo lleva a `/consulta`).
 *
 * Funciona sin JavaScript (la Server Action recibe el formulario común). Con
 * JavaScript, en `/consulta/[numero]` lee el código del fragmento de la URL
 * (`#K7QM3XZP`, el QR del comprobante), lo completa, lo saca de la barra de
 * direcciones (queda en el formulario, no en el historial ni en una captura) y
 * consulta solo. El fragmento nunca llega al servidor; el código viaja en el
 * cuerpo del POST.
 *
 * `idBase` distingue los ids si hubiera dos formularios en una página.
 * `nivel` es el de los títulos (el del formulario y el del resultado): 2 en
 * `/consulta`, debajo del `h1` de la página; 3 si algún día va dentro de una
 * sección con su `h2`.
 */
export function FormularioConsulta({
  numeroInicial = "",
  leerFragmento = false,
  idBase = "consulta",
  titulo = null,
  nivel = 2,
}: {
  numeroInicial?: string;
  /** /consulta/[numero]: completar el código desde el `#` y consultar. */
  leerFragmento?: boolean;
  idBase?: string;
  /** Un título dentro del formulario, que lo nombra ("Datos del comprobante" en /consulta). */
  titulo?: string | null;
  nivel?: 2 | 3;
}) {
  const [estado, enviar, pendiente] = useActionState<EstadoConsulta, FormData>(accionConsultar, { tipo: "inicial", numero: numeroInicial });
  // Controlados: React vacía los campos no controlados después de una acción, y
  // ante un código mal escrito conviene corregirlo, no reescribirlo.
  const [numero, setNumero] = useState(numeroInicial);
  const [codigo, setCodigo] = useState("");
  const formulario = useRef<HTMLFormElement>(null);
  const resultado = useRef<HTMLDivElement>(null);
  const enviadoDelFragmento = useRef(false);

  useEffect(() => {
    if (!leerFragmento || enviadoDelFragmento.current) return;
    const delFragmento = codigoDelFragmento(window.location.hash);
    if (window.location.hash) {
      // El código no se queda en la barra de direcciones ni en el historial.
      window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
    }
    if (!delFragmento) return;
    enviadoDelFragmento.current = true;
    // En el próximo cuadro (no en el cuerpo del efecto): completa el campo y
    // consulta con lo mismo que mandaría el botón.
    requestAnimationFrame(() => {
      setCodigo(delFragmento);
      const datos = new FormData();
      datos.set("numero", numeroInicial);
      datos.set("codigo", delFragmento);
      startTransition(() => enviar(datos));
    });
  }, [leerFragmento, numeroInicial, enviar]);

  // Con un resultado o un error, el foco va ahí (lo anuncia el lector de pantalla).
  useEffect(() => {
    if (estado.tipo !== "inicial") resultado.current?.focus();
  }, [estado]);

  const hayError = estado.tipo === "error";
  const idError = `${idBase}-error`;

  return (
    <div className="space-y-5">
      <form ref={formulario} action={enviar} className="space-y-4" aria-busy={pendiente} aria-labelledby={titulo ? `${idBase}-titulo` : undefined}>
        {titulo ? (
          <Titulo nivel={nivel} id={`${idBase}-titulo`} className="text-lg font-semibold text-pub-titulo">
            {titulo}
          </Titulo>
        ) : null}
        <div>
          <label htmlFor={`${idBase}-numero`} className="mb-1.5 block text-sm font-medium text-pub-texto">
            Número de expediente
          </label>
          <input
            id={`${idBase}-numero`}
            name="numero"
            type="text"
            inputMode="text"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            required
            maxLength={40}
            placeholder="CEM-2026-00042"
            value={numero}
            onChange={(e) => setNumero(e.target.value)}
            aria-describedby={`${idBase}-numero-ayuda${hayError ? ` ${idError}` : ""}`}
            aria-invalid={hayError ? true : undefined}
            className={`${CLASE_CAMPO} font-mono`}
          />
          <p id={`${idBase}-numero-ayuda`} className="mt-1 text-xs text-pub-texto-secundario">
            Está en tu comprobante. También sirve la forma corta, por ejemplo 42/2026.
          </p>
        </div>
        <div>
          <label htmlFor={`${idBase}-codigo`} className="mb-1.5 block text-sm font-medium text-pub-texto">
            Código de consulta
          </label>
          <input
            id={`${idBase}-codigo`}
            name="codigo"
            type="text"
            inputMode="text"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            required
            maxLength={40}
            placeholder="XXXX-XXXX"
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
            aria-describedby={`${idBase}-codigo-ayuda${hayError ? ` ${idError}` : ""}`}
            aria-invalid={hayError ? true : undefined}
            className={`${CLASE_CAMPO} font-mono uppercase tracking-wider`}
          />
          <p id={`${idBase}-codigo-ayuda`} className="mt-1 text-xs text-pub-texto-secundario">
            Las 8 letras y números del comprobante, con o sin guion.
          </p>
        </div>
        <button type="submit" disabled={pendiente} className={`${CLASE_BOTON_PRIMARIO} min-h-11 w-full text-[0.9375rem]`}>
          <Search className="h-4 w-4" aria-hidden="true" />
          {pendiente ? "Consultando…" : "Consultar"}
        </button>
      </form>

      <div ref={resultado} tabIndex={-1} aria-live="polite" className="rounded-control focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pub-foco">
        {estado.tipo === "error" ? (
          <p id={idError} role="alert" className="flex gap-2 rounded-control border border-pub-error-borde bg-pub-error-fondo px-3 py-2.5 text-sm text-pub-error">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{estado.mensaje}</span>
          </p>
        ) : null}
        {estado.tipo === "ok" ? <ResultadoTramite tramite={estado.tramite} idBase={idBase} nivel={nivel} /> : null}
      </div>
    </div>
  );
}

/** El resultado: solo lo de `TramitePublico`, con el estado en lenguaje del ciudadano. */
function ResultadoTramite({ tramite: t, idBase, nivel }: { tramite: TramitePublico; idBase: string; nivel: 2 | 3 }) {
  return (
    <section aria-labelledby={`${idBase}-resultado`} data-resultado-consulta="" className="rounded-tarjeta border border-pub-info-borde bg-pub-chip p-4 text-sm">
      <Titulo nivel={nivel} id={`${idBase}-resultado`} className="text-base font-semibold text-pub-titulo">
        Trámite <span className="font-mono">{t.numero}</span>
      </Titulo>
      <p className="mt-1 text-lg font-semibold text-pub-texto" data-estado-ciudadano="">
        {textoEstadoCiudadano(t.estado)}
      </p>
      <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
        <Dato titulo="Trámite">{t.tipoTramite}</Dato>
        <Dato titulo="Cementerio">{t.cementerio}</Dato>
        <Dato titulo="Fecha de inicio" mono>
          {formatearFecha(t.fechaInicio)}
        </Dato>
        <Dato titulo="Dónde está">
          {t.area.nombre}
          <span className="block text-xs text-pub-texto-secundario">
            desde el <span className="font-mono">{formatearFecha(t.area.desde)}</span>
          </span>
        </Dato>
        <Dato titulo="Avance">{textoAvance(t.paso)}</Dato>
        <Dato titulo="Último movimiento" mono>
          {formatearFecha(t.ultimoMovimiento)}
        </Dato>
      </dl>
      <p className="mt-3 border-t border-pub-info-borde pt-2 text-xs text-pub-texto-secundario">{AVISO_ORIENTATIVO}</p>
    </section>
  );
}

function Titulo({ nivel, ...props }: { nivel: 2 | 3; id: string; className: string; children: React.ReactNode }) {
  return nivel === 3 ? <h3 {...props} /> : <h2 {...props} />;
}

/** Un dato del resultado; las fechas, en monoespaciada (`mono`). */
function Dato({ titulo, mono = false, children }: { titulo: string; mono?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-pub-texto-secundario">{titulo}</dt>
      <dd className={`font-medium text-pub-texto ${mono ? "font-mono tabular-nums" : ""}`}>{children}</dd>
    </div>
  );
}
