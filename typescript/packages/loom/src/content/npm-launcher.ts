import {
  launcherCannotStart,
  launcherMissingPackage,
  launcherNoPlatform,
} from '../commands/build/messages.js';
import { systemCause } from '../helpers/messages.js';

/** The codes an exec or a spawn of an installed file meets, each worded by `systemCause`. */
const startCodes = ['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM', 'ENOEXEC'] as const;

/**
 * The placeholder a code no line of `systemCause` names leaves in its cause, which the launcher
 * fills with the code, escaped.
 */
const codePlaceholder = '{code}';

/** What the build knows of the launcher it renders. */
interface LauncherFacts {
  /** The application's name, the binary's file name in each platform package. */
  readonly name: string;
  /** The launcher package's name, which each platform package's name starts with. */
  readonly pkg: string;
  /** The platforms the build wrote a platform package for. */
  readonly platforms: readonly string[];
  /** The version every package carries. */
  readonly version: string;
}

/**
 * The launcher's code after its facts, which holds no sentence of its own. It runs on any Node that
 * runs CommonJS, so it keeps to `var` and functions, and it reads none of `process.stdin`,
 * `process.stdout`, and `process.stderr`, so Node leaves the three descriptors as the shell gave
 * them. `escapeControlCharacters` is a copy of core's, which the tests hold to core's.
 */
