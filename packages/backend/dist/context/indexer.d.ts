export interface IndexEntry {
    filePath: string;
    content: string;
    lines: string[];
    lastModified: number;
    symbols: string[];
}
export interface SearchResult {
    filePath: string;
    lineStart: number;
    lineEnd: number;
    content: string;
    score: number;
}
export declare class ContextEngine {
    private index;
    private workspaceRoot;
    private maxIndexSize;
    constructor(workspaceRoot?: string);
    initialize(): Promise<void>;
    indexWorkspace(): Promise<void>;
    private findFiles;
    private indexFile;
    private extractSymbols;
    search(query: string, maxResults?: number): SearchResult[];
    getCurrentContext(): string;
    getIndexSize(): number;
}
//# sourceMappingURL=indexer.d.ts.map