import { BrowserWindow } from 'electron';
import { query } from '@tencent-ai/agent-sdk';
import { permissionManager } from './security/PermissionManager';
import { logger } from '../utils/logger';
import Anthropic from '@anthropic-ai/sdk';
import { execSync } from 'child_process';
import fs from 'fs';

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

    constructor(window: BrowserWindow, apiKey: string, internetEnv: string = 'ioa') {
        this.windows = [window];
        this.apiKey = apiKey;
        this.internetEnv = internetEnv || 'ioa';  // Default to 'ioa' for internal network
        console.log('[CodeBuddySDKRuntime] Constructor called');
        console.log('[CodeBuddySDKRuntime] API Key:', apiKey ? '***' + apiKey.slice(-8) : 'NOT SET');
        console.log('[CodeBuddySDKRuntime] Internet Env:', this.internetEnv);
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

    /**
     * Find a compatible Node.js version from nvm
     * Returns the bin path or null if not found
     */
    private findCompatibleNodePath(): string | null {
        try {
            const home = process.env.HOME || '';
            const nvmDir = `${home}/.nvm/versions/node`;
            
            // Check if nvm is installed
            if (fs.existsSync(nvmDir)) {
                const versions = fs.readdirSync(nvmDir).filter((v: string) => v.startsWith('v'));
                console.log('[CodeBuddySDKRuntime] Found nvm versions:', versions);
                
                // Sort versions in descending order (newest first)
                const sortedVersions = versions.sort((a: string, b: string) => {
                    const parseVersion = (v: string) => {
                        const match = v.match(/^v(\d+)\.(\d+)\.(\d+)$/);
                        if (!match) return [0, 0, 0];
                        return [parseInt(match[1]), parseInt(match[2]), parseInt(match[3])];
                    };
                    const [aMajor, aMinor, aPatch] = parseVersion(a);
                    const [bMajor, bMinor, bPatch] = parseVersion(b);
                    if (aMajor !== bMajor) return bMajor - aMajor;
                    if (aMinor !== bMinor) return bMinor - aMinor;
                    return bPatch - aPatch;
                });
                
                // Find a compatible version (v18.20.8+ or v20+ or v22+)
                for (const version of sortedVersions) {
                    const match = version.match(/^v(\d+)\.(\d+)\.(\d+)$/);
                    if (!match) continue;
                    
                    const major = parseInt(match[1]);
                    const minor = parseInt(match[2]);
                    const patch = parseInt(match[3]);
                    
                    // Check if version meets requirements
                    let compatible = false;
                    if (major >= 20) {
                        compatible = true;
                    } else if (major === 18) {
                        if (minor > 20) compatible = true;
                        else if (minor === 20 && patch >= 8) compatible = true;
                    }
                    
                    if (compatible) {
                        const binPath = `${nvmDir}/${version}/bin`;
                        if (fs.existsSync(binPath)) {
                            console.log(`[CodeBuddySDKRuntime] Using Node.js ${version} from: ${binPath}`);
                            return binPath;
                        }
                    }
                }
            }
            
            return null;
        } catch (e) {
            console.warn('[CodeBuddySDKRuntime] Failed to find compatible Node.js:', e);
            return null;
        }
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
            if (authorizedFolders.length === 0) {
                const errorMsg = '请先选择工作目录。点击左下角的文件夹图标选择一个项目目录。';
                console.error('[CodeBuddySDKRuntime] No working directory configured');
                logger.error('SDK: No working directory configured');
                this.history[this.history.length - 1] = {
                    role: 'assistant',
                    content: errorMsg
                };
                this.notifyUpdate();
                this.broadcast('agent:complete', null);
                this.isProcessing = false;
                return;
            }
            const workingDir = authorizedFolders[0];
            console.log('[CodeBuddySDKRuntime] Working directory:', workingDir);
            console.log('[CodeBuddySDKRuntime] Starting query...');

            // 构建环境变量
            const env: Record<string, string> = {
                // Ensure PATH includes common node binary locations
                PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin'
            };
            if (this.apiKey) {
                env.CODEBUDDY_API_KEY = this.apiKey;
            }
            if (this.internetEnv) {
                env.CODEBUDDY_INTERNET_ENVIRONMENT = this.internetEnv;
            }
            
            // Find compatible Node.js version from nvm
            const home = process.env.HOME || '';
            const compatibleNodePath = this.findCompatibleNodePath();
            const standardPaths = '/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin';
            const nvmPaths = `${home}/.nvm/versions/node/v22.15.1/bin:${home}/.nvm/versions/node/v20.19.1/bin:${home}/.nvm/versions/node/v18.20.8/bin`;
            const npmPaths = `${home}/.npm-global/bin:${home}/node_modules/.bin:/usr/local/lib/node_modules/.bin`;
            
            let extendedPath = process.env.PATH || '';
            
            if (compatibleNodePath) {
                extendedPath = `${compatibleNodePath}:${nvmPaths}:${npmPaths}:${extendedPath}:${standardPaths}`;
                console.log('[CodeBuddySDKRuntime] Using Node.js from:', compatibleNodePath);
                logger.info('SDK: Using compatible Node.js', { path: compatibleNodePath });
            } else {
                extendedPath = `${nvmPaths}:${npmPaths}:${extendedPath}:${standardPaths}`;
            }
            
            console.log('[CodeBuddySDKRuntime] Full PATH length:', extendedPath.length);
            
            // Set CODEBUDDY_CODE_PATH in process.env for SDK to find the CLI
            // The SDK reads from process.env directly, not from options.env
            let codebuddyPath: string | null = null;
            if (!process.env.CODEBUDDY_CODE_PATH) {
                try {
                    codebuddyPath = execSync('which codebuddy', { 
                        encoding: 'utf-8',
                        env: { ...process.env, PATH: extendedPath, HOME: home },
                        shell: '/bin/bash'
                    }).trim();
                    if (codebuddyPath) {
                        // Set in process.env so SDK can find it
                        process.env.CODEBUDDY_CODE_PATH = codebuddyPath;
                        process.env.PATH = extendedPath;
                        env.PATH = extendedPath;
                        console.log('[CodeBuddySDKRuntime] Set CODEBUDDY_CODE_PATH in process.env:', codebuddyPath);
                        logger.info('SDK: Found CodeBuddy CLI', { path: codebuddyPath });
                    }
                } catch (e) {
                    console.error('[CodeBuddySDKRuntime] Failed to find codebuddy:', e);
                    logger.error('SDK: Failed to find codebuddy CLI', { error: String(e), pathLength: extendedPath.length });
                    throw new Error('CodeBuddy CLI 未找到。请确保已安装：npm install -g @tencent-ai/codebuddy-code');
                }
            } else {
                codebuddyPath = process.env.CODEBUDDY_CODE_PATH;
                console.log('[CodeBuddySDKRuntime] Using existing CODEBUDDY_CODE_PATH:', codebuddyPath);
            }
            
            // Verify codebuddy CLI exists and is executable
            if (codebuddyPath) {
                try {
                    if (!fs.existsSync(codebuddyPath)) {
                        throw new Error(`CodeBuddy CLI 路径不存在: ${codebuddyPath}`);
                    }
                    // Try to verify it's executable by checking version
                    try {
                        execSync(`"${codebuddyPath}" --version`, { 
                            encoding: 'utf-8',
                            timeout: 5000,
                            env: { ...process.env, PATH: env.PATH }
                        });
                        console.log('[CodeBuddySDKRuntime] CodeBuddy CLI verified');
                    } catch (verifyErr) {
                        logger.warn('SDK: CodeBuddy CLI version check failed', { error: String(verifyErr) });
                        // Don't throw, just log warning - SDK will handle it
                    }
                } catch (fsErr) {
                    logger.error('SDK: CodeBuddy CLI path verification failed', { error: String(fsErr), path: codebuddyPath });
                    throw new Error(`CodeBuddy CLI 验证失败: ${fsErr instanceof Error ? fsErr.message : String(fsErr)}`);
                }
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

            try {
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
            } catch (iteratorError: unknown) {
                // Handle iterator/transport errors separately
                const iterErr = iteratorError as Error;
                console.error('[CodeBuddySDKRuntime] Iterator/Transport error:', iterErr.message);
                logger.error('SDK Transport Error', { 
                    error: iterErr.message, 
                    name: iterErr.name,
                    messageCount,
                    hasResponse: fullResponse.length > 0
                });
                
                // If we got some response before the error, keep it
                if (fullResponse.length > 0) {
                    assistantMessage.content = fullResponse;
                    console.log('[CodeBuddySDKRuntime] Partial response saved, length:', fullResponse.length);
                } else {
                    // No response received, this is a connection failure
                    throw new Error(`连接中断: ${iterErr.message}. 请检查 CodeBuddy CLI 是否正常运行。`);
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
            
            // Provide user-friendly error messages
            let userMessage = err.message || '未知错误';
            if (err.message.includes('Transport closed') || err.message.includes('连接中断')) {
                userMessage = 'CodeBuddy CLI 连接中断。可能的原因：\n' +
                    '1. CodeBuddy CLI 进程意外退出\n' +
                    '2. 网络连接问题\n' +
                    '3. API Key 配置错误\n\n' +
                    '请检查：\n' +
                    '- CodeBuddy CLI 是否正确安装（运行 codebuddy --version）\n' +
                    '- API Key 是否正确配置\n' +
                    '- 网络环境是否正常';
            } else if (err.message.includes('CLI not found') || err.message.includes('codebuddy')) {
                userMessage = 'CodeBuddy CLI 未找到。请确保已安装 CodeBuddy CLI：\n' +
                    'npm install -g @tencent-ai/codebuddy-code';
            }
            
            logger.error('SDK Agent Error', { 
                error: err.message, 
                name: err.name,
                userMessage,
                stack: err.stack?.split('\n').slice(0, 5).join('\n')
            });
            
            // 移除空的助手消息
            if (this.history.length > 0 && this.history[this.history.length - 1].role === 'assistant') {
                const lastMsg = this.history[this.history.length - 1];
                if (!lastMsg.content || lastMsg.content === '') {
                    this.history.pop();
                } else {
                    // If there's partial content, update it with error message
                    lastMsg.content = (typeof lastMsg.content === 'string' ? lastMsg.content : '') + 
                        '\n\n[错误] ' + userMessage;
                }
            } else {
                // Add error message to history if no assistant message exists
                this.history.push({
                    role: 'assistant',
                    content: '[错误] ' + userMessage
                });
            }
            
            this.broadcast('agent:error', userMessage);
        } finally {
            this.isProcessing = false;
            this.currentQuery = null;
            this.notifyUpdate();
            this.broadcast('agent:complete', null);
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

    // Get a copy of the current history
    public getHistory(): Anthropic.MessageParam[] {
        return [...this.history];
    }

    // Cleanup resources when switching sessions
    public cleanup(): void {
        this.abort();
        this.history = [];
        this.pendingConfirmations.clear();
        this.isProcessing = false;
        this.currentQuery = null;
    }
}
