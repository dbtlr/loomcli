import { identifier, posixQuoted, scriptName } from './name.js';

/**
 * The Zsh completion script, ported from Cobra's `zsh_completions.go`.
 * Copyright 2013-2023 The Cobra Authors, under the Apache License, Version 2.0, from
 * https://github.com/spf13/cobra at commit adbc8813901bba65827259daa8e22ff94ec1f30e. The
 * package NOTICE records the attribution. The changes from Cobra:
 * - Every `eval` is removed: the request is an argument-array call, and no answer is run as source.
 * - The application name enters the script only as data: single-quoted in the shell's quoting, or
 *   encoded into function identifiers by `identifier()`, and only a portable name, which
 *   `scriptName()` checks at the call with a `TypeError`.
 * - ActiveHelp handling is removed; the plugin never writes it and leaves out such words.
 * - The request carries every word, the last cut at the cursor, so no empty word is appended.
 * - Answer words under `value` already carry the option's lead, such as `--format=`, so the script
 *   adds no flag prefix of its own.
 * - A nonzero exit, or an answer whose last line is not `:` and decimal digits, offers nothing.
 * - Directive numbers are written as literals.
 * - Quoting is removed with the `(Q)` flag, which expands nothing; when `compstate[quote]` is set,
 *   the cursor is inside an unclosed quote and the script offers nothing without a call.
 * - Words are no longer split with `${=...}`, which broke a quoted word holding a space.
 * - `_describe` receives its arguments as an array; `_files` is called directly rather than through
 *   an `_arguments` action string, and each file extension is quoted as a pattern with the `(b)`
 *   flag, so no glob qualifier in it runs.
 * - `\` and then `:` are escaped in each word and description passed to `_describe`, which reads a
 *   backslash as an escape.
 * - The last word of the request is `$PREFIX`, the word under the cursor cut at the cursor, rather
 *   than the whole word under the cursor.
 * - The completion function is `_loom_<id>` and the debug function `__loom_<id>_debug`, so no
 *   application name shadows a completion system function such as `_describe`, `_files`, or
 *   `_arguments`. The file still runs the function when compinit autoloads it as `_<name>`.
 * - The `#compdef` line and the autoload check carry the name as it is, because `scriptName()`
 *   accepts only a portable name.
 */
export function zshScript(name: string): string {
  const id = identifier(scriptName(name));
  const quoted = posixQuoted(name);
  return `#compdef ${name}
compdef _loom_${id} ${quoted}

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

_loom_${id}()
{
    local shellCompDirectiveError=1
    local shellCompDirectiveNoSpace=2
    local shellCompDirectiveNoFileComp=4
    local shellCompDirectiveFilterFileExt=8
    local shellCompDirectiveFilterDirs=16
    local shellCompDirectiveKeepOrder=32

    local out directive comp lastLine filter subdir result
    local -a completions request describe globs

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

    if [ $((directive & shellCompDirectiveFilterFileExt)) -ne 0 ]; then
        # File extension filtering. Each extension is quoted as a pattern,
        # so no glob qualifier in it runs.
        for filter in "\${lines[@]}"; do
            globs+=(-g "*.\${(b)filter}")
        done
        __loom_${id}_debug "File filtering patterns: \${globs[*]}"
        _files "\${globs[@]}"
    elif [ $((directive & shellCompDirectiveFilterDirs)) -ne 0 ]; then
        # File completion for directories only
        subdir="\${lines[1]}"
        if [ -n "$subdir" ]; then
            __loom_${id}_debug "Listing directories in $subdir"
            pushd -q -- "\${subdir}" >/dev/null 2>&1 || return 1
        else
            __loom_${id}_debug "Listing directories in ."
        fi

        _files -/
        result=$?
        if [ -n "$subdir" ]; then
            popd -q >/dev/null 2>&1
        fi
        return $result
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
                _files
            fi
        fi
    fi
}

# Run the completion function when compinit autoloads this file as _${name},
# and not when it is sourced.
if [ "$funcstack[1]" = "_${name}" ]; then
    _loom_${id}
fi
`;
}
