export interface Skill {
    name: string;
    description: string;
    triggers: string[];
    allowedTools: string[];
    content: string;
    filePath: string;
}
export declare class SkillsLoader {
    private skills;
    constructor();
    loadAll(): void;
    getSkill(name: string): Skill | undefined;
    getAllSkills(): Skill[];
    findMatchingSkills(input: string): Skill[];
    getSkillsDir(): string;
}
//# sourceMappingURL=skills-loader.d.ts.map