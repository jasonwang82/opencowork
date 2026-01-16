import { BrowserWindow } from 'electron';
import { query } from '@tencent-ai/agent-sdk';
import { permissionManager } from './security/PermissionManager';
import Anthropic from '@anthropic-ai/sdk';

export type AgentMessage = {
    role: 'user' | 'assistant';
    content: string | Anthropic.ContentBlock[];
    id?: string;
};

/**
 * CodeBuddySDKRuntime - Integration with CodeBuddy Agent SDK
 * 
 * This runtime uses the @tencent-ai/agent-sdk package to interact with
 * CodeBuddy AI service directly via SDK.
 */
export class CodeBuddySDKRuntime {
    private windows: BrowserWindow[] = [];
    private history: Anthropic.MessageParam[] = [];
    private isProcessing = false;
    private apiKey: string;
    private internetEnv: string;
    private currentQuery: ReturnType<typeof query> | null = null;
    private pendingConfirmations: Map<string, { resolve: (approved: boolean) => void }> = new Map();

    constructor(window: BrowserWindow, apiKey: string, internetEnv: string = '') {
        this.windows = [window];
        this.apiKey = apiKey;
        this.internetEnv = internetEnv;
        console.log('[CodeBuddySDKRuntime] Constructor called');
        console.log('[CodeBuddySDKRuntime] API Key:', apiKey ? '***' + apiKey.slice(-8) : 'NOT SET');
        console.log('[CodeBuddySDKRuntime] Internet Env:', internetEnv || 'NOT SET');
    }

    public addWindow(win: BrowserWindow) {
        if (!this.windows.includes(win)) {
            this.windows.push(win);
            console.log('[CodeBuddySDKRuntime] Window added, total:', this.windows.length);
        }
    }

    public removeWindow(win: BrowserWindow) {
        this.windows = this.windows.filter(w => w !== win);
        console.log('[CodeBuddySDKRuntime] Window removed, total:', this.windows.length);
    }

    public async initialize() {
        console.log('[CodeBuddySDKRuntime] Initializing...');
        console.log('[CodeBuddySDKRuntime] API Key set:', !!this.apiKey);
        console.log('[CodeBuddySDKRuntime] Internet Env:', this.internetEnv || 'default');
        console.log('[CodeBuddySDKRuntime] Ready to process messages');
    }

    public clearHistory() {
        this.history = [];
        console.log('[CodeBuddySDKRuntime] History cleared');
        this.notifyUpdate();
    }

    public loadHistory(messages: Anthropic.MessageParam[]) {
        this.history = messages;
        console.log('[CodeBuddySDKRuntime] History loaded, messages:', messages.length);
        this.notifyUpdate();
    }

    public handleConfirmResponse(id: string, approved: boolean) {
        console.log('[CodeBuddySDKRuntime] Confirm response:', id, approved);
        const pending = this.pendingConfirmations.get(id);
        if (pending) {
            pending.resolve(approved);
            this.pendingConfirmations.delete(id);
        }
    }

    public handleConfirmResponseWithRemember(id: string, approved: boolean, _remember: boolean) {
        this.handleConfirmResponse(id, approved);
    }

