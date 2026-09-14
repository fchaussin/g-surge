#!/usr/bin/env bash
# .claude/hooks/secret-guard.sh
#
# PreToolUse hook (matcher Bash) : avant tout `git commit`, scanne les
# changements STAGED et bloque le commit si on detecte des secrets en dur
# ou un vrai fichier .env (CLOUDFLARE_API_TOKEN et cie doivent rester
# gitignores, jamais commits en clair).
#
# Cable dans .claude/settings.json. Exit 2 = commit bloque (stderr renvoye a
# Claude). Exit 0 = rien a signaler / commande non concernee.
#
# Bypass ponctuel :
#   - variable d'env  ALLOW_SECRET_COMMIT=1
#   - marqueur en fin de ligne  "secret-guard:allow"  (ignore cette ligne)
#
# Peut aussi servir de git hook classique (protege hors Claude) :
#   ln -sf ../../.claude/hooks/secret-guard.sh .git/hooks/pre-commit
# (en hook git il n'y a pas de stdin JSON -> le scan tourne directement.)

set -euo pipefail

# --- 1. Recupere la commande (payload JSON de Claude sur stdin) -------------
cmd=""
if [ ! -t 0 ]; then
    payload="$(cat || true)"
    if [ -n "$payload" ]; then
        cmd="$(printf '%s' "$payload" | jq -r '.tool_input.command // empty' 2>/dev/null || true)"
    fi
fi

if [ -n "$cmd" ]; then
    if ! printf '%s' "$cmd" | grep -Eq '\bgit\b([[:space:]]+-[^[:space:]]+)*[[:space:]]+commit\b'; then
        exit 0
    fi
    printf '%s' "$cmd" | grep -Eq -- '--dry-run' && exit 0
fi

if [ "${ALLOW_SECRET_COMMIT:-0}" = "1" ] || printf '%s' "${cmd:-}" | grep -Eq '\bALLOW_SECRET_COMMIT=1\b'; then
    exit 0
fi

# --- 2. Se placer dans le repo ---------------------------------------------
cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || true
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

# --- 3. Fichiers staged ------------------------------------------------------
files="$(git diff --cached --name-only --diff-filter=ACMR 2>/dev/null || true)"
[ -z "$files" ] && exit 0

# --- Patterns ---------------------------------------------------------------
RE_HARDSECRET='(-----BEGIN [A-Z ]*PRIVATE KEY-----|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})'
RE_SECRETKV='(password|passwd|secret|token|api[_-]?key|auth[_-]?key|access[_-]?key)[[:space:]]*[:=][[:space:]]*["'"'"']?[^[:space:]"'"'"'#$<{][^[:space:]"'"'"'#]{6,}'

is_example() {
    case "$1" in
        *.example|*.example.*|*.sample|*.dist|*.md|*.tmpl|*.template) return 0 ;;
        *) return 1 ;;
    esac
}

violations=""
add() { violations+="  $1\n"; }

while IFS= read -r f; do
    [ -z "$f" ] && continue
    case "$f" in
        .claude/hooks/*) continue ;;
    esac

    added="$(git diff --cached -U0 -- "$f" 2>/dev/null | grep '^+' | grep -v '^+++' | sed 's/^+//' || true)"
    [ -z "$added" ] && continue
    added="$(printf '%s\n' "$added" | grep -v 'secret-guard:allow' || true)"
    [ -z "$added" ] && continue

    while IFS= read -r line; do
        [ -z "$line" ] && continue
        if printf '%s' "$line" | grep -Eq "$RE_HARDSECRET"; then
            add "$f : secret en clair -> ${line:0:80}"
        fi
        if ! is_example "$f" && printf '%s' "$line" | grep -iEq "$RE_SECRETKV"; then
            add "$f : valeur de secret codee en dur -> ${line:0:80}"
        fi
    done <<< "$added"

    case "$(basename "$f")" in
        .env|.env.*|*.env)
            is_example "$f" || add "$f : fichier .env reel ajoute au commit (doit rester gitignore)"
            ;;
    esac
done <<< "$files"

[ -z "$violations" ] && exit 0

{
    echo "COMMIT BLOQUE par secret-guard (.claude/hooks/secret-guard.sh) :"
    printf "%b" "$violations"
    echo ""
    echo "Corrige ces lignes (deplace le secret dans .env gitignore, ou .env.example avec placeholder)."
    echo "Bypass faux positif : marqueur 'secret-guard:allow' en fin de ligne,"
    echo "  ou prefixer la commande ->  ALLOW_SECRET_COMMIT=1 git commit ..."
} >&2
exit 2
