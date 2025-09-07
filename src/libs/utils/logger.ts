// Logger utility for Cloud Run Logs Explorer
type LogData = Record<string, unknown>

export const logger = {
  info: (message: string, data?: LogData) => {
    const logEntry = {
      severity: 'INFO',
      message,
      ...data && { data },
      timestamp: new Date().toISOString()
    }
    
    // Send to server API
    fetch('/api/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(logEntry)
    }).catch(() => {
      // Fallback to console if API call fails
      console.log(JSON.stringify(logEntry))
    })
  },

  warn: (message: string, data?: LogData) => {
    const logEntry = {
      severity: 'WARNING',
      message,
      ...data && { data },
      timestamp: new Date().toISOString()
    }
    
    // Send to server API
    fetch('/api/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(logEntry)
    }).catch(() => {
      // Fallback to console if API call fails
      console.warn(JSON.stringify(logEntry))
    })
  },

  error: (message: string, error?: Error | string) => {
    const logEntry = {
      severity: 'ERROR',
      message,
      ...(error instanceof Error ? {
        error: error.message,
        stack: error.stack
      } : { error: String(error) }),
      timestamp: new Date().toISOString()
    }

    // Send to server API
    fetch('/api/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(logEntry)
    }).catch(() => {
      // Fallback to console if API call fails
      console.error(JSON.stringify(logEntry))
    })
  },

  debug: (message: string, data?: LogData) => {
    const logEntry = {
      severity: 'DEBUG',
      message,
      ...data && { data },
      timestamp: new Date().toISOString()
    }

    // Send to server API
    fetch('/api/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(logEntry)
    }).catch(() => {
      // Fallback to console if API call fails
      console.debug(JSON.stringify(logEntry))
    })
  }
} 