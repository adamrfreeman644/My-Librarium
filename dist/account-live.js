/* Live Librarium adapter. Catalogue records always come from the API. */
(() => {
  const API = '/api/v1';
  if (localStorage.getItem('librarium-live-migrated') !== '1') {
    ['lib-books-v1', 'lib-series-v1', 'lib-sort-plan-v1', 'lib-agent-queue-v1', 'lib-agent-log-v1'].forEach(key => localStorage.removeItem(key));
    localStorage.setItem('librarium-live-migrated', '1');
  }
  const liveStyle = document.createElement('style');
  liveStyle.textContent = ".brand:after{content:'LIVE'!important;color:var(--dark-link,#2e5848)!important}";
  document.head.appendChild(liveStyle);
  const session = window.LibrariumSession;
  const state = { get token(){return session.access()}, libraries: [], shelves: new Map(), loaded: false };
  const bookFilters = document.getElementById('bookFilters');
  const filterBoxes = [...bookFilters.querySelectorAll('input[type=checkbox]')];
  const filterCount = document.getElementById('bookFilterCount');
  function updateBookFilters() {
    const count = filterBoxes.filter(box => !box.checked).length;
    filterCount.hidden = !count;
    filterCount.textContent = String(count);
  }
  function showFilteredBooks() {
    updateBookFilters();
    if (!state.loaded) return;
    if (view !== 'books') owner = 'Everyone';
    setView('books');
  }
  for (const box of filterBoxes) box.addEventListener('change', showFilteredBooks);
  document.getElementById('noSeriesShortcut').addEventListener('click', () => {
    filterBoxes.filter(box=>box.name==='seriesStatus').forEach(box=>{box.checked=box.value!=='linked';});
    showFilteredBooks();
    bookFilters.open=false;
    bookFilters.querySelector('summary').focus();
  });
  document.getElementById('resetBookFilters').addEventListener('click', () => {
    filterBoxes.forEach(box=>{box.checked=true;});
    showFilteredBooks();
  });
  document.addEventListener('click', event => {
    if (bookFilters.open && !bookFilters.contains(event.target)) bookFilters.open=false;
  });
  bookFilters.addEventListener('keydown', event => {
    if (event.key==='Escape' && bookFilters.open) {
      bookFilters.open=false;
      bookFilters.querySelector('summary').focus();
    }
  });
  const accountAction = document.getElementById('accountAction');
  function updateAccountAction() {
    accountAction.textContent = state.token || session.remembered() ? 'Log out' : 'Log in';
    accountAction.disabled = false;
  }
  accountAction.addEventListener('click', () => {
    if (state.token || session.remembered()) {
      session.clear();
      window.location.reload();
      return;
    }
    if (!document.getElementById('liveLogin')) loginScreen();
    document.getElementById('liveIdentifier').focus();
  });
  updateAccountAction();


  async function api(path, options = {}) {
    const headers = { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers };
    const response = await session.request(API + path, { ...options, headers });
    if (response.status === 401) {
      if (path !== '/auth/login') session.clear();
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
    bookFilters.hidden = true;
    bookFilters.open = false;
    filterBoxes.forEach(box=>{box.checked=true;});
    updateBookFilters();
    document.getElementById('bookSortTools').hidden = true;
    document.getElementById('seriesReviewLink').hidden = true;
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
      <p>Use your Librarium account to sign in.</p>
      ${message ? `<p role="alert" style="margin-top:18px;color:#aa4337">${esc(message)}</p>` : ''}
      <form id="liveLogin"><label for="liveIdentifier">Username or email</label><input id="liveIdentifier" name="identifier" autocomplete="username" required>
      <label for="livePassword">Password</label><input id="livePassword" name="password" type="password" autocomplete="current-password" required>
      <label class="rememberOption"><input name="remember" type="checkbox"> Keep me signed in on this device</label>
      <div class="actions"><button class="primary">Sign in to live catalogue</button></div></form></div>`;
    document.getElementById('liveLogin').addEventListener('submit', login);
  }

  async function login(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button'); button.disabled = true; button.textContent = 'Signing in…';
    try {
      const fields = new FormData(form), remember = fields.get('remember') === 'on';
      fields.delete('remember');
      const data = await api('/auth/login', { method: 'POST', body: JSON.stringify(Object.fromEntries(fields)) });
      if (typeof data?.access_token !== 'string' || !data.access_token) throw new Error('The login response did not include an access token.');
      const remembered = session.signIn(data, remember);
      updateAccountAction();
      await loadLive();
      if (remember && !remembered) toast('Signed in, but this browser could not remember the session.');
    } catch (error) { loginScreen(error.message); }
  }

  const isStandaloneTag = tag => String(tag?.name || '').trim().toLowerCase() === 'standalone';
  async function standaloneTag(libraryId) {
    const path = `/libraries/${encodeURIComponent(libraryId)}/tags`;
    let tags = requireList(await api(path));
    let tag = tags.find(isStandaloneTag);
    if (!tag) {
      try { tag = await api(path, {method:'POST',body:JSON.stringify({name:'Standalone',color:'#2e5848'})}); }
      catch (error) {
        tags = requireList(await api(path));
        tag = tags.find(isStandaloneTag);
        if (!tag) throw error;
      }
    }
    if (!tag?.id) throw new Error('Librarium did not return a Standalone tag.');
    return tag;
  }
  const authorOf = b => (b.contributors || []).filter(c => !c.role || c.role === 'author').map(c => c.name).join(', ') || 'Unknown author';
  const shelfCode = b => (b.shelves || []).map(s => s.name).find(n => /^[A-I][1-8]$/i.test(n || ''))?.toUpperCase() || null;
  const normaliseBook = (b, lib) => ({
    id: b.id, libraryId: lib.id, title: b.title || 'Untitled', author: authorOf(b), owner: lib.name,
    shelf: shelfCode(b), shelfIds: (b.shelves || []).map(s => s.id), color: '#476451', cover: b.cover_url || '',
    isbn: '', standalone:(b.tags || []).some(isStandaloneTag) && !(b.series || []).length, added: Date.parse(b.created_at || '') || Date.now(), raw: b
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
    bookFilters.hidden = false;
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
        const response = await session.request(url.href, { signal });
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
      if (!token || !state.token) return;
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
    panel.innerHTML = `<div class="paneltop"><h2>Saved series</h2><div class="seriesPageActions"><a href="${officialSeries}" target="_blank" rel="noopener">Manage in Librarium</a><button id="newSeriesButton" type="button" class="primary">＋ New series</button></div></div>
      ${failedSeries ? '<p role="status">Some collections’ series could not be loaded. <button id="retrySeries" type="button">Try again</button></p>' : ''}
      <div class="seriesgrid">${visible.map(({entry, lib}, index) => `<button class="seriescard" data-series-index="${index}">
        <div class="eyebrow">${esc(lib.name)}</div><h2>${esc(entry.name || 'Untitled series')}</h2>
        ${entry.book_count == null ? '' : `<p>${esc(String(entry.book_count))} linked books</p>`}
      </button>`).join('')}</div>
      ${!visible.length && !failedSeries ? '<div class="emptymsg">No saved series match this view.</div>' : ''}`;
    panel.querySelector('#newSeriesButton')?.addEventListener('click',openNewSeries);
    panel.querySelector('#retrySeries')?.addEventListener('click', () => { seriesRequest = null; render(); });
    panel.querySelectorAll('[data-series-index]').forEach(button => button.addEventListener('click', () =>
      showLiveSeries(visible[Number(button.dataset.seriesIndex)])));
  };

  const seriesNameKey = name => String(name||'').normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();
  async function createSavedSeries(lib,payload) {
    const base=seriesPath(lib);
    const existing=requireList(await api(base));
    if(existing.some(run=>seriesNameKey(run.name)===seriesNameKey(payload.name)))
      throw Error('A series with this name already exists in '+lib.name+'.');
    const created=await api(base,{method:'POST',body:JSON.stringify(payload)});
    if(!created?.id)throw Error('Librarium did not confirm creation. Check the series list before retrying.');
    return created;
  }

  function openNewSeries() {
    const initial = state.libraries.find(lib=>lib.name===owner)?.id || '';
    show(`<div class="eyebrow">Book series</div><h2>New series</h2>
      <p>Create a series in Librarium. You can link books to it from Edit book.</p>
      <form id="newSeriesForm">
        <label for="newSeriesLibrary">Library</label>
        <select id="newSeriesLibrary" name="library" required>
          <option value="">Choose a library</option>
          ${state.libraries.map(lib=>`<option value="${esc(lib.id)}" ${lib.id===initial||state.libraries.length===1?'selected':''}>${esc(lib.name)}</option>`).join('')}
        </select>
        <label for="newSeriesName">Series name</label>
        <input id="newSeriesName" name="name" maxlength="160" required>
        <div class="newSeriesFields">
          <div><label for="newSeriesStatus">Status</label><select id="newSeriesStatus" name="status"><option value="ongoing">Ongoing</option><option value="completed">Completed</option></select></div>
          <div><label for="newSeriesCount">Total volumes (optional)</label><input id="newSeriesCount" name="count" type="number" min="1" max="1000" step="1"></div>
        </div>
        <label for="newSeriesDescription">Description (optional)</label>
        <textarea id="newSeriesDescription" name="description" rows="2" maxlength="2000"></textarea>
        <p id="newSeriesStatusMessage" role="status"></p>
        <div class="actions"><button type="button" onclick="modal.close()">Cancel</button><button type="submit" class="primary">Create series</button></div>
      </form>`);
    const form=document.getElementById('newSeriesForm');
    const status=document.getElementById('newSeriesStatusMessage');
    const controls=[...form.querySelectorAll('button,input,select,textarea'),modal.querySelector('.dialogClose')];
    let busy=false;
    form.addEventListener('submit',async event=>{
      event.preventDefault();
      if(busy)return;
      const fields=Object.fromEntries(new FormData(form));
      const lib=state.libraries.find(l=>l.id===fields.library), name=fields.name.trim().replace(/\s+/g,' ');
      if(!lib||!name){status.textContent='Choose a library and enter a series name.';return;}
      const payload={name,status:fields.status,description:fields.description.trim()};
      if(fields.count)payload.total_count=Number(fields.count);
      busy=true;controls.forEach(control=>{control.disabled=true;});status.textContent='Creating series…';
      try{
        const created=await createSavedSeries(lib,payload);
        liveSeries=[...liveSeries,{entry:created,lib}].sort((a,b)=>String(a.entry.name).localeCompare(String(b.entry.name)));
        if(modal.open&&form.isConnected)modal.close();
        owner=lib.name;
        document.getElementById('search').value='';
        render();
        toast('Created '+created.name+' in '+lib.name);
      }catch(error){status.textContent=error.message;}
      finally{busy=false;controls.forEach(control=>{control.disabled=false;});}
    });
  }

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
        openBook(tiles[Number(button.dataset.seriesBook)].book_id,'',lib.id)));
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
    return `<div class="rowbook" onclick="openBook(${esc(JSON.stringify(b.id))},'',${esc(JSON.stringify(b.libraryId))})">${showCover
      ? `<div class="unshelvedBook">${thumbnail}<div class="unshelvedBookText">${description}</div></div>`
      : `<div>${description}</div>`}<span>${esc(b.shelf || 'Assign shelf →')}</span></div>`;
  };
  window.openBook = function (id = null, shelf = '', libraryId = '') {
    if (!state.loaded || !state.libraries.length) { toast('Sign in to a library first.'); return; }
    const b = books.find(x => x.id === id && (!libraryId || x.libraryId === libraryId));
    const libs = state.libraries.map(l => `<option value="${l.id}" ${b?.libraryId === l.id || (!b && owner === l.name) ? 'selected' : ''}>${esc(l.name)}</option>`).join('');
    show(`<div class="eyebrow">Live Librarium record</div><h1 style="font-size:37px">${b ? 'Edit book' : 'Add book'}</h1>
      <form id="bookForm" data-library-id="${esc(b?.libraryId || '')}" onsubmit="event.preventDefault();saveBook(${b ? `'${b.id}'` : 'null'})">
      ${b ? '' : newBookLookupFields()}
      <div class="bookEditGrid">
      <div class="bookDetailsFields">
        <label>Title<input name="title" required value="${esc(b?.title || '')}"></label>
        <label>Author<input name="author" ${b?'required':''} value="${esc(b?.author || '')}"></label>
        ${!b ? '<label>Subtitle<input name="subtitle"></label><label>Description<textarea name="description" rows="3"></textarea></label>' : ''}
        <div class="bookPlacement">
          ${b ? `<div><span class="bookLibraryLabel">Library</span><span class="bookLibraryValue">${esc(b.owner)}</span></div>`
              : `<label>Library<select name="libraryId">${libs}</select></label>`}
          <label>Physical shelf<select name="shelf">${shelfOptions(b?.shelf || shelf)}</select></label>
        </div>
        ${!b ? '<label>Media type<select name="mediaTypeId" required disabled><option value="">Loading media types…</option></select></label>' : ''}
        ${b && state.libraries.length > 1 ? '<div><button id="moveBookButton" type="button">Move to another library</button></div>' : ''}
        ${b ? `<label class="standaloneOption"><input id="standaloneBook" name="standalone" type="checkbox" ${b.standalone?'checked':''} ${b.raw.series?.length?'disabled':''}> Mark as standalone</label>
          <p class="standaloneHint">${b.raw.series?.length?'This book already belongs to a series.':'Standalone books are skipped in Series Review.'}</p>` : ''}
      </div>
      <details class="newBookSection bookSeriesSection" id="newBookSeries" ${b ? 'open' : ''}><summary>Series</summary>
        <div class="newBookSeriesBody">${b ? bookSeriesFields(b.owner) : ''}</div>
      </details>
      </div>
      ${b ? '' : newBookExtraFields()}
      <p id="bookSaveStatus" role="status"></p>
      <div class="actions">${b ? `<button type="button" class="danger" onclick="confirmDelete('${b.id}','${b.libraryId}')">Remove from library</button>` : ''}<button type="button" onclick="modal.close()">Cancel</button><button class="primary">Save to Librarium</button></div></form>`);
    document.getElementById('moveBookButton')?.addEventListener('click', () => showMoveBook(b));
    if (b) setupBookSeries(b);
    else {const form=document.getElementById('bookForm');loadBookMediaTypes(form);setupNewBookFields(form);setupNewBookSeries(form);}
  };

  function newBookLookupFields() {
    return `<section class="newBookLookup" aria-label="Book lookup">
      <label for="newBookLookup">ISBN or title lookup</label>
      <div class="lookuprow"><input id="newBookLookup" placeholder="ISBN, title or author" autocomplete="off">
      <button id="lookupNewBookISBN" type="button">Find by ISBN</button><button id="lookupNewBookTitle" type="button">Find by title</button></div>
      <p id="newBookLookupStatus" role="status"></p><div id="newBookLookupResults"></div>
    </section>`;
  }
  function bookSeriesFields(ownerName,pending=false){
    return `<fieldset id="bookSeriesEditor" class="bookSeriesEditor">
        <legend>Add to existing series</legend>
        <p class="bookSeriesMembership"></p>
        <details class="inlineSeriesCreate">
          <summary>＋ New series</summary>
          <p>Create a series in ${esc(ownerName)}.</p>
          <button id="suggestSeriesFromBook" type="button">Suggest series</button>
          <div class="inlineSeriesSuggestion" hidden></div>
          <label for="inlineSeriesName">Series name</label><input id="inlineSeriesName" maxlength="160">
          <div class="newSeriesFields">
            <div><label for="inlineSeriesStatus">Status</label><select id="inlineSeriesStatus"><option value="ongoing">Ongoing</option><option value="completed">Completed</option></select></div>
            <div><label for="inlineSeriesCount">Total volumes (optional)</label><input id="inlineSeriesCount" inputmode="numeric"></div>
          </div>
          <label for="inlineSeriesDescription">Description (optional)</label><textarea id="inlineSeriesDescription" rows="2" maxlength="2000"></textarea>
          <button id="inlineSeriesSave" type="button" class="primary">Create series</button>
          <p id="inlineSeriesMessage" role="status"></p>
        </details>
        <div class="authorSeriesSuggestions" hidden><strong>Suggested by author</strong><div class="authorSeriesChoices"></div></div>
        <div class="bookSeriesFields">
          <label for="editSeriesChoice">Series<select id="editSeriesChoice" name="seriesId" disabled><option>Loading series…</option></select></label>
          <label for="editSeriesVolume">Volume number<input id="editSeriesVolume" name="seriesPosition" type="text" inputmode="decimal" disabled></label>
        </div>
        <div class="editSeriesPreview" hidden aria-live="polite"></div>
        <button id="addBookToSeries" ${pending ? 'hidden style="display:none"' : ''} type="button" disabled>Add to series</button><p id="editSeriesMessage" role="status"></p>
      </fieldset>`;
  }

  function newBookExtraFields() {
    return `<details class="newBookSection" open><summary>Genres and tags</summary>
      <div class="newBookClassifications">
        <fieldset><legend>Genres</legend><input id="newBookGenresSearch" type="search" placeholder="Search genres" aria-label="Search genres"><div id="newBookGenres" class="bookCheckList searchableChecks">Loading genres…</div><p id="newBookGenresCount" class="pickerCount" role="status"></p><button id="newBookGenresMore" class="pickerMore" type="button" hidden>Show more</button></fieldset>
        <fieldset><legend>Tags</legend><div id="newBookTags" class="bookCheckList">Loading tags…</div>
          <label>New tag (optional)<input name="newTag" maxlength="80"></label></fieldset>
      </div>
    </details>
    <details class="newBookSection"><summary>Additional contributors</summary>
      <div id="newBookContributors"></div><button id="newBookAddContributor" type="button">＋ Add contributor</button>
    </details>
    <details id="newBookEdition" class="newBookSection"><summary>Edition details</summary>
      <label class="standaloneOption"><input name="includeEdition" type="checkbox"> Save an edition for this book</label>
      <div class="newBookEditionFields">
        <label>Format<select name="format"><option value="paperback">Paperback</option><option value="hardcover">Hardcover</option><option value="ebook">E-book</option><option value="audiobook">Audiobook</option></select></label>
        <label>Edition name<input name="editionName"></label>
        <label>Publisher<input name="publisher"></label>
        <label>Publication date<input name="publicationDate" type="date"></label>
        <label>Language code<input name="language" placeholder="e.g. en or en-GB"></label>
        <label>Page count<input name="pageCount" type="number" min="1" step="1"></label>
        <label>ISBN-13<input name="isbn13" inputmode="numeric"></label>
        <label>ISBN-10<input name="isbn10" inputmode="text"></label>
        <label>Narrator<input name="narrator"></label>
        <label>Duration (hours)<input name="durationHours" type="number" min="0" step="1"></label>
        <label>Duration (minutes)<input name="durationMinutes" type="number" min="0" max="59" step="1"></label>
        <label class="standaloneOption"><input name="primaryEdition" type="checkbox" checked> Primary edition</label>
      </div>
    </details>
    <label id="newBookCoverChoice" class="standaloneOption" hidden><input name="importCover" type="checkbox" checked> Import the lookup cover</label>`;
  }

  function editionLanguage(value) {
    const s=String(value||'').trim().replace(/_/g,'-'), m=s.match(/^([a-z]{2})(?:-([a-z]{2}))?$/i);
    if(m)return m[1].toLowerCase()+(m[2]?'-'+m[2].toUpperCase():'');
    return ({eng:'en',fra:'fr',fre:'fr',deu:'de',ger:'de',spa:'es',ita:'it',jpn:'ja',zho:'zh',chi:'zh',por:'pt',rus:'ru',kor:'ko',nld:'nl',dut:'nl'})[s.toLowerCase()]||'';
  }
  const isbnClean = value => String(value||'').toUpperCase().replace(/[\s-]/g,'');
  function validISBN(value) {
    if(/^\d{13}$/.test(value))return [...value].reduce((sum,n,i)=>sum+Number(n)*(i%2?3:1),0)%10===0;
    if(/^\d{9}[\dX]$/.test(value))return [...value].reduce((sum,n,i)=>sum+(n==='X'?10:Number(n))*(10-i),0)%11===0;
    return false;
  }
  function bookEdition(data) {
    if(data.includeEdition!=='on')return null;
    const isbn10=isbnClean(data.isbn10),isbn13=isbnClean(data.isbn13), language=editionLanguage(data.language);
    if((isbn10&&(!validISBN(isbn10)||isbn10.length!==10))||(isbn13&&(!validISBN(isbn13)||isbn13.length!==13)))throw Error('Check the ISBN in Edition details.');
    if(data.language.trim()&&!language)throw Error('Enter a language code like en or en-GB, or leave it blank.');
    const audio=data.format==='audiobook', ebook=data.format==='ebook';
    const duration=(Number(data.durationHours)||0)*3600+(Number(data.durationMinutes)||0)*60;
    return {format:data.format,edition_name:data.editionName.trim(),language,publisher:data.publisher.trim(),
      publish_date:data.publicationDate,isbn_10:!audio&&!ebook?isbn10||null:null,isbn_13:!audio?isbn13||null:null,
      page_count:!audio&&data.pageCount?Number(data.pageCount):null,duration_seconds:audio&&duration?duration:null,
      narrator:audio?data.narrator.trim()||null:null,is_primary:data.primaryEdition==='on'};
  }

  function setupNewBookFields(form) {
    const input=form.querySelector('#newBookLookup'),status=form.querySelector('#newBookLookupStatus'),results=form.querySelector('#newBookLookupResults');
    const genreBox=form.querySelector('#newBookGenres'),tagBox=form.querySelector('#newBookTags');
    const edition=form.querySelector('#newBookEdition');
    const contributorRows=form.querySelector('#newBookContributors');
    let tagsRevision=0,lookupRevision=0,genres=[];
    function renderChecks(container,rows,name){
      container.replaceChildren();
      if(!rows.length){container.textContent='None available.';return;}
      for(const row of rows){
        if(!row?.id||!row.name)continue;
        const label=document.createElement('label'),check=document.createElement('input');
        check.type='checkbox';check.name=name;check.value=row.id;
        label.append(check,document.createTextNode(row.name));container.append(label);
      }
    }
    function searchablePicker(container){
      const search=form.querySelector('#'+container.id+'Search'), more=form.querySelector('#'+container.id+'More');
      const count=form.querySelector('#'+container.id+'Count');
      let limit=8;
      function update(){
        const q=search.value.trim().toLowerCase();
        const labels=[...container.querySelectorAll('label')];
        let matching=0;
        for(const label of labels){
          const matches=label.textContent.toLowerCase().includes(q);
          label.hidden=!matches||(matching++>=limit);
        }
        const shown=Math.min(matching,limit), remaining=matching-shown;
        const checked=labels.filter(label=>label.querySelector('input').checked).length;
        count.textContent=labels.length?(matching?shown+' of '+matching+' shown':'No matches')+' · '+checked+' selected':'';
        more.hidden=!remaining;
        more.textContent=remaining?'Show more ('+remaining+' left)':'Show more';
      }
      search.addEventListener('input',()=>{limit=8;update();});
      search.addEventListener('keydown',event=>{if(event.key==='Enter')event.preventDefault();});
      container.addEventListener('change',update);
      more.addEventListener('click',()=>{limit+=12;update();});
      return update;
    }
    const updateGenres=searchablePicker(genreBox);
    api('/genres').then(value=>{genres=requireList(value);if(form.isConnected){renderChecks(genreBox,genres,'genreId');updateGenres();}})
      .catch(()=>{if(form.isConnected)genreBox.textContent='Could not load genres.';});
    async function loadTags(){
      const rev=++tagsRevision, lib=form.elements.libraryId.value;
      tagBox.textContent='Loading tags…';
      try{
        const tags=await api('/libraries/'+encodeURIComponent(lib)+'/tags');
        if(rev===tagsRevision&&form.isConnected)renderChecks(tagBox,requireList(tags),'tagId');
      }catch{if(rev===tagsRevision&&form.isConnected)tagBox.textContent='Could not load tags.';}
    }
    form.elements.libraryId.addEventListener('change',loadTags);
    loadTags();
    function addContributor(name='',role='author'){
      const row=document.createElement('div');
      row.className='newBookContributor';
      const text=document.createElement('input');text.placeholder='Contributor name';text.setAttribute('aria-label','Contributor name');text.value=name;text.name='contributorName';
      const select=document.createElement('select');select.name='contributorRole';select.setAttribute('aria-label','Contributor role');
      for(const value of ['author','editor','illustrator','translator','narrator','colorist','letterer','penciller','inker','cover_artist'])
        select.add(new Option(value.replace(/_/g,' '),value));
      select.value=role;
      const remove=document.createElement('button');remove.type='button';remove.textContent='Remove';remove.addEventListener('click',()=>row.remove());
      row.append(text,select,remove);contributorRows.append(row);return text;
    }
    form.querySelector('#newBookAddContributor').addEventListener('click',()=>addContributor().focus());
    function setEditionEnabled(){
      const enabled=form.elements.includeEdition.checked;
      edition.querySelectorAll('.newBookEditionFields input,.newBookEditionFields select').forEach(field=>field.disabled=!enabled);
    }
    form.elements.includeEdition.addEventListener('change',setEditionEnabled);setEditionEnabled();
    function applyResult(item,lookedUpISBN){
      const verifiedISBN=(value,length)=>{const code=isbnClean(value);return code.length===length&&validISBN(code)?code:'';};
      for(const [field,value] of Object.entries({title:item.title,subtitle:item.subtitle,description:item.description,
        publisher:item.publisher,publicationDate:/^\d{4}-\d{2}-\d{2}$/.test(item.publish_date||'')?item.publish_date:'',
        language:editionLanguage(item.language),pageCount:item.page_count,
        isbn10:verifiedISBN(item.isbn_10,10)||(lookedUpISBN.length===10?lookedUpISBN:''),isbn13:verifiedISBN(item.isbn_13,13)||(lookedUpISBN.length===13?lookedUpISBN:'')}))
        form.elements[field].value=String(value??'');
      const authors=Array.isArray(item.authors)?item.authors.filter(a=>typeof a==='string'&&a.trim()):[];
      if(authors.length){
        const parsed=authors.map(raw=>{
          const match=raw.match(/^(.*?)\s+\((author|editor|illustrator|translator|narrator)\)$/i);
          return match?{name:match[1],role:match[2].toLowerCase()}:{name:raw,role:'author'};
        });
        const first=parsed.findIndex(person=>person.role==='author');
        if(first>=0)form.elements.author.value=parsed.splice(first,1)[0].name;
        contributorRows.replaceChildren();
        for(const person of parsed)addContributor(person.name,person.role);
        if(parsed.length)contributorRows.closest('details').open=true;
      }
      const categoryNames=new Set((Array.isArray(item.categories)?item.categories:[]).map(x=>String(x).trim().toLowerCase()));
      for(const box of genreBox.querySelectorAll('input')){
        const genre=genres.find(g=>g.id===box.value);
        if(genre&&categoryNames.has(genre.name.toLowerCase()))box.checked=true;
      }
      updateGenres();
      form.dataset.lookupCover='';
      try{const cover=new URL(item.cover_url);if(cover.protocol==='https:')form.dataset.lookupCover=cover.href;}catch{}
      form.querySelector('#newBookCoverChoice').hidden=!form.dataset.lookupCover;
      form.elements.includeEdition.checked=true;setEditionEnabled();edition.open=true;
      results.replaceChildren();status.textContent='Details filled in. Review them before saving.';
    }
    async function lookup(byISBN){
      const query=byISBN?isbnClean(input.value):input.value.trim();
      const rev=++lookupRevision;
      results.replaceChildren();
      if(byISBN?!validISBN(query):query.length<2){status.textContent=byISBN?'Enter a valid ISBN-10 or ISBN-13.':'Enter a title or author.';return;}
      status.textContent='Looking up book details…';
      try{
        const rows=requireList(await api(byISBN?'/lookup/isbn/'+encodeURIComponent(query):'/lookup/books?q='+encodeURIComponent(query)));
        if(!form.isConnected||rev!==lookupRevision)return;
        for(const item of rows.slice(0,12)){
          if(!item?.title)continue;
          const pick=document.createElement('button');pick.type='button';
          const author=Array.isArray(item.authors)?item.authors.join(', '):'';
          pick.textContent=[item.title,author,item.provider_display||item.provider].filter(Boolean).join(' · ');
          pick.addEventListener('click',()=>applyResult(item,byISBN?query:''));results.append(pick);
        }
        status.textContent=results.children.length?'Choose a result to fill in the form.':'No matching metadata. You can enter the details manually.';
      }catch(error){if(rev===lookupRevision)status.textContent=error.message;}
    }
    form.querySelector('#lookupNewBookISBN').addEventListener('click',()=>lookup(true));
    form.querySelector('#lookupNewBookTitle').addEventListener('click',()=>lookup(false));
    input.addEventListener('keydown',event=>{
      if(event.key==='Enter'){event.preventDefault();lookup(/^\d{9}[\dX]$|^\d{13}$/.test(isbnClean(input.value)));}
    });
  }

  async function loadBookMediaTypes(form) {
    const select=form.elements.mediaTypeId, submit=form.querySelector('button.primary');
    const status=form.querySelector('#bookSaveStatus');
    submit.disabled=true;
    try{
      const types=requireList(await api('/media-types')).filter(t=>t?.id&&t.name);
      const preferred=types.find(t=>/^(novel|book|books)$/i.test(t.name));
      select.replaceChildren(new Option('Choose a media type',''),...types.map(t=>new Option(t.display_name||t.name,t.id)));
      if(preferred)select.value=preferred.id;
      if(!types.length)throw Error('No media types are configured in Librarium.');
      select.disabled=submit.disabled=false;
    }catch(e){status.textContent='Could not load media types. '+e.message;}
  }

  function suggestSeriesByAuthor(book, available) {
    const authors = item => (item.raw?.contributors || []).filter(c => !c.role || c.role === 'author');
    const authorKey = name => String(name || '').normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();
    const ownAuthors = authors(book);
    const allowed = new Set(available.map(run => run.id)), counts = new Map();
    if (!ownAuthors.length) return [];
    for (const other of books) {
      if (other.libraryId !== book.libraryId || other.id === book.id) continue;
      const sameAuthor = authors(other).some(a => ownAuthors.some(b =>
        (a.contributor_id && b.contributor_id && a.contributor_id === b.contributor_id) ||
        (authorKey(a.name) && authorKey(a.name) === authorKey(b.name))));
      if (!sameAuthor) continue;
      const refs = new Set((other.raw.series || []).map(ref => ref.series_id));
      for (const id of refs) if (allowed.has(id)) counts.set(id,(counts.get(id)||0)+1);
    }
    return available.filter(run => counts.has(run.id)).sort((a,b) =>
      counts.get(b.id)-counts.get(a.id) || String(a.name).localeCompare(String(b.name))).slice(0,4);
  }

  function setupNewBookSeries(form){
    const section=form.querySelector('#newBookSeries'), body=section.querySelector('.newBookSeriesBody');
    let loadedLibrary='';
    function load(){
      const lib=state.libraries.find(item=>item.id===form.elements.libraryId.value);
      body.replaceChildren();
      loadedLibrary='';
      if(!section.open||!lib)return;
      body.innerHTML=bookSeriesFields(lib.name,true);
      loadedLibrary=lib.id;
      setupBookSeries({
        libraryId:lib.id,
        get author(){return form.elements.author.value.trim();},
        get raw(){return {contributors:[{name:form.elements.author.value.trim(),role:'author'}],subtitle:form.elements.subtitle.value,description:form.elements.description.value,
          isbn_13:form.elements.isbn13.value,isbn_10:form.elements.isbn10.value};},
      },body.firstElementChild);
    }
    section.addEventListener('toggle',()=>{if(section.open&&loadedLibrary!==form.elements.libraryId.value)load();});
    form.elements.libraryId.addEventListener('change',load);
  }
  function seriesVolumeOccupied(rows,position){
    return rows.find(row=>Number(row.position)>0&&position>=Number(row.position)&&position<=Math.max(Number(row.position),Number(row.position_end)||0));
  }

  async function setupBookSeries(book, pendingPanel) {
    const panel = pendingPanel || document.getElementById('bookSeriesEditor');
    if (!panel) return;
    const select = panel.querySelector('#editSeriesChoice');
    const volume = panel.querySelector('#editSeriesVolume');
    const button = panel.querySelector('#addBookToSeries');
    const status = panel.querySelector('#editSeriesMessage');
    const membership = panel.querySelector('.bookSeriesMembership');
    const preview = panel.querySelector('.editSeriesPreview');
    const suggestions = panel.querySelector('.authorSeriesSuggestions');
    const choices = suggestions.querySelector('.authorSeriesChoices');
    const occupies = seriesVolumeOccupied;
    let previewRun = '';
    async function showSlots() {
      const run = runs.find(item => item.id === select.value);
      for (const choice of choices.querySelectorAll('button'))
        choice.setAttribute('aria-pressed',String(choice.dataset.series === select.value));
      previewRun = '';
      volume.value = '';
      volume.disabled = button.disabled = true;
      status.textContent = '';
      preview.hidden = !run;
      preview.replaceChildren();
      if (!run) return;
      const requested = document.createElement('p');
      requested.textContent = 'Loading books and open slots…';
      preview.append(requested);
      try {
        const url = `${base}/${encodeURIComponent(run.id)}`;
        const [linked, known] = await Promise.all([
          api(url+'/books').then(requireList),
          api(url+'/volumes').then(requireList).catch(() => []),
        ]);
        if (!panel.isConnected || !modal.open || !requested.isConnected || select.value !== run.id) return;
        const slots = seriesTiles(linked,known,run.total_count);
        const heading = document.createElement('strong');
        heading.textContent = 'Books and open slots';
        preview.replaceChildren(heading);
        const summary = document.createElement('p');
        summary.textContent = slots.length ? 'Tap an open slot, or enter a new volume number below.' : 'No numbered volumes are listed yet. Enter a volume number below.';
        preview.append(summary);
        const list = document.createElement('ul');
        list.className = 'editSeriesSlots';
        for (const slot of slots) {
          const position = Number(slot.position), occupied = Boolean(slot.book_id) || Boolean(occupies(linked,position));
          const item = document.createElement('li');
          const number = position > 0 ? `Vol. ${position}${slot.position_end > position ? `–${slot.position_end}` : ''}` : 'Unnumbered';
          const name = slot.title || (occupied ? 'Linked book' : 'Open slot');
          if (!occupied && position>0 && position<=1000) {
            const choice = document.createElement('button');
            choice.type = 'button';
            choice.textContent = `${number} · ${name}${slot.title?' · Open':''}`;
            choice.addEventListener('click', () => {
              volume.value = String(position);
              for(const old of list.querySelectorAll('[aria-pressed=true]'))old.setAttribute('aria-pressed','false');
              choice.setAttribute('aria-pressed','true');
              status.textContent = `${number} selected.`;
            });
            choice.setAttribute('aria-pressed','false');
            item.append(choice);
          } else item.textContent = `${number} · ${name}${slot.held===false&&occupied?' · Linked, not owned':''}`;
          list.append(item);
        }
        if (slots.length) preview.append(list);
        previewRun = run.id;
        volume.disabled = button.disabled = false;
      } catch (error) {
        if(requested.isConnected)requested.textContent = 'Could not load series slots. Choose the series again to retry.';
      }
    }
    select.addEventListener('change',showSlots);
    const base = seriesPath({id:book.libraryId});
    const refsPath = `/libraries/${encodeURIComponent(book.libraryId)}/books/${encodeURIComponent(book.id)}/series`;
    let runs = [], refs = [];
    const availableRuns = () => runs.filter(run => !refs.some(ref => ref.series_id === run.id));
    const refreshSuggestions = () => {
      const available = availableRuns();
      const recommended = suggestSeriesByAuthor(book,available);
      suggestions.hidden = !recommended.length;
      choices.replaceChildren(...recommended.map(run=>{
        const pick = document.createElement('button');
        pick.type='button';
        pick.dataset.series=run.id;
        pick.textContent=run.name;
        pick.setAttribute('aria-pressed',String(select.value===run.id));
        pick.addEventListener('click',()=>{
          if (select.disabled) return;
          select.value=run.id;
          showSlots();
        });
        return pick;
      }));
    };
    const refreshControls = () => {
      const available = availableRuns();
      select.replaceChildren(new Option(pendingPanel?'No series':'Choose a series', ''), ...available.map(run => new Option(run.name, run.id)));
      refreshSuggestions();
      select.disabled = !available.length;
      volume.disabled = button.disabled = true;
      preview.hidden = true;
      preview.replaceChildren();
      previewRun = '';
      membership.textContent = refs.length
        ? 'In series: ' + refs.map(ref => ref.series_name + (ref.position > 0 ? ` (vol. ${ref.position})` : '')).join(', ')
        : pendingPanel ? 'Choose a series and volume to link this book when you save.' : 'This book is not linked to a series yet.';
      return available.length;
    };
    try {
      [runs, refs] = await Promise.all([api(base).then(requireList), pendingPanel ? [] : api(refsPath).then(requireList)]);
      if (!panel.isConnected || !modal.open) return;
      runs.sort((a,b)=>String(a.name).localeCompare(String(b.name)));
      status.textContent = refreshControls() ? '' : runs.length
        ? 'This book is already linked to every series in this library.'
        : 'This library has no saved series yet.';
    } catch (error) {
      status.textContent = 'Could not load series. ' + error.message;
      return;
    }
    if(pendingPanel){
      const form=panel.closest('form');
      form.addEventListener('input',event=>{if(panel.isConnected&&event.target.name==='author')refreshSuggestions();});
      panel.closest('details').addEventListener('toggle',()=>{if(panel.isConnected)refreshSuggestions();});
    }
    const creator = panel.querySelector('.inlineSeriesCreate');
    const createButton = creator.querySelector('#inlineSeriesSave');
    const createStatus = creator.querySelector('#inlineSeriesMessage');
    const nameField = creator.querySelector('#inlineSeriesName');
    const countField = creator.querySelector('#inlineSeriesCount');
    const suggestButton = creator.querySelector('#suggestSeriesFromBook');
    const aiSuggestion = creator.querySelector('.inlineSeriesSuggestion');
    suggestButton.addEventListener('click', async()=>{
      const form = document.getElementById('bookForm');
      const title = form.elements.title.value.trim();
      if(!title){createStatus.textContent='Enter a book title first.';return;}
      suggestButton.disabled=true;
      aiSuggestion.hidden=false;
      aiSuggestion.textContent='Checking the book context with Ollama…';
      const authorMatches=suggestSeriesByAuthor(book,runs);
      const context={
        title,author:form.elements.author.value.trim(),subtitle:book.raw.subtitle||'',
        description:book.raw.description||'',isbn:book.raw.isbn_13||book.raw.isbn_10||'',
        existing:[...new Set([...authorMatches,...runs.filter(run=>
          seriesNameKey(run.name).length>=4&&seriesNameKey(title).includes(seriesNameKey(run.name)))
        ].map(run=>run.name))],
      };
      try{
        const known = (await Promise.all(authorMatches.map(async run=>{
          try{
            const volumes=requireList(await api(`${base}/${encodeURIComponent(run.id)}/volumes`));
            return volumes.some(volume=>seriesNameKey(volume.title)===seriesNameKey(title))?run:null;
          }catch{return null;}
        }))).filter(Boolean);
        let result, verified=false;
        if(known.length===1){
          result={name:known[0].name,reason:'This title is listed in the saved volume list.'};
          verified=true;
        }else{
          const response=await session.request('/series-assistant/suggest-series',{
            method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(context),
          });
          try{result=await response.json();}catch{throw Error('Series Assistant could not be reached. Check that your MacBook is online.');}
          if(!response.ok)throw Error(result.error||'Could not get a series suggestion.');
        }
        if(!panel.isConnected||!modal.open)return;
        aiSuggestion.replaceChildren();
        const info=document.createElement('p');
        const name=typeof result.name==='string'?result.name.trim():'';
        if(!name){info.textContent='No confident suggestion. You can still enter a series name yourself.';aiSuggestion.append(info);return;}
        info.textContent=(verified?'Saved volume list match: ':'Ollama suggestion (unverified): ')+name+(result.reason?' · '+result.reason:'');
        aiSuggestion.append(info);
        const matching=runs.filter(run=>seriesNameKey(run.name)===seriesNameKey(name));
        if(matching.length>1){const note=document.createElement('p');note.textContent='More than one existing series has this name. Choose the right one in the dropdown.';aiSuggestion.append(note);return;}
        if(matching.length===1&&refs.some(ref=>ref.series_id===matching[0].id)){
          const note=document.createElement('p');note.textContent='This book is already linked to that series.';aiSuggestion.append(note);return;
        }
        const use=document.createElement('button');use.type='button';
        use.textContent=matching.length?'Select existing series':'Use suggested name';
        use.addEventListener('click',()=>{
          if(matching.length){
            if(![...select.options].some(option=>option.value===matching[0].id))return;
            creator.open=false;select.value=matching[0].id;showSlots();
          }else{nameField.value=name;nameField.focus();}
        });
        aiSuggestion.append(use);
      }catch(error){aiSuggestion.textContent=error.message;}
      finally{suggestButton.disabled=false;}
    });
    creator.addEventListener('keydown', event=>{
      if(event.key==='Enter'&&event.target.tagName==='INPUT'){
        event.preventDefault();
        createButton.click();
      }
    });
    createButton.addEventListener('click',async()=>{
      const lib=state.libraries.find(item=>item.id===book.libraryId);
      const name=nameField.value.trim().replace(/\s+/g,' ');
      const count=countField.value.trim();
      if(!lib||!name){createStatus.textContent='Enter a series name.';nameField.focus();return;}
      if(count&&(!/^\d+$/.test(count)||Number(count)<1||Number(count)>1000)){
        createStatus.textContent='Enter a whole volume count from 1 to 1000.';countField.focus();return;
      }
      const fields=[...creator.querySelectorAll('button,input,select,textarea')];
      const payload={name,status:creator.querySelector('#inlineSeriesStatus').value,
        description:creator.querySelector('#inlineSeriesDescription').value.trim()};
      if(count)payload.total_count=Number(count);
      fields.forEach(field=>{field.disabled=true;});createStatus.textContent='Creating series…';
      try{
        const created=await createSavedSeries(lib,payload);
        seriesRequest=null;
        if(!panel.isConnected||!modal.open)return;
        runs.push(created);
        runs.sort((a,b)=>String(a.name).localeCompare(String(b.name)));
        refreshControls();
        creator.open=false;
        nameField.value=countField.value=creator.querySelector('#inlineSeriesDescription').value='';
        createStatus.textContent='';
        aiSuggestion.hidden=true;aiSuggestion.replaceChildren();
        select.value=created.id;
        await showSlots();
        if(previewRun===created.id)status.textContent=`Created ${created.name}. Choose a volume to add this book.`;
      }catch(error){createStatus.textContent=error.message;}
      finally{fields.forEach(field=>{field.disabled=false;});}
    });

    if(pendingPanel)return;
    button.addEventListener('click', async () => {
      if (book.standalone) {
        status.textContent = 'Uncheck Mark as standalone and save the book before adding it to a series.';
        return;
      }
      const run = runs.find(item => item.id === select.value);
      const position = Number(volume.value);
      if (!run || previewRun !== run.id) { status.textContent = 'Choose a series and wait for its volume slots to load.'; select.focus(); return; }
      if (!Number.isFinite(position) || position <= 0 || position > 1000) {
        status.textContent = 'Enter a volume number greater than 0 and no higher than 1000.';
        volume.focus(); return;
      }
      select.disabled = volume.disabled = button.disabled = true;
      status.textContent = 'Adding to series…';
      try {
        refs = requireList(await api(refsPath));
        if (!refs.some(ref => ref.series_id === run.id)) {
          const current = requireList(await api(`${base}/${encodeURIComponent(run.id)}/books`));
          const existing = occupies(current,position);
          if (existing) throw new Error(`Volume ${position} is already linked to ${existing.title || 'another book'}. Choose an open slot.`);
          await api(`${base}/${encodeURIComponent(run.id)}/books`, {
            method:'POST', body:JSON.stringify({book_id:book.id,position}),
          });
          refs = requireList(await api(refsPath));
          if (!refs.some(ref => ref.series_id === run.id)) throw new Error('Librarium did not confirm the link. Reopen Edit book to check.');
          status.textContent = `Added to ${run.name}.`;
        } else status.textContent = `This book is already in ${run.name}.`;
        book.raw.series = refs;
        seriesRequest = null;
        liveSeries = [];
        seriesLoading = false;
        volume.value = '';
        refreshControls();
        render();
      } catch (error) {
        status.textContent = error.message;
        select.disabled = volume.disabled = button.disabled = false;
      }
    });
  }

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
    document.getElementById('cancelMoveBook').addEventListener('click', () => openBook(book.id,'',book.libraryId));
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

  async function resolveAuthor(name,role='author') {
    const query=name.trim();
    if(!query)throw Error('Enter an author name.');
    const path='/contributors';
    const find=async()=>{
      const rows=requireList(await api(path+'?q='+encodeURIComponent(query)));
      return rows.find(c=>c?.id&&String(c.name||'').trim().toLowerCase()===query.toLowerCase());
    };
    let contributor=await find();
    if(!contributor){
      try{contributor=await api(path,{method:'POST',body:JSON.stringify({name:query})});}
      catch(error){contributor=await find();if(!contributor)throw error;}
    }
    if(!contributor?.id)throw Error('Librarium did not return an author record.');
    return {contributor_id:contributor.id,role};
  }

  window.saveBook = async function (id) {
    const form = document.getElementById('bookForm');
    if(!form||form.dataset.saving==='true')return;
    const fields = new FormData(form), data = Object.fromEntries(fields);
    const status=form.querySelector('#bookSaveStatus'), submit=form.querySelector('.actions button.primary');
    if(!id&&!data.mediaTypeId){status.textContent='Choose a media type first.';return;}
    form.dataset.saving='true';submit.disabled=true;status.textContent='Saving…';
    let createdBook=false;
    try {
      if (id) {
        const book = books.find(b => b.id === id && b.libraryId === form.dataset.libraryId);
        const marker = form.elements.standalone;
        const changeMarker = marker && !marker.disabled && marker.checked !== book.standalone;
        const bookPath = `/libraries/${encodeURIComponent(book.libraryId)}/books/${encodeURIComponent(id)}`;
        const raw = changeMarker ? await api(bookPath) : book.raw;
        const tags = raw.tags || [];
        let tagIDs = tags.map(t=>t.id);
        if (changeMarker) {
          if (marker.checked && raw.series?.length) throw new Error('This book already belongs to a series.');
          tagIDs = tags.filter(t=>!isStandaloneTag(t)).map(t=>t.id);
          if (marker.checked) tagIDs.push((await standaloneTag(book.libraryId)).id);
        }
        const contributors = data.author.trim() === book.author ? raw.contributors : [
          ...(raw.contributors || []).filter(c => c.role && c.role !== 'author'),
          await resolveAuthor(data.author)
        ];
        await api(bookPath, { method: 'PUT', body: JSON.stringify({ title: data.title.trim(), subtitle: raw.subtitle || '', description: raw.description || '', media_type_id: raw.media_type_id, contributors, genre_ids: (raw.genres || []).map(x => x.id), tag_ids: [...new Set(tagIDs)] }) });
        await setShelf(book, data.shelf);
      } else {
        const lib = state.libraries.find(l => l.id === data.libraryId);
        if(!lib)throw Error('Choose a library.');
        if(data.shelf && !(state.shelves.get(lib.id)||[]).some(s=>s.name.toUpperCase()===data.shelf.toUpperCase()))
          throw Error(`Shelf ${data.shelf} does not exist in ${lib.name}. Choose another shelf or leave the book unshelved.`);
        let seriesLink=null;
        if(data.seriesId){
          const position=Number(form.elements.seriesPosition?.value);
          if(!Number.isFinite(position)||position<=0||position>1000)throw Error('Enter a series volume number greater than 0 and no higher than 1000.');
          seriesLink={position,url:seriesPath(lib)+'/'+encodeURIComponent(data.seriesId)+'/books'};
          const linked=requireList(await api(seriesLink.url));
          if(seriesVolumeOccupied(linked,position))throw Error(`Volume ${position} is already linked to another book. Choose an open volume.`);
        }
        const edition=bookEdition(data);
        const contributors=[];
        if(data.author.trim())contributors.push(await resolveAuthor(data.author));
        const names=fields.getAll('contributorName'),roles=fields.getAll('contributorRole');
        for(let i=0;i<names.length;i++)if(names[i].trim()){
          const person=await resolveAuthor(names[i],roles[i]);
          if(!contributors.some(c=>c.contributor_id===person.contributor_id&&c.role===person.role))contributors.push(person);
        }
        const tagIDs=fields.getAll('tagId');
        if(data.newTag.trim()){
          const tagPath=`/libraries/${encodeURIComponent(lib.id)}/tags`;
          const name=data.newTag.trim(), tags=requireList(await api(tagPath));
          const tag=tags.find(t=>String(t.name).toLowerCase()===name.toLowerCase())||
            await api(tagPath,{method:'POST',body:JSON.stringify({name,color:'#2e5848'})});
          if(!tag?.id)throw Error('Librarium did not confirm the new tag.');
          tagIDs.push(tag.id);
        }
        const payload={title:data.title.trim(),subtitle:data.subtitle.trim(),description:data.description.trim(),
          media_type_id:data.mediaTypeId,contributors,genre_ids:fields.getAll('genreId'),tag_ids:[...new Set(tagIDs)]};
        if(edition)payload.edition=edition;
        const created = await api(`/libraries/${encodeURIComponent(lib.id)}/books`, {
          method:'POST',body:JSON.stringify(payload),
        });
        if(!created?.id)throw Error('Librarium did not confirm the new book. Check the catalogue before retrying.');
        createdBook=true;
        const sideEffects=[];
        if(seriesLink)sideEffects.push(api(seriesLink.url,{method:'POST',body:JSON.stringify({book_id:created.id,position:seriesLink.position})})
          .finally(()=>{seriesRequest=null;liveSeries=[];seriesLoading=false;}));
        if(data.shelf)sideEffects.push(setShelf(normaliseBook(created,lib),data.shelf));
        if(data.importCover==='on'&&form.dataset.lookupCover)sideEffects.push(api(
          `/libraries/${encodeURIComponent(lib.id)}/books/${encodeURIComponent(created.id)}/cover/fetch`,
          {method:'POST',body:JSON.stringify({url:form.dataset.lookupCover})}));
        const followUp=await Promise.allSettled(sideEffects);
        if(followUp.some(r=>r.status==='rejected'))throw Error('Some optional details could not be applied.');
        owner=lib.name;
      }
      modal.close(); await loadLive(); toast('Saved to the live Librarium database');
    } catch (error) {
      if(createdBook){
        status.textContent='The book was created, but some optional updates or the catalogue refresh failed. Close this form and refresh before trying again.';
        toast(status.textContent);
      }else status.textContent=error.message;
    } finally {
      form.dataset.saving=String(createdBook);
      if(!createdBook)submit.disabled=false;
    }

  };

  window.confirmDelete = function (id, lib = '') { const b = books.find(x => x.id === id && (!lib || x.libraryId === lib)); show(`<h2>Remove from ${esc(b.owner)}?</h2><p style="margin-top:15px">This retires that library’s copy of “${esc(b.title)}”.</p><div class="actions"><button onclick="openBook('${id}','','${b.libraryId}')">Cancel</button><button class="danger" onclick="deleteBook('${id}','${b.libraryId}')">Remove copy</button></div>`); };
  window.deleteBook = async function (id, lib = '') { const b = books.find(x => x.id === id && (!lib || x.libraryId === lib)); try { await api(`/libraries/${b.libraryId}/books/${id}`, { method: 'DELETE' }); modal.close(); await loadLive(); } catch (error) { toast(error.message); } };

  const baseComplete = window.completeSortMove;
  window.completeSortMove = async function (id, checked) {
    const move = sortPlan?.moves.find(m => m.id === id); const book = move?.kind === 'book' ? books.find(b => b.id === move.bookId) : null;
    if (book) { try { await setShelf(book, move.to); } catch (error) { toast(error.message); render(); return; } }
    baseComplete(id, checked);
    if (book) await loadLive();
  };

  Promise.resolve().then(() => session.restore()).then(token => token ? loadLive() : loginScreen()).catch(error => loginScreen(error.message));
})();

