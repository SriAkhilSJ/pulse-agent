// src/webview/components/BrowserCard.tsx
// Browser Tool Card — Professional wireframe for PulseCode AI
// Shows navigation, screenshots, execution timeline, permissions

import React, { useState } from 'react';
import {
  IconBrowser, IconChevronDown, IconChevronUp, IconCheck, IconX,
  IconWarning, IconClock, IconGlobe, IconCamera, IconLock,
  IconRefreshCw, IconExternalLink, IconMaximize2, IconStop,
  IconPlay, IconEye, IconDownload, IconMoreHorizontal
} from './Icons';

interface BrowserCardProps {
  toolCall: {
    id: string;
    name: string;
    status: 'running' | 'done' | 'error' | 'waiting_permission';
    url?: string;
    selector?: string;
    screenshot?: string;
    screenshotBase64?: string;
    result?: string;
    output?: string;
    duration?: number;
    error?: string;
    actions?: string[];
    permission?: {
      domain: string;
      reason: string;
      risks: string[];
    };
    timeline?: {
      step: string;
      status: 'done' | 'running' | 'pending' | 'error';
      duration?: number;
    }[];
    progress?: number;
    elapsed?: number;
  };
  onPermissionResponse?: (requestId: string, decision: 'deny' | 'once' | 'always') => void;
  onStop?: (toolCallId: string) => void;
  onOpenUrl?: (url: string) => void;
  onViewScreenshot?: (screenshot: string) => void;
}

