import { Mistral } from "@mistralai/mistralai";

// v3 legacy build: last CommonJS release, loads in the extension host without ESM shims
const pdfjs = require("pdfjs-dist/legacy/build/pdf.js");
// the extension host is Electron, where pdf.js does not detect Node and looks for a
// web Worker — provide the worker module on the main thread instead
(globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = require("pdfjs-dist/legacy/build/pdf.worker.js");

export interface PdfSignals {
  arxivId?: string;
  doi?: string;
}

/**
 * Identifier hunt without OCR: filename, embedded text layer of the first two
 * pages, PDF metadata and link annotations. Works for born-digital PDFs;
 * returns empty signals for pure scans.
 */
export async function extractPdfSignals(data: Uint8Array, fileName: string): Promise<PdfSignals> {
  const signals: PdfSignals = {};
  const fromName = fileName.replace(/\.pdf$/i, "").match(/^(\d{4}\.\d{4,5})(v\d+)?$/);
  if (fromName) {
    signals.arxivId = fromName[1] + (fromName[2] ?? "");
  }

  let text = "";
  const uris: string[] = [];
  try {
    const doc = await pdfjs.getDocument({
      data: Uint8Array.from(data),
      isEvalSupported: false,
    }).promise;
    const pageCount = Math.min(doc.numPages, 2);
    for (let n = 1; n <= pageCount; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      text += content.items.map((item: { str?: string }) => item.str ?? "").join(" ") + "\n";
      for (const annotation of await page.getAnnotations()) {
        if (typeof annotation.url === "string") {
          uris.push(annotation.url);
        }
      }
    }
    const meta = await doc.getMetadata().catch(() => undefined);
    const metaDoi = meta?.metadata?.get?.("prism:doi") ?? (meta?.info as { doi?: unknown })?.doi;
    if (typeof metaDoi === "string") {
      uris.push(metaDoi);
    }
    await doc.destroy();
  } catch (err) {
    // no text layer / unparseable pdf — filename signal may still be set
    console.warn("WarpCite: pdf signal extraction failed:", err);
  }

  if (!signals.arxivId) {
    const m = text.match(
      /arXiv:\s*(\d{4}\.\d{4,5}(?:v\d+)?|[a-z-]+(?:\.[A-Z]{2})?\/\d{7}(?:v\d+)?)/i
    );
    if (m) {
      signals.arxivId = m[1];
    }
  }
  const doi = `${text}\n${uris.join("\n")}`.match(/\b10\.\d{4,9}\/[^\s"'<>{}]+/);
  if (doi) {
    signals.doi = doi[0].replace(/[).,;\]]+$/, "");
  }
  return signals;
}

/** Canonical BibTeX from arXiv's export endpoint, DataCite DOI as fallback. */
export async function resolveArxiv(arxivId: string): Promise<string | undefined> {
  const bare = arxivId.replace(/v\d+$/, "");
  const viaExport = await fetchText(`https://arxiv.org/bibtex/${bare}`);
  if (viaExport && looksLikeBibtex(viaExport)) {
    return viaExport;
  }
  return resolveDoi(`10.48550/arXiv.${bare}`);
}

/** Canonical BibTeX via doi.org content negotiation (Crossref/DataCite). */
export async function resolveDoi(doi: string): Promise<string | undefined> {
  const text = await fetchText(`https://doi.org/${doi}`, { Accept: "application/x-bibtex" });
  return text && looksLikeBibtex(text) ? text : undefined;
}

async function fetchText(
  url: string,
  headers: Record<string, string> = {}
): Promise<string | undefined> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "WarpCite VSCode extension", ...headers },
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
    });
    return res.ok ? await res.text() : undefined;
  } catch {
    return undefined;
  }
}

function looksLikeBibtex(text: string): boolean {
  return /^\s*@\w+\s*\{/.test(text);
}

/** Replace the entry's citation key, keeping the entry type. */
export function rekey(bibtex: string, key: string): string {
  return bibtex.replace(/@(\w+)\s*\{\s*[^,\s]+\s*,/, `@$1{${key},`);
}

// --- Mistral OCR document annotation fallback ------------------------------

export interface BibFields {
  entry_type?: string;
  title?: string;
  authors?: string[];
  year?: string;
  journal_or_venue?: string;
  publisher?: string;
  doi?: string;
  isbn?: string;
  url?: string;
}

const BIB_ANNOTATION_FORMAT = {
  type: "json_schema" as const,
  jsonSchema: {
    name: "bibliographic_metadata",
    schemaDefinition: {
      type: "object",
      properties: {
        entry_type: {
          type: "string",
          description: "BibTeX entry type: article, book, inproceedings, techreport, phdthesis, misc",
        },
        title: { type: "string" },
        authors: { type: "array", items: { type: "string" }, description: "Full author names" },
        year: { type: "string" },
        journal_or_venue: { type: "string" },
        publisher: { type: "string" },
        doi: { type: "string" },
        isbn: { type: "string" },
        url: { type: "string" },
      },
      required: ["title"],
      additionalProperties: false,
    },
  },
};

/**
 * Bibliographic fields via Mistral OCR document annotation of the first two
 * pages. Costs one OCR call — callers must get the user's consent first.
 */
export async function extractViaMistralAnnotation(
  apiKey: string,
  data: Uint8Array,
  fileName: string,
  model = "mistral-ocr-latest"
): Promise<BibFields | undefined> {
  const client = new Mistral({ apiKey });
  const uploaded = await client.files.upload({
    file: { fileName, content: data },
    purpose: "ocr",
  });
  const signedUrl = await client.files.getSignedUrl({ fileId: uploaded.id });
  const annotate = (pages: number[]) =>
    client.ocr.process({
      model,
      document: { type: "document_url", documentUrl: signedUrl.url },
      pages,
      documentAnnotationFormat: BIB_ANNOTATION_FORMAT,
      includeImageBase64: false,
    });
  const result = await annotate([0, 1]).catch(() => annotate([0]));
  const raw = (result as { documentAnnotation?: unknown }).documentAnnotation;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return undefined;
    }
  }
  return raw && typeof raw === "object" ? (raw as BibFields) : undefined;
}

const ENTRY_TYPES = new Set([
  "article",
  "book",
  "booklet",
  "inproceedings",
  "incollection",
  "proceedings",
  "techreport",
  "phdthesis",
  "mastersthesis",
  "misc",
  "unpublished",
]);

export function buildBibFromFields(fields: BibFields, key: string, pdfName: string): string {
  const type = ENTRY_TYPES.has((fields.entry_type ?? "").toLowerCase())
    ? (fields.entry_type as string).toLowerCase()
    : "misc";
  const esc = (v: string) => v.replace(/[{}]/g, "").trim();
  const lines: string[] = [];
  const add = (k: string, v?: string) => {
    if (v && v.trim()) {
      lines.push(`  ${k} = {${esc(v)}},`);
    }
  };
  add("title", fields.title);
  add("author", fields.authors?.filter(Boolean).join(" and "));
  add("year", fields.year);
  if (fields.journal_or_venue) {
    add(
      type === "article" ? "journal" : type === "inproceedings" ? "booktitle" : "howpublished",
      fields.journal_or_venue
    );
  }
  add("publisher", fields.publisher);
  add("doi", fields.doi);
  add("isbn", fields.isbn);
  add("url", fields.url);
  lines.push(`  note = {Extracted by WarpCite from OCR annotation of ${esc(pdfName)} - please verify},`);
  return `@Comment{WarpCite: autogenerated for ${pdfName} (from Mistral OCR annotation)}\n@${type}{${key},\n${lines.join("\n")}\n}\n`;
}
