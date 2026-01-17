import { app, BrowserWindow, shell, ipcMain, screen, dialog, globalShortcut, Tray, Menu, nativeImage } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import { spawn } from 'node:child_process'
import dotenv from 'dotenv'
import { AgentRuntime } from './agent/AgentRuntime'
import { CLIAgentRuntime } from './agent/CLIAgentRuntime'
import { CodeBuddySDKRuntime } from './agent/CodeBuddySDKRuntime'
import { configStore } from './config/ConfigStore'
import { sessionStore } from './config/SessionStore'
import Anthropic from '@anthropic-ai/sdk'

// Extend App type to include isQuitting property
declare global {
  namespace Electron {
    interface App {
      isQuitting?: boolean
    }
  }
}

dotenv.config()

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

// Internal MCP Server Runner
// MiniMax startup removed
// --- Normal App Initialization ---

let mainWin: BrowserWindow | null = null
let floatingBallWin: BrowserWindow | null = null
let tray: Tray | null = null
let agent: AgentRuntime | CLIAgentRuntime | CodeBuddySDKRuntime | null = null

// Ball state
let isBallExpanded = false
const BALL_SIZE = 64
const EXPANDED_WIDTH = 340    // Match w-80 (320px) + padding
const EXPANDED_HEIGHT = 320   // Compact height for less dramatic expansion

app.on('before-quit', () => {
  app.isQuitting = true
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow()
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
  // Set App User Model ID for Windows notifications
  app.setAppUserModelId('com.opencowork.app')

  // Set app icon for macOS dock
  if (process.platform === 'darwin') {
    const logoPath = path.join(process.env.VITE_PUBLIC || '', 'logo.png')
    const appIcon = nativeImage.createFromPath(logoPath)
    if (!appIcon.isEmpty()) {
      app.dock.setIcon(appIcon)
    }
  }

  // Register Protocol Client
  if (app.isPackaged) {
    app.setAsDefaultProtocolClient('opencowork')
  } else {
    console.log('Skipping protocol registration in Dev mode.')
  }

  // 1. Setup IPC handlers FIRST
  // 1. Setup IPC handlers FIRST
  // setupIPCHandlers() - handlers are defined at top level now

  // 2. Create windows
  createMainWindow()
  createFloatingBallWindow()

  // 3. Initialize agent AFTER windows are created
  initializeAgent()

  // 4. Create system tray
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

  console.log('CodeBuddy Work started. Press Alt+Space to toggle floating ball.')
})


//Functions defined outside the block to ensure proper hoisiting and scope access (vars are global to file)

// IPC Handlers

ipcMain.handle('agent:send-message', async (_event, message: string | { content: string, images: string[] }) => {
  if (!agent) throw new Error('Agent not initialized')
  return await agent.processUserMessage(message)
})

ipcMain.handle('agent:abort', () => {
  agent?.abort()
})

ipcMain.handle('agent:confirm-response', (_, { id, approved, remember, tool, path }: { id: string, approved: boolean, remember?: boolean, tool?: string, path?: string }) => {
  if (approved && remember && tool) {
    configStore.addPermission(tool, path)
    console.log(`[Permission] Saved: ${tool} for path: ${path || '*'}`)
  }
  agent?.handleConfirmResponse(id, approved)
})

ipcMain.handle('agent:new-session', () => {
  agent?.clearHistory()
  const session = sessionStore.createSession()
  return { success: true, sessionId: session.id }
})

// Session Management
ipcMain.handle('session:list', () => {
  return sessionStore.getSessions()
})

ipcMain.handle('session:get', (_, id: string) => {
  return sessionStore.getSession(id)
})

ipcMain.handle('session:load', (_, id: string) => {
  const session = sessionStore.getSession(id)
  if (session && agent) {
    agent.loadHistory(session.messages)
    sessionStore.setCurrentSession(id)
    return { success: true }
  }
  return { error: 'Session not found' }
})

ipcMain.handle('session:save', (_, messages: Anthropic.MessageParam[]) => {
  const currentId = sessionStore.getCurrentSessionId()
  if (currentId) {
    sessionStore.updateSession(currentId, messages)
    return { success: true }
  }
  // Create new session if none exists
  const session = sessionStore.createSession()
  sessionStore.updateSession(session.id, messages)
  return { success: true, sessionId: session.id }
})

