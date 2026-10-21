import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

const fixture = new URL('fixtures/closed-pipe.mjs', import.meta.url);

/** One run of the fixture, whose host streams the scenario names. */
function run(scenario: string) {
  return invoke(fixture, [scenario]);
}

test('a closed reader on stdout stops a streaming row source and resolves 141 with nothing on stderr', () => {
  expect(run('rows')).toEqual({
    status: 141,
    stderr: '',
    stdout: [
      'stdout:1',
      'reason:closed-pipe:write EPIPE',
      'pulled:2:ended:true',
      'failures:0',
      'resolved:141',
      '',
    ].join('\n'),
  });
});

test('an action awaiting a print sees it reject with the run signal reason, and propagating it stays silent', () => {
  expect(run('print')).toEqual({
    status: 141,
    stderr: '',
    stdout: [
      'stdout:line 0',
      'rejected:true:aborted:true',
      'reason:closed-pipe:write EPIPE',
      'failures:0',
      'resolved:141',
      '',
    ].join('\n'),
  });
});

test('a socket stdout whose reader closed, which macOS reports as ENOTCONN, ends the run as a closed pipe', () => {
  expect(run('closed-socket')).toEqual({
    status: 141,
    stderr: '',
    stdout: [
      'stdout:line 0',
      'rejected:true:aborted:true',
      'reason:closed-pipe:write ENOTCONN',
      'failures:0',
      'resolved:141',
      '',
    ].join('\n'),
  });
});

test('the first cause to abort the run fixes the code between a caller abort and a closed pipe', () => {
  expect(run('caller-first')).toMatchObject({ status: 130, stderr: '' });
  expect(run('pipe-first')).toEqual({
    status: 141,
    stderr: '',
    stdout: 'reason:closed-pipe:write EPIPE\nfailures:0\nresolved:141\n',
  });
});

test('a stderr whose reader closed is a broken destination and returns 1', () => {
  expect(run('stderr')).toEqual({ status: 1, stderr: '', stdout: 'failures:1\nresolved:1\n' });
});

test('a stdout write that fails with another code is a broken destination and returns 1', () => {
  expect(run('full-disk')).toEqual({
    status: 1,
    stderr: 'probe: Something went wrong.\n',
    stdout: 'failures:1\nresolved:1\n',
  });
});
