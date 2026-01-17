import { useState, useEffect, useRef } from 'react';
import { Square, ArrowUp, ChevronDown, ChevronUp, Download, FolderOpen, MessageCircle, Zap, AlertTriangle, Check, X, Settings, Plus } from 'lucide-react';
import { useI18n } from '../i18n/I18nContext';
import { MarkdownRenderer } from './MarkdownRenderer';
import Anthropic from '@anthropic-ai/sdk';

type Mode = 'chat' | 'work';

interface PermissionRequest {
    id: string;
    tool: string;
    description: string;
    args: Record<string, unknown>;
}

interface CLIProgress {
    type: 'init' | 'tool_use' | 'tool_result' | 'complete';
    message: string;
    tool?: string;
    input?: Record<string, unknown>;
    model?: string;
    is_error?: boolean;
}

interface CoworkViewProps {
    history: Anthropic.MessageParam[];
    onSendMessage: (message: string | { content: string, images: string[] }) => void;
    onAbort: () => void;
    isProcessing: boolean;
    onOpenSettings: () => void;
    onNewWindow?: () => void;
}

export function CoworkView({ 
    history, 
    onSendMessage, 
    onAbort, 
    isProcessing, 
    onOpenSettings,
    onNewWindow
}: CoworkViewProps) {
    const [input, setInput] = useState('');
    const [images, setImages] = useState<string[]>([]); // Base64 strings
    const [mode, setMode] = useState<Mode>('work');
    const [expandedBlocks, setExpandedBlocks] = useState<Set<string>>(new Set());
    const [streamingText, setStreamingText] = useState('');
    const [progressMessages, setProgressMessages] = useState<CLIProgress[]>([]);
    const [workingDir, setWorkingDir] = useState<string | null>(null);
    const [authorizedFolders, setAuthorizedFolders] = useState<string[]>([]);
    const [showWorkspacePicker, setShowWorkspacePicker] = useState(false);
    const [permissionRequest, setPermissionRequest] = useState<PermissionRequest | null>(null);
    const scrollRef = useRef<HTMLDivElement>(null);
    const workspacePickerRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [selectedImage, setSelectedImage] = useState<string | null>(null);

    // Load initial working directory from authorized folders
    useEffect(() => {
        window.ipcRenderer.invoke('agent:get-authorized-folders').then((folders) => {
            const folderList = folders as string[];
            setAuthorizedFolders(folderList || []);
            if (folderList && folderList.length > 0) {
                setWorkingDir(folderList[0]);
            }
        });
    }, []);

    // Close workspace picker when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (workspacePickerRef.current && !workspacePickerRef.current.contains(event.target as Node)) {
                setShowWorkspacePicker(false);
            }
        };
        
        if (showWorkspacePicker) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [showWorkspacePicker]);

    // Setup listeners
    useEffect(() => {
        // Listen for streaming tokens
        const removeStreamListener = window.ipcRenderer.on('agent:stream-token', (_event, ...args) => {
            const token = args[0] as string;
            setStreamingText(prev => prev + token);
        });

        // Listen for CLI progress messages
        const removeProgressListener = window.ipcRenderer.on('agent:cli-progress', (_event, ...args) => {
            const progress = args[0] as CLIProgress;
            setProgressMessages(prev => [...prev, progress]);
        });

        // Clear streaming when history updates and save session
        const removeHistoryListener = window.ipcRenderer.on('agent:history-update', (_event, ...args) => {
            const newHistory = args[0] as Anthropic.MessageParam[];
            setStreamingText('');
            setProgressMessages([]); // Clear progress messages
            // Auto-save session
            if (newHistory && newHistory.length > 0) {
                window.ipcRenderer.invoke('session:save', newHistory);
            }
        });

        // Listen for permission requests
        const removeConfirmListener = window.ipcRenderer.on('agent:confirm-request', (_event, ...args) => {
            const req = args[0] as PermissionRequest;
            setPermissionRequest(req);
        });

        return () => {
            removeStreamListener?.();
            removeProgressListener?.();
            removeHistoryListener?.();
            removeConfirmListener?.();
        };
    }, []);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [history, streamingText, images]); // Scroll when images change too

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if ((!input.trim() && images.length === 0) || isProcessing) return;

        // Check if working directory is set (required for work mode)
        if (mode === 'work' && !workingDir) {
            alert('请先选择工作目录。点击左下角的文件夹图标选择一个项目目录。');
            return;
        }

        setStreamingText('');

        // Send as object if images exist, otherwise string for backward compat
        if (images.length > 0) {
            onSendMessage({ content: input, images });
        } else {
            onSendMessage(input);
        }

        setInput('');
        setImages([]);
    };

    const handleSelectFolder = async () => {
        const folder = await window.ipcRenderer.invoke('dialog:select-folder') as string | null;
        if (folder) {
            setWorkingDir(folder);
            // Set as primary working directory (also authorizes it)
            await window.ipcRenderer.invoke('agent:set-working-dir', folder);
        }
    };

    const handlePermissionResponse = (approved: boolean) => {
        if (permissionRequest) {
            window.ipcRenderer.invoke('agent:confirm-response', {
                id: permissionRequest.id,
                approved
            });
            setPermissionRequest(null);
        }
    };

    // Image Input Handlers
    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (files) {
            Array.from(files).forEach(file => {
                if (file.type.startsWith('image/')) {
                    const reader = new FileReader();
                    reader.onload = (e) => {
                        const result = e.target?.result as string;
                        if (result) {
                            setImages(prev => [...prev, result]);
                        }
                    };
                    reader.readAsDataURL(file);
                }
            });
        }
        // Reset input
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const handlePaste = (e: React.ClipboardEvent) => {
        const items = e.clipboardData.items;
        for (let i = 0; i < items.length; i++) {
            if (items[i].type.indexOf('image') !== -1) {
                e.preventDefault();
                const blob = items[i].getAsFile();
                if (blob) {
                    const reader = new FileReader();
                    reader.onload = (e) => {
                        const result = e.target?.result as string;
                        if (result) {
                            setImages(prev => [...prev, result]);
                        }
                    };
                    reader.readAsDataURL(blob);
                }
            }
        }
    };

    const removeImage = (index: number) => {
        setImages(prev => prev.filter((_, i) => i !== index));
    };

    // Keyboard shortcuts
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Focus input on Ctrl/Cmd+L
            if ((e.ctrlKey || e.metaKey) && e.key === 'l') {
                e.preventDefault();
                inputRef.current?.focus();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    const toggleBlock = (id: string) => {
        setExpandedBlocks(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const relevantHistory = history.filter(m => (m.role as string) !== 'system');

    return (
        <div className="flex flex-col h-full bg-[#FAF8F5] relative">
            {/* Permission Dialog Overlay */}
            {permissionRequest && (
                <div className="absolute inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl animate-in fade-in zoom-in-95 duration-200">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center">
                                <AlertTriangle size={24} className="text-amber-600" />
                            </div>
                            <div>
                                <h3 className="font-semibold text-stone-800 text-lg">操作确认</h3>
                                <p className="text-sm text-stone-500">{permissionRequest.tool}</p>
                            </div>
                        </div>

                        <p className="text-stone-600 mb-4">{permissionRequest.description}</p>

                        {/* Show details if write_file */}
                        {typeof permissionRequest.args?.path === 'string' && (
                            <div className="bg-stone-50 rounded-lg p-3 mb-4 font-mono text-xs text-stone-600">
                                <span className="text-stone-400">路径: </span>
                                {permissionRequest.args.path as string}
                            </div>
                        )}

                        <div className="flex gap-3">
                            <button
                                onClick={() => handlePermissionResponse(false)}
                                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-stone-600 bg-stone-100 hover:bg-stone-200 rounded-xl transition-colors"
                            >
                                <X size={16} />
                                拒绝
                            </button>
                            <button
                                onClick={() => handlePermissionResponse(true)}
                                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-brand-500 hover:bg-brand-600 rounded-xl transition-colors"
                            >
                                <Check size={16} />
                                允许
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Image Lightbox */}
            {selectedImage && (
                <div
                    className="absolute inset-0 z-50 bg-black/90 flex items-center justify-center p-4 animate-in fade-in duration-200"
                    onClick={() => setSelectedImage(null)}
                >
                    <button
                        className="absolute top-4 right-4 p-2 text-white/50 hover:text-white transition-colors"
                        onClick={() => setSelectedImage(null)}
                    >
                        <X size={24} />
                    </button>
                    <img
                        src={selectedImage}
                        alt="Full size"
                        className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
                    />
                </div>
            )}

            {/* Top Bar with Mode Tabs and Settings */}
            <div className="border-b border-stone-200 bg-white px-4 py-2.5 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-3">
                    {/* New Window Button */}
                    {onNewWindow && (
                        <button
                            onClick={onNewWindow}
                            className="p-1.5 text-stone-500 hover:text-stone-700 hover:bg-stone-100 rounded-lg transition-colors"
                            title="新建窗口 (Ctrl+N)"
                        >
                            <Plus size={18} />
                        </button>
                    )}

                    {/* Mode Tabs */}
                    <div className="flex items-center gap-0.5 bg-stone-100 rounded-lg p-0.5">
                            <button
                                onClick={() => setMode('chat')}
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${mode === 'chat' ? 'bg-white text-stone-800 shadow-sm' : 'text-stone-500 hover:text-stone-700'
                                    }`}
                            >
                                <MessageCircle size={14} />
                                Chat
                            </button>
                            <button
                                onClick={() => setMode('work')}
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${mode === 'work' ? 'bg-white text-stone-800 shadow-sm' : 'text-stone-500 hover:text-stone-700'
                                    }`}
                            >
                                <Zap size={14} />
                                Work
                            </button>
                        </div>
                    </div>

                {/* Working Dir + Settings */}
                <div className="flex items-center gap-2">
                    {/* Workspace Picker */}
                    <div className="relative" ref={workspacePickerRef}>
                        <button
                            onClick={() => setShowWorkspacePicker(!showWorkspacePicker)}
                            className="flex items-center gap-1 px-2 py-1 text-xs text-stone-500 hover:text-stone-700 hover:bg-stone-100 rounded-md transition-colors border border-transparent hover:border-stone-200"
                            title="切换工作目录"
                        >
                            <FolderOpen size={14} />
                            <span className="truncate max-w-24">
                                {workingDir ? workingDir.split(/[\\/]/).pop() : '选择目录'}
                            </span>
                            <ChevronDown size={12} className={`transition-transform ${showWorkspacePicker ? 'rotate-180' : ''}`} />
                        </button>
                        
                        {/* Workspace Dropdown */}
                        {showWorkspacePicker && (
                            <div className="absolute right-0 top-full mt-1 z-30 w-64 bg-white rounded-lg shadow-xl border border-stone-200 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
                                <div className="px-3 py-2 border-b border-stone-100 bg-stone-50/50">
                                    <span className="text-xs font-medium text-stone-600">工作目录</span>
                                </div>
                                <div className="max-h-48 overflow-y-auto py-1">
                                    {authorizedFolders.length === 0 ? (
                                        <div className="px-3 py-4 text-center text-xs text-stone-400">
                                            暂无已授权的目录
                                        </div>
                                    ) : (
                                        authorizedFolders.map((folder, idx) => (
                                            <button
                                                key={folder}
                                                onClick={async () => {
                                                    await window.ipcRenderer.invoke('agent:set-working-dir', folder);
                                                    setWorkingDir(folder);
                                                    setShowWorkspacePicker(false);
                                                }}
                                                className={`w-full flex items-center gap-2 px-3 py-2 text-xs text-left hover:bg-stone-50 transition-colors ${folder === workingDir ? 'bg-brand-50 text-brand-600' : 'text-stone-600'}`}
                                            >
                                                <FolderOpen size={14} className={folder === workingDir ? 'text-brand-500' : 'text-stone-400'} />
                                                <div className="flex-1 min-w-0">
                                                    <div className="font-medium truncate">{folder.split(/[\\/]/).pop()}</div>
                                                    <div className="text-[10px] text-stone-400 truncate">{folder}</div>
                                                </div>
                                                {idx === 0 && folder === workingDir && (
                                                    <span className="text-[10px] text-brand-500 bg-brand-100 px-1.5 py-0.5 rounded">当前</span>
                                                )}
                                            </button>
                                        ))
                                    )}
                                </div>
                                <div className="border-t border-stone-100 p-2">
                                    <button
                                        onClick={async () => {
                                            const folder = await window.ipcRenderer.invoke('dialog:select-folder') as string | null;
                                            if (folder) {
                                                await window.ipcRenderer.invoke('agent:set-working-dir', folder);
                                                setWorkingDir(folder);
                                                // Refresh authorized folders
                                                const folders = await window.ipcRenderer.invoke('agent:get-authorized-folders') as string[];
                                                setAuthorizedFolders(folders || []);
                                                setShowWorkspacePicker(false);
                                            }
                                        }}
                                        className="w-full flex items-center justify-center gap-1 px-3 py-1.5 text-xs text-brand-600 hover:bg-brand-50 rounded-md transition-colors"
                                    >
                                        <FolderOpen size={12} />
                                        添加新目录
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                    
                    <button
                        onClick={onOpenSettings}
                        className="p-1.5 text-stone-400 hover:text-stone-600 hover:bg-stone-100 rounded-lg transition-colors"
                        title="Settings"
                    >
                        <Settings size={16} />
                    </button>
                </div>
            </div>

            {/* Messages Area - Narrower for better readability */}
            <div className="flex-1 overflow-y-auto px-4 py-6" ref={scrollRef}>
                <div className="max-w-xl mx-auto space-y-5">
                    {relevantHistory.length === 0 && !streamingText ? (
                        <EmptyState 
                            mode={mode} 
                            workingDir={workingDir} 
                            onSelectFolder={handleSelectFolder}
                            onOpenSettings={onOpenSettings}
                        />
                    ) : (
                        <>
                            {relevantHistory.map((msg, idx) => (
                                <MessageItem
                                    key={idx}
                                    message={msg}
                                    expandedBlocks={expandedBlocks}
                                    toggleBlock={toggleBlock}
                                    showTools={mode === 'work'}
                                    onImageClick={setSelectedImage}
                                />
                            ))}

                            {streamingText && (
                                <div className="animate-in fade-in duration-200">
                                    <div className="text-stone-700 text-[15px] leading-7 max-w-none">
                                        <MarkdownRenderer content={streamingText} />
                                        <span className="inline-block w-2 h-5 bg-brand-500 ml-0.5 animate-pulse" />
                                    </div>
                                </div>
                            )}

                            {/* CLI Progress Messages */}
                            {progressMessages.length > 0 && (
                                <div className="space-y-2 animate-in fade-in duration-200">
                                    {progressMessages.map((progress, idx) => (
                                        <div
                                            key={idx}
                                            className={`flex items-center gap-2 text-sm px-3 py-2 rounded-lg ${
                                                progress.type === 'complete'
                                                    ? progress.is_error
                                                        ? 'bg-red-50 text-red-600'
                                                        : 'bg-green-50 text-green-600'
                                                    : progress.type === 'tool_use'
                                                        ? 'bg-blue-50 text-blue-600'
                                                        : 'bg-stone-100 text-stone-600'
                                            }`}
                                        >
                                            {progress.type === 'init' && (
                                                <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
                                            )}
                                            {progress.type === 'tool_use' && (
                                                <Zap size={14} className="text-blue-500" />
                                            )}
                                            {progress.type === 'tool_result' && (
                                                <Check size={14} className="text-green-500" />
                                            )}
                                            {progress.type === 'complete' && (
                                                progress.is_error
                                                    ? <AlertTriangle size={14} className="text-red-500" />
                                                    : <Check size={14} className="text-green-500" />
                                            )}
                                            <span className="truncate">{progress.message}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </>
                    )}

                    {isProcessing && !streamingText && progressMessages.length === 0 && (
                        <div className="flex items-center gap-2 text-stone-400 text-sm animate-pulse">
                            <div className="w-1.5 h-1.5 bg-brand-500 rounded-full animate-bounce" />
                            <span>Thinking...</span>
                        </div>
                    )}
                </div>
            </div>

            {/* Bottom Input */}
            <div className="border-t border-stone-200 bg-white p-4 shadow-lg shadow-stone-200/50">
                <div className="max-w-xl mx-auto">
                    {/* Image Preview Area */}
                    {images.length > 0 && (
                        <div className="flex gap-2 mb-2 overflow-x-auto pb-1">
                            {images.map((img, idx) => (
                                <div key={idx} className="relative w-16 h-16 rounded-lg border border-stone-200 overflow-hidden shrink-0 group">
                                    <img src={img} alt="Preview" className="w-full h-full object-cover" />
                                    <button
                                        onClick={() => removeImage(idx)}
                                        className="absolute top-0.5 right-0.5 bg-black/50 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                                    >
                                        <X size={10} />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}

                    <form onSubmit={handleSubmit}>
                        <div className="input-bar">
                            <button type="button" onClick={handleSelectFolder} className="p-3 text-stone-400 hover:text-stone-600 transition-colors" title="选择工作目录">
                                <FolderOpen size={18} />
                            </button>

                            {/* Image Upload Button */}
                            <button
                                type="button"
                                onClick={() => fileInputRef.current?.click()}
                                className="p-3 text-stone-400 hover:text-stone-600 transition-colors"
                                title="上传图片"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" /></svg>
                            </button>
                            <input
                                type="file"
                                ref={fileInputRef}
                                className="hidden"
                                accept="image/*"
                                multiple
                                onChange={handleFileSelect}
                            />

                            <input
                                ref={inputRef}
                                type="text"
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                onPaste={handlePaste}
                                placeholder={mode === 'chat' ? "输入消息... (Ctrl+L 聚焦)" : workingDir ? "描述任务... (Ctrl+L 聚焦)" : "请先选择工作目录"}
                                className="flex-1 bg-transparent text-stone-800 placeholder:text-stone-400 py-3 text-sm focus:outline-none"
                                disabled={isProcessing}
                            />

                            <div className="pr-2">
                                {isProcessing ? (
                                    <button
                                        type="button"
                                        onClick={onAbort}
                                        className="p-2.5 bg-red-100 text-red-600 rounded-lg hover:bg-red-200 transition-all"
                                    >
                                        <Square size={16} fill="currentColor" />
                                    </button>
                                ) : (
                                    <button
                                        type="submit"
                                        disabled={!input.trim() && images.length === 0}
                                        className={`p-2.5 rounded-lg transition-all ${input.trim() || images.length > 0
                                            ? 'bg-brand-500 text-white shadow-md hover:bg-brand-600'
                                            : 'bg-stone-100 text-stone-300'
                                            }`}
                                    >
                                        <ArrowUp size={16} />
                                    </button>
                                )}
                            </div>
                        </div>
                    </form>

                    <p className="text-[11px] text-stone-400 text-center mt-3">
                        AI 可能会出错，请仔细核查重要信息
                    </p>
                </div>
            </div>
        </div>
    );
}

function MessageItem({ message, expandedBlocks, toggleBlock, showTools, onImageClick }: {
    message: Anthropic.MessageParam,
    expandedBlocks: Set<string>,
    toggleBlock: (id: string) => void,
    showTools: boolean,
    onImageClick: (src: string) => void
}) {
    const isUser = message.role === 'user';

    if (isUser && Array.isArray(message.content) && message.content[0]?.type === 'tool_result') {
        return null;
    }

    if (isUser) {
        const contentArray = Array.isArray(message.content) ? message.content : [];
        const text = typeof message.content === 'string' ? message.content :
            contentArray.find((b): b is Anthropic.TextBlockParam => 'type' in b && b.type === 'text')?.text || '';

        // Extract images from user message
        const images = contentArray.filter((b): b is Anthropic.ImageBlockParam => 'type' in b && b.type === 'image');

        return (
            <div className="space-y-2 max-w-[85%]">
                {images.length > 0 && (
                    <div className="flex gap-2 flex-wrap">
                        {images.map((img, i: number) => {
                            const imgSource = img.source as { media_type: string; data: string };
                            const src = `data:${imgSource.media_type};base64,${imgSource.data}`;
                            return (
                                <img
                                    key={i}
                                    src={src}
                                    alt="User upload"
                                    className="w-32 h-32 object-cover rounded-xl border border-stone-200 cursor-zoom-in hover:opacity-90 transition-opacity"
                                    onClick={() => onImageClick(src)}
                                />
                            );
                        })}
                    </div>
                )}
                {text && (
                    <div className="user-bubble inline-block">
                        {text}
                    </div>
                )}
            </div>
        );
    }

    const blocks = Array.isArray(message.content) ? message.content : [{ type: 'text' as const, text: message.content as string }];

    type ContentBlock = { type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> };
    type ToolGroup = { type: 'tool_group'; items: ContentBlock[]; count: number };
    const groupedBlocks: (ContentBlock | ToolGroup)[] = [];
    let currentToolGroup: ContentBlock[] = [];

    blocks.forEach((block) => {
        const b = block as ContentBlock;
        if (b.type === 'tool_use') {
            currentToolGroup.push(b);
        } else {
            if (currentToolGroup.length > 0) {
                groupedBlocks.push({ type: 'tool_group', items: currentToolGroup, count: currentToolGroup.length });
                currentToolGroup = [];
            }
            groupedBlocks.push(b);
        }
    });
    if (currentToolGroup.length > 0) {
        groupedBlocks.push({ type: 'tool_group', items: currentToolGroup, count: currentToolGroup.length });
    }

    return (
        <div className="space-y-4">
            {groupedBlocks.map((block, i: number) => {
                if (block.type === 'text' && block.text) {
                    return (
                        <div key={i} className="text-stone-700 text-[15px] leading-7 max-w-none">
                            <MarkdownRenderer content={block.text} />
                        </div>
                    );
                }

                if (block.type === 'tool_group' && showTools) {
                    const toolGroup = block as ToolGroup;
                    return (
                        <div key={i} className="space-y-2">
                            {toolGroup.count > 1 && (
                                <div className="steps-indicator mb-2">
                                    <ChevronUp size={12} />
                                    <span>{toolGroup.count} steps</span>
                                </div>
                            )}

                            {toolGroup.items.map((tool, j: number) => {
                                const blockId = tool.id || `tool-${i}-${j}`;
                                const isExpanded = expandedBlocks.has(blockId);

                                return (
                                    <div key={j} className="command-block">
                                        <div
                                            className="command-block-header"
                                            onClick={() => toggleBlock(blockId)}
                                        >
                                            <div className="flex items-center gap-2.5">
                                                <span className="text-stone-400 text-sm">⌘</span>
                                                <span className="text-sm text-stone-600 font-medium">{tool.name || 'Running command'}</span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                {tool.name === 'write_file' && (
                                                    <Download size={14} className="text-stone-400" />
                                                )}
                                                <ChevronDown
                                                    size={16}
                                                    className={`text-stone-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                                                />
                                            </div>
                                        </div>
                                        {isExpanded && (
                                            <div className="p-3 bg-stone-50 border-t border-stone-100">
                                                {/* For Context Skills (empty input), show a friendly message */}
                                                {Object.keys(tool.input || {}).length === 0 ? (
                                                    <div className="text-xs text-emerald-600 font-medium">
                                                        ✓ Skill loaded into context
                                                    </div>
                                                ) : (
                                                    <pre className="text-xs font-mono text-stone-500 whitespace-pre-wrap overflow-x-auto">
                                                        {JSON.stringify(tool.input, null, 2)}
                                                    </pre>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    );
                }

                return null;
            })}
        </div>
    );
}

function EmptyState({ mode, workingDir, onSelectFolder, onOpenSettings }: { 
    mode: Mode, 
    workingDir: string | null,
    onSelectFolder: () => void,
    onOpenSettings: () => void 
}) {
    const { t } = useI18n();

    const handleSelectFolder = async () => {
        onSelectFolder();
    };

    return (
        <div className="flex flex-col items-center justify-center h-full text-center space-y-4 py-20">
            <div className="w-16 h-16 rounded-2xl bg-white shadow-lg flex items-center justify-center rotate-3 border border-stone-100 overflow-hidden">
                <img src="./logo.png" alt="Logo" className="w-full h-full object-cover" />
            </div>
            <div className="space-y-3">
                <h2 className="text-xl font-semibold text-stone-800">
                    WorkBuddy
                </h2>
                {mode === 'work' && !workingDir ? (
                    <div className="space-y-3">
                        <p className="text-stone-500 text-sm max-w-xs">
                            请先选择一个工作目录来开始任务
                        </p>
                        <button
                            onClick={handleSelectFolder}
                            className="inline-flex items-center gap-2 px-4 py-2 bg-brand-500 text-white rounded-lg hover:bg-brand-600 transition-colors text-sm font-medium"
                        >
                            <FolderOpen size={16} />
                            选择工作目录
                        </button>
                        <p className="text-stone-400 text-xs">
                            或在
                            <button 
                                onClick={onOpenSettings}
                                className="text-brand-500 hover:underline mx-1"
                            >
                                设置
                            </button>
                            中配置 API Key
                        </p>
                    </div>
                ) : mode === 'work' && workingDir ? (
                    <p className="text-stone-500 text-sm max-w-xs">
                        工作目录: {workingDir.split(/[\\/]/).pop()}
                    </p>
                ) : (
                    <p className="text-stone-500 text-sm max-w-xs">
                        {t('startByDescribing')}
                    </p>
                )}
            </div>
        </div>
    );
}
