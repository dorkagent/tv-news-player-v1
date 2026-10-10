/* =====================================================================
   Captions — fetch, parse and index the Archive's closed captions.

   How the Archive exposes them (verified Oct 2026):
   - Each TV item carries `<id>.cc5.srt` (the broadcast's own CC, with ">>"
     speaker changes) and usually `<id>.align.srt` (the same words, re-timed
     to the audio — much tighter sync). Both are flagged private, so the
     plain /download/ URL returns an empty body.
   - The item's datanode (`https://{server}{dir}/{file}`) serves the WHOLE
     SRT, with `Access-Control-Allow-Origin: *`, as long as the request
     carries a clip window (`?start=0&end=300`; the window must be between
     a few seconds and ~6 minutes, otherwise 403). Timestamps in that file
     are absolute (seconds from the start of the broadcast), which is
     exactly what a stitched timeline needs.
   No relay or server needed.
   ===================================================================== */
(function () {
  'use strict';

  const TRACK_LABELS = { align: 'Synced', cc5: 'Broadcast CC' };

  /** Pick caption files from an item's metadata `files` list, best first. */
  function captionFiles(files) {
    const srt = files.filter(f => /\.srt$/i.test(f.name));
    const rank = n => /\.align\.srt$/i.test(n) ? 0 : /\.cc5\.srt$/i.test(n) ? 1 : 2;
    return srt
      .sort((a, b) => rank(a.name) - rank(b.name))
      .map(f => {
        const m = f.name.match(/\.([a-z0-9]+)\.srt$/i);
        const key = m ? m[1].toLowerCase() : 'srt';
        return { name: f.name, key, label: TRACK_LABELS[key] || key.toUpperCase() };
      });
  }

  function candidateUrls(meta, fileName) {
    const hosts = [meta.server, meta.d1, meta.d2].filter(Boolean);
    const uniq = [...new Set(hosts)];
    const path = `${meta.dir}/${encodeURIComponent(fileName)}?start=0&end=300`;
    return uniq.map(h => `https://${h}${path}`);
  }

  async function fetchCaptions(meta, file, signal) {
    let lastErr;
    for (const url of candidateUrls(meta, file.name)) {
      try {
        const res = await fetch(url, { signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        if (!text.includes('-->')) throw new Error('not an SRT');
        const cues = parseSrt(text);
        if (!cues.length) throw new Error('empty SRT');
        return cues;
      } catch (e) {
        if (e.name === 'AbortError') throw e;
        lastErr = e;
      }
    }
    throw lastErr || new Error('no caption host');
  }

  const TS = /(\d+):(\d{2}):(\d{2})[,.](\d{1,3})/;
  const toSec = m => (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4].padEnd(3, '0')) / 1000;

  function parseSrt(text) {
    const out = [];
    const blocks = text.replace(/^\uFEFF/, '').replace(/\r/g, '').split(/\n{2,}/);
    for (const b of blocks) {
      const lines = b.split('\n').filter(Boolean);
      const i = lines.findIndex(l => l.includes('-->'));
      if (i < 0) continue;
      const [a, z] = lines[i].split('-->');
      const ma = a.match(TS), mz = z.match(TS);
      if (!ma || !mz) continue;
      const body = lines.slice(i + 1).join('\n').replace(/<[^>]+>/g, '').trim();
      if (!body) continue;
      out.push({ start: toSec(ma), end: Math.max(toSec(mz), toSec(ma) + 0.2), text: body });
    }
    out.sort((x, y) => x.start - y.start);
    return out;
  }

  /** ALL-CAPS caption text → readable sentence case (for the transcript). */
  function softenCase(s) {
    const letters = s.replace(/[^a-z]/gi, '');
    if (!letters || letters !== letters.toUpperCase()) return s;
    let t = s.toLowerCase();
    t = t.replace(/(^|[.!?]\s+|>>\s*)([a-z])/g, (m, p, c) => p + c.toUpperCase());
    t = t.replace(/\bi\b/g, 'I').replace(/\bi'(m|ve|ll|d)\b/g, "I'$1");
    return t;
  }

  /** Index of the last cue starting at or before t (binary search). */
  function cueIndexAt(cues, t) {
    let lo = 0, hi = cues.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (cues[mid].start <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return ans;
  }

  /**
   * What the on-screen box should show at time t.
   * Aligned tracks are word-group fragments, so we roll up the last couple
   * of fragments into two short lines, like broadcast roll-up captions.
   */
  function overlayText(cues, t, holdSec = 2.5, maxChars = 84) {
    const i = cueIndexAt(cues, t);
    if (i < 0) return '';
    const cur = cues[i];
    if (t > cur.end + holdSec) return '';
    const parts = [];
    let len = 0;
    for (let j = i; j >= 0 && j > i - 6; j--) {
      const c = cues[j];
      if (j < i && cues[j + 1].start - c.end > 1.5) break; // a pause: start fresh
      const txt = c.text.replace(/\n/g, ' ');
      if (len + txt.length > maxChars && parts.length) break;
      parts.unshift(txt); len += txt.length + 1;
      if (txt.startsWith('>>')) break; // new speaker begins a new block
    }
    return wrap(parts.join(' '), Math.floor(maxChars / 2));
  }

  function wrap(s, width) {
    const words = s.split(/\s+/); const lines = []; let line = '';
    for (const w of words) {
      if ((line + ' ' + w).trim().length > width && line) { lines.push(line); line = w; }
      else line = (line + ' ' + w).trim();
    }
    if (line) lines.push(line);
    return lines.slice(-2).join('\n');
  }

  /** Group cues into readable transcript paragraphs. */
  function paragraphs(cues) {
    const paras = [];
    let cur = null;
    for (const c of cues) {
      const text = c.text.replace(/\n/g, ' ');
      const newSpeaker = text.startsWith('>>');
      const gap = cur ? c.start - cur.end : 0;
      if (!cur || newSpeaker || gap > 2.2 || (c.start - cur.start > 20)) {
        cur = { start: c.start, end: c.end, text: '', speaker: newSpeaker };
        paras.push(cur);
      }
      cur.text += (cur.text ? ' ' : '') + text.replace(/^>>\s*/, '');
      cur.end = c.end;
    }
    paras.forEach(p => { p.text = softenCase(p.text); });
    return paras;
  }

  window.Captions = { captionFiles, fetchCaptions, parseSrt, overlayText, paragraphs, cueIndexAt, softenCase };
})();
