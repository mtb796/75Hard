import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';

const PAGE = pathToFileURL(new URL('index.html', import.meta.url).pathname).href;
const EXEC = process.env.CHROME_PATH || undefined;

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  → ' + extra : '')); }
};

const browser = await chromium.launch(EXEC ? { executablePath: EXEC, args: ['--no-sandbox'] } : { args: ['--no-sandbox'] });

async function newPage(opts = {}) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  if (opts.init) await page.addInitScript(opts.init);
  await page.goto(PAGE);
  await page.waitForFunction(() => document.querySelectorAll('.tile').length === 75, null, { timeout: 15000 });
  await page.waitForTimeout(opts.settle ?? 300);
  page.__errors = errors;
  return { ctx, page, errors };
}

/* ================================================================== */
console.log('\n[1] Sleep habit exists and rules/habits agree');
{
  const { ctx, page, errors } = await newPage();
  const labels = await page.$$eval('#habitList .tx b', els => els.map(e => e.textContent));
  ok('six habits rendered', labels.length === 6, labels.join(','));
  ok('Sleep habit present', labels.includes('Sleep'), labels.join(','));

  const rules = await page.$$eval('.rules li', els => els.map(e => e.textContent.toLowerCase()));
  ok('rules card still lists sleep', rules.some(r => r.includes('sleep')));
  ok('every rule has a habit or is the photo rule', rules.length === 6);

  // Day 2 is not a milestone → photo locked, 5 required.
  await page.click('#phases .grid >> nth=0 >> .tile >> nth=1');
  await page.waitForTimeout(100);
  const state2 = await page.textContent('#pState');
  ok('non-milestone day requires 5', state2 === '0 of 5 complete', state2);

  const disabled = await page.$$eval('#habitList button', els => els.map(e => e.disabled));
  ok('photo button uses real disabled', disabled[5] === true, JSON.stringify(disabled));

  // Day 1 is a milestone → 6 required.
  await page.click('#phases .grid >> nth=0 >> .tile >> nth=0');
  await page.waitForTimeout(100);
  const state1 = await page.textContent('#pState');
  ok('milestone day requires 6', state1 === '0 of 6 complete', state1);

  ok('no page errors', errors.length === 0, errors.join('|'));
  await ctx.close();
}

/* ================================================================== */
console.log('\n[2] localStorage persistence (finding #2)');
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(PAGE);
  await page.waitForFunction(() => document.querySelectorAll('.tile').length === 75);
  await page.waitForTimeout(4600); // outlast the 4s host wait

  await page.fill('#startDate', '2026-08-10');
  await page.dispatchEvent('#startDate', 'change');
  await page.waitForTimeout(200);
  await page.click('#habitList button >> nth=0'); // workout
  await page.click('#habitList button >> nth=1'); // diet
  await page.waitForTimeout(900);

  const stored = await page.evaluate(() => window.localStorage.getItem('banks75soft:duo'));
  ok('wrote to localStorage', !!stored, String(stored));
  ok('record has updatedAt', stored && JSON.parse(stored).updatedAt > 0);

  const status = await page.textContent('#status');
  ok('status reports a device save', /saved/i.test(status), status);

  // Reload in the same context → data must survive.
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('.tile').length === 75);
  await page.waitForTimeout(4600);
  const date = await page.inputValue('#startDate');
  const checked = await page.$$eval('#habitList button.checked', els => els.length);
  ok('start date survived reload', date === '2026-08-10', date);
  ok('checked habits survived reload', checked === 2, String(checked));
  await ctx.close();
}

