import { useState, useEffect, useRef } from 'react';
import { Minus, Square, X, PanelLeftClose, PanelLeft, Plus } from 'lucide-react';
import { CoworkView } from './components/CoworkView';
import { SettingsView } from './components/SettingsView';
import { ConfirmDialog, useConfirmations } from './components/ConfirmDialog';
import { AboutDialog } from './components/AboutDialog';
import { FloatingBallPage } from './components/FloatingBallPage';
import { SessionSidebar } from './components/SessionSidebar';
import { SetupWizard } from './components/SetupWizard';
import Anthropic from '@anthropic-ai/sdk';

// User info type matching the one in ConfigStore
export interface UserInfo {
  userId: string;
  userName: string;
  userNickname: string;
  token: string;
  enterpriseId?: string;
  enterprise?: string;
}

type SessionMode = 'chat' | 'work';

function App() {
  const [chatHistory, setChatHistory] = useState<Anthropic.MessageParam[]>([]);
  const [workHistory, setWorkHistory] = useState<Anthropic.MessageParam[]>([]);
  const [mode, setMode] = useState<SessionMode>('work');
  const [isChatProcessing, setIsChatProcessing] = useState(false);
  const [isWorkProcessing, setIsWorkProcessing] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [isLoginPending, setIsLoginPending] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showSetup, setShowSetup] = useState<boolean | null>(null); // null = loading, true = show, false = skip
  const { pendingRequest, handleConfirm, handleDeny } = useConfirmations();

  // Track which mode is currently processing
  const processingModeRef = useRef<SessionMode | null>(null);

  // Get history and processing state for current mode
  const history = mode === 'chat' ? chatHistory : workHistory;
  const setHistory = mode === 'chat' ? setChatHistory : setWorkHistory;
  const isProcessing = mode === 'chat' ? isChatProcessing : isWorkProcessing;

  // Check if this is the floating ball window
  const isFloatingBall = window.location.hash === '#/floating-ball' || window.location.hash === '#floating-ball';

  // Check if first-time setup is needed
  useEffect(() => {
    const checkSetup = async () => {
      // Skip setup check for floating ball
      if (isFloatingBall) {
        setShowSetup(false);
        return;
      }
      
      try {
        const result = await window.ipcRenderer.invoke('setup:check') as { complete: boolean };
        setShowSetup(!result.complete);
      } catch (err) {
        console.error('Failed to check setup status:', err);
        setShowSetup(false); // Skip setup on error
      }
    };
    
    checkSetup();
  }, [isFloatingBall]);

  // Get session ID from URL hash (format: #session=xxx)
  useEffect(() => {
    const parseSessionFromHash = () => {
      const hash = window.location.hash;
      const match = hash.match(/session=([^&]+)/);
      return match ? match[1] : null;
    };

    const initSession = async () => {
      const hashSessionId = parseSessionFromHash();
      
      if (hashSessionId) {
        // Load session from hash
        setSessionId(hashSessionId);
        try {
          const session = await window.ipcRenderer.invoke('session:get', hashSessionId) as { 
            id: string; 
            messages: Anthropic.MessageParam[];
            chatMessages?: Anthropic.MessageParam[];
            workMessages?: Anthropic.MessageParam[];
          } | null;
          if (session) {
            setChatHistory(session.chatMessages || []);
            setWorkHistory(session.workMessages || session.messages || []);
          }
        } catch (err) {
          console.error('Failed to load session:', err);
        }
      } else {
        // Fallback: try to get current session
        try {
          const currentSession = await window.ipcRenderer.invoke('session:current') as { 
            id: string; 
            messages: Anthropic.MessageParam[];
            chatMessages?: Anthropic.MessageParam[];
            workMessages?: Anthropic.MessageParam[];
          } | null;
          if (currentSession) {
            setSessionId(currentSession.id);
            setChatHistory(currentSession.chatMessages || []);
            setWorkHistory(currentSession.workMessages || currentSession.messages || []);
          }
        } catch (err) {
          console.error('Failed to get current session:', err);
        }
      }
    };

    if (!isFloatingBall) {
      initSession();
    }

    // Listen for hash changes
    const handleHashChange = () => {
      const newSessionId = parseSessionFromHash();
      if (newSessionId && newSessionId !== sessionId) {
        setSessionId(newSessionId);
      }
    };

    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, [isFloatingBall, sessionId]);

  // Listen for history updates - update based on processing mode
  useEffect(() => {
    const removeListener = window.ipcRenderer.on('agent:history-update', (_event, ...args) => {
      const updatedHistory = args[0] as Anthropic.MessageParam[];
      // Update history for the mode that initiated the request
      const targetMode = processingModeRef.current || mode;
      if (targetMode === 'chat') {
        setChatHistory(updatedHistory);
      } else {
        setWorkHistory(updatedHistory);
      }
      if (updatedHistory.length > 0) {
        const lastMsg = updatedHistory[updatedHistory.length - 1];
        if (lastMsg.role === 'assistant' && lastMsg.content && 
            (typeof lastMsg.content === 'string' ? lastMsg.content.length > 0 : true)) {
          // Clear processing for the mode that was processing
          if (targetMode === 'chat') {
            setIsChatProcessing(false);
          } else {
            setIsWorkProcessing(false);
          }
        }
      }
    });

    return () => {
      removeListener();
    };
  }, [mode]);

  // Listen for complete/error events - clear processing for the mode that initiated request
  useEffect(() => {
    const removeCompleteListener = window.ipcRenderer.on('agent:complete', () => {
      // Clear processing for the mode that was processing
      if (processingModeRef.current === 'chat') {
        setIsChatProcessing(false);
      } else if (processingModeRef.current === 'work') {
        setIsWorkProcessing(false);
      }
      processingModeRef.current = null;
    });

    const removeErrorListener = window.ipcRenderer.on('agent:error', (_event, ...args) => {
      const err = args[0] as string;
      console.error("Agent Error:", err);
      // Clear processing for the mode that was processing
      if (processingModeRef.current === 'chat') {
        setIsChatProcessing(false);
      } else if (processingModeRef.current === 'work') {
        setIsWorkProcessing(false);
      }
      processingModeRef.current = null;
    });

    return () => {
      removeCompleteListener();
      removeErrorListener();
    };
  }, []);

  // Listen for About dialog request from menu
  useEffect(() => {
    const removeAboutListener = window.ipcRenderer.on('app:show-about', () => {
      setShowAbout(true);
    });

    return () => {
      removeAboutListener();
    };
  }, []);

  // Check auth status on mount and listen for auth changes
  useEffect(() => {
    // Check initial auth status
    const checkAuth = async () => {
      try {
        const result = await window.ipcRenderer.invoke('auth:check-login') as { isLoggedIn: boolean; userInfo: UserInfo | null };
        if (result.isLoggedIn && result.userInfo) {
          setUserInfo(result.userInfo);
        }
      } catch (err) {
        console.error('Failed to check auth status:', err);
      }
    };
    
    if (!isFloatingBall) {
      checkAuth();
    }

    // Listen for user changes (login/logout)
    const removeUserChangedListener = window.ipcRenderer.on('auth:user-changed', (_event, ...args) => {
      const newUserInfo = args[0] as UserInfo | null;
      // #region agent log
      fetch('http://127.0.0.1:7245/ingest/e5ab6b9a-54c9-4022-ba10-dda891568b8f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.tsx:auth:user-changed',message:'User changed event received',data:{hasNewUserInfo:!!newUserInfo,userName:newUserInfo?.userName},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H7'})}).catch(()=>{});
      // #endregion
      setUserInfo(newUserInfo);
      setIsLoginPending(false);
    });

    // Listen for login pending state
    const removeLoginPendingListener = window.ipcRenderer.on('auth:login-pending', () => {
      setIsLoginPending(true);
    });

    return () => {
      removeUserChangedListener();
      removeLoginPendingListener();
    };
  }, [isFloatingBall]);

  const handleSendMessage = async (msg: string | { content: string, images: string[] }) => {
    if (!sessionId) {
      console.error('No active session');
      return;
    }
    
    // Add user message to history immediately for instant display
    const userMessage: Anthropic.MessageParam = {
      role: 'user',
      content: typeof msg === 'string' ? msg : msg.content
    };
    setHistory(prev => [...prev, userMessage]);
    
    // Track which mode is processing and set processing state
    processingModeRef.current = mode;
    if (mode === 'chat') {
      setIsChatProcessing(true);
    } else {
      setIsWorkProcessing(true);
    }
    
    // Fire and forget - don't block UI
    // Results are streamed via IPC events (agent:stream-token, agent:history-update)
    window.ipcRenderer.invoke('agent:send-message', { 
      sessionId, 
      message: msg,
      mode  // Pass mode to backend
    }).catch(err => {
      console.error('Failed to send message:', err);
      // Clear processing for the mode that failed
      if (mode === 'chat') {
        setIsChatProcessing(false);
      } else {
        setIsWorkProcessing(false);
      }
      processingModeRef.current = null;
    });
  };

  const handleAbort = () => {
    if (sessionId) {
      window.ipcRenderer.invoke('agent:abort', sessionId);
    }
    // Clear processing for the mode that was processing
    if (processingModeRef.current === 'chat') {
      setIsChatProcessing(false);
    } else if (processingModeRef.current === 'work') {
      setIsWorkProcessing(false);
    }
    processingModeRef.current = null;
  };

  // Handle session change (e.g., when switching workspace creates a new session)
  const handleSessionChange = (newSessionId: string) => {
    setSessionId(newSessionId);
    setChatHistory([]);
    setWorkHistory([]);
    // Update URL hash to reflect new session
    window.location.hash = `#session=${newSessionId}`;
  };

  // Handle mode change
  const handleModeChange = (newMode: SessionMode) => {
    setMode(newMode);
  };

  // Create a new window (opens new session in new window)
  const handleNewWindow = () => {
    window.ipcRenderer.invoke('window:new-session');
  };

  // Handle session selection from sidebar
  const handleSelectSession = async (targetSessionId: string) => {
    if (targetSessionId === sessionId) {
      setSidebarOpen(false);
      return;
    }
    try {
      const result = await window.ipcRenderer.invoke('session:switch', targetSessionId) as { 
        success: boolean; 
        history?: Anthropic.MessageParam[];
        chatMessages?: Anthropic.MessageParam[];
        workMessages?: Anthropic.MessageParam[];
      };
      if (result.success) {
        setSessionId(targetSessionId);
        setChatHistory(result.chatMessages || []);
        setWorkHistory(result.workMessages || result.history || []);
        window.location.hash = `#session=${targetSessionId}`;
      }
    } catch (err) {
      console.error('Failed to switch session:', err);
    }
    setSidebarOpen(false);
  };

  // Handle new session from sidebar
  const handleNewSession = () => {
    handleNewWindow();
    setSidebarOpen(false);
  };

  // If this is the floating ball window, render only the floating ball
  if (isFloatingBall) {
    return <FloatingBallPage />;
  }

  // Show loading while checking setup status
  if (showSetup === null) {
    return (
      <div className="h-screen w-full bg-[#FAF8F5] flex items-center justify-center">
        <div className="text-stone-400">加载中...</div>
      </div>
    );
  }

  // Show setup wizard if first time
  if (showSetup) {
    return <SetupWizard onComplete={() => setShowSetup(false)} />;
  }

  // Platform detection
  const isMac = window.platform?.isMac ?? false;

  // Main App - Simple single-session window
  return (
    <div className="h-screen w-full bg-[#FAF8F5] flex flex-col overflow-hidden font-sans">
      {/* Custom Titlebar */}
      <header
        className="h-10 border-b border-stone-200/80 flex items-center justify-between bg-white/80 backdrop-blur-sm shrink-0"
        style={{ 
          WebkitAppRegion: 'drag',
          paddingLeft: isMac ? '78px' : '12px',
          paddingRight: '12px'
        } as React.CSSProperties}
      >
        <div className="flex items-center gap-2" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          {/* Sidebar Toggle Button */}
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-1.5 text-stone-400 hover:text-stone-600 hover:bg-stone-100 rounded transition-colors"
            title={sidebarOpen ? "收起侧边栏" : "展开侧边栏"}
          >
            {sidebarOpen ? <PanelLeftClose size={16} /> : <PanelLeft size={16} />}
          </button>
          <img src="./logo.png" alt="Logo" className="w-5 h-5 rounded" />
          <span className="font-medium text-stone-700 text-sm">WorkBuddy</span>
        </div>

        <div className="flex items-center gap-1" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          {/* New Window Button */}
          <button
            onClick={async () => {
              const folder = await window.ipcRenderer.invoke('dialog:select-folder') as string | null;
              if (folder) {
                await window.ipcRenderer.invoke('window:new-with-folder', folder);
              }
            }}
            className="p-1.5 text-stone-400 hover:text-brand-600 hover:bg-brand-50 rounded transition-colors"
            title="新建窗口"
          >
            <Plus size={16} />
          </button>

          {/* Window Controls - Only show on Windows/Linux */}
          {!isMac && (
            <>
              <button
                onClick={() => window.ipcRenderer.invoke('window:minimize')}
                className="p-1.5 text-stone-400 hover:text-stone-600 hover:bg-stone-100 rounded transition-colors"
                title="Minimize"
              >
                <Minus size={14} />
              </button>
              <button
                onClick={() => window.ipcRenderer.invoke('window:maximize')}
                className="p-1.5 text-stone-400 hover:text-stone-600 hover:bg-stone-100 rounded transition-colors"
                title="Maximize"
              >
                <Square size={12} />
              </button>
              <button
                onClick={() => window.ipcRenderer.invoke('window:close')}
                className="p-1.5 text-stone-400 hover:text-stone-600 hover:bg-red-100 hover:text-red-500 rounded transition-colors"
                title="Close"
              >
                <X size={14} />
              </button>
            </>
          )}
        </div>
      </header>

      {/* Main Content with Sidebar */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Sidebar - slides in from left, no backdrop */}
        <div className={`
          fixed md:relative inset-y-0 left-0 z-50 md:z-auto
          transform transition-transform duration-200 ease-out
          md:transform-none border-r border-stone-200 shadow-lg md:shadow-none
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        `} style={{ top: isMac ? '40px' : '40px' }}>
          <SessionSidebar
            currentSessionId={sessionId ?? undefined}
            onNewSession={handleNewSession}
            onSelectSession={handleSelectSession}
            onClose={() => setSidebarOpen(false)}
            isOverlay={!sidebarOpen}
          />
        </div>

        {/* Backdrop overlay when sidebar is open - closes sidebar on click */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 bg-black/20 z-40 md:hidden"
            onClick={() => setSidebarOpen(false)}
            style={{ top: isMac ? '40px' : '40px' }}
          />
        )}

        {/* Main Content */}
        <main 
          className="flex-1 overflow-hidden"
          onClick={() => {
            // Close sidebar when clicking main content area (only on mobile/overlay mode)
            if (sidebarOpen && window.innerWidth < 768) {
              setSidebarOpen(false);
            }
          }}
        >
          {showSettings ? (
            <SettingsView 
              onClose={() => setShowSettings(false)} 
              userInfo={userInfo}
              onUserInfoChange={setUserInfo}
            />
          ) : (
            <CoworkView
              history={history}
              onSendMessage={handleSendMessage}
              onAbort={handleAbort}
              isProcessing={isProcessing}
              onOpenSettings={() => setShowSettings(true)}
              sessionId={sessionId ?? undefined}
              onClearHistory={() => {
                // Clear history for current mode only
                if (mode === 'chat') {
                  setChatHistory([]);
                } else {
                  setWorkHistory([]);
                }
                window.ipcRenderer.invoke('agent:clear-history', sessionId, mode);
              }}
              onSessionChange={handleSessionChange}
              userInfo={userInfo}
              isLoginPending={isLoginPending}
              mode={mode}
              onModeChange={handleModeChange}
            />
          )}
        </main>
      </div>

      {/* Confirmation Dialog */}
      <ConfirmDialog
        request={pendingRequest}
        onConfirm={handleConfirm}
        onDeny={handleDeny}
      />

      {/* About Dialog */}
      <AboutDialog
        isOpen={showAbout}
        onClose={() => setShowAbout(false)}
      />
    </div>
  );
}

export default App;
