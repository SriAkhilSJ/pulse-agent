export declare class SemanticCache {
    private entries;
    private maxSize;
    constructor(maxSize?: number);
    get(query: string): string | null;
    set(query: string, response: string): void;
    clear(): void;
    getStats(): {
        size: number;
        maxSize: number;
    };
    private normalize;
}
//# sourceMappingURL=semantic-cache.d.ts.map