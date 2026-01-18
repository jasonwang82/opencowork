import Store from 'electron-store';

export interface ToolPermission {
    tool: string;           // 'write_file', 'run_command', etc.
    pathPattern?: string;   // Optional: specific path or '*' for all
    grantedAt: number;      // Timestamp
}

export type IntegrationMode = 'api' | 'cli-codebuddy' | 'sdk-codebuddy';

// User info from CodeBuddy authentication
export interface UserInfo {
    userId: string;
    userName: string;
    userNickname: string;
    token: string;
    enterpriseId?: string;
    enterprise?: string;
}

export interface AppConfig {
    apiKey: string;
    apiUrl: string;
    model: string;
    authorizedFolders: string[];
    networkAccess: boolean;
    shortcut: string;
    allowedPermissions: ToolPermission[];
    integrationMode: IntegrationMode;
    codeBuddyApiKey: string;
    codeBuddyInternetEnv: string;
    commandBlacklist: string[];  // Commands that are not allowed to execute
    userInfo: UserInfo | null;   // Authenticated user info
    setupComplete: boolean;      // Whether first-time setup has been completed
}

// Default dangerous commands that should be blocked
const DEFAULT_COMMAND_BLACKLIST = [
    'rm -rf',
    'rm -r',
    'rm -fr',
    'rmdir',
    'format',
    'dd',
    'mkfs',
    ':>',       // Truncate file
    '> /dev/',  // Write to device
    'chmod 777',
    'chmod -R 777',
];

const defaults: AppConfig = {
    apiKey: '',
    apiUrl: 'https://api.minimaxi.com/anthropic',
    model: 'claude-opus-4.5',
    authorizedFolders: [],
    networkAccess: true, // "Open and use" implies network should be on
    shortcut: 'Alt+Space',
    allowedPermissions: [],
    integrationMode: 'sdk-codebuddy',  // Default to SDK mode
    codeBuddyApiKey: '',
    codeBuddyInternetEnv: 'ioa',
    commandBlacklist: DEFAULT_COMMAND_BLACKLIST,
    userInfo: null,
    setupComplete: false
};

class ConfigStore {
    private store: Store<AppConfig>;

    constructor() {
        this.store = new Store<AppConfig>({
            name: 'workbuddy-config',
            defaults
        });
    }

    get<K extends keyof AppConfig>(key: K): AppConfig[K] {
        return this.store.get(key);
    }

    set<K extends keyof AppConfig>(key: K, value: AppConfig[K]): void {
        this.store.set(key, value);
    }

    getAll(): AppConfig {
        const stored = this.store.store;
        // Return config with defaults applied
        return {
            ...stored,
            codeBuddyInternetEnv: this.getCodeBuddyInternetEnv()  // Use getter which has default 'ioa'
        };
    }

    // API Key
    getApiKey(): string {
        return this.store.get('apiKey') || process.env.ANTHROPIC_API_KEY || '';
    }

    setApiKey(key: string): void {
        this.store.set('apiKey', key);
    }

    // Model
    getModel(): string {
        return this.store.get('model');
    }

    setModel(model: string): void {
        this.store.set('model', model);
    }

    // API URL
    getApiUrl(): string {
        return this.store.get('apiUrl');
    }

    setApiUrl(url: string): void {
        this.store.set('apiUrl', url);
    }

    // Authorized Folders
    getAuthorizedFolders(): string[] {
        return this.store.get('authorizedFolders') || [];
    }

    addAuthorizedFolder(folder: string): void {
        const folders = this.getAuthorizedFolders();
        if (!folders.includes(folder)) {
            folders.push(folder);
            this.store.set('authorizedFolders', folders);
        }
    }

    removeAuthorizedFolder(folder: string): void {
        const folders = this.getAuthorizedFolders().filter(f => f !== folder);
        this.store.set('authorizedFolders', folders);
    }

    // Network Access
    getNetworkAccess(): boolean {
        return this.store.get('networkAccess');
    }

    setNetworkAccess(enabled: boolean): void {
        this.store.set('networkAccess', enabled);
    }

