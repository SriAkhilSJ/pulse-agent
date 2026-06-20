export interface SandboxConfig {
    image: string;
    memoryLimit: string;
    cpuLimit: string;
    network: 'none' | 'bridge' | 'host';
    timeoutMs: number;
}
export declare function runInDocker(command: string, config?: Partial<SandboxConfig>): Promise<string>;
export declare function isDockerAvailable(): boolean;
//# sourceMappingURL=docker.d.ts.map