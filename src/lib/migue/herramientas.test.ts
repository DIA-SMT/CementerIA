import { describe, expect, it, vi } from "vitest";
import type { Bandeja, ContadoresBandeja, FilaBandeja, Panel } from "@/lib/dominio/expedientes";
import { ErrorDominio } from "@/lib/dominio/expedientes/errores";
import { PermisoDenegado, type UsuarioPermisos } from "@/lib/dominio/permisos";
import type { PlantillaResumen } from "@/lib/dominio/plantillas/resumen";
import {
  CAMPOS_PERMITIDOS,
  DEFINICIONES,
  ejecutarHerramienta,
  interpretarLlamada,
  NOMBRES_HERRAMIENTAS,
  salidaEstado,
  soloCamposPermitidos,
  type ServiciosHerramientas,
} from "./herramientas";
import { fichaConDatosPersonales } from "./datos-de-prueba";

// Todo ficticio. Los datos personales de abajo son los que NUNCA tienen que
// salir de una herramienta: si alguno aparece en una salida, la prueba falla.
const PERSONALES = [
  "FICTICIO",
  "Anacleta",
  "99999001",
  "20999990015",
  "30999990013",
  "Calle Ficticia",
  "0381 000-0123",
  "vecina@ejemplo.test",
  "Sección A, fila 3, número 12",
  "Observación con un dato reservado",
  "Motivo de la devolución reservado",
  "carta-documento.pdf",
  "U. Interno",
];

const OPERADOR: UsuarioPermisos = { id: 10, rol: "operador", activo: true, area: { id: 3, codigo: "COMPUTO" } };
const DIRECCION: UsuarioPermisos = { id: 11, rol: "lectura", activo: true, area: { id: 9, codigo: "DIRECCION" } };

function fila(numero: string, extra: Partial<FilaBandeja> = {}): FilaBandeja {
  return {
    numero,
    numeroCorto: numero.slice(-2),
    numeroMunicipal: null,
    titular: "FICTICIO, Anacleta",
    tramite: { tipo: "Renovación de concesión", plantilla: "Renovación de contado", codigo: "RENOV_CONTADO", version: 1 },
    paso: { clave: "COMPUTO", nombre: "Cómputo", orden: 2, total: 7 },
    estado: "en_tramite",
    version: 1,
    areaActual: { codigo: "COMPUTO", nombre: "Cómputo", externa: false },
    areaResponsable: { codigo: "COMPUTO", nombre: "Cómputo" },
    enAreaDesde: new Date("2026-10-28T13:00:00Z"),
    enAreaDesdePrecision: "minuto",
    recibidoEn: null,
    diasEnArea: 5,
    diasAlerta: 3,
    demorado: true,
    etiquetas: [{ tipo: "devuelto", porArea: "Asesoría Legal", desdePaso: "Legal", motivo: "Motivo de la devolución reservado" }],
    soloConsulta: false,
    puedeConfirmar: true,
    paseRapido: null,
    ...extra,
  } as FilaBandeja;
}

const CONTADORES: ContadoresBandeja = { por_confirmar: 1, en_mi_area: 2, afuera: 0, afueraCustodia: 0, plazos: 1, plazosAlerta: 1, carga_historica: 0 };

function servicios(): ServiciosHerramientas {
  const plazo = { tipo: "plazo" as const, desde: "2026-10-01", diasHabiles: 30, cumplidoEn: null, vence: "2026-11-01", faltan: -1, provisorio: false, aniosSinCerrar: [], semaforo: "vencido" as const, texto: "venció" };
  return {
    obtenerFicha: vi.fn(async () => fichaConDatosPersonales()),
    bandeja: vi.fn(async (_u, pestana) => ({ pestana, area: { id: 3, codigo: "COMPUTO" }, hayMas: false, filas: pestana === "plazos" ? [fila("CEM-2026-00050", { demorado: false, etiquetas: [plazo] })] : [fila("CEM-2026-00042")] }) as Bandeja),
    contadoresBandeja: vi.fn(async () => CONTADORES),
    panel: vi.fn(
      async () =>
        ({
          demorados: { cantidad: 1, filas: [{ numero: "CEM-2026-00042", numeroCorto: "42/2026", titular: "FICTICIO, Anacleta", tramite: "Renovación", paso: "Cómputo", areaActual: { codigo: "COMPUTO", nombre: "Cómputo" }, enAreaDesde: new Date(), diasEnArea: 5, diasAlerta: 3 }], busqueda: null },
          plazos: {
            porVencer: { cantidad: 0, filas: [], busqueda: null },
            vencidos: { cantidad: 1, filas: [{ numero: "CEM-2026-00050", numeroCorto: "50/2026", titular: "FICTICIO, Anacleta", tramite: "Renovación", paso: "DIM", areaActual: { codigo: "DIM", nombre: "DIM" }, enAreaDesde: new Date(), diasEnArea: 31, diasAlerta: 30, plazo }], busqueda: null },
          },
        }) as unknown as Panel,
    ),
    plantillas: vi.fn(
      async (): Promise<PlantillaResumen[]> => [
        {
          codigo: "INHUMACION_DIRECCION",
          nombre: "Inhumación (Dirección)",
          tipoTramite: "Inhumación",
          formaPago: "contado",
          pasos: [{ orden: 1, nombre: "Mesa de Entradas", area: "Mesa de Entradas", custodia: null, esperaPagoDim: false, omitible: false, diasAlerta: 2, plazoDiasHabiles: null, subtareas: [{ nombre: "Recibir el certificado", obligatoria: true }] }],
          documentos: [{ nombre: "Certificado de defunción", origen: "concesionario", obligatorio: true }],
        },
      ],
    ),
  };
}

