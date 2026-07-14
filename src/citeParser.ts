import * as vscode from "vscode";

export interface CiteCall {
  /** offset of `#dhbwCite(` */
  start: number;
  /** offset just past the closing `)` */
  end: number;
  /** offsets of the argument list (inside the parens) */
  argsStart: number;
  argsEnd: number;
  name: string | undefined;
  page: string | undefined;
  highlight: { from: number; to: number } | undefined;
}

/** The configured Typst citation function name (default dhbwCite). */
export function citationFunctionName(): string {
  const name = vscode.workspace
    .getConfiguration("warpcite")
    .get<string>("citationFunction", "dhbwCite")
    .trim();
  return name.length > 0 ? name : "dhbwCite";
}

/** All #<citationFunction>(...) calls in the text, with parens balanced (highlight: (10,20)). */
export function findCiteCalls(text: string, functionName = citationFunctionName()): CiteCall[] {
  const calls: CiteCall[] = [];
  const re = new RegExp(`#${functionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\(`, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    const start = match.index;
    const argsStart = re.lastIndex;
    let depth = 1;
    let i = argsStart;
    while (i < text.length && depth > 0) {
      const ch = text[i];
      if (ch === "(") {
        depth++;
      } else if (ch === ")") {
        depth--;
      }
      i++;
    }
    const argsEnd = i - 1;
    const args = text.slice(argsStart, argsEnd);
    const page = args.match(/\bpage\s*:\s*(?:"([^"]*)"|(\w+))/);
    const highlight = args.match(/\bhighlight\s*:\s*\(\s*(\d+)\s*,\s*(\d+)\s*\)/);
    calls.push({
      start,
      end: i,
      argsStart,
      argsEnd,
      name: args.match(/"([^"]*)"/)?.[1],
      page: page ? (page[1] ?? page[2]) : undefined,
      highlight: highlight
        ? { from: parseInt(highlight[1], 10), to: parseInt(highlight[2], 10) }
        : undefined,
    });
    re.lastIndex = i;
  }
  return calls;
}

export function citeCallAt(
  text: string,
  offset: number,
  functionName = citationFunctionName()
): CiteCall | undefined {
  return findCiteCalls(text, functionName).find((c) => offset >= c.start && offset <= c.end);
}

export interface OcrPage {
  index: number;
  page: string | null;
  markdown?: string;
  header?: string | null;
  footer?: string | null;
  images?: { id?: string; imageBase64?: string }[];
}

export interface OcrResult {
  pages?: OcrPage[];
}

/** Match by printed page number first, PDF position (index + 1) as fallback. */
export function resolvePage(pages: OcrPage[], pageArg: string): OcrPage | undefined {
  return (
    pages.find((p) => p.page === pageArg) ?? pages.find((p) => p.index + 1 === Number(pageArg))
  );
}

/** Wrap the (from, to) char range of the markdown in <mark> tags, clamped to bounds. */
export function highlightRange(markdown: string, from: number, to: number): string {
  const f = Math.max(0, Math.min(markdown.length, from));
  const t = Math.max(f, Math.min(markdown.length, to));
  if (t <= f) {
    return markdown;
  }
  return `${markdown.slice(0, f)}<mark>${markdown.slice(f, t)}</mark>${markdown.slice(t)}`;
}

/**
 * Replace image refs with data URIs from the page's embedded base64 images.
 * `budget` caps the total output length (hover tooltips truncate around 100k
 * chars) — images that would exceed it are replaced with a placeholder note.
 */
export function inlineImages(markdown: string, page: OcrPage, budget = Infinity): string {
  const images = page.images ?? [];
  let length = markdown.length;
  return markdown.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (whole, alt, src) => {
    const img = images.find((i) => i.id === src);
    if (!img || !img.imageBase64) {
      return whole;
    }
    const uri = img.imageBase64.startsWith("data:")
      ? img.imageBase64
      : `data:image/jpeg;base64,${img.imageBase64}`;
    if (length + uri.length > budget) {
      return `*[image ${src} omitted — too large for the tooltip]*`;
    }
    length += uri.length;
    return `![${alt}](${uri})`;
  });
}

/** The source folder's *.ocr.json, parsed — or undefined if absent/unreadable. */
export async function loadOcrForSource(sourceName: string): Promise<OcrResult | undefined> {
  const files = await vscode.workspace.findFiles(
    `**/${sourceName}/*.ocr.json`,
    "**/node_modules/**",
    1
  );
  if (files.length === 0) {
    return undefined;
  }
  try {
    return JSON.parse(new TextDecoder().decode(await vscode.workspace.fs.readFile(files[0])));
  } catch {
    return undefined;
  }
}
