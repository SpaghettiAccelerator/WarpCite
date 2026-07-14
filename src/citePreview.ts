import MarkdownIt from "markdown-it";
import * as path from "path";
import * as vscode from "vscode";
import {
  findCiteCalls,
  highlightRange,
  inlineImages,
  loadOcrForSource,
  OcrPage,
  resolvePage,
} from "./citeParser";
import { pickPngSaveTarget } from "./ui";

interface PreviewArgs {
  name: string;
  page?: string;
  from?: number;
  to?: number;
  /** render this specific ocr.json instead of resolving by source name */
  ocrPath?: string;
}

/**
 * Cmd+click on the parameters of a #dhbwCite(...) call opens a preview tab to
 * the right rendering every OCR page (header, content, footer), scrolled to
 * the cited page with the cited chars highlighted.
 */
export function registerCitePreview(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("warpcite.openCitePreview", openPreview)
  );
  context.subscriptions.push(
    vscode.languages.registerDocumentLinkProvider([{ scheme: "file", pattern: "**/*.typ" }], {
      provideDocumentLinks,
    })
  );
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider([{ scheme: "file", pattern: "**/*.ocr.json" }], {
      provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
        const args: PreviewArgs = {
          name: path.basename(path.dirname(document.uri.fsPath)),
          ocrPath: document.uri.fsPath,
        };
        return [
          new vscode.CodeLens(new vscode.Range(0, 0, 0, 0), {
            title: "Preview",
            tooltip: "Render this OCR result as markdown",
            command: "warpcite.openCitePreview",
            arguments: [args],
          }),
        ];
      },
    })
  );
}

function provideDocumentLinks(document: vscode.TextDocument): vscode.DocumentLink[] {
  return findCiteCalls(document.getText())
    .filter((c) => c.name)
    .map((c) => {
      const args: PreviewArgs = {
        name: c.name!,
        page: c.page,
        from: c.highlight?.from,
        to: c.highlight?.to,
      };
      const link = new vscode.DocumentLink(
        new vscode.Range(document.positionAt(c.argsStart), document.positionAt(c.argsEnd)),
        vscode.Uri.parse(
          `command:warpcite.openCitePreview?${encodeURIComponent(JSON.stringify(args))}`
        )
      );
      link.tooltip = "Open OCR preview";
      return link;
    });
}

let panel: vscode.WebviewPanel | undefined;

async function openPreview(args: PreviewArgs): Promise<void> {
  let ocr;
  if (args.ocrPath) {
    try {
      ocr = JSON.parse(
        new TextDecoder().decode(
          await vscode.workspace.fs.readFile(vscode.Uri.file(args.ocrPath))
        )
      );
    } catch {
      ocr = undefined;
    }
  } else {
    ocr = await loadOcrForSource(args.name);
  }
  const pages = ocr && Array.isArray(ocr.pages) ? ocr.pages : [];
  if (pages.length === 0) {
    vscode.window.showErrorMessage(
      `WarpCite: no OCR result (*.ocr.json) found for source "${args.name}".`
    );
    return;
  }
  const cited = args.page !== undefined ? resolvePage(pages, args.page) : undefined;
  const targetIndex = cited?.index ?? pages[0].index;

  if (!panel) {
    panel = vscode.window.createWebviewPanel(
      "warpcite.citePreview",
      "WarpCite OCR",
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      { enableScripts: true }
    );
    panel.webview.onDidReceiveMessage((msg) => void handleSaveImageMessage(msg));
    panel.onDidDispose(() => (panel = undefined));
  }
  panel.title = `${args.name} — OCR`;
  panel.webview.html = renderHtml(pages, {
    highlightIndex: targetIndex,
    from: args.from,
    to: args.to,
    scrollToIndex: args.page !== undefined ? targetIndex : undefined,
  });
  panel.reveal(vscode.ViewColumn.Beside, true);
}

/** For test access: the current preview panel, if open. */
export function getPreviewPanel(): vscode.WebviewPanel | undefined {
  return panel;
}

/** Webview message handler: save a canvas-converted PNG via a save dialog at the workspace root. */
export async function handleSaveImageMessage(msg: unknown): Promise<void> {
  const message = msg as { type?: string; name?: string; dataUri?: string };
  if (message?.type !== "saveImage" || typeof message.dataUri !== "string") {
    return;
  }
  const base64 = message.dataUri.split(",")[1];
  if (!base64) {
    return;
  }
  const root = vscode.workspace.workspaceFolders?.[0]?.uri;
  const fileName = `${(message.name || "image").replace(/[^\w.-]/g, "_")}.png`;
  const target = await pickPngSaveTarget(root ? vscode.Uri.joinPath(root, fileName) : undefined);
  if (!target) {
    return;
  }
  await vscode.workspace.fs.writeFile(target, Buffer.from(base64, "base64"));
  vscode.window.showInformationMessage(`WarpCite: image saved to ${target.fsPath}.`);
}

