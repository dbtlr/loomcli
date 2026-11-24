# Fish completion script, printed by the Loom completion plugin.
# Ported from Cobra's fish_completions.go, Copyright 2013-2023 The Cobra Authors,
# under the Apache License, Version 2.0: http://www.apache.org/licenses/LICENSE-2.0
# The changes from Cobra are stated in the NOTICE file of @loomcli/plugins.

function __@@ID@@_debug
    set -l file "$BASH_COMP_DEBUG_FILE"
    if test -n "$file"
        echo "$argv" >> $file
    end
end

function __@@ID@@_perform_completion
    __@@ID@@_debug "Starting __@@ID@@_perform_completion"

    # Status 2 is an unclosed quote or an unfinished line: the word under the
    # cursor cannot be read without evaluating it, so offer nothing.
    commandline --is-valid
    if test $status -eq 2
        __@@ID@@_debug "The command line is incomplete"
        return 1
    end

    # Fish's own tokenizer and string unescape remove the quoting and expand
    # nothing: every word before the cursor, then the word under it, cut at
    # the cursor. Fish 3 reads no current token through commandline -oct.
    set -l args (commandline -opc)
    set -l current (commandline -ct | string unescape --style=script | string collect)

    __@@ID@@_debug "args: $args"
    __@@ID@@_debug "current: $current"

    # Each word reaches the program as its characters, in an argument list.
    set -l results ($args[1] completion __complete -- $args[2..-1] "$current" 2> /dev/null)
    or return 1

    # The last line is a colon and the directive's decimal digits.
    set -l directiveLine $results[-1]
    if not string match -q -r -- '^:[0-9]+$' "$directiveLine"
        __@@ID@@_debug "The answer holds no directive line"
        return 1
    end
    set -l comps $results[1..-2]

    __@@ID@@_debug "Comps: $comps"
    __@@ID@@_debug "DirectiveLine: $directiveLine"

    for comp in $comps
        printf "%s\n" "$comp"
    end

    printf "%s\n" "$directiveLine"
end

# this function limits calls to __@@ID@@_perform_completion, by caching the result behind $__@@ID@@_perform_completion_once_result
function __@@ID@@_perform_completion_once
    __@@ID@@_debug "Starting __@@ID@@_perform_completion_once"

    if test -n "$__@@ID@@_perform_completion_once_result"
        __@@ID@@_debug "Seems like a valid result already exists, skipping __@@ID@@_perform_completion"
        return 0
    end

    set --global __@@ID@@_perform_completion_once_result (__@@ID@@_perform_completion)
    if test -z "$__@@ID@@_perform_completion_once_result"
        __@@ID@@_debug "No completions, probably due to a failure"
        return 1
    end

    __@@ID@@_debug "Performed completions and set __@@ID@@_perform_completion_once_result"
    return 0
end

# this function is used to clear the $__@@ID@@_perform_completion_once_result variable after completions are run
function __@@ID@@_clear_perform_completion_once_result
    __@@ID@@_debug ""
    __@@ID@@_debug "========= clearing previously set __@@ID@@_perform_completion_once_result variable =========="
    set --erase __@@ID@@_perform_completion_once_result
    __@@ID@@_debug "Successfully erased the variable __@@ID@@_perform_completion_once_result"
end

function __@@ID@@_requires_order_preservation
    __@@ID@@_debug ""
    __@@ID@@_debug "========= checking if order preservation is required =========="

    __@@ID@@_perform_completion_once
    if test -z "$__@@ID@@_perform_completion_once_result"
        __@@ID@@_debug "Error determining if order preservation is required"
        return 1
    end

    set -l directive (string sub --start 2 $__@@ID@@_perform_completion_once_result[-1])
    __@@ID@@_debug "Directive is: $directive"

    set -l shellCompDirectiveKeepOrder 32
    set -l keeporder (math (math --scale 0 $directive / $shellCompDirectiveKeepOrder) % 2)
    __@@ID@@_debug "Keeporder is: $keeporder"

    if test $keeporder -ne 0
        __@@ID@@_debug "This does require order preservation"
        return 0
    end

    __@@ID@@_debug "This doesn't require order preservation"
    return 1
end


