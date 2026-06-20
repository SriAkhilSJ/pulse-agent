// src/file-mention-provider.ts
// File @mention Provider — Autocomplete for @file in chat input
// Like Cursor's @file / Windsurf's file attachment

import * as vscode from 'vscode';
import * as path from 'path';

export class FileMentionProvider implements vscode.CompletionItemProvider {
  private workspaceRoot: string = '';

  constructor() {
    const ws = vscode.workspace.workspaceFolders;
    if (ws) this.workspaceRoot = ws[0].uri.fsPath;
  }

  async provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
    context: vscode.CompletionContext
  ): Promise<vscode.CompletionItem[] | null> {
    const lineText = document.lineAt(position).text;
    const textBeforeCursor = lineText.substring(0, position.character);

    // Check if we're typing after @
    const atMatch = textBeforeCursor.match(/@(\*?[\w./-]*)$/);
    if (!atMatch) return null;

    const query = atMatch[1].replace(/^\*/, '');
    const items: vscode.CompletionItem[] = [];

    // Get matching files
    try {
      const pattern = query.includes('/') ? '**/*' + query.split('/').pop() : '**/*' + query + '*';
      const files = await vscode.workspace.findFiles(
        pattern,
        '{**/node_modules/**,**/.git/**,**/out/**,**/dist/**,**/build/**}',
        20
      );

      for (const file of files) {
        const relPath = this.workspaceRoot
          ? path.relative(this.workspaceRoot, file.fsPath)
          : file.fsPath;
        const name = path.basename(file.fsPath);
        const dir = path.dirname(relPath);

        const item = new vscode.CompletionItem(
          relPath,
          vscode.CompletionItemKind.File
        );
        item.detail = dir !== '.' ? dir : '';
        item.documentation = new vscode.MarkdownString('`' + file.fsPath + '`');
        item.sortText = relPath.length.toString().padStart(4, '0') + relPath;
        items.push(item);
      }

      // Add special @workspace item
      if ('workspace'.startsWith(query) || !query) {
        const wsItem = new vscode.CompletionItem('workspace', vscode.CompletionItemKind.Text);
        wsItem.detail = 'Full codebase context';
        wsItem.documentation = new vscode.MarkdownString('Attach the entire workspace context to your message');
        wsItem.preselect = true;
        items.unshift(wsItem);
      }

      // Add @symbol support
      if (query.startsWith('symbol:') || query.startsWith('#')) {
        const symbolQuery = query.replace(/^(symbol:|#)/, '');
        const symbols = await this.searchSymbols(symbolQuery);
        for (const sym of symbols) {
          const item = new vscode.CompletionItem(
            'symbol:' + sym.name,
            vscode.CompletionItemKind.Function
          );
          item.detail = sym.file + ':' + sym.line;
          items.push(item);
        }
      }

    } catch { /* ignore */ }

    return items;
  }

  private async searchSymbols(query: string): Promise<Array<{ name: string; file: string; line: number }>> {
    const results: Array<{ name: string; file: string; line: number }> = [];
    try {
      const files = await vscode.workspace.findFiles(
        '**/*.{ts,tsx,js,jsx,py,go,rs,java,c,cpp}',
        '{**/node_modules/**,**/.git/**,**/out/**}',
        100
      );
      for (const file of files) {
        const doc = await vscode.workspace.openTextDocument(file);
        const text = doc.getText();
        const regex = /(?:export\s+)?(?:async\s+)?(?:function|class|const|def|fn|func)\s+(\w+)/g;
        let match;
        let lineNum = 0;
        while ((match = regex.exec(text)) !== null) {
          lineNum++;
          if (match[1].toLowerCase().includes(query.toLowerCase())) {
            const relPath = this.workspaceRoot
              ? path.relative(this.workspaceRoot, file.fsPath)
              : file.fsPath;
            results.push({ name: match[1], file: relPath, line: lineNum });
            if (results.length >= 10) return results;
          }
        }
      }
    } catch { /* ignore */ }
    return results;
  }
}
