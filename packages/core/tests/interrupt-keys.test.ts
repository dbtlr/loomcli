import { describe, expect, it, vi } from 'vite-plus/test';

import { raiseInterruptKeys } from '../src/index.js';

const ctrlC = String.fromCodePoint(3);
const ctrlBackslash = String.fromCodePoint(28);
const ctrlZ = String.fromCodePoint(26);

/** An inert stand-in for the action's context: `raise` answers `answer`, and both calls are spies. */
function stand(answer: boolean) {
  const raise = vi.fn(() => answer);
  const cancel = vi.fn();
  return { cancel, context: { cancel, host: { raise } }, raise };
}

describe('raiseInterruptKeys', () => {
  it('raises SIGINT, SIGQUIT, and SIGTSTP in arrival order', () => {
    const { context, raise } = stand(true);
    raiseInterruptKeys(context, `a${ctrlZ}b${ctrlBackslash}${ctrlC}`);
    expect(raise.mock.calls).toEqual([['SIGTSTP'], ['SIGQUIT'], ['SIGINT']]);
  });

  it("raises one SIGTSTP for several Ctrl-Z at the first one's place", () => {
    const { context, raise } = stand(true);
    raiseInterruptKeys(context, `${ctrlZ}${ctrlC}${ctrlZ}`);
    expect(raise.mock.calls).toEqual([['SIGTSTP'], ['SIGINT']]);
  });

  it(
    String.raw`answers suspending for Ctrl-Z alone and ending once Ctrl-C or Ctrl-\ raised`,
    () => {
      expect(raiseInterruptKeys(stand(true).context, ctrlZ).raised).toBe('suspending');
      expect(raiseInterruptKeys(stand(true).context, `${ctrlZ}${ctrlC}`).raised).toBe('ending');
      expect(raiseInterruptKeys(stand(true).context, `${ctrlC}${ctrlZ}`).raised).toBe('ending');
      expect(raiseInterruptKeys(stand(true).context, ctrlBackslash).raised).toBe('ending');
    },
  );

  it('flushes the rest once a signal was raised', () => {
    expect(raiseInterruptKeys(stand(true).context, `ab${ctrlZ}cd`).rest).toBe('');
  });

  it(String.raw`cancels for Ctrl-C and Ctrl-\ and not for Ctrl-Z where raise answers false`, () => {
    const quiet = stand(false);
    expect(raiseInterruptKeys(quiet.context, `a${ctrlZ}b`)).toEqual({
      raised: undefined,
      rest: 'ab',
    });
    expect(quiet.cancel).not.toHaveBeenCalled();
    const interrupt = stand(false);
    expect(raiseInterruptKeys(interrupt.context, `a${ctrlC}b`)).toEqual({
      raised: undefined,
      rest: 'ab',
    });
    expect(interrupt.cancel).toHaveBeenCalledTimes(1);
    const quit = stand(false);
    raiseInterruptKeys(quit.context, `${ctrlBackslash}c`);
    expect(quit.cancel).toHaveBeenCalledTimes(1);
  });

  it('touches nothing when the text holds no interrupt key', () => {
    const { cancel, context, raise } = stand(true);
    expect(raiseInterruptKeys(context, 'plain\r\n')).toEqual({
      raised: undefined,
      rest: 'plain\r\n',
    });
    expect(raise).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
  });
});
