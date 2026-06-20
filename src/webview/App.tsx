// src/webview/App.tsx — PulseCode AI Agent (Antigravity-style, purple/black theme)
// Every tool has a dedicated UI card. Tester agent has collapsed/expanded timeline.

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { AgentAPI, AskUserQuestion, PermissionRequest, TodoItem, DiffEntry } from './agent-api';
import { QuestionDock } from './components/QuestionDock';
import { TodoPanel } from './components/TodoPanel';
import { PermissionDock } from './components/PermissionDock';
import {
  IconDoc, IconFolder, IconBrain, IconSearch,
  IconChevronDown, IconChevronUp, IconChevronRight,
  IconCheck, IconCircle, IconWarning, IconBolt, IconStar,
  IconPaperclip, IconSend, IconPlay, IconBrowser, IconDesktop,
  IconAndroid, IconMic, IconCamera, IconImage, IconEye,
  IconGlobe, IconTerminal, IconRobot, IconClock, IconX,
  IconSparkle, IconZap, IconLightbulb, IconClipboard,
  IconCircleFilled, IconArrowRight, IconMinus, IconPlus, IconSpinner,
  IconLock, IconRefreshCw,
} from './components/Icons';

// ─── Types ──────────────────────────────────────────────────────────
export interface ToolCall {
  id: string; name: string; path?: string; status: 'running'|'done'|'error';
  result?: string; output?: string; duration?: number;
  lines?: {type:'add'|'del'|'norm'; n?: string; text:string}[];
  matches?: {file:string;line:string;text:string}[];
  files?: string[]; error?: string; exitCode?: number;
  tests?: {s:'p'|'f'|'s';n:string;d:string}[];
  diags?: {sev:'e'|'w';loc:string;msg:string}[];
  git?: {s:string;f:string}[]; agent?: string;
  query?: string; fileCount?: number;
  screenshot?: string; url?: string; selector?: string;
  command?: string; device?: string; text?: string;
  imagePath?: string; imageBase64?: string;
}

// DiffEntry is imported from './agent-api'

export interface AgentEvent {
  id: string; type: 'analyzed-file' | 'analyzed-folder' | 'thought-process';
  title: string; path?: string; lineRange?: string;
  status: 'running' | 'done'; duration?: number;
  goal?: string; plan?: string[];
  steps?: { text: string; done: boolean }[];
}

export interface TesterStep {
  id: string; type: 'plan' | 'thinking' | 'working' | 'browser' | 'screenshot' | 'result';
  status: 'running' | 'done' | 'error';
  title: string; detail?: string; duration?: number;
  screenshot?: string; url?: string; selector?: string;
}

export interface TesterAgentState {
  id: string; name: string; status: 'running' | 'done' | 'error';
  testName?: string; sessionLabel?: string;
  elapsed?: number; steps: TesterStep[];
  plan?: string[]; currentStep?: number; totalSteps?: number;
}

export interface Message {
  id: string; role: 'user'|'assistant';
  text?: string; tools?: ToolCall[]; events?: AgentEvent[];
  testerAgent?: TesterAgentState;
  error?: string;
}

// ─── Status labels ──────────────────────────────────────────────────
const STATUS_LABELS: Record<string, string> = {
  'analyzed-file': 'Analyzing file...', 'analyzed-folder': 'Scanning folder...',
  'thought-process': 'Thinking...', 'bash': 'Running command...',
  'Terminal': 'Running command...', 'run_terminal': 'Running command...',
  'Read': 'Reading file...', 'read_file': 'Reading file...',
  'Write': 'Writing file...', 'write_file': 'Writing file...',
  'Edit': 'Editing...', 'edit_file': 'Editing...',
  'Search': 'Searching...', 'search_code': 'Searching...',
  'Glob': 'Listing files...', 'list_files': 'Listing files...',
  'Test': 'Running tests...', 'Diagnostics': 'Checking...',
  'Git': 'Checking git...', 'browser_navigate': 'Navigating...',
  'browser_click': 'Clicking...', 'browser_type': 'Typing...',
  'browser_screenshot': 'Taking screenshot...',
  'browser_assert_text': 'Asserting...', 'browser_get_text': 'Getting text...',
  'desktop_move_mouse': 'Moving mouse...', 'desktop_click': 'Clicking...',
  'desktop_type': 'Typing...', 'desktop_press_key': 'Pressing key...',
  'android_devices': 'Listing devices...', 'android_click': 'Tapping...',
  'android_type': 'Typing...', 'android_swipe': 'Swiping...',
  'android_screenshot': 'Capturing screen...',
  'audio_record': 'Recording...', 'audio_play': 'Playing...',
  'audio_transcribe': 'Transcribing...',
  'see_image': 'Analyzing image...', 'assert_image_contains': 'Asserting image...',
  'generate_image': 'Generating image...',
  'web_search': 'Searching web...', 'web_fetch': 'Fetching page...',
  'spawn_agent': 'Spawning agent...', 'get_subagent_result': 'Getting result...',
  'execute_plan': 'Executing plan...',
  'log_change': 'Logging change...', 'get_change_log': 'Getting log...',
  'revert_changes': 'Reverting changes...',
  'orchestrate': 'Orchestrating...', 'update_extension_code': 'Updating code...',
  'rollback_file': 'Rolling back...', 'get_current_file': 'Getting file...',
  'delete_file': 'Deleting...',
};

// ─── API instance ───────────────────────────────────────────────────
const api = new AgentAPI();


// NOTE: api.onAskUser and api.onPermissionRequest are wired up inside
// the App component via useEffect to avoid module-level side effects.


// ─── Breathing Indicator ────────────────────────────────────────────
function BreathingIndicator({ label, done }: { label: string; done?: boolean }) {
  return (
    <div className={'breathing' + (done ? ' done' : '')}>
      <span className="breathing-dots"><i /><i /><i /></span>
      <span className="breathing-label">{label}</span>
    </div>
  );
}

// ─── Streaming Text with shimmer cursor ─────────────────────────────
function StreamingText({ text, isStreaming }: { text: string; isStreaming: boolean }) {
  return (
    <div className="part-text streaming" id={'stream-' + text.substring(0, 8)}>
      <p>{text}<span className={isStreaming ? 'stream-cursor' : ''} /></p>
    </div>
  );
}

