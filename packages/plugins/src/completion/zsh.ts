import { identifier, posixQuoted } from '../shell-quoting.js';

/**
 * The script for a name, with the guard lines after its `#compdef` line and the function name its
 * file is autoloaded as, which runs the completion function.
 */
function zshText(name: string, file: { guard: string; loadedAs: string }): string {
  const id = identifier(name);
  const quoted = posixQuoted(name);
  return `#compdef ${name}
${file.guard}compdef _loom_${id} ${quoted}

# Zsh completion script, printed by the Loom completion plugin.
# Ported from Cobra's zsh_completions.go, Copyright 2013-2023 The Cobra Authors,
# under the Apache License, Version 2.0: http://www.apache.org/licenses/LICENSE-2.0
# The changes from Cobra are stated in the NOTICE file of @loomcli/plugins.

__loom_${id}_debug()
{
    local file="$BASH_COMP_DEBUG_FILE"
    if [[ -n \${file} ]]; then
        echo "$*" >> "\${file}"
    fi
}

# Offers the file names in the folder the word under the cursor names: all of
# them (any), only the folders (dirs), or the folders and the names that end in
# one of the extensions in the caller's lines array, compared as strings
# (extensions). The folder part of the word, through its last /, moves to
# IPREFIX and is inserted as typed. Its quoting is removed with (Q), which
# expands nothing, and only a leading ~/ is read as the home folder. The folder
# is listed by a glob in which only the trailing * is live, so no substitution,
# parameter, glob qualifier, or tilde in the typed text is evaluated. A dot-name
# is listed only when the typed name starts with a dot. compadd -f tests each
# name in that folder, so a folder is shown and inserted with a / after it.
__loom_${id}_offer_files()
{
    emulate -L zsh
    local kind=$1 typed=$PREFIX lead=$IPREFIX folder name filter keep
    local -a found names where

    compset -P '*/'
    folder=\${(Q)typed[1,$#typed-$#PREFIX]}
    # A ~/ after the lead of an attached value reaches the program as typed.
    if [[ -z $lead && \${typed[1,2]} == '~/' && -n $HOME ]]; then
        folder=\${HOME%/}/\${folder[3,-1]}
    fi
    if [[ \${(Q)PREFIX} == .* ]]; then
        found=("$folder"*(ND))
    else
        found=("$folder"*(N))
    fi
    for name in "\${found[@]}"; do
        name=\${name:t}
        keep=1
        if [[ $kind != any && ! -d $folder$name ]]; then
            keep=0
            if [[ $kind == extensions ]]; then
                for filter in "\${lines[@]}"; do
                    [[ $name == *."$filter" ]] && keep=1
                done
            fi
        fi
        (( keep )) && names+=("$name")
    done
    [[ -n $folder ]] && where=(-W "$folder")
    __loom_${id}_debug "Offering \${#names[@]} file names in '\${folder}'"
    compadd -f "\${where[@]}" -- "\${names[@]}"
}

_loom_${id}()
{
    local shellCompDirectiveError=1
    local shellCompDirectiveNoSpace=2
    local shellCompDirectiveNoFileComp=4
    local shellCompDirectiveFilterFileExt=8
    local shellCompDirectiveFilterDirs=16
    local shellCompDirectiveKeepOrder=32

    local out directive comp lastLine
    local -a completions request describe

    __loom_${id}_debug "\\n========= starting completion logic =========="
    __loom_${id}_debug "CURRENT: \${CURRENT}, words[*]: \${words[*]}"

    # The cursor is inside an unclosed quote, so the word under it cannot be
    # read without evaluating it: offer nothing and do not call the program.
    if [[ -n \${compstate[quote]} ]]; then
        __loom_${id}_debug "The word under the cursor holds an unclosed quote"
        return 1
    fi

    # The user could have moved the cursor backwards on the command-line.
    # We need to trigger completion from the $CURRENT location, so the request
    # holds the words before the $CURRENT location and then $PREFIX, the word
    # under the cursor cut at the cursor. The (Q) flag removes one level of
    # quoting and expands nothing, and each word reaches the program as its
    # characters, in an argument array.
    request=("\${(Q)words[1]}" completion __complete -- "\${(@Q)words[2,CURRENT-1]}" "\${(Q)PREFIX}")
    __loom_${id}_debug "About to call: \${request[*]}"

    out=$("\${request[@]}" 2>/dev/null)
    if [[ $? -ne 0 ]]; then
        __loom_${id}_debug "The program exited nonzero"
        return 1
    fi
    __loom_${id}_debug "completion output: \${out}"

    # The last line is a colon and the directive's decimal digits.
    lastLine=\${out##*$'\\n'}
    __loom_${id}_debug "last line: \${lastLine}"
    if [[ \${lastLine[1]} != : || -z \${lastLine[2,-1]} || \${lastLine[2,-1]} == *[^0-9]* ]]; then
        __loom_${id}_debug "The answer holds no directive line"
        return 1
    fi
    directive=$(( 10#\${lastLine[2,-1]} ))
    out=\${out%"$lastLine"}

    __loom_${id}_debug "directive: \${directive}"
    __loom_${id}_debug "completions: \${out}"

    if [ $((directive & shellCompDirectiveError)) -ne 0 ]; then
        __loom_${id}_debug "Completion received error. Ignoring completions."
        return 1
    fi

    local tab=$'\\t'
    local -a lines
    while IFS= read -r comp; do
        if [ -n "$comp" ]; then
            lines+=("$comp")
            # If requested, completions are returned with a description.
            # The description is preceded by a TAB character.
            # For zsh's _describe, we need to use a : instead of a TAB.
            # We first need to escape any \\ and then any : in the word and the
            # description, because _describe reads a backslash as an escape.
            comp=\${comp//\\\\/\\\\\\\\}
            comp=\${comp//:/\\\\:}
            comp=\${comp//$tab/:}

            __loom_${id}_debug "Adding completion: \${comp}"
            completions+=("$comp")
        fi
    done <<< "$out"

    if [ $((directive & shellCompDirectiveFilterFileExt)) -ne 0 ] || [ $((directive & shellCompDirectiveFilterDirs)) -ne 0 ]; then
        # The script lists the file names itself. A first word that starts
        # with - is the lead of a value attached to its option, such as
        # --config= or -c: it moves from PREFIX to IPREFIX as a literal, so the
        # names after it are listed, and a word without it lists nothing.
        if [[ \${lines[1]-} == -* ]]; then
            compset -P "\${(b)lines[1]}" || return 1
            shift lines
        fi
        if [ $((directive & shellCompDirectiveFilterFileExt)) -ne 0 ]; then
            __loom_${id}_debug "File extensions: \${lines[*]}"
            __loom_${id}_offer_files extensions
        else
            __loom_${id}_offer_files dirs
        fi
        return
    else
        if [ $((directive & shellCompDirectiveKeepOrder)) -ne 0 ]; then
            __loom_${id}_debug "Activating keep order."
            describe+=(-V)
        fi
        describe+=(completions completions)
        if [ $((directive & shellCompDirectiveNoSpace)) -ne 0 ]; then
            __loom_${id}_debug "Activating nospace."
            describe+=(-S '')
        fi

        __loom_${id}_debug "Calling _describe"
        if _describe "\${describe[@]}"; then
            __loom_${id}_debug "_describe found some completions"

            # Return the success of having called _describe
            return 0
        else
            __loom_${id}_debug "_describe did not find completions."
            __loom_${id}_debug "Checking if we should do file completion."
            if [ $((directive & shellCompDirectiveNoFileComp)) -ne 0 ]; then
                __loom_${id}_debug "deactivating file completion"

                # We must return an error code here to let zsh know that there were no
                # completions found by _describe; this is what will trigger other
                # matching algorithms to attempt to find completions.
                # For example zsh can match letters in the middle of words.
                return 1
            else
                # Perform file completion
                __loom_${id}_debug "Activating file completion"

                # We must return the result of this command, so it must be the
                # last command, or else we must store its result to return it.
                __loom_${id}_offer_files any
            fi
        fi
    fi
}

# Run the completion function when compinit autoloads this file as ${file.loadedAs},
# and not when it is sourced.
if [ "$funcstack[1]" = "${file.loadedAs}" ]; then
    _loom_${id}
fi
`;
}

