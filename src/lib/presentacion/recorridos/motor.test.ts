import { describe, expect, it } from "vitest";
import {
  almacenDisponible,
  claveRecorrido,
  debeInvitar,
  diaLocal,
  invitacionPara,
  perfilDe,
  registrarDecision,
  reiniciarRecorridos,
  resolverPasos,
  textoPara,
  textoProgreso,
  type Almacen,
  type Recorrido,
} from "./motor";

/** Un localStorage de mentira (en memoria), con el mismo contrato. */
class AlmacenEnMemoria implements Almacen {
  private datos = new Map<string, string>();
  getItem(clave: string) {
    return this.datos.get(clave) ?? null;
  }
  setItem(clave: string, valor: string) {
    this.datos.set(clave, valor);
  }
  removeItem(clave: string) {
    this.datos.delete(clave);
  }
  get length() {
    return this.datos.size;
  }
  key(indice: number) {
    return [...this.datos.keys()][indice] ?? null;
  }
}

/** Uno que tira error en todo (cookies bloqueadas, modo privado estricto). */
const almacenRoto: Almacen = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
  removeItem: () => {
    throw new Error("SecurityError");
  },
  get length(): number {
    throw new Error("SecurityError");
  },
  key: () => {
    throw new Error("SecurityError");
  },
};

const RECORRIDO: Recorrido = {
  id: "bandeja",
  nombre: "Bandeja",
  version: 1,
  pasos: [
    { id: "intro", titulo: "Hola", texto: "Sin ancla: va centrado" },
    { id: "pestanas", ancla: "bandeja-pestanas", titulo: "Pestañas", texto: "Las pestañas" },
    { id: "pase", ancla: "ficha-acciones-paso", titulo: "Dar pase", texto: { operador: "Dale el pase" } },
    { id: "confirmar", ancla: ["bandeja-lote", "bandeja-confirmar"], titulo: "Confirmar", texto: "Confirmá" },
    {
      id: "por-rol",
      ancla: "panel-estados",
      titulo: { todos: "Estados", admin: "Estados (admin)" },
      texto: { operador: "Para operadores", direccion: "Para Dirección", todos: "Para todos" },
    },
  ],
};

const HOY = "2026-10-27";

describe("perfilDe", () => {
  it("separa Mesa de Entradas de los demás operadores, y Dirección (lectura) del admin", () => {
    expect(perfilDe({ rol: "operador", area: { codigo: "MESA_ENTRADAS" } })).toBe("mesa");
    expect(perfilDe({ rol: "operador", area: { codigo: "COMPUTO" } })).toBe("operador");
    expect(perfilDe({ rol: "operador", area: null })).toBe("operador");
    expect(perfilDe({ rol: "lectura", area: { codigo: "DIRECCION" } })).toBe("direccion");
    expect(perfilDe({ rol: "admin", area: null })).toBe("admin");
  });
});

describe("textoPara: textos por rol", () => {
  it("un texto común vale para todos", () => {
    expect(textoPara("Igual para todos", "admin")).toBe("Igual para todos");
  });
  it("el del perfil gana; si no, el de todos", () => {
    const t = { operador: "Operador", direccion: "Dirección", todos: "Todos" };
    expect(textoPara(t, "operador")).toBe("Operador");
    expect(textoPara(t, "direccion")).toBe("Dirección");
    expect(textoPara(t, "admin")).toBe("Todos");
  });
  it("Mesa de Entradas usa el de operador si no tiene uno propio", () => {
    expect(textoPara({ operador: "Operador", todos: "Todos" }, "mesa")).toBe("Operador");
    expect(textoPara({ mesa: "Mesa", operador: "Operador" }, "mesa")).toBe("Mesa");
  });
  it("sin texto para el perfil (ni común), null: ese perfil no ve el paso", () => {
    expect(textoPara({ operador: "Solo operadores" }, "direccion")).toBeNull();
    expect(textoPara({ mesa: "Solo Mesa" }, "operador")).toBeNull();
  });
});

