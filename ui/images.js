/* Folio images: a zoomable image viewer (the image file view, and a lightbox over notes and
 * canvases), a crop tool, and screen capture through the browser for when the system has no
 * screenshot tool. No dependencies; everything draws with the DOM and a 2D canvas. */
'use strict';

(function (root) {
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const ICON = d => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const I = {
    prev: '<path d="M15 5l-7 7 7 7"/>',
    next: '<path d="M9 5l7 7-7 7"/>',
    zoomOut: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5M8 11h6"/>',
    zoomIn: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5M8 11h6M11 8v6"/>',
    fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    crop: '<path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/>',
    annotate: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
    open: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
  };
  const btn = (a, title, icon) => `<button class="dr-btn" data-a="${a}" title="${esc(title)}">${ICON(icon)}</button>`;
  const modalRoot = () => document.getElementById('modal-root') || document.body;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // ------------------------------------------------------------ viewer

  // Show items[index] ({src, name, path}) in `host`, zoomable and pannable. o: {modal, onClose,
  // onCrop(item), onAnnotate(item), onOpen(item), onCopy(item)}; actions without a handler are hidden.
  function viewer(host, items, index, o = {}) {
    let i = clamp(index | 0, 0, items.length - 1);
    let z = 1, x = 0, y = 0, fitted = true, drag = null;
    host.innerHTML = `<div class="iv${o.modal ? ' iv-modal' : ''}" tabindex="-1">
      <div class="iv-stage"><img class="iv-img" draggable="false" alt=""></div>
      <div class="iv-top"><span class="iv-name"></span>${o.modal ? btn('close', 'Close (Esc)', I.close) : ''}</div>
      <div class="iv-bar dr-island">
        ${items.length > 1 ? `${btn('prev', 'Previous image (←)', I.prev)}<span class="iv-count"></span>${btn('next', 'Next image (→)', I.next)}<span class="iv-sep"></span>` : ''}
        ${btn('out', 'Zoom out (-)', I.zoomOut)}<button class="dr-btn iv-zoom" data-a="actual" title="Actual size (1) or fit (0)">100%</button>${btn('in', 'Zoom in (+)', I.zoomIn)}${btn('fit', 'Fit to window (0)', I.fit)}
        ${o.onCrop || o.onAnnotate || o.onCopy || o.onOpen ? '<span class="iv-sep"></span>' : ''}
        ${o.onCrop ? btn('crop', 'Crop…', I.crop) : ''}${o.onAnnotate ? btn('annotate', 'Annotate in a drawing', I.annotate) : ''}${o.onCopy ? btn('copy', 'Copy image', I.copy) : ''}${o.onOpen ? btn('open', 'Open the image file', I.open) : ''}
      </div>
    </div>`;
    const el = host.querySelector('.iv'), stage = el.querySelector('.iv-stage'), img = el.querySelector('.iv-img');
    const zoomLabel = el.querySelector('.iv-zoom');

    const apply = () => {
      img.style.transform = `translate(${x}px, ${y}px) scale(${z})`;
      zoomLabel.textContent = Math.round(z * 100) + '%';
      stage.classList.toggle('iv-pannable', !fitted);
    };
    const fit = () => {
      const w = img.naturalWidth || 1, h = img.naturalHeight || 1, sw = stage.clientWidth, sh = stage.clientHeight;
      z = Math.min(1, (sw - 32) / w, (sh - 32) / h);
      if (!(z > 0)) z = 1;
      x = (sw - w * z) / 2; y = (sh - h * z) / 2; fitted = true;
      apply();
    };
    // Zoom to `nz` keeping the image point under (px, py) (stage coordinates) in place.
    const zoomAt = (nz, px = stage.clientWidth / 2, py = stage.clientHeight / 2) => {
      nz = clamp(nz, 0.02, 32);
      x = px - (px - x) * nz / z; y = py - (py - y) * nz / z; z = nz; fitted = false;
      apply();
    };
    const show = n => {
      i = (n + items.length) % items.length;
      const it = items[i];
      img.onload = () => fit();
      img.src = it.src;
      img.alt = it.name || '';
      el.querySelector('.iv-name').textContent = it.name || '';
      const c = el.querySelector('.iv-count');
      if (c) c.textContent = `${i + 1} / ${items.length}`;
    };

    stage.addEventListener('wheel', e => {
      e.preventDefault();
      const r = stage.getBoundingClientRect();
      const mult = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      zoomAt(z * Math.exp(-e.deltaY * mult * (Math.abs(e.deltaY) < 20 ? 0.01 : 0.0022)), e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
    stage.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      if (o.modal && e.target === stage && fitted) return; // a click beside the image closes (see click)
      drag = { sx: e.clientX, sy: e.clientY, x, y, moved: false };
      stage.setPointerCapture(e.pointerId);
    });
    stage.addEventListener('pointermove', e => {
      if (!drag) return;
      const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
      if (!drag.moved && Math.hypot(dx, dy) < 3) return;
      drag.moved = true; x = drag.x + dx; y = drag.y + dy; fitted = false;
      stage.classList.add('iv-grabbing');
      apply();
    });
    const endDrag = () => { if (drag) { stage.classList.remove('iv-grabbing'); setTimeout(() => { drag = null; }, 0); } };
    stage.addEventListener('pointerup', endDrag);
    stage.addEventListener('pointercancel', endDrag);
    stage.addEventListener('click', e => { if (o.modal && e.target === stage && !drag?.moved) o.onClose?.(); });
    stage.addEventListener('dblclick', e => {
      const r = stage.getBoundingClientRect();
      if (fitted && z < 1) zoomAt(1, e.clientX - r.left, e.clientY - r.top); else fit();
    });
    el.addEventListener('click', e => {
      const b = e.target.closest('[data-a]');
      if (!b) return;
      const it = items[i];
      switch (b.dataset.a) {
        case 'prev': show(i - 1); break;
        case 'next': show(i + 1); break;
        case 'in': zoomAt(z * 1.25); break;
        case 'out': zoomAt(z / 1.25); break;
        case 'fit': fit(); break;
        case 'actual': if (Math.abs(z - 1) < 1e-3) fit(); else zoomAt(1); break;
        case 'crop': o.onCrop?.(it); break;
        case 'annotate': o.onAnnotate?.(it); break;
        case 'copy': o.onCopy?.(it); break;
        case 'open': o.onOpen?.(it); break;
        case 'close': o.onClose?.(); break;
      }
    });
    el.addEventListener('keydown', e => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key;
      let done = true;
      if (k === 'Escape' && o.modal) o.onClose?.();
      else if ((k === 'ArrowLeft' || k === 'ArrowUp' || k === 'PageUp') && items.length > 1) show(i - 1);
      else if ((k === 'ArrowRight' || k === 'ArrowDown' || k === 'PageDown' || k === ' ') && items.length > 1) show(i + 1);
      else if (k === '+' || k === '=') zoomAt(z * 1.25);
      else if (k === '-' || k === '_') zoomAt(z / 1.25);
      else if (k === '0') fit();
      else if (k === '1') zoomAt(1);
      else done = false;
      if (done) { e.preventDefault(); e.stopPropagation(); }
    });
    const ro = new ResizeObserver(() => { if (fitted) fit(); });
    ro.observe(stage);
    show(i);
    return {
      el,
      focus() { el.focus({ preventScroll: true }); },
      get index() { return i; },
      destroy() { ro.disconnect(); host.innerHTML = ''; },
    };
  }

  // A viewer over everything; resolves when it closes.
  function lightbox(items, index, o = {}) {
    return new Promise(resolve => {
      const back = document.createElement('div');
      back.className = 'iv-back';
      modalRoot().append(back);
      const prev = document.activeElement;
      const close = () => { v.destroy(); back.remove(); prev?.focus?.({ preventScroll: true }); resolve(); };
      const wrap = f => f && (it => { close(); f(it); });
      const v = viewer(back, items, index, { ...o, modal: true, onClose: close, onCrop: wrap(o.onCrop), onAnnotate: wrap(o.onAnnotate), onOpen: wrap(o.onOpen) });
      v.focus();
    });
  }

  // ------------------------------------------------------------ crop

  // Let the user pick part of the image at `src`. Resolves with a PNG Blob, or null if cancelled.
  // o.whole: offer "Use whole image" (for screenshots).
  function crop(src, o = {}) {
    return new Promise(resolve => {
      const back = document.createElement('div');
      back.className = 'iv-back ic';
      back.innerHTML = `<div class="ic-top"><b>${esc(o.title || 'Crop image')}</b><span>Drag to select · Enter to crop · Esc to cancel</span></div>
        <div class="ic-stage"><div class="ic-frame"><img class="ic-img" draggable="false" alt=""><div class="ic-sel" hidden>${['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map(d => `<i class="ic-h" data-d="${d}"></i>`).join('')}<span class="ic-size"></span></div></div></div>
        <div class="ic-bar"><button class="btn" data-a="cancel">Cancel</button>${o.whole ? '<button class="btn" data-a="whole">Use whole image</button>' : ''}<button class="btn primary" data-a="ok" disabled>${esc(o.okLabel || 'Crop')}</button></div>`;
      modalRoot().append(back);
      back.tabIndex = -1;
      const prevFocus = document.activeElement;
      const frame = back.querySelector('.ic-frame'), img = back.querySelector('.ic-img'), selEl = back.querySelector('.ic-sel');
      const okBtn = back.querySelector('[data-a=ok]'), sizeEl = back.querySelector('.ic-size');
      let sel = null, drag = null; // sel in natural image pixels {x, y, w, h}
      const scale = () => img.clientWidth / (img.naturalWidth || 1);
      const draw = () => {
        selEl.hidden = !sel;
        okBtn.disabled = !sel || sel.w < 2 || sel.h < 2;
        if (!sel) return;
        const s = scale();
        Object.assign(selEl.style, { left: sel.x * s + 'px', top: sel.y * s + 'px', width: sel.w * s + 'px', height: sel.h * s + 'px' });
        sizeEl.textContent = `${Math.round(sel.w)} × ${Math.round(sel.h)}`;
      };
      const toImg = e => {
        const r = img.getBoundingClientRect(), s = scale();
        return [clamp((e.clientX - r.left) / s, 0, img.naturalWidth), clamp((e.clientY - r.top) / s, 0, img.naturalHeight)];
      };
      const finish = async how => {
        let out = null;
        if (how === 'ok' && sel && sel.w >= 2 && sel.h >= 2) out = await render(img, sel);
        else if (how === 'whole') out = await render(img, { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight });
        back.remove();
        prevFocus?.focus?.({ preventScroll: true });
        resolve(out);
      };
      frame.addEventListener('pointerdown', e => {
        if (e.button !== 0) return;
        e.preventDefault();
        const [px, py] = toImg(e);
        const h = e.target.closest('.ic-h');
        if (h) drag = { mode: h.dataset.d, sel: { ...sel } };
        else if (sel && e.target.closest('.ic-sel')) drag = { mode: 'move', px, py, sel: { ...sel } };
        else { drag = { mode: 'new', px, py }; sel = { x: px, y: py, w: 0, h: 0 }; }
        frame.setPointerCapture(e.pointerId);
        draw();
      });
      frame.addEventListener('pointermove', e => {
        if (!drag) return;
        const [px, py] = toImg(e), W = img.naturalWidth, H = img.naturalHeight;
        if (drag.mode === 'new') sel = { x: Math.min(px, drag.px), y: Math.min(py, drag.py), w: Math.abs(px - drag.px), h: Math.abs(py - drag.py) };
        else if (drag.mode === 'move') {
          const s = drag.sel;
          sel = { ...s, x: clamp(s.x + px - drag.px, 0, W - s.w), y: clamp(s.y + py - drag.py, 0, H - s.h) };
        } else {
          let { x: x1, y: y1 } = drag.sel, x2 = x1 + drag.sel.w, y2 = y1 + drag.sel.h;
          if (drag.mode.includes('w')) x1 = px;
          if (drag.mode.includes('e')) x2 = px;
          if (drag.mode.includes('n')) y1 = py;
          if (drag.mode.includes('s')) y2 = py;
          sel = { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
        }
        draw();
      });
      const up = () => { drag = null; if (sel && (sel.w < 2 || sel.h < 2)) sel = null; draw(); };
      frame.addEventListener('pointerup', up);
      frame.addEventListener('pointercancel', up);
      back.addEventListener('click', e => { const b = e.target.closest('[data-a]'); if (b) finish(b.dataset.a); });
      back.addEventListener('keydown', e => {
        e.stopPropagation();
        if (e.key === 'Escape') { e.preventDefault(); finish('cancel'); }
        else if (e.key === 'Enter') { e.preventDefault(); finish(sel ? 'ok' : o.whole ? 'whole' : 'cancel'); }
        else if (e.key.startsWith('Arrow') && sel) {
          // Nudge the selection (Shift: resize it instead).
          e.preventDefault();
          const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key].map(v => v * (e.altKey ? 10 : 1) / Math.min(1, scale()));
          if (e.shiftKey) sel = { ...sel, w: clamp(sel.w + d[0], 2, img.naturalWidth - sel.x), h: clamp(sel.h + d[1], 2, img.naturalHeight - sel.y) };
          else sel = { ...sel, x: clamp(sel.x + d[0], 0, img.naturalWidth - sel.w), y: clamp(sel.y + d[1], 0, img.naturalHeight - sel.h) };
          draw();
        }
      });
      new ResizeObserver(draw).observe(img);
      img.onload = () => { draw(); back.focus(); };
      img.onerror = () => { back.remove(); resolve(null); };
      img.src = src;
    });
  }

  function render(img, r) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(r.w)); c.height = Math.max(1, Math.round(r.h));
    c.getContext('2d').drawImage(img, Math.round(r.x), Math.round(r.y), c.width, c.height, 0, 0, c.width, c.height);
    return new Promise(res => c.toBlob(b => res(b), 'image/png'));
  }

  // ------------------------------------------------------------ screen capture

  const canCaptureScreen = () => !!navigator.mediaDevices?.getDisplayMedia;

  // Ask the browser for a screen, window or tab, grab one frame, then let the user crop it.
  // Resolves with a PNG Blob, or null if the user cancelled.
  async function captureScreen() {
    if (!canCaptureScreen()) throw new Error('screen capture isn’t available in this window');
    let stream;
    try { stream = await navigator.mediaDevices.getDisplayMedia({ video: { cursor: 'never' }, audio: false }); }
    catch (e) { if (e.name === 'NotAllowedError' || e.name === 'AbortError') return null; throw e; }
    let blob;
    try {
      const video = document.createElement('video');
      video.muted = true; video.playsInline = true; video.srcObject = stream;
      await video.play();
      // Give the picker a moment to disappear from what's being captured.
      await new Promise(r => setTimeout(r, 250));
      const c = document.createElement('canvas');
      c.width = video.videoWidth; c.height = video.videoHeight;
      c.getContext('2d').drawImage(video, 0, 0);
      blob = await new Promise(r => c.toBlob(r, 'image/png'));
    } finally { stream.getTracks().forEach(t => t.stop()); }
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    try { return await crop(url, { title: 'Screenshot', whole: true, okLabel: 'Use selection' }); }
    finally { URL.revokeObjectURL(url); }
  }

  root.FolioImages = { viewer, lightbox, crop, captureScreen, canCaptureScreen };
})(typeof window !== 'undefined' ? window : globalThis);
