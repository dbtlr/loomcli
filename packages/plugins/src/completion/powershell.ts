import { identifier, powershellQuoted, scriptName } from './name.js';

/**
 * The PowerShell completion script, ported from Cobra's `powershell_completions.go`.
 * Copyright 2013-2023 The Cobra Authors, under the Apache License, Version 2.0, from
 * https://github.com/spf13/cobra at commit adbc8813901bba65827259daa8e22ff94ec1f30e. The
 * package NOTICE records the attribution. The changes from Cobra:
 * - `Invoke-Expression` is removed, and no request or answer is run as source. On Windows the
 *   program is called through `&` with an argument array. On PowerShell 7 off Windows, where `&`
 *   expands a `~` and a wildcard in every word an array passes to a program, the program is
 *   started through `ProcessStartInfo` with each word in its `ArgumentList`, its output read as
 *   UTF-8, and its stderr read to the end and discarded.
 * - The application name enters the script only as data: single-quoted in the shell's quoting, or
 *   encoded into function and variable identifiers by `identifier()`, and only a portable name,
 *   which `scriptName()` checks at the call with a `TypeError`.
 * - The completer registers with `-Native`.
 * - ActiveHelp handling is removed, including the ActiveHelp environment variable on the request.
 * - The request is read from the elements of the command PowerShell's parser hands the completer,
 *   placed by their offsets, rather than from the command's text cut at the cursor and split at
 *   spaces. A constant string passes its value, which removes its quoting without evaluating it,
 *   and any other element, such as a variable or a subexpression, passes the text typed.
 * - The word under the cursor is its text cut at the cursor, read by PowerShell's parser, which
 *   runs nothing. A cut word that does not parse, such as one holding an unclosed quote, offers
 *   nothing without a call.
 * - The request carries every word, the last cut at the cursor, so no empty word is appended.
 * - The program is resolved with `Get-Command`, an application alone off Windows, and called as
 *   resolved. One that resolves to a `.bat` or `.cmd` file offers nothing without a call, because
 *   `cmd.exe` reads its arguments again as commands.
 * - On Windows, Cobra's check for Legacy argument passing, which it used to pass an empty last
 *   word, now escapes every word: an empty word as `""`, and each `"` with a backslash, the
 *   backslashes before it doubled. The `Windows` style counts as Legacy for the files and commands
 *   PowerShell passes Legacy arguments to. The program's output is read as UTF-8, and the last
 *   exit code is restored after the call.
 * - A nonzero exit, an answer whose last line is not `:` and decimal digits, an error directive,
 *   or any failure offers nothing: the completer returns one empty string, which keeps PowerShell
 *   from completing file names.
 * - The directive line is removed by its position rather than by comparing text.
 * - Answer words under `value` already carry the option's lead, such as `--format=`, so the
 *   handling of a flag with an equal sign is removed.
 * - Offered words are filtered by an ordinal string comparison rather than `-like`, which reads
 *   wildcards.
 * - The PSReadLine mode switch is removed. Each word is one `CompletionResult` whose text is the
 *   word, bare when it holds only ASCII letters, digits, and `-`, `_`, `.`, `/`, `:`, and `=`, and
 *   otherwise in single quotes with each `'` and each of U+2018 through U+201B written twice; its
 *   list text is the word and its tooltip the description. The space Cobra's Complete mode adds
 *   after a sole word is kept, unless directive 2 is set; the descriptions it wrote into the text
 *   of several words, and the spaces of its MenuComplete mode, are removed.
 * - Directives 8 and 16 list the folder that the word under the cursor names, read literally,
 *   rather than falling back to every file name.
 * - Directive numbers are written as literals, and values are kept in arrays.
 */
