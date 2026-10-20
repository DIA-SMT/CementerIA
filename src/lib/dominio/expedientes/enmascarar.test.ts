import { describe, expect, it } from "vitest";
import { enmascararDomicilio, enmascararEmail, enmascararTelefono, mostrarContacto } from "./enmascarar";

describe("enmascarado del contacto (decisión 13)", () => {
  it("teléfono: se ven los dos últimos dígitos y el formato", () => {
    expect(enmascararTelefono("0381 456-7890")).toBe("•••• •••-••90");
    expect(enmascararTelefono("+54 9 381 4567890")).toBe("+•• • ••• •••••90");
  });

  it("correo: solo las iniciales", () => {
    expect(enmascararEmail("maria.perez@correo.com.ar")).toBe("m•••@c•••");
    expect(enmascararEmail("sinarroba")).toBe("•••");
  });

  it("domicilio: nada", () => {
    expect(enmascararDomicilio("Calle Ficticia 123")).toBe("•••");
  });

  it("completo o enmascarado", () => {
    const c = { telefono: "0381 456-7890", telefonoWhatsapp: true, email: "a@b.c", domicilio: "Calle 1", };
    expect(mostrarContacto(c, true)).toEqual({ ...c, enmascarado: false });
    expect(mostrarContacto(c, false)).toEqual({
      telefono: "•••• •••-••90",
      telefonoWhatsapp: true,
      email: "a•••@b•••",
      domicilio: "•••",
      enmascarado: true,
    });
    expect(mostrarContacto({ telefono: null, telefonoWhatsapp: false, email: null, domicilio: null }, false)).toMatchObject({
      telefono: null,
      email: null,
      domicilio: null,
    });
  });
});
