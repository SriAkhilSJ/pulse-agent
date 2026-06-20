import React from 'react';

interface IconProps {
  size?: number;
  color?: string;
  className?: string;
}

export function Icon({ size = 14, color = 'currentColor', className = '', children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none"
      stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
      className={className} style={{ flexShrink: 0 }}>
      {children}
    </svg>
  );
}

export function IconDoc({ size = 14, color = 'currentColor' }: IconProps) {
  return <Icon size={size} color={color}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></Icon>;
}
export function IconFolder({ size = 14, color = 'currentColor' }: IconProps) {
  return <Icon size={size} color={color}><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></Icon>;
}
export function IconBrain({ size = 14, color = 'currentColor' }: IconProps) {
  return <Icon size={size} color={color}><path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 4.24-1.32A2.5 2.5 0 0 1 9.5 2Z"/><path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-4.24-1.32A2.5 2.5 0 0 0 14.5 2Z"/></Icon>;
}
export function IconSearch({ size = 14, color = 'currentColor' }: IconProps) {
  return <Icon size={size} color={color}><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></Icon>;
}
export function IconChevronDown({ size = 14, color = 'currentColor' }: IconProps) {
  return <Icon size={size} color={color}><polyline points="6 9 12 15 18 9"/></Icon>;
}
export function IconChevronUp({ size = 14, color = 'currentColor' }: IconProps) {
  return <Icon size={size} color={color}><polyline points="18 15 12 9 6 15"/></Icon>;
}
export function IconChevronRight({ size = 14, color = 'currentColor' }: IconProps) {
  return <Icon size={size} color={color}><polyline points="9 18 15 12 9 6"/></Icon>;
}
export function IconCheck({ size = 14, color = 'currentColor' }: IconProps) {
  return <Icon size={size} color={color}><polyline points="20 6 9 17 4 12"/></Icon>;
}
export function IconCircle({ size = 14, color = 'currentColor' }: IconProps) {
  return <Icon size={size} color={color}><circle cx="12" cy="12" r="10"/></Icon>;
}
export function IconWarning({ size = 14, color = 'currentColor' }: IconProps) {
  return <Icon size={size} color={color}><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></Icon>;
}
export function IconBolt({ size = 14, color = 'currentColor' }: IconProps) {
  return <Icon size={size} color={color}><polygon points="13 2 3 14 10 14 8 22 19 10 14 10 11 2"/></Icon>;
}
export function IconStar({ size = 14, color = 'currentColor' }: IconProps) {
  return <Icon size={size} color={color}><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></Icon>;
}
export function IconPaperclip({ size = 14, color = 'currentColor' }: IconProps) {
  return <Icon size={size} color={color}><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></Icon>;
}
export function IconSend({ size = 14, color = 'currentColor' }: IconProps) {
  return <Icon size={size} color={color}><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></Icon>;
}
export function IconPlay({ size = 10, color = 'currentColor' }: IconProps) {
  return <Icon size={size} color={color}><polygon points="5 3 19 12 5 21 5 3"/></Icon>;
}

// --- NEW ICONS for tool cards ---

export function IconBrowser({ size = 14, color = 'currentColor' }: IconProps) {
  return <Icon size={size} color={color}><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></Icon>;
}
export function IconDesktop({ size = 14, color = 'currentColor' }: IconProps) {
  return <Icon size={size} color={color}><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></Icon>;
}
export function IconAndroid({ size = 14, color = 'currentColor' }: IconProps) {
  return <Icon size={size} color={color}><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></Icon>;
}
export function IconMic({ size = 14, color = 'currentColor' }: IconProps) {
  return <Icon size={size} color={color}><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/></Icon>;
}
export function IconCamera({ size = 14, color = 'currentColor' }: IconProps) {
  return <Icon size={size} color={color}><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></Icon>;
}
export function IconImage({ size = 14, color = 'currentColor' }: IconProps) {
  return <Icon size={size} color={color}><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></Icon>;
}
export function IconEye({ size = 14, color = 'currentColor' }: IconProps) {
  return <Icon size={size} color={color}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></Icon>;
}
export function IconGlobe({ size = 14, color = 'currentColor' }: IconProps) {
  return <Icon size={size} color={color}><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></Icon>;
}
export function IconTerminal({ size = 14, color = 'currentColor' }: IconProps) {
  return <Icon size={size} color={color}><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></Icon>;
}
export function IconRobot({ size = 14, color = 'currentColor' }: IconProps) {
  return <Icon size={size} color={color}><rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><line x1="12" y1="7" x2="12" y2="11"/><line x1="8" y1="16" x2="8" y2="16"/><line x1="16" y1="16" x2="16" y2="16"/></Icon>;
}
export function IconClock({ size = 14, color = 'currentColor' }: IconProps) {
  return <Icon size={size} color={color}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></Icon>;
}
export function IconX({ size = 14, color = 'currentColor' }: IconProps) {
  return <Icon size={size} color={color}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></Icon>;
}

