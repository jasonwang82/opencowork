/**
 * CodeBuddy Plugin Manager
 *
 * Provides programmatic access to manage marketplaces and plugins
 * by directly manipulating ~/.codebuddy/settings.json
 *
 * @example
 * ```typescript
 * import { installMarketplace, installPlugin, enablePlugin } from '@genie/agent-sdk-js';
 *
 * // Install a marketplace
 * await installMarketplace({
 *   name: 'claude-plugins-official',
 *   repo: 'anthropics/claude-plugins-official',
 * });
 *
 * // Install and enable a plugin
 * await installPlugin({
 *   name: 'typescript-lsp',
 *   marketplace: 'claude-plugins-official',
 * });
 * ```
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ============= Types =============

/**
 * Marketplace source configuration (GitHub only)
 */
export interface MarketplaceSource {
    source: 'github';
    repo: string;
}

/**
 * Marketplace configuration item
 */
export interface MarketplaceConfigItem {
    source: MarketplaceSource;
    autoUpdate?: boolean;
}

/**
 * Options for installing a marketplace
 */
export interface InstallMarketplaceOptions {
    /** Marketplace name (identifier) */
    name: string;
    /** GitHub repository in format "owner/repo" */
    repo: string;
    /** Enable auto-update (default: true) */
    autoUpdate?: boolean;
}

/**
 * Options for removing a marketplace
 */
export interface RemoveMarketplaceOptions {
    /** Marketplace name to remove */
    name: string;
    /** Also remove all plugins from this marketplace (default: true) */
    removePlugins?: boolean;
}

/**
 * Options for installing a plugin
 */
export interface InstallPluginOptions {
    /** Plugin name */
    name: string;
    /** Marketplace name where the plugin is from */
    marketplace: string;
}

/**
 * Result of a settings operation
 */
export interface SettingsOperationResult {
    success: boolean;
    message: string;
}

// ============= Internal Types =============

interface MarketplaceConfig {
    [marketplaceName: string]: MarketplaceConfigItem;
}

interface EnabledPlugins {
    [pluginId: string]: boolean;
}

interface CodeBuddySettings {
    extraKnownMarketplaces?: MarketplaceConfig;
    enabledPlugins?: EnabledPlugins;
    [key: string]: unknown;
}

interface KnownMarketplaces {
    [marketplaceName: string]: unknown;
}

// ============= Internal Helpers =============

function getCodebuddyDir(): string {
    return path.join(os.homedir(), '.codebuddy');
}

function getSettingsPath(): string {
    return path.join(getCodebuddyDir(), 'settings.json');
}

function getKnownMarketplacesPath(): string {
    return path.join(getCodebuddyDir(), 'plugins', 'known_marketplaces.json');
}

function ensureSettingsDir(): void {
    const settingsDir = path.dirname(getSettingsPath());
    if (!fs.existsSync(settingsDir)) {
        fs.mkdirSync(settingsDir, { recursive: true });
    }
}

function readSettings(): CodeBuddySettings {
    const settingsPath = getSettingsPath();
    if (!fs.existsSync(settingsPath)) {
        return {};
    }
    try {
        const content = fs.readFileSync(settingsPath, 'utf-8');
        return JSON.parse(content) as CodeBuddySettings;
    } catch {
        return {};
    }
}

function writeSettings(settings: CodeBuddySettings): void {
    ensureSettingsDir();
    const settingsPath = getSettingsPath();
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
}

function readKnownMarketplaces(): KnownMarketplaces {
    const filePath = getKnownMarketplacesPath();
    if (!fs.existsSync(filePath)) {
        return {};
    }
    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        return JSON.parse(content) as KnownMarketplaces;
    } catch {
        return {};
    }
}

