// src/tools/audio-tools.ts
import { defineTool } from '../tool-registry';
import { runTerminalTool } from './terminal-tools';
import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';

function getAudioDir(): string {
  const wf = vscode.workspace.workspaceFolders;
  const base = wf ? wf[0].uri.fsPath : process.cwd();
  const dir = path.join(base, '.pulse', 'audio');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export const audioRecord = defineTool(
  'audio_record',
  'Record audio from the microphone',
  {
    type: 'object',
    properties: {
      duration_ms: { type: 'number', description: 'Duration in ms (default: 5000)' },
      save_path: { type: 'string', description: 'Output file name (optional)' },
    },
    required: [],
  },
  async (args: Record<string, unknown>): Promise<string> => {
    const duration = (args.duration_ms as number) || 5000;
    const name = (args.save_path as string) || `recording-${Date.now()}.wav`;
    const dir = getAudioDir();
    const filePath = path.join(dir, name);
    const seconds = Math.ceil(duration / 1000);
    if (process.platform === 'win32') {
      await runTerminalTool({ command: `ffmpeg -f dshow -i audio="Microphone" -t ${seconds} -ar 16000 -ac 1 "${filePath}" -y 2>&1` });
    } else {
      try {
        await runTerminalTool({ command: `sox -d -r 16000 -c 1 ${filePath} trim 0 ${seconds}` });
      } catch {
        try {
          await runTerminalTool({ command: `arecord -d ${seconds} -f cd ${filePath}` });
        } catch {
          await runTerminalTool({ command: `ffmpeg -f alsa -i default -t ${seconds} ${filePath}` });
        }
      }
    }
    return `Recorded ${seconds}s -> .pulse/audio/${name}`;
  }
);

export const audioPlay = defineTool(
  'audio_play',
  'Play an audio file',
  {
    type: 'object',
    properties: { file_path: { type: 'string', description: 'Path to the audio file' } },
    required: ['file_path'],
  },
  async (args: Record<string, unknown>): Promise<string> => {
    const filePath = args.file_path as string;
    if (!filePath) throw new Error('audio_play requires "file_path"');
    return runTerminalTool({ command: `ffplay -nodisp -autoexit "${filePath}"` });
  }
);

export const audioTranscribe = defineTool(
  'audio_transcribe',
  'Transcribe audio to text using Whisper',
  {
    type: 'object',
    properties: { file_path: { type: 'string', description: 'Path to the audio file' } },
    required: ['file_path'],
  },
  async (args: Record<string, unknown>): Promise<string> => {
    const filePath = args.file_path as string;
    if (!filePath) throw new Error('audio_transcribe requires "file_path"');
    try {
      const output = await runTerminalTool({ command: `whisper "${filePath}" --model tiny --output_format txt` });
      return output;
    } catch (err: any) {
      const errMsg = err?.message || String(err);
      if (errMsg.includes('command not found') || errMsg.includes('not recognized')) {
        throw new Error('Whisper not installed. Run: pip install openai-whisper');
      }
      throw new Error('Transcription failed: ' + errMsg);
    }
  }
);
