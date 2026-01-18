import { app, BrowserWindow, shell, ipcMain, screen, dialog, globalShortcut, Tray, Menu, nativeImage } from 'electron'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import https from 'node:https'
import { spawn, exec, execSync } from 'node:child_process'
import dotenv from 'dotenv'
import { agentManager } from './agent/AgentManager'
import { configStore, type UserInfo } from './config/ConfigStore'
import { sessionStore } from './config/SessionStore'
import { logger, getLogs, clearLogs } from './utils/logger'
import { permissionManager } from './agent/security/PermissionManager'
import Anthropic from '@anthropic-ai/sdk'
import type { AuthEnvironment } from '@tencent-ai/agent-sdk'
import AdmZip from 'adm-zip'

const require = createRequire(import.meta.url)

// Extend App type to include isQuitting property
declare global {
  namespace Electron {
    interface App {
      isQuitting?: boolean
    }
  }
}

dotenv.config()

// Helper function to get correct path for public assets
function getPublicAssetPath(filename: string): string {
  if (app.isPackaged) {
    // In production, try multiple possible paths
    const possiblePaths = [
      path.join(app.getAppPath(), 'dist', filename),
      path.join(app.getAppPath(), filename),
      path.join(process.resourcesPath, 'dist', filename),
      path.join(process.resourcesPath, filename),
      path.join(__dirname, '..', 'dist', filename),
      path.join(__dirname, filename),
    ]
    
    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        console.log(`[getPublicAssetPath] Found ${filename} at: ${p}`)
        return p
      }
    }
    
    // Fallback to first path even if not found
    console.warn(`[getPublicAssetPath] Could not find ${filename}, tried paths:`, possiblePaths)
    return possiblePaths[0]
  } else {
    // In development, use VITE_PUBLIC
    return path.join(process.env.VITE_PUBLIC || '', filename)
  }
}

// Use shared logger - wrapper functions
const addLog = (message: string, data?: unknown) => logger.info(message, data)
const logError = (message: string, data?: unknown) => logger.error(message, data)
const logWarn = (message: string, data?: unknown) => logger.warn(message, data)

// GPU crash protection - disable GPU acceleration to prevent crashes
app.disableHardwareAcceleration()
app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('disable-gpu-compositing')
app.commandLine.appendSwitch('disable-gpu-sandbox')
app.commandLine.appendSwitch('disable-software-rasterizer')
app.commandLine.appendSwitch('no-sandbox')
app.commandLine.appendSwitch('ignore-gpu-blacklist')
app.commandLine.appendSwitch('disable-gpu-driver-bug-workarounds')

// Disable default error dialog - handle errors silently
dialog.showErrorBox = (title: string, content: string) => {
  console.error(`[Main] Error Dialog Suppressed - ${title}: ${content}`)
}

// Global error handlers to prevent crashes
process.on('uncaughtException', (error) => {
  console.error('[Main] Uncaught Exception:', error)
  // Don't exit, just log
})

process.on('unhandledRejection', (reason, promise) => {
  console.error('[Main] Unhandled Rejection at:', promise, 'reason:', reason)
  // Don't exit, just log
})

const __dirname = path.dirname(fileURLToPath(import.meta.url))

process.env.APP_ROOT = path.join(__dirname, '..')

export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

// [Fix] Set specific userData path for dev mode to avoid permission/locking issues
if (VITE_DEV_SERVER_URL) {
  const devUserData = path.join(process.env.APP_ROOT, '.vscode', 'electron-userdata');
  if (!fs.existsSync(devUserData)) {
    fs.mkdirSync(devUserData, { recursive: true });
  }
  app.setPath('userData', devUserData);
}

// Set application name early (before app.whenReady) to ensure menu bar shows "WorkBuddy"
// This MUST be called as early as possible for macOS to pick up the correct name
app.setName('WorkBuddy')

// Internal MCP Server Runner
// MiniMax startup removed
// --- Normal App Initialization ---

let mainWin: BrowserWindow | null = null
let floatingBallWin: BrowserWindow | null = null
let tray: Tray | null = null
// Note: agent instances are now managed by AgentManager, one per session

// Ball state
let isBallExpanded = false
const BALL_SIZE = 64
const EXPANDED_WIDTH = 340    // Match w-80 (320px) + padding
const EXPANDED_HEIGHT = 320   // Compact height for less dramatic expansion

app.on('before-quit', () => {
  app.isQuitting = true
  // Clean up all agents on quit
  agentManager.destroyAll()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  // On macOS, re-create a window when dock icon is clicked and no windows are open
  const sessionWindows = BrowserWindow.getAllWindows().filter(w => w !== floatingBallWin)
  if (sessionWindows.length === 0) {
    createSessionWindow()
  } else {
    // Show the first available window
    sessionWindows[0].show()
    sessionWindows[0].focus()
  }
})

// Handle GPU process crash - prevent app from crashing
app.on('gpu-process-crashed' as any, (_event: unknown, killed: boolean) => {
  console.error('[Main] GPU process crashed, killed:', killed)
  // Don't quit the app, let it continue without GPU
})

// Handle child process crash
app.on('child-process-gone', (_event: unknown, details: { type: string; reason: string }) => {
  console.error('[Main] Child process gone:', details.type, details.reason)
  // Don't quit for GPU crashes
  if (details.type === 'GPU') {
    console.log('[Main] GPU process crashed, app will continue...')
  }
})

app.whenReady().then(() => {
  // Export stored API keys to environment variables
  try {
    const storedCodeBuddyApiKey = configStore.getCodeBuddyApiKey()
    const storedCodeBuddyInternetEnv = configStore.getCodeBuddyInternetEnv()
    const storedAnthropicApiKey = configStore.getApiKey()
    
    if (storedCodeBuddyApiKey && storedCodeBuddyApiKey.trim() !== '') {
      process.env.CODEBUDDY_API_KEY = storedCodeBuddyApiKey
      console.log('[main] Exported CODEBUDDY_API_KEY from stored config on startup')
    }
    if (storedCodeBuddyInternetEnv) {
      process.env.CODEBUDDY_INTERNET_ENVIRONMENT = storedCodeBuddyInternetEnv
      console.log('[main] Exported CODEBUDDY_INTERNET_ENVIRONMENT:', storedCodeBuddyInternetEnv)
    }
    if (storedAnthropicApiKey && storedAnthropicApiKey.trim() !== '') {
      process.env.ANTHROPIC_API_KEY = storedAnthropicApiKey
      console.log('[main] Exported ANTHROPIC_API_KEY from stored config on startup')
    }
  } catch (err) {
    console.error('[main] Failed to export stored API keys on startup:', err)
  }

  // Log startup info for debugging
  addLog('App starting', {
    isPackaged: app.isPackaged,
    appPath: app.getAppPath(),
    resourcesPath: process.resourcesPath,
    __dirname,
    platform: process.platform,
    version: app.getVersion()
  })

  // Set App User Model ID for Windows notifications
  app.setAppUserModelId('com.workbuddy.app')

  // Set app icon for macOS dock
  if (process.platform === 'darwin') {
    const logoPath = getPublicAssetPath('logo.png')
    addLog('Setting dock icon from path', { logoPath, isPackaged: app.isPackaged })
    const appIcon = nativeImage.createFromPath(logoPath)
    if (!appIcon.isEmpty()) {
      app.dock.setIcon(appIcon)
      addLog('Dock icon set successfully')
    } else {
      logWarn('Dock icon is empty, file may not exist', { logoPath })
    }
  }

  // Register Protocol Client
  if (app.isPackaged) {
    app.setAsDefaultProtocolClient('workbuddy')
  } else {
    console.log('Skipping protocol registration in Dev mode.')
  }

  // 1. Setup IPC handlers FIRST
  // 1. Setup IPC handlers FIRST
  // setupIPCHandlers() - handlers are defined at top level now

  // 2. Create windows (each window is registered with AgentManager in createSessionWindow)
  createMainWindow()
  createFloatingBallWindow()

  // 3. Set up floating ball with AgentManager
  if (floatingBallWin) {
    agentManager.setFloatingBallWindow(floatingBallWin)
  }

  // 4. Create application menu (macOS)
  if (process.platform === 'darwin') {
    const template: Electron.MenuItemConstructorOptions[] = [
      {
        label: 'WorkBuddy',
        submenu: [
          {
            label: 'About WorkBuddy',
            click: () => {
              // Send event to renderer to show About dialog
              BrowserWindow.getAllWindows().forEach(win => {
                win.webContents.send('app:show-about')
              })
            }
          },
          { type: 'separator' },
          {
            label: 'Services',
            role: 'services',
            submenu: []
          },
          { type: 'separator' },
          {
            label: 'Hide WorkBuddy',
            accelerator: 'Command+H',
            role: 'hide'
          },
          {
            label: 'Hide Others',
            accelerator: 'Command+Shift+H',
            role: 'hideOthers'
          },
          {
            label: 'Show All',
            role: 'unhide'
          },
          { type: 'separator' },
          {
            label: 'Quit WorkBuddy',
            accelerator: 'Command+Q',
            click: () => {
              app.quit()
            }
          }
        ]
      },
      {
        label: 'Edit',
        submenu: [
          { label: 'Undo', accelerator: 'Command+Z', role: 'undo' },
          { label: 'Redo', accelerator: 'Shift+Command+Z', role: 'redo' },
          { type: 'separator' },
          { label: 'Cut', accelerator: 'Command+X', role: 'cut' },
          { label: 'Copy', accelerator: 'Command+C', role: 'copy' },
          { label: 'Paste', accelerator: 'Command+V', role: 'paste' },
          { label: 'Select All', accelerator: 'Command+A', role: 'selectAll' }
        ]
      },
      {
        label: 'Window',
        submenu: [
          { label: 'Minimize', accelerator: 'Command+M', role: 'minimize' },
          { label: 'Close', accelerator: 'Command+W', role: 'close' },
          { type: 'separator' },
          { label: 'Bring All to Front', role: 'front' }
        ]
      }
    ]

    const menu = Menu.buildFromTemplate(template)
    Menu.setApplicationMenu(menu)
  }

  // 5. Register keyboard shortcut for new window (Cmd/Ctrl+N)
  globalShortcut.register('CommandOrControl+N', () => {
    console.log('[main] Cmd/Ctrl+N pressed - creating new window')
    createSessionWindow()
  })

  // 6. Create system tray
  createTray()

  // 5. Register global shortcut
  globalShortcut.register('Alt+Space', () => {
    if (floatingBallWin) {
      if (floatingBallWin.isVisible()) {
        if (isBallExpanded) {
          toggleFloatingBallExpanded()
        }
        floatingBallWin.hide()
      } else {
        floatingBallWin.show()
        floatingBallWin.focus()
      }
    }
  })

  // Show main window in dev mode
  if (VITE_DEV_SERVER_URL) {
    mainWin?.show()
  }

  console.log('WorkBuddy started. Press Alt+Space to toggle floating ball.')

  // 7. Auto-login check on startup
  // We delay this slightly to allow windows to be ready
  setTimeout(async () => {
    const isLoggedIn = configStore.isLoggedIn()
    console.log('[Main] Checking auth status on startup, isLoggedIn:', isLoggedIn)
    
    if (!isLoggedIn) {
      console.log('[Main] Not logged in, user will need to click login button')
      // Don't auto-login on startup - let user click the login button
      // This avoids blocking the main process and provides better UX
      broadcastUserChange(null)
    } else {
      // Broadcast existing user info to windows
      const userInfo = configStore.getUserInfo()
      console.log('[Main] Already logged in as:', userInfo?.userName)
      console.log('[Main] User info:', userInfo)
      broadcastUserChange(userInfo)
    }
  }, 2000)
})


