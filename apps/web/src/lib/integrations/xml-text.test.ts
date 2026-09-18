import { describe, expect, it } from "vitest";
import { decodeXmlText } from "./xml-text";

describe("decodeXmlText", () => {
  it("decodes XML and numeric entities in QuickBooks wine names", () => {
    expect(decodeXmlText("Ver Sacrum Do&#241;a Mencia")).toBe("Ver Sacrum Doña Mencia");
    expect(decodeXmlText("RJ Vinedos Reuni&#243;n")).toBe("RJ Vinedos Reunión");
    expect(decodeXmlText("C&#244;te d&#146;Or")).toBe("Côte d’Or");
  });

  it("decodes numeric entities that QuickBooks escaped as XML text", () => {
    expect(decodeXmlText("Rogue Vine Pipe&amp;#241;o")).toBe("Rogue Vine Pipeño");
  });

  it("normalizes encoded non-breaking spaces", () => {
    expect(decodeXmlText("Domaine&#160;Fourrier")).toBe("Domaine Fourrier");
  });
});
