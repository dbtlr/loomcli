/** Runs an importable scenario with the process facts supplied by its test. */
export async function invoke(
  file: URL,
  words: string[] = [],
  options: {
    cwd?: string | (() => string);
    env?: Record<string, string | undefined>;
    input?: string;
  } = {},
): Promise<{ status: number | undefined; stderr: string; stdout: string }> {
  const fixture: unknown = await import(file.href);
  if (
    typeof fixture !== 'object' ||
    fixture === null ||
    !('run' in fixture) ||
    typeof fixture.run !== 'function'
  ) {
    throw new Error(`Fixture ${file.href} must export a run function.`);
  }
  const result: unknown = await fixture.run(words, options);
  if (
    typeof result !== 'object' ||
    result === null ||
    !('status' in result) ||
    (result.status !== undefined && typeof result.status !== 'number') ||
    !('stderr' in result) ||
    typeof result.stderr !== 'string' ||
    !('stdout' in result) ||
    typeof result.stdout !== 'string'
  ) {
    throw new Error(
      `Fixture ${file.href} must return status (number or undefined), stderr (string), and stdout (string).`,
    );
  }
  return { status: result.status, stderr: result.stderr, stdout: result.stdout };
}