export function powershellScript(name: string): string {
  const id = identifier(scriptName(name));
  const quoted = powershellQuoted(name);
  return `# PowerShell completion script, printed by the Loom completion plugin.
# Ported from Cobra's powershell_completions.go, Copyright 2013-2023 The Cobra Authors,
# under the Apache License, Version 2.0: http://www.apache.org/licenses/LICENSE-2.0
# The changes from Cobra are stated in the NOTICE file of @loomcli/plugins.

function __${id}_debug {
    if ($env:BASH_COMP_DEBUG_FILE) {
        "$args" | Out-File -Append -FilePath "$env:BASH_COMP_DEBUG_FILE"
    }
}

# A word as the text of a CompletionResult: bare when it holds only ASCII
# letters, digits, and - _ . / : =, and otherwise in single quotes, where each
# ' and each of U+2018 through U+201B, which PowerShell also reads as a single
# quote, is written twice.
filter __${id}_quote {
    if ($_ -cmatch '\\A[A-Za-z0-9_./:=-]+\\z') {
        return $_
    }
    $Quoted = "'"
    foreach ($Character in $_.ToCharArray()) {
        $Code = [int]$Character
        if ($Code -eq 39 -or ($Code -ge 8216 -and $Code -le 8219)) {
            $Quoted += $Character
        }
        $Quoted += $Character
    }
    $Quoted + "'"
}

# A word for a program started under Legacy argument passing, which drops an
# empty argument and leaves a " unescaped in the command line the program
# reads: an empty word as "", and each " escaped with a backslash, with the
# backslashes before it doubled.
filter __${id}_legacy {
    if ($_ -eq '') {
        return '""'
    }
    $_ -creplace '(\\\\*)"', '$1$1\\"'
}

# The word an element of the command line passes: the value of a constant
# string, which removes its quoting without evaluating it, and otherwise the
# text typed, so a variable or a subexpression reaches the program as typed.
function __${id}_word($Element) {
    if ($Element -is [System.Management.Automation.Language.StringConstantExpressionAst]) {
        return $Element.Value
    }
    $Element.Extent.Text
}

# One offered word or file name as a CompletionResult, or as its text alone
# outside FullLanguage, where a CompletionResult cannot be created.
function __${id}_result($Text, $Label, $Type, $Tip) {
    if ($ExecutionContext.SessionState.LanguageMode -eq "FullLanguage") {
        [System.Management.Automation.CompletionResult]::new($Text, $Label, $Type, $Tip)
    } else {
        $Text
    }
}

[scriptblock]\${__${id}CompleterBlock} = {
    param(
            $WordToComplete,
            $CommandAst,
            $CursorPosition
        )

    __${id}_debug ""
    __${id}_debug "========= starting completion logic =========="
    __${id}_debug "WordToComplete: $WordToComplete Command: $CommandAst CursorPosition: $CursorPosition"

    $ShellCompDirectiveError=1
    $ShellCompDirectiveNoSpace=2
    $ShellCompDirectiveNoFileComp=4
    $ShellCompDirectiveFilterFileExt=8
    $ShellCompDirectiveFilterDirs=16
    $ShellCompDirectiveKeepOrder=32

    # Any failure offers nothing. One empty string completes nothing, where
    # returning nothing would let PowerShell complete file names.
    try {
        # The user could have moved the cursor backwards on the command-line.
        # Each element is placed by its offsets: the words before the cursor,
        # then the word under it cut at the cursor, which is empty when the
        # cursor starts a new word.
        $Elements = $CommandAst.CommandElements
        $Program = __${id}_word $Elements[0]
        $Words = @()
        $Current = ''
        for ($Index = 1; $Index -lt $Elements.Count; $Index++) {
            $Extent = $Elements[$Index].Extent
            if ($Extent.EndOffset -lt $CursorPosition) {
                $Words += __${id}_word $Elements[$Index]
                continue
            }
            if ($Extent.StartOffset -lt $CursorPosition) {
                # PowerShell's parser reads the cut word and runs nothing. A
                # word that does not parse, such as an unclosed quote, offers
                # nothing.
                $Typed = $Extent.Text.Substring(0, $CursorPosition - $Extent.StartOffset)
                $Errors = $null
                $Parsed = [System.Management.Automation.Language.Parser]::ParseInput("x $Typed", [ref]$null, [ref]$Errors)
                if ($Errors.Count -gt 0) {
                    __${id}_debug "The word under the cursor does not parse: $Typed"
                    return ""
                }
                $Cut = $Parsed.Find({ $args[0] -is [System.Management.Automation.Language.CommandAst] }, $false).CommandElements
                $Current = $Typed
                if ($Cut.Count -eq 2) {
                    $Current = __${id}_word $Cut[1]
                }
            }
            break
        }

        # PowerShell 7 off Windows expands a ~ and a wildcard in every word an
        # array passes to &, so there the program is started as a process with
        # an argument list, which passes each word as it is.
        $Unix = $PSVersionTable.PSEdition -eq 'Core' -and ($IsLinux -or $IsMacOS)
        $Pattern = [System.Management.Automation.WildcardPattern]::Escape($Program)
        if ($Unix) {
            $Resolved = Get-Command -Name $Pattern -CommandType Application -ErrorAction Ignore | Select-Object -First 1
        } else {
            $Resolved = Get-Command -Name $Pattern -ErrorAction Ignore | Select-Object -First 1
            if ($Resolved -is [System.Management.Automation.AliasInfo]) {
                $Resolved = $Resolved.ResolvedCommand
            }
        }
        if ($null -eq $Resolved) {
            __${id}_debug "The program is not found: $Program"
            return ""
        }

        # A program that resolves to a .bat or .cmd file is never called,
        # because cmd.exe reads its arguments again as commands.
        $Application = $Resolved -is [System.Management.Automation.ApplicationInfo]
        if ($Application -and ([System.IO.Path]::GetExtension($Resolved.Path) -in '.bat', '.cmd')) {
            __${id}_debug "The program is a batch file: $($Resolved.Path)"
            return ""
        }

        if ($Unix) {
            # Each word reaches the program as its characters, in the process's
            # argument list. The answer is read as UTF-8, and stderr is read to
            # its end and discarded, so a full stderr pipe never stalls the call.
            $Request = @('completion', '__complete', '--') + @($Words) + @($Current)
            __${id}_debug "Starting $($Resolved.Path) $Request"
            $Start = [System.Diagnostics.ProcessStartInfo]::new($Resolved.Path)
            foreach ($Word in $Request) {
                $Start.ArgumentList.Add($Word)
            }
            $Start.UseShellExecute = $false
            $Start.RedirectStandardOutput = $true
            $Start.RedirectStandardError = $true
            $Start.StandardOutputEncoding = [System.Text.UTF8Encoding]::new($false)
            $Start.WorkingDirectory = $ExecutionContext.SessionState.Path.CurrentFileSystemLocation.ProviderPath
            $Process = [System.Diagnostics.Process]::Start($Start)
            try {
                $Discarded = $Process.StandardError.ReadToEndAsync()
                $Text = $Process.StandardOutput.ReadToEnd()
                $Process.WaitForExit()
                $null = $Discarded.Result
                $ExitCode = $Process.ExitCode
            } finally {
                $Process.Dispose()
            }
            # One element per line, as & reads a program's output.
            $Out = @($Text -split '\\r?\\n')
            if ($Out[-1] -eq '') {
                if ($Out.Count -eq 1) {
                    $Out = @()
                } else {
                    $Out = @($Out[0..($Out.Count - 2)])
                }
            }
        } else {
            # PowerShell 7.2 and earlier, and the Legacy style after it, drop an
            # empty argument and leave a " unescaped, so each word is escaped. The
            # Windows style passes Legacy arguments to the files and commands
            # PowerShell lists for it.
            $Legacy = $false
            if ($Application) {
                if ($PSVersionTable.PsVersion -lt [version]'7.2.0' -or
                    ($PSVersionTable.PsVersion -lt [version]'7.3.0' -and -not [ExperimentalFeature]::IsEnabled("PSNativeCommandArgumentPassing"))) {
                    $Legacy = $true
                } elseif ($PSNativeCommandArgumentPassing -eq 'Legacy') {
                    $Legacy = $true
                } elseif ($PSNativeCommandArgumentPassing -eq 'Windows') {
                    $Legacy = ([System.IO.Path]::GetExtension($Resolved.Path) -in '.js', '.vbs', '.wsf') -or
                        ([System.IO.Path]::GetFileNameWithoutExtension($Resolved.Path) -in 'cmd', 'cscript', 'find', 'sqlcmd', 'wscript')
                }
            }
            $Arguments = @($Words) + @($Current)
            if ($Legacy) {
                $Arguments = @($Arguments | __${id}_legacy)
            }

            # Each word reaches the program as its characters, in an argument array.
            $Request = @('completion', '__complete', '--') + $Arguments
            __${id}_debug "Calling $Program $Request"

            # The answer is UTF-8, which PowerShell reads in the console's encoding.
            $SavedExitCode = $global:LASTEXITCODE
            $Encoding = [Console]::OutputEncoding
            $Recode = $Encoding.CodePage -ne 65001
            try {
                if ($Recode) {
                    [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
                }
                $global:LASTEXITCODE = 0
                $Out = @(& $Resolved @Request 2>$null)
                $ExitCode = $global:LASTEXITCODE
            } finally {
                if ($Recode) {
                    [Console]::OutputEncoding = $Encoding
                }
                $global:LASTEXITCODE = $SavedExitCode
            }
        }
        if ($ExitCode -ne 0) {
            __${id}_debug "The program exited with code $ExitCode"
            return ""
        }

        # The last line is a colon and the directive's decimal digits.
        if ($Out.Count -eq 0 -or "$($Out[-1])" -cnotmatch '\\A:[0-9]+\\z') {
            __${id}_debug "The answer holds no directive line"
            return ""
        }
        [int]$Directive = "$($Out[-1])".Substring(1)
        __${id}_debug "The completion directive is: $Directive"

        # remove directive (last element) from out
        $Lines = @()
        if ($Out.Count -gt 1) {
            $Lines = @($Out[0..($Out.Count - 2)])
        }
        __${id}_debug "The completions are: $Lines"

        if (($Directive -band $ShellCompDirectiveError) -ne 0 ) {
            # Error code.  No completion.
            __${id}_debug "Received error from custom completion go code"
            return ""
        }

        $Values = @($Lines | ForEach-Object {
            #Split the output in name and description
            $Name, $Description = "$_".Split("\`t",2)
            __${id}_debug "Name: $Name Description: $Description"

            # Set the description to a one space string if there is none set.
            # This is needed because the CompletionResult does not accept an empty string as argument
            if (-Not $Description) {
                $Description = " "
            }
            New-Object -TypeName PSCustomObject -Property @{
                Name = "$Name"
                Description = "$Description"
            }
        })

        $Space = " "
        if (($Directive -band $ShellCompDirectiveNoSpace) -ne 0 ) {
            # remove the space here
            __${id}_debug "ShellCompDirectiveNoSpace is called"
            $Space = ""
        }

        if ((($Directive -band $ShellCompDirectiveFilterFileExt) -ne 0 ) -or
           (($Directive -band $ShellCompDirectiveFilterDirs) -ne 0 ))  {
            # List the folder the word under the cursor names, read literally:
            # its directories, and under FilterFileExt its files that end in an
            # offered extension, compared as strings. Under FilterDirs, an
            # offered word names the folder to list in.
            $DirectoriesOnly = ($Directive -band $ShellCompDirectiveFilterDirs) -ne 0
            $Split = $Current.LastIndexOfAny([char[]]@([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar))
            $Folder = $Current.Substring(0, $Split + 1)
            $Leaf = $Current.Substring($Split + 1)
            $Base = $ExecutionContext.SessionState.Path.CurrentFileSystemLocation.ProviderPath
            $Extensions = @()
            if ($DirectoriesOnly) {
                if ($Values.Count -gt 0) {
                    $Base = [System.IO.Path]::Combine($Base, $Values[0].Name)
                }
            } else {
                $Extensions = @($Values | ForEach-Object { "." + $_.Name })
            }
            __${id}_debug "Listing $Folder in $Base for extensions $Extensions"
            $Entries = @(Get-ChildItem -LiteralPath ([System.IO.Path]::Combine($Base, $Folder)) -Force:($Leaf.StartsWith('.')) -ErrorAction Ignore | Where-Object {
                $Entry = $_
                $Entry.Name.StartsWith($Leaf, [System.StringComparison]::Ordinal) -and
                    ($Entry.PSIsContainer -or @($Extensions | Where-Object { $Entry.Name.EndsWith($_, [System.StringComparison]::Ordinal) }).Count -gt 0)
            })
            if ($Entries.Count -eq 0) {
                return ""
            }
            # A sole file takes a space after it, and a directory none.
            $Entries | ForEach-Object {
                $Text = $Folder + $_.Name
                $Type = 'ProviderItem'
                $After = ""
                if ($_.PSIsContainer) {
                    $Text += '/'
                    $Type = 'ProviderContainer'
                } elseif ($Entries.Count -eq 1) {
                    $After = $Space
                }
                __${id}_result (($Text | __${id}_quote) + $After) $_.Name $Type $_.Name
            }
            return
        }

        $Values = @($Values | Where-Object {
            # filter the result by string comparison
            $_.Name.StartsWith($Current, [System.StringComparison]::Ordinal)
        })

        # we sort the values in ascending order by name if keep order isn't passed
        if (($Directive -band $ShellCompDirectiveKeepOrder) -eq 0 ) {
            $Values = @($Values | Sort-Object -Property Name)
        }

        if ($Values.Count -eq 0) {
            if (($Directive -band $ShellCompDirectiveNoFileComp) -ne 0 ) {
                __${id}_debug "ShellCompDirectiveNoFileComp is called"
                # Just print an empty string here so the
                # shell does not start to complete paths.
                return ""
            }
            # Returning nothing leaves PowerShell its own file completion.
            return
        }

        # A sole word is inserted with a space after it, as Cobra's Complete
        # mode inserts it, unless the directive asks for no space.
        $After = ""
        if ($Values.Count -eq 1) {
            $After = $Space
        }
        $Values | ForEach-Object {
            __${id}_result (($_.Name | __${id}_quote) + $After) $_.Name 'ParameterValue' $_.Description
        }
    } catch {
        __${id}_debug "Completion failed: $_"
        return ""
    }
}

Register-ArgumentCompleter -Native -CommandName ${quoted} -ScriptBlock \${__${id}CompleterBlock}
`;
}