function renderHtml(
  pages: OcrPage[],
  opts: { highlightIndex: number; from?: number; to?: number; scrollToIndex?: number }
): string {
  const md = new MarkdownIt({ html: true });
  md.renderer.rules.image = (tokens, idx, options, _env, self) => {
    const token = tokens[idx];
    const src = token.attrGet("src") ?? "";
    if (!src.startsWith("data:")) {
      return self.renderToken(tokens, idx, options);
    }
    const alt = escapeHtml(token.content || "image");
    const name = escapeHtml((token.content || "image").replace(/\.\w+$/, "") || "image");
    return `<span class="img-wrap"><img src="${src}" alt="${alt}"><button class="save-img" data-name="${name}" title="Save this image as PNG">Save PNG</button></span>`;
  };
  const sections = pages
    .map((p) => {
      let body = p.markdown ?? "";
      if (
        p.index === opts.highlightIndex &&
        typeof opts.from === "number" &&
        typeof opts.to === "number"
      ) {
        body = highlightRange(body, opts.from, opts.to);
      }
      body = inlineImages(body, p);
      const header = p.header
        ? `<div class="hf header">${escapeHtml(p.header)}</div>`
        : "";
      const footer = p.footer
        ? `<div class="hf footer">${escapeHtml(p.footer)}</div>`
        : "";
      return `<section class="page" id="page-${p.index}">
  <div class="pageno">Page ${escapeHtml(p.page ?? `${p.index + 1} (pdf)`)}</div>
  ${header}
  <div class="content">${md.render(body)}</div>
  ${footer}
</section>`;
    })
    .join("\n");

  const hasHighlight =
    typeof opts.from === "number" && typeof opts.to === "number" && opts.to > opts.from;
  let scroll = "";
  if (hasHighlight) {
    scroll = `<script>(document.querySelector("#page-${opts.highlightIndex} mark") ?? document.getElementById("page-${opts.highlightIndex}"))?.scrollIntoView({ block: "center" });</script>`;
  } else if (opts.scrollToIndex !== undefined) {
    scroll = `<script>document.getElementById("page-${opts.scrollToIndex}")?.scrollIntoView();</script>`;
  }

  const saveScript = `<script>
  const vscodeApi = acquireVsCodeApi();
  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".save-img");
    if (!btn) return;
    const img = btn.parentElement.querySelector("img");
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext("2d").drawImage(img, 0, 0);
    vscodeApi.postMessage({ type: "saveImage", name: btn.dataset.name, dataUri: canvas.toDataURL("image/png") });
  });
</script>`;

  return `<!DOCTYPE html>
<html>
<head>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
  body { font-family: var(--vscode-font-family); line-height: 1.5; padding: 0 1em; }
  .page { border: 1px solid var(--vscode-panel-border, #8884); border-radius: 6px; margin: 1em 0; padding: 0.5em 1em 1em; }
  .pageno { font-weight: bold; font-size: 0.85em; text-transform: uppercase; letter-spacing: 0.05em; opacity: 0.7; border-bottom: 1px solid var(--vscode-panel-border, #8884); padding-bottom: 0.3em; margin-bottom: 0.5em; }
  .hf { font-size: 0.85em; opacity: 0.7; font-style: italic; }
  .hf.footer { border-top: 1px dashed var(--vscode-panel-border, #8884); margin-top: 0.8em; padding-top: 0.4em; }
  .hf.header { border-bottom: 1px dashed var(--vscode-panel-border, #8884); margin-bottom: 0.8em; padding-bottom: 0.4em; }
  /* match the hover tooltip's <mark> rendering (browser default, not themable there) */
  mark { background: #ffff00; color: #000000; padding: 0 1px; }
  img { max-width: 100%; }
  .img-wrap { position: relative; display: inline-block; max-width: 100%; }
  .save-img { position: absolute; right: 6px; bottom: 6px; background: #0078d4; color: #ffffff; border: none; border-radius: 3px; padding: 2px 8px; cursor: pointer; font-size: 0.8em; }
  .save-img:hover { background: #106ebe; }
  table { border-collapse: collapse; }
  td, th { border: 1px solid var(--vscode-panel-border, #8884); padding: 2px 6px; }
</style>
</head>
<body>
${sections}
${saveScript}
${scroll}
</body>
</html>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
