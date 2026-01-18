import { useState, useEffect } from 'react';
import { Plus, MessageSquare, Trash2, X } from 'lucide-react';

interface SessionSummary {
    id: string;
    title: string;
    createdAt: number;
    updatedAt: number;
}

interface SessionSidebarProps {
    currentSessionId?: string;
    onNewSession: () => void;
    onSelectSession: (sessionId: string) => void;
    onClose?: () => void;
    isOverlay?: boolean;
}

export function SessionSidebar({ 
    currentSessionId, 
    onNewSession, 
    onSelectSession,
    onClose,
    isOverlay = false
}: SessionSidebarProps) {
    const [sessions, setSessions] = useState<SessionSummary[]>([]);
    const [hoveredSession, setHoveredSession] = useState<string | null>(null);
    const [showClearConfirm, setShowClearConfirm] = useState(false);

    // Load sessions on mount and refresh periodically
    useEffect(() => {
        const loadSessions = async () => {
            try {
                const list = await window.ipcRenderer.invoke('session:list') as SessionSummary[];
                setSessions(list || []);
            } catch (err) {
                console.error('Failed to load sessions:', err);
            }
        };

        loadSessions();

        // Refresh when session changes
        const interval = setInterval(loadSessions, 5000);
        return () => clearInterval(interval);
    }, [currentSessionId]);

    const handleDeleteSession = async (e: React.MouseEvent, sessionId: string) => {
        e.stopPropagation();
        if (sessions.length <= 1) {
            // Don't delete the last session
            return;
        }
        try {
            await window.ipcRenderer.invoke('session:delete', sessionId);
            setSessions(prev => prev.filter(s => s.id !== sessionId));
            // If deleted current session, switch to first available
            if (sessionId === currentSessionId && sessions.length > 1) {
                const nextSession = sessions.find(s => s.id !== sessionId);
                if (nextSession) {
                    onSelectSession(nextSession.id);
                }
            }
        } catch (err) {
            console.error('Failed to delete session:', err);
        }
    };

    const handleClearAllSessions = async () => {
        if (sessions.length === 0) return;
        setShowClearConfirm(true);
    };

    const confirmClearAllSessions = async () => {
        setShowClearConfirm(false);
        try {
            const result = await window.ipcRenderer.invoke('session:clear-all') as { success: boolean; newSessionId?: string };
            // Reload sessions list
            const list = await window.ipcRenderer.invoke('session:list') as SessionSummary[];
            setSessions(list || []);
            // Switch to the new session
            if (result.newSessionId) {
                onSelectSession(result.newSessionId);
            } else if (list && list.length > 0) {
                onSelectSession(list[0].id);
            }
        } catch (err) {
            console.error('Failed to clear all sessions:', err);
        }
    };

    const formatDate = (timestamp: number) => {
        const date = new Date(timestamp);
        const now = new Date();
        const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
        
        if (diffDays === 0) {
            return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
        } else if (diffDays === 1) {
            return '昨天';
        } else if (diffDays < 7) {
            return `${diffDays}天前`;
        } else {
            return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
        }
    };

    return (
        <div className={`flex flex-col h-full bg-stone-50 ${isOverlay ? 'w-72' : 'w-64'}`}>
            {/* Header */}
            <div className="p-4 border-b border-stone-200 flex items-center justify-between">
                <h2 className="font-semibold text-stone-700">会话</h2>
                {isOverlay && onClose && (
                    <button
                        onClick={onClose}
                        className="p-1 text-stone-400 hover:text-stone-600 hover:bg-stone-200 rounded transition-colors"
                    >
                        <X size={18} />
                    </button>
                )}
            </div>

            {/* New Session Button */}
            <div className="p-3">
                <button
                    onClick={onNewSession}
                    className="w-full flex items-center gap-2 px-3 py-2.5 bg-brand-500 text-white rounded-lg hover:bg-brand-600 transition-colors text-sm font-medium"
                >
                    <Plus size={16} />
                    新建会话
                </button>
            </div>

            {/* Sessions List */}
            <div className="flex-1 overflow-y-auto px-3 pb-3">
                <div className="text-xs font-medium text-stone-400 uppercase tracking-wider mb-2 px-2">
                    最近
                </div>
                <div className="space-y-1">
                    {sessions.length === 0 ? (
                        <div className="text-center py-8 text-stone-400 text-sm">
                            暂无会话
                        </div>
                    ) : (
                        sessions.map((session) => (
                            <div
                                key={session.id}
                                onClick={() => onSelectSession(session.id)}
                                onMouseEnter={() => setHoveredSession(session.id)}
                                onMouseLeave={() => setHoveredSession(null)}
                                className={`
                                    group flex items-center gap-2 px-3 py-2.5 rounded-lg cursor-pointer transition-colors
                                    ${session.id === currentSessionId 
                                        ? 'bg-brand-100 text-brand-700' 
                                        : 'hover:bg-stone-100 text-stone-600'
                                    }
                                `}
                            >
                                <MessageSquare size={14} className={session.id === currentSessionId ? 'text-brand-500' : 'text-stone-400'} />
                                <div className="flex-1 min-w-0">
                                    <div className="text-sm font-medium truncate">
                                        {session.title || '新会话'}
                                    </div>
                                    <div className="text-xs text-stone-400">
                                        {formatDate(session.updatedAt)}
                                    </div>
                                </div>
                                {hoveredSession === session.id && sessions.length > 1 && (
                                    <button
                                        onClick={(e) => handleDeleteSession(e, session.id)}
                                        className="p-1 text-stone-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                                        title="删除会话"
                                    >
                                        <Trash2 size={14} />
                                    </button>
                                )}
                            </div>
                        ))
                    )}
                </div>
            </div>

            {/* Footer */}
            <div className="p-3 border-t border-stone-200 flex items-center justify-between">
                <div className="text-xs text-stone-400">
                    会话保存在本地
                </div>
                {sessions.length > 0 && (
                    <button
                        onClick={handleClearAllSessions}
                        className="p-1.5 text-stone-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                        title="清空所有会话"
                    >
                        <Trash2 size={14} />
                    </button>
                )}
            </div>

            {/* Clear All Sessions Confirmation Dialog */}
            {showClearConfirm && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                        <div className="p-6 space-y-4 text-center">
                            {/* WorkBuddy Icon */}
                            <div className="flex justify-center">
                                <div className="w-16 h-16 rounded-2xl bg-white shadow-lg flex items-center justify-center border border-stone-100 overflow-hidden">
                                    <img src="./logo.png" alt="WorkBuddy" className="w-full h-full object-cover" />
                                </div>
                            </div>
                            
                            {/* Message */}
                            <div className="space-y-2">
                                <p className="text-stone-800 text-base">
                                    确定要清空所有会话
                                </p>
                                <p className="text-stone-800 text-base">
                                    吗？此操作不可撤销。
                                </p>
                            </div>

                            {/* Buttons */}
                            <div className="flex gap-3 pt-2">
                                <button
                                    onClick={() => setShowClearConfirm(false)}
                                    className="flex-1 px-4 py-2.5 bg-stone-100 text-stone-700 rounded-lg hover:bg-stone-200 transition-colors font-medium"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={confirmClearAllSessions}
                                    className="flex-1 px-4 py-2.5 bg-stone-100 text-stone-700 rounded-lg hover:bg-stone-200 transition-colors font-medium"
                                >
                                    OK
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

