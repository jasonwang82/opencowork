// Shared logger for the application
// Stores logs in memory for the log viewer

export interface LogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  message: string;
  data?: unknown;
}

const appLogs: LogEntry[] = [];
const MAX_LOGS = 500;

export function addLog(level: 'info' | 'warn' | 'error', message: string, data?: unknown) {
  const logEntry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    data
  };
  appLogs.push(logEntry);
  // Keep only the last MAX_LOGS entries
  if (appLogs.length > MAX_LOGS) {
    appLogs.shift();
  }
  // Also log to console
  const consoleMethod = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  consoleMethod(`[${logEntry.timestamp}] [${level.toUpperCase()}] ${message}`, data || '');
}

export function getLogs(): LogEntry[] {
  return appLogs;
}

export function clearLogs() {
  appLogs.length = 0;
  addLog('info', 'Logs cleared by user');
}

// Convenience methods
export const logger = {
  info: (message: string, data?: unknown) => addLog('info', message, data),
  warn: (message: string, data?: unknown) => addLog('warn', message, data),
  error: (message: string, data?: unknown) => addLog('error', message, data),
  getLogs,
  clearLogs
};

export default logger;