# This function does two things:
# - Obtain the completions and store them in the global __@@ID@@_comp_results
# - Return false if file completion should be performed
function __@@ID@@_prepare_completions
    __@@ID@@_debug ""
    __@@ID@@_debug "========= starting completion logic =========="

    # Start fresh
    set --erase __@@ID@@_comp_results

    __@@ID@@_perform_completion_once
    __@@ID@@_debug "Completion results: $__@@ID@@_perform_completion_once_result"

    if test -z "$__@@ID@@_perform_completion_once_result"
        __@@ID@@_debug "No completion, probably due to a failure"
        # Offer nothing: no program answer, and no file completion.
        return 0
    end

    set -l directive (string sub --start 2 $__@@ID@@_perform_completion_once_result[-1])
    set --global __@@ID@@_comp_results $__@@ID@@_perform_completion_once_result[1..-2]

    __@@ID@@_debug "Completions are: $__@@ID@@_comp_results"
    __@@ID@@_debug "Directive is: $directive"

    set -l shellCompDirectiveError 1
    set -l shellCompDirectiveNoSpace 2
    set -l shellCompDirectiveNoFileComp 4
    set -l shellCompDirectiveFilterFileExt 8
    set -l shellCompDirectiveFilterDirs 16

    if test -z "$directive"
        set directive 0
    end

    set -l compErr (math (math --scale 0 $directive / $shellCompDirectiveError) % 2)
    if test $compErr -eq 1
        __@@ID@@_debug "Received error directive: aborting."
        # Offer nothing: the answer reports an error.
        set --erase __@@ID@@_comp_results
        return 0
    end

    set -l filefilter (math (math --scale 0 $directive / $shellCompDirectiveFilterFileExt) % 2)
    set -l dirfilter (math (math --scale 0 $directive / $shellCompDirectiveFilterDirs) % 2)
    if test $filefilter -eq 1; or test $dirfilter -eq 1
        __@@ID@@_debug "File extension filtering or directory filtering not supported"
        # Do full file completion instead
        return 1
    end

    set -l nospace (math (math --scale 0 $directive / $shellCompDirectiveNoSpace) % 2)
    set -l nofiles (math (math --scale 0 $directive / $shellCompDirectiveNoFileComp) % 2)

    __@@ID@@_debug "nospace: $nospace, nofiles: $nofiles"

    # If we want to prevent a space, or if file completion is NOT disabled,
    # we need to count the number of valid completions.
    # To do so, we will filter on prefix as the completions we have received
    # may not already be filtered so as to allow fish to match on different
    # criteria than the prefix. The filter compares strings.
    if test $nospace -ne 0; or test $nofiles -eq 0
        set -l prefix (commandline -ct | string unescape --style=script | string collect)
        set -l length (string length -- "$prefix")
        __@@ID@@_debug "prefix: $prefix"

        set -l completions
        for comp in $__@@ID@@_comp_results
            set -l word (string split --max 1 \t -- $comp)
            set -l head (string sub --length $length -- $word[1])
            if test "$head" = "$prefix"
                set -a completions $comp
            end
        end
        set --global __@@ID@@_comp_results $completions
        __@@ID@@_debug "Filtered completions are: $__@@ID@@_comp_results"

        # Important not to quote the variable for count to work
        set -l numComps (count $__@@ID@@_comp_results)
        __@@ID@@_debug "numComps: $numComps"

        if test $numComps -eq 1; and test $nospace -ne 0
            # We must first split on \t to get rid of the descriptions to be
            # able to check what the actual completion will be.
            # We don't need descriptions anyway since there is only a single
            # real completion which the shell will expand immediately.
            set -l split (string split --max 1 \t $__@@ID@@_comp_results[1])

            # Fish won't add a space if the completion ends with any
            # of the following characters: @=/:.,
            set -l lastChar (string sub -s -1 -- $split)
            if not string match -r -q "[@=/:.,]" -- "$lastChar"
                # In other cases, to support the "nospace" directive we trick the shell
                # by outputting an extra, longer completion.
                __@@ID@@_debug "Adding second completion to perform nospace directive"
                set --global __@@ID@@_comp_results $split[1] $split[1].
                __@@ID@@_debug "Completions are now: $__@@ID@@_comp_results"
            end
        end

        if test $numComps -eq 0; and test $nofiles -eq 0
            # To be consistent with bash and zsh, we only trigger file
            # completion when there are no other completions
            __@@ID@@_debug "Requesting file completion"
            return 1
        end
    end

    return 0
end

# Since Fish completions are only loaded once the user triggers them, we trigger them ourselves
# so we can properly delete any completions provided by another script.
# Only do this if the program can be found, or else fish may print some errors; besides,
# the existing completions will only be loaded if the program can be found.
if type -q @@QUOTED@@
    # The space after the program name is essential to trigger completion for the program
    # and not completion of the program name itself.
    # Also, we use '> /dev/null 2>&1' since '&>' is not supported in older versions of fish.
    complete --do-complete @@SPACED@@ > /dev/null 2>&1
end

# Remove any pre-existing completions for the program since we will be handling all of them.
complete -c @@QUOTED@@ -e

# this will get called after the two calls below and clear the $__@@ID@@_perform_completion_once_result global
complete -c @@QUOTED@@ -n '__@@ID@@_clear_perform_completion_once_result'
# The call to __@@ID@@_prepare_completions will setup __@@ID@@_comp_results
# which provides the program's completion choices.
# If this doesn't require order preservation, we don't use the -k flag
complete -c @@QUOTED@@ -n 'not __@@ID@@_requires_order_preservation && __@@ID@@_prepare_completions' -f -a '$__@@ID@@_comp_results'
# otherwise we use the -k flag
complete -k -c @@QUOTED@@ -n '__@@ID@@_requires_order_preservation && __@@ID@@_prepare_completions' -f -a '$__@@ID@@_comp_results'
