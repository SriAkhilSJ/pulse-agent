/**
 * PulseWebviewProvider — serves custom Pulse chat UI as a VS Code webview panel.
 */
import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { ContinueToPulseBridge } from "./ContinueToPulseBridge";

export class ContinueWebviewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "pulse.continueGUIView";
  private bridge?: ContinueToPulseBridge;

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "gui")],
    };
    this.bridge = new ContinueToPulseBridge(webviewView.webview);
    webviewView.webview.html = this.getHtml(webviewView.webview);
  }

  private getHtml(webview: vscode.Webview): string {
      const guiPath = vscode.Uri.joinPath(this.extensionUri, "gui");
      const htmlPath = path.join(guiPath.fsPath, "pulse-chat.html");
      let html = fs.readFileSync(htmlPath, "utf-8");
      // CSP for VS Code webview — allows inline scripts
      html = html.replace("</head>", `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; connect-src 'none';"></head>`);
      return html;
    }
}
