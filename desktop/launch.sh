#!/bin/sh
set -eu
fieldscreen_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

# Steam's preloaded overlay can prevent Electron's GPU child from launching.
# Remove only its renderer library, retaining unrelated user preload settings.
case "${LD_PRELOAD:-}" in
  *gameoverlayrenderer.so*)
    fieldscreen_preload=''
    fieldscreen_saved_ifs=$IFS
    IFS=' :'
    set -f
    for fieldscreen_library in $LD_PRELOAD; do
      case "$fieldscreen_library" in
        */gameoverlayrenderer.so) ;;
        *) fieldscreen_preload="${fieldscreen_preload:+$fieldscreen_preload:}$fieldscreen_library" ;;
      esac
    done
    set +f
    IFS=$fieldscreen_saved_ifs
    if [ -n "$fieldscreen_preload" ]; then export LD_PRELOAD=$fieldscreen_preload; else unset LD_PRELOAD; fi
    ;;
esac

fieldscreen_ozone=false
for fieldscreen_argument in "$@"; do
  case "$fieldscreen_argument" in --ozone-platform|--ozone-platform=*) fieldscreen_ozone=true;; esac
done
if [ -n "${SteamGameId:-${SteamAppId:-}}" ] && [ "$fieldscreen_ozone" = false ]; then
  exec "$fieldscreen_dir/fieldscreen-tv-bin" --ozone-platform=x11 "$@"
fi
exec "$fieldscreen_dir/fieldscreen-tv-bin" "$@"
