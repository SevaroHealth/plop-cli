#!/usr/bin/env bash
# plop-deploy installer.
#
#   curl -fsSL https://raw.githubusercontent.com/SevaroHealth/plop-cli/main/install.sh | bash
#
# Downloads the self-contained plop-deploy binary for your OS/arch and puts it
# on your PATH. No Node/Bun required to run it.
#
# This repo is public, so the default is a plain unauthenticated curl from
# GitHub Releases. Overrides:
#   PLOP_BIN_DIR        install dir (default: ~/.local/bin)
#   PLOP_CLI_TAG        release tag (default: latest)
#   PLOP_CLI_BASE_URL   alternate mirror base (e.g. a CloudFront URL)
#   PLOP_CLI_REPO       owner/repo (default: SevaroHealth/plop-cli)
set -euo pipefail

REPO="${PLOP_CLI_REPO:-SevaroHealth/plop-cli}"
BIN_NAME="plop-deploy"
BIN_DIR="${PLOP_BIN_DIR:-$HOME/.local/bin}"
BASE_URL="${PLOP_CLI_BASE_URL:-}"
TAG="${PLOP_CLI_TAG:-latest}"

os="$(uname -s)"
arch="$(uname -m)"
case "$os" in
  Darwin) os="darwin" ;;
  Linux) os="linux" ;;
  *) echo "Unsupported OS: $os (only macOS and Linux are supported)" >&2; exit 1 ;;
esac
case "$arch" in
  arm64 | aarch64) arch="arm64" ;;
  x86_64 | amd64) arch="x64" ;;
  *) echo "Unsupported architecture: $arch" >&2; exit 1 ;;
esac
asset="${BIN_NAME}-${os}-${arch}"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
out="$tmp/$BIN_NAME"

if [[ -n "$BASE_URL" ]]; then
  url="${BASE_URL%/}/$asset"
elif [[ "$TAG" == "latest" ]]; then
  url="https://github.com/$REPO/releases/latest/download/$asset"
else
  url="https://github.com/$REPO/releases/download/$TAG/$asset"
fi

echo "Downloading $url"
curl -fsSL "$url" -o "$out"

chmod +x "$out"
mkdir -p "$BIN_DIR"
mv "$out" "$BIN_DIR/$BIN_NAME"
echo "Installed $BIN_NAME -> $BIN_DIR/$BIN_NAME"

case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *)
    echo
    echo "NOTE: $BIN_DIR is not on your PATH. Add this to your shell profile:"
    echo "  export PATH=\"$BIN_DIR:\$PATH\""
    ;;
esac

echo
echo "Done. Try: $BIN_NAME --help"
