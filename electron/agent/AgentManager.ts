import { BrowserWindow } from 'electron';
import { AgentRuntime } from './AgentRuntime';
import { CLIAgentRuntime } from './CLIAgentRuntime';
import { CodeBuddySDKRuntime } from './CodeBuddySDKRuntime';
import { configStore } from '../config/ConfigStore';

export type AgentType = AgentRuntime | CLIAgentRuntime | CodeBuddySDKRuntime;

export type IntegrationMode = 'api' | 'cli-codebuddy' | 'sdk-codebuddy';

/**
 * AgentManager manages multiple Agent instances, one per session/window.
 * Each window = one session = one CodeBuddy process.
 */
export class AgentManager {
    private agents: Map<string, AgentType> = new Map();
    private windowSessions: Map<number, string> = new Map(); // windowId -> sessionId
    private sessionWindows: Map<string, BrowserWindow> = new Map(); // sessionId -> window
    private floatingBallWindow: BrowserWindow | null = null;

    constructor() {
        console.log('[AgentManager] Initialized');
    }

    /**
     * Register a window with a session
     */
    public registerWindow(windowId: number, sessionId: string, win: BrowserWindow) {
        this.windowSessions.set(windowId, sessionId);
        this.sessionWindows.set(sessionId, win);
        console.log(`[AgentManager] Registered window ${windowId} for session ${sessionId}`);
    }

    /**
     * Unregister a window (called when window closes)
     */
    public unregisterWindow(windowId: number): string | undefined {
        const sessionId = this.windowSessions.get(windowId);
        if (sessionId) {
            this.windowSessions.delete(windowId);
            this.sessionWindows.delete(sessionId);
            // Also destroy the agent for this session
            this.destroyAgent(sessionId);
            console.log(`[AgentManager] Unregistered window ${windowId}, session ${sessionId}`);
        }
        return sessionId;
    }

    /**
     * Get session ID for a window
     */
    public getSessionForWindow(windowId: number): string | undefined {
        return this.windowSessions.get(windowId);
    }

    /**
     * Get window for a session
     */
    public getWindowForSession(sessionId: string): BrowserWindow | undefined {
        return this.sessionWindows.get(sessionId);
    }

    /**
     * Set the floating ball window for agent broadcasts
     */
    public setFloatingBallWindow(win: BrowserWindow | null) {
        this.floatingBallWindow = win;
        if (win) {
            this.agents.forEach(agent => {
                if ('addWindow' in agent) {
                    agent.addWindow(win);
                }
            });
        }
    }

    /**
     * Get an existing agent for a session
     */
    public getAgent(sessionId: string): AgentType | undefined {
        return this.agents.get(sessionId);
    }

    /**
     * Get or create an agent for a session
     */
    public getOrCreateAgent(sessionId: string): AgentType | null {
        // Return existing agent if available
        const existing = this.agents.get(sessionId);
        if (existing) {
            console.log(`[AgentManager] Returning existing agent for session: ${sessionId}`);
            return existing;
        }

        // Create new agent
        const agent = this.createAgent(sessionId);
        if (agent) {
            this.agents.set(sessionId, agent);
            console.log(`[AgentManager] Created new agent for session: ${sessionId}, total agents: ${this.agents.size}`);
        }
        return agent;
    }

