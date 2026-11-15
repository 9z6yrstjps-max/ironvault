#!/bin/bash
# Publishes this folder to GitHub (used by Claude from its work environment).
# Usage: ./publish.sh "commit message"   -- reads the token from github-token.txt (never committed).
set -euo pipefail
REPO="9z6yrstjps-max/ironvault"
SRC="$(cd "$(dirname "$0")" && pwd)"
TOKEN="$(grep -o 'github_pat_[A-Za-z0-9_]*' "$SRC/github-token.txt" | head -1)"
AUTH="AUTHORIZATION: basic $(printf 'x-access-token:%s' "$TOKEN" | base64 | tr -d "\n")"
WORK="$(mktemp -d "${HOME}/ivpub.XXXXXX")"
git -c http.extraheader="$AUTH" clone -q --depth 1 "https://github.com/$REPO.git" "$WORK/repo"
rsync -a --delete --exclude .git --exclude-from "$SRC/.gitignore" "$SRC/" "$WORK/repo/"
cd "$WORK/repo"
git add -A
if git diff --cached --quiet; then echo "Nothing to publish."; exit 0; fi
git -c user.name="Enzo" -c user.email="9z6yrstjps-max@users.noreply.github.com" commit -q -m "${1:-Update site}"
git -c http.extraheader="$AUTH" push -q origin HEAD:main
git log --oneline -1; git show --stat --format= HEAD | tail -15
