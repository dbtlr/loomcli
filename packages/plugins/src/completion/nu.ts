import { identifier, nuQuoted } from '../shell-quoting.js';

/**
 * The Nushell completion script, written for Loom. Cobra has no Nushell script, so none of this
 * one derives from it and it carries no Cobra notice. It speaks Cobra's `__complete` protocol, as the
 * other scripts do:
 * - One `extern` for the application's name declares a rest parameter whose completer receives the
 *   whole command line, so no tree of commands and options is copied into the script, and
 *   Nushell's one global external completer is left alone. The parameter is typed `glob`, so
 *   Nushell still expands a bare wildcard or `~` when the program runs. The extern does change
 *   three forms, which completion.md lists: a quote inside a word keeps its quotes, an
 *   interpolation with a subexpression is expanded, and a bare true, false, or null fails.
 * - The completer splits the line into words itself, at white space, and keeps the call at the
 *   end of the line: the words after the last unquoted `|`, `;`, or new line, or after a `(` or
 *   `{` still open at the end, outside every quoted span, because Nushell hands it the whole line
 *   up to the cursor, not the call. A `( … )` or `{ … }` closed before the end is one word,
 *   joined to the text it touches. The first of those words is the program word and is dropped.
 *   A word keeps a quoted span whole, whether the span is the word or sits inside it: a
 *   double-quoted span, which skips a backslash escape, a single-quoted span, a backtick string,
 *   and, at the start of a word, a raw string. It reads back the quoting its own values use, and adds an empty word after a trailing
 *   space. The word reaches the application without the quotes of its spans, in an argument list.
 *   Nothing typed is evaluated.
 * - Nushell 0.117 is the floor: releases from 0.104 through 0.114 list file names after an empty
 *   answer, and 0.115 and 0.116 skip the completer for a word that looks like a flag. The
 *   completer's line binds by the parameter name `buffer` on 0.117 and as the first positional
 *   parameter on older releases.
 * - The application name enters the script only as data: a double-quoted string, or encoded into
 *   function identifiers by `identifier()`, and only the Application's portable name.
 * - Nushell inserts a value exactly as the script returns it, so the script writes each value so
 *   that Nushell reads it back as the same text: a bare word of letters, digits, and `_./:=+-`
 *   stays bare, which keeps an option such as `--format=json` an option, but not `true`, `false`, or
 *   `null`, which Nushell reads as keywords, and any other value is a
 *   backtick string, which holds every character but a backtick, or a double-quoted string with
 *   its backslashes and quotes escaped when the value holds a backtick. Nushell then matches the
 *   word under the cursor by substring, because a quoted value does not start with it.
 * - A nonzero exit, an unclosed quote, backtick string, or raw string, an answer whose last line
 *   is not `:` and decimal digits, and the error directive offer nothing, and no file names.
 * - Directives 8 and 16 return nothing from the script, so Nushell lists file names itself. Their
 *   answer lines are extensions and the lead of an attached value, never values, and Nushell has no
 *   way to narrow file names by a hint.
 * - Under directive 0, a first answer line that starts with `-` is the lead of a value attached to
 *   its option, never a value, because no Command name starts with `-`, so the script returns
 *   nothing there too.
 * - The no-files directive returns the record form, even when empty, so Nushell offers no file.
 */
