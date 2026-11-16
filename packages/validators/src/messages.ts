/*
 * The catalog's operator sentences, under ADR-0164. Each is a function of the settings it repeats,
 * or a constant, and the public issue code in `codes.ts` that prints it calls it. A sentence repeats
 * a rule's settings and never the rejected value. `tests/message-voice.test.ts` holds this module to
 * the failure message voice.
 */
import { escapeControlCharacters } from '@loomcli/core';

import { formatBytes } from './bytes-grammar.js';
import { formatDuration } from './duration-grammar.js';
import { listing } from './issues.js';
import type { PathKind } from './probe.js';
import { formatTimeOfDay } from './time-grammar.js';

const oneCharacter = 1;

/**
 * A count of characters, reading `character` for a count of 1.
 *
 * @example
 * ```ts
 * characters(1); // '1 character'
 * ```
 */
function characters(count: number): string {
  return count === oneCharacter ? '1 character' : `${String(count)} characters`;
}

/**
 * The declared settings a sentence lists, joined as a sentence lists them and escaped, because an
 * author declares them.
 *
 * @example
 * ```ts
 * listed(['https', 'http']); // 'https or http'
 * ```
 */
function listed(items: readonly string[]): string {
  return escapeControlCharacters(listing(items));
}

/** How each kind reads in a readable-path sentence. */
const readableKinds: Readonly<Record<PathKind, string>> = {
  any: 'file or directory',
  directory: 'directory',
  file: 'file',
};

/** How each kind reads in a writable-path sentence. */
const writableKinds: Readonly<Record<PathKind, string>> = {
  any: 'path',
  directory: 'directory',
  file: 'file',
};

/**
 * How a kind of path reads in a readable-path sentence.
 *
 * @example
 * ```ts
 * readableKind('any'); // 'file or directory'
 * ```
 */
function readableKind(kind: PathKind): string {
  return readableKinds[kind];
}

/**
 * How a kind of path reads in a writable-path sentence.
 *
 * @example
 * ```ts
 * writableKind('any'); // 'path'
 * ```
 */
function writableKind(kind: PathKind): string {
  return writableKinds[kind];
}

/**
 * The `text-nonempty` sentence.
 *
 * @example
 * ```ts
 * expectedNonempty; // 'Expected a nonempty value.'
 * ```
 */
const expectedNonempty = 'Expected a nonempty value.';

/**
 * The `text-min-length` sentence.
 *
 * @example
 * ```ts
 * expectedMinLength(3); // 'Expected at least 3 characters.'
 * ```
 */
function expectedMinLength(min: number): string {
  return `Expected at least ${characters(min)}.`;
}

/**
 * The `text-max-length` sentence.
 *
 * @example
 * ```ts
 * expectedMaxLength(64); // 'Expected at most 64 characters.'
 * ```
 */
function expectedMaxLength(max: number): string {
  return `Expected at most ${characters(max)}.`;
}

/**
 * The `text-exact-length` sentence.
 *
 * @example
 * ```ts
 * expectedExactLength(8); // 'Expected exactly 8 characters.'
 * ```
 */
function expectedExactLength(length: number): string {
  return `Expected exactly ${characters(length)}.`;
}

/**
 * The `text-length-range` sentence.
 *
 * @example
 * ```ts
 * expectedLengthRange(1, 64); // 'Expected from 1 through 64 characters.'
 * ```
 */
function expectedLengthRange(min: number, max: number): string {
  return `Expected from ${String(min)} through ${characters(max)}.`;
}

/**
 * The `integer` sentence.
 *
 * @example
 * ```ts
 * expectedInteger; // 'Expected a whole number.'
 * ```
 */
const expectedInteger = 'Expected a whole number.';

/**
 * The `integer-range` sentence.
 *
 * @example
 * ```ts
 * expectedIntegerRange(1, 64); // 'Expected a whole number from 1 through 64.'
 * ```
 */
function expectedIntegerRange(min: number, max: number): string {
  return `Expected a whole number from ${String(min)} through ${String(max)}.`;
}

/**
 * The `integer-min` sentence.
 *
 * @example
 * ```ts
 * expectedIntegerMin(1); // 'Expected a whole number of at least 1.'
 * ```
 */
function expectedIntegerMin(min: number): string {
  return `Expected a whole number of at least ${String(min)}.`;
}

/**
 * The `integer-max` sentence.
 *
 * @example
 * ```ts
 * expectedIntegerMax(64); // 'Expected a whole number of at most 64.'
 * ```
 */
function expectedIntegerMax(max: number): string {
  return `Expected a whole number of at most ${String(max)}.`;
}

/**
 * The `number` sentence.
 *
 * @example
 * ```ts
 * expectedNumber; // 'Expected a number.'
 * ```
 */
