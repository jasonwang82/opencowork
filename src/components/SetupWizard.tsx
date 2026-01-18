import { useState, useEffect } from 'react';
import { Check, Loader2, Sparkles, Cpu, FolderCheck, Rocket } from 'lucide-react';

interface SetupStep {
    id: string;
    title: string;
    description: string;
    icon: React.ReactNode;
}

const SETUP_STEPS: SetupStep[] = [
    {
        id: 'check-environment',
        title: '检查环境',
        description: '验证系统环境配置',
        icon: <Cpu size={20} />
    },
    {
        id: 'init-config',
        title: '初始化配置',
        description: '准备应用默认设置',
        icon: <FolderCheck size={20} />
    },
    {
        id: 'preload-sdk',
        title: '预热引擎',
        description: '加载 AI 处理引擎',
        icon: <Sparkles size={20} />
    },
    {
        id: 'verify-resources',
        title: '验证资源',
        description: '检查技能包和资源文件',
        icon: <FolderCheck size={20} />
    },
    {
        id: 'install-skills',
        title: '安装技能包',
        description: '下载并安装官方技能包',
        icon: <FolderCheck size={20} />
    },
    {
        id: 'complete',
        title: '准备就绪',
        description: '完成安装配置',
        icon: <Rocket size={20} />
    }
];

interface SetupWizardProps {
    onComplete: () => void;
}

export function SetupWizard({ onComplete }: SetupWizardProps) {
    const [currentStepIndex, setCurrentStepIndex] = useState(0);
    const [completedSteps, setCompletedSteps] = useState<string[]>([]);
    const [isRunning, setIsRunning] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        // Auto-start setup
        runSetup();
    }, []);

    const runSetup = async () => {
        setIsRunning(true);
        setError(null);

        for (let i = 0; i < SETUP_STEPS.length; i++) {
            const step = SETUP_STEPS[i];
            setCurrentStepIndex(i);

            try {
                // Add a small delay for visual feedback
                await new Promise(resolve => setTimeout(resolve, 500));
                
                const result = await window.ipcRenderer.invoke('setup:run-step', step.id) as {
                    success: boolean;
                    error?: string;
                    data?: unknown;
                };

                if (!result.success) {
                    throw new Error(result.error || '步骤执行失败');
                }

                setCompletedSteps(prev => [...prev, step.id]);
            } catch (err) {
                setError((err as Error).message);
                setIsRunning(false);
                return;
            }
        }

        setIsRunning(false);
        
        // Wait a moment before completing
        await new Promise(resolve => setTimeout(resolve, 800));
        onComplete();
    };

    const retrySetup = () => {
        setCompletedSteps([]);
        setCurrentStepIndex(0);
        setError(null);
        runSetup();
    };

    return (
        <div className="h-screen w-full bg-gradient-to-br from-brand-50 via-white to-amber-50 flex items-center justify-center p-8">
            <div className="max-w-md w-full">
                {/* Logo and Title */}
                <div className="text-center mb-8">
                    <div className="w-20 h-20 mx-auto mb-4 rounded-2xl bg-white shadow-lg flex items-center justify-center">
                        <img src="./logo.png" alt="WorkBuddy" className="w-12 h-12" />
                    </div>
                    <h1 className="text-2xl font-bold text-stone-800 mb-2">欢迎使用 WorkBuddy</h1>
                    <p className="text-stone-500">正在为您准备工作环境...</p>
                </div>

                {/* Progress Steps */}
                <div className="bg-white rounded-2xl shadow-xl p-6 space-y-4">
                    {SETUP_STEPS.map((step, index) => {
                        const isCompleted = completedSteps.includes(step.id);
                        const isCurrent = index === currentStepIndex && isRunning;

                        return (
                            <div
                                key={step.id}
                                className={`flex items-center gap-4 p-3 rounded-xl transition-all duration-300 ${
                                    isCurrent 
                                        ? 'bg-brand-50 border border-brand-200' 
                                        : isCompleted 
                                            ? 'bg-green-50' 
                                            : 'opacity-50'
                                }`}
                            >
                                <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                                    isCompleted 
                                        ? 'bg-green-500 text-white' 
                                        : isCurrent 
                                            ? 'bg-brand-500 text-white' 
                                            : 'bg-stone-200 text-stone-400'
                                }`}>
                                    {isCompleted ? (
                                        <Check size={20} />
                                    ) : isCurrent ? (
                                        <Loader2 size={20} className="animate-spin" />
                                    ) : (
                                        step.icon
                                    )}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className={`font-medium ${
                                        isCompleted 
                                            ? 'text-green-700' 
                                            : isCurrent 
                                                ? 'text-brand-700' 
                                                : 'text-stone-400'
                                    }`}>
                                        {step.title}
                                    </div>
                                    <div className={`text-sm ${
                                        isCompleted || isCurrent ? 'text-stone-500' : 'text-stone-400'
                                    }`}>
                                        {step.description}
                                    </div>
                                </div>
                            </div>
                        );
                    })}

                    {/* Error State */}
                    {error && (
                        <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-xl">
                            <p className="text-red-700 text-sm mb-3">{error}</p>
                            <button
                                onClick={retrySetup}
                                className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors text-sm font-medium"
                            >
                                重试
                            </button>
                        </div>
                    )}

                    {/* Progress Bar */}
                    <div className="mt-4">
                        <div className="h-1.5 bg-stone-200 rounded-full overflow-hidden">
                            <div 
                                className="h-full bg-gradient-to-r from-brand-400 to-brand-600 transition-all duration-500 ease-out"
                                style={{ 
                                    width: `${((completedSteps.length) / SETUP_STEPS.length) * 100}%` 
                                }}
                            />
                        </div>
                        <p className="text-center text-sm text-stone-400 mt-2">
                            {completedSteps.length} / {SETUP_STEPS.length} 完成
                        </p>
                    </div>
                </div>

                {/* Footer */}
                <p className="text-center text-xs text-stone-400 mt-6">
                    首次启动需要初始化，请稍候...
                </p>
            </div>
        </div>
    );
}

