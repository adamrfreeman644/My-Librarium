'use strict';
window.LibrariumSession = (() => {
  const ACCESS = 'librarium-access';
  const REFRESH = 'librarium-remember-refresh';
  let pending, generation = 0;
  const get = (storage, key) => {
    try { return storage.getItem(key) || ''; } catch { return ''; }
  };
  const put = (storage, key, value) => {
    try {
      if (value) storage.setItem(key, value); else storage.removeItem(key);
      return true;
    } catch { return false; }
  };
  const access = () => {
    const value = get(sessionStorage, ACCESS);
    return ['undefined', 'null'].includes(value) ? '' : value;
  };
  const remembered = () => Boolean(get(localStorage, REFRESH));
  const clear = () => {
    generation++;
    put(sessionStorage, ACCESS, '');
    put(localStorage, REFRESH, '');
  };
  const signIn = (data, remember) => {
    generation++;
    put(sessionStorage, ACCESS, data.access_token);
    return put(localStorage, REFRESH, remember ? data.refresh_token || '' : '') &&
      (!remember || Boolean(data.refresh_token));
  };
  const refresh = (rejected = '') => {
    if (pending) return pending;
    const attempt = generation;
    const run = async () => {
      if (attempt !== generation) return '';
      const current = access();
      if (current && current !== rejected) return current;
      const old = get(localStorage, REFRESH);
      if (!old) return '';
      const response = await fetch('/api/v1/auth/refresh', {
        method: 'POST', redirect: 'error',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({refresh_token: old})
      });
      if (attempt !== generation || get(localStorage, REFRESH) !== old) return '';
      if (response.status === 401 || response.status === 400) {
        clear();
        return '';
      }
      if (!response.ok) throw new Error('Could not restore your session. Try refreshing the page.');
      const payload = await response.json(), data = payload.data ?? payload;
      if (attempt !== generation || get(localStorage, REFRESH) !== old) return '';
      if (typeof data?.access_token !== 'string' || !data.access_token ||
          typeof data.refresh_token !== 'string' || !data.refresh_token)
        throw new Error('Librarium did not return a refreshed session.');
      if (!put(localStorage, REFRESH, data.refresh_token))
        throw new Error('This browser could not save your refreshed session.');
      put(sessionStorage, ACCESS, data.access_token);
      return data.access_token;
    };
    pending = (navigator.locks ? navigator.locks.request(REFRESH, run) : run())
      .finally(() => { pending = null; });
    return pending;
  };
  const request = async (path, options = {}) => {
    const url = new URL(path, location.origin);
    if (url.origin !== location.origin || !/^\/(api\/v1|series-assistant)\//.test(url.pathname))
      throw new Error('Unrecognized Librarium address.');
    const login = url.pathname === '/api/v1/auth/login';
    let current = login ? '' : access();
    if (!login && !current && remembered()) current = await refresh();
    const send = token => {
      const headers = new Headers(options.headers);
      if (token) headers.set('Authorization', 'Bearer ' + token);
      return fetch(url, {...options, headers, redirect:'error'});
    };
    let response = await send(current);
    if (response.status === 401 && !login && current && remembered()) {
      const next = await refresh(current);
      if (next) response = await send(next);
    }
    return response;
  };
  addEventListener('storage', event => {
    if (event.key === REFRESH && event.oldValue && event.newValue === null) {
      generation++;
      put(sessionStorage, ACCESS, '');
      location.reload();
    }
  });
  return {access, remembered, signIn, clear, request, restore: () => access() || refresh()};
})();