/* ================================================================== */
console.log('\n[3] Late host storage is NOT clobbered (finding #3)');
{
  // A bridge that only appears after 6s — past the 4s load wait.
  const init = () => {
    window.__hostWrites = [];
    setTimeout(() => {
      window.storage = {
        get: async () => ({ value: JSON.stringify({ v: 2, active: 'mb', updatedAt: 999,
          mb: { startDate: '2020-01-01', days: { 1: { workout: true } } },
          jm: { startDate: null, days: {} } }) }),
        set: async (k, v) => { window.__hostWrites.push(v); return true; }
      };
    }, 6000);
  };
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.addInitScript(init);
  await page.goto(PAGE);
  await page.waitForFunction(() => document.querySelectorAll('.tile').length === 75);
  await page.waitForTimeout(7000); // load gave up at 4s; bridge arrived at 6s

  const status = await page.textContent('#status');
  ok('no premature host warning before any save', status === '' || /this device/i.test(status), status);

  await page.click('#habitList button >> nth=0');
  await page.waitForTimeout(1200);

  const writes = await page.evaluate(() => window.__hostWrites);
  ok('never wrote to the late bridge', writes.length === 0, JSON.stringify(writes));

  const local = await page.evaluate(() => window.localStorage.getItem('banks75soft:duo'));
  ok('still autosaved locally', !!local);
  const after = await page.textContent('#status');
  ok('warns that sync needs a reload', /reload to sync/i.test(after), after);
  await ctx.close();
}

/* ================================================================== */
console.log('\n[4] Host storage present on time → used normally');
{
  const init = () => {
    window.__hostWrites = [];
    window.storage = {
      get: async () => ({ value: JSON.stringify({ v: 2, active: 'jm', updatedAt: 5000,
        mb: { startDate: null, days: {} },
        jm: { startDate: '2026-01-01', days: { 3: { workout: true, diet: true } } } }) }),
      set: async (k, v) => { window.__hostWrites.push(v); return true; }
    };
  };
  const { ctx, page, errors } = await newPage({ init, settle: 600 });
  const eyebrow = await page.textContent('#eyebrow');
  ok('adopted host record incl. active side', eyebrow === 'Janel Moore', eyebrow);
  const date = await page.inputValue('#startDate');
  ok('adopted host start date', date === '2026-01-01', date);

  await page.click('#habitList button >> nth=0');
  await page.waitForTimeout(900);
  const writes = await page.evaluate(() => window.__hostWrites);
  ok('wrote back to host', writes.length >= 1, String(writes.length));
  const status = await page.textContent('#status');
  ok('status is plain Saved', status === '✓ Saved', status);
  ok('no page errors', errors.length === 0, errors.join('|'));
  await ctx.close();
}

