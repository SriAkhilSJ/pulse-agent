export interface ChatEvent {
    type: 'chat';
    requestId: string;
    text: string;
    sessionId?: string;
}
export interface StopEvent {
    type: 'stop';
    requestId: string;
}
export interface GetHistoryEvent {
    type: 'getHistory';
    sessionId: string;
}
export interface GetSessionsEvent {
    type: 'getSessions';
}
export interface SearchSessionsEvent {
    type: 'searchSessions';
    query: string;
}
export interface ResumeSessionEvent {
    type: 'resumeSession';
    sessionId: string;
}
export interface DeleteSessionEvent {
    type: 'deleteSession';
    sessionId: string;
}
export interface NewSessionEvent {
    type: 'newSession';
}
export interface AskUserResponseEvent {
    type: 'askUserResponse';
    answer: string;
}
export interface PermissionResponseEvent {
    type: 'permissionResponse';
    decision: 'allow' | 'deny';
}
export interface SwitchProviderEvent {
    type: 'switchProvider';
    provider: string;
}
export type IncomingEvent = ChatEvent | StopEvent | GetHistoryEvent | GetSessionsEvent | SearchSessionsEvent | ResumeSessionEvent | DeleteSessionEvent | NewSessionEvent | AskUserResponseEvent | PermissionResponseEvent | SwitchProviderEvent;
export interface ThinkingEvent {
    type: 'thinking';
    text: string;
    requestId: string;
}
export interface ThinkingDeltaEvent {
    type: 'thinkingDelta';
    text: string;
    requestId: string;
}
export interface TextDeltaEvent {
    type: 'textDelta';
    text: string;
    requestId: string;
}
export interface ToolStepEvent {
    type: 'toolStep';
    step: {
        id: string;
        toolName: string;
        status: 'running' | 'done' | 'error';
        result?: string;
        duration?: number;
    };
    requestId: string;
}
export interface ResponseEvent {
    type: 'response';
    requestId: string;
    text: string;
    error?: string;
}
export interface StoppedEvent {
    type: 'stopped';
}
export interface LoadHistoryEvent {
    type: 'loadHistory';
    history: Array<{
        role: string;
        content: string;
    }>;
    sessionId: string;
}
export interface SessionListEvent {
    type: 'sessionList';
    sessions: Array<{
        id: string;
        title: string;
        updatedAt: number;
    }>;
}
export interface SessionSearchResultsEvent {
    type: 'sessionSearchResults';
    results: Array<{
        id: string;
        title: string;
        updatedAt: number;
    }>;
}
export interface SessionDeletedEvent {
    type: 'sessionDeleted';
    sessionId: string;
}
export interface NewSessionStartedEvent {
    type: 'newSessionStarted';
}
export interface ModelUpdateEvent {
    type: 'modelUpdate';
    model: string;
    provider: string;
    baseURL: string;
}
export interface ErrorEvent {
    type: 'error';
    message: string;
}
export type OutgoingEvent = ThinkingEvent | ThinkingDeltaEvent | TextDeltaEvent | ToolStepEvent | ResponseEvent | StoppedEvent | LoadHistoryEvent | SessionListEvent | SessionSearchResultsEvent | SessionDeletedEvent | NewSessionStartedEvent | ModelUpdateEvent | ErrorEvent;
export interface ACPRequest {
    jsonrpc: '2.0';
    id: string | number;
    method: string;
    params?: Record<string, unknown>;
}
export interface ACPResponse {
    jsonrpc: '2.0';
    id: string | number;
    result?: unknown;
    error?: {
        code: number;
        message: string;
        data?: unknown;
    };
}
export interface ACPNotification {
    jsonrpc: '2.0';
    method: string;
    params?: Record<string, unknown>;
}
export interface WSPacket {
    id: string;
    event: string;
    data: unknown;
    timestamp: number;
}
//# sourceMappingURL=index.d.ts.map