//Functions defined outside the block to ensure proper hoisiting and scope access (vars are global to file)

// IPC Handlers

ipcMain.handle('agent:send-message', async (_event, payload: { sessionId: string, message: string | { content: string, images: string[] } }) => {
  const { sessionId, message } = payload
  logger.info('Processing message', { 
    sessionId, 
    messageType: typeof message === 'string' ? 'text' : 'multimodal',
    messageLength: typeof message === 'string' ? message.length : message.content.length
  })
  
  const agent = agentManager.getOrCreateAgent(sessionId)
  if (!agent) {
    const error = 'Agent not initialized'
    logger.error('Failed to process message: agent not initialized', { 
      sessionId,
      registeredSessions: agentManager.getAllSessionWindows().map(s => s.sessionId)
    })
    throw new Error(error)
  }
  
  // Fire and forget - don't block the main process
  // Results are streamed via IPC events (agent:stream-token, agent:history-update)
  agent.processUserMessage(message).catch(err => {
    const error = err as Error
    logger.error('Message processing error', { 
      sessionId, 
      error: error.message, 
      stack: error.stack 
    })
    // Broadcast error to renderer
    const win = agentManager.getWindowForSession(sessionId)
    if (win && !win.isDestroyed()) {
      win.webContents.send('agent:error', error.message || 'Message processing failed')
      win.webContents.send('agent:complete', null)
    }
  })
  
  return { success: true }
})

ipcMain.handle('agent:abort', (_, sessionId?: string) => {
  if (sessionId) {
    // Abort specific session
    const agent = agentManager.getAgent(sessionId)
    agent?.abort()
  } else {
    // Fallback: abort current session (legacy support)
    const currentId = sessionStore.getCurrentSessionId()
    if (currentId) {
      const agent = agentManager.getAgent(currentId)
      agent?.abort()
    }
  }
})

// Clear history for a session (used when clicking the trash button)
ipcMain.handle('agent:clear-history', (_, sessionId?: string, mode?: 'chat' | 'work') => {
  const targetSessionId = sessionId || sessionStore.getCurrentSessionId()
  if (targetSessionId) {
    const agent = agentManager.getAgent(targetSessionId)
    if (agent) {
      agent.clearHistory()
      logger.info('Cleared history for session', { sessionId: targetSessionId, mode })
    }
    // Clear the session messages in the store for the specific mode
    if (mode) {
      sessionStore.updateSessionByMode(targetSessionId, mode, [])
    } else {
      // Legacy: clear both modes
      sessionStore.updateSessionByMode(targetSessionId, 'chat', [])
      sessionStore.updateSessionByMode(targetSessionId, 'work', [])
    }
  }
  return { success: true }
})

ipcMain.handle('agent:confirm-response', (_, { id, approved, remember, tool, path, sessionId }: { id: string, approved: boolean, remember?: boolean, tool?: string, path?: string, sessionId?: string }) => {
  if (approved && remember && tool) {
    configStore.addPermission(tool, path)
    console.log(`[Permission] Saved: ${tool} for path: ${path || '*'}`)
  }
  // Find the right agent - use sessionId if provided, otherwise use current
  const targetSessionId = sessionId || sessionStore.getCurrentSessionId()
  if (targetSessionId) {
    const agent = agentManager.getAgent(targetSessionId)
    agent?.handleConfirmResponse(id, approved)
  }
})

// Create a new session window (multi-window mode)
ipcMain.handle('window:new-session', () => {
  console.log('[main] Creating new session window...')
  const win = createSessionWindow()
  return { success: true, windowId: win.id }
})

// Create new window with a specific folder as working directory
ipcMain.handle('window:new-with-folder', async (_, folderPath: string) => {
  logger.info('Creating new window with folder', { folderPath })
  
  // Create a new session with folder name as title
  const folderName = folderPath.split(/[\\/]/).pop() || '新会话'
  const session = sessionStore.createSession(`工作区: ${folderName}`)
  
  // Set this folder as the primary working directory
  const folders = configStore.getAll().authorizedFolders || []
  const newFolders = [folderPath, ...folders.filter(f => f !== folderPath)]
  configStore.set('authorizedFolders', newFolders)
  permissionManager.syncFromConfig()
  
  // Create the window with this session
  const win = createSessionWindow(session.id)
  
  logger.info('New window created with folder', { 
    windowId: win.id, 
    sessionId: session.id, 
    folderPath 
  })
  
  return { success: true, windowId: win.id, sessionId: session.id }
})

// Legacy handler for compatibility - now creates a new window
ipcMain.handle('agent:new-session', () => {
  console.log('[main] agent:new-session - creating new window...')
  const win = createSessionWindow()
  return { success: true, windowId: win.id }
})

// Get app information for About dialog
ipcMain.handle('app:get-info', () => {
  const packageJson = require('../package.json')
  const integrationMode = configStore.getIntegrationMode()
  
  // Map integration mode to display name
  const integrationModeNames: Record<string, string> = {
    'api': 'API 模式',
    'cli-codebuddy': 'CodeBuddy CLI 模式',
    'sdk-codebuddy': 'CodeBuddy SDK 模式'
  }
  
  return {
    name: 'WorkBuddy',
    version: app.getVersion() || packageJson.version,
    description: 'WorkBuddy - 你的数字工友',
    integrationMode: integrationModeNames[integrationMode] || integrationMode
  }
})

// Session Management
ipcMain.handle('session:list', () => {
  return sessionStore.getSessions()
})

ipcMain.handle('session:get', (_, id: string) => {
  const session = sessionStore.getSession(id)
  if (session) {
    return {
      ...session,
      chatMessages: session.chatMessages || [],
      workMessages: session.workMessages || session.messages || []
    }
  }
  return null
})

ipcMain.handle('session:load', (_, id: string) => {
  const session = sessionStore.getSession(id)
  if (session) {
    // Get or create agent for this session
    const agent = agentManager.getOrCreateAgent(id)
    if (agent) {
      agent.loadHistory(session.messages)
      sessionStore.setCurrentSession(id)
      return { success: true }
    }
  }
  return { error: 'Session not found' }
})

ipcMain.handle('session:save', (_, messages: Anthropic.MessageParam[], mode?: 'chat' | 'work') => {
  const currentId = sessionStore.getCurrentSessionId()
  if (currentId) {
    if (mode) {
      sessionStore.updateSessionByMode(currentId, mode, messages)
    } else {
      // Legacy fallback - save to work mode by default
      sessionStore.updateSessionByMode(currentId, 'work', messages)
    }
    return { success: true }
  }
  // Create new session if none exists
  const session = sessionStore.createSession()
  if (mode) {
    sessionStore.updateSessionByMode(session.id, mode, messages)
  } else {
    sessionStore.updateSessionByMode(session.id, 'work', messages)
  }
  return { success: true, sessionId: session.id }
})

ipcMain.handle('session:delete', (_, id: string) => {
  // Destroy the agent for this session if it exists
  agentManager.destroyAgent(id)
  sessionStore.deleteSession(id)
  return { success: true }
})

