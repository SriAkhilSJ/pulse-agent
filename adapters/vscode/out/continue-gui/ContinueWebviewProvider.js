"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ContinueWebviewProvider = void 0;
/**
 * PulseWebviewProvider — serves custom Pulse chat UI as a VS Code webview panel.
 */
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const ContinueToPulseBridge_1 = require("./ContinueToPulseBridge");
class ContinueWebviewProvider {
    extensionUri;
    static viewType = "pulse.continueGUIView";
    bridge;
    constructor(extensionUri) {
        this.extensionUri = extensionUri;
    }
    resolveWebviewView(webviewView, _context, _token) {
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "gui")],
        };
        this.bridge = new ContinueToPulseBridge_1.ContinueToPulseBridge(webviewView.webview);
        webviewView.webview.html = this.getHtml(webviewView.webview);
    }
    getHtml(webview) {
        const guiPath = vscode.Uri.joinPath(this.extensionUri, "gui");
        const htmlPath = path.join(guiPath.fsPath, "pulse-chat.html");
        let html = fs.readFileSync(htmlPath, "utf-8");
        // CSP for VS Code webview — allows inline scripts
        html = html.replace("</head>", `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; connect-src 'none';"></head>`);
        return html;
    }
}
exports.ContinueWebviewProvider = ContinueWebviewProvider;
//# sourceMappingURL=ContinueWebviewProvider.js.map