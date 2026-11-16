# YT Music: Move to Top

A small Chrome/Edge extension that adds **Move to top** to your YouTube Music playlists:

- **One song:** open the song's ⋮ menu → **Move to top** (German UI: *An den Anfang verschieben*).
- **Several songs:** tick the checkboxes on the right of the rows, then click the ⤒ button in the selection bar at the bottom. The songs go to the top in the order they had in the playlist.

The list updates in place. There's no page reload, so playback keeps going.

It also adds a **Jump to playing song** button (⌖, bottom right, above the player bar). It shows up on a playlist page while a song from that playlist is playing. Click it to scroll to the song's row, which briefly lights up. In long playlists it loads further pages first if the song isn't loaded yet. This works on any playlist, not just ones you can edit.

## Install (unpacked)

1. Open `chrome://extensions` (or `edge://extensions`).
2. Turn on **Developer mode**.
3. Click **Load unpacked** and select this folder (the one containing `manifest.json`).
4. Reload any open music.youtube.com tab.

The icon is drawn by `scripts/make-icons.mjs` (no dependencies). To change it, edit the colours or shapes at the top of that script and run `node scripts/make-icons.mjs`.

After editing the code, click the extension's reload icon on the extensions page and refresh the YouTube Music tab.

## How it works

- `src/content.js` runs in the page itself (MV3 `"world": "MAIN"`) so it can read YouTube Music's own config and the data attached to each playlist row.
- The ⋮ menu entry only appears when the menu has YouTube's own **Remove from playlist** item. That item carries the playlist ID and the row's `setVideoId`, and its presence means you're allowed to edit the playlist.
- `src/api.js` calls the same internal endpoint the web app uses when you drag a song: `POST /youtubei/v1/browse/edit_playlist` with `ACTION_MOVE_VIDEO_BEFORE`. It signs the request with your existing session (the `SAPISIDHASH` header), so no API key or OAuth setup is needed.
- To put songs at the top, it moves them before the song currently in position 1. For a multi-selection, every move goes in a single request.
- The jump button looks up the playing song's video ID in the list. Generated playlists such as mixes and *New music* are reshuffled each time you open them, so it matches on the song, not its position. If a song is in the list twice, it uses the row the play queue recorded (`playlistSetVideoId`).

## Limits

- Only playlists you can edit. *Liked Music*, auto-generated playlists and other people's playlists don't show the option.
- This is YouTube's internal API, not a public one. A YouTube Music update can break it. If a move fails, a red message appears at the bottom left, and the browser console logs details under `[YTM Move to top]`.
- With **Select all**, only songs already loaded on the page are moved. Scroll down first to load the rest of a long playlist.
- If the playlist is shown with a sort applied, the move still happens on YouTube's side. The page just isn't rearranged (the message ends with ↻), so reload to see the new order.
