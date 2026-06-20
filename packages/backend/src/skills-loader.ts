// packages/backend/src/skills-loader.ts (standalone version)
import * as fs from 'fs';
import * as path from 'path';

export interface Skill {
  name: string;
  description: string;
  triggers: string[];
  allowedTools: string[];
  content: string;
  filePath: string;
}

function getSkillsDirs(): string[] {
  const dirs: string[] = [];
  // Bundled skills (shipped with the backend)
  dirs.push(path.join(__dirname, '..', 'skills'));
  // Workspace skills (override bundled)
  const workspace = process.env['PULSE_WORKSPACE'] || process.cwd();
  dirs.push(path.join(workspace, '.pulse', 'skills'));
  return dirs;
}

function parseSkillMarkdown(content: string, filePath: string): Skill | null {
  const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!frontmatterMatch) return null;

  const yamlBlock = frontmatterMatch[1];
  const body = frontmatterMatch[2].trim();

  const yaml: Record<string, string> = {};
  for (const line of yamlBlock.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const key = line.substring(0, colonIdx).trim();
      const value = line.substring(colonIdx + 1).trim().replace(/^["']|["']$/g, '');
      yaml[key] = value;
    }
  }

  let triggers: string[] = [];
  if (yaml.triggers) {
    triggers = yaml.triggers.replace(/[\[\]]/g, '').split(',').map((s: string) => s.trim()).filter(Boolean);
  }

  let allowedTools: string[] = [];
  if (yaml.allowed_tools) {
    allowedTools = yaml.allowed_tools.replace(/[\[\]]/g, '').split(',').map((s: string) => s.trim()).filter(Boolean);
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

export class SkillsLoader {
  private skills: Map<string, Skill> = new Map();

  constructor() {
    this.loadAll();
  }

  loadAll(): void {
    this.skills.clear();
    const dirs = getSkillsDirs();
    for (const dir of dirs) {
      if (!fs.existsSync(dir)) continue;
      let entries: fs.Dirent[];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const skillFile = path.join(dir, entry.name, 'SKILL.md');
        if (!fs.existsSync(skillFile)) continue;
        try {
          const content = fs.readFileSync(skillFile, 'utf-8');
          const skill = parseSkillMarkdown(content, skillFile);
          if (skill) this.skills.set(skill.name, skill);
        } catch (err) {
          console.error(`Failed to load skill ${entry.name}:`, err);
        }
      }
    }
    console.log(`Loaded ${this.skills.size} skills`);
  }

  getSkill(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  getAllSkills(): Skill[] {
    return Array.from(this.skills.values());
  }

  findMatchingSkills(input: string): Skill[] {
    const lower = input.toLowerCase();
    return this.getAllSkills().filter(skill =>
      skill.triggers.some(t => lower.includes(t.toLowerCase())) ||
      skill.name.toLowerCase().includes(lower) ||
      skill.description.toLowerCase().includes(lower)
    );
  }

  getSkillsDir(): string { return getSkillsDirs()[0]; }
}
