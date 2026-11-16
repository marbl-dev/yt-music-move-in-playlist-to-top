// Adds "Move to top" to (1) each song's ⋮ menu and (2) the multi-select toolbar
// on playlists you can edit.
(() => {
  const { innertube, moveToTop } = window.__ytmMoveToTop;

  const LABELS = {
    en: {
      move: 'Move to top', moving: 'Moving to top…', done: (n) => (n === 1 ? 'Moved to top' : `Moved ${n} songs to top`), fail: 'Could not move: ',
      jump: 'Jump to playing song', loading: 'Loading playlist…', notHere: "The playing song isn't in this playlist",
    },
    de: {
      move: 'An den Anfang verschieben', moving: 'Wird verschoben…', done: (n) => (n === 1 ? 'An den Anfang verschoben' : `${n} Songs an den Anfang verschoben`), fail: 'Verschieben fehlgeschlagen: ',
      jump: 'Zum laufenden Song springen', loading: 'Playlist wird geladen…', notHere: 'Der laufende Song ist nicht in dieser Playlist',
    },
  };
  const L = LABELS[(document.documentElement.lang || 'en').slice(0, 2)] || LABELS.en;

  // The page enforces Trusted Types, so build nodes instead of using innerHTML.
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const ICON_TOP = 'M4 3h16v2H4V3Zm8 4 6 6-1.41 1.41L13 10.83V21h-2V10.83l-3.59 3.58L6 13l6-6Z';
  const ICON_LOCATE = 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm8.94 3A8.99 8.99 0 0 0 13 3.06V1h-2v2.06A8.99 8.99 0 0 0 3.06 11H1v2h2.06A8.99 8.99 0 0 0 11 20.94V23h2v-2.06A8.99 8.99 0 0 0 20.94 13H23v-2h-2.06ZM12 19a7 7 0 1 1 0-14 7 7 0 0 1 0 14Z';
  function icon(d = ICON_TOP) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '24');
    svg.setAttribute('height', '24');
    svg.setAttribute('fill', 'currentColor');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
    return svg;
  }

  function span(className, child) {
    const s = document.createElement('span');
    s.className = className;
    if (typeof child === 'string') s.textContent = child;
    else s.appendChild(child);
    return s;
  }

  let busy = false;

  // ---------- helpers ----------

  function shelf() {
    return document.querySelector('ytmusic-playlist-shelf-renderer');
  }

  function rows() {
    const s = shelf();
    return s ? [...s.querySelectorAll('#contents > ytmusic-responsive-list-item-renderer')] : [];
  }

  function setVideoIdOf(row) {
    return row?.data?.playlistItemData?.playlistSetVideoId || null;
  }

  function currentPlaylistId() {
    return shelf()?.data?.playlistId || new URLSearchParams(location.search).get('list');
  }

  function isEditablePlaylist() {
    return location.pathname === '/playlist' && !!shelf()?.data?.contentsReorderable;
  }

  function findFirst(obj, pred) {
    if (!obj || typeof obj !== 'object') return null;
    if (pred(obj)) return obj;
    for (const v of Object.values(obj)) {
      const hit = findFirst(v, pred);
      if (hit) return hit;
    }
    return null;
  }

  // Ask the server which item is really at position 1 (the page may be showing a sorted view).
  async function fetchFirstSetVideoId(playlistId) {
    const res = await innertube('browse', { browseId: 'VL' + playlistId });
    const hit = findFirst(res, (o) => o.playlistItemData && o.playlistItemData.playlistSetVideoId);
    if (!hit) throw new Error('Playlist is empty or could not be read.');
    return hit.playlistItemData.playlistSetVideoId;
  }

  function toast(text, isError) {
    let el = document.getElementById('ytm-mtt-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'ytm-mtt-toast';
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.classList.toggle('ytm-mtt-error', !!isError);
    el.classList.add('ytm-mtt-show');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('ytm-mtt-show'), isError ? 6000 : 3000);
  }

  // Mirror the server-side move in the rendered list so no reload is needed.
  function reorderDom(setVideoIds, serverFirst) {
    const s = shelf();
    const container = s?.querySelector('#contents');
    const all = rows();
    if (!container || !all.length) return false;
    // Only safe when the page shows the playlist in its real (manual) order.
    if (setVideoIdOf(all[0]) !== serverFirst) return false;

    const byId = new Map(all.map((r) => [setVideoIdOf(r), r]));
    const moving = setVideoIds.map((id) => byId.get(id)).filter(Boolean);
    if (moving.length !== setVideoIds.length) return false;

    const anchor = container.firstElementChild;
    for (const row of moving) container.insertBefore(row, anchor);

    // Keep the shelf's backing data in the same order.
    const contents = s.data?.contents;
    if (Array.isArray(contents)) {
      const idOf = (c) => c?.musicResponsiveListItemRenderer?.playlistItemData?.playlistSetVideoId;
      const order = new Map(setVideoIds.map((id, i) => [id, i]));
      const front = contents.filter((c) => order.has(idOf(c))).sort((a, b) => order.get(idOf(a)) - order.get(idOf(b)));
      const rest = contents.filter((c) => !order.has(idOf(c)));
      contents.splice(0, contents.length, ...front, ...rest);
    }
    return true;
  }

  // YouTube's read API lags a few seconds behind writes, so right after one of our
  // moves it can still report the old first song. Remember what we put on top.
  const RECENT_MS = 2 * 60 * 1000;
  const recentFirst = new Map(); // playlistId -> { id, at }

  async function resolveFirst(playlistId) {
    const recent = recentFirst.get(playlistId);
    if (recent && Date.now() - recent.at < RECENT_MS) {
      // Trust it unless the page shows a different first song (e.g. you dragged one up since).
      const domFirst = currentPlaylistId() === playlistId ? setVideoIdOf(rows()[0]) : null;
      if (!domFirst || domFirst === recent.id) return recent.id;
    }
    return fetchFirstSetVideoId(playlistId);
  }

  async function runMove(setVideoIds, playlistId) {
    if (busy || !setVideoIds.length) return false;
    busy = true;
    toast(L.moving);
    try {
      const first = await resolveFirst(playlistId);
      await moveToTop(playlistId, setVideoIds, first);
      recentFirst.set(playlistId, { id: setVideoIds[0], at: Date.now() });
      const synced = reorderDom(setVideoIds, first);
      toast(L.done(setVideoIds.length) + (synced ? '' : ' ↻'));
      if (synced) window.scrollTo({ top: 0, behavior: 'smooth' });
      return true;
    } catch (err) {
      console.error('[YTM Move to top]', err);
      toast(L.fail + (err && err.message ? err.message : err), true);
      return false;
    } finally {
      busy = false;
    }
  }

  // ---------- (1) single song: item in the ⋮ popup menu ----------

  function closePopup() {
    const dd = document.querySelector('ytmusic-popup-container tp-yt-iron-dropdown');
    if (dd && typeof dd.close === 'function') dd.close();
  }

  function syncPopupItem() {
    const dd = document.querySelector('ytmusic-popup-container tp-yt-iron-dropdown');
    const popup = dd?.querySelector('ytmusic-menu-popup-renderer');
    const list = popup?.querySelector('tp-yt-paper-listbox#items');
    if (!list) return;
    const existing = list.querySelector(':scope > .ytm-mtt-item');

    // The native "Remove from playlist" entry tells us this is an editable playlist row,
    // and carries both the playlist id and the row's setVideoId.
    const removeItem = dd.opened
      ? [...list.children].find((el) => {
          const a = el.data?.serviceEndpoint?.playlistEditEndpoint?.actions?.[0];
          return a && a.action === 'ACTION_REMOVE_VIDEO' && a.setVideoId;
        })
      : null;

    if (!removeItem) {
      existing?.remove();
      return;
    }
    const ep = removeItem.data.serviceEndpoint.playlistEditEndpoint;
    const setVideoId = ep.actions[0].setVideoId;
    if (existing && existing.dataset.setVideoId === setVideoId && existing.nextElementSibling === removeItem) return;
    existing?.remove();

    const item = document.createElement('div');
    item.className = 'ytm-mtt-item';
    item.setAttribute('role', 'menuitem');
    item.tabIndex = -1;
    item.dataset.setVideoId = setVideoId;
    item.dataset.playlistId = ep.playlistId;
    item.append(span('ytm-mtt-icon', icon()), span('ytm-mtt-text', L.move));
    item.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      closePopup();
      runMove([item.dataset.setVideoId], item.dataset.playlistId);
    });
    list.insertBefore(item, removeItem);
  }

  // ---------- (2) multi-select: button in the selection toolbar ----------

  function selectedSetVideoIds() {
    return rows()
      .filter((r) => r.hasAttribute('is-checked'))
      .map(setVideoIdOf)
      .filter(Boolean);
  }

  function clearSelection(bar) {
    bar.querySelector('yt-icon-button.menu-bar-icon button')?.click();
  }

  function syncMultiSelectButton() {
    const bar = document.querySelector('ytmusic-multi-select-menu-bar');
    if (!bar) return;
    let btn = bar.querySelector('.ytm-mtt-bar-btn');
    if (!isEditablePlaylist()) {
      btn?.remove();
      return;
    }
    if (btn) return;

    btn = document.createElement('button');
    btn.className = 'ytm-mtt-bar-btn';
    btn.type = 'button';
    btn.title = L.move;
    btn.setAttribute('aria-label', L.move);
    btn.appendChild(icon());
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const ids = selectedSetVideoIds();
      if (!ids.length) return;
      const ok = await runMove(ids, currentPlaylistId());
      if (ok) clearSelection(bar);
    });
    // Put it in front of the toolbar's own action buttons.
    const actions = bar.querySelector('ytmusic-menu-renderer')?.parentElement;
    if (actions) actions.insertBefore(btn, actions.firstChild);
    else bar.appendChild(btn);
    bar.closest('ytmusic-dialog')?.refit?.();
  }

  // ---------- (3) jump to the song that's playing ----------

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // What's playing, as far as the player and queue know. Songs started from a playlist
  // carry that playlist's id and the row's setVideoId.
  function nowPlaying() {
    const ui = document.querySelector('ytmusic-app-layout')?.getAttribute('player-ui-state');
    if (!ui || ui === 'INACTIVE') return null;
    const we = document.querySelector('ytmusic-player-queue-item[selected]')?.data?.navigationEndpoint?.watchEndpoint;
    const playerId = document.querySelector('#movie_player')?.getVideoData?.()?.video_id;
    // Both ids count: the player's differs from the queue's when you switch between song and video.
    const videoIds = new Set([playerId, we?.videoId].filter(Boolean));
    if (!videoIds.size) return null;
    return { videoIds, setVideoId: we?.playlistSetVideoId || null, playlistId: we?.playlistId || null };
  }

  const videoIdOf = (row) => row?.data?.playlistItemData?.videoId || null;

  // Match on the song itself. Generated playlists (mixes, "New music" and the like) get
  // reshuffled whenever the page is reopened, and their setVideoIds follow the position,
  // not the song, so a setVideoId alone can point at a different song. It's only used
  // to pick between copies when a song is in the list more than once.
  function playingRow(np) {
    const same = rows().filter((r) => np.videoIds.has(videoIdOf(r)));
    if (same.length <= 1) return same[0] || null;
    return (
      same.find((r) => setVideoIdOf(r) === np.setVideoId) ||
      same.find((r) => /^(playing|paused)$/.test(r.getAttribute('play-button-state') || '')) ||
      same[0]
    );
  }

  // Long playlists render in pages of 100. Ask for the next page, as scrolling to the end would.
  async function loadMoreRows() {
    const cont = shelf()?.querySelector('#contents > ytmusic-continuation-item-renderer');
    if (!cont) return false;
    const before = rows().length;
    if (typeof cont.onPrescanVisible === 'function') {
      try { cont.onPrescanVisible(); } catch { cont.scrollIntoView({ block: 'end' }); }
    } else {
      cont.scrollIntoView({ block: 'end' });
    }
    for (let t = 0; t < 10000; t += 150) {
      await sleep(150);
      if (rows().length > before) return true;
    }
    return false;
  }

  const MAX_ROWS = 5000; // YouTube's own playlist size limit
  let jumping = false;
  async function jumpToPlaying() {
    if (jumping) return;
    const np = nowPlaying();
    if (!np) return;
    jumping = true;
    try {
      let row = playingRow(np);
      // Only page through the playlist when the song was started from it.
      if (!row && np.playlistId && np.playlistId === currentPlaylistId()) {
        toast(L.loading);
        while (!row && rows().length < MAX_ROWS && (await loadMoreRows())) row = playingRow(np);
      }
      if (!row) {
        toast(L.notHere, true);
        return;
      }
      document.getElementById('ytm-mtt-toast')?.classList.remove('ytm-mtt-show');
      row.scrollIntoView({ block: 'center', behavior: 'smooth' });
      row.classList.remove('ytm-mtt-flash');
      void row.offsetWidth; // restart the animation
      row.classList.add('ytm-mtt-flash');
      setTimeout(() => row.classList.remove('ytm-mtt-flash'), 2000);
    } finally {
      jumping = false;
    }
  }

  function syncJumpButton() {
    let btn = document.getElementById('ytm-mtt-jump');
    const np = location.pathname === '/playlist' && shelf() ? nowPlaying() : null;
    const ui = document.querySelector('ytmusic-app-layout')?.getAttribute('player-ui-state');
    const show =
      !!np &&
      ui !== 'PLAYER_PAGE_OPEN' &&
      ui !== 'FULLSCREEN' &&
      (np.playlistId === currentPlaylistId() || rows().some((r) => np.videoIds.has(videoIdOf(r))));
    if (!show) {
      btn?.remove();
      return;
    }
    if (btn) return;
    btn = document.createElement('button');
    btn.id = 'ytm-mtt-jump';
    btn.type = 'button';
    btn.title = L.jump;
    btn.setAttribute('aria-label', L.jump);
    btn.appendChild(icon(ICON_LOCATE));
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      jumpToPlaying();
    });
    document.body.appendChild(btn);
  }

  // ---------- wiring ----------

  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      syncPopupItem();
      syncMultiSelectButton();
      syncJumpButton();
    });
  }

  new MutationObserver(schedule).observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['aria-hidden', 'style', 'is-checked', 'play-button-state', 'player-ui-state', 'selected'],
  });
  schedule();
})();