const expectedNumber = 'Expected a number.';

/**
 * The `number-range` sentence.
 *
 * @example
 * ```ts
 * expectedNumberRange(0.5, 2); // 'Expected a number from 0.5 through 2.'
 * ```
 */
function expectedNumberRange(min: number, max: number): string {
  return `Expected a number from ${String(min)} through ${String(max)}.`;
}

/**
 * The `number-min` sentence.
 *
 * @example
 * ```ts
 * expectedNumberMin(0.5); // 'Expected a number of at least 0.5.'
 * ```
 */
function expectedNumberMin(min: number): string {
  return `Expected a number of at least ${String(min)}.`;
}

/**
 * The `number-max` sentence.
 *
 * @example
 * ```ts
 * expectedNumberMax(2); // 'Expected a number of at most 2.'
 * ```
 */
function expectedNumberMax(max: number): string {
  return `Expected a number of at most ${String(max)}.`;
}

/**
 * The `port` sentence.
 *
 * @example
 * ```ts
 * expectedPort; // 'Expected a port number from 1 through 65535.'
 * ```
 */
const expectedPort = 'Expected a port number from 1 through 65535.';

/**
 * The `one-of` sentence. The values are the author's, so the sentence escapes them.
 *
 * @example
 * ```ts
 * expectedOneOf(['dev', 'prod']); // 'Expected one of: dev, prod.'
 * ```
 */
function expectedOneOf(values: readonly string[]): string {
  return `Expected one of: ${escapeControlCharacters(values.join(', '))}.`;
}

/**
 * The `url` sentence.
 *
 * @example
 * ```ts
 * expectedUrl; // 'Expected an absolute URL, such as https://example.com.'
 * ```
 */
const expectedUrl = 'Expected an absolute URL, such as https://example.com.';

/**
 * The `url-scheme` sentence.
 *
 * @example
 * ```ts
 * expectedUrlScheme(['https']); // 'Expected an absolute URL with the scheme https.'
 * ```
 */
function expectedUrlScheme(protocols: readonly string[]): string {
  return `Expected an absolute URL with the scheme ${listed(protocols)}.`;
}

/**
 * The `uuid` sentence.
 *
 * @example
 * ```ts
 * expectedUuid; // 'Expected a UUID, such as 123e4567-e89b-12d3-a456-426614174000.'
 * ```
 */
const expectedUuid = 'Expected a UUID, such as 123e4567-e89b-12d3-a456-426614174000.';

/**
 * The `date` sentence.
 *
 * @example
 * ```ts
 * expectedDate; // 'Expected a date as YYYY-MM-DD, such as 2026-09-25.'
 * ```
 */
const expectedDate = 'Expected a date as YYYY-MM-DD, such as 2026-09-25.';

/**
 * The `date-time` sentence.
 *
 * @example
 * ```ts
 * expectedDateTime; // 'Expected a date and time, such as 2026-09-25T14:30:00Z or 2026-09-25 14:30.'
 * ```
 */
const expectedDateTime =
  'Expected a date and time, such as 2026-09-25T14:30:00Z or 2026-09-25 14:30.';

/**
 * The `date-layouts` sentence.
 *
 * @example
 * ```ts
 * expectedDateLayouts(['YYYY-MM-DD']); // 'Expected a date as YYYY-MM-DD, such as 2026-09-25.'
 * ```
 */
function expectedDateLayouts(forms: readonly string[]): string {
  return `Expected a date as ${listed(forms)}, such as 2026-09-25.`;
}

/**
 * The `date-time-layouts` sentence.
 *
 * @example
 * ```ts
 * expectedDateTimeLayouts(['YYYY-MM-DDThh:mm']);
 * // 'Expected a date and time as YYYY-MM-DDThh:mm, such as 2026-09-25T14:30:00Z.'
 * ```
 */
function expectedDateTimeLayouts(forms: readonly string[]): string {
  return `Expected a date and time as ${listed(forms)}, such as 2026-09-25T14:30:00Z.`;
}

/**
 * The `time` sentence.
 *
 * @example
 * ```ts
 * expectedTime; // 'Expected a time of day, such as 09:30 or 17:45:30.'
 * ```
 */
const expectedTime = 'Expected a time of day, such as 09:30 or 17:45:30.';

/**
 * The `time-layouts` sentence.
 *
 * @example
 * ```ts
 * expectedTimeLayouts(['hh:mm']); // 'Expected a time of day as hh:mm, such as 09:30.'
 * ```
 */
function expectedTimeLayouts(forms: readonly string[]): string {
  return `Expected a time of day as ${listed(forms)}, such as 09:30.`;
}

/**
 * The `time-range` sentence, with each bound in milliseconds since midnight.
 *
 * @example
 * ```ts
 * expectedTimeRange(32_400_000, 61_200_000); // 'Expected a time from 09:00 through 17:00.'
 * ```
 */
