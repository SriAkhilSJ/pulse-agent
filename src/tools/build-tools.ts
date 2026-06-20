// src/tools/build-tools.ts
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { defineTool } from '../tool-registry';

function getWorkspaceRoot(): string {
  const wf = vscode.workspace.workspaceFolders;
  if (!wf) throw new Error('No workspace folder open');
  return wf[0].uri.fsPath;
}

export const detectBuildSystemTool = defineTool(
  'detect_build_system',
  'Detect the project build system (npm, maven, gradle, etc.)',
  { type: 'object', properties: {}, required: [] },
  async (): Promise<string> => {
    const root = getWorkspaceRoot();
    if (fs.existsSync(path.join(root, 'package.json'))) {
      const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));
      const scripts = Object.keys(pkg.scripts || {});
      return 'npm (package.json). Scripts: ' + scripts.join(', ');
    }
    if (fs.existsSync(path.join(root, 'pom.xml'))) return 'Maven (pom.xml)';
    if (fs.existsSync(path.join(root, 'build.gradle')) || fs.existsSync(path.join(root, 'build.gradle.kts'))) return 'Gradle';
    if (fs.existsSync(path.join(root, 'Cargo.toml'))) return 'Cargo (Rust)';
    if (fs.existsSync(path.join(root, 'go.mod'))) return 'Go modules';
    if (fs.existsSync(path.join(root, 'requirements.txt')) || fs.existsSync(path.join(root, 'pyproject.toml'))) return 'Python';
    return 'Unknown build system';
  }
);

export const parseBuildErrorsTool = defineTool(
  'parse_build_errors',
  'Parse build output for errors and warnings',
  {
    type: 'object',
    properties: { output: { type: 'string', description: 'Build output text to parse' } },
    required: ['output'],
  },
  async (args: Record<string, unknown>): Promise<string> => {
    const output = args.output as string;
    if (!output) throw new Error('parse_build_errors requires "output"');
    const lines = output.split('\n');
    const errors = lines.filter(l => l.includes('error:') || l.includes('ERROR') || l.includes('Error:'));
    const warnings = lines.filter(l => l.includes('warning:') || l.includes('WARNING') || l.includes('Warning:'));
    let result = 'Build Analysis:\n';
    if (errors.length) result += '\nErrors (' + errors.length + '):\n' + errors.slice(0, 10).map(l => '  ' + l.trim()).join('\n');
    if (warnings.length) result += '\nWarnings (' + warnings.length + '):\n' + warnings.slice(0, 5).map(l => '  ' + l.trim()).join('\n');
    if (!errors.length && !warnings.length) result += '\nNo errors or warnings found.';
    return result;
  }
);

export const getRecommendedBuildCommandTool = defineTool(
  'get_recommended_build_command',
  'Get the recommended build command for this project',
  { type: 'object', properties: {}, required: [] },
  async (): Promise<string> => {
    const root = getWorkspaceRoot();
    if (fs.existsSync(path.join(root, 'package.json'))) {
      const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));
      const scripts = pkg.scripts || {};
      if (scripts.build) return 'npm run build';
      if (scripts.compile) return 'npm run compile';
      if (scripts.test) return 'npm test';
      return 'npm install';
    }
    if (fs.existsSync(path.join(root, 'pom.xml'))) return 'mvn compile';
    if (fs.existsSync(path.join(root, 'build.gradle'))) return 'gradle build';
    if (fs.existsSync(path.join(root, 'Cargo.toml'))) return 'cargo build';
    if (fs.existsSync(path.join(root, 'go.mod'))) return 'go build ./...';
    return 'Unknown — check project documentation';
  }
);
