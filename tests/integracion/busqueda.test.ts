// Búsqueda (src/lib/dominio/busqueda.ts) contra la base real: docs/propuesta-mvp.md,
// 2.13(g). También que las normalizaciones de TypeScript den lo mismo que las
// de la base, porque se comparan entre sí.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ResultadoAlta } from "@/lib/dominio/expedientes";
import { normalizar, normalizarNumero } from "@/lib/dominio/normalizar";
import type { UsuarioPermisos } from "@/lib/dominio/permisos";
import { asegurarSemilla, comando, cuitUnico, datosAlta, forzarEstado, idCementerio, loteUnico, servicio, titular, unicoLetras, usuario } from "./dominio";
import { clientePrisma, conPg } from "./helper";

const prisma = clientePrisma();
const exp = servicio(prisma);
let mesa: UsuarioPermisos;
let legal: UsuarioPermisos;

// Un expediente con datos "difíciles" para buscar, armado una vez.
const marca = unicoLetras("");
const apellido = `GONZÁLEZ ${marca}`;
const dniTitular = String(97_000_000 + (Date.now() % 999_999));
const dniSolicitante = String(96_000_000 + (Date.now() % 999_999));
const municipal = `${(Date.now() % 90_000) + 10_000}/2026`;
const padron = `P.${marca}-77`;
const lote = loteUnico();
let principal: ResultadoAlta;

beforeAll(async () => {
  await asegurarSemilla(prisma);
  [mesa, legal] = await Promise.all([usuario(prisma, "MESA_ENTRADAS"), usuario(prisma, "LEGAL")]);
  principal = await exp.alta(
    mesa,
    await datosAlta(prisma, {
      numeroMunicipal: municipal,
      padron,
      // Oeste: sección A a H (docs/fuentes); el lote es único de esta corrida.
      ubicacion: { seccion: "e", lote, numero: "45" },
      personas: [
        titular({ apellido, nombres: "María José", dni: dniTitular, esContacto: false }),
        { rol: "solicitante", apellido: "FICTICIO", nombres: "Solicitante", dni: dniSolicitante, vinculo: "hijo", email: "s@ejemplo.test", esContacto: true },
      ],
    }),
    comando(),
  );
});

afterAll(async () => prisma.$disconnect());

describe("normalizaciones: TypeScript = base", () => {
  const textos = ["GONZÁLEZ, María-José", "  Ñandú  Güemes ", "CEM-2026-00042", "12.345/2026", "Straße Øster", "Ça va? 50%_x", "ÁÉÍÓÚ àèìòù âêîôû äëïöü"];

  it.each(textos)("f_normalizar(%s)", async (t) => {
    const [r] = await conPg("app", async (c) => (await c.query<{ n: string; num: string | null }>(
      `SELECT public.f_normalizar($1) AS n,
              nullif(upper(regexp_replace(public.f_unaccent($1), '[^A-Za-z0-9]', '', 'g')), '') AS num`,
      [t],
    )).rows);
    expect(normalizar(t)).toBe(r.n);
    expect(normalizarNumero(t)).toBe(r.num);
  });
});

