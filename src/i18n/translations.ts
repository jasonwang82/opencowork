export const translations = {
    en: {
        // Navigation
        cowork: 'Cowork',
        chat: 'Chat',
        settings: 'Settings',
        taskWorkspace: 'Task Workspace',
        chatAssistant: 'Chat Assistant',

        // Cowork View
        currentPlan: 'Current Plan',
        describeTask: 'Describe a task or a change...',
        noMessagesYet: 'No messages yet',
        startByDescribing: 'Start by describing what you want to accomplish',

        // Settings
        apiConfiguration: 'API Configuration',
        apiKey: 'API Key',
        apiKeyPlaceholder: 'sk-ant-api03-...',
        apiKeyHint: 'Your Anthropic API key. Get one at console.anthropic.com',
        apiUrl: 'API URL',
        apiUrlHint: 'Base URL for API requests. Use default unless using a proxy.',
        modelSelection: 'Model Selection',
        authorizedFolders: 'Authorized Folders',
        authorizedFoldersHint: 'Claude can only access files within these folders.',
        noFoldersYet: 'No folders authorized yet',
        addFolder: 'Add Folder',
        networkAccess: 'Network Access',
        allowNetworkAccess: 'Allow Network Access',
        networkAccessHint: 'Enable Claude to make web requests (for MCP, research, etc.)',
        save: 'Save',
        saved: 'Saved!',

        // Confirmation Dialog
        actionConfirmation: 'Action Confirmation',
        reviewBeforeProceeding: 'Review before proceeding',
        tool: 'Tool',
        description: 'Description',
        arguments: 'Arguments',
        deny: 'Deny',
        allow: 'Allow',

        // Artifacts
        generatedArtifacts: 'Generated Artifacts',
        filesGenerated: 'files generated',
        fileGenerated: 'file generated',

        // Theme
        appearance: 'Appearance',
        theme: 'Theme',
        light: 'Light',
        dark: 'Dark',
        system: 'System',
        accentColor: 'Accent Color',
        language: 'Language',

        // Models
        modelSonnet: 'Claude 3.5 Sonnet (Latest)',
        modelHaiku: 'Claude 3.5 Haiku (Fast)',
        modelOpus: 'Claude 3 Opus (Most Capable)',
        modelGLM4: 'GLM 4.7 (Custom)',
        
        // Integration Mode
        integrationMode: 'Integration Mode',
        apiMode: 'API Mode (Claude API)',
        cliMode: 'CLI Mode (CodeBuddy CLI)',
        sdkMode: 'SDK Mode (CodeBuddy SDK)',
        apiModeDescription: 'Use API to call AI models directly',
        cliModeDescription: 'Use CodeBuddy CLI tool (requires codebuddy command to be installed)',
        sdkModeDescription: 'Use CodeBuddy Agent SDK directly (recommended)',
        codeBuddyInstructions: 'CodeBuddy CLI Mode Instructions:',
        codeBuddyInstallRequired: 'Requires codebuddy command to be installed on your system',
        codeBuddyHelp: 'Run codebuddy --help to see available parameters',
        codeBuddyCompatible: 'CodeBuddy parameters are mostly compatible with Claude Code',
        codeBuddyEnvVars: 'API Key and model configuration can be passed via environment variables to codebuddy',
        sdkModeInstructions: 'CodeBuddy SDK Mode Instructions:',
        sdkModeEnvVars: 'Set CODEBUDDY_API_KEY and CODEBUDDY_INTERNET_ENVIRONMENT environment variables',
        sdkModeAutoAuth: 'Or use existing login credentials from codebuddy CLI',
        sdkModeRecommended: 'This mode provides better integration and streaming support',
        modelName: 'Model Name',
        modelNameDescription: 'Enter model name, e.g., MiniMax-M2.1',

        // Additional UI
        runningCommand: 'Running command',
        steps: 'steps',
        reply: 'Reply...',
        aiDisclaimer: 'AI can make mistakes. Please verify important information.',
        minimize: 'Minimize',
        expand: 'Expand',
        close: 'Close',
        openInExplorer: 'Open in Explorer',
    },
    zh: {
        // Navigation
        cowork: '协作',
        chat: '对话',
        settings: '设置',
        taskWorkspace: '任务工作区',
        chatAssistant: '对话助手',

        // Cowork View
        currentPlan: '当前计划',
        describeTask: '描述一个任务或变更...',
        noMessagesYet: '暂无消息',
        startByDescribing: '开始描述你想要完成的任务',

        // Settings
        apiConfiguration: 'API 配置',
        apiKey: 'API 密钥',
        apiKeyPlaceholder: 'sk-ant-api03-...',
        apiKeyHint: '你的 Anthropic API 密钥，可在 console.anthropic.com 获取',
        apiUrl: 'API 地址',
        apiUrlHint: 'API 请求的基础 URL，使用代理时可修改',
        modelSelection: '模型选择',
        authorizedFolders: '授权文件夹',
        authorizedFoldersHint: 'Claude 只能访问这些文件夹内的文件',
        noFoldersYet: '尚未授权任何文件夹',
        addFolder: '添加文件夹',
        networkAccess: '网络访问',
        allowNetworkAccess: '允许网络访问',
        networkAccessHint: '允许 Claude 进行网络请求（用于 MCP、研究等）',
        save: '保存',
        saved: '已保存！',

        // Confirmation Dialog
        actionConfirmation: '操作确认',
        reviewBeforeProceeding: '执行前请确认',
        tool: '工具',
        description: '描述',
        arguments: '参数',
        deny: '拒绝',
        allow: '允许',

        // Artifacts
        generatedArtifacts: '生成的文件',
        filesGenerated: '个文件已生成',
        fileGenerated: '个文件已生成',

        // Theme
        appearance: '外观',
        theme: '主题',
        light: '浅色',
        dark: '深色',
        system: '跟随系统',
        accentColor: '强调色',
        language: '语言',

        // Models
        modelSonnet: 'Claude 3.5 Sonnet (最新)',
        modelHaiku: 'Claude 3.5 Haiku (快速)',
        modelOpus: 'Claude 3 Opus (最强)',
        modelGLM4: 'GLM 4.7 (自定义)',
        
        // Integration Mode
        integrationMode: '接入方式',
        apiMode: 'API 模式 (Claude API)',
        cliMode: 'CLI 模式 (CodeBuddy CLI)',
        sdkMode: 'SDK 模式 (CodeBuddy SDK)',
        apiModeDescription: '使用 API 直接调用 AI 模型',
        cliModeDescription: '使用 CodeBuddy CLI 工具运行（需要先安装 codebuddy 命令）',
        sdkModeDescription: '使用 CodeBuddy Agent SDK 直接调用（推荐）',
        codeBuddyInstructions: 'CodeBuddy CLI 模式说明：',
        codeBuddyInstallRequired: '需要在系统中安装 codebuddy 命令',
        codeBuddyHelp: '执行 codebuddy --help 查看可用参数',
        codeBuddyCompatible: 'CodeBuddy 的参数与 Claude Code 基本一致',
        codeBuddyEnvVars: 'API Key 和模型配置可以通过环境变量传递给 codebuddy',
        sdkModeInstructions: 'CodeBuddy SDK 模式说明：',
        sdkModeEnvVars: '需设置 CODEBUDDY_API_KEY 和 CODEBUDDY_INTERNET_ENVIRONMENT 环境变量',
        sdkModeAutoAuth: '或使用 codebuddy CLI 的登录凭据自动认证',
        sdkModeRecommended: '此模式提供更好的集成和流式响应支持',
        modelName: '模型名称',
        modelNameDescription: '输入模型名称，如 MiniMax-M2.1',

        // Additional UI
        runningCommand: '正在执行命令',
        steps: '个步骤',
        reply: '回复...',
        aiDisclaimer: 'AI 可能会犯错，请核实重要信息。',
        minimize: '最小化',
        expand: '展开',
        close: '关闭',
        openInExplorer: '在资源管理器中打开',
    }
};

export type Language = keyof typeof translations;
export type TranslationKey = keyof typeof translations.en;
