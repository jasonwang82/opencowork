import { BrowserWindow } from 'electron';
import { AgentRuntime } from './AgentRuntime';
import { CLIAgentRuntime } from './CLIAgentRuntime';
import { CodeBuddySDKRuntime } from './CodeBuddySDKRuntime';
import { configStore } from '../config/ConfigStore';
import { permissionManager } from './security/PermissionManager';
import { logger } from '../utils/logger';

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
        logger.info('Registered window with session', { 
            windowId, 
            sessionId,
            totalWindowSessions: this.windowSessions.size,
            totalSessionWindows: this.sessionWindows.size
        });
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
            logger.info('Unregistered window', { windowId, sessionId });
        } else {
            logger.warn('Attempted to unregister unknown window', { windowId });
        }
        return sessionId;
    }

    /**
     * Update session mapping for a window (used when switching workspaces)
     * This keeps the window but associates it with a new session
     */
    public updateWindowSession(windowId: number, oldSessionId: string, newSessionId: string, win: BrowserWindow): void {
        logger.info('Updating window session mapping', { windowId, oldSessionId, newSessionId });
        
        // Remove old mappings
        this.windowSessions.delete(windowId);
        this.sessionWindows.delete(oldSessionId);
        
        // Add new mappings
        this.windowSessions.set(windowId, newSessionId);
        this.sessionWindows.set(newSessionId, win);
        
        logger.info('Window session mapping updated', { 
            windowId, 
            newSessionId,
            totalWindowSessions: this.windowSessions.size,
            totalSessionWindows: this.sessionWindows.size
        });
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
            logger.info('Returning existing agent', { sessionId });
            return existing;
        }

        // Create new agent
        logger.info('Creating new agent', { sessionId });
        const agent = this.createAgent(sessionId);
        if (agent) {
            this.agents.set(sessionId, agent);
            logger.info('Agent created successfully', { sessionId, totalAgents: this.agents.size });
        } else {
            logger.error('Failed to create agent', { 
                sessionId, 
                availableSessions: Array.from(this.sessionWindows.keys()),
                availableWindows: Array.from(this.windowSessions.keys())
            });
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
            logger.error('Cannot create agent: no window for session', { 
                sessionId,
                registeredSessions: Array.from(this.sessionWindows.keys()),
                registeredWindows: Array.from(this.windowSessions.entries()).map(([wid, sid]) => ({ windowId: wid, sessionId: sid }))
            });
            return null;
        }

        const integrationMode = configStore.getIntegrationMode() as IntegrationMode;
        logger.info('Creating agent', { sessionId, mode: integrationMode });

        // Inject CodeBuddy environment variables
        this.injectCodeBuddyEnv();

        let agent: AgentType | null = null;

        try {
            if (integrationMode === 'sdk-codebuddy') {
                const codeBuddyApiKey = configStore.getCodeBuddyApiKey();
                const codeBuddyInternetEnv = configStore.getCodeBuddyInternetEnv();
                
                // Get cwd from authorized folders - bound at construction time
                const authorizedFolders = permissionManager.getAuthorizedFolders();
                const cwd = authorizedFolders.length > 0 ? authorizedFolders[0] : '';
                logger.info('SDK Runtime configuration', { 
                    cwd: cwd || 'NOT SET', 
                    hasApiKey: !!codeBuddyApiKey,
                    internetEnv: codeBuddyInternetEnv
                });
                
                agent = new CodeBuddySDKRuntime(sessionWindow, codeBuddyApiKey, codeBuddyInternetEnv, cwd);
                agent.initialize().catch(err => {
                    const error = err as Error;
                    logger.error('CodeBuddy SDK init failed', { 
                        sessionId, 
                        error: error.message, 
                        stack: error.stack 
                    });
                });

            } else if (integrationMode === 'cli-codebuddy') {
                // NOTE: CLI mode is deprecated, use SDK mode instead.
                // This code path is preserved for backwards compatibility but 
                // the UI no longer exposes CLI mode as an option.
                logger.warn('CLI mode is deprecated, consider using SDK mode', { sessionId });
                agent = new CLIAgentRuntime(sessionWindow);
                agent.initialize().catch(err => {
                    const error = err as Error;
                    logger.error('CodeBuddy CLI init failed', { 
                        sessionId, 
                        error: error.message, 
                        stack: error.stack 
                    });
                });

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
                    agent.initialize().catch(err => {
                        const error = err as Error;
                        logger.error('API Agent init failed', { 
                            sessionId, 
                            error: error.message, 
                            stack: error.stack 
                        });
                    });
                } else {
                    logger.error('No API key configured', { sessionId });
                    return null;
                }
            }

            // Add floating ball window if available
            if (agent && this.floatingBallWindow) {
                agent.addWindow(this.floatingBallWindow);
            }

            return agent;

        } catch (err) {
            const error = err as Error;
            logger.error('Failed to create agent', { 
                sessionId, 
                error: error.message, 
                stack: error.stack,
                integrationMode
            });
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
            const error = err as Error;
            logger.error('Failed to inject CodeBuddy env vars', { 
                error: error.message, 
                stack: error.stack 
            });
            process.env.CODEBUDDY_INTERNET_ENVIRONMENT = 'ioa';
        }
    }

    /**
     * Destroy an agent for a specific session
     */
    public destroyAgent(sessionId: string): boolean {
        logger.info('Destroying agent', { sessionId });
        const agent = this.agents.get(sessionId);
        if (agent) {
            try {
                agent.abort();
                if ('cleanup' in agent) {
                    agent.cleanup();
                }
                this.agents.delete(sessionId);
                logger.info('Agent destroyed successfully', { sessionId, remainingAgents: this.agents.size });
                return true;
            } catch (err) {
                const error = err as Error;
                logger.error('Error destroying agent', { 
                    sessionId, 
                    error: error.message, 
                    stack: error.stack 
                });
                this.agents.delete(sessionId);
                return false;
            }
        } else {
            logger.warn('No agent found to destroy', { sessionId });
        }
        return false;
    }

    /**
     * Destroy all agents (used on app quit)
     */
    public destroyAll(): void {
        logger.info('Destroying all agents', { totalAgents: this.agents.size });
        
        this.agents.forEach((agent, sessionId) => {
            try {
                agent.abort();
                if ('cleanup' in agent) {
                    agent.cleanup();
                }
                logger.info('Agent cleaned up', { sessionId });
            } catch (err) {
                const error = err as Error;
                logger.error('Error cleaning up agent', { 
                    sessionId, 
                    error: error.message, 
                    stack: error.stack 
                });
            }
        });

        this.agents.clear();
        logger.info('All agents destroyed');
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

