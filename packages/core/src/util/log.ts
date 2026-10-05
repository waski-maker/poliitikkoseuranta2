export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
const order: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  debug(msg: string, data?: Record<string, unknown>): void;
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
  child(scope: string): Logger;
}

/** Minimal structured JSON logger that works in Node, Deno and Bun. */
export function createLogger(level: LogLevel = 'info', scope = 'app'): Logger {
  const emit = (l: LogLevel, msg: string, data?: Record<string, unknown>) => {
    if (order[l] < order[level]) return;
    const line = JSON.stringify({ t: new Date().toISOString(), level: l, scope, msg, ...data });
    if (l === 'error' || l === 'warn') console.error(line);
    else console.log(line);
  };
  return {
    debug: (m, d) => emit('debug', m, d),
    info: (m, d) => emit('info', m, d),
    warn: (m, d) => emit('warn', m, d),
    error: (m, d) => emit('error', m, d),
    child: (s) => createLogger(level, `${scope}:${s}`),
  };
}

export const silentLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  child() {
    return silentLogger;
  },
};
