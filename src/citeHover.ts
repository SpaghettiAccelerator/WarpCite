import * as vscode from "vscode";
import {
  citeCallAt,
  highlightRange,
  inlineImages,
  loadOcrForSource,
  resolvePage,
} from "./citeParser";

/**
 * Hover on `#dhbwCite("<source>", page: <n>, highlight: (from,to))` in .typ
 * files: renders the OCR markdown of the cited page, with the highlight range
 * marked.
 */
export function registerCiteHoverProvider(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.languages.registerHoverProvider([{ scheme: "file", pattern: "**/*.typ" }], {
      provideHover,
    })
  );
}

async function provideHover(
  document: vscode.TextDocument,
  position: vscode.Position
): Promise<vscode.Hover | undefined> {
  const call = citeCallAt(document.getText(), document.offsetAt(position));
  if (!call || !call.name) {
    return undefined;
  }
  const range = new vscode.Range(document.positionAt(call.start), document.positionAt(call.end));
  const md = new vscode.MarkdownString();
  md.supportHtml = true;
  md.appendMarkdown(`**${call.name}**`);

  const ocr = await loadOcrForSource(call.name);
  if (!ocr) {
    md.appendMarkdown(
      `\n\n_No OCR result (\`*.ocr.json\`) found for this source — run "Run Document OCR" on its PDF._`
    );
    return new vscode.Hover(md, range);
  }
  const pages = Array.isArray(ocr.pages) ? ocr.pages : [];
  if (pages.length === 0) {
    md.appendMarkdown(`\n\n_OCR result has no pages._`);
    return new vscode.Hover(md, range);
  }

  let pageObj;
  if (call.page !== undefined) {
    pageObj = resolvePage(pages, call.page);
    if (!pageObj) {
      md.appendMarkdown(`\n\n_Page ${call.page} not found in the OCR result._`);
      return new vscode.Hover(md, range);
    }
    md.appendMarkdown(` — page ${call.page}`);
  } else {
    pageObj = pages[0];
    md.appendMarkdown(` — first page`);
  }

  let body = pageObj.markdown ?? "";
  if (call.highlight) {
    const from = Math.max(0, Math.min(body.length, call.highlight.from));
    body = highlightRange(body, call.highlight.from, call.highlight.to);
    // a hover cannot be scrolled programmatically — start the rendered page at
    // the paragraph containing the highlight instead
    const cut = body.lastIndexOf("\n\n", from);
    if (cut > 0) {
      body = `…\n\n${body.slice(cut + 2)}`;
    }
  }
  body = inlineImages(body, pageObj, 80_000);
  md.appendMarkdown(`\n\n---\n\n${body}`);
  return new vscode.Hover(md, range);
}
