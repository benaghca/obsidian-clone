// Edge cases for CZ2: title mode at 45%/55%, and double-click zoom-then-edit.
// Rapid wheels across the band, a pan or a zoom button during the 120ms settle,
// and a double-click while that settle is still pending. Product code is unchanged.
import { withBrowser, sleep } from './browser.mjs';

await withBrowser(async ({ send, run, click, press, check }) => {
  // Same predicate as navigation.ts titleMode / titleEdge, including the float snap.
  const titleMode = (scale, now) => {
    const zoom = Math.abs(scale - 0.45) <= 1e-6 ? 0.45 : Math.abs(scale - 0.55) <= 1e-6 ? 0.55 : scale;
    return now ? zoom <= 0.55 : zoom < 0.45;
  };
  const look = () => run(() => {
    const world = document.querySelector('.canvas-world');
    const m = new DOMMatrix(getComputedStyle(world).transform);
    const card = document.querySelector('[data-node-id="t"], [data-node-id="h"]');
    return {
      out: world.classList.contains('is-zoomed-out'),
      scale: m.a, x: m.e, y: m.f,
      editing: !!document.querySelector('.canvas-node.is-editing, .canvas-group-label.is-editing'),
      nodes: document.querySelectorAll('.canvas-node').length,
      cardEditing: !!card?.classList.contains('is-editing'),
    };
  });
  const cardPoint = (id, fy = 0.72) => run((id, fy) => {
    const r = document.querySelector(`[data-node-id="${id}"]`).getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height * fy };
  }, id, fy);
  const wheel = async (p, deltaY, ctrl) => {
    await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: p.x, y: p.y, deltaX: 0, deltaY, modifiers: ctrl ? 2 : 0 });
  };
  const wheelTo = async (p, target) => {
    const scale = (await look()).scale;
    await wheel(p, -300 * Math.log2(target / scale), true);
  };
  const fastDouble = async (p) => {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y });
    for (const clickCount of [1, 2]) {
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', buttons: 0, clickCount });
    }
  };
  // One turn of ctrl+wheels. The DOM scale is stale until the frame, so each delta is
  // computed from the previous target, which is what the canvas state multiplied.
  const burst = (targets) => run(targets => {
    const view = document.querySelector('.canvas-view');
    const world = document.querySelector('.canvas-world');
    const r = view.getBoundingClientRect();
    const clientX = r.left + r.width / 2, clientY = r.top + Math.min(200, r.height / 2);
    let scale = new DOMMatrix(getComputedStyle(world).transform).a;
    const during = [];
    for (const target of targets) {
      view.dispatchEvent(new WheelEvent('wheel', {
        clientX, clientY, deltaY: -300 * Math.log2(target / scale), deltaX: 0,
        ctrlKey: true, bubbles: true, cancelable: true,
      }));
      scale = target;
      during.push(world.classList.contains('is-zoomed-out'));
    }
    return { during, clientX, clientY };
  }, targets);

  await run(async () => {
    const { api } = await import('/src/api.ts');
    await api.createNote('Target.md', '# Target\n\nBody.\n');
    await api.createNote('EdgeTitles.canvas', JSON.stringify({
      nodes: [
        { id: 't', type: 'text', x: 0, y: 0, width: 280, height: 180, text: 'Plan the trip\nbody of the card' },
        { id: 'g', type: 'group', x: 360, y: 0, width: 280, height: 200, label: 'Group' },
      ],
      edges: [],
    }));
    await ws.vault.refreshFiles();
    await ws.open('EdgeTitles.canvas');
  });
  await sleep(200);
  await click('[aria-label="Reset zoom"]');
  await sleep(80);
  const origin = await run(async () => {
    const { api } = await import('/src/api.ts');
    return api.readNote('EdgeTitles.canvas');
  });

  // Three zoom-out clicks cross 45%. Each click flushes, so title mode is on within a frame.
  let state = await look();
  check(!state.out && Math.abs(state.scale - 1) < 1e-6, 'reset zoom is 100% content (' + state.scale + ')');
  for (let i = 0; i < 3; i++) {
    await click('[aria-label="Zoom out"]');
    await sleep(40);
  }
  state = await look();
  check(state.out && state.scale < 0.45, 'three zoom-out clicks are in title mode within a frame (' + state.scale + ')');
  await sleep(200);
  const held = await look();
  check(held.out && Math.abs(held.scale - state.scale) < 1e-9, 'title mode does not flip again after the buttons rest');

  const at = await cardPoint('t');
  // From titles, one turn ends inside the band. Only the last scale is drawn,
  // so the class stays titles on the next frame and after the settle. An
  // in-band end looks the same if the class were applied on that frame. The
  // out-and-back wheel below is what shows the settle wait.
  await wheelTo(at, 0.36);
  await sleep(200);
  check((await look()).out && (await look()).scale < 0.45, 'a wheel to 36% is title mode');
  const down = await burst([0.7, 0.32, 0.62, 0.5]);
  check(down.during.every(value => value === true), 'a one-frame burst does not flip title mode mid-turn');
  await sleep(40);
  const downFrame = await look();
  check(downFrame.out, 'title mode is still on one frame after the burst (' + downFrame.scale + ')');
  await sleep(200);
  const downSettled = await look();
  check(downSettled.out === titleMode(downSettled.scale, true) && downSettled.out && downSettled.scale > 0.45 && downSettled.scale <= 0.55,
    'ending a burst inside the band, having started on titles, keeps titles (' + JSON.stringify(downSettled) + ')');

  // The same shape from content ends just above 45% and keeps content.
  await wheelTo(at, 0.62);
  await sleep(200);
  check(!(await look()).out && (await look()).scale > 0.55, 'a wheel to 62% leaves title mode');
  const up = await burst([0.3, 0.8, 0.48]);
  check(up.during.every(value => value === false), 'a burst from content does not enter title mode mid-turn');
  await sleep(40);
  check(!(await look()).out, 'content is still showing one frame after that burst');
  await sleep(200);
  const upSettled = await look();
  check(upSettled.out === titleMode(upSettled.scale, false) && !upSettled.out && upSettled.scale >= 0.45,
    'ending a burst above 45%, having started on content, keeps content (' + JSON.stringify(upSettled) + ')');

  // Out and back across two frames, still inside the 120ms settle, cancels the pending change.
  await wheelTo(at, 0.36);
  await sleep(200);
  check((await look()).out, 'back in title mode before the two-frame return');
  await wheelTo(at, 0.72);
  await sleep(40);
  check((await look()).out, 'the outward wheel has not settled yet');
  await wheelTo(at, 0.36);
  await sleep(40);
  check((await look()).out, 'the return wheel has not left title mode');
  await sleep(220);
  const returned = await look();
  check(returned.out && returned.scale < 0.45, 'returning within the settle never leaves title mode (' + JSON.stringify(returned) + ')');

  // A pan while a zoom-out of title mode is pending does not apply it early and does not cancel it.
  await wheelTo(at, 0.8);
  await sleep(40);
  const pending = await look();
  check(pending.out && pending.scale > 0.55, 'the zoom toward content is painted and title mode is still waiting (' + pending.scale + ')');
  await wheel(at, 160, false);
  await sleep(40);
  const panned = await look();
  check(panned.out && Math.abs(panned.scale - pending.scale) < 1e-6 && (Math.abs(panned.x - pending.x) > 2 || Math.abs(panned.y - pending.y) > 2),
    'a pan during the settle moves the board and leaves title mode waiting (' + JSON.stringify({ pending, panned }) + ')');
  await sleep(200);
  const panSettled = await look();
  check(!panSettled.out && panSettled.scale > 0.55, 'title mode leaves after the zoom rests, pan included (' + JSON.stringify(panSettled) + ')');

  // A zero ctrl+wheel must not apply the pending leave on that frame, and the
  // leave still happens after the wheel rests. The gap that would separate
  // "timer reset" from "timer left running" is shorter than a stable wait, so
  // this case does not time that difference. The out-and-back wheel above is
  // what shows a later wheel replacing the pending one.
  await wheelTo(at, 0.34);
  await sleep(200);
  check((await look()).out, 'title mode is on before the zero-delta wheel');
  await wheelTo(at, 0.7);
  await sleep(40);
  check((await look()).out, 'title mode is waiting before the zero-delta wheel');
  await wheel(at, 0, true);
  await sleep(40);
  check((await look()).out && (await look()).scale > 0.55, 'a zero-delta wheel does not apply title mode early');
  await sleep(200);
  check(!(await look()).out, 'the pending leave still happens after the zero-delta wheel');

  // A zoom button flushes the scale it produced and the pending wheel must not undo that.
  await wheelTo(at, 0.36);
  await sleep(200);
  await wheelTo(at, 0.64);
  await sleep(30);
  check((await look()).out && (await look()).scale > 0.55, 'title mode is waiting on a wheel that would leave it');
  await click('[aria-label="Zoom out"]');
  await sleep(40);
  const flushed = await look();
  check(flushed.out === titleMode(flushed.scale, true) && flushed.out && flushed.scale < 0.5,
    'zoom-out during the settle applies title mode for the new scale immediately (' + JSON.stringify(flushed) + ')');
  await sleep(220);
  const flushHeld = await look();
  check(flushHeld.out && Math.abs(flushHeld.scale - flushed.scale) < 1e-9, 'the cancelled wheel does not change that scale later');

  // Bursts that end on the two edges. The float snap keeps 55% on titles and 45% on content.
  await wheelTo(at, 0.36);
  await sleep(200);
  await burst([0.3, 0.8, 0.55]);
  await sleep(220);
  const at55 = await look();
  check(at55.out && Math.abs(at55.scale - 0.55) < 1e-4, 'a burst ending at 55%, from titles, stays in title mode (' + at55.scale + ')');
  await wheelTo(at, 0.7);
  await sleep(200);
  check(!(await look()).out, 'content is showing before the 45% burst');
  await burst([0.3, 0.9, 0.45]);
  await sleep(220);
  const at45 = await look();
  check(!at45.out && Math.abs(at45.scale - 0.45) < 1e-4, 'a burst ending at 45%, from content, stays on content (' + at45.scale + ')');

  // Double-click while a zoom out of title mode has not settled: the class is still
  // title mode, so the click frames the card and the pending wheel does not pull it back.
  await wheelTo(at, 0.34);
  await sleep(200);
  const beforeJump = await cardPoint('t');
  const jumpScale = (await look()).scale;
  await wheel(beforeJump, -300 * Math.log2(0.85 / jumpScale), true);
  await fastDouble(beforeJump);
  await sleep(60);
  const jumped = await look();
  check(!jumped.cardEditing && !jumped.out && jumped.scale > 0.55, 'a double-click during the settle frames the card instead of editing (' + JSON.stringify(jumped) + ')');
  const framedScale = jumped.scale;
  await sleep(220);
  const jumpHeld = await look();
  check(!jumpHeld.out && !jumpHeld.cardEditing && Math.abs(jumpHeld.scale - framedScale) < 1e-6,
    'the wheel that was in flight does not move the framed card (' + JSON.stringify(jumpHeld) + ')');

  // The other way: a wheel into title territory has not settled, so the double-click edits.
  // After the settle, that card stays in the editor while the board shows titles.
  await press('Escape');
  await sleep(40);
  await click('[aria-label="Reset zoom"]');
  await sleep(60);
  await wheelTo(await cardPoint('t'), 0.7);
  await sleep(200);
  check(!(await look()).out, 'content is showing before the zoom into title mode');
  const into = await cardPoint('t');
  const intoScale = (await look()).scale;
  await wheel(into, -300 * Math.log2(0.32 / intoScale), true);
  await fastDouble(into);
  await sleep(80);
  const editedEarly = await run(() => {
    const card = document.querySelector('[data-node-id="t"]');
    return { editing: card.classList.contains('is-editing'), editor: !!card.querySelector('.cm-editor'), out: document.querySelector('.canvas-world').classList.contains('is-zoomed-out') };
  });
  check(editedEarly.editing && editedEarly.editor && !editedEarly.out, 'a double-click before title mode settles edits the card (' + JSON.stringify(editedEarly) + ')');
  await sleep(200);
  const editedSettled = await run(() => {
    const world = document.querySelector('.canvas-world');
    const card = document.querySelector('[data-node-id="t"]');
    const body = card.querySelector('.canvas-node-content');
    return {
      out: world.classList.contains('is-zoomed-out'),
      scale: new DOMMatrix(getComputedStyle(world).transform).a,
      editing: card.classList.contains('is-editing'),
      hidden: getComputedStyle(body).contentVisibility === 'hidden',
    };
  });
  check(editedSettled.out && editedSettled.scale < 0.45 && editedSettled.editing && !editedSettled.hidden,
    'the editor stays up when title mode settles (' + JSON.stringify(editedSettled) + ')');
  await press('Escape');
  await sleep(40);

  // Space is grab mode. A double-click must not frame or edit.
  await wheelTo(await cardPoint('t'), 0.34);
  await sleep(200);
  const grabAt = await cardPoint('t');
  const grabBefore = await look();
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
  try {
    await fastDouble(grabAt);
    await sleep(80);
    const grabAfter = await look();
    check(grabAfter.out && !grabAfter.cardEditing && Math.abs(grabAfter.scale - grabBefore.scale) < 1e-6 && grabAfter.nodes === grabBefore.nodes,
      'Space+double-click does not frame, edit, or add a card (' + JSON.stringify({ grabBefore, grabAfter }) + ')');
  } finally {
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
  }

  // A group's label still edits in title mode. The group body does not zoom or add a card.
  const labelAt = await run(() => {
    const r = document.querySelector('[data-node-id="g"] .canvas-group-label').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  const bodyAt = await cardPoint('g', 0.8);
  const beforeBody = await look();
  await fastDouble(bodyAt);
  await sleep(80);
  const afterBody = await look();
  check(afterBody.nodes === beforeBody.nodes && !afterBody.editing && Math.abs(afterBody.scale - beforeBody.scale) < 1e-6 && afterBody.out,
    'double-clicking a group body in title mode does not zoom, edit, or add a card');
  await fastDouble(labelAt);
  await sleep(80);
  check(await run(() => document.querySelector('[data-node-id="g"] .canvas-group-label')?.classList.contains('is-editing')), 'double-clicking a group label in title mode edits the label');
  await press('Escape');
  await sleep(40);
  check(await run(async (origin) => {
    const { api } = await import('/src/api.ts');
    return await api.readNote('EdgeTitles.canvas') === origin;
  }, origin), 'title-mode zoom, edit-cancel, and the group label leave the file bytes unchanged');

  // Read-only: the first double-click still frames the card. The second does not edit.
  await click('[aria-label="Canvas settings"]');
  await sleep(40);
  await click(await run(() => {
    const row = [...document.querySelectorAll('.menu-item')].find(el => el.querySelector('.menu-item-title')?.textContent === 'Read-only');
    const r = row.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }));
  await sleep(40);
  check(await run(() => document.querySelector('.canvas-view').classList.contains('is-readonly')), 'the canvas is read-only');
  await wheelTo(await cardPoint('t'), 0.34);
  await sleep(200);
  await fastDouble(await cardPoint('t'));
  await sleep(80);
  const readFramed = await look();
  check(!readFramed.out && readFramed.scale > 0.55 && !readFramed.cardEditing, 'read-only double-click frames the card and does not edit');
  const readScale = readFramed.scale;
  await fastDouble(await cardPoint('t'));
  await sleep(80);
  const readSecond = await look();
  check(!readSecond.cardEditing && Math.abs(readSecond.scale - readScale) < 1e-4, 'a second read-only double-click does not edit or zoom again');

  // A card that cannot leave title mode. One painted wheel-notch between double-clicks
  // frames again. The next double-click, with the scale at rest, edits.
  await run(async () => {
    const { api } = await import('/src/api.ts');
    await api.createNote('EdgeHuge.canvas', JSON.stringify({ nodes: [{ id: 'h', type: 'text', x: 0, y: 0, width: 4000, height: 2400, text: 'Wide card' }], edges: [] }));
    await ws.vault.refreshFiles();
    await ws.open('EdgeHuge.canvas');
  });
  await sleep(250);
  const opened = await look();
  check(opened.out && opened.scale < 0.45 && !opened.cardEditing, 'the huge card opens fitted in title mode (' + opened.scale + ')');
  const hugeAt = await cardPoint('h', 0.7);
  await fastDouble(hugeAt);
  await sleep(80);
  const fitted = await look();
  check(fitted.out && fitted.scale <= 0.55 && !fitted.cardEditing, 'the first double-click frames the huge card without editing (' + fitted.scale + ')');
  await wheel(hugeAt, -80, true);
  await sleep(50);
  const nudged = await look();
  check(nudged.out && !nudged.cardEditing && Math.abs(nudged.scale - fitted.scale) > 1e-4, 'one wheel notch moves the scale while title mode stays on (' + fitted.scale + ' -> ' + nudged.scale + ')');
  await fastDouble(await cardPoint('h', 0.7));
  await sleep(80);
  const reframed = await look();
  check(reframed.out && !reframed.cardEditing && Math.abs(reframed.scale - fitted.scale) < 1e-3,
    'a double-click after that notch frames the card again (' + JSON.stringify(reframed) + ')');
  await fastDouble(await cardPoint('h', 0.7));
  await sleep(100);
  check(await run(() => !!document.querySelector('[data-node-id="h"].is-editing .cm-editor')), 'the double-click after the scale rests edits the huge card');
  await press('Escape');
  await sleep(40);
}, { height: 800 });