function writeKnownMarketplaces(data: KnownMarketplaces): void {
    const filePath = getKnownMarketplacesPath();
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

function getPluginId(name: string, marketplace: string): string {
    return `${name}@${marketplace}`;
}

// ============= Marketplace API =============

/**
 * Install a marketplace by adding it to extraKnownMarketplaces
 *
 * @param options - Installation options
 * @returns Operation result
 *
 * @example
 * ```typescript
 * await installMarketplace({
 *   name: 'claude-plugins-official',
 *   repo: 'anthropics/claude-plugins-official',
 * });
 * ```
 */
export async function installMarketplace(options: InstallMarketplaceOptions): Promise<SettingsOperationResult> {
    const { name, repo, autoUpdate = true } = options;

    if (!name || !repo) {
        return {
            success: false,
            message: 'Marketplace name and repo are required',
        };
    }

    if (!repo.includes('/')) {
        return {
            success: false,
            message: 'Repo must be in format "owner/repo"',
        };
    }

    const settings = readSettings();

    if (!settings.extraKnownMarketplaces) {
        settings.extraKnownMarketplaces = {};
    }

    if (settings.extraKnownMarketplaces[name]) {
        return {
            success: false,
            message: `Marketplace "${name}" already exists`,
        };
    }

    settings.extraKnownMarketplaces[name] = {
        source: {
            source: 'github',
            repo,
        },
        autoUpdate,
    };

    writeSettings(settings);

    return {
        success: true,
        message: `Marketplace "${name}" installed successfully`,
    };
}

/**
 * Remove a marketplace from settings and known_marketplaces.json
 *
 * @param options - Removal options
 * @returns Operation result
 *
 * @example
 * ```typescript
 * await removeMarketplace({ name: 'team-marketplace' });
 * ```
 */
export async function removeMarketplace(options: RemoveMarketplaceOptions): Promise<SettingsOperationResult> {
    const { name, removePlugins = true } = options;

    if (!name) {
        return {
            success: false,
            message: 'Marketplace name is required',
        };
    }

    const settings = readSettings();
    const knownMarketplaces = readKnownMarketplaces();

    // Check if marketplace exists in either location
    const inSettings = settings.extraKnownMarketplaces?.[name];
    const inKnown = knownMarketplaces[name];

    if (!inSettings && !inKnown) {
        return {
            success: false,
            message: `Marketplace "${name}" not found`,
        };
    }

    // Remove from settings.json
    if (settings.extraKnownMarketplaces && settings.extraKnownMarketplaces[name]) {
        delete settings.extraKnownMarketplaces[name];
        if (Object.keys(settings.extraKnownMarketplaces).length === 0) {
            delete settings.extraKnownMarketplaces;
        }
    }

    // Remove plugins from settings if requested
    if (removePlugins && settings.enabledPlugins) {
        const pluginIds = Object.keys(settings.enabledPlugins);
        for (const pluginId of pluginIds) {
            if (pluginId.endsWith(`@${name}`)) {
                delete settings.enabledPlugins[pluginId];
            }
        }
        if (Object.keys(settings.enabledPlugins).length === 0) {
            delete settings.enabledPlugins;
        }
    }

    writeSettings(settings);

    // Remove from known_marketplaces.json
    if (knownMarketplaces[name]) {
        delete knownMarketplaces[name];
        writeKnownMarketplaces(knownMarketplaces);
    }

    return {
        success: true,
        message: `Marketplace "${name}" removed successfully`,
    };
}

// ============= Plugin API =============

/**
 * Install and enable a plugin
 *
 * @param options - Installation options
 * @returns Operation result
 *
 * @example
 * ```typescript
 * await installPlugin({
 *   name: 'typescript-lsp',
 *   marketplace: 'claude-plugins-official',
 * });
 * ```
 */
export async function installPlugin(options: InstallPluginOptions): Promise<SettingsOperationResult> {
    const { name, marketplace } = options;

    if (!name || !marketplace) {
        return {
            success: false,
            message: 'Plugin name and marketplace are required',
        };
    }

    const pluginId = getPluginId(name, marketplace);
    const settings = readSettings();

    if (!settings.enabledPlugins) {
        settings.enabledPlugins = {};
    }

    settings.enabledPlugins[pluginId] = true;

    writeSettings(settings);

    return {
        success: true,
        message: `Plugin "${pluginId}" installed and enabled successfully`,
    };
}

/**
 * Enable a plugin
 *
 * @param name - Plugin name
 * @param marketplace - Marketplace name
 * @returns Operation result
 *
 * @example
 * ```typescript
 * await enablePlugin('typescript-lsp', 'claude-plugins-official');
 * ```
 */
export async function enablePlugin(name: string, marketplace: string): Promise<SettingsOperationResult> {
    return installPlugin({ name, marketplace });
}

/**
 * Disable a plugin
 *
 * @param name - Plugin name
 * @param marketplace - Marketplace name
 * @returns Operation result
 *
 * @example
 * ```typescript
 * await disablePlugin('typescript-lsp', 'claude-plugins-official');
 * ```
 */
export async function disablePlugin(name: string, marketplace: string): Promise<SettingsOperationResult> {
    if (!name || !marketplace) {
        return {
            success: false,
            message: 'Plugin name and marketplace are required',
        };
    }

    const pluginId = getPluginId(name, marketplace);
    const settings = readSettings();

    if (!settings.enabledPlugins) {
        settings.enabledPlugins = {};
    }

    settings.enabledPlugins[pluginId] = false;

    writeSettings(settings);

    return {
        success: true,
        message: `Plugin "${pluginId}" disabled successfully`,
    };
}
