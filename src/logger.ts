export type Logger = {
  info(data: Record<string, unknown>, msg: string): void;
  warn(data: Record<string, unknown>, msg: string): void;
  error(data: Record<string, unknown>, msg: string): void;
};

export function createLogger(params: { service: string }): Logger {
  const base = { service: params.service };
  const write =
    (level: "info" | "warn" | "error") =>
    (data: Record<string, unknown>, msg: string) => {
      const line = JSON.stringify({
        ts: new Date().toISOString(),
        level,
        msg,
        ...base,
        ...data,
      });
      // eslint-disable-next-line no-console
      console[level](line);
    };

  return { info: write("info"), warn: write("warn"), error: write("error") };
}

