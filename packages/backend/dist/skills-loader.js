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
exports.SkillsLoader = void 0;
// packages/backend/src/skills-loader.ts (standalone version)
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
function getSkillsDirs() {
    const dirs = [];
    // Bundled skills (shipped with the backend)
    dirs.push(path.join(__dirname, '..', 'skills'));
    // Workspace skills (override bundled)
    const workspace = process.env['PULSE_WORKSPACE'] || process.cwd();
    dirs.push(path.join(workspace, '.pulse', 'skills'));
    return dirs;
}
function parseSkillMarkdown(content, filePath) {
    const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
    if (!frontmatterMatch)
        return null;
    const yamlBlock = frontmatterMatch[1];
    const body = frontmatterMatch[2].trim();
    const yaml = {};
    for (const line of yamlBlock.split('\n')) {
        const colonIdx = line.indexOf(':');
        if (colonIdx > 0) {
            const key = line.substring(0, colonIdx).trim();
            const value = line.substring(colonIdx + 1).trim().replace(/^["']|["']$/g, '');
            yaml[key] = value;
        }
    }
    let triggers = [];
    if (yaml.triggers) {
        triggers = yaml.triggers.replace(/[\[\]]/g, '').split(',').map((s) => s.trim()).filter(Boolean);
    }
    let allowedTools = [];
    if (yaml.allowed_tools) {
        allowedTools = yaml.allowed_tools.replace(/[\[\]]/g, '').split(',').map((s) => s.trim()).filter(Boolean);
    }
    return {
        name: yaml.name || path.basename(path.dirname(filePath)),
        description: yaml.description || '',
        triggers,
        allowedTools,
        content: body,
        filePath,
    };
}
class SkillsLoader {
    skills = new Map();
    constructor() {
        this.loadAll();
    }
    loadAll() {
        this.skills.clear();
        const dirs = getSkillsDirs();
        for (const dir of dirs) {
            if (!fs.existsSync(dir))
                continue;
            let entries;
            try {
                entries = fs.readdirSync(dir, { withFileTypes: true });
            }
            catch {
                continue;
            }
            for (const entry of entries) {
                if (!entry.isDirectory())
                    continue;
                const skillFile = path.join(dir, entry.name, 'SKILL.md');
                if (!fs.existsSync(skillFile))
                    continue;
                try {
                    const content = fs.readFileSync(skillFile, 'utf-8');
                    const skill = parseSkillMarkdown(content, skillFile);
                    if (skill)
                        this.skills.set(skill.name, skill);
                }
                catch (err) {
                    console.error(`Failed to load skill ${entry.name}:`, err);
                }
            }
        }
        console.log(`Loaded ${this.skills.size} skills`);
    }
    getSkill(name) {
        return this.skills.get(name);
    }
    getAllSkills() {
        return Array.from(this.skills.values());
    }
    findMatchingSkills(input) {
        const lower = input.toLowerCase();
        return this.getAllSkills().filter(skill => skill.triggers.some(t => lower.includes(t.toLowerCase())) ||
            skill.name.toLowerCase().includes(lower) ||
            skill.description.toLowerCase().includes(lower));
    }
    getSkillsDir() { return getSkillsDirs()[0]; }
}
exports.SkillsLoader = SkillsLoader;
//# sourceMappingURL=skills-loader.js.map