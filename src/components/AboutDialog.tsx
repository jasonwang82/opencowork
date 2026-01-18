import { useState, useEffect } from 'react';
import { X } from 'lucide-react';

interface AboutDialogProps {
    isOpen: boolean;
    onClose: () => void;
}

interface AppInfo {
    name: string;
    version: string;
    description: string;
    integrationMode: string;
}

export function AboutDialog({ isOpen, onClose }: AboutDialogProps) {
    const [appInfo, setAppInfo] = useState<AppInfo | null>(null);

    useEffect(() => {
        if (isOpen) {
            window.ipcRenderer.invoke('app:get-info').then((info) => {
                setAppInfo(info as AppInfo);
            }).catch(err => {
                console.error('Failed to get app info:', err);
                // Fallback values
                setAppInfo({
                    name: 'WorkBuddy',
                    version: '1.0.0',
                    description: 'WorkBuddy - 你的数字工友',
                    integrationMode: '未知'
                });
            });
        }
    }, [isOpen]);

    if (!isOpen || !appInfo) return null;

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                {/* Header */}
                <div className="relative bg-gradient-to-br from-purple-500/10 to-blue-500/10 p-6 border-b border-stone-200">
                    <button
                        onClick={onClose}
                        className="absolute top-4 right-4 p-1.5 text-stone-400 hover:text-stone-600 hover:bg-stone-100 rounded-lg transition-colors"
                    >
                        <X size={18} />
                    </button>
                    <div className="flex items-center gap-4">
                        <div className="w-16 h-16 rounded-2xl bg-white shadow-lg flex items-center justify-center border border-stone-100 overflow-hidden">
                            <img src="./logo.png" alt="WorkBuddy Logo" className="w-full h-full object-cover" />
                        </div>
                        <div className="flex-1">
                            <h2 className="text-2xl font-bold text-stone-800">{appInfo.name}</h2>
                            <p className="text-sm text-stone-500 mt-1">版本 {appInfo.version}</p>
                        </div>
                    </div>
                </div>

                {/* Body */}
                <div className="p-6 space-y-4">
                    <div>
                        <p className="text-stone-700 leading-relaxed">{appInfo.description}</p>
                    </div>

                    <div className="space-y-2 pt-2 border-t border-stone-100">
                        <div className="flex items-start justify-between">
                            <span className="text-sm text-stone-500">当前登录环境</span>
                            <span className="text-sm text-stone-700 font-medium">{appInfo.integrationMode}</span>
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="px-6 py-4 border-t border-stone-200 bg-stone-50/50">
                    <button
                        onClick={onClose}
                        className="w-full px-4 py-2.5 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors font-medium"
                    >
                        确定
                    </button>
                </div>
            </div>
        </div>
    );
}

