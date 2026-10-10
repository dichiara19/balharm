#!/usr/bin/env bash
# PreToolUse (Bash): blocca i comandi git/deploy che violano le regole di
# CLAUDE.md. Exit 2 = comando bloccato, stderr torna a Claude come motivo.
cmd=$(jq -r '.tool_input.command // empty')
[ -z "$cmd" ] && exit 0

deny() { echo "git-guard: $1" >&2; exit 2; }

# Attribuzione a Claude in commit, tag o PR.
if grep -qE '\bgit\b.*\b(commit|tag)\b|\bgh\b.*\bpr\b' <<<"$cmd" &&
   grep -qiE 'co-authored-by:[^"]*(claude|anthropic)|claude-session|generated with[^"]*claude|claude\.ai/|noreply@anthropic' <<<"$cmd"; then
  deny "niente riferimenti a Claude in commit/tag/PR (regola globale di Giuseppe)."
fi

# Aggirare le git hook del repo.
if grep -qE '\bgit\b.*(--no-verify|\bcommit\b[^|;&]*\s-[a-zA-Z]*n\b)' <<<"$cmd"; then
  deny "--no-verify / commit -n non ammessi: le hook in .githooks/ sono i controlli del repo."
fi
if grep -qE '\bgit\b.*\bconfig\b.*core\.hooksPath' <<<"$cmd"; then
  deny "core.hooksPath deve restare .githooks."
fi

# Il token ion senza restrizioni.
if grep -qE '\bgit\b.*\b(add|commit|stash)\b.*dev\.local' <<<"$cmd"; then
  deny "dev.local.js non va mai in git (token ion senza restrizioni)."
fi

# Push su main: Cloudflare Pages è configurato (npm run build → dist,
# git-integrated, preview abilitate). Il blocco è stato rimosso il
# 2026-10-10 dopo verifica della preview del branch.

# Deploy manuali: dist/ di test contiene dev.local.js.
if grep -qE '\bwrangler\b.*\b(deploy|publish)\b|\bpages\b.*\bdeploy\b' <<<"$cmd"; then
  deny "deploy manuale non ammesso: Pages è git-integrated e dist/ locale può contenere dev.local.js."
fi

exit 0
