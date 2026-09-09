# Preview security scope

The packaged desktop preview runs a local, static interface inside sandboxed Electron. It has no live data requests, media playback, credential storage, or remote content. The renderer cannot use Node.js, open other windows, or navigate away from the bundled page. The preload bridge exposes only the app's Exit action.

The React/Vinext/Cloudflare browser entry is retained for local development. Those server and build dependencies are not bundled into the desktop application's runtime. A dependency audit on September 9, 2026 reported 11 advisories in that development stack (8 high, 2 moderate, 1 low). Address them before exposing a browser server publicly or adding live services. Keep the development server bound to localhost.

Do not post passwords, IPTV playlists containing credentials, OAuth tokens, or API keys in issues. This preview does not need any of them.
