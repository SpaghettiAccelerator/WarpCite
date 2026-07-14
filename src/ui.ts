import * as vscode from "vscode";

/** Modal "Replace it?" confirmation; resolves true only if the user picks Replace. */
export async function confirmReplace(what: string): Promise<boolean> {
  const choice = await vscode.window.showWarningMessage(
    `WarpCite: ${what} already exists. Replace it?`,
    { modal: true },
    "Replace"
  );
  return choice === "Replace";
}

/** Save-file dialog for exporting an image as PNG. */
export async function pickPngSaveTarget(
  defaultUri: vscode.Uri | undefined
): Promise<vscode.Uri | undefined> {
  return vscode.window.showSaveDialog({
    defaultUri,
    filters: { "PNG image": ["png"] },
    saveLabel: "Save image",
  });
}

/** Modal consent for the paid OCR-annotation call; true only if the user picks OK. */
export async function confirmAnnotationOcr(pdfName: string): Promise<boolean> {
  const choice = await vscode.window.showInformationMessage(
    `WarpCite: no identifier (arXiv/DOI) found in ${pdfName}. Press OK to run Mistral OCR on the first two pages and extract the citation from them.`,
    { modal: true },
    "OK"
  );
  return choice === "OK";
}
