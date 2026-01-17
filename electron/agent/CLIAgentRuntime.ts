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

// CLI stream-json 输出的消息类型
interface CLIStreamMessage {
    type: 'system' | 'assistant' | 'user' | 'result';
    subtype?: string;
    uuid?: string;
    session_id?: string;
    message?: {
        content: Array<{
            type: string;
            text?: string;
            id?: string;
            name?: string;
            input?: Record<string, unknown>;
            tool_use_id?: string;
            content?: Array<{ type: string; text: string }>;
        }>;
    };
    result?: string;
    is_error?: boolean;
    error_message?: string;
    error?: string;
}

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
        console.log('[CLIAgentRuntime] Initializing CodeBuddy CLI...');
        console.log('[CLIAgentRuntime] CODEBUDDY_API_KEY:', process.env.CODEBUDDY_API_KEY ? '***' + process.env.CODEBUDDY_API_KEY.slice(-8) : 'NOT SET');
        console.log('[CLIAgentRuntime] CODEBUDDY_INTERNET_ENVIRONMENT:', process.env.CODEBUDDY_INTERNET_ENVIRONMENT || 'NOT SET');
        
        // Check if codebuddy is available
        try {
            const testProcess = spawn('codebuddy', ['--version'], { 
                shell: true,
                env: { ...process.env, PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin' }
            });
            testProcess.on('error', (err) => {
                console.error('[CLIAgentRuntime] CodeBuddy CLI not found:', err);
                this.broadcast('agent:error', 
                    'CodeBuddy CLI is not installed or not in PATH. ' +
                    'Please install it by following the instructions at the CodeBuddy documentation. ' +
                    'After installation, make sure the "codebuddy" command is available in your system PATH.'
                );
            });
            testProcess.on('close', (code) => {
                if (code === 0) {
                    console.log('[CLIAgentRuntime] CodeBuddy CLI is available');
                } else {
                    console.warn('[CLIAgentRuntime] CodeBuddy CLI check returned non-zero exit code:', code);
                }
            });
        } catch (error) {
            console.error('[CLIAgentRuntime] Failed to check CodeBuddy CLI:', error);
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

    private removeMessageFromHistory(message: Anthropic.MessageParam) {
        const idx = this.history.indexOf(message);
        if (idx !== -1) {
            this.history.splice(idx, 1);
        }
    }

    private async executeCodeBuddy(userMessage: string) {
        const authorizedFolders = permissionManager.getAuthorizedFolders();
        if (authorizedFolders.length === 0) {
            const errorMsg = '请先选择工作目录。点击左下角的文件夹图标选择一个项目目录。';
            console.error('[CLIAgentRuntime] No working directory configured');
            this.history.push({
                role: 'assistant',
                content: errorMsg
            });
            this.notifyUpdate();
            this.broadcast('agent:complete', null);
            this.isProcessing = false;
            return;
        }
        const workingDir = authorizedFolders[0];

        // Build codebuddy command with arguments
        // CodeBuddy CLI usage: codebuddy -p --output-format stream-json --permission-mode bypassPermissions [--model MODEL] [prompt]
        const args: string[] = [];
        
        // Use print mode for non-interactive output
        args.push('-p');
        
        // Use stream-json format to get structured output with tool calls
        args.push('--output-format', 'stream-json');
        
        // Use permission mode to bypass permissions for automated use
        args.push('--permission-mode', 'bypassPermissions');

        // Add model if specified (format: claude-opus-4.5, claude-sonnet-4-20250514, etc.)
        const model = configStore.getModel();
        if (model) {
            args.push('--model', model);
        }

        // Add the user message as the prompt (must be last)
        args.push(userMessage);

        // Log the command (without sensitive info)
        const logArgs = args.map(arg => arg.includes(' ') ? `"${arg}"` : arg);
        console.log(`[CLIAgentRuntime] Executing: codebuddy ${logArgs.join(' ')}`);
        console.log(`[CLIAgentRuntime] Working directory: ${workingDir}`);

        // Add an empty assistant message to history immediately
        // This ensures the UI shows the message structure during streaming
        const assistantMessage: Anthropic.MessageParam = {
            role: 'assistant',
            content: ''
        };
        this.history.push(assistantMessage);
        this.notifyUpdate();

        return new Promise<void>((resolve, reject) => {
            // For CLI mode, let CLI use its own credentials from ~/.codebuddy/
            // Do NOT override with app settings - CLI has its own authentication system
            
            // Build env - inherit from process.env to preserve HOME, PATH, etc.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const env: Record<string, any> = {
                ...process.env,
                PATH: `${process.env.PATH || ''}:/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin:${process.env.HOME}/.nvm/versions/node/v22.15.1/bin`,
            };
            
            // IMPORTANT: Do NOT set CODEBUDDY_API_KEY for CLI mode
            // The CLI uses its own authentication from ~/.codebuddy/.credentials.json
            // Setting this env var interferes with CLI's built-in auth
            console.log('[CLIAgentRuntime] Using CLI native authentication from ~/.codebuddy/');
            
            // Remove any existing CODEBUDDY_API_KEY to ensure CLI uses its own config
            delete env.CODEBUDDY_API_KEY;
            
            // Also don't override internet environment - let CLI use its config
            delete env.CODEBUDDY_INTERNET_ENVIRONMENT;
            
            console.log('[CLIAgentRuntime] Environment:');
            console.log('[CLIAgentRuntime] HOME:', env.HOME);
            console.log('[CLIAgentRuntime] CODEBUDDY_API_KEY: NOT SET (using CLI native auth)');
            console.log('[CLIAgentRuntime] CODEBUDDY_INTERNET_ENVIRONMENT: NOT SET (using CLI config)');

            this.currentProcess = spawn('codebuddy', args, {
                cwd: workingDir,
                shell: true, // Use shell: true to find codebuddy in PATH
                env: env as NodeJS.ProcessEnv
            });

            let jsonBuffer = '';
            let stderrBuffer = '';
            let finalResult = '';

            this.currentProcess.stdout?.on('data', (data) => {
                try {
                    const text = data.toString();
                    jsonBuffer += text;
                    
                    // Parse JSON messages line by line
                    const lines = jsonBuffer.split('\n');
                    jsonBuffer = lines.pop() || ''; // Keep incomplete line in buffer
                    
                    for (const line of lines) {
                        const trimmedLine = line.trim();
                        if (!trimmedLine || !trimmedLine.startsWith('{')) continue;
                        
                        try {
                            const msg = JSON.parse(trimmedLine) as CLIStreamMessage;
                            this.handleStreamMessage(msg);
                            
                            // Capture final result text
                            if (msg.type === 'result' && msg.result) {
                                finalResult = msg.result;
                            }
                        } catch (e) {
                            // Not valid JSON, might be partial or status indicator
                            console.log('[CLIAgentRuntime] Non-JSON output:', trimmedLine);
                        }
                    }
                } catch (err) {
                    console.error('[CLIAgentRuntime] Error processing stdout:', err);
                }
            });

            this.currentProcess.stderr?.on('data', (data) => {
                try {
                    const text = data.toString();
                    stderrBuffer += text;
                    console.error('[CodeBuddy Error]:', text);
                } catch (err) {
                    console.error('[CLIAgentRuntime] Error processing stderr:', err);
                }
            });

            this.currentProcess.on('close', (code) => {
                try {
                    // Process any remaining buffer
                    if (jsonBuffer.trim() && jsonBuffer.trim().startsWith('{')) {
                        try {
                            const msg = JSON.parse(jsonBuffer.trim()) as CLIStreamMessage;
                            this.handleStreamMessage(msg);
                            if (msg.type === 'result' && msg.result) {
                                finalResult = msg.result;
                            }
                        } catch (e) {
                            // Ignore parse errors for incomplete data
                        }
                    }

                    if (code === 0) {
                        // Success - update final assistant response in history
                        assistantMessage.content = finalResult || 'Command executed successfully.';
                        this.notifyUpdate();
                        resolve();
                    } else {
                        // Error - remove the empty assistant message and show error
                        this.removeMessageFromHistory(assistantMessage);
                        const errorMessage = stderrBuffer || `CodeBuddy process exited with code ${code}`;
                        this.broadcast('agent:error', errorMessage);
                        this.notifyUpdate();
                        reject(new Error(errorMessage));
                    }
                } catch (err) {
                    console.error('[CLIAgentRuntime] Error in close handler:', err);
                    reject(err);
                } finally {
                    this.currentProcess = null;
                }
            });

            this.currentProcess.on('error', (err) => {
                console.error('[CodeBuddy Process Error]:', err);
                // Remove the empty assistant message on error
                this.removeMessageFromHistory(assistantMessage);
                this.broadcast('agent:error', `Failed to start CodeBuddy: ${err.message}`);
                this.notifyUpdate();
                this.currentProcess = null;
                reject(err);
            });
        });
    }

    /**
     * Handle stream-json messages and broadcast progress to UI
     */
    private handleStreamMessage(msg: CLIStreamMessage) {
        try {
            console.log('[CLIAgentRuntime] Stream message:', msg.type, msg.subtype || '');
            
            // Print full message details for debugging errors
            if (msg.type === 'result' && (msg.subtype === 'error_during_execution' || msg.is_error)) {
                console.error('[CLIAgentRuntime] Error details:', JSON.stringify(msg, null, 2));
            }
            
            if (msg.type === 'system' && msg.subtype === 'init') {
                // System initialization - broadcast start
                this.broadcast('agent:cli-progress', {
                    type: 'init',
                    message: '正在初始化...',
                    model: (msg as unknown as { model?: string }).model
                });
            } else if (msg.type === 'assistant' && msg.message?.content) {
                // Process assistant message content
                for (const block of msg.message.content) {
                    if (block.type === 'tool_use' && block.name) {
                        // Tool call - broadcast progress
                        const toolName = block.name;
                        const input = block.input || {};
                        
                        let progressMessage = '';
                        switch (toolName) {
                            case 'Bash':
                                progressMessage = `执行命令: ${(input as { command?: string }).command || ''}`;
                                break;
                            case 'Read':
                                progressMessage = `读取文件: ${(input as { file_path?: string }).file_path || ''}`;
                                break;
                            case 'Write':
                                progressMessage = `写入文件: ${(input as { file_path?: string }).file_path || ''}`;
                                break;
                            case 'Edit':
                                progressMessage = `编辑文件: ${(input as { file_path?: string }).file_path || ''}`;
                                break;
                            case 'Glob':
                                progressMessage = `搜索文件: ${(input as { pattern?: string }).pattern || ''}`;
                                break;
                            case 'Grep':
                                progressMessage = `搜索内容: ${(input as { pattern?: string }).pattern || ''}`;
                                break;
                            case 'WebFetch':
                                progressMessage = `获取网页: ${(input as { url?: string }).url || ''}`;
                                break;
                            case 'WebSearch':
                                progressMessage = `搜索网页: ${(input as { query?: string }).query || ''}`;
                                break;
                            case 'Task':
                                progressMessage = `启动任务: ${(input as { description?: string }).description || ''}`;
                                break;
                            case 'TodoWrite':
                                progressMessage = '更新任务列表';
                                break;
                            default:
                                progressMessage = `调用工具: ${toolName}`;
                        }
                        
                        this.broadcast('agent:cli-progress', {
                            type: 'tool_use',
                            tool: toolName,
                            message: progressMessage,
                            input: input
                        });
                    } else if (block.type === 'text' && block.text) {
                        // Text content - stream to UI
                        this.broadcast('agent:stream-token', block.text);
                    }
                }
            } else if (msg.type === 'user' && msg.message?.content) {
                // Tool result - could show completion
                for (const block of msg.message.content) {
                    if (block.type === 'tool_result' && block.tool_use_id) {
                        this.broadcast('agent:cli-progress', {
                            type: 'tool_result',
                            message: '工具执行完成'
                        });
                    }
                }
            } else if (msg.type === 'result') {
                // Final result
                const errorMsg = msg.error_message || msg.error || msg.result;
                this.broadcast('agent:cli-progress', {
                    type: 'complete',
                    message: msg.is_error ? `错误: ${errorMsg}` : '执行完成',
                    is_error: msg.is_error
                });
                
                // If there's an error, also stream it to the UI
                if (msg.is_error && errorMsg) {
                    this.broadcast('agent:stream-token', `\n\n❌ 错误: ${errorMsg}`);
                }
            }
        } catch (err) {
            console.error('[CLIAgentRuntime] Error handling stream message:', err);
        }
    }

    private broadcast(channel: string, data: unknown) {
        try {
            // Filter out destroyed windows first
            this.windows = this.windows.filter(win => !win.isDestroyed());
            
            for (const win of this.windows) {
                try {
                    if (!win.isDestroyed() && win.webContents && !win.webContents.isDestroyed()) {
                        win.webContents.send(channel, data);
                    }
                } catch (err) {
                    console.error('[CLIAgentRuntime] Error sending to window:', err);
                }
            }
        } catch (err) {
            console.error('[CLIAgentRuntime] Error broadcasting:', err);
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