import { describe, expect, it } from "vitest";
import { CLAVE_PERFIL_ADMIN, descripcionPerfil, mostrarFranja, nombrePerfilEnFranja, nombreSelector } from "./perfil-prueba";

describe("textos del modo prueba", () => {
  it("la franja va mientras el perfil no sea Administrador", () => {
    expect(mostrarFranja(CLAVE_PERFIL_ADMIN)).toBe(false);
    expect(mostrarFranja("area:LIQUIDACION")).toBe(true);
    expect(mostrarFranja(null)).toBe(true);
  });

  it("nombres del perfil, del rol y del botón", () => {
    expect(nombrePerfilEnFranja({ etiqueta: "Liquidación", rol: "operador" })).toBe("Liquidación");
    expect(nombrePerfilEnFranja({ etiqueta: "Dirección", rol: "lectura" })).toBe("Dirección (solo lectura)");
    expect(nombrePerfilEnFranja(null)).toBe("un perfil que no es de la lista");
    expect(descripcionPerfil({ rol: "operador" })).toBe("Operador");
    expect(descripcionPerfil({ rol: "lectura" })).toBe("Solo lectura");
    expect(descripcionPerfil({ rol: "admin" })).toBe("Administrador del sistema");
    expect(nombreSelector({ etiqueta: "Liquidación" })).toBe("Ver como… (modo prueba, ahora Liquidación)");
    expect(nombreSelector(null)).toBe("Ver como… (modo prueba)");
  });
});