/* ================================================================== */
console.log('\n[5] Vault codec (finding #4)');
{
  const { ctx, page } = await newPage();
  const r = await page.evaluate(async () => {
    const out = {};
    const set = async (sel, val) => {
      const el = document.querySelector(sel);
      el.value = val;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    // Build a known ledger through the UI. Setting a start date jumps the panel
    // to today, so click back to day 1 (a milestone) before toggling habits.
    await set('#startDate', '2026-08-10');
    document.querySelectorAll('#phases .grid')[0].querySelectorAll('.tile')[0].click();
    document.querySelectorAll('#habitList button')[0].click(); // day 1 workout
    document.querySelectorAll('#habitList button')[4].click(); // day 1 sleep
    document.querySelectorAll('#habitList button')[5].click(); // day 1 photo (milestone)
    document.getElementById('vaultToggle').click();
    out.code = document.getElementById('vaultCode').value;

    const restore = (code) => {
      document.getElementById('restoreInput').value = code;
      document.getElementById('restoreBtn').click();
      return document.getElementById('vaultMsg').textContent;
    };
    out.truncated = restore(out.code.slice(0, -4));
    // Flip a character in the middle of the payload; the final base64 character
    // of a 62-byte body carries padding bits only, so mutating it is a no-op.
    const mid = 40;
    out.mutated = restore(out.code.slice(0, mid) + (out.code[mid] === 'A' ? 'B' : 'A') + out.code.slice(mid + 1));
    out.garbage = restore('MB75-!!!!');
    out.empty = restore('   ');
    // Round trip: wipe then restore.
    document.getElementById('resetBtn').click();
    document.getElementById('resetBtn').click();
    out.afterReset = document.getElementById('startDate').value;
    out.roundTrip = restore(out.code);
    out.dateBack = document.getElementById('startDate').value;
    document.querySelectorAll('#phases .grid')[0].querySelectorAll('.tile')[0].click();
    out.checkedBack = document.querySelectorAll('#habitList button.checked').length;
    out.day1Done = document.querySelectorAll('#phases .grid')[0]
      .querySelectorAll('.tile')[0].classList.contains('partial');
    return out;
  });

  ok('v2 code length is 83 chars', r.code.replace('MB75-', '').length === 83, String(r.code.length));
  ok('truncated code rejected', /incomplete/i.test(r.truncated), r.truncated);
  ok('mutated code rejected', /altered|incomplete|read/i.test(r.mutated), r.mutated);
  ok('garbage rejected', /aren.t part|read/i.test(r.garbage), r.garbage);
  ok('empty rejected', /paste a vault code/i.test(r.empty), r.empty);
  ok('reset cleared the ledger', r.afterReset === '', r.afterReset);
  ok('round trip restored', /Restored/.test(r.roundTrip), r.roundTrip);
  ok('round trip kept start date', r.dateBack === '2026-08-10', r.dateBack);
  ok('round trip kept 3 habits incl. sleep', r.checkedBack === 3, String(r.checkedBack));
  ok('day 1 tile shows partial progress', r.day1Done === true, String(r.day1Done));
  await ctx.close();
}

/* ================================================================== */
console.log('\n[5b] Legacy v1 codes still restore');
{
  // v1: 50 bytes, version 1, epoch 2020-01-01, 5 habits (no sleep).
  const bytes = [1];
  const offset = Math.round((Date.UTC(2026, 7, 10) - Date.UTC(2020, 0, 1)) / 86400000);
  bytes.push((offset >> 8) & 255, offset & 255);
  const bits = [];
  for (let d = 1; d <= 75; d++) {
    // day 1: workout + photo checked; everything else off.
    const on = d === 1 ? [1, 0, 0, 0, 1] : [0, 0, 0, 0, 0];
    bits.push(...on);
  }
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | (bits[i + j] || 0);
    bytes.push(b);
  }
  const code = 'MB75-' + Buffer.from(bytes).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  ok('constructed v1 code is 50 bytes', bytes.length === 50, String(bytes.length));

  const { ctx, page } = await newPage();
  const r = await page.evaluate((c) => {
    document.getElementById('vaultToggle').click();
    document.getElementById('restoreInput').value = c;
    document.getElementById('restoreBtn').click();
    const msg = document.getElementById('vaultMsg').textContent;
    const date = document.getElementById('startDate').value;
    // Restore jumps the panel to today; the v1 data lives on day 1.
    document.querySelectorAll('#phases .grid')[0].querySelectorAll('.tile')[0].click();
    return {
      msg, date,
      checked: [...document.querySelectorAll('#habitList button')].map(b => b.classList.contains('checked'))
    };
  }, code);
  ok('v1 code accepted', /Restored/.test(r.msg), r.msg);
  ok('v1 start date decoded', r.date === '2026-08-10', r.date);
  ok('v1 workout mapped', r.checked[0] === true, JSON.stringify(r.checked));
  ok('v1 sleep defaults off', r.checked[4] === false, JSON.stringify(r.checked));
  ok('v1 photo mapped to new slot', r.checked[5] === true, JSON.stringify(r.checked));
  await ctx.close();
}

/* ================================================================== */
console.log('\n[6] Day-counter states (finding #6)');
{
  const { ctx, page } = await newPage();
  const read = async (iso) => {
    await page.evaluate((v) => {
      const el = document.getElementById('startDate');
      el.value = v;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, iso);
    await page.waitForTimeout(120);
    return {
      day: await page.textContent('#sDay'),
      line: await page.textContent('#timeline')
    };
  };
  const iso = (offsetDays) => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + offsetDays);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  };

  const future = await read(iso(5));
  ok('pre-start shows dash, not Day 1', future.day === '—', future.day);
  ok('pre-start explains the wait', /starts in 5 days/i.test(future.line), future.line);

  const running = await read(iso(-11));
  ok('running shows real day', running.day === '12', running.day);
  ok('running line matches', /day 12 of 75/i.test(running.line), running.line);

  const done = await read(iso(-100));
  ok('finished does not pin to 75', done.day === '✓', done.day);
  ok('finished line says finished', /finished/i.test(done.line), done.line);

  const none = await read('');
  ok('no date shows dash', none.day === '—', none.day);
  ok('no date prompts', /set a start date/i.test(none.line), none.line);
  await ctx.close();
}