ipcMain.handle('session:delete', (_, id: string) => {
  sessionStore.deleteSession(id)
  return { success: true }
})

ipcMain.handle('session:current', () => {
  const id = sessionStore.getCurrentSessionId()
  return id ? sessionStore.getSession(id) : null
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
  return true
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

  // Reinitialize agent
  initializeAgent()
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

// MCP Configuration Handlers
const mcpConfigPath = path.join(os.homedir(), '.opencowork', 'mcp.json');

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

    // Update agent services
    if (agent) {
      // We might need to reload MCP client here, but for now just saving is enough.
      // The user might need to restart app or we can add a reload capability later.
    }
    return { success: true };
  } catch (e) {
    console.error('Failed to save MCP config:', e);
    return { success: false, error: (e as Error).message };
  }
});

// Skills Management Handlers
const skillsDir = path.join(os.homedir(), '.opencowork', 'skills');

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


function initializeAgent() {
  try {
    const apiKey = configStore.getApiKey() || process.env.ANTHROPIC_API_KEY
    const integrationMode = configStore.getIntegrationMode()
    
    console.log('[main] Initializing agent...')
    console.log('[main] Integration mode:', integrationMode)

    if (!mainWin) {
      console.warn('[main] Main window not available for agent initialization')
      return
    }

    // Inject CodeBuddy environment variables from stored config (UI values take priority)
    // Default to 'ioa' for internal network environment
    try {
      const storedApiKey = configStore.getCodeBuddyApiKey()
      const storedInternetEnv = configStore.getCodeBuddyInternetEnv() // defaults to 'ioa'
      
      if (storedApiKey && storedApiKey.trim() !== '') {
        process.env.CODEBUDDY_API_KEY = storedApiKey
        console.log('[main] Injected CODEBUDDY_API_KEY from stored config')
      }
      // Always set internet environment, default to 'ioa'
      process.env.CODEBUDDY_INTERNET_ENVIRONMENT = storedInternetEnv || 'ioa'
      console.log('[main] Injected CODEBUDDY_INTERNET_ENVIRONMENT:', process.env.CODEBUDDY_INTERNET_ENVIRONMENT)
    } catch (envErr) {
      console.error('[main] Failed to inject CodeBuddy env vars:', envErr)
      // Fallback to default
      process.env.CODEBUDDY_INTERNET_ENVIRONMENT = 'ioa'
    }

    if (integrationMode === 'sdk-codebuddy') {
      // Initialize SDK-based CodeBuddy agent
      const codeBuddyApiKey = configStore.getCodeBuddyApiKey()
      const codeBuddyInternetEnv = configStore.getCodeBuddyInternetEnv()
      
      console.log('[main] Initializing CodeBuddy SDK Agent...')
      console.log('[main] CodeBuddy API Key:', codeBuddyApiKey ? '***' + codeBuddyApiKey.slice(-8) : 'NOT SET')
      console.log('[main] CodeBuddy Internet Env:', codeBuddyInternetEnv || 'NOT SET')

      agent = new CodeBuddySDKRuntime(mainWin, codeBuddyApiKey, codeBuddyInternetEnv)
      if (floatingBallWin) {
        agent.addWindow(floatingBallWin)
      }
      (global as Record<string, unknown>).agent = agent
      agent.initialize().catch(err => console.error('[main] CodeBuddy SDK initialization failed:', err))
      console.log('[main] CodeBuddy SDK Agent initialized')

  } else if (integrationMode === 'cli-codebuddy') {
    // Initialize CLI-based CodeBuddy agent
    console.log('[main] Initializing CodeBuddy CLI Agent...')
    agent = new CLIAgentRuntime(mainWin)
    if (floatingBallWin) {
      agent.addWindow(floatingBallWin)
    }
    (global as Record<string, unknown>).agent = agent
    agent.initialize().catch(err => console.error('[main] CodeBuddy CLI initialization failed:', err))
    console.log('[main] CodeBuddy CLI Agent initialized')
    
  } else {
    // Initialize API-based agent (default)
    if (apiKey) {
      console.log('[main] Initializing API Agent...')
      console.log('[main] Model:', configStore.getModel())
      console.log('[main] API URL:', configStore.getApiUrl())
      
      agent = new AgentRuntime(apiKey, mainWin, configStore.getModel(), configStore.getApiUrl())
      if (floatingBallWin) {
        agent.addWindow(floatingBallWin)
      }
      (global as Record<string, unknown>).agent = agent
      agent.initialize().catch(err => console.error('[main] Agent initialization failed:', err))
      console.log('[main] API Agent initialized')
    } else {
      console.warn('[main] No API Key found. Please configure in Settings.')
    }
  }
  } catch (err) {
    console.error('[main] Critical error during agent initialization:', err)
    // Don't crash the app, just log the error
  }
}

