# FieldScreen TV

<img src="public/images/fieldscreen-mark.png" alt="FieldScreen TV — a penguin with a football chest and screen-shaped wings" width="180">

*Your gameday, on every screen.*

A television-first NFL control room for game day. Field positions, a featured game, and configurable video/data panes in one 16:9 screen.

**Development preview · v0.1.0-preview.1.** Scores and events are simulated. IPTV playback and XMLTV guide browsing are included. Live NFL scores/statistics and wireless casting are not connected in this version.

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
| B | Close the provider/guide panel or introduction; return focus to the view switch |
| X | Select a pane's audio; pin the featured game in Director |
| Y | Change multiview layout; toggle automatic focus in Director |
| LB / RB | Director / Multiview |
| Menu | Play / pause the Sunday simulation in Director |

Standard-mapped controllers use the browser Gamepad API. Mouse and keyboard controls also work. Automated tests cover navigation, provider import, stream proxying, guide matching, credential-storage policy, and player reuse; hardware compatibility is not yet verified. Entering provider details may need a keyboard or Steam’s on-screen keyboard.

## Connect IPTV and find games

1. Choose **Connect IPTV** in the top bar.
2. Enter an **Xtream** provider address, username, and password, or choose **M3U playlist** and paste its URL/import a file.
3. Add your **XMLTV guide URL** if needed. Xtream guides and guide URLs embedded in M3U headers are detected automatically.
4. Search for a team, matchup, or channel. Filter by group, **Football**, **RedZone**, or **On now**.
5. Choose a destination screen, then **Watch** on a channel. Assign additional screens, then open **Watch wall**.

The guide joins XMLTV programme channel IDs to the playlist's `tvg-id` (or Xtream `epg_channel_id`). It shows current and upcoming listings, local start times, and searchable descriptions from the next 48 hours. Guide refresh runs every 15 minutes while connected; **Refresh guide** refreshes immediately. Football discovery is a name/description filter, not video recognition or an official sports feed. A scheduled programme does not guarantee that a channel is currently carrying the game. Without guide data, channels remain searchable by name and group.

M3U/XMLTV files can contain account credentials. Enter them only in the app. They are held in the local service for the current session. The packaged Linux app can optionally remember a provider using an available OS keyring; it refuses insecure plaintext fallback. Browser development sessions do not save provider credentials. **Disconnect & forget** stops playback and removes the saved provider. The app does not send account information to GitHub or an app-operated service; it contacts the provider and the stream/guide servers supplied by that provider.

Standard HTTP HLS and MPEG-TS playback are included, plus browser-compatible MP4/WebM links. Video/audio codecs must be supported by the bundled browser; H.264/AAC is the most broadly compatible combination. DRM-protected streams, UDP/RTSP, proprietary headers, and provider-specific authentication beyond the supplied URL/login are not implemented. A public **Try sample video** option checks a Mux-hosted Big Buck Bunny stream; it is not an NFL broadcast.

Each visible video pane uses a provider connection. Four games normally require four allowed connections and sufficient bandwidth/decoding performance. Moving a game to the main pane preserves its player. Changing to a smaller layout stops hidden streams; selecting another view or disconnecting stops the watch-wall players. Only one video is audible. Sample data panes remain available alongside live video.

## Included in the preview

- Sunday Director: six sample games, event progression, automatic selection, and manual pinning.
- Detailed proportioned fields with home-team end zones, yard numbers, NFL hash marks, and sample possession markers.
- Full-screen, split, four-pane, and one-plus-three layouts.
- Assign IPTV channels (including your provider’s RedZone), sample games, scores, or standings to panes.
- M3U URL/file import, Xtream login, XMLTV EPG matching, team/channel search, and now/next listings.
- Real single-pane audio focus; information-only panes do not receive audio focus.
- Stadium and Night themes, loading previews, and reduced-motion support.

## Still to build

Live scores, all 32 teams, schedules, standings, team and game statistics, saved layouts, casting, and hardware verification. The Yahoo fantasy companion remains a separate project.

Do not add IPTV credentials, playlist URLs containing credentials, or API secrets to the source or GitHub issues. Use the private in-app setup for credentials. Your actual provider and physical Steam Deck/TV playback have not yet been verified.

## Development

Requires Node.js 24 or later and npm.

```sh
npm ci
npm test
npm run desktop
```

For the browser version, run `npm run dev -- --host 127.0.0.1`. For a Linux download, run `npm run package:linux`. Built packages appear in `release/`. See [preview security scope](SECURITY.md) before using the browser development entry.

`design/tv-preview.html` preserves the approved visual study. `scripts/build-preview.mjs` produces its TV application and bundles the local IPTV service. `desktop/` provides the sandboxed Electron shell. `app/` retains the React/Vinext entry point for the full dashboard implementation. The Linux workflow checks the browser build and packages the desktop preview.

## Artwork and dependencies

The penguin/football emblem and stadium backdrop are original generated artwork. The backdrop is not a photograph of a live game. The logo was created with the built-in image generator; its [prompt](design/logo-prompt.txt) is included for provenance. Field diagrams use simulated data. Fonts are distributed under the licenses included with their packages. Icons come from Lucide. Video playback uses [hls.js](https://github.com/video-dev/hls.js) and [mpegts.js](https://github.com/xqq/mpegts.js); XMLTV parsing uses [saxes](https://github.com/lddubeau/saxes). Their licenses are included in the package. Third-party dependencies retain their respective licenses. This is an independent fan project, not an official NFL or Yahoo product.

The source is published for inspection and download. An open-source license for the project has not been selected; third-party licenses still apply.
