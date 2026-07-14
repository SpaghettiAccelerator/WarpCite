import * as vscode from "vscode";

/** Permanent "WarpCite" status bar item; spins while actions are pending and lists them in the tooltip. */
class WarpCiteStatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private readonly pending = new Map<number, string>();
  private nextId = 1;

  constructor() {
    this.item = vscode.window.createStatusBarItem(
      "warpcite.status",
      vscode.StatusBarAlignment.Right,
      100
    );
    this.item.name = "WarpCite";
    this.item.command = {
      title: "Open WarpCite settings",
      command: "workbench.action.openSettings",
      arguments: ["@ext:felixwieland.warpcite"],
    };
    this.render();
    this.item.show();
  }

  begin(label: string): number {
    const id = this.nextId++;
    this.pending.set(id, label);
    this.render();
    return id;
  }

  update(id: number, label: string): void {
    if (this.pending.has(id)) {
      this.pending.set(id, label);
      this.render();
    }
  }

  end(id: number): void {
    this.pending.delete(id);
    this.render();
  }

  dispose(): void {
    this.item.dispose();
  }

  private render(): void {
    this.item.text = this.pending.size > 0 ? "$(loading~spin) WarpCite" : "$(book) WarpCite";
    const tooltip = new vscode.MarkdownString();
    if (this.pending.size === 0) {
      tooltip.appendMarkdown("**WarpCite**\n\nNo pending actions");
    } else {
      tooltip.appendMarkdown("**WarpCite — pending actions**\n\n");
      for (const label of this.pending.values()) {
        tooltip.appendMarkdown(`- ${label}\n`);
      }
    }
    this.item.tooltip = tooltip;
  }
}

export const statusBar = new WarpCiteStatusBar();
