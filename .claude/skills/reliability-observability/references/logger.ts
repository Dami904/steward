/**
 * Minimal structured logger. No external dependency required.
 *
 * Every log line is a single JSON object so it's greppable and pipeable
 * into whatever you actually use for aggregation later (Axiom, Sentry,
 * Vercel log drains, plain stdout collection). Wire that in inside
 * `error()` — everything else in this file can stay as-is.
 */

type LogLevel = "debug" | "info" | "warn" | "error";

interface LogMeta {
  [key: string]: unknown;
}

interface LogEntry {
  ts: string;
  level: LogLevel;
  msg: string;
  service: string;
  requestId?: string;
  [key: string]: unknown;
}

const SERVICE_NAME = process.env.SERVICE_NAME ?? "app";

class Logger {
  private context: LogMeta;

  constructor(context: LogMeta = {}) {
    this.context = context;
  }

  /** Returns a child logger with extra fields merged onto every line it emits. */
  with(context: LogMeta): Logger {
    return new Logger({ ...this.context, ...context });
  }

  debug(msg: string, meta?: LogMeta) {
    this.emit("debug", msg, meta);
  }

  info(msg: string, meta?: LogMeta) {
    this.emit("info", msg, meta);
  }

  warn(msg: string, meta?: LogMeta) {
    this.emit("warn", msg, meta);
  }

  /**
   * Always call this in a catch block, even if you're also returning a
   * clean error to the caller. The caller gets the clean message; this
   * line is what lets you debug it after the fact.
   */
  error(msg: string, err?: unknown, meta?: LogMeta) {
    const errInfo =
      err instanceof Error
        ? { errorName: err.name, errorMessage: err.message, stack: err.stack }
        : err !== undefined
          ? { error: err }
          : {};
    this.emit("error", msg, { ...errInfo, ...meta });

    // Wire your error-tracking service here, e.g.:
    // if (process.env.SENTRY_DSN) Sentry.captureException(err, { extra: meta });
  }

  private emit(level: LogLevel, msg: string, meta?: LogMeta) {
    const entry: LogEntry = {
      ts: new Date().toISOString(),
      level,
      msg,
      service: SERVICE_NAME,
      ...this.context,
      ...meta,
    };
    const line = JSON.stringify(entry);
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
  }
}

export const logger = new Logger();

/** Attach a stable id to every log line from one request/execution. */
export function withRequestId(requestId: string): Logger {
  return logger.with({ requestId });
}

export function newRequestId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
