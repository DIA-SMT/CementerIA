import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ErrorDominio } from "../expedientes/errores";
import {
  EntradaCementerioSitio,
  EntradaContacto,
  EntradaNovedad,
  EntradaPregunta,
  EntradaRecorrido,
  esCorreo,
  esUrlHttps,
  esUrlMapa,
  fechasProximas,
  FOTOS_SITIO,
  fotoSitio,
  LARGOS,
  leerEntradaSitio,
  limpiarLinea,
  limpiarParrafos,
  novedadVigente,
} from "./validacion";

/** Las rutas de los errores de una entrada inválida. */
function errores(esquema: Parameters<typeof leerEntradaSitio>[0], valor: unknown): Array<{ ruta: string; mensaje: string }> {
  try {
    leerEntradaSitio(esquema, valor);
  } catch (e) {
    if (e instanceof ErrorDominio) return [...e.errores];
    throw e;
  }
  return [];
}

describe("enlaces de mapa", () => {
  it.each([
    "https://www.google.com/maps/place/Cementerio/@-26.83,-65.23,17z",
    "https://google.com/maps?q=-26.83,-65.23",
    "https://www.google.com/maps",
    "https://maps.app.goo.gl/AbCdEf123",
    "https://www.openstreetmap.org/#map=17/-26.83/-65.23",
    "https://openstreetmap.org/node/123",
  ])("acepta %s", (url) => {
    expect(esUrlMapa(url)).toBe(true);
  });

  it.each([
    ["http (no https)", "http://www.google.com/maps/place/x"],
    ["otro host", "https://maps.example.com/maps"],
    ["google.com sin /maps", "https://www.google.com/search?q=x"],
    ["maps pegado a otra cosa", "https://www.google.com/mapsevil"],
    ["un host que termina igual", "https://evilgoogle.com/maps"],
    ["usuario en la URL", "https://google.com@evil.com/maps"],
    ["con puerto", "https://www.google.com:8443/maps"],
    ["javascript:", "javascript:alert(1)"],
    ["con espacios", "https://www.google.com/maps/place/a b"],
    ["con comillas", 'https://www.google.com/maps/"x'],
    ["con < >", "https://www.google.com/maps/<b>"],
    ["maps.app.goo.gl sin código", "https://maps.app.goo.gl/"],
    ["mayúsculas en el host", "https://WWW.GOOGLE.COM/maps"],
    ["demasiado largo", `https://www.google.com/maps/${"a".repeat(LARGOS.url)}`],
  ])("rechaza %s", (_caso, url) => {
    expect(esUrlMapa(url)).toBe(false);
  });
});

describe("enlace de inscripción y correo", () => {
  it("el enlace: https con dominio, sin usuario ni puerto", () => {
    expect(esUrlHttps("https://forms.example.org/inscripcion?r=1")).toBe(true);
    expect(esUrlHttps("https://smt.gob.ar")).toBe(true);
    expect(esUrlHttps("http://smt.gob.ar")).toBe(false);
    expect(esUrlHttps("https://localhost/x")).toBe(false);
    expect(esUrlHttps("https://a@b.com")).toBe(false);
    expect(esUrlHttps("https://b.com:444/")).toBe(false);
    expect(esUrlHttps("javascript:alert(1)")).toBe(false);
    expect(esUrlHttps("https://b.com/<script>")).toBe(false);
  });

  it("el correo", () => {
    expect(esCorreo("mesa.entradas@smt.gob.ar")).toBe(true);
    expect(esCorreo("sin-arroba.smt.gob.ar")).toBe(false);
    expect(esCorreo("a b@smt.gob.ar")).toBe(false);
    expect(esCorreo("a@localhost")).toBe(false);
    expect(esCorreo("<a>@smt.gob.ar")).toBe(false);
  });
});