ipcMain.handle('session:clear-all', () => {
  // Destroy all agents
  agentManager.destroyAll()
  // Clear all sessions
  sessionStore.clearAllSessions()
  // Create a new empty session
  const newSessionId = sessionStore.createSession()
  return { success: true, newSessionId }
})

ipcMain.handle('session:current', () => {
  const id = sessionStore.getCurrentSessionId()
  if (id) {
    const session = sessionStore.getSession(id)
    if (session) {
      return {
        ...session,
        chatMessages: session.chatMessages || [],
        workMessages: session.workMessages || session.messages || []
      }
    }
  }
  return null
})

// Session switch - with multi-agent concurrency, each session has its own agent
// We just need to save current session and switch the active session ID
ipcMain.handle('session:switch', async (_, targetSessionId: string) => {
  console.log('[main] Switching session to:', targetSessionId)
  
  try {
    // 1. Save current session state (both modes are saved separately via frontend)
    const currentId = sessionStore.getCurrentSessionId()
    if (currentId) {
      const currentAgent = agentManager.getAgent(currentId)
      if (currentAgent) {
        // Note: Agent history is per-mode now, frontend handles saving
        console.log('[main] Current session agent exists:', currentId)
      }
    }
    
    // 2. Load target session and its agent (create on-demand if needed)
    const session = sessionStore.getSession(targetSessionId)
    if (session) {
      const targetAgent = agentManager.getOrCreateAgent(targetSessionId)
      if (targetAgent) {
        // Load work history by default (agent uses single history internally)
        const workMessages = session.workMessages || session.messages || []
        if (targetAgent.getHistory().length === 0 && workMessages.length > 0) {
          targetAgent.loadHistory(workMessages)
        }
      }
      sessionStore.setCurrentSession(targetSessionId)
      console.log('[main] Switched to session:', targetSessionId)
      return { 
        success: true, 
        session,
        chatMessages: session.chatMessages || [],
        workMessages: session.workMessages || session.messages || []
      }
    } else {
      console.error('[main] Session not found:', targetSessionId)
      return { success: false, error: 'Session not found' }
    }
  } catch (err) {
    console.error('[main] Session switch error:', err)
    return { success: false, error: (err as Error).message }
  }
})

ipcMain.handle('agent:authorize-folder', (_, folderPath: string) => {
  const folders = configStore.getAll().authorizedFolders || []
  if (!folders.includes(folderPath)) {
    folders.push(folderPath)
    configStore.set('authorizedFolders', folders)
  }
  return true
})

ipcMain.handle('agent:get-authorized-folders', () => {
  return configStore.getAll().authorizedFolders || []
})

// Permission Management
ipcMain.handle('permissions:list', () => {
  return configStore.getAllowedPermissions()
})

ipcMain.handle('permissions:revoke', (_, { tool, pathPattern }: { tool: string, pathPattern?: string }) => {
  configStore.removePermission(tool, pathPattern)
  return { success: true }
})

ipcMain.handle('permissions:clear', () => {
  configStore.clearAllPermissions()
  return { success: true }
})

// Command Blacklist Management
ipcMain.handle('blacklist:get', () => {
  return configStore.getCommandBlacklist()
})

ipcMain.handle('blacklist:add', (_, command: string) => {
  configStore.addToBlacklist(command)
  return { success: true }
})

ipcMain.handle('blacklist:remove', (_, command: string) => {
  configStore.removeFromBlacklist(command)
  return { success: true }
})

ipcMain.handle('blacklist:reset', () => {
  configStore.resetBlacklistToDefault()
  return { success: true }
})

ipcMain.handle('agent:set-working-dir', (_, folderPath: string) => {
  // Set as first (primary) in the list
  const folders = configStore.getAll().authorizedFolders || []
  const newFolders = [folderPath, ...folders.filter(f => f !== folderPath)]
  configStore.set('authorizedFolders', newFolders)
  // Sync permissionManager cache
  permissionManager.syncFromConfig()
  logger.info('Set working directory', { folderPath, newFolders })
  return true
})

// Switch workspace: destroy current agent and create a new session with new working directory
ipcMain.handle('agent:switch-workspace', async (event, payload: { sessionId: string, newWorkingDir: string }) => {
  const { sessionId, newWorkingDir } = payload
  logger.info('Switch workspace requested', { sessionId, newWorkingDir })
  
  try {
    // Get the window that sent this request
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) {
      const errorMsg = 'Cannot switch workspace: window not found'
      logger.error(errorMsg, { sessionId, newWorkingDir })
      return { success: false, error: errorMsg }
    }
    
    // 1. Destroy current agent for this session
    logger.info('Destroying agent for session', { sessionId })
    agentManager.destroyAgent(sessionId)
    
    // 2. Set new working directory as primary
    const folders = configStore.getAll().authorizedFolders || []
    const newFolders = [newWorkingDir, ...folders.filter(f => f !== newWorkingDir)]
    configStore.set('authorizedFolders', newFolders)
    // Sync permissionManager cache with new folders
    permissionManager.syncFromConfig()
    logger.info('Updated authorized folders', { newFolders })
    
    // 3. Create a new session (this ensures fresh context with new cwd)
    const folderName = newWorkingDir.split(/[\\/]/).pop() || '新会话'
    const newSession = sessionStore.createSession(`工作区: ${folderName}`)
    logger.info('Created new session', { newSessionId: newSession.id, folderName })
    
    // 4. Update window-session mapping so the window is associated with new session
    agentManager.updateWindowSession(win.id, sessionId, newSession.id, win)
    logger.info('Updated window-session mapping', { windowId: win.id, oldSessionId: sessionId, newSessionId: newSession.id })
    
    logger.info('Workspace switch completed successfully', { newWorkingDir, newSessionId: newSession.id })
    return { success: true, workingDir: newWorkingDir, newSessionId: newSession.id }
  } catch (error: unknown) {
    const err = error as Error
    logger.error('Workspace switch failed', { 
      sessionId, 
      newWorkingDir, 
      error: err.message, 
      stack: err.stack 
    })
    return { success: false, error: err.message || 'Workspace switch failed' }
  }
})

ipcMain.handle('config:get-all', () => configStore.getAll())
ipcMain.handle('config:set-all', (_, cfg) => {
  if (cfg.apiKey) configStore.setApiKey(cfg.apiKey)
  if (cfg.apiUrl) configStore.setApiUrl(cfg.apiUrl)
  if (cfg.model) configStore.setModel(cfg.model)
  configStore.set('authorizedFolders', cfg.authorizedFolders || [])
  configStore.setNetworkAccess(cfg.networkAccess || false)
  if (cfg.shortcut) configStore.set('shortcut', cfg.shortcut)
  if (cfg.integrationMode) configStore.setIntegrationMode(cfg.integrationMode)
  
  // CodeBuddy specific settings
  if (cfg.codeBuddyApiKey !== undefined) configStore.setCodeBuddyApiKey(cfg.codeBuddyApiKey)
  if (cfg.codeBuddyInternetEnv !== undefined) configStore.setCodeBuddyInternetEnv(cfg.codeBuddyInternetEnv)

  // Destroy all agents so they get recreated with new settings
  agentManager.destroyAll()
  console.log('[main] Settings saved, agents will be recreated with new config on next message')
})

// Setup handlers
ipcMain.handle('setup:check', () => {
  return { complete: configStore.isSetupComplete() }
})

