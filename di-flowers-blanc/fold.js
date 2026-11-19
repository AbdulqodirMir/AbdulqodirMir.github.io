/* Pastry-fold image loading (unblur kit preset).
   Every photo paints in as a coarse triangle mosaic of its own pixels, folding
   up to sharp (10 -> 40 -> 128 triangles -> full image). Real image data only:
   no overlays, no blur layers, no colour veils. Mark photos with
   <picture data-fold="path/base"> holding the sharp <img>; the base names the
   fold_pieces.py output (-fold-10/40/128.webp next to the sharp file).
   The native <picture>/<img> is never moved or re-requested; a canvas sits on
   top while folding and fades out at the end, so the settled page is identical
   to before. Skips itself when the image is already loaded or arrives within
   240 ms, when the user prefers reduced motion, or when the tab is hidden. */
(() => {
  const d = document, W = window;
  const RM = matchMedia('(prefers-reduced-motion: reduce)');
  if (RM.matches || !('IntersectionObserver' in W)) return;

  const toBitmap = im => createImageBitmap(im).catch(() => im); // bitmap = true pixel dims; fallback keeps the element
  const load = url => new Promise((resolve, reject) => {
    const im = new Image();
    im.decoding = 'async';
    im.onload = () => im.decode().then(() => toBitmap(im)).then(resolve, () => resolve(im)).catch(() => resolve(im));
    im.onerror = reject;
    im.src = url;
  });

  const visible = el => {
    for (let n = el, i = 0; n && n !== d.body && i < 8; n = n.parentElement, i++) {
      const cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < .05) return false;
      if (cs.clipPath && cs.clipPath.startsWith('inset(')) {
        const m = cs.clipPath.match(/inset\(([\d.]+)%/);
        if (m && +m[1] > 99) return false;
      }
    }
    const r = el.getBoundingClientRect();
    return r.width > 4 && r.height > 4;
  };

  const imgReady = img => {
    if (img.complete && img.naturalWidth > 0) return Promise.resolve(true);
    return new Promise(res => {
      const done = () => res(img.complete && img.naturalWidth > 0);
      img.addEventListener('load', done, { once: true });
      img.addEventListener('error', done, { once: true });
    });
  };

  const cells = [];
  for (let y = 0; y < 5; y++) for (let x = 0; x < 4; x++) {
    const x0 = x / 4, x1 = (x + 1) / 4, y0 = y / 5, y1 = (y + 1) / 5;
    cells.push({ points: [[x0, y0], [x1, y0], [x1, y1]], order: x + y + .25 });
    cells.push({ points: [[x0, y0], [x1, y1], [x0, y1]], order: x + y + .75 });
  }

  const render = async pic => {
    if (pic.__fold) return; pic.__fold = true;
    const img = pic.querySelector('img');
    if (!img) return;
    const sharpP = imgReady(img);
    if (img.complete && img.naturalWidth > 0) return; // already here: nothing to reveal
    let first;
    try { first = await load(pic.dataset.fold + '-fold-10.webp'); } catch (e) { return; }
    if (!pic.isConnected) return;
    if (img.complete && img.naturalWidth > 0) return; // sharp arrived meanwhile: never cover it

    if (getComputedStyle(pic).position === 'static') pic.classList.add('fold-pos');
    const rect = pic.getBoundingClientRect(), ratio = Math.min(devicePixelRatio || 1, 1.5);
    const canvas = d.createElement('canvas');
    canvas.className = 'fold-c';
    canvas.setAttribute('aria-hidden', 'true');
    canvas.width = Math.max(1, Math.round(rect.width * ratio));
    canvas.height = Math.max(1, Math.round(rect.height * ratio));
    const ctx = canvas.getContext('2d', { alpha: false });
    let disposed = false, resizeEpoch = 0;
    const active = () => pic.isConnected && !disposed;

    // Cover-fit anchored at the img's own computed object-position, so the
    // folded pixels sit exactly where the settled image will (default 50% 50%).
    const op = (getComputedStyle(img).objectPosition || '50% 50%').trim().split(/\s+/);
    const pct = v => /%$/.test(v) ? parseFloat(v) / 100 : 0.5;
    const ax = pct(op[0]), ay = pct(op[1] || '50%');
    const paint = (image, cell, alpha = 1) => {
      const w = canvas.width, h = canvas.height;
      if (cell) {
        ctx.save(); ctx.beginPath();
        cell.forEach((p, i) => i ? ctx.lineTo(p[0] * w, p[1] * h) : ctx.moveTo(p[0] * w, p[1] * h));
        ctx.closePath(); ctx.clip(); ctx.globalAlpha = alpha;
      }
      const iw = image.width, ih = image.height; // ImageBitmap pixel dims (drawImage source rect is raw bitmap space, NOT srcset-density-corrected space)
      const scale = Math.max(w / iw, h / ih), sw = w / scale, sh = h / scale;
      ctx.drawImage(image, (iw - sw) * ax, (ih - sh) * ay, sw, sh, 0, 0, w, h);
      if (cell) ctx.restore();
    };

    let current = first;
    paint(first);
    pic.append(canvas);
    pic.dataset.quality = '10';

    const resizer = new ResizeObserver(() => {
      if (!active() || !canvas.isConnected) return;
      const r = pic.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(r.width * ratio));
      canvas.height = Math.max(1, Math.round(r.height * ratio));
      resizeEpoch++; paint(current);
    });
    resizer.observe(pic);

    const morph = (next, q) => new Promise(resolve => {
      if (!active()) { resolve(); return; }
      if (document.hidden || RM.matches) { paint(next); current = next; pic.dataset.quality = q; resolve(); return; }
      const previous = current, start = performance.now(), span = q === 'sharp' ? 460 : 280;
      let painted = new Set(), epoch = resizeEpoch; paint(previous);
      const frame = now => {
        if (!active()) { resolve(); return; }
        const t = Math.min(1, (now - start) / span);
        if (epoch !== resizeEpoch) { epoch = resizeEpoch; painted.clear(); paint(previous); }
        for (const cell of cells) {
          if (painted.has(cell)) continue;
          const u = Math.max(0, Math.min(1, (t - (cell.order / 8) * .60) / .35)); if (!u) continue;
          if (u < 1) { paint(previous, cell.points); paint(next, cell.points, 1 - Math.pow(1 - u, 3)); }
          else { paint(next, cell.points); painted.add(cell); }
        }
        if (t < 1) requestAnimationFrame(frame);
        else { paint(next); current = next; pic.dataset.quality = q; resolve(); }
      };
      requestAnimationFrame(frame);
    });

    let sharpReady = false;
    sharpP.then(ok => { sharpReady = ok; });
    try {
      for (const n of [40, 128]) {
        if (sharpReady) break;
        const next = await load(pic.dataset.fold + '-fold-' + n + '.webp');
        if (!active()) return;
        if (sharpReady) break;
        await morph(next, String(n));
      }
      const ok = await sharpP;
      if (!active()) return;
      if (ok) {
        await img.decode().catch(() => {});
        if (!active()) return;
        await morph(await toBitmap(img), 'sharp');
      }
    } catch (e) { /* fall through to cleanup */ }
    disposed = true; resizer.disconnect();
    if (canvas.isConnected) { // hand off to the native img with a short fade: no hard swap, no settle shimmer
      canvas.style.transition = 'opacity 140ms ease';
      requestAnimationFrame(() => { canvas.style.opacity = '0'; });
      setTimeout(() => canvas.isConnected && canvas.remove(), 200);
    }
  };

  const arm = pic => {
    const img = pic.querySelector('img');
    if (!img) return;
    let started = false, poll = 0;
    const io = new IntersectionObserver(es => es.forEach(e => {
      if (!e.isIntersecting || started) return;
      // images hidden behind .on/clip states wait until actually shown; the img's
      // own opacity counts too (theme variants are hidden with opacity:0 on the img)
      poll = poll || setInterval(() => {
        if (visible(img)) { started = true; clearInterval(poll); poll = 0; io.disconnect(); render(pic); }
      }, 250);
    }), { rootMargin: '80px' });
    io.observe(pic);
  };

  d.querySelectorAll('picture.fold').forEach(arm);
})();