    /**
     * Create a new agent based on current integration mode
     */
    private createAgent(sessionId: string): AgentType | null {
        // Get the window for this session
        const sessionWindow = this.sessionWindows.get(sessionId);
        if (!sessionWindow) {
            console.warn(`[AgentManager] Cannot create agent: no window for session ${sessionId}`);
            return null;
        }

        const integrationMode = configStore.getIntegrationMode() as IntegrationMode;
        console.log(`[AgentManager] Creating agent for session ${sessionId}, mode: ${integrationMode}`);

        // Inject CodeBuddy environment variables
        this.injectCodeBuddyEnv();

        let agent: AgentType | null = null;

        try {
            if (integrationMode === 'sdk-codebuddy') {
                const codeBuddyApiKey = configStore.getCodeBuddyApiKey();
                const codeBuddyInternetEnv = configStore.getCodeBuddyInternetEnv();
                
                agent = new CodeBuddySDKRuntime(sessionWindow, codeBuddyApiKey, codeBuddyInternetEnv);
                agent.initialize().catch(err => 
                    console.error(`[AgentManager] CodeBuddy SDK init failed for ${sessionId}:`, err)
                );

            } else if (integrationMode === 'cli-codebuddy') {
                agent = new CLIAgentRuntime(sessionWindow);
                agent.initialize().catch(err => 
                    console.error(`[AgentManager] CodeBuddy CLI init failed for ${sessionId}:`, err)
                );

            } else {
                // API mode (default)
                const apiKey = configStore.getApiKey() || process.env.ANTHROPIC_API_KEY;
                if (apiKey) {
                    agent = new AgentRuntime(
                        apiKey,
                        sessionWindow,
                        configStore.getModel(),
                        configStore.getApiUrl()
                    );
                    agent.initialize().catch(err => 
                        console.error(`[AgentManager] API Agent init failed for ${sessionId}:`, err)
                    );
                } else {
                    console.warn('[AgentManager] No API key configured');
                    return null;
                }
            }

            // Add floating ball window if available
            if (agent && this.floatingBallWindow) {
                agent.addWindow(this.floatingBallWindow);
            }

            return agent;

        } catch (err) {
            console.error(`[AgentManager] Failed to create agent for ${sessionId}:`, err);
            return null;
        }
    }

    /**
     * Inject CodeBuddy environment variables from config
     */
    private injectCodeBuddyEnv() {
        try {
            const storedApiKey = configStore.getCodeBuddyApiKey();
            const storedInternetEnv = configStore.getCodeBuddyInternetEnv();
            
            if (storedApiKey && storedApiKey.trim() !== '') {
                process.env.CODEBUDDY_API_KEY = storedApiKey;
            }
            process.env.CODEBUDDY_INTERNET_ENVIRONMENT = storedInternetEnv || 'ioa';
        } catch (err) {
            console.error('[AgentManager] Failed to inject CodeBuddy env vars:', err);
            process.env.CODEBUDDY_INTERNET_ENVIRONMENT = 'ioa';
        }
    }

    /**
     * Destroy an agent for a specific session
     */
    public destroyAgent(sessionId: string): boolean {
        const agent = this.agents.get(sessionId);
        if (agent) {
            try {
                agent.abort();
                if ('cleanup' in agent) {
                    agent.cleanup();
                }
                this.agents.delete(sessionId);
                console.log(`[AgentManager] Destroyed agent for session: ${sessionId}, remaining: ${this.agents.size}`);
                return true;
            } catch (err) {
                console.error(`[AgentManager] Error destroying agent for ${sessionId}:`, err);
                this.agents.delete(sessionId);
                return false;
            }
        }
        return false;
    }

    /**
     * Destroy all agents (used on app quit)
     */
    public destroyAll(): void {
        console.log(`[AgentManager] Destroying all agents (${this.agents.size} total)`);
        
        this.agents.forEach((agent, sessionId) => {
            try {
                agent.abort();
                if ('cleanup' in agent) {
                    agent.cleanup();
                }
            } catch (err) {
                console.error(`[AgentManager] Error cleaning up agent ${sessionId}:`, err);
            }
        });

        this.agents.clear();
        console.log('[AgentManager] All agents destroyed');
    }

    /**
     * Get count of active agents
     */
    public getAgentCount(): number {
        return this.agents.size;
    }

    /**
     * Check if a session has an active agent
     */
    public hasAgent(sessionId: string): boolean {
        return this.agents.has(sessionId);
    }

    /**
     * Get all session IDs with active agents
     */
    public getActiveSessionIds(): string[] {
        return Array.from(this.agents.keys());
    }

    /**
     * Get all open session windows
     */
    public getAllSessionWindows(): Array<{ sessionId: string; window: BrowserWindow }> {
        return Array.from(this.sessionWindows.entries()).map(([sessionId, window]) => ({
            sessionId,
            window
        }));
    }

    /**
     * Get count of open windows
     */
    public getWindowCount(): number {
        return this.windowSessions.size;
    }
}

// Export singleton instance
export const agentManager = new AgentManager();