describe("textos", () => {
  it("una línea: espacios (y saltos) como uno solo, sin bordes; vacía es null", () => {
    expect(limpiarLinea("  De 7\n a   18 ")).toBe("De 7 a 18");
    expect(limpiarLinea("   ")).toBeNull();
    expect(limpiarLinea(null)).toBeNull();
  });

  it("párrafos: \\n sin \\r, sin espacios de más y a lo sumo una línea en blanco", () => {
    expect(limpiarParrafos("Uno  \r\n dos\r\n\r\n\r\n\r\nTres ")).toBe("Uno\ndos\n\nTres");
    expect(limpiarParrafos("\n\n")).toBeNull();
  });

  it("el HTML y el Markdown se guardan como texto (la página los escapa); los caracteres de control, no", () => {
    const r = leerEntradaSitio(EntradaPregunta, { pregunta: "¿<b>Hola</b>?", respuesta: "**así**", orden: 1, activa: true });
    expect(r).toMatchObject({ pregunta: "¿<b>Hola</b>?", respuesta: "**así**" });
    expect(errores(EntradaPregunta, { pregunta: "Hola\u0007", respuesta: "x", orden: 1, activa: true })).toEqual([
      { ruta: "pregunta", mensaje: "Tiene caracteres que no se pueden mostrar" },
    ]);
  });

  it("los largos máximos, con su mensaje", () => {
    expect(errores(EntradaPregunta, { pregunta: "x".repeat(LARGOS.pregunta + 1), respuesta: "y", orden: 0, activa: true })).toEqual([
      { ruta: "pregunta", mensaje: `Hasta ${LARGOS.pregunta} caracteres` },
    ]);
    expect(leerEntradaSitio(EntradaPregunta, { pregunta: "x".repeat(LARGOS.pregunta), respuesta: "y", orden: 0, activa: true }).pregunta).toHaveLength(LARGOS.pregunta);
  });

  it("lo obligatorio, con su mensaje; lo opcional vacío queda null", () => {
    expect(errores(EntradaRecorrido, { nombre: "  ", activo: true, orden: 0 })).toEqual([{ ruta: "nombre", mensaje: "Escribí el nombre del recorrido" }]);
    expect(leerEntradaSitio(EntradaRecorrido, { nombre: "Recorrido", descripcion: "", cupo: "  ", activo: true, orden: 0 })).toMatchObject({
      nombre: "Recorrido",
      descripcion: null,
      cupo: null,
      cementerioId: null,
      inscripcionUrl: null,
      foto: null,
    });
  });
});

describe("entradas", () => {
  it("un cementerio: la URL de mapa y la foto de la lista cerrada", () => {
    const base = { cementerioId: 1, visible: true };
    expect(errores(EntradaCementerioSitio, { ...base, mapaUrl: "https://example.com/mapa", foto: "otra" }).map((e) => e.ruta)).toEqual(["mapaUrl", "foto"]);
    expect(leerEntradaSitio(EntradaCementerioSitio, { ...base, mapaUrl: " https://maps.app.goo.gl/abc ", foto: "parque-memorial", horarioSemana: " De 7 a 18 " })).toMatchObject({
      mapaUrl: "https://maps.app.goo.gl/abc",
      foto: "parque-memorial",
      horarioSemana: "De 7 a 18",
      domicilio: null,
    });
  });

  it("el contacto: correo y mapa válidos o vacíos", () => {
    expect(errores(EntradaContacto, { correo: "no-es-correo", mapaUrl: "javascript:alert(1)" }).map((e) => e.ruta)).toEqual(["correo", "mapaUrl"]);
    expect(leerEntradaSitio(EntradaContacto, { correo: "", mapaUrl: "" })).toEqual({ domicilio: null, horario: null, telefono: null, correo: null, mapaUrl: null });
  });

  it("una novedad: fechas válidas y en orden", () => {
    const n = { titulo: "Corte", texto: "Por mantenimiento", activa: true };
    expect(errores(EntradaNovedad, { ...n, desde: "2026-11-10", hasta: "2026-11-09" })).toEqual([{ ruta: "hasta", mensaje: "Tiene que ser el mismo día que «Desde» o después" }]);
    expect(errores(EntradaNovedad, { ...n, desde: "2026-02-30", hasta: "2026-03-01" }).map((e) => e.ruta)).toEqual(["desde"]);
    expect(leerEntradaSitio(EntradaNovedad, { ...n, desde: "2026-11-01", hasta: "2026-11-01" })).toMatchObject({ desde: "2026-11-01", hasta: "2026-11-01" });
  });
});