// ─── Thinking Card (Hermes-style reasoning card) ──────────────────────
// Shows the model's actual reasoning text streamed from the agent.
// Only renders when there is real thinking content (not just "Thinking..." placeholder).
function ThinkingCard({ event }: { event: AgentEvent }) {
  console.log('[CARD][ThinkingCard] render', { eventId: event.id, type: event.type, status: event.status, titleLen: event.title?.length || 0, hasGoal: !!event.goal, hasPlan: !!event.plan, planSteps: event.plan?.length || 0, hasSteps: !!event.steps, stepCount: event.steps?.length || 0, duration: event.duration });
  const [open, setOpen] = useState(true);
  const isStreaming = event.status === 'running';
  // Only show content if we have real thinking text
  const hasContent = event.title && event.title.trim().length > 0;

  // Don't render the card at all if there's no content and it's done
  if (!hasContent && !isStreaming) return null;

  // Keep open during streaming, collapse 3s after done
  useEffect(() => {
    if (!isStreaming && hasContent) {
      const timer = setTimeout(() => setOpen(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [isStreaming, hasContent]);

  return (
    <div
      className={'thinking-card' + (open ? ' open' : '') + (isStreaming ? ' streaming' : '')}
      data-streaming={isStreaming ? '' : undefined}
    >
      <div className="thinking-card-head" onClick={() => setOpen(!open)}>
        <span className="thinking-card-icon">
          {isStreaming
            ? <span className="thinking-spinner" />
            : <IconBrain size={13} color="var(--pc-accent)" />}
        </span>
        <span className="thinking-card-label">
          {isStreaming ? 'Thinking...' : '💭 Thought Process'}
        </span>
        {event.duration !== undefined && event.duration > 0 && !isStreaming && (
          <span className="thinking-card-dur">{(event.duration / 1000).toFixed(1)}s</span>
        )}
        <span className="thinking-card-chevron">
          {open ? <IconChevronUp size={10} /> : <IconChevronRight size={10} />}
        </span>
      </div>
      {open && hasContent && (
        <div className="thinking-card-body">
          {/* Main thinking content — the actual model reasoning text */}
          <div className={'thinking-card-content' + (isStreaming ? ' streaming-thought' : '')}>
            {event.title}
          </div>

          {/* Optional structured sections from agent events */}
          {event.goal && (
            <div className="thinking-card-section">
              <span className="thinking-card-section-label">Goal</span>
              <div className="thinking-card-section-text">{event.goal}</div>
            </div>
          )}
          {event.plan && event.plan.length > 0 && (
            <div className="thinking-card-section">
              <span className="thinking-card-section-label">Plan</span>
              {event.plan.map((step, i) => (
                <div key={i} className="thinking-card-plan-step">
                  <span className="thinking-card-plan-num">{i + 1}</span>
                  <span>{step}</span>
                </div>
              ))}
            </div>
          )}
          {event.steps && event.steps.length > 0 && (
            <div className="thinking-card-section">
              <span className="thinking-card-section-label">Steps</span>
              {event.steps.map((s, i) => (
                <div key={i} className={'thinking-card-step' + (s.done ? ' done' : '')}>
                  <span className="thinking-card-step-mk">
                    {s.done ? <IconCheck size={10} color="#22c55e" /> : <IconCircle size={10} />}
                  </span>
                  <span>{s.text}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════
// TESTER AGENT CARD — Collapsed / Expanded with timeline feed
// ═════════════════════════════════════════════════════════════════════
function TesterAgentCard({ agent }: { agent: TesterAgentState }) {
  console.log('[CARD][TesterAgentCard] render', { agentId: agent.id, name: agent.name, status: agent.status, testName: agent.testName, stepCount: agent.steps?.length || 0, planSteps: agent.plan?.length || 0, currentStep: agent.currentStep, totalSteps: agent.totalSteps, elapsed: agent.elapsed });
  const [open, setOpen] = useState(true);
  const isRunning = agent.status === 'running';
  const isError = agent.status === 'error';

  const statusColor = isError ? '#f14c4c' : isRunning ? 'var(--pc-accent)' : '#22c55e';
  const statusLabel = isError ? 'Failed' : isRunning ? 'Running...' : 'Completed';

  return (
    <div className={'tester-agent-card' + (open ? ' open' : '') + (isError ? ' err' : '')}>
      {/* ── Collapsed Header ── */}
      <div className="tester-head" onClick={() => setOpen(!open)}>
        <span className="tester-icon">
          <IconRobot size={16} color={statusColor} />
        </span>
        <div className="tester-head-main">
          <span className="tester-name">{agent.name}</span>
          {agent.sessionLabel && (
            <span className="tester-session">{agent.sessionLabel}</span>
          )}
        </div>
        <div className="tester-head-right">
          {agent.testName && (
            <span className="tester-test-name">{agent.testName}</span>
          )}
          {agent.elapsed != null && (
            <span className="tester-elapsed">
              <IconClock size={10} color="var(--pc-text-faint)" />
              {(agent.elapsed / 1000).toFixed(1)}s
            </span>
          )}
          <span className="tester-status" style={{ color: statusColor }}>
            {isRunning && <span className="status-dot run" style={{ background: statusColor }} />}
            {statusLabel}
          </span>
          <span className="tester-chevron">
            {open ? <IconChevronUp size={12} /> : <IconChevronDown size={12} />}
          </span>
        </div>
      </div>

      {/* ── Expanded Body ── */}
      {open && (
        <div className="tester-body">
          {/* Plan */}
          {agent.plan && agent.plan.length > 0 && (
            <div className="tester-section">
              <div className="tester-section-header">
                <IconCheck size={12} color="#22c55e" />
                <span>Plan</span>
              </div>
              <div className="tester-plan-list">
                {agent.plan.map((step, i) => (
                  <div key={i} className="tester-plan-step">
                    <span className="tester-plan-num">{i + 1}</span>
                    <span>{step}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Progress bar */}
          {agent.totalSteps && agent.totalSteps > 0 && (
            <div className="tester-progress">
              <div className="tester-progress-bar">
                <div
                  className="tester-progress-fill"
                  style={{ width: `${((agent.currentStep || 0) / agent.totalSteps) * 100}%` }}
                />
              </div>
              <span className="tester-progress-label">
                Step {agent.currentStep || 0} of {agent.totalSteps}
              </span>
            </div>
          )}

          {/* Timeline Feed */}
          <div className="tester-timeline">
            {agent.steps.map((step) => (
              <TimelineItem key={step.id} step={step} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Timeline Item ──────────────────────────────────────────────────
function TimelineItem({ step }: { step: TesterStep }) {
  const isRunning = step.status === 'running';
  const isError = step.status === 'error';
  const isDone = step.status === 'done';

  const iconMap: Record<string, React.ReactNode> = {
    'plan': <IconCheck size={12} color="#a487fa" />,
    'thinking': <IconBrain size={12} color="#c3b0ff" />,
    'working': isRunning ? <IconPlay size={12} color="var(--pc-accent)" /> : <IconCheck size={12} color="#22c55e" />,
    'browser': <IconBrowser size={12} color="#89d185" />,
    'screenshot': <IconCamera size={12} color="#cca700" />,
    'result': isError ? <IconX size={12} color="#f14c4c" /> : <IconCheck size={12} color="#22c55e" />,
  };

  const colorMap: Record<string, string> = {
    'plan': '#a487fa', 'thinking': '#c3b0ff', 'working': '#89d185',
    'browser': '#89d185', 'screenshot': '#cca700', 'result': isError ? '#f14c4c' : '#22c55e',
  };

  return (
    <div className={'tester-timeline-item' + (isRunning ? ' running' : '') + (isError ? ' error' : '')}>
      <div className="tester-timeline-dot" style={{ borderColor: colorMap[step.type] || 'var(--pc-accent)' }}>
        <span style={{ color: colorMap[step.type] || 'var(--pc-accent)' }}>
          {iconMap[step.type] || <IconCircle size={12} />}
        </span>
      </div>
      <div className="tester-timeline-content">
        <div className="tester-timeline-header">
          <span className="tester-timeline-title">{step.title}</span>
          {step.duration != null && step.duration > 0 && (
            <span className="tester-timeline-dur">{(step.duration / 1000).toFixed(1)}s</span>
          )}
          {isRunning && <span className="status-dot run" style={{ background: 'var(--pc-accent)' }} />}
        </div>
        {step.detail && <div className="tester-timeline-detail">{step.detail}</div>}
        {step.url && <div className="tester-timeline-url">→ {step.url}</div>}
        {step.selector && <div className="tester-timeline-selector">selector: {step.selector}</div>}
        {step.screenshot && (
          <div className="tester-timeline-screenshot">
            <IconCamera size={10} color="var(--pc-text-faint)" />
            <span>{step.screenshot}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════
// TOOL CARDS — One per tool type
// ═════════════════════════════════════════════════════════════════════

function ToolCard({ tool }: { tool: ToolCall }) {
  console.log('[CARD][ToolCard] render', { toolId: tool.id, name: tool.name, status: tool.status, path: tool.path, url: tool.url, selector: tool.selector, command: tool.command?.substring(0, 60), duration: tool.duration, hasResult: !!tool.result, resultLen: tool.result?.length || 0, hasOutput: !!tool.output, outputLen: tool.output?.length || 0, hasLines: !!tool.lines, lineCount: tool.lines?.length || 0, hasMatches: !!tool.matches, matchCount: tool.matches?.length || 0, hasScreenshot: !!tool.screenshot, hasImage: !!tool.imageBase64 || !!tool.imagePath });
  const [open, setOpen] = useState(true);
  const isErr = tool.status === 'error';
  const name = toolName(tool.name);
  const icon = toolIcon(tool.name);

  // Check if this is a browser or desktop tool
  const isBrowserTool = tool.name.startsWith('browser_');
  const isDesktopTool = tool.name.startsWith('desktop_');

  // Browser/Desktop tools get the new professional card design
  if (isBrowserTool || isDesktopTool) {
    return (
      <div className={`tool-card browser-card ${isDesktopTool ? 'desktop-card' : ''} ${isErr ? 'err' : ''} ${tool.status} ${open ? 'open' : ''}`}>
        {/* ═══ HEADER ═══ */}
        <div className="browser-card-header" onClick={() => setOpen(!open)}>
          <div className="browser-card-left">
            <div className={`browser-icon ${isDesktopTool ? 'desktop' : ''}`}>
              {isBrowserTool ? (
                <IconBrowser size={16} color="var(--pc-accent)" />
              ) : (
                <IconDesktop size={16} color="var(--pc-accent)" />
              )}
            </div>
            <div>
              <div className="browser-tool-name">{name}</div>
              {tool.url && <div className="browser-url">{new URL(tool.url).hostname}</div>}
              {tool.selector && <div className="browser-url">{tool.selector}</div>}
            </div>
          </div>
          <div className="browser-card-right">
            <span className={`status-badge ${tool.status}`}>
              <span className={`status-dot ${tool.status}`}></span>
              {tool.status === 'running' ? 'Running' : tool.status === 'done' ? 'Completed' : 'Error'}
            </span>
            {tool.duration != null && tool.duration > 0 && (
              <span className="elapsed">{(tool.duration / 1000).toFixed(1)}s</span>
            )}
            {tool.status === 'running' && (
              <button className="stop-btn" onClick={(e) => { e.stopPropagation(); api.stopTool?.(tool.id); }}>
                <IconX size={10} />
              </button>
            )}
            <span className="browser-expand">{open ? <IconChevronUp size={10} /> : <IconChevronDown size={10} />}</span>
          </div>
        </div>

        {/* ═══ BODY ═══ */}
        {open && (
          <div className="browser-card-body">
            {/* GOAL / RESULT */}
            {tool.result && (
              <div className="browser-section">
                <div className="browser-section-label">Result</div>
                <div className="browser-goal">{tool.result}</div>
              </div>
            )}

            {/* URL BAR (browser tools) */}
            {isBrowserTool && tool.url && (
              <div className="url-box">
                <IconLock size={11} color="var(--pc-text-faint)" />
                <span className="url-text">{tool.url}</span>
                <button className="url-action" onClick={() => window.open(tool.url, '_blank')}>
                  <IconGlobe size={11} />
                </button>
              </div>
            )}

            {/* COORDINATES (desktop tools) */}
            {isDesktopTool && tool.output && (
              <div className="coords-display">
                <div className="coord-item">
                  <span className="coord-label">X</span>
                  <span className="coord-value">{tool.output.match(/X:\s*(\d+)/)?.[1] || '—'}</span>
                </div>
                <div className="coord-item">
                  <span className="coord-label">Y</span>
                  <span className="coord-value">{tool.output.match(/Y:\s*(\d+)/)?.[1] || '—'}</span>
                </div>
              </div>
            )}

            {/* PROGRESS BAR (running) */}
            {tool.status === 'running' && (
              <div className="progress">
                <div className="progress-bar">
                  <div className="progress-fill" style={{ width: '60%' }}></div>
                </div>
              </div>
            )}

            {/* SCREENSHOT */}
            {tool.screenshot && (
              <div className="screenshot">
                <span className="screenshot-placeholder">
                  <IconCamera size={14} color="var(--pc-text-faint)" />
                  <span>Screenshot captured</span>
                </span>
                <div className="screenshot-actions">
                  <button><IconEye size={10} /> Full Size</button>
                  <button><IconPaperclip size={10} /> Download</button>
                </div>
              </div>
            )}

            {/* OUTPUT */}
            {tool.output && (
              <div className="output">{tool.output}</div>
            )}

            {/* FOOTER */}
            <div className="browser-footer">
              <span className="browser-footer-time">
                {new Date().toLocaleTimeString()} • {name}
              </span>
              <div className="browser-footer-actions">
                {tool.status === 'done' && tool.url && (
                  <button className="browser-action-btn" onClick={() => window.open(tool.url, '_blank')}>
                    <IconGlobe size={10} /> View Page
                  </button>
                )}
                {tool.status === 'done' && tool.screenshot && (
                  <button className="browser-action-btn">
                    <IconEye size={10} /> Screenshot
                  </button>
                )}
                {tool.status === 'error' && (
                  <button className="browser-action-btn retry">
                    <IconRefreshCw size={10} /> Retry
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ═══ ORIGINAL TOOL CARD (for non-browser/desktop tools) ═══
  return (
    <div className={'tool-card' + (isErr ? ' err' : '') + (open ? ' open' : '')}>
      <div className="tool-head" onClick={() => setOpen(!open)}>
        <span className="tool-icon">{icon}</span>
        <span className="tool-name">
          {name}
          {tool.path && <span className="path"> {tool.path}</span>}
          {tool.url && <span className="path"> {tool.url}</span>}
          {tool.selector && <span className="path"> {tool.selector}</span>}
          {tool.command && <span className="path"> {tool.command}</span>}
          {tool.device && <span className="path"> {tool.device}</span>}
        </span>
        <span className="tool-meta">
          {tool.lines && (
            <>
              <span className="lc add">+{tool.lines.filter(l => l.type === 'add').length}</span>
              <span className="lc del">-{tool.lines.filter(l => l.type === 'del').length}</span>
            </>
          )}
          {tool.matches && <span className="badge">{tool.matches.length} matches</span>}
          {tool.tests && (
            <>
              {tool.tests.filter(t => t.s === 'p').length > 0 && (
                <span className="badge green">{tool.tests.filter(t => t.s === 'p').length} passed</span>
              )}
              {tool.tests.filter(t => t.s === 'f').length > 0 && (
                <span className="badge red">{tool.tests.filter(t => t.s === 'f').length} failed</span>
              )}
            </>
          )}
          {tool.diag && (
            <>
              {tool.diag.filter(d => d.sev === 'e').length > 0 && (
                <span className="badge red">{tool.diag.filter(d => d.sev === 'e').length} errors</span>
              )}
              {tool.diag.filter(d => d.sev === 'w').length > 0 && (
                <span className="badge amber">{tool.diag.filter(d => d.sev === 'w').length} warnings</span>
              )}
            </>
          )}
          {tool.git && <span className="badge">{tool.git.length} changed</span>}
          {tool.fileCount && <span className="badge">{tool.fileCount} files</span>}
          {tool.duration != null && tool.duration > 0 && (
            <span className="lc">{(tool.duration / 1000).toFixed(1)}s</span>
          )}
          <span className={'status-dot ' + (isErr ? 'err' : tool.status === 'running' ? 'run' : 'ok')} />
        </span>
      </div>

      {open && (
        <div className="tool-body">
          {renderToolBody(tool)}
        </div>
      )}
    </div>
  );
}

// ─── Terminal Card ──────────────────────────────────────────────────
function TerminalCard({ cmd, output, exitCode, duration, err, status }: { cmd: string; output: string; exitCode?: number; duration?: number; err?: boolean; status?: string }) {
  console.log('[CARD][TerminalCard] render', { cmd: cmd?.substring(0, 80), outputLen: output?.length || 0, lineCount: output?.split('\n').length || 0, exitCode, duration, err, status });
  const [copied, setCopied] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const lines = (output || '').split('\n');
  const isRunning = status === 'running';

  // Auto-expand when running, collapse is manual
  useEffect(() => {
    if (isRunning) setCollapsed(false);
  }, [isRunning]);

  const handleCopy = () => {
    const text = `> ${cmd}\n${output || '(no output)'}`;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className={'terminal-card' + (err ? ' err' : '') + (isRunning ? ' running' : '')}>
      {/* ── Title Bar (clickable to collapse) ── */}
      <div className="terminal-card-bar" onClick={() => setCollapsed(!collapsed)}>
        <span className="terminal-card-dots">
          <i /><i /><i />
        </span>
        <span className="terminal-card-title">
          <span className="terminal-card-shell">bash</span>
          <span className="terminal-card-path">C:\Projects\CodeGalaxy</span>
          <span className="terminal-card-cmd">{cmd.length > 60 ? cmd.substring(0, 60) + '...' : cmd}</span>
        </span>
        <div className="terminal-card-actions" onClick={(e) => e.stopPropagation()}>
          {isRunning && <span className="terminal-card-live">LIVE</span>}
          <button className={'terminal-card-copy' + (copied ? ' copied' : '')} onClick={handleCopy}>
            {copied ? '✓' : 'Copy'}
          </button>
          {duration != null && duration > 0 && (
            <span className="terminal-card-dur">{(duration / 1000).toFixed(1)}s</span>
          )}
          {exitCode != null && (
            <span className={'terminal-card-exit' + (exitCode === 0 ? '' : ' err')}>
              exit {exitCode}
            </span>
          )}
          <span className={'terminal-card-chevron' + (collapsed ? '' : ' open')}>
            {collapsed ? '▶' : '▼'}
          </span>
        </div>
      </div>

      {/* ── Output Area (collapsible) ── */}
      {!collapsed && (
        <div className="terminal-card-output">
          {lines.map((line, i) => (
            <div key={i} className="terminal-card-line">
              <span className="terminal-card-prompt">&gt;</span>
              <span className="terminal-card-text">{line}</span>
            </div>
          ))}
          {isRunning && <span className="terminal-card-cursor">_</span>}
        </div>
      )}
    </div>
  );
}

// ─── Render tool body based on tool name ────────────────────────────
function renderToolBody(tool: ToolCall): React.ReactNode {
  const n = tool.name;

  // ── Terminal ──
  if (n === 'bash' || n === 'Terminal' || n === 'run_terminal') {
    return <TerminalCard cmd={tool.command || tool.path || ''} output={tool.output || tool.result || ''} exitCode={tool.exitCode} duration={tool.duration} err={tool.status === 'error'} status={tool.status} />;
  }

  // ── File: read ──
  if (n === 'Read' || n === 'read_file' || n === 'get_current_file') {
    return (
      <div className="file-snippet">
        {(tool.result || '').split('\n').map((l, i) => (
          <div key={i}><span className="gut">{i + 1}</span>{l}</div>
        ))}
      </div>
    );
  }

  // ── File: write ──
  if (n === 'Write' || n === 'write_file') {
    return <div className="tool-content mono">{tool.result}</div>;
  }

  // ── File: edit (diff) ──
  if (n === 'Edit' || n === 'edit_file') {
    if (tool.lines && tool.lines.length > 0) {
      return (
        <div className="diff-lines">
          {tool.lines.map((l, i) => (
            <div key={i} className={'ln ' + l.type}>{l.text}</div>
          ))}
        </div>
      );
    }
    return <div className="tool-content mono">{tool.result}</div>;
  }

  // ── File: delete ──
  if (n === 'delete_file') {
    return <div className="tool-content mono">{tool.result || 'Deleted'}</div>;
  }

  // ── File: rollback ──
  if (n === 'rollback_file') {
    return <div className="tool-content mono">{tool.result || 'Rolled back'}</div>;
  }

  // ── File: update extension ──
  if (n === 'update_extension_code') {
    return <div className="tool-content mono">{tool.result || 'Updated'}</div>;
  }

  // ── Search ──
  if (n === 'Search' || n === 'search_code') {
    if (tool.matches && tool.matches.length > 0) {
      return (
        <div>
          {tool.matches.map((m, i) => (
            <div key={i} className="result-row">
              <span className="rf">{m.file}</span>
              <span className="rl">{m.line}</span>
              <span className="rt">{m.text}</span>
            </div>
          ))}
        </div>
      );
    }
    return <div className="tool-content mono">{tool.result || 'No matches'}</div>;
  }

  // ── List files ──
  if (n === 'Glob' || n === 'list_files') {
    if (tool.files && tool.files.length > 0) {
      return (
        <div className="file-list">
          {tool.files.map((f, i) => (
            <span key={i} className="file-tag">
              <span className="dot"><IconDoc size={11} color="var(--pc-text-weak)" /></span>{f}
            </span>
          ))}
        </div>
      );
    }
    // Parse result lines with DIR:/FILE: prefix for SVG icon rendering
    const entries = (tool.result || '').split('\n').filter(Boolean);
    return (
      <div className="file-list">
        {entries.map((e, i) => {
          const isDir = e.startsWith('DIR:');
          const isFile = e.startsWith('FILE:');
          const name = isDir || isFile ? e.substring(4) : e;
          const Icon = isDir ? IconFolder : IconDoc;
          return (
            <span key={i} className="file-tag">
              <span className="dot"><Icon size={11} color={isDir ? 'var(--pc-accent)' : 'var(--pc-text-weak)'} /></span>{name}
            </span>
          );
        })}
      </div>
    );
  }

  // ── Browser: navigate ──
  if (n === 'browser_navigate') {
    return (
      <div>
        {tool.url && (
          <div className="browser-url">
            <IconGlobe size={12} color="var(--pc-accent)" />
            <span>{tool.url}</span>
          </div>
        )}
        {tool.screenshot && (
          <div className="browser-screenshot">
            <IconCamera size={12} color="var(--pc-text-faint)" />
            <span>{tool.screenshot}</span>
          </div>
        )}
        <div className="tool-content mono">{tool.result}</div>
      </div>
    );
  }

  // ── Browser: click ──
  if (n === 'browser_click') {
    return (
      <div>
        {tool.selector && (
          <div className="browser-action">
            <IconPlay size={10} color="#89d185" />
            <span>Click: {tool.selector}</span>
          </div>
        )}
        {tool.screenshot && (
          <div className="browser-screenshot">
            <IconCamera size={12} color="var(--pc-text-faint)" />
            <span>{tool.screenshot}</span>
          </div>
        )}
        <div className="tool-content mono">{tool.result}</div>
      </div>
    );
  }

  // ── Browser: type ──
  if (n === 'browser_type') {
    return (
      <div>
        {tool.selector && tool.text && (
          <div className="browser-action">
            <IconPlay size={10} color="#89d185" />
            <span>Type "{tool.text}" into {tool.selector}</span>
          </div>
        )}
        {tool.screenshot && (
          <div className="browser-screenshot">
            <IconCamera size={12} color="var(--pc-text-faint)" />
            <span>{tool.screenshot}</span>
          </div>
        )}
        <div className="tool-content mono">{tool.result}</div>
      </div>
    );
  }

  // ── Browser: screenshot ──
  if (n === 'browser_screenshot') {
    return (
      <div>
        {tool.screenshot && (
          <div className="browser-screenshot">
            <IconCamera size={12} color="#cca700" />
            <span>{tool.screenshot}</span>
          </div>
        )}
        <div className="tool-content mono">{tool.result}</div>
      </div>
    );
  }

  // ── Browser: assert text ──
  if (n === 'browser_assert_text') {
    const passed = tool.result?.includes('PASS');
    return (
      <div>
        <div className={'browser-assert ' + (passed ? 'pass' : 'fail')}>
          {passed ? <IconCheck size={12} color="#22c55e" /> : <IconX size={12} color="#f14c4c" />}
          <span>{tool.result}</span>
        </div>
        {tool.screenshot && (
          <div className="browser-screenshot">
            <IconCamera size={12} color="var(--pc-text-faint)" />
            <span>{tool.screenshot}</span>
          </div>
        )}
      </div>
    );
  }

  // ── Browser: get text ──
  if (n === 'browser_get_text') {
    return (
      <div>
        {tool.selector && (
          <div className="browser-action">
            <IconEye size={10} color="#89d185" />
            <span>Get text: {tool.selector}</span>
          </div>
        )}
        <div className="tool-content mono">{tool.result}</div>
      </div>
    );
  }

  // ── Desktop: move mouse ──
  if (n === 'desktop_move_mouse') {
    return (
      <div className="tool-content mono">
        <IconDesktop size={12} color="var(--pc-accent)" />
        <span> {tool.result}</span>
      </div>
    );
  }

  // ── Desktop: click ──
  if (n === 'desktop_click') {
    return (
      <div className="tool-content mono">
        <IconDesktop size={12} color="var(--pc-accent)" />
        <span> {tool.result}</span>
      </div>
    );
  }

  // ── Desktop: type ──
  if (n === 'desktop_type') {
    return (
      <div className="tool-content mono">
        <IconDesktop size={12} color="var(--pc-accent)" />
        <span> {tool.result}</span>
      </div>
    );
  }

  // ── Desktop: press key ──
  if (n === 'desktop_press_key') {
    return (
      <div className="tool-content mono">
        <IconDesktop size={12} color="var(--pc-accent)" />
        <span> {tool.result}</span>
      </div>
    );
  }

  // ── Android: devices ──
  if (n === 'android_devices') {
    return (
      <div className="android-devices">
        {(tool.result || '').split('\n').filter(Boolean).map((line, i) => (
          <div key={i} className="android-device-row">
            <IconAndroid size={12} color="#4ec9b0" />
            <span>{line}</span>
          </div>
        ))}
      </div>
    );
  }

  // ── Android: click / type / swipe ──
  if (n === 'android_click' || n === 'android_type' || n === 'android_swipe') {
    return (
      <div className="tool-content mono">
        <IconAndroid size={12} color="#4ec9b0" />
        <span> {tool.result}</span>
      </div>
    );
  }

  // ── Android: screenshot ──
  if (n === 'android_screenshot') {
    return (
      <div>
        <div className="browser-screenshot">
          <IconCamera size={12} color="#cca700" />
          <span>{tool.screenshot || tool.result}</span>
        </div>
      </div>
    );
  }

  // ── Audio: record ──
  if (n === 'audio_record') {
    return (
      <div className="tool-content mono">
        <IconMic size={12} color="#c586c0" />
        <span> {tool.result}</span>
      </div>
    );
  }

  // ── Audio: play ──
  if (n === 'audio_play') {
    return (
      <div className="tool-content mono">
        <IconPlay size={12} color="#c586c0" />
        <span> {tool.result}</span>
      </div>
    );
  }

  // ── Audio: transcribe ──
  if (n === 'audio_transcribe') {
    return (
      <div className="tool-content mono">
        <IconMic size={12} color="#c586c0" />
        <span> {tool.result}</span>
      </div>
    );
  }

  // ── Vision: see image ──
  if (n === 'see_image') {
    return (
      <div>
        {tool.path && (
          <div className="vision-image">
            <IconEye size={12} color="var(--pc-accent)" />
            <span>{tool.path}</span>
          </div>
        )}
        <div className="tool-content">{tool.result}</div>
      </div>
    );
  }

  // ── Vision: assert image ──
  if (n === 'assert_image_contains') {
    const passed = tool.result?.includes('PASS') || tool.result?.includes('✓') || tool.result?.includes('OK');
    return (
      <div>
        <div className={'browser-assert ' + (passed ? 'pass' : 'fail')}>
          {passed ? <IconCheck size={12} color="#22c55e" /> : <IconX size={12} color="#f14c4c" />}
          <span>{tool.result}</span>
        </div>
      </div>
    );
  }

  // ── Image generation ──
  if (n === 'generate_image') {
    const isRunning = tool.status === 'running';
    const hasImage = tool.imageBase64 || tool.imagePath;
    const isDone = tool.status === 'done';

    return (
      <div className={`image-gen-card ${isRunning ? 'generating' : ''} ${isDone && hasImage ? 'done' : ''}`}>
        {isRunning && !hasImage && (
          <div className="image-gen-loading">
            <div className="image-gen-placeholder">
              <div className="image-gen-shimmer" />
              <span className="image-gen-label">Generating image...</span>
            </div>
          </div>
        )}
        {isDone && hasImage && (
          <div className="image-gen-reveal">
            <img
              src={tool.imageBase64 ? `data:image/png;base64,${tool.imageBase64}` : ''}
              alt="Generated image"
              className="image-gen-result"
            />
          </div>
        )}
        {isDone && !hasImage && (
          <div className="image-gen-text">
            <IconImage size={12} color="var(--pc-accent)" />
            <span>{tool.result}</span>
          </div>
        )}
        {tool.result && hasImage && (
          <div className="image-gen-caption">{tool.result}</div>
        )}
      </div>
    );
  }

  // ── Web: search ──
  if (n === 'web_search') {
    const lines = (tool.result || '').split('\n').filter(Boolean);
    return (
      <div className="web-results">
        {lines.map((line, i) => (
          <div key={i} className="web-row">
            <span className="web-fav"><IconSearch size={10} /></span>
            <span>{line.replace(/^\[\d+\]\s*/, '')}</span>
          </div>
        ))}
      </div>
    );
  }

  // ── Web: fetch ──
  if (n === 'web_fetch') {
    return (
      <div>
        {tool.url && (
          <div className="browser-url">
            <IconGlobe size={12} color="var(--pc-accent)" />
            <span>{tool.url}</span>
          </div>
        )}
        <div className="tool-content mono" style={{ maxHeight: 200, overflow: 'auto' }}>
          {tool.result}
        </div>
      </div>
    );
  }

  // ── Agent: spawn ──
  if (n === 'spawn_agent') {
    return (
      <div className="subagent">
        <div className="sa-head">
          <IconBrain size={12} color="var(--pc-accent)" />
          <span>Sub-agent spawned</span>
        </div>
        <div className="sa-body">
          <div className="sa-step"><span className="m"><IconArrowRight size={10} color="var(--pc-accent)" /></span><span>{tool.result}</span></div>
        </div>
      </div>
    );
  }

  // ── Agent: get result ──
  if (n === 'get_subagent_result') {
    return (
      <div className="subagent">
        <div className="sa-head">
          <IconCheck size={12} color="#22c55e" />
          <span>Sub-agent result</span>
        </div>
        <div className="sa-body">
          <div className="sa-step"><span>{tool.result}</span></div>
        </div>
      </div>
    );
  }

  // ── Agent: execute plan ──
  if (n === 'execute_plan') {
    return <div className="tool-content mono">{tool.result}</div>;
  }

  // ── Change: log ──
  if (n === 'log_change') {
    return (
      <div className="tool-content mono">
        <IconCheck size={12} color="#22c55e" />
        <span> {tool.result}</span>
      </div>
    );
  }

  // ── Change: get log ──
  if (n === 'get_change_log') {
    return (
      <div className="change-log">
        {(tool.result || '').split('\n').filter(Boolean).map((line, i) => (
          <div key={i} className="change-log-row">{line}</div>
        ))}
      </div>
    );
  }

  // ── Change: revert ──
  if (n === 'revert_changes') {
    return (
      <div className="tool-content mono">
        <IconCheck size={12} color="#22c55e" />
        <span> {tool.result}</span>
      </div>
    );
  }

  // ── Orchestrate ──
  if (n === 'orchestrate') {
    try {
      const parsed = JSON.parse(tool.result || '{}');
      return (
        <div className="tool-content mono">
          <IconBrain size={12} color="var(--pc-accent)" />
          <span> Phase: {parsed.phase || 'unknown'} | Mode: {parsed.mode || 'unknown'}</span>
          {parsed.result && <div style={{ marginTop: 6 }}>{typeof parsed.result === 'string' ? parsed.result : JSON.stringify(parsed.result)}</div>}
        </div>
      );
    } catch {
      return <div className="tool-content mono">{tool.result}</div>;
    }
  }

  // ── Tests ──
  if (n === 'Test') {
    if (tool.tests && tool.tests.length > 0) {
      return (
        <div>
          {tool.tests.map((t, i) => (
            <div key={i} className="test-row">
              <span className={'tk ' + t.s}>
                {t.s === 'p' ? <IconCheck size={10} color="#22c55e" /> : t.s === 'f' ? <IconWarning size={10} color="#f14c4c" /> : <IconCircle size={10} />}
              </span>
              <span className="tn">{t.n}</span>
              <span className="td">{t.d}</span>
            </div>
          ))}
        </div>
      );
    }
  }

  // ── Diagnostics ──
  if (n === 'Diagnostics') {
    if (tool.diag && tool.diag.length > 0) {
      return (
        <div>
          {tool.diag.map((d, i) => (
            <div key={i} className="diag">
              <span className={'sev ' + d.sev}>
                {d.sev === 'e' ? <IconWarning size={10} color="#f14c4c" /> : <IconWarning size={10} color="#febc2e" />}
              </span>
              <span className="loc">{d.loc}</span>
              <span className="msg">{d.msg}</span>
            </div>
          ))}
        </div>
      );
    }
  }

  // ── Git ──
  if (n === 'Git') {
    if (tool.git && tool.git.length > 0) {
      return (
        <div>
          {tool.git.map((g, i) => (
            <div key={i} className="git-row">
              <span className={'gs ' + g.s.toLowerCase()}>{g.s}</span>
              <span className="gf">{g.f}</span>
            </div>
          ))}
        </div>
      );
    }
  }

  // ── Fallback: generic ──
  return <div className="tool-content mono">{tool.result || tool.output || 'No output'}</div>;
}

// ─── Tool icon / name helpers ───────────────────────────────────────
function toolIcon(name: string): React.ReactNode {
  const icons: Record<string, React.ReactNode> = {
    bash: <IconTerminal size={12} />, Terminal: <IconTerminal size={12} />, run_terminal: <IconTerminal size={12} />,
    Read: <IconDoc size={12} />, read_file: <IconDoc size={12} />, get_current_file: <IconDoc size={12} />,
    Write: <IconDoc size={12} />, write_file: <IconDoc size={12} />,
    Edit: <IconDoc size={12} />, edit_file: <IconDoc size={12} />,
    delete_file: <IconDoc size={12} />, rollback_file: <IconDoc size={12} />, update_extension_code: <IconDoc size={12} />,
    Search: <IconSearch size={12} />, search_code: <IconSearch size={12} />,
    Glob: <IconFolder size={12} />, list_files: <IconFolder size={12} />,
    browser_navigate: <IconBrowser size={12} />, browser_click: <IconBrowser size={12} />,
    browser_type: <IconBrowser size={12} />, browser_screenshot: <IconCamera size={12} />,
    browser_assert_text: <IconBrowser size={12} />, browser_get_text: <IconBrowser size={12} />,
    desktop_move_mouse: <IconDesktop size={12} />, desktop_click: <IconDesktop size={12} />,
    desktop_type: <IconDesktop size={12} />, desktop_press_key: <IconDesktop size={12} />,
    android_devices: <IconAndroid size={12} />, android_click: <IconAndroid size={12} />,
    android_type: <IconAndroid size={12} />, android_swipe: <IconAndroid size={12} />,
    android_screenshot: <IconAndroid size={12} />,
    audio_record: <IconMic size={12} />, audio_play: <IconPlay size={12} />, audio_transcribe: <IconMic size={12} />,
    see_image: <IconEye size={12} />, assert_image_contains: <IconEye size={12} />,
    generate_image: <IconImage size={12} />,
    web_search: <IconSearch size={12} />, web_fetch: <IconGlobe size={12} />,
    spawn_agent: <IconBrain size={12} />, get_subagent_result: <IconBrain size={12} />,
    execute_plan: <IconBrain size={12} />, orchestrate: <IconBrain size={12} />,
    log_change: <IconCheck size={12} />, get_change_log: <IconDoc size={12} />, revert_changes: <IconCheck size={12} />,
    Test: <IconCheck size={12} />, Diagnostics: <IconWarning size={12} />, Git: <IconFolder size={12} />,
  };
  return icons[name] || <IconDoc size={12} />;
}

function toolName(name: string): string {
  const nm: Record<string, string> = {
    bash: 'Terminal', Terminal: 'Terminal', run_terminal: 'Terminal',
    Read: 'Read', read_file: 'Read', get_current_file: 'Read',
    Write: 'Write', write_file: 'Write', Edit: 'Edit', edit_file: 'Edit',
    delete_file: 'Delete', rollback_file: 'Rollback', update_extension_code: 'Update Code',
    Search: 'Search', search_code: 'Search', Glob: 'Glob', list_files: 'Glob',
    browser_navigate: 'Navigate', browser_click: 'Click', browser_type: 'Type',
    browser_screenshot: 'Screenshot', browser_assert_text: 'Assert', browser_get_text: 'Get Text',
    desktop_move_mouse: 'Move Mouse', desktop_click: 'Click', desktop_type: 'Type', desktop_press_key: 'Press Key',
    android_devices: 'Devices', android_click: 'Tap', android_type: 'Type',
    android_swipe: 'Swipe', android_screenshot: 'Screenshot',
    audio_record: 'Record', audio_play: 'Play', audio_transcribe: 'Transcribe',
    see_image: 'See Image', assert_image_contains: 'Assert Image',
    generate_image: 'Generate',
    web_search: 'Web Search', web_fetch: 'Fetch',
    spawn_agent: 'Spawn Agent', get_subagent_result: 'Agent Result',
    execute_plan: 'Execute Plan', orchestrate: 'Orchestrate',
    log_change: 'Log Change', get_change_log: 'Change Log', revert_changes: 'Revert',
  };
  return nm[name] || name;
}

  // Provider display info (module-level, created once)
const PROVIDER_INFO: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  openrouter: { label: 'OpenRouter', color: '#8B5CF6', icon: <IconGlobe size={14} color="#8B5CF6" /> },
  groq:       { label: 'Groq',       color: '#22c55e', icon: <IconZap size={14} color="#22c55e" /> },
  nvidia:     { label: 'NVIDIA',     color: '#76b900', icon: <IconBolt size={14} color="#76b900" /> },
  bluesminds: { label: 'Bluesminds', color: '#3b82f6', icon: <IconBrain size={14} color="#3b82f6" /> },
  custom:     { label: 'Custom',     color: '#cca700', icon: <IconDesktop size={14} color="#cca700" /> },
};

// ═════════════════════════════════════════════════════════════════════
// MAIN APP
// ═════════════════════════════════════════════════════════════════════
export function App() {
  const [theme, setTheme] = useState('pulse-vscode');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [askQ, setAskQ] = useState<AskUserQuestion | null>(null);
  const [askA, setAskA] = useState('');
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [permReq, setPermReq] = useState<PermissionRequest | null>(null);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [sessionSearch, setSessionSearch] = useState('');
  const [searchResults, setSearchResults] = useState<SessionSearchResult[]>([]);
  const [showSearch, setShowSearch] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<string>(() => 'sess_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8));
  const activeSessionIdRef = useRef(activeSessionId);
  activeSessionIdRef.current = activeSessionId;
  const [activeSessionName, setActiveSessionName] = useState<string>('');
  const [conversationActive, setConversationActive] = useState(false);
  const [currentModel, setCurrentModel] = useState('');
  const [currentProvider, setCurrentProvider] = useState('');
  const [currentBaseURL, setCurrentBaseURL] = useState('');

  // ═══ Diff View State ═══
  const [diffViewOpen, setDiffViewOpen] = useState(false);
  const [diffEntries, setDiffEntries] = useState<DiffEntry[]>([]);
  const [diffSelectedIdx, setDiffSelectedIdx] = useState(0);

  // Collect diff data from tool calls
  const collectDiffFromTool = useCallback((tool: ToolCall) => {
    if ((tool.name === 'write_file' || tool.name === 'edit_file' || tool.name === 'Write' || tool.name === 'Edit') && tool.path) {
      const entry: DiffEntry = {
        id: tool.id,
        path: tool.path,
        name: tool.path.split('/').pop() || tool.path,
        status: tool.status,
        lines: tool.lines || [],
        result: tool.result || '',
        duration: tool.duration,
        toolName: tool.name,
      };
      setDiffEntries(prev => {
        const existing = prev.findIndex(e => e.path === entry.path);
        if (existing >= 0) {
          const updated = [...prev];
          updated[existing] = entry;
          return updated;
        }
        return [...prev, entry];
      });
    }
  }, []);

  // Derived: has any diffs
  const hasDiffs = diffEntries.length > 0;
  const currentDiff = diffEntries[diffSelectedIdx] || null;
  const [showModelSelector, setShowModelSelector] = useState(false);
  const modelSelectorRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const streamingMsgId = useRef<string | null>(null);
  const streamingText = useRef<string>('');

  useEffect(() => { document.documentElement.setAttribute('data-theme', theme); }, [theme]);
  useEffect(() => { listRef.current?.scrollTo(0, listRef.current.scrollHeight); }, [messages]);

  // Wire up API callbacks (moved from module scope to avoid stale closures)
  useEffect(() => {
    api.onAskUser((q: AskUserQuestion) => {
      setAskQ({ ...q, allowCustom: true, multiple: false });
    });
    api.onPermissionRequest((r: PermissionRequest) => {
      setPermReq(r);
    });
  }, []);

  // Close model selector on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (modelSelectorRef.current && !modelSelectorRef.current.contains(e.target as Node)) {
        setShowModelSelector(false);
      }
    };
    if (showModelSelector) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showModelSelector]);

  // ── Load sessions on mount ──
  useEffect(() => {
    api.requestSessions().then(s => setSessions(s));
  }, []);

  // ── Message handler ──
    useEffect(() => {
      const handler = (event: MessageEvent) => {
        const msg = event.data;
        console.log('[PulseAgent Webview] Received command:', msg.command, msg);

        if (msg.command === 'modelUpdate') {
          console.log('[PulseAgent Webview] Model update:', msg.model, msg.provider);
          setCurrentModel(msg.model || '');
          setCurrentProvider(msg.provider || '');
          setCurrentBaseURL(msg.baseURL || '');
          return;
        }
        if (msg.command === 'sessionList') {
          console.log('[PulseAgent Webview] Sessions:', msg.sessions?.length);
          setSessions(msg.sessions || []);
          return;
        }
        if (msg.command === 'sessionSearchResults') {
          setSearchResults(msg.results || []);
          return;
        }
        if (msg.command === 'newSessionStarted') {
          console.log('[PulseAgent Webview] New session started');
          setMessages([]);
          setActiveSessionId(null);
          activeSessionIdRef.current = null;
          api.requestSessions().then(s => setSessions(s));
          return;
        }
        if (msg.command === 'sessionTitleUpdate') {
          if (msg.sessionId === activeSessionIdRef.current) {
            setActiveSessionName(msg.title || '');
          }
          return;
        }
        if (msg.command === 'loadHistory' && msg.history) {
          console.log('[PulseAgent Webview] Load history:', msg.history.length, 'messages');
          const loaded: Message[] = [];
          let idx = 0;
          for (const h of msg.history) {
            if (h.role === 'user') {
              loaded.push({ id: 'u_' + Date.now() + '_' + idx + '_' + Math.random().toString(36).substring(2, 10), role: 'user', text: h.content });
            } else if (h.role === 'assistant') {
              loaded.push({ id: 'a_' + Date.now() + '_' + idx + '_' + Math.random().toString(36).substring(2, 10), role: 'assistant', text: h.content });
            }
            idx++;
          }
          setMessages(loaded);
          if (msg.sessionId) setActiveSessionId(msg.sessionId);
          return;
        }

        // ── Thinking status — creates/updates a single thinking card per message ──
        if (msg.command === 'thinking') {
          const msgId = msg.requestId || streamingMsgId.current;
          console.log('[PulseAgent Webview] Thinking status:', msg.text?.substring(0, 80), 'msgId:', msgId);
          if (!msgId) return;
          setMessages(p => p.map(m => {
            if (m.id !== msgId) return m;
            const events = m.events || [];
            // Close any previously running thinking card that has no real content
            const cleanedEvents = events.filter(e => {
              // Remove empty thinking cards (title is still the placeholder)
              if (e.type === 'thought-process' && e.status === 'done') {
                const wasEmpty = !e.title || e.title === 'Thinking...' || e.title === 'Thought Process';
                return !wasEmpty;
              }
              return true;
            });
            return {
              ...m,
              events: [...cleanedEvents, {
                id: 'think-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
                type: 'thought-process' as const,
                title: msg.text || '',
                status: 'running' as const,
              }]
            };
          }));
        }

        // — Thinking delta — streams reasoning tokens into the current thinking card —
        if (msg.command === 'thinkingDelta') {
          const msgId = msg.requestId || streamingMsgId.current;
          if (!msgId) return;
          setMessages(p => p.map(m => {
            if (m.id !== msgId) return m;
            const events = m.events || [];
            // Find the last running thinking card, or create one if missing
            const runningIdx = events.findIndex(e => e.type === 'thought-process' && e.status === 'running');
            if (runningIdx >= 0) {
              // Append delta to existing thinking card
              const updated = [...events];
              const current = updated[runningIdx];
              updated[runningIdx] = {
                ...current,
                title: (current.title === 'Thinking...' ? '' : current.title) + msg.text,
              };
              return { ...m, events: updated };
            }
            // No running thinking card — create one (first delta arrived before 'thinking' status)
            return {
              ...m,
              events: [...events, {
                id: 'think-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
                type: 'thought-process' as const,
                title: msg.text,
                status: 'running' as const,
              }]
            };
          }));
        }

        // — Text delta — streams final answer content —
        if (msg.command === 'textDelta') {
          const msgId = msg.requestId || streamingMsgId.current;
          if (!msgId) return;
          streamingText.current += msg.text;
          setMessages(p => p.map(m => {
            if (m.id !== msgId) return m;
            // Do NOT close thinking cards here — they close on 'response' or 'thinking' status
            // Interleaved reasoning + content is normal
            return { ...m, text: streamingText.current };
          }));
        }

        if (msg.command === 'toolStep' && msg.step) {
          // Match by requestId first, fall back to streamingMsgId for backwards compat
          const msgId = msg.requestId || streamingMsgId.current;
          if (!msgId) return;
          const step = msg.step;
          console.log('[PulseAgent Webview] Tool step:', step.toolName, step.status, 'msgId:', msgId);

          let imageBase64 = undefined;
          let imagePath = undefined;
          if (step.toolName === 'generate_image' && step.result) {
            try {
              const parsed = JSON.parse(step.result);
              if (parsed.imageBase64) imageBase64 = parsed.imageBase64;
              if (parsed.imagePath) imagePath = parsed.imagePath;
            } catch { /* not JSON, use as text */ }
          }

          setMessages(p => p.map(m => {
            if (m.id !== msgId) return m;
            // Close any running thinking cards — tool execution started
            const events = (m.events || []).map(e =>
              e.type === 'thought-process' && e.status === 'running'
                ? { ...e, status: 'done' as const }
                : e
            );
            const tools = m.tools || [];
            const existingIdx = tools.findIndex(t => t.id === step.id);
            const extra: Record<string, unknown> = {};
            if (imageBase64) extra.imageBase64 = imageBase64;
            if (imagePath) extra.imagePath = imagePath;
            if (existingIdx >= 0) {
              const updated = [...tools];
              updated[existingIdx] = { ...updated[existingIdx], status: step.status, result: step.result, duration: step.duration, query: step.query, fileCount: step.fileCount, screenshot: step.screenshot, url: step.url, selector: step.selector, command: step.command, ...extra };
              return { ...m, events, tools: updated };
            }
            return { ...m, events, tools: [...tools, { id: step.id, name: step.toolName, path: step.toolArgs?.path, status: step.status, result: step.result, duration: step.duration, query: step.query, fileCount: step.fileCount, screenshot: step.screenshot, url: step.url, selector: step.selector, command: step.command, ...extra }] };
          }));
        }

      if (msg.command === 'testerAgentUpdate') {
        const msgId = streamingMsgId.current;
        if (!msgId) return;
        setMessages(p => p.map(m => {
          if (m.id !== msgId) return m;
          return { ...m, testerAgent: msg.agent };
        }));
      }

      if (msg.command === 'response') {
        console.log('[PulseAgent Webview] Response received:', (msg.text || '').substring(0, 120), 'error:', msg.error);
        const msgId = msg.requestId || streamingMsgId.current;
        console.log('[PulseAgent Webview] response msgId:', msgId, 'messages count:', messages.length);
        // Capture streamed text BEFORE clearing refs (fixes race condition)
        const capturedStreamedText = streamingText.current;
        streamingMsgId.current = null;
        streamingText.current = '';
        if (msgId) {
          setMessages(p => p.map(m => {
            if (m.id !== msgId) return m;
            // Mark all running thinking cards as done
            const events = (m.events || []).map(e => {
              if (e.status !== 'running') return e;
              return {
                ...e,
                status: 'done' as const,
                title: msg.error ? `Error: ${msg.error.substring(0, 100)}` : `Response received (${(msg.text || '').split(' ').length} words)`,
              };
            });
            // Prefer captured streamed text (accumulated from deltas), fall back to msg.text from extension
            const finalText = capturedStreamedText || msg.text || '';
            return { ...m, events, text: finalText, error: msg.error || undefined };
          }));
        }
        if (!msg.error) setError(null);
      }

      if (msg.command === 'stopped') {
        console.log('[PulseAgent Webview] Stopped');
        setThinking(false);
        streamingMsgId.current = null;
        streamingText.current = '';
      }

      if (msg.command === 'subAgentUpdate') {
        console.log('[PulseAgent Webview] SubAgent update:', msg.subAgent);
      }
      if (msg.command === 'historyCleared') {
        console.log('[PulseAgent Webview] History cleared');
        setMessages([]);
      }
      if (msg.command === 'error') {
        console.error('[PulseAgent Webview] Error:', msg.message);
        setError(msg.message || 'An unknown error occurred');
        setThinking(false);
        // Clean up streaming state on error
        streamingMsgId.current = null;
        streamingText.current = '';
        setConversationActive(false);
      }

      // Clear error on new thinking/response
      if (msg.command === 'thinking' || msg.command === 'response') {
        setError(null);
      }

      // ── Ask Mode: permission request from extension ──
      if (msg.command === 'permissionRequest') {
        setPermReq({
          requestId: msg.requestId,
          toolName: msg.toolName || 'run_terminal',
          command: (msg as any).cmd || msg.toolName || '',
          patterns: msg.patterns || [],
          sessionId: msg.sessionId || '',
        });
      }

      // ── Plan Mode: todo update from extension ──
      if (msg.command === 'todoUpdate') {
        setTodos(msg.todos || []);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  // ── Collect diff data from completed tools ──
  useEffect(() => {
    for (const msg of messages) {
      if (msg.role === 'assistant' && msg.tools) {
        for (const tool of msg.tools) {
          if (tool.status === 'done' || tool.status === 'error') {
            collectDiffFromTool(tool);
          }
        }
      }
    }
    // Notify extension about diff changes so agent can read them
    if (diffEntries.length > 0) {
      api.notifyDiffChanges(diffEntries);
    }
  }, [messages, collectDiffFromTool, diffEntries, api]);

  // ── Diff View Component (Editor-style menu bar + diff body) ──
  function DiffViewPanel() {
    if (!diffViewOpen || diffEntries.length === 0) return null;
    const currentDiff = diffEntries[diffSelectedIdx];
    if (!currentDiff) return null;

    const totalAdds = diffEntries.reduce((s, e) => s + e.lines.filter(l => l.type === 'add').length, 0);
    const totalDels = diffEntries.reduce((s, e) => s + e.lines.filter(l => l.type === 'del').length, 0);

    return (
      <div className="diff-editor-panel">
        {/* ═══ Menu Bar (file tabs like editor) ═══ */}
        <div className="diff-editor-menu">
          <div className="diff-editor-menu-left">
            <span className="diff-editor-title">
              <IconDoc size={13} color="var(--pc-accent)" />
              Changes
            </span>
            <span className="diff-editor-stats">
              <span className="diff-stat add">+{totalAdds}</span>
              <span className="diff-stat del">-{totalDels}</span>
              <span className="diff-file-count">{diffEntries.length} file{diffEntries.length !== 1 ? 's' : ''}</span>
            </span>
          </div>
          <div className="diff-editor-menu-right">
            <button className="diff-editor-close" onClick={() => setDiffViewOpen(false)} title="Close">
              <IconX size={12} />
            </button>
          </div>
        </div>

        {/* ═══ File Tabs (like editor tabs) ═══ */}
        <div className="diff-file-tabs">
          {diffEntries.map((entry, i) => {
            const adds = entry.lines.filter(l => l.type === 'add').length;
            const dels = entry.lines.filter(l => l.type === 'del').length;
            return (
              <button
                key={entry.id}
                className={`diff-file-tab ${i === diffSelectedIdx ? 'active' : ''}`}
                onClick={() => setDiffSelectedIdx(i)}
                title={entry.path}
              >
                <IconDoc size={11} color={i === diffSelectedIdx ? 'var(--pc-accent)' : 'var(--pc-text-faint)'} />
                <span className="diff-tab-name">{entry.name}</span>
                {adds > 0 && <span className="diff-tab-badge add">+{adds}</span>}
                {dels > 0 && <span className="diff-tab-badge del">-{dels}</span>}
              </button>
            );
          })}
        </div>

        {/* ═══ Diff Content (red/green code) ═══ */}
        <div className="diff-editor-body">
          {currentDiff.lines.length > 0 ? (
            <div className="diff-lines">
              {currentDiff.lines.map((line, i) => (
                <div key={i} className={`diff-line ${line.type}`}>
                  <span className="diff-line-num">{line.n || (i + 1)}</span>
                  <span className="diff-line-marker">{line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' '}</span>
                  <span className="diff-line-text">{line.text}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="diff-view-result">{currentDiff.result || 'No diff available'}</div>
          )}
        </div>

        {/* ═══ Footer with navigation ═══ */}
        <div className="diff-editor-footer">
          <span className="diff-footer-path">{currentDiff.path}</span>
          <div className="diff-editor-nav">
            <button className="diff-nav-btn" disabled={diffSelectedIdx === 0} onClick={() => setDiffSelectedIdx(i => Math.max(0, i - 1))}>
              <IconChevronUp size={10} /> Prev
            </button>
            <span className="diff-nav-idx">{diffSelectedIdx + 1} / {diffEntries.length}</span>
            <button className="diff-nav-btn" disabled={diffSelectedIdx >= diffEntries.length - 1} onClick={() => setDiffSelectedIdx(i => Math.min(diffEntries.length - 1, i + 1))}>
              Next <IconChevronDown size={10} />
            </button>
          </div>
        </div>
      </div>
    );
  }
  const handleSend = useCallback(async (text: string) => {
    if (!text.trim() || thinking) return;
    console.log('[PulseAgent Webview] Sending message:', text.trim().substring(0, 80));
    const isFirstMessage = messages.length === 0;
    const userMsg: Message = { id: 'u' + Date.now(), role: 'user', text: text.trim() };
    const assistantId = 'a' + Date.now();
    streamingMsgId.current = assistantId;
    streamingText.current = '';
    // Don't create an initial thinking event — the extension's onThinking callback will create it
    setMessages(p => [...p, userMsg, { id: assistantId, role: 'assistant', events: [], tools: [] }]);
    setInput('');
    setThinking(true);
    setConversationActive(true);
    try {
      console.log('[PulseAgent Webview] Calling api.chat, sessionId:', activeSessionId, 'isFirst:', isFirstMessage);
      const timeoutId = setTimeout(() => {
        console.warn('[PulseAgent Webview] Chat timeout after 10min');
        setThinking(false);
        setConversationActive(false);
        streamingMsgId.current = null;
        streamingText.current = '';
        setMessages(p => p.map(m => {
          if (m.id !== assistantId) return m;
          const events = (m.events || []).map(e => e.status === 'running' ? { ...e, status: 'done' as const, title: 'Timed out' } : e);
          return { ...m, events, text: 'Request timed out. Check your API key and model.' };
        }));
      }, 600_000);
      await api.chat(text.trim(), activeSessionId, isFirstMessage);
      clearTimeout(timeoutId);
      console.log('[PulseAgent Webview] api.chat resolved');
    } catch (e: any) {
      console.error('[PulseAgent Webview] api.chat error:', e.message, e.name);
      // ALWAYS clear streaming state on any error
      streamingMsgId.current = null;
      streamingText.current = '';
      if (e.name === 'AskUserError') {
        setAskQ({ question: e.question, motive: e.motive, options: e.options, requestId: '0' });
      }
      // Show connection error in the assistant message
      const connErr = (e.message || String(e)).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 300);
      setMessages(p => p.map(m => {
        if (m.id !== assistantId) return m;
        const events = (m.events || []).map(ev => ev.status === 'running' ? { ...ev, status: 'done' as const } : ev);
        return { ...m, events, error: connErr || 'Connection failed' };
      }));
    } finally {
      setThinking(false);
      setConversationActive(false);
    }
  }, [thinking, messages, activeSessionId, activeSessionName]);

  // ── Session search handler ──
  const handleSessionSearch = useCallback(async (query: string) => {
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }
    const results = await api.searchSessions(query);
    setSearchResults(results);
  }, []);

  const handleResumeSession = useCallback(async (sessionId: string) => {
    setActiveSessionId(sessionId);
    setMessages([]);
    setConversationActive(false);
    api.resumeSession(sessionId);
  }, []);

  const handleDeleteSession = useCallback(async (sessionId: string) => {
    api.deleteSession(sessionId);
    setSessions(prev => prev.filter(s => s.id !== sessionId));
  }, []);

  const handleNewSession = useCallback(() => {
    // Only allow new chat if conversation is done
    if (conversationActive || thinking) return;
    const newId = 'sess_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
    setActiveSessionId(newId);
    setActiveSessionName('');
    setMessages([]);
    setConversationActive(false);
    api.newSession(activeSessionId);
  }, [conversationActive, thinking, activeSessionId]);

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDay = Math.floor(diffHr / 24);
    if (diffDay < 7) return `${diffDay}d ago`;
    return d.toLocaleDateString();
  };

  // Determine what to show in the main area
  const showWelcome = messages.length === 0;
  console.log('[PulseAgent Webview] Render:', { messages: messages.length, thinking, showWelcome, activeSessionId });

  return (
    <div className="sidebar">
      {/* ── Session Header Bar ── */}
      <div className="session-header-bar">
        <div className="session-header-left">
          <button
            className={'session-new-btn' + (conversationActive || thinking ? ' disabled' : '')}
            onClick={handleNewSession}
            title={conversationActive || thinking ? 'Conversation in progress...' : 'New Session'}
            disabled={conversationActive || thinking}
          >
            <IconPlus size={12} color="var(--pc-text-base)" /> New Chat
          </button>
          {activeSessionId && (
            <span className="session-active-badge">
              {activeSessionName || activeSessionId.substring(0, 12) + '...'}
            </span>
          )}
        </div>
        <div className="session-header-right">
          <div className="session-search-wrap">
            <IconSearch size={12} color="var(--pc-text-faint)" className="session-search-icon" />
            <input
              className="session-search-input"
              placeholder="Search sessions..."
              value={sessionSearch}
              onChange={e => {
                setSessionSearch(e.target.value);
                handleSessionSearch(e.target.value);
              }}
              onFocus={() => setShowSearch(true)}
              onBlur={() => setTimeout(() => setShowSearch(false), 200)}
            />
            {sessionSearch && (
              <button className="session-search-clear" onClick={() => { setSessionSearch(''); setSearchResults([]); }}>
                <IconX size={10} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Search Results Dropdown ── */}
      {showSearch && sessionSearch && searchResults.length > 0 && (
        <div className="session-search-results">
          <div className="session-search-header">Search Results ({searchResults.length})</div>
          {searchResults.map((r, i) => (
            <div key={i} className="session-search-item" onClick={() => handleResumeSession(r.session_id)}>
              <div className="session-search-item-title">{r.title}</div>
              <div className="session-search-item-snippet">{r.snippet.substring(0, 100)}</div>
              <div className="session-search-item-meta">
                <span>Score: {r.rank}</span>
                <span>{formatTime(r.started_at)}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Diff View Panel (left side overlay) ── */}
      <DiffViewPanel />

      <div className="chat-messages-wrapper">
        {/* ── Welcome / Session History Screen ── */}
        {showWelcome && (
          <div className="welcome-screen">
            <div className="welcome-hero">
              <div className="welcome-logo"><IconSparkle size={32} color="var(--pc-accent)" /></div>
              <div className="welcome-title">PulseCode AI Agent</div>
              <div className="welcome-subtitle">Your autonomous coding companion. Start a new chat or resume a previous session.</div>
            </div>

            {/* Quick Actions */}
            <div className="welcome-quick-actions">
              <button className={'welcome-action-card' + (conversationActive || thinking ? ' disabled' : '')} onClick={handleNewSession} disabled={conversationActive || thinking}>
                <span className="welcome-action-icon"><IconPlus size={18} color="var(--pc-accent)" /></span>
                <span className="welcome-action-label">New Chat</span>
                <span className="welcome-action-desc">Start fresh with a clean context</span>
              </button>
              <button className="welcome-action-card" onClick={() => {
                const examples = [
                  "Create a React component for a todo list",
                  "Set up a Node.js Express server with TypeScript",
                  "Build a Python script to scrape a website",
                  "Create a VS Code extension boilerplate",
                ];
                const randomExample = examples[Math.floor(Math.random() * examples.length)];
                setInput(randomExample);
              }}>
                <span className="welcome-action-icon"><IconLightbulb size={18} color="#febc2e" /></span>
                <span className="welcome-action-label">Try an Example</span>
                <span className="welcome-action-desc">See what PulseCode can do</span>
              </button>
            </div>

            {/* Recent Sessions */}
            {sessions.length > 0 && (
              <div className="welcome-sessions">
                <div className="welcome-sessions-header">
                  <span className="welcome-sessions-title">Recent Sessions</span>
                  <span className="welcome-sessions-count">{sessions.length} sessions</span>
                </div>
                <div className="welcome-sessions-list">
                  {sessions.map((s) => (
                    <div key={s.id} className="welcome-session-card" onClick={() => handleResumeSession(s.id)}>
                      <div className="welcome-session-main">
                        <div className="welcome-session-title">{s.title}</div>
                        <div className="welcome-session-preview">{s.preview}</div>
                      </div>
                      <div className="welcome-session-meta">
                        <span className="welcome-session-time">{formatTime(s.started_at)}</span>
                        {s.message_count !== undefined && (
                          <span className="welcome-session-count">{s.message_count} msgs</span>
                        )}
                        <button
                          className="welcome-session-delete"
                          onClick={(e) => { e.stopPropagation(); handleDeleteSession(s.id); }}
                          title="Delete session"
                        >
                          <IconX size={10} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {sessions.length === 0 && (
              <div className="welcome-empty-sessions">
                <div className="welcome-empty-icon"><IconClipboard size={20} color="var(--pc-text-faint)" /></div>
                <div className="welcome-empty-text">No previous sessions yet. Start your first conversation!</div>
              </div>
            )}
          </div>
        )}

        {/* ── Message List ── */}
        <div className="message-list" role="log" ref={listRef}>
          {messages.map((m) => {
            if (m.role === 'user') return <div key={m.id} className="turn-user"><div className="user-bubble">{m.text}</div></div>;
            return (
              <div key={m.id} className="turn-assistant">
                {/* Events */}
                {m.events?.map((e, i) => {
                  if (e.type === 'analyzed-file') return (
                    <div key={i}>
                      {e.status === 'running' && <BreathingIndicator label={STATUS_LABELS['analyzed-file']} />}
                      {e.status === 'done' && <AnalyzedFileCard event={e} />}
                    </div>
                  );
                  if (e.type === 'analyzed-folder') return (
                    <div key={i}>
                      {e.status === 'running' && <BreathingIndicator label={STATUS_LABELS['analyzed-folder']} />}
                      {e.status === 'done' && <AnalyzedFolderCard event={e} />}
                    </div>
                  );
                  if (e.type === 'thought-process') return (
                    <div key={i}>
                      {/* Show breathing dots only when nothing else is visible yet */}
                      {e.status === 'running' && !m.text && !(m.tools && m.tools.length > 0) && (
                        <BreathingIndicator label="Generating..." />
                      )}
                      {/* Show ThinkingCard when it has content (streaming or done) */}
                      <ThinkingCard event={e} />
                    </div>
                  );
                  return null;
                })}

                {/* Tester Agent */}
                {m.testerAgent && <TesterAgentCard agent={m.testerAgent} />}

                {/* Error Card */}
                {m.error && (
                  <div className="error-card">
                    <div className="error-card-header">
                      <span className="error-card-icon"><IconWarning size={14} color="#f14c4c" /></span>
                      <span className="error-card-title">Error</span>
                      <button className="error-retry-btn" onClick={() => {
                        // Find the preceding user message and resend
                        const idx = messages.findIndex(mm => mm.id === m.id);
                        if (idx > 0) {
                          const prevMsg = messages[idx - 1];
                          if (prevMsg.role === 'user' && prevMsg.text) {
                            handleSend(prevMsg.text);
                          }
                        }
                      }} title="Retry">
                        <IconRefreshCw size={11} /> Retry
                      </button>
                    </div>
                    <div className="error-card-body">{m.error}</div>
                  </div>
                )}

                {/* Tool Cards — each card shows its own running/done state */}
                {m.tools?.map((t, i) => (
                  <div key={t.id || i}>
                    {t.status === 'running' && <BreathingIndicator label={STATUS_LABELS[t.name] || t.name} />}
                    {(t.status === 'done' || t.status === 'error') && <ToolCard tool={t} />}
                  </div>
                ))}

                {/* Streamed text — shown with shimmer cursor while streaming, plain when done */}
                {m.text && m.text.length > 0 && (
                  <StreamingText text={m.text} isStreaming={streamingMsgId.current === m.id} />
                )}
              </div>
            );
          })}
        </div>

        <div className="suggest-bar">
          <button className="suggest-chip">Run the tests</button>
          <button className="suggest-chip">Show me the full diff</button>
          <button className="suggest-chip">Add reconnection logging</button>
        </div>
        <button className="scroll-fab" onClick={() => listRef.current?.scrollTo(0, listRef.current.scrollHeight)}><IconChevronDown size={16} /></button>
      </div>

      {/* Ask User Modal -- DEPRECATED: replaced by QuestionDock */}
      {/* Keep for backwards compatibility but hide behind QuestionDock */}

      {/* Input */}
      <div className="chat-input">
        <div className="session-actions-row">
          <button className="session-action"><IconPlus size={11} color="var(--pc-text-weak)" /> New Task</button>
          <button className="session-action"><IconArrowRight size={11} color="var(--pc-text-weak)" /> Move to Worktree</button>
          <button className="session-action"><IconCheck size={11} color="var(--pc-text-weak)" /> Show Changes</button>
        </div>

        {/* ── QuestionDock (Ask Mode) ── */}
        {askQ && !askQ._dismissed && (
          <QuestionDock
            request={askQ}
            onReply={(answers) => {
              api.respondToAsk(askQ.question, answers.join(', '), askQ.requestId);
              setAskQ(null);
            }}
            onDismiss={() => {
              api.rejectAsk(askQ.requestId);
              setAskQ(null);
            }}
          />
        )}

        {/* ── PermissionDock ── */}
        {permReq && (
          <PermissionDock
            request={permReq}
            onDecide={(decision) => {
              api.respondToPermission(permReq.requestId, decision);
              setPermReq(null);
            }}
          />
        )}

        {/* ── TodoPanel (Plan Mode) ── */}
        {todos.length > 0 && (
          <TodoPanel
            todos={todos}
            onUpdate={(updated) => setTodos(updated)}
          />
        )}

        <div className="prompt-input-container">
          <div className="prompt-textarea">
            <textarea rows={1} placeholder="Type your message…" value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (!thinking && input.trim()) handleSend(input); } }} />
          </div>
          <div className="prompt-input-hint">
            <div className="hint-selectors">
              <div className="model-selector-wrap" ref={modelSelectorRef}>
                <button className={'selector' + (showModelSelector ? ' open' : '')} onClick={() => setShowModelSelector(!showModelSelector)}>
                  <IconBolt size={12} />
                  <span className="model-btn-label">{currentModel || 'Select Model'}</span>
                  <span className="model-btn-provider" style={{ color: PROVIDER_INFO[currentProvider]?.color || 'var(--pc-text-faint)' }}>
                    {PROVIDER_INFO[currentProvider]?.label || currentProvider || <IconMinus size={10} color="var(--pc-text-faint)" />}
                  </span>
                  <span className="chevron"><IconChevronDown size={10} /></span>
                </button>
                {showModelSelector && (
                  <div className="model-dropdown">
                    <div className="model-dropdown-header">
                      <span>Provider / Model</span>
                      <span className="model-dropdown-baseurl">{currentBaseURL}</span>
                    </div>
                    <div className="model-dropdown-list">
                      {Object.entries(PROVIDER_INFO).map(([key, info]) => (
                        <button
                          key={key}
                          className={'model-dropdown-item' + (currentProvider === key ? ' active' : '')}
                          onClick={() => {
                            api.postMessage({ command: 'switchProvider', provider: key });
                            setShowModelSelector(false);
                          }}
                        >
                          <span className="model-item-icon">{info.icon}</span>
                          <div className="model-item-info">
                            <span className="model-item-label" style={{ color: info.color }}>{info.label}</span>
                            <span className="model-item-provider">{key}</span>
                          </div>
                          {currentProvider === key && <IconCheck size={12} color="var(--pc-accent)" />}
                        </button>
                      ))}
                    </div>
                    <div className="model-dropdown-footer">
                      <span>Switch provider via Pulse: Set Provider command</span>
                    </div>
                  </div>
                )}
              </div>
              <button className="selector"><IconStar size={12} /> medium <span className="chevron"><IconChevronDown size={10} /></span></button>
            </div>
            <div className="hint-actions">
              <button className="act" title="Attach file"><IconPaperclip size={14} /></button>
              <button className="act on" title="Auto-approve"><IconCheck size={14} /></button>
              {hasDiffs && (
                <button
                  className={`act review-changes ${diffViewOpen ? 'active' : ''}`}
                  title="Review Changes"
                  onClick={() => setDiffViewOpen(!diffViewOpen)}
                >
                  <IconDoc size={14} />
                  <span className="review-count">{diffEntries.length}</span>
                </button>
              )}
              {thinking ? (
                <button className="act stop" title="Stop" onClick={() => api.stop()}><IconX size={14} /></button>
              ) : (
                <button className="act send" title="Send" onClick={() => handleSend(input)}><IconSend size={14} /></button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Event Cards ────────────────────────────────────────────────────
function AnalyzedFileCard({ event }: { event: AgentEvent }) {
  const [open, setOpen] = useState(true);
  return (
    <div className={'event-card event-file' + (open ? ' open' : '')}>
      <div className="event-card-head" onClick={() => setOpen(!open)}>
        <span className="event-icon"><IconDoc size={14} color="var(--pc-accent)" /></span>
        <span className="event-title">{event.title}</span>
        <span className="event-path">{event.path}</span>
        {event.lineRange && <span className="event-lines">{event.lineRange}</span>}
        <span className="event-chevron">{open ? <IconChevronDown size={10} /> : <IconChevronRight size={10} />}</span>
      </div>
      {open && <div className="event-card-body"><div className="event-file-snippet">{event.plan ? event.plan.join('\n') : (event.title || '(no details)')}</div></div>}
    </div>
  );
}

function AnalyzedFolderCard({ event }: { event: AgentEvent }) {
  const [open, setOpen] = useState(true);
  return (
    <div className={'event-card event-folder' + (open ? ' open' : '')}>
      <div className="event-card-head" onClick={() => setOpen(!open)}>
        <span className="event-icon"><IconFolder size={14} color="var(--pc-accent)" /></span>
        <span className="event-title">{event.title}</span>
        <span className="event-path">{event.path}</span>
        <span className="event-chevron">{open ? <IconChevronDown size={10} /> : <IconChevronRight size={10} />}</span>
      </div>
      {open && <div className="event-card-body"><div className="event-file-list">{event.steps ? event.steps.map((s,i) => <span key={i} className="file-tag"><span className="dot"><IconPlay size={8} /></span>{s.text || s}</span>) : (event.title || '(no details)')}</div></div>}
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────
function extractGoal(text: string): string {
  const m = text.match(/(?:Goal|Objective|Task|What I'll do|Plan)[:\\s]+([^\\n]+)/i);
  if (m) return m[1].trim();
  return text.split(/[.\n]/)[0]?.trim() || 'Processing your request';
}
function extractPlan(text: string): string[] {
  const steps: string[] = [];
  for (const line of text.split('\n')) {
    const n = line.match(/^\d+\.\s+(.+)/);
    const b = line.match(/^[-•]\s+(.+)/);
    if (n) steps.push(n[1].trim());
    else if (b) steps.push(b[1].trim());
  }
  if (steps.length > 0) return steps.slice(0, 6);
  return text.split(/\.\s+/).filter(s => s.length > 10 && s.length < 200).slice(0, 4).map(s => s.trim() + (s.endsWith('.') ? '' : '.'));
}
function extractSteps(text: string): { text: string; done: boolean }[] {
  const actions: { text: string; done: boolean }[] = [];
  for (const line of text.split('\n')) {
    const c = line.trim();
    if (c.includes('✓') || c.includes('PASS') || c.includes('OK')) actions.push({ text: c.replace(/^[✓✅]\s*/, ''), done: true });
    else if (c.includes('⏳') || c.includes('⟳') || c.includes('running')) actions.push({ text: c.replace(/^[⟳⏳○]\s*/, ''), done: false });
  }
  if (actions.length > 0) return actions.slice(0, 8);
  return extractPlan(text).map(s => ({ text: s, done: true }));
}
