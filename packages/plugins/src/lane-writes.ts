/*
 * The lane writes a plugin makes beside its own work, such as a `-v` or `-vv` line: a write that
 * fails is let go, so the plugin's caller still resolves. A stream that refused the write stays
 * broken, which the run reports as any failed write, and a lane view that threw is reported by
 * nothing else once its rejection is caught here.
 */

/** Lets a lane's failed write go, so the caller still resolves. */
function passOver(): undefined {
  return undefined;
}

/**
 * Waits for one lane write and lets a write that fails go. A lane the caller does not hold writes
 * nothing.
 */
async function say(written: Promise<void> | undefined): Promise<void> {
  await written?.catch(passOver);
}

export { passOver, say };
