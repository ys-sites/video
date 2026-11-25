// Masvid live demos: every skill tile is drawn live in a <canvas> (no video downloads).
// <canvas data-demo="captions-pop"> ... ; the hero pairs a typing chat with the matching effect.
(function () {
  'use strict';
  var SANS = "'Geist','Segoe UI',Inter,Arial,sans-serif";
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function ease(x) { x = Math.max(0, Math.min(1, x)); return 1 - Math.pow(1 - x, 3); }
  function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }

  // ---------- scenes ----------
  function speaker(c, t, W, H, hue) {
    var g = c.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, 'hsl(' + hue + ',45%,22%)'); g.addColorStop(1, 'hsl(' + ((hue + 40) % 360) + ',55%,9%)');
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    for (var i = 0; i < 7; i++) {
      var x = (W * (0.15 + 0.13 * i) + Math.sin(t * 0.4 + i) * 12) % W, y = H * (0.18 + 0.09 * (i % 4));
      c.fillStyle = 'hsla(' + (hue + i * 12) + ',80%,70%,0.10)'; c.beginPath(); c.arc(x, y, W * (0.07 + 0.02 * (i % 3)), 0, 7); c.fill();
    }
    var bob = Math.sin(t * 2.2) * H * 0.004, cx = W / 2, hy = H * 0.43 + bob;
    c.fillStyle = 'rgba(8,8,10,0.92)';
    rr(c, cx - W * 0.33, H * 0.6 + bob, W * 0.66, H * 0.5, W * 0.16); c.fill();
    c.beginPath(); c.ellipse(cx, hy, W * 0.13, W * 0.16, 0, 0, 7); c.fill();
    c.strokeStyle = 'hsla(' + hue + ',90%,75%,0.55)'; c.lineWidth = W * 0.008;
    c.beginPath(); c.ellipse(cx, hy, W * 0.13, W * 0.16, 0, -1.2, 0.6); c.stroke();
  }
  function room(c, t, W, H) {
    var push = 1 + 0.04 * Math.sin(t * 0.5);
    c.save(); c.translate(W / 2, H / 2); c.scale(push, push); c.translate(-W / 2, -H / 2);
    c.fillStyle = '#e9e3d8'; c.fillRect(0, 0, W, H);
    c.fillStyle = '#d8cfc0'; c.beginPath(); c.moveTo(0, H * 0.62); c.lineTo(W, H * 0.62); c.lineTo(W, H); c.lineTo(0, H); c.fill();
    c.fillStyle = '#b98c5f'; c.beginPath(); c.moveTo(W * 0.1, H * 0.62); c.lineTo(W * 0.9, H * 0.62); c.lineTo(W * 1.2, H); c.lineTo(-W * 0.2, H); c.fill();
    var win = c.createLinearGradient(0, H * 0.2, 0, H * 0.5); win.addColorStop(0, '#bfe3ff'); win.addColorStop(1, '#fff6dc');
    c.fillStyle = win; c.fillRect(W * 0.3, H * 0.2, W * 0.4, H * 0.3);
    c.strokeStyle = '#ffffff'; c.lineWidth = W * 0.015; c.strokeRect(W * 0.3, H * 0.2, W * 0.4, H * 0.3);
    c.beginPath(); c.moveTo(W / 2, H * 0.2); c.lineTo(W / 2, H * 0.5); c.stroke();
    c.fillStyle = '#3c4a3f'; rr(c, W * 0.12, H * 0.52, W * 0.42, H * 0.12, W * 0.03); c.fill();
    c.fillStyle = '#2d3830'; rr(c, W * 0.12, H * 0.47, W * 0.42, H * 0.07, W * 0.03); c.fill();
    c.fillStyle = 'rgba(255,240,200,0.25)'; c.beginPath(); c.moveTo(W * 0.3, H * 0.5); c.lineTo(W * 0.7, H * 0.5); c.lineTo(W * 0.85, H * 0.95); c.lineTo(W * 0.15, H * 0.95); c.fill();
    c.restore();
  }

  // ---------- captions ----------
  var PHRASES = { pop: ['THIS', 'KITCHEN', 'IS', 'HUGE'], bold: ['3', 'BEDS', 'UNDER', '$600K'], karaoke: ['LISTED', 'THIS', 'MORNING'], editorial: ['Light', 'from', 'every', 'room'], minimal: ['walk', 'with', 'me'] };
  function captions(c, t, W, H, style, accent, phrase) {
    var words = phrase || PHRASES[style] || PHRASES.pop, per = 0.42, cyc = words.length * per + 0.9, lt = t % cyc;
    var size = W * (style === 'minimal' ? 0.075 : style === 'editorial' ? 0.095 : 0.11);
    c.font = (style === 'editorial' ? 'italic 600 ' : style === 'minimal' ? '500 ' : '900 ') + size + 'px ' + (style === 'editorial' ? 'Georgia,serif' : SANS);
    c.textBaseline = 'middle'; c.textAlign = 'left';
    var sp = size * 0.3, ws = words.map(function (w) { return c.measureText(w).width; });
    var lines = [[]], lw = 0;
    words.forEach(function (w, i) { if (lw + ws[i] > W * 0.82 && lines[lines.length - 1].length) { lines.push([]); lw = 0; } lines[lines.length - 1].push(i); lw += ws[i] + sp; });
    var y0 = H * 0.74 - (lines.length - 1) * size * 0.62;
    lines.forEach(function (line, li) {
      var tot = line.reduce(function (n, i) { return n + ws[i]; }, 0) + sp * (line.length - 1), x = (W - tot) / 2, y = y0 + li * size * 1.25;
      line.forEach(function (i) {
        var s = i * per, active = lt >= s && lt < s + per, shown = lt >= s, a = style === 'karaoke' ? 1 : ease((lt - s) / 0.12);
        if (!shown && style !== 'karaoke') { x += ws[i] + sp; return; }
        c.save(); c.globalAlpha = a; c.translate(x + ws[i] / 2, y);
        if (active && style === 'pop') { var k = 1 + 0.15 * (1 - ease((lt - s) / 0.15)); c.scale(k, k); c.fillStyle = accent; rr(c, -ws[i] / 2 - size * 0.16, -size * 0.6, ws[i] + size * 0.32, size * 1.15, size * 0.2); c.fill(); c.fillStyle = '#0b0b0c'; c.fillText(words[i], -ws[i] / 2, 0); }
        else if (style === 'editorial') { c.shadowColor = 'rgba(0,0,0,.6)'; c.shadowBlur = size * 0.3; c.fillStyle = '#fff'; c.fillText(words[i], -ws[i] / 2, 0); if (active) { c.shadowBlur = 0; c.fillStyle = accent; c.fillRect(-ws[i] / 2, size * 0.5, ws[i], size * 0.08); } }
        else if (style === 'minimal') { c.shadowColor = 'rgba(0,0,0,.6)'; c.shadowBlur = size * 0.3; c.fillStyle = '#fff'; c.fillText(words[i], -ws[i] / 2, 0); }
        else { c.lineJoin = 'round'; c.lineWidth = size * 0.16; c.strokeStyle = 'rgba(0,0,0,.9)'; c.strokeText(words[i], -ws[i] / 2, 0); c.fillStyle = active ? accent : style === 'karaoke' && !shown ? 'rgba(255,255,255,.5)' : '#fff'; c.fillText(words[i], -ws[i] / 2, 0); }
        c.restore(); x += ws[i] + sp;
      });
    });
  }

  // ---------- demos ----------
  var LOOKS = [['Original', 'none'], ['Cinematic', 'brightness(.95) contrast(1.15) saturate(.85)'], ['Warm', 'saturate(1.15) sepia(.18)'], ['B&W', 'grayscale(1) contrast(1.15)']];
  var DEMOS = {
    'captions-pop': function (c, t, W, H) { speaker(c, t, W, H, 260); captions(c, t, W, H, 'pop', '#c5f04a'); },
    'captions-bold': function (c, t, W, H) { speaker(c, t, W, H, 20); captions(c, t, W, H, 'bold', '#ffd400'); },
    'captions-karaoke': function (c, t, W, H) { speaker(c, t, W, H, 190); captions(c, t, W, H, 'karaoke', '#ff5fb7'); },
    'captions-editorial': function (c, t, W, H) { room(c, t, W, H); c.fillStyle = 'rgba(0,0,0,.25)'; c.fillRect(0, 0, W, H); captions(c, t, W, H, 'editorial', '#ffb020'); },
    'captions-minimal': function (c, t, W, H) { room(c, t, W, H); captions(c, t, W, H, 'minimal', '#fff'); },
    zoom: function (c, t, W, H) {
      var lt = t % 3.2, k = lt > 1.1 && lt < 2.5 ? 1 + 0.18 * ease((lt - 1.1) / 0.25) * ease((2.5 - lt) / 0.25) : 1;
      c.save(); c.translate(W / 2, H * 0.42); c.scale(k, k); c.translate(-W / 2, -H * 0.42); speaker(c, t, W, H, 300); c.restore();
      captions(c, lt, W, H, 'bold', '#c5f04a', ['ONLY', '$600K']);
    },
    look: function (c, t, W, H) {
      var i = Math.floor(t / 2.2) % LOOKS.length, next = LOOKS[(i + 1) % LOOKS.length], wipe = ease(((t % 2.2) - 1.4) / 0.7);
      c.save(); c.filter = LOOKS[i][1]; room(c, t, W, H); c.restore();
      if (wipe > 0) { c.save(); c.beginPath(); c.rect(0, 0, W * wipe, H); c.clip(); c.filter = next[1]; room(c, t, W, H); c.restore(); c.fillStyle = '#fff'; c.fillRect(W * wipe - 1, 0, 2, H); }
      label(c, W, H, wipe > 0.5 ? next[0] : LOOKS[i][0]);
    },
    reframe: function (c, t, W, H) {
      var k = ease(((t % 3.4) - 0.8) / 0.9);
      c.fillStyle = '#111'; c.fillRect(0, 0, W, H);
      c.save(); c.filter = 'blur(10px) brightness(.5)'; room(c, t, W, H); c.restore();
      var fw = W, fh = W * 9 / 16, tw = W, th = H, w = fw + (tw - fw) * k, h = fh + (th - fh) * k, x = (W - w) / 2, y = (H - h) / 2;
      c.save(); rr(c, x, y, w, h, 8); c.clip(); room(c, t, W, H); c.restore();
      c.strokeStyle = '#c5f04a'; c.lineWidth = 3; rr(c, x, y, w, h, 8); c.stroke();
      label(c, W, H, k > 0.5 ? '9:16' : '16:9');
    },
    cut: function (c, t, W, H) {
      c.fillStyle = '#0f0f12'; c.fillRect(0, 0, W, H);
      var words = ['Welcome', 'to', 'um,', 'this', 'uh,', 'beautiful', 'home.', '...', 'The', 'kitchen', 'is', 'um,', 'huge.'], bad = [2, 4, 7, 11], lt = t % 4.2;
      var size = W * 0.07; c.font = '600 ' + size + 'px ' + SANS; c.textBaseline = 'middle';
      var x = W * 0.08, y = H * 0.2;
      words.forEach(function (w, i) {
        var ww = c.measureText(w).width; if (x + ww > W * 0.92) { x = W * 0.08; y += size * 1.6; }
        var isBad = bad.indexOf(i) >= 0, gone = isBad && lt > 1.2 + bad.indexOf(i) * 0.35;
        c.fillStyle = isBad ? (gone ? 'rgba(255,90,90,.35)' : '#ff6b6b') : '#e4e4e7'; c.fillText(w, x, y);
        if (gone) { c.fillStyle = '#ff6b6b'; c.fillRect(x, y, ww * ease((lt - 1.2 - bad.indexOf(i) * 0.35) / 0.3), 2); }
        x += ww + size * 0.35;
      });
      var shrink = ease((lt - 2.8) / 0.8), bw = W * 0.84, by = H * 0.78;
      c.fillStyle = '#1f1f24'; rr(c, W * 0.08, by, bw, H * 0.05, 6); c.fill();
      var segs = [[0, 0.2], [0.26, 0.5], [0.6, 0.82], [0.88, 1]], acc = 0, total = segs.reduce(function (n, s) { return n + s[1] - s[0]; }, 0);
      segs.forEach(function (s, i) {
        var len = s[1] - s[0], from = s[0], to = acc / total; acc += len;
        var px = from + (to * total - from) * shrink, scale = 1 + (1 / total - 1) * shrink;
        c.fillStyle = '#4f8a72'; rr(c, W * 0.08 + bw * px * (shrink > 0 ? 1 : 1), by, Math.max(2, bw * len * scale - 3), H * 0.05, 5); c.fill();
      });
      label(c, W, H, shrink > 0.5 ? '−4.9 s dead air' : 'Edit by text');
    },
    titlecta: function (c, t, W, H) {
      room(c, t, W, H); c.fillStyle = 'rgba(0,0,0,.25)'; c.fillRect(0, 0, W, H);
      var lt = t % 4.6, ti = ease(lt / 0.4) * ease((2.2 - lt) / 0.3), ca = ease((lt - 2.4) / 0.4) * ease((4.4 - lt) / 0.3);
      c.textAlign = 'center'; c.textBaseline = 'middle';
      if (ti > 0) { var s = W * 0.12; c.globalAlpha = ti; c.font = '900 ' + s + 'px ' + SANS; c.lineWidth = s * 0.14; c.strokeStyle = '#000'; c.strokeText('JUST', W / 2, H * 0.2 + (1 - ti) * 20); c.fillStyle = '#fff'; c.fillText('JUST', W / 2, H * 0.2 + (1 - ti) * 20); c.strokeText('LISTED', W / 2, H * 0.2 + s * 1.1); c.fillStyle = '#c5f04a'; c.fillText('LISTED', W / 2, H * 0.2 + s * 1.1); c.globalAlpha = 1; }
      if (ca > 0) { var z = W * 0.065, bw = W * 0.72, by = H * 0.85 + (1 - ca) * 20; c.globalAlpha = ca; c.fillStyle = '#c5f04a'; rr(c, (W - bw) / 2, by - z, bw, z * 2, z); c.fill(); c.fillStyle = '#0b0b0c'; c.font = '800 ' + z + 'px ' + SANS; c.fillText('DM me for a tour', W / 2, by); c.globalAlpha = 1; }
      c.textAlign = 'left';
    },
    duck: function (c, t, W, H) {
      c.fillStyle = '#0f0f12'; c.fillRect(0, 0, W, H);
      var n = 34, bw = W * 0.84 / n;
      for (var i = 0; i < n; i++) {
        var ph = (i / n) * 6 + t * 1.5, talk = Math.sin(ph * 0.9) > 0.1;
        var v = talk ? 0.25 + 0.6 * Math.abs(Math.sin(ph * 5.1) * Math.cos(ph * 2.3)) : 0.03;
        c.fillStyle = '#c5f04a'; var vh = H * 0.28 * v; c.fillRect(W * 0.08 + i * bw, H * 0.36 - vh, bw * 0.6, vh * 2);
        var m = talk ? 0.12 : 0.5; c.fillStyle = '#b06ad6'; var mh = H * 0.12 * m * (0.8 + 0.2 * Math.sin(i + t * 3)); c.fillRect(W * 0.08 + i * bw, H * 0.72 - mh, bw * 0.6, mh * 2);
      }
      c.fillStyle = '#a1a1aa'; c.font = '600 ' + W * 0.05 + 'px ' + SANS; c.fillText('Voice', W * 0.08, H * 0.1); c.fillText('Music dips under it', W * 0.08, H * 0.56);
    },
    chat: function (c, t, W, H) {
      c.fillStyle = '#111113'; c.fillRect(0, 0, W, H);
      var msg = 'make it punchy with yellow captions', lt = t % 6, n = Math.min(msg.length, Math.floor(lt * 14));
      var s = W * 0.055; c.font = '500 ' + s + 'px ' + SANS; c.textBaseline = 'middle';
      c.fillStyle = '#27272a'; rr(c, W * 0.12, H * 0.12, W * 0.8, s * 3.2, 14); c.fill();
      c.fillStyle = '#fff'; wrap(c, msg.slice(0, n) + (n < msg.length && Math.floor(t * 3) % 2 ? '|' : ''), W * 0.16, H * 0.12 + s * 1.05, W * 0.72, s * 1.2);
      ['Cut 4 pauses', 'Removed 2 fillers', 'Yellow pop captions', 'Zoom on "$600K"'].forEach(function (st, i) {
        var a = ease((lt - 2.8 - i * 0.45) / 0.3); if (a <= 0) return;
        c.globalAlpha = a; c.fillStyle = '#c5f04a'; c.fillText('✓', W * 0.1, H * 0.42 + i * s * 1.9); c.fillStyle = '#d4d4d8'; c.fillText(st, W * 0.18, H * 0.42 + i * s * 1.9); c.globalAlpha = 1;
      });
    },
  };
  function label(c, W, H, text) { var s = W * 0.05; c.font = '700 ' + s + 'px ' + SANS; var w = c.measureText(text).width; c.fillStyle = 'rgba(0,0,0,.6)'; rr(c, W * 0.06, H * 0.05, w + s * 1.2, s * 1.9, s * 0.95); c.fill(); c.fillStyle = '#fff'; c.textBaseline = 'middle'; c.fillText(text, W * 0.06 + s * 0.6, H * 0.05 + s * 0.95); }
  function wrap(c, text, x, y, max, lh) { var line = '', words = text.split(' '); for (var i = 0; i < words.length; i++) { var test = line ? line + ' ' + words[i] : words[i]; if (c.measureText(test).width > max && line) { c.fillText(line, x, y); line = words[i]; y += lh; } else line = test; } c.fillText(line, x, y); }

  // ---------- runtime ----------
  var tiles = [];
  function setup(canvas) {
    var fn = DEMOS[canvas.getAttribute('data-demo')]; if (!fn) return;
    var tile = { canvas: canvas, ctx: canvas.getContext('2d'), fn: fn, visible: false, start: performance.now() };
    tiles.push(tile);
    if ('IntersectionObserver' in window) new IntersectionObserver(function (es) { tile.visible = es[0].isIntersecting; }, { threshold: 0.15 }).observe(canvas);
    else tile.visible = true;
    fn(tile.ctx, 1.1, canvas.width, canvas.height);
  }
  var HERO = [
    { say: 'Make it punchy', demo: 'cut' }, { say: 'Yellow pop captions', demo: 'captions-bold' }, { say: 'Zoom in on the price', demo: 'zoom' },
    { say: 'Give it a cinematic look', demo: 'look' }, { say: 'Make it 9:16 for Reels', demo: 'reframe' }, { say: 'Add a hook and a call to action', demo: 'titlecta' },
  ];
  function hero(root) {
    var canvas = root.querySelector('canvas'), say = root.querySelector('[data-say]'), steps = root.querySelectorAll('[data-step]');
    if (!canvas || !say) return;
    var ctx = canvas.getContext('2d'), start = performance.now(), last = -1;
    tiles.push({ canvas: canvas, ctx: ctx, visible: true, start: start, fn: function (c, t, W, H) {
      var i = Math.floor(t / 5) % HERO.length, lt = t % 5;
      if (i !== last) { last = i; steps.forEach(function (s, k) { s.classList.toggle('on', k === i); }); }
      var full = HERO[i].say, n = Math.min(full.length, Math.floor(lt * 18));
      say.textContent = full.slice(0, n) + (n < full.length ? '▍' : '');
      DEMOS[HERO[i].demo](c, lt + 0.6, W, H);
    } });
  }
  function loop(now) {
    for (var i = 0; i < tiles.length; i++) { var tl = tiles[i]; if (!tl.visible) continue; tl.fn(tl.ctx, Math.max(0, (now - tl.start) / 1000), tl.canvas.width, tl.canvas.height); }
    if (!reduce) requestAnimationFrame(loop);
  }
  function init() {
    document.querySelectorAll('canvas[data-demo]').forEach(setup);
    document.querySelectorAll('[data-hero]').forEach(hero);
    document.querySelectorAll('video[data-hover]').forEach(function (v) {
      var card = v.closest('a,article') || v;
      card.addEventListener('mouseenter', function () { v.play().catch(function () {}); });
      card.addEventListener('mouseleave', function () { v.pause(); });
      if ('IntersectionObserver' in window && matchMedia('(hover: none)').matches) new IntersectionObserver(function (es) { es[0].isIntersecting ? v.play().catch(function () {}) : v.pause(); }, { threshold: 0.6 }).observe(v);
    });
    document.querySelectorAll('[data-filter]').forEach(function (b) {
      b.addEventListener('click', function () {
        var f = b.getAttribute('data-filter');
        document.querySelectorAll('[data-filter]').forEach(function (x) { x.classList.toggle('on', x === b); });
        document.querySelectorAll('[data-kind]').forEach(function (el) { el.hidden = f !== 'all' && el.getAttribute('data-kind').indexOf(f) < 0; });
      });
    });
    requestAnimationFrame(loop);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
