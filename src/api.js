// Thin client for YouTube Music's internal (InnerTube) API.
// Runs in the page's MAIN world so it can read `ytcfg` and reuse the signed-in session cookies.
(() => {
  const ORIGIN = 'https://music.youtube.com';

  function cfg(key) {
    return window.ytcfg && window.ytcfg.get(key);
  }

  function getCookie(name) {
    const m = document.cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
    return m ? decodeURIComponent(m[1]) : null;
  }

  async function sha1Hex(text) {
    const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  // Same auth header the web client builds from the SAPISID cookie.
  async function authHeader() {
    const ts = Math.floor(Date.now() / 1000);
    const parts = [];
    const variants = [
      ['SAPISIDHASH', getCookie('SAPISID') || getCookie('__Secure-3PAPISID')],
      ['SAPISID1PHASH', getCookie('__Secure-1PAPISID')],
      ['SAPISID3PHASH', getCookie('__Secure-3PAPISID')],
    ];
    for (const [label, value] of variants) {
      if (value) parts.push(`${label} ${ts}_${await sha1Hex(`${ts} ${value} ${ORIGIN}`)}`);
    }
    if (!parts.length) throw new Error('Not signed in to YouTube Music (no SAPISID cookie).');
    return parts.join(' ');
  }

  async function innertube(endpoint, body) {
    const key = cfg('INNERTUBE_API_KEY');
    const headers = {
      'Content-Type': 'application/json',
      Authorization: await authHeader(),
      'X-Origin': ORIGIN,
      'X-Goog-AuthUser': String(cfg('SESSION_INDEX') ?? 0),
      'X-Youtube-Client-Name': String(cfg('INNERTUBE_CONTEXT_CLIENT_NAME') ?? 67),
      'X-Youtube-Client-Version': String(cfg('INNERTUBE_CLIENT_VERSION') ?? ''),
    };
    const visitor = cfg('VISITOR_DATA');
    if (visitor) headers['X-Goog-Visitor-Id'] = visitor;
    const delegated = cfg('DELEGATED_SESSION_ID');
    if (delegated) headers['X-Goog-PageId'] = delegated;

    const res = await fetch(`${ORIGIN}/youtubei/v1/${endpoint}?key=${key}&prettyPrint=false`, {
      method: 'POST',
      credentials: 'include',
      headers,
      body: JSON.stringify({ context: cfg('INNERTUBE_CONTEXT'), ...body }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error?.message || `HTTP ${res.status}`);
    return json;
  }

  /**
   * Move `setVideoIds` (in the order given) to the top of the playlist.
   * `firstSetVideoId` is the item currently at position 1.
   *
   * Moves are issued back to front: the last item goes before the current first item,
   * then each earlier item goes before the one we just placed. The result is
   * [ids[0], ids[1], ..., ids[n-1], <rest of playlist>]. This also works when the
   * current first item is part of the selection.
   */
  async function moveToTop(playlistId, setVideoIds, firstSetVideoId) {
    if (!setVideoIds.length) return;
    const actions = [];
    let successor = firstSetVideoId;
    for (let i = setVideoIds.length - 1; i >= 0; i--) {
      const id = setVideoIds[i];
      if (id !== successor) {
        actions.push({ action: 'ACTION_MOVE_VIDEO_BEFORE', setVideoId: id, movedSetVideoIdSuccessor: successor });
      }
      successor = id;
    }
    if (!actions.length) return;
    const res = await innertube('browse/edit_playlist', { playlistId, actions });
    if (res.status && res.status !== 'STATUS_SUCCEEDED') {
      throw new Error(`YouTube Music returned ${res.status}`);
    }
    return res;
  }

  window.__ytmMoveToTop = { innertube, moveToTop };
})();