// --- Additional icons replacing emojis ---

export function IconSparkle({ size = 14, color = 'currentColor' }: IconProps) {
  // ✨ sparkle / magic wand
  return <Icon size={size} color={color}><path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8L12 2z"/></Icon>;
}

export function IconZap({ size = 14, color = 'currentColor' }: IconProps) {
  // ⚡ lightning bolt (provider icon)
  return <Icon size={size} color={color}><polygon points="13 2 3 14 10 14 8 22 19 10 14 10 11 2"/></Icon>;
}

export function IconLightbulb({ size = 14, color = 'currentColor' }: IconProps) {
  // 💡 lightbulb / idea
  return <Icon size={size} color={color}><path d="M9 21h6"/><path d="M12 3a6 6 0 0 0-6 6c0 2 1 4 2 5h8c1-1 2-3 2-5a6 6 0 0 0-6-6z"/><line x1="12" y1="1" x2="12" y2="3"/></Icon>;
}

export function IconClipboard({ size = 14, color = 'currentColor' }: IconProps) {
  // 📋 clipboard / sessions
  return <Icon size={size} color={color}><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></Icon>;
}

export function IconCircleFilled({ size = 14, color = 'currentColor' }: IconProps) {
  // ◉ filled circle (selected radio)
  return <Icon size={size} color={color}><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/></Icon>;
}

export function IconArrowRight({ size = 14, color = 'currentColor' }: IconProps) {
  // → arrow right
  return <Icon size={size} color={color}><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></Icon>;
}

export function IconMinus({ size = 14, color = 'currentColor' }: IconProps) {
  // — minus / dash
  return <Icon size={size} color={color}><line x1="5" y1="12" x2="19" y2="12"/></Icon>;
}

export function IconPlus({ size = 14, color = 'currentColor' }: IconProps) {
  // + plus
  return <Icon size={size} color={color}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></Icon>;
}

export function IconSpinner({ size = 14, color = 'currentColor' }: IconProps) {
  // ⏳ / ⟳ spinning indicator
  return <Icon size={size} color={color}><path d="M12 2v4"/><path d="M12 18v4"/><path d="M4.93 4.93l2.83 2.83"/><path d="M16.24 16.24l2.83 2.83"/><path d="M2 12h4"/><path d="M18 12h4"/><path d="M4.93 19.07l2.83-2.83"/><path d="M16.24 7.76l2.83-2.83"/></Icon>;
}

export function IconHelpCircle({ size = 14, color = 'currentColor' }: IconProps) {
  // ❓ help / question
  return <Icon size={size} color={color}><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></Icon>;
}

export function IconSquare({ size = 14, color = 'currentColor' }: IconProps) {
  // ☐ empty square (checkbox)
  return <Icon size={size} color={color}><rect x="3" y="3" width="18" height="18" rx="2"/></Icon>;
}

export function IconCheckSquare({ size = 14, color = 'currentColor' }: IconProps) {
  // ☑ checked square (checkbox)
  return <Icon size={size} color={color}><path d="M9 11l2 2 4-4"/><rect x="3" y="3" width="18" height="18" rx="2"/></Icon>;
}

export function IconLock({ size = 14, color = 'currentColor' }: IconProps) {
  // 🔒 lock
  return <Icon size={size} color={color}><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></Icon>;
}

export function IconRefreshCw({ size = 14, color = 'currentColor' }: IconProps) {
  // 🔄 refresh/rotate
  return <Icon size={size} color={color}><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></Icon>;
}

export function IconMaximize2({ size = 14, color = 'currentColor' }: IconProps) {
  // ⤢ maximize/fullscreen
  return <Icon size={size} color={color}><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></Icon>;
}

export function IconStop({ size = 14, color = 'currentColor' }: IconProps) {
  // ■ stop square
  return <Icon size={size} color={color}><rect x="3" y="3" width="18" height="18" rx="2"/></Icon>;
}

export function IconExternalLink({ size = 14, color = 'currentColor' }: IconProps) {
  // ↗ external link
  return <Icon size={size} color={color}><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></Icon>;
}

export function IconDownload({ size = 14, color = 'currentColor' }: IconProps) {
  // ⤓ download arrow
  return <Icon size={size} color={color}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></Icon>;
}

export function IconMoreHorizontal({ size = 14, color = 'currentColor' }: IconProps) {
  // ⋯ more horizontal
  return <Icon size={size} color={color}><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></Icon>;
}
