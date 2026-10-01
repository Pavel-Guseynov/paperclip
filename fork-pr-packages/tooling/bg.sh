#!/bin/bash
# usage: bg.sh <log> <command...>   run a command as qzrunner, detached from this shell
log="$1"; shift
nohup setsid runuser -u qzrunner -- bash -c "$*" > "$log" 2>&1 < /dev/null &
disown
