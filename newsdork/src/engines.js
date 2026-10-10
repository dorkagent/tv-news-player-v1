/* =====================================================================
   Playback engines. Both expose the same surface:

     load({ id, file, duration, startAt, autoplay })
     play() / pause() / seek(t) / destroy()
     setVolume(volume, muted)
     .time  .paused  .duration  .name
     ranges()  -> [[start, end], ...] loaded chunks on the global timeline

   and report through hooks:
     onTime(t) onPlaying(bool) onWaiting(bool) onEnded() onError(msg) onRanges()

   StreamEngine  — ONE <video>, ONE continuous timeline. Fetches the
                   broadcast in 2-minute clips (archive.org ?exact=1&start&end),
                   repackages each clip to fragmented MP4 in the browser with
                   mp4box.js, and appends it into a MediaSource at the right
                   offset. Native seeking, buffering, fullscreen.
   SegmentEngine — fallback for browsers without MSE (iPhone Safari < 17.1):
                   the original dual-<video> handoff, cleaned up.
   ===================================================================== */
(function () {
  'use strict';

  const DL = 'https://archive.org/download/';
  const clipUrl = (id, file, s, e) =>
    `${DL}${id}/${encodeURIComponent(file)}?exact=1&start=${+s.toFixed(3)}&end=${+e.toFixed(3)}`;
  const MS = window.ManagedMediaSource || window.MediaSource;

  /* ------------------------------------------------------------------ */
  class StreamEngine {
    static supported() {
      return !!(MS && window.MP4Box && MS.isTypeSupported &&
        MS.isTypeSupported('video/mp4; codecs="avc1.640020"') &&
        window.ReadableStream && window.AbortController);
    }

    constructor(video, hooks) {
      this.name = 'stream';
      this.v = video;
      this.h = hooks;
      this.CHUNK = 120;      // seconds per fetched clip
      this.AHEAD = 50;       // start the next fetch when this little is buffered ahead
      this.BEHIND = 30;      // keep this much behind the playhead
      this.MAX_QUEUED = 24e6; // bytes waiting to be appended before we stop reading the network
      this.gen = 0;
      this.chunks = [];
      video.classList.add('is-active');
      this._on = {
        timeupdate: () => this._tick(),
        playing: () => { this.h.onWaiting(false); this.h.onPlaying(true); },
        pause: () => this.h.onPlaying(false),
        waiting: () => { this.h.onWaiting(true); this._watchStall(); },
        canplay: () => this.h.onWaiting(false),
        seeking: () => this._onSeeking(),
        ended: () => this.h.onEnded(),
        loadedmetadata: () => this._onMeta(),
        error: () => { if (this.ms) this.h.onError('The video decoder reported an error.'); }
      };
      for (const [k, fn] of Object.entries(this._on)) video.addEventListener(k, fn);
    }

    get time() { return this.v.currentTime || 0; }
    get paused() { return this.v.paused; }
    get duration() { return this.dur || 0; }

    load({ id, file, duration, startAt = 0, autoplay = true }) {
      this._teardownSource();
      this.id = id; this.file = file; this.dur = duration;
      this.startAt = Math.max(0, Math.min(startAt, duration - 1));
      this.autoplay = autoplay;
      this.nextStart = Math.floor(this.startAt);
      this.chunks = [];
      this.retries = 0;
      this.sbs = {};
      this.ms = new MS();
      if (window.ManagedMediaSource && MS === window.ManagedMediaSource) this.v.disableRemotePlayback = true;
      this.objUrl = URL.createObjectURL(this.ms);
      this.v.src = this.objUrl;
      this.h.onWaiting(true);
      this.ms.addEventListener('sourceopen', () => {
        try { this.ms.duration = duration; } catch (e) { /* ignore */ }
        this._schedule(true);
      }, { once: true });
    }

    _onMeta() {
      if (this.startAt > 0) { try { this.v.currentTime = this.startAt; } catch (e) {} }
      if (this.autoplay) this.play();
    }

    play() { const p = this.v.play(); if (p) p.catch(() => this.h.onPlaying(false)); }
    pause() { this.v.pause(); }
    seek(t) {
      if (!this.dur) return;
      this.v.currentTime = Math.max(0, Math.min(t, this.dur - 0.25));
    }
    setVolume(vol, muted) { this.v.volume = vol; this.v.muted = muted; }

    ranges() {
      const b = this.v.buffered, out = [];
      for (let i = 0; i < b.length; i++) out.push([b.start(i), b.end(i)]);
      // split buffered spans at chunk seams so the UI can show the chunks
      const seams = this.chunks.map(c => c[1]);
      const res = [];
      for (const [s, e] of out) {
        let a = s;
        for (const x of seams.filter(x => x > s + 1 && x < e - 1).sort((p, q) => p - q)) { res.push([a, x]); a = x; }
        res.push([a, e]);
      }
      return res;
    }

    destroy() {
      this._teardownSource();
      for (const [k, fn] of Object.entries(this._on)) this.v.removeEventListener(k, fn);
    }

    /* ---------------- internals ---------------- */
    _teardownSource() {
      this._abortFetch();
      clearTimeout(this._stallTimer);
      if (this.objUrl) { URL.revokeObjectURL(this.objUrl); this.objUrl = null; }
      this.ms = null; this.sbs = {};
      this.v.removeAttribute('src');
      try { this.v.load(); } catch (e) {}
    }

    _bufferedEndFrom(t) {
      const b = this.v.buffered;
      for (let i = 0; i < b.length; i++) if (b.start(i) - 0.3 <= t && t <= b.end(i)) return b.end(i);
      return t;
    }

    _tick() {
      this.h.onTime(this.v.currentTime);
      this._schedule(false);
      const now = performance.now();
      if (!this._lastEvict || now - this._lastEvict > 8000) {
        this._lastEvict = now;
        for (const e of Object.values(this.sbs)) this._evict(e, false);
      }
    }

    _onSeeking() {
      const t = this.v.currentTime;
      this.h.onTime(t);
      const bufferedAhead = this._bufferedEndFrom(t) - t;
      const insideCurrentFetch = this.fetching && this.cur && t >= this.cur.start - 0.5 && t < this.cur.end;
      if (bufferedAhead < 0.5 && !insideCurrentFetch) {
        this._abortFetch();
        this.nextStart = Math.max(0, Math.floor(t));
        this._schedule(true);
      } else {
        this._schedule(false);
      }
    }

    _schedule(force) {
      if (!this.ms || this.ms.readyState === 'closed' || this.fetching) return;
      const t = this.v.currentTime;
      const e = this._bufferedEndFrom(t);
      // playing back inside an older buffered island: continue from its end
      if (e > t + 0.5 && e < this.nextStart - 1) this.nextStart = Math.floor(e);
      if (this.nextStart >= this.dur - 0.25) { this._tryEnd(); return; }
      if (force || e - t < this.AHEAD) this._fetchClip(this.nextStart);
    }

    async _fetchClip(start) {
      let end = Math.min(start + this.CHUNK, this.dur);
      if (this.dur - end < 8) end = this.dur;          // never leave a tiny tail clip
      if (end - start < 3) start = Math.max(0, end - 3);
      const gen = this.gen;
      const ac = new AbortController();
      this.ac = ac;
      this.fetching = true;
      this.cur = { start, end };

      const mp4 = window.MP4Box.createFile();
      let failed = null;
      mp4.onError = (e) => { failed = new Error('mp4 parse: ' + e); };
      mp4.onReady = (info) => {
        const tracks = [...(info.videoTracks || []), ...(info.audioTracks || [])];
        for (const tr of tracks) {
          const kind = (info.videoTracks || []).includes(tr) ? 'video' : 'audio';
          const entry = this._ensureSb(kind, tr.codec);
          if (!entry) continue;
          mp4.setSegmentOptions(tr.id, entry, { nbSamples: kind === 'video' ? 90 : 140 });
        }
        for (const seg of mp4.initializeSegmentation()) this._enqueue(seg.user, { data: seg.buffer, offset: start, gen });
        mp4.start();
      };
      mp4.onSegment = (_id, entry, buffer) => { if (gen === this.gen) this._enqueue(entry, { data: buffer, gen }); };

      try {
        const res = await fetch(clipUrl(this.id, this.file, start, end), { signal: ac.signal });
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
        const reader = res.body.getReader();
        let pos = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (gen !== this.gen) { reader.cancel().catch(() => {}); return; }
          const ab = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
          ab.fileStart = pos; pos += ab.byteLength;
          mp4.appendBuffer(ab);
          if (failed) throw failed;
          await this._backpressure(gen);
        }
        mp4.flush();
        if (gen !== this.gen) return;
        if (!pos) throw new Error('empty clip');
        this.chunks.push([start, end]);
        this.nextStart = end;
        this.retries = 0;
        this.fetching = false;
        this.h.onRanges();
        this._schedule(false);
      } catch (e) {
        if (e.name === 'AbortError' || gen !== this.gen) return;
        this.fetching = false;
        console.warn('[stream] clip failed', start, end, e);
        if (++this.retries <= 3) {
          setTimeout(() => { if (gen === this.gen) this._schedule(true); }, 800 * this.retries);
        } else {
          this.h.onError(`Couldn't load the stream at ${Math.floor(start / 60)}:${String(Math.floor(start % 60)).padStart(2, '0')} (${e.message}).`);
        }
      }
    }

    _ensureSb(kind, codec) {
      if (this.sbs[kind]) return this.sbs[kind];
      const mime = `${kind}/mp4; codecs="${codec}"`;
      if (!MS.isTypeSupported(mime)) { console.warn('[stream] unsupported', mime); return null; }
      const sb = this.ms.addSourceBuffer(mime);
      sb.mode = 'segments';
      const entry = { kind, sb, q: [], bytes: 0, waiters: [] };
      sb.addEventListener('updateend', () => this._pump(entry));
      this.sbs[kind] = entry;
      return entry;
    }

    _enqueue(entry, item) {
      entry.q.push(item);
      entry.bytes += item.data.byteLength;
      this._pump(entry);
    }

    _pump(entry) {
      if (!this.ms || this.ms.readyState === 'closed') return;
      if (entry.sb.updating) return;
      while (entry.q.length && entry.q[0].gen !== this.gen) entry.bytes -= entry.q.shift().data.byteLength;
      if (!entry.q.length) { this._release(entry); this._tryEnd(); return; }
      const it = entry.q[0];
      try {
        if (it.offset != null && entry.sb.timestampOffset !== it.offset) entry.sb.timestampOffset = it.offset;
        entry.sb.appendBuffer(it.data);
        entry.q.shift();
        entry.bytes -= it.data.byteLength;
        if (entry.bytes < this.MAX_QUEUED / 2) this._release(entry);
      } catch (e) {
        if (e.name === 'QuotaExceededError') {
          if (!this._evict(entry, true)) setTimeout(() => this._pump(entry), 1000);
        } else {
          console.error('[stream] append', e);
          this.h.onError('The browser rejected a video chunk.');
        }
      }
    }

    _release(entry) { const w = entry.waiters; entry.waiters = []; w.forEach(r => r()); }

    async _backpressure(gen) {
      for (const entry of Object.values(this.sbs)) {
        while (gen === this.gen && entry.bytes > this.MAX_QUEUED) {
          await new Promise(r => entry.waiters.push(r));
        }
      }
    }

    _evict(entry, aggressive) {
      const sb = entry.sb;
      if (sb.updating || !this.ms || this.ms.readyState !== 'open') return false;
      const t = this.v.currentTime, b = sb.buffered;
      const keep = aggressive ? 4 : this.BEHIND;
      if (b.length && b.start(0) < t - keep - 1) { sb.remove(0, t - keep); return true; }
      if (aggressive && b.length && b.end(b.length - 1) > t + this.CHUNK * 2) {
        sb.remove(t + this.CHUNK * 2, Infinity); return true;
      }
      return false;
    }

    _abortFetch() {
      this.gen++;
      if (this.ac) { try { this.ac.abort(); } catch (e) {} }
      this.ac = null; this.fetching = false; this.cur = null;
      for (const entry of Object.values(this.sbs || {})) {
        entry.q = []; entry.bytes = 0; this._release(entry);
        if (this.ms && this.ms.readyState === 'open') { try { entry.sb.abort(); } catch (e) {} }
      }
    }

    _tryEnd() {
      if (!this.ms || this.ms.readyState !== 'open' || this.fetching) return;
      if (this.nextStart < this.dur - 0.25) return;
      for (const e of Object.values(this.sbs)) if (e.q.length || e.sb.updating) return;
      try { this.ms.endOfStream(); } catch (e) {}
    }

    _watchStall() {
      clearTimeout(this._stallTimer);
      this._stallTimer = setTimeout(() => {
        if (!this.ms || this.v.readyState >= 3) return;
        if (!this.fetching) { this.nextStart = Math.floor(this.v.currentTime); this._schedule(true); }
      }, 6000);
    }
  }

  /* ------------------------------------------------------------------ */
  class SegmentEngine {
    static supported() { return true; }

    constructor(videoA, videoB, hooks) {
      this.name = 'segments';
      this.SEG = 300;
      this.AHEAD = 25;
      this.h = hooks;
      this.a = videoA; this.b = videoB;
      this.active = videoA; this.stager = videoB;
      this.token = 0;
      this._handlers = [];
      for (const v of [videoA, videoB]) {
        const on = (k, fn) => { v.addEventListener(k, fn); this._handlers.push([v, k, fn]); };
        on('timeupdate', () => { if (v === this.active) this._tick(); });
        on('playing', () => { if (v === this.active) { this.h.onWaiting(false); this.h.onPlaying(true); } });
        on('pause', () => { if (v === this.active && !this._handing) this.h.onPlaying(false); });
        on('waiting', () => { if (v === this.active) this.h.onWaiting(true); });
        on('canplay', () => { if (v === this.active) this.h.onWaiting(false); });
        on('ended', () => { if (v === this.active) this._handoff(); });
        on('error', () => { if (v === this.active && v.getAttribute('src')) this._onError(); });
      }
    }

    get time() { return this.currentStart + (this.active.currentTime || 0); }
    get paused() { return this.active.paused; }
    get duration() { return this.dur || 0; }

    load({ id, file, duration, startAt = 0, autoplay = true }) {
      this.id = id; this.file = file; this.dur = duration;
      this.autoplay = autoplay; this.errors = 0;
      this._reset();
      this.seek(startAt);
    }

    _url(start) { return clipUrl(this.id, this.file, start, Math.min(start + this.SEG, this.dur)); }

    _reset() {
      this.token++;
      this.currentStart = 0; this.staged = null; this.stagedReady = false;
      for (const v of [this.a, this.b]) { v.oncanplay = null; v.pause(); v.removeAttribute('src'); v.load(); v.dataset.seg = ''; }
      this.active.classList.add('is-active'); this.stager.classList.remove('is-active');
    }

    play() { const p = this.active.play(); if (p) p.catch(() => this.h.onPlaying(false)); }
    pause() { this.active.pause(); }
    seek(t) {
      t = Math.max(0, Math.min(t, this.dur - 0.5));
      const seg = Math.floor(t / this.SEG) * this.SEG;
      // the seek lands in the staged segment: swap instead of reloading
      if (this.stagedReady && this.staged === seg) { this._swap(); this.active.currentTime = t - seg; this.play(); return; }
      this._playSegment(seg, t - seg);
    }
    setVolume(vol, muted) { for (const v of [this.a, this.b]) { v.volume = vol; v.muted = muted; } }

    ranges() {
      const out = [];
      const b = this.active.buffered;
      if (b.length) out.push([this.currentStart, this.currentStart + b.end(b.length - 1)]);
      if (this.stagedReady && this.staged != null) out.push([this.staged, Math.min(this.staged + this.SEG, this.dur)]);
      return out;
    }

    destroy() {
      this._reset();
      for (const [v, k, fn] of this._handlers) v.removeEventListener(k, fn);
    }

    _playSegment(start, offset) {
      this.currentStart = start;
      this._clearStager();
      const v = this.active, token = ++this.token;
      this.h.onWaiting(true);
      this.h.onTime(start + offset);
      if (v.dataset.seg === String(start) && v.getAttribute('src')) {
        v.currentTime = offset;
        if (this.autoplay !== false) this.play();
        return;
      }
      v.dataset.seg = String(start);
      v.src = this._url(start);
      v.oncanplay = () => {
        if (token !== this.token) return;
        v.oncanplay = null;
        try { v.currentTime = offset; } catch (e) {}
        if (this.autoplay !== false) this.play();
        this.autoplay = true;
      };
    }

    _stageNext() {
      const next = this.currentStart + this.SEG;
      if (next >= this.dur || this.staged === next) return;
      const s = this.stager;
      this.staged = next; this.stagedReady = false;
      s.dataset.seg = String(next);
      s.src = this._url(next);
      s.oncanplay = () => { s.oncanplay = null; this.stagedReady = true; this.h.onRanges(); };
    }

    _clearStager() {
      const s = this.stager;
      this.staged = null; this.stagedReady = false;
      s.oncanplay = null; s.pause(); s.removeAttribute('src'); s.load(); s.dataset.seg = '';
    }

    _swap() {
      const old = this.active;
      this._handing = true;
      old.pause();
      this._handing = false;
      this.active = this.stager; this.stager = old;
      this.currentStart = this.staged;
      this.staged = null; this.stagedReady = false; this.token++;
      old.classList.remove('is-active'); this.active.classList.add('is-active');
    }

    _handoff() {
      const next = this.currentStart + this.SEG;
      if (next >= this.dur - 0.5) { this.h.onEnded(); return; }
      if (this.stagedReady && this.staged === next) {
        this._swap();
        try { this.active.currentTime = 0; } catch (e) {}
        this.play();
      } else {
        this._playSegment(next, 0);
      }
    }

    _tick() {
      const v = this.active;
      if (v.duration > 0 && !v.paused && v.duration - v.currentTime < this.AHEAD) this._stageNext();
      this.h.onTime(this.time);
    }

    _onError() {
      if (++this.errors <= 2) { const t = this.time; setTimeout(() => this._playSegment(Math.floor(t / this.SEG) * this.SEG, t % this.SEG), 600); return; }
      this.h.onError('The video stream failed to load.');
    }
  }

  window.Engines = { StreamEngine, SegmentEngine };
})();
