import { Mistral } from "@mistralai/mistralai";
import * as path from "path";
import * as vscode from "vscode";
import { parsePrintedPageNumber } from "./pageNumber";
import { statusBar } from "./status";
import { confirmReplace } from "./ui";

export function ocrModel(): string {
  return vscode.workspace
    .getConfiguration("warpcite")
    .get<string>("mistral.model", "mistral-ocr-latest");
}

export function registerMistralOcrCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("warpcite.runMistralOcr", async (uri?: vscode.Uri) => {
      const pdfUri = uri ?? vscode.window.activeTextEditor?.document.uri;
      if (!pdfUri || !pdfUri.fsPath.toLowerCase().endsWith(".pdf")) {
        vscode.window.showErrorMessage("WarpCite: select a .pdf file to run OCR on.");
        return;
      }
      await runOcr(pdfUri);
    })
  );
}

export async function readApiKey(): Promise<string | undefined> {
  const key = vscode.workspace
    .getConfiguration("warpcite")
    .get<string>("mistral.apiKey", "")
    .trim();
  return key.length > 0 ? key : undefined;
}

async function runOcr(pdfUri: vscode.Uri): Promise<void> {
  const pdfName = path.basename(pdfUri.fsPath);
  const apiKey = await readApiKey();
  if (!apiKey) {
    vscode.window.showErrorMessage(
      "WarpCite: no Mistral API key — set warpcite.mistral.apiKey in the settings."
    );
    return;
  }

  const jsonUri = vscode.Uri.joinPath(
    pdfUri,
    "..",
    `${path.basename(pdfName, path.extname(pdfName))}.ocr.json`
  );
  try {
    await vscode.workspace.fs.stat(jsonUri);
    if (!(await confirmReplace(path.basename(jsonUri.fsPath)))) {
      return;
    }
  } catch {
    // no previous OCR result
  }

  const actionId = statusBar.begin(`OCR ${pdfName} — uploading`);
  try {
    const client = new Mistral({ apiKey });
    const content = await vscode.workspace.fs.readFile(pdfUri);
    const uploaded = await client.files.upload({
      file: { fileName: pdfName, content },
      purpose: "ocr",
    });
    const signedUrl = await client.files.getSignedUrl({ fileId: uploaded.id });

    statusBar.update(actionId, `OCR ${pdfName} — processing with ${ocrModel()}`);
    const result = await client.ocr.process({
      model: ocrModel(),
      document: { type: "document_url", documentUrl: signedUrl.url },
      tableFormat: "html",
      extractHeader: true,
      extractFooter: true,
      includeImageBase64: true,
    });

    statusBar.update(actionId, `OCR ${pdfName} — writing result`);
    const output = {
      ...result,
      pages: result.pages.map((p) => ({ ...p, page: parsePrintedPageNumber(p.footer) })),
    };
    await vscode.workspace.fs.writeFile(
      jsonUri,
      new TextEncoder().encode(JSON.stringify(output, null, 2))
    );
    vscode.window.showInformationMessage(
      `WarpCite: OCR result written to ${path.basename(jsonUri.fsPath)}.`
    );
  } catch (err) {
    console.error("WarpCite OCR failed:", err);
    vscode.window.showErrorMessage(
      `WarpCite: OCR of ${pdfName} failed: ${err instanceof Error ? err.message : String(err)}`
    );
  } finally {
    statusBar.end(actionId);
  }
}
