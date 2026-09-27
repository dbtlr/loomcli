#!/usr/bin/env zsh
# Drives one interactive shell under a pseudo-terminal for the shell completion tests.
# Usage: zsh zpty-driver.zsh <shell> [args...]
# BSD script(1) refuses a piped stdin, so the zsh/zpty module owns the terminal instead.
# Steps arrive on stdin, one per line, and may be streamed while the shell runs:
#   send <text>    writes text to the shell; escapes such as \t, \n, and \x01 are decoded
#   expect <glob>  reads the terminal until the output so far matches *<glob>*, prints the
#                  output through the first match between @@BEGIN@@ and @@END@@ lines, and keeps
#                  the output after it; after 15 seconds it prints @@TIMEOUT@@ and the output,
#                  and when the shell exits first it prints @@EXITED@@ and the output
#   quit           closes the terminal
# The reads use zpty -rt without a pattern, because a pattern read blocks until a newline and a
# prompt never ends in one.
emulate -L zsh
zmodload zsh/zpty || exit 3
# zpty joins its arguments and evaluates them, so each one is quoted to arrive as it is.
zpty shell "${(j: :)${(q)@}}" || exit 4
typeset buf='' line verb arg text pattern chunk
integer deadline
while IFS= read -r line; do
  verb=${line%% *}
  arg=${line#* }
  case $verb in
    send)
      # printf -v keeps a trailing newline, which a command substitution would strip.
      printf -v text '%b' "$arg"
      zpty -w -n shell "$text"
      ;;
    expect)
      deadline=$(( SECONDS + 15 ))
      printf -v pattern '%b' "$arg"
      while [[ $buf != *${~pattern}* ]]; do
        zpty -rt shell chunk 2>/dev/null
        case $? in
          0)
            buf+=$chunk
            ;;
          2)
            # The shell exited. zpty -t would block here on macOS, so the read status tells.
            print -r -- '@@EXITED@@'
            print -r -- "$buf"
            exit 6
            ;;
          *)
            if (( SECONDS > deadline )); then
              print -r -- '@@TIMEOUT@@'
              print -r -- "$buf"
              exit 5
            fi
            sleep 0.02
            ;;
        esac
      done
      print -r -- '@@BEGIN@@'
      print -rn -- "${(M)buf#*${~pattern}}"
      print -r -- '@@END@@'
      buf=${buf#*${~pattern}}
      ;;
    quit)
      break
      ;;
  esac
done
zpty -d shell 2>/dev/null
