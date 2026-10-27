import { describe, expect, it, vi } from "vitest";
import type { ServicioExpedientes } from "@/lib/dominio/expedientes";
import { ErrorDominio } from "@/lib/dominio/expedientes/errores";
import { PermisoDenegado, type UsuarioPermisos } from "@/lib/dominio/permisos";
import { firmarTicket, verificarTicket } from "@/lib/adjuntos/ticket";
import { disposicion, HEADERS_SEGUROS, responderAutorizacion, responderConfirmacion, responderLectura, responderSubida, statusDeError } from "./adjuntos-http";

// Lo que no necesita base: el contrato HTTP. Con la base real, en
// tests/integracion/adjuntos-http.test.ts.

const usuario: UsuarioPermisos = { id: 7, activo: true, rol: "operador", area: { id: 2, codigo: "COMPUTO" } };

function servicio(parcial: Partial<ServicioExpedientes>): ServicioExpedientes {
  return parcial as ServicioExpedientes;
}

describe("status de cada error", () => {
  it("los códigos del dominio", () => {
    expect(statusDeError("no_encontrado")).toBe(404);
    expect(statusDeError("motivo_requerido")).toBe(403);
    expect(statusDeError("permiso")).toBe(403);
    expect(statusDeError("conflicto_version")).toBe(409);
    expect(statusDeError("adjunto_muy_grande")).toBe(413);
    expect(statusDeError("adjunto_invalido")).toBe(415);
    expect(statusDeError("validacion")).toBe(422);
  });

  it("Content-Disposition con el nombre en UTF-8 y una versión ASCII", () => {
    expect(disposicion("inline", "Constancia de Cómputos.pdf")).toBe(
      `inline; filename="Constancia de C_mputos.pdf"; filename*=UTF-8''Constancia%20de%20C%C3%B3mputos.pdf`,
    );
    expect(disposicion("attachment", 'a"b\\c.png')).toBe(`attachment; filename="a_b_c.png"; filename*=UTF-8''a%22b%5Cc.png`);
  });
});

describe("POST de subida", () => {
  const url = "http://localhost:3000/api/expedientes/CEM-2026-00001/adjuntos?nombre=a.pdf&version=3&comando=c1";

  it("sin sesión: 401 sin llamar al dominio", async () => {
    const subirAdjunto = vi.fn();
    const r = await responderSubida(servicio({ subirAdjunto }), null, "CEM-2026-00001", new Request(url, { method: "POST", body: "x" }));
    expect(r.status).toBe(401);
    expect(subirAdjunto).not.toHaveBeenCalled();
  });

  it("desde otro origen: 403", async () => {
    const subirAdjunto = vi.fn();
    const req = new Request(url, { method: "POST", body: "x", headers: { origin: "https://otro.example", host: "localhost:3000" } });
    expect((await responderSubida(servicio({ subirAdjunto }), usuario, "CEM-2026-00001", req)).status).toBe(403);
    expect(subirAdjunto).not.toHaveBeenCalled();
  });

  it("más de 10 MB declarados: 413 antes de leer", async () => {
    const subirAdjunto = vi.fn();
    const req = new Request(url, { method: "POST", body: "x", headers: { "content-length": String(11 * 1024 * 1024) } });
    const r = await responderSubida(servicio({ subirAdjunto }), usuario, "CEM-2026-00001", req);
    expect(r.status).toBe(413);
    expect(await r.json()).toMatchObject({ ok: false, codigo: "adjunto_muy_grande" });
    expect(subirAdjunto).not.toHaveBeenCalled();
  });

  it("pasa el cuerpo sin leer y los metadatos de la query; responde 201 con JSON", async () => {
    const subirAdjunto = vi.fn(async (_u: UsuarioPermisos, numero: string, cuerpo: ReadableStream<Uint8Array>) => {
      expect(cuerpo).toBeInstanceOf(ReadableStream);
      return { numero, version: 4, repetido: false, movimientoId: "99", documento: "DNI", nombre: "a.pdf", mime: "application/pdf", bytes: 1, sha256: "x", recepcionImplicita: false };
    });
    const req = new Request(`${url}&documento=DNI`, { method: "POST", body: "%PDF-" });
    const r = await responderSubida(servicio({ subirAdjunto }), usuario, "CEM-2026-00001", req);
    expect(r.status).toBe(201);
    expect(await r.json()).toMatchObject({ ok: true, version: 4, movimientoId: "99" });
    expect(subirAdjunto.mock.calls[0].slice(3)).toEqual([{ nombre: "a.pdf", documento: "DNI" }, 3, "c1"]);
  });

  it("sin versión: 422; un error del dominio con su status", async () => {
    const subirAdjunto = vi.fn(async () => {
      throw new ErrorDominio("adjunto_invalido", "Subilo como JPG", [{ ruta: "archivo", mensaje: "Subilo como JPG" }]);
    });
    const sinVersion = new Request(url.replace("version=3", "version=x"), { method: "POST", body: "x" });
    expect((await responderSubida(servicio({ subirAdjunto }), usuario, "N", sinVersion)).status).toBe(422);
    const r = await responderSubida(servicio({ subirAdjunto }), usuario, "N", new Request(url, { method: "POST", body: "x" }));
    expect(r.status).toBe(415);
    expect(await r.json()).toEqual({ ok: false, codigo: "adjunto_invalido", mensaje: "Subilo como JPG", errores: [{ ruta: "archivo", mensaje: "Subilo como JPG" }] });
  });
});

