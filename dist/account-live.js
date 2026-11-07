/* Live Librarium adapter. Catalogue records always come from the API. */
(() => {
  const API = '/api/v1';
  if (localStorage.getItem('librarium-live-migrated') !== '1') {
    ['lib-books-v1', 'lib-series-v1', 'lib-sort-plan-v1', 'lib-agent-queue-v1', 'lib-agent-log-v1'].forEach(key => localStorage.removeItem(key));
    localStorage.setItem('librarium-live-migrated', '1');
  }
  const liveStyle = document.createElement('style');
  liveStyle.textContent = ".brand:after{content:'LIVE'!important;color:#2e5848!important}";
  document.head.appendChild(liveStyle);
  const savedToken = sessionStorage.getItem('librarium-access');
  const state = { token: savedToken && !['undefined', 'null'].includes(savedToken) ? savedToken : '', libraries: [], shelves: new Map(), loaded: false };
  if (!state.token) sessionStorage.removeItem('librarium-access');
  const seriesFilter = document.getElementById('noSeriesFilter');
  seriesFilter.addEventListener('click', () => {
    if (!state.loaded) return;
    const active = seriesFilter.getAttribute('aria-pressed') === 'true';
    seriesFilter.setAttribute('aria-pressed', String(!active));
    if (!active) owner = 'Everyone';
    setView('books');
  });
  const accountAction = document.getElementById('accountAction');
  function updateAccountAction() {
    accountAction.textContent = state.token ? 'Log out' : 'Log in';
    accountAction.disabled = false;
  }
  accountAction.addEventListener('click', () => {
    if (state.token) {
      sessionStorage.removeItem('librarium-access');
      window.location.reload();
      return;
    }
    if (!document.getElementById('liveLogin')) loginScreen();
    document.getElementById('liveIdentifier').focus();
  });
  updateAccountAction();


  async function api(path, options = {}) {
    const headers = { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers };
    if (state.token) headers.Authorization = `Bearer ${state.token}`;
    const response = await fetch(API + path, { ...options, headers });
    if (response.status === 401) {
      sessionStorage.removeItem('librarium-access');
      state.token = '';
      state.loaded = false;
      state.libraries = [];
      if (path !== '/auth/login') loginScreen('Your session expired. Sign in again.');
      throw new Error(path === '/auth/login' ? 'Username or password was not accepted.' : 'Your session expired. Sign in again.');
    }
    if (!response.ok) {
      let message = `Librarium request failed (${response.status})`;
      try { message = (await response.json()).error || message; } catch {}
      throw new Error(message);
    }
    if (response.status === 204) return null;
    let payload;
    try { payload = await response.json(); }
    catch { throw new Error('The server did not return Librarium JSON. Check the /api/v1 proxy.'); }
    // Librarium's respond.JSON wraps every successful result, including login.
    return payload && Object.prototype.hasOwnProperty.call(payload, 'data') ? payload.data : payload;
  }

  function loginScreen(message = '') {
    seriesFilter.hidden = true;
    document.getElementById('seriesReviewLink').hidden = true;
    seriesFilter.setAttribute('aria-pressed','false');
    clearCovers();
    seriesRequest = null;
    liveSeries = [];
    seriesLoading = false;
    updateAccountAction();
    if (modal.open) modal.close();
    books = [];
    state.loaded = false;
    state.libraries = [];
    document.querySelector('.heading > button').disabled = true;
    document.getElementById('owners').innerHTML = '';
    document.getElementById('pageTitle').textContent = 'Connect to your library.';
    document.getElementById('subtitle').textContent = 'Sign in to the live Librarium catalogue. No demo records are used.';
    document.getElementById('content').innerHTML = `<div class="panel" style="max-width:520px;margin:35px auto">
      <div class="eyebrow">Live Librarium</div><h2 style="margin:8px 0 6px">Sign in</h2>
      <p>Credentials are sent only to your own Librarium API. The access token is kept in this browser tab session.</p>
      ${message ? `<p role="alert" style="margin-top:18px;color:#aa4337">${esc(message)}</p>` : ''}
      <form id="liveLogin"><label for="liveIdentifier">Username or email</label><input id="liveIdentifier" name="identifier" autocomplete="username" required>
      <label for="livePassword">Password</label><input id="livePassword" name="password" type="password" autocomplete="current-password" required>
      <div class="actions"><button class="primary">Sign in to live catalogue</button></div></form></div>`;
    document.getElementById('liveLogin').addEventListener('submit', login);
  }

  async function login(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button'); button.disabled = true; button.textContent = 'Signing in…';
    try {
      const data = await api('/auth/login', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(form))) });
      if (typeof data?.access_token !== 'string' || !data.access_token) throw new Error('The login response did not include an access token.');
      state.token = data.access_token; sessionStorage.setItem('librarium-access', state.token);
      updateAccountAction();
      await loadLive();
    } catch (error) { loginScreen(error.message); }
  }

  const authorOf = b => (b.contributors || []).filter(c => !c.role || c.role === 'author').map(c => c.name).join(', ') || 'Unknown author';
  const shelfCode = b => (b.shelves || []).map(s => s.name).find(n => /^[A-I][1-8]$/i.test(n || ''))?.toUpperCase() || null;
  const normaliseBook = (b, lib) => ({
    id: b.id, libraryId: lib.id, title: b.title || 'Untitled', author: authorOf(b), owner: lib.name,
    shelf: shelfCode(b), shelfIds: (b.shelves || []).map(s => s.id), color: '#476451', cover: b.cover_url || '',
    isbn: '', added: Date.parse(b.created_at || '') || Date.now(), raw: b
  });

  async function allBooks(lib) {
    const result = [];
    for (let page = 1; ; page++) {
      const data = await api(`/libraries/${encodeURIComponent(lib.id)}/books?page=${page}&per_page=100`);
      const items = Array.isArray(data) ? data : (data.items || []);
      result.push(...items.map(b => normaliseBook(b, lib)));
      if (!items.length || Array.isArray(data) || (Number.isFinite(data.total) ? result.length >= data.total : items.length < (data.per_page || 100))) break;
    }
    return result;
  }

  async function loadLive() {
    document.getElementById('content').innerHTML = '<div class="emptymsg">Loading the live catalogue…</div>';
    state.libraries = await api('/libraries');
    if (!Array.isArray(state.libraries)) throw new Error('The server returned an invalid library list.');
    const shelfSets = await Promise.all(state.libraries.map(async lib => {
      const data = await api(`/libraries/${lib.id}/shelves`).catch(() => []);
      return [lib.id, Array.isArray(data) ? data : (data.items || [])];
    }));
    state.shelves = new Map(shelfSets);
    books = (await Promise.all(state.libraries.map(allBooks))).flat();
    state.loaded = true;
    seriesFilter.hidden = false;
    document.getElementById('seriesReviewLink').hidden = false;
    document.querySelector('.heading > button').disabled = !state.libraries.length;
    seriesData = [];
    localStorage.removeItem('lib-books-v1'); localStorage.removeItem('lib-series-v1');
    owner = state.libraries.some(l => l.name === owner) ? owner : (state.libraries[0]?.name || 'Everyone');
    render();
    if (!state.libraries.length) document.getElementById('content').innerHTML = '<div class="emptymsg">Signed in successfully. This account has no accessible libraries. Check library membership in Librarium.</div>';
    document.querySelector('.asideFoot').innerHTML = `LIVE CATALOGUE<br>${state.libraries.map(l => esc(l.name)).join(' · ')}<hr style="border:0;border-top:1px solid #d5dbcc;margin:20px 0">${books.length} real books · shared through Librarium`;
    toast(`Loaded ${books.length} books from Librarium`);
  }

  let coverObserver;
  let coverRequests;
  const coverURLs = new Set();

  function clearCovers() {
    coverObserver?.disconnect();
    coverRequests?.abort();
    for (const url of coverURLs) URL.revokeObjectURL(url);
    coverURLs.clear();
  }

  function loadCovers() {
    const token = state.token;
    if (!token) return;
    coverRequests = new AbortController();
    const signal = coverRequests.signal;
    async function loadCover(img) {
      try {
        const path = img.dataset.libraryCover;
        const url = new URL(path, location.origin);
        if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) return;
        const response = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
          redirect: 'error',
          signal,
        });
        if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) return;
        const blob = await response.blob();
        if (signal.aborted || !img.isConnected) return;
        const src = URL.createObjectURL(blob);
        coverURLs.add(src);
        img.src = src;
      } catch {
        // Leave the book's title and author visible when its cover is unavailable.
      }
    }
    const images = document.querySelectorAll('img[data-library-cover]');
    if (typeof IntersectionObserver === 'undefined') {
      images.forEach(loadCover);
      return;
    }
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) {
        observer.unobserve(entry.target);
        loadCover(entry.target);
      }
    }, { rootMargin: '250px' });
    coverObserver = observer;
    images.forEach(img => observer.observe(img));
  }

  let seriesRequest;
  let seriesLoading = false;
  let liveSeries = [];
  let failedSeries = 0;
  const seriesPath = lib => `/libraries/${encodeURIComponent(lib.id)}/series`;
  const officialSeries = 'https://librarium.ad53app.com/series';
  const requireList = result => {
    if (!Array.isArray(result)) throw new Error('Unexpected Librarium response');
    return result;
  };

  function fetchSeries() {
    seriesLoading = true;
    const token = state.token;
    seriesRequest = Promise.allSettled(state.libraries.map(async lib =>
      requireList(await api(seriesPath(lib))).map(entry => ({ entry, lib }))
    )).then(results => {
      if (!token || state.token !== token) return;
      seriesLoading = false;
      failedSeries = results.filter(r => r.status === 'rejected').length;
      liveSeries = results.flatMap(r => r.status === 'fulfilled' ? r.value : [])
        .sort((a, b) => String(a.entry.name).localeCompare(String(b.entry.name)));
      if (view === 'series' && state.loaded) render();
    });
  }

  window.renderSeries = function () {
    document.getElementById('pageTitle').textContent = 'Book series';
    document.getElementById('subtitle').textContent = 'Series saved in your Librarium collections.';
    const panel = document.getElementById('content');
    if (!seriesRequest) {
      panel.innerHTML = '<div class="emptymsg" role="status">Loading series from Librarium…</div>';
      fetchSeries();
      return;
    }
    if (seriesLoading) {
      panel.innerHTML = '<div class="emptymsg" role="status">Loading series from Librarium…</div>';
      return;
    }
    const query = document.getElementById('search').value.trim().toLowerCase();
    const visible = liveSeries.filter(({entry, lib}) =>
      (owner === 'Everyone' || owner === lib.name) &&
      [entry.name, entry.description, lib.name].join(' ').toLowerCase().includes(query)
    );
    panel.innerHTML = `<div class="paneltop"><h2>Saved series</h2><a href="${officialSeries}" target="_blank" rel="noopener">Manage in Librarium</a></div>
      ${failedSeries ? '<p role="status">Some collections’ series could not be loaded. <button id="retrySeries" type="button">Try again</button></p>' : ''}
      <div class="seriesgrid">${visible.map(({entry, lib}, index) => `<button class="seriescard" data-series-index="${index}">
        <div class="eyebrow">${esc(lib.name)}</div><h2>${esc(entry.name || 'Untitled series')}</h2>
        ${entry.book_count == null ? '' : `<p>${esc(String(entry.book_count))} linked books</p>`}
      </button>`).join('')}</div>
      ${!visible.length && !failedSeries ? '<div class="emptymsg">No saved series match this view.</div>' : ''}`;
    panel.querySelector('#retrySeries')?.addEventListener('click', () => { seriesRequest = null; render(); });
    panel.querySelectorAll('[data-series-index]').forEach(button => button.addEventListener('click', () =>
      showLiveSeries(visible[Number(button.dataset.seriesIndex)])));
  };

  function seriesTiles(linked, known, total) {
    const positions = new Map();
    const unnumbered = [];
    for (const book of linked) {
      const position = Number(book.position);
      if (!(position > 0)) { unnumbered.push(book); continue; }
      const group = positions.get(position) || [];
      group.push(book);
      positions.set(position, group);
    }
    const covered = new Set();
    for (const book of linked) {
      const start = Number(book.position), end = Number(book.position_end);
      if (Number.isInteger(start) && start > 0 && end >= start)
        for (let n = start + 1; n <= Math.min(end, start + 1000); n++) covered.add(n);
    }
    for (const volume of known) {
      const position = Number(volume.position);
      if (position > 0 && !positions.has(position) && !covered.has(position))
        positions.set(position, [{ ...volume, held: false }]);
    }
    const numbered = [...positions.keys()].filter(Number.isInteger);
    const last = Math.min(1000, Math.max(Number(total) || 0, 0, ...numbered));
    for (let position = 1; position <= last; position++) {
      if (!positions.has(position) && !covered.has(position))
        positions.set(position, [{ position, held: false }]);
    }
    return [...positions.entries()].sort((a, b) => a[0] - b[0])
      .flatMap(([, entries]) => entries).concat(unnumbered);
  }

  async function showLiveSeries({entry, lib}) {
    show(`<div class="eyebrow">${esc(lib.name)}</div><h2>${esc(entry.name || 'Untitled series')}</h2>
      ${entry.description ? `<p>${esc(entry.description)}</p>` : ''}
      <div id="liveSeriesBooks" class="shelfBooks" aria-live="polite">Loading volumes…</div>
      <div class="actions"><a href="${officialSeries}" target="_blank" rel="noopener">Manage in Librarium</a></div>`);
    const panel = document.getElementById('liveSeriesBooks');
    try {
      const path = `${seriesPath(lib)}/${encodeURIComponent(entry.id)}`;
      const [linked, known] = await Promise.all([
        api(`${path}/books`).then(requireList),
        api(`${path}/volumes`).then(requireList).catch(() => []),
      ]);
      if (!panel.isConnected || !modal.open) return;
      const byID = new Map(books.filter(b => b.libraryId === lib.id).map(b => [b.id, b]));
      const tiles = seriesTiles(linked, known, entry.total_count);
      panel.innerHTML = tiles.length ? `<div class="seriesVolumes">${tiles.map((volume, index) => {
        const book = byID.get(volume.book_id);
        const held = volume.held ?? Boolean(book);
        const number = volume.position > 0
          ? `Vol. ${volume.position}${volume.position_end > volume.position ? `–${volume.position_end}` : ''}`
          : '';
        const title = volume.title || book?.title || '';
        const cover = held ? (volume.cover_url || book?.cover || '') : '';
        const caption = title || number || 'Untitled volume';
        const art = `<div class="seriesVolumeArt ${held ? 'seriesVolumeOwned' : 'seriesVolumeMissing'}">
          <div class="seriesVolumeFallback"><strong>${esc(held ? caption : 'Missing')}</strong>
          ${!held && title ? `<span>${esc(title)}</span>` : ''}</div>
          ${cover ? `<img ${cover.startsWith('/api/') ? `data-library-cover="${esc(cover)}"` : `src="${esc(cover)}" loading="lazy"`}
            alt="${esc(caption)} cover" onload="this.parentElement.classList.add('has-cover-image')"
            onerror="this.parentElement.classList.remove('has-cover-image');this.remove()">` : ''}</div>`;
        return `<div class="seriesVolumeTile">${held && book
          ? `<button type="button" class="seriesVolumeButton" data-series-book="${index}" aria-label="View ${esc(caption)}">${art}</button>`
          : art}
          ${number ? `<small>${esc(number)}</small>` : ''}`
          + `${held && title ? `<span class="seriesVolumeTitle">${esc(title)}</span>` : ''}</div>`;
      }).join('')}</div>` : '<p>No volumes are listed for this series yet.</p>';
      panel.querySelectorAll('[data-series-book]').forEach(button => button.addEventListener('click', () =>
        openBook(tiles[Number(button.dataset.seriesBook)].book_id)));
      clearCovers();
      loadCovers();
    } catch {
      panel.textContent = 'Volumes could not be loaded. Try opening this series again.';
    }
  }

  const baseRender = window.render;
  window.render = function () {
    if (!state.loaded) { loginScreen(); return; }
    clearCovers();
    baseRender();
    loadCovers();
    // The prototype interpolated numeric IDs into inline handlers. Live IDs
    // are UUID strings. Repair generated links, including local-agent cards.
    document.querySelectorAll('[onclick], [onkeydown]').forEach(element => {
      for (const attribute of ['onclick', 'onkeydown']) {
        const handler = element.getAttribute(attribute);
        if (handler) element.setAttribute(attribute, handler.replace(/openBook\(([a-f0-9-]{36})\)/gi, (_, id) => `openBook(${JSON.stringify(id)})`));
      }
    });
    if (!state.libraries.length) return;
    const choices = [...state.libraries.map(l => l.name), 'Everyone'];
    document.getElementById('owners').innerHTML = choices.map((name, index) => `<button data-library-choice="${index}" class="${owner === name ? 'active' : ''}">${name === 'Everyone' ? 'Everyone' : esc(name) + '’s books'} <span style="opacity:.55;margin-left:5px">${books.filter(b => name === 'Everyone' || b.owner === name).length}</span></button>`).join('');
    document.querySelectorAll('[data-library-choice]').forEach(button => button.addEventListener('click', () => { owner = choices[Number(button.dataset.libraryChoice)]; render(); }));
  };
  // Shelf dialogs generate rows outside render().
  window.row = (b, showCover = false) => {
    const description = `<b>${esc(b.title)}</b><br><small>${esc(b.author)} · ${esc(b.owner)}</small>`;
    const thumbnail = showCover ? `<span class="unshelvedCover" aria-hidden="true">▤${b.cover
      ? `<img ${b.cover.startsWith('/api/') ? `data-library-cover="${esc(b.cover)}"` : `src="${esc(b.cover)}" loading="lazy"`}
        alt="" onerror="this.remove()">` : ''}</span>` : '';
    return `<div class="rowbook" onclick="openBook(${esc(JSON.stringify(b.id))})">${showCover
      ? `<div class="unshelvedBook">${thumbnail}<div class="unshelvedBookText">${description}</div></div>`
      : `<div>${description}</div>`}<span>${esc(b.shelf || 'Assign shelf →')}</span></div>`;
  };
  window.openBook = function (id = null, shelf = '') {
    if (!state.loaded || !state.libraries.length) { toast('Sign in to a library first.'); return; }
    const b = books.find(x => x.id === id);
    const libs = state.libraries.map(l => `<option value="${l.id}" ${b?.libraryId === l.id || (!b && owner === l.name) ? 'selected' : ''}>${esc(l.name)}</option>`).join('');
    show(`<div class="eyebrow">Live Librarium record</div><h1 style="font-size:37px">${b ? 'Edit book' : 'Add book'}</h1>
      <form id="bookForm" onsubmit="event.preventDefault();saveBook(${b ? `'${b.id}'` : 'null'})">
      <label>Title</label><input name="title" required value="${esc(b?.title || '')}">
      <label>Author</label><input name="author" required value="${esc(b?.author || '')}">
      <label>Library</label><select name="libraryId" ${b ? 'disabled' : ''}>${libs}</select>
      ${b && state.libraries.length > 1 ? '<button id="moveBookButton" type="button" style="margin-top:8px">Move to another library</button>' : ''}
      <label>Physical shelf</label><select name="shelf">${shelfOptions(b?.shelf || shelf)}</select>
      <p style="font-size:11px;margin-top:8px">Shelf moves are written back to matching Librarium shelves such as A1–I8.</p>
      <div class="actions">${b ? `<button type="button" class="danger" onclick="confirmDelete('${b.id}')">Remove from library</button>` : ''}<button type="button" onclick="modal.close()">Cancel</button><button class="primary">Save to Librarium</button></div></form>`);
    document.getElementById('moveBookButton')?.addEventListener('click', () => showMoveBook(b));
  };

  const bookCopies = async book =>
    requireList((await api(`/books/${encodeURIComponent(book.id)}/copies`))?.items);

  async function moveLibraryCopy(book, destination, sourceId, displayedCopies, expectedDestination) {
    if (destination.id === book.libraryId) throw new Error('Choose a different library.');
    const copies = await bookCopies(book);
    const inSource = copies.filter(copy => copy.library_id === book.libraryId && copy.id);
    if (sourceId === 'all' && (inSource.length !== displayedCopies.length ||
      inSource.some(copy => !displayedCopies.includes(copy.id)))) {
      throw new Error('The source copies changed. Reopen the move dialog before moving all copies.');
    }
    const sources = sourceId === 'all' ? inSource : inSource.filter(copy => copy.id === sourceId);
    if (!sources.length) throw new Error('The selected copies are no longer in this library. Reopen the move dialog.');
    if (sources.some(copy => copy.on_loan_to)) throw new Error('Return any loans before moving these copies.');
    const existing = copies.filter(copy => copy.library_id === destination.id);
    if (existing.length !== expectedDestination.length ||
      existing.some(copy => !expectedDestination.includes(copy.id))) {
      throw new Error('Destination copies changed. Check both libraries and reopen the move dialog before trying again.');
    }

    const created = [];
    try {
      for (const source of sources) {
        const payload = { book_id: book.id };
        for (const key of ['edition_id', 'acquired_at', 'acquired_from', 'price_minor',
          'price_currency', 'condition', 'is_signed', 'notes']) {
          if (source[key] != null) payload[key] = source[key];
        }
        const copy = await api(`/libraries/${encodeURIComponent(destination.id)}/copies`, {
          method: 'POST', body: JSON.stringify(payload),
        });
        if (!copy?.id || created.some(id => id === copy.id) || sources.some(s => s.id === copy.id)) {
          throw new Error('Librarium did not return a distinct destination copy.');
        }
        created.push(copy.id);
      }
      const updated = await bookCopies(book);
      for (const [index, source] of sources.entries()) {
        if (!updated.some(copy =>
          copy.id === created[index] && copy.library_id === destination.id &&
          (copy.edition_id || '') === (source.edition_id || '')
        )) throw new Error('A destination copy could not be verified.');
        const original = updated.find(copy => copy.id === source.id && copy.library_id === book.libraryId);
        if (!original || original.on_loan_to || original.updated_at !== source.updated_at) {
          throw new Error('A source copy changed during the move.');
        }
      }
    } catch (error) {
      throw new Error(`${error.message} All originals were kept. Check the destination for any new copies.`);
    }
    let retired = 0;
    try {
      for (const source of sources) {
        await api(`/copies/${encodeURIComponent(source.id)}`, { method: 'DELETE' });
        retired++;
      }
    } catch {
      throw new Error(`All ${created.length} destination copies were verified. Removal was confirmed for ${retired} of ${sources.length} originals. Check both libraries before retrying.`);
    }
    return sources.length;
  }

  async function showMoveBook(book) {
    const destinations = state.libraries.filter(lib => lib.id !== book.libraryId);
    if (!destinations.length) return;
    show(`<h2>Move to another library</h2><p>Move “${esc(book.title)}” from ${esc(book.owner)}.</p>
      <form id="moveBookForm">
        <label for="moveSourceCopy">Copy to move</label>
        <select id="moveSourceCopy" name="sourceCopy" required disabled><option value="">Loading copies…</option></select>
        <label for="moveDestination">Destination library</label>
        <select id="moveDestination" name="destination" required>
          <option value="">Choose a library</option>
          ${destinations.map(lib => `<option value="${esc(lib.id)}">${esc(lib.name)}</option>`).join('')}
        </select>
        <p>The new copy starts unshelved. Its book details and edition are kept; links specific to the old library, such as shelf and series placement, don’t move.</p>
        <label id="existingCopyNotice" hidden style="display:none"><input type="checkbox" name="allowExisting" style="width:auto;min-height:0"> The destination already has this title. Add the selected copies alongside the existing copies.</label>
        <p id="moveBookStatus" role="status"></p>
        <div class="actions"><button type="button" id="cancelMoveBook">Cancel</button>
          <button class="primary" type="submit" disabled>Move book</button></div>
      </form>`);
    const form = document.getElementById('moveBookForm');
    const status = document.getElementById('moveBookStatus');
    const copySelect = form.elements.sourceCopy;
    const submit = form.querySelector('[type="submit"]');
    let displayedCopies = [];
    let displayedAllCopies = [];
    const notice = document.getElementById('existingCopyNotice');
    function destinationChanged() {
      const hasExisting = displayedAllCopies.some(copy => copy.library_id === form.elements.destination.value);
      notice.hidden = !hasExisting;
      notice.style.display = hasExisting ? '' : 'none';
      form.elements.allowExisting.checked = false;
      form.elements.allowExisting.required = hasExisting;
    }
    form.elements.destination.addEventListener('change', destinationChanged);
    document.getElementById('cancelMoveBook').addEventListener('click', () => openBook(book.id));
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (moveInProgress) return;
      const destination = destinations.find(lib => lib.id === form.elements.destination.value);
      const sourceId = copySelect.value;
      if (!destination || !sourceId) return;
      const expectedDestination = displayedAllCopies.filter(copy => copy.library_id === destination.id).map(copy => copy.id);
      if (expectedDestination.length && !form.elements.allowExisting.checked) return;
      moveInProgress = true;
      const close = modal.querySelector('.dialogClose');
      const controls = [...form.querySelectorAll('button,select,input'), close];
      controls.forEach(control => control.disabled = true);
      status.textContent = 'Moving book…';
      try {
        const moved = await moveLibraryCopy(book, destination, sourceId, displayedCopies, expectedDestination);
        modal.close();
        owner = destination.name;
        try { await loadLive(); }
        catch { toast('Book moved. Refresh to see the updated library.'); return; }
        toast(moved === 1 ? `Book moved to ${destination.name}` : `${moved} copies moved to ${destination.name}`);
      } catch (error) {
        status.textContent = error.message;
        if (!status.isConnected) toast(error.message);
      } finally {
        moveInProgress = false;
        controls.forEach(control => control.disabled = false);
      }
    });
    try {
      displayedAllCopies = await bookCopies(book);
      const copies = displayedAllCopies.filter(copy => copy.library_id === book.libraryId && copy.id);
      if (!form.isConnected || !modal.open) return;
      if (!copies.length) {
        copySelect.replaceChildren(new Option('No copies found', ''));
        status.textContent = 'Librarium has no physical copy of this book in the source library.';
        return;
      }
      destinationChanged();
      displayedCopies = copies.map(copy => copy.id);
      copySelect.replaceChildren(new Option('Choose a copy', ''), ...copies.map((copy, index) => {
        const text = [`Copy ${index + 1}`, copy.edition_id ? 'Edition recorded' : 'No edition recorded',
          copy.condition, copy.location_name, copy.is_signed ? 'Signed' : '', copy.on_loan_to ? 'On loan' : '']
          .filter(Boolean).join(' · ');
        const option = new Option(text, copy.id);
        option.disabled = Boolean(copy.on_loan_to);
        return option;
      }));
      if (copies.length > 1 && copies.every(copy => !copy.on_loan_to)) {
        copySelect.add(new Option(`All copies (${copies.length})`, 'all'), 1);
      }
      copySelect.disabled = false;
      if (copies.length === 1 && !copies[0].on_loan_to) copySelect.value = copies[0].id;
      if (copies.every(copy => copy.on_loan_to)) {
        status.textContent = 'Return the loan before moving this copy.';
        return;
      }
      submit.disabled = false;
    } catch {
      copySelect.replaceChildren(new Option('Copies unavailable', ''));
      status.textContent = 'Could not load the source copies. Reopen the move dialog to try again.';
    }
  }

  let moveInProgress = false;
  modal.addEventListener('cancel', event => { if (moveInProgress) event.preventDefault(); });

  async function setShelf(book, code) {
    const available = state.shelves.get(book.libraryId) || [];
    // Validate the destination before removing anything, and retain unrelated
    // catalogue shelves (e.g. favourites and reading lists).
    const target = code ? available.find(s => s.name.toUpperCase() === code.toUpperCase()) : null;
    if (code && !target) throw new Error(`Create shelf ${code} in Librarium before assigning books to it.`);
    const current = available.filter(s => book.shelfIds.includes(s.id) && /^[A-I][1-8]$/i.test(s.name));
    if (code) {
      if (!book.shelfIds.includes(target.id)) await api(`/libraries/${book.libraryId}/shelves/${target.id}/books`, { method: 'POST', body: JSON.stringify({ book_id: book.id }) });
    }
    for (const shelf of current) if (shelf.id !== target?.id) await api(`/libraries/${book.libraryId}/shelves/${shelf.id}/books/${book.id}`, { method: 'DELETE' });
  }

  window.saveBook = async function (id) {
    const form = document.getElementById('bookForm'); const data = Object.fromEntries(new FormData(form));
    try {
      if (id) {
        const book = books.find(b => b.id === id);
        const raw = book.raw;
        const contributors = data.author.trim() === book.author ? raw.contributors : [
          ...(raw.contributors || []).filter(c => c.role && c.role !== 'author'),
          { name: data.author.trim(), role: 'author' }
        ];
        await api(`/libraries/${book.libraryId}/books/${id}`, { method: 'PUT', body: JSON.stringify({ title: data.title.trim(), subtitle: raw.subtitle || '', description: raw.description || '', media_type_id: raw.media_type_id, contributors, genre_ids: (raw.genres || []).map(x => x.id), tag_ids: (raw.tags || []).map(x => x.id) }) });
        await setShelf(book, data.shelf);
      } else {
        const mediaTypes = await api('/media-types');
        const mediaType = mediaTypes.find(t => /^(book|books)$/i.test(t.name));
        if (!mediaType) throw new Error('No Book media type is configured in Librarium.');
        const created = await api(`/libraries/${data.libraryId}/books`, { method: 'POST', body: JSON.stringify({ title: data.title.trim(), media_type_id: mediaType.id, contributors: [{ name: data.author.trim(), role: 'author' }] }) });
        const lib = state.libraries.find(l => l.id === data.libraryId); await setShelf(normaliseBook(created, lib), data.shelf);
      }
      modal.close(); await loadLive(); toast('Saved to the live Librarium database');
    } catch (error) { toast(error.message); }
  };

  window.confirmDelete = function (id) { const b = books.find(x => x.id === id); show(`<h2>Remove from ${esc(b.owner)}?</h2><p style="margin-top:15px">This retires that library’s copy of “${esc(b.title)}”.</p><div class="actions"><button onclick="openBook('${id}')">Cancel</button><button class="danger" onclick="deleteBook('${id}')">Remove copy</button></div>`); };
  window.deleteBook = async function (id) { const b = books.find(x => x.id === id); try { await api(`/libraries/${b.libraryId}/books/${id}`, { method: 'DELETE' }); modal.close(); await loadLive(); } catch (error) { toast(error.message); } };

  const baseComplete = window.completeSortMove;
  window.completeSortMove = async function (id, checked) {
    const move = sortPlan?.moves.find(m => m.id === id); const book = move?.kind === 'book' ? books.find(b => b.id === move.bookId) : null;
    if (book) { try { await setShelf(book, move.to); } catch (error) { toast(error.message); render(); return; } }
    baseComplete(id, checked);
    if (book) await loadLive();
  };

  if (state.token) loadLive().catch(error => loginScreen(error.message)); else loginScreen();
})();

