const WINDOWS_1252_CODE_POINTS: Record<number, number> = {
  128: 0x20ac,
  130: 0x201a,
  131: 0x0192,
  132: 0x201e,
  133: 0x2026,
  134: 0x2020,
  135: 0x2021,
  136: 0x02c6,
  137: 0x2030,
  138: 0x0160,
  139: 0x2039,
  140: 0x0152,
  142: 0x017d,
  145: 0x2018,
  146: 0x2019,
  147: 0x201c,
  148: 0x201d,
  149: 0x2022,
  150: 0x2013,
  151: 0x2014,
  152: 0x02dc,
  153: 0x2122,
  154: 0x0161,
  155: 0x203a,
  156: 0x0153,
  158: 0x017e,
  159: 0x0178
};

export function decodeXmlText(value: string) {
  let decoded = value;

  // QuickBooks can return HTML-style numeric entities escaped inside XML
  // (for example, &amp;#241;). Decode a few layers so both forms are handled.
  for (let pass = 0; pass < 4; pass += 1) {
    const next = decoded
      .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, rawCode: string) => decodeNumericEntity(rawCode))
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&gt;/g, ">")
      .replace(/&lt;/g, "<")
      .replace(/&amp;/g, "&");

    if (next === decoded) break;
    decoded = next;
  }

  return decoded.replace(/\u00a0/g, " ");
}

function decodeNumericEntity(rawCode: string) {
  const numericCode = rawCode[0]?.toLowerCase() === "x"
    ? Number.parseInt(rawCode.slice(1), 16)
    : Number.parseInt(rawCode, 10);
  const codePoint = WINDOWS_1252_CODE_POINTS[numericCode] || numericCode;

  if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
    return "\ufffd";
  }

  return String.fromCodePoint(codePoint);
}
