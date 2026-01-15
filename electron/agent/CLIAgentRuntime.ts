import { BrowserWindow } from 'electron';
import { spawn, ChildProcess } from 'child_process';
import { permissionManager } from './security/PermissionManager';
import { configStore } from '../config/ConfigStore';
import Anthropic from '@anthropic-ai/sdk';

export type AgentMessage = {
    role: 'user' | 'assistant';
    content: string | Anthropic.ContentBlock[];
    id?: string;
};

/**
 * CLIAgentRuntime - Integration with CodeBuddy CLI
 * 
 * This runtime executes the `codebuddy` command to interact with AI
 * instead of using API calls. It's similar to how Claude Code CLI works.
 */
export class CLIAgentRuntime {
    private windows: BrowserWindow[] = [];
    private history: Anthropic.MessageParam[] = [];
    private isProcessing = false;
    private currentProcess: ChildProcess | null = null;
    private pendingConfirmations: Map<string, { resolve: (approved: boolean) => void }> = new Map();

    constructor(window: BrowserWindow) {
        this.windows = [window];
    }

    public addWindow(win: BrowserWindow) {
        if (!this.windows.includes(win)) {
            this.windows.push(win);
        }
    }

    public async initialize() {
        console.log('Initializing CLIAgentRuntime (CodeBuddy)...');
        // Check if codebuddy is available
        try {
            const testProcess = spawn('codebuddy', ['--version'], { shell: false });
            testProcess.on('error', (err) => {
                console.error('CodeBuddy CLI not found:', err);
                this.broadcast('agent:error', 
                    'CodeBuddy CLI is not installed or not in PATH. ' +
                    'Please install it by following the instructions at the CodeBuddy documentation. ' +
                    'After installation, make sure the "codebuddy" command is available in your system PATH.'
                );
            });
            testProcess.on('close', (code) => {
                if (code === 0) {
                    console.log('CodeBuddy CLI is available');
                } else {
                    console.warn('CodeBuddy CLI check returned non-zero exit code:', code);
                }
            });
        } catch (error) {
            console.error('Failed to check CodeBuddy CLI:', error);
        }
    }

    public removeWindow(win: BrowserWindow) {
        this.windows = this.windows.filter(w => w !== win);
    }

    public handleConfirmResponse(id: string, approved: boolean) {
        const pending = this.pendingConfirmations.get(id);
        if (pending) {
            pending.resolve(approved);
            this.pendingConfirmations.delete(id);
        }
    }

    public clearHistory() {
        this.history = [];
        this.notifyUpdate();
    }

    public loadHistory(messages: Anthropic.MessageParam[]) {
        this.history = messages;
        this.notifyUpdate();
    }

    public async processUserMessage(input: string | { content: string, images: string[] }) {
        if (this.isProcessing) {
            throw new Error('Agent is already processing a message');
        }

        this.isProcessing = true;

        try {
            let userContent: string = '';
            
            if (typeof input === 'string') {
                userContent = input;
            } else {
                userContent = input.content;
                // Note: CLI mode does not support images
                if (input.images && input.images.length > 0) {
                    const errorMsg = 'Image input is not supported in CodeBuddy CLI mode.';
                    this.broadcast('agent:error', errorMsg);
                    throw new Error(errorMsg);
                }
            }

            // Add user message to history
            this.history.push({ role: 'user', content: userContent });
            this.notifyUpdate();

            // Execute codebuddy command
            await this.executeCodeBuddy(userContent);

        } catch (error: unknown) {
            const err = error as { message?: string };
            console.error('CLI Agent Error:', error);
            this.broadcast('agent:error', err.message || 'An unknown error occurred');
        } finally {
            this.isProcessing = false;
            this.notifyUpdate();
        }
    }

