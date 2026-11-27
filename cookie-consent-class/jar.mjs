// One browser's cookie store, seen through the document.cookie of each host's pages: a Domain must cover the host and must
// not be a public suffix (else the cookie is dropped), Max-Age 0 removes, a rewrite keeps the first creation time, and
// cookies are listed longest path first, then oldest first.
export function createBrowser({ publicSuffixes = [] } = {}) {
  const store = new Map();
  let created = 0;
  let clock = 0;
  return {
    advance(seconds) { clock += seconds; },
    page(host) {
      const covers = (domain) => host === domain || host.endsWith('.' + domain);
      return {
        get cookie() {
          return [...store.values()]
            .filter((item) => item.expires > clock && (item.hostOnly ? item.domain === host : covers(item.domain)))
            .sort((a, b) => b.path.length - a.path.length || a.created - b.created)
            .map((item) => `${item.name}=${item.value}`).join('; ');
        },
        set cookie(text) {
          const [pair, ...attributes] = text.split(';').map((part) => part.trim());
          const at = pair.indexOf('=');
          let domain = null;
          let path = '/';
          let maxAge = Infinity;
          for (const attribute of attributes) {
            const [key, ...rest] = attribute.split('=');
            const argument = rest.join('=');
            if (key.toLowerCase() === 'domain') domain = argument.replace(/^\./, '').toLowerCase();
            if (key.toLowerCase() === 'path') path = argument;
            if (key.toLowerCase() === 'max-age') maxAge = Number(argument);
          }
          if (domain !== null && (!covers(domain) || publicSuffixes.includes(domain))) return;
          const name = pair.slice(0, at);
          const key = `${name}|${domain ?? 'host:' + host}|${path}`;
          if (maxAge <= 0) { store.delete(key); return; }
          const old = store.get(key);
          store.set(key, { name, value: pair.slice(at + 1), domain: domain ?? host, hostOnly: domain === null, path,
            created: old ? old.created : created++, expires: clock + maxAge });
        },
      };
    },
  };
}