function expectedTimeRange(min: number, max: number): string {
  return `Expected a time from ${formatTimeOfDay(min)} through ${formatTimeOfDay(max)}.`;
}

/**
 * The `time-min` sentence, with the bound in milliseconds since midnight.
 *
 * @example
 * ```ts
 * expectedTimeMin(32_400_000); // 'Expected a time of at least 09:00.'
 * ```
 */
function expectedTimeMin(min: number): string {
  return `Expected a time of at least ${formatTimeOfDay(min)}.`;
}

/**
 * The `time-max` sentence, with the bound in milliseconds since midnight.
 *
 * @example
 * ```ts
 * expectedTimeMax(61_200_000); // 'Expected a time of at most 17:00.'
 * ```
 */
function expectedTimeMax(max: number): string {
  return `Expected a time of at most ${formatTimeOfDay(max)}.`;
}

/**
 * The `duration` sentence.
 *
 * @example
 * ```ts
 * expectedDuration; // 'Expected a duration, such as 90s, 2h30m, or 1.5h.'
 * ```
 */
const expectedDuration = 'Expected a duration, such as 90s, 2h30m, or 1.5h.';

/**
 * The `duration-capital-m` sentence.
 *
 * @example
 * ```ts
 * expectedDurationMinutes; // 'Expected a duration; write minutes as m or min, because M is ambiguous.'
 * ```
 */
const expectedDurationMinutes =
  'Expected a duration; write minutes as m or min, because M is ambiguous.';

/**
 * The `duration-range` sentence, with each bound in milliseconds.
 *
 * @example
 * ```ts
 * expectedDurationRange(30_000, 3_600_000); // 'Expected a duration from 30s through 1h.'
 * ```
 */
function expectedDurationRange(min: number, max: number): string {
  return `Expected a duration from ${formatDuration(min)} through ${formatDuration(max)}.`;
}

/**
 * The `duration-min` sentence, with the bound in milliseconds.
 *
 * @example
 * ```ts
 * expectedDurationMin(30_000); // 'Expected a duration of at least 30s.'
 * ```
 */
function expectedDurationMin(min: number): string {
  return `Expected a duration of at least ${formatDuration(min)}.`;
}

/**
 * The `duration-max` sentence, with the bound in milliseconds.
 *
 * @example
 * ```ts
 * expectedDurationMax(3_600_000); // 'Expected a duration of at most 1h.'
 * ```
 */
function expectedDurationMax(max: number): string {
  return `Expected a duration of at most ${formatDuration(max)}.`;
}

/**
 * The `path` sentence.
 *
 * @example
 * ```ts
 * expectedPath; // 'Expected a nonempty path with no NUL character.'
 * ```
 */
const expectedPath = 'Expected a nonempty path with no NUL character.';

/**
 * The `path-readable` sentence.
 *
 * @example
 * ```ts
 * expectedReadablePath('file'); // 'Expected a readable file that exists.'
 * ```
 */
function expectedReadablePath(kind: PathKind): string {
  return `Expected a readable ${readableKind(kind)} that exists.`;
}

/**
 * The `path-writable` sentence.
 *
 * @example
 * ```ts
 * expectedWritablePath('file');
 * // 'Expected a writable file, or a new file in a writable directory.'
 * ```
 */
function expectedWritablePath(kind: PathKind): string {
  return `Expected a writable ${writableKind(kind)}, or a new ${writableKind(kind)} in a writable directory.`;
}

/**
 * The `bytes` sentence.
 *
 * @example
 * ```ts
 * expectedSize; // 'Expected a size, such as 512KiB, 10MB, or 1.5GB.'
 * ```
 */
const expectedSize = 'Expected a size, such as 512KiB, 10MB, or 1.5GB.';

/**
 * The `bytes-range` sentence, with each bound in bytes.
 *
 * @example
 * ```ts
 * expectedSizeRange(1024, 1_048_576); // 'Expected a size from 1KiB through 1MiB.'
 * ```
 */
function expectedSizeRange(min: number, max: number): string {
  return `Expected a size from ${formatBytes(min)} through ${formatBytes(max)}.`;
}

/**
 * The `bytes-min` sentence, with the bound in bytes.
 *
 * @example
 * ```ts
 * expectedSizeMin(1024); // 'Expected a size of at least 1KiB.'
 * ```
 */
function expectedSizeMin(min: number): string {
  return `Expected a size of at least ${formatBytes(min)}.`;
}

/**
 * The `bytes-max` sentence, with the bound in bytes.
 *
 * @example
 * ```ts
 * expectedSizeMax(1_048_576); // 'Expected a size of at most 1MiB.'
 * ```
 */