/** Todas las claves de un valor, en cualquier nivel. */
function claves(valor: unknown, acumuladas = new Set<string>()): Set<string> {
  if (Array.isArray(valor)) for (const v of valor) claves(v, acumuladas);
  else if (valor && typeof valor === "object") {
    for (const [k, v] of Object.entries(valor)) {
      acumuladas.add(k);
      claves(v, acumuladas);
    }
  }
  return acumuladas;
}

function sinDatosPersonales(salida: unknown) {
  const texto = JSON.stringify(salida);
  for (const dato of PERSONALES) expect(texto, `«${dato}» salió de una herramienta`).not.toContain(dato);
  for (const k of claves(salida)) expect(CAMPOS_PERMITIDOS.has(k), `la clave «${k}» no está en la lista cerrada`).toBe(true);
}

describe("la lista cerrada de campos de las herramientas", () => {
  it("estado_expediente arma la salida campo por campo, sin personas, ubicación, observaciones, motivos ni adjuntos", () => {
    const salida = salidaEstado(fichaConDatosPersonales());
    sinDatosPersonales(salida);
    expect(salida).toMatchObject({
      numero: "CEM-2026-00042",
      tramite: "Renovación de concesión",
      estado: "En trámite",
      paso: { orden: 2, total: 7, nombre: "Cómputo" },
      areaActual: "Cómputo",
      enAreaDesde: "2026-10-28",
      recibido: false,
      diasEnArea: 4,
      diasAlerta: 3,
      demorado: true,
      alertas: ["Sin confirmar recepción", "Devuelto", "Demorado"],
      faltaParaElPase: [
        { tipo: "subtarea", nombre: "Verificar el padrón" },
        { tipo: "documento", nombre: "Título de la concesión" },
      ],
      puedeDarPase: false,
      puedeConfirmarRecepcion: true,
    });
  });

  it.each(NOMBRES_HERRAMIENTAS)("%s, corrida de punta a punta con servicios que devuelven datos personales, no deja salir ninguno", async (nombre) => {
    const args = { estado_expediente: { numero: "42/2026" }, mi_bandeja: { filtro: "todas" }, vencidos_y_demorados: {}, plantilla_tramite: { tipo: "inhumación" }, como_se_hace: { tema: "confirmar recepción" } }[nombre];
    for (const usuario of [OPERADOR, DIRECCION]) {
      const r = await ejecutarHerramienta(interpretarLlamada({ id: "1", type: "function", function: { name: nombre, arguments: JSON.stringify(args) } }), {
        usuario,
        perfil: usuario === OPERADOR ? "operador" : "direccion",
        servicios: servicios(),
      });
      sinDatosPersonales(r.datos);
    }
  });

  it("soloCamposPermitidos descarta lo que no está en la lista, en cualquier nivel, y lo que no es un dato plano", () => {
    expect(soloCamposPermitidos({ numero: "CEM-2026-00001", titular: "FICTICIO", expedientes: [{ numero: "x", dni: "99999001" }], fecha: new Date() })).toEqual({
      numero: "CEM-2026-00001",
      expedientes: [{ numero: "x" }],
    });
    for (const prohibida of ["titular", "dni", "cuil", "cuit", "apellido", "nombres", "domicilio", "telefono", "email", "ubicacion", "observaciones", "observacion", "motivo", "adjuntos", "personas", "usuario"]) {
      expect(CAMPOS_PERMITIDOS.has(prohibida), prohibida).toBe(false);
    }
  });
});

