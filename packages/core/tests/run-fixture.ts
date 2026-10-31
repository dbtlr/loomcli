/** Runs an importable scenario with the process facts supplied by its test. */
export async function invoke(
  file: URL,
  words: string[] = [],
  options: { cwd?: string; env?: Record<string, string | undefined>; input?: string } = {},
): Promise<{ status: number; stderr: string; stdout: string }> {
  const fixture = await import(file.href);
  return fixture.run(words, options);
}
