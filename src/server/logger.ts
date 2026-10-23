type Level = 'debug' | 'info' | 'warn' | 'error'

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 }

let threshold = ORDER.info

export interface Logger {
  debug(message: string, detail?: unknown): void
  info(message: string, detail?: unknown): void
  warn(message: string, detail?: unknown): void
  error(message: string, detail?: unknown): void
  child(bindings: Record<string, string>): Logger
}

function formatDetail(detail: unknown): string {
  if (detail === undefined) return ''
  if (detail instanceof Error) return ` ${detail.message}`
  try {
    return ` ${JSON.stringify(detail)}`
  } catch {
    return ` ${String(detail)}`
  }
}

function write(level: Level, scope: string, message: string, detail?: unknown): void {
  if (ORDER[level] < threshold) return
  const stamp = new Date().toISOString()
  const line = `${stamp} ${level.toUpperCase().padEnd(5)} ${scope.padEnd(18)} ${message}${formatDetail(detail)}`
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

export function setLogLevel(level: string): void {
  threshold = ORDER[(level as Level)] ?? ORDER.info
}

function make(scope: string): Logger {
  return {
    debug: (message, detail) => write('debug', scope, message, detail),
    info: (message, detail) => write('info', scope, message, detail),
    warn: (message, detail) => write('warn', scope, message, detail),
    error: (message, detail) => write('error', scope, message, detail),
    child: (bindings) => make(`${scope}/${Object.values(bindings).join('/')}`),
  }
}

export const logger: Logger = make('myapi')
