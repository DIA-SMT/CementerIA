"use client";

import { useState } from "react";
import { Copy, KeyRound, LockOpen, UserCheck, UserCog, UserPlus, UserX } from "lucide-react";
import { Aviso } from "@/components/aviso";
import { AvisoError } from "@/components/aviso-error";
import { Dialogo } from "@/components/dialogo";
import { atributosCampo, Campo, CLASE_BOTON_COMPACTO, CLASE_BOTON_COMPACTO_PELIGRO, CLASE_BOTON_PRIMARIO, CLASE_BOTON_SECUNDARIO, CLASE_CONTROL } from "@/components/formulario";
import { cuilValido } from "@/lib/dominio/cuil";
import { ROLES, type Rol } from "@/lib/dominio/permisos";
import type { EstadoError } from "@/lib/presentacion/errores";
import { accionUsuario } from "../acciones";
import { AvisoHecho, DialogoConfirmar, erroresDe, useAccion } from "../piezas";

/**
 * Los diálogos de `/admin/usuarios`: alta por CUIL, cambiar área o rol,
 * desactivar, reactivar, blanquear la contraseña y desbloquear. El CUIL se
 * controla también acá (dígito verificador) para avisar antes de enviar; el
 * dominio lo vuelve a controlar.
 *
 * Login propio (27/10/2026): el alta y el blanqueo devuelven una contraseña
 * temporal que se muestra UNA sola vez (DialogoClaveTemporal), con un botón
 * para copiarla. Vive solo en el estado de este componente: al cerrar el
 * diálogo se pierde, y en la base queda solo el hash.
 */

type Area = { id: number; codigo: string; nombre: string };
const RUTA = "/admin/usuarios";
const ROL_TEXTO: Record<Rol, string> = { operador: "Operador (trabaja en su área)", lectura: "Lectura (Dirección: panel y búsqueda)", admin: "Administrador" };

function CamposAcceso({ areaId, rol, setAreaId, setRol, areas, error, rolBloqueado = false }: {
  areaId: number | null;
  rol: Rol;
  setAreaId: (v: number | null) => void;
  setRol: (v: Rol) => void;
  areas: readonly Area[];
  error: EstadoError | null;
  rolBloqueado?: boolean;
}) {
  return (
    <>
      <Campo ruta="rol" etiqueta="Rol" obligatorio errores={erroresDe(error, "rol")} ayuda={rolBloqueado ? "No podés cambiar tu propio rol" : undefined}>
        <select {...atributosCampo("rol", erroresDe(error, "rol"), rolBloqueado ? "campo-rol-ayuda" : undefined)} value={rol} disabled={rolBloqueado} onChange={(e) => setRol(ROLES.find((r) => r === e.target.value) ?? "operador")} className={CLASE_CONTROL}>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ROL_TEXTO[r]}
            </option>
          ))}
        </select>
      </Campo>
      <Campo ruta="areaId" etiqueta="Área" obligatorio={rol !== "admin"} errores={erroresDe(error, "areaId")} ayuda="Solo áreas internas: la DIM y los cementerios no tienen usuarios">
        <select {...atributosCampo("areaId", erroresDe(error, "areaId"), "campo-areaId-ayuda")} value={areaId ?? ""} onChange={(e) => setAreaId(e.target.value === "" ? null : Number(e.target.value))} className={CLASE_CONTROL}>
          <option value="">{rol === "admin" ? "Sin área" : "Elegí el área…"}</option>
          {areas.map((a) => (
            <option key={a.id} value={a.id}>
              {a.nombre}
            </option>
          ))}
        </select>
      </Campo>
    </>
  );
}

/**
 * La contraseña temporal, una sola vez: grande, en monoespaciada, con
 * "Copiar" y el aviso de que no se vuelve a ver.
 */
export function DialogoClaveTemporal({ nombre, clave, onCerrar }: { nombre: string; clave: string; onCerrar: () => void }) {
  const [copiada, setCopiada] = useState<"si" | "no" | null>(null);
  return (
    <Dialogo titulo={`Contraseña temporal de ${nombre}`} onCerrar={onCerrar}>
      <div className="space-y-4">
        <Aviso tono="advertencia" titulo="Copiala ahora: no se vuelve a mostrar">
          <p>
            Pasásela a la persona en mano o por teléfono (no por un chat ni por correo). Al ingresar con su CUIL y esta
            contraseña, CementerIA le va a pedir que elija una nueva.
          </p>
        </Aviso>
        <p className="text-sm text-texto-secundario">Contraseña temporal:</p>
        <p
          data-clave-temporal
          className="select-all rounded-control border border-borde bg-fondo px-4 py-3 text-center font-mono text-xl font-semibold tracking-wider text-texto"
        >
          {clave}
        </p>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-borde pt-3">
          <div role="status" className="text-sm text-texto-secundario">
            {copiada === "si" ? "Copiada al portapapeles." : copiada === "no" ? "No se pudo copiar: seleccionala y copiala a mano." : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                navigator.clipboard
                  .writeText(clave)
                  .then(() => setCopiada("si"))
                  .catch(() => setCopiada("no"));
              }}
              className={CLASE_BOTON_SECUNDARIO}
            >
              <Copy className="h-4 w-4" aria-hidden="true" />
              Copiar
            </button>
            <button type="button" onClick={onCerrar} className={CLASE_BOTON_PRIMARIO} data-autofocus>
              Listo, ya la copié
            </button>
          </div>
        </div>
      </div>
    </Dialogo>
  );
}