/* ================================================================== */
console.log('\n[7] Accessibility + fonts (findings #5, #6)');
{
  const { ctx, page, errors } = await newPage();

  // Tab keyboard navigation.
  await page.focus('#tabMb');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(200);
  const afterArrow = await page.evaluate(() => ({
    active: document.activeElement.id,
    eyebrow: document.getElementById('eyebrow').textContent,
    mbTabIndex: document.getElementById('tabMb').tabIndex,
    jmTabIndex: document.getElementById('tabJm').tabIndex,
    jmSelected: document.getElementById('tabJm').getAttribute('aria-selected'),
    panelLabel: document.getElementById('ledger').getAttribute('aria-labelledby')
  }));
  ok('ArrowRight switches side', afterArrow.eyebrow === 'Janel Moore', afterArrow.eyebrow);
  ok('focus follows to new tab', afterArrow.active === 'tabJm', afterArrow.active);
  ok('roving tabindex applied', afterArrow.mbTabIndex === -1 && afterArrow.jmTabIndex === 0);
  ok('aria-selected updated', afterArrow.jmSelected === 'true');
  ok('tabpanel relabelled', afterArrow.panelLabel === 'tabJm', afterArrow.panelLabel);

  await page.keyboard.press('Home');
  await page.waitForTimeout(200);
  ok('Home returns to first tab', (await page.textContent('#eyebrow')) === 'Malik Banks');

  // Locked photo button must not be tabbable.
  await page.click('#phases .grid >> nth=0 >> .tile >> nth=1');
  await page.waitForTimeout(120);
  const photoTabbable = await page.evaluate(() => {
    const b = document.querySelectorAll('#habitList button')[5];
    return { disabled: b.disabled, tabIndex: b.tabIndex };
  });
  ok('locked photo is disabled', photoTabbable.disabled === true);

  // Serif fallback: fonts are blocked offline, headings must still be serif.
  const fonts = await page.evaluate(() => ({
    h1: getComputedStyle(document.querySelector('h1')).fontFamily,
    soft: getComputedStyle(document.querySelector('.soft')).fontFamily,
    body: getComputedStyle(document.body).fontFamily,
    tile: getComputedStyle(document.querySelector('.tile')).fontFamily
  }));
  ok('h1 falls back to serif', /serif/.test(fonts.h1) && !/sans-serif/.test(fonts.h1.split(',').pop().trim()), fonts.h1);
  ok('.soft falls back to serif', /Georgia|serif/.test(fonts.soft), fonts.soft);
  ok('tiles fall back to serif', /serif/.test(fonts.tile), fonts.tile);
  ok('body stays sans', /sans-serif/.test(fonts.body), fonts.body);

  ok('no page errors', errors.length === 0, errors.join('|'));
  await ctx.close();
}

/* ================================================================== */
console.log('\n[8] Vault-only mode when nothing can store');
{
  const init = () => {
    // Simulate a viewer with localStorage blocked and no host bridge.
    Object.defineProperty(window, 'localStorage', {
      get() { throw new DOMException('blocked', 'SecurityError'); }
    });
  };
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.addInitScript(init);
  await page.goto(PAGE);
  await page.waitForFunction(() => document.querySelectorAll('.tile').length === 75);
  await page.waitForTimeout(4800);

  const status = await page.textContent('#status');
  ok('falls back to vault mode', /vault/i.test(status), status);
  const vaultOpen = await page.evaluate(() => !document.getElementById('vaultBody').hidden);
  ok('vault panel auto-opened', vaultOpen);
  ok('no page errors', errors.length === 0, errors.join('|'));
  await ctx.close();
}

