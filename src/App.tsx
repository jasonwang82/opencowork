import { useState, useEffect } from 'react';
import { Minus, Square, X, Plus } from 'lucide-react';
import { CoworkView } from './components/CoworkView';
import { SettingsView } from './components/SettingsView';
import { ConfirmDialog, useConfirmations } from './components/ConfirmDialog';
import { FloatingBallPage } from './components/FloatingBallPage';
import Anthropic from '@anthropic-ai/sdk';

function App() {
  const [history, setHistory] = useState<Anthropic.MessageParam[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const { pendingRequest, handleConfirm, handleDeny } = useConfirmations();

  // Check if this is the floating ball window
  const isFloatingBall = window.location.hash === '#/floating-ball' || window.location.hash === '#floating-ball';

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
          const session = await window.ipcRenderer.invoke('session:get', hashSessionId) as { id: string; messages: Anthropic.MessageParam[] } | null;
          if (session) {
            setHistory(session.messages);
          }
        } catch (err) {
          console.error('Failed to load session:', err);
        }
      } else {
        // Fallback: try to get current session
        try {
          const currentSession = await window.ipcRenderer.invoke('session:current') as { id: string; messages: Anthropic.MessageParam[] } | null;
          if (currentSession) {
            setSessionId(currentSession.id);
            setHistory(currentSession.messages);
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

  // Listen for history updates
  useEffect(() => {
    const removeListener = window.ipcRenderer.on('agent:history-update', (_event, ...args) => {
      const updatedHistory = args[0] as Anthropic.MessageParam[];
      setHistory(updatedHistory);
      if (updatedHistory.length > 0) {
        const lastMsg = updatedHistory[updatedHistory.length - 1];
        if (lastMsg.role === 'assistant' && lastMsg.content && 
            (typeof lastMsg.content === 'string' ? lastMsg.content.length > 0 : true)) {
          setIsProcessing(false);
        }
      }
    });

    const removeCompleteListener = window.ipcRenderer.on('agent:complete', () => {
      setIsProcessing(false);
    });

    const removeErrorListener = window.ipcRenderer.on('agent:error', (_event, ...args) => {
      const err = args[0] as string;
      console.error("Agent Error:", err);
      setIsProcessing(false);
    });

    return () => {
      removeListener();
      removeCompleteListener();
      removeErrorListener();
    };
  }, []);

  const handleSendMessage = async (msg: string | { content: string, images: string[] }) => {
    if (!sessionId) {
      console.error('No active session');
      return;
    }
    setIsProcessing(true);
    try {
      const result = await window.ipcRenderer.invoke('agent:send-message', { 
        sessionId, 
        message: msg 
      }) as { error?: string } | undefined;
      if (result?.error) {
        console.error(result.error);
        setIsProcessing(false);
      }
    } catch (err) {
      console.error(err);
      setIsProcessing(false);
    }
  };

  const handleAbort = () => {
    if (sessionId) {
      window.ipcRenderer.invoke('agent:abort', sessionId);
    }
    setIsProcessing(false);
  };

  // Create a new window (opens new session in new window)
  const handleNewWindow = () => {
    window.ipcRenderer.invoke('window:new-session');
  };

  // If this is the floating ball window, render only the floating ball
  if (isFloatingBall) {
    return <FloatingBallPage />;
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
          <img src="./logo.png" alt="Logo" className="w-6 h-6 rounded-md object-cover" />
          <span className="font-medium text-stone-700 text-sm">WorkBuddy</span>
        </div>

        <div className="flex items-center gap-1" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          {/* New Window Button */}
          <button
            onClick={handleNewWindow}
            className="p-1.5 text-stone-400 hover:text-stone-600 hover:bg-stone-100 rounded transition-colors"
            title="新建窗口 (Ctrl+N)"
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

      {/* Main Content */}
      <main className="flex-1 overflow-hidden">
        {showSettings ? (
          <SettingsView onClose={() => setShowSettings(false)} />
        ) : (
          <CoworkView
            history={history}
            onSendMessage={handleSendMessage}
            onAbort={handleAbort}
            isProcessing={isProcessing}
            onOpenSettings={() => setShowSettings(true)}
            onNewWindow={handleNewWindow}
          />
        )}
      </main>

      {/* Confirmation Dialog */}
      <ConfirmDialog
        request={pendingRequest}
        onConfirm={handleConfirm}
        onDeny={handleDeny}
      />
    </div>
  );
}

export default App;