    // Tool Permissions
    getAllowedPermissions(): ToolPermission[] {
        return this.store.get('allowedPermissions') || [];
    }

    addPermission(tool: string, pathPattern?: string): void {
        const permissions = this.getAllowedPermissions();
        // Check if already exists
        const exists = permissions.some(p =>
            p.tool === tool && p.pathPattern === (pathPattern || '*')
        );
        if (!exists) {
            permissions.push({
                tool,
                pathPattern: pathPattern || '*',
                grantedAt: Date.now()
            });
            this.store.set('allowedPermissions', permissions);
        }
    }

    removePermission(tool: string, pathPattern?: string): void {
        const permissions = this.getAllowedPermissions().filter(p =>
            !(p.tool === tool && p.pathPattern === (pathPattern || '*'))
        );
        this.store.set('allowedPermissions', permissions);
    }

    hasPermission(tool: string, path?: string): boolean {
        const permissions = this.getAllowedPermissions();
        return permissions.some(p => {
            if (p.tool !== tool) return false;
            if (p.pathPattern === '*') return true;
            if (!path) return p.pathPattern === '*';
            // Check if path matches pattern (simple prefix match)
            return path.startsWith(p.pathPattern || '');
        });
    }

    clearAllPermissions(): void {
        this.store.set('allowedPermissions', []);
    }

    // Integration Mode
    getIntegrationMode(): IntegrationMode {
        return this.store.get('integrationMode') || 'sdk-codebuddy';
    }

    setIntegrationMode(mode: IntegrationMode): void {
        this.store.set('integrationMode', mode);
    }

    // CodeBuddy specific - UI values take priority over environment variables
    getCodeBuddyApiKey(): string {
        const storedKey = this.store.get('codeBuddyApiKey');
        if (storedKey && storedKey.trim() !== '') {
            return storedKey;
        }
        return process.env.CODEBUDDY_API_KEY || '';
    }

    setCodeBuddyApiKey(key: string): void {
        this.store.set('codeBuddyApiKey', key);
    }

    getCodeBuddyInternetEnv(): string {
        const storedEnv = this.store.get('codeBuddyInternetEnv');
        if (storedEnv && storedEnv.trim() !== '') {
            return storedEnv;
        }
        return process.env.CODEBUDDY_INTERNET_ENVIRONMENT || 'ioa';
    }

    setCodeBuddyInternetEnv(env: string): void {
        this.store.set('codeBuddyInternetEnv', env);
    }

    // Command Blacklist
    getCommandBlacklist(): string[] {
        return this.store.get('commandBlacklist') || DEFAULT_COMMAND_BLACKLIST;
    }

    setCommandBlacklist(commands: string[]): void {
        this.store.set('commandBlacklist', commands);
    }

    addToBlacklist(command: string): void {
        const blacklist = this.getCommandBlacklist();
        if (!blacklist.includes(command)) {
            blacklist.push(command);
            this.store.set('commandBlacklist', blacklist);
        }
    }

    removeFromBlacklist(command: string): void {
        const blacklist = this.getCommandBlacklist().filter(c => c !== command);
        this.store.set('commandBlacklist', blacklist);
    }

    resetBlacklistToDefault(): void {
        this.store.set('commandBlacklist', DEFAULT_COMMAND_BLACKLIST);
    }

    // User Authentication
    getUserInfo(): UserInfo | null {
        return this.store.get('userInfo') || null;
    }

    setUserInfo(userInfo: UserInfo | null): void {
        this.store.set('userInfo', userInfo);
    }

    isLoggedIn(): boolean {
        const userInfo = this.getUserInfo();
        return userInfo !== null && !!userInfo.token;
    }

    logout(): void {
        this.store.set('userInfo', null);
    }

    // Setup Complete
    isSetupComplete(): boolean {
        return this.store.get('setupComplete') || false;
    }

    setSetupComplete(complete: boolean): void {
        this.store.set('setupComplete', complete);
    }
}

export const configStore = new ConfigStore();