describe("resolverPasos: salteo de pasos", () => {
  const todosSeVen = () => true;

  it("con todos los elementos a la vista, muestra los que tienen texto para el perfil", () => {
    expect(resolverPasos(RECORRIDO, "operador", todosSeVen).map((p) => p.id)).toEqual(["intro", "pestanas", "pase", "confirmar", "por-rol"]);
  });

  it("saltea el paso cuyo elemento no existe o no se ve (Dar pase para Dirección, otro ancho)", () => {
    const seVe = (ancla: string) => ancla !== "ficha-acciones-paso";
    expect(resolverPasos(RECORRIDO, "operador", seVe).map((p) => p.id)).toEqual(["intro", "pestanas", "confirmar", "por-rol"]);
  });

  it("saltea el paso sin texto para el perfil aunque el elemento esté", () => {
    expect(resolverPasos(RECORRIDO, "direccion", todosSeVen).map((p) => p.id)).toEqual(["intro", "pestanas", "confirmar", "por-rol"]);
  });

  it("con varias anclas, usa la primera que se ve; si no se ve ninguna, saltea el paso", () => {
    const sinLote = (ancla: string) => ancla !== "bandeja-lote";
    expect(resolverPasos(RECORRIDO, "operador", sinLote).find((p) => p.id === "confirmar")?.ancla).toBe("bandeja-confirmar");
    expect(resolverPasos(RECORRIDO, "operador", todosSeVen).find((p) => p.id === "confirmar")?.ancla).toBe("bandeja-lote");
    const ninguna = (ancla: string) => !ancla.startsWith("bandeja-");
    expect(resolverPasos(RECORRIDO, "operador", ninguna).map((p) => p.id)).toEqual(["intro", "pase", "por-rol"]);
  });

  it("el paso sin ancla siempre está (va centrado, sin resaltar nada)", () => {
    const nada = () => false;
    expect(resolverPasos(RECORRIDO, "admin", nada)).toEqual([{ id: "intro", titulo: "Hola", texto: "Sin ancla: va centrado", ancla: null }]);
  });

  it("los textos salen según el perfil", () => {
    const porRol = (perfil: Parameters<typeof resolverPasos>[1]) => resolverPasos(RECORRIDO, perfil, todosSeVen).find((p) => p.id === "por-rol");
    expect(porRol("operador")).toMatchObject({ titulo: "Estados", texto: "Para operadores" });
    expect(porRol("mesa")).toMatchObject({ titulo: "Estados", texto: "Para operadores" });
    expect(porRol("direccion")).toMatchObject({ titulo: "Estados", texto: "Para Dirección" });
    expect(porRol("admin")).toMatchObject({ titulo: "Estados (admin)", texto: "Para todos" });
  });

  it("no consulta el DOM por los pasos que el perfil no ve", () => {
    const consultadas: string[] = [];
    resolverPasos(RECORRIDO, "direccion", (a) => {
      consultadas.push(a);
      return true;
    });
    expect(consultadas).not.toContain("ficha-acciones-paso");
  });
});

describe("textoProgreso", () => {
  it("cuenta desde 1", () => {
    expect(textoProgreso(0, 6)).toBe("Paso 1 de 6");
    expect(textoProgreso(5, 6)).toBe("Paso 6 de 6");
  });
});

