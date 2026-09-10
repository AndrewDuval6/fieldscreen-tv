# FieldScreen TV

<img src="public/images/fieldscreen-mark.png" alt="FieldScreen TV — a penguin with a football chest and screen-shaped wings" width="180">

*Your gameday, on every screen.*

[**Website & install instructions — fieldscreentv.org**](https://fieldscreentv.org)

A television-first NFL control room for game day. Field positions, a featured game, and configurable video/data panes in one 16:9 screen.

**Development preview · v0.1.0-preview.5.** ESPN scores, schedules, all 32 teams, division standings, game details, and team statistics are connected. nflverse adds advanced season statistics. IPTV playback and XMLTV guide matching are included. Wireless casting is still planned.

## Steam Deck is the TV console

The Steam Deck runs the same TV experience as a living-room PC: full screen, large-screen composition, and Xbox controller navigation. There is no separate handheld layout. On a 16:10 screen the 16:9 composition is letterboxed, preserving the TV layout.

The intended setup is Steam Deck connected to the TV, an Xbox controller, and a Steam library shortcut. Apple TV and Android TV are planned platforms; this release runs on Linux only. Physical Steam Deck, Xbox controller, and Apple TV testing is still pending.

## Download and launch

Linux preview builds are packaged as an **x64 AppImage**, plus a portable `.tar.gz` alternative. They bundle the runtime, fonts, icons, and preview artwork; Node.js and a development server are not needed to run a packaged download.

[**Download the Linux preview**](https://github.com/AndrewDuval6/fieldscreen-tv/releases/tag/v0.1.0-preview.5)

Choose `FieldScreen-TV-0.1.0-preview.5-Linux-x86_64.AppImage`, or the portable `.tar.gz` alternative.

To launch on Steam Deck:

1. On Steam Deck, switch to Desktop Mode and download the `.AppImage` from Releases.
2. Move it into an `Applications` folder in your Home directory. In its file properties, allow it to run as a program.
3. In Steam, choose **Add a Non-Steam Game**, browse to that AppImage, and add it.
4. Return to Gaming Mode, connect your TV and Xbox controller, and launch the app. Use a standard Gamepad controller layout; this is a native Linux app and does not use Proton.

Valve documents adding apps to the Deck library in its [Desktop Mode FAQ](https://help.steampowered.com/en/faqs/view/671A-4453-E8D2-323C).

If AppImage mounting is unavailable on a Linux installation, extract the `.tar.gz` download and add its `fieldscreen-tv` executable to Steam instead.

The AppImage opens full screen for TV use. The installer’s desktop shortcut opens in a window; you can also pass `--windowed` when launching from a terminal. **F11** or the on-screen **Window / Fullscreen** button switches between the two. **Exit** closes it. Display sleep is inhibited only while the desktop app is running.

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
| Right stick | Scroll schedules, statistics, scoreboards, or the guide |
| Menu | Refresh NFL scores in Director |

Standard-mapped controllers use the browser Gamepad API. Mouse and keyboard controls also work. Automated tests cover navigation, provider import, stream proxying, guide matching, credential-storage policy, and player reuse; hardware compatibility is not yet verified. Entering provider details may need a keyboard or Steam’s on-screen keyboard.

## Install from a terminal

Clone the repo and run its installer. It downloads the packaged Linux app from GitHub, checks SHA256SUMS, and adds an application-menu shortcut. No Node.js, source build, or administrator access is needed. Git and curl must be available.

```bash
git clone https://github.com/AndrewDuval6/fieldscreen-tv.git &&
cd fieldscreen-tv &&
./install.sh
```

The installed AppImage has a stable path at `~/Applications/FieldScreen-TV.AppImage`. The desktop shortcut opens windowed; adding the AppImage itself to Steam opens the TV experience full screen. Use `./install.sh --no-launch` to install without opening it. Close the running app before updating; from the cloned folder, run `git pull --ff-only && ./install.sh`.

## Connect IPTV and find games

1. Choose **Connect IPTV** in the top bar.
2. Enter an **Xtream** provider address, username, and password, or choose **M3U playlist** and paste its URL/import a file.
3. Add your **XMLTV guide URL** if needed. Xtream guides and guide URLs embedded in M3U headers are detected automatically.
4. Search for a team, matchup, or channel. Filter by group, **Football**, **RedZone**, or **On now**.
5. Choose a destination screen, then **Watch** on a channel. Assign additional screens, then open **Watch wall**.

**Refresh channels** reloads your M3U URL or Xtream lineup using the current connection, including session-only connections. It updates channel names and groups, adds new channels, removes missing ones, and shows the last successful update time. Channels whose stream URLs stay the same keep playing; removed or changed streams return their panes to the dashboard. A failed refresh keeps the previous lineup. For an imported M3U file, the button asks you to select an updated file; a local file cannot retrieve provider changes by itself. Remembered file imports update their encrypted saved copy.

The guide joins XMLTV programme channel IDs to the playlist's `tvg-id` (or Xtream `epg_channel_id`). XML and compressed feeds are detected from their contents, including short provider links without a file extension. **Your games** automatically ranks live and upcoming NFL coverage across the whole lineup. **Watch game** selects a current guide listing that names both teams; **Check coverage** shows alternatives when only a team, channel name, or scheduled network matches. Network suggestions are marked as unconfirmed. Matching uses text and kickoff times, not video recognition.

**All channels** searches the entire lineup and the next 48 hours of guide listings. **Ctrl+F** focuses this search. Lineups of up to 500 channels appear in one scrollable list; larger lineups are filtered before pagination. **Update TV guide** lets you replace only the guide link while keeping channels connected. Guide refresh runs every 15 minutes and after channel refresh. Download failures keep the last available listings, report the reason, and honor a retry delay.

M3U/XMLTV files can contain account credentials. Enter them only in the app. They are held in the local service for the current session. The packaged Linux app can optionally remember a provider using an available OS keyring; it refuses insecure plaintext fallback. Browser development sessions do not save provider credentials. **Disconnect & forget** stops playback and removes the saved provider. The app does not send account information to GitHub or an app-operated service; it contacts the provider and the stream/guide servers supplied by that provider.

Standard HTTP HLS and MPEG-TS playback are included, plus browser-compatible MP4/WebM links. Video/audio codecs must be supported by the bundled browser; H.264/AAC is the most broadly compatible combination. DRM-protected streams, UDP/RTSP, proprietary headers, and provider-specific authentication beyond the supplied URL/login are not implemented. A public **Try sample video** option checks a Mux-hosted Big Buck Bunny stream; it is not an NFL broadcast.

Each visible video pane uses a provider connection. Four games normally require four allowed connections and sufficient bandwidth/decoding performance. Moving a game to the main pane preserves its player. Changing to a smaller layout stops hidden streams; selecting another view or disconnecting stops the watch-wall players. Only one video is audible. NFL scorecards, the league scoreboard, and standings remain available alongside live video.

## NFL data

The dashboard starts on the current NFL week. **Game Day** automatically focuses live games, prioritizing red-zone possessions and close fourth quarters; before kickoff, it features the next scheduled game. You can pin any matchup and page through the field wall. Scheduled games show kickoff time and no invented score. Field markers appear only when ESPN reports a recognizable possession and position, with offense moving left to right.

**Schedule** selects a season, stage, and week. **Game details** includes quarter scores, team statistics, recent/scoring plays, and player leaders when published. **Standings** covers all eight divisions. **Team Lab** offers all 32 teams, season/category selection, and advanced nflverse statistics. Before the first game, Team Lab defaults to the previous season; each statistics panel identifies its season.

Scores and open game details refresh every 30 seconds while the page is visible. Standings refresh every 10 minutes; team statistics are cached for 30 minutes and nflverse season totals for six hours. Failed requests retain the last successful response and label it **CACHED** with its original timestamp. Data can lag the broadcast. Postponements, missing statistics, and unpublished seasons are shown as unavailable rather than filled with sample numbers.

Sources:

- [ESPN scoreboard](https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard), [teams](https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams), and [standings](https://site.api.espn.com/apis/v2/sports/football/nfl/standings?level=3), plus ESPN game summaries and team statistics. These publicly reachable endpoints currently require no API key but are undocumented and unsupported for this app. Availability and response formats can change; access is not a production service guarantee or a redistribution license.
- [nflverse data](https://github.com/nflverse/nflverse-data), used under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). FieldScreen selects, normalizes, and rounds team regular-season statistics for display. Consult the [update schedule](https://nflreadr.nflverse.com/articles/nflverse_data_schedule.html): advanced statistics are published after games, not a live feed. A new season file may not yet exist.

The installed app retrieves and caches data locally. IPTV guide contents and provider credentials are never sent to ESPN or nflverse. NFL data access does not include a video broadcast; streams come from the provider you connect.

## Included in the preview

- Sunday Director with real NFL data, automatic focus, manual pinning, and a paged field wall.
- Detailed proportioned fields with home-team end zones, yard numbers, NFL hash marks, and reported possession markers.
- Schedules, eight-division standings, game details, and all 32 teams with historical season statistics.
- nflverse advanced metrics, including EPA, CPOE, air yards, sacks, and QB hits where published.
- Full-screen, split, four-pane, and one-plus-three layouts mixing IPTV and NFL data.
- M3U URL/file import, Xtream login, XMLTV matching, team/channel search, and now/next listings.
- Matchup-to-guide broadcast discovery and real single-pane audio focus.
- Stadium and Night themes, branded connection loaders, and reduced-motion support.

## Still to build

Saved layouts, casting, additional TV platforms, and hardware verification. The Yahoo fantasy companion remains a separate project.

Do not add IPTV credentials, playlist URLs containing credentials, or API secrets to the source or GitHub issues. Use the private in-app setup for credentials. Your actual provider and physical Steam Deck/TV playback have not yet been verified.

## Development

Requires Node.js 24 or later and npm.

```sh
npm ci
npm test
npm run desktop
```

For the browser version, run `npm run dev -- --host 127.0.0.1`. For a Linux download, run `npm run package:linux`. Built packages appear in `release/`. See [preview security scope](SECURITY.md) before using the browser development entry.

`design/tv-preview.html` preserves the approved visual study. `scripts/build-preview.mjs` produces its TV application and bundles the local NFL data and IPTV services. `desktop/` provides the sandboxed Electron shell. `app/` retains the React/Vinext entry point for the full dashboard implementation. The Linux workflow checks the browser build and packages the desktop preview.

## Artwork and dependencies

The penguin/football emblem and stadium backdrop are original generated artwork. The backdrop is not a photograph of a live game. The logo was created with the built-in image generator; its [prompt](design/logo-prompt.txt) is included for provenance. Field diagrams use reported NFL positions; they are schematic views, not player-tracking data. Fonts are distributed under the licenses included with their packages. Icons come from Lucide. Video playback uses [hls.js](https://github.com/video-dev/hls.js) and [mpegts.js](https://github.com/xqq/mpegts.js); XMLTV parsing uses [saxes](https://github.com/lddubeau/saxes). Their licenses are included in the package. Third-party dependencies retain their respective licenses. This is an independent fan project, not an official NFL or Yahoo product.

The source is published for inspection and download. An open-source license for the project has not been selected; third-party licenses still apply.
