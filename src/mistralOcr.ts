import * as path from "path";
import * as vscode from "vscode";
import { createMistralClient } from "./mistralClient";
import { parsePrintedPageNumber } from "./pageNumber";
import { statusBar } from "./status";
import { confirmReplace } from "./ui";

export function ocrModel(): string {
  return vscode.workspace
    .getConfiguration("warpcite")
    .get<string>("mistral.model", "mistral-ocr-latest");
}

const API_KEY_SECRET = "warpcite.mistral.apiKey";

export function registerMistralOcrCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("warpcite.runMistralOcr", async (uri?: vscode.Uri) => {
      const pdfUri = uri ?? vscode.window.activeTextEditor?.document.uri;
      if (!pdfUri || !pdfUri.fsPath.toLowerCase().endsWith(".pdf")) {
        vscode.window.showErrorMessage("WarpCite: select a .pdf file to run OCR on.");
        return;
      }
      await runOcr(pdfUri, context.secrets);
    })
  );
}

export function registerTestConnectionCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("warpcite.testMistralConnection", async () => {
      const apiKey = await requireApiKey(context.secrets);
      if (!apiKey) {
        return;
      }
      const host = vscode.env.remoteName
        ? `remote extension host (${vscode.env.remoteName})`
        : "local extension host";
      const fingerprint =
        apiKey.length > 8
          ? `${apiKey.slice(0, 4)}…${apiKey.slice(-4)} (${apiKey.length} chars)`
          : `(${apiKey.length} chars)`;
      const started = Date.now();
      try {
        const models = await createMistralClient(apiKey).models.list();
        const count = models.data?.length ?? 0;
        vscode.window.showInformationMessage(
          `WarpCite: Mistral API reachable from the ${host} with key ${fingerprint} — ` +
            `${count} model(s), ${Date.now() - started} ms.`
        );
      } catch (err) {
        vscode.window.showErrorMessage(
          `WarpCite: Mistral API NOT reachable from the ${host} with key ${fingerprint} ` +
            `(after ${Math.round((Date.now() - started) / 1000)} s): ${describeError(err)}`
        );
      }
    })
  );
}

export function registerApiKeyCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("warpcite.setMistralApiKey", async () => {
      const value = await vscode.window.showInputBox({
        title: "WarpCite: Mistral API Key",
        prompt: "Stored in VS Code secret storage, never in settings. Leave empty to clear the stored key.",
        password: true,
        ignoreFocusOut: true,
      });
      if (value === undefined) {
        return; // cancelled
      }
      if (value.trim().length === 0) {
        await context.secrets.delete(API_KEY_SECRET);
        vscode.window.showInformationMessage("WarpCite: Mistral API key cleared.");
      } else {
        await context.secrets.store(API_KEY_SECRET, value.trim());
        vscode.window.showInformationMessage(
          "WarpCite: Mistral API key saved to secret storage."
        );
      }
    })
  );
}

/**
 * One-time migration: move a key from the old plaintext setting into secret
 * storage and scrub it from every settings scope it was written to.
 */
export async function migrateApiKeyToSecretStorage(
  secrets: vscode.SecretStorage
): Promise<void> {
  const config = vscode.workspace.getConfiguration("warpcite");
  const legacy = config.get<string>("mistral.apiKey", "").trim();
  if (legacy.length === 0) {
    return;
  }
  if (!(await secrets.get(API_KEY_SECRET))) {
    await secrets.store(API_KEY_SECRET, legacy);
  }
  const info = config.inspect<string>("mistral.apiKey");
  if (info?.globalValue !== undefined) {
    await config.update("mistral.apiKey", undefined, vscode.ConfigurationTarget.Global);
  }
  if (info?.workspaceValue !== undefined) {
    await config.update("mistral.apiKey", undefined, vscode.ConfigurationTarget.Workspace);
  }
  if (info?.workspaceFolderValue !== undefined) {
    await config.update("mistral.apiKey", undefined, vscode.ConfigurationTarget.WorkspaceFolder);
  }
  vscode.window.showInformationMessage(
    "WarpCite: moved the Mistral API key from settings into secret storage."
  );
}

export async function readApiKey(
  secrets: vscode.SecretStorage
): Promise<string | undefined> {
  const key = (await secrets.get(API_KEY_SECRET))?.trim();
  return key && key.length > 0 ? key : undefined;
}

/** Read the key, or prompt the user to set one if it is missing. */
export async function requireApiKey(
  secrets: vscode.SecretStorage
): Promise<string | undefined> {
  const key = await readApiKey(secrets);
  if (key) {
    return key;
  }
  const pick = await vscode.window.showErrorMessage(
    "WarpCite: no Mistral API key set.",
    "Set API Key"
  );
  if (pick === "Set API Key") {
    await vscode.commands.executeCommand("warpcite.setMistralApiKey");
    return readApiKey(secrets);
  }
  return undefined;
}

/** Mistral's OCR endpoint rejects documents above 50 MB / 1000 pages. */
const MAX_OCR_BYTES = 50 * 1024 * 1024;

/** Flatten an error and its `cause` chain — fetch failures like "terminated" carry the real reason in `cause`. */
export function describeError(err: unknown): string {
  const parts: string[] = [];
  let current: unknown = err;
  while (current !== undefined && current !== null && parts.length < 5) {
    parts.push(current instanceof Error ? current.message : String(current));
    current = current instanceof Error ? current.cause : undefined;
  }
  return parts.join(" ← ");
}

async function runOcr(pdfUri: vscode.Uri, secrets: vscode.SecretStorage): Promise<void> {
  const pdfName = path.basename(pdfUri.fsPath);
  const apiKey = await requireApiKey(secrets);
  if (!apiKey) {
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
    const client = createMistralClient(apiKey);
    const content = await vscode.workspace.fs.readFile(pdfUri);
    if (content.byteLength > MAX_OCR_BYTES) {
      vscode.window.showErrorMessage(
        `WarpCite: ${pdfName} is ${(content.byteLength / 1024 / 1024).toFixed(1)} MB — ` +
          `Mistral OCR accepts at most 50 MB. Try compressing the PDF or splitting it.`
      );
      return;
    }
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
      `WarpCite: OCR of ${pdfName} failed: ${describeError(err)}`
    );
  } finally {
    statusBar.end(actionId);
  }
}
