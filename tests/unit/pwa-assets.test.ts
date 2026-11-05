import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('offers a standalone manifest with valid install icons', () => {
  const manifest = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8')) as {
    start_url:string;display:string;icons:{src:string;sizes:string}[];
  };
  expect(manifest.start_url).toBe('/');
  expect(manifest.display).toBe('standalone');
  for (const icon of manifest.icons) {
    const bytes = readFileSync(`public${icon.src}`);
    expect(bytes.subarray(0,8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(`${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`).toBe(icon.sizes);
  }
});

it('exposes install metadata without caching private multiplayer responses', () => {
  expect(readFileSync('index.html','utf8')).toContain('href="/manifest.webmanifest"');
  expect(readFileSync('index.html','utf8')).toContain('rel="apple-touch-icon"');
  const sw = readFileSync('public/sw.js','utf8');
  expect(sw).toContain('respondWith(fetch(event.request))');
  expect(sw).not.toContain('caches.open');
});
