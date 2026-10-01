'use strict';

/** Converts a glob (`*`, `**`, `?`) into a RegExp matching a '/'-separated relative path. */
function globToRegExp(glob) {
  let g = String(glob).trim().replace(/\\/g, '/').replace(/^\.\//, '');
  const anchored = g.startsWith('/');
  if (anchored) g = g.slice(1);
  // like .gitignore: a slash only at the end does not anchor the pattern
  const hasInnerSlash = g.replace(/\/+$/, '').includes('/');
  if (g.endsWith('/')) g += '**';
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*') {
      if (g[i + 1] === '*') {
        re += g[i + 2] === '/' ? '(?:.*/)?' : '.*';
        i += g[i + 2] === '/' ? 2 : 1;
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  // patterns without a slash match the name anywhere, like .gitignore
  const prefix = anchored || hasInnerSlash ? '^' : '(?:^|/)';
  return new RegExp(prefix + re + '(?:/.*)?$', 'i');
}

module.exports = { globToRegExp };