ipcMain.handle('setup:run-step', async (_, step: string) => {
  logger.info('Running setup step', { step })
  
  try {
    switch (step) {
      case 'check-environment':
        // Check system environment
        return { 
          success: true, 
          data: { 
            platform: process.platform,
            arch: process.arch,
            nodeVersion: process.version
          }
        }
      
      case 'init-config':
        // Initialize default configuration
        if (!configStore.isSetupComplete()) {
          // Already has defaults, just verify
        }
        return { success: true }
      
      case 'preload-sdk':
        // Preload SDK by importing it
        try {
          const sdk = await import('@anthropic-ai/sdk')
          logger.info('SDK preloaded successfully', { version: sdk.Anthropic.prototype.constructor.name })
        } catch (e) {
          logger.warn('SDK preload skipped (optional)', { error: (e as Error).message })
        }
        return { success: true }
      
      case 'verify-resources': {
        // Verify resources directory exists
        const resourcesPath = app.isPackaged
          ? path.join(process.resourcesPath, 'resources')
          : path.join(__dirname, '..', 'resources')
        const skillsPath = path.join(resourcesPath, 'skills')
        
        const fs = await import('fs/promises')
        try {
          await fs.access(skillsPath)
          const skills = await fs.readdir(skillsPath)
          return { success: true, data: { skillsCount: skills.length } }
        } catch {
          return { success: true, data: { skillsCount: 0, warning: 'Skills directory not found' } }
        }
      }
      
      case 'install-skills': {
        // Download and install official skills to ~/.codebuddy/skills
        const SKILLS_ZIP_URL = 'https://cnb.cool/codebuddy/codebuddy/-/git/raw/master/skills/skills.zip?download=true'
        const codebuddyDir = path.join(os.homedir(), '.codebuddy')
        const targetSkillsPath = path.join(codebuddyDir, 'skills')
        
        const fsPromises = await import('fs/promises')
        
        try {
          // Ensure .codebuddy directory exists
          await fsPromises.mkdir(codebuddyDir, { recursive: true })
          
          // Get list of existing skill directories before extraction
          const existingSkillsBefore = new Set<string>()
          try {
            await fsPromises.access(targetSkillsPath)
            const dirs = await fsPromises.readdir(targetSkillsPath)
            for (const dir of dirs) {
              const dirPath = path.join(targetSkillsPath, dir)
              const stat = await fsPromises.stat(dirPath)
              if (stat.isDirectory()) {
                existingSkillsBefore.add(dir)
              }
            }
          } catch {
            // Directory doesn't exist or is empty, that's fine
          }
          
          // Download ZIP file
          logger.info('Downloading skills zip from', { url: SKILLS_ZIP_URL })
          
          const zipBuffer = await new Promise<Buffer>((resolve, reject) => {
            https.get(SKILLS_ZIP_URL, (response) => {
              if (response.statusCode !== 200) {
                reject(new Error(`Failed to download: ${response.statusCode} ${response.statusMessage}`))
                return
              }
              
              const chunks: Buffer[] = []
              response.on('data', (chunk: Buffer) => {
                chunks.push(chunk)
              })
              response.on('end', () => {
                resolve(Buffer.concat(chunks))
              })
              response.on('error', (err) => {
                reject(err)
              })
            }).on('error', (err) => {
              reject(err)
            })
          })
          
          logger.info('ZIP file downloaded', { size: zipBuffer.length })
          
          // Extract ZIP file
          const zip = new AdmZip(zipBuffer)
          const zipEntries = zip.getEntries()
          
          // Ensure skills directory exists
          await fsPromises.mkdir(targetSkillsPath, { recursive: true })
          
          // Extract files, checking for existing directories with same names
          for (const entry of zipEntries) {
            // Skip __MACOSX and ._ files
            if (entry.entryName.startsWith('__MACOSX') || entry.entryName.includes('/._')) {
              continue
            }
            
            // Remove 'skills/' prefix if exists
            let relativePath = entry.entryName
            if (relativePath.startsWith('skills/')) {
              relativePath = relativePath.substring(7)
            }
            
            if (!relativePath) continue
            
            const targetPath = path.join(targetSkillsPath, relativePath)
            
            // If it's a directory
            if (entry.isDirectory) {
              const dirName = path.basename(targetPath)
              const parentDir = path.dirname(targetPath)
              
              // Check if parent directory has a directory with the same name
              try {
                const parentItems = await fsPromises.readdir(parentDir)
                if (parentItems.includes(dirName)) {
                  const existingPath = path.join(parentDir, dirName)
                  const stat = await fsPromises.stat(existingPath)
                  if (stat.isDirectory()) {
                    logger.info('Skipping existing directory', { path: existingPath })
                    continue
                  }
                }
              } catch {
                // Parent directory doesn't exist, continue creating
              }
              
              // Create directory
              await fsPromises.mkdir(targetPath, { recursive: true })
            } else {
              // If it's a file, check if parent directory has a directory with the same name
              const fileName = path.basename(targetPath)
              const parentDir = path.dirname(targetPath)
              
              try {
                const parentItems = await fsPromises.readdir(parentDir)
                if (parentItems.includes(fileName)) {
                  const existingPath = path.join(parentDir, fileName)
                  const stat = await fsPromises.stat(existingPath)
                  if (stat.isDirectory()) {
                    // Directory exists with same name, skip file
                    logger.info('Skipping file, directory exists with same name', { path: existingPath })
                    continue
                  }
                }
              } catch {
                // Parent directory doesn't exist, create it
                await fsPromises.mkdir(parentDir, { recursive: true })
              }
              
              // Extract file content
              const content = entry.getData()
              await fsPromises.writeFile(targetPath, content)
            }
          }
          
          // After extraction, count skill directories (top-level directories in targetSkillsPath)
          let extractedCount = 0
          let skippedCount = 0
          
          try {
            const existingSkillsAfter = new Set<string>()
            const dirs = await fsPromises.readdir(targetSkillsPath)
            for (const dir of dirs) {
              const dirPath = path.join(targetSkillsPath, dir)
              const stat = await fsPromises.stat(dirPath)
              if (stat.isDirectory()) {
                existingSkillsAfter.add(dir)
              }
            }
            
            // Compare with before: new directories = extracted, existing = skipped
            for (const skillDir of existingSkillsAfter) {
              if (existingSkillsBefore.has(skillDir)) {
                skippedCount++
              } else {
                extractedCount++
              }
            }
          } catch (error) {
            logger.warn('Could not count skill directories after extraction', { error: (error as Error).message })
            // Fallback: if we can't count properly, return 0 to avoid misleading numbers
            extractedCount = 0
            skippedCount = 0
          }
          
          logger.info('Skills extracted successfully', {
            targetPath: targetSkillsPath,
            extractedSkillsCount: extractedCount,
            skippedSkillsCount: skippedCount
          })
          
          return {
            success: true,
            data: {
              targetPath: targetSkillsPath,
              extractedCount,
              skippedCount
            }
          }
        } catch (error) {
          logger.warn('Failed to install skills', {
            error: (error as Error).message,
            stack: (error as Error).stack
          })
          // Don't fail setup if skills installation fails - it's not critical
          return {
            success: true,
            data: {
              warning: `Skills installation failed: ${(error as Error).message}`
            }
          }
        }
      }
      
      case 'complete':
        configStore.setSetupComplete(true)
        return { success: true }
      
      default:
        return { success: false, error: 'Unknown setup step' }
    }
  } catch (error) {
    logger.error('Setup step failed', { step, error: (error as Error).message })
    return { success: false, error: (error as Error).message }
  }
})

ipcMain.handle('setup:complete', () => {
  configStore.setSetupComplete(true)
  return { success: true }
})

// Log viewer handlers
ipcMain.handle('logs:get-all', () => {
  return getLogs()
})

ipcMain.handle('logs:clear', () => {
  clearLogs()
  return { success: true }
})

ipcMain.handle('logs:export', async () => {
  const logs = getLogs()
  const logContent = logs.map(log => 
    `[${log.timestamp}] [${log.level.toUpperCase()}] ${log.message}${log.data ? ' ' + JSON.stringify(log.data) : ''}`
  ).join('\n')
  
  const result = await dialog.showSaveDialog({
    title: '导出日志',
    defaultPath: `codebuddy-work-logs-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`,
    filters: [{ name: 'Text Files', extensions: ['txt'] }]
  })
  
  if (!result.canceled && result.filePath) {
    fs.writeFileSync(result.filePath, logContent)
    return { success: true, path: result.filePath }
  }
  return { success: false }
})

// Shortcut update handler
ipcMain.handle('shortcut:update', (_, newShortcut: string) => {
  try {
    globalShortcut.unregisterAll()
    globalShortcut.register(newShortcut, () => {
      if (floatingBallWin) {
        if (floatingBallWin.isVisible()) {
          if (isBallExpanded) {
            toggleFloatingBallExpanded()
          }
          floatingBallWin.hide()
        } else {
          floatingBallWin.show()
          floatingBallWin.focus()
        }
      }
    })
    configStore.set('shortcut', newShortcut)
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
})

// CodeBuddy Install Handler
ipcMain.handle('codebuddy:install', async () => {
  return new Promise((resolve) => {
    try {
      console.log('[Main] Installing CodeBuddy CLI...')
      
      // Use npm to install globally - need shell: true to find npm in PATH
      const installProcess = spawn('npm', ['install', '-g', '@tencent-ai/codebuddy-code'], {
        stdio: 'pipe',
        shell: true,
        env: { ...process.env, PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin' }
      })

      let stdout = ''
      let stderr = ''

      installProcess.stdout?.on('data', (data) => {
        const text = data.toString()
        stdout += text
        console.log('[CodeBuddy Install]', text.trim())
      })

      installProcess.stderr?.on('data', (data) => {
        const text = data.toString()
        stderr += text
        console.error('[CodeBuddy Install Error]', text.trim())
      })

      installProcess.on('close', (code) => {
        if (code === 0) {
          console.log('[Main] CodeBuddy CLI installed successfully')
          resolve({ success: true, message: '安装成功！' })
        } else {
          console.error('[Main] CodeBuddy CLI installation failed with code:', code)
          resolve({ 
            success: false, 
            message: `安装失败 (退出码: ${code})。请手动运行: npm install -g @tencent-ai/codebuddy-code` 
          })
        }
      })

      installProcess.on('error', (err) => {
        console.error('[Main] Failed to start npm install:', err)
        resolve({ 
          success: false, 
          message: `安装失败: ${err.message}。请确保已安装 Node.js 和 npm。` 
        })
      })
    } catch (err) {
      console.error('[Main] Error installing CodeBuddy:', err)
      resolve({ 
        success: false, 
        message: `安装失败: ${(err as Error).message}` 
      })
    }
  })
})

ipcMain.handle('dialog:select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWin!, {
    properties: ['openDirectory']
  })
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0]
  }
  return null
})

ipcMain.handle('shell:open-path', async (_, filePath: string) => {
  return shell.showItemInFolder(filePath)
})

// Floating Ball specific handlers
ipcMain.handle('floating-ball:toggle', () => {
  toggleFloatingBallExpanded()
})