export function BotonAltaUsuario({ areas }: { areas: readonly Area[] }) {
  const [abierto, setAbierto] = useState(false);
  const [hecho, setHecho] = useState<string | null>(null);
  const [temporal, setTemporal] = useState<{ nombre: string; clave: string } | null>(null);
  return (
    <div className="flex flex-col items-end gap-2">
      <button type="button" aria-haspopup="dialog" data-recorrido="usuarios-alta" onClick={() => setAbierto(true)} className={CLASE_BOTON_PRIMARIO}>
        <UserPlus className="h-4 w-4" aria-hidden="true" />
        Alta de usuario
      </button>
      <AvisoHecho mensaje={hecho} />
      {abierto ? (
        <DialogoAlta
          areas={areas}
          onCerrar={() => setAbierto(false)}
          onHecho={(m, clave) => {
            setAbierto(false);
            setHecho(m);
            if (clave) setTemporal(clave);
          }}
        />
      ) : null}
      {temporal ? <DialogoClaveTemporal nombre={temporal.nombre} clave={temporal.clave} onCerrar={() => setTemporal(null)} /> : null}
    </div>
  );
}

function DialogoAlta({
  areas,
  onCerrar,
  onHecho,
}: {
  areas: readonly Area[];
  onCerrar: () => void;
  onHecho: (mensaje: string, temporal: { nombre: string; clave: string } | null) => void;
}) {
  const { pendiente, error, setError, enviar } = useAccion();
  const [cuil, setCuil] = useState("");
  const [nombre, setNombre] = useState("");
  const [apellido, setApellido] = useState("");
  const [email, setEmail] = useState("");
  const [rol, setRol] = useState<Rol>("operador");
  const [areaId, setAreaId] = useState<number | null>(null);
  const soloDigitos = cuil.replace(/[\s.-]/g, "");
  return (
    <Dialogo
      titulo="Alta de usuario"
      descripcion="Ingresa con su CUIL (o su correo) y una contraseña temporal que se genera al darlo de alta y se muestra una sola vez."
      onCerrar={onCerrar}
      ocupado={pendiente}
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!cuilValido(soloDigitos)) {
            setError({ ok: false, codigo: "validacion", mensaje: "Revisá el CUIL", errores: [{ ruta: "cuil", mensaje: "CUIL inválido: 11 dígitos con el dígito verificador correcto" }] });
            return;
          }
          enviar(
            () => accionUsuario({ accion: "alta", datos: { cuil: soloDigitos, nombre, apellido, email, rol, areaId } }),
            (r) => onHecho(r.mensaje, r.claveTemporal ? { nombre: `${nombre} ${apellido}`.trim(), clave: r.claveTemporal } : null),
          );
        }}
      >
        <Campo ruta="cuil" etiqueta="CUIL" obligatorio errores={erroresDe(error, "cuil")} ayuda="Con o sin guiones (ej. 20-12345678-6)">
          <input {...atributosCampo("cuil", erroresDe(error, "cuil"), "campo-cuil-ayuda")} type="text" inputMode="numeric" autoComplete="off" maxLength={15} value={cuil} onChange={(e) => setCuil(e.target.value)} className={`${CLASE_CONTROL} font-mono`} data-autofocus />
        </Campo>
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo ruta="apellido" etiqueta="Apellido" obligatorio errores={erroresDe(error, "apellido")}>
            <input {...atributosCampo("apellido", erroresDe(error, "apellido"))} type="text" autoComplete="off" maxLength={100} value={apellido} onChange={(e) => setApellido(e.target.value)} className={CLASE_CONTROL} />
          </Campo>
          <Campo ruta="nombre" etiqueta="Nombre" obligatorio errores={erroresDe(error, "nombre")}>
            <input {...atributosCampo("nombre", erroresDe(error, "nombre"))} type="text" autoComplete="off" maxLength={100} value={nombre} onChange={(e) => setNombre(e.target.value)} className={CLASE_CONTROL} />
          </Campo>
        </div>
        <Campo ruta="email" etiqueta="Correo (opcional)" errores={erroresDe(error, "email")}>
          <input {...atributosCampo("email", erroresDe(error, "email"))} type="email" autoComplete="off" maxLength={200} value={email} onChange={(e) => setEmail(e.target.value)} className={CLASE_CONTROL} />
        </Campo>
        <CamposAcceso areaId={areaId} rol={rol} setAreaId={setAreaId} setRol={setRol} areas={areas} error={error} />
        {error ? <AvisoError error={error} recargar={RUTA} yaMostradas={["cuil", "nombre", "apellido", "email", "rol", "areaId"]} /> : null}
        <div className="flex flex-wrap justify-end gap-2 border-t border-borde pt-3">
          <button type="button" onClick={onCerrar} disabled={pendiente} className={CLASE_BOTON_SECUNDARIO}>
            Cancelar
          </button>
          <button type="submit" disabled={pendiente} className={CLASE_BOTON_PRIMARIO}>
            {pendiente ? "Guardando…" : "Dar de alta"}
          </button>
        </div>
      </form>
    </Dialogo>
  );
}

