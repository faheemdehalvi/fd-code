#!/bin/sh
# Installs only the ArtCraft apps you name (https://getartcraft.com/apps) from
# each app's latest official release on github.com/storytold.
#
#   curl -fsSL https://raw.githubusercontent.com/faheemdehalvi/fd-code/t3-beta/scripts/artcraft-install.sh | sh -s -- soundcraft photocraft
#
# Environment:
#   ARTCRAFT_APPS_DIR  where the apps go (default: /Applications)
set -eu

APPS="photocraft vectorcraft filmcraft lightcraft pdfcraft effectcraft designcraft figcraft wordcraft soundcraft deckcraft cadcraft gridcraft craft-launcher"

if [ "$(uname -s)" != Darwin ]; then
  echo "This installer is for macOS. On Windows use artcraft-install.ps1." >&2
  exit 1
fi
if [ $# -eq 0 ]; then
  echo "Name the apps to install, for example: soundcraft photocraft effectcraft" >&2
  echo "Apps: $APPS" >&2
  exit 2
fi
for app in "$@"; do
  case " $APPS " in
    *" $app "*) ;;
    *) echo "Unknown app: $app. Choose from: $APPS" >&2; exit 2 ;;
  esac
done

dest="${ARTCRAFT_APPS_DIR:-/Applications}"
mkdir -p "$dest"
tmp=$(mktemp -d)
trap 'hdiutil detach -quiet "$tmp/mnt" 2>/dev/null || true; rm -rf "$tmp"' EXIT

for app in "$@"; do
  curl -fsSL "https://api.github.com/repos/storytold/$app/releases/latest" -o "$tmp/release.json"
  # JXA parses the release JSON without needing jq or Python on a stock Mac.
  asset=$(osascript -l JavaScript -e '
    ObjC.import("Foundation");
    function run(argv) {
      const text = $.NSString.stringWithContentsOfFileEncodingError(argv[0], $.NSUTF8StringEncoding, null).js;
      const a = JSON.parse(text).assets.find((x) => /-macos-universal\.dmg$/.test(x.name));
      return a ? [a.name, a.browser_download_url, (a.digest || "").replace(/^sha256:/, "")].join(" ") : "";
    }' "$tmp/release.json")
  if [ -z "$asset" ]; then
    echo "$app: the latest release has no macOS installer." >&2
    exit 1
  fi
  read -r name url digest <<EOF
$asset
EOF

  echo "Downloading $name"
  curl -fL --progress-bar "$url" -o "$tmp/$name"
  if [ -z "$digest" ]; then
    echo "$app: the release publishes no checksum for $name, so it was not installed." >&2
    exit 1
  fi
  echo "$digest  $tmp/$name" | shasum -a 256 -c - >/dev/null || {
    echo "$app: checksum mismatch for $name, so it was not installed." >&2
    exit 1
  }

  hdiutil attach -quiet -nobrowse -readonly -mountpoint "$tmp/mnt" "$tmp/$name"
  bundle=$(find "$tmp/mnt" -maxdepth 1 -name '*.app' | head -n 1)
  if [ -z "$bundle" ]; then
    echo "$app: no app found inside $name." >&2
    exit 1
  fi
  target="$dest/$(basename "$bundle")"
  rm -rf "$target"
  ditto "$bundle" "$target"
  hdiutil detach -quiet "$tmp/mnt"
  rm -f "$tmp/$name"
  echo "Installed $(basename "$bundle") in $dest"
done
