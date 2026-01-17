import path from 'path';
import { configStore } from '../../config/ConfigStore';

export class PermissionManager {
    private authorizedFolders: Set<string> = new Set();
    private networkAccess: boolean = false;

    constructor() {
        // Load from persisted config
        const savedFolders = configStore.getAuthorizedFolders();
        savedFolders.forEach((f: string) => this.authorizedFolders.add(path.resolve(f)));
    }

    authorizeFolder(folderPath: string): boolean {
        const normalized = path.resolve(folderPath);
        // Security check: never allow root directories
        if (normalized === '/' || normalized === 'C:\\' || normalized.match(/^[A-Z]:\\$/)) {
            console.warn('Attempted to authorize root directory, denied.');
            return false;
        }
        this.authorizedFolders.add(normalized);
        console.log(`Authorized folder: ${normalized}`);
        return true;
    }

    revokeFolder(folderPath: string): void {
        const normalized = path.resolve(folderPath);
        this.authorizedFolders.delete(normalized);
    }

    isPathAuthorized(filePath: string): boolean {
        const normalized = path.resolve(filePath);
        for (const folder of this.authorizedFolders) {
            if (normalized.startsWith(folder)) {
                return true;
            }
        }
        return false;
    }

    getAuthorizedFolders(): string[] {
        return Array.from(this.authorizedFolders);
    }

    setNetworkAccess(enabled: boolean): void {
        this.networkAccess = enabled;
    }

    isNetworkAccessEnabled(): boolean {
        return this.networkAccess;
    }

    /**
     * Check if a command is blocked by the blacklist
     * @param command The command string to check
     * @returns true if the command is blocked, false otherwise
     */
    isCommandBlocked(command: string): boolean {
        const blacklist = configStore.getCommandBlacklist();
        const normalizedCommand = command.toLowerCase().trim();
        
        for (const blockedPattern of blacklist) {
            const pattern = blockedPattern.toLowerCase().trim();
            // Check if command contains the blocked pattern
            if (normalizedCommand.includes(pattern)) {
                console.warn(`[PermissionManager] Command blocked by blacklist: "${command}" matches pattern "${blockedPattern}"`);
                return true;
            }
        }
        return false;
    }

    /**
     * Get the reason why a command was blocked
     * @param command The command that was blocked
     * @returns The matching blacklist pattern, or null if not blocked
     */
    getBlockedReason(command: string): string | null {
        const blacklist = configStore.getCommandBlacklist();
        const normalizedCommand = command.toLowerCase().trim();
        
        for (const blockedPattern of blacklist) {
            const pattern = blockedPattern.toLowerCase().trim();
            if (normalizedCommand.includes(pattern)) {
                return blockedPattern;
            }
        }
        return null;
    }
}

export const permissionManager = new PermissionManager();
