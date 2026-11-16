/*
 * The catalog's operator sentences, under ADR-0164. A sentence repeats a rule's settings and never
 * the rejected value. `tests/message-voice.test.ts` holds this module to the failure message voice.
 */
import { escapeControlCharacters } from '@loomcli/core';

import { formatBytes } from './bytes-grammar.js';
import { formatDuration } from './duration-grammar.js';
import { listing } from './issues.js';
import type { PathKind } from './probe.js';
import { formatTimeOfDay } from './time-grammar.js';

const oneCharacter = 1;

function characters(count: number): string {
  return count === oneCharacter ? '1 character' : `${String(count)} characters`;
}

/** The declared settings a sentence lists, joined as a sentence lists them and escaped, because an author declares them. */
function listed(items: readonly string[]): string {
  return escapeControlCharacters(listing(items));
}

const readableKinds: Readonly<Record<PathKind, string>> = {
  any: 'file or directory',
  directory: 'directory',
  file: 'file',
};

const writableKinds: Readonly<Record<PathKind, string>> = {
  any: 'path',
  directory: 'directory',
  file: 'file',
};

function readableKind(kind: PathKind): string {
  return readableKinds[kind];
}

function writableKind(kind: PathKind): string {
  return writableKinds[kind];
}

const expectedNonempty = 'Expected a nonempty value.';

function expectedMinLength(min: number): string {
  return `Expected at least ${characters(min)}.`;
}

function expectedMaxLength(max: number): string {
  return `Expected at most ${characters(max)}.`;
}

function expectedExactLength(length: number): string {
  return `Expected exactly ${characters(length)}.`;
}

function expectedLengthRange(min: number, max: number): string {
  return `Expected from ${String(min)} through ${characters(max)}.`;
}

const expectedInteger = 'Expected a whole number.';

function expectedIntegerRange(min: number, max: number): string {
  return `Expected a whole number from ${String(min)} through ${String(max)}.`;
}

function expectedIntegerMin(min: number): string {
  return `Expected a whole number of at least ${String(min)}.`;
}

function expectedIntegerMax(max: number): string {
  return `Expected a whole number of at most ${String(max)}.`;
}

const expectedNumber = 'Expected a number.';

function expectedNumberRange(min: number, max: number): string {
  return `Expected a number from ${String(min)} through ${String(max)}.`;
}

function expectedNumberMin(min: number): string {
  return `Expected a number of at least ${String(min)}.`;
}

function expectedNumberMax(max: number): string {
  return `Expected a number of at most ${String(max)}.`;
}

const expectedPort = 'Expected a port number from 1 through 65535.';

function expectedOneOf(values: readonly string[]): string {
  return `Expected one of: ${escapeControlCharacters(values.join(', '))}.`;
}

const expectedUrl = 'Expected an absolute URL, such as https://example.com.';

function expectedUrlScheme(protocols: readonly string[]): string {
  return `Expected an absolute URL with the scheme ${listed(protocols)}.`;
}

const expectedUuid = 'Expected a UUID, such as 123e4567-e89b-12d3-a456-426614174000.';

const expectedDate = 'Expected a date as YYYY-MM-DD, such as 2026-09-25.';

const expectedDateTime =
  'Expected a date and time, such as 2026-09-25T14:30:00Z or 2026-09-25 14:30.';

function expectedDateLayouts(forms: readonly string[]): string {
  return `Expected a date as ${listed(forms)}, such as 2026-09-25.`;
}

function expectedDateTimeLayouts(forms: readonly string[]): string {
  return `Expected a date and time as ${listed(forms)}, such as 2026-09-25T14:30:00Z.`;
}

const expectedTime = 'Expected a time of day, such as 09:30 or 17:45:30.';

function expectedTimeLayouts(forms: readonly string[]): string {
  return `Expected a time of day as ${listed(forms)}, such as 09:30.`;
}

function expectedTimeRange(min: number, max: number): string {
  return `Expected a time from ${formatTimeOfDay(min)} through ${formatTimeOfDay(max)}.`;
}

function expectedTimeMin(min: number): string {
  return `Expected a time of at least ${formatTimeOfDay(min)}.`;
}

function expectedTimeMax(max: number): string {
  return `Expected a time of at most ${formatTimeOfDay(max)}.`;
}

const expectedDuration = 'Expected a duration, such as 90s, 2h30m, or 1.5h.';

const expectedDurationMinutes =
  'Expected a duration; write minutes as m or min, because M is ambiguous.';

function expectedDurationRange(min: number, max: number): string {
  return `Expected a duration from ${formatDuration(min)} through ${formatDuration(max)}.`;
}

function expectedDurationMin(min: number): string {
  return `Expected a duration of at least ${formatDuration(min)}.`;
}

function expectedDurationMax(max: number): string {
  return `Expected a duration of at most ${formatDuration(max)}.`;
}

const expectedPath = 'Expected a nonempty path with no NUL character.';

function expectedReadablePath(kind: PathKind): string {
  return `Expected a readable ${readableKind(kind)} that exists.`;
}

function expectedWritablePath(kind: PathKind): string {
  return `Expected a writable ${writableKind(kind)}, or a new ${writableKind(kind)} in a writable directory.`;
}

const expectedSize = 'Expected a size, such as 512KiB, 10MB, or 1.5GB.';

function expectedSizeRange(min: number, max: number): string {
  return `Expected a size from ${formatBytes(min)} through ${formatBytes(max)}.`;
}

function expectedSizeMin(min: number): string {
  return `Expected a size of at least ${formatBytes(min)}.`;
}

function expectedSizeMax(max: number): string {
  return `Expected a size of at most ${formatBytes(max)}.`;
}

const expectedHost = 'Expected a host name, such as example.com.';

const expectedHostOrIp =
  'Expected a host name or an IP address, such as example.com, 192.0.2.1, or [2001:db8::1].';

const expectedIp = 'Expected an IP address, such as 192.0.2.1 or 2001:db8::1.';

const expectedIpV4 = 'Expected an IPv4 address, such as 192.0.2.1.';

const expectedIpV6 = 'Expected an IPv6 address, such as 2001:db8::1.';

const expectedCidr = 'Expected a CIDR block, such as 192.0.2.0/24 or 2001:db8::/32.';

const expectedCidrV4 = 'Expected an IPv4 CIDR block, such as 192.0.2.0/24.';

const expectedCidrV6 = 'Expected an IPv6 CIDR block, such as 2001:db8::/32.';

const expectedNetworkAddress = 'Expected a network address with no bits set below the prefix.';

function expectedKeyValue(separator: string): string {
  return `Expected a key and a value as key${escapeControlCharacters(separator)}value.`;
}

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