describe("caja única", () => {
  it('texto: "gonzalez" encuentra "GONZÁLEZ"', async () => {
    const r = await exp.buscar(legal, { q: `gonzalez ${marca.toLowerCase()}` });
    expect(r.consulta.tipo).toBe("texto");
    expect(r.resultados.map((f) => f.numero)).toEqual([principal.numero]);
    expect(r.resultados[0]).toMatchObject({
      titular: `${apellido}, María José`,
      paso: { clave: "MESA", nombre: "Mesa de Entradas" },
      areaActual: { codigo: "MESA_ENTRADAS" },
      plantilla: { codigo: "RENOV_CONTADO", version: 1 },
      estado: "en_tramite",
    });
    expect(r.resultados[0].similitud).toBeGreaterThan(0);
    // En texto no se abre directo aunque haya uno solo: no es un número exacto.
    expect(r.abrir).toBeNull();
  });

  it("texto: cada palabra tiene que estar, en cualquier orden", async () => {
    expect((await exp.buscar(mesa, { q: `${marca} maria` })).resultados).toHaveLength(1);
    expect((await exp.buscar(mesa, { q: `${marca} pedro` })).resultados).toHaveLength(0);
  });

  it("DNI con puntos: abre directo y dice por dónde coincidió", async () => {
    const conPuntos = dniTitular.replace(/(\d{2})(\d{3})(\d{3})/, "$1.$2.$3");
    const r = await exp.buscar(mesa, { q: conPuntos });
    expect(r.abrir).toBe(principal.numero);
    expect(r.resultados[0].coincidencias).toEqual([{ campo: "dni", etiqueta: "DNI del titular" }]);
  });

  it("CUIL de 11 dígitos: busca el DNI que contiene", async () => {
    const r = await exp.buscar(mesa, { q: `20-${dniSolicitante}-3` });
    expect(r.abrir).toBe(principal.numero);
    expect(r.resultados[0].coincidencias).toEqual([{ campo: "dni", etiqueta: "DNI del solicitante" }]);
  });

  it("persona jurídica: el CUIT de 11 dígitos abre directo; la razón social, como texto", async () => {
    const cuit = cuitUnico();
    const razon = `Asociación Ficticia ${marca} de Socorros Mutuos`;
    const asociacion = await exp.alta(
      mesa,
      await datosAlta(prisma, {
        tipoMonumento: "PANTEON",
        personas: [{ rol: "titular", tipo: "juridica", razonSocial: razon, cuit, email: "asociacion@ejemplo.test" }],
      }),
      comando(),
    );
    const conGuiones = `${cuit.slice(0, 2)}-${cuit.slice(2, 10)}-${cuit.slice(10)}`;
    const r = await exp.buscar(mesa, { q: conGuiones });
    expect(r.abrir).toBe(asociacion.numero);
    expect(r.resultados[0]).toMatchObject({ titular: razon, coincidencias: [{ campo: "cuit", etiqueta: "CUIT del titular" }] });
    const t = await exp.buscar(mesa, { q: `socorros ${marca.toLowerCase()}` });
    expect(t.resultados.map((f) => f.numero)).toEqual([asociacion.numero]);
  });

  it("N° municipal con barra (y con otros separadores)", async () => {
    for (const q of [municipal, municipal.replace("/", "-"), municipal.replace("/", " ")]) {
      const r = await exp.buscar(mesa, { q });
      expect(r.resultados.map((f) => f.numero), q).toContain(principal.numero);
      expect(r.resultados.find((f) => f.numero === principal.numero)?.coincidencias).toContainEqual({ campo: "numero_municipal", etiqueta: "N° municipal" });
    }
  });

  it("forma corta 42/2026: el número interno", async () => {
    const r = await exp.buscar(mesa, { q: principal.numeroCorto });
    expect(r.resultados.find((f) => f.numero === principal.numero)?.coincidencias).toContainEqual({ campo: "numero_interno", etiqueta: "N° interno" });
  });

  it("prefijo CEM: abre directo, aunque se escriba distinto", async () => {
    const [, anio, sec] = principal.numero.split("-");
    const r = await exp.buscar(mesa, { q: `cem ${anio}/${Number(sec)}` });
    expect(r).toMatchObject({ consulta: { tipo: "numero_interno" }, abrir: principal.numero, resultados: [] });
    expect((await exp.buscar(mesa, { q: "CEM-1999-99999" })).abrir).toBeNull();
  });

  it("padrón como texto (tiene letras): por la columna busqueda", async () => {
    const r = await exp.buscar(mesa, { q: padron.toLowerCase() });
    expect(r.resultados.map((f) => f.numero)).toContain(principal.numero);
  });

  it("varias coincidencias numéricas: lista, sin abrir", async () => {
    const otro = await exp.alta(mesa, await datosAlta(prisma, { padron: municipal }), comando());
    const r = await exp.buscar(mesa, { q: municipal });
    expect(r.abrir).toBeNull();
    const porNumero = new Map(r.resultados.map((f) => [f.numero, f.coincidencias.map((c) => c.campo)]));
    expect(porNumero.get(principal.numero)).toEqual(["numero_municipal"]);
    expect(porNumero.get(otro.numero)).toEqual(["padron"]);
  });
});

describe("filtros", () => {
  it("por cementerio y campos de ubicación (@>), normalizados como en el alta", async () => {
    const oeste = await idCementerio(prisma, "OESTE");
    const r = await exp.buscar(mesa, { filtros: { cementerioId: oeste, ubicacion: { seccion: "E", lote: `00${lote}` } } });
    expect(r.resultados.map((f) => f.numero)).toEqual([principal.numero]);
    // La sección en minúscula se normaliza igual que en el alta.
    expect((await exp.buscar(mesa, { filtros: { cementerioId: oeste, ubicacion: { seccion: "e", lote } } })).resultados.map((f) => f.numero)).toEqual([principal.numero]);
    const norte = await idCementerio(prisma, "NORTE");
    expect((await exp.buscar(mesa, { filtros: { cementerioId: norte, ubicacion: { lote } } })).resultados).toEqual([]);
    await expect(exp.buscar(mesa, { filtros: { ubicacion: { lote: "12" } } })).rejects.toMatchObject({ codigo: "validacion" });
  });

  it("los anulados no aparecen, salvo que se pidan", async () => {
    const token = unicoLetras("ANUL");
    const a = await exp.alta(mesa, await datosAlta(prisma, { padron: token }), comando());
    await forzarEstado(prisma, a.numero, "anulado");
    expect((await exp.buscar(mesa, { q: token })).resultados).toEqual([]);
    const r = await exp.buscar(mesa, { q: token, filtros: { incluirAnulados: true } });
    expect(r.resultados.map((f) => [f.numero, f.estado])).toEqual([[a.numero, "anulado"]]);
  });

  it("estado, plantilla y fecha de inicio", async () => {
    const q = `${marca} gonzalez`;
    expect((await exp.buscar(mesa, { q, filtros: { estados: ["en_tramite"], plantillaCodigo: "RENOV_CONTADO" } })).resultados).toHaveLength(1);
    expect((await exp.buscar(mesa, { q, filtros: { plantillaCodigo: "RENOV_PLAN" } })).resultados).toHaveLength(0);
    expect((await exp.buscar(mesa, { q, filtros: { fechaInicioHasta: "2000-01-01" } })).resultados).toHaveLength(0);
  });

  it("50 resultados como máximo, y avisa que hay más", async () => {
    const token = unicoLetras("MUCHOS");
    for (let i = 0; i < 51; i++) {
      await exp.alta(mesa, await datosAlta(prisma, { padron: `${token} ${i}` }), comando());
    }
    const r = await exp.buscar(mesa, { q: token });
    expect(r.resultados).toHaveLength(50);
    expect(r.hayMas).toBe(true);
  });
});
