const { allowedNavigation } = require('./runtime.cjs');
function createNotificationPolicy({ getOrigin, getContents, confirm }) {
  const allowed = new Set(); let pending = false;
  const current = () => {
    try { const origin = getOrigin(); const contents = getContents(); return origin && contents && !contents.isDestroyed?.() && allowedNavigation(contents.getURL(), origin) ? { origin, contents } : null; } catch { return null; }
  };
  const check = (contents, permission, requestingOrigin, details = {}) => {
    const state = current();
    return Boolean(permission === 'notifications' && state && allowed.has(state.origin) && allowedNavigation(requestingOrigin, state.origin) && (!contents || (contents === state.contents && details.isMainFrame === true)) && (!details.embeddingOrigin || allowedNavigation(details.embeddingOrigin, state.origin)));
  };
  const request = async (contents, permission, callback, details = {}) => {
    const state = current();
    if (permission !== 'notifications' || !state || contents !== state.contents || details.isMainFrame !== true || !allowedNavigation(details.requestingUrl, state.origin)) { callback(false); return; }
    if (allowed.has(state.origin)) { callback(true); return; }
    if (pending) { callback(false); return; } pending = true;
    try {
      const consent = await confirm(); const latest = current();
      const granted = Boolean(consent && latest && latest.origin === state.origin && latest.contents === contents);
      if (granted) allowed.add(state.origin); callback(granted);
    } catch { callback(false); }
    finally { pending = false; }
  };
  return { check, request };
}
module.exports = { createNotificationPolicy };
