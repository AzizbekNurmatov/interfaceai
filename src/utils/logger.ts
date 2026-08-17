import { getGuardrails } from "../safety/guardrails.js";

type LogLevel = "info" | "warn" | "error";

function write(level: LogLevel, message: string, data?: unknown): void {
  const guardrails = getGuardrails();
  const payload = guardrails.maskUnknown({
    ts: new Date().toISOString(),
    level,
    message,
    data,
  });
  const line = JSON.stringify(payload);
  if (level === "error") console.error(line);
  else console.log(line);
}

export const logger = {
  info(message: string, data?: unknown): void {
    write("info", message, data);
  },
  warn(message: string, data?: unknown): void {
    write("warn", message, data);
  },
  error(message: string, data?: unknown): void {
    write("error", message, data);
  },
};