function createTray() {
  try {
    const logoPath = path.join(process.env.VITE_PUBLIC || '', 'logo.png')
    let trayIcon = nativeImage.createFromPath(logoPath)
    
    // Resize for macOS menu bar (16x16 is standard, use 32x32 for Retina)
    if (process.platform === 'darwin') {
      trayIcon = trayIcon.resize({ width: 18, height: 18 })
    } else {
      trayIcon = trayIcon.resize({ width: 20, height: 20 })
    }
    
    tray = new Tray(trayIcon)
  } catch (e) {
    console.error('[Main] Failed to create tray icon:', e)
    const blankIcon = nativeImage.createEmpty()
    tray = new Tray(blankIcon)
  }

  tray.setToolTip('CodeBuddy Work')

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示主窗口',
      click: () => {
        mainWin?.show()
        mainWin?.focus()
      }
    },
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
    if (mainWin) {
      if (mainWin.isVisible()) {
        mainWin.hide()
      } else {
        mainWin.show()
        mainWin.focus()
      }
    }
  })
}

function createMainWindow() {
  // Platform-specific window options
  const isMac = process.platform === 'darwin'
  
  mainWin = new BrowserWindow({
    width: 480,
    height: 720,
    minWidth: 400,
    minHeight: 600,
    icon: path.join(process.env.VITE_PUBLIC || '', 'logo.png'),
    frame: false,
    // On macOS: use hiddenInset for native traffic lights
    // On Windows/Linux: completely frameless, custom controls in renderer
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    // Add extra space for traffic lights on macOS
    trafficLightPosition: isMac ? { x: 12, y: 12 } : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
    },
    show: false,
  })

  // Remove menu bar
  mainWin.setMenu(null)

  mainWin.once('ready-to-show', () => {
    console.log('Main window ready.')
    mainWin?.show()
  })

  mainWin.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault()
      mainWin?.hide()
    }
  })

  // Handle render process crash - auto recover
  mainWin.webContents.on('render-process-gone', (_event: unknown, details: { reason: string }) => {
    console.error('[Main] Render process gone:', details.reason)
    if (details.reason !== 'clean-exit' && mainWin && !mainWin.isDestroyed()) {
      console.log('[Main] Attempting to reload main window...')
      setTimeout(() => {
        try {
          if (mainWin && !mainWin.isDestroyed()) {
            mainWin.reload()
          }
        } catch (err) {
          console.error('[Main] Failed to reload:', err)
        }
      }, 1000)
    }
  })

  // Handle crashes
  mainWin.webContents.on('crashed' as any, () => {
    console.error('[Main] Main window crashed, reloading...')
    setTimeout(() => {
      try {
        if (mainWin && !mainWin.isDestroyed()) {
          mainWin.reload()
        }
      } catch (err) {
        console.error('[Main] Failed to reload after crash:', err)
      }
    }, 1000)
  })

  mainWin.webContents.on('did-finish-load', () => {
    mainWin?.webContents.send('main-process-message', (new Date).toLocaleString())
  })

  if (VITE_DEV_SERVER_URL) {
    mainWin.loadURL(VITE_DEV_SERVER_URL)
  } else {
    mainWin.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
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
    icon: path.join(process.env.VITE_PUBLIC, 'logo.png'),
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
    if (agent && floatingBallWin) {
      agent.removeWindow(floatingBallWin)
    }
    floatingBallWin = null
  })

  // Add to agent after creation
  floatingBallWin.webContents.on('did-finish-load', () => {
    if (agent && floatingBallWin) {
      agent.addWindow(floatingBallWin)
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