/**
 * The Zsh completion script, ported from Cobra's `zsh_completions.go`.
 * Copyright 2013-2023 The Cobra Authors, under the Apache License, Version 2.0, from
 * https://github.com/spf13/cobra at commit adbc8813901bba65827259daa8e22ff94ec1f30e. The
 * package NOTICE records the attribution. The changes from Cobra:
 * - Every `eval` is removed: the request is an argument-array call, and no answer is run as source.
 * - The application name enters the script only as data: single-quoted in the shell's quoting, or
 *   encoded into function identifiers by `identifier()`, and only the Application's portable
 *   name.
 * - ActiveHelp handling is removed; the plugin never writes it and leaves out such words.
 * - The request carries every word, the last cut at the cursor, so no empty word is appended.
 * - Answer words under `value` already carry the option's lead, such as `--format=`, so the script
 *   adds no flag prefix of its own.
 * - A nonzero exit, or an answer whose last line is not `:` and decimal digits, offers nothing.
 * - Directive numbers are written as literals.
 * - Quoting is removed with the `(Q)` flag, which expands nothing; when `compstate[quote]` is set,
 *   the cursor is inside an unclosed quote and the script offers nothing without a call.
 * - Words are no longer split with `${=...}`, which broke a quoted word holding a space.
 * - `_describe` receives its arguments as an array.
 * - `\` and then `:` are escaped in each word and description passed to `_describe`, which reads a
 *   backslash as an escape.
 * - The last word of the request is `$PREFIX`, the word under the cursor cut at the cursor, rather
 *   than the whole word under the cursor.
 * - The completion function is `_loom_<id>` and the debug function `__loom_<id>_debug`, so no
 *   application name shadows a completion system function such as `_describe`, `_files`, or
 *   `_arguments`. The file still runs the function when compinit autoloads it as `_<name>`.
 * - The `#compdef` line and the autoload check carry the name as it is, because the Application's
 *   name is a portable name.
 * - No `_files` or `_path_files` is called, because both expand the folder part of the typed word,
 *   running a `$(…)` in it. `__loom_<id>_offer_files` lists file names itself: the folder part of
 *   the word moves to `$IPREFIX` and is inserted as typed, its quoting is removed with `(Q)`, and
 *   it is listed by a glob of the quoted folder with only a trailing `*` live, so nothing typed is
 *   expanded or run. Only a leading `~/`, with no lead before it, is read as `$HOME`. The names go
 *   to `compadd -f` with the folder as `-W`, which reads it as a literal path, so a folder is shown
 *   and inserted with a `/`. A dot-name is listed only when the typed name starts with a dot.
 * - Directive 0 falls back to that listing of every name, rather than to `_files`. Directive 16
 *   lists the folders, and directive 8 the folders and the names that end in an offered
 *   extension, compared as strings, so no other file name is offered.
 * - Under directives 8 and 16, a first answer word that starts with `-` is the lead of a value
 *   attached to its option, such as `--config=` or `-c`, moved from `$PREFIX` to `$IPREFIX` as a
 *   literal, so the names after it are listed. No answer word names a folder to list in.
 */
export function zshScript(name: string): string {
  return zshText(name, { guard: '', loadedAs: `_${name}` });
}

/**
 * The Zsh file `completion install` writes, named `_loom_<identifier>`: the printed script with
 * its autoload check naming that file, and, right after the `#compdef` line, a guard that starts
 * the completion system when `.zshrc` has not, with `compinit -i`, which skips an insecure folder on
 * `fpath` rather than asking, and registers nothing when `compdef` is still not defined.
 */
export function zshInstalledScript(name: string): string {
  const guard = `# Start the completion system when no compdef is defined, and register nothing without it.
(( $+functions[compdef] )) || { autoload -Uz compinit && compinit -i }
(( $+functions[compdef] )) || return 0
`;
  return zshText(name, { guard, loadedAs: `_loom_${identifier(name)}` });
}