describe("persistencia", () => {
  it("la clave es por usuario, pantalla y versión", () => {
    expect(claveRecorrido(12, { id: "bandeja", version: 3 })).toBe("cementeria:recorrido:12:bandeja:v3");
  });

  it("la primera vez invita; después de empezarlo o de No volver a mostrar, no", () => {
    const a = new AlmacenEnMemoria();
    expect(debeInvitar(a, 1, RECORRIDO, HOY)).toBe(true);
    expect(registrarDecision(a, 1, RECORRIDO, "empezado", HOY)).toBe(true);
    expect(debeInvitar(a, 1, RECORRIDO, HOY)).toBe(false);

    const b = new AlmacenEnMemoria();
    registrarDecision(b, 1, RECORRIDO, "no_mostrar", HOY);
    expect(debeInvitar(b, 1, RECORRIDO, HOY)).toBe(false);
    expect(debeInvitar(b, 1, RECORRIDO, "2027-03-01")).toBe(false);
  });

  it("Ahora no: no vuelve a invitar ese día, sí otro día", () => {
    const a = new AlmacenEnMemoria();
    registrarDecision(a, 1, RECORRIDO, "ahora_no", HOY);
    expect(a.getItem(claveRecorrido(1, RECORRIDO))).toBe(`pospuesto:${HOY}`);
    expect(debeInvitar(a, 1, RECORRIDO, HOY)).toBe(false);
    expect(debeInvitar(a, 1, RECORRIDO, "2026-10-28")).toBe(true);
  });

  it("es por usuario: lo que contestó uno no vale para otro en la misma computadora", () => {
    const a = new AlmacenEnMemoria();
    registrarDecision(a, 1, RECORRIDO, "no_mostrar", HOY);
    expect(debeInvitar(a, 2, RECORRIDO, HOY)).toBe(true);
  });

  it("una versión nueva del recorrido vuelve a invitar", () => {
    const a = new AlmacenEnMemoria();
    registrarDecision(a, 1, RECORRIDO, "no_mostrar", HOY);
    expect(debeInvitar(a, 1, { ...RECORRIDO, version: 2 }, HOY)).toBe(true);
  });

  it("un valor que no se entiende vuelve a invitar", () => {
    const a = new AlmacenEnMemoria();
    a.setItem(claveRecorrido(1, RECORRIDO), "{raro}");
    expect(debeInvitar(a, 1, RECORRIDO, HOY)).toBe(true);
  });

  it("sin almacén funciona igual y vuelve a invitar", () => {
    expect(debeInvitar(null, 1, RECORRIDO, HOY)).toBe(true);
    expect(registrarDecision(null, 1, RECORRIDO, "no_mostrar", HOY)).toBe(false);
    expect(reiniciarRecorridos(null, 1)).toBeNull();
  });

  it("con un almacén que tira error, no rompe nada y vuelve a invitar", () => {
    expect(debeInvitar(almacenRoto, 1, RECORRIDO, HOY)).toBe(true);
    expect(registrarDecision(almacenRoto, 1, RECORRIDO, "empezado", HOY)).toBe(false);
    expect(reiniciarRecorridos(almacenRoto, 1)).toBeNull();
  });

  it("almacenDisponible prueba una escritura: null si leerlo o escribir falla", () => {
    const a = new AlmacenEnMemoria();
    expect(almacenDisponible(() => a)).toBe(a);
    expect(a.length).toBe(0);
    expect(almacenDisponible(() => almacenRoto)).toBeNull();
    expect(
      almacenDisponible(() => {
        throw new Error("SecurityError: el acceso a localStorage está bloqueado");
      }),
    ).toBeNull();
    expect(almacenDisponible(() => undefined)).toBeNull();
  });

  it("reiniciar borra todo lo de ese usuario (pantallas, versiones y bienvenida) y nada de otro", () => {
    const a = new AlmacenEnMemoria();
    registrarDecision(a, 1, RECORRIDO, "no_mostrar", HOY);
    registrarDecision(a, 1, { id: "bienvenida", version: 1 }, "empezado", HOY);
    registrarDecision(a, 1, { id: "ficha", version: 2 }, "ahora_no", HOY);
    registrarDecision(a, 2, RECORRIDO, "no_mostrar", HOY);
    a.setItem("otra-app", "x");
    expect(reiniciarRecorridos(a, 1)).toBe(3);
    expect(debeInvitar(a, 1, RECORRIDO, HOY)).toBe(true);
    expect(debeInvitar(a, 2, RECORRIDO, HOY)).toBe(false);
    expect(a.getItem("otra-app")).toBe("x");
  });
});

describe("invitacionPara", () => {
  const bienvenida: Recorrido = { id: "bienvenida", nombre: "CementerIA", version: 1, pasos: [] };

  it("primero la bienvenida; contestada, la de la pantalla; las dos contestadas, ninguna", () => {
    const a = new AlmacenEnMemoria();
    const candidatos = { bienvenida, pantalla: RECORRIDO };
    expect(invitacionPara(a, 1, candidatos, HOY)?.id).toBe("bienvenida");
    registrarDecision(a, 1, bienvenida, "no_mostrar", HOY);
    expect(invitacionPara(a, 1, candidatos, HOY)?.id).toBe("bandeja");
    registrarDecision(a, 1, RECORRIDO, "ahora_no", HOY);
    expect(invitacionPara(a, 1, candidatos, HOY)).toBeNull();
  });

  it("sin bienvenida (en /cambiar-clave) ni pantalla, nada", () => {
    expect(invitacionPara(new AlmacenEnMemoria(), 1, { bienvenida: null, pantalla: RECORRIDO }, HOY)?.id).toBe("bandeja");
    expect(invitacionPara(new AlmacenEnMemoria(), 1, { bienvenida: null, pantalla: null }, HOY)).toBeNull();
  });
});

describe("diaLocal", () => {
  it("AAAA-MM-DD con ceros", () => {
    expect(diaLocal(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  });
});