interface UsuarioFila {
  id: number;
  nombre: string;
  cuil: string;
  areaId: number | null;
  rol: Rol;
  activo: boolean;
  /** Bloqueado por intentos fallidos ahora. */
  bloqueado: boolean;
}

export function AccionesUsuario({ usuario, esUnoMismo, areas }: { usuario: UsuarioFila; esUnoMismo: boolean; areas: readonly Area[] }) {
  const [dialogo, setDialogo] = useState<"acceso" | "desactivar" | "reactivar" | "blanquear" | "desbloquear" | null>(null);
  const [hecho, setHecho] = useState<string | null>(null);
  const [temporal, setTemporal] = useState<string | null>(null);
  const accion = useAccion();
  const terminar = (r: { mensaje: string; claveTemporal?: string }) => {
    setDialogo(null);
    setHecho(r.mensaje);
    if (r.claveTemporal) setTemporal(r.claveTemporal);
  };
  return (
    <div className="flex flex-col items-start gap-1">
      <div className="flex flex-wrap gap-1" data-recorrido="usuarios-acciones">
        <button type="button" aria-haspopup="dialog" onClick={() => setDialogo("acceso")} className={CLASE_BOTON_COMPACTO}>
          <UserCog className="h-4 w-4" aria-hidden="true" />
          Área o rol<span className="sr-only"> de {usuario.nombre}</span>
        </button>
        {usuario.activo ? (
          esUnoMismo ? null : (
            <button type="button" aria-haspopup="dialog" onClick={() => setDialogo("desactivar")} className={CLASE_BOTON_COMPACTO_PELIGRO}>
              <UserX className="h-4 w-4" aria-hidden="true" />
              Desactivar<span className="sr-only"> a {usuario.nombre}</span>
            </button>
          )
        ) : (
          <button type="button" aria-haspopup="dialog" onClick={() => setDialogo("reactivar")} className={CLASE_BOTON_COMPACTO}>
            <UserCheck className="h-4 w-4" aria-hidden="true" />
            Reactivar<span className="sr-only"> a {usuario.nombre}</span>
          </button>
        )}
        {esUnoMismo ? null : (
          <button type="button" aria-haspopup="dialog" data-recorrido="usuarios-blanquear" onClick={() => setDialogo("blanquear")} className={CLASE_BOTON_COMPACTO}>
            <KeyRound className="h-4 w-4" aria-hidden="true" />
            Blanquear contraseña<span className="sr-only"> de {usuario.nombre}</span>
          </button>
        )}
        {usuario.bloqueado ? (
          <button type="button" aria-haspopup="dialog" onClick={() => setDialogo("desbloquear")} className={CLASE_BOTON_COMPACTO}>
            <LockOpen className="h-4 w-4" aria-hidden="true" />
            Desbloquear<span className="sr-only"> a {usuario.nombre}</span>
          </button>
        ) : null}
      </div>
      <AvisoHecho mensaje={hecho} />
      {temporal ? <DialogoClaveTemporal nombre={usuario.nombre} clave={temporal} onCerrar={() => setTemporal(null)} /> : null}
      {dialogo === "blanquear" ? (
        <DialogoConfirmar
          titulo={`Blanquear la contraseña de ${usuario.nombre}`}
          textoBoton="Blanquear contraseña"
          peligro
          motivo="obligatorio"
          pendiente={accion.pendiente}
          error={accion.error}
          recargar={RUTA}
          onCerrar={() => setDialogo(null)}
          onConfirmar={(motivo) => accion.enviar(() => accionUsuario({ accion: "blanquear", id: usuario.id, motivo }), terminar)}
        >
          <p>
            Se genera una contraseña temporal nueva, que vas a ver una sola vez; la actual deja de valer. Se cierran todas sus
            sesiones abiertas y, si estaba bloqueado, se desbloquea. Al ingresar la va a tener que cambiar.
          </p>
        </DialogoConfirmar>
      ) : null}
      {dialogo === "desbloquear" ? (
        <DialogoConfirmar
          titulo={`Desbloquear a ${usuario.nombre}`}
          textoBoton="Desbloquear"
          motivo="opcional"
          pendiente={accion.pendiente}
          error={accion.error}
          recargar={RUTA}
          onCerrar={() => setDialogo(null)}
          onConfirmar={(motivo) => accion.enviar(() => accionUsuario({ accion: "desbloquear", id: usuario.id, motivo }), terminar)}
        >
          <p>Está bloqueado por 5 intentos fallidos seguidos. Desbloquearlo le permite volver a probar ya, sin esperar los 15 minutos. Su contraseña no cambia.</p>
        </DialogoConfirmar>
      ) : null}
      {dialogo === "acceso" ? <DialogoAcceso usuario={usuario} esUnoMismo={esUnoMismo} areas={areas} onCerrar={() => setDialogo(null)} onHecho={terminar} /> : null}
      {dialogo === "desactivar" ? (
        <DialogoConfirmar
          titulo={`Desactivar a ${usuario.nombre}`}
          textoBoton="Desactivar"
          peligro
          motivo="opcional"
          pendiente={accion.pendiente}
          error={accion.error}
          recargar={RUTA}
          onCerrar={() => setDialogo(null)}
          onConfirmar={(motivo) => accion.enviar(() => accionUsuario({ accion: "desactivar", id: usuario.id, motivo }), terminar)}
        >
          <p>No va a poder ingresar, y si tiene una sesión abierta se corta en su próxima acción. Sus movimientos quedan en el historial. Se puede reactivar.</p>
        </DialogoConfirmar>
      ) : null}
      {dialogo === "reactivar" ? (
        <DialogoConfirmar
          titulo={`Reactivar a ${usuario.nombre}`}
          textoBoton="Reactivar"
          motivo="opcional"
          pendiente={accion.pendiente}
          error={accion.error}
          recargar={RUTA}
          onCerrar={() => setDialogo(null)}
          onConfirmar={(motivo) => accion.enviar(() => accionUsuario({ accion: "reactivar", id: usuario.id, motivo }), terminar)}
        >
          <p>Vuelve a poder ingresar con su contraseña, con el área y el rol que tenía. Si no la recuerda, después blanqueásela.</p>
        </DialogoConfirmar>
      ) : null}
    </div>
  );
}

