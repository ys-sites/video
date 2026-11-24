/*
 * Caption Studio — word-timed animated captions, rendered and exported in the browser.
 *
 * The three looks follow OpenMotion's "Animated caption styles" recipe
 * (library/skills/openmotion-caption-styling, Apache-2.0, nexu-io/openmotion):
 *   Clean  — sentence case, spoken words full, upcoming words at 30%
 *   Pop    — uppercase condensed, black outline, 2–3 words, active word #FFE14D, 70%→100% overshoot in ~180 ms
 *   Marker — two words at a time, key word on a #FF6B4A box that wipes left to right in ~200 ms
 * Chunks change on phrase boundaries; a word appears on its first frame of speech.
 *
 * One canvas renderer drives the preview and the export, so the download matches the preview.
 * Nothing is uploaded: the video, the words and the export stay on the viewer's device.
 */
(function () {
  'use strict';

  var root = document.getElementById('caption-studio');
  if (!root) return;
  var $ = function (sel) { return root.querySelector(sel); };

  // ---------- Demo: OpenMotion habits tip, measured word timings ----------
  var DEMO_AUDIO = 'videos/caption-demo-voice.m4a';
  var DEMO_WORDS = [
    ['Want', 0.249], ['to', 0.494], ['read', 0.625], ['more?', 0.845],
    ['Read', 2.059], ['one', 2.284], ['*page.*', 2.515],
    ['Want', 3.449], ['to', 3.694], ['*run?*', 3.839],
    ['Put', 5.039], ['on', 5.204], ['your', 5.349], ['*shoes.*', 5.505],
    ['Want', 6.549], ['to', 6.794], ['*meditate?*', 6.879],
    ['Sit', 8.315], ['for', 8.624], ['one', 8.795], ['*breath.*', 9.035]
  ];
  var DEMO_DURATION = 10;

  var FPS = 30;
  var FRAME = 1 / FPS;
  var BASE = 1080; // design width for a 9:16 frame; everything scales from here

  var STYLES = {
    clean: { label: 'Clean', maxWords: 6, font: function (px) { return '600 ' + px + 'px Inter, sans-serif'; }, size: 58, lineGap: 1.25 },
    pop: { label: 'Pop', maxWords: 3, font: function (px) { return px + 'px Anton, Impact, sans-serif'; }, size: 118, lineGap: 1.05 },
    marker: { label: 'Marker', maxWords: 2, font: function (px) { return '800 ' + px + 'px Poppins, sans-serif'; }, size: 80, lineGap: 1.2 }
  };

  // ---------- State ----------
  var state = {
    style: 'pop',
    words: [],          // {text, start, key}
    chunks: [],
    media: null,        // HTMLMediaElement (audio for the demo, video for an uploaded clip)
    isVideo: false,
    duration: DEMO_DURATION,
    W: 1080, H: 1920,
    posY: 0.66,
    sizeScale: 1,
    accent: '#FFE14D',
    box: '#FF6B4A',
    showSafe: false,
    selected: -1,
    tapping: false, tapIndex: 0,
    exporting: false, recorder: null,
    audio: null,        // {ctx, dest} once routed through Web Audio
    sourceName: 'Demo: habits tip (demo voice)',
    objectUrl: null
  };

  root.studioState = state; // read-only hook for automated checks

  var canvas = $('#cs-canvas');
  var ctx = canvas.getContext('2d');
  var el = {
    play: $('#cs-play'), scrub: $('#cs-scrub'), time: $('#cs-time'),
    file: $('#cs-file'), demo: $('#cs-demo'), sourceName: $('#cs-source-name'),
    transcript: $('#cs-transcript'), apply: $('#cs-apply'), spread: $('#cs-spread'),
    tap: $('#cs-tap'), tapBig: $('#cs-tap-big'), tapNext: $('#cs-tap-next'), tapPanel: $('#cs-tap-panel'),
    importFile: $('#cs-import'), chips: $('#cs-chips'),
    wordPanel: $('#cs-word'), wordText: $('#cs-word-text'), wordStart: $('#cs-word-start'),
    wordKey: $('#cs-word-key'), wordPrev: $('#cs-word-minus'), wordNext: $('#cs-word-plus'), wordHere: $('#cs-word-here'),
    styleBtns: root.querySelectorAll('[data-style]'),
    pos: $('#cs-pos'), size: $('#cs-size'), accent: $('#cs-accent'), box: $('#cs-box'), safe: $('#cs-safe'),
    exportBtn: $('#cs-export'), cancel: $('#cs-cancel'), progress: $('#cs-progress'), status: $('#cs-status'),
    srt: $('#cs-srt'), json: $('#cs-json'), om: $('#cs-om')
  };

  // ---------- Helpers ----------
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function easeOutCubic(p) { return 1 - Math.pow(1 - p, 3); }
  function easeOutQuad(p) { return 1 - (1 - p) * (1 - p); }
  function backOut(p, s) { s = s || 2.4; p -= 1; return p * p * ((s + 1) * p + s) + 1; }
  function fmt(t) {
    t = Math.max(0, t || 0);
    var m = Math.floor(t / 60), s = t - m * 60;
    return m + ':' + (s < 10 ? '0' : '') + s.toFixed(2);
  }
  function say(msg) { el.status.textContent = msg; }
  function isPhraseEnd(text) { return /[.?!,;:]["')\]]*$/.test(text); }
  function scale() { return Math.min(state.W, state.H) / BASE; }

  function wordEnd(i) {
    var w = state.words[i], n = state.words[i + 1];
    var natural = w.start + Math.max(0.35, w.text.length * 0.07);
    return n ? Math.min(n.start, natural + 0.4) : Math.min(state.duration, natural + 0.3);
  }

  // Words from text: "*word*" marks a key word for the Marker look.
  function parseWords(text) {
    return text.split(/\s+/).filter(Boolean).map(function (raw) {
      var key = /^\*.+\*$/.test(raw);
      return { text: key ? raw.slice(1, -1) : raw, start: 0, key: key };
    }).filter(function (w) { return w.text.length; });
  }
  function wordsToText(words) {
    return words.map(function (w) { return w.key ? '*' + w.text + '*' : w.text; }).join(' ');
  }

  // Spread words over the clip, weighted by length (a first pass before tapping or nudging).
  function spreadEvenly(words, duration) {
    var from = 0.2, to = Math.max(from + 0.5, duration - 0.4);
    var weights = words.map(function (w) { return 1 + w.text.length + (isPhraseEnd(w.text) ? 3 : 0); });
    var total = weights.reduce(function (a, b) { return a + b; }, 0) || 1;
    var t = from;
    words.forEach(function (w, i) { w.start = +t.toFixed(3); t += (to - from) * weights[i] / total; });
  }

  // ---------- Chunking: phrase boundaries, max words per look, and line width ----------
  function fontPx() { return STYLES[state.style].size * scale() * state.sizeScale; }

  function measure(text, px) {
    ctx.font = STYLES[state.style].font(px);
    return ctx.measureText(state.style === 'pop' ? text.toUpperCase() : text).width;
  }

  function buildChunks() {
    var st = STYLES[state.style], px = fontPx(), maxW = state.W * 0.86;
    var space = measure(' ', px) * 1.3;
    var chunks = [], cur = null, curW = 0;
    var lines = state.style === 'clean' ? 2 : 1;
    state.words.forEach(function (w, i) {
      var ww = measure(w.text, px) + (w.key && state.style === 'marker' ? px * 0.24 : 0);
      var prev = state.words[i - 1];
      var gap = prev ? w.start - wordEnd(i - 1) : 0;
      var full = cur && (cur.idx.length >= st.maxWords || curW + space + ww > maxW * lines);
      var boundary = prev && (isPhraseEnd(prev.text) || gap > 0.6);
      if (!cur || full || boundary) {
        cur = { idx: [], start: w.start, end: 0 };
        chunks.push(cur);
        curW = 0;
      }
      cur.idx.push(i);
      curW += (curW ? space : 0) + ww;
    });
    chunks.forEach(function (c, k) {
      var last = c.idx[c.idx.length - 1];
      var next = chunks[k + 1];
      var hold = wordEnd(last) + 0.5;
      c.end = next ? Math.min(next.start, hold) : Math.min(state.duration, hold);
      if (c.end <= c.start) c.end = c.start + 0.25;
    });
    state.chunks = chunks;
  }

  // ---------- Rendering ----------
  var bgSeed = 0, bgCache = null;
  function demoBackdrop(W, H) {
    if (bgCache && bgCache.w === W && bgCache.h === H) return bgCache.c;
    var c = document.createElement('canvas');
    c.width = Math.round(W * 1.5); c.height = Math.round(H * 1.2);
    var b = c.getContext('2d');
    var g = b.createLinearGradient(0, 0, 0, c.height);
    g.addColorStop(0, '#12141a');
    g.addColorStop(1, '#09090b');
    b.fillStyle = g;
    b.fillRect(0, 0, c.width, c.height);
    var cx = c.width / 2, cy = c.height * 0.36;
    var r = b.createRadialGradient(cx, cy, 0, cx, cy, W * 0.9);
    r.addColorStop(0, 'rgba(197,240,74,0.16)');
    r.addColorStop(1, 'rgba(197,240,74,0)');
    b.fillStyle = r;
    b.fillRect(0, 0, c.width, c.height);
    bgCache = { w: W, h: H, c: c };
    return c;
  }
  function drawBackground(t) {
    var W = state.W, H = state.H;
    if (state.isVideo && state.media && state.media.readyState >= 2) {
      var vw = state.media.videoWidth, vh = state.media.videoHeight;
      var k = Math.max(W / vw, H / vh);
      var dw = vw * k, dh = vh * k;
      ctx.drawImage(state.media, (W - dw) / 2, (H - dh) / 2, dw, dh);
      return;
    }
    // Demo backdrop: a slow colour wash in the site palette, pre-rendered once and moved each frame.
    var bg = demoBackdrop(W, H);
    var ox = W * 0.18 * Math.sin(t * 0.35 + bgSeed), oy = H * 0.06 * Math.cos(t * 0.27);
    ctx.drawImage(bg, -W * 0.25 + ox, -H * 0.1 + oy);
    var s = scale();
    ctx.fillStyle = 'rgba(250,250,250,0.55)';
    ctx.font = '600 ' + Math.round(30 * s) + 'px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('HABIT TIP · DEMO VOICE', W / 2, H * 0.14);
    ctx.fillStyle = '#fafafa';
    ctx.font = '800 ' + Math.round(78 * s) + 'px Inter, sans-serif';
    ctx.fillText('The two-minute rule', W / 2, H * 0.14 + 96 * s);
    ctx.textAlign = 'left';
  }

  function drawSafe() {
    var W = state.W, H = state.H;
    ctx.save();
    ctx.setLineDash([16 * scale(), 12 * scale()]);
    ctx.lineWidth = 3 * scale();
    ctx.strokeStyle = 'rgba(34,211,238,0.8)';
    var top = H * (168 / 1920), bottom = H * (1330 / 1920);
    ctx.strokeRect(W * 0.06, top, W * 0.88, bottom - top);
    ctx.restore();
  }

  // Lay a chunk out in lines; returns [{i, x, y, w}] centred on posY.
  function layout(chunk, px) {
    var maxW = state.W * 0.86;
    var space = measure(' ', px) * (state.style === 'pop' ? 1.15 : 1.3);
    var pad = state.style === 'marker' ? px * 0.12 : 0;
    var lines = [[]], widths = [0];
    chunk.idx.forEach(function (i) {
      var w = state.words[i];
      var ww = measure(w.text, px) + (w.key && state.style === 'marker' ? pad * 2 : 0);
      var L = lines.length - 1;
      if (lines[L].length && widths[L] + space + ww > maxW && state.style === 'clean') {
        lines.push([]); widths.push(0); L++;
      }
      widths[L] += (lines[L].length ? space : 0) + ww;
      lines[L].push({ i: i, w: ww });
    });
    var lh = px * STYLES[state.style].lineGap;
    var y0 = state.H * state.posY - (lines.length - 1) * lh / 2;
    var out = [];
    lines.forEach(function (line, L) {
      var x = (state.W - widths[L]) / 2;
      line.forEach(function (item) {
        out.push({ i: item.i, x: x, y: y0 + L * lh, w: item.w });
        x += item.w + space;
      });
    });
    return { items: out, widest: Math.max.apply(null, widths) };
  }

  function drawCaptions(t) {
    var chunk = null;
    for (var k = 0; k < state.chunks.length; k++) {
      var c = state.chunks[k];
      if (t >= c.start && t < c.end) { chunk = c; break; }
    }
    if (!chunk) return;
    var px = fontPx();
    var lay = layout(chunk, px);
    // Pop and Marker stay on one line: shrink to fit rather than overflow.
    if (state.style !== 'clean' && lay.widest > state.W * 0.9) {
      px *= state.W * 0.9 / lay.widest;
      lay = layout(chunk, px);
    }
    var s = scale();
    var enter = easeOutCubic(clamp((t - chunk.start) / 0.2, 0, 1));
    var dy = (1 - enter) * 16 * s;
    var alpha = clamp((chunk.end - t) / 0.1, 0, 1);

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.font = STYLES[state.style].font(px);
    lay.items.forEach(function (it, n) {
      var w = state.words[it.i];
      var next = lay.items[n + 1] ? state.words[lay.items[n + 1].i].start : chunk.end;
      var y = it.y + dy;
      if (state.style === 'clean') drawClean(w, it, y, t, s);
      else if (state.style === 'pop') drawPop(w, it, y, t, next, px, s);
      else drawMarker(w, it, y, t, px);
    });
    ctx.restore();
  }

  function drawClean(w, it, y, t, s) {
    var on = clamp((t - w.start) / 0.08, 0, 1);
    ctx.save();
    ctx.globalAlpha *= 0.3 + 0.7 * on;
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = 14 * s;
    ctx.shadowOffsetY = 3 * s;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(w.text, it.x, y);
    ctx.restore();
  }

  function drawPop(w, it, y, t, next, px, s) {
    if (t < w.start) return;
    var p = clamp((t - w.start) / 0.18, 0, 1);
    var sc = 0.7 + 0.3 * backOut(p);
    var active = t < next;
    var text = w.text.toUpperCase();
    var cx = it.x + it.w / 2, cy = y + px * 0.2; // origin 50% 70%
    ctx.save();
    ctx.globalAlpha *= clamp((t - w.start) / 0.04, 0, 1);
    ctx.translate(cx, cy);
    ctx.scale(sc, sc);
    ctx.translate(-cx, -cy);
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    ctx.lineWidth = Math.max(4, px * 0.14);
    ctx.strokeStyle = '#000000';
    ctx.strokeText(text, it.x, y);
    ctx.fillStyle = active ? state.accent : '#ffffff';
    ctx.fillText(text, it.x, y);
    ctx.restore();
  }

  function drawMarker(w, it, y, t, px) {
    if (t < w.start) return;
    ctx.save();
    ctx.globalAlpha *= clamp((t - w.start) / 0.06, 0, 1);
    if (!w.key) {
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = 'rgba(0,0,0,0.45)';
      ctx.shadowBlur = px * 0.18;
      ctx.fillText(w.text, it.x, y);
      ctx.restore();
      return;
    }
    var pad = px * 0.12;
    var wipe = easeOutQuad(clamp((t - w.start) / 0.2, 0, 1));
    var top = y - px * 0.56, h = px * 1.08, r = px * 0.16;
    var bw = it.w * wipe;
    // Word in white first, then the box and dark text clipped to the wiped area,
    // so the word reads on both sides of the moving edge.
    ctx.fillStyle = '#ffffff';
    ctx.fillText(w.text, it.x + pad, y);
    if (bw > 0) {
      ctx.save();
      ctx.beginPath();
      roundRect(it.x, top, bw, h, Math.min(r, bw / 2));
      ctx.fillStyle = state.box;
      ctx.fill();
      ctx.clip();
      ctx.fillStyle = '#16110e';
      ctx.fillText(w.text, it.x + pad, y);
      ctx.restore();
    }
    ctx.restore();
  }

  function roundRect(x, y, w, h, r) {
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function render(at) {
    var t = at != null ? at : state.media ? state.media.currentTime : 0;
    drawBackground(t);
    if (state.showSafe && !state.exporting) drawSafe();
    drawCaptions(t);
  }

  // ---------- Loop and transport ----------
  function tick() {
    if (state.offline) { requestAnimationFrame(tick); return; } // the frame-exact export owns the canvas
    render();
    if (state.media) {
      var t = state.media.currentTime;
      if (!scrubbing) el.scrub.value = String(Math.round(t / state.duration * 1000));
      el.time.textContent = fmt(t) + ' / ' + fmt(state.duration);
      if (state.exporting) el.progress.value = t / state.duration;
      highlightChip(t);
    }
    requestAnimationFrame(tick);
  }

  var scrubbing = false;
  el.scrub.addEventListener('input', function () {
    scrubbing = true;
    if (state.media) state.media.currentTime = el.scrub.value / 1000 * state.duration;
  });
  el.scrub.addEventListener('change', function () { scrubbing = false; });

  function setPlayLabel() {
    var playing = state.media && !state.media.paused;
    el.play.textContent = playing ? 'Pause' : 'Play';
    el.play.setAttribute('aria-pressed', playing ? 'true' : 'false');
  }

  function routeAudio() {
    // Route the media through Web Audio once, so the export can record its sound.
    if (state.audio && state.audio.media === state.media) return state.audio;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    var actx = state.audio ? state.audio.ctx : new AC();
    var src = actx.createMediaElementSource(state.media);
    var dest = actx.createMediaStreamDestination();
    src.connect(actx.destination);
    src.connect(dest);
    state.audio = { ctx: actx, dest: dest, media: state.media };
    return state.audio;
  }

  function play() {
    if (!state.media) return;
    try { var a = routeAudio(); if (a && a.ctx.state === 'suspended') a.ctx.resume(); } catch (e) { /* plays without Web Audio */ }
    if (state.media.ended || state.media.currentTime >= state.duration - 0.05) state.media.currentTime = 0;
    var p = state.media.play();
    if (p && p.catch) p.catch(function () { say('Press Play again to start playback.'); });
  }
  el.play.addEventListener('click', function () {
    if (state.exporting) return;
    if (state.media && !state.media.paused) state.media.pause(); else play();
  });

  root.addEventListener('keydown', function (e) {
    var tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'textarea' || tag === 'input' || tag === 'select') return;
    if (e.code === 'Space' || e.key === 't' || e.key === 'T') {
      if (state.tapping) { e.preventDefault(); tapWord(); return; }
      if (e.code === 'Space' && tag !== 'button') { e.preventDefault(); el.play.click(); }
    }
  });

  // ---------- Sources ----------
  function useMedia(media, isVideo, name) {
    if (state.media) { state.media.pause(); }
    state.media = media;
    state.isVideo = isVideo;
    state.sourceName = name;
    el.sourceName.textContent = name;
    media.preload = 'auto';
    media.playsInline = true;
    media.addEventListener('play', setPlayLabel);
    media.addEventListener('pause', setPlayLabel);
    media.addEventListener('ended', function () { setPlayLabel(); if (state.exporting) finishExport(); if (state.tapping) stopTapping(); });
    // If playback stalls mid-export, pause the recorder too so picture and sound stay in sync.
    media.addEventListener('waiting', function () { if (state.exporting && state.recorder && state.recorder.state === 'recording') state.recorder.pause(); });
    media.addEventListener('playing', function () { if (state.exporting && state.recorder && state.recorder.state === 'paused') state.recorder.resume(); });
    setPlayLabel();
  }

  // The demo voice is fetched into memory first, so seeking and exporting never wait on the network.
  var demoUrl = null, demoBlob = null;
  function loadDemo() {
    if (demoUrl) { startDemo(demoUrl); return; }
    say('Loading the demo…');
    fetch(DEMO_AUDIO).then(function (r) {
      if (!r.ok) throw new Error('http ' + r.status);
      return r.blob();
    }).then(function (b) {
      demoBlob = b;
      demoUrl = URL.createObjectURL(b);
      startDemo(demoUrl);
    }).catch(function () { startDemo(DEMO_AUDIO); });
  }

  function startDemo(src) {
    var a = new Audio(src);
    state.W = 1080; state.H = 1920; state.posY = 0.66;
    canvas.width = state.W; canvas.height = state.H;
    state.duration = DEMO_DURATION;
    state.sourceWasDemo = true;
    state.srcBlob = demoBlob;
    useMedia(a, false, 'Demo: habits tip (demo voice)');
    state.words = DEMO_WORDS.map(function (p) {
      var key = /^\*.+\*$/.test(p[0]);
      return { text: key ? p[0].slice(1, -1) : p[0], start: p[1], key: key };
    });
    el.transcript.value = wordsToText(state.words);
    el.pos.value = String(Math.round(state.posY * 100));
    a.addEventListener('loadedmetadata', function () { if (isFinite(a.duration)) state.duration = a.duration; buildChunks(); renderChips(); });
    if (state.objectUrl) { URL.revokeObjectURL(state.objectUrl); state.objectUrl = null; }
    refresh();
    say('Demo loaded. Words are timed from the voice. Pick a look, or open your own video.');
  }

  el.demo.addEventListener('click', loadDemo);

  el.file.addEventListener('change', function () {
    var f = el.file.files && el.file.files[0];
    if (!f) return;
    var url = URL.createObjectURL(f);
    var v = document.createElement('video');
    v.src = url;
    v.muted = false;
    say('Opening ' + f.name + '…');
    v.addEventListener('loadedmetadata', function () {
      var vw = v.videoWidth || 1080, vh = v.videoHeight || 1920;
      var k = Math.min(1, 1920 / Math.max(vw, vh));
      state.W = Math.round(vw * k / 2) * 2;
      state.H = Math.round(vh * k / 2) * 2;
      canvas.width = state.W; canvas.height = state.H;
      state.duration = isFinite(v.duration) ? v.duration : 10;
      state.posY = state.H >= state.W ? 0.66 : 0.8;
      el.pos.value = String(Math.round(state.posY * 100));
      if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
      state.objectUrl = url;
      state.srcBlob = f;
      useMedia(v, true, f.name);
      // Keep the words; if they came from the demo, start fresh so nothing paraphrases the new clip.
      if (!state.words.length || state.sourceWasDemo !== false) {
        state.words = [];
        el.transcript.value = '';
      }
      state.sourceWasDemo = false;
      refresh();
      say('Video ready (' + state.W + '×' + state.H + ', ' + fmt(state.duration) + '). Paste what is said, then Apply, Tap to time or Import timings.');
    }, { once: true });
    v.addEventListener('error', function () { say('This browser cannot play that file. Try an MP4 (H.264) or WebM.'); }, { once: true });
    v.load();
    el.file.value = '';
  });

  // ---------- Words ----------
  el.apply.addEventListener('click', function () {
    var next = parseWords(el.transcript.value);
    if (!next.length) { say('Type or paste the words that are said first.'); return; }
    if (next.length === state.words.length) {
      next.forEach(function (w, i) { w.start = state.words[i].start; });
      say('Text updated; timings kept (' + next.length + ' words).');
    } else {
      spreadEvenly(next, state.duration);
      say('Spread ' + next.length + ' words across the clip. Use Tap to time for exact sync.');
    }
    state.words = next;
    state.selected = -1;
    refresh();
  });

  el.spread.addEventListener('click', function () {
    if (!state.words.length) { el.apply.click(); return; }
    spreadEvenly(state.words, state.duration);
    refresh();
    say('Words spread evenly. Tap to time, or nudge single words by a frame.');
  });

  // Tap to time: play from the start and tap on each word as it is spoken.
  function startTapping() {
    if (!state.words.length) { el.apply.click(); if (!state.words.length) return; }
    state.tapping = true;
    state.tapIndex = 0;
    el.tap.textContent = 'Stop tapping';
    el.tap.setAttribute('aria-pressed', 'true');
    el.tapPanel.hidden = false;
    updateTapNext();
    state.media.currentTime = 0;
    play();
    el.tapBig.focus();
    say('Tap the big button (or press Space) as each word starts.');
  }
  function stopTapping() {
    state.tapping = false;
    el.tap.textContent = 'Tap to time';
    el.tap.setAttribute('aria-pressed', 'false');
    el.tapPanel.hidden = true;
    if (state.media) state.media.pause();
    for (var i = 1; i < state.words.length; i++) {
      if (state.words[i].start <= state.words[i - 1].start) state.words[i].start = +(state.words[i - 1].start + FRAME).toFixed(3);
    }
    refresh();
    say('Timing saved. Nudge any word by a frame if it is early or late.');
  }
  function updateTapNext() {
    var w = state.words[state.tapIndex];
    el.tapNext.textContent = w ? w.text : 'done';
  }
  function tapWord() {
    if (!state.tapping) return;
    var w = state.words[state.tapIndex];
    if (!w) { stopTapping(); return; }
    // Human taps land ~120 ms late; pull them back so the word lands on its first frame.
    w.start = +Math.max(0, state.media.currentTime - 0.12).toFixed(3);
    state.tapIndex++;
    updateTapNext();
    buildChunks();
    renderChips();
    if (state.tapIndex >= state.words.length) stopTapping();
  }
  el.tap.addEventListener('click', function () { if (state.tapping) stopTapping(); else startTapping(); });
  el.tapBig.addEventListener('click', tapWord);

  // Import word timings: Whisper-style JSON, a plain [{text,start}] array, SRT or VTT.
  el.importFile.addEventListener('change', function () {
    var f = el.importFile.files && el.importFile.files[0];
    if (!f) return;
    f.text().then(function (txt) {
      var words = /\.(srt|vtt)$/i.test(f.name) || /-->/.test(txt) ? fromSubtitles(txt) : fromJson(JSON.parse(txt));
      if (!words.length) throw new Error('no words');
      state.words = words;
      el.transcript.value = wordsToText(words);
      refresh();
      say('Imported ' + words.length + ' timed words from ' + f.name + '.');
    }).catch(function () {
      say('Could not read timings from that file. Use Whisper JSON (words with start), or an SRT/VTT file.');
    });
    el.importFile.value = '';
  });

  function fromJson(data) {
    var list = [];
    function take(arr) {
      arr.forEach(function (w) {
        var text = String(w.word != null ? w.word : w.text != null ? w.text : '').trim();
        var start = +(w.start != null ? w.start : w.startTime != null ? w.startTime : w.t);
        if (text && isFinite(start)) list.push({ text: text.replace(/^\*(.+)\*$/, '$1'), start: start, key: !!w.key || /^\*.+\*$/.test(text) });
      });
    }
    if (Array.isArray(data)) take(data);
    else if (data && Array.isArray(data.words)) take(data.words);
    else if (data && Array.isArray(data.segments)) data.segments.forEach(function (s) { if (Array.isArray(s.words)) take(s.words); });
    return list.sort(function (a, b) { return a.start - b.start; });
  }

  function fromSubtitles(txt) {
    var out = [];
    var re = /(\d{1,2}:)?(\d{1,2}):(\d{2})[.,](\d{1,3})\s*-->\s*(\d{1,2}:)?(\d{1,2}):(\d{2})[.,](\d{1,3})[^\n]*\n([\s\S]*?)(?:\n\s*\n|$)/g;
    var m;
    function sec(h, mi, s, ms) { return (h ? parseInt(h, 10) : 0) * 3600 + parseInt(mi, 10) * 60 + parseInt(s, 10) + parseInt((ms + '00').slice(0, 3), 10) / 1000; }
    while ((m = re.exec(txt))) {
      var a = sec(m[1], m[2], m[3], m[4]), b = sec(m[5], m[6], m[7], m[8]);
      var words = parseWords(m[9].replace(/<[^>]+>/g, ' '));
      var weights = words.map(function (w) { return 1 + w.text.length; });
      var total = weights.reduce(function (x, y) { return x + y; }, 0) || 1, t = a;
      words.forEach(function (w, i) { w.start = +t.toFixed(3); t += (b - a) * weights[i] / total; out.push(w); });
    }
    return out;
  }

  // ---------- Word chips and the single-word editor ----------
  function renderChips() {
    el.chips.innerHTML = '';
    if (!state.words.length) {
      var p = document.createElement('p');
      p.className = 'cs-empty';
      p.textContent = 'No words yet. Paste the transcript above and press Apply.';
      el.chips.appendChild(p);
    }
    state.words.forEach(function (w, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'cs-chip' + (w.key ? ' key' : '') + (i === state.selected ? ' sel' : '');
      b.dataset.i = String(i);
      b.innerHTML = '<span></span><small></small>';
      b.firstChild.textContent = w.text;
      b.lastChild.textContent = w.start.toFixed(2);
      b.setAttribute('aria-label', w.text + ' at ' + w.start.toFixed(2) + ' seconds' + (w.key ? ', key word' : ''));
      el.chips.appendChild(b);
    });
    showWordPanel();
  }

  var lastLit = -2;
  function highlightChip(t) {
    var lit = -1;
    for (var i = 0; i < state.words.length; i++) { if (state.words[i].start <= t) lit = i; else break; }
    if (lit === lastLit) return;
    lastLit = lit;
    var prev = el.chips.querySelector('.cs-chip.now');
    if (prev) prev.classList.remove('now');
    var cur = el.chips.querySelector('.cs-chip[data-i="' + lit + '"]');
    if (cur) cur.classList.add('now');
  }

  el.chips.addEventListener('click', function (e) {
    var b = e.target.closest('.cs-chip');
    if (!b) return;
    var i = +b.dataset.i;
    if (e.shiftKey) { state.words[i].key = !state.words[i].key; el.transcript.value = wordsToText(state.words); refresh(); return; }
    state.selected = i;
    if (state.media) { state.media.pause(); state.media.currentTime = Math.max(0, state.words[i].start); }
    renderChips();
  });

  function showWordPanel() {
    var w = state.words[state.selected];
    el.wordPanel.hidden = !w;
    if (!w) return;
    el.wordText.value = w.text;
    el.wordStart.value = w.start.toFixed(3);
    el.wordKey.setAttribute('aria-pressed', w.key ? 'true' : 'false');
  }

  function setStart(v) {
    var w = state.words[state.selected];
    if (!w || !isFinite(v)) return;
    w.start = +clamp(v, 0, state.duration).toFixed(3);
    state.words.sort(function (a, b) { return a.start - b.start; });
    state.selected = state.words.indexOf(w);
    if (state.media) state.media.currentTime = w.start;
    refresh();
  }
  el.wordStart.addEventListener('change', function () { setStart(parseFloat(el.wordStart.value)); });
  el.wordPrev.addEventListener('click', function () { var w = state.words[state.selected]; if (w) setStart(w.start - FRAME); });
  el.wordNext.addEventListener('click', function () { var w = state.words[state.selected]; if (w) setStart(w.start + FRAME); });
  el.wordHere.addEventListener('click', function () { if (state.media) setStart(state.media.currentTime); });
  el.wordText.addEventListener('change', function () {
    var w = state.words[state.selected];
    var v = el.wordText.value.trim();
    if (!w || !v) return;
    w.text = v;
    el.transcript.value = wordsToText(state.words);
    refresh();
  });
  el.wordKey.addEventListener('click', function () {
    var w = state.words[state.selected];
    if (!w) return;
    w.key = !w.key;
    el.transcript.value = wordsToText(state.words);
    refresh();
  });

  // ---------- Look ----------
  function setStyle(name) {
    state.style = name;
    el.styleBtns.forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.style === name ? 'true' : 'false'); });
    refresh();
  }
  el.styleBtns.forEach(function (b) { b.addEventListener('click', function () { setStyle(b.dataset.style); }); });
  el.pos.addEventListener('input', function () { state.posY = el.pos.value / 100; });
  el.size.addEventListener('input', function () { state.sizeScale = el.size.value / 100; buildChunks(); });
  el.accent.addEventListener('input', function () { state.accent = el.accent.value; });
  el.box.addEventListener('input', function () { state.box = el.box.value; });
  el.safe.addEventListener('change', function () { state.showSafe = el.safe.checked; });

  function refresh() {
    buildChunks();
    renderChips();
  }

  // ---------- Export: video ----------
  function pickMime() {
    if (!window.MediaRecorder) return null;
    var list = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
    for (var i = 0; i < list.length; i++) if (MediaRecorder.isTypeSupported(list[i])) return list[i];
    return '';
  }

  var chunksOut = [];
  el.exportBtn.addEventListener('click', function () {
    if (state.exporting || !state.media) return;
    if (!state.words.length) { say('Add the words first: paste the transcript and press Apply.'); return; }
    if (state.tapping) stopTapping();
    canExportOffline().then(function (ok) {
      if (ok) exportOffline().catch(function (err) {
        console.error(err);
        endExportUi();
        say('Frame-exact export failed (' + (err && err.message || err) + '). Trying a real-time recording instead.');
        setTimeout(recordRealtime, 600);
      });
      else recordRealtime();
    });
  });

  // Fallback: record the live preview in real time (browsers without WebCodecs).
  function recordRealtime() {
    var mime = pickMime();
    if (mime === null || !canvas.captureStream) { say('This browser cannot record video. Use a current Chrome, Edge or Firefox, or download the OpenMotion composition below.'); return; }
    var stream = canvas.captureStream(FPS);
    try {
      var a = routeAudio();
      if (a) { if (a.ctx.state === 'suspended') a.ctx.resume(); a.dest.stream.getAudioTracks().forEach(function (tr) { stream.addTrack(tr); }); }
    } catch (e) { /* export without sound */ }
    var rec;
    try { rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 10000000 } : undefined); }
    catch (e) { say('Recording failed to start in this browser.'); return; }
    chunksOut = [];
    rec.ondataavailable = function (e) { if (e.data && e.data.size) chunksOut.push(e.data); };
    rec.onstop = function () {
      var type = rec.mimeType || mime || 'video/webm';
      if (!state.cancelled && chunksOut.length) {
        var ext = /mp4/.test(type) ? 'mp4' : 'webm';
        download(new Blob(chunksOut, { type: type.split(';')[0] }), 'captions-' + state.style + '.' + ext);
        say('Exported ' + STYLES[state.style].label + ' captions as ' + ext.toUpperCase() + '. Saved to your downloads.');
      } else if (state.cancelled) say('Export cancelled.');
      endExportUi();
    };
    state.recorder = rec;
    state.cancelled = false;
    state.exporting = true;
    if (state.tapping) stopTapping();
    root.classList.add('cs-busy');
    el.exportBtn.disabled = true;
    el.cancel.hidden = false;
    el.progress.hidden = false;
    el.progress.value = 0;
    state.media.pause();
    state.media.currentTime = 0;
    say('Recording in real time (' + fmt(state.duration) + '). Keep this tab in front until it finishes.');
    var started = false;
    function go() {
      if (started) return;
      started = true;
      rec.start(250);
      play();
    }
    state.media.addEventListener('seeked', go, { once: true });
    setTimeout(go, 400);
  }

  // ---------- Export: frame-exact with WebCodecs ----------
  // Every frame is drawn at its exact time (t = i / FPS), encoded to H.264, the source audio
  // is decoded and encoded to AAC, and both are written into an MP4 here — faster than real time,
  // and immune to a busy tab or a slow disk.
  var VIDEO_CODECS = ['avc1.640028', 'avc1.4d0028', 'avc1.42e028', 'avc1.640033', 'avc1.42001f'];
  var videoConfig = null, audioOk = null;

  function canExportOffline() {
    if (!window.VideoEncoder || !window.VideoFrame) return Promise.resolve(false);
    var tries = VIDEO_CODECS.map(function (codec) {
      var cfg = { codec: codec, width: state.W, height: state.H, bitrate: state.W * state.H > 1500000 ? 10000000 : 6000000, framerate: FPS, avc: { format: 'avc' } };
      return VideoEncoder.isConfigSupported(cfg).then(function (r) { return r.supported ? cfg : null; }, function () { return null; });
    });
    return Promise.all(tries).then(function (list) {
      videoConfig = list.filter(Boolean)[0] || null;
      return !!videoConfig;
    });
  }

  function decodeSourceAudio() {
    if (!state.srcBlob || !window.OfflineAudioContext) return Promise.resolve(null);
    return state.srcBlob.arrayBuffer().then(function (buf) {
      var oc = new OfflineAudioContext(2, 48000, 48000);
      return new Promise(function (res) {
        try { oc.decodeAudioData(buf, res, function () { res(null); }); } catch (e) { res(null); }
      });
    }).catch(function () { return null; });
  }

  function aacConfig(rate, ch) {
    if (!window.AudioEncoder || !window.AudioData) return Promise.resolve(null);
    var cfg = { codec: 'mp4a.40.2', sampleRate: rate, numberOfChannels: ch, bitrate: 128000 };
    return AudioEncoder.isConfigSupported(cfg).then(function (r) { return r.supported ? cfg : null; }, function () { return null; });
  }

  function seekTo(t) {
    var m = state.media;
    return new Promise(function (res) {
      var done = false;
      function finish() { if (!done) { done = true; res(); } }
      m.addEventListener('seeked', finish, { once: true });
      setTimeout(finish, 3000);
      m.currentTime = t;
    });
  }

  function toBytes(d) { return d instanceof ArrayBuffer ? new Uint8Array(d.slice(0)) : new Uint8Array(d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength)); }
  function tickUi() { return new Promise(function (r) { setTimeout(r, 0); }); }

  function exportOffline() {
    var total = Math.max(1, Math.round(state.duration * FPS));
    var vChunks = [], aChunks = [], avcC = null, asc = null, failure = null;
    state.cancelled = false;
    state.exporting = true;
    state.offline = true;
    root.classList.add('cs-busy');
    el.exportBtn.disabled = true;
    el.cancel.hidden = false;
    el.progress.hidden = false;
    el.progress.value = 0;
    if (state.media) state.media.pause();
    say('Preparing the export…');

    var venc = new VideoEncoder({
      output: function (chunk, meta) {
        if (meta && meta.decoderConfig && meta.decoderConfig.description && !avcC) avcC = toBytes(meta.decoderConfig.description);
        var data = new Uint8Array(chunk.byteLength);
        chunk.copyTo(data);
        vChunks.push({ data: data, ts: chunk.timestamp, key: chunk.type === 'key' });
      },
      error: function (e) { failure = e; }
    });
    venc.configure(videoConfig);

    var audioBuf = null;
    return decodeSourceAudio().then(function (buf) {
      audioBuf = buf;
      return (async function () {
        for (var i = 0; i < total; i++) {
          if (state.cancelled) throw new Error('cancelled');
          if (failure) throw failure;
          var t = i / FPS;
          if (state.isVideo) await seekTo(Math.min(t, Math.max(0, state.duration - 0.001)));
          render(t);
          var frame = new VideoFrame(canvas, { timestamp: Math.round(t * 1e6), duration: Math.round(1e6 / FPS) });
          venc.encode(frame, { keyFrame: i % (FPS * 2) === 0 });
          frame.close();
          while (venc.encodeQueueSize > 6) await new Promise(function (r) { setTimeout(r, 4); });
          if (i % 6 === 0) {
            el.progress.value = (i / total) * 0.9;
            el.time.textContent = fmt(t) + ' / ' + fmt(state.duration);
            say('Rendering frame ' + (i + 1) + ' of ' + total + '…');
            await tickUi();
          }
        }
        await venc.flush();
        venc.close();
        if (failure) throw failure;
        if (!avcC) throw new Error('encoder gave no H.264 header');

        // Audio: decoded source → AAC, trimmed to the clip length.
        var audioInfo = null;
        if (audioBuf) {
          var ch = Math.min(2, audioBuf.numberOfChannels), rate = audioBuf.sampleRate;
          var cfg = await aacConfig(rate, ch);
          if (cfg) {
            say('Encoding the sound…');
            var aerr = null;
            var aenc = new AudioEncoder({
              output: function (chunk, meta) {
                if (meta && meta.decoderConfig && meta.decoderConfig.description && !asc) asc = toBytes(meta.decoderConfig.description);
                var data = new Uint8Array(chunk.byteLength);
                chunk.copyTo(data);
                aChunks.push({ data: data, ts: chunk.timestamp });
              },
              error: function (e) { aerr = e; }
            });
            aenc.configure(cfg);
            var len = Math.min(audioBuf.length, Math.round(total / FPS * rate));
            var block = 4096;
            for (var off = 0; off < len; off += block) {
              var n = Math.min(block, len - off);
              var planar = new Float32Array(n * ch);
              for (var c = 0; c < ch; c++) planar.set(audioBuf.getChannelData(c).subarray(off, off + n), c * n);
              var ad = new AudioData({ format: 'f32-planar', sampleRate: rate, numberOfFrames: n, numberOfChannels: ch, timestamp: Math.round(off / rate * 1e6), data: planar });
              aenc.encode(ad);
              ad.close();
              if (aenc.encodeQueueSize > 20) await new Promise(function (r) { setTimeout(r, 4); });
            }
            await aenc.flush();
            aenc.close();
            if (aerr) throw aerr;
            if (!asc) asc = makeAsc(rate, ch);
            audioInfo = { rate: rate, channels: ch, asc: asc, chunks: aChunks };
          }
        }

        el.progress.value = 0.97;
        say('Writing the MP4…');
        await tickUi();
        var mp4 = muxMp4({ width: state.W, height: state.H, fps: FPS, avcC: avcC, chunks: vChunks }, audioInfo);
        download(new Blob([mp4], { type: 'video/mp4' }), 'captions-' + state.style + '.mp4');
        var mb = (mp4.byteLength / 1048576).toFixed(1);
        say('Exported ' + STYLES[state.style].label + ' captions: ' + total + ' frames at ' + FPS + ' fps, ' + state.W + '×' + state.H + ', ' + mb + ' MB' + (audioInfo ? ', with sound' : ', no sound track found') + '. Saved to your downloads.');
      })();
    }).then(function () {
      state.offline = false;
      endExportUi();
    }, function (err) {
      state.offline = false;
      try { if (venc.state !== 'closed') venc.close(); } catch (e) { /* closed */ }
      if (err && err.message === 'cancelled') { endExportUi(); say('Export cancelled.'); return; }
      throw err;
    });
  }

  // AudioSpecificConfig for AAC-LC when the encoder does not supply one.
  function makeAsc(rate, ch) {
    var rates = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
    var fi = rates.indexOf(rate);
    if (fi < 0) fi = 3;
    var v = (2 << 11) | (fi << 7) | (ch << 3);
    return new Uint8Array([v >> 8, v & 255]);
  }

  // ---------- Minimal MP4 writer (ftyp, mdat, moov; one sample per chunk) ----------
  function muxMp4(video, audio) {
    function u8(n) { return [n & 255]; }
    function u16(n) { return [(n >> 8) & 255, n & 255]; }
    function u24(n) { return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
    function u32(n) { return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]; }
    function str(s) { var a = []; for (var i = 0; i < s.length; i++) a.push(s.charCodeAt(i)); return a; }
    function flat(parts) {
      var len = 0, i;
      for (i = 0; i < parts.length; i++) len += parts[i].length;
      var out = new Uint8Array(len), o = 0;
      for (i = 0; i < parts.length; i++) { out.set(parts[i], o); o += parts[i].length; }
      return out;
    }
    function box(type) {
      var parts = Array.prototype.slice.call(arguments, 1).map(function (p) { return p instanceof Uint8Array ? p : new Uint8Array(p); });
      var body = flat(parts);
      return flat([new Uint8Array(u32(body.length + 8).concat(str(type))), body]);
    }
    function full(type, version, flags) {
      var rest = Array.prototype.slice.call(arguments, 3);
      return box.apply(null, [type, u8(version).concat(u24(flags))].concat(rest));
    }
    var MATRIX = [].concat(u32(0x10000), u32(0), u32(0), u32(0), u32(0x10000), u32(0), u32(0), u32(0), u32(0x40000000));
    var MOVIE_TS = 1000;

    function runs(deltas) { // stts entries
      var out = [], last = null, count = 0;
      deltas.forEach(function (d) { if (d === last) count++; else { if (last !== null) out.push([count, last]); last = d; count = 1; } });
      if (last !== null) out.push([count, last]);
      return out;
    }
    function stbl(entry, deltas, sizes, offsets, keys) {
      var stts = runs(deltas);
      var parts = [
        full('stsd', 0, 0, u32(1), entry),
        full('stts', 0, 0, u32(stts.length), [].concat.apply([], stts.map(function (r) { return u32(r[0]).concat(u32(r[1])); }))),
      ];
      if (keys) parts.push(full('stss', 0, 0, u32(keys.length), [].concat.apply([], keys.map(u32))));
      parts.push(full('stsc', 0, 0, u32(1), u32(1).concat(u32(1), u32(1))));
      parts.push(full('stsz', 0, 0, u32(0), u32(sizes.length), [].concat.apply([], sizes.map(u32))));
      parts.push(full('stco', 0, 0, u32(offsets.length), [].concat.apply([], offsets.map(u32))));
      return box.apply(null, ['stbl'].concat(parts));
    }
    function trak(id, handler, ts, mediaDur, movieDur, w, h, header, stblBox) {
      return box('trak',
        full('tkhd', 0, 3, u32(0), u32(0), u32(id), u32(0), u32(movieDur), u32(0), u32(0), u16(0), u16(0), u16(handler === 'soun' ? 0x100 : 0), u16(0), MATRIX, u32(w << 16), u32(h << 16)),
        box('mdia',
          full('mdhd', 0, 0, u32(0), u32(0), u32(ts), u32(mediaDur), u16(0x55c4), u16(0)),
          full('hdlr', 0, 0, u32(0), str(handler), u32(0), u32(0), u32(0), str(handler === 'vide' ? 'VideoHandler' : 'SoundHandler'), [0]),
          box('minf', header, box('dinf', full('dref', 0, 0, u32(1), full('url ', 0, 1))), stblBox)));
    }

    // mdat payload: all video samples, then all audio samples.
    var vSamples = video.chunks.slice().sort(function (a, b) { return a.ts - b.ts; });
    var aSamples = audio ? audio.chunks.slice().sort(function (a, b) { return a.ts - b.ts; }) : [];
    var ftyp = box('ftyp', str('isom'), u32(0x200), str('isom'), str('iso2'), str('avc1'), str('mp41'));
    var mdatLen = 8;
    vSamples.forEach(function (s) { mdatLen += s.data.length; });
    aSamples.forEach(function (s) { mdatLen += s.data.length; });
    var offset = ftyp.length + 8, vOffsets = [], aOffsets = [];
    vSamples.forEach(function (s) { vOffsets.push(offset); offset += s.data.length; });
    aSamples.forEach(function (s) { aOffsets.push(offset); offset += s.data.length; });

    var V_TS = video.fps * 1000;
    var vDelta = 1000; // one frame at fps*1000 timescale
    var vDur = vSamples.length * vDelta;
    var vKeys = [];
    vSamples.forEach(function (s, i) { if (s.key) vKeys.push(i + 1); });
    var avc1 = box('avc1', u32(0), u16(0), u16(1), u16(0), u16(0), u32(0), u32(0), u32(0), u16(video.width), u16(video.height),
      u32(0x480000), u32(0x480000), u32(0), u16(1), new Array(32).fill(0), u16(0x18), u16(0xffff), box('avcC', video.avcC));
    var vTrak = trak(1, 'vide', V_TS, vDur, Math.round(vDur / V_TS * MOVIE_TS), video.width, video.height,
      full('vmhd', 0, 1, u16(0), u16(0), u16(0), u16(0)),
      stbl(avc1, vSamples.map(function () { return vDelta; }), vSamples.map(function (s) { return s.data.length; }), vOffsets, vKeys));

    var traks = [vTrak], movieDur = Math.round(vDur / V_TS * MOVIE_TS);
    if (audio && aSamples.length) {
      var asc = Array.prototype.slice.call(audio.asc);
      function desc(tag, body) { return [tag, body.length].concat(body); }
      var dsi = desc(5, asc);
      var dcd = desc(4, [0x40, 0x15].concat(u24(0), u32(128000), u32(128000), dsi));
      var esd = desc(3, u16(1).concat([0], dcd, desc(6, [2])));
      var mp4a = box('mp4a', u32(0), u16(0), u16(1), u32(0), u32(0), u16(audio.channels), u16(16), u16(0), u16(0), u32(audio.rate << 16 >>> 0),
        full('esds', 0, 0, esd));
      var aDur = aSamples.length * 1024;
      traks.push(trak(2, 'soun', audio.rate, aDur, Math.round(aDur / audio.rate * MOVIE_TS), 0, 0,
        full('smhd', 0, 0, u16(0), u16(0)),
        stbl(mp4a, aSamples.map(function () { return 1024; }), aSamples.map(function (s) { return s.data.length; }), aOffsets, null)));
      movieDur = Math.max(movieDur, Math.round(aDur / audio.rate * MOVIE_TS));
    }
    var mvhd = full('mvhd', 0, 0, u32(0), u32(0), u32(MOVIE_TS), u32(movieDur), u32(0x10000), u16(0x100), u16(0), u32(0), u32(0), MATRIX,
      u32(0), u32(0), u32(0), u32(0), u32(0), u32(0), u32(traks.length + 1));
    var moov = box.apply(null, ['moov', mvhd].concat(traks));

    var parts = [ftyp, new Uint8Array(u32(mdatLen).concat(str('mdat')))];
    vSamples.forEach(function (s) { parts.push(s.data); });
    aSamples.forEach(function (s) { parts.push(s.data); });
    parts.push(moov);
    return flat(parts);
  }

  function finishExport() {
    if (state.recorder && state.recorder.state !== 'inactive') {
      setTimeout(function () { state.recorder.stop(); }, 150);
    }
  }
  el.cancel.addEventListener('click', function () {
    state.cancelled = true;
    if (state.media) state.media.pause();
    finishExport();
  });
  function endExportUi() {
    state.exporting = false;
    state.recorder = null;
    root.classList.remove('cs-busy');
    el.exportBtn.disabled = false;
    el.cancel.hidden = true;
    el.progress.hidden = true;
  }

  function download(blob, name) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
  }

  // ---------- Export: SRT, word JSON, OpenMotion composition ----------
  function srtTime(t) {
    var ms = Math.round(t * 1000), h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60;
    function p(n, l) { n = String(n); while (n.length < l) n = '0' + n; return n; }
    return p(h, 2) + ':' + p(m, 2) + ':' + p(s, 2) + ',' + p(ms % 1000, 3);
  }
  el.srt.addEventListener('click', function () {
    if (!state.chunks.length) { say('No captions to save yet.'); return; }
    var out = state.chunks.map(function (c, k) {
      return (k + 1) + '\n' + srtTime(c.start) + ' --> ' + srtTime(c.end) + '\n' + c.idx.map(function (i) { return state.words[i].text; }).join(' ') + '\n';
    }).join('\n');
    download(new Blob([out], { type: 'text/plain' }), 'captions.srt');
  });
  el.json.addEventListener('click', function () {
    var data = { fps: FPS, words: state.words.map(function (w, i) { return { text: w.text, start: w.start, end: +wordEnd(i).toFixed(3), key: w.key }; }) };
    download(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), 'caption-words.json');
  });

  function escHtml(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  // A HyperFrames captions scene in OpenMotion's composition format: one captions host,
  // each chunk a timed .clip group, word times in data-at, a paused GSAP timeline.
  el.om.addEventListener('click', function () {
    if (!state.chunks.length) { say('No captions to save yet.'); return; }
    var s = scale(), px = Math.round(fontPx());
    var top = Math.round(state.H * state.posY - px * 1.2);
    var css = {
      clean: '.word{font-family:"Inter",sans-serif;font-weight:600;font-size:' + px + 'px;color:#fff;margin:0 .12em;text-shadow:0 ' + Math.round(3 * s) + 'px ' + Math.round(14 * s) + 'px rgba(0,0,0,.55)}',
      pop: '.word{font-family:"Anton",sans-serif;font-size:' + px + 'px;line-height:1;color:#fff;margin:0 .08em;text-transform:uppercase;-webkit-text-stroke:' + Math.round(px * 0.14) + 'px #000;paint-order:stroke fill;transform-origin:50% 70%}',
      marker: '.word{font-family:"Poppins",sans-serif;font-weight:800;font-size:' + px + 'px;line-height:1.1;color:#fff;margin:0 .12em;position:relative}.key{color:#16110e;padding:0 .12em}.key-box{position:absolute;left:0;right:0;top:.06em;bottom:.02em;background:' + state.box + ';border-radius:.16em;transform-origin:0% 50%}.key-txt{position:relative}'
    }[state.style];
    var groups = state.chunks.map(function (c, k) {
      var words = c.idx.map(function (i, n) {
        var w = state.words[i], id = 'w' + (k + 1) + '-' + (n + 1);
        if (state.style === 'marker' && w.key) {
          return '<span class="word key" id="' + id + '" data-at="' + w.start.toFixed(3) + '"><span class="key-box" id="' + id + '-box"></span><span class="key-txt" id="' + id + '-txt">' + escHtml(w.text) + '</span></span>';
        }
        return '<span class="word" id="' + id + '" data-at="' + w.start.toFixed(3) + '">' + escHtml(w.text) + '</span>';
      }).join('\n        ');
      return '    <div id="cap-' + (k + 1) + '" class="cap-group clip" data-start="' + c.start.toFixed(3) + '" data-duration="' + (c.end - c.start).toFixed(3) + '" data-track-index="1">\n' +
        '      <div class="cap-inner" id="cap-' + (k + 1) + '-in">\n        ' + words + '\n      </div>\n    </div>';
    }).join('\n');
    var dur = Math.ceil(state.duration * 1000) / 1000;
    var html = [
      '<!-- Caption Studio export (' + STYLES[state.style].label + '). OpenMotion / HyperFrames captions scene.',
      '     Use: save as compositions/captions.html in an OpenMotion project, import the font files with',
      '     openmotion_import_assets and point the @font-face rules at them, then add this host to index.html:',
      '     <div id="captions" data-composition-id="captions" data-composition-src="compositions/captions.html"',
      '          data-start="0" data-duration="' + dur + '" data-track-index="2" data-track-kind="captions"',
      '          data-width="' + state.W + '" data-height="' + state.H + '"></div>',
      '     Look based on OpenMotion\'s caption-styling recipe (Apache-2.0). -->',
      '<template>',
      '  <style>',
      '    #root{position:absolute;inset:0}',
      '    .cap-group{position:absolute;left:0;right:0;top:' + top + 'px;height:' + Math.round(px * 2.4) + 'px}',
      '    .cap-inner{position:absolute;inset:0;display:flex;flex-wrap:wrap;align-items:center;justify-content:center;text-align:center;padding:0 7%}',
      '    .word{display:inline-block;white-space:nowrap}',
      '    ' + css,
      '  </style>',
      '  <div id="root" data-composition-id="captions" data-width="' + state.W + '" data-height="' + state.H + '">',
      groups,
      '  </div>',
      '  <script>',
      '    (function () {',
      '      var STYLE = "' + state.style + '", ACCENT = "' + state.accent + '";',
      '      var tl = gsap.timeline({ paused: true });',
      '      var root = document.querySelector(\'[data-composition-id="captions"]\');',
      '      Array.prototype.forEach.call(root.querySelectorAll(".cap-group"), function (group) {',
      '        var start = parseFloat(group.dataset.start), end = start + parseFloat(group.dataset.duration);',
      '        var inner = group.querySelector(".cap-inner");',
      '        var words = Array.prototype.slice.call(group.querySelectorAll(".word"));',
      '        tl.fromTo(inner, { y: 16 }, { y: 0, duration: 0.2, ease: "power3.out" }, start);',
      '        tl.fromTo(inner, { opacity: 1 }, { opacity: 0, duration: 0.1, ease: "power2.in", immediateRender: false }, end - 0.1);',
      '        words.forEach(function (word, i) {',
      '          var at = parseFloat(word.dataset.at);',
      '          var next = i + 1 < words.length ? parseFloat(words[i + 1].dataset.at) : end;',
      '          if (STYLE === "clean") {',
      '            tl.fromTo(word, { opacity: 0.3 }, { opacity: 1, duration: 0.08, ease: "none" }, at);',
      '          } else if (STYLE === "pop") {',
      '            tl.fromTo(word, { opacity: 0 }, { opacity: 1, duration: 0.04, ease: "none" }, at);',
      '            tl.fromTo(word, { scale: 0.7 }, { scale: 1, duration: 0.18, ease: "back.out(2.4)" }, at);',
      '            tl.fromTo(word, { color: "#ffffff" }, { color: ACCENT, duration: 0.01 }, at);',
      '            if (next < end) tl.fromTo(word, { color: ACCENT }, { color: "#ffffff", duration: 0.01, immediateRender: false }, next);',
      '          } else {',
      '            tl.fromTo(word, { opacity: 0 }, { opacity: 1, duration: 0.06, ease: "none" }, at);',
      '            var box = word.querySelector(".key-box");',
      '            if (box) tl.fromTo(box, { scaleX: 0 }, { scaleX: 1, duration: 0.2, ease: "power2.out" }, at);',
      '          }',
      '        });',
      '      });',
      '      tl.set({}, {}, ' + dur + ');',
      '      window.__timelines = window.__timelines || {};',
      '      window.__timelines["captions"] = tl;',
      '    })();',
      '  </' + 'script>',
      '</template>',
      ''
    ].join('\n');
    download(new Blob([html], { type: 'text/html' }), 'captions.html');
    say('Saved captions.html — drop it into an OpenMotion project to render it frame-exact.');
  });

  // ---------- Start ----------
  var fontsReady = document.fonts && document.fonts.load
    ? Promise.all(['600 40px Inter', '800 40px Inter', '40px Anton', '800 40px Poppins'].map(function (f) { return document.fonts.load(f); })).catch(function () {})
    : Promise.resolve();
  loadDemo();
  setStyle(state.style);
  requestAnimationFrame(tick);
  fontsReady.then(function () { refresh(); });
  // Caption fonts load without blocking the page; re-measure line widths once they arrive.
  if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', function () { if (!state.exporting) refresh(); });
})();