const launcherCode = String.raw`var childProcess = require('child_process');
var fs = require('fs');
var os = require('os');
var path = require('path');
var tty = require('tty');

// The characters core's escapeControlCharacters escapes, as it lists them.
var controls = /[\p{Cc}\p{Zl}\p{Zp}\u{202a}-\u{202e}\u{2066}-\u{2069}\u{200e}\u{200f}\u{61c}]/gu;

// A copy of core's escapeControlCharacters: each control character, line separator, and
// bidirectional control becomes its four-digit \uXXXX escape, so a value prints on one line.
function escapeControlCharacters(text) {
  return text.replace(controls, function (character) {
    return '\\u' + character.charCodeAt(0).toString(16).padStart(4, '0');
  });
}

// Prints one of the launcher's sentences, its placeholders filled in one pass, and exits 1.
function fail(sentence, values) {
  var line = sentence.replace(/\{(platform|path|cause)\}/g, function (placeholder, key) {
    return values[key] === undefined ? '' : values[key];
  });
  fs.writeSync(2, line + '\n');
  process.exit(1);
}

// The runtime's report without its network section, which would otherwise resolve the peer of
// every open socket, as core reads it.
function networkFreeReport() {
  var report = process.report;
  if (!report || typeof report.getReport !== 'function') {
    return undefined;
  }
  if (!('excludeNetwork' in report)) {
    return report.getReport();
  }
  var excluded = report.excludeNetwork;
  report.excludeNetwork = true;
  try {
    return report.getReport();
  } finally {
    report.excludeNetwork = excluded;
  }
}

// The host's platform as a release asset names it, with -musl on a Linux whose C library is not
// glibc, read as core reads host.libc.
function hostPlatform() {
  var platform = process.platform + '-' + process.arch;
  if (process.platform !== 'linux') {
    return platform;
  }
  var report = networkFreeReport();
  var header = report && report.header;
  return header && header.glibcVersionRuntime !== undefined ? platform : platform + '-musl';
}

// The cause of a failed start in Loom's words, from the error's code alone.
function causeOf(code) {
  if (typeof code !== 'string') {
    return '';
  }
  if (Object.prototype.hasOwnProperty.call(facts.causes, code)) {
    return facts.causes[code];
  }
  return facts.otherCause.replace('{code}', escapeControlCharacters(code));
}

function cannotStart(platform, binary, code) {
  fail(facts.cannotStart, {
    cause: causeOf(code),
    path: escapeControlCharacters(binary),
    platform: escapeControlCharacters(platform),
  });
}

// The first four bytes of a program this system's exec runs: ELF, and Mach-O in its 64-bit and
// 32-bit forms in either byte order and its universal form.
var magics = ['7f454c46', 'cffaedfe', 'cefaedfe', 'cafebabe', 'feedface', 'feedfacf'];

// Whether the file starts with a program's magic number. Anything else, a shell script included,
// would start through /bin/sh on the spawn path or end Node on the exec path.
function isProgram(binary) {
  var bytes = Buffer.alloc(4);
  var descriptor = fs.openSync(binary, 'r');
  try {
    var read = fs.readSync(descriptor, bytes, 0, 4, 0);
    return read === 4 && magics.indexOf(bytes.toString('hex')) !== -1;
  } finally {
    fs.closeSync(descriptor);
  }
}

// The code a start of the binary would fail with, read before the start: a failed
// process.execve ends some Nodes at once, and a spawn runs a file that is no program through
// /bin/sh, so the launcher checks the file first.
function startFailure(binary) {
  try {
    if (!fs.statSync(binary).isFile()) {
      return 'EACCES';
    }
    fs.accessSync(binary, fs.constants.X_OK);
    return isProgram(binary) ? undefined : 'ENOEXEC';
  } catch (error) {
    return error && error.code;
  }
}

// The signals the launcher does not raise on itself, which Node reserves or ignores: SIGUSR1
// opens its inspector, and it ignores SIGPIPE and SIGXFSZ.
var unraised = ['SIGUSR1', 'SIGPIPE', 'SIGXFSZ'];

// Ends the launcher as the child ended by a signal. It raises the same signal on itself, so the
// shell reads a death by that signal. A signal it cannot raise, or a raise that does not end it,
// ends it with 128 plus the signal's number, the status a shell reads for that death.
function endBySignal(signal) {
  var status = 128 + (os.constants.signals[signal] || 0);
  if (unraised.indexOf(signal) !== -1) {
    process.exit(status);
  }
  try {
    process.kill(process.pid, signal);
  } catch (error) {
    process.exit(status);
  }
  // A guard, should the raise not end the launcher.
  setTimeout(function () {
    process.exit(status);
  }, 100);
}

// Runs the binary as a child, on a Node without process.execve, and ends as the child ended.
function spawnBinary(platform, binary) {
  var terminal = tty.isatty(0) || tty.isatty(1) || tty.isatty(2);
  var signals = ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGQUIT'];
  var listeners = {};
  var child;
  // A terminal's Ctrl-C, Ctrl-\, and hangup reach the child through its process group, so only
  // SIGTERM is forwarded while any descriptor is a terminal.
  signals.forEach(function (signal) {
    listeners[signal] = function () {
      if (child && (signal === 'SIGTERM' || !terminal)) {
        child.kill(signal);
      }
    };
    process.on(signal, listeners[signal]);
  });
  function stopListening() {
    signals.forEach(function (signal) {
      process.removeListener(signal, listeners[signal]);
    });
  }
  try {
    child = childProcess.spawn(binary, process.argv.slice(2), { stdio: 'inherit' });
  } catch (error) {
    stopListening();
    cannotStart(platform, binary, error && error.code);
  }
  child.on('error', function (error) {
    stopListening();
    cannotStart(platform, binary, error && error.code);
  });
  child.on('exit', function (code, signal) {
    stopListening();
    if (signal === null) {
      process.exit(code);
    }
    endBySignal(signal);
  });
}

// Whether the platform package that resolved is the one the launcher was built with, by the name
// and version in its package.json, so a hoisted or ancestor copy of another version never runs.
function isBuiltPackage(manifest, platform) {
  try {
    var read = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    return read.name === facts.pkg + '-' + platform && read.version === facts.version;
  } catch (error) {
    return false;
  }
}

function launch() {
  var platform = hostPlatform();
  if (facts.platforms.indexOf(platform) === -1) {
    fail(facts.noPlatform, { platform: escapeControlCharacters(platform) });
  }
  var manifest;
  try {
    manifest = require.resolve(facts.pkg + '-' + platform + '/package.json');
  } catch (error) {
    fail(facts.missingPackage, { platform: escapeControlCharacters(platform) });
  }
  if (!isBuiltPackage(manifest, platform)) {
    fail(facts.missingPackage, { platform: escapeControlCharacters(platform) });
  }
  var binary = path.join(path.dirname(manifest), 'bin', facts.name);
  var failure = startFailure(binary);
  if (failure !== undefined) {
    cannotStart(platform, binary, failure);
  }
  if (typeof process.execve === 'function') {
    // A Node from 26 throws when the exec fails, and an older one ends the process.
    try {
      process.execve(binary, [binary].concat(process.argv.slice(2)), process.env);
    } catch (error) {
      cannotStart(platform, binary, error && error.code);
    }
  }
  spawnBinary(platform, binary);
}

launch();
`;

/**
 * The launcher package's bin, `bin/<name>`: a CommonJS file for Node that finds the platform
 * package for the host and replaces itself with its binary, or runs the binary as a child on a Node
 * without `process.execve`, under ADR-0213. Its sentences come from `loom build`'s messages
 * module, rendered with the values the build knows, and its causes from `systemCause`.
 */
function npmLauncher({ name, pkg, platforms, version }: LauncherFacts): string {
  const facts = {
    cannotStart: launcherCannotStart(name, pkg, version),
    causes: Object.fromEntries(startCodes.map((code) => [code, systemCause(code)])),
    missingPackage: launcherMissingPackage(name, pkg, version),
    name,
    noPlatform: launcherNoPlatform(name, pkg, platforms),
    otherCause: systemCause(codePlaceholder),
    pkg,
    platforms,
    version,
  };
  return `#!/usr/bin/env node
'use strict';

// Written by loom build --target npm. Do not edit: the next build replaces it.

var facts = ${JSON.stringify(facts, undefined, 2)};

${launcherCode}`;
}

export type { LauncherFacts };
export { npmLauncher };