export function BrowserCard({ toolCall, onPermissionResponse, onStop, onOpenUrl, onViewScreenshot }: BrowserCardProps) {
  console.log('[CARD][BrowserCard] render', { toolCallId: toolCall.id, name: toolCall.name, status: toolCall.status, url: toolCall.url, selector: toolCall.selector, hasResult: !!toolCall.result, resultLen: toolCall.result?.length || 0, hasOutput: !!toolCall.output, hasScreenshot: !!toolCall.screenshot || !!toolCall.screenshotBase64, hasPermission: !!toolCall.permission, timelineSteps: toolCall.timeline?.length || 0, duration: toolCall.duration, progress: toolCall.progress });
  const [expanded, setExpanded] = useState(true);
  const [activeTab, setActiveTab] = useState<'timeline' | 'screenshot' | 'output'>('timeline');

  const statusConfig = {
    running: { color: 'var(--pc-accent)', bg: 'rgba(139,92,246,.12)', label: 'Running', icon: '●' },
    done: { color: '#22c55e', bg: 'rgba(34,197,94,.12)', label: 'Completed', icon: '✓' },
    error: { color: '#f43f5e', bg: 'rgba(244,63,94,.12)', label: 'Error', icon: '✗' },
    waiting_permission: { color: '#cca700', bg: 'rgba(204,167,0,.12)', label: 'Permission Required', icon: '⚠' },
  };

  const status = statusConfig[toolCall.status];

  return (
    <div className={`tool-card browser-card ${expanded ? 'expanded' : ''} ${toolCall.status}`}>

      {/* ═══ HEADER ═══ */}
      <div className="browser-card-header" onClick={() => setExpanded(!expanded)}>
        <div className="browser-card-left">
          <span className="browser-icon">🌐</span>
          <span className="browser-tool-name">{toolCall.name}</span>
          {toolCall.url && (
            <span className="browser-url" title={toolCall.url}>
              {new URL(toolCall.url).hostname}
            </span>
          )}
        </div>
        <div className="browser-card-right">
          <span className="browser-status" style={{ color: status.color, background: status.bg }}>
            <span className="status-dot" style={{ color: status.color }}>{status.icon}</span>
            {status.label}
          </span>
          {toolCall.duration && (
            <span className="browser-duration">
              <IconClock size={10} /> {toolCall.duration.toFixed(1)}s
            </span>
          )}
          {toolCall.status === 'running' && (
            <button className="browser-stop-btn" onClick={(e) => { e.stopPropagation(); onStop?.(toolCall.id); }}>
              <IconStop size={12} />
            </button>
          )}
          <span className="browser-expand">{expanded ? <IconChevronUp size={12} /> : <IconChevronDown size={12} />}</span>
        </div>
      </div>

      {/* ═══ BODY ═══ */}
      {expanded && (
        <div className="browser-card-body">

          {/* GOAL */}
          <div className="browser-section">
            <div className="browser-section-label">Goal</div>
            <div className="browser-goal">{toolCall.result || toolCall.output || 'Navigating...'}</div>
          </div>

          {/* URL BAR */}
          {toolCall.url && (
            <div className="browser-url-bar">
              <IconLock size={12} style={{ color: 'var(--pc-text-faint)' }} />
              <span className="browser-url-text">{toolCall.url}</span>
              <button className="browser-url-action" onClick={() => onOpenUrl?.(toolCall.url!)}>
                <IconExternalLink size={12} />
              </button>
            </div>
          )}

          {/* PERMISSION REQUEST */}
          {toolCall.status === 'waiting_permission' && toolCall.permission && (
            <div className="browser-permission">
              <div className="browser-permission-header">
                <IconWarning size={14} style={{ color: '#cca700' }} />
                <span>Permission Required</span>
              </div>
              <div className="browser-permission-domain">{toolCall.permission.domain}</div>
              <div className="browser-permission-reason">{toolCall.permission.reason}</div>
              {toolCall.permission.risks.length > 0 && (
                <div className="browser-permission-risks">
                  {toolCall.permission.risks.map((risk, i) => (
                    <div key={i} className="browser-permission-risk">• {risk}</div>
                  ))}
                </div>
              )}
              <div className="browser-permission-actions">
                <button className="perm-btn deny" onClick={() => onPermissionResponse?.(toolCall.id, 'deny')}>Deny</button>
                <button className="perm-btn once" onClick={() => onPermissionResponse?.(toolCall.id, 'once')}>Allow Once</button>
                <button className="perm-btn always" onClick={() => onPermissionResponse?.(toolCall.id, 'always')}>Always Allow</button>
              </div>
            </div>
          )}

          {/* PROGRESS BAR (running) */}
          {toolCall.status === 'running' && (
            <div className="browser-progress">
              <div className="browser-progress-bar">
                <div className="browser-progress-fill" style={{ width: `${toolCall.progress || 30}%` }} />
              </div>
              <span className="browser-progress-time">
                {toolCall.elapsed ? `${toolCall.elapsed.toFixed(1)}s` : 'Loading...'}
              </span>
            </div>
          )}

          {/* TABS */}
          <div className="browser-tabs">
            <button className={`browser-tab ${activeTab === 'timeline' ? 'active' : ''}`} onClick={() => setActiveTab('timeline')}>
              Timeline
            </button>
            {(toolCall.screenshot || toolCall.screenshotBase64) && (
              <button className={`browser-tab ${activeTab === 'screenshot' ? 'active' : ''}`} onClick={() => setActiveTab('screenshot')}>
                Screenshot
              </button>
            )}
            {toolCall.output && (
              <button className={`browser-tab ${activeTab === 'output' ? 'active' : ''}`} onClick={() => setActiveTab('output')}>
                Output
              </button>
            )}
          </div>

          {/* TIMELINE TAB */}
          {activeTab === 'timeline' && toolCall.timeline && (
            <div className="browser-timeline">
              {toolCall.timeline.map((item, i) => (
                <div key={i} className={`timeline-item ${item.status}`}>
                  <span className="timeline-dot" />
                  <span className="timeline-step">{item.step}</span>
                  {item.duration && <span className="timeline-dur">{item.duration.toFixed(1)}s</span>}
                </div>
              ))}
            </div>
          )}

          {/* SCREENSHOT TAB */}
          {activeTab === 'screenshot' && (toolCall.screenshot || toolCall.screenshotBase64) && (
            <div className="browser-screenshot">
              <img
                src={toolCall.screenshotBase64 ? `data:image/png;base64,${toolCall.screenshotBase64}` : toolCall.screenshot}
                alt="Browser screenshot"
                onClick={() => onViewScreenshot?.(toolCall.screenshot!)}
              />
              <div className="browser-screenshot-actions">
                <button onClick={() => onViewScreenshot?.(toolCall.screenshot!)}>
                  <IconMaximize2 size={12} /> Full Size
                </button>
                <button>
                  <IconDownload size={12} /> Download
                </button>
              </div>
            </div>
          )}

          {/* OUTPUT TAB */}
          {activeTab === 'output' && toolCall.output && (
            <div className="browser-output">{toolCall.output}</div>
          )}

          {/* FOOTER */}
          <div className="browser-footer">
            <span className="browser-footer-time">
              Last updated: {new Date().toLocaleTimeString()}
            </span>
            <div className="browser-footer-actions">
              {toolCall.status === 'done' && (
                <>
                  <button className="browser-action-btn" onClick={() => onOpenUrl?.(toolCall.url!)}>
                    <IconGlobe size={12} /> View Page
                  </button>
                  {toolCall.screenshot && (
                    <button className="browser-action-btn" onClick={() => onViewScreenshot?.(toolCall.screenshot!)}>
                      <IconEye size={12} /> Screenshot
                    </button>
                  )}
                </>
              )}
              {toolCall.status === 'error' && (
                <button className="browser-action-btn retry">
                  <IconRefreshCw size={12} /> Retry
                </button>
              )}
            </div>
          </div>

        </div>
      )}
    </div>
  );
}


