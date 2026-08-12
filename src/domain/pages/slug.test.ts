import { describe, expect, it } from "vitest";
import { copyName, copySlug, generateSlug } from "./slug";

describe("page slug generation", () => {
  it.each([
    ["Contact Us", "contact-us"],
    ["  About   Us  ", "about-us"],
    ["Products & Services", "products-services"],
    ["HELLO WORLD", "hello-world"],
  ])("normalizes %s", (name, expected) => expect(generateSlug(name)).toBe(expected));

  it("rejects names with no usable URL characters", () => {
    expect(() => generateSlug("& !!!")).toThrowError(/custom slug/);
  });

  it("creates deterministic copy names and slugs", () => {
    expect(copyName("Services", 1)).toBe("Services Copy");
    expect(copyName("Services", 2)).toBe("Services Copy 2");
    expect(copySlug("services", 1)).toBe("services-copy");
    expect(copySlug("services", 2)).toBe("services-copy-2");
  });
});