describe("las herramientas respetan el dominio", () => {
  it("mi_bandeja sin bandeja (Dirección) lo dice y no llama a la bandeja", async () => {
    const s = servicios();
    const r = await ejecutarHerramienta(interpretarLlamada({ id: "1", type: "function", function: { name: "mi_bandeja", arguments: '{"filtro":"todas"}' } }), { usuario: DIRECCION, perfil: "direccion", servicios: s });
    expect(r.datos.error).toMatch(/no tiene bandeja/);
    expect(s.bandeja).not.toHaveBeenCalled();
  });

  it("vencidos_y_demorados: el operador ve su bandeja; Dirección, el panel", async () => {
    const op = await ejecutarHerramienta({ ok: true, id: "1", nombre: "vencidos_y_demorados", argumentos: {} }, { usuario: OPERADOR, perfil: "operador", servicios: servicios() });
    expect(op.datos).toMatchObject({ demorados: { cantidad: 1 }, plazosVencidos: { cantidad: 1, expedientes: [{ numero: "CEM-2026-00050", vence: "2026-11-01" }] } });
    expect(String(op.datos.alcance)).toMatch(/tu área/);
    const dir = await ejecutarHerramienta({ ok: true, id: "1", nombre: "vencidos_y_demorados", argumentos: {} }, { usuario: DIRECCION, perfil: "direccion", servicios: servicios() });
    expect(String(dir.datos.alcance)).toMatch(/panel general/);
    expect(dir.numeros.sort()).toEqual(["CEM-2026-00042", "CEM-2026-00050"]);
  });

  it("un permiso denegado o un expediente que no existe vuelven como un resultado, sin tirar", async () => {
    const s = servicios();
    vi.mocked(s.obtenerFicha).mockRejectedValueOnce(new PermisoDenegado("ver_expediente", "usuario_inactivo"));
    const negado = await ejecutarHerramienta(interpretarLlamada({ id: "1", type: "function", function: { name: "estado_expediente", arguments: '{"numero":"CEM-2026-00042"}' } }), { usuario: OPERADOR, perfil: "operador", servicios: s });
    expect(negado).toEqual({ datos: { error: "Con tu usuario no podés ver eso." }, numeros: [] });
    vi.mocked(s.obtenerFicha).mockRejectedValueOnce(new ErrorDominio("no_encontrado", "No existe"));
    const noExiste = await ejecutarHerramienta(interpretarLlamada({ id: "1", type: "function", function: { name: "estado_expediente", arguments: '{"numero":"CEM-2026-00999"}' } }), { usuario: OPERADOR, perfil: "operador", servicios: s });
    expect(noExiste.datos).toEqual({ error: "No encontré el expediente CEM-2026-00999." });
  });
});

describe("interpretarLlamada: el parseo de lo que pide el modelo", () => {
  const llamada = (name: string, args: string) => interpretarLlamada({ id: "c1", type: "function", function: { name, arguments: args } });

  it("normaliza el número de expediente (las dos formas) y valida los argumentos", () => {
    expect(llamada("estado_expediente", '{"numero":"cem 2026 42"}')).toEqual({ ok: true, id: "c1", nombre: "estado_expediente", argumentos: { numero: "CEM-2026-00042" } });
    expect(llamada("estado_expediente", '{"numero":"42/2026"}')).toMatchObject({ ok: true, argumentos: { numero: "CEM-2026-00042" } });
    expect(llamada("estado_expediente", '{"numero":"99999001"}')).toMatchObject({ ok: false, error: expect.stringMatching(/no es un número de expediente/) });
    expect(llamada("mi_bandeja", '{"filtro":""}')).toMatchObject({ ok: true, argumentos: { filtro: "todas" } });
    expect(llamada("mi_bandeja", '{"filtro":"todo"}')).toMatchObject({ ok: false });
    expect(llamada("vencidos_y_demorados", "")).toMatchObject({ ok: true, argumentos: {} });
    expect(llamada("plantilla_tramite", `{"tipo":"${"x".repeat(101)}"}`)).toMatchObject({ ok: false });
    expect(llamada("como_se_hace", '{"tema":"  dar pase  "}')).toMatchObject({ ok: true, argumentos: { tema: "dar pase" } });
  });

  it("rechaza una herramienta que no existe, JSON roto o argumentos que no son un objeto", () => {
    expect(llamada("borrar_expediente", "{}")).toMatchObject({ ok: false, error: expect.stringMatching(/No hay ninguna herramienta/) });
    expect(llamada("estado_expediente", "{numero:")).toMatchObject({ ok: false, error: expect.stringMatching(/JSON/) });
    expect(llamada("estado_expediente", "[1]")).toMatchObject({ ok: false });
  });

  it("las definiciones son estrictas y son exactamente las cinco", () => {
    expect(DEFINICIONES.map((d) => d.function.name)).toEqual([...NOMBRES_HERRAMIENTAS]);
    for (const d of DEFINICIONES) {
      expect(d.function.strict).toBe(true);
      expect(d.function.parameters.additionalProperties).toBe(false);
      expect(d.function.parameters.required.sort()).toEqual(Object.keys(d.function.parameters.properties).sort());
    }
  });
});