describe("GET de lectura", () => {
  const leer = (url: string, leerAdjunto: ServicioExpedientes["leerAdjunto"], u: UsuarioPermisos | null = usuario, headers: HeadersInit = {}) =>
    responderLectura(servicio({ leerAdjunto }), u, "42", new Request(url, { headers }), "10.0.0.1");

  it("inline con los headers de la sección 6; ?descargar=1 como attachment", async () => {
    const leerAdjunto = vi.fn(async (_u: UsuarioPermisos, id: string, o?: { descargar?: boolean }) => ({
      numero: "CEM-2026-00001",
      movimientoId: id,
      nombre: "boleta.png",
      mime: "image/png",
      bytes: 3,
      sha256: "x",
      disposicion: o?.descargar ? ("attachment" as const) : ("inline" as const),
      contenido: new Blob([new Uint8Array([1, 2, 3])]).stream(),
    }));
    const r = await leer("http://localhost/adjuntos/42", leerAdjunto);
    expect(r.status).toBe(200);
    expect(Object.fromEntries(r.headers)).toMatchObject({
      ...Object.fromEntries(Object.entries(HEADERS_SEGUROS).map(([k, v]) => [k.toLowerCase(), v])),
      "content-type": "image/png",
      "content-length": "3",
      "content-disposition": `inline; filename="boleta.png"; filename*=UTF-8''boleta.png`,
    });
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    const d = await leer("http://localhost/adjuntos/42?descargar=1", leerAdjunto);
    expect(d.headers.get("content-disposition")).toMatch(/^attachment;/);
    expect(leerAdjunto.mock.calls[1][2]).toEqual({ descargar: true, motivo: null, ip: "10.0.0.1" });
  });

  it("el motivo por query o por header", async () => {
    const leerAdjunto = vi.fn(async () => {
      throw new ErrorDominio("no_encontrado", "No existe ese adjunto");
    });
    await leer("http://localhost/adjuntos/42?motivo=Consulta%20del%20titular", leerAdjunto);
    await leer("http://localhost/adjuntos/42", leerAdjunto, usuario, { "x-motivo": "Por el reclamo 123" });
    expect(leerAdjunto.mock.calls.map((c) => (c as unknown[])[2])).toEqual([
      { descargar: false, motivo: "Consulta del titular", ip: "10.0.0.1" },
      { descargar: false, motivo: "Por el reclamo 123", ip: "10.0.0.1" },
    ]);
  });

  it("errores en texto, con los mismos headers: sin sesión 401, sin motivo 403, retirado 404, permiso 403", async () => {
    const sinUso = vi.fn();
    expect((await leer("http://localhost/adjuntos/42", sinUso, null)).status).toBe(401);
    expect(sinUso).not.toHaveBeenCalled();

    const sinMotivo = await leer("http://localhost/adjuntos/42", async () => {
      throw new ErrorDominio("motivo_requerido", "Abrir un adjunto… exige un motivo", [{ ruta: "motivo", mensaje: "Escribí el motivo" }]);
    });
    expect(sinMotivo.status).toBe(403);
    expect(sinMotivo.headers.get("content-security-policy")).toBe("sandbox; default-src 'none'");
    expect(sinMotivo.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(await sinMotivo.text()).toMatch(/indicá el motivo/);

    const retirado = await leer("http://localhost/adjuntos/42", async () => {
      throw new ErrorDominio("no_encontrado", "Ese adjunto fue retirado");
    });
    expect([retirado.status, await retirado.text()]).toEqual([404, "Ese adjunto fue retirado"]);

    const permiso = await leer("http://localhost/adjuntos/42", async () => {
      throw new PermisoDenegado("ver_datos_completos", "usuario_inactivo");
    });
    expect(permiso.status).toBe(403);
  });

  it("un error que no es del dominio sube (es un defecto)", async () => {
    await expect(
      leer("http://localhost/adjuntos/42", async () => {
        throw new Error("disco");
      }),
    ).rejects.toThrow("disco");
  });
});

describe("subida directa (Supabase Storage): autorizar y confirmar", () => {
  const SECRETO = "secreto-de-prueba-que-tiene-mas-de-32-caracteres";
  const base = "http://localhost:3000/api/expedientes/CEM-2026-00001/adjuntos";
  const ID = "0b0e7c6e-5a1f-4e43-9a43-0e7d2b6f1c11";
  const COMANDO = "6f1c9a43-0e7d-4e43-9a43-0b0e7c6e5a1f";
  const post = (ruta: string, cuerpo: unknown, headers: HeadersInit = {}) =>
    new Request(`${base}/${ruta}`, { method: "POST", body: typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo), headers });
  const resultado = { numero: "CEM-2026-00001", version: 4, repetido: false, movimientoId: "99", documento: null, nombre: "a.pdf", mime: "application/pdf", bytes: 1, sha256: "x", recepcionImplicita: false };

  it("autorizar: URL firmada y un ticket atado al usuario, expediente y comando; o lo de antes si el comando ya se usó", async () => {
    const autorizarSubidaAdjunto = vi.fn(async () => ({ tipo: "subir" as const, subida: { id: ID, url: "https://x.supabase.co/storage/v1/object/upload/sign/adjuntos/tmp/x?token=t" } }));
    const r = await responderAutorizacion(servicio({ autorizarSubidaAdjunto }), usuario, "CEM-2026-00001", post("autorizar", { documento: "DNI", version: 3, comando: COMANDO, bytes: 9_000_000 }), SECRETO);
    expect(r.status).toBe(200);
    const cuerpo = (await r.json()) as { ok: boolean; subida: { url: string; ticket: string } };
    expect(cuerpo.subida.url).toMatch(/token=t$/);
    expect(verificarTicket(SECRETO, cuerpo.subida.ticket, { usuarioId: usuario.id, numero: "CEM-2026-00001", comando: COMANDO })).toEqual({ ok: true, id: ID });
    expect(autorizarSubidaAdjunto.mock.calls[0]).toEqual([usuario, "CEM-2026-00001", { documento: "DNI" }, 3, COMANDO]);

    const repetido = vi.fn(async () => ({ tipo: "repetido" as const, resultado: { ...resultado, repetido: true } }));
    const r2 = await responderAutorizacion(servicio({ autorizarSubidaAdjunto: repetido }), usuario, "CEM-2026-00001", post("autorizar", { version: 3, comando: COMANDO }), SECRETO);
    expect(await r2.json()).toMatchObject({ ok: true, repetido: true, movimientoId: "99" });
  });

  it("autorizar: sin sesión 401, otro origen 403, JSON roto 400, más de 10 MB declarados 413, sin versión 422; sin llamar al dominio", async () => {
    const autorizarSubidaAdjunto = vi.fn();
    const s = servicio({ autorizarSubidaAdjunto });
    expect((await responderAutorizacion(s, null, "N", post("autorizar", {}), SECRETO)).status).toBe(401);
    expect((await responderAutorizacion(s, usuario, "N", post("autorizar", {}, { origin: "https://otro.example", host: "localhost:3000" }), SECRETO)).status).toBe(403);
    expect((await responderAutorizacion(s, usuario, "N", post("autorizar", "{no es json"), SECRETO)).status).toBe(400);
    expect((await responderAutorizacion(s, usuario, "N", post("autorizar", { version: 3, comando: COMANDO, bytes: 11 * 1024 * 1024 }), SECRETO)).status).toBe(413);
    expect((await responderAutorizacion(s, usuario, "N", post("autorizar", { comando: COMANDO }), SECRETO)).status).toBe(422);
    expect(autorizarSubidaAdjunto).not.toHaveBeenCalled();
  });

  it("confirmar: con un ticket válido pasa el id del temporal; con uno ajeno 403 y vencido 422, sin llamar al dominio", async () => {
    const confirmarSubidaAdjunto = vi.fn(async () => resultado);
    const s = servicio({ confirmarSubidaAdjunto });
    const ticket = firmarTicket(SECRETO, { usuarioId: usuario.id, numero: "CEM-2026-00001", comando: COMANDO }, ID);
    const ok = await responderConfirmacion(s, usuario, "CEM-2026-00001", post("confirmar", { ticket, nombre: "a.pdf", documento: null, version: 3, comando: COMANDO }), SECRETO);
    expect(ok.status).toBe(201);
    expect(await ok.json()).toMatchObject({ ok: true, movimientoId: "99" });
    expect(confirmarSubidaAdjunto.mock.calls[0]).toEqual([usuario, "CEM-2026-00001", ID, { nombre: "a.pdf", documento: null }, 3, COMANDO]);

    confirmarSubidaAdjunto.mockClear();
    const otroUsuario = { ...usuario, id: 8 };
    expect((await responderConfirmacion(s, otroUsuario, "CEM-2026-00001", post("confirmar", { ticket, version: 3, comando: COMANDO }), SECRETO)).status).toBe(403);
    expect((await responderConfirmacion(s, usuario, "CEM-2026-00002", post("confirmar", { ticket, version: 3, comando: COMANDO }), SECRETO)).status).toBe(403);
    const vencido = firmarTicket(SECRETO, { usuarioId: usuario.id, numero: "CEM-2026-00001", comando: COMANDO }, ID, Date.now() - 3 * 60 * 60 * 1000);
    expect((await responderConfirmacion(s, usuario, "CEM-2026-00001", post("confirmar", { ticket: vencido, version: 3, comando: COMANDO }), SECRETO)).status).toBe(422);
    expect(confirmarSubidaAdjunto).not.toHaveBeenCalled();
  });

  it("confirmar: los errores del dominio con su status (magic bytes 415, tamaño 413)", async () => {
    const ticket = firmarTicket(SECRETO, { usuarioId: usuario.id, numero: "N", comando: COMANDO }, ID);
    for (const [codigo, status] of [["adjunto_invalido", 415], ["adjunto_muy_grande", 413], ["conflicto_version", 409]] as const) {
      const confirmarSubidaAdjunto = vi.fn(async () => {
        throw new ErrorDominio(codigo, "x");
      });
      const r = await responderConfirmacion(servicio({ confirmarSubidaAdjunto }), usuario, "N", post("confirmar", { ticket, version: 3, comando: COMANDO }), SECRETO);
      expect(r.status).toBe(status);
    }
  });
});
