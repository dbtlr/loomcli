import { identifier, posixQuoted } from './name.js';

/**
 * The Bash completion script, ported from Cobra's `bash_completionsV2.go`.
 * Copyright 2013-2023 The Cobra Authors, under the Apache License, Version 2.0, from
 * https://github.com/spf13/cobra at commit adbc8813901bba65827259daa8e22ff94ec1f30e. The
 * package NOTICE records the attribution. The changes from Cobra:
 * - Every `eval` is removed: the request is an argument-array call, and no answer is run as source.
 * - The application name enters the script only as data: single-quoted in the shell's quoting, or
 *   encoded into function identifiers by `identifier()`.
 * - ActiveHelp handling is removed; the plugin never writes it and leaves out such words.
 * - The request carries every word, the last cut at the cursor, so no empty word is appended.
 * - Answer words under `value` already carry the option's lead, such as `--format=`, so the script
 *   adds no flag prefix of its own.
 * - A nonzero exit, or an answer whose last line is not `:` and decimal digits, offers nothing.
 * - Directive numbers are written as literals.
 * - Quoting is removed from each word by `__<id>_dequote`, a string-only decoder written for Bash
 *   3.2; an unclosed quote in the word under the cursor offers nothing without a call.
 * - Every `compgen -W` is removed; offered words are filtered by `[[ $comp == "$cur"* ]]`.
 * - Without the bash-completion package, `__<id>_comp_words` builds `words`, `cword`, and `cur`
 *   from `COMP_WORDS` as `-n =:` does, and directives 8 and 16 fall back to `compgen -f` and
 *   `compgen -d` with the extensions compared as strings.
 * - The extension list is quoted rather than expanded unquoted, and `_filedir` gets one argument
 *   rather than a command string.
 * - The current word is not trimmed after `=`; `__<id>_handle_special_char` trims the inserted
 *   words instead.
 * - An error, a failed call, or an unreadable answer turns default file completion off.
 */