// ═══ DESKTOP TOOL CARD ═══

interface DesktopCardProps {
  toolCall: {
    id: string;
    name: string;
    status: 'running' | 'done' | 'error';
    screenshot?: string;
    screenshotBase64?: string;
    result?: string;
    output?: string;
    duration?: number;
    error?: string;
    coordinates?: { x: number; y: number };
    action?: string;
    timeline?: {
      step: string;
      status: 'done' | 'running' | 'pending' | 'error';
    }[];
  };
  onStop?: (toolCallId: string) => void;
  onViewScreenshot?: (screenshot: string) => void;
}

export function DesktopCard({ toolCall, onStop, onViewScreenshot }: DesktopCardProps) {
  console.log('[CARD][DesktopCard] render', { toolCallId: toolCall.id, name: toolCall.name, status: toolCall.status, action: toolCall.action, coordinates: toolCall.coordinates, hasResult: !!toolCall.result, hasOutput: !!toolCall.output, hasScreenshot: !!toolCall.screenshot || !!toolCall.screenshotBase64, timelineSteps: toolCall.timeline?.length || 0, duration: toolCall.duration });
  const [expanded, setExpanded] = useState(true);
  const [activeTab, setActiveTab] = useState<'timeline' | 'screenshot' | 'output'>('screenshot');

  const statusConfig = {
    running: { color: 'var(--pc-accent)', bg: 'rgba(139,92,246,.12)', label: 'Running', icon: '●' },
    done: { color: '#22c55e', bg: 'rgba(34,197,94,.12)', label: 'Completed', icon: '✓' },
    error: { color: '#f43f5e', bg: 'rgba(244,63,94,.12)', label: 'Error', icon: '✗' },
  };

  const status = statusConfig[toolCall.status];

  return (
    <div className={`tool-card desktop-card ${expanded ? 'expanded' : ''} ${toolCall.status}`}>

      {/* HEADER */}
      <div className="browser-card-header desktop" onClick={() => setExpanded(!expanded)}>
        <div className="browser-card-left">
          <span className="browser-icon desktop">🖥️</span>
          <span className="browser-tool-name">{toolCall.name}</span>
          {toolCall.action && <span className="desktop-action">{toolCall.action}</span>}
        </div>
        <div className="browser-card-right">
          <span className="browser-status" style={{ color: status.color, background: status.bg }}>
            <span className="status-dot" style={{ color: status.color }}>{status.icon}</span>
            {status.label}
          </span>
          {toolCall.coordinates && (
            <span className="desktop-coords">
              X: {toolCall.coordinates.x}, Y: {toolCall.coordinates.y}
            </span>
          )}
          {toolCall.duration && (
            <span className="browser-duration">
              <IconClock size={10} /> {toolCall.duration.toFixed(1)}s
            </span>
          )}
          {toolCall.status === 'running' && (
            <button className="browser-stop-btn" onClick={(e) => { e.stopPropagation(); onStop?.(toolCall.id); }}>
              <IconStop size={12} />
            </button>
          )}
          <span className="browser-expand">{expanded ? <IconChevronUp size={12} /> : <IconChevronDown size={12} />}</span>
        </div>
      </div>

      {/* BODY */}
      {expanded && (
        <div className="browser-card-body">

          {/* CURRENT ACTION */}
          {toolCall.action && (
            <div className="browser-section">
              <div className="browser-section-label">Current Action</div>
              <div className="desktop-current-action">{toolCall.action}</div>
            </div>
          )}

          {/* COORDINATES */}
          {toolCall.coordinates && (
            <div className="desktop-coords-display">
              <div className="coord-item">
                <span className="coord-label">X</span>
                <span className="coord-value">{toolCall.coordinates.x}</span>
              </div>
              <div className="coord-item">
                <span className="coord-label">Y</span>
                <span className="coord-value">{toolCall.coordinates.y}</span>
              </div>
            </div>
          )}

          {/* PROGRESS */}
          {toolCall.status === 'running' && (
            <div className="desktop-progress">
              <div className="desktop-progress-bar">
                <div className="desktop-progress-fill" />
              </div>
            </div>
          )}

          {/* TABS */}
          <div className="browser-tabs">
            <button className={`browser-tab ${activeTab === 'screenshot' ? 'active' : ''}`} onClick={() => setActiveTab('screenshot')}>
              <IconCamera size={11} /> Screenshot
            </button>
            {toolCall.timeline && toolCall.timeline.length > 0 && (
              <button className={`browser-tab ${activeTab === 'timeline' ? 'active' : ''}`} onClick={() => setActiveTab('timeline')}>
                Timeline
              </button>
            )}
            {toolCall.output && (
              <button className={`browser-tab ${activeTab === 'output' ? 'active' : ''}`} onClick={() => setActiveTab('output')}>
                Output
              </button>
            )}
          </div>

          {/* SCREENSHOT TAB */}
          {activeTab === 'screenshot' && (toolCall.screenshot || toolCall.screenshotBase64) && (
            <div className="desktop-screenshot">
              <img
                src={toolCall.screenshotBase64 ? `data:image/png;base64,${toolCall.screenshotBase64}` : toolCall.screenshot}
                alt="Desktop screenshot"
                onClick={() => onViewScreenshot?.(toolCall.screenshot!)}
              />
              <div className="desktop-screenshot-hint">Click to expand</div>
            </div>
          )}

          {/* TIMELINE TAB */}
          {activeTab === 'timeline' && toolCall.timeline && (
            <div className="browser-timeline">
              {toolCall.timeline.map((item, i) => (
                <div key={i} className={`timeline-item ${item.status}`}>
                  <span className="timeline-dot" />
                  <span className="timeline-step">{item.step}</span>
                </div>
              ))}
            </div>
          )}

          {/* OUTPUT TAB */}
          {activeTab === 'output' && toolCall.output && (
            <div className="browser-output">{toolCall.output}</div>
          )}

          {/* FOOTER */}
          <div className="browser-footer">
            <span className="browser-footer-time">
              {new Date().toLocaleTimeString()} • {toolCall.name}
            </span>
            <div className="browser-footer-actions">
              {toolCall.status === 'done' && toolCall.screenshot && (
                <button className="browser-action-btn" onClick={() => onViewScreenshot?.(toolCall.screenshot!)}>
                  <IconEye size={12} /> View
                </button>
              )}
              {toolCall.status === 'error' && (
                <button className="browser-action-btn retry">
                  <IconRefreshCw size={12} /> Retry
                </button>
              )}
            </div>
          </div>

        </div>
      )}
    </div>
  );
}