ipcMain.handle('floating-ball:show-main', () => {
  mainWin?.show()
  mainWin?.focus()
})

ipcMain.handle('floating-ball:start-drag', () => {
  // Enable window dragging
  if (floatingBallWin) {
    floatingBallWin.setMovable(true)
  }
})

ipcMain.handle('floating-ball:move', (_, { deltaX, deltaY }: { deltaX: number, deltaY: number }) => {
  if (floatingBallWin) {
    const [x, y] = floatingBallWin.getPosition()
    floatingBallWin.setPosition(x + deltaX, y + deltaY)
    // Enforce fixed size when expanded to prevent any resizing
    if (isBallExpanded) {
      floatingBallWin.setSize(EXPANDED_WIDTH, EXPANDED_HEIGHT)
    }
  }
})

// Window controls for custom titlebar
ipcMain.handle('window:minimize', () => mainWin?.minimize())
ipcMain.handle('window:maximize', () => {
  if (mainWin?.isMaximized()) {
    mainWin.unmaximize()
  } else {
    mainWin?.maximize()
  }
})
ipcMain.handle('window:close', () => mainWin?.hide())

// Authentication Handlers
let isAuthenticating = false

// Broadcast user info change to all windows
function broadcastUserChange(userInfo: UserInfo | null) {
  BrowserWindow.getAllWindows().forEach(win => {
    if (!win.isDestroyed()) {
      win.webContents.send('auth:user-changed', userInfo)
    }
  })
}

/**
 * Perform SDK-based authentication with external browser
 * This function is used both for startup auto-login and manual login via IPC
 * 
 * @param environment - Auth environment: 'external' | 'internal' | 'ioa' | 'cloudhosted'
 * @param endpoint - Optional custom endpoint for self-hosted environments
 * @returns Authentication result with success status and user info or error
 */
async function performSDKAuthentication(
  environment: AuthEnvironment = 'ioa',
  endpoint?: string
): Promise<{ success: boolean; userInfo?: UserInfo; error?: string }> {
  if (isAuthenticating) {
    logger.warn('SDK authentication already in progress')
    return { success: false, error: '登录正在进行中' }
  }
  
  isAuthenticating = true
  logger.info('Starting SDK Authentication', { environment, endpoint })
  
  // Notify windows that login is starting
  BrowserWindow.getAllWindows().forEach(win => {
    if (!win.isDestroyed()) {
      win.webContents.send('auth:login-pending')
    }
  })
  
  try {
    // Set CODEBUDDY_CODE_PATH environment variable for SDK to find CLI
    // This is required because SDK needs to know where the codebuddy CLI is located
    if (!process.env.CODEBUDDY_CODE_PATH) {
      let codebuddyCliPath: string | null = null
      
      // First try: use findCodeBuddyPath with system Node.js
      const systemNodePath = findSystemNodePath()
      if (systemNodePath) {
        codebuddyCliPath = findCodeBuddyPath(systemNodePath)
      }
      
      // Second try: use execSync to find codebuddy in PATH (like CodeBuddySDKRuntime does)
      if (!codebuddyCliPath) {
        try {
          const home = process.env.HOME || ''
          const nvmDir = `${home}/.nvm/versions/node`
          const standardPaths = '/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin'
          const nvmPaths = fs.existsSync(nvmDir)
            ? fs.readdirSync(nvmDir).filter((v: string) => v.startsWith('v')).map((v: string) => `${nvmDir}/${v}/bin`).join(':')
            : ''
          const extendedPath = `${systemNodePath ? path.dirname(systemNodePath) : ''}:${nvmPaths}:${process.env.PATH || ''}:${standardPaths}`
          
          codebuddyCliPath = execSync('which codebuddy', {
            encoding: 'utf-8',
            env: { ...process.env, PATH: extendedPath, HOME: home },
            shell: '/bin/bash'
          }).trim()
        } catch (e) {
          logger.warn('Failed to find codebuddy with which command', { error: (e as Error).message })
        }
      }
      
      if (codebuddyCliPath) {
        process.env.CODEBUDDY_CODE_PATH = codebuddyCliPath
        logger.info('Set CODEBUDDY_CODE_PATH', { path: codebuddyCliPath })
      } else {
        logger.warn('CodeBuddy CLI not found, SDK auth may fail. Make sure codebuddy is installed: npm install -g @tencent-ai/codebuddy-code')
      }
    } else {
      logger.info('Using existing CODEBUDDY_CODE_PATH', { path: process.env.CODEBUDDY_CODE_PATH })
    }
    
    // Dynamic import like the working demo (auth-demo-e)
    const { unstable_v2_authenticate } = await import('@tencent-ai/agent-sdk')
    
    const result = await unstable_v2_authenticate({
      environment: endpoint ? undefined : environment,
      endpoint: endpoint,
      onAuthUrl: async (authState) => {
        logger.info('Auth URL received', { authUrl: authState.authUrl })
        console.log('Auth URL:', authState.authUrl)
        
        if (authState.authUrl) {
          // Use child_process.exec to open browser (works in all contexts including webview)
          // This is more reliable than shell.openExternal in some environments
          const platform = process.platform
          let command: string
          
          if (platform === 'darwin') {
            command = `open "${authState.authUrl}"`
          } else if (platform === 'win32') {
            command = `start "" "${authState.authUrl}"`
          } else {
            command = `xdg-open "${authState.authUrl}"`
          }
          
          try {
            // Use child_process.exec first (works in all contexts)
            await new Promise<void>((resolve, reject) => {
              exec(command, (error) => {
                if (error) {
                  logger.warn('Failed to open browser via exec, trying shell.openExternal', { error: error.message })
                  // Fallback to shell.openExternal if exec fails (only works in main process)
                  if (shell && typeof shell.openExternal === 'function') {
                    shell.openExternal(authState.authUrl)
                      .then(() => resolve())
                      .catch((shellError) => {
                        logger.error('Both exec and shell.openExternal failed', { 
                          execError: error.message, 
                          shellError: (shellError as Error).message 
                        })
                        reject(shellError)
                      })
                  } else {
                    reject(error)
                  }
                } else {
                  resolve()
                }
              })
            })
            logger.info('Browser opened successfully')
          } catch (openError) {
            logger.error('Failed to open browser', { error: (openError as Error).message })
            // Continue anyway - user can manually open the URL
          }
          
          // Notify frontend that we're waiting for browser authentication
          BrowserWindow.getAllWindows().forEach(win => {
            if (!win.isDestroyed()) {
              win.webContents.send('auth:waiting-browser', { authUrl: authState.authUrl })
            }
          })
        }
      },
      timeout: 300000, // 5 minutes timeout
    })
    
    logger.info('Authentication completed!', { 
      userId: result.userinfo.userId, 
      userName: result.userinfo.userName,
      hasToken: !!result.userinfo.token
    })
    
    // Save user info from SDK response
    const userInfo: UserInfo = {
      userId: result.userinfo.userId,
      userName: result.userinfo.userName,
      userNickname: result.userinfo.userNickname,
      token: result.userinfo.token,
      enterpriseId: result.userinfo.enterpriseId,
      enterprise: result.userinfo.enterprise,
    }
    
    configStore.setUserInfo(userInfo)
    broadcastUserChange(userInfo)
    
    logger.info('SDK Authentication Successful')
    isAuthenticating = false
    return { success: true, userInfo }
  } catch (error) {
    isAuthenticating = false
    const err = error as Error
    logger.error('SDK Authentication Failed', { 
      errorName: err.name,
      errorMessage: err.message, 
      environment 
    })
    
    // Notify windows that login failed so they can reset their state
    BrowserWindow.getAllWindows().forEach(win => {
      if (!win.isDestroyed()) {
        win.webContents.send('auth:login-failed', { error: err.message })
      }
    })
    
    return { 
      success: false, 
      error: err.message || '登录失败',
    }
  }
}

// Helper to execute codebuddy commands
function executeCodeBuddyAuthCommand(args: string[]): Promise<{ success: boolean; output?: string; error?: string }> {
  return new Promise((resolve) => {
    const home = process.env.HOME || ''
    const systemNodePath = findSystemNodePath()
    
    if (!systemNodePath) {
      resolve({ success: false, error: '未找到 Node.js' })
      return
    }
    
    // Find codebuddy CLI
    const nodeDir = path.dirname(systemNodePath)
    let codebuddyPath = path.join(nodeDir, 'codebuddy')
    
    if (!fs.existsSync(codebuddyPath)) {
      const otherPaths = [
        `${home}/.npm-global/bin/codebuddy`,
        '/usr/local/bin/codebuddy',
        '/opt/homebrew/bin/codebuddy',
      ]
      for (const p of otherPaths) {
        if (fs.existsSync(p)) {
          codebuddyPath = p
          break
        }
      }
    }
    
    if (!fs.existsSync(codebuddyPath)) {
      resolve({ success: false, error: 'CodeBuddy CLI 未安装' })
      return
    }
    
    const nvmDir = `${home}/.nvm/versions/node`
    const standardPaths = '/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin'
    const nvmPaths = fs.existsSync(nvmDir)
      ? fs.readdirSync(nvmDir).filter((v: string) => v.startsWith('v')).map((v: string) => `${nvmDir}/${v}/bin`).join(':')
      : ''
    const pathEnv = `${path.dirname(systemNodePath)}:${nvmPaths}:${process.env.PATH || ''}:${standardPaths}`

    const codebuddyProcess = spawn(systemNodePath, [codebuddyPath, ...args], {
      env: { ...process.env, PATH: pathEnv, HOME: home }
    })

    let stdout = ''
    let stderr = ''

    codebuddyProcess.stdout?.on('data', (data) => { stdout += data.toString() })
    codebuddyProcess.stderr?.on('data', (data) => { stderr += data.toString() })

    codebuddyProcess.on('close', (code) => {
      if (code === 0) {
        resolve({ success: true, output: stdout.trim() })
      } else {
        resolve({ success: false, error: stderr.trim() || stdout.trim() || `Exit code ${code}` })
      }
    })

    codebuddyProcess.on('error', (err) => {
      resolve({ success: false, error: err.message })
    })
  })
}

