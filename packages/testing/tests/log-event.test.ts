import { Writable } from 'node:stream';

import type { FailureForm, LogDestination, LogEvent } from '@loomcli/core';
import { describe, expect, it } from 'vite-plus/test';

import { logDestination, logEvent } from '../src/index.js';

/** Writes an error or fatal event as one line on the destination's stderr. */
function writeEvent(event: LogEvent, destination: LogDestination): void {
  if (event.level === 'error' || event.level === 'fatal') {
    destination.stderr?.write(`${event.level}: ${event.message}\n`);
  }
}

describe('logEvent', () => {
  it('an unstated member takes its fixed default', () => {
    expect(logEvent()).toEqual({
      application: { name: 'app', version: '0.0.0' },
      fields: {},
      level: 'info',
      message: '',
      path: [],
      plugin: null,
      run: '0'.repeat(32),
      time: '2026-01-01T00:00:00.000Z',
    });
    expect(Object.keys(logEvent())).not.toContain('failure');
    expect(Object.keys(logEvent())).not.toContain('defect');
  });

  it('a stated member replaces its default whole', () => {
    const failure: FailureForm = {
      code: 'loom/usage',
      exitCode: 2,
      hints: [],
      message: 'Bad flag.',
    };
    const event = logEvent({
      application: { name: 'notes', version: '1.2.0' },
      failure,
      fields: { attempt: 2 },
      level: 'error',
      message: 'Sync failed.',
      path: ['sync'],
      plugin: '@acme/sync',
    });
    expect(event).toEqual({
      application: { name: 'notes', version: '1.2.0' },
      failure,
      fields: { attempt: 2 },
      level: 'error',
      message: 'Sync failed.',
      path: ['sync'],
      plugin: '@acme/sync',
      run: '0'.repeat(32),
      time: '2026-01-01T00:00:00.000Z',
    });
  });

  it('a hook writes the event whole as one JSON record', () => {
    expect(JSON.stringify(logEvent({ message: 'Started.' }))).toBe(
      '{"application":{"name":"app","version":"0.0.0"},"fields":{},"level":"info","message":"Started.","path":[],"plugin":null,"run":"00000000000000000000000000000000","time":"2026-01-01T00:00:00.000Z"}',
    );
  });

  it('the event and everything it holds are frozen, and the stated values are not', () => {
    const fields = { nested: { count: 1 }, tags: ['a'] };
    const event = logEvent({ defect: { message: 'Boom.', name: 'TypeError' }, fields });
    expect(Object.isFrozen(event)).toBe(true);
    expect(Object.isFrozen(event.application)).toBe(true);
    expect(Object.isFrozen(event.path)).toBe(true);
    expect(Object.isFrozen(event.fields)).toBe(true);
    expect(Object.isFrozen(event.fields.nested)).toBe(true);
    expect(Object.isFrozen(event.fields.tags)).toBe(true);
    expect(Object.isFrozen(event.defect)).toBe(true);
    expect(Object.isFrozen(fields)).toBe(false);
    expect(Object.isFrozen(fields.nested)).toBe(false);
  });
});

describe('logDestination', () => {
  it('an unstated member takes its fixed default', () => {
    expect(logDestination()).toEqual({
      env: {},
      home: '/loom-test/home',
      platform: 'linux',
      stderr: null,
    });
  });

  it('a stated stream is the stream the hook writes to', () => {
    let written = '';
    const stderr = new Writable({
      write: (chunk, _encoding, done) => {
        written += String(chunk);
        done();
      },
    });
    const destination = logDestination({ stderr });
    expect(destination.stderr).toBe(stderr);
    writeEvent(logEvent({ level: 'error', message: 'Sync failed.' }), destination);
    expect(written).toBe('error: Sync failed.\n');
  });

  it('a stated member replaces its default whole, and the destination is frozen', () => {
    const env = { XDG_STATE_HOME: '/state' };
    const destination = logDestination({ env, home: '/home/ada', platform: 'darwin' });
    expect(destination).toEqual({ env, home: '/home/ada', platform: 'darwin', stderr: null });
    expect(Object.isFrozen(destination)).toBe(true);
    expect(destination.env).toBe(env);
  });
});
