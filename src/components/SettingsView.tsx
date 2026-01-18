import { useState, useEffect, useCallback } from 'react';
import { X, Settings, FolderOpen, Server, Check, Plus, Trash2, Edit2, Zap, Eye, FileText, Download, RefreshCw, Package, Loader2, LogOut, LogIn, User } from 'lucide-react';
import { SkillEditor } from './SkillEditor';
import { useI18n } from '../i18n/useI18n';
import type { IntegrationMode } from '../../electron/config/ConfigStore';
import type { UserInfo } from '../App';

interface SettingsViewProps {
    onClose: () => void;
    userInfo?: UserInfo | null;
    onUserInfoChange?: (userInfo: UserInfo | null) => void;
}

interface Config {
    apiKey: string;
    apiUrl: string;
    model: string;
    authorizedFolders: string[];
    networkAccess: boolean;
    shortcut: string;
    integrationMode: IntegrationMode;
    codeBuddyApiKey: string;
    codeBuddyInternetEnv: string;
}

interface SkillInfo {
    id: string;
    name: string;
    path: string;
    isBuiltin: boolean;
}

interface ToolPermission {
    tool: string;
    pathPattern?: string;
    grantedAt: number;
}

export function SettingsView({ onClose, userInfo, onUserInfoChange }: SettingsViewProps) {
    useI18n(); // Hook for i18n context
    const [config, setConfig] = useState<Config>({
        apiKey: '',
        apiUrl: 'https://api.minimaxi.com/anthropic',
        model: 'MiniMax-M2.1',
        authorizedFolders: [],
        networkAccess: false,
        shortcut: 'Alt+Space',
        integrationMode: 'sdk-codebuddy',  // Default to SDK mode
        codeBuddyApiKey: '',
        codeBuddyInternetEnv: 'ioa'
    });
    const [saved, setSaved] = useState(false);
    const [activeTab, setActiveTab] = useState<'api' | 'folders' | 'mcp' | 'skills' | 'plugins' | 'advanced' | 'logs'>('api');
    const [isRecordingShortcut, setIsRecordingShortcut] = useState(false);
    const [isLoggingIn, setIsLoggingIn] = useState(false);
    const [isLoginPending, setIsLoginPending] = useState(false);
    const [isLoggingOut, setIsLoggingOut] = useState(false);
    const [loginError, setLoginError] = useState<string | null>(null);

    // Plugins State
    const [pluginSource, setPluginSource] = useState('');
    const [pluginLoading, setPluginLoading] = useState(false);
    const [pluginStatus, setPluginStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
    const [installedMarketplaces, setInstalledMarketplaces] = useState<string>('');
    const [builtinLoading, setBuiltinLoading] = useState<Record<string, boolean>>({});

    const BUILTIN_MARKETPLACES = [
        { id: 'anthropics/claude-code', name: 'Claude Code', description: 'Official Claude Code plugins' },
        { id: 'anthropics/skills', name: 'Skills', description: 'Official AI skills library' },
        { id: 'anthropics/claude-plugins-official', name: 'Claude Plugins', description: 'Official Claude plugins collection' },
    ];

    // Logs State
    interface LogEntry {
        timestamp: string;
        level: string;
        message: string;
        data?: unknown;
    }
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [logsLoading, setLogsLoading] = useState(false);

    // MCP State
    const [mcpConfig, setMcpConfig] = useState('');
    const [mcpSaved, setMcpSaved] = useState(false);

    // Skills State
    const [skills, setSkills] = useState<SkillInfo[]>([]);
    const [editingSkill, setEditingSkill] = useState<string | null>(null);
    const [viewingSkill, setViewingSkill] = useState<boolean>(false); // New state for read-only mode
    const [showSkillEditor, setShowSkillEditor] = useState(false);
    const [isImportingSkills, setIsImportingSkills] = useState(false);
    const [importSkillsStatus, setImportSkillsStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

    // Permissions State
    const [permissions, setPermissions] = useState<ToolPermission[]>([]);

    // Command Blacklist State
    const [blacklist, setBlacklist] = useState<string[]>([]);
    const [newBlacklistCommand, setNewBlacklistCommand] = useState('');

    const loadPermissions = () => {
        window.ipcRenderer.invoke('permissions:list').then(list => setPermissions(list as ToolPermission[]));
    };

    const loadBlacklist = () => {
        window.ipcRenderer.invoke('blacklist:get').then(list => setBlacklist(list as string[]));
    };

    const addToBlacklist = async () => {
        const command = newBlacklistCommand.trim();
        if (!command) return;
        await window.ipcRenderer.invoke('blacklist:add', command);
        setNewBlacklistCommand('');
        loadBlacklist();
    };

    const removeFromBlacklist = async (command: string) => {
        await window.ipcRenderer.invoke('blacklist:remove', command);
        loadBlacklist();
    };

    const resetBlacklist = async () => {
        if (confirm('确定要恢复默认黑名单吗？')) {
            await window.ipcRenderer.invoke('blacklist:reset');
            loadBlacklist();
        }
    };

    // Log functions
    const loadLogs = useCallback(async () => {
        setLogsLoading(true);
        try {
            const logData = await window.ipcRenderer.invoke('logs:get-all');
            setLogs((logData as LogEntry[]) || []);
        } catch (e) {
            console.error('Failed to load logs:', e);
        } finally {
            setLogsLoading(false);
        }
    }, []);

    const clearLogs = async () => {
        if (confirm('确定要清除所有日志吗？')) {
            await window.ipcRenderer.invoke('logs:clear');
            loadLogs();
        }
    };

    const exportLogs = async () => {
        const result = await window.ipcRenderer.invoke('logs:export');
        if ((result as { success: boolean }).success) {
            alert('日志已导出');
        }
    };

    const revokePermission = async (tool: string, pathPattern?: string) => {
        await window.ipcRenderer.invoke('permissions:revoke', { tool, pathPattern });
        loadPermissions();
    };

    const clearAllPermissions = async () => {
        if (confirm('确定要清除所有已授权的权限吗？')) {
            await window.ipcRenderer.invoke('permissions:clear');
            loadPermissions();
        }
    };

    useEffect(() => {
        window.ipcRenderer.invoke('config:get-all').then((cfg) => {
            if (cfg) setConfig(cfg as Config);
        });
    }, []);

    // Listen for login pending state (waiting for browser authentication)
    useEffect(() => {
        const removeLoginPendingListener = window.ipcRenderer.on('auth:login-pending', () => {
            setIsLoginPending(true);
        });

        const removeUserChangedListener = window.ipcRenderer.on('auth:user-changed', (_event, ...args) => {
            const newUserInfo = args[0] as UserInfo | null;
            onUserInfoChange?.(newUserInfo);
            setIsLoginPending(false);
        });

        const removeLoginFailedListener = window.ipcRenderer.on('auth:login-failed', () => {
            setIsLoginPending(false);
        });

        return () => {
            removeLoginPendingListener?.();
            removeUserChangedListener?.();
            removeLoginFailedListener?.();
        };
    }, [onUserInfoChange]);

    const loadPluginMarketplaces = useCallback(async () => {
        try {
            const result = await window.ipcRenderer.invoke('plugin:marketplace-list') as { success: boolean; marketplaces?: string; error?: string };
            if (result.success && result.marketplaces) {
                setInstalledMarketplaces(result.marketplaces);
            }
        } catch (e) {
            console.error('Failed to load plugin marketplaces:', e);
        }
    }, []);

    useEffect(() => {
        if (activeTab === 'mcp') {
            window.ipcRenderer.invoke('mcp:get-config').then(cfg => setMcpConfig(cfg as string));
        } else if (activeTab === 'skills') {
            refreshSkills();
        } else if (activeTab === 'plugins') {
            loadPluginMarketplaces();
        } else if (activeTab === 'advanced') {
            loadPermissions();
            loadBlacklist();
        } else if (activeTab === 'logs') {
            loadLogs();
        }
    }, [activeTab, loadLogs, loadPluginMarketplaces]);

    // Shortcut recording handler
    const handleShortcutKeyDown = (e: React.KeyboardEvent) => {
        e.preventDefault();
        e.stopPropagation();

        const parts: string[] = [];
        if (e.ctrlKey) parts.push('Ctrl');
        if (e.altKey) parts.push('Alt');
        if (e.shiftKey) parts.push('Shift');
        if (e.metaKey) parts.push('Meta');

        // Add the actual key (filter out modifier keys)
        const key = e.key;
        if (!['Control', 'Alt', 'Shift', 'Meta'].includes(key)) {
            // Normalize key names
            const normalizedKey = key === ' ' ? 'Space' : key.length === 1 ? key.toUpperCase() : key;
            parts.push(normalizedKey);
        }

        // Allow single function keys (F1-F12) or modifier + key combinations
        const isFunctionKey = /^F\d{1,2}$/.test(parts[parts.length - 1] || '');
        if (parts.length >= 1 && (isFunctionKey || parts.length >= 2)) {
            const newShortcut = parts.join('+');
            setConfig({ ...config, shortcut: newShortcut });
            setIsRecordingShortcut(false);
            // Update the global shortcut via IPC
            window.ipcRenderer.invoke('shortcut:update', newShortcut);
        }
    };

    const refreshSkills = () => {
        window.ipcRenderer.invoke('skills:list').then(list => setSkills(list as SkillInfo[]));
    };

    const handleImportSkills = async () => {
        setIsImportingSkills(true);
        setImportSkillsStatus(null);

        try {
            const result = await window.ipcRenderer.invoke('skills:import-official') as {
                success: boolean;
                message?: string;
                error?: string;
                extractedCount?: number;
                skippedCount?: number;
            };

            if (result.success) {
                setImportSkillsStatus({
                    type: 'success',
                    message: result.message || `成功导入 ${result.extractedCount || 0} 个技能${result.skippedCount ? `，跳过 ${result.skippedCount} 个已存在项` : ''}`
                });
                // Refresh skills list
                refreshSkills();
            } else {
                setImportSkillsStatus({
                    type: 'error',
                    message: result.error || '导入失败'
                });
            }
        } catch (e) {
            setImportSkillsStatus({
                type: 'error',
                message: `导入失败: ${(e as Error).message}`
            });
        } finally {
            setIsImportingSkills(false);
        }
    };

    const handleSave = async () => {
        await window.ipcRenderer.invoke('config:set-all', config);
        setSaved(true);
        setTimeout(() => {
            setSaved(false);
            onClose();
        }, 800);
    };

    const saveMcpConfig = async () => {
        try {
            // Validate JSON
            JSON.parse(mcpConfig);
            await window.ipcRenderer.invoke('mcp:save-config', mcpConfig);
            setMcpSaved(true);
            setTimeout(() => setMcpSaved(false), 2000);
        } catch (e) {
            alert('Invalid JSON configuration');
        }
    };

    const deleteSkill = async (filename: string) => {
        if (confirm(`确定要删除技能 "${filename}" 吗？`)) {
            await window.ipcRenderer.invoke('skills:delete', filename);
            refreshSkills();
        }
    };

    const handleAddMarketplace = async () => {
        const source = pluginSource.trim();
        if (!source) return;

        setPluginLoading(true);
        setPluginStatus(null);

        try {
            const result = await window.ipcRenderer.invoke('plugin:marketplace-add', source) as { success: boolean; output?: string; error?: string };
            if (result.success) {
                setPluginStatus({ type: 'success', message: `插件市场添加成功！${result.output || ''}` });
                setPluginSource('');
                loadPluginMarketplaces();
            } else {
                setPluginStatus({ type: 'error', message: `添加失败: ${result.error || '请检查输入格式'}` });
            }
        } catch (e) {
            setPluginStatus({ type: 'error', message: `添加失败: ${(e as Error).message}` });
        } finally {
            setPluginLoading(false);
        }
    };

    const handleBuiltinMarketplace = async (marketId: string, isInstalled: boolean) => {
        setBuiltinLoading(prev => ({ ...prev, [marketId]: true }));
        setPluginStatus(null);

        try {
            const action = isInstalled ? 'plugin:marketplace-remove' : 'plugin:marketplace-add';
            const result = await window.ipcRenderer.invoke(action, marketId) as { success: boolean; output?: string; error?: string };
            
            if (result.success) {
                setPluginStatus({ 
                    type: 'success', 
                    message: isInstalled ? `已移除 ${marketId}` : `已安装 ${marketId}` 
                });
                loadPluginMarketplaces();
            } else {
                setPluginStatus({ type: 'error', message: `操作失败: ${result.error || '未知错误'}` });
            }
        } catch (e) {
            setPluginStatus({ type: 'error', message: `操作失败: ${(e as Error).message}` });
        } finally {
            setBuiltinLoading(prev => ({ ...prev, [marketId]: false }));
        }
    };

    const addFolder = async () => {
        const result = await window.ipcRenderer.invoke('dialog:select-folder') as string | null;
        if (result && !config.authorizedFolders.includes(result)) {
            setConfig({ ...config, authorizedFolders: [...config.authorizedFolders, result] });
        }
    };

    const removeFolder = (folder: string) => {
        setConfig({ ...config, authorizedFolders: config.authorizedFolders.filter(f => f !== folder) });
    };

    return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-stone-100 shrink-0">
                    <h2 className="text-lg font-semibold text-stone-800">设置</h2>
                    <div className="flex items-center gap-2">
                        {activeTab === 'api' || activeTab === 'folders' || activeTab === 'advanced' ? (
                            <button
                                onClick={handleSave}
                                disabled={saved}
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${saved
                                    ? 'bg-green-100 text-green-600'
                                    : 'bg-brand-500 text-white hover:bg-brand-600'
                                    }`}
                            >
                                {saved ? <Check size={14} /> : null}
                                {saved ? '已保存' : '保存'}
                            </button>
                        ) : null}
                        <button
                            onClick={onClose}
                            className="p-1.5 text-stone-400 hover:text-stone-600 hover:bg-stone-100 rounded-lg transition-colors"
                        >
                            <X size={18} />
                        </button>
                    </div>
                </div>

                {/* Tabs */}
                <div className="flex border-b border-stone-100 overflow-x-auto shrink-0">
                    {[
                        { id: 'api' as const, label: '通用', icon: <Settings size={14} /> },
                        { id: 'folders' as const, label: '权限', icon: <FolderOpen size={14} /> },
                        { id: 'mcp' as const, label: 'MCP', icon: <Server size={14} /> },
                        { id: 'skills' as const, label: 'Skills', icon: <Zap size={14} /> },
                        { id: 'plugins' as const, label: '插件', icon: <Package size={14} /> },
                        { id: 'advanced' as const, label: '高级', icon: <Settings size={14} /> },
                        { id: 'logs' as const, label: '日志', icon: <FileText size={14} /> },
                    ].map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors whitespace-nowrap ${activeTab === tab.id
                                ? 'text-brand-500 border-b-2 border-brand-500 bg-brand-50/50'
                                : 'text-stone-500 hover:text-stone-700 hover:bg-stone-50'
                                }`}
                        >
                            {/*tab.icon*/}
                            {tab.label}
                        </button>
                    ))}
                </div>

                {/* Content */}
                <div className="p-0 overflow-y-auto flex-1 bg-stone-50/30">
                    <div className="p-5 space-y-5">
                        {activeTab === 'api' && (
                            <>
                                {/* Account Section */}
                                <div className="space-y-4">
                                    <div>
                                        <label className="block text-xs font-medium text-stone-500 mb-3">账号</label>
                                        
                                        {userInfo ? (
                                            // Logged in state
                                            <div className="bg-white border border-stone-200 rounded-lg p-4 space-y-3">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-12 h-12 rounded-full bg-brand-100 flex items-center justify-center">
                                                        <User size={24} className="text-brand-600" />
                                                    </div>
                                                    <div className="flex-1">
                                                        <p className="text-sm font-medium text-stone-800">
                                                            {userInfo.userNickname}
                                                        </p>
                                                        <p className="text-xs text-stone-400">
                                                            {userInfo.userName}
                                                            {userInfo.enterprise && ` @ ${userInfo.enterprise}`}
                                                        </p>
                                                    </div>
                                                </div>
                                                <button
                                                    onClick={async () => {
                                                        setIsLoggingOut(true);
                                                        try {
                                                            await window.ipcRenderer.invoke('auth:logout');
                                                            onUserInfoChange?.(null);
                                                        } catch (err) {
                                                            console.error('Logout failed:', err);
                                                        } finally {
                                                            setIsLoggingOut(false);
                                                        }
                                                    }}
                                                    disabled={isLoggingOut}
                                                    className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors disabled:opacity-50"
                                                >
                                                    {isLoggingOut ? (
                                                        <Loader2 size={16} className="animate-spin" />
                                                    ) : (
                                                        <LogOut size={16} />
                                                    )}
                                                    {isLoggingOut ? '正在登出...' : '登出'}
                                                </button>
                                            </div>
                                        ) : (
                                            // Not logged in state
                                            <div className="bg-white border border-stone-200 rounded-lg p-4 space-y-3">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-12 h-12 rounded-full bg-stone-100 flex items-center justify-center">
                                                        <User size={24} className="text-stone-400" />
                                                    </div>
                                                    <div className="flex-1">
                                                        <p className="text-sm font-medium text-stone-600">
                                                            未登录
                                                        </p>
                                                        <p className="text-xs text-stone-400">
                                                            登录后可使用完整功能
                                                        </p>
                                                    </div>
                                                </div>
                                                {isLoginPending ? (
                                                    <div className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm text-stone-600 bg-stone-50 rounded-lg">
                                                        <Loader2 size={16} className="animate-spin text-brand-500" />
                                                        <span>正在登录中，请在浏览器中完成认证...</span>
                                                    </div>
                                                ) : (
                                                    <>
                                                        <button
                                                            onClick={async () => {
                                                                setIsLoggingIn(true);
                                                                try {
                                                                    const result = await window.ipcRenderer.invoke('auth:login') as { 
                                                                        success: boolean; 
                                                                        userInfo?: UserInfo; 
                                                                        error?: string 
                                                                    };
                                                                    // Note: auth:login will trigger auth:login-pending event
                                                                    // and then auth:user-changed when complete
                                                                    // We don't need to set userInfo here as it's handled by listeners
                                                                    if (!result.success && result.error) {
                                                                        setIsLoginPending(false);
                                                                        setLoginError(result.error);
                                                                    }
                                                                } catch (err) {
                                                                    setIsLoginPending(false);
                                                                    console.error('Login failed:', err);
                                                                    setLoginError((err as Error).message);
                                                                } finally {
                                                                    setIsLoggingIn(false);
                                                                }
                                                            }}
                                                            disabled={isLoggingIn}
                                                            className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-white bg-brand-500 hover:bg-brand-600 rounded-lg transition-colors disabled:opacity-50"
                                                        >
                                                            {isLoggingIn ? (
                                                                <Loader2 size={16} className="animate-spin" />
                                                            ) : (
                                                                <LogIn size={16} />
                                                            )}
                                                            {isLoggingIn ? '正在启动...' : '登录'}
                                                        </button>
                                                        <p className="text-[10px] text-stone-400 text-center">
                                                            点击登录后将在浏览器中完成认证
                                                        </p>
                                                    </>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </>
                        )}

                        {activeTab === 'folders' && (
                            <>
                                <div className="bg-blue-50 text-blue-700 rounded-lg p-3 text-xs">
                                    出于安全考虑，AI 只能访问以下授权的文件夹及其子文件夹。
                                </div>

                                {config.authorizedFolders.length === 0 ? (
                                    <div className="text-center py-8 text-stone-400 border-2 border-dashed border-stone-200 rounded-xl">
                                        <p className="text-sm">暂无授权文件夹</p>
                                    </div>
                                ) : (
                                    <div className="space-y-2">
                                        {config.authorizedFolders.map((folder, idx) => (
                                            <div
                                                key={idx}
                                                className="flex items-center justify-between p-3 bg-white border border-stone-200 rounded-lg group"
                                            >
                                                <div className="flex items-center gap-3 overflow-hidden">
                                                    <FolderOpen size={16} className="text-stone-400 shrink-0" />
                                                    <span className="text-sm font-mono text-stone-600 truncate">
                                                        {folder}
                                                    </span>
                                                </div>
                                                <button
                                                    onClick={() => removeFolder(folder)}
                                                    className="p-1 text-stone-300 hover:text-red-500 hover:bg-red-50 rounded transition-all"
                                                >
                                                    <X size={16} />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                <button
                                    onClick={addFolder}
                                    className="w-full py-2.5 border border-dashed border-stone-300 text-stone-500 hover:text-brand-600 hover:border-brand-500 hover:bg-brand-50 rounded-xl transition-all flex items-center justify-center gap-2 text-sm"
                                >
                                    <Plus size={16} />
                                    添加文件夹
                                </button>
                            </>
                        )}

                        {activeTab === 'mcp' && (
                            <div className="h-full flex flex-col">
                                <div className="flex items-center justify-between mb-2">
                                    <span className="text-xs font-medium text-stone-500">mcp.json 配置</span>
                                    <button
                                        onClick={saveMcpConfig}
                                        className={`text-xs px-2 py-1 rounded transition-colors ${mcpSaved ? 'bg-green-100 text-green-600' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                                            }`}
                                    >
                                        {mcpSaved ? '已保存' : '保存配置'}
                                    </button>
                                </div>
                                <textarea
                                    value={mcpConfig}
                                    onChange={(e) => setMcpConfig(e.target.value)}
                                    className="w-full h-[320px] bg-white border border-stone-200 rounded-lg p-3 font-mono text-xs focus:outline-none focus:border-brand-500 resize-none text-stone-700"
                                    placeholder='{ "mcpServers": { ... } }'
                                    spellCheck={false}
                                />
                                <p className="text-[10px] text-stone-400 mt-2">
                                    配置将保存在 ~/.codebuddy/mcp.json。请确保 JSON 格式正确。
                                </p>

                            </div>
                        )}

                        {activeTab === 'skills' && (
                            <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                    <p className="text-sm text-stone-500">自定义 AI 技能</p>
                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={handleImportSkills}
                                            disabled={isImportingSkills}
                                            className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-purple-500 text-white rounded hover:bg-purple-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            {isImportingSkills ? (
                                                <>
                                                    <Loader2 size={12} className="animate-spin" />
                                                    导入中...
                                                </>
                                            ) : (
                                                <>
                                                    <Download size={12} />
                                                    导入常用Skills
                                                </>
                                            )}
                                        </button>
                                        <button
                                            onClick={() => {
                                                setEditingSkill(null);
                                                setShowSkillEditor(true);
                                            }}
                                            className="flex items-center gap-1 text-xs px-2 py-1 bg-brand-500 text-white rounded hover:bg-brand-600 transition-colors"
                                        >
                                            <Plus size={12} />
                                            新建技能
                                        </button>
                                    </div>
                                </div>

                                {importSkillsStatus && (
                                    <div className={`p-3 rounded-lg text-sm ${
                                        importSkillsStatus.type === 'success'
                                            ? 'bg-green-50 text-green-700 border border-green-200'
                                            : 'bg-red-50 text-red-700 border border-red-200'
                                    }`}>
                                        {importSkillsStatus.message}
                                    </div>
                                )}

                                {skills.length === 0 ? (
                                    <div className="text-center py-8 text-stone-400 border-2 border-dashed border-stone-200 rounded-xl">
                                        <p className="text-sm">暂无技能</p>
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-1 gap-2">
                                        {skills.map((skill) => (
                                            <div
                                                key={skill.id}
                                                className="flex items-center justify-between p-3 bg-white border border-stone-200 rounded-lg hover:border-brand-200 transition-colors group"
                                            >
                                                <div className="flex items-center gap-3">
                                                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${skill.isBuiltin ? 'bg-brand-50 text-brand-600' : 'bg-purple-50 text-purple-600'}`}>
                                                        <Zap size={16} />
                                                    </div>
                                                    <div>
                                                        <div className="flex items-center gap-2">
                                                            <p className="text-sm font-medium text-stone-700">{skill.name}</p>
                                                            {skill.isBuiltin && (
                                                                <span className="text-[10px] px-1.5 py-0.5 bg-stone-100 text-stone-500 rounded-full font-medium">内置</span>
                                                            )}
                                                        </div>
                                                        <p className="text-[10px] text-stone-400 font-mono truncate max-w-xs">{skill.path}</p>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                    <button
                                                        onClick={() => {
                                                            setEditingSkill(skill.id);
                                                            setViewingSkill(skill.isBuiltin); // Set view-only if built-in
                                                            setShowSkillEditor(true);
                                                        }}
                                                        className="p-1.5 text-stone-400 hover:text-blue-500 hover:bg-blue-50 rounded"
                                                        title={skill.isBuiltin ? "查看" : "编辑"}
                                                    >
                                                        {skill.isBuiltin ? <Eye size={14} /> : <Edit2 size={14} />}
                                                    </button>
                                                    {!skill.isBuiltin && (
                                                        <button
                                                            onClick={() => deleteSkill(skill.id)}
                                                            className="p-1.5 text-stone-400 hover:text-red-500 hover:bg-red-50 rounded"
                                                            title="删除"
                                                        >
                                                            <Trash2 size={14} />
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}

                        {activeTab === 'plugins' && (
                            <div className="space-y-5">
                                {/* Add Marketplace Section */}
                                <div className="space-y-3">
                                    <div>
                                        <h3 className="text-sm font-medium text-stone-700">添加插件市场</h3>
                                        <p className="text-xs text-stone-400 mt-1">支持以下格式:</p>
                                        <ul className="text-xs text-stone-400 mt-1 space-y-0.5 font-mono">
                                            <li>• owner/repo (GitHub)</li>
                                            <li>• git@github.com:owner/repo.git (SSH)</li>
                                            <li>• https://example.com/marketplace.json</li>
                                            <li>• ./path/to/marketplace</li>
                                        </ul>
                                    </div>
                                    <div className="flex gap-2">
                                        <input
                                            type="text"
                                            value={pluginSource}
                                            onChange={(e) => setPluginSource(e.target.value)}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter' && pluginSource.trim()) {
                                                    handleAddMarketplace();
                                                }
                                            }}
                                            placeholder="owner/repo 或 URL"
                                            className="flex-1 px-3 py-2 text-sm border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 font-mono"
                                            disabled={pluginLoading}
                                        />
                                        <button
                                            onClick={handleAddMarketplace}
                                            disabled={!pluginSource.trim() || pluginLoading}
                                            className="px-4 py-2 text-sm font-medium text-white bg-brand-500 rounded-lg hover:bg-brand-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                                        >
                                            {pluginLoading ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                                            添加
                                        </button>
                                    </div>
                                    {pluginStatus && (
                                        <div className={`p-3 rounded-lg text-sm ${
                                            pluginStatus.type === 'success' 
                                                ? 'bg-green-50 text-green-700 border border-green-200' 
                                                : 'bg-red-50 text-red-700 border border-red-200'
                                        }`}>
                                            {pluginStatus.message}
                                        </div>
                                    )}
                                </div>

                                {/* Built-in Marketplaces */}
                                <div className="space-y-3">
                                    <div className="flex items-center justify-between">
                                        <h3 className="text-sm font-medium text-stone-700">推荐插件市场</h3>
                                        <button
                                            onClick={loadPluginMarketplaces}
                                            className="text-xs text-brand-500 hover:text-brand-600 flex items-center gap-1"
                                        >
                                            <RefreshCw size={12} />
                                            刷新
                                        </button>
                                    </div>
                                    <div className="grid grid-cols-1 gap-2">
                                        {BUILTIN_MARKETPLACES.map((market) => {
                                            const isInstalled = installedMarketplaces.includes(market.id);
                                            const isLoading = builtinLoading[market.id];
                                            return (
                                                <div
                                                    key={market.id}
                                                    className="flex items-center justify-between p-3 bg-white border border-stone-200 rounded-lg hover:border-brand-200 transition-colors"
                                                >
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-10 h-10 rounded-lg bg-brand-50 flex items-center justify-center">
                                                            <Package size={20} className="text-brand-600" />
                                                        </div>
                                                        <div>
                                                            <p className="text-sm font-medium text-stone-700">{market.name}</p>
                                                            <p className="text-xs text-stone-400">{market.description}</p>
                                                            <p className="text-[10px] text-stone-400 font-mono mt-0.5">{market.id}</p>
                                                        </div>
                                                    </div>
                                                    <button
                                                        onClick={() => handleBuiltinMarketplace(market.id, isInstalled)}
                                                        disabled={isLoading}
                                                        className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5 ${
                                                            isLoading
                                                                ? 'bg-stone-100 text-stone-400 cursor-not-allowed'
                                                                : isInstalled
                                                                ? 'bg-red-50 text-red-600 hover:bg-red-100'
                                                                : 'bg-brand-500 text-white hover:bg-brand-600'
                                                        }`}
                                                    >
                                                        {isLoading ? (
                                                            <Loader2 size={12} className="animate-spin" />
                                                        ) : isInstalled ? (
                                                            <>
                                                                <Trash2 size={12} />
                                                                移除
                                                            </>
                                                        ) : (
                                                            <>
                                                                <Download size={12} />
                                                                安装
                                                            </>
                                                        )}
                                                    </button>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>

                                {/* Installed Marketplaces Info */}
                                {installedMarketplaces && (
                                    <div className="space-y-2">
                                        <h3 className="text-sm font-medium text-stone-700">已安装的市场</h3>
                                        <div className="bg-stone-900 rounded-lg p-3 font-mono text-xs text-stone-300 whitespace-pre-wrap max-h-32 overflow-y-auto">
                                            {installedMarketplaces || '暂无已安装的插件市场'}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {activeTab === 'advanced' && (
                            <>
                                <div className="flex items-center justify-between p-3 bg-white border border-stone-200 rounded-lg opacity-60">
                                    <div>
                                        <p className="text-sm font-medium text-stone-700">浏览器操作</p>
                                        <p className="text-xs text-stone-400">允许 AI 操作浏览器（开发中）</p>
                                    </div>
                                    <button
                                        disabled
                                        className="w-10 h-6 rounded-full bg-stone-200 cursor-not-allowed"
                                    >
                                        <div className="w-4 h-4 rounded-full bg-white shadow mx-1 translate-x-0" />
                                    </button>
                                </div>

                                <div className="flex items-center justify-between p-3 bg-white border border-stone-200 rounded-lg">
                                    <div>
                                        <p className="text-sm font-medium text-stone-700">快捷键</p>
                                        <p className="text-xs text-stone-400">{config.shortcut} 呼出悬浮球</p>
                                    </div>
                                    {isRecordingShortcut ? (
                                        <input
                                            type="text"
                                            autoFocus
                                            className="px-3 py-1.5 text-sm border border-brand-400 rounded-lg bg-brand-50 text-brand-600 font-medium outline-none animate-pulse"
                                            placeholder="按下快捷键..."
                                            onKeyDown={handleShortcutKeyDown}
                                            onBlur={() => setIsRecordingShortcut(false)}
                                            readOnly
                                        />
                                    ) : (
                                        <button
                                            onClick={() => setIsRecordingShortcut(true)}
                                            className="px-3 py-1.5 text-sm border border-stone-200 rounded-lg hover:bg-stone-50 text-stone-600"
                                        >
                                            {config.shortcut}
                                        </button>
                                    )}
                                </div>

                                {/* Permissions Management */}
                                <div className="space-y-2">
                                    <p className="text-sm font-medium text-stone-700">已授权的权限</p>
                                    {permissions.length === 0 ? (
                                        <p className="text-xs text-stone-400 p-3 bg-stone-50 rounded-lg">暂无已保存的权限</p>
                                    ) : (
                                        <div className="space-y-2">
                                            {permissions.map((p, idx) => (
                                                <div key={idx} className="flex items-center justify-between p-2 bg-white border border-stone-200 rounded-lg">
                                                    <div className="flex-1">
                                                        <p className="text-sm font-mono text-stone-700">{p.tool}</p>
                                                        <p className="text-xs text-stone-400">{p.pathPattern === '*' ? '所有路径' : p.pathPattern}</p>
                                                    </div>
                                                    <button
                                                        onClick={() => revokePermission(p.tool, p.pathPattern)}
                                                        className="px-2 py-1 text-xs text-red-600 hover:bg-red-50 rounded"
                                                    >
                                                        撤销
                                                    </button>
                                                </div>
                                            ))}
                                            <button
                                                onClick={clearAllPermissions}
                                                className="w-full px-3 py-2 text-sm text-red-600 border border-red-200 rounded-lg hover:bg-red-50"
                                            >
                                                清除所有权限
                                            </button>
                                        </div>
                                    )}
                                </div>

                                {/* Command Blacklist Management */}
                                <div className="space-y-2">
                                    <div className="flex items-center justify-between">
                                        <p className="text-sm font-medium text-stone-700">命令黑名单</p>
                                        <button
                                            onClick={resetBlacklist}
                                            className="text-xs text-brand-500 hover:text-brand-600"
                                        >
                                            恢复默认
                                        </button>
                                    </div>
                                    <p className="text-xs text-stone-400">
                                        包含以下模式的命令将被禁止执行（如 rm -rf、format 等危险操作）
                                    </p>
                                    
                                    {/* Add new command to blacklist */}
                                    <div className="flex gap-2">
                                        <input
                                            type="text"
                                            value={newBlacklistCommand}
                                            onChange={(e) => setNewBlacklistCommand(e.target.value)}
                                            onKeyDown={(e) => e.key === 'Enter' && addToBlacklist()}
                                            placeholder="输入要禁用的命令模式..."
                                            className="flex-1 px-3 py-2 text-sm border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
                                        />
                                        <button
                                            onClick={addToBlacklist}
                                            disabled={!newBlacklistCommand.trim()}
                                            className="px-3 py-2 text-sm font-medium text-white bg-brand-500 rounded-lg hover:bg-brand-600 disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            添加
                                        </button>
                                    </div>
                                    
                                    {/* Blacklist items */}
                                    <div className="space-y-1 max-h-48 overflow-y-auto">
                                        {blacklist.map((cmd, idx) => (
                                            <div key={idx} className="flex items-center justify-between p-2 bg-red-50 border border-red-100 rounded-lg">
                                                <code className="text-sm font-mono text-red-700">{cmd}</code>
                                                <button
                                                    onClick={() => removeFromBlacklist(cmd)}
                                                    className="px-2 py-1 text-xs text-red-600 hover:bg-red-100 rounded"
                                                >
                                                    移除
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </>
                        )}

                        {activeTab === 'logs' && (
                            <div className="space-y-4">
                                {/* Header with actions */}
                                <div className="flex items-center justify-between">
                                    <div>
                                        <h3 className="text-sm font-medium text-stone-700">应用日志</h3>
                                        <p className="text-xs text-stone-400">查看应用运行日志，用于排查问题</p>
                                    </div>
                                    <div className="flex gap-2">
                                        <button
                                            onClick={loadLogs}
                                            disabled={logsLoading}
                                            className="flex items-center gap-1 px-2 py-1.5 text-xs font-medium text-stone-600 bg-stone-100 rounded-lg hover:bg-stone-200 disabled:opacity-50"
                                        >
                                            <RefreshCw size={12} className={logsLoading ? 'animate-spin' : ''} />
                                            刷新
                                        </button>
                                        <button
                                            onClick={exportLogs}
                                            className="flex items-center gap-1 px-2 py-1.5 text-xs font-medium text-stone-600 bg-stone-100 rounded-lg hover:bg-stone-200"
                                        >
                                            <Download size={12} />
                                            导出
                                        </button>
                                        <button
                                            onClick={clearLogs}
                                            className="flex items-center gap-1 px-2 py-1.5 text-xs font-medium text-red-600 bg-red-50 rounded-lg hover:bg-red-100"
                                        >
                                            <Trash2 size={12} />
                                            清除
                                        </button>
                                    </div>
                                </div>

                                {/* Log count */}
                                <div className="text-xs text-stone-500">
                                    共 {logs.length} 条日志记录
                                </div>

                                {/* Log list */}
                                <div className="bg-stone-900 rounded-lg p-3 font-mono text-xs max-h-[400px] overflow-y-auto">
                                    {logs.length === 0 ? (
                                        <div className="text-stone-500 text-center py-8">
                                            暂无日志
                                        </div>
                                    ) : (
                                        <div className="space-y-1">
                                            {logs.slice().reverse().map((log, idx) => (
                                                <div key={idx} className="flex gap-2 py-1 border-b border-stone-800 last:border-0">
                                                    <span className="text-stone-500 whitespace-nowrap">
                                                        {new Date(log.timestamp).toLocaleTimeString()}
                                                    </span>
                                                    <span className={`font-medium whitespace-nowrap ${
                                                        log.level === 'error' ? 'text-red-400' :
                                                        log.level === 'warn' ? 'text-yellow-400' :
                                                        'text-green-400'
                                                    }`}>
                                                        [{log.level.toUpperCase()}]
                                                    </span>
                                                    <span className="text-stone-300 break-all">
                                                        {log.message}
                                                        {log.data !== undefined && log.data !== null && (
                                                            <span className="text-stone-500 ml-2">
                                                                {String(JSON.stringify(log.data))}
                                                            </span>
                                                        )}
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Skill Editor Modal */}
            {showSkillEditor && (
                <SkillEditor
                    filename={editingSkill}
                    readOnly={viewingSkill}
                    onClose={() => {
                        setShowSkillEditor(false);
                        setViewingSkill(false);
                    }}
                    onSave={refreshSkills}
                />
            )}

            {/* Login Error Dialog */}
            {loginError && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
                    <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                        <div className="p-6 space-y-4 text-center">
                            {/* WorkBuddy Icon */}
                            <div className="flex justify-center">
                                <div className="w-16 h-16 rounded-2xl bg-white shadow-lg flex items-center justify-center border border-stone-100 overflow-hidden">
                                    <img src="./logo.png" alt="WorkBuddy" className="w-full h-full object-cover" />
                                </div>
                            </div>
                            
                            {/* Message */}
                            <p className="text-stone-800 text-base">
                                登录失败: {loginError}
                            </p>

                            {/* Button */}
                            <button
                                onClick={() => setLoginError(null)}
                                className="w-full px-4 py-2.5 bg-brand-500 text-white rounded-lg hover:bg-brand-600 transition-colors font-medium"
                            >
                                OK
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
