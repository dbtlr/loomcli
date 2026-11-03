import type { Host } from './types.js';

/** What `raiseInterruptKeys` did with one read's text. */
interface InterruptKeys {
  /**
   * What the raised signals do to the process: `'ending'` when Ctrl-C or Ctrl-\ raised its signal,
   * `'suspending'` when only Ctrl-Z did, and `undefined` when none raised one.
   */
  readonly raised: 'ending' | 'suspending' | undefined;
  /** The text with every interrupt key removed, or `''` once a signal was raised. */
  readonly rest: string;
}

/** A signal a terminal's interrupt key raises: Ctrl-C, Ctrl-\, or Ctrl-Z. */
type InterruptSignal = 'SIGINT' | 'SIGQUIT' | 'SIGTSTP';

/**
 * The signal each interrupt key raises at a terminal in its usual mode, by the key's character:
 * Ctrl-C (0x03), Ctrl-\ (0x1c), and Ctrl-Z (0x1a). Raw mode delivers each as a byte, which UTF-8
 * and latin1 decode to the same character.
 */
const interrupts: Readonly<Record<string, InterruptSignal>> = {
  '\u0003': 'SIGINT',
  '\u001a': 'SIGTSTP',
  '\u001c': 'SIGQUIT',
};

/** Any one interrupt key. */
const interruptKey = new RegExp(`[${Object.keys(interrupts).join('')}]`, 'u');

/** Whether `text` holds an interrupt key, which ends the background query's wait at once. */
function hasInterruptKey(text: string): boolean {
  return interruptKey.test(text);
}

/**
 * Splits `text` into the signals its interrupt keys stand for, in arrival order, with several
 * Ctrl-Z keys counted once at the first one's place, and the text left without them.
 */
function splitInterruptKeys(text: string): { signals: InterruptSignal[]; rest: string } {
  const signals: InterruptSignal[] = [];
  let rest = '';
  for (const character of text) {
    const signal = interrupts[character];
    if (signal === undefined) {
      rest += character;
    } else if (signal !== 'SIGTSTP' || !signals.includes('SIGTSTP')) {
      signals.push(signal);
    }
  }
  return { rest, signals };
}

/**
 * Raises the signal each interrupt key in `text` stands for on the run's signal source, in arrival
 * order, as the key would at a cooked terminal: Ctrl-C starts the shutdown, Ctrl-\ ends the
 * process, and Ctrl-Z suspends it. Several Ctrl-Z keys raise one SIGTSTP, at the first one's place.
 * Where `host.raise` answers `false`, the process is not that terminal's: Ctrl-C and Ctrl-\ call
 * `cancel()` and Ctrl-Z does nothing. Answers which kind of signal was raised, which reaches the
 * run a moment later, and the text without its interrupt keys, or `''` once a signal was raised,
 * as a cooked terminal discards the input still unread.
 */
function raiseInterruptKeys(
  context: { readonly host: Pick<Host, 'raise'>; readonly cancel: () => void },
  text: string,
): InterruptKeys {
  const { rest, signals } = splitInterruptKeys(text);
  let raised: InterruptKeys['raised'] = undefined;
  for (const signal of signals) {
    if (context.host.raise(signal)) {
      raised = signal === 'SIGTSTP' && raised !== 'ending' ? 'suspending' : 'ending';
    } else if (signal !== 'SIGTSTP') {
      context.cancel();
    }
  }
  return { raised, rest: raised === undefined ? rest : '' };
}

export type { InterruptKeys };
export { hasInterruptKey, raiseInterruptKeys };
