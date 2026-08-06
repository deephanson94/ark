#!/bin/bash
[ "$CLAUDE_CODE_REMOTE" != "true" ] && exit 0
[ -f package.json ] || exit 0
npm install
exit 0