export function bashScript(name: string): string {
  const id = identifier(name);
  const quoted = posixQuoted(name);
  return `# Bash completion script, printed by the Loom completion plugin.
# Ported from Cobra's bash_completionsV2.go, Copyright 2013-2023 The Cobra Authors,
# under the Apache License, Version 2.0: http://www.apache.org/licenses/LICENSE-2.0
# The changes from Cobra are stated in the NOTICE file of @loomcli/plugins.

__${id}_debug()
{
    if [[ -n \${BASH_COMP_DEBUG_FILE-} ]]; then
        echo "$*" >> "\${BASH_COMP_DEBUG_FILE}"
    fi
}

# Macs have bash3 for which the bash-completion package doesn't include
# _init_completion. This is a minimal version of that function.
__${id}_init_completion()
{
    COMPREPLY=()
    _get_comp_words_by_ref "$@" cur prev words cword
}

# Bash without the bash-completion package: build words, cword, and cur from
# COMP_WORDS the way _get_comp_words_by_ref -n =: does. A word that is exactly
# = or : glues to the word before it, and the word after such a glue joins too
# when no whitespace separates them. The current word is cut at the cursor.
__${id}_comp_words()
{
    local line=\${COMP_LINE:0:COMP_POINT} word i last=0 glued=0 spaced

    words=()
    for (( i = 0; i < \${#COMP_WORDS[@]} && i <= COMP_CWORD; i++ )); do
        word=\${COMP_WORDS[i]}
        spaced=0
        while [[ -n $line && \${line:0:1} == [[:space:]] ]]; do
            line=\${line:1}
            spaced=1
        done
        if (( i == COMP_CWORD )); then
            word=$line
        fi
        line=\${line:\${#word}}
        if (( i > 0 && !spaced )) && [[ $word == = || $word == : || $glued == 1 ]]; then
            words[last]+=$word
        else
            words+=("$word")
            last=$(( \${#words[@]} - 1 ))
        fi
        if [[ $word == = || $word == : ]]; then
            glued=1
        else
            glued=0
        fi
    done
    cword=$last
    cur=\${words[last]}
}

# Removes the quoting from one word the way the shell would, without evaluating
# it: single quotes are literal, double quotes honor \\" \\\\ \\\` \\$, a backslash
# outside quotes escapes the next character, and everything else is literal, so
# $HOME, ~, and $(...) stay as typed. The result lands in the caller's
# dequoted variable. An unclosed quote returns 1.
__${id}_dequote()
{
    local word=$1 result='' quote='' char next i=0 length=\${#1}

    while (( i < length )); do
        char=\${word:i:1}
        if [[ $quote == "'" ]]; then
            if [[ $char == "'" ]]; then
                quote=''
            else
                result+=$char
            fi
        elif [[ $quote == '"' ]]; then
            if [[ $char == '"' ]]; then
                quote=''
            elif [[ $char == '\\' ]]; then
                next=\${word:i+1:1}
                case $next in
                    '"'|'\\'|'\`'|'$')
                        result+=$next
                        i=$(( i + 1 ))
                        ;;
                    *)
                        result+=$char
                        ;;
                esac
            else
                result+=$char
            fi
        else
            case $char in
                "'"|'"')
                    quote=$char
                    ;;
                '\\')
                    i=$(( i + 1 ))
                    result+=\${word:i:1}
                    ;;
                *)
                    result+=$char
                    ;;
            esac
        fi
        i=$(( i + 1 ))
    done
    if [[ -n $quote ]]; then
        return 1
    fi
    dequoted=$result
}

# This function calls the program to obtain the completion results and the
# directive. It fills the 'out' and 'directive' vars, and returns 1 when the
# program cannot be called or does not answer.
__${id}_get_completion_results() {
    local args=() dequoted program lastLine i

    # Each word reaches the program as its characters, in an argument array.
    # Calling \${words[0]} instead of the name itself allows handling aliases.
    __${id}_dequote "\${words[0]}" || return 1
    program=$dequoted
    for (( i = 1; i < \${#words[@]} - 1; i++ )); do
        __${id}_dequote "\${words[i]}" || return 1
        args+=("$dequoted")
    done
    # The word under the cursor is cut at the cursor, and empty on a new word.
    if ! __${id}_dequote "\${cur}"; then
        __${id}_debug "The word under the cursor holds an unclosed quote"
        return 1
    fi
    args+=("$dequoted")

    __${id}_debug "Calling \${program} completion __complete -- \${args[*]}"
    out=$("$program" completion __complete -- "\${args[@]}" 2>/dev/null) || return 1

    # The last line is a colon and the directive's decimal digits.
    lastLine=\${out##*$'\\n'}
    if [[ \${lastLine:0:1} != : || -z \${lastLine:1} || \${lastLine:1} == *[!0-9]* ]]; then
        __${id}_debug "The answer holds no directive line"
        return 1
    fi
    directive=$(( 10#\${lastLine:1} ))
    out=\${out%"$lastLine"}
    __${id}_debug "The completion directive is: \${directive}"
    __${id}_debug "The completions are: \${out}"
}

# Offers nothing: the compspec's default file completion is turned off too.
__${id}_offer_nothing() {
    COMPREPLY=()
    if [[ $(type -t compopt) == builtin ]]; then
        compopt +o default
    fi
}

__${id}_process_completion_results() {
    local shellCompDirectiveError=1
    local shellCompDirectiveNoSpace=2
    local shellCompDirectiveNoFileComp=4
    local shellCompDirectiveFilterFileExt=8
    local shellCompDirectiveFilterDirs=16
    local shellCompDirectiveKeepOrder=32

    if (((directive & shellCompDirectiveError) != 0)); then
        # Error code.  No completion.
        __${id}_debug "Received error from the completion answer"
        __${id}_offer_nothing
        return
    else
        if (((directive & shellCompDirectiveNoSpace) != 0)); then
            if [[ $(type -t compopt) == builtin ]]; then
                __${id}_debug "Activating no space"
                compopt -o nospace
            else
                __${id}_debug "No space directive not supported in this version of bash"
            fi
        fi
        if (((directive & shellCompDirectiveKeepOrder) != 0)); then
            if [[ $(type -t compopt) == builtin ]]; then
                # no sort isn't supported for bash less than < 4.4
                if [[ \${BASH_VERSINFO[0]} -lt 4 || ( \${BASH_VERSINFO[0]} -eq 4 && \${BASH_VERSINFO[1]} -lt 4 ) ]]; then
                    __${id}_debug "No sort directive not supported in this version of bash"
                else
                    __${id}_debug "Activating keep order"
                    compopt -o nosort
                fi
            else
                __${id}_debug "No sort directive not supported in this version of bash"
            fi
        fi
        if (((directive & shellCompDirectiveNoFileComp) != 0)); then
            if [[ $(type -t compopt) == builtin ]]; then
                __${id}_debug "Activating no file completion"
                compopt +o default
            else
                __${id}_debug "No file completion directive not supported in this version of bash"
            fi
        fi
    fi

    local completions=() comp
    while IFS='' read -r comp; do
        [[ -z $comp ]] && continue
        completions+=("$comp")
    done <<<"\${out}"

    if (((directive & shellCompDirectiveFilterFileExt) != 0)); then
        __${id}_filter_file_extensions
    elif (((directive & shellCompDirectiveFilterDirs) != 0)); then
        __${id}_filter_directories
    else
        __${id}_handle_completion_types
    fi

    __${id}_handle_special_char "$cur" :
    __${id}_handle_special_char "$cur" =
}

# File completion filtered by the offered extensions, compared as strings.
__${id}_filter_file_extensions() {
    local fullFilter="" filter file

    if declare -F _filedir >/dev/null 2>&1; then
        for filter in "\${completions[@]}"; do
            fullFilter+="$filter|"
        done
        __${id}_debug "File filtering extensions: $fullFilter"
        _filedir "$fullFilter"
        return
    fi
    if [[ $(type -t compopt) == builtin ]]; then
        compopt -o filenames
    fi
    while IFS='' read -r file; do
        [[ -z $file ]] && continue
        if [[ -d $file ]]; then
            COMPREPLY+=("$file")
            continue
        fi
        for filter in "\${completions[@]}"; do
            if [[ $file == *."$filter" ]]; then
                COMPREPLY+=("$file")
                break
            fi
        done
    done < <(compgen -f -- "$cur")
}

# File completion for directories only, inside the offered directory if any.
__${id}_filter_directories() {
    local subdir=\${completions[0]}

    if [[ -n $subdir ]]; then
        __${id}_debug "Listing directories in $subdir"
        pushd -- "$subdir" >/dev/null 2>&1 || return
    else
        __${id}_debug "Listing directories in ."
    fi
    if declare -F _filedir >/dev/null 2>&1; then
        _filedir -d
    else
        if [[ $(type -t compopt) == builtin ]]; then
            compopt -o filenames
        fi
        local directory
        while IFS='' read -r directory; do
            [[ -n $directory ]] && COMPREPLY+=("$directory")
        done < <(compgen -d -- "$cur")
    fi
    if [[ -n $subdir ]]; then
        popd >/dev/null 2>&1
    fi
}

__${id}_handle_completion_types() {
    __${id}_debug "__${id}_handle_completion_types: COMP_TYPE is $COMP_TYPE"

    case $COMP_TYPE in
    37|42)
        # Type: menu-complete/menu-complete-backward and insert-completions
        # If the user requested inserting one completion at a time, or all
        # completions at once on the command-line we must remove the descriptions.
        # https://github.com/spf13/cobra/issues/1508

        # If there are no completions, we don't need to do anything
        (( \${#completions[@]} == 0 )) && return 0

        local tab=$'\\t' compline comp

        # Strip any description, escape the completion to handle special
        # characters, and keep only the completions that match
        for compline in "\${completions[@]}"; do
            printf -v comp "%q" "\${compline%%$tab*}" &>/dev/null || comp=$(printf "%q" "\${compline%%$tab*}")
            [[ $comp == "$cur"* ]] && COMPREPLY+=("$comp")
        done
        ;;

    *)
        # Type: complete (normal completion)
        __${id}_handle_standard_completion_case
        ;;
    esac
}

__${id}_handle_standard_completion_case() {
    local tab=$'\\t'

    # If there are no completions, we don't need to do anything
    (( \${#completions[@]} == 0 )) && return 0

    local longest=0
    local compline comp
    # Look for the longest completion so that we can format things nicely
    for compline in "\${completions[@]}"; do
        [[ -z $compline ]] && continue

        # Before checking if the completion matches what the user typed,
        # we need to strip any description and escape the completion to handle special
        # characters because those escape characters are part of what the user typed.
        # Don't call "printf" in a sub-shell because it will be much slower
        # since we are in a loop.
        printf -v comp "%q" "\${compline%%$tab*}" &>/dev/null || comp=$(printf "%q" "\${compline%%$tab*}")

        # Only consider the completions that match
        [[ $comp == "$cur"* ]] || continue

        # The completions matches.  Add it to the list of full completions including
        # its description.  We don't escape the completion because it may get printed
        # in a list if there are more than one and we don't want show escape characters
        # in that list.
        COMPREPLY+=("$compline")

        # Strip any description before checking the length, and again, don't escape
        # the completion because this length is only used when printing the completions
        # in a list and we don't want show escape characters in that list.
        comp=\${compline%%$tab*}
        if ((\${#comp}>longest)); then
            longest=\${#comp}
        fi
    done

    # If there is a single completion left, remove the description text and escape any special characters
    if ((\${#COMPREPLY[*]} == 1)); then
        __${id}_debug "COMPREPLY[0]: \${COMPREPLY[0]}"
        COMPREPLY[0]=$(printf "%q" "\${COMPREPLY[0]%%$tab*}")
        __${id}_debug "Removed description from single completion, which is now: \${COMPREPLY[0]}"
    else
        # Format the descriptions
        __${id}_format_comp_descriptions $longest
    fi
}

__${id}_handle_special_char()
{
    local comp="$1"
    local char=$2
    if [[ "$comp" == *\${char}* && "$COMP_WORDBREAKS" == *\${char}* ]]; then
        local word=\${comp%"\${comp##*\${char}}"}
        local idx=\${#COMPREPLY[*]}
        while ((--idx >= 0)); do
            COMPREPLY[idx]=\${COMPREPLY[idx]#"$word"}
        done
    fi
}

__${id}_format_comp_descriptions()
{
    local tab=$'\\t'
    local comp desc maxdesclength
    local longest=$1

    local i ci
    for ci in \${!COMPREPLY[*]}; do
        comp=\${COMPREPLY[ci]}
        # Properly format the description string which follows a tab character if there is one
        if [[ "$comp" == *$tab* ]]; then
            __${id}_debug "Original comp: $comp"
            desc=\${comp#*$tab}
            comp=\${comp%%$tab*}

            # $COLUMNS stores the current shell width.
            # Remove an extra 4 because we add 2 spaces and 2 parentheses.
            maxdesclength=$(( COLUMNS - longest - 4 ))

            # Make sure we can fit a description of at least 8 characters
            # if we are to align the descriptions.
            if ((maxdesclength > 8)); then
                # Add the proper number of spaces to align the descriptions
                for ((i = \${#comp} ; i < longest ; i++)); do
                    comp+=" "
                done
            else
                # Don't pad the descriptions so we can fit more text after the completion
                maxdesclength=$(( COLUMNS - \${#comp} - 4 ))
            fi

            # If there is enough space for any description text,
            # truncate the descriptions that are too long for the shell width
            if ((maxdesclength > 0)); then
                if ((\${#desc} > maxdesclength)); then
                    desc=\${desc:0:$(( maxdesclength - 1 ))}
                    desc+="…"
                fi
                comp+="  ($desc)"
            fi
            COMPREPLY[ci]=$comp
            __${id}_debug "Final comp: $comp"
        fi
    done
}

__start_${id}()
{
    local cur prev words cword split

    COMPREPLY=()

    # Call _init_completion from the bash-completion package
    # to prepare the arguments properly
    if declare -F _init_completion >/dev/null 2>&1; then
        _init_completion -n =: || return
    elif declare -F _get_comp_words_by_ref >/dev/null 2>&1; then
        __${id}_init_completion -n =: || return
    else
        __${id}_comp_words
    fi

    __${id}_debug
    __${id}_debug "========= starting completion logic =========="
    __${id}_debug "cur is \${cur}, words[*] is \${words[*]}, #words[@] is \${#words[@]}, cword is $cword"

    # The user could have moved the cursor backwards on the command-line.
    # We need to trigger completion from the $cword location, so we need
    # to truncate the command-line ($words) up to the $cword location.
    words=("\${words[@]:0:$cword+1}")
    __${id}_debug "Truncated words[*]: \${words[*]},"

    local out directive
    if ! __${id}_get_completion_results; then
        __${id}_offer_nothing
        return 0
    fi
    __${id}_process_completion_results
}

if [[ $(type -t compopt) = "builtin" ]]; then
    complete -o default -F __start_${id} ${quoted}
else
    complete -o default -o nospace -F __start_${id} ${quoted}
fi

# ex: ts=4 sw=4 et filetype=sh
`;
}
