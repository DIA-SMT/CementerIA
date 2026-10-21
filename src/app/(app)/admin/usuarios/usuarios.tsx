"use client";

import { useState } from "react";
import { UserCheck, UserCog, UserPlus, UserX } from "lucide-react";
import { AvisoError } from "@/components/aviso-error";
import { Dialogo } from "@/components/dialogo";
import { atributosCampo, Campo, CLASE_BOTON_PRIMARIO, CLASE_BOTON_SECUNDARIO, CLASE_CONTROL } from "@/components/formulario";
import { cuilValido } from "@/lib/dominio/cuil";
import { ROLES, type Rol } from "@/lib/dominio/permisos";
import type { EstadoError } from "@/lib/presentacion/errores";
import { accionUsuario } from "../acciones";
import { AvisoHecho, DialogoConfirmar, erroresDe, useAccion } from "../piezas";

/**
 * Los diálogos de `/admin/usuarios`: alta por CUIL, cambiar área o rol,
 * desactivar y reactivar. El CUIL se controla también acá (dígito
 * verificador) para avisar antes de enviar; el dominio lo vuelve a controlar.
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

export function BotonAltaUsuario({ areas }: { areas: readonly Area[] }) {
  const [abierto, setAbierto] = useState(false);
  const [hecho, setHecho] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-end gap-2">
      <button type="button" aria-haspopup="dialog" onClick={() => setAbierto(true)} className={CLASE_BOTON_PRIMARIO}>
        <UserPlus className="h-4 w-4" aria-hidden="true" />
        Alta de usuario
      </button>
      <AvisoHecho mensaje={hecho} />
      {abierto ? (
        <DialogoAlta
          areas={areas}
          onCerrar={() => setAbierto(false)}
          onHecho={(m) => {
            setAbierto(false);
            setHecho(m);
          }}
        />
      ) : null}
    </div>
  );
}

function DialogoAlta({ areas, onCerrar, onHecho }: { areas: readonly Area[]; onCerrar: () => void; onHecho: (mensaje: string) => void }) {
  const { pendiente, error, setError, enviar } = useAccion();
  const [cuil, setCuil] = useState("");
  const [nombre, setNombre] = useState("");
  const [apellido, setApellido] = useState("");
  const [email, setEmail] = useState("");
  const [rol, setRol] = useState<Rol>("operador");
  const [areaId, setAreaId] = useState<number | null>(null);
  const soloDigitos = cuil.replace(/[\s.-]/g, "");
  return (
    <Dialogo titulo="Alta de usuario" descripcion="Con el CUIL con el que entra a Cidituc. El nombre se actualiza en su primer ingreso." onCerrar={onCerrar} ocupado={pendiente}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!cuilValido(soloDigitos)) {
            setError({ ok: false, codigo: "validacion", mensaje: "Revisá el CUIL", errores: [{ ruta: "cuil", mensaje: "CUIL inválido: 11 dígitos con el dígito verificador correcto" }] });
            return;
          }
          enviar(() => accionUsuario({ accion: "alta", datos: { cuil: soloDigitos, nombre, apellido, email, rol, areaId } }), (r) => onHecho(r.mensaje));
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
        <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 pt-3">
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
}

export function AccionesUsuario({ usuario, esUnoMismo, areas }: { usuario: UsuarioFila; esUnoMismo: boolean; areas: readonly Area[] }) {
  const [dialogo, setDialogo] = useState<"acceso" | "desactivar" | "reactivar" | null>(null);
  const [hecho, setHecho] = useState<string | null>(null);
  const accion = useAccion();
  const terminar = (r: { mensaje: string }) => {
    setDialogo(null);
    setHecho(r.mensaje);
  };
  return (
    <div className="flex flex-col items-start gap-1">
      <div className="flex flex-wrap gap-1">
        <button type="button" aria-haspopup="dialog" onClick={() => setDialogo("acceso")} className={`${CLASE_BOTON_SECUNDARIO} px-2 py-1`}>
          <UserCog className="h-4 w-4" aria-hidden="true" />
          Área o rol<span className="sr-only"> de {usuario.nombre}</span>
        </button>
        {usuario.activo ? (
          esUnoMismo ? null : (
            <button type="button" aria-haspopup="dialog" onClick={() => setDialogo("desactivar")} className={`${CLASE_BOTON_SECUNDARIO} px-2 py-1 text-red-800`}>
              <UserX className="h-4 w-4" aria-hidden="true" />
              Desactivar<span className="sr-only"> a {usuario.nombre}</span>
            </button>
          )
        ) : (
          <button type="button" aria-haspopup="dialog" onClick={() => setDialogo("reactivar")} className={`${CLASE_BOTON_SECUNDARIO} px-2 py-1`}>
            <UserCheck className="h-4 w-4" aria-hidden="true" />
            Reactivar<span className="sr-only"> a {usuario.nombre}</span>
          </button>
        )}
      </div>
      <AvisoHecho mensaje={hecho} />
      {dialogo === "acceso" ? <DialogoAcceso usuario={usuario} esUnoMismo={esUnoMismo} areas={areas} onCerrar={() => setDialogo(null)} onHecho={terminar} /> : null}
      {dialogo === "desactivar" ? (
        <DialogoConfirmar
          titulo={`Desactivar a ${usuario.nombre}`}
          textoBoton="Desactivar"
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
          <p>Vuelve a poder ingresar con Cidituc, con el área y el rol que tenía.</p>
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
        <p className="text-sm text-slate-700">Rige desde su próxima acción: la sesión vuelve a leer el área y el rol en cada pedido.</p>
        {error ? <AvisoError error={error} recargar={RUTA} yaMostradas={["rol", "areaId"]} /> : null}
        <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 pt-3">
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
