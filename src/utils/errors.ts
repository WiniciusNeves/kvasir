const RED = '\x1b[31m';
const RESET = '\x1b[0m';

export function printCliError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`${RED}✖ ${message}${RESET}`);
}

export function withErrorHandling<Args extends unknown[]>(
  fn: (...args: Args) => Promise<void>
): (...args: Args) => Promise<void> {
  return async (...args: Args): Promise<void> => {
    try {
      await fn(...args);
    } catch (error) {
      printCliError(error);
    }
  };
}