/* ================================================================== */
console.log('\n[9] Mobile layout — iPhone SE, iPhone 15, Pixel, landscape');
{
  const DEVICES = [
    { name: 'iPhone SE',       width: 320, height: 568, dpr: 2 },
    { name: 'iPhone 12/13/15', width: 390, height: 844, dpr: 3 },
    { name: 'Pixel 7',         width: 412, height: 915, dpr: 2.6 },
    { name: 'iPhone landscape',width: 844, height: 390, dpr: 3 }
  ];

  for (const d of DEVICES) {
    const ctx = await browser.newContext({
      viewport: { width: d.width, height: d.height },
      deviceScaleFactor: d.dpr,
      isMobile: true,
      hasTouch: true
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto(PAGE);
    await page.waitForFunction(() => document.querySelectorAll('.tile').length === 75);
    await page.waitForTimeout(300);

    // No horizontal overflow anywhere on the page.
    const overflow = await page.evaluate(() => ({
      doc: document.documentElement.scrollWidth,
      win: window.innerWidth,
      widest: (() => {
        let worst = null, max = 0;
        document.querySelectorAll('*').forEach(el => {
          const r = el.getBoundingClientRect();
          if (r.right > max) { max = r.right; worst = el.className || el.tagName; }
        });
        return { max: Math.round(max), worst: String(worst) };
      })()
    }));
    ok(`${d.name}: no horizontal scroll`, overflow.doc <= overflow.win + 1,
       `doc=${overflow.doc} win=${overflow.win} widest=${overflow.widest.worst}@${overflow.widest.max}`);

    // Inputs must be >=16px or iOS zooms the page on focus.
    const inputPx = await page.$$eval('input', els =>
      els.map(e => ({ id: e.id, size: parseFloat(getComputedStyle(e).fontSize) })));
    ok(`${d.name}: inputs >=16px (no iOS zoom)`,
       inputPx.every(i => i.size >= 16), JSON.stringify(inputPx));

    // Primary controls must be reachable thumb targets.
    const small = await page.evaluate(() => {
      const sel = '.tab, .panel-nav button, .vault-toggle, .reset, .vault-row button, .habit, .tile';
      const bad = [];
      document.querySelectorAll(sel).forEach(el => {
        if (el.offsetParent === null) return;
        const r = el.getBoundingClientRect();
        if (r.height < 34 || r.width < 34) bad.push(`${el.className}:${Math.round(r.width)}x${Math.round(r.height)}`);
      });
      return bad;
    });
    ok(`${d.name}: tap targets >=34px`, small.length === 0, small.slice(0, 5).join(', '));

    // Tapping (not clicking) must work through the touch stack.
    await page.tap('#habitList button >> nth=0');
    await page.waitForTimeout(150);
    const checked = await page.$$eval('#habitList button.checked', e => e.length);
    ok(`${d.name}: touch tap checks a habit`, checked === 1, String(checked));

    ok(`${d.name}: no page errors`, errors.length === 0, errors.join('|'));
    await ctx.close();
  }
}

/* ================================================================== */
console.log('\n[10] Every button works and persists');
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(PAGE);
  await page.waitForFunction(() => document.querySelectorAll('.tile').length === 75);
  await page.waitForTimeout(4600);

  const read = () => page.evaluate(() => JSON.parse(localStorage.getItem('banks75soft:duo') || 'null'));

  // start date
  await page.fill('#startDate', '2026-08-01');
  await page.dispatchEvent('#startDate', 'change');
  await page.waitForTimeout(800);
  ok('start date persists', (await read())?.mb.startDate === '2026-08-01');

  // day nav buttons
  await page.tap('#phases .grid >> nth=0 >> .tile >> nth=0');   // day 1
  await page.waitForTimeout(120);
  ok('prev disabled on day 1', await page.isDisabled('#prevDay'));
  await page.tap('#nextDay');
  await page.waitForTimeout(120);
  ok('next advances a day', (await page.textContent('#pTitle')) === 'DAY 2');
  await page.tap('#prevDay');
  await page.waitForTimeout(120);
  ok('prev goes back a day', (await page.textContent('#pTitle')) === 'DAY 1');

  // all six habit buttons on a milestone day
  for (let i = 0; i < 6; i++) { await page.tap(`#habitList button >> nth=${i}`); await page.waitForTimeout(60); }
  await page.waitForTimeout(800);
  const rec = await read();
  ok('all six habits persist', Object.keys(rec.mb.days['1']).length === 6, JSON.stringify(rec.mb.days['1']));
  ok('day 1 reads complete', (await page.textContent('#pState')) === '◆ Day complete');
  ok('day 1 tile is gold', await page.evaluate(() =>
    document.querySelectorAll('#phases .grid')[0].querySelectorAll('.tile')[0].classList.contains('done')));
  ok('perfect-day stat updated', (await page.textContent('#sPerfect')) === '1');

  // last tile in the final phase is reachable and selectable
  await page.tap('#phases .grid >> nth=2 >> .tile >> nth=24');
  await page.waitForTimeout(150);
  ok('day 75 tile selects', (await page.textContent('#pTitle')) === 'DAY 75');
  ok('next disabled on day 75', await page.isDisabled('#nextDay'));

  // side switch persists and keeps ledgers separate
  await page.tap('#tabJm');
  await page.waitForTimeout(800);
  ok('Janel ledger is empty', (await page.inputValue('#startDate')) === '');
  ok('reset button renamed', /Janel/.test(await page.textContent('#resetBtn')));
  const rec2 = await read();
  ok('active side persisted', rec2.active === 'jm', rec2.active);
  ok('Malik data untouched', rec2.mb.startDate === '2026-08-01');

  // vault toggle + copy + restore round trip on Janel
  await page.fill('#startDate', '2026-09-01');
  await page.dispatchEvent('#startDate', 'change');
  await page.waitForTimeout(200);
  await page.tap('#vaultToggle');
  await page.waitForTimeout(150);
  ok('vault opens', await page.isVisible('#vaultCode'));
  const jmCode = await page.inputValue('#vaultCode');
  ok('Janel code carries JM prefix', jmCode.startsWith('JM75-'), jmCode.slice(0, 8));
  await page.tap('#copyCode');
  await page.waitForTimeout(200);
  ok('copy reports a result', (await page.textContent('#vaultMsg')).length > 0);

  // reset is two-tap and clears only the active side
  await page.tap('#resetBtn');
  await page.waitForTimeout(120);
  ok('reset arms first', /Tap again/.test(await page.textContent('#resetBtn')));
  await page.tap('#resetBtn');
  await page.waitForTimeout(800);
  ok('reset cleared Janel', (await page.inputValue('#startDate')) === '');
  const rec3 = await read();
  ok('reset persisted', rec3.jm.startDate === null);
  ok('reset spared Malik', rec3.mb.startDate === '2026-08-01');

  // restore Janel from the copied code
  await page.fill('#restoreInput', jmCode);
  await page.tap('#restoreBtn');
  await page.waitForTimeout(800);
  ok('restore brought Janel back', (await page.inputValue('#startDate')) === '2026-09-01');
  const rec4 = await read();
  ok('restore persisted', rec4.jm.startDate === '2026-09-01');

  // vault toggle closes
  await page.tap('#vaultToggle');
  await page.waitForTimeout(150);
  ok('vault closes', !(await page.isVisible('#vaultCode')));

  ok('no page errors', errors.length === 0, errors.join('|'));
  await ctx.close();
}

/* ================================================================== */
console.log('\n[11] Content completeness');
{
  const { ctx, page, errors } = await newPage();
  const text = await page.textContent('body');
  for (const needle of ['20–30 minutes', 'protein', '1.5–2 liters', '10 pages', '7 hours',
                        'Phase I', 'Phase II', 'Phase III', 'How It Works', 'The Rules', 'The Vault']) {
    ok(`page states "${needle}"`, text.includes(needle));
  }
  const milestones = await page.textContent('#milestoneList');
  ok('milestone days listed', milestones === '1, 10, 20, 30, 40, 50, 60, 75', milestones);
  const howto = await page.$$eval('.howto li', els => els.length);
  ok('how-it-works has entries', howto >= 8, String(howto));
  const themeColor = await page.getAttribute('#themeColor', 'content');
  ok('theme-color set for Malik', themeColor === '#0b0b0e', themeColor);
  await page.click('#tabJm');
  await page.waitForTimeout(200);
  ok('theme-color follows Janel', (await page.getAttribute('#themeColor', 'content')) === '#eef1e3');
  ok('no page errors', errors.length === 0, errors.join('|'));
  await ctx.close();
}

await browser.close();
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
