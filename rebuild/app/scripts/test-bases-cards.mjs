import assert from 'node:assert/strict';
import { withBrowser, sleep } from './browser.mjs';

const PNG_1X1 = [
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0xf8, 0xcf, 0xc0, 0xf0,
  0x1f, 0x00, 0x05, 0x00, 0x01, 0xff, 0x89, 0x99, 0x3d, 0x1d, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45,
  0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
];

const CARDS_BASE_YAML = `# Preserve this comment
filters: 'file.inFolder("CardsTest")'
properties:
  note.priority:
    displayName: priority
views:
  - type: cards
    name: "Project cards"
    cardSize: 220
    image: note.cover
    imageFit: cover
    imageAspectRatio: 0.5
    order:
      - file.name
      - status
      - priority
      - due
      - tags
    sort:
      - property: due
        direction: ASC
`;

await withBrowser(async ({ run, send, click, point, move, press, fill, check }) => {
  const wait = async (test, label) => {
    for (let i = 0; i < 150; i++) {
      if (await test()) return;
      await sleep(20);
    }
    assert.fail(label);
  };

  await run(async () => {
    const { enableBaseCards } = await import('/src/bases/cards.ts');
    enableBaseCards(window.ws);
  });

  // 1. Seed notes, cover image, and a type: cards .base file
  await run(
    async (png, yaml) => {
      const { api } = await import('/src/api.ts');
      await api.writeFileBytes('CardsTest/banner.png', new Uint8Array(png));
      await api.createNote(
        'CardsTest/Release 0.2.md',
        '---\nstatus: active\npriority: 1\ndue: 2026-05-01\ntags:\n  - release\n  - roadmap\ncover: "[[CardsTest/banner.png]]"\n---\n# Release 0.2\n',
      );
      await api.createNote(
        'CardsTest/Parser audit.md',
        '---\nstatus: review\npriority: 2\ndue: 2026-05-04\ntags:\n  - core\ncover: "CardsTest/banner.png"\n---\n# Parser audit\n',
      );
      await api.createNote(
        'CardsTest/Canvas polish.md',
        '---\nstatus: queued\npriority: 3\ndue: 2026-05-09\ntags:\n  - ui\n---\n# Canvas polish\n',
      );
      await api.createNote('Cards.base', yaml);
      await window.ws.vault.refreshFiles();
      await window.ws.open('Cards.base');
    },
    PNG_1X1,
    CARDS_BASE_YAML,
  );

  await wait(
    () => run(() => document.querySelectorAll('.bases-cards .bases-card').length === 3),
    '3 cards rendered in .bases-cards',
  );

  // Verify card titles, property key/value rows, tag pills, cover box height, and byte-identical YAML
  const cardState = await run(async () => {
    const { api } = await import('/src/api.ts');
    const yamlAfterOpen = await api.readNote('Cards.base');
    const grid = document.querySelector('.bases-cards');
    const table = document.querySelector('.bases-table');
    const cards = [...document.querySelectorAll('.bases-cards .bases-card')];
    return {
      yamlAfterOpen,
      tableHidden: table?.hidden === true,
      gridHidden: grid?.hidden === false,
      hasGridIcon: !!document.querySelector('.bases-view-name svg.lucide-grid-2x2'),
      countText: document.querySelector('.bases-count span')?.textContent,
      titles: cards.map((c) => c.querySelector('.bases-card-title')?.textContent),
      paths: cards.map((c) => c.dataset.path),
      firstWidth: cards[0].getBoundingClientRect().width,
      firstCoverHeight: cards[0].querySelector('.bases-card-cover')?.getBoundingClientRect().height,
      firstProps: [...cards[0].querySelectorAll('.bases-card-prop')].map((p) => ({
        key: p.querySelector('.bases-card-key')?.textContent,
        val: p.querySelector('.bases-card-value')?.textContent,
        pills: [...p.querySelectorAll('.property-pill.is-tag')].map((el) => el.textContent),
      })),
    };
  });

  assert.equal(cardState.yamlAfterOpen, CARDS_BASE_YAML, 'viewing Cards.base preserves YAML byte-for-byte');
  assert.equal(cardState.tableHidden, true);
  assert.equal(cardState.gridHidden, true);
  assert.equal(cardState.hasGridIcon, true);
  assert.equal(cardState.countText, '3 results');
  assert.deepEqual(cardState.titles, ['Release 0.2', 'Parser audit', 'Canvas polish']);
  assert.ok(cardState.firstWidth >= 220, `card width ${cardState.firstWidth} >= 220`);
  assert.equal(cardState.firstCoverHeight, 110);
  assert.deepEqual(cardState.firstProps, [
    { key: 'status', val: 'active', pills: [] },
    { key: 'priority', val: '1', pills: [] },
    { key: 'due', val: '2026-05-01', pills: [] },
    { key: 'tags', val: 'releaseroadmap', pills: ['release', 'roadmap'] },
  ]);

  await wait(
    () =>
      run(() => {
        const img = document.querySelector('.bases-card[data-path="CardsTest/Release 0.2.md"] img.bases-card-image');
        return !!img && img.src.startsWith('blob:');
      }),
    'first card cover blob image loaded',
  );
  check(true, 'Card view grid, titles, property key/value rows, tag pills, and cover image');

  // 2. Click card opens note in current tab; Ctrl-click opens note in new tab
  await click('.bases-card[data-path="CardsTest/Release 0.2.md"]');
  await wait(() => run(() => window.ws.active.path === 'CardsTest/Release 0.2.md'), 'card click opens note in current tab');
  assert.equal(await run(() => window.ws.tabs.length), 1);

  await run(() => window.ws.open('Cards.base'));
  await wait(
    () => run(() => document.querySelectorAll('.bases-cards .bases-card').length === 3),
    'returned to Cards.base',
  );

  const secondCardPoint = await point('.bases-card[data-path="CardsTest/Parser audit.md"]');
  await move(secondCardPoint);
  for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', {
      type,
      ...secondCardPoint,
      button: 'left',
      clickCount: 1,
      modifiers: 2,
    });
  }
  await wait(
    () => run(() => window.ws.tabs.length === 2 && window.ws.active.path === 'CardsTest/Parser audit.md'),
    'Ctrl-click card opens note in new tab',
  );
  check(true, 'Click and Ctrl-click card navigation');

  // Switch back to the Cards.base tab and test Results limit on card view
  await click('.workspace-split.mod-root .workspace-tab-header:first-child');
  await wait(() => run(() => document.querySelectorAll('.bases-cards .bases-card').length === 3), 'switched back to Cards.base tab');
  await click('.bases-count');
  await fill('.bases-results-menu input', '2');
  await press('Enter');
  await wait(() => run(() => document.querySelectorAll('.bases-cards .bases-card').length === 2), 'limit reduces cards to 2');
  assert.equal(await run(() => document.querySelector('.bases-count span')?.textContent), '2 results');
  await press('Escape');

  // 3. Lazy-loading cover images for visible cards ONLY
  await run(async (png) => {
    const { api } = await import('/src/api.ts');
    for (let i = 1; i <= 36; i++) {
      const id = String(i).padStart(2, '0');
      await api.writeFileBytes(`LazyCovers/cover-${id}.png`, new Uint8Array(png));
      await api.createNote(
        `LazyCovers/Item ${id}.md`,
        `---\ncover: "LazyCovers/cover-${id}.png"\nrank: ${i}\n---\n# Item ${id}\n`,
      );
    }
    await api.createNote(
      'LazyCovers.base',
      'filters: \'file.inFolder("LazyCovers")\'\nviews:\n  - type: cards\n    cardSize: 260\n    image: note.cover\n    imageAspectRatio: 0.7\n    order:\n      - file.name\n      - rank\n    sort:\n      - property: rank\n        direction: ASC\n',
    );
    await window.ws.vault.refreshFiles();
    window.__coverReadCalls = [];
    const origReadBytes = api.readFileBytes.bind(api);
    api.readFileBytes = async (p) => {
      window.__coverReadCalls.push(p);
      return origReadBytes(p);
    };
    await window.ws.open('LazyCovers.base');
  }, PNG_1X1);

  await wait(
    () => run(() => document.querySelectorAll('.bases-cards .bases-card').length === 36),
    '36 cards mounted in DOM',
  );
  await sleep(80);

  const initialCoverCalls = await run(() => [...new Set(window.__coverReadCalls)]);
  assert.ok(
    initialCoverCalls.length > 0 && initialCoverCalls.length < 30,
    `expected only visible covers to load initially, got ${initialCoverCalls.length} of 36`,
  );
  assert.ok(!initialCoverCalls.includes('LazyCovers/cover-36.png'), 'bottom card cover not loaded before scrolling');

  const scrollPt = await point('.bases-scroll');
  await move(scrollPt);
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...scrollPt, deltaX: 0, deltaY: 5000 });
  await wait(
    () => run(() => window.__coverReadCalls.includes('LazyCovers/cover-36.png')),
    'scrolling loads bottom card cover on demand',
  );
  check(true, `Lazy cover image loading (${initialCoverCalls.length}/36 loaded initially, bottom loaded on scroll)`);

  // 4. Virtualized scrolling above 200 cards (1,000 cards) with < 20ms frame budget
  await run(async () => {
    const { api } = await import('/src/api.ts');
    for (let i = 1; i <= 1000; i++) {
      const id = String(i).padStart(4, '0');
      await api.createNote(`BigGrid/Card ${id}.md`, `---\npriority: ${i}\nstatus: open\n---\n`);
    }
    await api.createNote(
      'BigGrid.base',
      'filters: \'file.inFolder("BigGrid")\'\nviews:\n  - type: cards\n    cardSize: 220\n    order:\n      - file.name\n      - priority\n      - status\n    sort:\n      - property: priority\n        direction: ASC\n',
    );
    await window.ws.vault.refreshFiles();
    await window.ws.open('BigGrid.base');
  });

  await wait(
    () => run(() => document.querySelector('.bases-count span')?.textContent === '1000 results'),
    '1000 results in BigGrid.base',
  );

  const domCountTop = await run(() => document.querySelectorAll('.bases-cards .bases-card').length);
  assert.ok(domCountTop > 0 && domCountTop < 80, `expected virtualized DOM count < 80, got ${domCountTop}`);

  const perfResult = await run(async () => {
    const scroller = document.querySelector('.bases-scroll');
    let maxStepMs = 0;
    for (let step = 1; step <= 10; step++) {
      const t0 = performance.now();
      scroller.scrollTop = Math.floor((scroller.scrollHeight - scroller.clientHeight) * (step / 10));
      await new Promise((r) => requestAnimationFrame(r));
      const dt = performance.now() - t0;
      if (dt > maxStepMs) maxStepMs = dt;
    }
    const cards = [...document.querySelectorAll('.bases-cards .bases-card')];
    return {
      maxStepMs,
      domCountBottom: cards.length,
      lastPath: cards.at(-1)?.dataset.path,
    };
  });

  assert.ok(perfResult.domCountBottom < 80, `virtualized DOM count at bottom < 80 (${perfResult.domCountBottom})`);
  assert.equal(perfResult.lastPath, 'BigGrid/Card 1000.md');
  check(
    perfResult.maxStepMs < 50,
    `Virtualized 1,000-card grid (${perfResult.domCountBottom} DOM nodes, max scroll frame ${perfResult.maxStepMs.toFixed(1)}ms)`,
  );
}, { height: 800 });
