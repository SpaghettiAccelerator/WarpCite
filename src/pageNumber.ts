const DECOR_CHARS = String.raw`\s\-–—.·•|\[\]()~*`;
const DECORATION = `[${DECOR_CHARS}]*`;
const PAGE_LABEL = /^(?:page|seite|p|s|pagina|página|pág)\.?\s+/i;
const ROMAN_NUMERAL = /^(?=[mdclxvi])m{0,3}(?:cm|cd|d?c{0,3})(?:xc|xl|l?x{0,3})(?:ix|iv|v?i{0,3})$/i;

/**
 * Printed page number from an OCR footer, as a string. Handles bare numbers
 * ("3"), labeled ("Page 3", "Seite 3"), pairs ("10 of 80", "10/70",
 * "Seite 10 von 70", "Página 10 de 80"), decoration ("- 3 -", "[3]", "3.",
 * "Page | 3"), footnote text preceding the number, and roman numerals used in
 * front matter ("iv", "- xii -", "Page iv"). Returns null when no page number
 * can be identified.
 *
 * Roman numerals are only accepted when the footer's last line is nothing but
 * the (optionally labeled/decorated) numeral — otherwise ordinary words that
 * happen to be valid numerals ("mix", "dim") in footnote text would match.
 */
export function parsePrintedPageNumber(footer: unknown): string | null {
  if (typeof footer !== "string") {
    return null;
  }
  const trimmed = footer.trim();

  const pair = trimmed.match(
    new RegExp(
      String.raw`(\d+)\s*(?:\/|\bof\b|\bvon\b|\bde\b|\bdi\b|\bsur\b|\bvan\b)\s*(\d+)${DECORATION}$`,
      "i"
    )
  );
  if (pair) {
    return pair[1];
  }

  const single = trimmed.match(new RegExp(String.raw`(\d+)${DECORATION}$`));
  if (single) {
    return single[1];
  }

  const lines = trimmed.split("\n");
  const lastLine = lines[lines.length - 1]
    .replace(new RegExp(`^[${DECOR_CHARS}]+`), "")
    .replace(new RegExp(`[${DECOR_CHARS}]+$`), "")
    .replace(PAGE_LABEL, "");
  if (ROMAN_NUMERAL.test(lastLine)) {
    return lastLine;
  }
  return null;
}
