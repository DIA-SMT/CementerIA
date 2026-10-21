import { NextResponse, type NextRequest } from "next/server";
import { cookieSegura, nombreCookie, opcionesBorrado, opcionesCookie } from "@/lib/auth/cookies";
import { destinoSeguro } from "@/lib/auth/destino";
import { ingresarSimulado } from "@/lib/auth/ingreso";
import { hostnameDeSolicitud, ipDeSolicitud, mismoOrigen } from "@/lib/auth/red";
import { dependenciasIngreso } from "@/lib/auth/sesion";
import { COOKIE_SESION, COOKIE_SIN_ACCESO, emitirSesion, segundosAhora } from "@/lib/auth/sesion-token";
import { prisma } from "@/lib/db/cliente";
import { inicioPara } from "@/lib/dominio/navegacion";
import { devLoginPara, entorno } from "@/lib/entorno";
import { log } from "@/lib/log";
import { redirigirA } from "@/lib/auth/redireccion";

/**
 * POST /dev/login/entrar: el "Entrar como…" de /dev/login.
 *
 * Responde 404 —igual que la página— si el login simulado no está habilitado,
 * para no anunciar que existe. Vuelve a controlar todo lo que controló la
 * página (usuario activo, lista blanca, host): el formulario lo puede reenviar
 * cualquiera con otro `usuarioId`.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const e = entorno();
  const devLogin = devLoginPara(e, hostnameDeSolicitud(request.headers));
  if (!devLogin) return new NextResponse(null, { status: 404 });
  if (!mismoOrigen(request.headers)) return new NextResponse(null, { status: 403 });

  const formulario = await request.formData().catch(() => null);
  if (!formulario) return new NextResponse(null, { status: 400 });
  const campoId = formulario.get("usuarioId");
  const usuarioId = typeof campoId === "string" && /^[1-9]\d{0,9}$/.test(campoId) ? Number(campoId) : NaN;
  const volverCampo = formulario.get("volver");
  const volver = destinoSeguro(typeof volverCampo === "string" ? volverCampo : null);
  if (!Number.isSafeInteger(usuarioId)) return new NextResponse(null, { status: 400 });

  const fila = await prisma.usuario.findUnique({ where: { id: usuarioId }, select: { cuil: true, activo: true } });
  if (!fila || !fila.activo || (devLogin.listaBlanca && !devLogin.listaBlanca.has(fila.cuil))) {
    return new NextResponse(null, { status: 404 });
  }

  const resultado = await ingresarSimulado(dependenciasIngreso, usuarioId, ipDeSolicitud(request.headers));
  if (!resultado.ok) return new NextResponse(null, { status: 404 });

  const ahora = segundosAhora();
  const sesion = await emitirSesion(
    { usuarioId, sesionVersion: resultado.usuario.sesionVersion, inicio: ahora },
    e.secretoSesion,
    ahora,
  );
  if (!sesion) return new NextResponse(null, { status: 500 });

  log.info("ingreso.simulado", { usuarioId });
  const segura = cookieSegura(request.nextUrl, e.nodeEnv);
  const respuesta = redirigirA(volver ?? inicioPara(resultado.usuario));
  respuesta.cookies.set(nombreCookie(COOKIE_SESION, e.nodeEnv), sesion.token, opcionesCookie(segura, sesion.maxAge));
  respuesta.cookies.set(COOKIE_SIN_ACCESO, "", opcionesBorrado(segura, "/sin-acceso"));
  respuesta.headers.set("Cache-Control", "no-store");
  return respuesta;
}
