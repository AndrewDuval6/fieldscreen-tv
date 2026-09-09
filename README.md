# FieldScreen TV

<img src="public/images/fieldscreen-mark.png" alt="FieldScreen TV — a penguin with a football chest and screen-shaped wings" width="180">

*Your gameday, on every screen.*

A television-first NFL control room for game day. Field positions, a featured game, and configurable video/data panes in one 16:9 screen.

**Development preview · v0.1.0-preview.1.** Scores and events are simulated. Live NFL data, IPTV playback, and wireless casting are not connected in this version.

## Steam Deck is the TV console

The Steam Deck runs the same TV experience as a living-room PC: full screen, large-screen composition, and Xbox controller navigation. There is no separate handheld layout. On a 16:10 screen the 16:9 composition is letterboxed, preserving the TV layout.

The intended setup is Steam Deck connected to the TV, an Xbox controller, and a Steam library shortcut. Apple TV and Android TV are planned platforms; this release runs on Linux only. Physical Steam Deck, Xbox controller, and Apple TV testing is still pending.

## Download and launch

Linux preview builds are packaged as an **x64 AppImage**, plus a portable `.tar.gz` alternative. They bundle the runtime, fonts, icons, and preview artwork; Node.js and a development server are not needed to run a packaged download.

[**Download the Linux preview**](https://github.com/AndrewDuval6/fieldscreen-tv/releases/tag/v0.1.0-preview.1)

Choose `FieldScreen-TV-0.1.0-preview.1-Linux-x86_64.AppImage`, or the portable `.tar.gz` alternative.

To launch on Steam Deck:

1. On Steam Deck, switch to Desktop Mode and download the `.AppImage` from Releases.
2. Move it into an `Applications` folder in your Home directory. In its file properties, allow it to run as a program.
3. In Steam, choose **Add a Non-Steam Game**, browse to that AppImage, and add it.
4. Return to Gaming Mode, connect your TV and Xbox controller, and launch the app. Use a standard Gamepad controller layout; this is a native Linux app and does not use Proton.

Valve documents adding apps to the Deck library in its [Desktop Mode FAQ](https://help.steampowered.com/en/faqs/view/671A-4453-E8D2-323C).

If AppImage mounting is unavailable on a Linux installation, extract the `.tar.gz` download and add its `fieldscreen-tv` executable to Steam instead.

The preview opens full screen with a skippable introduction. **F11** toggles the native window's full-screen state. **Exit** closes it. Display sleep is inhibited only while the desktop app is running.

## Controller

| Control | Action |
| --- | --- |
| D-pad / left stick | Move focus between controls |
| A | Activate the focused control; cycle a selected pane's content |
| Left / right on a pane selector | Previous / next content source |
| B | Close the introduction or return focus to the view switch |
| X | Select a pane's audio; pin the featured game in Director |
| Y | Change multiview layout; toggle automatic focus in Director |
| LB / RB | Director / Multiview |
| Menu | Play / pause the Sunday simulation in Director |

Standard-mapped controllers use the browser Gamepad API. Mouse and keyboard controls also work. Automated tests cover navigation and button behavior; hardware compatibility is not yet verified.

## Included in the preview

- Sunday Director: six sample games, event progression, automatic selection, and manual pinning.
- Detailed proportioned fields with home-team end zones, yard numbers, NFL hash marks, and sample possession markers.
- Full-screen, split, four-pane, and one-plus-three layouts.
- Assign example games, RedZone placeholders, scores, or standings to panes.
- One audio-selection state; information-only panes do not receive audio focus.
- Stadium and Night themes, loading previews, and reduced-motion support.

## Still to build

Live scores, all 32 teams, schedules, standings, team and game statistics, saved layouts, private IPTV setup and real playback, casting, and hardware verification. The Yahoo fantasy companion remains a separate project.

Do not add IPTV credentials, playlist URLs containing credentials, or API secrets to the source or GitHub issues. The preview has no credential-entry feature and makes no live data requests.

## Development

Requires Node.js 24 or later and npm.

```sh
npm ci
npm test
npm run desktop
```

For the browser version, run `npm run dev -- --host 127.0.0.1`. For a Linux download, run `npm run package:linux`. Built packages appear in `release/`. See [preview security scope](SECURITY.md) before using the browser development entry.

`design/tv-preview.html` preserves the approved visual study. `scripts/build-preview.mjs` produces its offline TV application. `desktop/` provides the sandboxed Electron shell. `app/` retains the React/Vinext entry point for the full dashboard implementation. The Linux workflow checks the browser build and packages the desktop preview.

## Artwork and dependencies

The penguin/football emblem and stadium backdrop are original generated artwork. The backdrop is not a photograph of a live game. The logo was created with the built-in image generator; its [prompt](design/logo-prompt.txt) is included for provenance. Field diagrams use simulated data. Fonts are distributed under the licenses included with their packages. Icons come from Lucide. Third-party dependencies retain their respective licenses. This is an independent fan project, not an official NFL or Yahoo product.

The source is published for inspection and download. An open-source license for the project has not been selected; third-party licenses still apply.
