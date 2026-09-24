#!/usr/bin/env bash
# Runs the gate script for several branch heads in one lane, one after another.
# Usage: lane-queue.sh <lane-root> <label>:<source-clone>:<branch>:<expected-sha> ...
# Each head is fetched from its source clone and checked out detached, so no ref
# in the lane changes. A head that differs from <expected-sha> is skipped.
set -u
scratch=/private/tmp/claude-501/-Users-pavelguseynov-paperclip-fork/28b5943e-7b11-4fdc-a43e-73c2578b2a8e/scratchpad
lane="$1"; shift
for spec in "$@"; do
  IFS=: read -r label source branch expected <<< "$spec"
  case "$source" in /*) ;; *) source="$scratch/$source" ;; esac
  git -C "$lane" fetch -q "$source" "$branch" || { echo "$label: fetch failed" >> "$scratch/logs/lane-queue.log"; continue; }
  head="$(git -C "$lane" rev-parse FETCH_HEAD)"
  case "$head" in
    "$expected"*) ;;
    *) echo "$label: head $head does not match expected $expected; skipped" >> "$scratch/logs/lane-queue.log"; continue ;;
  esac
  git -C "$lane" checkout -q --detach "$head" || { echo "$label: checkout failed" >> "$scratch/logs/lane-queue.log"; continue; }
  cp "$scratch/gates.sh" "$scratch/gates-run-$label.sh"
  GATE_ROOT="$lane" bash "$scratch/gates-run-$label.sh" "$label" 7b7c4d4172d6aac14919e2682b702ae87bc17653
  echo "$label: done $(date -u +%FT%TZ)" >> "$scratch/logs/lane-queue.log"
done
