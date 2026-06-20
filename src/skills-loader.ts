// src/skills-loader.ts
// Skills system: reads skills from extension bundle + workspace.
// Workspace skills override bundled ones (loaded second).

import * as vscode from 'vscode';
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
  // Extension-bundled skills (shipped with the extension)
  dirs.push(path.join(__dirname, '..', 'skills'));
  // Workspace skills (override bundled)
  const wf = vscode.workspace.workspaceFolders;
  if (wf) {
    dirs.push(path.join(wf[0].uri.fsPath, '.pulse', 'skills'));
  }
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
      if (!fs.existsSync(dir)) {
        // Don't create the dir automatically — only load from existing dirs
        continue;
      }
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
    console.log(`📚 Loaded ${this.skills.size} skills`);
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

  async createSkill(name: string, description: string, agentApiKey: string, agentBaseURL: string, model: string): Promise<string> {
    const skillDir = path.join(getSkillsDirs()[0], name);
    fs.mkdirSync(skillDir, { recursive: true });

    const prompt = `Create a SKILL.md file for a skill called "${name}" with this description: "${description}".

The file should have YAML frontmatter with: name, description, triggers (array), allowed_tools (array).
Then a markdown body with clear, step-by-step instructions for an AI agent to follow.

Format:
---
name: ${name}
description: ${description}
triggers: [trigger1, trigger2]
allowed_tools: [read_file, write_file, run_terminal]
---

# ${name}
...instructions...

Generate the complete file content.`;

    const response = await fetch(`${agentBaseURL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${agentApiKey}` },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 2000,
      }),
    });

    if (!response.ok) throw new Error(`Skill generation failed: ${response.status}`);
    const data = await response.json() as any;
    const content = data.choices?.[0]?.message?.content || `# ${name}\n\n${description}`;

    const filePath = path.join(skillDir, 'SKILL.md');
    fs.writeFileSync(filePath, content, 'utf-8');
    this.loadAll();

    return filePath;
  }

  getSkillsDir(): string { return getSkillsDirs()[0]; }
}
