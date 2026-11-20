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
#   settle <ms> <file> <seconds>
#                  measures the file, presses Tab, and reads the terminal until it has been silent
#                  for the milliseconds and the file has grown, or until the seconds have passed
#   quit           closes the terminal
# The reads use zpty -rt without a pattern, because a pattern read blocks until a newline and a
# prompt never ends in one.
emulate -L zsh
zmodload zsh/zpty || exit 3
zmodload zsh/datetime || exit 3
# zpty joins its arguments and evaluates them, so each one is quoted to arrive as it is.
zpty shell "${(j: :)${(q)@}}" || exit 4
typeset buf='' line verb arg text pattern chunk
integer deadline
typeset -F stamp
typeset -a words
# Nushell asks where the cursor is, and waits two seconds for an answer a terminal gives.
# The report puts the cursor in the first row, which leaves the menu room below it.
# A read may end inside a request, so the start of one at the end of a read waits for the next.
typeset cursor_pending=''
reply_cursor_reports() {
  [[ -n $LOOM_PTY_REPORTS_CURSOR ]] || return 0
  local rest=$cursor_pending$chunk
  integer cut
  while [[ $rest == *$'\e[6n'* ]]; do
    zpty -w -n shell $'\e[1;1R'
    rest=${rest#*$'\e[6n'}
  done
  cursor_pending=''
  for cut in 3 2 1; do
    if (( ${#rest} >= cut )) && [[ $'\e[6n' == "${rest[-cut,-1]}"* ]]; then
      cursor_pending=${rest[-cut,-1]}
      break
    fi
  done
}
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
            reply_cursor_reports
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
    settle)
      words=(${=arg})
      integer began=$SECONDS size
      size=$(wc -c < $words[2])
      stamp=$EPOCHREALTIME
      zpty -w -n shell $'\t'
      deadline=$(( SECONDS + 15 ))
      # The loop ends once the file has grown and the output has been quiet since, or when the
      # seconds have passed and the output is quiet.
      integer grown=0
      while (( SECONDS <= deadline )); do
        if (( ! grown )) && (( $(wc -c < $words[2]) > size )); then
          grown=1
          stamp=$EPOCHREALTIME
        fi
        if (( EPOCHREALTIME - stamp >= words[1] / 1000.0 )) && (( grown || SECONDS - began >= words[3] )); then
          break
        fi
        zpty -rt shell chunk 2>/dev/null
        case $? in
          0)
            buf+=$chunk
            reply_cursor_reports
            stamp=$EPOCHREALTIME
            ;;
          2)
            break
            ;;
          *)
            sleep 0.02
            ;;
        esac
      done
      ;;
    quit)
      break
      ;;
  esac
done
zpty -d shell 2>/dev/null
