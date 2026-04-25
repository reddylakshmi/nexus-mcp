type AnyRecord = Record<string, unknown>;

export function toActionableError(err: unknown, context?: { action?: string; hint?: string }): string {
  const base = (() => {
    if (err instanceof Error) return err.message || err.name;
    if (typeof err === "string") return err;
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  })();

  const parts: string[] = [];
  if (context?.action) parts.push(context.action);
  parts.push(base);
  if (context?.hint) parts.push(`Hint: ${context.hint}`);
  return parts.join(" — ");
}

export function redactSecrets(data: AnyRecord): AnyRecord {
  const redacted: AnyRecord = {};
  for (const [k, v] of Object.entries(data)) {
    if (typeof v === "string" && /token|secret|private|password|key/i.test(k)) {
      redacted[k] = v.length <= 8 ? "[redacted]" : `${v.slice(0, 3)}…[redacted]…${v.slice(-3)}`;
    } else {
      redacted[k] = v;
    }
  }
  return redacted;
}

