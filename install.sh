#!/usr/bin/env bash
set -euo pipefail

# Installs the published binary; cloning this repo does not require a source build.
fieldscreen_version="0.1.0-preview.10"
fieldscreen_launch=true
case "${1:-}" in
  --no-launch) fieldscreen_launch=false ;;
  --help) printf 'Usage: ./install.sh [--no-launch]\nDownloads the Linux x64 app, verifies its checksum, and adds an application-menu shortcut.\n'; exit 0 ;;
  '') ;;
  *) printf 'Unknown option. Use ./install.sh --help\n' >&2; exit 1 ;;
esac
if [[ "$(uname -s):$(uname -m)" != Linux:x86_64 ]]; then
  printf 'This preview supports Linux x86_64, including Steam Deck.\n' >&2; exit 1
fi
for fieldscreen_tool in curl sha256sum install mktemp; do
  command -v "$fieldscreen_tool" >/dev/null || { printf 'Please install %s and try again.\n' "$fieldscreen_tool" >&2; exit 1; }
done

fieldscreen_source_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
fieldscreen_app_dir="${FIELDSCREEN_INSTALL_DIR:-$HOME/Applications}"
fieldscreen_data_dir="${XDG_DATA_HOME:-$HOME/.local/share}"
fieldscreen_bin_dir="${FIELDSCREEN_BIN_DIR:-$HOME/.local/bin}"
mkdir -p "$fieldscreen_app_dir"
fieldscreen_app_dir="$(cd -- "$fieldscreen_app_dir" && pwd)"
fieldscreen_temp="$(mktemp -d "$fieldscreen_app_dir/.fieldscreen-install.XXXXXX")"
trap 'rm -rf -- "$fieldscreen_temp"' EXIT
fieldscreen_asset="FieldScreen-TV-${fieldscreen_version}-Linux-x86_64.AppImage"
fieldscreen_release="https://github.com/AndrewDuval6/fieldscreen-tv/releases/download/v${fieldscreen_version}"
printf 'Downloading FieldScreen TV %s…\n' "$fieldscreen_version"
curl --fail --location --show-error --retry 2 --proto '=https' --proto-redir '=https' "$fieldscreen_release/$fieldscreen_asset" --output "$fieldscreen_temp/$fieldscreen_asset"
curl --fail --location --show-error --retry 2 --proto '=https' --proto-redir '=https' "$fieldscreen_release/SHA256SUMS" --output "$fieldscreen_temp/SHA256SUMS"
fieldscreen_checksum="$(awk -v asset="$fieldscreen_asset" '$2 == asset {print $1}' "$fieldscreen_temp/SHA256SUMS")"
if [[ ! "$fieldscreen_checksum" =~ ^[[:xdigit:]]{64}$ ]]; then
  printf 'No valid checksum found for this download. The existing app was not changed.\n' >&2; exit 1
fi
(cd -- "$fieldscreen_temp" && printf '%s  %s\n' "$fieldscreen_checksum" "$fieldscreen_asset" | sha256sum --check --status) || {
  printf 'Download verification failed. The existing app was not changed.\n' >&2; exit 1
}
chmod 755 "$fieldscreen_temp/$fieldscreen_asset"
fieldscreen_app="$fieldscreen_app_dir/FieldScreen-TV.AppImage"
mv -f -- "$fieldscreen_temp/$fieldscreen_asset" "$fieldscreen_app"
mkdir -p "$fieldscreen_bin_dir" "$fieldscreen_data_dir/applications" "$fieldscreen_data_dir/icons/hicolor/512x512/apps"
ln -sfn -- "$fieldscreen_app" "$fieldscreen_bin_dir/fieldscreen-tv"
install -m 644 "$fieldscreen_source_dir/desktop/icon.png" "$fieldscreen_data_dir/icons/hicolor/512x512/apps/fieldscreen-tv.png"
# Desktop Entry Exec uses its own escaping, not shell evaluation.
fieldscreen_exec="${fieldscreen_app//\\/\\\\\\\\}"
fieldscreen_exec="${fieldscreen_exec//\"/\\\"}"
fieldscreen_exec="${fieldscreen_exec//\$/\\\$}"
fieldscreen_exec="${fieldscreen_exec//\`/\\\`}"
fieldscreen_exec="${fieldscreen_exec//%/%%}"
cat > "$fieldscreen_data_dir/applications/fieldscreen-tv.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=FieldScreen TV
Comment=NFL dashboard and IPTV multiview
Exec="$fieldscreen_exec" --windowed
Icon=fieldscreen-tv
Terminal=false
Categories=AudioVideo;Video;Sports;
StartupWMClass=fieldscreen-tv
DESKTOP
if command -v update-desktop-database >/dev/null; then update-desktop-database "$fieldscreen_data_dir/applications" >/dev/null 2>&1 || true; fi
printf '\nInstalled: %s\nOpen FieldScreen TV from your app launcher.\n' "$fieldscreen_app"
printf 'For Steam Deck Gaming Mode, add this AppImage as a non-Steam game.\n'
printf 'To update later: git pull --ff-only && ./install.sh\n'
if "$fieldscreen_launch"; then
  printf 'Opening in a window. Select Connect IPTV to enter your provider privately.\n'
  nohup "$fieldscreen_app" --windowed </dev/null >/dev/null 2>&1 &
fi