// Check if user is logged in (returns user info if cached)
ipcMain.handle('auth:check-login', () => {
  const userInfo = configStore.getUserInfo()
  return { isLoggedIn: configStore.isLoggedIn(), userInfo }
})

// Get current user info
ipcMain.handle('auth:get-user', () => {
  return configStore.getUserInfo()
})

// Initiate login flow via SDK (opens browser automatically)
// This handler is used by SettingsView and other places that call 'auth:login'
ipcMain.handle('auth:login', async () => {
  // Use SDK authentication instead of CLI
  return await performSDKAuthentication('ioa')
})

// Logout
ipcMain.handle('auth:logout', async () => {
  console.log('[Main] Logging out...')
  
  // Try to logout via CLI
  try {
    await executeCodeBuddyAuthCommand(['logout'])
  } catch (e) {
    console.warn('[Main] CLI logout failed:', e)
  }
  
  configStore.logout()
  broadcastUserChange(null)
  return { success: true }
})

// SDK-based authentication with external browser
// Supports multiple environments: 'external', 'internal', 'ioa', 'cloudhosted'
ipcMain.handle('auth:sdk-login', async (_, environment: AuthEnvironment = 'ioa') => {
  // Delegate to the reusable authentication function
  return await performSDKAuthentication(environment)
})

// SDK-based authentication with custom endpoint (self-hosted)
// Example: auth:sdk-login-endpoint with 'https://my-corp.codebuddy.com'
ipcMain.handle('auth:sdk-login-endpoint', async (_, endpoint: string) => {
  logger.info('SDK login with custom endpoint requested', { endpoint })
  
  if (!endpoint || !endpoint.startsWith('http')) {
    return { success: false, error: '请提供有效的端点 URL' }
  }
  
  // Delegate to the reusable authentication function with custom endpoint
  return await performSDKAuthentication('external', endpoint)
})

// MCP Configuration Handlers
const mcpConfigPath = path.join(os.homedir(), '.codebuddy', 'mcp.json');

ipcMain.handle('mcp:get-config', async () => {
  try {
    if (!fs.existsSync(mcpConfigPath)) return '{}';
    return fs.readFileSync(mcpConfigPath, 'utf-8');
  } catch (e) {
    console.error('Failed to read MCP config:', e);
    return '{}';
  }
});

ipcMain.handle('mcp:save-config', async (_, content: string) => {
  try {
    const dir = path.dirname(mcpConfigPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(mcpConfigPath, content, 'utf-8');

    // TODO: Update agent MCP services if needed
    // With multi-agent architecture, we might need to reload MCP for all active agents
    // For now, user needs to restart the app or start new sessions
    return { success: true };
  } catch (e) {
    console.error('Failed to save MCP config:', e);
    return { success: false, error: (e as Error).message };
  }
});

// Skills Management Handlers
const skillsDir = path.join(os.homedir(), '.codebuddy', 'skills');

// Helper to get built-in skill names
const getBuiltinSkillNames = () => {
  try {
    let sourceDir = path.join(process.cwd(), 'resources', 'skills');
    if (app.isPackaged) {
      const possiblePath = path.join(process.resourcesPath, 'resources', 'skills');
      if (fs.existsSync(possiblePath)) sourceDir = possiblePath;
      else sourceDir = path.join(process.resourcesPath, 'skills');
    }
    if (fs.existsSync(sourceDir)) {
      return fs.readdirSync(sourceDir).filter(f => fs.statSync(path.join(sourceDir, f)).isDirectory());
    }
  } catch (e) { console.error(e) }
  return [];
};

ipcMain.handle('skills:list', async () => {
  try {
    if (!fs.existsSync(skillsDir)) return [];
    const builtinSkills = getBuiltinSkillNames();
    const files = fs.readdirSync(skillsDir);

    return files.filter(f => {
      try { return fs.statSync(path.join(skillsDir, f)).isDirectory(); } catch { return false; }
    }).map(f => ({
      id: f,
      name: f,
      path: path.join(skillsDir, f),
      isBuiltin: builtinSkills.includes(f)
    }));
  } catch (e) {
    console.error('Failed to list skills:', e);
    return [];
  }
});

ipcMain.handle('skills:get', async (_, skillId: string) => {
  try {
    const skillPath = path.join(skillsDir, skillId);
    if (!fs.existsSync(skillPath)) return '';

    // Look for MD file inside
    const files = fs.readdirSync(skillPath);
    const mdFile = files.find(f => f.toLowerCase().endsWith('.md'));

    if (!mdFile) return '';
    return fs.readFileSync(path.join(skillPath, mdFile), 'utf-8');
  } catch (e) {
    console.error('Failed to read skill:', e);
    return '';
  }
});

ipcMain.handle('skills:save', async (_, { filename, content }: { filename: string, content: string }) => {
  try {
    const skillId = filename.replace('.md', ''); // normalized id

    // Check if built-in
    const builtinSkills = getBuiltinSkillNames();
    if (builtinSkills.includes(skillId)) {
      return { success: false, error: 'Cannot modify built-in skills' };
    }

    if (!fs.existsSync(skillsDir)) fs.mkdirSync(skillsDir, { recursive: true });
    const skillPath = path.join(skillsDir, skillId);
    if (!fs.existsSync(skillPath)) fs.mkdirSync(skillPath, { recursive: true });

    // Save to README.md or existing md
    let targetFile = 'README.md';
    if (fs.existsSync(skillPath)) {
      const existing = fs.readdirSync(skillPath).find(f => f.toLowerCase().endsWith('.md'));
      if (existing) targetFile = existing;
    }

    fs.writeFileSync(path.join(skillPath, targetFile), content, 'utf-8');

    return { success: true };
  } catch (e) {
    console.error('Failed to save skill:', e);
    return { success: false, error: (e as Error).message };
  }
});

ipcMain.handle('skills:delete', async (_, skillId: string) => {
  try {
    // Check if built-in
    const builtinSkills = getBuiltinSkillNames();
    if (builtinSkills.includes(skillId)) {
      return { success: false, error: 'Cannot delete built-in skills' };
    }

    const skillPath = path.join(skillsDir, skillId);
    if (fs.existsSync(skillPath)) {
      fs.rmSync(skillPath, { recursive: true, force: true });
      return { success: true };
    }
    return { success: false, error: 'Skill not found' };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
});

ipcMain.handle('skills:import-official', async () => {
  const SKILLS_ZIP_URL = 'https://cnb.cool/codebuddy/codebuddy/-/git/raw/master/skills/skills.zip?download=true'
  const codebuddyDir = path.join(os.homedir(), '.codebuddy')
  const targetSkillsPath = path.join(codebuddyDir, 'skills')
  
  try {
    logger.info('Starting official skills import', { targetPath: targetSkillsPath })
    
    // Ensure .codebuddy directory exists
    if (!fs.existsSync(codebuddyDir)) {
      fs.mkdirSync(codebuddyDir, { recursive: true })
    }
    
    // Check if skills directory exists
    let skillsDirExists = false
    try {
      await fs.promises.access(targetSkillsPath)
      skillsDirExists = true
    } catch {
      // Directory doesn't exist, continue
    }
    
    // Download ZIP file
    logger.info('Downloading skills zip from', { url: SKILLS_ZIP_URL })
    
    const zipBuffer = await new Promise<Buffer>((resolve, reject) => {
      https.get(SKILLS_ZIP_URL, (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`Failed to download: ${response.statusCode} ${response.statusMessage}`))
          return
        }
        
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => {
          chunks.push(chunk)
        })
        response.on('end', () => {
          resolve(Buffer.concat(chunks))
        })
        response.on('error', (err) => {
          reject(err)
        })
      }).on('error', (err) => {
        reject(err)
      })
    })
    
    logger.info('ZIP file downloaded', { size: zipBuffer.length })
    
    // Extract ZIP file
    const zip = new AdmZip(zipBuffer)
    const zipEntries = zip.getEntries()
    
    // Create skills directory if it doesn't exist
    if (!skillsDirExists) {
      await fs.promises.mkdir(targetSkillsPath, { recursive: true })
    }
    
    // Get list of existing skill directories before extraction
    const existingSkillsBefore = new Set<string>()
    try {
      const dirs = await fs.promises.readdir(targetSkillsPath)
      for (const dir of dirs) {
        const dirPath = path.join(targetSkillsPath, dir)
        const stat = await fs.promises.stat(dirPath)
        if (stat.isDirectory()) {
          existingSkillsBefore.add(dir)
        }
      }
    } catch {
      // Directory might be empty, that's fine
    }
    
    // Extract files, checking for existing directories with same names
    for (const entry of zipEntries) {
      // Skip __MACOSX and ._ files
      if (entry.entryName.startsWith('__MACOSX') || entry.entryName.includes('/._')) {
        continue
      }
      
      // Remove 'skills/' prefix if exists
      let relativePath = entry.entryName
      if (relativePath.startsWith('skills/')) {
        relativePath = relativePath.substring(7)
      }
      
      if (!relativePath) continue
      
      const targetPath = path.join(targetSkillsPath, relativePath)
      
      // If it's a directory
      if (entry.isDirectory) {
        const dirName = path.basename(targetPath)
        const parentDir = path.dirname(targetPath)
        
        // Check if parent directory has a directory with the same name
        try {
          const parentItems = await fs.promises.readdir(parentDir)
          if (parentItems.includes(dirName)) {
            const existingPath = path.join(parentDir, dirName)
            const stat = await fs.promises.stat(existingPath)
            if (stat.isDirectory()) {
              logger.info('Skipping existing directory', { path: existingPath })
              continue
            }
          }
        } catch {
          // Parent directory doesn't exist, continue creating
        }
        
        // Create directory
        await fs.promises.mkdir(targetPath, { recursive: true })
      } else {
        // If it's a file, check if parent directory has a directory with the same name
        const fileName = path.basename(targetPath)
        const parentDir = path.dirname(targetPath)
        
        try {
          const parentItems = await fs.promises.readdir(parentDir)
          if (parentItems.includes(fileName)) {
            const existingPath = path.join(parentDir, fileName)
            const stat = await fs.promises.stat(existingPath)
            if (stat.isDirectory()) {
              // Directory exists with same name, skip file
              logger.info('Skipping file, directory exists with same name', { path: existingPath })
              continue
            }
          }
        } catch {
          // Parent directory doesn't exist, create it
          await fs.promises.mkdir(parentDir, { recursive: true })
        }
        
        // Extract file content
        const content = entry.getData()
        await fs.promises.writeFile(targetPath, content)
      }
    }
    
    // After extraction, count skill directories (top-level directories in targetSkillsPath)
    let extractedCount = 0
    let skippedCount = 0
    
    try {
      const existingSkillsAfter = new Set<string>()
      const dirs = await fs.promises.readdir(targetSkillsPath)
      for (const dir of dirs) {
        const dirPath = path.join(targetSkillsPath, dir)
        const stat = await fs.promises.stat(dirPath)
        if (stat.isDirectory()) {
          existingSkillsAfter.add(dir)
        }
      }
      
      // Compare with before: new directories = extracted, existing = skipped
      for (const skillDir of existingSkillsAfter) {
        if (existingSkillsBefore.has(skillDir)) {
          skippedCount++
        } else {
          extractedCount++
        }
      }
    } catch (error) {
      logger.warn('Could not count skill directories after extraction', { error: (error as Error).message })
      // Fallback: if we can't count properly, return 0 to avoid misleading numbers
      extractedCount = 0
      skippedCount = 0
    }
    
    logger.info('Skills imported successfully', {
      targetPath: targetSkillsPath,
      extractedSkillsCount: extractedCount,
      skippedSkillsCount: skippedCount
    })
    
    return {
      success: true,
      message: `成功导入 ${extractedCount} 个技能${skippedCount > 0 ? `，跳过 ${skippedCount} 个已存在技能` : ''}`,
      extractedCount,
      skippedCount
    }
  } catch (error) {
    logger.error('Failed to import official skills', {
      error: (error as Error).message,
      stack: (error as Error).stack
    })
    return {
      success: false,
      error: (error as Error).message
    }
  }
})

