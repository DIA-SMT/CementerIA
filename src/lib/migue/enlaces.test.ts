import { describe, expect, it } from "vitest";
import type { UsuarioPermisos } from "@/lib/dominio/permisos";
import { datosPublicosParaMigue } from "./datos-publicos";
import { LANDING, sitioDePrueba } from "./datos-de-prueba";
import { interpretarRespuesta } from "./enlaces";
import { validadorInterno } from "./interno";
import { validadorPublico } from "./publico";

const publico = validadorPublico(datosPublicosParaMigue(sitioDePrueba(), LANDING));

describe("interpretarRespuesta: las líneas de servicio, como las escribe el modelo", () => {
  it.each([
    "Podés seguirlo en la consulta.\nENLACE: /consulta",
    "Podés seguirlo en la consulta.\n**ENLACE:** /consulta",
    "Podés seguirlo en la consulta.\n- ENLACE: [Consultá tu trámite](/consulta)",
    "Podés seguirlo en la consulta.\n> ENLACE: /consulta/",
    "Podés seguirlo en la consulta.\nENLACES: /consulta, /inventada",
  ])("saca la línea y deja el enlace válido: %j", (crudo) => {
    expect(interpretarRespuesta(crudo, publico)).toEqual({
      texto: "Podés seguirlo en la consulta.",
      enlaces: [{ href: "/consulta", etiqueta: "Consultá tu trámite" }],
      sinRespuesta: false,
    });
  });

  it("la marca de sin respuesta se saca del texto y se informa", () => {
    expect(interpretarRespuesta("Eso no lo tengo. Consultalo en Mesa de Entradas. [SIN_RESPUESTA]\nENLACE: /contacto", publico)).toEqual({
      texto: "Eso no lo tengo. Consultalo en Mesa de Entradas.",
      enlaces: [{ href: "/contacto", etiqueta: "Contacto" }],
      sinRespuesta: true,
    });
  });

  it("un enlace inventado se descarta, y una URL que no es de los datos se saca del texto", () => {
    const r = interpretarRespuesta("Mirá [este sitio](https://otro.ejemplo.test/x) o https://inventada.ejemplo.test/turnos.\nENLACE: /turnos", publico);
    expect(r.enlaces).toEqual([]);
    expect(r.texto).toBe("Mirá este sitio o.");
    expect(r.texto).not.toContain("http");
  });

  it("las URL que cargó la Dirección (inscripción, mapa) sí, y las rutas del sitio escritas en el texto van como botón", () => {
    const r = interpretarRespuesta("Te inscribís en https://inscripcion.ejemplo.test/recorridos y las fechas están en /recorridos.", publico);
    expect(r.enlaces).toEqual([
      { href: "https://inscripcion.ejemplo.test/recorridos", etiqueta: "Inscripción" },
      { href: "/recorridos", etiqueta: "Recorridos históricos" },
    ]);
    expect(r.texto).toContain("https://inscripcion.ejemplo.test/recorridos");
  });

  it("como mucho tres enlaces", () => {
    const r = interpretarRespuesta("Mirá.\nENLACE: /horarios\nENLACE: /contacto\nENLACE: /tramites\nENLACE: /consulta", publico);
    expect(r.enlaces).toHaveLength(3);
  });
});

describe("validadorInterno: las pantallas del menú y la ficha de un expediente que devolvió una herramienta", () => {
  const operador: UsuarioPermisos = { id: 10, rol: "operador", activo: true, area: { id: 3, codigo: "COMPUTO" } };
  const validar = validadorInterno(operador, new Set(["CEM-2026-00042"]));

  it("acepta su menú y la ficha devuelta; rechaza lo que no le toca o no salió de una herramienta", () => {
    expect(validar("/bandeja")).toBe("Bandeja");
    expect(validar("/panel")).toBe("Panel");
    expect(validar("/avisos")).toBe("Avisos");
    expect(validar("/expedientes/CEM-2026-00042")).toBe("Abrir CEM-2026-00042");
    expect(validar("/expedientes/CEM-2026-00043")).toBeNull();
    expect(validar("/expedientes/42%2F2026")).toBeNull();
    expect(validar("/admin/usuarios")).toBeNull();
    expect(validar("/expedientes/nuevo")).toBeNull();
    expect(validar("https://cementeria.ejemplo.test/bandeja")).toBeNull();
  });

  it("de punta a punta: el número que no devolvió ninguna herramienta no va como enlace", () => {
    const r = interpretarRespuesta("Está en Cómputo.\nENLACE: /expedientes/CEM-2026-00042\nENLACE: /expedientes/CEM-2026-00099", validar);
    expect(r.enlaces).toEqual([{ href: "/expedientes/CEM-2026-00042", etiqueta: "Abrir CEM-2026-00042" }]);
  });
});