    public async processUserMessage(input: string | { content: string, images?: string[] }) {
        if (this.isProcessing) {
            console.log('[CodeBuddySDKRuntime] Already processing, rejecting new message');
            throw new Error('Agent is already processing a message');
        }

        this.isProcessing = true;
        let userContent = '';

        if (typeof input === 'string') {
            userContent = input;
        } else {
            userContent = input.content;
            if (input.images && input.images.length > 0) {
                console.log('[CodeBuddySDKRuntime] Warning: Images not supported in SDK mode');
                this.broadcast('agent:error', 'Image input is not supported in CodeBuddy SDK mode.');
            }
        }

        const truncatedContent = userContent.length > 100 ? userContent.substring(0, 100) + '...' : userContent;
        console.log('[CodeBuddySDKRuntime] Processing message:', truncatedContent);

        // 添加用户消息到历史
        this.history.push({ role: 'user', content: userContent });
        this.notifyUpdate();

        try {
            const authorizedFolders = permissionManager.getAuthorizedFolders();
            const workingDir = authorizedFolders[0] || process.cwd();
            console.log('[CodeBuddySDKRuntime] Working directory:', workingDir);
            console.log('[CodeBuddySDKRuntime] Starting query...');

            // 构建环境变量
            const env: Record<string, string> = {};
            if (this.apiKey) {
                env.CODEBUDDY_API_KEY = this.apiKey;
            }
            if (this.internetEnv) {
                env.CODEBUDDY_INTERNET_ENVIRONMENT = this.internetEnv;
            }

            console.log('[CodeBuddySDKRuntime] Query options:', {
                cwd: workingDir,
                permissionMode: 'bypassPermissions',
                hasApiKey: !!env.CODEBUDDY_API_KEY,
                internetEnv: env.CODEBUDDY_INTERNET_ENVIRONMENT || 'default'
            });

            const q = query({
                prompt: userContent,
                options: {
                    cwd: workingDir,
                    permissionMode: 'bypassPermissions',
                    env
                }
            });

            this.currentQuery = q;
            let fullResponse = '';
            let messageCount = 0;

            // 添加空的助手消息用于流式更新
            const assistantMessage: Anthropic.MessageParam = {
                role: 'assistant',
                content: ''
            };
            this.history.push(assistantMessage);
            this.notifyUpdate();

            for await (const message of q) {
                messageCount++;
                console.log(`[CodeBuddySDKRuntime] Message #${messageCount}, type:`, message.type);

                if (message.type === 'system') {
                    const systemData = message as { type: 'system'; session_id?: string; tools?: unknown[] };
                    console.log('[CodeBuddySDKRuntime] Session ID:', systemData.session_id);
                    console.log('[CodeBuddySDKRuntime] Tools available:', systemData.tools?.length || 0);
                }

                if (message.type === 'assistant') {
                    const assistantData = message as { 
                        type: 'assistant'; 
                        message?: { 
                            content?: Array<{
                                type: string;
                                text?: string;
                                name?: string;
                                input?: unknown;
                                content?: string;
                            }> 
                        } 
                    };
                    
                    if (assistantData.message?.content) {
                        for (const block of assistantData.message.content) {
                            if (block.type === 'text' && block.text) {
                                const textPreview = block.text.length > 50 ? block.text.substring(0, 50) + '...' : block.text;
                                console.log('[CodeBuddySDKRuntime] Text block:', textPreview);
                                fullResponse += block.text;
                                this.broadcast('agent:stream-token', block.text);
                            } else if (block.type === 'tool_use') {
                                console.log('[CodeBuddySDKRuntime] Tool use:', block.name);
                                const inputStr = JSON.stringify(block.input);
                                const inputPreview = inputStr.length > 100 ? inputStr.substring(0, 100) + '...' : inputStr;
                                console.log('[CodeBuddySDKRuntime] Tool input:', inputPreview);
                            } else if (block.type === 'tool_result') {
                                console.log('[CodeBuddySDKRuntime] Tool result received');
                            }
                        }
                    }
                }

                if (message.type === 'result') {
                    const resultData = message as { 
                        type: 'result'; 
                        subtype?: string; 
                        duration_ms?: number; 
                        total_cost_usd?: number 
                    };
                    console.log('[CodeBuddySDKRuntime] Result subtype:', resultData.subtype);
                    if (resultData.duration_ms) {
                        console.log('[CodeBuddySDKRuntime] Duration:', resultData.duration_ms, 'ms');
                    }
                    if (resultData.total_cost_usd) {
                        console.log('[CodeBuddySDKRuntime] Cost:', resultData.total_cost_usd, 'USD');
                    }
                }
            }

            // 更新助手回复
            assistantMessage.content = fullResponse || 'No response received.';
            console.log('[CodeBuddySDKRuntime] Query completed, total messages:', messageCount);
            console.log('[CodeBuddySDKRuntime] Response length:', fullResponse.length, 'chars');

        } catch (error: unknown) {
            const err = error as Error;
            console.error('[CodeBuddySDKRuntime] Error:', err.message);
            console.error('[CodeBuddySDKRuntime] Stack:', err.stack);
            
            // 移除空的助手消息
            if (this.history.length > 0 && this.history[this.history.length - 1].role === 'assistant') {
                const lastMsg = this.history[this.history.length - 1];
                if (!lastMsg.content || lastMsg.content === '') {
                    this.history.pop();
                }
            }
            
            this.broadcast('agent:error', err.message || 'Unknown error occurred');
        } finally {
            this.isProcessing = false;
            this.currentQuery = null;
            this.notifyUpdate();
            console.log('[CodeBuddySDKRuntime] Processing finished');
        }
    }

    public abort() {
        console.log('[CodeBuddySDKRuntime] Abort requested');
        if (this.currentQuery) {
            // SDK 的 query 返回的对象可能有 interrupt 方法
            const q = this.currentQuery as unknown as { interrupt?: () => void };
            if (typeof q.interrupt === 'function') {
                q.interrupt();
                console.log('[CodeBuddySDKRuntime] Query interrupted');
            }
        }
        this.isProcessing = false;
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
}