function DialogoAcceso({ usuario, esUnoMismo, areas, onCerrar, onHecho }: { usuario: UsuarioFila; esUnoMismo: boolean; areas: readonly Area[]; onCerrar: () => void; onHecho: (r: { mensaje: string }) => void }) {
  const { pendiente, error, enviar } = useAccion();
  const [rol, setRol] = useState<Rol>(usuario.rol);
  const [areaId, setAreaId] = useState<number | null>(usuario.areaId);
  const [motivo, setMotivo] = useState("");
  // Su área puede estar inactiva: se muestra igual para que se vea cuál es.
  const opciones = usuario.areaId !== null && !areas.some((a) => a.id === usuario.areaId) ? [...areas, { id: usuario.areaId, codigo: "", nombre: "(su área actual, que no se puede asignar)" }] : areas;
  return (
    <Dialogo titulo={`Área o rol de ${usuario.nombre}`} onCerrar={onCerrar} ocupado={pendiente}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          enviar(() => accionUsuario({ accion: "acceso", id: usuario.id, datos: { areaId, rol }, motivo }), onHecho);
        }}
      >
        <CamposAcceso areaId={areaId} rol={rol} setAreaId={setAreaId} setRol={setRol} areas={opciones} error={error} rolBloqueado={esUnoMismo} />
        <Campo ruta="motivo" etiqueta="Motivo (opcional)" ayuda="Queda en la auditoría">
          <input {...atributosCampo("motivo", undefined, "campo-motivo-ayuda")} type="text" maxLength={300} value={motivo} onChange={(e) => setMotivo(e.target.value)} className={CLASE_CONTROL} />
        </Campo>
        <p className="text-sm text-texto-secundario">Rige desde su próxima acción: la sesión vuelve a leer el área y el rol en cada pedido.</p>
        {error ? <AvisoError error={error} recargar={RUTA} yaMostradas={["rol", "areaId"]} /> : null}
        <div className="flex flex-wrap justify-end gap-2 border-t border-borde pt-3">
          <button type="button" onClick={onCerrar} disabled={pendiente} className={CLASE_BOTON_SECUNDARIO}>
            Cancelar
          </button>
          <button type="submit" disabled={pendiente} className={CLASE_BOTON_PRIMARIO}>
            {pendiente ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </form>
    </Dialogo>
  );
}
