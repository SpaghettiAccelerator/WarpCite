import * as path from "path";
import * as vscode from "vscode";
import { describeError } from "./mistralOcr";
import { confirmReplace } from "./ui";

const RENAMEABLE = /\.(pdf|ocr\.json)$/i;

export function registerRenameToFolderCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "warpcite.renameToFolderName",
      async (uri?: vscode.Uri, uris?: vscode.Uri[]) => {
        const selection = uris && uris.length > 0 ? uris : uri ? [uri] : [];
        const targets = selection.filter((u) => RENAMEABLE.test(u.fsPath));
        if (targets.length === 0) {
          vscode.window.showErrorMessage(
            "WarpCite: select a .pdf or .ocr.json file to rename."
          );
          return;
        }
        for (const target of targets) {
          await renameToFolderName(target);
        }
      }
    )
  );
}

/** `.ocr.json` is one compound extension; everything else keeps its last extension. */
function extensionOf(fileName: string): string {
  return /\.ocr\.json$/i.test(fileName) ? ".ocr.json" : path.extname(fileName);
}

async function renameToFolderName(uri: vscode.Uri): Promise<void> {
  const fileName = path.basename(uri.fsPath);
  const folderName = path.basename(path.dirname(uri.fsPath));
  const newName = `${folderName}${extensionOf(fileName)}`;
  if (newName === fileName) {
    vscode.window.showInformationMessage(
      `WarpCite: ${fileName} is already named after its folder.`
    );
    return;
  }
  const targetUri = vscode.Uri.joinPath(uri, "..", newName);

  // On case-insensitive filesystems a case-only rename stats as "existing" —
  // that is still a plain rename, not a replacement.
  const caseOnly = newName.toLowerCase() === fileName.toLowerCase();
  if (!caseOnly) {
    try {
      await vscode.workspace.fs.stat(targetUri);
      if (!(await confirmReplace(newName))) {
        return;
      }
    } catch {
      // target does not exist
    }
  }

  try {
    await vscode.workspace.fs.rename(uri, targetUri, { overwrite: true });
    vscode.window.showInformationMessage(`WarpCite: renamed ${fileName} to ${newName}.`);
  } catch (err) {
    vscode.window.showErrorMessage(
      `WarpCite: renaming ${fileName} failed: ${describeError(err)}`
    );
  }
}