describe("qué se muestra", () => {
  it("una novedad vigente: activa y hoy entre desde y hasta, inclusive", () => {
    const n = { activa: true, desde: "2026-10-30", hasta: "2026-11-02" };
    expect(novedadVigente(n, "2026-10-29")).toBe(false);
    expect(novedadVigente(n, "2026-10-30")).toBe(true);
    expect(novedadVigente(n, "2026-11-02")).toBe(true);
    expect(novedadVigente(n, "2026-11-03")).toBe(false);
    expect(novedadVigente({ ...n, activa: false }, "2026-11-01")).toBe(false);
  });

  it("las fechas próximas: solo las futuras, de la más cercana a la más lejana, hasta 6", () => {
    const ahora = new Date("2026-10-28T15:00:00Z");
    const f = (iso: string) => ({ fecha: new Date(iso) });
    const fechas = [
      f("2026-10-28T15:00:00Z"), // ahora mismo: ya no
      f("2026-10-27T10:00:00Z"),
      ...Array.from({ length: 8 }, (_, i) => f(`2026-11-${String(10 - i).padStart(2, "0")}T13:00:00Z`)),
    ];
    const r = fechasProximas(fechas, ahora);
    expect(r).toHaveLength(6);
    expect(r.map((x) => x.fecha.toISOString().slice(0, 10))).toEqual(["2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"]);
  });

  it("las fotos: claves únicas y archivos de public/assets/cementeria", () => {
    expect(new Set(FOTOS_SITIO.map((f) => f.clave)).size).toBe(FOTOS_SITIO.length);
    for (const f of FOTOS_SITIO) {
      expect(f.chica).toMatch(/^\/assets\/cementeria\/[a-z0-9-]+-960\.webp$/);
      // La grande es el original del kit; la chica, su versión de 960 px.
      expect(f.grande).toBe(f.chica.replace("-960.webp", ".webp"));
      expect(f.alt).toMatch(/ilustrativa/);
      expect(existsSync(path.join("public", f.chica)), f.chica).toBe(true);
      expect(existsSync(path.join("public", f.grande)), f.grande).toBe(true);
    }
    expect(fotoSitio("panoramica")?.grande).toBe("/assets/cementeria/hero-landing.webp");
    expect(fotoSitio("no-existe")).toBeNull();
    expect(fotoSitio(null)).toBeNull();
  });
});

describe("los mismos límites que la migración *_sitio_publico", () => {
  const sql = readFileSync(path.join("prisma", "migrations", "20261028180000_sitio_publico", "migration.sql"), "utf8");

  it("la lista cerrada de fotos del CHECK es la de FOTOS_SITIO", () => {
    const listas = [...sql.matchAll(/foto IN \(([^)]*)\)/g)].map((m) => m[1].split(",").map((x) => x.trim().replace(/'/g, "")).sort());
    expect(listas).toHaveLength(2);
    for (const l of listas) expect(l).toEqual([...FOTOS_SITIO.map((f) => f.clave)].sort());
  });

  it.each([
    ["domicilio", LARGOS.domicilio],
    ["que_tiene", LARGOS.queTiene],
    ["horario_semana", LARGOS.horario],
    ["horario_especial", LARGOS.horarioEspecial],
    ["dias_hora", LARGOS.diasHora],
    ["punto_encuentro", LARGOS.puntoEncuentro],
    ["titulo", LARGOS.tituloNovedad],
    ["texto", LARGOS.textoNovedad],
    ["telefono", LARGOS.telefono],
    ["pregunta", LARGOS.pregunta],
    ["respuesta", LARGOS.respuesta],
  ])("%s: hasta %i", (columna, largo) => {
    expect(sql).toContain(`char_length(${columna}) BETWEEN 1 AND ${largo} `);
  });
});