    private async executeCodeBuddy(userMessage: string) {
        const authorizedFolders = permissionManager.getAuthorizedFolders();
        const workingDir = authorizedFolders[0] || process.cwd();

        // Build codebuddy command with arguments
        // The command structure is similar to: codebuddy --message "user message" --directory "working dir"
        const args: string[] = [];
        
        // Add working directory
        if (workingDir) {
            args.push('--directory', workingDir);
        }

        // Add API key if available (some CLI tools support it)
        const apiKey = configStore.getApiKey();
        if (apiKey) {
            args.push('--api-key', apiKey);
        }

        // Add model if specified
        const model = configStore.getModel();
        if (model) {
            args.push('--model', model);
        }

        // Add the user message
        args.push('--message', userMessage);

        // Redact API key for logging
        const logArgs = args.map((arg, idx) => {
            if (args[idx - 1] === '--api-key') {
                return '***REDACTED***';
            }
            return arg.includes(' ') ? `"${arg}"` : arg;
        });

        console.log(`[CLIAgentRuntime] Executing: codebuddy ${logArgs.join(' ')}`);

        // Add an empty assistant message to history immediately
        // This ensures the UI shows the message structure during streaming
        const assistantMessageIndex = this.history.length;
        this.history.push({
            role: 'assistant',
            content: ''
        });
        this.notifyUpdate();

        return new Promise<void>((resolve, reject) => {
            this.currentProcess = spawn('codebuddy', args, {
                cwd: workingDir,
                shell: false, // Use shell: false for better security
                env: {
                    ...process.env,
                    // Note: Using both --api-key flag and CODEBUDDY_API_KEY env var
                    // for maximum compatibility with different codebuddy implementations
                    CODEBUDDY_API_KEY: apiKey || process.env.ANTHROPIC_API_KEY || '',
                }
            });

            let stdoutBuffer = '';
            let stderrBuffer = '';

            this.currentProcess.stdout?.on('data', (data) => {
                const text = data.toString();
                stdoutBuffer += text;
                
                // Stream output token by token to UI
                // The UI will accumulate these tokens in a streaming display
                this.broadcast('agent:stream-token', text);
                console.log('[CodeBuddy]:', text);
            });

            this.currentProcess.stderr?.on('data', (data) => {
                const text = data.toString();
                stderrBuffer += text;
                console.error('[CodeBuddy Error]:', text);
            });

            this.currentProcess.on('close', (code) => {
                if (code === 0) {
                    // Success - update final assistant response in history
                    this.history[assistantMessageIndex] = {
                        role: 'assistant',
                        content: stdoutBuffer || 'Command executed successfully.'
                    };
                    this.notifyUpdate();
                    resolve();
                } else {
                    // Error - remove the empty assistant message and show error
                    this.history.splice(assistantMessageIndex, 1);
                    const errorMessage = stderrBuffer || `CodeBuddy process exited with code ${code}`;
                    this.broadcast('agent:error', errorMessage);
                    this.notifyUpdate();
                    reject(new Error(errorMessage));
                }
                this.currentProcess = null;
            });

            this.currentProcess.on('error', (err) => {
                console.error('[CodeBuddy Process Error]:', err);
                // Remove the empty assistant message on error
                this.history.splice(assistantMessageIndex, 1);
                this.broadcast('agent:error', `Failed to start CodeBuddy: ${err.message}`);
                this.notifyUpdate();
                this.currentProcess = null;
                reject(err);
            });
        });
    }

    private broadcast(channel: string, data: unknown) {
        for (const win of this.windows) {
            if (!win.isDestroyed()) {
                win.webContents.send(channel, data);
            }
        }
    }

    private notifyUpdate() {
        this.broadcast('agent:history-update', this.history);
    }

    public handleConfirmResponseWithRemember(id: string, approved: boolean, _remember: boolean): void {
        const pending = this.pendingConfirmations.get(id);
        if (pending) {
            pending.resolve(approved);
            this.pendingConfirmations.delete(id);
        }
    }

    public abort() {
        if (this.currentProcess) {
            this.currentProcess.kill();
            this.currentProcess = null;
        }
    }
}
