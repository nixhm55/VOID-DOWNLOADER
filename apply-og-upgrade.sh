#!/usr/bin/env bash
set -euo pipefail

# VOID — OG Global Lossless Music Integration Installer
# Copies the independent OG backend and frontend files into the Void project directory.

TARGET_DIR="${1:-/Users/mohammednisam/Works/vs/MAIN/WEBSITE/VOID DOWNLOADER}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Applying VOID OG Global Lossless Music Integration to: $TARGET_DIR"

mkdir -p "$TARGET_DIR/VOID-BACKEND/og/config"
mkdir -p "$TARGET_DIR/VOID-BACKEND/og/models"
mkdir -p "$TARGET_DIR/VOID-BACKEND/og/verification"
mkdir -p "$TARGET_DIR/VOID-BACKEND/og/providers"
mkdir -p "$TARGET_DIR/VOID-BACKEND/og/search"
mkdir -p "$TARGET_DIR/VOID-BACKEND/og/services"
mkdir -p "$TARGET_DIR/VOID-BACKEND/og/tests"
mkdir -p "$TARGET_DIR/src/api"
mkdir -p "$TARGET_DIR/src/types"
mkdir -p "$TARGET_DIR/src/desktop"
mkdir -p "$TARGET_DIR/src/mobile"
mkdir -p "$TARGET_DIR/api/void-api"

cp -f "$SCRIPT_DIR/VOID-BACKEND/og/config/index.js" "$TARGET_DIR/VOID-BACKEND/og/config/index.js"
cp -f "$SCRIPT_DIR/VOID-BACKEND/og/models/index.js" "$TARGET_DIR/VOID-BACKEND/og/models/index.js"
cp -f "$SCRIPT_DIR/VOID-BACKEND/og/verification/index.js" "$TARGET_DIR/VOID-BACKEND/og/verification/index.js"
cp -f "$SCRIPT_DIR/VOID-BACKEND/og/providers/index.js" "$TARGET_DIR/VOID-BACKEND/og/providers/index.js"
cp -f "$SCRIPT_DIR/VOID-BACKEND/og/search/index.js" "$TARGET_DIR/VOID-BACKEND/og/search/index.js"
cp -f "$SCRIPT_DIR/VOID-BACKEND/og/services/index.js" "$TARGET_DIR/VOID-BACKEND/og/services/index.js"
cp -f "$SCRIPT_DIR/VOID-BACKEND/og/tests/ogVerificationAndRegression.test.js" "$TARGET_DIR/VOID-BACKEND/og/tests/ogVerificationAndRegression.test.js"
cp -f "$SCRIPT_DIR/VOID-BACKEND/index.js" "$TARGET_DIR/VOID-BACKEND/index.js"
cp -f "$SCRIPT_DIR/VOID-BACKEND/.env.example" "$TARGET_DIR/VOID-BACKEND/.env.example"
cp -f "$SCRIPT_DIR/.env.example" "$TARGET_DIR/.env.example"

cp -f "$SCRIPT_DIR/src/api/ogApi.ts" "$TARGET_DIR/src/api/ogApi.ts"
cp -f "$SCRIPT_DIR/src/api/quality.ts" "$TARGET_DIR/src/api/quality.ts"
cp -f "$SCRIPT_DIR/src/api/unifiedSearch.ts" "$TARGET_DIR/src/api/unifiedSearch.ts"
cp -f "$SCRIPT_DIR/src/types/voidUI.tsx" "$TARGET_DIR/src/types/voidUI.tsx"
cp -f "$SCRIPT_DIR/src/desktop/DesktopUI.tsx" "$TARGET_DIR/src/desktop/DesktopUI.tsx"
cp -f "$SCRIPT_DIR/src/mobile/MobileUI.tsx" "$TARGET_DIR/src/mobile/MobileUI.tsx"
cp -f "$SCRIPT_DIR/src/App.tsx" "$TARGET_DIR/src/App.tsx"
cp -f "$SCRIPT_DIR/src/index.css" "$TARGET_DIR/src/index.css"
cp -f "$SCRIPT_DIR/api/void-api/_gateway.ts" "$TARGET_DIR/api/void-api/_gateway.ts"

echo "VOID OG upgrade applied. Running verification test suite..."
node "$TARGET_DIR/VOID-BACKEND/og/tests/ogVerificationAndRegression.test.js"
echo "Done!"
