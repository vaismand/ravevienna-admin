export async function captureOutput(
  fn: () => Promise<void>
): Promise<{ output: string; exitCode: number }> {
  const lines: string[] = [];

  const append = (chunk: string) => {
    lines.push(chunk.replace(/\r?\n$/, ""));
  };

  const origLog = console.log;
  const origError = console.error;
  const origWarn = console.warn;

  console.log = (...args: unknown[]) => {
    append(
      args
        .map((arg) =>
          typeof arg === "string" ? arg : JSON.stringify(arg, null, 2)
        )
        .join(" ")
    );
    origLog(...args);
  };

  console.error = (...args: unknown[]) => {
    append(
      args
        .map((arg) =>
          typeof arg === "string" ? arg : JSON.stringify(arg, null, 2)
        )
        .join(" ")
    );
    origError(...args);
  };

  console.warn = (...args: unknown[]) => {
    append(
      args
        .map((arg) =>
          typeof arg === "string" ? arg : JSON.stringify(arg, null, 2)
        )
        .join(" ")
    );
    origWarn(...args);
  };

  try {
    await fn();
    return { output: lines.join("\n"), exitCode: 0 };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    append(message);
    return { output: lines.join("\n"), exitCode: 1 };
  } finally {
    console.log = origLog;
    console.error = origError;
    console.warn = origWarn;
  }
}