// Plugin Marketplace Handlers
/**
 * Find the system Node.js executable path
 * This ensures we use the system Node.js instead of Electron's built-in Node.js
 */
function findSystemNodePath(): string | null {
  const home = process.env.HOME || '';
  const possiblePaths = [
    // NVM paths (prioritize latest version)
    ...(fs.existsSync(`${home}/.nvm/versions/node`) 
      ? fs.readdirSync(`${home}/.nvm/versions/node`)
          .filter((v: string) => v.startsWith('v'))
          .sort()
          .reverse()
          .map((v: string) => `${home}/.nvm/versions/node/${v}/bin/node`)
      : []),
    // Standard installation paths
    '/usr/local/bin/node',
    '/opt/homebrew/bin/node',
    '/usr/bin/node',
    // Try to find from current PATH
    process.env.PATH?.split(':')
      .map((p: string) => path.join(p, 'node'))
      .find((p: string) => fs.existsSync(p)) || null
  ].filter(Boolean) as string[];

  for (const nodePath of possiblePaths) {
    if (nodePath && fs.existsSync(nodePath)) {
      try {
        // Verify it's executable
        fs.accessSync(nodePath, fs.constants.F_OK | fs.constants.X_OK);
        return nodePath;
      } catch {
        continue;
      }
    }
  }
  
  return null;
}

/**
 * Find the codebuddy command path
 */
function findCodeBuddyPath(nodePath: string): string | null {
  const nodeDir = path.dirname(nodePath);
  const codebuddyPath = path.join(nodeDir, 'codebuddy');
  
  if (fs.existsSync(codebuddyPath)) {
    return codebuddyPath;
  }
  
  // Fallback: try to find in PATH
  const home = process.env.HOME || '';
  const possiblePaths = [
    `${home}/.npm-global/bin/codebuddy`,
    `${home}/node_modules/.bin/codebuddy`,
    '/usr/local/bin/codebuddy',
    '/opt/homebrew/bin/codebuddy',
    '/usr/local/lib/node_modules/.bin/codebuddy'
  ];
  
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  
  return null;
}

const executeCodeBuddyCommand = (args: string[]): Promise<{ success: boolean; output?: string; error?: string }> => {
  return new Promise((resolve) => {
    const home = process.env.HOME || '';
    
    // Find system Node.js path
    const systemNodePath = findSystemNodePath();
    if (!systemNodePath) {
      logger.error('Failed to find system Node.js');
      resolve({ success: false, error: 'Failed to find system Node.js. Please ensure Node.js is installed.' });
      return;
    }
    
    logger.info('Using system Node.js', { path: systemNodePath });
    
    // Find codebuddy path
    const codebuddyPath = findCodeBuddyPath(systemNodePath);
    if (!codebuddyPath) {
      logger.error('Failed to find codebuddy command');
      resolve({ success: false, error: 'Failed to find codebuddy command. Please ensure CodeBuddy CLI is installed.' });
      return;
    }
    
    logger.info('Using codebuddy', { path: codebuddyPath });
    
    // Build PATH environment with system Node.js first
    const nvmDir = `${home}/.nvm/versions/node`;
    const standardPaths = '/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin';
    const nvmPaths = fs.existsSync(nvmDir)
      ? fs.readdirSync(nvmDir).filter((v: string) => v.startsWith('v')).map((v: string) => `${nvmDir}/${v}/bin`).join(':')
      : '';
    const npmPaths = `${home}/.npm-global/bin:${home}/node_modules/.bin:/usr/local/lib/node_modules/.bin`;
    const pathEnv = `${path.dirname(systemNodePath)}:${nvmPaths}:${npmPaths}:${process.env.PATH || ''}:${standardPaths}`;

    // Use system Node.js to execute codebuddy script
    // This ensures codebuddy uses the system Node.js version, not Electron's
    const codebuddyProcess = spawn(systemNodePath, [codebuddyPath, ...args], {
      env: { 
        ...process.env, 
        PATH: pathEnv, 
        HOME: home,
        // Explicitly set NODE environment to system Node.js
        NODE: systemNodePath
      }
    });

    let stdout = '';
    let stderr = '';

    codebuddyProcess.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    codebuddyProcess.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    codebuddyProcess.on('close', (code) => {
      if (code === 0) {
        resolve({ success: true, output: stdout.trim() });
      } else {
        const errorMsg = stderr.trim() || stdout.trim() || `Command failed with exit code ${code}`;
        logger.error('CodeBuddy plugin command failed', { args, code, stderr, stdout });
        resolve({ success: false, error: errorMsg });
      }
    });

    codebuddyProcess.on('error', (err) => {
      logger.error('CodeBuddy plugin command error', { args, error: err.message });
      resolve({ success: false, error: `Failed to execute command: ${err.message}` });
    });
  });
};

ipcMain.handle('plugin:marketplace-add', async (_, source: string) => {
  console.log('[main] Adding plugin marketplace:', source);
  logger.info('Adding plugin marketplace', { source });
  
  // Use plugin subcommand (not slash command)
  const result = await executeCodeBuddyCommand(['plugin', 'marketplace', 'add', source]);
  
  if (result.success) {
    logger.info('Plugin marketplace added successfully', { source, output: result.output });
  } else {
    logger.error('Failed to add plugin marketplace', { source, error: result.error });
  }
  
  return result;
});

ipcMain.handle('plugin:marketplace-remove', async (_, source: string) => {
  console.log('[main] Removing plugin marketplace:', source);
  logger.info('Removing plugin marketplace', { source });
  
  // Use plugin subcommand (not slash command)
  const result = await executeCodeBuddyCommand(['plugin', 'marketplace', 'remove', source]);
  
  if (result.success) {
    logger.info('Plugin marketplace removed successfully', { source, output: result.output });
  } else {
    logger.error('Failed to remove plugin marketplace', { source, error: result.error });
  }
  
  return result;
});