function expectedSizeMax(max: number): string {
  return `Expected a size of at most ${formatBytes(max)}.`;
}

/**
 * The `host` sentence.
 *
 * @example
 * ```ts
 * expectedHost; // 'Expected a host name, such as example.com.'
 * ```
 */
const expectedHost = 'Expected a host name, such as example.com.';

/**
 * The `host-or-ip` sentence.
 *
 * @example
 * ```ts
 * expectedHostOrIp;
 * // 'Expected a host name or an IP address, such as example.com, 192.0.2.1, or [2001:db8::1].'
 * ```
 */
const expectedHostOrIp =
  'Expected a host name or an IP address, such as example.com, 192.0.2.1, or [2001:db8::1].';

/**
 * The `ip` sentence.
 *
 * @example
 * ```ts
 * expectedIp; // 'Expected an IP address, such as 192.0.2.1 or 2001:db8::1.'
 * ```
 */
const expectedIp = 'Expected an IP address, such as 192.0.2.1 or 2001:db8::1.';

/**
 * The `ip-v4` sentence.
 *
 * @example
 * ```ts
 * expectedIpV4; // 'Expected an IPv4 address, such as 192.0.2.1.'
 * ```
 */
const expectedIpV4 = 'Expected an IPv4 address, such as 192.0.2.1.';

/**
 * The `ip-v6` sentence.
 *
 * @example
 * ```ts
 * expectedIpV6; // 'Expected an IPv6 address, such as 2001:db8::1.'
 * ```
 */
const expectedIpV6 = 'Expected an IPv6 address, such as 2001:db8::1.';

/**
 * The `cidr` sentence.
 *
 * @example
 * ```ts
 * expectedCidr; // 'Expected a CIDR block, such as 192.0.2.0/24 or 2001:db8::/32.'
 * ```
 */
const expectedCidr = 'Expected a CIDR block, such as 192.0.2.0/24 or 2001:db8::/32.';

/**
 * The `cidr-v4` sentence.
 *
 * @example
 * ```ts
 * expectedCidrV4; // 'Expected an IPv4 CIDR block, such as 192.0.2.0/24.'
 * ```
 */
const expectedCidrV4 = 'Expected an IPv4 CIDR block, such as 192.0.2.0/24.';

/**
 * The `cidr-v6` sentence.
 *
 * @example
 * ```ts
 * expectedCidrV6; // 'Expected an IPv6 CIDR block, such as 2001:db8::/32.'
 * ```
 */
const expectedCidrV6 = 'Expected an IPv6 CIDR block, such as 2001:db8::/32.';

/**
 * The `cidr-host-bits` sentence.
 *
 * @example
 * ```ts
 * expectedNetworkAddress; // 'Expected a network address with no bits set below the prefix.'
 * ```
 */
const expectedNetworkAddress = 'Expected a network address with no bits set below the prefix.';

/**
 * The `key-value` sentence. The separator is the author's, so the sentence escapes it.
 *
 * @example
 * ```ts
 * expectedKeyValue(':'); // 'Expected a key and a value as key:value.'
 * ```
 */
function expectedKeyValue(separator: string): string {
  return `Expected a key and a value as key${escapeControlCharacters(separator)}value.`;
}

/**
 * The `email` sentence.
 *
 * @example
 * ```ts
 * expectedEmail; // 'Expected an email address, such as name@example.com.'
 * ```
 */
const expectedEmail = 'Expected an email address, such as name@example.com.';

export {
  expectedCidr,
  expectedCidrV4,
  expectedCidrV6,
  expectedDate,
  expectedDateLayouts,
  expectedDateTime,
  expectedDateTimeLayouts,
  expectedDuration,
  expectedDurationMax,
  expectedDurationMin,
  expectedDurationMinutes,
  expectedDurationRange,
  expectedEmail,
  expectedExactLength,
  expectedHost,
  expectedHostOrIp,
  expectedInteger,
  expectedIntegerMax,
  expectedIntegerMin,
  expectedIntegerRange,
  expectedIp,
  expectedIpV4,
  expectedIpV6,
  expectedKeyValue,
  expectedLengthRange,
  expectedMaxLength,
  expectedMinLength,
  expectedNetworkAddress,
  expectedNonempty,
  expectedNumber,
  expectedNumberMax,
  expectedNumberMin,
  expectedNumberRange,
  expectedOneOf,
  expectedPath,
  expectedPort,
  expectedReadablePath,
  expectedSize,
  expectedSizeMax,
  expectedSizeMin,
  expectedSizeRange,
  expectedTime,
  expectedTimeLayouts,
  expectedTimeMax,
  expectedTimeMin,
  expectedTimeRange,
  expectedUrl,
  expectedUrlScheme,
  expectedUuid,
  expectedWritablePath,
};