export function nuScript(name: string): string {
  const id = identifier(name);
  const quoted = nuQuoted(name);
  return String.raw`# Nushell completion script, printed by the Loom completion plugin.
# This script is Loom's own: nothing in it derives from Cobra.

# Finds where a quoted span that starts at a character index ends: the index of its closer, or -1
# when it is unclosed. Only a double-quoted span skips a backslash escape, and the closer is more
# than one character for a raw string, which closes at a quote and as many # again.
def __${id}_close [chars: list<string>, body: int, closer: string, escapes: bool] {
  let count = ($chars | length)
  let width = ($closer | str length)
  let lead = ($closer | str substring 0..0)
  mut at = $body
  while $at < $count {
    let c = ($chars | get $at)
    if $escapes and $c == "\\" {
      $at += 2
      continue
    }
    if $c == $lead and (($chars | skip $at | take $width | str join) == $closer) {
      return $at
    }
    $at += 1
  }
  -1
}

# Reads one word of a command line that starts at a character index: a record of the word, whether
# a quote in it is unclosed, and the index after it. A word ends at white space or at an unquoted
# |, ;, {, (, }, or ), and Nushell keeps a quoted span inside a word as part of it, so the word
# continues through a double-quoted span, which skips its backslash escapes, and through a
# single-quoted span and a backtick string, which read none, and, at the start of the word, through
# a raw string r#'...'# of any number of #. The word holds what was typed without the quotes of its
# spans and no escape is read. An unclosed quote takes the rest of the line.
def __${id}_token [chars: list<string>, start: int] {
  let count = ($chars | length)
  let tick = (char --unicode '60')
  mut at = $start
  mut word = ''
  while $at < $count {
    let c = ($chars | get $at)
    if $c =~ '^\s$' or $c in ['|' ';' '{' '(' '}' ')'] {
      break
    }
    mut body = $at + 1
    mut closer = ''
    if $c == '"' or $c == "'" or $c == $tick {
      $closer = $c
    } else if $c == 'r' and $at == $start {
      let hashes = ($chars | skip ($at + 1) | take while {|h| $h == '#'} | length)
      let quote = $at + 1 + $hashes
      if $quote < $count and ($chars | get $quote) == "'" {
        $body = $quote + 1
        $closer = ("'" + (0..<$hashes | each {'#'} | str join))
      }
    }
    if $closer == '' {
      $word = $word + $c
      $at += 1
      continue
    }
    let end = (__${id}_close $chars $body $closer ($c == '"'))
    if $end < 0 {
      return {word: ($word + ($chars | skip $body | str join)), open: true, next: $count}
    }
    $word = $word + ($chars | skip $body | take ($end - $body) | str join)
    $at = $end + ($closer | str length)
  }
  {word: $word, open: false, next: $at}
}

# Splits the call at the end of a command line into records of a word and whether its quote is
# unclosed, by the reading of __${id}_token. The call starts after the last unquoted |, ;, or new
# line, or after a ( or { that is still open at the end of the line, and its program word comes
# first and is dropped. A ( … ) or { … } closed before the end is one word of the call, as typed and
# joined to the text it touches, such as a subexpression given as an option's value. Nothing in it
# is evaluated, and a space at the end adds an empty word.
def __${id}_words [line: string] {
  let chars = ($line | split chars)
  let count = ($chars | length)
  mut found = []
  mut groups = []
  mut glued = false
  mut at = 0
  while $at < $count {
    let lead = ($chars | get $at)
    if $lead == "\n" or $lead == "\r" or $lead in ['|' ';'] {
      $found = []
      $glued = false
      $at += 1
      continue
    }
    if $lead =~ '^\s$' {
      $glued = false
      $at += 1
      continue
    }
    if $lead in ['{' '('] {
      # A group that touches the word before it continues that word.
      let touching = $at > 0 and not (($chars | get ($at - 1)) =~ '^[\s|;{(]$')
      $groups = ($groups | append {found: $found, start: $at, touching: $touching})
      $found = []
      $at += 1
      continue
    }
    if $lead in ['}' ')'] and not ($groups | is-empty) {
      let group = ($groups | last)
      $groups = ($groups | drop 1)
      let text = ($chars | skip $group.start | take ($at + 1 - $group.start) | str join)
      $found = if $group.touching and not ($group.found | is-empty) {
        let last = ($group.found | last)
        $group.found | drop 1 | append {word: ($last.word + $text), open: $last.open}
      } else {
        $group.found | append {word: $text, open: false}
      }
      $glued = true
      $at += 1
      continue
    }
    let token = (__${id}_token $chars $at)
    # A ) or } that closes no group is read as nothing.
    if $token.next == $at {
      $at += 1
      continue
    }
    if $glued and not ($found | is-empty) {
      let last = ($found | last)
      let word = $last.word + $token.word
      $found = ($found | drop 1 | append {word: $word, open: ($last.open or $token.open)})
    } else {
      $found = ($found | append {word: $token.word, open: $token.open})
    }
    $glued = false
    $at = $token.next
  }
  # A boundary with no word after it holds no call, so nothing is asked.
  if ($found | is-empty) {
    return [{word: '', open: true}]
  }
  let words = ($found | skip 1)
  if ($line | str ends-with ' ') { $words | append {word: '', open: false} } else { $words }
}

# The value as Nushell reads it back as the same text. Nushell inserts what the completer returns
# as it is, so a value that holds a space, a quote, a bracket, a dollar sign, a semicolon, or a
# glob character would run or split when the line runs. A bare word keeps its letters, digits, and
# a few safe marks, so an option stays an option, except true, false, and null, which Nushell reads
# as keywords and not as a string argument. Every other value is a string, and the one character a
# backtick string cannot hold sends the value to a double-quoted string instead.
def __${id}_literal [word: string] {
  let tick = (char --unicode '60')
  if ($word =~ '^[A-Za-z0-9_./:=+-]+$') and not ($word in ['true' 'false' 'null']) {
    $word
  } else if not ($word | str contains $tick) {
    [$tick $word $tick] | str join
  } else {
    ['"' ($word | str replace --all '\' '\\' | str replace --all '"' '\"') '"'] | str join
  }
}

# The completer of every word after the program: asks the application for the words, by the
# arguments of a call and not by a command line, and reads the directive on the last line. Nushell
# binds the command line to the parameter named buffer.
def __${id}_complete [buffer: string] {
  let options = { sort: false, completion_algorithm: substring }
  let nothing = { options: $options, completions: [] }
  try {
    let words = (__${id}_words $buffer)
    if ($words | any {|w| $w.open}) {
      return $nothing
    }
    let arguments = ($words | each {|w| $w.word})
    let program = ${quoted}
    let result = (do { ^$program completion __complete -- ...$arguments } | complete)
    if $result.exit_code != 0 {
      return $nothing
    }
    let answer = ($result.stdout | lines)
    let last = ($answer | last)
    if not ($last =~ '^:[0-9]+$') {
      return $nothing
    }
    let directive = ($last | str substring 1.. | into int)
    # The error directive is 1.
    if ($directive mod 2) == 1 {
      return $nothing
    }
    # The directives 8 and 16 answer extensions and a lead, which are no values: Nushell lists files.
    if ((($directive // 8) mod 2) == 1) or ((($directive // 16) mod 2) == 1) {
      return null
    }
    # Where files are allowed, a first line that starts with - is the lead of a value attached to
    # its option, which is no value, because no Command name starts with -: Nushell lists files.
    let files = (($directive // 4) mod 2) == 0
    if $files and (($answer | drop 1 | first 1 | str join) | str starts-with '-') {
      return null
    }
    let items = ($answer | drop 1 | each {|line|
      let parts = ($line | split row --number 2 (char tab) | append '')
      {word: $parts.0, description: $parts.1}
    } | where {|item| $item.word != ''} | each {|item|
      {value: (__${id}_literal $item.word), description: $item.description}
    })
    # The no-files directive is 4: the record form offers no file names, even with no word.
    if ((($directive // 4) mod 2) == 1) or not ($items | is-empty) {
      { options: $options, completions: $items }
    } else {
      null
    }
  } catch {
    $nothing
  }
}

export extern ${quoted} [ ...arguments: glob@"__${id}_complete" ]
`;
}
