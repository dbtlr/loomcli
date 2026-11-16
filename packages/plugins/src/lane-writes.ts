/*
 * The lane writes a plugin makes beside its own work, such as a `-v` or `-vv` line: a write that
 * fails is left to core's output contract, which reports it, so the plugin's caller still resolves.
 */

/** Leaves a lane's failed write to core's output contract, so the caller still resolves. */
function passOver(): undefined {
  return undefined;
}

/**
 * Waits for one lane write and lets a write that fails go, so core's output contract alone reports
 * it. A lane the caller does not hold writes nothing.
 */
async function say(written: Promise<void> | undefined): Promise<void> {
  await written?.catch(passOver);
}

export { passOver, say };