ipcMain.handle('plugin:marketplace-list', async () => {
  console.log('[main] Listing plugin marketplaces');
  
  // Use plugin subcommand (not slash command)
  const result = await executeCodeBuddyCommand(['plugin', 'marketplace', 'list']);
  
  if (result.success) {
    // Parse the output to extract marketplace names
    // The output format may vary, so we return raw output for now
    return { success: true, marketplaces: result.output };
  } else {
    return { success: false, error: result.error };
  }
});

// NOTE: initializeAgent() is deprecated. Agents are now created on-demand by AgentManager.
// Each session gets its own agent instance for true multi-session concurrency.

function createTray() {
  try {
    const logoPath = getPublicAssetPath('logo.png')
    addLog('Creating tray icon from path', { logoPath, isPackaged: app.isPackaged })
    let trayIcon = nativeImage.createFromPath(logoPath)
    
    if (trayIcon.isEmpty()) {
      logWarn('Tray icon is empty, using blank icon', { logoPath })
      trayIcon = nativeImage.createEmpty()
    } else {
      // Resize for macOS menu bar (16x16 is standard, use 32x32 for Retina)
      if (process.platform === 'darwin') {
        trayIcon = trayIcon.resize({ width: 18, height: 18 })
      } else {
        trayIcon = trayIcon.resize({ width: 20, height: 20 })
      }
      addLog('Tray icon created successfully')
    }
    
    tray = new Tray(trayIcon)
  } catch (e) {
    logError('Failed to create tray icon', { error: String(e) })
    const blankIcon = nativeImage.createEmpty()
    tray = new Tray(blankIcon)
  }

  tray.setToolTip('WorkBuddy')

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '新建窗口',
      accelerator: 'CommandOrControl+N',
      click: () => {
        createSessionWindow()
      }
    },
    { type: 'separator' },
    {
      label: '显示悬浮球',
      click: () => {
        floatingBallWin?.isVisible() ? floatingBallWin?.hide() : floatingBallWin?.show()
      }
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        app.isQuitting = true
        app.quit()
      }
    }
  ])

  tray.setContextMenu(contextMenu)

  tray.on('click', () => {
    // Show the most recent window or create a new one
    const windows = BrowserWindow.getAllWindows().filter(w => w !== floatingBallWin)
    if (windows.length > 0) {
      const lastWindow = windows[0]
      if (lastWindow.isVisible()) {
        lastWindow.hide()
      } else {
        lastWindow.show()
        lastWindow.focus()
      }
    } else {
      createSessionWindow()
    }
  })
}

/**
 * Create a new session window
 * Each window = one session = one CodeBuddy process
 */
function createSessionWindow(sessionId?: string): BrowserWindow {
  // Create or use provided sessionId
  const session = sessionId 
    ? sessionStore.getSession(sessionId) || sessionStore.createSession()
    : sessionStore.createSession()
  
  const finalSessionId = session.id
  
  // Platform-specific window options
  const isMac = process.platform === 'darwin'
  
  const win = new BrowserWindow({
    width: 520,
    height: 760,
    minWidth: 420,
    minHeight: 600,
    icon: getPublicAssetPath('logo.png'),
    frame: false,
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    trafficLightPosition: isMac ? { x: 12, y: 12 } : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
    },
    show: false,
  })

  // Remove menu bar
  win.setMenu(null)

  // Register window with AgentManager
  agentManager.registerWindow(win.id, finalSessionId, win)
  
  // Set as current session
  sessionStore.setCurrentSession(finalSessionId)

  win.once('ready-to-show', () => {
    console.log(`[Main] Session window ready: ${finalSessionId}`)
    win.show()
  })

  // When window closes, cleanup the agent
  win.on('closed', () => {
    console.log(`[Main] Session window closed: ${finalSessionId}`)
    agentManager.unregisterWindow(win.id)
    
    // If this was the main window, clear the reference
    if (mainWin === win) {
      mainWin = null
    }
  })

  // Handle render process crash - auto recover
  win.webContents.on('render-process-gone', (_event: unknown, details: { reason: string }) => {
    console.error('[Main] Render process gone:', details.reason)
    if (details.reason !== 'clean-exit' && !win.isDestroyed()) {
      console.log('[Main] Attempting to reload window...')
      setTimeout(() => {
        try {
          if (!win.isDestroyed()) {
            win.reload()
          }
        } catch (err) {
          console.error('[Main] Failed to reload:', err)
        }
      }, 1000)
    }
  })

  // Handle crashes
  win.webContents.on('crashed' as any, () => {
    console.error('[Main] Window crashed, reloading...')
    setTimeout(() => {
      try {
        if (!win.isDestroyed()) {
          win.reload()
        }
      } catch (err) {
        console.error('[Main] Failed to reload after crash:', err)
      }
    }, 1000)
  })

  // Load the app with session ID in hash
  if (VITE_DEV_SERVER_URL) {
    win.loadURL(`${VITE_DEV_SERVER_URL}#session=${finalSessionId}`)
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'), { hash: `session=${finalSessionId}` })
  }

  return win
}

function createMainWindow() {
  // Create the first session window as the main window
  mainWin = createSessionWindow()
}

function createFloatingBallWindow() {
  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize

  floatingBallWin = new BrowserWindow({
    width: BALL_SIZE,
    height: BALL_SIZE,
    x: screenWidth - BALL_SIZE - 20,
    y: screenHeight - BALL_SIZE - 100,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    hasShadow: false,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
    },
    icon: getPublicAssetPath('logo.png'),
  })

  // Handle render process crash - auto recover
  floatingBallWin.webContents.on('render-process-gone', (_event: unknown, details: { reason: string }) => {
    console.error('[Main] Floating ball render process gone:', details.reason)
    if (details.reason !== 'clean-exit' && floatingBallWin && !floatingBallWin.isDestroyed()) {
      console.log('[Main] Attempting to reload floating ball...')
      setTimeout(() => {
        try {
          if (floatingBallWin && !floatingBallWin.isDestroyed()) {
            floatingBallWin.reload()
          }
        } catch (err) {
          console.error('[Main] Failed to reload floating ball:', err)
        }
      }, 1000)
    }
  })

  // Handle crashes
  floatingBallWin.webContents.on('crashed' as any, () => {
    console.error('[Main] Floating ball crashed, reloading...')
    setTimeout(() => {
      try {
        if (floatingBallWin && !floatingBallWin.isDestroyed()) {
          floatingBallWin.reload()
        }
      } catch (err) {
        console.error('[Main] Failed to reload floating ball after crash:', err)
      }
    }, 1000)
  })

  if (VITE_DEV_SERVER_URL) {
    floatingBallWin.loadURL(`${VITE_DEV_SERVER_URL}#/floating-ball`)
  } else {
    floatingBallWin.loadFile(path.join(RENDERER_DIST, 'index.html'), { hash: 'floating-ball' })
  }

  floatingBallWin.on('closed', () => {
    agentManager.setFloatingBallWindow(null)
    floatingBallWin = null
  })

  // Add to agent manager after creation
  floatingBallWin.webContents.on('did-finish-load', () => {
    if (floatingBallWin) {
      agentManager.setFloatingBallWindow(floatingBallWin)
    }
  })
}

function toggleFloatingBallExpanded() {
  if (!floatingBallWin) return

  const [currentX, currentY] = floatingBallWin.getPosition()
  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize

  if (isBallExpanded) {
    // Collapse - Calculate where ball should go based on current expanded window position
    // Ball's right edge should align with expanded panel's right edge
    // Ball position = (expanded right edge - BALL_SIZE), same Y
    const ballX = currentX + EXPANDED_WIDTH - BALL_SIZE
    const ballY = currentY

    // Clamp to screen bounds
    const finalX = Math.max(0, Math.min(ballX, screenWidth - BALL_SIZE))
    const finalY = Math.max(0, Math.min(ballY, screenHeight - BALL_SIZE))

    floatingBallWin.setSize(BALL_SIZE, BALL_SIZE)
    floatingBallWin.setPosition(finalX, finalY)
    isBallExpanded = false
  } else {
    // Expand
    // Horizontal-only expansion: Keep Y same, expand LEFT from ball

    // Keep Y the same - no vertical movement
    // Only move X to the left so ball's right edge stays at same position
    // Ball's right edge = currentX + BALL_SIZE
    // Panel's right edge = newX + EXPANDED_WIDTH = currentX + BALL_SIZE
    // So: newX = currentX + BALL_SIZE - EXPANDED_WIDTH

    let newX = currentX + BALL_SIZE - EXPANDED_WIDTH
    let newY = currentY  // Keep Y the same - NO upward movement

    // Ensure not going negative
    newX = Math.max(0, newX)
    newY = Math.max(0, newY)

    floatingBallWin.setSize(EXPANDED_WIDTH, EXPANDED_HEIGHT)
    floatingBallWin.setPosition(newX, newY)
    isBallExpanded = true
  }

  floatingBallWin.webContents.send('floating-ball:state-changed', isBallExpanded)
}

// Ensure the ball stays on top
setInterval(() => {
  if (floatingBallWin && !floatingBallWin.isDestroyed()) {
    floatingBallWin.setAlwaysOnTop(true, 'screen-saver')
  }
}, 2000)
