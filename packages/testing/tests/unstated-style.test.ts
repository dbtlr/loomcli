import type { View } from '@loomcli/core';
import { describe, expect, it, vi } from 'vite-plus/test';

import { failureHookContext, viewContext } from '../src/index.js';

/** Renders a value as its own text. */
const plainView: View<string> = { render: (text) => text };

/** A style a test assigns in place of an answered one. */
const assigned = (text: string): string => `[${text}]`;

/** A built context's unstated style. */
function unstated() {
  return viewContext(plainView, {}).style;
}

/** Reads a name the registered types do not know, as a theme token from an installed plugin. */
function named(target: object, name: string): (text: string) => string {
  const answered: unknown = Reflect.get(target, name);
  if (typeof answered !== 'function') {
    throw new TypeError(`The style has no ${name}.`);
  }
  return (text) => String(Reflect.apply(answered, target, [text]));
}

describe('an unstated style', () => {
  it('answers every name with a style that returns its text unchanged', () => {
    const style = unstated();
    const answers = [
      style('plain'),
      style.red('plain'),
      style.bgBrightBlue('plain'),
      style.bold('plain'),
      style.reset('plain'),
      style.primary('plain'),
      style.escape('plain'),
      style.bold.primary('plain'),
      style.hex('#c97b36')('plain'),
      style.bgRgb(1, 2, 3)('plain'),
      style.ansi256(208).underline('plain'),
      named(style, 'accent')('plain'),
      named(style.bold, 'accent')('plain'),
    ];
    expect(answers).toEqual(answers.map(() => 'plain'));
  });

  it('answers the same function for a path on every read', () => {
    const style = unstated();
    expect(style.primary).toBe(style.primary);
    expect(style.bold.primary).toBe(style.bold.primary);
    expect(style.bold.primary).not.toBe(style.primary);
    expect(style.hex('#c97b36')).toBe(style.hex('#123'));
    expect(style.hex).toBe(style.hex);
    expect(style.bgHex('#123')).not.toBe(style.hex('#123'));
  });

  it('keeps a spy on the name the function asks for', () => {
    const context = failureHookContext(() => undefined, {
      application: 'notes',
      invokedBy: 'argv',
      mediaType: undefined,
      path: [],
      view: undefined,
    });
    vi.spyOn(context.style, 'primary');
    vi.spyOn(context.style.bold, 'primary');
    expect(context.style.primary('3 files')).toBe('3 files');
    context.style.bold.primary('bold');
    expect(context.style.primary).toHaveBeenCalledWith('3 files');
    expect(context.style.primary).toHaveBeenCalledOnce();
    expect(context.style.bold.primary).toHaveBeenCalledWith('bold');
  });

  it('spies on a name it has not answered yet', () => {
    const style = unstated();
    const spy = vi.spyOn(style, 'success');
    style.success('done');
    expect(spy).toHaveBeenCalledWith('done');
  });

  it('keeps a name the test assigns', () => {
    const style = unstated();
    Reflect.set(style, 'accent', assigned);
    expect(Reflect.get(style, 'accent')).toBe(assigned);
  });

  it('keeps a function its own members and is no thenable', async () => {
    const style = unstated();
    expect(Reflect.get(style, 'then')).toBeUndefined();
    await expect(Promise.resolve(style)).resolves.toBe(style);
    const members = ['call', 'apply', 'bind'];
    expect(members.map((name) => Reflect.get(style, name))).toEqual(
      members.map((name) => Reflect.get(Function.prototype, name)),
    );
    expect(style).toHaveLength(1);
    expect(style.name).toBeTypeOf('string');
  });

  it('stated by the test replaces the proxy whole', () => {
    const style = unstated();
    const context = viewContext(plainView, { style });
    expect(context.style).toBe(style);
  });
});
