// ==UserScript==
// @name         Mega Alakazam
// @namespace    jimmy.pokecatch.mega
// @version      2.17.2
// @description  The Poke'Catch helper, rebuilt on the game's own engine. Every number comes from the game itself.
// @match        https://pokecatch-online.app/*
// @match        https://www.pokecatch-online.app/*
// @match        https://pokecatch-online.netlify.app/*
// @match        https://pokecatch-online.pages.dev/*
// @updateURL    https://raw.githubusercontent.com/Murillo0211/mega-remote/main/mega-alakazam.meta.js
// @downloadURL  https://raw.githubusercontent.com/Murillo0211/mega-remote/main/mega-alakazam.user.js
// @grant        none
// @run-at       document-start
// @inject-into  page
// ==/UserScript==

/*
 * Mega Alakazam - source is built from mega/src/*.js by build.mjs. Edit the sources, not this file.
 * Architecture: mega/DESIGN.md. Engine reference: mega/ENGINE.md.
 */
(() => {
'use strict';
const VERSION = '2.17.2';
// every "catch (__e) { __h('00-header:24', __e); }" in Mega is built into a call to this (build.mjs): see Health in 01-health.js
function __h(site, e) { try { Health.record(site, e); } catch (x) { /* Health not up yet */ } }
// ---- self-update: a newer Mega that Mega downloaded from GitHub (Updater) runs instead of this copy ----
// Tampermonkey updates on its own slow schedule; this lets a plain reload (Kinesis "Reload Game") run the
// newest version right away. Safety: a downloaded version that crashes while loading is skipped at once
// (this copy keeps going), and one that fails to come up 3 times is never tried again.
if ((() => {
  try {
    if (window.__MEGA_HOT) return false; // this IS the downloaded copy
    const v = localStorage.getItem('mega-next-ver'), P = (x) => String(x).split('.').map((n) => +n || 0);
    const newer = (a, b) => { const x = P(a), y = P(b); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false; };
    if (!v || !newer(v, VERSION)) { if (v) { localStorage.removeItem('mega-next-code'); localStorage.removeItem('mega-next-ver'); } return false; }
    if (localStorage.getItem('mega-next-bad') === v) return false;
    const tries = +(localStorage.getItem('mega-next-try') || 0);
    if (tries >= 3) { localStorage.setItem('mega-next-bad', v); return false; }
    const code = localStorage.getItem('mega-next-code'); if (!code) return false;
    localStorage.setItem('mega-next-try', String(tries + 1));
    window.__MEGA_HOT = v;
    const s = document.createElement('script'); s.textContent = code; (document.head || document.documentElement).appendChild(s); s.remove();
    if (window.__MEGA_HOT_OK === v) return true;
    window.__MEGA_HOT = null; return false; // it crashed while loading: run this copy instead
  } catch { return false; }
})()) return;

/* ===================================================================================================
 * Health - nothing fails silently.
 *   - Every "catch (__e) { __h('01-health:3', __e); }" in Mega reports here (the build rewrites them to __h('file:line', error)): each
 *     place is counted with its last message and time, kept 7 days on this PC, shown in Settings.
 *   - A goal whose step keeps failing (5 errors in 30 minutes) sends one phone alert (at most every 2 h).
 *   - Self-test: after every update (and on demand) Mega checks every goal, planner and screen against
 *     your live save, read-only. A new version that fails it is rolled back by itself (Updater).
 * =================================================================================================== */
const Health = (() => {
  const KEY = 'mega-health', KEEP = 7 * 86_400_000;
  let sites = {}; try { sites = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (x) { sites = {}; }
  let dirty = false, test = null;
  try { test = JSON.parse(localStorage.getItem('mega-selftest') || 'null'); } catch (x) { test = null; }
  const msgOf = (e) => String(e?.message || e || 'error').slice(0, 160);
  function record(site, e) {
    const s = sites[site] || (sites[site] = { n: 0, first: Date.now() });
    s.n++; s.last = Date.now(); s.msg = msgOf(e); s.v = VERSION; dirty = true;
  }
  function flush() {
    if (!dirty) return; dirty = false;
    const now = Date.now(); for (const k of Object.keys(sites)) if (now - (sites[k].last || 0) > KEEP) delete sites[k];
    const keys = Object.keys(sites).sort((a, b) => sites[b].last - sites[a].last).slice(0, 80);
    const keep = {}; for (const k of keys) keep[k] = sites[k]; sites = keep;
    try { localStorage.setItem(KEY, JSON.stringify(sites)); } catch (x) {}
  }
  setInterval(flush, 60_000);
  // the places that failed since a time, newest first
  function recent(since = Date.now() - 86_400_000) { return Object.entries(sites).filter(([, s]) => s.last >= since).map(([site, s]) => ({ site, ...s })).sort((a, b) => b.last - a.last); }
  function clear() { sites = {}; dirty = true; flush(); }

  // ---- goals that keep failing ----
  const streak = {}; // goal id -> [times]
  function goalErr(g, e, label) {
    record('goal:' + g.type, e);
    const t = (streak[g.id] || []).filter((x) => Date.now() - x < 30 * 60_000); t.push(Date.now()); streak[g.id] = t;
    if (t.length >= 5 && Date.now() - (g.healthAlertAt || 0) > 2 * 3.6e6) {
      g.healthAlertAt = Date.now(); try { Plan.save(); } catch (x) {}
      try { Log.add(`${label} keeps failing (${t.length} errors in 30 min): ${msgOf(e)}`); } catch (x) {}
      try { Notify.send('problem', `Mega: ${label} keeps failing`, `${t.length} errors in 30 minutes. Last: ${msgOf(e)}. It keeps trying; tell Claude if it doesn't clear.`); } catch (x) {}
    }
  }
  function goalOk(g) { delete streak[g.id]; }

  // ---- self-test: read-only checks of everything Mega decides, against the live save ----
  async function selfTest(why = 'on demand') {
    const out = [], ok = (name) => out.push({ name, ok: true }), fail = (name, detail, warn) => out.push({ name, ok: false, warn: !!warn, detail: String(detail).slice(0, 200) });
    const run = async (name, f, warn) => { try { const r = await f(); if (r === true || r === undefined) ok(name); else fail(name, r, warn); } catch (e) { fail(name, 'threw: ' + msgOf(e), warn); } };
    const S = Engine.get('Game.S') || {}, D = Engine.get('Game.DEX') || {};
    await run('game hooks', () => { const a = Engine.audit?.(); const miss = (a?.missing || []).filter(Boolean); return miss.length ? 'missing: ' + miss.join(', ') : true; });
    await run('save loaded', () => (S.adv && Array.isArray(S.mons) && S.mons.length ? true : 'no save data'));
    // every goal in the plan: its check, label and progress run without errors
    for (const g of Plan.goals.filter((x) => !x.done)) {
      await run(`goal check: ${Plan.label(g)}`, () => { const T = GoalTypes[g.type]; if (!T) return 'unknown goal type ' + g.type; const c = T.check(g); if (!c || !c.state) return 'no state'; T.progress?.(g); return true; });
    }
    // carriers: right side, no duplicate species, on the chapter you're in and your best leveling chapter
    const sideOk = (ch, mons) => { const L = S.link; if (!L) return true; const side = Engine.get('STORY').regionOf(ch)?.key === L.to ? 'to' : 'from'; const bad = mons.filter((m) => (Engine.get('Game').groupOf(m.reg) === 'to' ? 'to' : 'from') !== side); return bad.length ? `${bad.length} from the wrong side: ${bad.map((m) => D[m.id]?.name).join(', ')}` : true; };
    for (const ch of [...new Set([+S.adv?.chapter, (() => { try { return XpChap.rank()[0]?.ch; } catch (x) { return null; } })()].filter((x) => x != null && !isNaN(x)))]) {
      await run(`carriers for ${Engine.get('STORY')?.CHAPTERS?.[ch]?.name || ch}`, () => {
        const p = Sim.carriers(ch, { n: 6, minLevel: 1 }).picks.map((x) => x.m);
        if (!p.length) return 'no carriers found';
        if (!Sim.dupFree(p)) return 'two of the same species';
        return sideOk(ch, p);
      });
    }
    await run('goal chains', () => { for (const g of Plan.goals.filter((x) => !x.done && x.type === 'legend')) { const z = (Engine.get('LegendZones')?.ZONES || []).find((q) => +q.id === +g.foe); if (z?.cond) Chains.steps(z.cond, z); } return true; });
    await run('special encounters have a fight to simulate', () => { const bad = Plan.goals.filter((g) => !g.done && g.type === 'special' && g.ch != null && !Sim.staticZone(+g.ch, +g.foe)).map((g) => Plan.label(g)); return bad.length ? 'no encounter found: ' + bad.join(', ') : true; }, true);
    await run('XP per hour ranking', () => { const r = XpChap.rank(); return r.length && r.every((x) => isFinite(x.xpHr) && x.xpHr > 0) ? true : 'empty or broken numbers'; });
    await run('main money', () => { const m = History.homeMoney(); return isFinite(m) && m >= 0 ? true : 'bad number ' + m; });
    await run('gym plan for the next gym', () => { const s = S.link?.side === 'to' ? +(S.adv?.unlocked ?? 0) : null; if (s == null) return true; const G = GymPlan.gymOf(s); if (!G) return true; return G.foes.length ? true : 'gym has no team'; }, true);
    await run('gem ranking', () => { const g = EliteInfo.gems(); return Array.isArray(g.top) ? true : 'no list'; });
    await run('every screen draws', () => { const bad = UI.renderTest(); return bad.length ? bad.join('; ') : true; });
    // (named without the words it looks for: the Health card shows this name, and must not trip the check itself)
    await run('no broken values on screen', () => { const o = UI.renderTest.odd || []; return o.length ? 'a missing number or name on ' + o.join(', ') : true; }, true);
    await run('English names everywhere', async () => { const l = (await UI.frenchLeft?.()) || []; return l.length ? l.slice(0, 6).join('; ') : true; }, true);
    // the test pack's live half: the version before wrote down its decisions; anything unplanned that changed is shown
    await run('same decisions as the version before', () => { const d = Decisions.compare(); if (!d) return true; const c = d.changed.filter((x) => !x.expected); return c.length ? `${c.length} changed since ${d.from}: ` + c.slice(0, 3).map((x) => `${x.k}: ${x.was} → ${x.now}`).join('; ') : true; }, true);
    await run('game guard', () => { const h = GameGuard.held(); return h ? 'plan paused since ' + new Date(h.at).toLocaleString() + ': ' + h.why : true; }, true);
    await run('phone update builds', () => { const r = Remote.testSnapshot?.(); return r === undefined || r === true ? true : r; });
    const failed = out.filter((x) => !x.ok && !x.warn);
    test = { at: Date.now(), v: VERSION, why, n: out.length, failed: failed.length, warns: out.filter((x) => !x.ok && x.warn).length, results: out.filter((x) => !x.ok), names: out.length };
    try { localStorage.setItem('mega-selftest', JSON.stringify(test)); } catch (x) {}
    try { Log.add(failed.length ? `self-test (${why}): ${failed.length} of ${out.length} checks failed - ${failed.slice(0, 3).map((x) => x.name + ': ' + x.detail).join(' | ')}` : `self-test (${why}): all ${out.length} checks passed`); } catch (x) {}
    return test;
  }
  return { record, recent, clear, flush, goalErr, goalOk, selfTest, get test() { return test; }, get sites() { return sites; } };
})();

/* ---------------------------------------------------------------------------------------------
 * Black box (Jimmy 2026-11-20: Chrome went to a solid grey page on the Mac, white on the PC - the
 * tab froze). Every minute Mega writes one line to localStorage: memory, page size, the longest
 * stall in that minute, what the plan was doing and where. localStorage survives the freeze and
 * the reload, so after the next one the last lines show what led up to it. The last 6 hours are kept.
 * Read-only for the game; nothing here clicks or changes anything.
 * ------------------------------------------------------------------------------------------- */
const Blackbox = (() => {
  const KEY = 'mega-blackbox', KEEP = 360;
  let worst = 0, worstAt = 0, stalls = 0;
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) { stalls++; if (e.duration > worst) { worst = e.duration; worstAt = Date.now(); } } }).observe({ type: 'longtask', buffered: false });
  } catch (__e) { __h('02-blackbox:13', __e); }
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]') || []; } catch { return []; } };
  function write(row) {
    const rows = read(); rows.push(row);
    while (rows.length > KEEP) rows.shift();
    try { localStorage.setItem(KEY, JSON.stringify(rows)); } catch { rows.splice(0, rows.length >> 1); try { localStorage.setItem(KEY, JSON.stringify(rows)); } catch (__e) { __h('02-blackbox:18', __e); } }
  }
  function tick() {
    const m = performance.memory || {};
    let what = '', where = '';
    try { what = String(globalThis.__MEGA?.Plan?.top || '').slice(0, 140); } catch (__e) { __h('02-blackbox:23', __e); }
    try { const a = Engine.read('Game.S', {})?.adv || {}; where = `ch${a.chapter ?? '?'} stop${a.node ?? '?'}/${(a.nodes || []).length}${a.battle ? ' fight' : ''}`; } catch (__e) { __h('02-blackbox:24', __e); }
    write({ t: Date.now(), up: Math.round(performance.now() / 60000), heap: Math.round((m.usedJSHeapSize || 0) / 1048576), dom: document.getElementsByTagName('*').length,
      img: document.images.length, stall: Math.round(worst), stalls, hidden: document.hidden ? 1 : 0, what, where });
    worst = 0; stalls = 0; void worstAt;
  }
  write({ t: Date.now(), start: VERSION, before: (() => { try { return JSON.parse(localStorage.getItem('mega-bb-trail') || '[]').slice(-15); } catch { return []; } })(), gap: (() => { const r = read(); const last = r[r.length - 1]; return last ? Math.round((Date.now() - last.t) / 60000) : null; })() });
  // breadcrumbs: the last things Mega started (game calls, plan steps). The latest is kept in localStorage, so a
  // freeze leaves behind what was running when it hit; the trail of the last 30 goes into the minute line.
  const trail = [];
  let lastSet = 0;
  function mark(s) {
    const now = Date.now(); trail.push(`${new Date(now).toLocaleTimeString([], { hour12: false })} ${s}`); if (trail.length > 30) trail.shift();
    // every mark is written (2026-11-21: with a 250 ms throttle only the first step of each 3 s round was kept, so the
    // trail always ended on 'goal region' and could not say which step was running when the page froze)
    lastSet = now; try { localStorage.setItem('mega-bb-trail', JSON.stringify(trail)); } catch (__e) { __h('02-blackbox:38', __e); }
  }
  const lastTrail = () => { try { return JSON.parse(localStorage.getItem('mega-bb-trail') || '[]'); } catch { return []; } };
  setInterval(() => { try { tick(); } catch (__e) { __h('02-blackbox:41', __e); } }, 60_000);
  // heartbeat, every second: where the game is (chapter / stop / zone / battle turn and its foe) and the last thing
  // Mega started. A freeze stops it, so after a reload the last beat says to the second when and in what it hung.
  const hbOld = (() => { try { return JSON.parse(localStorage.getItem('mega-bb-hb') || 'null'); } catch { return null; } })();
  if (hbOld) { try { const rows = read(); const st = rows[rows.length - 1]; if (st && st.start && !st.hb) { st.hb = hbOld; localStorage.setItem(KEY, JSON.stringify(rows)); } } catch (__e) { __h('02-blackbox:45', __e); } }
  setInterval(() => {
    try {
      const a = Engine.read('Game.S', {})?.adv || {}, b = a.battle;
      const foe = b ? (b.enemies || b.foes || []).map((u) => `${u.id}:${u.hp ?? ''}`).slice(0, 3).join(' ') : '';
      localStorage.setItem('mega-bb-hb', JSON.stringify({ t: Date.now(), ch: a.chapter, node: a.node, zone: a.zone?.id ?? null, ev: a.event?.raid ? 'raid' : a.tower ? 'tower' : null,
        kind: b?.kind || null, turn: b?.turn ?? null, queue: Array.isArray(b?.queue) ? b.queue.length : null, foe, mark: trail[trail.length - 1] || '', hidden: document.hidden ? 1 : 0 }));
    } catch (__e) { __h('02-blackbox:52', __e); }
  }, 1000);
  return { read, tick, mark, lastTrail };
})();

// Mega Alakazam sprite supplied by Jimmy (2026-11-15), white background removed, 96 px wide
const MEGA_ICON = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGAAAABmCAYAAAA0wZQlAAAuwUlEQVR42u2dd5xU1fn/3+ece+fOzDY6YgOUslQLRo0lNrrBgqI0S34mthhjAzTRSAQFQUTUmGaMGsSW9tWAYDfqV43GAtJEEAsibXfZ3dmZufee8/z+mGFhBY0iKEm+5/WaF2Vn773neZ7zlM9TruLfYE2+cZqIgO8FoBxXXH6x4j9kebv6A06cOFG6du1Mr1774Xk+IoJ1ORk3Zqz6PwZ8DStdWkKP3r148OGHMWi01gwbNozJN0yS6urqf3sm6F354a6/YYoMOeFUHn7oz1inQDT/aWuXPgFBkCSOY3zfR1sBsYD6j2LALi1SYRzjJzzExnTaZy+MAa0hn4v+7wR8LUsJWqCysgsKqKysRClFEAT83/qa1rSbb5EPP1wlj82eIyvf/1CWr1gpE6+fJP8p+9vlFWppabm8+ebrGKVZsHARxvM466yzWL9ujfqvZcDkqbeKc8UL+JqrLrtopxKjWbNy+cP9DzB65EjEOmpra/87A7Gbps0QP0jSvsPe9OzRC5RQW1dPPGmKXHPVzguMwjBkyZJ3im6o++91Q+NIiF2Wnj0refjhWYBGKcPIkSMJPCNjx1y+U5iQSCSx9utX+5OmTBeU4Jzjp+OuULuYF6RBfOKwAYl3tluoQcw34IQ5EAg8s4u4ocqBUlsQxaNnz568/fbbX0PA8vWqnqlTbpFThp6MKEfCM0yZdIOsXb9OfaMMuHLcZarABytDTzmVBx54AO0nMOIYduqpOIw45/hJ8Xs77CE96FbZEYVDvhYIZLKcfMqJPPTwX+jVuzviQnJhfteJhCdMmEDS9xgxYgSLFi5m0cIljYETaseTyFqhR49eX5v073dgH/78P4/Qs3dnrMsUDb/edSLh+rqNar/99pOxY8dy2oiRGHEsWLAAZwVjdnxwrZTC9/2dTvgbp9wkSim6dOnCggULCMOQVMqn875dsNbuWlhQTfUG9ZOrxqkD+/TkwAN7s3jxYrRKogiYcN1k2XH5gBvkrrvuJpvN73QGOKVxqkASQfHuOx/SuVMvevfen0ymTu2SYFztho2qunqjmjJlCp6yxGEDpww7hck33rxDmJAIUhgvQSKx82ErT2mwjncWL6J39+7ccMN4DupzAA0NDWqXB+M2bFinrr/+OnES0+dbPRk27FSUQsaN/eoGuUu3yp2ugm6aNkP23ntvkskEZ4weDThqanZ+wmeHipVgMUYhEiFEO1BvOrLZ7E4lRBiGGKMwxuBc/O8JR9fUVCmAkSNHy8yZMxkxchjOObn6p+O2W5LiOMQYgxFBRMjnd7wtmHTTLaKd46yzzkIbqN248d8fayotT8lfH/mTrPzgfbl52m3bbQ+at2glpc2aS0VF2U4JAaZOv1WumzRVSpu1lP+ojFh9bVadOfp7LFywiO49K5kydfp2bbC6ar2qr6lWGzfueC/k5ukzpFuXzpQEPoHhPy8f0KpVK7n88jF0694dYxIsXPA2URRyzc+u+saP+JSp06RTp074vs/w4cPJ1H8zELcCuHHaLYIVQADHuLE7Dvlr1aqNjBl7JaCYeuMUcrks9Zmab5QBU6dOk9NPH0YURRxwwAHfbH5h4uSpMu+pZ2XFex/KivfelxXvvS8zbr19h+rD8ormUl7R8htPI6bTaSkpKZH33/9Q3nvvPdl9992/8WfyjDHkcjmcc43JDrejgUdVgHW/6ZVKpdBaY60ljiMaGhq+8Wfykp6hV7dK/vLIXDq23wPPOAYeP5jI3iFjL79whxzN2ppdw60TEay1RFGelStX7jR8Zyt7M/02yWYaSCaTRc9HGHPFJQrAu+668XTs2J5cmGXx0qUYT2N1kmwU85+2qqoKccoRRxwhYRhSV1e30wVj6k0z5JQThxRyJko1Op433XSzXHHFZYXsSvPmzeXumfexZOEinAMxBjyfn1x60S4hueNP+44kJA9kqC9rxg13vfBvEShNmTpdhg4dysK338QYn4WLluCKjufwYUPp0+eAzW5oeXmpGOOjtcfv7v4Db7w9Hz8Wrr5m3De2WYnXyL0Tv8cZZ/Yi8iIgia1vybXXP8PU+/62SzGhWbNmjVYuH8aMHz+B7t27gYpJeAFvzX+bGHBoNDDi1JOaMmDLVVFRIQAPPfwnXn31VZLJNFdc/uOdumGx9aJMaZN7/HnioXL8iMNwfoB2IDrGc7Dw2RU88th7XPPg698IE1q3bi1hGALg+wFjxoyhV69eeJ5HLh/x9pJ3ChDHpElcddVVjDj1hK2ucdBBB7Fhwwb1uRsob1YhD9z/EHvssQePPjqbIOERBAEXX7xzVZNE1fLrCaP5/pm9iX2NNRmMgI0c6VQJZFtx9TX3c/19r32tDGjRooUAvPTSSyQSCaCQrQuCgNdff53zzjuPMAyJrQU0tRs3qC0Fesu1sYg3qS8Szb7yyqtEUUQQBIgIBxywX+MFdjjx3Vr53bWncM73BpBLZEmW702m9h2MCI4CJJ3Oe7z+0goefGwNU2Y9/bUxoXnz5iIi3HvvvRhTwC5GjRpVzFt7rF+/Xu1wLMg5RzabQSmFc44oihq5/2VVjIRrRHLVnxkRSFgl1FXRwttIg6rCqgpQEcolUGLQQqE4S2cJ1BpaRuu/XthAqUbCO+dwziFFlDaKop0DR1dVVakjjjhC3nrrLRYsWFj0o7/czVpWlMp15/XH1L5PFOyFxPWCgk/r/JmTziUVrWC3Pq0Qk6akYncydQvwiFEIhjxOAmLjyBqPiNQ34saeffbZsimG+KqawPtiOH+NOvTQQyUMQxKJBDU1Xw7LifG55OoT8Pz1pOM2TBl+MHndtMQ8ztfIvROH4wd5eh78bUpa9AYXo+IEigjBECqDweGAPocfztN/uv9zjfjOZsTXmpBZvXq12v5MGYikCGMw9kMum34iebGUujpRpgWXPvgPdefPh3PWiO4kynuScQZiH1QtSkWIFG+tokKFnPhYqaffd/dBEs3lylkvqW0RX8I6mTiyH57KobE4o2gwLfjVn+azLlel/msaNLSpx1cxon2UcuCypFWG824+HUFR54XSSm0kWZqknjzaA6iioWolWoWAaUxNbvq70jFekEWHmU/FDnVy/cijEKUZ//1vMfamURiVQ1SMxqdOt2Xq469Cjv+eDhlfypj/6tvsf0gbNDGh9kGVkApjXKqOk0/cG8nnCcniOY3KbqQqv4xSHSLEjUTXUnxcVXDzsCXUeQV//MrhR0mZreXaM/swbtrJJKzGUx7WrgOjsWiWv7SQetUcndf/fQ0au5UhCxfdRFrW4DuL1TFO+XiS5JHfzmHo2YMJ/SyIAiU4DFocomTzY6o8SACSRMUZFrzwMk88asl4Kcb//HQksRqrPNB1hcqe4rXEebz18gJOO/8x6hRUVe86jSlfW49YtdcCJeBLRM7z8VzBOnga2nfdg9jEFFyjglwoHPKpUEW5EkTFiNlIoJoxb/Zaxk4+C5Ek1v8I0UUGFWVLFIhSICl8CyaE2GsG1PBf2aQXWIdxDudH4AxKhNDliL0MTrkvVJ5SKEHVxM4iAcTJDeACFLbxO0rA6WJFp2iSrpacDw0JEKf/O3vE0oGW+387joRbRr9j9yLG+/LdLluoIFQWVIxICRCDciiRYvJHY5XCEx9jhdfe2MAp59zJqupdryfua32g8latRLv1VL82jrxXIBTKYRUYcV/QoVWAIMrhpARPcqAiBB/BQxEVv2lIOMPrL/6Dvhe9xsbqXbOv7AuroPFnDBIvv46sX871920f/mKsT6kCGwuLX3qdbof3wWqH5yDWuhEdyXsxqbhoRLcpLwolBkMOwSt4RULRaCsMSYzbwMLXVhO7YoP9jsKqchvl+lGnIHoD1zz8htqpdUFXn9NdAH52Sh+54me90d4aPPkK7UhZMDlY+taCos6PC16KKuhqQ0RCspSEGmvCL4jPRChXxGe0QyGI3cgbr7xPff16Rl/w9o6telAO46/kqluP4afDegtAu7LtLxrT2wbFNsiE0w6RCVf35drh35ZSfy1eopSYFPVfgf7VudVqZQNqyDmPIRKgRApSiyYZppj//ArWzl7DmgteZtmTH36xDWjH/FeWEFgfXxRK0rz59Eq0izn1kjdYXr92h6oeFTRXeWOIQ0uFeLRttps88Jv+7NFs+8oOvM/yNtKultBokq6ey6ecx08vvo1JD78GtoRpD7do/OblowdL4PLcMOupL7zRHLD8nVVIwrH/wT0L6I5OkJ/zPivWNeOI3zyKnDcQju70L68VRZZ3l36EiWNE53GSIq/TDDvnb6xq+Go2btyo/mLEbrW3a3/3LDd97ygunXIhtdc8Trn9ZLtLDLfJAJVordqVGrl42iAilSQ0VaRKkuBVoBLlCmD8sH4ipoGrJ+5H516TPt95lDrRqkxtqcojSfPS/SvoflhvvLzB+qvxNibYu66ED888ldJcaZODapXDGUPKphBXR14ipl75CJX7tqSy6z5oyYD1MBZCX7OmZC9o2PYpOumIw8U43WjQUQ5FzB9ffKUJoWf99XFWLP0ZiTApFsOEPz5S+LkPibwhn1hFMlqLLy0I1Q62AQ2mFGfqQFk8a1BRW5QuEF+yH4gfLEQSn1Cv96VOPt+WNyE+YBzEUcDq1B7oXJJEKka8NImyKiyr8eqq+aRsVUEdKkGUxRMhicV4ChcnSUor2pkKPCzWbgRVsBmh8cimd8fkt13zIw31UpptoCLKUBHVUx5lKI8ylGwDYt+oKqihHFX6MsngLSRcKVKbEWXaqQZdih97+GSwevtb4z6Xcn7YhkDq8WyCOFiN5DcIcR3Xn30Ql998Clm7L3v3upi6+ngr/p/5rQPEw6FFcedrb6rNtTlrpX3zNpighpvnvo84y6Sp/SDMo4e0Jsq04N3Hl9L8pHaIAqtjjPPxozJsZKnLa6ZMfBFfBZx0wr64fD3aWBAPXIqc2o2h595DpnYzZP79gw4UgL33aMfEU0/kpCMPQZTb7NaKx7L3VrJHMi31gd+I8dfUfUjLiq4sevdcyvKO8WcfjKc6ItkNMvnsw9CiUTjW+22J1U6IAyaMOlROHJTmjQXrGH3xCdx42SNYs44rpp7MO0+so//lT7Nmw9aw7p5BQm666AI8m0XQLFv1MctXvM8xg/cly1sM/3/HEfgBe3b5Pfc/9Cf+OvMybr3+BBoSDi0aT/JYpYqwkCBxC264bibNwoCPHBw5ciIXnnoy8+76NpAuekOGpYs/IK92Z8wtLzFg/4PJxXWkQ8O+e7aiQ8e9MNqhsSAGhwYVA5rlyz7CKMcvnnqGmkRAXXXTfEfzktay9J2fEbgPKVMVTB93HwP77c8LSz/goF6GARcsYv3G7esh/twT8Kt58zl2cH8O6gmLn3kRT7I06BRZuy/HXDyTqtptFzZpP8Hy5cvp2rEtooTKvfeiUyfDKedUEprdiMIEzvhcOLgXxxz/HYaeXsXPpzYnJRsIbEjeA4uHISKIfcb/7G5m/s9KVmyIyJssQa6G+QMOwtgk1rMF+EEL3XrsTewsD/62PyMueIWLDj+YyOTxnMZzoJVDUDgFRmIgAtEYEVBgFcWT8SnvLbNO7dPtEvnNRYPxvLU0eD4dj25L5++04Z3nF5INNu6cQKwuVpTHMfkgSxCWM2DwXkRBGX/53VNYLw3UbfP3PqivV5Oee07u7DSikO3y/pfKnh2Z/9KrGHEY5xOpLONu6cv1px1BTc37jB/Vn/GT+pL3NwIOX7KYVMB1F/4PYx+ZT3jSIKxfR5ATFj50MieMLMHFuqhGdLGeNQYUrcNq/nx7JUPOf5YL+h9Nx73bYHWE77I4SRFpjaHQafPO8iqM8rjl6af4pD6rYNutUKXptgy84EgCNnCCRAQqz5svLEO8BoJaRQYQqRelvlxWzvv8ms6M+vPs9+SUIXviObAuwItrOKBjFwZ3yRHrPeXh//3nNm/oOViychX7te/AGb95H2WXY7RFUKSknmdn9GfhS09wSt8Ur80eQqDWbMZ7FIhL0abLrxhzdHfMql9yw4xvs/DBIeTyBiVtKc1ZYi9PvlgpobdwoRvSWXod3Jv57x7Jfl2v5fazz8fYgFAFGBWSkHosaYwDQ0xkBF+2bUWHf+cYUVGelxctxLMeHj6+07z52j/xVIIjzn+RMUedxttrV35p4v9LBkRhRirblHHSkA5gIvAConwdTzzxd3q02g+SKcIjDxeH5tHnn29y85qNder3cx6XC/r2Y+xRx+ESCWY+8ih1RnPnAw/x7MLXcJLh27utQmfr0UqRy8Yo46GVz313zeHPvzyZFmENb70ym6RzPPunj1gT+OzT62Ca1c2nc4/mhUqJT60DvrU/zqVpm6lm2T/vpLL3hdz0w3MpCaFGkjz50qsFaNxpOu7ennsfe5QP89FWxDvj8COkS3k53Tt3wo8iJv/0DnyzhvHjL0PFCuUEpduS0NXoZLzjVdCpfY+iWtpgyBMbEJUnR1t+Pft/GdyjnH3atOOQli2JtUfFYYfLzP99sckmNiZKQHwqXMTM/5nDL2bdTx0RAwefgBk4jCcee5InZv6IE0/qwtjxI1AVFmuT6HwhMm6bq8J6NSTCFE89/h6X/uZVGhKWIJnmhdl/5am3X+fGm6Y1TknYBNc59SRaFcFWgfpEGTnj89KLz+NKM1x47kDmPr4AHZWAjalNpCC/2Q09+cgjxAgMOWh/Am2xZPEl5uN3KxC1hrf+8RJaHE5pEpJhft16Ou25Dyf18SXnK+a+/LLaIQwoQYiiPLg0nlgiT5Es6UDetSRrFFoUQRziIXi5/DbDjLzxcJJndS5DNmHwtAdxAa9XiVoivxUZE2PT60AU4lIYLEY10BDk8G0S6lNUZ5NQ4pMyaWysqdOtqE/sQWhbbb6bgCIkHYHoPHkdoIlo7hrABVSbetLyDq1UewK1ClFtyJsy7KfIVZ7PYSTGqjw5LVjtERpQqgXYFsR5IeFpcGlCAxnSJDNCy3xIdTrYcScgqK+gDcLDs+vpd1wHnnn+LXLVdRzXpSPOajp2bkfOWVat/Jhue+zG9/WBkjU+971SiChraqrUbc8+LWP6H0v/o4/ixH59iYxGBBwxfY8ezDMP3EVS7YkSTRT7KBGiKEPnLntiohqwlTwwdzk//91sIu0VgDcNAwccy8ABx6Ji6HPgfkTZBs4/9wdIPmTYMYfRAg/jqUYY+4VnnuCKCw8lUO3JJDIMHNKV2Y+s4pY5y6gt9ocN2a+XtEt4dN69FXt02BODKqSf8TAOQruG8nRb5j2+ngGDv82jf3uHVH1EWb6Bjl3asar6Y0q/5FyjbTJAautlxDH9GXBkezp0SPDxuzXc+d47iNb4to7O7fdk1aoPibSP5wsd99kLnEIZyCKccczR8odnnlUAsXa89MEqLv3Z1cS6YCSNgBNNziSZ+KuHGDO6PzcecALaqwFTy4J/fkhaVZAJLH959J9M/sNrNNgEWtxWSZzLL/sx02+axgH77c89f7iXXJjl4qGncsGAAYTGkogCPGsItU/W0yjxiEhjAE9tpLb+YwVw+mEHy3cPO5RU8R5OG4jzhVBJOQyWyj07AAmWvfsey+54GRe25MeDTyR2tRhl6dCuJXVfMiLb9glIKpyux/kJErFl391bE2sPwRApx0erltP3iMNxEkIsOCUYBR07tgMUe8WaKBvJAy+/qGqqNqpnlyyRHyiNQ8g25ClNpnnkb4/S//gTyOkUv//bG5x20t6kXBXEbXjmqRUcc1I7+p37MmvXf0IkloRzPPXUUzgXc+yxxzaWCBoVNSYrc/kIceCnymhAk7KFYM75WUz4IUPPW0k6uZ53XxnDm/98g6FDWlHrtZS1S0L6Hnoons0hSCE37baoabIx/b5zKPP+/hZK+XTZrSNGLIYYRYhVgtWOPTvugSXBCUccIY+88MV6GLaJBX3v6GMZ+p0jMU6jXIJYe2hikjYPKibUhc37LiokTURhNcUkuFARKIYc1ofh3zlSiql3lICnfSrKypl2y+2cePJJJJXw7OOzoSQgpBmGPMZfyUGDDmbwGc+xek0tNkqibQolmmw2i7WW5557bjOupOGqcWN4e8EilFJ4nmbyH+7krmefIYgSaCKcMlS2P5gL+h/I8Ucey24HTaLbt3vgbBmrljfQefc9URJjFVi9xbiyLWyLRoi9CHQ9CWrwyJD3G6gPc3TuuA++Bc8JhhjvSzTZNTkBYSaSRImvjAvxsMQC+3Tei2XLluN0mvlrP0Eby3cPOwhFhCMoqgVgi+yVtRZMzNADejJ34Rty3z134pzjsSeeRClFj+774mILCpwo1qxeS+vWrbdIsrxNVUOeOI6Z98Q8BgwYAMB3vzsYgHnz5m2BtBqcgDaF4lkRRdJPEuIIvRhFjJIEQST86ulnqCpNUlsttKtoxqBu3encrgPKgnEeWiLwIWcE42jq4ori+MP7EIrhmedfo8Pue5KyDu1FWHEFUVabxt5spwo6deBATjvicDl8/y6E1hXGt+Do3LUrL77yT/odezhhZiPOxoWhFugvNcttwYIFJBIJLjr/PLaetrJhiySL3o4GOmmUA7epukU0vnhMem42qUizMpshVgasoJSiY6vWpCMLyvHu+8vYc6/dUDEktI+SJjJVuHZsKS1J0++Y7/D8cy+wd7u2dGzfHt83WBt9dTjatxGpqJ4yX6P05qoFS8i3DumDFzVQ5ms8oxAUot2XuE3hk8uFaL2Z777vFyeUuMZPHMdIMTIdMGBAE4nf1mTDx+c9xg0Tr0crQQno2PH7Wfdz+xNzue2ZJ/m4LmZlNkSUj0KDUUTEmIRPrCHnafzYsOr9dax6bw0JElhv6wjP04Y4m0XFOY444mA67LMXWrvtJv5WJ6DexpQGSaRYpeBUQfcZAUXcqG4cpnjMvnpDcRzHKKV2TC9yY12QxipNddprzD9QKJLDFG+VEp+MApNMIRhircn5Mcm4UH6vkwZs0+hWNuVviPGdbqpqGiNBvf0MeHnRIipsnkEH7UdCLFlt0M6hRVCqgOMIRSgXhxKH04IpPonVhXIRJbrANIFUFBfLT4o69VOuZN++fYmi6CsyYTPxGwupRROYFGs+Xo1osIAnm+fvfbCxilbNyog1KEkgQOg5KnIx5x57LPtWtidNXIhLzCaVVthEYb8OLYU9G9maD9vFAK8igLqQ5ctX07FHJ4JsLdoZKA6MtEYQbKFGWYqRpzicSwIGYy2aGIeHUxqLcOnR/Rh1xpnMmjWTSTdch3OOXj0rGTBgUKO+/3zCblJfDmsFrTWe52GMwVq7hXqKmwqicigcqkg8b1P2QxUatktKyrj22mvp0aMHAIMG9EeURoBpM27jYzT7fLisYMQpeEgG2WyYReO0IxkrjIMsMc7XgN0mPvWFGLDhozVqAzDj+b9L/qW/c+eo02nwCy5kKnYEkUZUjNNZBA9LCSoyrG/XmqpkEmN9fAeRhtCLadXQQO69NV+xakYXj7Vm7tzZ+L6P53nMnj2bfv36bWHG9FZe9b333kvLli2prq5u0i3fokULZs2aSRAE9O3bt5Fh4EDBpZf8CIDp02fgOdjtkypKbQ1Wh8UsncU4S2AhbwwJPEQ83l26EmMC8kZ/tUBsbVUhJfeD3z0oTseU6pjx55+PZ/MEVgjiBOtJkNlzb+JkggvOOx/PGIwrKCcrhVqf2fMep7okyVVHHFycRbF5zZs3j759+6K1RkS2eRLmPj6PgQMGs3DxItCC53mN/VhKKZ588slG1aWUavSeNv2fc46ZM2fSokWLJqPJHnjgAUQKM6GfeuqpIhOk8QTpoj25/JJLiTTMuO1Gmq+ro3W9V1Q9gvge9ZHwyburyBvDnXMfpTrwUaKp2fjFh/x94S+2KC8RPClEhgRceuVYLhkzlvKcJXYW43uExWBs3mNzC9XPsSXpe+R1YQ7bGWecgXOOWbNmYoyPtZa+ffsyZ84chgwZ0qQx8Omnn0bQhGHM0qXv0KNH5TZL3Hw/4M0336Rnz56EYYjWGmPUVs11W7q4YRjiXMygQYMaVZkxwafsCRinCY3DaseNU28ieuV1KsIcRhz1yYA7HptDLh0QxJr12zkPYzvfH3CLXHbJj9GECBpRjnnz5qGLlccDBgxg7uPzijlXUM5DlGbhoiUo42FdTK9unbDKY9GiRfTsXglOGDx4MCLC3LlzG6VRlGbBoqX06tEdtlGVp3CMPuN7KHHc84d70S5CzBfo4tSFrQ/o13+bPj/AnMfnMWjAADyrmfGLXzLpZ1ehohDP8yARsKr6q7c5edunmaXxoR9/fG5xIwObDEAVdOPlVfFId+vWlWwYcd555zHz7t816u1CQGd5+umntwrAZCtP51NurEqgxLF6fRXNW7TA9w333XP3v9zB4kXLAGFAv4HbzAMDnDB4EH/5y/9w4oknc/755xHZQq/0jy++UJHJ8A3OjHONFQWb+mSVUoWjrkzjBFpXJO4mA6cNJDxwUVjEWFwTA9rQ0NCEAaKKhlXJZx5VTUy5rSaBxZNwm5K8zR1YcE6KgqI/M0ZJJBJYG6FNIcKOnXxzDRpTpk6XRMLj/Au+jzGK2bMfY+DAAYDGGI98LsYYxW23zShKvtChQwdMUMjb2igmyod4xuDEECQ8enfvxvzFS+hZ2QVjTGMEvEn6Fy5ZTPfu3cHF21SY3xt9Gpcc/y2QDBtr1hDrElo1awbAH//4RzKZTEFlfEqAevToDKKZNm0a48ZdXoy53DaFrSBccOmPLiIfxtgolLFjLlVfKwNunHyzXHbZJSgFsc0yd+7cJpACwK233oaI0LNHZdHgUfR+dNFgeoiFe+65h8VLltCjsnMBRfvMg1iw6pv86m3p6lgFhd4CZUBp4kJfc3ECTDkPPfTQNnClQimiKE2vXj2YPGU6Yy778ecoCFc0G0LgC5dddkkRF9BcPeZHaqcyYMIN06Q0neSiiy5EXFwsAvFxDgYM6IsRh1WaKdNm0LNXD0Ts5tFnjcbObaFWCurohut/zqxZs3DO0qtyH95euoweXTuDK3gyDg9FTM9unYC4QHgVY6UMo2rR1uP0s87g+VsOYfbfPuG8bx9JRiepNzF/eeEVFA7PKNimytBF26JBBF9plNZEcYTWuvGnoBkwYBBPPvkkxx13HEqBNgZxIWMuOX8TVC0oh9Zw5XZMlGnCgOsmXC8FcMxvBNsvvPBCfK1oyNSSTqe3MXG8qaFUn1tKrkmlUpx++ulUVVXRtm1b7r67YDB7VnYpzl5QBcBsWynSWBCyhCYgljI8cVjXQNdOJfziiX9wTr9B2Kxm9GGHE2pN1dp1tNp9L+65+y4++90Elh49ujNt2jTGjLkcJw6xW8MlBah7a2ZefskPAdcETt9uBkyaciPJZJLVq9cU0T9HHDm0UqTTyUZDO2fOHAYOLHo9ynDL9Fvp1r0bSAEfasRjigM+tNaMGjWqME8nl6O6uhqtNevWraOiooKZM2eiNSilUcbn7YUL6dmz51aD/nImKKqOmHcXvs6NPzqOFe8uolvXzmSJUbGiuRdQ3no38kYz7Jh+uHyhI3uTv//pZYwqZPaAMIzRWheFSDdGzpuIvynY2xJAlDjPbu3aULudg2WbiFq2rlZVr1ur2rSooE2LClq2aM2M6bc2glubpHhT+F4wlJtRQSVuC1SyADUPGzaM008/nerqatatW0ddXV1jOrE47IKRI0eiNqmtogeltmEQrfJBOZyOmHDdTzi6B+zbqRITZPnbbd9n3YaVLP1oBVpiUnFIr9at6detB8OHD6eurm4bW3eNn8rKSn79699y++13NHplc+bMaTK13Vohk8kyY8ZttGzZmpYtW1PRvJyarzDVV3+WqtBaE0cRicBrArHm8/kmBCygW2qbAFQcxySTSbTxEcBK4R0wSm3SW4V/B4Hf6JI2XmaLkndRBUYH1mLEop0PSUM2bgAvQ9aWUEFIbLOELqIQD2pUnKVUGxIJj7RfUugz0J/9OpJ8Pr91HLKF2tkEBDbSSHmUlJXv+DigpqZGXT7uJ8yaNZNLLrkIVFjoSkTQnimoIoE4jJg+7RY6d+xYVA0FgqZSAYlEgtGjR7Nh3Xo2Vq1FSYTBoiQGiRvLuZUDE9WiYk1ZUELSQJ8DevDWgvlbMMAwf9ESPB9ceSnECXS+Fqe7onRnJt+wlOl3LGfv1l3pvnt7cAExKVLlijD/ARvWv8eIs85EnEcyzqFdtFWiyGhN925d6VbZhRkzZhBFEcYU1O0TTz1JbIU4jrE24tJLf8SatWu56pprqFq/Ycd7QZMmT5Hu3XsycMAxTdzITSdBgLnz5tCvXz8qu3Uu6sPNkhJGwuhRI1i/YcNmf2jT7xYf17MQmoiEDjiv736ce8Zw7nroj0icJ9IBN948hft+//vGV1gphKyNIG84b/Qo+h9wNLdNewqHofc+B6Ilh0QNoJM48bB+Fe8tqmfsuB5MOO0YaqvepWXLHmiVJW/g/nv+8Bk5hcLbW33fNJJn/luLyOcczoYkkx6DBg9GG/jRRefiaS2XX7b9rmgTBky8/kbxPM0Vl1/eqBtFFEppHpszD+P7OCXMf+N1Lr3sxxitKICY0rgBURDFecL6epSLMVqI8QsJGuVQWGLAU4rpIw8hYT1OHrUnv372dRpMhEiKc0aNIG2qiWNHIuHhXMzkiROY+cCD6BBcVEv3tmmQjoDBc3WFjIUksRpMsoYPl+c4f0wbnK7hlMGtuG3U/mxYvxjrpTFW07xVS6AQk/i+v020dtMp2X//3syf/zY9e1WSTCaZPXsegwb2J+ErLrroh+RyWfnpT8aq+oY6KU2XbV919A2Tpkrv3r1RSnjssceK3owrwg2KZe+sIJvPgdZceeVYdPEUNI0eNdrB/xt+OkMOO5IRhx+N046EzVG5T2tUvK6YYw4gzvHdoeUYdsOr/5iSEJQYnHKU2Wru+8VpDDnnHO655/eNEnrmiKEQe6STJfgWtCsMQo1NYaCTQoPAoneXcNFFHUFtoOchB5NJZPn+cQcy4cyDMFE5Daa0MUfQtm1b7rrrrs9Nr+byDXTr1pVhp48giiImjJ9YKERTIQMGH8+VV45Ba/Olid+EAVMmX9fo1Wz6U0tB7//kp9fQrWcPBvUreD8uipj7+OPFNKQlYX2M8pCERzbMEriIfr32pJlW5HWA8yOeevYtLrywG6nkWlzOI05kwJXiuQ2IasFjv+jPd4Z/lxQw744jyVGDtlkiJXjOgBYuOq4/pVtM9HUaIpMniHysA0yEMgqVSJDWPnsdfQBEliAqA51n7I0nFNSpK+GGoYehEjVI3hIlcqRy6eIEl2Lu2HlFg11IxoPjgftmFbJsOIaPGkaM4S8P3k+/fgMYN/YyNEpEHFdedcWOyQdMv+V26dChA0Y7UqmAMIy38g6UFLrcJbb88NxzkFyGn/2/s2hmBC+OcRp0HJMPNRMe/B2JAGZNOQ6nFSIpxF+PkxRJZ1mb2R3fpGjpv4sozbd//AYz757F2WeO5tyTTqK0qmqrMhjtNLEppAFnPf00G00Dowbvy+kntKHL4UfjW0fs5Qs2SAoupRHwvJaMOOkhBh57EFf99m/88r7fYBxbuL9be0vF6TcoHKF1vLP8fW6ceC1RZPG8BPlchOd51NZVffXq6Mk3TZd9Oncq1kAo4ihqOjqmGIicOfIMstrhq5irf/ADWmIpjzI4GyA6gdgcWgXoEktNBMkshJ5Bi8KTkFh8AhuTNUnaJtfglKbOlBG4CIkUgVPkvQiX3YjnHFsNOxEPqyNMJKyvz2KbJamIhHy2nEQckU9QyGuLh/FzKA3ZuhacO/oWjj9qGCVRDRN/MIxzhg/l3vv/hBJDZEOU+Xyo2DMJrIWqqpqdgwVFUdTom3t+gmw2u1WmqaCCICGWtI0oy9aRNlJ8zW2M1gG4gHqjSLoGWjpFdSTkKCNNPVZH1NIJrSMEReg3IChilSKvLC4O8UoSmGxEmMsX4elPPacXE0Q+Ga3xK5qDzeDKdqMhVYlWOYRSKI6yURqMbolnu5PK70MJDeRVCSWuirb5PM20otpaYlsY/YExn1OBob90CcoXVkE33TJDunbqiiZXyHjhsXDhYibdMHErY7Vx40a1e4sK+dkPzmG3KEMsMTEBnkTEVvPeusXEcY6Es3Tatw8f+235+e0TmH3H2WQ9zcnnP0g24SjJGxq8JAkXUmpriTWY2OA86N9tf7q1bkVoklilSUcOlG2sTUqFaab/fR7rKgJUQ46EKUWImf3LY+jV5xiS3nKc8nBRjMu357Jz5tD/W50Rk8cpjecsSvtc/cs7qDEJJFnCXXfdXaiQbqKCXPF1mRqnPN5etJSrxn61kc7qXw2i3pSj/byBF81alsr5R/bjkL33oCERosIAZUKWvfcmV97WF+cKjRPnnXUfddFePPfWfKzng2iqaqoL0XGxeIoow5SRx6EEcolsAYNxAQq447E3UQSMO+poQhSeEzKJQh/xXc88wcJ16/BNAH7hYLdo3hyAv/+yN10P7Y3Bh3w7zj7zfrq12wPBx/cse7XbDc/zsCYqNJGXteWy235BXhniOOb+++/fKqe8CQ1YsmwlV3yFKfM7JKnQtqJMzj9qAKVRljCwqIRm8ftr+fUDx+AZQTuFVRrja+LaNOPH/5mJ978OxIX0JoYJpx2HTz1xYj1jJw0lr9KkqePNZ5fw3pJPCHWCK2a8imcDhp/Si9/+ZSWxSiAmQzLWrKutKtQExQVvqElBQZsSfji4LycfuwcN6RqGXvBHPnr9KjB1uFw5U674B9067IfTWTSOd5e+T4THjJdfpKqqSjVv3lw+XVWxyQZGolm6aCFXjhujvrGRZVp5xAkfJxFihSjUWCnFJOqQqCWRKphykWqCZI6RA3oy+dQ+IFJ4e52vuWT8KSxa8AilHMXNl76K0VVUe225+9EXyHgB2mkuHXAoXqKOn/z8VJpn5nDVg7PBlG4OGhUovzAodstVtS6kWatS7vpbgOdVseLNS3Aqi5MKdDLHT26r5PvDH2KfNvuhlcP4hpJYN3p61dVNX2l4xhlnyKafyVd8E9gOYcDqmmr1+yfnyDnH9cNk8yjtkXRZ5r+4lAMPPoQIIeFg0QurMWSxJmTIKW14a/7HRMSc8YPjifmA5/66Gp2o4oe3DcDYFCuefon9OvfkxO8NwnoNSMJSapqTz6xm2Ilppp5+DHkthRrWIiDolOBL05rOMKX4+4zB9D56X2JtIa9QWohNBlEOa1uR1wHGaXxRxJrGGOCzsDJ2xZFlLVNJaWECzjzuWJwyrFz1JD+64mgSYRZDlpMv+DvVXqFGMynw/UEH0KVDmva9y+h2eC/ef3kFRIo/zXuRROwRx6X89ol3qTMRl57ci/7HtABJQdqiIkt5XQeyQW1julBrTWRjnJEtShQhGVvQGRp8h++VEsY5ehy+H6IF38Ys/PubTPvFB/Ta42CCfJ5MHOOCJLe+8Nx2TUT/xmfGtUsHEhNglEfgV5FXkI5gRX3T+0lUK3uVleMlDX/45UgO690OlbbkKSVhQfuWf7ywjqWLPyIVhIy9/QnKNdw/+ThEysgnGgojB5QDF/DcU4upjcq4bfbCJgygiH57As0UDB+4F9/9blfEZEA3Y/rNL9O+7aGUewEujqgB7p/zGB+EbqcSf6eNrWxIejgsRqeoD0twfkBOp4BVTbnvl6vyirT44uF0KTWJlsSmIMkJlcATi3UfoiWkqkFBWCBkRIx4EXnPofP7gsqj8KnKrCGn2hC61U0KixIuxKokgqImsw7r9iR27dFSh5MKrOpCYJoR5hqIdQLVooJcMg1hPf9RUxM/b5VVeBKUtMDmGki5ekTAhAadtsQO/Bj++Kuh+JKnwdfEriWp2NH3h3OL4w1iNtZkvvB+Sps1F8/6aJUFZbEUumK0aBryIbkwo/7jxlb+q1XeormUh9WsXDiWrO+Y/YvnqexWjlEaEb+Afuo6qr12nHLuozR4mvqqXXMc5b8lAz4rENzZnsg3uf4/x2Dtn81KjwIAAAAASUVORK5CYII=';

/* ---------------------------------------------------------------------------------------------
 * Hook: hands the game's internal namespace to Mega Alakazam (window.__MEGA_NS).
 *
 * boot.js inserts bundle/app.<hash>.js as an ordinary <script async=false>. Before that tag reaches
 * the page we point it at a copy of the same bundle with one expression added where the game
 * registers its App module:   ...,a.App={refresh:...}  ->  ...,(window.__MEGA_NS=a),a.App={refresh:...}
 * The namespace name is read from the code, never assumed. Anything unexpected -> the original
 * tag is left untouched and Mega Alakazam runs read-only.
 * ------------------------------------------------------------------------------------------- */
const Hook = (() => {
  // the stand-alone probe (0.1) may also be installed: one hook is enough
  if (window.__MEGA_HOOK) return { report: window.__MEGA_HOOK };
  const BUNDLE = /\/bundle\/app\.[\w]+\.js(?:[?#]|$)/;
  const report = (window.__MEGA_HOOK = { ok: false, by: 'mega ' + VERSION, reason: 'waiting for the game bundle', at: Date.now() });
  let tried = false;

  function patchedUrl(url) {
    const t0 = performance.now();
    // synchronous so the tag carries its final address before insertion (keeps script order);
    // boot.js preloads the bundle, so this is normally served from cache
    const x = new XMLHttpRequest();
    x.open('GET', url, false);
    x.send();
    if (x.status !== 200 || !x.responseText) throw new Error('download failed (' + x.status + ')');
    const src = x.responseText;
    const sites = [...src.matchAll(/([,;{(])([A-Za-z_$][\w$]{0,3})\.App=\{refresh:/g)];
    if (sites.length !== 1) throw new Error('expected one App site, found ' + sites.length);
    const m = sites[0], ns = m[2];
    if (!new RegExp('(?:^|[^\\w$.])' + ns.replace(/\$/g, '\\$') + '\\.POKEDEX=\\[').test(src)) throw new Error('namespace "' + ns + '" does not hold POKEDEX');
    const out = src.slice(0, m.index + 1) + '(window.__MEGA_NS=' + ns + '),' + src.slice(m.index + 1);
    new Function(out); // compile only
    Object.assign(report, { ns, bytes: src.length, ms: Math.round(performance.now() - t0) });
    return URL.createObjectURL(new Blob([out], { type: 'text/javascript' }));
  }

  function intercept(node) {
    try {
      if (tried || !(node instanceof HTMLScriptElement) || !BUNDLE.test(node.src || '')) return;
      tried = true;
      const original = node.src;
      report.bundle = original.split('/').pop();
      report.bundleUrl = original;
      node.src = patchedUrl(original);
      report.reason = 'patched copy inserted';
      node.addEventListener('error', () => { report.reason = 'patched copy failed to load - original used'; node.src = original; }, { once: true });
    } catch (e) {
      report.reason = 'left untouched: ' + ((e && e.message) || e);
    }
  }

  // started too late (Tampermonkey injected after boot.js had already added the bundle): the hand-over can't
  // happen on this load, so reload once - at most twice in 3 minutes, so it can never loop. Seen twice on
  // 2026-11-18: Mega silently didn't appear until a manual reload.
  const RK = 'mega-hook-reload';
  const retry = (why) => {
    let r = { n: 0, at: 0 }; try { r = JSON.parse(sessionStorage.getItem(RK) || '{"n":0,"at":0}'); } catch (__e) { __h('10-hook:56', __e); }
    if (Date.now() - r.at > 3 * 60_000) r = { n: 0, at: Date.now() };
    if (r.n >= 2) { report.reason = 'missed the game bundle (' + why + ') - reload the page'; return; }
    r.n++; try { sessionStorage.setItem(RK, JSON.stringify(r)); } catch (__e) { __h('10-hook:59', __e); }
    report.reason = 'missed the game bundle (' + why + ') - reloading once';
    setTimeout(() => location.reload(), 1500);
  };
  try { if ([...document.scripts].some((x) => BUNDLE.test(x.src || ''))) setTimeout(() => { if (!window.__MEGA_NS && !tried) retry('it was already loaded'); }, 4000); } catch (__e) { __h('10-hook:63', __e); }
  for (const name of ['appendChild', 'insertBefore']) {
    const real = Node.prototype[name];
    Node.prototype[name] = function (node, ...rest) { intercept(node); return real.call(this, node, ...rest); };
  }
  // confirm the hand-over once the game is up
  const started = Date.now();
  const watch = setInterval(() => {
    let up = false;
    try { const G = window.__MEGA_NS; up = !!(G && G.POKEDEX && G.CONFIG); } catch (__e) { __h('10-hook:72', __e); }
    if (up) { clearInterval(watch); Object.assign(report, { ok: true, reason: 'engine available' }); try { sessionStorage.removeItem(RK); } catch (__e) { __h('10-hook:73', __e); } }
    else if (!tried && Date.now() - started > 20_000 && [...document.scripts].some((x) => BUNDLE.test(x.src || ''))) { clearInterval(watch); retry('never saw it load'); }
    else if (Date.now() - started > 60_000) { clearInterval(watch); if (!report.ok && /^patched/.test(report.reason)) report.reason = 'patched copy loaded but the engine never appeared'; }
  }, 500);
  return { report };
})();

/* ---------------------------------------------------------------------------------------------
 * Engine: the only place that touches the game's namespace.
 *
 * Every function Mega Alakazam relies on is listed in REQUIRED. On start-up (and after every game
 * update) each one is checked, so a renamed or removed function shows up as a named problem on the
 * Engine screen instead of a silent wrong answer somewhere else.
 *
 * FORBIDDEN lists functions that must never be called (Jimmy's clock rule, irreversible actions).
 * call() refuses them even if some future code asks.
 * ------------------------------------------------------------------------------------------- */
const Engine = (() => {
  const REQUIRED = [
    'Game.S', 'Game.allMons', 'Game.ownedMons', 'Game.underMons', 'Game.getMon', 'Game.owns', 'Game.inDex', 'Game.dexState',
    'Game.levelCap', 'Game.capFor', 'Game.tierOf', 'Game.statsOf', 'Game.maxHp', 'Game.rankOf',
    'Game.currentRegion', 'Game.regionDone', 'Game.isLegend', 'STORY.REGIONS',
    'Underground.unlocked', 'Underground.perDay', 'Underground.left', 'Underground.slotsMax', 'Underground.slots', 'Underground.best',
    'CandyRun.unlocked', 'CandyRun.playedToday', 'CandyRun.why',
    'Tower.unlocked', 'Tower.left', 'Tower.weekEnds',
    'WorldBoss.state', 'WorldBoss.open', 'WorldBoss.catchable', 'WorldBoss.caught',
    'Raids.unlocked', 'Raids.ready', 'Raids.revealed',
    'LegendZones.ZONES', 'LegendZones.knobs', 'LegendZones.state', 'LegendZones.progress', 'LegendZones.whenText',
    'Adventure.startZone', 'Adventure.leaveZone', 'Adventure.loopKey', 'Adventure.effectiveness', 'Adventure.rankAura', 'Game.zoneTeam', 'Game.save', 'Game.curHp', 'Game.DEX', 'Game.bestMoveAgainst', 'Game.learnOf', 'STATUS.effectOf', 'Adventure.setChapter', 'Adventure.isLooping', 'Adventure.toggleLoop', 'STORY.bandOf', 'STORY.regionOf', 'STORY.CHAPTERS', 'Game.levelXp', 'Game.capFor', 'Game.teamMons', 'Game.setBuddy', 'Game.activeBuffs', 'Game.useBuffBerry', 'Game.itemCount', 'Adventure.zonePool', 'Underground.send', 'Underground.collect', 'Underground.progress', 'Underground.simulate', 'Underground.themeOf', 'Underground.starts', 'Underground.why', 'EVOLUTIONS', 'Game.inDex', 'WEATHER.current', 'WEATHER.hours', 'DAYTIME.phase', 'DAYTIME.PHASES', 'STORY.staticLevel', 'Game.eggReady', 'Game.hatchEgg', 'Game.pensionHasDitto', 'Game.toPension', 'Game.fromPension', 'Adventure.startTower', 'Tower.weekKey', 'Tower.run', 'CandyRun.why', 'CandyRun.loadDay', 'Adventure.startRaid', 'Raids.drawn', 'Raids.lane', 'Raids.reroll', 'Raids.canReroll', 'Raids.setPick', 'Raids.bots', 'Raids.teamKey',
    'POKEDEX', 'CONFIG', 'App.refresh',
    'Cloud.trades.species', 'Cloud.trades.offers', 'Cloud.trades.state', 'Cloud.trades.mine', 'Game.tradeBlock', 'Game.tradePreview', 'Game.tierIndex', 'Game.owns', 'Game.canLay', 'Game.tradeFee', 'App.show', 'LegendZones.eliteShown', 'LegendZones.eliteBest', 'LegendZones.eliteNext', 'LegendZones.eliteOpen', 'LegendZones.eliteCan', 'LegendZones.eliteKnobs', 'LegendZones.eliteGem', 'LegendZones.eliteFoe', 'Underground.rankOf', 'UI.monDetail', 'Adventure.winChance', 'Adventure.startLeague', 'Adventure.leaveLeague', 'WorldBoss.attack', 'WorldBoss.autoTeam', 'WorldBoss.left', 'LegendZones.eliteNext', 'STORY.gymTeam', 'LegendZones.leagueOpen', 'LegendZones.leagueBest', 'LegendZones.leagueNext',
  ];
  // Shop buying/selling (Game.buy, Game.sell - items only, checked in the game's code), Day Care and
  // Underground purchases are allowed since 2026-11-15 at Jimmy's request - but only from a goal or
  // button he set up, never on Mega's own initiative (his standing rule: no automatic candy buying).
  const FORBIDDEN = new Set([
    'Game.setClock', 'Game.reset', 'Game.load', 'Game.releaseMon',
    'Adventure.offline', 'Adventure.simulate', 'Adventure.addTime',
    'Cloud.wipe', 'Cloud.signOut', 'DAYTIME.force', 'WEATHER.force', 'DAYTIME.forceSeason',
    'CandyRun.addMs', 'CandyRun.ignoreLock', 'Tower.addMs', 'Tower.ignoreLock', 'Tower.testGift', 'Tower.testBoard', 'Tower.catchUp', 'Raids.testDraw', 'Raids.testBoard', 'Raids.testNpc',
    // trades: Mega only reads the board, Jimmy accepts / posts himself
    'Cloud.trades.accept', 'Cloud.trades.create', 'Cloud.trades.close',
    // gems: Jimmy decides (rank-up resets a Pokémon to Lv 5; recycling destroys gems)
    'Underground.rankUp', 'Underground.recycleGems', 'Underground.buyGem',
  ]);

  const ns = () => window.__MEGA_NS || null;
  const ready = () => { const G = ns(); try { return !!(G && Array.isArray(G.POKEDEX) && G.CONFIG && G.Game && G.Game.S); } catch { return false; } };

  function get(path) {
    let o = ns();
    for (const part of path.split('.')) { if (o == null) return undefined; try { o = o[part]; } catch { return undefined; } }
    return o;
  }
  function call(path, ...args) {
    if (FORBIDDEN.has(path)) throw new Error('Mega Alakazam never calls ' + path);
    const parts = path.split('.'), fn = parts.pop(), owner = get(parts.join('.'));
    const f = owner && owner[fn];
    if (typeof f !== 'function') throw new Error('engine: ' + path + ' is not available in this game build');
    if (!reading) Blackbox.mark('game ' + path);
    return f.apply(owner, args);
  }
  let reading = false;
  // for reads: never throws, returns fallback on any problem
  function read(path, fallback, ...args) {
    reading = true;
    try { const v = typeof get(path) === 'function' ? call(path, ...args) : get(path); return v === undefined ? fallback : v; } catch { return fallback; } finally { reading = false; }
  }
  function audit() {
    const missing = REQUIRED.filter((p) => get(p) === undefined);
    return { ready: ready(), missing, hook: window.__MEGA_HOOK || null };
  }
  const sprite = (id) => (window.CDN || 'https://pokecatch-online.pages.dev/') + 'assets/pokemon/' + id + '.png';
  // The wild Pokémon one route stop can spawn, the way the game builds it: zonePool(stop, chapter, true)
  // (passing only the areas array returns the whole chapter's table, which is wrong per stop).
  // Normalised to {id, pct (share among the active ones; for an inactive one, its share once active), on (active right now), when, min, max}.
  function pool(stop, ch) {
    // a stop with 0 wild fights (the League rooms) lists Pokémon that can never be met there
    if (!stop || stop.wild === 0) return [];
    try { if (get('STORY.CHAPTERS')?.[ch]?.league) return []; } catch (__e) { __h('20-engine:73', __e); } // nothing is caught in the League
    let raw = [];
    try { raw = get('Adventure').zonePool(stop, ch, true) || []; } catch { raw = []; }
    // Entry by entry, the game uses one of two shapes: Pokémon you can meet right now come with a weight
    // {w} (or {w, off} when switched off), and time / weather ones that aren't active come as a summary
    // {pct, on:false, when}. Both end up as {pct, on}: pct = its share (if active), on = can appear now.
    const tot = raw.filter((x) => x.w != null && !x.off && x.on !== false).reduce((t, x) => t + (x.w || 0), 0) || 1;
    return raw.map((x) => {
      const has = x.w != null, on = !x.off && x.on !== false;
      const pct = has ? (x.w || 0) / (on ? tot : tot + (x.w || 0)) : +x.pct || 0;
      return { id: x.id, pct, w: has ? x.w || 0 : 0, on, when: x.when || null, min: x.min, max: x.max };
    });
  }
  return { ns, ready, get, call, read, audit, sprite, pool, REQUIRED, FORBIDDEN };
})();

/* ---------------------------------------------------------------------------------------------
 * World: one read-only snapshot of the game, rebuilt each tick. Every screen and (later) every goal
 * reads from here, so they can never disagree about what you own, what is running, or what is left.
 * Everything comes from the game's own functions; nothing here re-derives a rule.
 * ------------------------------------------------------------------------------------------- */
const World = (() => {
  const E = Engine;
  let last = null;

  const regionKey = (r) => (r && typeof r === 'object' ? r.key : r) || null;

  function regions() {
    const all = E.read('STORY.REGIONS', []) || [];
    // "beaten" comes from regionDone(key). completedRegions() is narrower: it listed only Kanto and
    // Johto for a save that has beaten Hoenn and Sinnoh too, so it is not used for this.
    const cur = regionKey(E.read('Game.currentRegion', null));
    const done = new Set(all.filter((r) => r && r.key && E.read('Game.regionDone', false, r.key)).map((r) => r.key));
    return all.filter((r) => r && r.key).map((r) => ({
      key: r.key, name: r.name || r.key, dex: Array.isArray(r.dex) ? r.dex : null,
      done: done.has(r.key), current: r.key === cur, open: done.has(r.key) || r.key === cur,
    }));
  }

  // what is holding the battle screen right now (only one thing can)
  function screenHolder(S) {
    const a = S.adv || {};
    if (a.event?.raid) return { kind: 'raid', label: RaidCount.label(a.event) + ' run' };
    if (S.candy?.run) return { kind: 'candy', label: 'Candy Factory run' };
    if (S.tower?.run || a.tower != null) return { kind: 'tower', label: 'Battle Tower run' };
    if (a.league) return { kind: 'league', label: 'League run' };
    if (a.zone) return { kind: 'zone', id: a.zone.foe ?? a.zone.id, label: 'Legendary zone' };
    return { kind: 'chapter', ch: a.chapter, label: 'Chapter' };
  }

  function dailies() {
    const ugSlots = E.read('Underground.slots', []) || [];
    return {
      underground: E.read('Underground.unlocked', false) && {
        perDay: E.read('Underground.perDay', null), left: E.read('Underground.left', null),
        slotsMax: E.read('Underground.slotsMax', null), running: ugSlots.length,
        finished: ugSlots.filter((s) => s && +s.end > 0 && Date.now() > +s.end).length,
        nextBack: ugSlots.map((s) => +s.end).filter((t) => t > Date.now()).sort((a, b) => a - b)[0] || null,
        best: E.read('Underground.best', null), dayEnds: E.read('Underground.dayEnds', null),
      },
      candy: E.read('CandyRun.unlocked', false) && { played: E.read('CandyRun.playedToday', null), why: E.read('CandyRun.why', null), best: E.read('CandyRun.best', null) },
      tower: E.read('Tower.unlocked', false) && { left: E.read('Tower.left', null), weekEnds: E.read('Tower.weekEnds', null) },
      worldBoss: { open: E.read('WorldBoss.open', false), catchable: E.read('WorldBoss.catchable', false), caught: E.read('WorldBoss.caught', false), state: E.read('WorldBoss.state', null) },
      raid: E.read('Raids.unlocked', false) && { ready: E.read('Raids.ready', null), revealed: E.read('Raids.revealed', null) },
    };
  }

  function build() {
    if (!E.ready()) return (last = { ok: false, at: Date.now(), audit: E.audit() });
    const S = E.get('Game.S');
    const dexList = E.get('POKEDEX') || [];
    const byId = new Map(dexList.map((p) => [p.id, p]));
    const w = {
      ok: true, at: Date.now(), audit: E.audit(),
      S,
      cap: E.read('Game.levelCap', null),
      region: regionKey(E.read('Game.currentRegion', null)),
      regions: regions(),
      roster: E.read('Game.ownedMons', []) || [],
      away: E.read('Game.underMons', []) || [],
      screen: screenHolder(S),
      inBattle: !!S.adv?.battle,
      dailies: dailies(),
      species: byId,
    };
    last = w;
    return w;
  }

  // ownership, straight from the game
  const dex = {
    owns: (id) => !!E.read('Game.owns', false, +id),
    registered: (id) => !!E.read('Game.inDex', false, +id),
    state: (id) => E.read('Game.dexState', null, +id),
    name: (id) => (last?.species?.get(+id)?.name) || ('#' + id),
  };

  // species in an open region you have not registered yet
  function missing(w = last) {
    if (!w?.ok) return [];
    const out = [];
    for (const r of w.regions) {
      if (!r.open || !r.dex) continue;
      for (let id = r.dex[0]; id <= r.dex[1]; id++) {
        if (!w.species.has(id)) continue;
        if (!dex.registered(id)) out.push({ id, region: r.key, state: dex.state(id), legend: !!E.read('Game.isLegend', false, id) });
      }
    }
    return out;
  }

  return { build, get last() { return last; }, dex, missing };
})();

/* ---------------------------------------------------------------------------------------------
 * Sim: legendary-zone fight simulator.
 *
 * The fight rules are ported from Alakazam 4.x (checked against the game's battle code at the
 * time), but every NUMBER now comes from the game itself, so a game update can't make it drift:
 *   stats / HP ........ Game.statsOf, Game.maxHp   (includes shiny, rank, tastes, HP_BOOST)
 *   types ............. Game.DEX[id].types         (alternate forms included, e.g. 48701)
 *   move choice ....... Game.bestMoveAgainst        (what the game's AI actually picks)
 *   type matchups ..... Adventure.effectiveness
 *   power / accuracy .. Game.movePower, Game.moveAcc
 *   status ............ STATUS.effectOf / capOf / canGet
 *   zone .............. LegendZones.get(id): hp, power, weather, burst
 *   aura .............. Adventure.rankAura
 *   constants ......... CONFIG (crit, enemy damage, LEVEL_GAP, LEGEND_ZONE, BOSS_STATUS, ...)
 * New vs 4.x: MOVE_RECHARGE (Hyper Beam & co. skip the next action) and MULTI_HIT.
 * Every prediction is meant to be held against Recorder data (see Analyse).
 * ------------------------------------------------------------------------------------------- */
const Sim = (() => {
  const E = Engine;
  const G = () => E.ns();
  const C = () => G().CONFIG;
  const Gm = () => G().Game;

  // ---- data adapter: the game's own functions -----------------------------------------------
  const dex = (id) => Gm().DEX?.[id] || (G().POKEDEX || []).find((p) => p.id === +id) || null;
  const typesOf = (m) => dex(m.id)?.types || ['normal'];
  // the game allows one Pokémon per Pokédex number on a team: forms share it (Giratina 487 / 48701)
  const species = (m) => dex(m.id ?? m)?.num ?? (m.id ?? m);
  const dupFree = (team) => new Set(team.map(species)).size === team.length;
  const statsOf = (m) => Gm().statsOf(m);
  const maxHp = (m) => Gm().maxHp(m);
  const move = (k) => G().MOVES?.[k] || null;
  const power = (k) => Gm().movePower(k) || 0;
  const acc = (k) => Gm().moveAcc(k) ?? 100;
  const learn = (m) => Gm().learnOf(m) || [];
  const eff = (type, types) => G().Adventure.effectiveness(type, types);
  const effectOf = (k) => G().STATUS.effectOf(k);
  const capOf = (k) => G().STATUS.capOf(k);
  // v0.5.13: every sleep / freeze / paralysis a Pokémon gets in a battle makes the next one less likely, on both
  // sides - the game's STATUS_RESIST: chance x max(FLOOR, STEP ^ times it already got one this battle)
  const srMul = (u, st) => { const R = C().STATUS_RESIST; return R && (R.ON || []).includes(st) ? Math.max(+R.FLOOR || 0.25, (+R.STEP || 0.6) ** (u.sr || 0)) : 1; };
  const srHit = (u, st) => { const R = C().STATUS_RESIST; if (R && (R.ON || []).includes(st)) u.sr = (u.sr || 0) + 1; };
  const isNight = () => G().DAYTIME?.phase?.()?.key === 'night';
  // the game's gym step as it plays right now: a step with atNight (N: Zekrom for Reshiram; Watson's gym: Iris)
  // takes that version when the run is built at night. A run already under way keeps the version it rolled.
  const gymNow = (step, ch = null) => {
    if (!step) return step;
    try {
      const adv = G().S?.adv, live = (adv?.nodes || []).find((n) => n.type === 'gym' && n.gym && (n.ch == null ? +adv.chapter === +ch : +n.ch === +ch) && (n.gym.name === step.name));
      if (live && ch != null) return live.gym;
    } catch (__e) { __h('35-sim:51', __e); }
    return step.atNight && isNight() ? { ...step, ...step.atNight } : step;
  };
  const bestKey = (att, def) => { try { return Gm().bestMoveAgainst(att, typesOf(def))?.key || 'struggle'; } catch { return 'struggle'; } };
  const blacklisted = (k) => (C().MOVE_BLACKLIST || []).includes(k);
  const recharges = (k) => (C().MOVE_RECHARGE || []).includes(k);
  // the game's canGet for sim units (unit carries id + status), plus the boss's sleep cooldown
  const canGet = (u, st) => {
    if (st === 'confusion') return !u.confused;
    if (u.status) return false;
    if ((st === 'sleep' || st === 'freeze') && u.sleepCd > 0) return false;
    try { return !!G().STATUS.canGet({ id: u.id, status: null }, st); } catch { return true; }
  };

  function mulberry(seed) {
    return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  // multi-hit moves: a fixed count, a list of per-hit powers (Triple Kick), or "2-5"
  // The share of the move's power each hit carries. The game's movePower for a multi-hit move is already the
  // TOTAL (Dual Chop 80 = 2 x 40, Bullet Seed 77.5 = 25 x the average 3.1 hits; Game.movePower), and each hit
  // really uses the move's own power (Game.hitPowers). Until 2.10.19 every hit counted at the total: two-hit
  // moves did double, 2-5 hit moves about triple.
  function hitsOf(k, rnd) {
    const v = (C().MULTI_HIT || {})[k];
    if (v == null) return [1];
    const tot = power(k) || 1, raw = +move(k)?.power || 0;
    if (typeof v === 'number') return Array(v).fill(raw ? raw / tot : 1 / v);
    if (Array.isArray(v)) return v.map((x) => x / tot);
    // "2-5": 2 below 35%, 3 below 70%, 4 below 85%, else 5 (the game's MULTI_HIT_ODDS walk)
    const odds = C().MULTI_HIT_ODDS || [0.35, 0.35, 0.15, 0.15], avg = odds.reduce((a, o, i) => a + o * (i + 2), 0) || 3.1;
    let r = rnd(), n = 2;
    for (let i = 0; i < odds.length && (r -= odds[i]) > 0; i++) n = i + 3;
    return Array(n).fill(raw ? raw / tot : 1 / avg);
  }

  // everything about `att` hitting `def` with move k except the dice
  function attack(att, def, k, wx) {
    const mv = move(k);
    if (k === 'struggle' || !mv) return { k, base: 0, acc: 100, phys: true, type: 'normal', fx: null, recharge: false };
    const A = statsOf(att), D = statsOf(def), phys = mv.cat === 'phys';
    const maxL = C().MAX_LEVEL || 100, lv = Math.min(att.level, maxL);
    const gap = (C().LEVEL_GAP || 1.06) ** (att.level - def.level);
    const stab = typesOf(att).includes(mv.type) ? 1.5 : 1;
    const w = (wx?.[mv.type] ?? 1) * (isNight() ? C().NIGHT_DAMAGE?.[mv.type] ?? 1 : 1);
    const base = (((2 * lv) / 5 + 2) * power(k) * (phys ? A.atk : A.spa) / Math.max(1, phys ? D.def : D.spd) / 50 + 2) * stab * eff(mv.type, typesOf(def)) * gap * w;
    const e = effectOf(k);
    return { k, base, acc: acc(k), phys, type: mv.type, fx: e ? [e.status, Math.min(e.chance, capOf(k))] : null, recharge: recharges(k), multi: (C().MULTI_HIT || {})[k] != null };
  }

  // the status move a Pokémon would use (the last one learned that can land)
  function statusMove(me, foe) {
    let sm = null;
    for (const [lv, k] of learn(me)) {
      if (lv > me.level || power(k) > 0) continue;
      const e = effectOf(k), mv = move(k);
      if (!e || !mv || eff(mv.type, typesOf(foe)) === 0) continue;
      if (!canGet({ id: foe.id, status: null }, e.status)) continue;
      sm = { k, st: e.status, chance: Math.min(mv.acc || e.chance, capOf(k)) };
    }
    return sm;
  }

  // the boss's counter move when the zone doesn't name one: its weakest damaging move that
  // isn't its best one, preferring off-type moves
  function counterKey(boss, def, named) {
    if (named && move(named)) return named;
    const best = bestKey(boss, def), dt = typesOf(def), own = typesOf(boss);
    const ks = learn(boss).filter(([lv, k]) => lv <= boss.level && !blacklisted(k) && move(k) && power(k) > 0 && k !== best && eff(move(k).type, dt) !== 0).map(([, k]) => k);
    const off = ks.filter((k) => !own.includes(move(k).type));
    return (off.length ? off : ks).sort((a, b) => power(a) - power(b))[0] || best;
  }

  // zone settings straight from the game
  // the zone's settings; with an elite tier, the game's elite settings for that tier (eliteKnobs for
  // HP / power, Lv MAX_LEVEL, this week's form, ELITE.HURT for poison / burn on it, ELITE.RESIST =
  // how much less often your status moves land on it)
  // a roaming legendary (Tornadus, Raikou...): no zone - the game fights it as a wild Pokémon at
  // ROAMING.MIN_LEVEL with LEGEND_ZONE.ROAM_HP / ROAM_POWER, in the weather it brings (ROAMING.WEATHER),
  // without the zone aura (the old helper's rules)
  function roamZone(foeId) {
    const c = C(), R = c.ROAMING || {}, L = c.LEGEND_ZONE || {};
    if (!(R.GROUPS || []).some((g) => g.ids.includes(+foeId))) return null;
    let lv = null; try { lv = +G().Roaming.level() || null; } catch (__e) { __h('35-sim:134', __e); }
    return { id: +foeId, foe: +foeId, hp: L.ROAM_HP ?? 4, power: L.ROAM_POWER ?? 0.6, weather: (R.WEATHER || {})[foeId] || null, burst: null, counter: null, level: lv || R.MIN_LEVEL || 100, wild: true, roam: true };
  }
  function zoneOf(foeId, tier = 0) {
    const LZ = G().LegendZones, z = LZ.get(foeId);
    if (!z) return roamZone(foeId);
    // weekly forms (Deoxys): fight this week's form with its own stats and strength
    let form = null; if (!tier && Array.isArray(z.forms)) { try { form = +LZ.foe(z) || null; } catch (__e) { __h('35-sim:141', __e); } }
    const fk = form && form !== foeId ? (z.formKnobs || {})[form] : null;
    const base = { id: foeId, foe: fk ? form : foeId, hp: fk?.hp ?? z.hp, power: fk?.power ?? z.power, weather: z.weather || null, burst: z.burst || null, counter: z.counter || null, level: z.level || 100, static: true, wb: !!z.wb };
    // the strength the game really used the last time you fought it (Calib keeps it from the Recorder);
    // not for a new form - those fights were against a different form
    let obs = null; if (!fk) { try { obs = Calib.observed(foeId, tier); } catch (__e) { __h('35-sim:146', __e); } }
    if (!tier) return obs ? { ...base, hp: obs.hp, power: obs.power, observed: true } : base;
    const EL = C().ELITE || {};
    let kn = null; try { kn = LZ.eliteKnobs(foeId, null, tier); } catch (__e) { __h('35-sim:149', __e); }
    let foe = foeId; try { foe = LZ.eliteFoe(z) || foeId; } catch (__e) { __h('35-sim:150', __e); }
    return { ...base, foe, hp: obs?.hp ?? kn?.hp ?? base.hp, power: obs?.power ?? kn?.power ?? base.power, observed: !!obs, level: C().MAX_LEVEL || 100, elite: tier, hurt: EL.HURT?.[tier] ?? null, resist: EL.RESIST?.[tier] ?? 1 };
  }

  function setup(team, foeId, zone = zoneOf(foeId)) {
    const c = C(), LZ = c.LEGEND_ZONE || {}, ED = c.ENEMY_DAMAGE || {};
    const boss = { uid: 'boss', id: +(zone?.foe ?? foeId), level: zone?.level || 100, shiny: false, foe: true };
    const wx = zone?.weather ? c.WEATHER?.TYPES?.[zone.weather]?.damage || null : null;
    let aura = 1;
    try { aura = (LZ.AURA || 0) && !zone?.wild ? G().Adventure.rankAura(team) || 1 : 1; } catch (__e) { __h('35-sim:159', __e); } // no aura for roamers
    // tuning learned from your real fights (Calib): boss power / HP per kind of fight
    const ctx = zone?.raid ? 'raid' : zone?.elite ? 'elite' : zone?.wb ? 'wb' : 'zone';
    let cal = zone?.cal || null; if (!cal) { try { cal = Calib.get(ctx); } catch (__e) { __h('35-sim:162', __e); } }
    const pk = +(cal?.pk) || 1, hk = +(cal?.hk) || 1;
    const P = (zone?.power ?? 1) * aura * aura * (zone?.wild ? ED.wild ?? 0.85 : ED.static ?? 1) * pk; // roamers hit like wild Pokémon
    const PR = (zone?.power ?? 1) * aura * aura * (ED.static ?? 1) * pk; // rage hits always use 'static'
    const slots = 1 + (c.ENEMY_HP_PER_ALLY ?? 0.7) * ((c.TEAM_SIZE || 6) - 1);
    const bossHp = maxHp({ ...boss, hpMult: slots * (zone?.hp ?? 1) * aura * hk });
    const drainOf = (k) => (c.DRAIN || {})[k] || 0;
    const minDmg = (att, def, k, mult) => { const a = attack(att, def, k, wx); return a.base ? Math.max(1, Math.round(Math.floor(a.base * 0.85) * mult)) : 0; };
    const finishers = (att, def, mult) => learn(att)
      .filter(([lv, k]) => lv <= att.level && !blacklisted(k) && move(k) && power(k) > 0 && !(c.MULTI_HIT || {})[k] && eff(move(k).type, typesOf(def)) !== 0)
      .map(([, k]) => ({ atk: attack(att, def, k, wx), min: minDmg(att, def, k, mult), drain: drainOf(k) }))
      .sort((x, y) => y.atk.acc - x.atk.acc || power(y.atk.k) - power(x.atk.k));
    const burstKey = zone?.burst && move(zone.burst) ? zone.burst : null;
    const allies = team.map((m) => {
      const best = bestKey(m, boss), bh = bestKey(boss, m), A = statsOf(m);
      return {
        uid: m.uid, id: m.id, name: dex(m.id)?.name || '#' + m.id, types: typesOf(m), spe: A.spe, hp: maxHp(m),
        atk: attack(m, boss, best, wx), atkDrain: drainOf(best), sm: statusMove(m, boss), fin: finishers(m, boss, 1),
        bossHit: attack(boss, m, bh, wx), bossDrain: drainOf(bh), bossFin: finishers(boss, m, P), bossSm: statusMove(boss, m),
        aim: Math.max(0, power(bh)) * eff(move(bh)?.type || 'normal', typesOf(m)),
        counter: attack(boss, m, counterKey(boss, m, zone?.counter), wx),
        burst: attack(boss, m, burstKey || bh, wx),
        selfHit: Math.max(1, Math.floor(((2 * m.level) / 5 + 2) * 40 * A.atk / Math.max(1, A.def) / 50 + 2)),
      };
    });
    const BS = statsOf(boss);
    return { allies, power: P, ragePower: PR, aura, zone, boss: { id: boss.id, types: typesOf(boss), spe: BS.spe, hp: bossHp, selfHit: Math.max(1, Math.floor((42 * 40 * BS.atk / Math.max(1, BS.def)) / 50 + 2)) } };
  }

  // one fight. trace (optional) gets [bossHp, teamHp, alive, bossStatus, rage] at the start of each round
  function run(st, rnd, trace) {
    const c = C(), LZ = c.LEGEND_ZONE || {}, BSx = c.BOSS_STATUS || {};
    const P = st.power, PR = st.ragePower, crit = c.CRIT_CHANCE ?? 1 / 24, critM = c.CRIT_MULT ?? 1.5;
    const RAGE = LZ.RAGE ?? 8, CNT = LZ.COUNTER ?? 0.3, BURST = LZ.BURST ?? 1;
    const HURT = st.zone?.hurt ?? BSx.HURT ?? 40, RESIST = st.zone?.resist ?? 1, BURN_ATK = BSx.BURN_ATK ?? 0.75, SLEEP_CD = BSx.SLEEP_CD ?? 2;
    const SMC = c.STATUS_MOVE_CHANCE ?? 0.3, PARA = c.FULL_PARA_CHANCE ?? 0.25, THAW = c.THAW_CHANCE ?? 0.2, CONF = c.CONFUSION_SELF_HIT ?? 0.33;
    const STALL = c.STALL_ROUNDS ?? 8, MAXR = c.MAX_ROUNDS ?? 200;
    // game 0.5.10 status rules (when its config has them): a status lowers one stat (burn Atk, poison Sp. Atk,
    // sleep Def, freeze Sp. Def, x0.75 each), burn / poison wear off after DOT_TURNS ticks (4 on a boss, 5 on yours),
    // paralysis after PARA_TURNS, and a boss stays asleep / frozen up to LOCK_MAX turns, then can't be again for LOCK_CD
    const FX = c.STATUS_FX || null, NEW = !!FX && BSx.LOCK_MAX != null;
    const STAT = FX?.STAT || {}, DOT_B = NEW ? +BSx.DOT_TURNS || 0 : 0, DOT_A = NEW ? +FX.DOT_TURNS || 0 : 0, PARA_T = NEW ? +FX.PARA_TURNS || 0 : 0;
    const LOCK_MAX = +BSx.LOCK_MAX || 0, LOCK_CD = BSx.LOCK_CD ?? SLEEP_CD;
    const sm = (u, stat) => { const e = STAT[u.status]; return e && e[0] === stat ? +e[1] || 1 : 1; };
    // damage multiplier from both sides' status (old rules: burn halves your physical hits, BURN_ATK on the boss's)
    const fxMult = (att, def, atk) => {
      if (!NEW) return att.status === 'burn' && atk.phys ? (att.boss ? BURN_ATK : 0.5) : 1;
      return (atk.phys ? sm(att, 'atk') : sm(att, 'spa')) / (atk.phys ? sm(def, 'def') : sm(def, 'spd'));
    };
    const A = st.allies.map((a, i) => ({ ...a, cur: Math.max(1, Math.min(a.hp, st.startHp?.[i] ?? a.hp)), status: null, sleep: 0, confused: 0, recharge: false }));
    const B = { ...st.boss, cur: st.boss.hp, status: null, sleep: 0, confused: 0, rage: 0, sleepCd: 0, boss: true, recharge: false };
    const alive = () => A.filter((a) => a.cur > 0);
    // the game's miss rule: after a Pokémon misses, its next attack can't miss (a WeakSet of attackers who just missed)
    const hitOk = (atk, u) => {
      if (u && u.sure) { u.sure = false; return true; }
      if (rnd() * 100 > atk.acc) { if (u) u.sure = true; return false; }
      return true;
    };
    const roll1 = (atk, burnMult, mult, scale = 1, u = null, first = true) => {
      if (first && !hitOk(atk, u)) return 0; // the game checks accuracy once per move, not per hit
      const cr = rnd() < crit ? critM : 1;
      const d = Math.max(1, Math.floor(atk.base * scale * (burnMult || 1) * cr * (0.85 + rnd() * 0.15)));
      return mult === 1 ? d : Math.max(1, Math.round(d * mult));
    };
    const roll = (atk, burnMult, mult, u = null) => {
      if (!atk.base) return 0;
      if (!atk.multi) return roll1(atk, burnMult, mult, 1, u);
      let sum = 0, n = 0;
      for (const s of hitsOf(atk.k, rnd)) { const d = roll1(atk, burnMult, mult, s, u, n++ === 0); if (!d && sum === 0) return 0; sum += d; }
      return sum;
    };
    const inflict = (u, s) => {
      if (s === 'tri') s = ['burn', 'paralysis', 'freeze'][Math.floor(rnd() * 3)];
      if (!canGet(u, s)) return false;
      if (s === 'confusion') u.confused = 2 + Math.floor(rnd() * 4);
      else { u.status = s; u.bit = 0; u.lost = 0; if (s === 'sleep') u.sleep = 1 + Math.floor(rnd() * 3); srHit(u, s); }
      return true;
    };
    let calm = 0, rounds = 0;
    const blocked = (u) => {
      if (u.recharge) { u.recharge = false; return true; }
      if (NEW && u.boss && (u.status === 'sleep' || u.status === 'freeze')) {
        const lost = u.lost || 0;
        if (lost < LOCK_MAX && (u.status === 'sleep' ? lost < u.sleep : rnd() >= THAW)) { u.lost = lost + 1; return true; }
        u.status = null; u.sleep = 0; u.lost = 0; u.sleepCd = LOCK_CD + 1; // wakes / thaws and acts this turn
      } else if (u.boss && u.status === 'sleep') { u.status = null; u.sleep = 0; u.sleepCd = SLEEP_CD + 1; return true; }
      if (u.status === 'sleep') { if (u.sleep > 0) { u.sleep--; return true; } u.status = null; }
      else if (u.status === 'freeze') { if (rnd() >= THAW) return true; u.status = null; }
      else if (u.status === 'paralysis' && rnd() < PARA) return true;
      if (u.confused) { if (--u.confused <= 0) u.confused = 0; else if (rnd() < CONF) { u.cur -= u.selfHit; calm = 0; return true; } }
      return false;
    };
    const tick = (u) => {
      if ((u.status === 'burn' || u.status === 'poison') && u.cur > 0) {
        u.cur -= Math.max(1, Math.floor(u.hp / (u.boss ? HURT : 8))); calm = 0;
        const lim = u.boss ? DOT_B : DOT_A;
        u.bit = (u.bit || 0) + 1; if (lim && u.bit >= lim && u.cur > 0) { u.status = null; u.bit = 0; }
      } else if (u.status === 'paralysis' && PARA_T) { u.bit = (u.bit || 0) + 1; if (u.bit >= PARA_T) { u.status = null; u.bit = 0; } }
    };
    const thaw = (u, atk, dmg) => { if (dmg && u.status === 'freeze' && atk.type === 'fire' && u.cur > 0) u.status = null; };
    for (;;) {
      if (B.cur <= 0) return { ko: true, dealt: 1, rounds };
      if (!alive().length) return { ko: false, dealt: 1 - B.cur / B.hp, rounds };
      rounds++;
      if (trace) trace.push([Math.max(0, B.cur), A.reduce((t, a) => t + Math.max(0, a.cur), 0), alive().length, B.status, B.rage]);
      if (B.sleepCd > 0) B.sleepCd--;
      if (++calm > STALL || rounds > MAXR) {
        const mine = A.reduce((s, a) => s + Math.max(0, a.cur), 0) / A.reduce((s, a) => s + a.hp, 0);
        const theirs = Math.max(0, B.cur) / B.hp;
        return { ko: mine > theirs, dealt: 1 - theirs, rounds, timeout: true };
      }
      const q = [...alive().map((a) => ({ a, s: a.spe * (a.status === 'paralysis' ? 0.25 : 1), r: rnd() })),
        { a: null, s: B.spe * (B.status === 'paralysis' ? 0.25 : 1), r: rnd() }].sort((x, y) => y.s - x.s || x.r - y.r);
      for (const { a } of q) {
        if (B.cur <= 0 || !alive().length) break;
        if (a) {
          if (a.cur <= 0) continue;
          let dmg = 0;
          if (!blocked(a) && a.cur > 0) {
            const fin = a.fin.find((f) => f.min >= B.cur && f.min > 0);
            if (!fin && a.sm && canGet(B, a.sm.st) && (rnd() < SMC || !a.atk.base)) {
              if (rnd() * 100 < a.sm.chance * RESIST * srMul(B, a.sm.st)) { inflict(B, a.sm.st); calm = 0; }
            } else {
              const atk = fin ? fin.atk : a.atk, drain = fin ? fin.drain : a.atkDrain;
              dmg = roll(atk, fxMult(a, B, atk), 1, a);
              if (atk.recharge) a.recharge = true;
              if (dmg) {
                calm = 0; B.cur -= dmg;
                if (drain && a.cur > 0) a.cur = Math.min(a.hp, a.cur + Math.max(1, Math.ceil(a.hp * drain))); // v0.5.13: share of its own max HP
                thaw(B, atk, dmg);
                if (B.cur > 0 && atk.fx && rnd() * 100 < atk.fx[1] * RESIST * srMul(B, atk.fx[0])) inflict(B, atk.fx[0]);
              }
            }
          }
          tick(a);
          // rage: every landed hit charges it (not while the boss sleeps); below max it counters
          // a random Pokémon, at max it bursts the whole team (measured: ~97% of hits counter)
          if (dmg > 0 && B.cur > 0 && B.status !== 'sleep') {
            B.rage = Math.min(RAGE, B.rage + 1);
            const targets = alive();
            if (targets.length) {
              if (B.rage >= RAGE) { B.rage = 0; for (const t of targets) t.cur -= roll(t.burst, fxMult(B, t, t.burst), PR * BURST, B); }
              else { const t = targets[Math.floor(rnd() * targets.length)]; t.cur -= roll(t.counter, fxMult(B, t, t.counter), PR * CNT, B); }
              calm = 0;
            }
          }
        } else {
          if (!blocked(B) && B.cur > 0) {
            const targets = alive();
            if (targets.length) {
              // the game picks the boss's target at random (checked against 362 recorded hits)
              const t = targets[Math.floor(rnd() * targets.length)];
              const fin = t.bossFin.find((f) => f.min >= t.cur && f.min > 0);
              if (!fin && t.bossSm && canGet(t, t.bossSm.st) && (rnd() < SMC || !t.bossHit.base)) {
                if (rnd() * 100 < t.bossSm.chance * srMul(t, t.bossSm.st)) { inflict(t, t.bossSm.st); calm = 0; }
              } else {
                const atk = fin ? fin.atk : t.bossHit, drain = fin ? fin.drain : t.bossDrain;
                const dmg = roll(atk, fxMult(B, t, atk), P, B);
                if (atk.recharge) B.recharge = true;
                if (dmg) {
                  calm = 0; t.cur -= dmg;
                  if (drain) B.cur = Math.min(B.hp, B.cur + Math.max(1, Math.ceil(B.hp * drain))); // v0.5.13: share of its own max HP
                  thaw(t, atk, dmg);
                  if (t.cur > 0 && atk.fx && rnd() * 100 < atk.fx[1] * srMul(t, atk.fx[0])) inflict(t, atk.fx[0]);
                }
              }
            }
          }
          tick(B);
        }
      }
    }
  }

  function evaluate(team, foeId, runs = 400, seed = 1, st = null, zone = undefined) {
    st = st || setup(team, foeId, zone === undefined ? zoneOf(foeId) : zone);
    let ko = 0, dealt = 0, rounds = 0;
    for (let i = 0; i < runs; i++) { const r = run(st, mulberry(seed * 7919 + i * 104729)); ko += r.ko ? 1 : 0; dealt += r.dealt; rounds += r.rounds; }
    // a faster win scores a little higher (Jimmy 2026-11-20: at 100% every team tied, so the World Boss team kept two
    // status Pokémon that added nothing): worth up to ~5 KO points between a 10-round and a 40-round win
    return { ko: ko / runs, dealt: dealt / runs, rounds: rounds / runs, score: ko / runs + 0.25 * (dealt / runs) + 0.15 / (1 + rounds / runs / 10), aura: st.aura };
  }

  function trace(team, foeId, runs = 400, maxRound = 30) {
    const st = setup(team, foeId);
    const acc = Array.from({ length: maxRound }, () => ({ n: 0, boss: 0, team: 0 }));
    let ko = 0;
    for (let i = 0; i < runs; i++) { const tr = []; const r = run(st, mulberry(7919 + i * 104729), tr); ko += r.ko ? 1 : 0; tr.slice(0, maxRound).forEach((x, k) => { acc[k].n++; acc[k].boss += x[0]; acc[k].team += x[1]; }); }
    return { ko: ko / runs, bossHp: st.boss.hp, teamHp: st.allies.reduce((s, a) => s + a.hp, 0), perRound: acc.map((a, k) => a.n ? { r: k, reach: a.n / runs, boss: a.boss / a.n, team: a.team / a.n } : null).filter(Boolean) };
  }

  // best 6 for a legendary: start from your current zone team and a few strong seeds, then
  // try every slot x every candidate, keep swaps that win more simulated fights
  const yieldCh = new MessageChannel(), yieldQ = [];
  yieldCh.port1.onmessage = () => yieldQ.shift()?.();
  const yieldNow = () => new Promise((r) => { yieldQ.push(r); yieldCh.port2.postMessage(0); });
  // asMax: every Pokémon below the max level is simulated as if it were already at it (moves it
  // would learn included), to show who is worth leveling. Results also say how the same team does today.
  async function search(foeId, { onProgress, pool: poolIn, asMax = false, tier = 0, zone: zoneIn = null } = {}) {
    const L = C().MAX_LEVEL || 100;
    const lift = (m) => (asMax && m.level < L ? { ...m, level: L, realLevel: m.level } : m);
    const all = (poolIn || Gm().allMons() || []).filter((m) => dex(m.id)).map(lift);
    const keyOf = (m) => `${m.id}-${!!m.shiny}`;
    // best copy of each species: higher rank first, then the higher (real) level
    const better = (a, b) => (a.rank || 0) - (b.rank || 0) || (a.realLevel ?? a.level) - (b.realLevel ?? b.level);
    const bestCopy = {};
    for (const m of all) { const k = keyOf(m); if (!bestCopy[k] || better(m, bestCopy[k]) > 0) bestCopy[k] = m; }
    const cands = Object.values(bestCopy);
    const z = zoneIn || zoneOf(foeId, tier);
    // Elite tiers: the game keeps only CONFIG.ELITE.LEGENDS (1) Legendary or Mythical per team and drops the rest
    // (2026-11-21: Mega sent 6 Legendaries to Elite Genesect - only Reshiram fought, alone). Teams obey that here.
    const legCap = tier > 0 || z?.elite ? (+(C().ELITE?.LEGENDS) || 1) : 99;
    const isLeg = (m) => { const d = Gm().DEX?.[m.id] || {}; return !!(d.legendary || d.mythical); };
    const legOk = (t) => t.filter(isLeg).length <= legCap;
    const info = cands.map((m) => { const a = setup([m], foeId, z).allies[0]; return { m, v: (a.atk.base * (a.atk.recharge ? 0.5 : 1) * a.hp) / Math.max(1, a.bossHit.base + a.burst.base * 0.4), sm: a.sm, para: (a.atk.fx && a.atk.fx[0] === 'paralysis') || (a.sm && a.sm.st === 'paralysis') }; });
    const byV = [...info].sort((x, y) => y.v - x.v);
    const statusUsers = byV.filter((x) => x.sm && x.sm.st !== 'paralysis').slice(0, 6);
    const pool = [...new Set([...byV.slice(0, 22), ...statusUsers, ...byV.filter((x) => x.sm).slice(0, 8)].map((x) => x.m))];
    const fill = (start, avoidPara) => { const t = [...start]; for (const x of byV) { if (t.length >= 6) break; if (t.some((y) => species(y) === species(x.m)) || (avoidPara && x.para) || !legOk([...t, x.m])) continue; t.push(x.m); } return t; };
    const cur = (Gm().zoneTeam?.(foeId) || []).map((u) => Gm().getMon(u)).filter(Boolean);
    const starts = [cur.length === 6 && dupFree(cur) && legOk(cur) ? cur.map(lift) : null, fill([], false), fill([], true), ...statusUsers.slice(0, 3).map((x) => fill([x.m], true))].filter(Boolean);
    const total = starts.length * 6 * pool.length;
    let evals = 0, best = null, slice = performance.now();
    const tops = [];
    const cache = new Map();
    const full = (t) => { const k = t.map((m) => m.uid).join(','); let r = cache.get(k); if (!r) { r = evaluate(t, foeId, 200, 1, null, z); cache.set(k, r); } return r; };
    for (const start of starts) {
      const team = start.slice(0, 6); if (team.length < 6) continue;
      let curRes = full(team);
      for (let pass = 0; pass < 4; pass++) {
        let improved = false;
        for (let slot = 0; slot < 6; slot++) {
          let swap = null, res = curRes;
          for (const cnd of pool) {
            if (team.some((t, i) => i !== slot && species(t) === species(cnd)) || team[slot].uid === cnd.uid) continue;
            const trial = team.slice(); trial[slot] = cnd; if (!legOk(trial)) continue; ++evals;
            const quick = evaluate(trial, foeId, 50, 1, null, z);
            if (quick.score >= res.score - 0.12) { const r = full(trial); if (r.score > res.score + 0.005) { res = r; swap = cnd; } }
            if (performance.now() - slice > 50) { onProgress?.(Math.min(0.97, evals / total)); await yieldNow(); slice = performance.now(); }
          }
          if (swap) { team[slot] = swap; curRes = res; improved = true; }
        }
        if (!improved) break;
      }
      if (!best || curRes.score > best.res.score) best = { team: team.slice(), res: curRes };
      tops.push(team.slice());
    }
    // Elite tiers (2.16.0): the game's own engine decides (GameSim) - this model drifted far from the game
    // there. Its picks and the current team are re-scored in a sandboxed copy of the game, then refined.
    // 2.16.2: legendary zones too (tier 0, a zone of its own - not roamers, gyms or World Boss)
    if ((tier > 0 || (z?.static && !z?.wild && !z?.roam && !z?.wb && !zoneIn)) && !asMax && typeof GameSim !== 'undefined') {
      try {
        const g = await GameSim.refine(foeId, tier, [...(cur.length === 6 && dupFree(cur) && legOk(cur) ? [cur] : []), ...tops], byV.map((x) => x.m), { legOk, species, onProgress });
        if (g) {
          const final = { ko: g.final.ko, left: g.final.left, rounds: g.final.n, engine: true };
          const curE = cur.length === 6 && legOk(cur) ? await GameSim.play(foeId, tier, cur.map((m) => m.uid), 60) : null;
          onProgress?.(1);
          return { foeId, tier, team: g.team, final, today: final, toLevel: [], asMax, current: curE ? { ko: curE.ko, engine: true } : null, at: Date.now(), engine: true };
        }
      } catch (e) { try { Log.add(`${tier ? 'Elite' : 'Zone'} sim in the game's engine failed (${e?.message || e}) - using Mega's own model`); } catch (__e) { __h('35-sim:421', __e); } }
    }
    const final = evaluate(best.team, foeId, 1000, 99, null, z);
    const current = cur.length === 6 ? evaluate(legCap < 99 && !legOk(cur) ? cur.filter((m, i, a) => !isLeg(m) || a.filter(isLeg).indexOf(m) < legCap) : cur, foeId, 1000, 99, null, z) : null;
    const toLevel = best.team.filter((m) => m.realLevel != null).map((m) => ({ uid: m.uid, id: m.id, from: m.realLevel, to: m.level }));
    const today = toLevel.length ? evaluate(best.team.map((m) => Gm().getMon(m.uid) || m), foeId, 1000, 99, null, z) : final;
    onProgress?.(1);
    return { foeId, tier, team: best.team, final, today, toLevel, asMax, current, at: Date.now() };
  }

  // ---- training carriers -------------------------------------------------------------------
  // The chapter's wild Pokémon, weighted the way the game spawns them: every route stop's pool
  // (Adventure.zonePool, only entries active right now) x how many wild fights that stop has.
  // The game scales every chapter to its level band (STORY.bandOf: Stark Mountain is Lv 90-99, not the
  // base spawn levels 42-59): route stops climb evenly from the band's low end to its top. Each wild
  // Pokémon gets the level of the stops it spawns at, weighted by how often you meet it there.
  function bandOf(ch) { try { const b = G().STORY.bandOf(ch); return b && b[0] != null && b[1] != null ? b : null; } catch { return null; } }
  function chapterPool(ch) {
    const steps = G().STORY.CHAPTERS[ch]?.steps || [], out = new Map(), band = bandOf(ch);
    const routes = steps.filter((st) => st.kind === 'route' && st.areas?.length);
    routes.forEach((st, i) => {
      const pool = Engine.pool(st, ch);
      const on = pool.filter((p) => p.on !== false), tot = on.reduce((t, p) => t + (p.pct || 0), 0) || 1;
      const stepLv = band ? Math.round(band[0] + (band[1] - band[0]) * (routes.length > 1 ? i / (routes.length - 1) : 1)) : null;
      for (const p of on) {
        const k = p.id, lv = stepLv ?? Math.round(((p.min || 50) + (p.max || p.min || 50)) / 2);
        const w = (p.pct || 0) / tot * (st.wild || 1);
        const o = out.get(k) || { id: k, lvw: 0, w: 0 }; o.w += w; o.lvw += lv * w; out.set(k, o);
      }
    });
    const all = [...out.values()], W = all.reduce((t, x) => t + x.w, 0) || 1;
    return all.map((x) => ({ id: x.id, lv: Math.round(x.lvw / (x.w || 1)), w: x.w / W })).sort((a, b) => b.w - a.w);
  }
  // How well one Pokémon clears a chapter: kills per action against its wild Pokémon (one-hit
  // KOs count fully), with a penalty for the damage it takes while doing it. Same damage math
  // as the legendary simulator.
  function clearScore(m, pool) {
    const ED = C().ENEMY_DAMAGE || {}, me = statsOf(m), myHp = maxHp(m);
    let kill = 0, hurt = 0, oneShot = 0;
    for (const p of pool) {
      const foe = { uid: 'wild', id: p.id, level: p.lv, foe: true };
      const mine = attack(m, foe, bestKey(m, foe));
      const theirs = attack(foe, m, bestKey(foe, m));
      const hp = maxHp(foe), dmg = mine.base * 0.925 * (mine.acc / 100);
      const hits = dmg > 0 ? Math.max(1, Math.ceil(hp / (mine.base * 0.925))) * (2 - Math.min(1, mine.acc / 100)) : 20; // a miss is always followed by a sure hit: p + 2(1-p) tries per hit
      const first = me.spe > statsOf(foe).spe;
      const taken = theirs.base * 0.925 * (ED.wild ?? 0.85) * Math.max(0, hits - (first ? 1 : 0));
      kill += p.w / hits;
      hurt += p.w * Math.min(1, taken / Math.max(1, myHp));
      if (hits <= 1.05) oneShot += p.w;
    }
    return { score: kill - 0.5 * hurt, kill, hurt, oneShot };
  }
  // The old helper's coverage (Jimmy: its picks cleared Dragonspiral first try): how many of each foe this
  // Pokémon knocks out before it faints - its damage x its HP over the foe's damage x the foe's HP, max 50.
  // Unlike a win chance it never tops out at 100%, so it still tells a good team from a great one.
  function coverage(m, foes) {
    return foes.map((f) => {
      const F = { uid: 'cov', id: +f.id, level: +(f.level ?? f.lv) || 50, foe: true };
      const out = attack(m, F, bestKey(m, F)).base || 0, inc = Math.max(1, attack(F, m, bestKey(F, m)).base || 0);
      return Math.min(50, (out * maxHp(m)) / inc / Math.max(1, maxHp(F)));
    });
  }
  // ---- the old helper's gym simulator (Jimmy: its teams beat the last two gyms where Mega's didn't) ----------
  // Plays the game's trainer-battle rules: 1 Pokémon a side (2 for double gyms), the leader sends its team in
  // order, your side switches by itself to the best matchup (Auto Switch; a switch costs that turn), leader
  // Pokémon have HP x GYM_HP_MULT x power x (6/size)^GYM_TEAM_EXP and hit x GYM_DAMAGE x power, the leader
  // aims where its best move hurts most for the HP left, status moves ~30% of turns, burn/poison 1/8 a turn,
  // 200 rounds (or 8 without damage): the side with more HP left (in %) wins. Ported from Alakazam 4.x.
  const num = (k, d) => { const v = C()?.[k]; return typeof v === 'number' ? v : d; };
  function matchScore(me, foe) { // the game's Auto Switch score
    const TP = C()?.TYPE_POWER || { strong: 3, weak: -3, immune: -5, exposed: -2, resists: 2 };
    const ft = typesOf(foe), mt = typesOf(me), k = bestKey(me, foe), mv = move(k);
    const e = mv && power(k) > 0 ? eff(mv.type, ft) : 1;
    const w = Math.max(...ft.map((t) => eff(t, mt)));
    return (e === 0 ? TP.immune : e > 1 ? TP.strong : e < 1 ? TP.weak : 0) + (w > 1 ? TP.exposed : w < 1 ? TP.resists : 0);
  }
  const gymCache = new Map();
  function gymSetup(team, foes, gym) {
    const n = foes.length, size = num('TEAM_SIZE', 6), pw = +gym?.power || 1;
    // a plain trainer on the way (gym.plain = its damage factor): no gym HP boost, ENEMY_DAMAGE.trainer x that factor
    const hpMult = gym?.plain ? 1 : num('GYM_HP_MULT', 1.3) * pw * Math.max(1, size / n) ** num('GYM_TEAM_EXP', 0.7);
    const P = gym?.plain ? (+(C().ENEMY_DAMAGE || {}).trainer || 0.9) * gym.plain : num('GYM_DAMAGE', 1.3) * pw;
    const DR = C()?.DRAIN || {}, drainOf = (k) => DR[k] || 0;
    const fins = (att, def, mult) => learn(att)
      .filter(([lv, k]) => lv <= att.level && !blacklisted(k) && move(k) && power(k) > 0 && eff(move(k).type, typesOf(def)) !== 0)
      .map(([, k]) => { const a = attack(att, def, k); return { atk: a, min: a.base ? Math.max(1, Math.round(Math.floor(a.base * 0.85) * mult)) : 0, drain: drainOf(k) }; })
      .sort((x, y) => y.atk.acc - x.atk.acc || power(y.atk.k) - power(x.atk.k));
    const selfHit = (u) => { const A = statsOf(u); return Math.max(1, Math.floor(((2 * u.level) / 5 + 2) * 40 * A.atk / Math.max(1, A.def) / 50 + 2)); };
    const F = foes.map((f, j) => ({ j, id: f.id, level: f.level, types: typesOf(f), spe: statsOf(f).spe, hp: Math.floor(maxHp(f) * hpMult), selfHit: selfHit(f) }));
    const A = team.map((m) => {
      const key = `${m.uid}|${m.id}|${m.level}|${m.rank || 0}|${(m.ban || []).join('.')}|${foes.map((f) => f.id + ':' + f.level + ':' + (f.rank || 0)).join(',')}|${P}|${hpMult}|${isNight()}`;
      let per = gymCache.get(key);
      if (!per) {
        per = foes.map((f) => {
          const best = bestKey(m, f), fb = bestKey(f, m), fbm = move(fb);
          return {
            atk: attack(m, f, best), atkDrain: drainOf(best), sm: statusMove(m, f), fin: fins(m, f, 1),
            hit: attack(f, m, fb), hitDrain: drainOf(fb), fsm: statusMove(f, m), ffin: fins(f, m, P),
            aim: Math.max(0, power(fb)) * (fbm ? eff(fbm.type, typesOf(m)) : 1), score: matchScore(m, f),
          };
        });
        if (gymCache.size > 4000) gymCache.clear();
        gymCache.set(key, per);
      }
      return { uid: m.uid, id: m.id, types: typesOf(m), spe: statsOf(m).spe, hp: maxHp(m), selfHit: selfHit(m), per };
    });
    return { A, F, P, slots: gym?.double && n >= 2 ? 2 : 1 };
  }
  function gymRun(setup, rnd, start = null) {
    const crit = num('CRIT_CHANCE', 1 / 24), critM = num('CRIT_MULT', 1.5), P = setup.P;
    const SMC = num('STATUS_MOVE_CHANCE', 0.3), PARA = num('FULL_PARA_CHANCE', 0.25), THAW = num('THAW_CHANCE', 0.2), CONF = num('CONFUSION_SELF_HIT', 0.33);
    // start: uid -> HP fraction carried in from the fights before (no heal in between)
    const A = setup.A.map((a, i) => ({ ...a, i, cur: start && start[a.uid] != null ? Math.round(a.hp * start[a.uid]) : a.hp, status: null, sleep: 0, confused: 0, ally: true }));
    const hpOut = () => Object.fromEntries(A.map((a) => [a.uid, Math.max(0, a.cur) / a.hp]));
    const F = setup.F.map((f) => ({ ...f, cur: f.hp, status: null, sleep: 0, confused: 0 }));
    const roll = (atk, burnMult, mult, u) => {
      if (!atk.base) return 0;
      if (u.sure) u.sure = false; else if (rnd() * 100 > atk.acc) { u.sure = true; return 0; }
      const burn = burnMult && atk.phys ? burnMult : 1;
      let sum = 0; // multi-hit moves: each hit its own crit and roll, each rounded (the game's hitPowers / dn)
      for (const sc of atk.multi ? hitsOf(atk.k, rnd) : [1]) {
        const c = rnd() < crit ? critM : 1;
        const d = Math.max(1, Math.floor(atk.base * sc * burn * c * (0.85 + rnd() * 0.15)));
        sum += mult === 1 ? d : Math.max(1, Math.round(d * mult));
      }
      return sum;
    };
    const inflict = (u, st) => {
      if (st === 'tri') st = ['burn', 'paralysis', 'freeze'][Math.floor(rnd() * 3)];
      if (!canGet(u, st)) return;
      if (st === 'confusion') u.confused = 2 + Math.floor(rnd() * 4);
      else { u.status = st; if (st === 'sleep') u.sleep = 1 + Math.floor(rnd() * 3); srHit(u, st); }
    };
    let calm = 0;
    const blocked = (u) => {
      if (u.status === 'sleep') { if (u.sleep > 0) { u.sleep--; return true; } u.status = null; }
      else if (u.status === 'freeze') { if (rnd() >= THAW) return true; u.status = null; }
      else if (u.status === 'paralysis' && rnd() < PARA) return true;
      if (u.confused) { if (--u.confused <= 0) u.confused = 0; else if (rnd() < CONF) { u.cur -= u.selfHit; calm = 0; return true; } }
      return false;
    };
    const tick = (u) => { if ((u.status === 'burn' || u.status === 'poison') && u.cur > 0) { u.cur -= Math.max(1, Math.floor(u.hp / 8)); calm = 0; } };
    const aliveA = () => A.filter((a) => a.cur > 0), aliveF = () => F.filter((f) => f.cur > 0);
    let actA = [], actF = [], queue = [], rounds = 0;
    const refill = () => {
      const front = aliveF().slice(0, Math.min(setup.slots, 2));
      const fresh = (cur, want) => { const out = cur.filter((x) => want.includes(x)); for (const w of want) if (out.length < want.length && !out.includes(w)) out.push(w); return out; };
      actF = fresh(actF.filter((f) => f.cur > 0), front);
      const order = aliveA().map((a) => ({ a, s: front.reduce((t, f) => t + a.per[f.j].score, 0) / Math.max(1, front.length) + (actA.includes(a) ? 0.001 : 0) }))
        .sort((x, y) => y.s - x.s || x.a.i - y.a.i).map((x) => x.a).slice(0, setup.slots);
      const before = actA.filter((a) => a.cur > 0);
      actA = fresh(before, order);
      queue = queue.filter((q) => (q.a.ally ? actA : actF).includes(q.a));
      return before.some((a) => !actA.includes(a));
    };
    const hit = (u, t, pp, atkKey, drKey, finKey, smKey, mult) => {
      const fin = pp[finKey].find((f) => f.min >= t.cur && f.min > 0);
      if (!fin && pp[smKey] && canGet(t, pp[smKey].st) && (rnd() < SMC || !pp[atkKey].base)) {
        if (rnd() * 100 < pp[smKey].chance * srMul(t, pp[smKey].st)) { inflict(t, pp[smKey].st); calm = 0; }
        return;
      }
      const atk = fin ? fin.atk : pp[atkKey], dr = fin ? fin.drain : pp[drKey];
      const d = roll(atk, u.status === 'burn' ? 0.5 : 0, mult, u);
      if (!d) return;
      calm = 0; t.cur -= d;
      if (dr && u.cur > 0) u.cur = Math.min(u.hp, u.cur + Math.max(1, Math.ceil(u.hp * dr))); // v0.5.13: share of its own max HP
      if (t.status === 'freeze' && atk.type === 'fire' && t.cur > 0) t.status = null;
      if (t.cur > 0 && atk.fx && rnd() * 100 < atk.fx[1] * srMul(t, atk.fx[0])) inflict(t, atk.fx[0]);
    };
    for (;;) {
      if (!aliveF().length) return { win: true, rounds, hp: hpOut() };
      if (!aliveA().length) return { win: false, rounds, hp: hpOut(), left: aliveF().reduce((s, f) => s + f.cur, 0) / F.reduce((s, f) => s + f.hp, 0) };
      if (refill()) continue;
      if (!queue.length) {
        rounds++;
        if (++calm > num('STALL_ROUNDS', 8) || rounds > num('MAX_ROUNDS', 200)) {
          const mine = aliveA().reduce((s, a) => s + a.cur, 0) / A.reduce((s, a) => s + a.hp, 0);
          const theirs = aliveF().reduce((s, f) => s + f.cur, 0) / F.reduce((s, f) => s + f.hp, 0);
          return { win: mine > theirs, rounds, timeout: true, left: theirs, hp: hpOut() };
        }
        queue = [...actA, ...actF].map((u) => ({ a: u, s: u.spe * (u.status === 'paralysis' ? 0.25 : 1), r: rnd() })).sort((x, y) => y.s - x.s || x.r - y.r);
        continue;
      }
      const { a: u } = queue.shift();
      if (u.cur <= 0) continue;
      if (u.ally) {
        if (!actF.length) continue;
        if (!blocked(u) && u.cur > 0) { const t = actF[Math.floor(rnd() * actF.length)]; hit(u, t, u.per[t.j], 'atk', 'atkDrain', 'fin', 'sm', 1); }
        tick(u);
      } else {
        const targets = actA.filter((a) => a.cur > 0);
        if (!targets.length) continue;
        if (!blocked(u) && u.cur > 0) {
          let t = targets[0], tv = -1;
          for (const x of targets) { const v = x.per[u.j].aim / Math.max(1, x.cur) * (0.95 + rnd() * 0.1); if (v > tv) { tv = v; t = x; } }
          hit(u, t, t.per[u.j], 'hit', 'hitDrain', 'ffin', 'fsm', P);
        }
        tick(u);
      }
    }
  }
  // win chance of `team` against a gym leader's `foes` over `runs` seeded fights (same seeds = same answer)
  function gymEval(team, foes, gym, runs = 80, seed = 1) {
    if (!team.length || !foes.length) return { win: 0, rounds: 0 };
    const st = gymSetup(team, foes, gym);
    let w = 0, rounds = 0;
    for (let i = 0; i < runs; i++) { const r = gymRun(st, mulberry(seed * 7919 + i * 104729)); if (r.win) w++; rounds += r.rounds; }
    return { win: w / runs, rounds: rounds / runs };
  }
  // The whole run from the last Pokémon Center to the leader, HP carrying over (the game doesn't heal between
  // fights): stages are { foes, plain } trainer fights or { berry: true } trees (+BERRY_HEAL of max HP to
  // everyone still standing). Returns the chance to beat the leader at the end and the HP the team arrives with.
  function gymChain(team, stages, foes, gym, runs = 60, seed = 1) {
    if (!team.length || !foes.length) return { win: 0, arrive: 0, survive: 0 };
    const heal = num('BERRY_HEAL', 0.25);
    const sets = stages.map((s) => (s.berry ? null : gymSetup(team, s.foes, { plain: s.plain || 1 })));
    const boss = gymSetup(team, foes, gym);
    let w = 0, ok = 0, arrive = 0;
    for (let i = 0; i < runs; i++) {
      const rnd = mulberry(seed * 7919 + i * 104729 + 31);
      let hp = Object.fromEntries(team.map((m) => [m.uid, 1])), dead = false;
      for (let k = 0; k < stages.length && !dead; k++) {
        if (stages[k].berry) { for (const u in hp) if (hp[u] > 0) hp[u] = Math.min(1, hp[u] + heal); continue; }
        const r = gymRun(sets[k], rnd, hp); hp = r.hp; if (!r.win) dead = true;
      }
      if (dead) continue;
      ok++; arrive += Object.values(hp).reduce((a, b) => a + b, 0) / team.length;
      if (gymRun(boss, rnd, hp).win) w++;
    }
    return { win: w / runs, survive: ok / runs, arrive: ok ? arrive / ok : 0 };
  }
  function chapterFoes(ch) {
    const steps = G().STORY.CHAPTERS[ch]?.steps || [], wild = chapterPool(ch);
    const fights = steps.filter((st) => st.kind === 'route').reduce((t, st) => t + (st.wild || 1), 0) || 1;
    // the boss team scales too: its ace sits at the game's aceOf(ch) (Stark Mountain: Lv 100, not 66)
    const ace = (() => { try { return +G().STORY.aceOf(ch) || null; } catch { return null; } })();
    const boss = steps.filter((st) => Array.isArray(st.team) && st.team.length).flatMap((st) => { const top = Math.max(...st.team.map(([, lv]) => +lv || 1)); return st.team.map(([id, lv]) => ({ id, lv: ace ? Math.round((+lv || top) * ace / top) : +lv || 50, boss: true })); });
    if (!boss.length) return wild;
    const bw = 1 / (fights + 1); // the whole boss team counts as one fight's worth
    return [...wild.map((x) => ({ ...x, w: x.w * (1 - bw) })), ...boss.map((x) => ({ ...x, w: bw / boss.length }))];
  }
  const bstOf = (id) => Object.values(dex(id)?.stats || {}).reduce((t, x) => t + (+x || 0), 0);
  // a special encounter in a chapter (Rotom forms, Spiritomb...): a single fight against your whole team at
  // the encounter's own level - the game adds no extra HP or power for these (ENEMY_DAMAGE.static = 1)
  function staticZone(ch, foeId) {
    const st = (G().STORY.CHAPTERS[ch]?.steps || []).find((x) => x.kind === 'static' && +x.id === +foeId);
    if (!st) return null;
    return { id: +foeId, foe: +foeId, hp: 1, power: 1, weather: null, burst: null, counter: null, level: +st.level || bandOf(ch)?.[1] || 50, static: true };
  }
  // the Pokémon that can play chapter ch: on a new region's side only that side's (Unova), else everyone
  function sidePool(ch) {
    const L = Gm().S?.link, all = Gm().allMons?.() || [];
    if (!L) return all;
    let side = null; try { side = G().STORY.regionOf(ch)?.key === L.to ? 'to' : 'from'; } catch (__e) { __h('35-sim:675', __e); }
    return all.filter((m) => { try { return (Gm().groupOf(m.reg) === 'to' ? 'to' : 'from') === side; } catch { return true; } });
  }
  function carriers(ch, { exclude = [], n = 4, minLevel = 90 } = {}) {
    const pool = chapterFoes(ch);
    if (!pool.length) return { pool, picks: [] };
    const away = new Set((Gm().underMons?.() || []).map((m) => m.uid));
    // a new region (Unova) is its own side until its League: only Pokémon of the chapter's side can play it
    const L = Gm().S?.link; let chSide = null;
    if (L) { try { chSide = G().STORY.regionOf(ch)?.key === L.to ? 'to' : 'from'; } catch (__e) { __h('35-sim:684', __e); } }
    const fits = (m) => !L || !chSide || ((() => { try { return Gm().groupOf(m.reg) === 'to'; } catch { return false; } })() ? 'to' : 'from') === chSide;
    const seen = new Set(), cands = [];
    for (const m of [...(Gm().ownedMons?.() || [])].sort((a, b) => b.level - a.level)) {
      if (m.level < minLevel || exclude.includes(m.uid) || away.has(m.uid) || !fits(m)) continue;
      const k = species(m); if (seen.has(k)) continue; seen.add(k); // best copy of each species (forms count as one)
      cands.push({ m, ...clearScore(m, pool) });
    }
    // near-ties (within 5% of the best - every Lv 100 one-shots easy chapters, and the gap is just
    // move accuracy) go to the strongest: highest base stats, then level. The strong get stronger.
    cands.forEach((c) => { c.bst = bstOf(c.m.id); });
    const top = Math.max(...cands.map((c) => c.score), 0), tie = (c) => c.score >= top * 0.95;
    cands.sort((a, b) => (tie(b) - tie(a)) || (tie(a) && tie(b) ? (b.bst - a.bst) || (b.m.level - a.m.level) : b.score - a.score));
    return { pool, picks: cands.slice(0, n), ranked: cands };
  }

  return { CARRIER_V: 4, gymNow, isNight, roamZone, coverage, gymEval, gymChain, bandOf, staticZone, sidePool, zoneOf, setup, run, evaluate, trace, search, mulberry, chapterPool, chapterFoes, clearScore, carriers, species, dupFree };
})();

/* ---------------------------------------------------------------------------------------------
 * GameSim (2.16.0): Elite legendary fights played in the GAME'S OWN battle engine, in a sandbox.
 * Mega's Sim (35-sim.js) is its own model of the game's fights. For Elite tiers it drifted far from
 * the game (2026-11-25: it gave Rayquaza tier 4 99.6% while every real try lost with the boss at
 * ~35-45% HP). Here a copy of the save is handed to Game.sandbox (the game's own tool, the
 * Underground's simulate uses it), the Elite tier is started there with Adventure.startZone and
 * Adventure.step() plays it out: the same code, numbers and randomness as a real try.
 * Checked against Jimmy's real fights: tier 3 won first try (engine 88%), tier 4 lost every try
 * with the boss at 33-46% (engine 2%, boss at ~30%).
 * The copy is thrown away - nothing reaches the real save (sandbox() also blocks saving).
 * ------------------------------------------------------------------------------------------- */
const GameSim = (() => {
  const E = Engine;
  const yieldNow = () => new Promise((r) => setTimeout(r, 0));
  // a short breather between bursts so the game keeps drawing (2.16.5)
  const rest = () => new Promise((r) => setTimeout(r, 30));
  // one try of Elite `tier` against legendary `foe` with `uids`: { win, left } (left = boss HP share at the end)
  function eliteOnce(foe, tier, uids, base) {
    const G = E.get('Game'), A = E.get('Adventure');
    const x = structuredClone(base || G.S);
    x.elite = x.elite || {}; x.elite[foe] = { ...(x.elite[foe] || {}), t: tier - 1 }; // the game only starts best+1
    x.eventTeams = x.eventTeams || {}; x.eventTeams['zone:' + foe] = uids.slice(); x.road = null;
    let win = false, left = 1, ok = false;
    G.sandbox(x, () => {
      const ad = A.ensure();
      Object.assign(ad, { event: null, tower: null, league: null, zone: null, battle: null, pending: null });
      ok = A.startZone(foe, tier) !== false;
      if (!ok) return;
      for (let s = 0; s < 20000; s++) {
        const en = ad.battle?.enemies?.[0];
        if (en) { try { left = G.curHp(en) / G.maxHp(en); } catch (__e) { __h('36-gamesim:31', __e); } }
        const ev = A.step() || [];
        if (ev.some((e) => e.type === 'eliteDone')) { win = true; left = 0; return; }
        if (ev.some((e) => e.type === 'zoneLoop' || e.type === 'zoneShut')) return;
      }
    });
    if (!ok) throw new Error('the game would not start that tier in the simulator');
    return { win, left };
  }
  // n tries: { ko (win share), left (median boss HP share on losses), n }
  async function elite(foe, tier, uids, n = 40, { budgetMs = 30 } = {}) {
    const G = E.get('Game'); const base = structuredClone(G.S);
    let w = 0, t0 = performance.now(); const L = [];
    for (let i = 0; i < n; i++) {
      const r = eliteOnce(foe, tier, uids, base);
      if (r.win) w++; else L.push(r.left);
      if (performance.now() - t0 > budgetMs) { await rest(); t0 = performance.now(); }
    }
    L.sort((a, b) => a - b);
    return { ko: w / n, left: L.length ? L[L.length >> 1] : 0, n };
  }
  // ---- legendary zones (2.16.2): one try at catching `foe` in its zone (tier 0). In the copy it's marked not
  // caught so the zone opens like the first time; a try ends with a KO (the game throws a Ball: 'capture')
  // or a wipe ('zoneLoop' / 'defeat').
  function zoneOnce(foe, uids, base) {
    const G = E.get('Game'), A = E.get('Adventure');
    const x = structuredClone(base || G.S);
    if (x.dex) delete x.dex[foe];
    x.eventTeams = x.eventTeams || {}; x.eventTeams['zone:' + foe] = uids.slice(); x.road = null;
    let win = false, left = 1, ok = false;
    G.sandbox(x, () => {
      const ad = A.ensure();
      Object.assign(ad, { event: null, tower: null, league: null, zone: null, battle: null, pending: null });
      ok = A.startZone(foe) !== false && !!ad.zone && !ad.zone.riddle;
      if (!ok) return;
      for (let s = 0; s < 20000; s++) {
        const en = ad.battle?.enemies?.[0];
        if (en) { try { left = G.curHp(en) / G.maxHp(en); } catch (__e) { __h('36-gamesim:68', __e); } }
        const ev = A.step() || [];
        if (ev.some((e) => e.type === 'capture')) { win = true; left = 0; return; }
        if (ev.some((e) => e.type === 'zoneLoop' || e.type === 'defeat' || e.type === 'zoneShut')) return;
      }
    });
    if (!ok) throw new Error('the game would not open that zone in the simulator');
    return { win, left };
  }
  async function zone(foe, uids, n = 40) {
    const base = structuredClone(E.get('Game').S);
    let w = 0, t0 = performance.now(); const L = [];
    for (let i = 0; i < n; i++) { const r = zoneOnce(foe, uids, base); if (r.win) w++; else L.push(r.left); if (performance.now() - t0 > 30) { await rest(); t0 = performance.now(); } }
    L.sort((a, b) => a - b);
    return { ko: w / n, left: L.length ? L[L.length >> 1] : 0, n };
  }
  // the right fight for a tier: Elite tiers 1-5, or the zone itself (0)
  const play = (foe, tier, uids, n) => (tier > 0 ? elite(foe, tier, uids, n) : zone(foe, uids, n));
  const score = (r) => r.ko - 0.25 * r.left; // wins first; among equals, the team that hurts the boss most
  // Refine Mega's heuristic pick with the real engine: score its candidates, then try swapping each slot
  // for the strongest few alternatives (the game's 1-Legendary cap kept). cands: arrays of mons.
  async function refine(foe, tier, cands, pool, { legOk = () => true, species = (m) => m.id, onProgress } = {}) {
    const seen = new Map();
    const rate = async (team, n) => { const k = team.map((m) => m.uid).join(',') + ':' + n; if (!seen.has(k)) seen.set(k, await play(foe, tier, team.map((m) => m.uid), n)); return seen.get(k); };
    let best = null;
    for (const t of cands) { if (t.length < 6 || !legOk(t)) continue; const r = await rate(t, 24); if (!best || score(r) > score(best.r)) best = { team: t.slice(), r }; }
    if (!best) return null;
    const alt = pool.slice(0, 10);
    let step = 0; const total = 6 * alt.length * 2;
    for (let pass = 0; pass < 2; pass++) {
      let improved = false;
      for (let slot = 0; slot < 6; slot++) {
        for (const c of alt) {
          step++; onProgress?.(Math.min(0.97, step / total));
          if (best.team.some((m, i) => i !== slot && species(m) === species(c)) || best.team[slot].uid === c.uid) continue;
          const trial = best.team.slice(); trial[slot] = c; if (!legOk(trial)) continue;
          const q = await rate(trial, 12);
          if (score(q) <= score(best.r) - 0.05) continue;
          const r = await rate(trial, 30);
          if (score(r) > score(best.r) + 0.02) { best = { team: trial, r }; improved = true; }
        }
      }
      if (!improved) break;
    }
    const final = await play(foe, tier, best.team.map((m) => m.uid), 100);
    return { team: best.team, final };
  }
  // ---- Shiny Raid (2.16.1): one try of today's raid in `reg` with your `mine` (uids) and ally trainer keys.
  // The copy forgets today's catch so the raid can start (the game: one boss a day). A try ends with a KO (the
  // game throws a Ball: 'capture') or a wipe ('defeat'). The raid has to be today's drawn region.
  function raidOnce(reg, mine, allies, base) {
    const G = E.get('Game'), A = E.get('Adventure');
    const x = structuredClone(base || G.S);
    const rd = x.raids || (x.raids = {});
    for (const k of ['done', 'doneBoss']) for (const key of Object.keys(rd[k] || {})) if (key.startsWith(reg)) delete rd[k][key];
    rd.pick = rd.pick || {}; rd.pick[reg] = allies.slice();
    x.eventTeams = x.eventTeams || {}; x.eventTeams['raid:' + reg] = mine.slice();
    let ko = false, left = 1, ok = false;
    G.sandbox(x, () => {
      const ad = A.ensure();
      Object.assign(ad, { event: null, tower: null, league: null, zone: null, battle: null, pending: null });
      ok = A.startRaid(reg) !== false && !!ad.event?.raid;
      if (!ok) return;
      for (let s = 0; s < 20000; s++) {
        const en = ad.battle?.enemies?.[0];
        if (en) { try { left = G.curHp(en) / G.maxHp(en); } catch (__e) { __h('36-gamesim:133', __e); } }
        const ev = A.step() || [];
        if (ev.some((e) => e.type === 'capture')) { ko = true; left = 0; return; }
        if (ev.some((e) => e.type === 'defeat')) return;
      }
    });
    if (!ok) throw new Error('the game would not start that raid in the simulator');
    return { ko, left };
  }
  async function raid(reg, mine, allies, n = 40) {
    const base = structuredClone(E.get('Game').S);
    let w = 0, t0 = performance.now(); const L = [];
    for (let i = 0; i < n; i++) {
      const r = raidOnce(reg, mine, allies, base);
      if (r.ko) w++; else L.push(r.left);
      if (performance.now() - t0 > 30) { await rest(); t0 = performance.now(); }
    }
    L.sort((a, b) => a - b);
    return { ko: w / n, left: L.length ? L[L.length >> 1] : 0, n };
  }
  // ---- Elite League (2.16.3): one try = the League run of `reg` at `tier` until a wipe (the game then starts
  // over from the first leader) or the run is won. Returns how many leaders fell and whether it was won.
  function leagueOnce(reg, tier, uids, base) {
    const G = E.get('Game'), A = E.get('Adventure');
    const x = structuredClone(base || G.S);
    x.eliteLeague = x.eliteLeague || {}; x.eliteLeague[reg] = { ...(x.eliteLeague[reg] || {}), t: tier - 1 };
    x.road = uids.slice(); x.team = uids.slice();
    let won = false, beat = 0, ok = false;
    G.sandbox(x, () => {
      const ad = A.ensure();
      Object.assign(ad, { event: null, tower: null, league: null, zone: null, battle: null, pending: null });
      ok = A.startLeague(reg, tier) !== false && !!ad.league;
      if (!ok) return;
      for (let s = 0; s < 40000; s++) {
        const ev = A.step() || [];
        for (const e of ev) { if (e.type === 'victory') beat++; if (e.type === 'defeat') return; }
        if (!ad.league) { won = true; return; }
      }
    });
    if (!ok) throw new Error('the game would not start that League tier in the simulator');
    return { won, beat };
  }
  // n tries: { ko, per: [win share against leader i, among tries that reached them] }
  async function league(reg, tier, uids, n = 40, leaders = 5) {
    const base = structuredClone(E.get('Game').S);
    let w = 0, t0 = performance.now(); const reach = Array(leaders).fill(0), pass = Array(leaders).fill(0);
    for (let i = 0; i < n; i++) {
      const r = leagueOnce(reg, tier, uids, base); if (r.won) w++;
      const got = r.won ? leaders : Math.min(r.beat, leaders - 1);
      for (let k = 0; k < leaders; k++) { if (got >= k) reach[k]++; if (got > k) pass[k]++; }
      if (performance.now() - t0 > 30) { await rest(); t0 = performance.now(); }
    }
    return { ko: w / n, n, per: reach.map((r, k) => (r ? pass[k] / r : null)) };
  }
  return { eliteOnce, elite, zoneOnce, zone, play, refine, raidOnce, raid, leagueOnce, league };
})();

/* ---------------------------------------------------------------------------------------------
 * Recorder: writes down every real fight, action by action, so the simulator can be checked
 * against what actually happened instead of trusted.
 *
 * The game keeps the fight in Game.S.adv.battle: a queue of who acts next, the boss's HP / rage /
 * status, and the allies. One actor moves per step (~0.5-0.8 s). Each time the state changes, the
 * actor is the one that was at the head of the queue just before, and the HP deltas are its hit.
 *
 * Storage: IndexedDB ("mega-alakazam" / "fights"), so it never competes with the game's own save
 * for localStorage space. Read-only towards the game.
 * ------------------------------------------------------------------------------------------- */
// The raid's own KO counter. The daily Shiny Raid counts KOs in Raids.pity (its Master Ball gauge).
// The "15,000 Trainers" event raid (game 0.5.16, adv.event.date === 'fete15') keeps its own counters
// in S.fete15: Fete15.tries(reg) goes up once per capture attempt (every KO gives one), and
// Raids.pity never moves - reading that one made every event-raid fight look like a wipe.
const RaidCount = {
  fete: (ev) => ev?.date === 'fete15',
  kos(ev) { try { return this.fete(ev) ? +Engine.get('Fete15').tries(ev.reg) || 0 : +Engine.get('Raids').pity(ev.reg) || 0; } catch { return 0; } },
  gauge(ev) { try { return +(this.fete(ev) ? Engine.get('Fete15').pity(ev.reg) : Engine.get('Raids').pity(ev.reg)) || 0; } catch { return 0; } },
  label: (ev) => (ev?.date === 'fete15' ? '15,000 Trainers raid' : 'Shiny Raid'),
};
const Recorder = (() => {
  const E = Engine;
  const DB_NAME = 'mega-alakazam', STORE = 'fights', KEEP_PER_FOE = 60;
  let db = null, cur = null, prev = null, timer = null;
  // true once we have seen a moment with no fight (or another foe): a fight that starts after that
  // was watched from its first action
  let sawGap = false;
  const listeners = new Set();

  function openDb() {
    if (db) return Promise.resolve(db);
    return new Promise((res, rej) => {
      const r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = () => { const s = r.result.createObjectStore(STORE, { keyPath: 'id' }); s.createIndex('foe', 'foeId'); s.createIndex('at', 'at'); };
      r.onsuccess = () => res((db = r.result));
      r.onerror = () => rej(r.error);
    });
  }
  async function put(f) {
    const d = await openDb();
    await new Promise((res, rej) => { const tx = d.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put(f); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
    await prune(f.foeId);
  }
  async function all(foeId) {
    const d = await openDb();
    return new Promise((res, rej) => {
      const tx = d.transaction(STORE), st = tx.objectStore(STORE);
      const q = foeId == null ? st.getAll() : st.index('foe').getAll(+foeId);
      q.onsuccess = () => res((q.result || []).sort((a, b) => b.at - a.at));
      q.onerror = () => rej(q.error);
    });
  }
  async function prune(foeId) {
    const list = await all(foeId);
    if (list.length <= KEEP_PER_FOE) return;
    const d = await openDb(), tx = d.transaction(STORE, 'readwrite');
    for (const f of list.slice(KEEP_PER_FOE)) tx.objectStore(STORE).delete(f.id);
  }

  const hpOf = (uid) => { const m = E.read('Game.getMon', null, uid); return m ? E.read('Game.curHp', m.hp ?? 0, m) : 0; };

  function state(b) {
    const e = (b.enemies || [])[0] || {};
    const head = b.queue && b.queue[0] ? { side: b.queue[0].side, uid: b.queue[0].uid } : null;
    return { turn: b.turn, head, qn: (b.queue || []).length, q: (b.queue || []).map((x) => x.uid), units: [...(b.allies || []).filter(Boolean).map((uid) => ({ side: 'ally', uid })), ...(b.enemies || []).map((x) => ({ side: 'enemy', uid: x.uid }))], boss: +e.hp || 0, rage: e.rage ?? null, st: e.status || null, team: cur.team.map((t) => hpOf(t.uid)) };
  }

  // worth keeping: legendary zones, raids, gym / league bosses. Route wild/trainer fights are not.
  const worth = (b) => b.zone != null || b.kind === 'static' || !!b.event || b.kind === 'gym' || b.kind === 'league';
  function begin(b) {
    const e = (b.enemies || [])[0];
    if (!e) return;
    if (!worth(b)) { cur = { skip: true, foeUid: e.uid, team: [] }; prev = null; return; }
    const team = (b.allies || []).filter(Boolean).map((uid) => {
      const m = E.read('Game.getMon', null, uid) || {};
      return { uid, id: +m.id, level: m.level, shiny: !!m.shiny, rank: E.read('Game.rankOf', 0, m), maxHp: E.read('Game.maxHp', null, m) };
    });
    cur = {
      v: 3, id: `${Date.now()}-${e.uid}`, at: Date.now(), foeUid: e.uid, foeId: +e.id, foeLevel: e.level,
      kind: b.kind, zone: b.zone ?? null, elite: +(E.get('Game.S')?.adv?.zone?.elite) || 0, raid: !!(b.event?.raid || (E.get('Game.S')?.adv?.event?.raid && b.kind === 'static')), power: b.power, hpPower: b.hpPower, slots: b.slots,
      bossMax: E.read('Game.maxHp', null, e), hpMult: e.hpMult, rageMax: e.rageMax ?? null,
      team, events: [], complete: false,
    };
    prev = state(b);
    cur.complete = sawGap && b.turn === 0;
    cur.startBoss = prev.boss;
    const S0 = E.get('Game.S') || {};
    cur.wins0 = +(S0.stats?.wins ?? NaN);
    cur.battles0 = +(S0.stats?.battles ?? NaN);
    if (cur.raid) { const ev = S0.adv?.event || {}; cur.raidReg = ev.reg || null; cur.raidDate = ev.date || null; cur.pity0 = RaidCount.kos({ reg: cur.raidReg, date: cur.raidDate }); }
    cur.tries0 = +(S0.legTries?.[cur.foeId] ?? 0);
    cur.hadDex = !!E.read('Game.inDex', false, cur.foeId);
    cur.teamStart = prev.team.slice(); // HP at the start - not always full
  }

  function step(b) {
    // the game's own damage meter (0.5.10 "Battle recap": dealt / taken / burn-poison per Pokémon, boss fights only):
    // keep the latest copy, the battle is cleared the instant it ends
    if (b.meter && cur) { try { cur.meter = { dealt: { ...b.meter.dealt }, dot: { ...b.meter.dot }, taken: { ...b.meter.taken } }; } catch (__e) { __h('40-record:100', __e); } }
    const s = state(b);
    const changed = s.turn !== prev.turn || s.boss !== prev.boss || s.rage !== prev.rage || s.st !== prev.st || s.team.some((h, i) => h !== prev.team[i]) || (s.head?.uid !== prev.head?.uid);
    if (!changed) return;
    const dTeam = {};
    s.team.forEach((h, i) => { const d = h - prev.team[i]; if (d) dTeam[i] = d; });
    // exactly one actor may have moved since the last sample, or the hit cannot be attributed
    const moved = s.turn === prev.turn ? prev.qn - s.qn : null;
    const dTeamHas = (u) => { const i = cur.team.findIndex((t) => t.uid === u.uid); return i >= 0 && prev.team[i] > 0; };
    let actor;
    if (s.turn !== prev.turn) {
      // new turn: the game rebuilt the queue and took its first unit off it - that unit acted
      // (only certain when exactly one unit is missing from the new queue)
      const gone = s.units.filter((u) => !s.q.includes(u.uid) && (u.side === 'enemy' || s.team[cur.team.findIndex((t) => t.uid === u.uid)] > 0 || dTeamHas(u)));
      actor = gone.length === 1 && s.turn === prev.turn + 1 && !prev.qn ? (gone[0].side === 'enemy' ? 'E' : cur.team.findIndex((t) => t.uid === gone[0].uid)) : '?';
    } else actor = !prev.head || (moved != null && moved > 1) ? '?' : prev.head.side === 'enemy' ? 'E' : cur.team.findIndex((t) => t.uid === prev.head.uid);
    if (prev.boss - s.boss || Object.keys(dTeam).length || s.rage !== prev.rage || s.st !== prev.st) {
      cur.events.push({ dt: Date.now() - cur.at, turn: s.turn, a: actor, dB: prev.boss - s.boss, dT: dTeam, rage: s.rage, st: s.st });
    }
    prev = s;
  }

  // How a fight ended, from the game's own counters - not from HP, because the game clears the
  // battle and heals the team the instant it ends, often before either 0 is ever sampled:
  //  - a legendary KO always gives a capture attempt (legTries goes up)
  //  - every fight adds to stats.battles; only a win adds to stats.wins
  function classify(f, S) {
    // caught it outright: a catch needs a KO, and the counters below may not have moved yet
    if (f.hadDex === false && E.read('Game.inDex', false, f.foeId)) return 'ko';
    // Shiny Raid boss: every KO adds a try to the raid's pity counter (raid fights don't count in stats)
    if (f.raid && f.pity0 != null) return RaidCount.kos({ reg: f.raidReg, date: f.raidDate }) > f.pity0 ? 'ko' : 'wipe';
    const tried = +(S.legTries?.[f.foeId] ?? 0) > f.tries0;
    const dB = +(S.stats?.battles ?? NaN) - f.battles0, dW = +(S.stats?.wins ?? NaN) - f.wins0;
    if (tried) return 'ko';
    if (dB >= 1) return dW >= 1 ? 'ko' : 'wipe';
    return 'left';
  }

  async function end(reason) {
    const f = cur; cur = null; prev = null;
    if (!f || f.skip || f.events.length < 3) return;
    const lastBoss = f.events.reduce((b, ev) => b - ev.dB, f.startBoss);
    f.endBoss = Math.max(0, lastBoss);
    await new Promise((r) => setTimeout(r, 1200)); // let the game update its counters
    f.outcome = classify(f, E.get('Game.S') || {});
    f.ended = reason;
    f.turns = f.events.length ? f.events[f.events.length - 1].turn : 0;
    f.ms = Date.now() - f.at;
    try { await put(f); } catch (e) { console.warn('[Mega Alakazam] could not store fight', e); }
    for (const fn of listeners) try { fn(f); } catch (__e) { __h('40-record:149', __e); }
  }

  function poll() {
    const b = E.get('Game.S')?.adv?.battle;
    if (!b || !(b.enemies || []).length) { sawGap = true; if (cur) end(prev && prev.team.length && prev.team.every((h) => h <= 0) ? 'wipe' : 'gone'); return; }
    const e = b.enemies[0];
    if (cur && cur.foeUid !== e.uid) { sawGap = true; end(prev && prev.team.length && prev.team.every((h) => h <= 0) ? 'wipe' : 'gone'); }
    if (!cur) { begin(b); return; }
    if (cur.skip) return;
    step(b);
    if (prev && prev.team.length && prev.team.every((h) => h <= 0)) end('wipe');
  }

  async function migrate() {
    try {
      const list = (await all()).sort((a, b) => a.at - b.at);
      const S = E.get('Game.S') || {};
      // 2.15.7: the 15,000 Trainers raid was scored from the Shiny Raid's counter, which never moves in it,
      // so every fight said 'wipe' (the boss's last HP is rarely sampled: the game clears the fight first).
      // The event counts one try per KO: when a region's event-raid fights are no more than its tries,
      // every one of them was a KO.
      try {
        const F = E.get('Fete15'), from = Date.parse('2026-11-20T00:00:00Z');
        for (const [reg, p] of Object.entries(S.fete15?.pick || {})) {
          const fs = list.filter((f) => f.raid && f.at > from && +f.foeId === +p.id && !f.raidDate && f.outcome === 'wipe');
          const all = list.filter((f) => f.raid && f.at > from && +f.foeId === +p.id);
          if (fs.length && all.length <= (+F.tries(reg) || 0)) for (const f of fs) { f.outcome = 'ko'; f.raidReg = reg; f.raidDate = 'fete15'; f.migrated = (f.migrated ? f.migrated + '; ' : '') + 'event raid wipe->ko (counted from its own tries)'; await put(f); }
        }
      } catch (e) { console.warn('[Mega Alakazam] migrate fete15', e); }
      for (let i = 0; i < list.length; i++) {
        const f = list[i];
        if (f.v >= 3) continue;
        if (f.v === 2 || f.migrated) {
          // 0.2.5 scored a capture as 'left': the last fight before the foe is in the Pokédex was the catch
          const later = list.slice(i + 1).some((x) => x.foeId === f.foeId);
          if (f.outcome === 'left' && !later && f.endBoss >= 0 && E.read('Game.inDex', false, f.foeId) && f.at > Date.now() - 7 * 864e5 && E.read('Game.isLegend', false, f.foeId)) {
            const tries = +(S.legTries?.[f.foeId] ?? 0);
            if (tries >= f.tries0) { f.outcome = 'ko'; f.migrated = (f.migrated ? f.migrated + '; ' : '') + 'left->ko (caught after this fight)'; }
          }
          f.v = 3; await put(f); continue;
        }
        if (f.outcome !== 'left' || !(f.endBoss > 0)) { f.v = 3; await put(f); continue; }
        const next = list.slice(i + 1).find((x) => x.foeId === f.foeId);
        const triesAfter = next ? next.tries0 : +(S.legTries?.[f.foeId] ?? 0);
        if (E.read('Game.isLegend', false, f.foeId) && Number.isFinite(triesAfter) && triesAfter === f.tries0) { f.outcome = 'wipe'; f.migrated = '0.2.3 left->wipe (no capture attempt followed)'; }
        f.v = 3;
        await put(f);
      }
    } catch (e) { console.warn('[Mega Alakazam] migrate', e); }
  }

  function start() {
    setTimeout(migrate, 3000); if (!timer) timer = setInterval(() => { try { if (E.ready()) poll(); } catch (e) { console.warn('[Mega Alakazam] recorder', e); } }, 100); }
  return { start, all, onFight: (fn) => listeners.add(fn), get current() { return cur; } };
})();

/* ---------------------------------------------------------------------------------------------
 * BossLog: every real gym and League fight, written down as the game actually ran it - the ground
 * truth for rebuilding the gym simulator (Jimmy, 2026-11-18: Mega's teams lost to Cheren six times at
 * an estimated 100% while the old helper's team won; the rebuild may only ship once it agrees with these).
 *
 * Kept per fight: the chapter and leader, the gym's power, the fight's edge and slots, the leader's
 * whole team as the game built it (levels, HP multiplier, real max HP), your six (levels, rank, HP),
 * what each simulator said at the start (the ported old-helper simulator, the game's quick estimate),
 * who was in charge (Mega's plan or the old helper), a compact timeline of HP turn by turn, and the
 * result from the game's own counters (battles / wins, badges, chapter unlocked).
 *
 * Read-only towards the game, always on (it records while Mega's plan is paused and the old helper
 * plays). Stored in IndexedDB "mega-bossfights" (last 300 fights), never in the game's localStorage.
 * ------------------------------------------------------------------------------------------- */
const BossLog = (() => {
  const E = Engine, DB = 'mega-bossfights', STORE = 'fights', KEEP = 300;
  let db = null, cur = null, count = null;
  const S = () => E.get('Game.S') || {};
  const safe = (f, d = null) => { try { const v = f(); return v === undefined ? d : v; } catch { return d; } };
  function open() {
    if (db) return Promise.resolve(db);
    return new Promise((res, rej) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => { const s = r.result.createObjectStore(STORE, { keyPath: 'id' }); s.createIndex('at', 'at'); };
      r.onsuccess = () => res((db = r.result));
      r.onerror = () => rej(r.error);
    });
  }
  async function all() {
    const d = await open();
    return new Promise((res, rej) => { const q = d.transaction(STORE).objectStore(STORE).getAll(); q.onsuccess = () => res((q.result || []).sort((a, b) => a.at - b.at)); q.onerror = () => rej(q.error); });
  }
  async function put(f) {
    const d = await open();
    await new Promise((res, rej) => { const tx = d.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put(f); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
    const list = await all(); count = list.length;
    if (list.length > KEEP) { const tx = d.transaction(STORE, 'readwrite'); for (const x of list.slice(0, list.length - KEEP)) tx.objectStore(STORE).delete(x.id); }
  }
  const isBoss = (b) => b && (b.kind === 'gym' || b.kind === 'league') && (b.enemies || []).length;
  const mon = (u) => E.read('Game.getMon', null, u);
  const curHp = (m) => safe(() => +E.read('Game.curHp', m.hp ?? 0, m), m?.hp ?? 0);
  const maxHp = (m) => safe(() => +E.read('Game.maxHp', 0, m), 0);
  const teamNow = () => (S().team || []).slice(0, 6).map(mon).filter(Boolean);

  function begin(b) {
    const a = S().adv || {}, team = teamNow(), g = b.gym || {};
    const foes = b.enemies.map((e) => ({ uid: e.uid, id: +e.id, level: +e.level, hpMult: e.hpMult ?? null, maxHp: maxHp(e), hp: +e.hp, statMult: e.statMult ?? null }));
    const fresh = (m) => { const c = { ...m }; delete c.hp; delete c.curHp; return c; };
    const simFoes = foes.map((f) => ({ id: f.id, level: f.level }));
    cur = {
      v: 1, id: `${Date.now()}-${b.enemies[0].uid}`, at: Date.now(),
      ch: +a.chapter, chapter: safe(() => E.get('STORY').CHAPTERS[a.chapter].name), unlocked: +a.unlocked, node: +a.node, nodes: (a.nodes || []).length,
      kind: b.kind, trainer: b.trainer || g.leader || null, gym: { leader: g.leader || null, type: g.type || null, badge: g.badge || null, power: +g.power || 1, double: !!g.double },
      edge: b.edge ?? null, slots: +b.slots || 1, foes,
      team: team.map((m) => ({ uid: m.uid, id: +m.id, level: +m.level, rank: safe(() => +E.read('Game.rankOf', 0, m), 0), shiny: !!m.shiny, maxHp: maxHp(m), hp: curHp(m) })),
      est: {
        oldSim: safe(() => +Sim.gymEval(team.map(fresh), simFoes, { power: +g.power || 1, double: !!g.double }, 300).win, null),
        game: safe(() => +E.call('Adventure.winChance', team.map(fresh), simFoes, 'gym', 1, +g.power || 1), null),
      },
      by: safe(() => (Plan.oldOn() ? 'old helper' : Plan.running ? 'Mega' : 'you (plan paused)'), null),
      stats0: { battles: +(S().stats?.battles ?? NaN), wins: +(S().stats?.wins ?? NaN), badges: (a.badges || []).length },
      startHp: null, // filled below: share of the team's HP left at the start (0-1)
      replay: +a.chapter < +a.unlocked, // a leader you've already beaten (Mega's training loops)
      tl: [], complete: +b.turn === 0,
    };
    { const hp = cur.team.reduce((x, t) => x + (t.hp || 0), 0), mx = cur.team.reduce((x, t) => x + (t.maxHp || 0), 0); cur.startHp = mx ? +(hp / mx).toFixed(3) : null; }
    sample(b);
    if (!cur.replay) try { Log.add(`recording ${cur.trainer || 'a boss'} fight (${cur.foes.length} Pokémon, power ×${cur.gym.power}, edge ${cur.edge}) - old-helper simulator ${cur.est.oldSim == null ? '?' : Math.round(cur.est.oldSim * 100) + '%'}`); } catch (__e) { __h('41-bosslog:68', __e); }
  }
  function sample(b) {
    const s = { t: Date.now() - cur.at, turn: +b.turn, e: b.enemies.map((e) => +e.hp), a: cur.team.map((t) => { const m = mon(t.uid); return m ? curHp(m) : 0; }), on: (b.allies || []).map((u) => cur.team.findIndex((t) => t.uid === u)), of: (b.foes || []).map((u) => b.enemies.findIndex((e) => e.uid === u)) };
    const last = cur.tl[cur.tl.length - 1];
    if (last && last.turn === s.turn && last.e.join() === s.e.join() && last.a.join() === s.a.join() && last.on.join() === s.on.join()) return;
    if (cur.tl.length < 1500) cur.tl.push(s);
  }
  async function end(reason) {
    const f = cur; cur = null; if (!f) return;
    await new Promise((r) => setTimeout(r, 1500)); // the game updates its counters right after the fight
    const a = S().adv || {}, st = S().stats || {};
    const dB = +(st.battles ?? NaN) - f.stats0.battles, dW = +(st.wins ?? NaN) - f.stats0.wins;
    const badge = (a.badges || []).length > f.stats0.badges || +a.unlocked > f.unlocked;
    const lastT = f.tl[f.tl.length - 1];
    const foesUp = lastT ? lastT.e.filter((h) => h > 0).length : 0;
    f.outcome = badge || dW >= 1 ? 'won' : dB >= 1 || foesUp > 0 || (lastT && lastT.a.every((h) => h <= 0)) ? 'lost' : 'left';
    f.ended = reason; f.ms = Date.now() - f.at; f.turns = lastT ? lastT.turn : 0;
    f.foesLeft = lastT ? lastT.e.filter((h) => h > 0).length : null;
    try { await put(f); } catch (e) { console.warn('[Mega Alakazam] could not store boss fight', e); }
    if (!f.replay) try { Log.add(`recorded: ${f.trainer || 'boss'} - ${f.outcome}${f.outcome === 'lost' ? ` (${f.foesLeft} of ${f.foes.length} of their Pokémon still standing)` : ''} in ${f.turns} turns; the old-helper simulator had said ${f.est.oldSim == null ? '?' : Math.round(f.est.oldSim * 100) + '%'}`); } catch (__e) { __h('41-bosslog:88', __e); }
  }
  function poll() {
    const b = S().adv?.battle;
    if (cur) {
      if (!isBoss(b) || b.enemies[0].uid !== cur.foes[0].uid) { end(isBoss(b) ? 'next fight' : 'over'); if (!isBoss(b)) return; }
      else { sample(b); return; }
    }
    if (isBoss(b)) begin(b);
  }
  setInterval(() => { try { if (E.ready()) poll(); } catch (e) { console.warn('[Mega Alakazam] boss log', e); } }, 250);
  setTimeout(async () => {
    try {
      const l = await all(); count = l.length;
      for (const f of l) {
        if (f.outcome === 'left' && f.foesLeft > 0) { f.outcome = 'lost'; f.fixed = 'left->lost (2.7.4: leader still standing)'; await put(f); }
        if (f.startHp == null && f.team?.length) { const hp = f.team.reduce((x, t) => x + (t.hp || 0), 0), mx = f.team.reduce((x, t) => x + (t.maxHp || 0), 0); f.startHp = mx ? +(hp / mx).toFixed(3) : null; await put(f); }
      }
    } catch (__e) { __h('41-bosslog:106', __e); }
  }, 4000);
  return { all, poll, get current() { return cur; }, get count() { return count; } };
})();

/* ---------------------------------------------------------------------------------------------
 * Analyse: turns recorded fights into the numbers the simulator has to reproduce.
 *  - per attacker (species): average damage per action to the boss, how often it misses
 *  - the boss: average single-target hit, rage bursts (all allies hit at once), counters
 *  - outcome rate over complete fights only (fights seen from turn 0)
 * Pure functions over stored fights; no game access.
 * ------------------------------------------------------------------------------------------- */
const Analyse = (() => {
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

  function foe(fights) {
    const done = fights.filter((f) => f.complete);
    const out = { fights: fights.length, complete: done.length, ko: done.filter((f) => f.outcome === 'ko').length, wipe: done.filter((f) => f.outcome === 'wipe').length };
    out.koRate = out.ko + out.wipe ? out.ko / (out.ko + out.wipe) : null;
    out.turnsKo = mean(done.filter((f) => f.outcome === 'ko').map((f) => f.turns));
    out.turnsWipe = mean(done.filter((f) => f.outcome === 'wipe').map((f) => f.turns));
    const per = new Map(), bossHits = [], bursts = [], counters = [], ticks = {};
    let hitTotal = 0, tickTotal = 0;
    for (const f of fights) {
      let lastRage = null;
      for (const ev of f.events) {
        const nT = Object.keys(ev.dT || {}).length;
        if (typeof ev.a === 'number' && ev.a >= 0) {
          const t = f.team[ev.a]; if (!t) continue;
          const k = t.id + (t.shiny ? 's' : '') + ':' + (t.rank || 0);
          const p = per.get(k) || { id: t.id, shiny: t.shiny, rank: t.rank || 0, hits: [], zero: 0 };
          if (ev.dB > 0) { p.hits.push(ev.dB); hitTotal += ev.dB; } else p.zero++;
          per.set(k, p);
          // one of yours hit on your own landed action = the boss's counter (its target is random)
          if (ev.dB > 0 && nT === 1 && Object.values(ev.dT)[0] < 0) counters.push(-Object.values(ev.dT)[0]);
        }
        // rage reset with every living ally hit = a burst
        // median, not mean: a burst can land in the same step as an ordinary hit on one ally
        if (lastRage != null && ev.rage === 0 && lastRage > 0 && nT >= 2) bursts.push(median(Object.values(ev.dT).map((d) => -d)));
        else if (ev.a === 'E' && nT === 1) bossHits.push(-Object.values(ev.dT)[0]);
        // the boss losing HP on its own turn while poisoned or burned = the status tick
        if (ev.a === 'E' && ev.dB > 0 && (ev.st === 'poison' || ev.st === 'burn')) { (ticks[ev.st] = ticks[ev.st] || []).push(ev.dB); tickTotal += ev.dB; }
        lastRage = ev.rage;
      }
    }
    out.attackers = [...per.values()].map((p) => ({ ...p, avg: mean(p.hits), n: p.hits.length + p.zero, missRate: (p.hits.length + p.zero) ? p.zero / (p.hits.length + p.zero) : null })).sort((a, b) => (b.avg || 0) - (a.avg || 0));
    out.bossHit = mean(bossHits); out.bossHitN = bossHits.length;
    out.burst = mean(bursts); out.burstN = bursts.length;
    out.counter = mean(counters); out.counterN = counters.length;
    out.ticks = Object.entries(ticks).map(([st, a]) => ({ st, avg: median(a), n: a.length }));
    out.statusShare = hitTotal + tickTotal ? tickTotal / (hitTotal + tickTotal) : null;
    return out;
  }
  return { foe, mean, median };
})();

/* ---------------------------------------------------------------------------------------------
 * Calib: keeps the fight simulator honest against your real fights.
 *
 * Every boss fight is in the Recorder (team, boss, the strength the game used, KO or wipe). Once a
 * day (and after enough new fights) Calib replays those fights in the simulator and tunes two
 * numbers per kind of fight - raid, elite tier, regular zone - boss power (pk) and boss HP (hk), so
 * the simulator's KO rates match what really happened. Found on 2026-11-16: raids were 2x too
 * optimistic (sim 31% vs real 15%), elite tier 1 too pessimistic (sim 31% vs real 80%).
 *
 * It also remembers the boss strength the game really used per legendary + tier (the elite
 * settings say 0.65-0.81 power, the fights used 0.49-0.58), and the simulator uses that first.
 * Read-only: nothing here touches the game.
 * ------------------------------------------------------------------------------------------- */
const Calib = (() => {
  const E = Engine, KEY = 'mega-calib', OBS = 'mega-obs';
  let cal = (() => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } })() || {};
  let obs = (() => { try { return JSON.parse(localStorage.getItem(OBS) || 'null'); } catch { return null; } })() || {};
  const DAY = 86_400_000;
  const get = (ctx) => { const c = cal[ctx]; return c && c.pk ? { pk: c.pk, hk: c.hk } : null; };
  const observed = (foe, tier = 0) => { const o = obs[`${+foe}:${+tier || 0}`]; return o && Date.now() - o.at < 14 * DAY ? o : null; };
  // which elite tier an older fight was (before the Recorder wrote it down): match the boss HP
  function tierOf(f) {
    if (f.raid) return 0;
    if (f.elite != null) return +f.elite || 0;
    const LZ = E.get('LegendZones'); let best = 0, bd = Infinity;
    for (let t = 1; t <= 5; t++) { let k = null; try { k = LZ.eliteKnobs(f.foeId, null, t); } catch (__e) { __h('46-calib:26', __e); } if (!k || !isFinite(+k.hp)) continue; if (Math.abs(+k.hp - +f.hpPower) < 0.02) { const d = Math.abs(+k.power - +f.power); if (d < bd) { bd = d; best = t; } } }
    return best;
  }
  // the World Boss (Arceus, #493) gets its own tuning: the zone tuning (boss power x0.6, HP x1.4) made it look easy (2026-11-20: sim 100%, real 1 KO in 8)
  const ctxOf = (f, t) => (f.raid ? 'raid' : t > 0 ? 'elite' : +f.zone === 493 || +f.foeId === 493 ? 'wb' : 'zone');
  async function fights() {
    let all = []; try { all = await Recorder.all(); } catch (__e) { __h('46-calib:32', __e); }
    return all.filter((f) => f.kind === 'static' && (f.outcome === 'ko' || f.outcome === 'wipe') && f.team?.length && isFinite(+f.power) && isFinite(+f.hpPower) && Date.now() - f.at < 14 * DAY);
  }
  // remember the strength the game really used for each legendary + tier
  async function learnObserved() {
    const fs = await fights(); const next = {};
    for (const f of fs.filter((x) => !x.raid).sort((a, b) => a.at - b.at)) { const t = tierOf(f); next[`${f.foeId}:${t}`] = { hp: +f.hpPower, power: +f.power, at: f.at }; }
    obs = next; try { localStorage.setItem(OBS, JSON.stringify(obs)); } catch (__e) { __h('46-calib:39', __e); }
  }
  function zoneFor(f, t) {
    if (f.raid) return { id: f.foeId, foe: f.foeId, level: f.foeLevel || 100, static: true, raid: true, weather: null, burst: null, counter: null, hp: +f.hpPower, power: +f.power };
    let z = null; try { z = Sim.zoneOf(f.foeId, t); } catch (__e) { __h('46-calib:43', __e); }
    return { ...(z || { id: f.foeId, foe: f.foeId, level: 100, static: true }), hp: +f.hpPower, power: +f.power };
  }
  function teamFor(f) { return f.team.map((t) => E.read('Game.getMon', null, t.uid) || { uid: t.uid, id: t.id, level: t.level, bot: true, statMult: +(E.get('CONFIG')?.RAID?.BOT_STATS) || 0.9, rank: t.rank || 0 }); }
  let busy = false;
  async function fit(force = false) {
    if (busy || !E.ready()) return null;
    busy = true;
    try {
      await learnObserved();
      const fs = await fights(), groups = {};
      for (const f of fs) {
        const t = tierOf(f), ctx = ctxOf(f, t);
        const key = [f.foeId, t, (+f.power).toFixed(3), (+f.hpPower).toFixed(3), f.team.map((x) => x.uid).sort().join(',')].join('|');
        const G = (groups[ctx] ||= new Map()); const g = G.get(key) || { f, t, n: 0, ko: 0 }; g.n++; if (f.outcome === 'ko') g.ko++; G.set(key, g);
      }
      const yieldNow = () => new Promise((ok) => setTimeout(ok, 0));
      const out = { ...cal };
      for (const [ctx, G] of Object.entries(groups)) {
        const gs = [...G.values()].filter((g) => g.n >= 2).sort((a, b) => b.n - a.n).slice(0, 8);
        const n = gs.reduce((t, g) => t + g.n, 0);
        if (n < 12 || (!force && cal[ctx] && cal[ctx].n === n && Date.now() - cal[ctx].at < DAY)) continue;
        const prep = gs.map((g) => ({ g, team: teamFor(g.f), zone: zoneFor(g.f, g.t), real: g.ko / g.n }));
        const err = async (pk, hk) => { let e = 0; for (const p of prep) { let r; try { r = Sim.evaluate(p.team, p.g.f.foeId, 160, 11, null, { ...p.zone, cal: { pk, hk } }); } catch { r = { ko: 0 }; } e += p.g.n * (r.ko - p.real) ** 2; await yieldNow(); } return e / n; };
        const before = await err(1, 1);
        let best = { pk: 1, hk: 1, e: before };
        for (const pk of [0.45, 0.6, 0.75, 0.9, 1.1, 1.3, 1.55, 1.85, 2.2, 2.6]) { const e = await err(pk, 1); if (e < best.e) best = { pk, hk: 1, e }; }
        if (gs.length >= 2) for (const hk of [0.8, 0.9, 1.12, 1.25, 1.4]) { const e = await err(best.pk, hk); if (e < best.e) best = { ...best, hk, e }; }
        for (const m of [0.9, 0.95, 1.05, 1.1]) { const pk = +(best.pk * m).toFixed(3); const e = await err(pk, best.hk); if (e < best.e) best = { ...best, pk, e }; }
        // with few fights, trust the tuning only partly
        const w = Math.min(1, n / 40), pk = +(1 + (best.pk - 1) * w).toFixed(3), hk = +(1 + (best.hk - 1) * w).toFixed(3);
        out[ctx] = { pk, hk, n, groups: gs.length, errBefore: Math.sqrt(before), errAfter: Math.sqrt(best.e), at: Date.now() };
        Log.add(`simulator tuned for ${ctx === 'raid' ? 'Shiny Raids' : ctx === 'elite' ? 'elite tiers' : ctx === 'wb' ? 'the World Boss' : 'legendary zones'} from ${n} real fights: off by ${Math.round(Math.sqrt(before) * 100)} points before, ${Math.round(Math.sqrt(best.e) * 100)} after (boss power x${pk}, HP x${hk})`);
      }
      cal = out; try { localStorage.setItem(KEY, JSON.stringify(cal)); } catch (__e) { __h('46-calib:77', __e); }
      return cal;
    } finally { busy = false; }
  }
  let timer = null, newFights = 0;
  function boot() {
    if (timer) return;
    setTimeout(() => { learnObserved().catch(() => {}); }, 20_000);
    setTimeout(() => { fit().catch(() => {}); }, 90_000);
    timer = setInterval(() => { fit().catch(() => {}); }, 6 * 3_600_000);
    try { Recorder.onFight((f) => { if (f.kind === 'static') { learnObserved().catch(() => {}); if (++newFights >= 25) { newFights = 0; fit().catch(() => {}); } } }); } catch (__e) { __h('46-calib:87', __e); }
  }
  return { get, observed, fit, boot, learnObserved, tierOf, get info() { return cal; }, get observedAll() { return obs; } };
})();

/* ---------------------------------------------------------------------------------------------
 * Views: pure functions World -> HTML. No reads of their own, so what each screen shows is
 * exactly what the World snapshot says.
 * ------------------------------------------------------------------------------------------- */
// rank badge like the game's (Jimmy 2026-11-23): a Roman numeral in its pixel font "Jersey 15", gold with a dark outline
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
const RK = (n) => (+n > 0 ? `<span class="rkn" title="Rank ${+n}">${ROMAN[+n] || +n}</span>` : '');
const Views = (() => {
  const row = (k, v, cls = '') => `<div class="row"><span class="k">${k}</span><span class="v ${cls}">${v}</span></div>`;
  const yes = (b) => (b ? '<span class="ok">yes</span>' : '<span class="dim">no</span>');

  function now(w, esc, fmtIn) {
    if (!w.ok) return `<div class="note">The game engine isn't reachable, so Mega Alakazam can't show anything yet. See the Engine tab.</div>`;
    const d = w.dailies, ug = d.underground, wb = d.worldBoss;
    const scr = w.screen.kind === 'zone' ? `${esc(World.dex.name(w.screen.id))} (legendary zone)` : w.screen.kind === 'chapter' ? `Chapter ${w.screen.ch}` : esc(w.screen.label);
    const region = w.regions.find((r) => r.current);
    const run = Plan.goals.filter((g) => !g.done).length;
    let h = `<div class="note">${Plan.running ? `Your plan is running · ${run} goal${run === 1 ? '' : 's'}` : 'Your plan is paused'}${Plan.top ? ` · ${esc(Plan.top)}` : ''}</div>`;
    h += `<div class="card"><h3>Right now</h3>
      ${row('On screen', scr)}
      ${row('In a fight', yes(w.inBattle))}
      ${row('Region', esc(region?.name || w.region || '?'))}
      ${row('Level cap', w.cap ?? '?')}
      ${row('Pokémon owned', `${w.roster.length}${w.away.length ? ` <span class="dim">(${w.away.length} in the Underground)</span>` : ''}`)}</div>`;
    h += `<div class="card"><h3>Today</h3>`;
    if (ug) h += row('Underground', `${ug.left} of ${ug.perDay} left · ${ug.running}/${ug.slotsMax} bays busy${ug.finished ? ` · <span class="warn">${ug.finished} ready to collect</span>` : ug.nextBack ? ` · back in ${fmtIn(ug.nextBack)}` : ''}`);
    if (d.candy) h += row('Candy Factory', d.candy.played ? '<span class="ok">done today</span>' : d.candy.why === 'day' ? '<span class="dim">closed today</span>' : d.candy.why ? `<span class="warn">${esc(d.candy.why)}</span>` : '<span class="warn">not run yet</span>');
    if (d.tower) h += row('Battle Tower', `weekly · resets in ${fmtIn(d.tower.weekEnds)}`);
    if (d.raid) h += row('Shiny Raid', d.raid.ready ? '<span class="warn">ready to start</span>' : '<span class="dim">not ready</span>');
    h += row('World Boss', wb.caught ? '<span class="ok">caught this edition</span>' : wb.catchable ? '<span class="warn">catchable now</span>' : wb.open ? 'shield up' : '<span class="dim">closed</span>');
    h += `</div>`;
    return h;
  }

  function dex(w, prefs, esc, ui = {}) {
    if (!w.ok) return `<div class="note">Waiting for the game engine.</div>`;
    if (ui.dexOpen) return Views.dexDetail(ui.dexOpen, esc);
    const D = Engine.get('Game.DEX') || {};
    const tile = (id, extra = '') => { const st = World.dex.state(id), reg = World.dex.registered(id), d = D[id] || {};
      const now = reg ? null : DexInfo.availableNow(id);
      return `<div class="mon ${now ? 'now' : d.legendary || d.mythical ? 'leg' : ''} ${reg ? '' : st ? 'seen' : 'unk'}" data-act="dexinfo" data-id="${id}" style="cursor:pointer" title="${esc(now ? 'Can be caught right now: ' + now : 'Tap for how to get it')}"><img src="${Engine.sprite(id)}" loading="lazy">${esc(d.name || '#' + id)}${extra}</div>`; };
    const q = (prefs.q || '').trim().toLowerCase();
    let h = `<input class="q" placeholder="Search a Pokémon - tap one to see how to get it" value="${esc(prefs.q || '')}">`;
    if (q) {
      const hits = Object.values(D).filter((p) => (p.name || '').toLowerCase().includes(q)).slice(0, 24);
      if (!hits.length) h += `<div class="note">No Pokémon called "${esc(prefs.q)}".</div>`;
      else h += `<div class="grid">${hits.map((p) => tile(p.id, World.dex.registered(p.id) ? '<br><span class="ok">✓</span>' : '<br><span class="dim">missing</span>')).join('')}</div>`;
      return h;
    }
    h += Mirror.dexGrid(w, esc);
    for (const r of []) {
      const ids = DexInfo.regionIds(r.key), miss = ids.filter((id) => !World.dex.registered(id));
      const have = ids.length - miss.length;
      h += `<div class="card"><h3>${esc(r.name)} <span class="dim">${have}/${ids.length}</span></h3><div class="bar"><i style="width:${(100 * have / Math.max(1, ids.length)).toFixed(1)}%"></i></div>`;
      if (miss.length) h += `<div class="grid" style="margin-top:10px">${miss.map((id) => tile(id)).join('')}</div>`;
      else h += `<div class="ok" style="margin-top:6px">Complete.</div>`;
      h += `</div>`;
    }
    h += `<div class="note"><span class="ok">Green frame</span> = can be caught right now (wild under the current time and weather, a special encounter whose conditions are met, or an open legendary zone).</div>`;
    h += `<div class="note dim">Forms count too (Rotom's appliance forms, Deoxys formes…). Tap any Pokémon to see where it lives, what it needs and when it can appear.</div>`;
    return h;
  }


  function engine(w, esc) {
    const a = w.audit || Engine.audit(), hk = a.hook || {};
    const N = Notify.cfg, on = (b) => (b ? 'checked' : '');
    let h = `<div class="card"><h3>📱 Phone alerts</h3>
      <label class="chk"><input type="checkbox" data-act="n-on" ${on(N.on)}> Send alerts to my phone</label>
      ${Object.entries(Notify.KINDS).map(([k, t]) => `<label class="chk" style="margin-left:22px"><input type="checkbox" data-act="n-kind" data-k="${k}" ${on(N.kinds[k])} ${N.on ? '' : 'disabled'}> ${esc(t)}</label>`).join('')}
      <label class="chk"><input type="checkbox" data-act="n-quiet" ${on(N.quiet)}> Quiet hours 11 PM - 8 AM (problems still come through)</label>
      <div class="row" style="margin-top:8px"><span class="k">Topic</span><span class="v"><code>${esc(N.topic || 'none yet')}</code></span></div>
      <div class="row"><span class="k">Last alert</span><span class="v ${N.last && !N.last.ok ? 'bad' : ''}">${N.last ? (N.last.ok ? `${new Date(N.last.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · ${esc(N.last.what || '')}` : `failed: ${esc(N.last.err)}`) : 'none yet'}</span></div>
      <div class="row"><span class="k">Sent through</span><span class="v">${Remote.info?.relay ? (Notify.viaRelay ? (Notify.viaRelay.ok ? `<span class="ok">Mega Relay</span> · ${Notify.viaRelay.subs} phone${Notify.viaRelay.subs === 1 ? '' : 's'} (no ntfy limit)` : Notify.viaRelay.subs === 0 ? 'ntfy - turn on alerts in the phone app (Settings → 🔔) to use Mega Relay instead' : `ntfy (Mega Relay couldn't: ${esc(Notify.viaRelay.err || 'unknown')})`) : 'Mega Relay first, ntfy as backup') : 'ntfy'}</span></div>
      <button class="btn" data-act="n-test">Send a test</button><button class="btn" data-act="n-week">Send the Week So Far</button><button class="btn" data-act="n-new">New topic</button>
      <div class="note dim" style="margin-top:8px">Uses the free <b>ntfy</b> app: on your iPhone install ntfy, tap +, "Subscribe to topic", type the topic above exactly. Mega took over Alakazam 4.x's topic, so if 4.x alerts reach your phone, these will too - then turn off "Send alerts to my phone" in 4.x so you don't get everything twice.</div></div>`;
    try { const r = XpChap.rank().slice(0, 6), best = r[0];
      h += `<div class="card"><h3>📈 Leveling Chapters</h3><div class="dim" style="font-size:var(--t-s)">XP per hour = the game's XP formula for each chapter's wild Pokémon x the wins per hour Mega measures while training there. Close calls (within 10%) get a 10-minute check before Mega settles. Estimates for chapters with a leader you might lose to count less (your strongest six simulated against that leader).</div>${r.map((x) => `<div class="row"><span class="k">${x === best ? '⭐ ' : ''}${esc(x.name)} <span class="dim">Lv ${x.top}</span></span><span class="v">${XpChap.fmt(x.xpHr)} XP/h <span class="dim">· ${XpChap.fmt(x.perWin)}/win · ${Math.round(x.rate)} wins/h ${x.real ? 'measured' : x.learned ? `wins measured (${x.min} min)` : 'estimated'}${x.risk < 0.995 ? ` · <span class="warn">x${x.risk.toFixed(2)} for the chance of losing to the leader</span>` : ''}</span></span></div>`).join('') || '<div class="dim">No chapters yet.</div>'}</div>`; } catch (__e) { __h('50-views:78', __e); }
    // ---- health: self-test + every swallowed error, by place ----
    try {
      const T = Health.test, R = Health.recent(), when = (t) => new Date(t).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
      // restore Mega's own data from a file (2026-11-23: the game moved to pokecatch-online.app and the browser keeps each
      // address's storage apart, so the plan, phone pairing and settings stayed behind on the old address)
      h += `<div class="card"><h3>📦 Restore Mega Data</h3><div class="dim">Load a saved copy of Mega's data (a .json file of its entries): your plan, phone pairing and settings. Only Mega's own entries are written (the ones starting with "mega-"); the game's save is never touched. The page reloads afterwards.</div>
        <label class="btn" style="margin-top:8px;display:block;text-align:center;cursor:pointer">Choose File…<input type="file" accept=".json,application/json" data-act="restore-file" style="display:none"></label></div>`;
      h += `<div class="card"><h3>🩺 Health</h3>`;
      h += T ? `<div class="row"><span class="k">Self-test</span><span class="v ${T.failed ? 'bad' : 'ok'}">${T.failed ? `${T.failed} of ${T.n} failed` : `all ${T.n} passed`}${T.warns ? ` <span class="warn">· ${T.warns} warning${T.warns === 1 ? '' : 's'}</span>` : ''}</span></div><div class="row"><span class="k">Last run</span><span class="v dim">${esc(when(T.at))} · v${esc(T.v)} · ${esc(T.why)}</span></div>${(T.results || []).map((r) => `<div class="note ${r.warn ? '' : 'bad'}" style="margin-top:4px"><b>${r.warn ? '⚠' : '✖'} ${esc(r.name)}</b><br>${esc(r.detail || '')}</div>`).join('')}` : '<div class="dim">The self-test hasn\'t run yet.</div>';
      h += `<button class="btn" data-act="health-test">Run Self-Test</button>`;
      h += `<div class="row" style="margin-top:8px"><span class="k">Errors (24 h)</span><span class="v ${R.length ? 'warn' : 'ok'}">${R.length ? `${R.reduce((t, x) => t + (x.n || 0), 0)} in ${R.length} place${R.length === 1 ? '' : 's'}` : 'none'}</span></div>`;
      h += R.slice(0, 8).map((x) => `<div class="row"><span class="k" style="font-size:var(--t-s)">${esc(x.site)} ×${x.n}</span><span class="v dim" style="font-size:var(--t-s)">${esc(x.msg || '')} · ${esc(when(x.last))}</span></div>`).join('');
      if (R.length) h += `<button class="btn" data-act="health-clear">Clear the Error List</button>`;
      h += `<div class="note dim" style="margin-top:8px">Mega checks every goal, planner and screen against your save after each update. A new version that fails is rolled back to the one before by itself, and your phone gets an alert. A goal that keeps failing (5 errors in 30 min) alerts you too.</div></div>`;
    } catch (__e) { __h('50-views:93', __e); }
    { const U = Updater.info, av = Updater.available;
      h += `<div class="card"><h3>⬆ Updates</h3><div class="row"><span class="k">This version</span><span class="v">${esc(VERSION)}</span></div><div class="row"><span class="k">Newest on GitHub</span><span class="v ${U.err ? 'bad' : ''}">${U.err ? 'could not check: ' + esc(U.err) : U.latest ? esc(U.latest) + (av ? ' <span class="ok">· ready</span>' : ' · up to date') : 'checking…'}</span></div>${U.checkedAt ? `<div class="row"><span class="k">Checked</span><span class="v dim">${new Date(U.checkedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span></div>` : ''}
        ${av ? `<button class="btn" data-act="update">New Update ${esc(av)}</button>` : ''}<button class="btn" data-act="update-check">Check now</button>
        <label class="chk" style="margin-top:6px"><input type="checkbox" data-act="update-auto" ${Updater.auto ? 'checked' : ''}> Reload the game by itself to run an update (at a safe moment)</label>
        <label class="chk"><input type="checkbox" data-act="update-continue" ${Updater.autoContinue ? 'checked' : ''}> Press Continue on the title screen after a reload</label>
        <button class="btn" data-act="update-tm">Install in Tampermonkey too</button>
        <div class="note dim" style="margin-top:8px">Mega checks every 10 minutes and downloads a new version by itself; it runs the next time the game reloads (Mega reloads it at a safe moment - not during a zone, raid, tower or league - or use Reload Game on Kinesis). A version that fails to start is skipped and this one keeps running. "Install in Tampermonkey too" makes it permanent there (optional - Tampermonkey also catches up by itself).</div></div>`; }
    try { h += `<div class="card"><h3>🔗 Goal Chains</h3><label class="chk"><input type="checkbox" data-act="chains-on" ${Chains.on ? 'checked' : ''}> When a legendary is locked, add the goals it needs (catches, items, a Pokédex, a League)</label><div class="dim" style="font-size:var(--t-s)">Checked every 30 minutes. A goal you remove isn't added back for the same legendary. Things Mega can't do (braille doors, trainer counts) show as "needs you" on the goal.</div></div>`; } catch (__e) { __h('50-views:101', __e); }
    { // text size (2.13.5: moved here from the header, so the header keeps its fold button inside the panel)
      let i = 2; try { i = JSON.parse(localStorage.getItem('mega-alakazam-ui') || '{}').scaleIdx ?? 2; } catch (__e) { __h('50-views:103', __e); }
      const pct = [100, 110, 120, 132, 145, 160][Math.max(0, Math.min(5, i))];
      h += `<div class="card"><h3>🔠 Text size</h3><div class="row"><span class="k">Mega's text</span><span class="v"><b>${pct}%</b></span></div><div class="btns"><button class="btn" data-act="smaller" ${i <= 0 ? 'disabled' : ''}>A− Smaller</button><button class="btn" data-act="bigger" ${i >= 5 ? 'disabled' : ''}>A+ Bigger</button></div><div class="dim" style="font-size:var(--t-s);margin-top:6px">The panel gets wider with bigger text, up to about 40% of the screen.</div></div>`;
    }
    h += `<div class="card"><h3>🗂️ Tabs</h3><div class="dim" style="font-size:var(--t-s)">Drag a tab at the top onto another to move it. Your order is saved.</div><button class="btn" data-act="tabs-reset" style="margin-top:6px">Reset tab order</button></div>`;
    { const ci = Calib.info, names = { raid: 'Shiny Raids', elite: 'Elite tiers', zone: 'Legendary zones' };
      const rows = Object.entries(names).map(([k, l]) => { const c = ci[k]; return `<div class="row"><span class="k">${l}</span><span class="v">${c ? `off by ${Math.round(c.errAfter * 100)} pts <span class="dim">(was ${Math.round(c.errBefore * 100)}) · ${c.n} fights · ${new Date(c.at).toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>` : '<span class="dim">not enough fights yet (needs 12)</span>'}</span></div>`; }).join('');
      h += `<div class="card"><h3>🎯 Simulator Accuracy</h3><div class="dim" style="font-size:var(--t-s)">Every boss fight is recorded. Once a day Mega replays them in the simulator and tunes it until its KO predictions match what really happened - so team picks and the 🥊 numbers on your phone stay honest. "Off by" is the average gap between predicted and real KO rates.</div>${rows}<button class="btn" data-act="calib-run">Tune Now</button></div>`; }
    { const G = Guard.results, list = Guard.CHECKS.map((c) => { const r = G[c.key]; return `<div class="row"><span class="k">${esc(c.label)}</span><span class="v ${r && !r.ok ? 'bad' : ''}">${!r ? 'not checked yet' : r.ok ? '<span class="ok">● looks right</span>' : esc(r.why)}</span></div>`; }).join('');
      h += `<div class="card"><h3>🛡️ Safety Checks</h3><div class="dim" style="font-size:var(--t-s)">Before Mega starts anything you can't take back (Candy Factory, Shiny Raid, Underground, World Boss, elite zones, Elite League), it reads back the team the game will really use and won't start if it's short, too low, away or not the one it picked. Every 10 minutes it also checks the game data each goal relies on; anything that looks wrong after a game update pauses just those goals.</div>${list}<button class="btn" data-act="guard-run">Check Now</button></div>`; }
    { const R = Remote.info, ago = R.lastSent ? Math.round((Date.now() - R.lastSent) / 1000) : null;
      h += `<div class="card"><h3>📱 Kinesis (Phone App)</h3>
      <label class="chk"><input type="checkbox" data-act="rm-on" ${R.on ? 'checked' : ''}> Let my phone see and control Mega</label>
      ${R.on ? `<div style="margin-top:6px">${R.lastErr ? `<span class="warn">${esc(R.lastErr)}</span>` : ago != null ? `<span class="ok">●</span> ${R.relay ? 'live (every second)' : R.watched ? 'phone open - live' : 'phone closed - updates every hour'} · last update ${ago < 60 ? ago + ' s' : Math.round(ago / 60) + ' min'} ago` : 'starting…'}</div>
      <label class="chk" style="margin-top:6px"><input type="checkbox" data-act="rm-relay" ${R.relay ? 'checked' : ''}> Use Mega Relay on this PC (no outside service, no limits)</label>
      ${R.relay ? `<div class="${R.relayOk ? 'ok' : 'warn'}" style="font-size:var(--t-s)">${R.relayOk ? '● Mega Relay is running - live numbers every second. On your phone open your PC\'s Tailscale address.' : R.relayOk === false ? 'Mega Relay isn\'t running: start it with start-mega-relay on this PC.' : 'checking Mega Relay…'}</div>` : ''}
      ${R.relay ? '' : `<div class="dim" style="font-size:var(--t-s)">ntfy messages today: ${R.used} of ${R.budget} for the remote (ntfy's free limit is about 250 a day, shared with phone alerts). For live updates with no limit, use Mega Relay above.</div>`}
      <button class="btn gold" data-act="rm-pair" ${Notify.cfg.topic ? '' : 'disabled'}>Send Setup Link to My Phone</button>
      <button class="btn" data-act="rm-rekey">New Keys (Unpair Every Phone)</button>` : ''}
      <div class="note dim" style="margin-top:8px">Kinesis is a web page for your phone (${esc(R.page)}): the Now screen, your plan (start, pause, add, remove, reorder), the Pokédex with its "ways to get it", legendary sims and settings - while the game keeps running here. Everything goes through ntfy.sh encrypted with a key only this PC and your phone have. Trades and gems still need the game window. The setup link arrives as a phone alert: tap it once on your iPhone, then add the page to your Home Screen.</div></div>`; }
    h += `<div class="card"><h3>💤 When the Plan Is Idle</h3>
      <label class="chk"><input type="checkbox" data-act="idle-level" ${Plan.idleOn ? 'checked' : ''}> Level Pokémon when every goal is done or waiting</label>
      <div class="note dim" style="margin-top:8px">After 2 minutes with nothing to run, Mega levels three at a time: Pokémon that took a gem first, then shinies, then the ones closest to Lv 100 (up to your level cap). It uses the best training chapter with carriers and a Pinap Berry, keeps that chapter looping so the story never moves on by itself, sends a phone alert, and puts your team, buddy and chapter back as soon as a real goal is ready.</div></div>`;
    h += `<div class="card"><h3>🍓 Berries</h3>
      <label class="chk"><input type="checkbox" data-act="berries" ${Berries.on ? 'checked' : ''}> Use berries while goals run</label>
      <div class="note dim" style="margin-top:8px">One at a time, only for the goal that's running, never replacing a stronger one: Enigma + Razz while catching a missing Pokémon in the wild, Golden Razz (or Razz) at a legendary or special encounter, Pinap while leveling, Lansat while farming money, Starf + Nanab while hunting a shiny, Rowap while chasing a roaming legendary (it doubles how long it stays put).</div>
      ${berryRows(esc)}</div>`;
    h += (() => {
      let L = []; try { L = MoveTune.list(); } catch (__e) { __h('50-views:131', __e); }
      const nm = (id) => { try { return Casing.names(Engine.get('Game.DEX')[id].name); } catch { return '#' + id; } };
      return `<div class="card"><h3>🥋 Moves</h3>
      <label class="chk"><input type="checkbox" data-act="movetune" ${MoveTune.on ? 'checked' : ''}> Let Mega turn status moves on and off before boss fights</label>
      <div class="note dim" style="margin-top:8px">In a fight, a Pokémon with a status move (sleep, burn, paralysis…) uses it about 1 turn in 3 instead of attacking. Before a Legendary or Elite fight, Mega simulates each team member with its status moves on and off and keeps a change only when the fight clearly improves - the same as tapping the move on the Pokémon's card. Damaging moves and anything you turned off yourself are never touched.</div>
      ${L.length ? `<div style="margin-top:8px">${L.map((x) => `<div class="row"><b>${esc(nm(x.id))}</b><span class="dim">off: ${esc(x.off.join(', '))}</span></div>`).join('')}</div><button class="btn sm" data-act="movetune-back" style="margin-top:8px">Give Back Every Move Mega Turned Off</button>` : '<div class="dim" style="margin-top:8px">No moves turned off by Mega right now.</div>'}</div>`;
    })();
    h += `<div class="card"><h3>🃏 Popups that stop the game</h3>
      <label class="chk"><input type="checkbox" data-act="cards" ${Cards.on ? 'checked' : ''}> Close the new-Pokémon card and the end-of-run recap</label>
      <div class="note dim" style="margin-top:8px">The game stands still while these are open, so an unattended catch or Tower run would stall your plan. Mega taps Continue / the gold button after a few seconds - never while you're clicking in the game, and never any other popup (the "Two saves found" dialog, trades, shop and settings are never touched).</div></div>`;
    h += `<div class="card"><h3>Connection</h3>
      ${row('Mega Alakazam', 'v' + esc(VERSION))}
      ${row('Engine hook', hk.ok ? '<span class="ok">connected</span>' : `<span class="bad">${esc(hk.reason || 'not loaded')}</span>`)}
      ${row('Game build', esc(hk.bundle || '?'))}
      ${row('Hooked by', esc(hk.by || 'probe 0.1'))}
      ${a.ready ? row('Functions in use', `${Engine.REQUIRED.length - a.missing.length}/${Engine.REQUIRED.length}`, a.missing.length ? 'warn' : 'ok') : ''}</div>`;
    if (!a.ready) h += `<div class="note">Not connected, so nothing can be checked. Mega Alakazam stays read-only until the hook connects (usually after the next reload).</div>`;
    else if (a.missing.length) h += `<div class="card"><h3>Missing after a game update</h3>${a.missing.map((p) => `<div><code>${esc(p)}</code></div>`).join('')}</div>`;
    h += `<div class="card"><h3>Never called (safety rules)</h3><div class="dim" style="font-size:var(--t-s)">${[...Engine.FORBIDDEN].map((p) => `<code>${esc(p)}</code>`).join(' · ')}</div></div>`;
    return h;
  }

  // fights: data = { list: [fights], at } loaded async by the UI
  function fights(w, data, prefs, esc) {
    const cur = Recorder.current;
    let h = '';
    if (cur && !cur.skip) h += `<div class="note">Recording now: <b>${esc(World.dex.name(cur.foeId))}</b> · ${cur.events.length} actions so far${cur.complete ? '' : ' (joined mid-fight, so it won\u2019t count toward the KO rate)'}</div>`;
    else h += `<div class="note">Mega records every legendary, raid and boss fight in the background. Only fights watched from the first turn count toward the KO rate.</div>`;
    if (!data) return h + '<div class="dim">Loading…</div>';
    if (!data.list.length) return h + '<div class="dim">No fights recorded yet.</div>';
    const byFoe = new Map();
    for (const f of data.list) { const a = byFoe.get(f.foeId) || []; a.push(f); byFoe.set(f.foeId, a); }
    for (const [id, list] of [...byFoe.entries()].sort((a, b) => b[1][0].at - a[1][0].at)) {
      const A = Analyse.foe(list), open = prefs.foe === String(id);
      const rate = A.koRate == null ? '<span class="dim">no complete fights yet</span>' : `<b class="${A.koRate >= 0.8 ? 'ok' : A.koRate >= 0.5 ? 'warn' : 'bad'}">${Math.round(A.koRate * 100)}% KO</b> <span class="dim">(${A.ko}/${A.ko + A.wipe})</span>`;
      const legend = (() => { try { const d = Engine.get('Game.DEX')?.[id] || {}; return !!(d.legendary || d.mythical || Engine.read('Game.isLegend', false, id)); } catch { return false; } })();
      h += `<div class="card" data-sec="${legend ? 'leg' : 'other'}"><div data-act="foe" data-foe="${id}" style="display:flex;gap:8px;align-items:center;cursor:pointer"><img src="${Engine.sprite(id)}" width="40" height="40" style="image-rendering:pixelated">
        <div style="flex:1"><b>${esc(World.dex.name(id))}</b> <span class="dim">${list.length} fight${list.length === 1 ? '' : 's'}</span><div>${rate}</div></div><span class="dim">${open ? '▾' : '▸'}</span></div>`;
      if (open) {
        h += row('Turns to KO / to wipe', `${A.turnsKo ? A.turnsKo.toFixed(1) : '-'} / ${A.turnsWipe ? A.turnsWipe.toFixed(1) : '-'}`);
        h += row(`${esc(World.dex.name(id))}'s hit on one target`, A.bossHit ? `${Math.round(A.bossHit)} <span class="dim">(${A.bossHitN})</span>` : '-');
        h += row('Rage burst on each of yours', A.burst ? `${Math.round(A.burst)} <span class="dim">(${A.burstN})</span>` : '-');
        for (const t of A.ticks) h += row(`${t.st === 'burn' ? 'Burn' : 'Poison'} tick on ${esc(World.dex.name(id))}`, `<b class="ok">${Math.round(t.avg)}</b> <span class="dim">(${t.n} ticks)</span>`);
        if (A.statusShare != null && A.ticks.length) h += row('Damage from poison / burn', `<b>${Math.round(A.statusShare * 100)}%</b> <span class="dim">of all damage dealt</span>`);
        h += row('Counter-hit on one of yours', A.counter ? `${Math.round(A.counter)} <span class="dim">(${A.counterN})</span>` : '-');
        h += `<div style="margin-top:6px;font-weight:700;color:var(--ink)">Your damage per action</div>`;
        for (const t of A.attackers) h += `<div class="row"><span class="k" style="display:flex;align-items:center;gap:6px"><img src="${Engine.sprite(t.id)}" width="28" height="28" style="image-rendering:pixelated">${esc(World.dex.name(t.id))}${t.shiny ? ' ✨' : ''}${t.rank ? ` r${t.rank}` : ''}</span><span class="v">${t.avg ? Math.round(t.avg) : '-'} <span class="dim">· ${t.n} actions${t.missRate ? `, ${Math.round(t.missRate * 100)}% no damage` : ''}</span></span></div>`;
      }
      h += `</div>`;
    }
    return h;
  }

  return { now, dex, engine, fights, row };
})();

// Settings › Berries: each boost berry on/off and how many to keep (Mega stops using it at that number)
function berryRows(esc) {
  const FAM = { capture: 'catching', dex: 'missing Pokémon', rare: 'rare finds', xp: 'XP', money: 'money', shiny: 'shiny hunts', roam: 'roaming legendaries' };
  let L = []; try { L = Berries.list(); } catch { return ''; }
  const nm = (k) => { try { return DexInfo.itemName(k) || k; } catch { return k; } };
  return `<div style="margin-top:10px">${L.map((b) => `<div class="row" style="align-items:center;gap:8px">
    <label class="chk" style="flex:1;margin:0"><input type="checkbox" data-act="berry-on" data-k="${esc(b.key)}" ${b.off ? '' : 'checked'}> <b>${esc(nm(b.key))}</b> <span class="dim">· ${esc(FAM[b.family] || b.family)} ×${b.mult} · you have ${b.have}${b.active ? ' · <span class="ok">active</span>' : ''}</span></label>
    <span class="dim" style="font-size:var(--t-s)">keep</span><input type="number" min="0" max="9999" inputmode="numeric" data-act="berry-keep" data-k="${esc(b.key)}" value="${b.keep}" style="width:64px"></div>`).join('')}
    <div class="dim" style="font-size:var(--t-s);margin-top:4px">Unchecked: Mega never uses that berry (it uses a weaker one of the same kind if it has one). Keep: Mega stops when you're down to that many.</div></div>`;
}

/* ---------------------------------------------------------------------------------------------
 * Icons: one consistent set instead of colour emoji. Mega's screens were written with emoji as
 * icons; swap() turns the ones that mean something into drawn icons (design/field.css .ic-*),
 * turns a few into plain symbols, and drops the purely decorative ones. Only text is touched,
 * never tags or attributes. Shared with Kinesis (copied in at publish), so both look the same.
 * ------------------------------------------------------------------------------------------- */
const Icons = (() => {
  const ICON = { '✨': 'shiny', '⭐': 'star', '📍': 'pin', '🕒': 'clock', '⏳': 'clock', '🥚': 'egg', '🐣': 'egg', '🔔': 'bell', '💰': 'coin',
    '🏆': 'trophy', '🎖': 'trophy', '⚔': 'fight', '🥊': 'fight', '🛡': 'shield', '⚠': 'warn', '⏸': 'pause', '👥': 'team',
    '⛏': 'pick', '🗼': 'tower', '🍬': 'candy', '🌍': 'globe', '📘': 'book', '🎁': 'gift', '👻': 'ghost' };
  const GLYPH = { '⬆': '↑', '🔄': '⟳', '🟢': '●' };
  const DROP = ['🎯', '💛', '📱', '💤', '✏', '🩺', '🗂', '🔗', '📈', '🍓', '⚡'];
  const keys = [...Object.keys(ICON), ...Object.keys(GLYPH), ...DROP].sort((a, b) => b.length - a.length);
  const RE = new RegExp(`(${keys.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\uFE0F?( ?)`, 'gu');
  // in text: icon <i>, symbol, or nothing; inside <option> (no tags allowed there): symbol or nothing
  const one = (plain) => (m, k, sp) => ICON[k] ? (plain ? '' : `<i class="ic ic-${ICON[k]}"></i>${sp}`) : GLYPH[k] ? GLYPH[k] + sp : '';
  function swap(html) {
    if (!html) return html;
    RE.lastIndex = 0;
    let inOpt = false;
    return String(html).split(/(<[^>]+>)/).map((part) => {
      if (part.startsWith('<')) { if (/^<option\b/i.test(part)) inOpt = true; else if (/^<\/option/i.test(part)) inOpt = false; return part; }
      // a spaced hyphen used as a dash reads as one ("won today – next raid 3 PM")
      return part.replace(RE, one(inOpt)).replace(/ - /g, ' – ');
    }).join('');
  }
  return { swap };
})();

/* ---------------------------------------------------------------------------------------------
 * Casing (Jimmy's preference): proper Title Case for headings, labels, buttons, tabs and menu
 * choices, and the game's terms written as names everywhere else. Runs on the rendered panel.
 * ------------------------------------------------------------------------------------------- */
const Casing = (() => {
  const SMALL = new Set(['a', 'an', 'the', 'and', 'or', 'nor', 'but', 'of', 'in', 'on', 'at', 'to', 'for', 'by', 'vs', 'via', 'with', 'per', 'from', 'as', 'if', 'than', 'into']);
  // game terms, wherever they appear
  const TERMS = [
    ['legendary zones', 'Legendary Zones'], ['legendary zone', 'Legendary Zone'], ['special encounters', 'Special Encounters'], ['special encounter', 'Special Encounter'],
    ['day care', 'Day Care'], ['battle tower', 'Battle Tower'], ['candy factory', 'Candy Factory'], ['shiny raids', 'Shiny Raids'], ['shiny raid', 'Shiny Raid'],
    ['the underground', 'the Underground'], ['world boss', 'World Boss'], ['pokédex', 'Pokédex'], ['item stop', 'Item Stop'], ['rare find', 'Rare Find'],
    ['pinap berry', 'Pinap Berry'], ['pinap berries', 'Pinap Berries'], ['manaphy egg', 'Manaphy Egg'], ['griseous orb', 'Griseous Orb'],
  ].map(([k, v]) => [new RegExp(`(^|[^\\p{L}])${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}])`, 'giu'), v]);
  const terms = (s) => { for (const [re, v] of TERMS) s = s.replace(re, (m, pre) => pre + v); return s; };
  function title(s) {
    let first = true;
    return s.replace(/[\p{L}\p{N}'’.]+/gu, (w, off, all) => {
      const prev = all.slice(0, off).trimEnd().slice(-1);
      const start = first || /[(:·–—\-|/]/.test(prev);
      first = false;
      if (/\d/.test(w) || /[A-Z].*[A-Z]/.test(w) || /^[A-Z]/.test(w) && w.length > 1 && w !== w[0] + w.slice(1).toLowerCase()) return w; // KO, Lv, Ch51, XP…
      if (/^[A-Z]$/.test(w)) return w; // a capital letter on its own is meant ("Tier A"); the article is written lowercase
      if (!start && SMALL.has(w.toLowerCase())) return w.toLowerCase();
      return w[0].toUpperCase() + w.slice(1);
    });
  }
  // English place names (Jimmy plays in English; the game's data is written in French): the game's own
  // dictionary (I18N.en), limited to chapter / stop / region / badge names so sentences aren't touched.
  // Runs on everything shown, so names already saved in goals and the log come out in English too.
  let NAMES = null, namesAt = 0;
  function namesMap() {
    if (NAMES && Date.now() - namesAt < 600_000) return NAMES;
    const lang = (document.documentElement.lang || 'en').slice(0, 2), dict = Engine.get('I18N')?.[lang];
    const chs = Engine.get('STORY.CHAPTERS') || [];
    if (!chs.length || !Engine.get('I18N')) return []; // game not loaded yet: try again next time
    if (!dict || lang === 'fr') { NAMES = []; namesAt = Date.now(); return NAMES; }
    const keys = new Set();
    for (const c of chs) {
      for (const k of [c.name, c.region, c.badge, c.zone]) if (typeof k === 'string') keys.add(k);
      for (const st of c.steps || []) for (const k of [st.name, st.region, st.badge, st.place, st.leader]) if (typeof k === 'string') keys.add(k);
    }
    for (const r of Engine.get('STORY.REGIONS') || []) if (typeof r.name === 'string') keys.add(r.name);
    for (const z of Engine.get('LegendZones.ZONES') || []) for (const k of [z.zone, z.at, z.place]) if (typeof k === 'string') keys.add(k);
    const pairs = [...keys].filter((k) => k.length > 2 && typeof dict[k] === 'string' && dict[k] !== k).sort((a, b) => b.length - a.length);
    const esc = (k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    NAMES = [];
    for (let i = 0; i < pairs.length; i += 200) { // a few big regexes instead of hundreds of small ones
      const part = pairs.slice(i, i + 200), map = new Map(part.map((k) => [k, dict[k]]));
      NAMES.push([new RegExp(`(^|[^\\p{L}])(${part.map(esc).join('|')})(?![\\p{L}])`, 'gu'), map]);
    }
    namesAt = Date.now();
    return NAMES;
  }
  const memo = new Map(); // the panel re-renders every 2 s with mostly the same text
  function names(s) {
    if (!s || !/\p{L}/u.test(s)) return s;
    const hit = memo.get(s); if (hit !== undefined) return hit;
    let v = s; const list = namesMap();
    if (!list.length) return s;
    try { for (const [re, map] of list) v = v.replace(re, (m, pre, k) => pre + (map.get(k) ?? k)); } catch (__e) { __h('54-case:60', __e); }
    if (s.length < 2000) { if (memo.size > 3000) memo.clear(); memo.set(s, v); } // big texts (whole phone updates) aren't kept
    return v;
  }
  const TITLE = 'h3, .row > .k, .tabs button, button.btn, option, summary, label.chk, .gt';
  function textNodes(el, fn) { const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); const list = []; while (w.nextNode()) list.push(w.currentNode); for (const n of list) { const v = fn(n.nodeValue); if (v !== n.nodeValue) n.nodeValue = v; } }
  // French names still in a text (for the self-test): every hit is a place that skipped names()
  function leftover(s) {
    const out = new Set();
    for (const [re] of namesMap()) { re.lastIndex = 0; for (const m of String(s || '').matchAll(re)) out.add(m[2]); }
    return [...out];
  }
  function apply(root) {
    if (!root) return;
    textNodes(root, (t) => terms(names(t)));
    for (const el of root.querySelectorAll('[title]')) { const v = names(el.getAttribute('title')); if (v !== el.getAttribute('title')) el.setAttribute('title', v); } // hover text too
    for (const el of root.querySelectorAll(TITLE)) {
      if (el.closest('[data-raw]')) continue;
      // label.chk: only its own words (not nested inputs)
      textNodes(el, (t) => (t.trim() ? title(t) : t));
    }
  }
  return { apply, title, terms, names, leftover };
})();

/* ---------------------------------------------------------------------------------------------
 * Legends: every legendary zone, straight from the game (LegendZones.ZONES, forms included),
 * with the game's own state ('done' caught / 'open' / 'closed' time window / 'locked'), its
 * unlock checklist (LegendZones.progress) and its day/night window (LegendZones.whenText).
 * Plus a small cache of simulated best teams and the real record of each team from Recorder.
 * ------------------------------------------------------------------------------------------- */
const Legends = (() => {
  const E = Engine;
  const safe = (f, d = null) => { try { const v = f(); return v === undefined ? d : v; } catch { return d; } };
  const LZ = () => E.get('LegendZones');
  const SIM_KEY = 'mega-sim';

  function list() {
    const zs = [...(E.get('LegendZones.ZONES') || [])];
    // the World Boss zone (Arceus, #493): game 0.5.10 keeps it out of ZONES - add it so it can be simulated like the rest
    if (!zs.some((z) => z.wb)) { const wb = safe(() => LZ().get(493), null); if (wb?.wb) zs.push(wb); }
    const DX = E.get('Game.DEX') || {}, owns = (id) => !!safe(() => E.read('Game.owns', false, id), false);
    return zs.map((z) => {
      const p = safe(() => LZ().progress(z));
      // weekly forms (Deoxys at Birth Island): the game offers one form you don't own each week, picked at the
      // weekly reset (LegendZones.foe = this week's); each form has its own strength (formKnobs)
      let forms = null, form = null, allForms = null, kn = null;
      if (Array.isArray(z.forms) && z.forms.length) {
        forms = z.forms.map((id) => ({ id, name: DX[id]?.name || '#' + id, owned: owns(id) }));
        allForms = forms.every((f) => f.owned);
        form = allForms ? null : safe(() => +LZ().foe(z), null) || null;
        kn = form && form !== z.id ? (z.formKnobs || {})[form] || null : null;
      }
      return {
        id: z.id, name: (z.wb ? 'World Boss: ' : '') + (DX[z.id]?.name || '#' + z.id), wb: !!z.wb, region: z.region, place: z.zone || z.at,
        level: z.level, hp: kn?.hp ?? z.hp, power: kn?.power ?? z.power, burst: z.burst, weather: z.weather || null,
        forms, form, formName: form ? DX[form]?.name || null : null, allForms,
        state: safe(() => LZ().state(z), 'locked'), when: safe(() => LZ().whenText(z)),
        progress: p ? { text: p.text, have: p.have, need: p.need, braille: !!p.braille, lines: (p.lines || []).map((l) => ({ text: l.text, have: l.have, need: l.need })) } : null,
      };
    });
  }
  // roaming legendaries (no zone): from the game's ROAMING groups and its Roaming module
  function roamers() {
    const C = E.get('CONFIG') || {}, R = C.ROAMING || {}, DX = E.get('Game.DEX') || {}, S = E.get('Game.S') || {}, ST = E.get('STORY');
    const out = [];
    for (const g of R.GROUPS || []) for (const id of g.ids) {
      const caught = (S.roam?.caught || []).includes(id) || !!safe(() => E.read('Game.owns', false, id), false);
      const free = !caught && !!safe(() => E.get('Roaming').free(id), false);
      const at = S.roam?.at?.[id];
      const z = safe(() => Sim.roamZone(id));
      const chName = at ? safe(() => Casing.names(ST.CHAPTERS[at.ch].name), 'a chapter') : null;
      out.push({
        id, name: DX[id]?.name || '#' + id, region: (g.regions || [])[0] || '', roam: true, level: z?.level || R.MIN_LEVEL || 100, hp: z?.hp, power: z?.power, weather: z?.weather || null,
        place: at ? `roaming in ${chName}` : 'roaming', state: caught ? 'done' : free ? (at ? 'open' : 'closed') : 'locked',
        when: at ? `in ${chName} until ${new Date(at.until).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}, then it moves` : free ? 'between spots - it shows up again shortly' : null,
        progress: free || caught ? null : { text: `Become ${safe(() => Casing.names(g.unlock), g.unlock)} to set it roaming`, have: 0, need: 1, lines: [] },
        forms: null, form: null, formName: null, allForms: null,
      });
    }
    return out;
  }
  const listAll = () => [...list(), ...safe(() => roamers(), [])];
  const get = (id) => listAll().find((x) => x.id === +id) || null;

  // simulated best teams (kept per legendary until you ask again)
  const sims = () => { try { return JSON.parse(localStorage.getItem(SIM_KEY) || '{}'); } catch { return {}; } };
  function saveSim(id, r) {
    const all = sims();
    all[id] = { uids: r.team.map((m) => m.uid), ko: r.final.ko, today: r.today ? r.today.ko : r.final.ko, toLevel: r.toLevel || [], asMax: !!r.asMax, rounds: r.final.rounds, current: r.current ? r.current.ko : null, at: r.at };
    try { localStorage.setItem(SIM_KEY, JSON.stringify(all)); } catch (__e) { __h('55-legends:66', __e); }
    return all[id];
  }

  // the real record of one exact team against one legendary (fights watched from the start)
  async function realFor(id, uids) {
    const key = [...uids].sort().join(',');
    const fights = (await Recorder.all(id)).filter((f) => f.complete && [...f.team.map((t) => t.uid)].sort().join(',') === key);
    const ko = fights.filter((f) => f.outcome === 'ko').length;
    const lost = fights.filter((f) => f.outcome === 'wipe' || (f.outcome === 'left' && f.endBoss > 0)).length;
    return { fights: fights.length, ko, lost, rate: ko + lost ? ko / (ko + lost) : null };
  }

  function dropSim(id) { const all = sims(); delete all[id]; try { localStorage.setItem(SIM_KEY, JSON.stringify(all)); } catch (__e) { __h('55-legends:79', __e); } }
  return { list: listAll, zones: list, roamers, get, sims, saveSim, dropSim, realFor };
})();

/* ---------------------------------------------------------------------------------------------
 * DexInfo: how to get any Pokémon (forms included), straight from the game's data.
 *   wild      - chapters/routes where it spawns, chance, and when (time / weather)
 *   special   - fixed special-encounter stops (STORY.CHAPTERS steps of kind 'static'): the game
 *               decides them when a chapter is BUILT - right time of day, right weather at that
 *               place, prerequisites owned, then a chance roll. Weather is hourly per place and
 *               WEATHER.hours(place) is the game's own forecast.
 *   evolve    - from which Pokémon, by level / item
 *   legend    - its legendary zone, unlock checklist and time window
 *   forms     - every form sharing its Pokédex number
 * Read-only: nothing here changes the game.
 * ------------------------------------------------------------------------------------------- */
const DexInfo = (() => {
  // Items live in a side's bag: while you're on a new region's side (Unova), your older regions' bag
  // is the game's stash (link.stash), so count an item from the bag of the chapter it's used in.
  function itemFor(item, ch) {
    const s = Engine.get('Game.S') || {}, link = s.link;
    const here = +Engine.read('Game.itemCount', 0, item) || 0;
    if (!link || !link.stash || ch == null) return here;
    let reg = null; try { reg = Engine.get('STORY').regionOf(ch)?.key; } catch (__e) { __h('56-dexinfo:20', __e); }
    const side = reg === link.to ? 'to' : 'from';
    return side === link.side ? here : +(link.stash.items || {})[item] || 0;
  }
  const E = Engine;
  const S = () => E.get('Game.S') || {};
  const D = () => E.get('Game.DEX') || {};
  const name = (id) => D()[id]?.name || '#' + id;
  const safe = (f, d = null) => { try { const v = f(); return v === undefined ? d : v; } catch { return d; } };
  const pct = (x) => (x >= 0.1 ? Math.round(x * 100) : Math.round(x * 1000) / 10) + '%';
  const WX = { rain: 'rain', storm: 'storm', sun: 'sun', snow: 'snow', blizzard: 'blizzard', ash: 'ash', fog: 'fog', sand: 'sandstorm' };
  // the game's own English names (sun = "Harsh sunlight", ash = "Ashfall", sand = "Sandstorm")
  const wxName = (k) => (k ? (() => { try { return E.get('DAYTIME').cond(k)?.name || E.get('WEATHER').info(k)?.name; } catch { return null; } })() || WX[k] || k : 'clear');
  const clock = (t) => {
    const d = new Date(t), now = new Date(), tm = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diff = Math.round((day(d) - day(now)) / 86_400_000);
    return diff === 0 ? tm : diff === 1 ? `tomorrow ${tm}` : `${d.toLocaleDateString([], { weekday: 'long' })} ${tm}`;
  };

  const num = (id) => D()[id]?.num ?? +id;
  const forms = (id) => Object.values(D()).filter((d) => (d.num ?? d.id) === num(id)).map((d) => d.id).sort((a, b) => a - b);

  // ---- time of day: PHASES = [{key, from}] in local hours ----
  function phaseAt(t) {
    const P = E.get('DAYTIME.PHASES') || [], h = new Date(t).getHours();
    let cur = P[P.length - 1];
    for (const p of P) if (h >= p.from) cur = p;
    return cur?.key;
  }
  // next time (from now) the phase test passes, scanning hour by hour for 48 h
  function nextPhase(test) {
    if (test(safe(() => E.get('DAYTIME').phase().key))) return Date.now();
    const base = new Date(); base.setMinutes(0, 0, 0);
    for (let i = 1; i <= 48; i++) { const t = base.getTime() + i * 3_600_000; if (test(phaseAt(t))) return t; }
    return null;
  }

  // the next time a season starts: 3 days each, spring > summer > autumn > winter (DAYTIME.season / seasonUntil)
  function nextSeason(key) {
    const DT = E.get('DAYTIME'), L = (DT?.SEASONS || []).map((x) => x.key);
    const cur = safe(() => DT.season()?.key), i = L.indexOf(cur), j = L.indexOf(key);
    if (i < 0 || j < 0) return null;
    if (i === j) return Date.now();
    const b = safe(() => DT.seasonUntil()), n = (j - i + 4) % 4;
    return b ? b + (n - 1) * 3 * 86_400_000 : null;
  }
  // the next moment one of `when` holds at a chapter stop (a wild Pokémon's "night" / "rain" / "spring"…):
  // { now, at, key } - the soonest of the alternatives. Time of day and seasons follow the calendar, weather the
  // game's own forecast for that stop (a week ahead).
  function nextWhen(ch, placeName, when) {
    if (!when || !when.length) return { now: true, at: Date.now(), key: null };
    const ST = E.get('STORY'), st = (ST?.CHAPTERS?.[ch]?.steps || []).find((x) => x.name === placeName && x.kind === 'route') || (ST?.CHAPTERS?.[ch]?.steps || []).find((x) => x.name === placeName);
    const place = st ? placeOf(ch, st) : { name: placeName, ch };
    let best = null;
    for (const k of when) {
      let t = null;
      if (['morning', 'day', 'night'].includes(k)) t = nextPhase((p) => p === k);
      else if (['spring', 'summer', 'autumn', 'winter'].includes(k)) t = nextSeason(k);
      else { const w = nextWindow(place, [k], () => true); t = w ? w.at : null; }
      if (t != null && (!best || t < best.at)) best = { at: t, key: k, now: t <= Date.now() + 1000 };
    }
    return best;
  }
  const whenLine = (r) => (r ? (r.now ? `possible now (${wxName(r.key)})` : `next: ${clock(r.at)} (${wxName(r.key)})`) : 'not in the next week');

  // ---- places ----
  const placeOf = (ch, st) => ({ name: st.name, bg: st.bg, scene: st.scene, indoor: st.indoor, climate: st.climate, habitat: st.habitat, ch });
  const weatherNow = (place) => safe(() => E.get('WEATHER').current(place));
  // next hour (game forecast) where the weather is one of `keys` and the time-of-day test passes
  function nextWindow(place, keys, timeOk) {
    const hours = safe(() => E.get('WEATHER').hours(place, 168), []) || []; // a week ahead (the game's forecast takes any length; it defaults to 24 h)
    const now = Date.now();
    if ((!keys || keys.includes(weatherNow(place))) && timeOk(safe(() => E.get('DAYTIME').phase().key))) return { at: now, now: true };
    if (!keys) { const t = nextPhase(timeOk); return t ? { at: t, now: t <= now } : null; } // time of day only
    for (const h of hours) { if (h.at + 3_600_000 < now) continue; if (keys.includes(h.key) && timeOk(phaseAt(Math.max(h.at, now)))) return { at: Math.max(h.at, now), now: h.at <= now, key: h.key }; }
    return null;
  }

  // when a spot only works at a time of day / in a weather: "night", "sandstorm"
  const whenText = (when) => (when || []).map((k) => (['morning', 'day', 'night'].includes(k) ? k : (() => { try { return wxName(k); } catch { return k; } })())).join(' or ');
  // ---- wild ----
  function wild(id) {
    const ST = E.get('STORY'), unlocked = +(S().adv?.unlocked ?? 0), out = [];
    (ST?.CHAPTERS || []).forEach((c, ch) => {
      const spots = [];
      for (const st of c.steps || []) {
        if (st.kind !== 'route' || !st.areas?.length) continue;
        const p = E.pool(st, ch).find((x) => x.id === +id);
        if (p) spots.push({ place: st.name, pct: p.pct || 0, on: p.on !== false, when: p.when || null, lv: [p.min, p.max], fights: +st.wild || 0 });
      }
      if (spots.length) out.push({ ch, chapter: c.name || 'chapter ' + ch, open: ch <= unlocked, best: Math.max(...spots.map((x) => x.pct)), now: spots.some((x) => x.on), spots });
    });
    return out.sort((a, b) => (b.open - a.open) || (b.now - a.now) || (b.best - a.best));
  }

  // ---- special encounters ----
  function special(id) {
    const ST = E.get('STORY'), s = S(), unlocked = +(s.adv?.unlocked ?? 0), out = [];
    (ST?.CHAPTERS || []).forEach((c, ch) => (c.steps || []).forEach((st) => {
      if (st.kind !== 'static' || +st.id !== +id) return;
      const place = placeOf(ch, st), have = st.needs ? itemFor(st.needs, ch) : null;
      const missingCaught = (st.caught || []).filter((x) => !s.dex?.[x]);
      const timeOk = (k) => (st.night ? k === 'night' : st.day ? k !== 'night' : true);
      const win = nextWindow(place, st.skies || null, timeOk);
      const blockers = [];
      if (ch > unlocked) blockers.push('chapter not unlocked yet');
      if (st.once && s.adv?.gifts?.[st.once]) blockers.push('already met');
      if (st.after && !s.adv?.gifts?.[st.after]) blockers.push('an earlier event first');
      if (st.needs && have < (st.needN || 1)) blockers.push(`${st.needN} ${itemName(st.needs)}${st.needN > 1 && !/s$/.test(itemName(st.needs)) ? 's' : ''} (you have ${have})${lootWhere(st.needs)}`);
      if (missingCaught.length) blockers.push(`register ${missingCaught.map(name).join(', ')} first`);
      out.push({
        ch, chapter: c.name || 'chapter ' + ch, place: st.name, chance: st.chance ?? 1, level: safe(() => ST.staticLevel(ch, st)),
        night: !!st.night, day: !!st.day, skies: st.skies || null, needs: st.needs || null, needN: st.needN || null, have, missingCaught,
        weatherNow: weatherNow(place), window: win, blockers, ready: !blockers.length && !!win?.now, once: st.once,
      });
    }));
    return out;
  }
  // in plain words: "storm at Valley Windworks" / "night" / "rain or storm, daytime"
  function conditionText(sp) {
    const parts = [];
    if (sp.skies) parts.push(sp.skies.map(wxName).join(' or '));
    if (sp.night) parts.push('at night'); if (sp.day) parts.push('in the daytime');
    return parts.join(', ') || 'any time';
  }
  function windowText(sp) {
    if (!sp.window) return 'no matching weather in the forecast';
    if (sp.window.now) return `possible right now (${wxName(sp.weatherNow)})`;
    return `next chance: ${clock(sp.window.at)}${sp.window.key ? ` (${wxName(sp.window.key)})` : ''} - now ${wxName(sp.weatherNow)}`;
  }

  // ---- Day Care eggs already on the way ----
  function eggs(id) {
    const P = S().pension || {};
    return (P.eggs || []).filter((e) => +e.id === +id || num(e.id) === num(id) && +id < 1000).map((e) => ({ uid: e.uid, id: +e.id, hatchAt: +e.hatchAt, ready: !!E.read('Game.eggReady', false, e) }));
  }
  const eggSlots = () => { const P = S().pension || {}; return { used: (P.eggs || []).length, max: +(P.open?.eggs ?? 0), next: Math.min(...(P.eggs || []).map((e) => +e.hatchAt)) }; };

  // ---- rare item drops on a route's item stop (Manaphy Egg on Routes 220/223/226, Gracidea…) ----
  // the game checks, at the item stop: not already given, conditions (badge / owns / skies / tide),
  // then its chance. key 'egg:490' = an egg that hatches into #490.
  function loot(key) {
    const ST = E.get('STORY'), s = S(), unlocked = +(s.adv?.unlocked ?? 0), out = [];
    (ST?.CHAPTERS || []).forEach((c, ch) => (c.steps || []).forEach((st) => {
      const L = st.loot?.[key]; if (L == null) return;
      const o = typeof L === 'number' ? { p: L } : L, blockers = [];
      if (ch > unlocked) blockers.push('chapter not unlocked yet');
      if (s.adv?.gifts?.[key]) blockers.push('already found');
      if (o.badge && !(s.adv?.badges || []).includes(o.badge)) blockers.push(`the ${o.badge} badge`);
      if (o.owns && !o.owns.every((x) => E.read('Game.owns', false, x))) blockers.push(`own ${o.owns.filter((x) => !E.read('Game.owns', false, x)).map(name).join(', ')}`);
      if (o.until && s.adv?.gifts?.[o.until]) blockers.push('no longer available');
      if (o.upTo && (+E.read('Game.itemCount', 0, key) || 0) >= o.upTo) blockers.push(`you already hold ${o.upTo}`);
      out.push({ ch, chapter: c.name || 'chapter ' + ch, place: st.name, chance: o.p || 0, skies: o.skies || null, tide: st.tide || null, blockers });
    }));
    return out.sort((a, b) => a.blockers.length - b.blockers.length || b.chance - a.chance);
  }
  // where an item drops, for items the game hands out at one chapter stop (Axew's Broken Tusks)
  const lootWhere = (item) => {
    try {
      const ST = E.get('STORY');
      for (let ch = 0; ch < (ST?.CHAPTERS?.length || 0); ch++) for (const st of ST.CHAPTERS[ch].steps || []) if (st.loot?.[item]) return ` - found at ${st.name} (${ST.CHAPTERS[ch].name} chapter), ${Math.round((+st.loot[item].p || 0) * 100)}% at each item find`;
    } catch (__e) { __h('56-dexinfo:182', __e); }
    return '';
  };
  const itemName = (key) => {
    if (key.startsWith('egg:')) return `${name(+key.slice(4))} Egg`;
    let n = null; try { n = E.get('UI')?.itemName?.(key); } catch (__e) { __h('56-dexinfo:187', __e); }
    return n && typeof n === 'string' ? n : key.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  };
  // every rare find on the routes (Prism Scale, Griseous Orb, Drives…), with what it's for
  function rareItems() {
    const ST = E.get('STORY'), keys = new Set();
    for (const c of ST?.CHAPTERS || []) for (const st of c.steps || []) for (const k of Object.keys(st.loot || {})) if (!k.startsWith('egg:')) keys.add(k);
    const EV = E.get('EVOLUTIONS') || {};
    return [...keys].map((key) => {
      const spots = loot(key), have = +E.read('Game.itemCount', 0, key) || 0;
      const uses = [];
      for (const [f, list] of Object.entries(EV)) for (const e of list || []) if (e?.item === key) uses.push(`evolves ${name(+f)} into ${name(+e.to)}`);
      const o = (() => { for (const c of ST.CHAPTERS) for (const st of c.steps || []) { const L = st.loot?.[key]; if (L != null) return typeof L === 'number' ? { p: L } : L; } return {}; })();
      return { key, name: itemName(key), have, need: +o.upTo || 1, spots, best: spots[0] || null, uses, open: spots.some((x) => !x.blockers.length) };
    }).sort((a, b) => (a.have >= a.need) - (b.have >= b.need) || b.open - a.open || a.name.localeCompare(b.name));
  }

  // ---- breeding: who lays this species' egg (CONFIG.PENSION.LAYS: parent -> egg) ----
  function breedFrom(id) {
    const LAYS = E.get('CONFIG')?.PENSION?.LAYS || {};
    const parents = Object.entries(LAYS).filter(([p, e]) => +e === +id && +p !== +id).map(([p]) => +p);
    return parents.length ? { parents, owned: parents.filter((p) => E.read('Game.owns', false, p)), ditto: !!E.read('Game.pensionHasDitto', false) } : null;
  }

  // ---- evolution ----
  function evoFrom(id) {
    for (const [f, list] of Object.entries(E.get('EVOLUTIONS') || {})) for (const e of list || []) if (+e.to === +id) return { from: +f, ...e };
    return null;
  }
  // the game's own rules (Jimmy 2026-11-21: "don't assume"), read from its code: an evolution is { to, level } or
  // { to, item } or { to, level, party }. A level one happens when the Pokémon GAINS a level at or past that level,
  // and - when set - only with the party species in your team (Shelmet + Karrablast, Karrablast + Shelmet,
  // Mantyke + Remoraid) and only at the time of day in CONFIG.TIME_EVOLUTIONS (Espeon by day, Umbreon at night…).
  // An item one is the item used on it (Soothe Bell = the friendship ones); 'link-cable' is a trade evolution (below).
  const timeOf = (to) => (E.get('CONFIG')?.TIME_EVOLUTIONS || {})[to] || null;
  const evoFromId = (e) => { if (e.from) return e.from; for (const [f, l] of Object.entries(E.get('EVOLUTIONS') || {})) if ((l || []).includes(e)) return +f; return e.to; };
  function evoText(e) {
    if (!e) return '';
    // trade evolutions: a Pokémon you RECEIVE in a trade arrives evolved (offer your Kadabra for someone's Kadabra:
    // theirs comes to you as Alakazam) - and since game 0.5.13 the Shop sells a Link Cable (₽500,000) you use from
    // the Pokémon's card, like a stone (Game.useItem). Mega never buys one by itself.
    if (e.item === 'link-cable') return `with a Link Cable (Shop, ₽500,000 - use it from ${name(evoFromId(e))}'s card), or get a ${name(evoFromId(e))} in a trade and it arrives as ${name(e.to)}`;
    const bits = [];
    if (e.item) bits.push(`with a ${itemName(e.item)}`);
    if (e.party) bits.push(`by gaining a level with ${name(e.party)} in your team`);
    else if (e.level && e.level > 1) bits.push(`at Lv ${e.level}`);
    else if (e.level) bits.push('by gaining a level');
    const t = timeOf(e.to); if (t) bits.push(t === 'night' ? 'at night' : 'during the day');
    return bits.join(', ') || 'by a special condition';
  }

  // ---- everything about one Pokémon ----
  function howTo(id) {
    id = +id;
    const d = D()[id] || {}, s = S();
    const owned = (E.read('Game.ownedMons', []) || []).filter((m) => +m.id === id);
    const evo = evoFrom(id);
    // only one you can reach (Game.ownedMons also lists Pokémon tied up elsewhere, e.g. a trade offer: leveling
    // those ended 'gone' at once and the Pokédex goal re-added it every minute - 24 times for one Oshawott)
    const pre = evo ? (E.read('Game.ownedMons', []) || []).filter((m) => +m.id === evo.from && E.read('Game.getMon', null, m.uid)).sort((a, b) => b.level - a.level)[0] || null : null;
    const z = safe(() => Legends.get(id));
    return {
      id, name: name(id), types: d.types || [], legendary: !!d.legendary, mythical: !!d.mythical,
      state: E.read('Game.dexState', null, id), registered: !!E.read('Game.inDex', false, id), owned: owned.length,
      wild: wild(id), special: special(id),
      evolve: evo ? { ...evo, fromName: name(evo.from), how: evoText(evo), pre: pre ? { uid: pre.uid, level: pre.level } : null } : null,
      legend: z ? { state: z.state, when: z.when, progress: z.progress } : null,
      forms: forms(id).filter((x) => x !== id).map((x) => ({ id: x, name: name(x), registered: !!E.read('Game.inDex', false, x) })),
      roaming: !!s.roam?.at?.[id],
      eggs: eggs(id), loot: loot('egg:' + id), breed: breedFrom(id), eggSlots: eggSlots(),
    };
  }

  // the best way in, for the planner: { kind, ... , text }
  // Every way to get one Pokémon, best first (route() = the first). When leveling would use up your
  // only copy of the pre-evolution (Elekid -> Electabuzz takes Elekid out of your Pokédex, and getting
  // it back means a Day Care egg), catching it directly goes first if it can be caught.
  function routes(id) {
    const h = howTo(id), out = [];
    if (h.eggs.length) { const e = h.eggs.sort((a, b) => a.hatchAt - b.hatchAt)[0]; out.push({ kind: 'egg', text: e.ready ? 'egg in the Day Care - ready to hatch' : `egg in the Day Care - hatches ${clock(e.hatchAt)}` }); }
    if (h.legend) out.push({ kind: 'legend', text: `legendary zone (${h.legend.state === 'locked' ? 'locked: ' + (h.legend.progress?.text || '') : h.legend.when || 'open'})` });
    const sp = h.special.find((x) => !x.blockers.some((b) => /already met|not unlocked/.test(b)));
    if (sp) {
      const soul = sp.needs && sp.have < sp.needN ? { item: sp.needs, need: sp.needN, have: sp.have } : null;
      const regMiss = sp.missingCaught.length;
      out.push({ kind: 'special', ch: sp.ch, place: sp.place, soul, regMiss, text: `special encounter at ${sp.place} (${sp.chapter}) · ${conditionText(sp)}${sp.chance < 1 ? ` · ${pct(sp.chance)} each time the chapter is built` : ''}${soul ? ` · needs ${soul.need} ${itemName(soul.item)}${/s$/.test(itemName(soul.item)) ? '' : 's'}${lootWhere(soul.item)}, you have ${soul.have}` : ''}${regMiss ? ` · register ${sp.missingCaught.map(name).join(', ')} first` : ''}` });
    }
    let evo = null;
    if (h.evolve?.pre) {
      const copies = (E.read('Game.allMons', []) || []).filter((m) => +m.id === +h.evolve.from).length;
      const last = copies <= 1;
      const warn = last ? ` - it's your only ${h.evolve.fromName}, so ${h.evolve.fromName} leaves your Pokédex (getting it back means a Day Care egg)` : ` - you have ${copies}, so you keep a ${h.evolve.fromName}`;
      if (h.evolve.level && !h.evolve.item) evo = { kind: 'evolve', uid: h.evolve.pre.uid, level: h.evolve.level, from: h.evolve.from, party: h.evolve.party || null, time: timeOf(id), last, text: `${h.evolve.level > 1 && h.evolve.pre.level < h.evolve.level ? `level your ${h.evolve.fromName} (Lv ${h.evolve.pre.level}) to ${h.evolve.level}` : `level your ${h.evolve.fromName} (Lv ${h.evolve.pre.level}) once`}${h.evolve.party ? ` with ${name(h.evolve.party)} in the team` : ''}${timeOf(id) ? (timeOf(id) === 'night' ? ' at night' : ' during the day') : ''} to evolve${warn}` };
      else evo = { kind: 'manual', last, text: `evolve your ${h.evolve.fromName} ${h.evolve.how}${warn}` };
    }
    const w = h.wild.find((x) => x.open);
    const wild = w ? { kind: 'wild', ch: w.ch, text: `catch it in the wild: ${w.chapter} (${w.spots.map((x) => x.place).slice(0, 3).join(', ')}${w.spots.length > 3 ? '…' : ''}) · ${pct(w.best)}${w.now ? '' : ' · not at this time / weather'}` } : null;
    if (evo && wild && evo.last) out.push(wild, evo); else { if (evo) out.push(evo); if (wild) out.push(wild); }
    if (!evo && h.evolve) out.push({ kind: 'manual', text: `evolves from ${h.evolve.fromName} (${h.evolve.how}) - get ${h.evolve.fromName} first` });
    if (!wild && h.wild.length) out.push({ kind: 'manual', text: `wild in ${h.wild[0].chapter} - not unlocked yet` });
    const lt = h.loot.find((x) => !x.blockers.some((b) => /already found|not unlocked|no longer/.test(b)));
    if (lt) out.push({ kind: 'loot', item: 'egg:' + id, ch: lt.ch, place: lt.place, text: `${itemName('egg:' + id)}: rare find at ${lt.place} (${lt.chapter}) · ${pct(lt.chance)} at each item stop${lt.blockers.length ? ' · needs ' + lt.blockers.join(', ') : ''}` });
    if (h.breed) out.push(h.breed.owned.length ? { kind: 'breed', parent: h.breed.owned[0], text: `breed your ${name(h.breed.owned[0])} in the Day Care${h.breed.ditto ? ' (Ditto is there)' : ' with Ditto'}` } : { kind: 'manual', text: `bred from ${h.breed.parents.map(name).join(' or ')} - catch one first` });
    if (!out.length) out.push(h.mythical || h.legendary ? { kind: 'soon', text: 'special event' } : { kind: 'soon', text: 'no automatic way yet' });
    return out;
  }
  const route = (id) => routes(id)[0];

  // every Pokédex entry of a region: species numbers in its range, plus their forms
  function regionIds(key) {
    const r = (E.get('STORY.REGIONS') || []).find((x) => x && x.key === key); if (!r?.dex) return [];
    return Object.values(D()).filter((d) => { const n = d.num ?? d.id; return n >= r.dex[0] && n <= r.dex[1]; }).map((d) => d.id).sort((a, b) => (num(a) - num(b)) || (a - b));
  }

  // can it be caught right now? (wild under today's time/weather, a special encounter whose
  // conditions are met, an open legendary zone). Cached a minute per Pokémon: weather is hourly.
  const nowCache = new Map();
  function availableNow(id) {
    const c = nowCache.get(+id);
    if (c && Date.now() - c.at < 60_000) return c.v;
    let v = null;
    const z = safe(() => Legends.get(+id));
    if (z) v = z.state === 'open' ? 'legendary zone open now' : null;
    else {
      const sp = special(id).find((x) => !x.blockers.length && x.window?.now);
      if (sp) v = `special encounter possible now at ${sp.place}`;
      else { const w = wild(id).find((x) => x.open && x.now); if (w) v = `wild now in ${w.chapter}`; }
    }
    nowCache.set(+id, { at: Date.now(), v });
    return v;
  }

  return { timeOf, nextWhen, whenLine, nextSeason, itemFor, howTo, route, routes, whenText, rareItems, availableNow, eggs, eggSlots, loot, itemName, breedFrom, special, wild, forms, regionIds, conditionText, windowText, wxName, clock, pct, evoText };
})();

/* ---------------------------------------------------------------------------------------------
 * DayCare: what's in the game's Day Care (read-only) - the eggs in the incubator with how long each
 * has left, the Pokémon staying there, and when the next egg comes. Shown on the Now tab and sent
 * to the phone. Also an alert when an egg is ready to hatch (once per egg, survives reloads).
 * ------------------------------------------------------------------------------------------- */
const DayCare = (() => {
  const E = Engine, DONE = 'mega-egg-told';
  const P = () => E.get('Game.S')?.pension || {};
  const name = (id) => E.get('Game.DEX')?.[id]?.name || '#' + id;
  function info() {
    const p = P(), now = Date.now();
    const eggs = (p.eggs || []).map((e) => {
      let ready = false; try { ready = !!E.read('Game.eggReady', false, e); } catch (__e) { __h('57-daycare:13', __e); }
      return { uid: e.uid, id: +e.id, hatchAt: +e.hatchAt, laidAt: +e.laidAt || +e.hatchAt - 6 * 3_600_000, left: Math.max(0, +e.hatchAt - now), ready, shinyParent: !!e.sp, place: e.place || '' };
    }).sort((a, b) => a.hatchAt - b.hatchAt);
    const mons = (p.mons || []).map((x) => x?.mon || x).filter(Boolean).map((m) => ({ id: +m.id, level: +m.level || 1, shiny: !!m.shiny }));
    const max = +(p.open?.eggs ?? 0), goal = +p.eggGoal || 0, prog = +p.egg || 0;
    const full = max > 0 && eggs.length >= max;
    let layers = []; try { layers = E.read('Game.pensionLayers', []) || []; } catch (__e) { __h('57-daycare:19', __e); }
    const nextEgg = !full && layers.length && goal > 0 ? Math.max(0, goal - prog) : null;
    return { eggs, mons, used: eggs.length, max, full, nextEgg, laying: layers.length > 0 };
  }
  // ---- alert: egg ready (once per egg) ----
  let told = (() => { try { return JSON.parse(localStorage.getItem(DONE) || '[]'); } catch { return []; } })();
  function check() {
    if (!E.ready()) return;
    const d = info(), ready = d.eggs.filter((e) => e.ready && !told.includes(e.uid));
    // auto-collect (2.13.14, Jimmy's switch on the Day Care tab): hatch ready eggs by itself, never inside a
    // Legendary zone, league, tower or raid (the game's own hatch call, like the Hatch button)
    if (ready.length && autoOn() && !(typeof GameMode !== 'undefined' && GameMode.on())) {
      const a = E.get('Game.S')?.adv || {};
      if (!(a.zone || a.league || a.tower || a.raid || a.event)) {
        const r = hatch(); Log.add(`Day Care auto-collect: ${r}`);
        if (/^hatched/.test(r)) { try { Notify.send('egg', `Day Care: ${r}`, 'Auto-collect hatched it - it is in your PC'); } catch (__e) { __h('57-daycare:34', __e); } told = [...told, ...ready.map((e) => e.uid)]; try { localStorage.setItem(DONE, JSON.stringify(told)); } catch (__e) { __h('57-daycare:34', __e); } return; }
      }
    }
    if (ready.length) {
      const n = ready.map((e) => name(e.id) + (e.shinyParent ? ' ✨' : ''));
      Notify.send('egg', ready.length === 1 ? `${n[0]} egg is ready to hatch` : `${ready.length} eggs are ready to hatch`, ready.length === 1 ? 'Open the Day Care to hatch it' : n.join(', '));
    }
    const live = new Set(d.eggs.map((e) => e.uid));
    told = [...told.filter((u) => live.has(u)), ...ready.map((e) => e.uid)];
    try { localStorage.setItem(DONE, JSON.stringify(told)); } catch (__e) { __h('57-daycare:43', __e); }
  }
  const autoOn = () => { try { return localStorage.getItem('mega-egg-auto') === '1'; } catch { return false; } };
  const setAuto = (on) => { try { localStorage.setItem('mega-egg-auto', on ? '1' : '0'); } catch (__e) { __h('57-daycare:46', __e); } Log.add(`Day Care auto-collect ${on ? 'on' : 'off'}`); if (on) try { check(); } catch (__e) { __h('57-daycare:46', __e); } };
  let timer = null;
  function boot() { if (timer) return; timer = setInterval(() => { try { check(); } catch (__e) { __h('57-daycare:48', __e); } }, 30_000); }
  const left = (ms) => { const m = Math.ceil(ms / 60_000); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ' ' + (m % 60) + ' min' : ''}`; };
  // hatch ready eggs (one by uid, or every ready one) - for a tap in Mega or Kinesis
  function hatch(uid) {
    const eggs = (E.get('Game.S')?.pension?.eggs || []).filter((e) => (uid ? e.uid === uid : true) && E.read('Game.eggReady', false, e));
    if (!eggs.length) return 'no egg is ready yet';
    const got = [];
    for (const e of eggs) { let r = null; try { r = E.call('Game.hatchEgg', e.uid); } catch (__e) { __h('57-daycare:55', __e); } if (r) got.push(name(e.id)); }
    try { E.call('Game.save'); } catch (__e) { __h('57-daycare:56', __e); } try { E.call('App.refresh'); } catch (__e) { __h('57-daycare:56', __e); }
    return got.length ? `hatched ${got.join(', ')}` : 'the game didn\'t hatch it - open the Day Care';
  }
  return { info, boot, left, name, hatch, autoOn, setAuto };
})();

/* ---------------------------------------------------------------------------------------------
 * Day Care tab (2.13.13, Jimmy 2026-11-23: "make it look exactly like ZG, with all that info in place,
 * easier to read"): the incubator with three numbers and its eggs, the parents as numbered cards,
 * the natural-egg timer, the shiny egg forecast, and the shiny egg list grouped by parent and berry.
 * Everything comes from DayCare (the save) and EggPredict (the game's own egg math, exact).
 * ------------------------------------------------------------------------------------------- */
Views.daycare = (w, esc) => {
  if (!w.ok) return `<div class="note">Waiting for the game engine.</div>`;
  const E = Engine, S = E.get('Game.S') || {}, P = S.pension || {}, C = E.get('CONFIG')?.PENSION || {};
  const nm = (id) => esc(Casing.names(E.get('Game.DEX')?.[id]?.name || '#' + id));
  const eggOf = (id) => { const L = C.LAYS || {}; if (L[id] != null) return +L[id]; let f = []; try { f = E.get('Game').familyOf(+id) || []; } catch (__e) { __h('57-dcview:11', __e); } return +(f[0] ?? id); };
  const at = (t) => new Date(t).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  const dc = DayCare.info(), mine = (() => { try { return EggPredict.eggs(); } catch { return []; } })();
  const per = (+C.EGG_MIN || 240) * 60_000;
  const shinyHeld = mine.filter((e) => e.shiny).length, ready = dc.eggs.filter((e) => e.ready).length, hatched = +(S.stats?.hatched ?? 0);
  const mons = (P.mons || []).map((x) => x?.mon || x).filter(Boolean);
  let layers = []; try { layers = (E.read('Game.pensionLayers', []) || []).map((x) => x.mon || x); } catch (__e) { __h('57-dcview:17', __e); }
  const slotOf = (id, shiny) => { const i = mons.findIndex((m) => +m.id === +id && !!m.shiny === !!shiny); return i >= 0 ? i + 1 : null; };
  const rateTxt = (r) => { const n = Math.round(1 / r); return `1/${n}`; };

  // ---- incubator ----
  let h = `<div class="dcbox"><div class="dch"><h2>Incubator</h2><span class="dcok">Exact · the game's own egg math</span></div>
    <div class="dim dcs">Taken ${dc.used}/${dc.max || +C.INCUBATOR || 4}${dc.full ? ' · full - hatch one to make room' : ''}</div>
    <div class="mets dcm"><div><b>${shinyHeld}</b><span>Shiny eggs held</span></div><div><b>${ready}</b><span>Ready to claim</span></div><div><b>${hatched.toLocaleString()}</b><span>Total hatched</span></div></div>`;
  if (!dc.eggs.length) h += `<div class="dcs">No eggs in the incubator.</div>`;
  for (const e of dc.eggs) {
    const sh = mine.find((x) => x.uid === e.uid)?.shiny, pct = e.ready ? 1 : 1 - e.left / Math.max(1, e.hatchAt - e.laidAt);
    h += `<div class="dcegg"><img src="${E.sprite(e.id)}" width="40" height="40" style="${e.ready ? '' : 'filter:grayscale(1);opacity:.55'}"><div class="grow"><b>${nm(e.id)}</b> ${sh ? '<span class="dcsh">✦ Shiny</span>' : '<span class="dim">Normal</span>'}
      <div class="dim">${e.ready ? '<span class="ok">Ready to hatch</span>' : `${DayCare.left(e.left)} left · hatches ${at(e.hatchAt)}`}</div>${e.ready ? '' : `<div class="bar"><i style="width:${Math.round(pct * 100)}%"></i></div>`}</div>
      ${e.ready ? `<button class="qbtn" data-act="m-egg-hatch" data-uid="${esc(e.uid)}">Hatch</button>` : ''}</div>`;
  }
  if (ready > 1) h += `<button class="qbtn" style="margin-top:8px" data-act="m-egg-hatch" data-uid="">Hatch all ready (${ready})</button>`;
  h += `<label class="chk dcauto"><input type="checkbox" data-act="egg-auto" ${DayCare.autoOn() ? 'checked' : ''}>Auto-collect ready eggs</label><div class="dim dcs">Hatches eggs as soon as they're ready (checked every 30 seconds), but never during a Legendary zone, league, tower or raid. You get a phone alert for each one it hatches.</div>`;

  // ---- parents ----
  h += `<div class="dch" style="margin-top:14px"><h3>Day Care parents</h3><span class="dim">${mons.length} in Day Care · ${layers.length} can be drawn</span></div>`;
  if (!mons.length) h += `<div class="dcs dim">No Pokémon in the Day Care.</div>`;
  else h += `<div class="dcpar">${mons.map((m, i) => {
    const lays = layers.some((l) => +l.id === +m.id && !!l.shiny === !!m.shiny), ditto = +m.id === 132;
    return `<div class="dcp"><span class="qpos">${i + 1}</span><div class="grow"><b>${m.shiny ? '✦ ' : ''}${nm(m.id)}</b><div class="dim">${ditto ? 'Needed for natural eggs' : lays ? `Produces ${nm(eggOf(m.id))}` : 'Can\'t lay here'}</div></div></div>`;
  }).join('')}</div>`;
  if (dc.laying) {
    const goal = +P.eggGoal || per, prog = +P.egg || 0;
    h += `<div class="dcs"><div class="dch"><span>Natural egg progress</span><b>${dc.full ? 'waiting for a free slot' : dc.nextEgg != null ? `next egg in ${DayCare.left(dc.nextEgg)}` : ''}</b></div><div class="bar"><i style="width:${Math.min(100, Math.round(prog / goal * 100))}%"></i></div></div>`;
  }

  // ---- forecast ----
  let U = null; try { U = EggPredict.upcoming(400); } catch (__e) { __h('57-dcview:48', __e); }
  h += `<div class="dch" style="margin-top:14px"><h3>Shiny egg forecast</h3>${U ? '<span class="dcok">Exact for these parents</span>' : ''}</div>`;
  if (!U || !U.layers.length) { h += `<div class="dcs dim">Nobody in the Day Care can lay an egg right now.</div></div>`; return h; }
  const when = (a) => (dc.nextEgg != null ? at(Date.now() + dc.nextEgg + a * per) : '');
  // the next egg itself
  const nextPar = U.layers.length ? U.layers[Math.floor(EggPredict.roll(U.next, 1) * U.layers.length)] : null;
  const nextRow = U.rows.find((r) => r.k === U.next);
  const nextShiny = !!nextRow?.now;
  const firstNat = U.rows.find((r) => r.now), firstBerry = U.rows.find((r) => r.berry && !r.now);
  h += `<div class="dcnext"><b>Next natural egg #${U.next} · ${nextPar ? nm(eggOf(nextPar.id)) : '?'} · ${nextShiny ? '<span class="dcsh">✦ shiny</span>' : 'normal'}${nextPar ? ` · parent slot ${slotOf(nextPar.id, nextPar.shiny) || '?'}` : ''}</b>
    <div class="dim">${U.berryOn ? 'A Belue Berry is active for it. ' : ''}${firstNat ? `Natural egg ${firstNat.ahead === 0 ? 'next' : firstNat.ahead + 1} is shiny (${nm(eggOf(firstNat.parent))}, #${firstNat.k})` : 'No natural shiny in the next 400 eggs'}</div></div>
    <div class="dcpair"><div><span class="dim">Next natural shiny egg</span><b>${firstNat ? `Egg ${firstNat.ahead + 1} · ${nm(eggOf(firstNat.parent))} (#${firstNat.k})` : '—'}</b>${firstNat && when(firstNat.ahead) ? `<span class="dim">about ${when(firstNat.ahead)}</span>` : ''}</div>
      <div><span class="dim">Next shiny-with-berry egg</span><b>${firstBerry ? `Egg ${firstBerry.ahead + 1} · ${nm(eggOf(firstBerry.parent))} (#${firstBerry.k})` : '—'}</b>${firstBerry && when(firstBerry.ahead) ? `<span class="dim">about ${when(firstBerry.ahead)}</span>` : ''}</div></div>`;

  // ---- shiny egg list, grouped by the parent drawn and whether it needs the berry ----
  const base = EggPredict.rate(0, 0), par = EggPredict.rate(2, 0);
  const groups = [
    ['Shiny parent · natural shiny', rateTxt(par), (r) => r.parentShiny && r.now],
    ['Shiny parent · shiny only with a berry', `${rateTxt(par)} → ${rateTxt(par * 2)}`, (r) => r.parentShiny && r.berry && !r.now],
    ['Normal parent · natural shiny', rateTxt(base), (r) => !r.parentShiny && r.now],
    ['Normal parent · shiny only with a berry', `${rateTxt(base)} → ${rateTxt(base * 2)}`, (r) => !r.parentShiny && r.berry && !r.now],
  ];
  h += `<details class="dclist" open><summary>Shiny egg list</summary><div class="dim dcs">Grouped by the parent actually drawn. A berry-only shiny egg needs a Belue Berry fed before that egg is laid.</div>`;
  for (const [t, rt, f] of groups) {
    const rows = U.rows.filter(f).slice(0, 4); if (!rows.length) continue;
    h += `<div class="dcg"><div class="dcgh"><b>${t}</b><span class="dim">${rt}</span></div>${rows.map((r) => `<div class="dcr"><b>${r.ahead === 0 ? 'next egg' : r.ahead + ' eggs from now'}</b><span>slot ${slotOf(r.parent, r.parentShiny) || '?'} ${nm(r.parent)} → ${nm(eggOf(r.parent))}</span><span class="dcok">#${r.k}</span></div>`).join('')}</div>`;
  }
  h += `</details><div class="dim dcs">Distance counts natural eggs laid${dc.nextEgg != null ? `; one about every ${Math.round(per / 3_600_000)} h` : ''}. Changing or reordering parents, using a Belue Berry or gift eggs taking numbers will recalculate it.</div></div>`;
  return h;
};

/* ---------------------------------------------------------------------------------------------
 * EggPredict: which Day Care eggs will hatch shiny. Read from the game's own code (v0.5.11):
 *  - every egg gets a number when it's laid (pension.laid, counting up: egg k)
 *  - shiny = hash("<trainer since>:<trainer id>|egg|k|0") < rate, the game's own 53-bit hash
 *  - rate = PENSION.SHINY_RATE (1/512), or PENSION.SHINY_PARENT_RATE (1/16) if the parent is shiny,
 *    x PENSION.SHINY_BERRY_MULT (2) when a Belue Berry was used before that egg was laid
 *  - the parent = the layers list (Game.pensionLayers) at floor(hash("...|egg|k|1") x how many can lay)
 * Checked against the game on 2026-11-22: same parents for eggs #254 and #255, and all 33 hatched eggs match.
 * Read-only: Mega never uses a berry or moves a Pokémon for this by itself.
 * ------------------------------------------------------------------------------------------- */
const EggPredict = (() => {
  const E = Engine;
  const S = () => E.get('Game.S') || {};
  const PC = () => E.get('CONFIG')?.PENSION || {};
  const Un = [24348, 41597, 15337, 49222];
  function hash(u) { // the game's Gn
    let A = 1779033703 ^ (Un[0] << 16 | Un[1]), q = 3144134277 ^ (Un[2] << 16 | Un[3]);
    for (let i = 0; i < u.length; i++) { const c = u.charCodeAt(i); A = Math.imul(A ^ c, 2654435761); q = Math.imul(q ^ c, 1597334677); }
    A = Math.imul(A ^ A >>> 16, 2246822507) ^ Math.imul(q ^ q >>> 13, 3266489909);
    q = Math.imul(q ^ q >>> 16, 2246822507) ^ Math.imul(A ^ A >>> 13, 3266489909);
    return (4294967296 * (2097151 & q) + (A >>> 0)) / 9007199254740992;
  }
  const key = () => { const t = S().trainer || {}; return `${t.since ?? ''}:${t.id ?? ''}`; };
  const roll = (k, q = 0) => hash(`${key()}|egg|${k}|${q}`);
  function rate(sp, bx) {
    const p = PC(), base = +p.SHINY_RATE || 1 / 512;
    const par = sp ? (+sp === 2 ? +p.SHINY_PARENT_RATE : +p.SHINY_PARENT_RATE_OLD) || 0 : 0;
    return (par ? Math.max(par, base) : base) * (bx ? +p.SHINY_BERRY_MULT || 2 : 1);
  }
  const shinyOf = (e) => ('shiny' in e ? !!e.shiny : Number.isInteger(e.k) ? roll(e.k) < rate(e.sp, e.bx) : null);
  // the eggs in the incubator: number, and whether it hatches shiny (known for sure)
  function eggs() {
    return (S().pension?.eggs || []).map((e) => ({ uid: e.uid, id: +e.id, k: e.k, shiny: shinyOf(e), sp: !!e.sp, bx: !!e.bx }));
  }
  // the next eggs: for each number, the parent it would come from with today's Day Care, and whether it's
  // shiny as things are, with a Belue Berry used before it, or never with these parents
  function upcoming(n = 400) {
    const P = S().pension || {}, laid = Number.isFinite(P.laid) ? P.laid : (+S().stats?.hatched || 0) + (P.eggs || []).length;
    let layers = []; try { layers = (E.read('Game.pensionLayers', []) || []).map((x) => x.mon || x); } catch (__e) { __h('57-eggpredict:39', __e); }
    const out = [];
    for (let k = laid; k < laid + n; k++) {
      const v = roll(k), par = layers.length ? layers[Math.floor(roll(k, 1) * layers.length)] : null, sp = par?.shiny ? 2 : 0;
      const now = v < rate(sp, k === laid && P.bx), berry = v < rate(sp, 1);
      const anyParent = v < rate(2, 1);
      if (now || berry || anyParent) out.push({ k, ahead: k - laid, parent: par ? +par.id : null, parentShiny: !!sp, now, berry, needShinyParent: !berry && anyParent });
    }
    return { laid, next: laid, layers: layers.map((m) => ({ id: +m.id, shiny: !!m.shiny })), berryOn: !!P.bx, rows: out };
  }
  return { hash, roll, rate, eggs, upcoming, shinyOf };
})();

/* ---------------------------------------------------------------------------------------------
 * Legends tab view. ui = { pick, simRun: {id, pct, result, error}, real: {id, ...} }
 * ------------------------------------------------------------------------------------------- */
Views.legends = (w, ui, esc) => {
  if (!w.ok) return `<div class="note">Waiting for the game engine.</div>`;
  // Hide locked / Hide caught (Jimmy): the list only - a legendary you already picked stays shown
  const all = Legends.list().filter((z) => +z.id === +ui.pick || !((ui.hideLocked && (z.state === 'locked' || z.state === 'sealed')) || (ui.hideCaught && z.state === 'done')));
  const order = { open: 0, closed: 1, locked: 2, done: 3 };
  const label = { open: '<span class="ok">open</span>', closed: '<span class="warn">closed now</span>', locked: '<span class="dim">locked</span>', done: '<span class="dim">caught</span>' };
  const name = (id) => esc(World.dex.name(id));
  const mon = (uid) => Engine.read('Game.getMon', null, uid);
  const pct = (x) => (x == null ? '?' : Math.round(x * 100) + '%');
  let h = '';

  const sel = ui.pick ? Legends.get(ui.pick) : null;
  h += `<select class="sel" data-act="pick"><option value="">Choose a legendary…</option>${[...all].sort((a, b) => order[a.state] - order[b.state] || a.id - b.id).map((z) =>
    `<option value="${z.id}" ${+ui.pick === z.id ? 'selected' : ''}>${esc(z.name)}${z.roam ? ' (roaming)' : ''} · ${esc(z.region)} · ${z.state === 'done' ? 'caught' : z.roam && z.state === 'open' ? 'out now' : z.state}</option>`).join('')}</select>`;
  h += `<div style="display:flex;gap:14px;flex-wrap:wrap;margin:4px 0 8px"><label class="chk"><input type="checkbox" data-act="leg-hide-locked" ${ui.hideLocked ? 'checked' : ''}> Hide locked</label><label class="chk"><input type="checkbox" data-act="leg-hide-caught" ${ui.hideCaught ? 'checked' : ''}> Hide caught</label></div>`;

  if (sel) {
    h += `<div class="card"><h3>${esc(sel.name)} <span class="dim">Lv ${sel.level}</span></h3>
      <div class="row"><span class="k">${sel.roam ? 'Roaming' : 'Zone'}</span><span class="v">${sel.roam && sel.state === 'open' ? '<span class="ok">out now</span>' : sel.roam && sel.state === 'closed' ? '<span class="warn">between spots</span>' : label[sel.state] || esc(sel.state)}</span></div>
      ${sel.roam ? `<div class="row"><span class="k">Fight</span><span class="v">Lv ${sel.level} · HP x${sel.hp} · power x${sel.power}${sel.weather ? ' · ' + esc(sel.weather) : ''}</span></div>` : ''}
      <div class="row"><span class="k">When</span><span class="v">${esc(sel.when || '?')}</span></div>`;
    if (sel.forms) {
      h += `<div class="row"><span class="k">This week</span><span class="v">${sel.allForms ? '<span class="ok">every form caught</span>' : sel.form ? `${esc(sel.formName || name(sel.form))}${Engine.read('Game.owns', false, sel.form) ? ' <span class="ok">· caught</span>' : ''}` : '?'}</span></div>`;
      h += `<div class="grid" style="margin-top:6px">${sel.forms.map((f) => `<div class="mon ${f.owned ? '' : 'unk'}"><img src="${Engine.sprite(f.id)}" alt="">${esc(f.name.replace(/^.*\(|\)$/g, '') || f.name)}<br><span class="${f.owned ? 'ok' : 'dim'}">${f.owned ? '✓ caught' : sel.form === f.id ? 'this week' : 'later'}</span></div>`).join('')}</div>`;
      h += `<div class="note dim" style="margin-top:8px">One form you don't own appears each week, at the weekly reset (Sunday 4 PM). The game picks it at random from the ones you're missing.</div>`;
    }
    if (sel.progress) {
      h += `<div class="row"><span class="k">Unlock</span><span class="v">${sel.progress.have >= sel.progress.need ? '<span class="ok">done</span>' : `${sel.progress.have}/${sel.progress.need}`}</span></div>`;
      if (sel.progress.text) h += `<div class="note">${esc(sel.progress.text)}</div>`;
      for (const l of sel.progress.lines) h += `<div class="row"><span class="k">${esc(l.text || '')}</span><span class="v ${l.have >= l.need ? 'ok' : 'warn'}">${l.have}/${l.need}</span></div>`;
    }
    h += `</div>`;

    // team: current zone team, simulated best, real record
    const cur = sel.roam ? (Engine.get('Game.S')?.team || []).slice(0, 6) : Engine.read('Game.zoneTeam', [], sel.id) || [];
    const saved = Legends.sims()[sel.id];
    const teamRow = (uids) => `<div class="grid">${uids.map((u) => { const m = mon(u); return m ? `<div class="mon"><img src="${Engine.sprite(m.id)}" alt="">${name(m.id)}${m.shiny ? ' ✨' : ''}<br><span class="dim">Lv ${m.level}</span></div>` : `<div class="mon unk"><span class="dim">away</span></div>`; }).join('')}</div>`;
    h += `<div class="card"><h3>${sel.roam ? 'Your team now' : 'Zone team now'}</h3>${cur.length ? teamRow(cur) : '<div class="note">No team set for this zone yet.</div>'}`;
    if (ui.real && ui.real.id === sel.id && ui.real.cur) h += `<div class="row"><span class="k">Real record</span><span class="v">${ui.real.cur.fights ? `${ui.real.cur.ko} KO · ${ui.real.cur.lost} lost (${pct(ui.real.cur.rate)})` : '<span class="dim">no recorded fights</span>'}</span></div>`;
    h += `</div>`;

    const run = ui.simRun && ui.simRun.id === sel.id ? ui.simRun : null;
    h += `<div class="card"><h3>Best team (simulator)</h3>`;
    if (run && run.pct != null && !run.result && !run.error) h += `<div class="note">Simulating… ${run.pct}%</div><div class="bar"><i style="width:${run.pct}%"></i></div>`;
    else if (run && run.error) h += `<div class="note bad">${esc(run.error)}</div>`;
    if (saved) {
      h += teamRow(saved.uids);
      const stillLow = (saved.toLevel || []).filter((x) => (Engine.read('Game.getMon', null, x.uid)?.level ?? 100) < x.to);
      if (stillLow.length) {
        h += `<div class="row"><span class="k">KO once leveled</span><span class="v ok">${pct(saved.ko)}</span></div>`;
        h += `<div class="row"><span class="k">KO today</span><span class="v">${pct(saved.today)}</span></div>`;
        h += `<div class="note warn">Level these first: ${stillLow.map((x) => `${name(x.id)} (Lv ${Engine.read('Game.getMon', null, x.uid)?.level ?? x.from} → ${x.to})`).join(', ')}${sel.state !== 'done' ? '<br>Adding this legendary to your plan adds the leveling goal in front of it.' : ''}</div>`;
      } else h += `<div class="row"><span class="k">Simulated KO</span><span class="v">${pct(saved.ko)}</span></div>`;
      if (saved.current != null) h += `<div class="row"><span class="k">${sel.roam ? 'Your team now' : 'Zone team now'}</span><span class="v dim">${pct(saved.current)}</span></div>`;
      if (ui.real && ui.real.id === sel.id && ui.real.sim) h += `<div class="row"><span class="k">Real record</span><span class="v">${ui.real.sim.fights ? `${ui.real.sim.ko} KO · ${ui.real.sim.lost} lost` : '<span class="dim">not fought yet</span>'}</span></div>`;
      h += `<div class="note dim">Simulated at full HP. Wild Pokémon before the legendary can lower your real odds. Checked against your recorded fights: Palkia 12% sim vs 9% real, Giratina 97% vs 95%.</div>`;
    }
    h += `<label class="chk"><input type="checkbox" data-act="asmax" ${ui.asMax ? 'checked' : ''}> As if all were Lv 100 <span class="dim">(shows who's worth leveling)</span></label>`;
    h += `<div class="btns"><button class="btn" data-act="sim" ${run && !run.result && !run.error ? 'disabled' : ''}>${saved ? 'Search again' : 'Find best team'}</button>`;
    if (saved) h += `<button class="btn" data-act="use">Use this team</button>`;
    h += `</div></div>`;

    if (sel.state !== 'done') {
      const g = Plan.has(sel.id);
      if (g) { const L = Plan.live(g.id); h += `<div class="note">In your plan (#${Plan.goals.filter((x) => !x.done).indexOf(g) + 1})${L?.why ? ' · ' + esc(L.why) : L?.line ? ' · ' + esc(L.line) : ''}. <button class="btn sm" data-act="tab" data-tab="plan">Open plan</button></div>`; }
      else h += `<button class="btn gold" data-act="leg-add">Add "Catch ${esc(sel.name)}" to my plan</button>`;
    }
  }
  return h;
};

// Underground settings: where a run starts and what it's after (used on the add form and on the goal itself)
function ugSelects(from, aim, starts, actFrom, actAim, id = '') {
  const d = id ? ` data-id="${id}"` : '';
  return `<select class="sel" data-act="${actFrom}"${d}><option value="auto" ${from === 'auto' ? 'selected' : ''}>Start floor: best (Mega tries each)</option>${starts.map((f) => `<option value="${f}" ${+from === f && from !== 'auto' ? 'selected' : ''}>Start at floor ${f}</option>`).join('')}</select>`
    + `<select class="sel" data-act="${actAim}"${d}><option value="deep" ${aim !== 'loot' ? 'selected' : ''}>Aim: deepest floor (raises your record)</option><option value="loot" ${aim === 'loot' ? 'selected' : ''}>Aim: most loot this run</option></select>`;
}
/* ---------------------------------------------------------------------------------------------
 * Plan tab view. ui = { addType, addFoe, showLog }
 * ------------------------------------------------------------------------------------------- */
Views.plan = (w, ui, esc) => {
  if (!w.ok) return `<div class="note">Waiting for the game engine.</div>`;
  const light = { running: ['ok', '●', 'running'], ready: ['ok', '●', 'running'], queued: ['dim', '○', 'next'], wait: ['warn', '◐', 'waiting'], paused: ['dim', '❚❚', 'paused'], done: ['ok', '✔', 'done'] };
  let h = `<div class="card">
      <button class="btn ${Plan.running ? '' : 'gold'}" style="margin:0" data-act="plan-run">${Plan.running ? '❚❚ Pause plan' : '▶ Start plan'}</button>
      <div class="${Plan.running ? '' : 'dim'}" style="margin-top:10px">${esc(Plan.top || (Plan.running ? 'starting…' : 'paused'))}</div>
      ${Plan.oldOn() ? `<div class="note warn" style="margin-top:6px">Alakazam 4.x is switched on, so the plan can't act. <button class="btn sm" data-act="oldoff">Switch 4.x off</button></div>` : ''}</div>`;

  const head = h; h = ''; // the goal list is built first, then placed under "Add a Goal"
  const open = Plan.goals.filter((g) => !g.done), done = Plan.goals.filter((g) => g.done);
  if (!open.length) h += `<div class="note">Your plan is empty. Add a goal below - the top goal that can run goes first.</div>`;
  open.forEach((g, i) => {
    const L = Plan.live(g.id) || { state: g.paused ? 'paused' : 'wait', why: 'checking…' };
    const [cls, dot, word] = light[L.state] || light.wait;
    const sp = GoalTypes[g.type]?.sprite?.(g);
    const bg = GoalTypes[g.type]?.uses === 'background';
    const sec = ['running', 'ready', 'queued'].includes(L.state) && !g.paused ? 'goals' : 'wait';
    h += `<div class="card goal" data-sec="${sec}">
        <div style="display:flex;align-items:center;gap:10px">
          <b class="dim" style="width:20px;font-size:var(--t-m)">${i + 1}</b>
          ${sp ? `<img src="${Engine.sprite(sp)}" width="44" height="44" style="image-rendering:pixelated;flex:none">` : `<span style="width:44px;text-align:center;font-size:26px;flex:none">${g.type === 'under' ? '⛏️' : g.type === 'region' ? '📘' : g.type === 'candy' ? '🍬' : g.type === 'tower' ? '🗼' : g.type === 'raid' ? '✨' : g.type === 'elite' ? '🏆' : g.type === 'league' ? '🎖️' : g.type === 'wboss' ? '🌍' : g.type === 'money' ? '💰' : '•'}</span>`}
          <div style="flex:1;min-width:0"><b class="gt" style="font-size:var(--t-m)">${esc(Plan.label(g))}</b>${bg ? ' <span class="dim gt" style="font-size:var(--t-s)">· alongside</span>' : ''}</div>
        </div>
        <div class="${cls} st" style="margin:6px 0 0 30px">${dot} ${word}${L.why ? ' · ' + esc(L.why) : ''}${L.state === 'running' && L.line ? ' · ' + esc(L.line) : ''}</div>${L.state === 'running' && L.team && (L.team.win != null || L.team.how) ? `<div class="dim" style="margin:2px 0 0 30px;font-size:var(--t-s)">🛡️ ${L.team.win != null ? Math.round(L.team.win * 100) + '% · ' : ''}${esc(L.team.how || '')}</div>` : ''}
        ${g.type === 'region' && g.rows?.length ? `<details style="margin:8px 0 0 30px" ${ui.openRows?.[g.id] ? 'open' : ''}><summary data-act="rows" data-id="${g.id}" style="cursor:pointer;color:var(--acc)">Show the ${g.rows.length} missing</summary>${g.rows.map((r) => `<div class="row" style="justify-content:flex-start;align-items:center;gap:8px"><img src="${Engine.sprite(r.id)}" width="36" height="36" style="image-rendering:pixelated;flex:none"><span style="flex:1"><b>${esc(World.dex.name(r.id))}</b><br><span class="${r.job ? 'ok' : 'dim'}">${esc(r.text)}</span></span></div>`).join('')}</details>` : ''}
        <div class="tools">
          <button class="btn sm" data-act="g-top" data-id="${g.id}" ${i === 0 ? 'disabled' : ''} title="Move to the top">Top</button>
          <button class="btn sm" data-act="g-up" data-id="${g.id}" ${i === 0 ? 'disabled' : ''} title="Move up">Up</button>
          <button class="btn sm" data-act="g-down" data-id="${g.id}" ${i === open.length - 1 ? 'disabled' : ''} title="Move down">Down</button>
          <button class="btn sm" data-act="g-pause" data-id="${g.id}">${g.paused ? 'Resume' : 'Pause'}</button>
          <button class="btn sm danger" data-act="g-del" data-id="${g.id}" title="Remove from the plan">Remove</button>
        </div>
        ${g.type === 'under' ? `<div style="margin:6px 0 0 30px;display:flex;gap:6px;flex-wrap:wrap">${ugSelects(g.from ?? 1, g.aim || 'deep', (() => { try { return Engine.get('Underground').starts() || [1]; } catch { return [1]; } })(), 'ug-from', 'ug-aim', g.id)}</div><div style="margin:4px 0 0 30px"><button class="btn sm" data-act="ug-preview" data-id="${g.id}" ${g.preview?.busy && Date.now() - g.preview.at < 300_000 ? 'disabled' : ''}>${g.preview?.busy && Date.now() - g.preview.at < 300_000 ? 'Trying start floors…' : '🔍 Preview the Pick'}</button></div>${g.preview && !g.preview.busy ? `<div class="${g.preview.error ? 'warn' : 'dim'}" style="margin:2px 0 0 30px;font-size:var(--t-s)">${g.preview.error ? esc(g.preview.error) : `Would send ${esc(g.preview.team.join(', '))}${g.preview.guide ? ` (${g.preview.guide} from the Discord guide)` : ''} from floor ${g.preview.from} (${esc(g.preview.theme || '')}): about floor ${g.preview.floors}${g.preview.low != null && g.preview.low !== g.preview.floors ? ` (${g.preview.low} on a bad run)` : ''}, ${g.preview.cleared} floors cleared, about ₽${(g.preview.value || 0).toLocaleString()} worth of loot`}</div>` : ''}${g.lastSend ? `<div class="dim" style="margin:2px 0 0 30px;font-size:var(--t-s)">Last sent from floor ${g.lastSend.from} (${esc(g.lastSend.theme || '')}): about floor ${g.lastSend.floors}${g.lastSend.low != null && g.lastSend.low !== g.lastSend.floors ? ` (${g.lastSend.low} on a bad run)` : ''}, ${g.lastSend.cleared} floors cleared</div>` : ''}` : ''}
        ${g.type === 'discord' && ['xp', 'mix', 'axsiom'].includes(g.spot) ? `<div style="margin:6px 0 0 30px"><select class="sel" data-act="disc-carrier" data-id="${g.id}"><option value="">Carrier: the fastest (Mega picks)</option>${(GoalTypes.carrierChoices?.() || []).map((c) => `<option value="${c.uid}" ${g.carrier === c.uid ? 'selected' : ''}>Carrier: ${esc(c.name)}</option>`).join('')}</select></div>` : ''}
        ${g.type === 'raid' ? `<button class="btn sm" style="margin-top:6px" data-act="m-raid-repick">🔄 Re-pick Raid Team</button>` : ''}${/zone 3 times|try anyway/.test(L.why || '') ? `<button class="btn sm" style="margin-top:6px" data-act="g-retry" data-id="${g.id}">${/try anyway/.test(L.why || '') ? 'Try Anyway' : 'Try again'}</button>` : ''}</div>`;
  });

  // adding goals lives on the Tasks tab now (2.13); the queue keeps a shortcut there
  const goalsHtml = h; h = head;
  h += `<button class="btn gold" data-act="tab" data-tab="tasks" style="margin:0 0 12px">＋ New task</button>`;
  h += goalsHtml;
  if (done.length) h += `<div class="card"><h3>Done</h3>${done.length > 25 ? `<div class="dim" style="margin-bottom:4px">The latest 25 of ${done.length}</div>` : ''}${done.slice().sort((a, b) => (+b.done || 0) - (+a.done || 0)).slice(0, 25).map((g) => `<div class="row"><span class="k">✔ ${esc(Plan.label(g))}</span><span class="v dim">${new Date(g.done).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span></div>`).join('')}<button class="btn sm" style="margin-top:6px" data-act="plan-clear">Clear done</button></div>`;

  const lines = Log.lines.slice(ui.showLog ? -40 : -6).reverse();
  h += `<div class="card"><h3>What Mega did</h3>${lines.length ? lines.map((l) => `<div class="row" style="justify-content:flex-start"><span class="k" style="white-space:nowrap;flex:none;width:78px">${new Date(l.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span><span style="text-align:left">${esc(l.text)}</span></div>`).join('') : '<div class="dim">Nothing yet.</div>'}<button class="btn" data-act="log-more">${ui.showLog ? 'Show less' : 'Show more'}</button></div>`;
  return h;
};

/* ---------------------------------------------------------------------------------------------
 * The options for one kind of goal (what used to sit under "Add a goal" on the Plan tab); the Tasks
 * tab shows it under the task you picked. Ends with one extra </div> (it closed the old card).
 * ------------------------------------------------------------------------------------------- */
Views.planAdd = (w, ui, esc) => {
  let h = '';
  const legends = Legends.list().filter((z) => z.state !== 'done' && !Plan.has(z.id));
  const order = { open: 0, closed: 1, locked: 2 };
  if (ui.addType === 'wboss') {
    h += `<button class="btn" data-act="plan-add-wboss" ${Plan.hasType('wboss') ? 'disabled' : ''}>Add to plan</button>
    <div class="note dim">Each edition: while the shield is up, uses your 3 daily attacks (the game's own pick: your strongest that haven't attacked today); when it falls, catches it like a legendary during the 24-hour window, with Golden Razz. Goes ahead of your other goals like the dailies. Elite tiers and the Elite League are added from Simulate.</div></div>`;
  } else if (ui.addType === 'item') {
    const items = DexInfo.rareItems(), it = items.find((x) => x.key === ui.addItem);
    // only what you can go and find right now (not owned, a chapter open to hunt in, not already hunted)
    const hunting = (k) => Plan.goals.some((g) => !g.done && g.type === 'loot' && g.item === k);
    const avail = items.filter((x) => x.have < x.need && x.open && !hunting(x.key));
    const later = items.filter((x) => x.have < x.need && !x.open), have = items.filter((x) => x.have >= x.need), on = items.filter((x) => x.have < x.need && x.open && hunting(x.key));
    h += `<select class="sel" data-act="add-item"><option value="">${avail.length ? `Choose one of ${avail.length} you can find…` : 'Nothing to find right now'}</option>${avail.map((x) => `<option value="${x.key}" ${ui.addItem === x.key ? 'selected' : ''}>${esc(x.name)} · ${DexInfo.pct(x.spots.find((L) => !L.blockers.length)?.chance || 0)}${x.uses.length ? ' · ' + esc(x.uses[0]) : ''}</option>`).join('')}</select>
      <div class="dim" style="font-size:var(--t-s);margin-top:6px">${on.length ? `Hunting now: ${on.map((x) => esc(x.name)).join(', ')} · ` : ''}${have.length ? `You have: ${have.map((x) => esc(x.name)).join(', ')}` : ''}${later.length ? `<br>Not yet: ${later.map((x) => `${esc(x.name)} (${esc(x.spots[0]?.blockers[0] || 'locked')})`).join(', ')}` : ''}</div>`;
    if (it) {
      h += `<div style="margin-top:8px">${it.uses.length ? `<div>Used to: ${esc(it.uses.join(', '))}</div>` : ''}${it.need > 1 ? `<div>You collect up to ${it.need} (have ${it.have}).</div>` : ''}</div>`;
      for (const L of it.spots.filter((x) => !x.blockers.length)) h += `<div style="padding:8px 0;border-top:1px solid var(--line)"><div><b>${esc(L.place)}</b> · ${esc(L.chapter)} <span class="dim">ch ${L.ch}</span> · ${DexInfo.pct(L.chance)} at its item stop</div>
        ${L.blockers.length ? `<div class="warn">needs ${esc(L.blockers.join(' · '))}</div>` : ''}${L.skies ? `<div class="dim">only in ${esc(L.skies.join(' / '))}</div>` : ''}
        <button class="btn${L === it.spots[0] ? ' gold' : ''}" data-act="plan-add-item" data-item="${it.key}" data-ch="${L.ch}" data-place="${esc(L.place)}" data-need="${it.need}" ${Plan.goals.some((g) => !g.done && g.type === 'loot' && g.item === it.key) ? 'disabled' : ''}>Add: Hunt Here</button></div>`;
    }
    h += `<div class="note dim">Rare finds sit at a chapter's item stop (it appears in about 70% of runs). Mega goes there, restarts the chapter whenever the stop isn't in the run, and keeps going until the item is in your bag. Locked ones can go on the list and wait.</div></div>`;
  } else if (ui.addType === 'money') {
    const have = +(Engine.get('Game.S')?.money ?? 0);
    h += `<select class="sel" data-act="add-money">${[1e6, 2e6, 5e6, 1e7, 2e7, 5e7].filter((x) => x > have).map((x) => `<option value="${x}" ${+ui.addMoney === x ? 'selected' : ''}>Up to ₽${x.toLocaleString()}</option>`).join('')}</select>
    <button class="btn" data-act="plan-add-money">Add to plan</button>
    <div class="note dim">You have ₽${have.toLocaleString()}. Farms the chapter that pays the most with the Pokémon that clear it fastest, keeps a Lansat Berry going, shows ₽ per hour, and puts your team and chapter back when it reaches the target.</div></div>`;
  } else if (ui.addType === 'raid') {
    h += `<button class="btn" data-act="plan-add-raid" ${Plan.hasType('raid') ? 'disabled' : ''}>Add to plan</button>
    <div class="note dim">Plays today's Shiny Raid once it's drawn: picks your 2 best against the boss and the ally trainers whose Pokémon do best, starts it, and lets the game retry until you win. Uses the daily reroll only when today's boss is a shiny you already own (or clearly weak) and another region's boss would be better.</div></div>`;
  } else if (ui.addType === 'tower') {
    h += `<button class="btn" data-act="plan-add-tower" ${Plan.hasType('tower') ? 'disabled' : ''}>Add to plan</button>
    <div class="note dim">Plays one Battle Tower run each week (the game picks the lineup from all your Pokémon) and lets it run to the end. Goes ahead of your other goals like the other dailies.</div></div>`;
  } else if (ui.addType === 'train') {
    h += `<button class="btn" data-act="plan-add-train" ${Plan.hasType('train') ? 'disabled' : ''}>Add to plan</button>
    <div class="note dim">Exactly what the plan does when it has nothing to do - levels your team first, then your strongest in the PC, in the chapter with the best XP per hour - but as a goal in your list: goals above it go first, goals below wait. It never finishes by itself; remove or pause it when you're done.</div></div>`;
  } else if (String(ui.addType).startsWith('discord-')) {
    const k = ui.addType.slice(8), v = (GoalTypes.discordSpots || {})[k] || {};
    const WHY = { money: 'The most money of every loop with an endgame team: Mega sends your 6 fastest clearers, so laps are quick.', xp: 'The whole Kanto Pokémon League (Elite Four and Champion) as one loop. Every team member gets each win\'s XP even if it never fights: one carrier that sweeps it (two if the simulation says one alone is slower) and the rest leveling - your team first, then your strongest in the PC.', axsiom: 'Axsiom\'s run: Giant Chasm with ONE carrier (his are rank V) and the other five leveling, with the Shiny berry on all the time plus a catch berry (Golden Razz, then Razz - a shiny gets one ball), Money and XP berries. Giant Chasm can drop Shiny berries, so the Shiny berry keeps itself going. Mega simulates the whole chapter to check one carrier clears it.', mix: 'The best mix of money, battle XP and Exp. Candies: Mega levels your Pokémon there with carriers, with a Lansat Berry for the money too.', candy: 'The most Exp. Candy drops (random, so it shifts run to run): your 6 fastest clearers on a loop. The goal shows how many candies came in.' }[k] || '';
    h += `<button class="btn" data-act="plan-add-discord" data-spot="${k}">Add to plan</button>
    <div class="note dim">From the Discord's Auto-Replay Farming Guide (made on game v0.5.091 - later versions changed XP and money for older regions, so Mega's own measuring may disagree). ${WHY} While it runs, ${esc(v.where || 'the spot')} is your only loop (the game goes on to the next looped chapter after each one); your team, chapter and loops come back when you pause or remove it. It never finishes by itself.</div></div>`;
  } else if (ui.addType === 'bloc') {
    h += `<button class="btn" data-act="plan-add-bloc" ${Plan.hasType('bloc') ? 'disabled' : ''}>Add to plan</button>
    <div class="note dim">Once a day, after the daily reset: tries hundreds of 10-Pokémon teams with the game's own Pokéblock Boss forecast (the same team on the same day always ends the same way), then attacks with the one that empties the most bars. The attack is instant - nobody is sent away, so the 10 stay free for raids and the Underground.</div></div>`;
  } else if (ui.addType === 'candy') {
    h += `<button class="btn" data-act="plan-add-candy" ${Plan.hasType('candy') ? 'disabled' : ''}>Add to plan</button>
    <div class="note dim">Runs the Candy Factory once a day as soon as it opens: reads the day's type, picks the six that beat it best, starts the run, and lets it play out. Dailies go ahead of your other goals, like in 4.x.</div></div>`;
  } else if (ui.addType === 'story') {
    // regions you've unlocked whose League isn't beaten yet (new regions show up here as the game adds them)
    const ST = Engine.get('STORY'), un = +(Engine.get('Game.S')?.adv?.unlocked ?? 0), NM = { unova: 'Unova', kalos: 'Kalos', alola: 'Alola', galar: 'Galar', paldea: 'Paldea' };
    const regs = (ST?.REGIONS || []).filter((r) => r && r.key).map((r) => { let chs = []; try { chs = ST.chaptersOf(r.key) || []; } catch (__e) { __h('58-planview:112', __e); } return { key: r.key, name: NM[r.key] || r.name, chs }; })
      .filter((r) => r.chs.length && un >= r.chs[0] && !Engine.read('Game.regionCleared', false, r.key));
    h += regs.length ? `<select class="sel" data-act="add-story"><option value="">Choose a region…</option>${regs.map((r) => `<option value="${r.key}" ${ui.addStory === r.key ? 'selected' : ''} ${Plan.goals.some((g) => !g.done && g.type === 'story' && g.region === r.key) ? 'disabled' : ''}>${esc(r.name)} League${Plan.goals.some((g) => !g.done && g.type === 'story' && g.region === r.key) ? ' (in your plan)' : ''}</option>`).join('')}</select>
    <button class="btn" data-act="plan-add-story" ${ui.addStory ? '' : 'disabled'}>Add to plan</button>` : `<div class="note">Every League you've unlocked is beaten.</div>`;
    h += `<div class="note dim">Plays that region's chapters in order with the Pokémon caught there: the simulator picks the 6 best for each chapter and its gym, and after 2 losses in a row it trains for 30 minutes in the best cleared chapter, then tries again. It stays in that region's chapters (an older chapter would swap your money, bag and team) and sits below your dailies, which take the screen when they're due.</div></div>`;
  } else if (ui.addType === 'league') {
    const L = GoalTypes.eliteLeagues?.() || [];
    const lbl = (r) => `${esc(r.name)} · ${r.best} of 5 won${r.odds != null ? ` · tier ${r.best + 1}: ${r.odds >= 0.995 ? '99+' : r.odds > 0 && r.odds < 0.01 ? '<1' : Math.round(r.odds * 100)}% win` : ''}${r.best < 5 ? ` · gems: ${r.types.map((t) => t[0].toUpperCase() + t.slice(1)).join(', ')}` : ''}${r.inPlan ? ' (in your plan)' : !r.open ? ' (win its League first)' : r.best >= 5 ? ' (all won)' : ''}`;
    h += `<select class="sel" data-act="add-league"><option value="">Choose a region…</option>${L.map((r) => `<option value="${r.key}" ${ui.addLeague === r.key ? 'selected' : ''} ${r.inPlan || !r.open || r.best >= 5 ? 'disabled' : ''}>${lbl(r)}</option>`).join('')}</select>
    <button class="btn" data-act="plan-add-league" ${ui.addLeague ? '' : 'disabled'}>Add to plan</button>
    <div class="note dim">That region's Elite Four + Champion again, at Lv 100 and ranked to the tier (tier 1 = rank 1 … tier 5 = rank 5), with a Pokémon Center before each one. Win all five in a row to win the tier. <b>Every tier pays once: 1 Legendary gem</b> of one of that League's types (you pick it in the game), and tiers 3 and 5 also give a frame. Mega simulates each tier to pick your best 6 (any region's Pokémon can join), shows the odds, and steps back after 10 losses at one tier.</div></div>`;
  } else if (ui.addType === 'region') {
    const regs = (Engine.get('STORY.REGIONS') || []).filter((r) => r && r.key).map((r) => ({ ...r, miss: GoalTypes.regionMissing(r.key).length })).filter((r) => r.miss);
    h += `<select class="sel" data-act="add-reg"><option value="">Choose a region…</option>${regs.map((r) => `<option value="${r.key}" ${ui.addReg === r.key ? 'selected' : ''} ${Plan.goals.some((g) => !g.done && g.type === 'region' && g.reg === r.key) ? 'disabled' : ''}>${esc(r.name || r.key)} · ${r.miss} missing</option>`).join('')}</select>
    <button class="btn" data-act="plan-add-reg" ${ui.addReg ? '' : 'disabled'}>Add to plan</button>
    <div class="note dim">Finds a way to get each missing Pokémon and adds those jobs to your plan right below it: catch in the wild (restarting the chapter when it can't show up any more), level to evolve, or catch the legendary. What it can't do yet is listed with the reason.</div></div>`;
  } else
  if (ui.addType === 'under') {
    const starts = (() => { try { return Engine.get('Underground').starts() || [1]; } catch { return [1]; } })();
    h += ugSelects(ui.addFrom ?? 'auto', ui.addAim || 'deep', starts, 'add-from', 'add-aim') + `
    <button class="btn" data-act="plan-add-ug" ${Plan.hasType('under') ? 'disabled' : ''}>Add to plan</button>
    <div class="note dim">Runs next to your other goals: brings finished expeditions home (never early), sends new ones while you have runs left today, and picks each team with the game's own expedition simulation from Pokémon your other goals and chapter team aren't using.</div></div>`;
  } else {
  h += `
    <select class="sel" data-act="add-foe"><option value="">Choose a legendary…</option>${[...legends].sort((a, b) => order[a.state] - order[b.state] || a.id - b.id).map((z) =>
      `<option value="${z.id}" ${+ui.addFoe === z.id ? 'selected' : ''}>${esc(z.name)} · ${z.state === 'open' ? 'open' : z.state === 'closed' ? 'closed now' : 'locked'}</option>`).join('')}</select>
    <button class="btn" data-act="plan-add" ${ui.addFoe ? '' : 'disabled'}>Add to plan</button>
    <div class="note dim">Locked ones can go on the list too: they wait until you unlock them. A legendary with no team gets one from the simulator automatically.</div></div>`;
  }

  return h;
};

/* ---------------------------------------------------------------------------------------------
 * Queue tab (2.13.12, Jimmy 2026-11-23: "copy the exact layout of ZG"): a heading with the counts
 * and New task, then one list - the tasks in order, then the finished ones. Each row: position,
 * name, a state chip, one detail line, and its buttons. No sections, no log (that's on Now).
 * ------------------------------------------------------------------------------------------- */
Views.queue = (w, ui, esc) => {
  if (!w.ok) return `<div class="note">Waiting for the game engine.</div>`;
  const open = Plan.goals.filter((g) => !g.done), done = Plan.goals.filter((g) => g.done).sort((a, b) => (+b.done || 0) - (+a.done || 0));
  const CHIP = { running: ['run', 'Running'], ready: ['run', 'Running'], queued: ['', 'Next'], wait: ['wait', 'Waiting'], paused: ['wait', 'Paused'] };
  const nextUp = open.find((g) => !g.paused && ['queued', 'ready'].includes(Plan.live(g.id)?.state));
  let h = `<div class="qhead"><div><h2>Task queue</h2><p>${open.length} to do · ${done.length} finished</p></div><button class="qbtn" data-act="tab" data-tab="tasks">New task</button></div>`;
  const notice = !Plan.running ? 'Mega is stopped - press Start Mega to run the queue.' : Plan.oldOn() ? 'Alakazam 4.x is switched on, so the queue can\'t act.' : nextUp ? `Next · ${Plan.label(nextUp)}` : '';
  if (notice) h += `<p class="qnote">${esc(notice)}${Plan.oldOn() ? ' <button class="qbtn" data-act="oldoff">Switch 4.x off</button>' : ''}</p>`;
  h += `<ol class="qlist">`;
  if (!open.length) h += `<li class="qempty">Nothing in the queue. Pick a task on the Tasks tab, then Start Now or Add to Queue.</li>`;
  open.forEach((g, i) => {
    const L = Plan.live(g.id) || { state: g.paused ? 'paused' : 'wait', why: 'checking…' };
    const [cc, word] = g.paused ? CHIP.paused : CHIP[L.state] || CHIP.wait;
    const bg = GoalTypes[g.type]?.uses === 'background';
    const detail = [bg ? 'runs alongside' : '', L.why, L.state === 'running' ? L.line : ''].filter(Boolean).join(' · ');
    h += `<li class="qjob${cc === 'run' ? ' on' : ''}"><div class="qjh"><span class="qpos">${i + 1}</span><strong>${esc(Plan.label(g))}</strong><span class="qst ${cc}">${word}</span></div>
      ${detail ? `<p class="qd">${esc(detail)}</p>` : ''}
      ${g.type === 'region' && g.rows?.length ? `<details class="qd" ${ui.openRows?.[g.id] ? 'open' : ''}><summary data-act="rows" data-id="${g.id}" style="cursor:pointer;color:var(--acc)">Show the ${g.rows.length} missing</summary>${g.rows.map((r) => `<div class="row" style="justify-content:flex-start;align-items:center;gap:8px"><img src="${Engine.sprite(r.id)}" width="32" height="32" style="image-rendering:pixelated;flex:none"><span style="flex:1"><b>${esc(World.dex.name(r.id))}</b><br><span class="${r.job ? 'ok' : 'dim'}">${esc(r.text)}</span></span></div>`).join('')}</details>` : ''}
      ${g.type === 'under' ? `<div class="qx">${ugSelects(g.from ?? 1, g.aim || 'deep', (() => { try { return Engine.get('Underground').starts() || [1]; } catch { return [1]; } })(), 'ug-from', 'ug-aim', g.id)}</div>${g.lastSend ? `<p class="qd">Last sent from floor ${g.lastSend.from}: about floor ${g.lastSend.floors}, ${g.lastSend.cleared} floors cleared</p>` : ''}` : ''}
      ${g.type === 'discord' && ['xp', 'mix', 'axsiom'].includes(g.spot) ? `<div class="qx"><select class="sel" data-act="disc-carrier" data-id="${g.id}"><option value="">Carrier: the fastest (Mega picks)</option>${(GoalTypes.carrierChoices?.() || []).map((c) => `<option value="${c.uid}" ${g.carrier === c.uid ? 'selected' : ''}>Carrier: ${esc(c.name)}</option>`).join('')}</select></div>` : ''}
      <div class="qact"><button data-act="g-top" data-id="${g.id}" ${i === 0 ? 'disabled' : ''}>Top</button><button data-act="g-up" data-id="${g.id}" ${i === 0 ? 'disabled' : ''}>Up</button><button data-act="g-down" data-id="${g.id}" ${i === open.length - 1 ? 'disabled' : ''}>Down</button><button data-act="g-pause" data-id="${g.id}">${g.paused ? 'Resume' : 'Pause'}</button>${g.type === 'under' ? `<button data-act="ug-preview" data-id="${g.id}">Preview pick</button>` : ''}${g.type === 'raid' ? '<button data-act="m-raid-repick">Re-pick team</button>' : ''}${/zone 3 times|try anyway/.test(L.why || '') ? `<button data-act="g-retry" data-id="${g.id}">${/try anyway/.test(L.why || '') ? 'Try anyway' : 'Try again'}</button>` : ''}<button class="rm" data-act="g-del" data-id="${g.id}">Remove</button></div>
      ${g.type === 'under' && g.preview && !g.preview.busy ? `<p class="qd ${g.preview.error ? 'warn' : ''}">${g.preview.error ? esc(g.preview.error) : `Would send ${esc(g.preview.team.join(', '))} from floor ${g.preview.from}: about floor ${g.preview.floors}, ₽${(g.preview.value || 0).toLocaleString()} of loot`}</p>` : ''}</li>`;
  });
  for (const g of done.slice(0, 10)) h += `<li class="qjob"><div class="qjh"><span class="qpos">✔</span><strong>${esc(Plan.label(g))}</strong><span class="qst run">Done</span></div><p class="qd">${new Date(g.done).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</p></li>`;
  h += `</ol>`;
  if (done.length) h += `<button class="qbtn" style="margin-top:8px" data-act="plan-clear">Clear ${done.length} finished</button>`;
  return h;
};

/* ---------------------------------------------------------------------------------------------
 * Trade picker tags (Jimmy, 2026-11-19, from the old helper): in the game's "Wanted species" window
 * (Trades > new offer, step 1) every species gets a tag - its rarity (COMMON / UNCOMMON / RARE / LEGEND,
 * which is also what you have to offer for it) and ✓ ×N when you own it - plus a "Hide ones I own"
 * checkbox above the grid (remembered).
 * The rarity is the game's own: it marks each cell with a glow class (t-common / t-uncommon / t-rare /
 * t-legendary). "Own" is what you have right now (Pokémon traded away or evolved don't count), not the
 * game's "Already caught" mark; it includes the Underground, and m.egg only means "hatched from an egg". Read-only: it only adds tags and hides cells, it never picks or trades.
 * ------------------------------------------------------------------------------------------- */
const TradePick = (() => {
  const KEY = 'mega-trade-hideowned';
  const LABEL = { 't-common': 'COMMON', 't-uncommon': 'UNCOMMON', 't-rare': 'RARE', 't-legendary': 'LEGEND', 't-legend': 'LEGEND', 't-unique': 'UNIQUE' };
  const KEY2 = 'mega-trade-onlyspare';
  let onlySpare = (() => { try { return localStorage.getItem(KEY2) === '1'; } catch { return false; } })();
  let hide = (() => { try { return localStorage.getItem(KEY) !== '0'; } catch { return true; } })();
  function css() {
    if (document.getElementById('mega-tradepick-css')) return;
    const st = document.createElement('style'); st.id = 'mega-tradepick-css';
    st.textContent = `
      .mega-tp{position:absolute;left:3px;top:3px;z-index:3;pointer-events:none;display:flex;gap:3px;flex-wrap:wrap}
      .mega-tp b{font:800 10px/1 Inter,system-ui,sans-serif;padding:3px 5px;border-radius:6px;letter-spacing:.03em;box-shadow:0 1px 4px #0007}
      .mega-tp .t-common{background:#9aa4b1;color:#111}.mega-tp .t-uncommon{background:#3b82f6;color:#fff}.mega-tp .t-rare{background:#a855f7;color:#fff}
      .mega-tp .t-legendary,.mega-tp .t-legend,.mega-tp .t-unique{background:#f6c744;color:#1a1405}.mega-tp .own{background:#5ad68a;color:#0d1a12}
      .ot-cell.mega-owned{opacity:.55}.ot-cell.mega-owned:hover{opacity:1}
      .mega-hideowned .ot-cell.mega-owned{display:none}
      .mega-tp .spare,.mega-tpbar i.spare{background:#5ad68a;color:#0d1a12}.mega-tp .keep,.mega-tpbar i.keep{background:#ffb547;color:#1a1405}.mega-tp .last,.mega-tpbar i.last{background:#ff6b6b;color:#fff}
      .mega-tpbar i{font:800 10px/1 Inter,system-ui,sans-serif;font-style:normal;padding:2px 5px;border-radius:6px}
      .mega-onlyspare .ot-cell:not(.mega-spare){display:none}
      .mega-hot{font:800 10px/1 Inter,system-ui,sans-serif;padding:3px 5px;border-radius:6px;background:#ff7a1a;color:#fff;box-shadow:0 1px 4px #0007;letter-spacing:.03em}
      .pc-cell>.mega-hot{position:absolute;left:2px;top:2px;z-index:3;pointer-events:none}
      .meta b .mega-hot{margin-left:6px;vertical-align:middle}
      .mega-tpbar{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin:6px 2px 8px;font:600 14px/1.3 Inter,system-ui,sans-serif}
      .mega-tpbar label{display:flex;align-items:center;gap:6px;cursor:pointer}.mega-tpbar input{width:18px;height:18px}
      .mega-tpbar span{opacity:.75;font-weight:500}`;
    document.head.appendChild(st);
  }
  function scan() {
    const dlg = [...document.querySelectorAll('.ot-pickdlg')].find((d) => d.offsetParent || d.getClientRects().length);
    if (!dlg) return;
    const cells = [...dlg.querySelectorAll('.ot-cell')];
    if (!cells.length) return;
    css();
    if (dlg.querySelector('.ot-box.give') || /step 2/i.test(dlg.textContent.slice(0, 80))) return scanGive(dlg, cells); // step 2: your own Pokémon
    const counts = {};
    try { for (const m of Engine.read('Game.ownedMons', []) || []) counts[+m.id] = (counts[+m.id] || 0) + 1; } catch (__e) { __h('58-tradepick:45', __e); }
    for (const c of cells) {
      const id = +c.querySelector('img[data-id]')?.dataset.id; if (!id) continue;
      const tier = [...(c.querySelector('.tglow')?.classList || [])].find((x) => /^t-/.test(x)) || '';
      const n = counts[id] || 0, sig = tier + '|' + n;
      if (c.dataset.megaTp === sig) continue;
      c.dataset.megaTp = sig;
      let tag = c.querySelector('.mega-tp');
      if (!tag) { tag = document.createElement('div'); tag.className = 'mega-tp'; if (getComputedStyle(c).position === 'static') c.style.position = 'relative'; c.appendChild(tag); }
      tag.innerHTML = (LABEL[tier] ? `<b class="${tier}">${LABEL[tier]}</b>` : '') + (n ? `<b class="own">✓ ×${n}</b>` : '');
      c.classList.toggle('mega-owned', n > 0);
    }
    dlg.querySelector('.mega-tpbar.give')?.remove(); dlg.classList.remove('mega-onlyspare');
    for (const c of cells) c.classList.remove('mega-spare');
    if (!dlg.querySelector('.mega-tpbar')) {
      const bar = document.createElement('div'); bar.className = 'mega-tpbar';
      bar.innerHTML = `<label><input type="checkbox"> Hide ones I own</label><span>Tag = rarity (what you must offer) · ✓ ×N = you own N</span>`;
      const cb = bar.querySelector('input'); cb.checked = hide;
      cb.addEventListener('change', () => { hide = cb.checked; try { localStorage.setItem(KEY, hide ? '1' : '0'); } catch (__e) { __h('58-tradepick:63', __e); } dlg.classList.toggle('mega-hideowned', hide); });
      const grid = cells[0].parentElement; grid.parentElement.insertBefore(bar, grid);
    }
    dlg.classList.toggle('mega-hideowned', hide);
  }
  // Step 2 ("Your Pokémon", Jimmy 2026-11-19): how many spares you have of each species, and a "Show only spares" box.
  // A spare = any copy of a species you have 2+ of (Jimmy: one left is fine, he breeds more), unless it's
  // in your team / buddy / Day Care or a Pokémon a Mega goal is using (level goals, Legendary and roamer
  // teams, the Shiny Raid team). The grid has no uid, so copies are matched by species + level (spares first).
  function scanGive(dlg, cells) {
    const s = Engine.read('Game.S', {}) || {};
    const owned = (Engine.read('Game.ownedMons', []) || []).filter((m) => m && m.id);
    let rsv = new Set();
    try { rsv = GoalTypes.reserved(); } catch (__e) { __h('58-tradepick:76', __e); }
    for (const u of [...(s.team || []), s.buddy?.uid]) if (u) rsv.add(u);
    const care = new Set((s.pension?.mons || []).map((x) => x.mon?.uid).filter(Boolean));
    const by = {};
    for (const m of owned) (by[+m.id] ||= []).push(m);
    const info = {}; // id -> { n, spares: Set(uid), why: uid -> text }
    for (const [id, list] of Object.entries(by)) {
      const why = {}, spares = new Set();
      for (const m of list) {
        why[m.uid] = m.fav ? 'a favorite (the game won\'t trade favorites)' : m.shiny ? 'shiny' : care.has(m.uid) ? 'in the Day Care'
          : rsv.has(m.uid) ? ((s.team || []).includes(m.uid) ? 'in your team' : s.buddy?.uid === m.uid ? 'your buddy' : 'a Mega goal is using it') : '';
        if (!why[m.uid] && list.length >= 2) spares.add(m.uid);
      }
      info[id] = { n: list.length, spares, why };
    }
    const used = new Set();
    let sig = '';
    for (const c of cells) {
      const id = +c.querySelector('img[data-id]')?.dataset.id; if (!id) continue;
      const lv = +(/Lv\.?\s*(\d+)/.exec(c.querySelector('.ot-cell-l')?.textContent || c.textContent)?.[1] || 0);
      const I = info[id] || { n: 0, spares: new Set(), why: {} };
      const cands = (by[id] || []).filter((m) => +m.level === lv && !used.has(m.uid) && !m.shiny).sort((a, b) => (I.spares.has(b.uid) - I.spares.has(a.uid)));
      const m = cands[0]; if (m) used.add(m.uid);
      const spare = !!m && I.spares.has(m.uid);
      const kind = spare ? 'spare' : I.n <= 1 ? 'last' : 'keep';
      const text = spare ? `SPARE · have ${I.n}` : I.n <= 1 ? 'LAST ONE' : `IN USE · have ${I.n}`;
      sig += kind;
      let tag = c.querySelector('.mega-tp');
      if (!tag) { tag = document.createElement('div'); tag.className = 'mega-tp'; if (getComputedStyle(c).position === 'static') c.style.position = 'relative'; c.appendChild(tag); }
      if (tag.dataset.t !== text) { tag.dataset.t = text; tag.innerHTML = `<b class="${kind}">${text}</b>`; }
      c.classList.toggle('mega-spare', spare);
      c.title = `Mega: you have ${I.n}` + (m && !spare ? ` - this one is ${I.n <= 1 ? 'your only one: trading it sends its Pokédex entry back to "seen"' : I.why[m.uid] || 'kept'}` : '');
    }
    dlg.querySelector('.mega-tpbar:not(.give)')?.remove(); dlg.classList.remove('mega-hideowned');
    if (!dlg.querySelector('.mega-tpbar.give')) {
      const bar = document.createElement('div'); bar.className = 'mega-tpbar give';
      bar.innerHTML = `<label><input type="checkbox"> Show only spares</label><span><i class="spare">SPARE</i> you have 2+, any one can go · <i class="keep">IN USE</i> team, buddy, Day Care or a Mega goal · <i class="last">LAST ONE</i> your only copy</span>`;
      const cb = bar.querySelector('input'); cb.checked = onlySpare;
      cb.addEventListener('change', () => { onlySpare = cb.checked; try { localStorage.setItem(KEY2, onlySpare ? '1' : '0'); } catch (__e) { __h('58-tradepick:114', __e); } dlg.classList.toggle('mega-onlyspare', onlySpare); });
      const grid = cells[0].parentElement; grid.parentElement.insertBefore(bar, grid);
    }
    dlg.classList.toggle('mega-onlyspare', onlySpare);
    return sig;
  }
  // ---- Trade demand (Jimmy 2026-11-19): which species people keep asking for on the trade board, tagged in the
  // Day Care so he knows what's worth breeding. Every 12 h Mega reads every species' offers (the read-only call the
  // Trades screen makes, one species every 2 s) and counts what each offer WANTS. Shiny offers are left out.
  const DKEY = 'mega-trade-demand', DEVERY = 12 * 3600_000;
  let demand = (() => { try { return JSON.parse(localStorage.getItem(DKEY) || 'null'); } catch { return null; } })();
  let crawling = false;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function crawl() {
    if (crawling || !Engine.ready() || !Engine.get('Cloud.trades')) return;
    if (demand && Date.now() - demand.at < DEVERY) return;
    crawling = true;
    try {
      const R = [...new Set((Engine.get('STORY.REGIONS') || []).filter((r) => r.open && r.dex).map((r) => r.key))];
      const sp = await Engine.call('Cloud.trades.species', R, [], []);
      const rows = (sp?.data || []).filter((r) => !r[1] && +r[2] > 0);
      const counts = {}; let offers = 0;
      for (const r of rows) {
        const res = await Engine.call('Cloud.trades.offers', R, +r[0], false).catch(() => null);
        for (const o of res?.data || []) { const w = +o.want_id; if (w) { counts[w] = (counts[w] || 0) + 1; offers++; } }
        await sleep(2000);
      }
      if (offers) { demand = { at: Date.now(), counts, offers }; try { localStorage.setItem(DKEY, JSON.stringify(demand)); } catch (__e) { __h('58-tradepick:141', __e); } }
    } catch (e) { console.warn('[Mega Alakazam] trade demand', e); } finally { crawling = false; }
  }
  // "high demand" = the 25 most-wanted species (at least 4 offers asking for it)
  function hot() {
    if (!demand?.counts) return new Map();
    if (hot.at === demand.at) return hot.map;
    const top = Object.entries(demand.counts).filter(([, n]) => n >= 4).sort((a, b) => b[1] - a[1]).slice(0, 25);
    hot.at = demand.at; hot.map = new Map(top.map(([id, n], i) => [+id, { n, rank: i + 1 }]));
    return hot.map;
  }
  function scanCare() {
    const scr = document.getElementById('screen-pension');
    if (!scr || !scr.classList.contains('active')) return;
    const H = hot(); if (!H.size) return;
    css();
    const D = Engine.get('Game.DEX') || {};
    for (const c of scr.querySelectorAll('.pen-res, .pc-cell')) {
      const id = +c.querySelector('img[data-id]')?.dataset.id; if (!id) continue;
      const h = H.get(id), sig = h ? `${h.n}|${h.rank}` : '';
      if (c.dataset.megaHot === sig) continue;
      c.dataset.megaHot = sig;
      c.querySelector('.mega-hot')?.remove();
      if (!h) continue;
      const b = document.createElement('b'); b.className = 'mega-hot';
      b.textContent = `WANTED ×${h.n}`;
      b.title = `Mega: ${h.n} trade offers ask for ${D[id]?.name || '#' + id} (#${h.rank} most wanted on the board, checked ${new Date(demand.at).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}). Breeding its family gives you copies to trade.`;
      if (getComputedStyle(c).position === 'static') c.style.position = 'relative';
      (c.querySelector('.meta b') || c).appendChild(b);
    }
  }
  setInterval(() => { try { if (Engine.ready()) scanCare(); } catch (e) { console.warn('[Mega Alakazam] day care demand tags', e); } }, 1500);
  setTimeout(() => crawl(), 60_000); setInterval(() => crawl(), 30 * 60_000);
  setInterval(() => { try { if (Engine.ready()) scan(); } catch (e) { console.warn('[Mega Alakazam] trade picker tags', e); } }, 700);
  return { scan, crawl, get demand() { return demand; }, hot };
})();

/* ---------------------------------------------------------------------------------------------
 * Pokédex detail page: everything about one Pokémon - status, where it lives, special encounters
 * with their weather / time / requirements and the next chance from the game's forecast,
 * evolution, legendary zone, forms - and a button that adds the right job to the plan.
 * Cached for 20 s: the wild scan reads every chapter.
 * ------------------------------------------------------------------------------------------- */
const DexView = (() => {
  let cache = { id: null, at: 0, html: '' };
  const row = (k, v, cls = '') => `<div class="row"><span class="k">${k}</span><span class="v ${cls}">${v}</span></div>`;
  const tick = (ok) => (ok ? '<span class="ok">✓</span>' : '<span class="bad">✗</span>');
  function render(id, esc) {
    if (cache.id === id && Date.now() - cache.at < 20_000) return cache.html;
    const h = DexInfo.howTo(id), r = DexInfo.route(id), D = Engine.get('Game.DEX') || {};
    const nm = (x) => esc(D[x]?.name || '#' + x);
    const stateTxt = h.registered ? '<span class="ok">registered</span>' : `<span class="bad">not registered</span>${h.state && h.state !== 'unknown' ? ` <span class="dim">(${esc(h.state)})</span>` : ''}`;
    let o = `<button class="btn sm" data-act="dexback" style="margin:0 0 10px">‹ Back to the Pokédex</button>`;
    o += `<div class="card"><div style="display:flex;gap:14px;align-items:center">
      <img src="${Engine.sprite(id)}" width="96" height="96" style="image-rendering:pixelated;background:var(--well);border-radius:14px;flex:none">
      <div style="flex:1"><div style="font-size:20px;font-weight:800">${esc(h.name)}</div>
      <div class="dim">#${D[id]?.num ?? id} · ${h.types.map(esc).join(' / ')}${h.legendary ? ' · legendary' : h.mythical ? ' · mythical' : ''}</div>
      <div style="margin-top:4px">${stateTxt}${h.owned ? ` · you own ${h.owned}` : ''}</div>${!h.registered && DexInfo.availableNow(id) ? `<div class="ok" style="margin-top:4px">● ${esc(DexInfo.availableNow(id))}</div>` : ''}</div></div></div>`;

    // the plan's way in
    const auto = ['legend', 'wild', 'evolve', 'special', 'loot', 'breed'].includes(r.kind);
    const inPlan = Plan.goals.find((g) => !g.done && ((['legend', 'wild', 'special', 'breed'].includes(g.type) && g.foe === +id) || (g.type === 'level' && g.forDex === +id) || (g.type === 'loot' && g.item === 'egg:' + id)));
    if (!h.registered) {
      // every way in, best first - each with its own button (e.g. level Elekid OR catch Electabuzz)
      const ways = DexInfo.routes(id), AUTO = ['legend', 'wild', 'evolve', 'special', 'loot', 'breed'];
      o += `<div class="card"><h3>${ways.length > 1 ? 'Ways to Get It' : 'Best Way to Get It'}</h3>`;
      if (inPlan) o += `<div class="note" style="margin-bottom:8px">Already in your plan: ${esc(Plan.label(inPlan))} <button class="btn sm" data-act="tab" data-tab="plan">Open plan</button></div>`;
      ways.forEach((wy, k) => {
        o += `<div style="${k ? 'border-top:1px solid var(--line);margin-top:10px;padding-top:10px' : ''}">
          ${ways.length > 1 ? `<div class="dim" style="font-size:var(--t-s);font-weight:700">${k === 0 ? 'BEST' : 'OR'}</div>` : ''}
          <div>${esc(wy.text)}</div>`;
        if (wy.kind === 'wild') { // every chapter it lives in: pick the one to add
          const W = DexInfo.wild(id);
          o += `<div style="margin-top:6px">${W.map((c) => `<div style="padding:8px 0;border-top:1px solid var(--line)">
            <div><b>${esc(c.chapter)}</b> <span class="dim">ch ${c.ch}</span> · ${DexInfo.pct(c.best)}${c.open ? (c.now ? ' <span class="ok">● now</span>' : ' <span class="warn">not at this time / weather</span>') : ' <span class="dim">· not unlocked</span>'}</div>
            <div class="dim" style="font-size:var(--t-s)">${c.spots.map((x) => `${esc(x.place)} (${DexInfo.pct(x.pct)}${x.when?.length ? ` · ${x.on ? '' : '<span class="warn">'}${esc(DexInfo.whenText(x.when))} only${x.on ? '' : '</span>'}` : ''}${x.fights ? ` · ${x.fights} wild fight${x.fights > 1 ? 's' : ''} per run` : ''})`).join(' · ')}</div>
            ${c.open && !inPlan ? `<button class="btn${c.ch === wy.ch ? ' gold' : ''}" data-act="dex-add-wild" data-id="${id}" data-ch="${c.ch}">Add: Catch Here</button>` : ''}</div>`).join('')}</div></div>`;
          return;
        }
        if (wy.kind === 'egg') o += `<div class="note dim" style="margin-top:6px">Nothing to add - a region goal in your plan hatches it as soon as it's ready.</div>`;
        else if (AUTO.includes(wy.kind) && !inPlan) o += `<button class="btn${k === 0 ? ' gold' : ''}" data-act="dex-add" data-id="${id}" data-way="${k}">${wy.kind === 'evolve' ? 'Add: Level to Evolve' : wy.kind === 'wild' ? 'Add: Catch in the Wild' : wy.kind === 'breed' ? 'Add: Breed It' : wy.kind === 'loot' ? 'Add: Find the Egg' : 'Add This to My Plan'}</button>`;
        else if (!AUTO.includes(wy.kind)) o += `<div class="note dim" style="margin-top:6px">Mega can't do this one by itself yet.</div>`;
        o += `</div>`;
      });
      o += `</div>`;
    }

    if (h.eggs.length) o += `<div class="card"><h3>Egg in the Day Care</h3>${h.eggs.map((e) => row('Egg', e.ready ? '<span class="ok">ready to hatch</span>' : `hatches <b>${DexInfo.clock(e.hatchAt)}</b>`)).join('')}</div>`;
    for (const L of h.loot) {
      o += `<div class="card"><h3>Rare find · ${esc(L.place)}</h3>${row('Item', esc(DexInfo.itemName('egg:' + id)))}${row('Chapter', `${esc(L.chapter)} <span class="dim">(ch ${L.ch})</span>`)}${row('Chance', `${DexInfo.pct(L.chance)} each time you reach its item stop`)}`;
      o += row('Item stop', 'shows up in about 70% of chapter runs');
      if (L.blockers.length) o += row('Needs', esc(L.blockers.join(' · ')), 'warn');
      if (h.eggSlots.max) o += row('Day Care egg slots', `${h.eggSlots.used}/${h.eggSlots.max}${h.eggSlots.used >= h.eggSlots.max ? ' <span class="warn">full</span>' : ''}`);
      o += `</div>`;
    }
    if (h.breed) o += `<div class="card"><h3>Breeding</h3>${row('Laid by', h.breed.parents.map(nm).join(' / '))}${row('You own one', tick(h.breed.owned.length))}${row('Ditto in the Day Care', tick(h.breed.ditto))}</div>`;
    for (const sp of h.special) {
      o += `<div class="card"><h3>Special encounter · ${esc(sp.place)}</h3>`;
      o += row('Chapter', `${esc(sp.chapter)} <span class="dim">(ch ${sp.ch})</span>`);
      o += row('Appears', esc(DexInfo.conditionText(sp)));
      o += row('Chance', sp.chance < 1 ? `${DexInfo.pct(sp.chance)} each time the chapter is built` : 'always, once the conditions are met');
      if (sp.level) o += row('Level', sp.level);
      if (sp.skies || sp.night || sp.day) {
        o += row('Weather there now', esc(DexInfo.wxName(sp.weatherNow)));
        o += row('Next chance', sp.window ? (sp.window.now ? '<span class="ok">right now</span>' : `<b>${DexInfo.clock(sp.window.at)}</b>${sp.window.key ? ` (${esc(DexInfo.wxName(sp.window.key))})` : ''}`) : '<span class="dim">not in the forecast</span>');
      }
      if (sp.needs) o += row(`${esc(sp.needs.replace(/-/g, ' '))}s needed`, `${tick(sp.have >= sp.needN)} ${sp.have}/${sp.needN}`);
      if (sp.missingCaught.length) o += row('Register first', sp.missingCaught.map(nm).join(', '), 'warn');
      if (sp.blockers.some((b) => /already met/.test(b))) o += row('Status', '<span class="dim">already met</span>');
      o += `</div>`;
    }
    if (h.wild.length) {
      o += `<div class="card"><h3>In the wild</h3>`;
      for (const c of h.wild.slice(0, 6)) {
        o += `<div style="margin-top:6px"><b>${esc(c.chapter)}</b> <span class="dim">ch ${c.ch}${c.open ? '' : ' · not unlocked yet'}</span></div>`;
        for (const sp of c.spots.slice(0, 6)) o += row(esc(sp.place), `${DexInfo.pct(sp.pct)}${sp.lv?.[0] ? ` · Lv ${sp.lv[0]}${sp.lv[1] && sp.lv[1] !== sp.lv[0] ? '–' + sp.lv[1] : ''}` : ''}${sp.when ? ` · ${esc(sp.when.join('/'))}` : ''}${sp.on ? '' : ' <span class="dim">(not now)</span>'}`);
      }
      if (h.wild.length > 6) o += `<div class="dim" style="margin-top:6px">…and ${h.wild.length - 6} more chapters</div>`;
      o += `</div>`;
    }
    if (h.evolve) {
      o += `<div class="card"><h3>Evolution</h3>${row('Evolves from', `<span data-act="dexinfo" data-id="${h.evolve.from}" style="cursor:pointer;text-decoration:underline">${nm(h.evolve.from)}</span>`)}${row('How', esc(h.evolve.how))}
        ${row(`Your ${nm(h.evolve.from)}`, h.evolve.pre ? `Lv ${h.evolve.pre.level}` : '<span class="dim">none</span>')}</div>`;
    }
    if (h.legend) {
      o += `<div class="card"><h3>Legendary zone</h3>${row('Zone', esc(h.legend.state === 'done' ? 'caught' : h.legend.state))}${row('When', esc(h.legend.when || '?'))}`;
      for (const l of h.legend.progress?.lines || []) o += row(esc(l.text || ''), `${tick(l.have >= l.need)} ${l.have}/${l.need}`);
      o += `</div>`;
    }
    if (h.roaming) o += `<div class="card"><h3>Roaming</h3><div>It's roaming right now - it can show up on routes.</div></div>`;
    if (h.forms.length) o += `<div class="card"><h3>Forms</h3><div class="grid">${h.forms.map((f) => `<div class="mon ${f.registered ? '' : 'unk'}" data-act="dexinfo" data-id="${f.id}" style="cursor:pointer"><img src="${Engine.sprite(f.id)}">${esc(f.name)}<br>${f.registered ? '<span class="ok">✓</span>' : '<span class="dim">missing</span>'}</div>`).join('')}</div></div>`;
    if (!h.special.length && !h.wild.length && !h.evolve && !h.legend && !h.eggs.length && !h.loot.length && !h.breed) o += `<div class="note">The game data has no wild spot, special encounter, evolution or zone for it - it comes from an event, an item or a trade.</div>`;
    cache = { id, at: Date.now(), html: o };
    return o;
  }
  return { render, clear: () => { cache.at = 0; } };
})();
Views.dexDetail = (id, esc) => DexView.render(+id, esc);

// the job for one Pokémon: the way picked on its page (0 = best)
function addDexJob(id, way = 0) {
  const r = DexInfo.routes(id)[+way || 0] || DexInfo.route(id);
  if (r.kind === 'legend') return Plan.add('legend', { foe: id });
  if (r.kind === 'wild') return Plan.add('wild', { foe: id, ch: r.ch });
  if (r.kind === 'evolve') return Plan.add('level', { uids: [r.uid], target: r.level, forDex: id });
  if (r.kind === 'loot') return Plan.add('loot', { item: r.item, ch: r.ch, place: r.place, foe: id });
  if (r.kind === 'breed') return Plan.add('breed', { foe: id, from: r.parent });
  if (r.kind === 'special') {
    if (r.soul && !Plan.goals.some((x) => !x.done && x.type === 'souls' && x.item === r.soul.item)) Plan.add('souls', { item: r.soul.item, need: r.soul.need, forDex: id });
    return Plan.add('special', { foe: id, ch: r.ch, place: r.place });
  }
  return false;
}

/* ---------------------------------------------------------------------------------------------
 * Sub-tabs (Jimmy 2026-11-23: "I have to scroll so much to get to information or cards").
 * A long tab shows one section at a time, picked from a row of chips under the main tabs.
 * The views stay as they are: their cards are sorted into sections by the card's title (its h3)
 * or by a data-sec="key" on the card. What comes before the first card (notes, mode bars) is
 * always shown. The phone keeps its own pick (prefs.sub is one of the phone's own keys).
 * ------------------------------------------------------------------------------------------- */
const Sub = (() => {
  // [key, label, test on the card title (null = everything not matched: the catch-all section)]
  const SUBS = {
    now: [['main', 'Overview', null], ['care', 'Day Care', /day care/], ['more', 'Pokédex & Team', /^(pokédex|team|trades)$/]],
    act: [['hist', 'History', /^history/], ['goals', 'Goals', null], ['stats', 'Stats', /^(money|pokédex|pokedex|total levels|shinies|lv 100)/], ['log', 'Log', /^log\b/]],
    plan: [['goals', 'Active', null], ['wait', 'Waiting', /^\0$/], ['done', 'Done', /^done\b/], ['did', 'What Mega Did', /^what mega did/]],
    gems: [['focus', 'Focus', /focus pokémon/], ['shop', 'Shop', /gem shop/], ['picks', 'Discord Picks', /discord picks/], ['rank', 'Rank Up', /^(gems|strongest get stronger)$/], ['all', 'Held', null], ['none', 'Not Held', /^\0$/]],
    blocs: [['blocks', 'Pokéblocks', /^pokéblocks/], ['boss', 'Boss', /boss/], ['rev', 'Revealed', /^revealed/], ['rain', 'Rainbow', /rainbow/]],
    engine: [['phone', 'Phone', /phone alerts|kinesis|popups|connection/], ['plan', 'Plan', /leveling chapters|goal chains|when the plan is idle|berries|moves/], ['look', 'Look', /^tabs$|top bar|text size/], ['health', 'Health', null]],
    fights: [['leg', 'Legendaries', null], ['other', 'Trainers & Others', null]],
  };
  const title = (card) => {
    const h = card.querySelector(':scope > h3, :scope > div > h3');
    return (h ? h.textContent : '').replace(/[^\p{L}\p{N}\s&·'-]/gu, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  };
  const has = (tab) => !!SUBS[tab];
  function apply(tab, html, prefs, esc = (s) => String(s), opt = {}) { // opt.pick: show that section only, without the chip row
    const S = SUBS[tab]; if (!S || typeof html !== 'string' || typeof document === 'undefined') return html;
    const t = document.createElement('template'); t.innerHTML = html;
    const lead = [], groups = Object.fromEntries(S.map(([k]) => [k, []]));
    const catchAll = (S.find((x) => !x[2]) || S[0])[0];
    let seenCard = false, cur = null;
    for (const n of [...t.content.childNodes]) {
      const isCard = n.nodeType === 1 && n.classList.contains('card') && n.getAttribute('data-sec') !== 'lead';
      if (n.nodeType === 1 && n.getAttribute('data-sec') === 'lead') { lead.push(n); continue; }
      if (!isCard) { if (!seenCard || !cur) lead.push(n); else groups[cur].push(n); continue; }
      seenCard = true;
      const ds = n.getAttribute('data-sec');
      if (ds && groups[ds]) { cur = ds; groups[ds].push(n); continue; }
      const ti = title(n), hit = S.find(([, , re]) => re && re.test(ti));
      cur = hit ? hit[0] : catchAll; groups[cur].push(n);
    }
    const shown = S.filter(([k]) => groups[k].length);
    if (shown.length < 2 && !opt.pick) return html; // nothing to split
    let pick = opt.pick || prefs?.sub?.[tab];
    if (!groups[pick]?.length) pick = shown[0][0];
    const box = document.createElement('div');
    for (const n of lead) box.appendChild(n);
    const bar = `<div class="chips subtabs" style="position:sticky;top:-12px;z-index:3;background:var(--bg);margin:-4px -2px 8px;padding:6px 2px">${shown.map(([k, l]) => `<button class="chip${k === pick ? ' on' : ''}" data-act="subtab" data-tab="${tab}" data-k="${k}">${esc(l)} <span class="faint" style="font-weight:700">${groups[k].filter((n) => n.nodeType === 1 && n.classList.contains('card')).length}</span></button>`).join('')}</div>`;
    const sec = document.createElement('div');
    for (const n of groups[pick]) sec.appendChild(n);
    return (opt.pick ? '' : bar) + box.innerHTML + sec.innerHTML;
  }
  return { apply, has, SUBS };
})();

/* ---------------------------------------------------------------------------------------------
 * Tasks (2.13, Jimmy 2026-11-23: "simple, straightforward" - the ZGRay helper's layout with Mega's
 * engine under it). Pick a group, pick a task card, set its options, then Start Now (it goes to the
 * top of the queue and the plan runs) or Add to Queue. Every task is one of Mega's goal types; the
 * options are the same ones the Plan tab's old "Add a goal" form had (Views.planAdd).
 * ------------------------------------------------------------------------------------------- */
const Tasks = (() => {
  const CATS = [['adv', 'Adventure'], ['col', 'Collect'], ['evt', 'Events'], ['res', 'Resources']];
  // k = the task, t = the goal type it adds (planAdd's addType), ic = icon, one = only one in the plan at a time
  const LIST = [
    { k: 'region', cat: 'adv', ic: 'book', name: 'Complete the Pokédex', t: 'region', hint: 'Catches everything a region is missing.' },
    { k: 'money', cat: 'adv', ic: 'coin', name: 'Auto money', t: 'money', one: 1, hint: 'Farms the best-paying chapter up to a target.' },
    { k: 'story', cat: 'adv', ic: 'globe', name: 'Advance the story', t: 'story', hint: 'Beats a region\'s chapters and League, for new regions.' },
    { k: 'daily', cat: 'adv', ic: 'clock', name: 'Daily clears', t: 'daily', hint: 'Your dailies and weeklies, all at once.' },
    { k: 'legend', cat: 'col', ic: 'star', name: 'Catch a legendary', t: 'legend', hint: 'Simulates a team and catches it.' },
    { k: 'shiny', cat: 'col', ic: 'shiny', name: 'Shiny hunt', t: 'shiny', hint: 'Breeds or hunts the shiny you pick in the Pokédex.' },
    { k: 'train', cat: 'col', ic: 'team', name: 'Level Pokémon', t: 'train', one: 1, hint: 'Levels your team, then your strongest in the PC.' },
    { k: 'd-xp', cat: 'col', ic: 'trophy', name: 'Battle XP', t: 'discord-xp', hint: 'Discord guide: the Kanto League loop, candy when ready.' },
    { k: 'd-axsiom', cat: 'col', ic: 'shiny', name: 'Axsiom Plan', t: 'discord-axsiom', hint: 'Giant Chasm with Shiny, Capture and Money berries.' },
    { k: 'd-mix', cat: 'col', ic: 'candy', name: 'Money + XP + candies', t: 'discord-mix', hint: 'Discord guide: Giant Chasm.' },
    { k: 'd-candy', cat: 'col', ic: 'candy', name: 'Exp. Candies', t: 'discord-candy', hint: 'Discord guide: Kanto Victory Road.' },
    { k: 'league', cat: 'evt', ic: 'trophy', name: 'Elite League', t: 'league', hint: 'Win a region\'s tiers for Legendary gems.' },
    { k: 'elite', cat: 'evt', ic: 'fight', name: 'Elite legendaries', t: 'elite', hint: 'Elite tiers of a legendary, from Sim.' },
    { k: 'raid', cat: 'evt', ic: 'shiny', name: 'Shiny Raid', t: 'raid', one: 1, hint: 'Every day.' },
    { k: 'candy', cat: 'evt', ic: 'candy', name: 'Candy Factory', t: 'candy', one: 1, hint: 'Every day.' },
    { k: 'tower', cat: 'evt', ic: 'tower', name: 'Battle Tower', t: 'tower', one: 1, hint: 'Every week.' },
    { k: 'bloc', cat: 'evt', ic: 'gift', name: 'Pokéblock Boss', t: 'bloc', one: 1, hint: 'Every day.' },
    { k: 'wboss', cat: 'evt', ic: 'shield', name: 'World Boss', t: 'wboss', one: 1, hint: 'Every edition.' },
    { k: 'under', cat: 'res', ic: 'pick', name: 'Underground', t: 'under', one: 1, hint: 'Runs alongside your other tasks.' },
    { k: 'item', cat: 'res', ic: 'pin', name: 'Find a rare item', t: 'item', hint: 'Hunts an item stop until it drops.' },
  ];
  // Daily clears = these goal types, each added once
  const DAILY = [['raid', 'Shiny Raid every day'], ['candy', 'Candy Factory every day'], ['bloc', 'Pokéblock Boss every day'], ['tower', 'Battle Tower every week'], ['wboss', 'World Boss every edition']];
  const ui = { cat: 'adv', pick: null, daily: Object.fromEntries(DAILY.map(([k]) => [k, true])), msg: '' };
  try { const p = JSON.parse(localStorage.getItem('mega-tasks-ui') || '{}'); if (p.cat) ui.cat = p.cat; if (p.pick) ui.pick = p.pick; if (p.daily) Object.assign(ui.daily, p.daily); } catch (__e) { __h('59-tasks:35', __e); }
  const save = () => { try { localStorage.setItem('mega-tasks-ui', JSON.stringify({ cat: ui.cat, pick: ui.pick, daily: ui.daily })); } catch (__e) { __h('59-tasks:36', __e); } };
  const task = (k) => LIST.find((x) => x.k === k) || null;
  const inPlan = (type) => { try { return Plan.hasType(type); } catch { return false; } };

  // the options under the picked task
  function options(w, planUi, esc) {
    const T = task(ui.pick); if (!T) return `<div class="note dim">Pick a task above to see its options.</div>`;
    let h = `<div class="card taskopts" data-sec="lead"><h3>${esc(T.name)}</h3>`;
    if (T.t === 'daily') {
      h += DAILY.map(([k, l]) => `<label class="chk"><input type="checkbox" data-act="task-daily" data-k="${k}" ${ui.daily[k] ? 'checked' : ''} ${inPlan(k) ? 'disabled' : ''}>${esc(l)}${inPlan(k) ? ' <span class="dim">· already in your queue</span>' : ''}</label>`).join('')
        + `<div class="note dim" style="margin-top:10px">Dailies go ahead of your other tasks when they're due, then hand the screen back.</div></div>`;
      return h;
    }
    if (T.t === 'shiny') return h + `<div class="note dim">Shiny hunts start from a Pokémon's page in the Pokédex: open the one you want and press its shiny hunt button. Mega breeds it when you own a shiny of its family, otherwise it hunts the wild spot where it's most common.</div><button class="btn gold" data-act="tab" data-tab="dex">Open the Pokédex</button></div>`;
    if (T.t === 'elite') return h + `<div class="note dim">Elite legendary tiers are added from Sim: it shows the easiest next tier with your simulated win %.</div><button class="btn gold" data-act="tab" data-tab="legends">Open Sim</button></div>`;
    planUi.addType = T.t;
    return h + Views.planAdd(w, planUi, esc);
  }

  function view(w, planUi, esc) {
    if (!w.ok) return `<div class="note">Waiting for the game engine.</div>`;
    const cards = LIST.filter((x) => x.cat === ui.cat);
    let h = `<div class="lbl" style="margin:2px 0 8px">Choose task</div>
      <div class="tcats">${CATS.map(([k, l]) => `<button class="tcat${ui.cat === k ? ' on' : ''}" data-act="task-cat" data-k="${k}">${esc(l)}</button>`).join('')}</div>
      <div class="tgrid">${cards.map((T) => {
        const busy = T.one && inPlan(T.t);
        return `<button class="tcard${ui.pick === T.k ? ' on' : ''}" data-act="task-pick" data-k="${T.k}" title="${esc(T.hint)}"><i class="ic ic-${T.ic}"></i><span>${esc(T.name)}${busy ? '<small>in your queue</small>' : ''}</span></button>`;
      }).join('')}</div>`;
    h += options(w, planUi, esc);
    if (ui.msg) h += `<div class="note ${ui.warn ? 'warn' : 'ok'}" style="margin-top:8px">${esc(ui.msg)}</div>`;
    return h;
  }
  // the picked task's add button, read from its options (no screen needed, so Kinesis can press it too):
  // the gold one when there are several (an item's best spot), else the first that isn't disabled
  function addBtn(w, planUi, esc) {
    const T = task(ui.pick); if (!T || ['daily', 'shiny', 'elite'].includes(T.t)) return null;
    planUi.addType = T.t;
    let html = ''; try { html = Views.planAdd(w, planUi, esc); } catch { return null; }
    const btns = [...html.matchAll(/<button\b([^>]*\bdata-act="plan-add[^"]*"[^>]*)>/g)].map((m) => {
      const attrs = m[1], ds = {};
      for (const [, k, v] of attrs.matchAll(/\bdata-([\w-]+)="([^"]*)"/g)) ds[k.replace(/-(\w)/g, (x, c) => c.toUpperCase())] = v.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
      return { ds, gold: /class="[^"]*\bgold\b/.test(attrs), off: /\bdisabled\b/.test(attrs.replace(/data-[\w-]+="[^"]*"/g, '')) };
    });
    // the money target: the first choice in its list when you haven't picked one
    if (T.t === 'money' && !planUi.addMoney) { const m = html.match(/data-act="add-money">\s*<option value="(\d+)"/); if (m) planUi.addMoney = +m[1]; }
    return btns.find((b) => b.gold && !b.off) || btns.find((b) => !b.off) || null;
  }
  function canGo(w, planUi, esc) {
    const T = task(ui.pick); if (!T) return false;
    if (T.t === 'daily') return DAILY.some(([k]) => ui.daily[k] && !inPlan(k));
    return !!addBtn(w, planUi, esc);
  }
  // add the task; now = put what was added at the top and run the plan. fire(dataset) presses the add button.
  // why Start Now / Add to Queue can't add anything right now (2.15.15: the buttons stay pressable and say so)
  function whyNot(w, planUi, esc) {
    const T = task(ui.pick); if (!T) return 'Pick a task first: choose a category, then tap one of the tasks above.';
    if (!w.ok) return 'The game isn\'t ready yet - try again in a moment.';
    if (T.t === 'daily') return DAILY.some(([k]) => ui.daily[k]) ? 'All the dailies you ticked are already in your queue.' : 'Tick at least one daily above first.';
    if (['shiny', 'elite'].includes(T.t)) return `${T.name}: use the buttons in its options above.`;
    return `${T.name}: it's already in your queue, or pick its options above first.`;
  }
  function go(w, planUi, esc, now, fire) {
    const T = task(ui.pick);
    if (!canGo(w, planUi, esc)) { ui.msg = whyNot(w, planUi, esc); ui.warn = 1; setTimeout(() => { ui.msg = ''; ui.warn = 0; }, 15000); return; }
    ui.warn = 0;
    const before = new Set(Plan.goals.map((g) => g.id));
    if (T.t === 'daily') { for (const [k] of DAILY) if (ui.daily[k] && !inPlan(k)) Plan.add(k, {}); }
    else { const b = addBtn(w, planUi, esc); if (!b) return; fire(b.ds); }
    const added = Plan.goals.filter((g) => !before.has(g.id));
    if (!added.length) { ui.msg = 'Nothing new was added (it may already be in your queue).'; return; }
    if (now) {
      for (const g of added.slice().reverse()) Plan.toTop(g.id);
      if (!Plan.running) Plan.setRunning(true);
      const a = Engine.get('Game.S')?.adv;
      ui.msg = `${T.name}: started${a?.league || a?.zone ? ' - after the current run ends (Mega never switches mid-run)' : ''}.`;
    } else ui.msg = `${T.name}: added to your queue (${added.length === 1 ? 'position ' + (Plan.goals.filter((g) => !g.done).indexOf(added[0]) + 1) : added.length + ' tasks'}).`;
    Log.add(`task ${now ? 'started' : 'queued'}: ${added.map((g) => Plan.label(g)).join(', ')}`);
    setTimeout(() => { ui.msg = ''; }, 15000);
  }
  return { ui, view, canGo, go, save, CATS, LIST, task };
})();
Views.tasks = (w, planUi, esc) => Tasks.view(w, planUi, esc);

/* ---------------------------------------------------------------------------------------------
 * UI: the Mega Alakazam panel. Lives in a shadow root so neither the game's styles nor Alakazam
 * 4.x's can leak in or out. Docked as a full-height column on the left; the game is moved right by
 * the same width (and back when folded), so nothing of the game is covered.
 * ------------------------------------------------------------------------------------------- */
const UI = (() => {
  const PREFS_KEY = 'mega-alakazam-ui';
  const prefs = (() => { try { return { tab: 'tasks', open: true, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') }; } catch { return { tab: 'tasks', open: true }; } })();
  // 2.13: seven tabs; some hold several of Mega's screens, switched by a row under the status card
  const GROUPS = { home: [['now', 'Now'], ['tasks', 'Tasks'], ['fights', 'Fights']], dexg: [['dex', 'Pokédex'], ['box', 'PC'], ['trades', 'Trades']], rank: [['gems', 'Gems'], ['blocs', 'Pokéblocks']] };
  const groupOf = (k) => Object.keys(GROUPS).find((g) => GROUPS[g].some(([x]) => x === k)) || null;
  function goTab(k) { // any screen key (old or new) -> the tab that shows it
    const g = groupOf(k);
    if (g) { prefs.tab = g; prefs.grp = { ...(prefs.grp || {}), [g]: k }; } else prefs.tab = k;
  }
  const view = () => (GROUPS[prefs.tab] ? (prefs.grp?.[prefs.tab] && GROUPS[prefs.tab].some(([x]) => x === prefs.grp[prefs.tab]) ? prefs.grp[prefs.tab] : GROUPS[prefs.tab][0][0]) : prefs.tab);
  if (!prefs.v213) { goTab(prefs.tab || 'tasks'); delete prefs.tabOrder; prefs.v213 = 1; }
  // 2.13.6: Tasks and Live are one tab (Tasks · Now · Activity · Fights)
  if (prefs.grp?.home === 'act') prefs.grp.home = 'now';
  if (prefs.grp?.home === 'care') { prefs.grp.home = 'now'; if (prefs.tab === 'home') prefs.tab = 'care'; delete prefs.tabOrder; }
  if (!prefs.v2136) { if (prefs.tab === 'live') goTab(prefs.grp?.live || 'now'); else if (prefs.tab === 'tasks') goTab('tasks'); delete prefs.tabOrder; prefs.v2136 = 1; }
  const savePrefs = () => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (__e) { __h('60-ui:22', __e); } };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtIn = (t) => {
    if (!t) return '';
    const s = Math.max(0, Math.round((t - Date.now()) / 1000));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    if (h >= 48) return `${Math.floor(h / 24)} days ${h % 24}h`;
    return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
  };
  // Mega's panel: its own frame (rail, header, tabs, scroll area) + the shared design system
  // (design/field.css, put in by the build with SCOPE = .wrap). Theme: .th-night / .th-day on .wrap.
  const CSS = `
    :host{all:initial}
    /* =============================================================================================
 * Field Device — the one design system for Mega (PC panel) and Kinesis (phone).
 * Colours: Alakazam 4.x's (Jimmy 2026-11-23: "go back to what the old helper had") - a dark purple-navy
 * shell (header, tabs) around a dark slate screen, violet accent, gold for the one main action.
 * Night (the default, "Classic") = Alakazam 4.x's slate, Day = paper screen. The shell colour is for chrome only;
 * content uses the screen's own colours, with gold for the one main action on a card.
 *
 * Written once here. The build swaps .wrap for the root: .wrap in Mega's panel, html in Kinesis.
 * ============================================================================================= */

/* ---- tokens ---- */
.wrap {
  --shell-hi:#2a2350; --shell:#1f1b38; --shell-lo:#161a28; --seam:#282d3d; --on-shell:#e8eaf2; --on-shell-dim:#a08cff;
  --gold:#f6c744; --gold-lo:#e2a92b; --on-gold:#16131f;
  --r-s:8px; --r-m:10px; --r-l:14px;
  --s1:4px; --s2:8px; --s3:12px; --s4:16px;
  --t-xs:12px; --t-s:13px; --t-m:15px; --t-l:17px; --t-xl:22px;
  --font:Inter,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
}
.wrap.th-night {
  --bg:#10121a; --card:#171a25; --well:#1e2231; --line:#282d3d; --line-2:#343a4f;
  --ink:#e8eaf2; --mute:#8b91a7; --faint:#5e6478; --acc:#a08cff; --acc-ink:#16131f;
  --ok:#5ad68a; --warn:#ffb547; --bad:#ff6b6b; --shiny:#ffd45e; --focus:#a08cff55;
  color-scheme:dark;
}
.wrap.th-day {
  --bg:#f2ecdb; --card:#fffbf2; --well:#ece3cb; --line:#e0d3b0; --line-2:#cbb98c;
  --ink:#2a231e; --mute:#6b6052; --faint:#998c78; --acc:#0f7a68; --acc-ink:#fff;
  --ok:#147a40; --warn:#9a5c06; --bad:#b4232c; --shiny:#b07d00; --focus:#0f7a6855;
  color-scheme:light;
}

/* 2.13 night for Mega's panel (Jimmy 2026-11-23: the ZGRay helper's look) - navy screen, mint accent.
   Kinesis keeps th-night until it gets the same layout. */
.wrap.th-zg {
  --shell-hi:#21364a; --shell:#1d2c41; --shell-lo:#1b263d; --seam:#2c3b50; --on-shell:#e6edf8; --on-shell-dim:#93a8c2;
  --gold:#79dcba; --gold-lo:#5fc9a4; --on-gold:#102d29;
  --t-xs:12px; --t-s:12px; --t-m:14px; --t-l:14px; --t-xl:20px; /* two text sizes: regular and small */
  --bg:#111a29; --card:#162233; --well:#0b1423; --line:#2b3b50; --line-2:#3b4e63;
  --ink:#e6edf8; --mute:#93a8c2; --faint:#62758c; --acc:#79dcba; --acc-ink:#102d29; --focus:#79dcba55;
  --ok:#79dcba; --warn:#e6be7a; --bad:#ff8a8a; --shiny:#ffd45e;
}

/* ---- text ---- */
.dim{color:var(--mute)} .faint{color:var(--faint)} .ok{color:var(--ok)} .warn{color:var(--warn)} .bad{color:var(--bad)}
.lbl{font-size:var(--t-xs);font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--mute)}
.big{font-size:var(--t-xl);font-weight:800;letter-spacing:-.01em}
.num,.row .v{font-variant-numeric:tabular-nums}
code{font:var(--t-s)/1.4 ui-monospace,Menlo,Consolas,monospace;color:var(--acc)}
a{color:var(--acc)}

/* ---- cards ---- */
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--r-l);padding:var(--s3) var(--s4);margin:0 0 var(--s3);box-shadow:0 1px 0 #0000000f}
.card h3,h3.card-title{all:unset;display:flex;align-items:center;gap:var(--s2);font-size:var(--t-xs);font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--mute);margin:0 0 var(--s2);padding:0 0 var(--s2);border-bottom:1px solid var(--line)}
.card h3 .ic{font-size:14px}
.card.folded h3{border-bottom:0;padding-bottom:0;margin-bottom:0}
.card.folded > :not(h3){display:none !important}
.card h3.foldh,.mv .card > h3{cursor:pointer;user-select:none}
.card h3.foldh::after,.mv .card > h3::after{content:'';margin-left:auto;width:8px;height:8px;border-right:2px solid var(--faint);border-bottom:2px solid var(--faint);transform:rotate(45deg) translate(-2px,-2px);transition:transform .15s}
.card.folded h3.foldh::after,.mv .card.folded > h3::after{transform:rotate(-45deg)}
.note{font-size:var(--t-s);color:var(--ink);background:var(--well);border:1px solid var(--line);border-radius:var(--r-m);padding:var(--s2) var(--s3);margin:0 0 var(--s3)}
.note.warn,.card.warn{border-color:color-mix(in srgb,var(--warn) 55%,var(--line))}
.card.ok{border-color:color-mix(in srgb,var(--ok) 55%,var(--line))}

/* ---- rows: label on the left, value on the right; a long value drops below, full width ---- */
.row{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;column-gap:var(--s3);row-gap:2px;padding:7px 0;border-top:1px solid var(--line)}
.row:first-of-type,h3 + .row{border-top:0}
.row .k{flex:0 1 auto;color:var(--mute);white-space:nowrap}
.row .v{flex:1 1 150px;text-align:right;min-width:0;overflow-wrap:anywhere}

/* ---- buttons: gold = the main action, plain = secondary (screen-coloured), danger = can't be undone ---- */
.btn{all:unset;box-sizing:border-box;display:block;width:100%;text-align:center;cursor:pointer;user-select:none;
  font:700 var(--t-m)/20px var(--font);padding:9px var(--s3);min-height:40px;margin:var(--s2) 0 0;border-radius:var(--r-m);
  color:var(--ink);background:var(--well);border:1px solid var(--line-2);box-shadow:0 1px 0 #0000001a;transition:background .12s,border-color .12s}
.btn:hover{border-color:var(--acc)} .btn:active{transform:translateY(1px)}
.btn:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
.btn[disabled],.btn:disabled{opacity:.45;cursor:default;transform:none}
.btn.gold{color:var(--on-gold);background:linear-gradient(180deg,var(--gold),var(--gold-lo));border-color:var(--gold-lo)}
.btn.gold:hover{filter:brightness(1.06)}
.btn.danger{color:var(--bad);background:transparent;border-color:color-mix(in srgb,var(--bad) 55%,transparent)}
.btn.danger:hover{background:color-mix(in srgb,var(--bad) 12%,transparent)}
.btn.sm{min-height:34px;padding:6px var(--s2);font-size:var(--t-s);margin:0}
.btns,.tools{display:flex;flex-wrap:wrap;gap:var(--s2);margin-top:var(--s2)} .btns .btn,.tools .btn{flex:1 1 0;width:auto;margin:0}
.goal .tools{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:4px} .goal .tools .btn{min-height:32px;padding:5px 2px;font-size:var(--t-xs);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

/* ---- inputs ---- */
input.q,select.sel,.field{all:unset;box-sizing:border-box;display:block;width:100%;font:var(--t-m)/20px var(--font);color:var(--ink);background:var(--well);border:1px solid var(--line-2);border-radius:var(--r-m);padding:9px var(--s3);margin:0 0 var(--s3)}
input.q:focus,select.sel:focus,.field:focus{border-color:var(--acc);box-shadow:0 0 0 3px var(--focus)}
input.q::placeholder{color:var(--faint)}
select.sel{appearance:auto;-webkit-appearance:menulist}
label.chk{display:flex;gap:var(--s2);align-items:flex-start;margin:var(--s2) 0 0;color:var(--ink);cursor:pointer;line-height:1.4}
label.chk input{flex:none;margin:2px 0 0;width:17px;height:17px;accent-color:var(--acc)}

/* ---- chips (filters) ---- */
.chips{display:flex;flex-wrap:wrap;gap:6px;margin:var(--s2) 0}
/* rank badge, as the game draws it: Roman numeral, pixel font, gold with a 1px dark outline */
.rkn{font-family:'Jersey 15',system-ui,sans-serif;font-weight:500;font-size:1.12em;line-height:1;letter-spacing:.04em;margin-left:4px;color:#ffe066;
  text-shadow:1px 0 #5a3a06,-1px 0 #5a3a06,0 1px #5a3a06,0 -1px #5a3a06,1px 1px #5a3a06}
.chip{all:unset;cursor:pointer;padding:5px 11px;border-radius:999px;font-size:var(--t-s);font-weight:600;color:var(--ink);background:var(--well);border:1px solid var(--line)}
.chip.on{color:var(--acc-ink);background:var(--acc);border-color:var(--acc)}
.pill{display:inline-block;padding:1px 8px;border-radius:999px;font-size:var(--t-xs);font-weight:800;color:var(--on-shell);background:var(--shell)}

/* ---- Pokémon tiles ---- */
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(80px,1fr));gap:var(--s2)}
.mon{background:var(--well);border:1px solid var(--line);border-radius:var(--r-m);padding:6px 4px;text-align:center;font-size:var(--t-s);line-height:1.3;color:var(--ink)}
.mon img{width:56px;height:56px;image-rendering:pixelated;display:block;margin:0 auto}
.mon.leg{border-color:var(--line-2)} .mon.now{border:2px solid var(--ok)} .mon.unk img{filter:brightness(0) opacity(.35)} .mon.unk{color:var(--faint)}
img.sp{image-rendering:pixelated;background:var(--well);border-radius:var(--r-m);flex:none}
.tmwrap{container-type:inline-size} .tmgrid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:var(--s2) 6px;text-align:center}
@container (min-width:380px){.tmgrid{grid-template-columns:repeat(6,minmax(0,1fr))}}
.tmname{font-size:var(--t-xs);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

/* ---- progress ---- */
.bar{height:6px;border-radius:3px;background:var(--line);overflow:hidden;margin-top:6px}
.bar i{display:block;height:100%;border-radius:3px;background:var(--acc)}
.pips span{display:inline-block;width:18px;height:6px;border-radius:3px;margin-right:3px;background:var(--line)} .pips .w{background:var(--ok)} .pips .n{background:var(--gold)}

/* ---- tables ---- */
table{width:100%;border-collapse:collapse;font-size:var(--t-s)} td,th{padding:4px 6px;border-bottom:1px solid var(--line);text-align:left} th{color:var(--mute);font-weight:700}

/* ---- layout helpers ---- */
.flex{display:flex;gap:var(--s3);align-items:center} .grow{flex:1;min-width:0}

/* ---- icons: drawn, one colour, sized to the text (Icons.swap turns the old emoji into these) ---- */
.ic{display:inline-block;width:1em;height:1em;vertical-align:-.14em;background:currentColor;-webkit-mask:var(--m) center/contain no-repeat;mask:var(--m) center/contain no-repeat;flex:none}
.ic-shiny{color:var(--shiny)}
.ic-shiny{--m:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M12 1.5l2.6 7.1 7.4 2.9-7.4 2.9L12 21.5l-2.6-7.1L2 11.5l7.4-2.9z'/%3E%3C/svg%3E")}
.ic-star{--m:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M12 2l3 6.6 7.2.8-5.4 4.9 1.5 7.1L12 17.8 5.7 21.4l1.5-7.1L1.8 9.4 9 8.6z'/%3E%3C/svg%3E")}
.ic-pin{--m:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M12 1.5a7.5 7.5 0 0 0-7.5 7.5c0 5.4 7.5 13.5 7.5 13.5s7.5-8.1 7.5-13.5A7.5 7.5 0 0 0 12 1.5zm0 10.2a2.7 2.7 0 1 1 0-5.4 2.7 2.7 0 0 1 0 5.4z'/%3E%3C/svg%3E")}
.ic-clock{--m:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 2.2a7.8 7.8 0 1 1 0 15.6 7.8 7.8 0 0 1 0-15.6zM11 6v6.6l4.6 2.8 1-1.7-3.4-2V6z'/%3E%3C/svg%3E")}
.ic-egg{--m:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M12 1.5c-4 0-7.5 7.3-7.5 12.5a7.5 7.5 0 0 0 15 0C19.5 8.8 16 1.5 12 1.5z'/%3E%3C/svg%3E")}
.ic-bell{--m:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M12 22.5a2.6 2.6 0 0 0 2.6-2.5H9.4a2.6 2.6 0 0 0 2.6 2.5zM19 16v-5a7 7 0 0 0-5.3-6.8V3.3a1.7 1.7 0 0 0-3.4 0v.9A7 7 0 0 0 5 11v5l-2 2v1h18v-1z'/%3E%3C/svg%3E")}
.ic-coin{--m:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 3a7 7 0 1 1 0 14 7 7 0 0 1 0-14zm0 2.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9z'/%3E%3C/svg%3E")}
.ic-trophy{--m:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M6 2h12v2h4v3a5 5 0 0 1-4.7 5 6 6 0 0 1-4.3 3.9V19h4v3H7v-3h4v-3.1A6 6 0 0 1 6.7 12 5 5 0 0 1 2 7V4h4zm-2 4v1a3 3 0 0 0 2 2.8V6zm16 0h-2v3.8A3 3 0 0 0 20 7z'/%3E%3C/svg%3E")}
.ic-fight{--m:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M2 2h5l8.3 8.3-2.4 2.4L4.6 4.4V2.1zm20 0v5l-6.1 6.1 2.6 2.6 1.6-1.6 1.4 1.4-2.3 2.3 2.8 2.8-2.1 2.1-2.8-2.8-2.3 2.3-1.4-1.4 1.6-1.6-2.6-2.6L9.7 19.3 8.3 18l2.6-2.6-2.6-2.6L6.7 14.4 5.3 13l2.3-2.3L17 2z'/%3E%3C/svg%3E")}
.ic-shield{--m:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M12 1.5l8.5 3.2v6.1c0 5.7-3.6 10.1-8.5 11.7-4.9-1.6-8.5-6-8.5-11.7V4.7z'/%3E%3C/svg%3E")}
.ic-warn{--m:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M12 2L1 21.5h22zm-1.1 7h2.2v6.2h-2.2zm0 7.8h2.2V19h-2.2z'/%3E%3C/svg%3E")}
.ic-pause{--m:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M6 4h4.5v16H6zm7.5 0H18v16h-4.5z'/%3E%3C/svg%3E")}
.ic-team{--m:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M8.5 11a3.8 3.8 0 1 0 0-7.6 3.8 3.8 0 0 0 0 7.6zm8 0a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4zM1 20c0-3.6 3.4-6.5 7.5-6.5S16 16.4 16 20v1H1zm16.5 1v-1c0-2-.7-3.8-2-5.2 3.9-.4 7.5 1.8 7.5 5.2v1z'/%3E%3C/svg%3E")}
.ic-pick{--m:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M14.8 3.2C10.6 1.6 6 2.3 2.5 5c4-.9 8-.3 11.4 1.6L3 17.5 6.5 21 17.4 10.1c1.9 3.4 2.5 7.4 1.6 11.4 2.7-3.5 3.4-8.1 1.8-12.3l1.2-1.2-6-6z'/%3E%3C/svg%3E")}
.ic-tower{--m:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M8 2h2v2h1V2h2v2h1V2h2v4l-1 2v12h2v2H7v-2h2V8L8 6zm3 9v4h2v-4z'/%3E%3C/svg%3E")}
.ic-candy{--m:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M12 6.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11zM6.3 8.6 1.5 6.5 3 12l-1.5 5.5 4.8-2.1a7.4 7.4 0 0 1 0-6.8zm11.4 0 4.8-2.1L21 12l1.5 5.5-4.8-2.1a7.4 7.4 0 0 0 0-6.8z'/%3E%3C/svg%3E")}
.ic-globe{--m:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm6.9 9h-3a15 15 0 0 0-1.4-6.3A8 8 0 0 1 18.9 11zM12 4.1c.9 1.3 1.8 3.7 1.9 6.9h-3.8c.1-3.2 1-5.6 1.9-6.9zM9.5 4.7A15 15 0 0 0 8.1 11h-3a8 8 0 0 1 4.4-6.3zM5.1 13h3a15 15 0 0 0 1.4 6.3A8 8 0 0 1 5.1 13zm6.9 6.9c-.9-1.3-1.8-3.7-1.9-6.9h3.8c-.1 3.2-1 5.6-1.9 6.9zm2.5-.6a15 15 0 0 0 1.4-6.3h3a8 8 0 0 1-4.4 6.3z'/%3E%3C/svg%3E")}
.ic-book{--m:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M5 2h13a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm2 4v2h9V6zm0 4v2h7v-2z'/%3E%3C/svg%3E")}
.ic-gift{--m:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M3 8h18v4H3zm1 5h7v9H4zm9 0h7v9h-7zM11 8h2v14h-2zm-4.5-6C8.6 2 10.8 4.6 12 7c1.2-2.4 3.4-5 5.5-5A2.5 2.5 0 0 1 20 4.5C20 6.4 17 7 12 7 7 7 4 6.4 4 4.5A2.5 2.5 0 0 1 6.5 2z'/%3E%3C/svg%3E")}
.ic-ghost{--m:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M12 2a8 8 0 0 0-8 8v12l2.7-2 2.6 2 2.7-2 2.7 2 2.6-2L20 22V10a8 8 0 0 0-8-8zM9 8.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm6 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z'/%3E%3C/svg%3E")}

/* ---- 2.13.14: Mega's panel in the ZGRay style - one look for every tab (Jimmy 2026-11-23: "format, font size,
   all flow the same and feel the same"). Boxes: 1px border, 12px corners, bold title in the regular size;
   buttons: compact, mint for the main one; section switches: underlined text, like the Tasks row. ---- */
.wrap.th-zg .card{border-color:var(--line-2);border-radius:12px;padding:11px 12px;margin:0 0 10px;box-shadow:none}
.wrap.th-zg .card h3,.wrap.th-zg h3.card-title{font-size:var(--t-m);font-weight:800;letter-spacing:0;text-transform:none;color:var(--ink);border-bottom:0;padding:0;margin:0 0 6px}
.wrap.th-zg .card h3 .dim,.wrap.th-zg .card h3 span{font-size:var(--t-s);font-weight:600}
.wrap.th-zg .lbl{font-size:var(--t-s);letter-spacing:.06em}
.wrap.th-zg .note{border-color:var(--line-2);border-radius:8px;color:var(--mute);background:var(--card)}
.wrap.th-zg .btn{min-height:34px;padding:7px 12px;font:600 var(--t-s)/18px var(--font);border-radius:9px;box-shadow:none;background:var(--well)}
.wrap.th-zg .btn.gold{background:var(--acc);border-color:var(--acc);color:var(--acc-ink);font-weight:800}
.wrap.th-zg .btn.sm{min-height:30px;padding:5px 9px;font-size:var(--t-s)}
.wrap.th-zg .btn.danger{color:#f1b3bc}
.wrap.th-zg input.q,.wrap.th-zg select.sel{font-size:var(--t-m);border-radius:9px;padding:7px 10px}
.wrap.th-zg .row{padding:6px 0}
.wrap.th-zg .chip{font-size:var(--t-s);padding:4px 10px}
.wrap.th-zg .chips.subtabs{display:flex;flex-wrap:wrap;gap:4px 16px;border-bottom:1px solid var(--line);padding:0 2px !important;margin:0 0 10px !important;background:var(--bg)}
.wrap.th-zg .chips.subtabs .chip{all:unset;cursor:pointer;padding:5px 1px 7px;font-size:var(--t-s);font-weight:600;color:var(--mute);border-bottom:2px solid transparent;margin-bottom:-1px}
.wrap.th-zg .chips.subtabs .chip:hover{color:var(--ink)}
.wrap.th-zg .chips.subtabs .chip.on{color:var(--ink);border-bottom-color:var(--acc);background:transparent}
.wrap.th-zg table{font-size:var(--t-s)}
/* section switches (Tasks row, Sim modes): underlined text - shared so Kinesis gets it too */
.snav{display:flex;flex-wrap:wrap;gap:4px 16px;margin:0 2px 10px;border-bottom:1px solid var(--line)} .snav button{all:unset;cursor:pointer;padding:5px 1px 7px;font-size:var(--t-s);font-weight:600;color:var(--mute);border-bottom:2px solid transparent;margin-bottom:-1px} .snav button:hover{color:var(--ink)} .snav button.on{color:var(--ink);border-bottom-color:var(--acc)}
.wrap.th-zg .chip.on{color:var(--ink);background:color-mix(in srgb,var(--acc) 22%,transparent);border-color:color-mix(in srgb,var(--acc) 55%,transparent)}

/* ---- 2.14: the ZGRay-style blocks (status card, task cards, queue, Day Care) - shared so Kinesis draws Mega's screens the same ---- */
.stat{padding:9px 11px;border:1px solid var(--line-2);background:var(--well);border-radius:12px;margin:0 0 8px;overflow-wrap:anywhere}
.stat .live{display:flex;align-items:center;gap:6px;color:var(--mute);font-size:var(--t-s);letter-spacing:.06em;text-transform:uppercase;margin-bottom:3px}
.stat b{display:block;font-size:var(--t-m)} .stat .dim{font-size:var(--t-s);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.sdot{width:7px;height:7px;border-radius:50%;background:var(--acc);box-shadow:0 0 7px var(--acc)} .sdot.off{background:var(--faint);box-shadow:none} .sdot.err{background:var(--bad)}
.mets{display:grid;grid-template-columns:repeat(3,1fr);border:1px solid var(--line);border-radius:12px;background:var(--card);margin:0 0 12px}
.mets div{padding:7px 6px;text-align:center;border-left:1px solid var(--line)} .mets div:first-child{border-left:0}
.mets b{display:block;font-size:var(--t-m);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums} .mets span{display:block;font-size:var(--t-s);line-height:1.25;color:var(--mute);white-space:nowrap}
.tcats{display:flex;flex-wrap:wrap;gap:4px;padding:4px;margin:0 0 10px;background:var(--well);border:1px solid var(--line);border-radius:12px}
.tcat{all:unset;cursor:pointer;flex:1 1 auto;text-align:center;padding:6px 4px;border-radius:9px;font-size:var(--t-s);color:var(--mute);white-space:nowrap}
.tcat:hover{color:var(--ink)} .tcat.on{background:color-mix(in srgb,var(--acc) 22%,transparent);color:var(--ink);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--acc) 45%,transparent)}
.tgrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;margin:0 0 12px}
.tcard{all:unset;cursor:pointer;display:flex;align-items:center;gap:10px;padding:9px 10px;border:1px solid var(--line-2);border-radius:10px;background:var(--card);color:var(--ink);font-size:var(--t-m);font-weight:600;min-height:22px}
.tcard:hover{border-color:var(--acc)} .tcard .ic{color:var(--acc);font-size:var(--t-m)} .tcard small{display:block;font-size:var(--t-s);color:var(--mute)}
.tcard.on{background:color-mix(in srgb,var(--acc) 18%,var(--card));border-color:var(--acc)}
.taskopts .btn[data-act^="plan-add"]:not([data-act="plan-add-item"]){display:none}
.dcbox{border:1px solid var(--line-2);border-radius:14px;padding:12px;background:var(--card)}
.dch{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap} .dch h2,.dch h3{all:unset;font-weight:800;font-size:var(--t-m)}
.dcok{font-size:var(--t-s);color:var(--acc);background:color-mix(in srgb,var(--acc) 14%,transparent);padding:1px 7px;border-radius:6px}
.dcs{margin:6px 0;font-size:var(--t-s)} .dcm{margin:8px 0}
.dcegg{display:flex;gap:10px;align-items:center;padding:8px 0;border-top:1px solid var(--line)} .dcegg img{image-rendering:pixelated;flex:none;background:var(--well);border-radius:10px}
.dcsh{color:var(--shiny);font-weight:700} .dcauto{margin-top:10px;padding-top:8px;border-top:1px solid var(--line)}
.dcpar{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;margin-top:8px}
.dcp{display:flex;gap:8px;align-items:flex-start;border:1px solid var(--line-2);border-radius:10px;padding:8px;background:var(--well)} .dcp .dim{font-size:var(--t-s)}
.dcnext{margin-top:8px;padding:10px;border-left:3px solid var(--acc);border-radius:8px;background:var(--well)} .dcnext .dim{font-size:var(--t-s);margin-top:4px}
.dcpair{display:grid;gap:6px;margin-top:8px;padding:10px;border-left:3px solid var(--acc);border-radius:8px;background:color-mix(in srgb,var(--acc) 8%,var(--well))}
.dcpair div{display:grid;grid-template-columns:minmax(0,1fr) auto;column-gap:8px} .dcpair .dim{font-size:var(--t-s)} .dcpair div > .dim:last-child{grid-column:2;text-align:right}
.dclist{margin-top:12px;border:1px solid var(--line-2);border-radius:10px;padding:8px 10px} .dclist summary{cursor:pointer;font-weight:700}
.dcg{margin-top:8px;border:1px solid var(--line);border-radius:8px;padding:8px;background:var(--well)} .dcgh{display:flex;gap:8px;align-items:baseline;margin-bottom:4px}
.dcr{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:8px;align-items:baseline;padding:4px 0;border-top:1px solid var(--line);font-size:var(--t-s)}
.qhead{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:0 0 10px} .qhead h2{all:unset;display:block;font-size:var(--t-m);font-weight:800} .qhead p{margin:2px 0 0;color:var(--mute);font-size:var(--t-s)}
.qbtn{all:unset;cursor:pointer;flex:none;padding:7px 12px;border-radius:9px;border:1px solid var(--line-2);background:var(--well);color:var(--ink);font-size:var(--t-s);font-weight:600} .qbtn:hover{border-color:var(--acc)}
.qnote{margin:0 0 9px;padding:8px 10px;border:1px solid var(--line-2);border-radius:8px;background:var(--card);color:var(--mute);font-size:var(--t-s)}
.qlist{display:grid;gap:7px;list-style:none;margin:0;padding:0}
.qjob,.qempty{border:1px solid var(--line-2);border-radius:10px;padding:9px;background:var(--card)} .qempty{border-style:dashed;color:var(--mute);font-size:var(--t-s);padding:16px 12px}
.qjob.on{border-color:color-mix(in srgb,var(--acc) 70%,var(--line));background:color-mix(in srgb,var(--acc) 9%,var(--card))}
.qjh{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:start;gap:7px} .qjh strong{font-size:var(--t-m);line-height:1.35;overflow-wrap:anywhere}
.qpos,.qst{padding:2px 6px;border-radius:5px;background:var(--line);font-size:var(--t-s);white-space:nowrap;font-variant-numeric:tabular-nums}
.qst.run{color:var(--acc);background:color-mix(in srgb,var(--acc) 18%,transparent)} .qst.wait{color:var(--warn);background:color-mix(in srgb,var(--warn) 16%,transparent)}
.qd{margin:6px 0 0;color:var(--mute);font-size:var(--t-s);overflow-wrap:anywhere} .qx{margin-top:6px;display:flex;gap:6px;flex-wrap:wrap}
.qact{display:flex;flex-wrap:wrap;gap:4px;margin-top:7px} .qact button{all:unset;cursor:pointer;padding:5px 9px;border-radius:8px;border:1px solid var(--line-2);background:var(--well);color:var(--ink);font-size:var(--t-s)}
.qact button:hover:enabled{border-color:var(--acc)} .qact button:disabled{opacity:.4;cursor:default} .qact .rm{color:#f1b3bc}
.wrap .btn.dimb{opacity:.55}
.wrap .csec{border-top:1px solid var(--line);margin-top:12px;padding-top:12px} .wrap .csec:first-child{border-top:0;margin-top:0;padding-top:0} .wrap .csec h3{font-size:var(--t-m);margin-bottom:4px}
.wrap .dready{margin-top:6px;padding:6px 10px;border-radius:10px;background:color-mix(in srgb,var(--gold) 18%,transparent);border:1px solid color-mix(in srgb,var(--gold) 55%,transparent);font-size:var(--t-s);cursor:pointer} .wrap .dcard.hot{border-color:color-mix(in srgb,var(--gold) 60%,transparent)}

    .wrap{position:fixed;left:0;top:0;bottom:0;z-index:99998;font:var(--t-m)/1.5 var(--font);color:var(--ink);display:flex}
    .rail{width:64px;height:100%;display:flex;flex-direction:column;align-items:center;gap:14px;padding-top:14px;box-sizing:border-box;cursor:pointer;
      background:linear-gradient(180deg,var(--shell),var(--shell-lo));border-right:3px solid var(--seam)}
    .rail img,.hd img{image-rendering:pixelated;filter:drop-shadow(0 1px 0 #0006)}
    .rail .open{color:var(--on-shell);font-size:22px;font-weight:800}
    .panel{height:100%;display:flex;flex-direction:column;background:var(--bg);border-right:3px solid var(--seam);box-shadow:8px 0 30px #0006;position:relative;box-sizing:border-box}
    .grip{position:absolute;top:0;right:-5px;width:8px;height:100%;cursor:ew-resize;z-index:2}
    .grip:hover{background:linear-gradient(90deg,transparent,var(--focus),transparent)}
    .hd{position:relative;display:flex;align-items:center;gap:6px;padding:8px 10px;color:var(--on-shell);user-select:none;
      background:radial-gradient(120% 140% at 0% 0%,var(--shell-hi) 0%,var(--shell-lo) 55%);border-bottom:1px solid var(--seam)}
    .hd .t{font-weight:800;font-size:var(--t-m);letter-spacing:.14em;text-transform:uppercase;white-space:nowrap;background:linear-gradient(90deg,var(--gold),#ffe08a);-webkit-background-clip:text;background-clip:text;color:transparent}
    .hd .v{color:var(--on-shell-dim);font-size:var(--t-s);margin-left:auto;margin-right:2px}
    .hd .fold{all:unset;cursor:pointer;color:var(--on-shell);font-size:var(--t-m);font-weight:800;padding:3px 8px;border-radius:8px} .hd .fold:hover{background:#ffffff24} .hd .fold[disabled]{opacity:.35;cursor:default}
    .hd .fold.upd{background:linear-gradient(180deg,var(--gold),var(--gold-lo));color:var(--on-gold);font-size:var(--t-s);padding:4px 9px}
    .hd .vtip{position:absolute;left:8px;top:100%;margin-top:2px;padding:3px 8px;border-radius:8px;background:#1d0a0e;color:#fff;font-size:var(--t-s);font-weight:700;white-space:nowrap;opacity:0;pointer-events:none;transition:opacity .12s;z-index:5;box-shadow:0 2px 10px #0008}
    .hd img.ver:hover + .vtip{opacity:1}
    .dot{width:12px;height:12px;border-radius:50%;flex:none;box-sizing:border-box;border:2px solid #ffffffb0;background:#5ad68a;box-shadow:0 0 8px #5ad68a}
    .dot.warn{background:#ffb547;box-shadow:0 0 8px #ffb547} .dot.err{background:#ff6b6b;box-shadow:0 0 8px #ff6b6b}
    .tabs{display:grid;grid-template-columns:repeat(6,1fr);gap:5px;padding:8px 10px;background:var(--shell-lo);border-bottom:3px solid var(--seam)}
    .tabs button{all:unset;cursor:pointer;touch-action:none;text-align:center;padding:5px 2px;border-radius:8px;font-weight:700;font-size:var(--t-s);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--on-shell-dim);background:#00000026;border:1px solid #ffffff1f}
    .tabs button:hover{background:#ffffff1f;color:#fff}
    .tabs button.on{background:linear-gradient(90deg,var(--gold),#ffd978);color:var(--on-gold);border-color:var(--gold);box-shadow:none}
    .tabs button.drag{opacity:.4} .tabs button.dropto{outline:2px dashed #fff;outline-offset:1px}
    .body{padding:12px;overflow:auto;flex:1;background:var(--bg);scrollbar-width:thin;scrollbar-color:var(--line-2) transparent}
    .goal .st{font-size:var(--t-s);margin-top:2px}
    /* 2.13: the ZGRay-style frame */
    .th-zg .hd{background:linear-gradient(115deg,#21364a,#1b263d);padding:11px 12px;gap:8px}
    .th-zg .hd .t{all:unset;font-weight:800;font-size:var(--t-m);color:var(--ink);white-space:nowrap}
    .th-zg .hd img.ver{background:var(--acc);border-radius:10px;padding:2px;width:30px;height:32px}
    .vtag{font:var(--t-s) ui-monospace,monospace;color:var(--mute)}
    .tabs{display:flex;gap:0;padding:0 4px;border-bottom:1px solid var(--line)}
    .th-zg .tabs{background:#152132}
    .tabs button{flex:1 1 auto;font-size:var(--t-s);border-radius:0;background:transparent;border:0;border-bottom:2px solid transparent;padding:9px 3px 8px;color:var(--mute);overflow:visible;text-overflow:clip}
    .tabs button:hover{background:#ffffff0d;color:var(--ink)}
    .tabs button.on{background:transparent;color:var(--acc);border-bottom-color:var(--acc);box-shadow:none}
    .foot{padding:10px 12px 12px;border-top:1px solid var(--line);background:var(--bg);display:grid;gap:8px}
    .fr{display:grid;grid-template-columns:1fr 1fr;gap:8px}
    .fb{all:unset;box-sizing:border-box;cursor:pointer;text-align:center;padding:11px 8px;border-radius:10px;font-weight:800;font-size:var(--t-m);border:1px solid var(--line-2);background:var(--well);color:var(--ink)}
    .fb.go{background:var(--acc);border-color:var(--acc);color:var(--acc-ink)} .fb.go2{border-color:var(--acc);color:var(--acc)}
    .fb.stop{background:color-mix(in srgb,var(--bad) 14%,var(--well));border-color:color-mix(in srgb,var(--bad) 45%,var(--line));color:#ffc5cf}
    .fb.lt{padding:7px 8px;font-weight:600;font-size:var(--t-s);color:var(--mute)} .fb:disabled{opacity:.4;cursor:default} .fb.dimb{opacity:.55}
    .pillq{display:inline-block;min-width:18px;padding:0 6px;margin-left:4px;border-radius:999px;background:var(--line-2);color:var(--ink);font-size:var(--t-s)}
  `;
  let host, root, timer;
  const W_MIN = 340, W_MAX = 900, RAIL = 64;
  const width = () => Math.max(W_MIN, Math.min(W_MAX, +prefs.width || 460));
  // text size: scales all of Mega (text, buttons, spacing) - for reading on a phone over remote desktop
  const SCALES = [1, 1.1, 1.2, 1.32, 1.45, 1.6];
  const scale = () => SCALES[Math.max(0, Math.min(SCALES.length - 1, prefs.scaleIdx ?? 2))];
  // the game moves right by the panel's width, so Mega never covers it
  function layout() {
    let st = document.getElementById('mega-layout');
    if (!st) { st = document.createElement('style'); st.id = 'mega-layout'; (document.head || document.documentElement).appendChild(st); }
    const w = prefs.open ? width() : RAIL;
    st.textContent = `html body{padding-left:${w}px !important;box-sizing:border-box !important}
      #team-mini{left:${w}px !important}`;
    if (host) host.style.setProperty('--w', w + 'px');
  }
  const TABS = [['home', 'Tasks'], ['plan', 'Queue'], ['care', 'Day Care'], ['dexg', 'Pokédex'], ['rank', 'Rank Up'], ['legends', 'Sim'], ['engine', 'Settings']];
  // your tab order (drag to rearrange); tabs added in later versions go at the end
  const tabList = () => { const o = Array.isArray(prefs.tabOrder) ? prefs.tabOrder : [], byK = new Map(TABS); return [...o.filter((k) => byK.has(k)).map((k) => [k, byK.get(k)]), ...TABS.filter(([k]) => !o.includes(k))]; };
  // drag with the mouse (pointer events - the browser's own drag-and-drop doesn't fire inside Mega's panel)
  function tabDrag(bar) {
    let d = null, swallow = false;
    const at = (e) => { const el = (root.elementFromPoint ? root.elementFromPoint(e.clientX, e.clientY) : document.elementFromPoint(e.clientX, e.clientY)); return el?.closest?.('button[data-tab]') || null; };
    const clear = () => bar.querySelectorAll('.drag,.dropto').forEach((x) => x.classList.remove('drag', 'dropto'));
    bar.addEventListener('click', (e) => { if (swallow) { swallow = false; e.stopPropagation(); e.preventDefault(); } }, true);
    bar.addEventListener('pointerdown', (e) => {
      const b = e.target.closest('button[data-tab]'); if (!b || e.button !== 0) return;
      d = { key: b.dataset.tab, b, x: e.clientX, y: e.clientY, on: false };
      const move = (ev) => {
        if (!d) return;
        if (!d.on && Math.hypot(ev.clientX - d.x, ev.clientY - d.y) < 8) return;
        if (!d.on) { d.on = true; d.b.classList.add('drag'); bar.style.cursor = 'grabbing'; }
        const t = at(ev); bar.querySelectorAll('.dropto').forEach((x) => x !== t && x.classList.remove('dropto'));
        if (t && t !== d.b && bar.contains(t)) t.classList.add('dropto');
      };
      const up = (ev) => {
        window.removeEventListener('pointermove', move, true); window.removeEventListener('pointerup', up, true);
        const was = d; d = null; bar.style.cursor = ''; clear();
        if (!was?.on) return;
        swallow = true; setTimeout(() => { swallow = false; }, 400);
        const t = at(ev); if (!t || !bar.contains(t) || t.dataset.tab === was.key) return;
        const keys = tabList().map(([k]) => k), from = was.key, to = t.dataset.tab, i = keys.indexOf(from), jo = keys.indexOf(to);
        keys.splice(i, 1); keys.splice(keys.indexOf(to) + (jo > i ? 1 : 0), 0, from); // lands where the target was
        prefs.tabOrder = keys; savePrefs(); render(); try { Remote.soon(); } catch (__e) { __h('60-ui:121', __e); }
      };
      window.addEventListener('pointermove', move, true); window.addEventListener('pointerup', up, true);
    });
  }
  // Settings: every card folds by clicking its title; which ones you closed is remembered
  const cardKey = (h3) => h3.textContent.replace(/[^\p{L}\p{N} ]/gu, '').trim();
  function foldCards(body) {
    const shut = new Set(prefs.foldSet || []);
    body.querySelectorAll(':scope > .card').forEach((c) => {
      const h = c.querySelector(':scope > h3'); if (!h) return;
      h.classList.add('foldh'); h.dataset.act = 'fold-card';
      if (shut.has(cardKey(h))) c.classList.add('folded');
    });
  }
  let fightData = null, changeH = null, inputH = null;
  // ---- Kinesis shows Mega's own screens (Settings, Fights) and presses their buttons from the phone,
  // so the two always match: whatever these screens get, the phone gets too.
  // 1.0: every tab but Now, Plan and Trades (those keep their phone shape - Trades does real trades from the phone)
  // the phone's Start Now / Add to Queue / Start-Stop (Mega's are in its footer)
  const phoneFoot = (w) => { const can = w.ok && Tasks.canGo(w, planUi, esc); return `<div class="btns" style="margin-top:4px"><button class="btn gold${can ? '' : ' dimb'}" data-act="task-go" data-now="1">Start Now</button><button class="btn${can ? '' : ' dimb'}" data-act="task-go" data-now="0">＋ Add to Queue</button></div><button class="btn${Plan.running ? ' danger' : ''}" data-act="stop-all">${Plan.running ? 'Stop Mega' : 'Start Mega'}</button>`; };
  const MV = { now: (w) => Sub.apply('now', Views.now(w, esc, fmtIn), prefs, esc, { pick: 'main' }), trades: () => Views.trades(esc), tasks: (w) => Views.tasks(w, planUi, esc) + phoneFoot(w), queue: (w) => Views.queue(w, planUi, esc), care: (w) => Views.daycare(w, esc), engine: (w) => Views.engine(w, esc), fights: (w) => Views.fights(w, fightData, prefs, esc), league: () => Views.league(esc),
    dex: (w) => Views.dex(w, prefs, esc, dexUi), box: (w) => (w.ok ? Views.box(esc) : '<div class="note">Waiting for the game engine.</div>'),
    legends: (w) => Views.legends(w, legUi, esc), gems: (w) => (w.ok ? Views.gems(esc) : '<div class="note">Waiting for the game engine.</div>'), blocs: (w) => (w.ok ? Views.blocs(esc) : '<div class="note">Waiting for the game engine.</div>'), act: () => Views.activity(esc) };
  // ---- the phone has its own screen state: the open Pokémon, searches, filters and picks it changes
  // don't move Mega's panel on the PC (and the other way round). Swapped in only around a phone draw
  // or tap; the PC panel doesn't redraw while it's swapped. Shared on purpose: running simulations.
  const PREF_KEYS = ['tab', 'q', 'foe', 'leg', 'simMode', 'asMax', 'sub'], LEG_KEYS = ['pick', 'asMax', 'mode', 'eliteAll'];
  let phoneSwap = false, PHONE = null;
  const pickKeys = (o, ks) => Object.fromEntries(ks.map((k) => [k, o[k]]));
  function asPhone(fn) {
    if (!PHONE) PHONE = { dex: { dexOpen: null }, leg: { pick: legUi.pick, asMax: false, mode: 'legendary' }, prefs: pickKeys(prefs, PREF_KEYS), mirror: JSON.parse(JSON.stringify(Mirror.ui)) };
    const pc = { dex: { ...dexUi }, leg: pickKeys(legUi, LEG_KEYS), prefs: pickKeys(prefs, PREF_KEYS), mirror: JSON.parse(JSON.stringify(Mirror.ui)) };
    const load = (st) => { Object.assign(dexUi, st.dex); Object.assign(legUi, st.leg); Object.assign(prefs, st.prefs); for (const k of Object.keys(st.mirror)) Object.assign(Mirror.ui[k], st.mirror[k]); };
    phoneSwap = true; load(PHONE);
    try { return fn(); } finally {
      PHONE = { dex: { ...dexUi }, leg: pickKeys(legUi, LEG_KEYS), prefs: pickKeys(prefs, PREF_KEYS), mirror: JSON.parse(JSON.stringify(Mirror.ui)) };
      load(pc); phoneSwap = false; savePrefs();
    }
  }
  async function mvHtml(tab) {
    if (!MV[tab]) throw new Error('that screen is not on the phone');
    if (tab === 'fights' && !fightData) { try { fightData = { list: await Recorder.all(), at: Date.now() }; } catch { fightData = { list: [], at: Date.now() }; } }
    // English for the phone: Mega's own panel translates on screen (Casing.apply); this html goes as text
    // (names like "Forêt d'Empoigne" are escaped, so match them with a plain ' and escape it back)
    const w = World.build();
    return Icons.swap(Casing.names(String(asPhone(() => Sub.apply(tab, MV[tab](w), prefs, esc)) ?? '').replace(/&#39;/g, "'")).replace(/'/g, '&#39;'));
  }
  async function mvAct(d) {
    const data = { ...(d.data || {}) }, act = data.act;
    const cls = { contains: () => false, toggle() {}, add() {}, remove() {} };
    const t = { dataset: data, checked: !!d.checked, value: d.value ?? '', classList: cls, tagName: (d.tag || 'BUTTON').toUpperCase(),
      closest: (sel) => (sel === '[data-act]' ? t : null), matches: (sel) => !!act && sel.includes(`[data-act="${act}"]`) && sel.toLowerCase().startsWith((d.tag || 'button').toLowerCase()) };
    if (act === 'fold-card' || act === 'toggle' || act === 'bigger' || act === 'smaller' || act === 'tab') return 'ok'; // just the PC's own layout
    // spending gems needs the phone's own confirmation sheet (Kinesis sends gem.rank); never a pop-up on the PC
    // (fuse / buy / new offer can come with the phone's own confirm as data-sure; trades and hatching use the phone's own sheets)
    if (act === 'gem-rank' || act === 'gem-open' || act === 'tr-open' || act === 'm-egg-hatch' || (['gem-fuse', 'gem-buy', 'gem-reroll'].includes(act) && !data.sure)) return 'confirm on the phone';
    if (act === 'fights-reload' || (d.tab === 'fights' && /^f-?/.test(act || ''))) fightData = null;
    asPhone(() => { if (d.kind === 'change' && changeH) changeH({ target: t }); else if (d.kind === 'input' && inputH) inputH({ target: t }); else onClick({ target: { closest: () => t }, preventDefault() {}, stopPropagation() {} }); });
    await new Promise((r) => setTimeout(r, 400));
    return 'ok';
  }
  const dexUi = { dexOpen: null };
  const planUi = { addMoney: null, addFoe: null, addType: 'legend', addFrom: 'auto', addAim: 'deep', addReg: null, showLog: false };
  const legUi = { pick: null, simRun: null, real: null, asMax: false, mode: 'legendary', hideLocked: false, hideCaught: false };
  async function loadReal(id) {
    const roam = !!Legends.get(id)?.roam;
    const cur = roam ? (Engine.get('Game.S')?.team || []).slice(0, 6) : Engine.read('Game.zoneTeam', [], id) || [], sim = Legends.sims()[id];
    legUi.real = { id, cur: cur.length ? await Legends.realFor(id, cur) : null, sim: sim ? await Legends.realFor(id, sim.uids) : null };
    renderBody(true);
  }
  async function runSim(id) {
    legUi.simRun = { id, pct: 0 };
    renderBody(true);
    try {
      const r = await Sim.search(id, { asMax: legUi.asMax, onProgress: (p) => { legUi.simRun.pct = Math.round(p * 100); renderBody(true); } });
      Legends.saveSim(id, r);
      legUi.simRun = { id, result: true };
      Log.add(`${World.dex.name(id)}: best simulated team ${Math.round(r.final.ko * 100)}%${r.asMax ? ` as if Lv 100 (today ${Math.round(r.today.ko * 100)}%)` : ''}`);
    } catch (e) { legUi.simRun = { id, error: 'The simulator stopped: ' + (e?.message || e) }; }
    loadReal(id);
  }
  const loadFights = () => Recorder.all().then((list) => { fightData = { list, at: Date.now() }; renderBody(true); }).catch(() => { fightData = { list: [], at: Date.now() }; });

  function mount() {
    if (host) return;
    host = document.createElement('div');
    host.id = 'mega-alakazam';
    root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${CSS}</style><div class="wrap"></div>`;
    document.documentElement.appendChild(host);
    layout();
    root.addEventListener('click', onClick);
    root.addEventListener('change', changeH = (e) => {
      if (e.target.matches('input[data-act="restore-file"]')) {
        const f = e.target.files?.[0]; if (!f) return;
        f.text().then((txt) => {
          let d; try { d = JSON.parse(txt); } catch { alert('That file is not a Mega data file (not JSON).'); return; }
          const SKIP = /^mega-(next|prev)-(code|ver)$|^mega-(tested-ver|selftest|test-|game-build|next-try|next-bad)/;
          const keys = Object.keys(d || {}).filter((k) => /^mega-/.test(k) && typeof d[k] === 'string' && !SKIP.test(k));
          if (!keys.length) { alert('No Mega entries in that file.'); return; }
          if (!confirm(`Restore ${keys.length} Mega entries (plan, phone pairing, settings)? This replaces Mega's current data on this address, then reloads the page.`)) return;
          const wait = () => { const a = Engine.get('Game.S')?.adv; if (a?.battle) return setTimeout(wait, 200); for (const k of keys) localStorage.setItem(k, d[k]); location.reload(); };
          wait();
        });
        return;
      } if (e.target.matches('input[data-act="berry-on"], input[data-act="berry-keep"]')) { const k = e.target.dataset.k; if (e.target.dataset.act === 'berry-on') Berries.setPref(k, { off: !e.target.checked }); else Berries.setPref(k, { keep: +e.target.value || 0 }); Log.add(`berries: ${k.replace(/-/g, ' ')} ${Berries.pref(k).off ? 'off' : 'on'}, keep ${Berries.pref(k).keep}`); renderBody(true); return; } if (e.target.dataset.msel) { Mirror.ui.box[e.target.dataset.msel] = e.target.value; renderBody(true); return; } if (e.target.matches('select[data-act="add-foe"]')) { planUi.addFoe = +e.target.value || null; renderBody(true); return; }
      if (e.target.matches('select[data-act="add-type"]')) { planUi.addType = e.target.value || 'legend'; renderBody(true); return; }
      if (e.target.matches('select[data-act="add-from"]')) { planUi.addFrom = e.target.value === 'auto' ? 'auto' : +e.target.value || 1; return; }
      if (e.target.matches('select[data-act="add-aim"]')) { planUi.addAim = e.target.value === 'loot' ? 'loot' : 'deep'; return; }
      if (e.target.matches('select[data-act="gem-tier"]')) { try { localStorage.setItem('mega-gem-tier', e.target.value); } catch (__e) { __h('60-ui:231', __e); } renderBody(true); return; }
      if (e.target.matches('select[data-act="gem-focus"]')) { Views.gemUi = { ...(Views.gemUi || {}), focus: e.target.value }; try { localStorage.setItem('mega-gem-focus', e.target.value); } catch (__e) { __h('60-ui:232', __e); } renderBody(true); return; }
      if (e.target.matches('select[data-act="disc-carrier"]')) {
        const g = Plan.goals.find((x) => x.id === e.target.dataset.id);
        if (g) { GoalTypes.setCarrier(g, e.target.value || null); Log.add(`${Plan.label(g)}: carrier ${g.carrier ? (() => { try { return Casing.names(Engine.get('Game.DEX')[Engine.read('Game.getMon', {}, g.carrier)?.id].name); } catch { return 'that Pokémon'; } })() : 'picked by Mega'}`); }
        renderBody(true); return;
      }
      if (e.target.matches('select[data-act="ug-from"], select[data-act="ug-aim"]')) {
        const g = Plan.goals.find((x) => x.id === e.target.dataset.id);
        if (g) { if (e.target.dataset.act === 'ug-from') g.from = e.target.value === 'auto' ? 'auto' : +e.target.value || 1; else g.aim = e.target.value === 'loot' ? 'loot' : 'deep'; Plan.save(); Log.add(`Underground: ${Plan.label(g)}`); }
        renderBody(true); return;
      }
      if (e.target.matches('select[data-act="add-money"]')) { planUi.addMoney = +e.target.value; return; }
      if (e.target.matches('select[data-act="add-item"]')) { planUi.addItem = e.target.value || null; renderBody(true); return; }
      if (e.target.matches('select[data-act="add-story"]')) { planUi.addStory = e.target.value || null; renderBody(true); return; }
      if (e.target.matches('select[data-act="add-league"]')) { planUi.addLeague = e.target.value || null; renderBody(true); return; }
      if (e.target.matches('select[data-act="add-reg"]')) { planUi.addReg = e.target.value || null; renderBody(true); return; }
      if (e.target.matches('select[data-act="elite-pick"]')) { legUi.elitePick = +e.target.value || null; prefs.elitePick = legUi.elitePick; savePrefs(); renderBody(true); return; }
      if (e.target.matches('select.sel') || e.target.matches('select[data-act="pick"]')) { legUi.pick = +e.target.value || null; prefs.leg = legUi.pick; savePrefs(); legUi.real = null; renderBody(true); if (legUi.pick) loadReal(legUi.pick); } });
    root.addEventListener('input', inputH = (e) => { if (phoneSwap && e.target.dataset?.act === 'berry-keep' && e.target.dataset.k) { Berries.setPref(e.target.dataset.k, { keep: +e.target.value || 0 }); Log.add(`phone: keep ${Berries.pref(e.target.dataset.k).keep} ${e.target.dataset.k.replace(/-/g, ' ')}`); renderBody(true); return; } if (e.target.dataset.mq) { const k = e.target.dataset.mq; Mirror.ui[k].q = e.target.value; renderBody(true); return; } if (e.target.matches('input.q')) { prefs.q = e.target.value; savePrefs(); renderBody(true); } });
    legUi.pick = prefs.leg || null; legUi.elitePick = prefs.elitePick || null;
    legUi.asMax = !!prefs.asMax; legUi.hideLocked = !!prefs.legHideLocked; legUi.hideCaught = !!prefs.legHideCaught;
    legUi.mode = ['elite', 'league'].includes(prefs.simMode) ? prefs.simMode : 'legendary';
    if (legUi.pick) setTimeout(() => loadReal(legUi.pick), 1500);
    Plan.boot();
    Notify.boot();
    try { Dailies.boot(); } catch (__e) { __h('60-ui:257', __e); }
    Cards.boot();
    Trades.boot();
    DayCare.boot();
    History.boot();
    Guard.boot();
    Calib.boot();
    Updater.boot();
    GameGuard.boot();
    Remote.boot();
    render();
    loadFights();
    Recorder.onFight(() => loadFights());
    timer = setInterval(() => { if (prefs.open) renderBody(); }, 2000);
  }

  function onClick(e) {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    const act = t.dataset.act;
    // the Kinesis mirror (Activity, PC, Pokédex grid + shiny, Change Team, hatch, raid re-pick)
    if (act === 'team-edit') { Mirror.ui.tm.draft = null; Mirror.ui.tm.q = ''; prefs.tab = 'team'; savePrefs(); render(); return; }
    if (act === 'egg-auto') { DayCare.setAuto(!!t.checked); renderBody(true); return; }
    if (act === 'stop-all') { Plan.setRunning(!Plan.running); renderBody(true); return; }
    if (act && act.startsWith('m-')) { Mirror.act(act, t, () => renderBody(true)).then((r) => { if (r === 'back') { goTab('now'); savePrefs(); render(); } else renderBody(true); }); return; }
    if (act === 'toggle') { prefs.open = !prefs.open; if (!prefs.open) Mirror.markAway(); savePrefs(); render(); }
    if (act === 'bigger' || act === 'smaller') {
      const i = Math.max(0, Math.min(SCALES.length - 1, (prefs.scaleIdx ?? 2) + (act === 'bigger' ? 1 : -1)));
      // keep the same amount of text per line: the column grows with the text, within what the screen allows
      const old = scale(); prefs.scaleIdx = i;
      prefs.width = Math.max(W_MIN, Math.min(W_MAX, Math.round(width() * scale() / old), Math.round(innerWidth * 0.42)));
      savePrefs(); render();
    }
    if (act === 'tab') { goTab(t.dataset.tab); savePrefs(); render(); if (view() === 'trades') Trades.refresh().then(() => renderBody(true)); }
    if (act === 'grp' && GROUPS[prefs.tab]) { prefs.grp = { ...(prefs.grp || {}), [prefs.tab]: t.dataset.k }; savePrefs(); renderBody(true); root?.querySelector('.body')?.scrollTo?.(0, 0); if (t.dataset.k === 'trades') Trades.refresh().then(() => renderBody(true)); return; }
    if (act === 'task-cat') { Tasks.ui.cat = t.dataset.k; Tasks.ui.pick = (Tasks.LIST.find((x) => x.cat === t.dataset.k && x.k === Tasks.ui.pick) || null)?.k || null; Tasks.save(); renderBody(true); return; }
    if (act === 'task-pick') { Tasks.ui.pick = Tasks.ui.pick === t.dataset.k ? null : t.dataset.k; Tasks.ui.msg = ''; Tasks.save(); renderBody(true); return; }
    if (act === 'task-daily') { Tasks.ui.daily[t.dataset.k] = !!t.checked; Tasks.save(); renderBody(true); return; }
    if (act === 'task-go') {
      const fire = (ds) => onClick({ target: { closest: () => ({ dataset: ds, checked: false, value: '', tagName: 'BUTTON', classList: { contains: () => false }, closest: () => null }) }, preventDefault() {}, stopPropagation() {} });
      Tasks.go(World.build(), planUi, esc, t.dataset.now === '1', fire); if (view() !== 'tasks') goTab('tasks'); renderBody(true); return;
    }
    if (act === 'tr-refresh') { Trades.refresh(true).then(() => renderBody(true)); setTimeout(() => renderBody(true), 50); }
    if (act === 'tr-open') { Trades.openMsg = 'Opening in the game…'; renderBody(true); Trades.openInGame(+t.dataset.id, !!t.dataset.shiny, t.dataset.who || null, +t.dataset.want || 0).then((m) => { Trades.openMsg = m ? m[0].toUpperCase() + m.slice(1) + '.' : ''; renderBody(true); setTimeout(() => { Trades.openMsg = ''; }, 30_000); }); }
    if (act === 'gem-open') { EliteInfo.msg = 'Opening in the game…'; renderBody(true); EliteInfo.openMon(t.dataset.uid).then((m) => { EliteInfo.msg = m ? m[0].toUpperCase() + m.slice(1) + '.' : ''; renderBody(true); setTimeout(() => { EliteInfo.msg = ''; }, 30_000); }); }
    if (act === 'subtab' && t.dataset.tab) { prefs.sub = { ...(prefs.sub || {}), [t.dataset.tab]: t.dataset.k }; savePrefs(); renderBody(true); try { const b = root?.querySelector('.body'); if (b && !phoneSwap) b.scrollTop = 0; } catch (__e) { __h('60-ui:302', __e); } return; }
    if (act === 'elite-jump' && t.dataset.id) { legUi.elitePick = +t.dataset.id; prefs.elitePick = legUi.elitePick; savePrefs(); renderBody(true); return; }
    if (act === 'elite-all') { legUi.eliteAll = !legUi.eliteAll; renderBody(true); return; }
    if (act === 'elite-sim' || act === 'league-sim') {
      const tier = +t.dataset.tier, k = act === 'elite-sim' ? `L${t.dataset.id}:${tier}` : `G${t.dataset.reg}:${tier}`;
      Views.__eliteRun = Views.__eliteRun || {}; Views.__eliteRun[k] = 0; renderBody(true);
      const onProgress = (p) => { Views.__eliteRun[k] = Math.round(p * 100); renderBody(true); };
      (act === 'elite-sim' ? EliteSim.legend(+t.dataset.id, tier, { onProgress }) : EliteSim.leagueSim(t.dataset.reg, tier, { onProgress }))
        .then((r) => Log.add(`${act === 'elite-sim' ? `${World.dex.name(+t.dataset.id)} elite` : `Elite League ${t.dataset.reg}`} tier ${tier}: ${Math.round(r.ko * 100)}%`))
        .catch((e) => Log.add('simulation failed: ' + (e?.message || e))).finally(() => { delete Views.__eliteRun[k]; renderBody(true); });
    }
    // Best Next Rewards: tap a tier -> confirm -> add its goal (Jimmy 2026-11-25)
    if (act === 'rw-ask') { Views.__rwAsk = Views.__rwAsk === t.dataset.k ? null : t.dataset.k; renderBody(true); return; }
    if (act === 'rw-cancel') { Views.__rwAsk = null; renderBody(true); return; }
    if (act === 'rw-add') {
      const k = t.dataset.k || '';
      if (k[0] === 'e' && t.dataset.id && !Plan.goals.some((g) => !g.done && g.type === 'elite' && +g.foe === +t.dataset.id)) Plan.add('elite', { foe: +t.dataset.id, upTo: 5 });
      if (k[0] === 'g' && t.dataset.reg && !Plan.goals.some((g) => !g.done && g.type === 'league' && g.reg === t.dataset.reg)) Plan.add('league', { reg: t.dataset.reg, upTo: 5 });
      Views.__rwAsk = null; renderBody(true); return;
    }
    if (act === 'elite-add') { Plan.add('elite', { foe: +t.dataset.id, upTo: 5 }); renderBody(true); }
    if (act === 'league-add') { Plan.add('league', { reg: t.dataset.reg, upTo: 5 }); renderBody(true); }
    if (act === 'plan-add-wboss') { Plan.add('wboss', {}); renderBody(true); }
    if (act === 'plan-add-train') { Plan.add('train', {}); planUi.addType = 'legend'; renderBody(true); }
    if (act === 'plan-add-discord' && t.dataset.spot) { Plan.add('discord', { spot: t.dataset.spot }); planUi.addType = 'legend'; renderBody(true); }
    if (act === 'plan-add-bloc') { Plan.add('bloc', {}); planUi.addType = 'legend'; renderBody(true); }
    if (act === 'sim-mode') { legUi.mode = t.dataset.mode || 'legendary'; prefs.simMode = legUi.mode; savePrefs(); renderBody(true); root?.querySelector('.body')?.scrollTo?.(0, 0); }
    if (act === 'tr-pick') { Trades.pick = { id: +t.dataset.id, shiny: !!t.dataset.shiny }; Trades.openMsg = ''; renderBody(true); root?.querySelector('.body')?.scrollTo?.(0, 0); }
    if (act === 'tr-back') { Trades.pick = null; Trades.openMsg = ''; renderBody(true); }
    if (act === 'tr-shiny') { Trades.setShiny(t.checked); setTimeout(() => renderBody(true), 50); }
    const id = legUi.pick;
    if (act === 'asmax') { legUi.asMax = !!t.checked; prefs.asMax = legUi.asMax; savePrefs(); }
    if (act === 'sim' && id) runSim(id);
    if (act === 'leg-hide-locked') { legUi.hideLocked = !!t.checked; prefs.legHideLocked = legUi.hideLocked; savePrefs(); renderBody(true); }
    if (act === 'leg-hide-caught') { legUi.hideCaught = !!t.checked; prefs.legHideCaught = legUi.hideCaught; savePrefs(); renderBody(true); }
    if (act === 'use' && id) { const sim = Legends.sims()[id]; if (sim) { if (Legends.get(id)?.roam) { if (!GoalTypes.setChapterTeam(GoalKit.fullTeam(sim.uids))) legUi.simRun = { id, error: 'the game would not take that team right now (mid-fight?)' }; } else { const r = GoalTypes.setTeam(id, sim.uids); if (!r.ok) legUi.simRun = { id, error: r.why }; } loadReal(id); } }
    if (act === 'leg-add' && id) { Plan.add(Legends.get(id)?.roam ? 'roam' : 'legend', { foe: id }); renderBody(true); }
    if (act === 'oldoff') { Plan.turnOldOff(); setTimeout(() => renderBody(true), 300); }
    const gid = t.dataset.id;
    if (act === 'plan-run') { Plan.setRunning(!Plan.running); renderBody(true); }
    if (act === 'plan-add' && planUi.addFoe) { Plan.add('legend', { foe: planUi.addFoe }); planUi.addFoe = null; renderBody(true); }
    if (act === 'ug-preview') { const g = Plan.goals.find((x) => x.id === t.dataset.id); if (g) { const p = GoalTypes.ugPreview(g); if (p && !p.then && p.error) g.preview = p; renderBody(true); Promise.resolve(p).finally(() => renderBody(true)); } return; }
    if (act === 'plan-add-ug') { Plan.add('under', { from: planUi.addFrom || 'auto', aim: planUi.addAim || 'deep' }); planUi.addType = 'legend'; renderBody(true); }
    if (act === 'plan-add-story' && planUi.addStory) { const NM = { unova: 'Unova', kalos: 'Kalos', alola: 'Alola', galar: 'Galar', paldea: 'Paldea' }; Plan.add('story', { region: planUi.addStory, regionName: NM[planUi.addStory] || planUi.addStory }); planUi.addStory = null; planUi.addType = 'legend'; try { GoalTypes.storyPlace?.(); } catch (__e) { __h('60-ui:345', __e); } renderBody(true); return; }
    if (act === 'plan-add-league' && planUi.addLeague) { if (!Plan.goals.some((g) => !g.done && g.type === 'league' && g.reg === planUi.addLeague)) Plan.add('league', { reg: planUi.addLeague, upTo: 5 }); planUi.addLeague = null; planUi.addType = 'legend'; renderBody(true); return; }
    if (act === 'plan-add-reg' && planUi.addReg) { Plan.add('region', { reg: planUi.addReg }); planUi.addReg = null; planUi.addType = 'legend'; renderBody(true); }
    if (act === 'rows') { e.preventDefault(); planUi.openRows = planUi.openRows || {}; planUi.openRows[gid] = !planUi.openRows[gid]; renderBody(true); }
    if (act === 'dexinfo') { dexUi.dexOpen = +t.dataset.id; if (view() !== 'dex') { goTab('dex'); savePrefs(); render(); } else renderBody(true); root?.querySelector('.body')?.scrollTo?.(0, 0); }
    if (act === 'dexback') { dexUi.dexOpen = null; renderBody(true); }
    if (act === 'plan-add-item') { Plan.add('loot', { item: t.dataset.item, ch: +t.dataset.ch, place: t.dataset.place, need: +t.dataset.need || 1 }); renderBody(true); }
    if (act === 'dex-add-wild') { Plan.add('wild', { foe: +t.dataset.id, ch: +t.dataset.ch }); DexView.clear(); renderBody(true); }
    if (act === 'dex-add') { addDexJob(+t.dataset.id, +t.dataset.way || 0); DexView.clear(); renderBody(true); }
    if (act === 'n-on') { Notify.set('on', !!t.checked); if (t.checked && !Notify.cfg.topic) Notify.newTopic(); renderBody(true); }
    if (act === 'n-kind') { Notify.setKind(t.dataset.k, !!t.checked); }
    if (act === 'n-quiet') { Notify.set('quiet', !!t.checked); }
    if (act === 'berries') { Berries.set(!!t.checked); }
    if (act === 'topbar') { TopBar.set(!!t.checked); }
    if (act === 'movetune') { MoveTune.set(!!t.checked); Log.add(`moves: Mega ${t.checked ? 'may now turn status moves on and off before boss fights' : 'no longer changes moves (and gave back every move it had turned off)'}`); renderBody(true); }
    if (act === 'movetune-back') { const n = MoveTune.giveBack(); Log.add(`moves: gave back the moves Mega had turned off on ${n} Pokémon`); renderBody(true); return; }
    if (act === 'berry-on' && t.dataset.k && phoneSwap) { Berries.setPref(t.dataset.k, { off: !t.checked }); Log.add(`phone: ${t.dataset.k.replace(/-/g, ' ')} ${t.checked ? 'on' : 'off'}`); renderBody(true); return; }
    if (act === 'idle-level') { Plan.setIdle(!!t.checked); }
    if (act === 'rm-on') { Remote.set(!!t.checked); setTimeout(() => renderBody(true), 50); }
    if (act === 'rm-pair') { Remote.sendPair().then((ok) => { Log.add(ok ? 'phone remote: setup link sent to your phone' : 'phone remote: could not send the setup link (check Phone Alerts)'); renderBody(true); }); }
    if (act === 'calib-run') { Log.add('simulator: tuning against your recorded fights…'); Calib.fit(true).then(() => renderBody(true)); }
    if (act === 'guard-run') { Guard.run(); renderBody(true); }
    if (act === 'rm-relay') { Remote.setRelay(!!t.checked); setTimeout(() => renderBody(true), 300); }
    if (act === 'rm-rekey') { Remote.reKey(); Log.add('phone remote: new keys - pair your phone again'); renderBody(true); }
    if (act === 'cards') { Cards.set(!!t.checked); }
    if (act === 'n-test') { Notify.test().then(() => renderBody(true)); }
    if (act === 'n-week') { try { Notify.weekly(true); } catch (__e) { __h('60-ui:371', __e); } } // the weekly summary (Sunday 6 PM) so far, without starting a new week
    if (act === 'n-new') { Notify.newTopic(); renderBody(true); }
    if (act === 'plan-add-money') { const sel = root?.querySelector('select[data-act="add-money"]'); Plan.add('money', { target: planUi.addMoney || +sel?.value || 1e7 }); planUi.addType = 'legend'; renderBody(true); }
    if (act === 'plan-add-raid') { Plan.add('raid', {}); planUi.addType = 'legend'; renderBody(true); }
    if (act === 'plan-add-tower') { Plan.add('tower', {}); planUi.addType = 'legend'; renderBody(true); }
    if (act === 'plan-add-candy') { Plan.add('candy', {}); planUi.addType = 'legend'; renderBody(true); }
    if (act === 'fold-card') {
      const c = t.closest('.card'), k = cardKey(t), shut = new Set(prefs.foldSet || []);
      c.classList.toggle('folded'); if (c.classList.contains('folded')) shut.add(k); else shut.delete(k);
      prefs.foldSet = [...shut]; savePrefs(); return;
    }
    if (act === 'chains-on') { Chains.setOn(t.checked); renderBody(true); return; }
    if (act === 'health-test') { Health.selfTest('on demand').then(() => renderBody(true)); return; }
    if (act === 'health-clear') { Health.clear(); renderBody(true); return; }
    if (act === 'gem-focus-pick') { Views.gemUi = { ...(Views.gemUi || {}), focus: t.dataset.uid }; try { localStorage.setItem('mega-gem-focus', t.dataset.uid); } catch (__e) { __h('60-ui:385', __e); } renderBody(true); return; }
    if (act === 'gem-fuse') {
      const k = t.dataset.key, n = Math.max(1, +t.dataset.n || 1), f = GemFocus.fuseFor(k); if (!f?.can) return;
      if (!t.dataset.sure && !window.confirm(`Fuse ${n * f.per} ${f.lowerLabel}s into ${n} ${GemFocus.label(k)}${n === 1 ? '' : 's'}?\n\nThis can't be undone.`)) return;
      const r = GemFocus.fuse(k, n); Log.add(r ? `fused ${r.n * f.per} ${f.lowerLabel}s into ${r.n} ${GemFocus.label(r.key)}${r.n === 1 ? '' : 's'}` : 'gem: the game would not fuse that'); renderBody(true); return;
    }
    if (act === 'gem-buy') {
      const k = t.dataset.key, p = GemFocus.price(k);
      if (!t.dataset.sure && !window.confirm(`Buy 1 ${GemFocus.label(k)} for ${p} shards? (you have ${GemFocus.shards()})`)) return;
      Log.add(GemFocus.buy(k) ? `bought 1 ${GemFocus.label(k)} for ${p} shards` : 'gem shop: the game would not sell it (not enough shards, or the offer changed)'); renderBody(true); return;
    }
    if (act === 'gem-reroll') {
      const o = GemFocus.shop(); if (!o) return;
      if (!t.dataset.sure && !window.confirm(`Get a new gem shop offer for ₽${(+o.cost).toLocaleString()}? (the next one costs double)`)) return;
      const r = GemFocus.reroll(); Log.add(r?.error ? `gem shop: ${r.error}` : `gem shop: new offer for ₽${(+o.cost).toLocaleString()} - ${(r?.ids || []).map((k) => GemFocus.label(k)).join(', ')}`); try { GemFocus.watchShop(); } catch (__e) { __h('60-ui:399', __e); } renderBody(true); return;
    }
    if (act === 'gem-rank') {
      // your click + the game's own confirm text; the game's rank-up (rank +1, back to Lv 5). Mega never does this by itself.
      const m = Engine.read('Game.getMon', null, t.dataset.uid), U = Engine.get('Underground'); if (!m || !U) return;
      const ro = (() => { try { return U.rankOf(m, t.dataset.key); } catch { return null; } })(); if (!ro || ro.why) { Log.add('gem: ' + (ro?.why || 'that gem does not fit')); renderBody(true); return; }
      const nm = Engine.get('Game.DEX')?.[m.id]?.name || 'it';
      if (!t.dataset.sure && !window.confirm(`Rank up ${nm} (Lv ${m.level}) to rank ${ro.next} with ${ro.need} gem${ro.need === 1 ? '' : 's'}?\n\nIt goes back to Lv 5 and has to level up again. This can't be undone.`)) return;
      const r = U.rankUp(m.uid, t.dataset.key); if (r) Log.add(`ranked up ${nm} to rank ${r.rank} with ${r.spent} gem${r.spent === 1 ? '' : 's'} (back to Lv 5)`);
      renderBody(true); return;
    }
    if (act === 'gymplan-run') { let r = null; try { r = GymPlan.run(+t.dataset.ch, { force: true }); } catch (__e) { __h('60-ui:410', __e); } setTimeout(() => renderBody(true), 300); Promise.resolve(r).catch(() => {}).finally(() => renderBody(true)); return; }
    if (act === 'gym-go' || act === 'gym-train') {
      const g = (Plan.goals || []).find((x) => !x.done && x.type === 'story'); if (!g) return;
      try { if (act === 'gym-go') GoalTypes.story.goFight(g); else GoalTypes.story.trainThese(g); } catch (e) { Log.add('story button: ' + e.message); }
      renderBody(true); return;
    }
    if (act === 'theme') { prefs.theme = themeNow() === 'day' ? 'night' : 'day'; savePrefs(); render(); try { Remote.soon(); } catch (__e) { __h('60-ui:416', __e); } return; }
    if (act === 'update') { Updater.install(); return; }
    if (act === 'update-continue') { Updater.setContinue(t.checked); renderBody(true); return; }
    if (act === 'update-tm') { try { window.open('https://raw.githubusercontent.com/Murillo0211/mega-remote/main/mega-alakazam.user.js?t=' + Date.now(), '_blank'); } catch (__e) { __h('60-ui:419', __e); } return; }
    if (act === 'update-auto') { Updater.setAuto(t.checked); renderBody(true); return; }
    if (act === 'update-check') { Updater.check().then(() => renderBody(true)); return; }
    if (act === 'tabs-reset') { delete prefs.tabOrder; savePrefs(); render(); try { Remote.soon(); } catch (__e) { __h('60-ui:422', __e); } return; }
    if (act === 'plan-clear') { Plan.clearDone(); renderBody(true); }
    if (act === 'g-top') { Plan.toTop(gid); renderBody(true); }
    if (act === 'g-up') { Plan.move(gid, -1); renderBody(true); }
    if (act === 'g-down') { Plan.move(gid, 1); renderBody(true); }
    if (act === 'g-pause') { Plan.pause(gid); renderBody(true); }
    if (act === 'g-del') { Plan.remove(gid); renderBody(true); }
    if (act === 'g-retry') { Plan.retry(gid); renderBody(true); }
    if (act === 'log-more') { planUi.showLog = !planUi.showLog; renderBody(true); }
    if (act === 'foe') { prefs.foe = prefs.foe === t.dataset.foe ? null : t.dataset.foe; savePrefs(); renderBody(true); }
  }

  function health(w) {
    if (!w.ok) return ['err', 'Engine not reachable - read-only fallback'];
    if (w.audit.missing.length) return ['warn', `${w.audit.missing.length} engine functions missing after a game update`];
    return ['', 'Connected to the game engine'];
  }

  // theme: Classic (Alakazam 4.x's dark, the default) or Day; the header button switches them
  const THEMES = ['auto', 'day', 'night'];
  const themeNow = () => { const t = prefs.theme || 'auto'; return t === 'day' ? 'day' : 'night'; }; const themeCls = () => 'th-night th-zg'; // 2.13.5: one theme (the Day theme is gone) // Auto = Classic (Alakazam 4.x's dark) since 2026-11-23
  function render() {
    if (phoneSwap) return; // drawing for the phone right now: the PC panel keeps its own state
    const w = World.build();
    const wrap = root?.querySelector('.wrap');
    wrap.classList.remove('th-day', 'th-night', 'th-zg'); wrap.classList.add(...themeCls().split(' '));
    const [cls, tip] = health(w);
    layout();
    if (!prefs.open) { wrap.innerHTML = `<div class="rail" data-act="toggle" title="Open Mega Alakazam v${esc(VERSION)}"><img src="${MEGA_ICON}" width="44" height="47" alt=""><span class="dot ${cls}" title="${esc(tip)}"></span><span class="open">›</span></div>`; return; }
    const z = scale();
    wrap.innerHTML = `<div class="panel" style="width:${Math.round(width() / z)}px;zoom:${z}"><div class="grip" title="Drag to resize"></div>
      <div class="hd"><img src="${MEGA_ICON}" width="34" height="36" alt="" class="ver" title="Mega Alakazam v${esc(VERSION)}"><span class="vtip">v${esc(VERSION)}</span><span class="t">Mega Alakazam</span><span class="vtag">${esc(VERSION)}</span><span class="dot ${cls}" title="${esc(tip)} · v${esc(VERSION)}"></span><span style="flex:1"></span>${Updater.available ? `<button class="fold upd" data-act="update" title="Reloads the game into Mega ${esc(Updater.available)}">Update ${esc(Updater.available)}</button>` : ''}<button class="fold" data-act="toggle" title="Fold to a thin rail">‹</button></div>
      <div class="tabs">${tabList().map(([k, l]) => `<button data-act="tab" data-tab="${k}" class="${prefs.tab === k ? 'on' : ''}" title="Drag to rearrange">${l}</button>`).join('')}</div>
      <div class="body"></div><div class="foot"></div></div>`;
    const grip = root?.querySelector('.grip'), panel = root?.querySelector('.panel');
    grip.onpointerdown = (e) => {
      e.preventDefault(); grip.setPointerCapture(e.pointerId);
      const move = (ev) => { prefs.width = Math.max(W_MIN, Math.min(W_MAX, ev.clientX)); panel.style.width = Math.round(prefs.width / scale()) + 'px'; layout(); };
      const up = () => { grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); savePrefs(); };
      grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', up);
    };
    try { Casing.apply(root.querySelector('.tabs')); } catch (__e) { __h('60-ui:463', __e); }
    try { tabDrag(root.querySelector('.tabs')); } catch (__e) { __h('60-ui:464', __e); }
    renderBody(true, w);
  }

  // the status card every tab starts with (ZGRay's layout): what runs now, and three numbers
  const session = { at: Date.now(), money: null };
  // the running card says where and the berry timers only; team and levels are on Now (2.13.11)
  const brief = (t) => String(t || '').split(' · ').filter((x) => x && !/\d+\/100|\bcarriers?\b|Lv \d+|^\+\d+ more/.test(x)).join(' · ');
  function statusHtml(w) {
    const S = Engine.get('Game.S'), money = +(S?.money ?? NaN);
    if (session.money == null && Number.isFinite(money)) session.money = money;
    // the goal on the battle screen (Pokédex parents and the Underground run alongside it)
    const act = Plan.goals.filter((g) => !g.done && ['running', 'ready'].includes(Plan.live(g.id)?.state));
    const cur = act.find((g) => GoalTypes[g.type]?.uses === 'screen' && Plan.live(g.id)?.state === 'running') || act.find((g) => GoalTypes[g.type]?.uses === 'screen') || act[0] || null, L = cur ? Plan.live(cur.id) : null;
    const also = act.filter((g) => g !== cur).length;
    const word = !w.ok ? 'WAITING · game engine' : Plan.running ? 'RUNNING · Mega is working' : 'PAUSED · Mega is stopped';
    const net = Number.isFinite(money) && session.money != null ? money - session.money : null;
    let dex = '—'; try { const d = S?.dex || {}, all = Object.keys(Engine.get('Game.DEX') || {}).filter((k) => +k > 0 && +k < 10000).length; const c = Object.entries(d).filter(([k, x]) => +k > 0 && +k < 10000 && x?.caught).length; if (all) dex = `${c}/${all}`; } catch (__e) { __h('60-ui:481', __e); }
    // how long the task on the screen has been running (2.13.10 - kept across reloads; starts over when the task changes)
    let since = null;
    if (cur && Plan.running) {
      let r = null; try { r = JSON.parse(localStorage.getItem('mega-cur-task') || 'null'); } catch (__e) { __h('60-ui:485', __e); }
      if (!r || r.id !== cur.id) { r = { id: cur.id, at: Date.now() }; try { localStorage.setItem('mega-cur-task', JSON.stringify(r)); } catch (__e) { __h('60-ui:486', __e); } }
      since = r.at;
    }
    const t = since ? Math.floor((Date.now() - since) / 60000) : null, tm = t == null ? '—' : t < 60 ? `${t}m` : `${Math.floor(t / 60)}h ${String(t % 60).padStart(2, '0')}m`;
    return `<div class="stat"><div class="live"><i class="sdot ${!w.ok ? 'err' : Plan.running ? '' : 'off'}"></i>${word}</div>
      <b>${esc(cur ? Plan.label(cur) : Plan.running ? (Plan.top || 'Nothing to do - leveling while idle') : 'Ready - press Start')}</b>
      <div class="dim">${esc(cur ? brief([L?.why, L?.line].filter(Boolean).join(' · ')) : Plan.running ? '' : 'Pick a task, then Start Now or Add to Queue')}</div>${(() => { try { const r = Dailies.list().filter((d) => d.state === 'ready'); return r.length ? `<div class="dready" data-act="tab" data-tab="home">🔔 <b>${r.length} ${r.length === 1 ? 'daily' : 'dailies'} ready:</b> ${r.map((d) => esc(d.name)).join(', ')}</div>` : ''; } catch { return ''; } })()}</div>
      <div class="mets"><div><b>${dex}</b><span>Pokédex</span></div><div><b>${net == null ? '—' : (net > 0 ? '+' : net < 0 ? '−' : '') + '₽' + Math.abs(Math.round(net)).toLocaleString()}</b><span>Money gained</span></div><div><b>${tm}</b><span>On this task</span></div></div>`;
  }
  function footer(w) {
    const f = root?.querySelector('.foot'); if (!f) return;
    const onTasks = view() === 'tasks', can = onTasks && w.ok && Tasks.canGo(w, planUi, esc), n = Plan.goals.filter((g) => !g.done).length;
    const html = `<div class="fr"><button class="fb go${can ? '' : ' dimb'}" data-act="task-go" data-now="1" title="${onTasks ? 'Put this task at the top of the queue and run it' : 'Open Tasks to pick one'}">Start Now</button><button class="fb ${Plan.running ? 'stop' : 'go2'}" data-act="stop-all">${Plan.running ? 'Stop Mega' : 'Start Mega'}</button></div>
      <div class="fr"><button class="fb lt${can ? '' : ' dimb'}" data-act="task-go" data-now="0">＋ Add to Queue</button><button class="fb lt" data-act="tab" data-tab="plan">Queue <span class="pillq">${n}</span></button></div>`;
    if (f.dataset.html !== html) { f.innerHTML = html; f.dataset.html = html; }
  }
  function renderBody(force, w = World.build()) {
    if (phoneSwap) return;
    const body = root?.querySelector('.body');
    if (!body) return;
    // keep the search box focused while typing
    const focused = root.activeElement && root.activeElement.matches('input.q, select.sel');
    if (focused && !force) return;
    const vt = view();
    const html = vt === 'care' ? Views.daycare(w, esc) : vt === 'now' ? Views.now(w, esc, fmtIn) : vt === 'tasks' ? Views.tasks(w, planUi, esc) : vt === 'act' ? Views.activity(esc) : vt === 'box' ? (w.ok ? Views.box(esc) : '<div class="note">Waiting for the game engine.</div>') : vt === 'team' ? Views.teamEdit(esc) : vt === 'plan' ? Views.queue(w, planUi, esc) : vt === 'legends' ? Views.legends(w, legUi, esc) : vt === 'dex' ? Views.dex(w, prefs, esc, dexUi) : vt === 'engine' ? Views.engine(w, esc) : vt === 'fights' ? Views.fights(w, fightData, prefs, esc) : vt === 'trades' ? Views.trades(esc) : vt === 'gems' ? (w.ok ? Views.gems(esc) : '<div class="note">Waiting for the game engine.</div>') : vt === 'blocs' ? (w.ok ? Views.blocs(esc) : '<div class="note">Waiting for the game engine.</div>') : Views.now(w, esc, fmtIn);
    const top = (vt === 'plan' || vt === 'care' ? '' : statusHtml(w)) + (GROUPS[prefs.tab] ? `<div class="snav">${GROUPS[prefs.tab].map(([k, l]) => `<button class="${vt === k ? 'on' : ''}" data-act="grp" data-k="${k}">${l}</button>`).join('')}</div>` : '');
    const key = top + html + '|sub:' + (prefs.sub?.[vt] || ''); // a sub-tab pick changes the screen too
    footer(w);
    if (body.dataset.html === key) return;
    const st = body.scrollTop;
    body.innerHTML = top + Icons.swap(vt === 'now' ? Sub.apply('now', html, prefs, esc, { pick: 'main' }) : Sub.apply(vt, html, prefs, esc)); body.dataset.html = key; body.scrollTop = st;
    if (vt === 'engine') foldCards(body);
    try { footer(w); } catch (__e) { __h('60-ui:518', __e); }
    try { Casing.apply(body); } catch (__e) { __h('60-ui:519', __e); }
    if (focused) { const q = root?.querySelector('input.q'); if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } }
  }

  // self-test: draw every tab's screen (no DOM) and report the ones that throw
  function renderTest() {
    const w = World.build(), bad = [], odd = [];
    const tabs = { now: () => Views.now(w, esc, fmtIn), act: () => Views.activity(esc), plan: () => Views.plan(w, planUi, esc), box: () => Views.box(esc), dex: () => Views.dex(w, prefs, esc, dexUi),
      legends: () => Views.legends(w, legUi, esc), engine: () => Views.engine(w, esc), fights: () => Views.fights(w, fightData || { list: [], at: 0 }, prefs, esc), trades: () => Views.trades(esc), gems: () => Views.gems(esc), blocs: () => Views.blocs(esc), league: () => Views.league(esc) };
    for (const [k, f] of Object.entries(tabs)) { try { const h = f(); if (typeof h !== 'string') bad.push(`${k}: drew nothing`); else if (/\bundefined\b|\bNaN\b|\[object Object\]/.test(h.replace(/<[^>]+>/g, ' '))) odd.push(k); } catch (e) { bad.push(`${k}: ${e?.message || e}`); } }
    renderTest.odd = odd; return bad;
  }
  // self-test: French names left on Mega's screen (text and hover text) or in what the phone gets
  async function frenchLeft() {
    const out = new Set();
    try { const b = root && root?.querySelector('.body'); if (b) for (const k of Casing.leftover(b.textContent + ' ' + [...b.querySelectorAll('[title]')].map((e) => e.title).join(' '))) out.add('Mega: ' + k); } catch (__e) { __h('60-ui:534', __e); }
    for (const t of Object.keys(MV)) { try { for (const k of Casing.leftover((await mvHtml(t)).replace(/<[^>]+>/g, ' ').replace(/&#39;/g, "'"))) out.add('Kinesis ' + t + ': ' + k); } catch (__e) { __h('60-ui:535', __e); } }
    return [...out];
  }
  // the top-bar status line opens Mega on a tab
  function openTab(tab) { prefs.open = true; goTab(tab); savePrefs(); render(); }
  return { mount, openTab, mvHtml, mvAct, statusFor: () => { try { return statusHtml(World.build()); } catch { return ''; } }, renderTest, frenchLeft, get pcState() { return { dex: { ...dexUi }, leg: pickKeys(legUi, LEG_KEYS), q: prefs.q }; }, refresh: () => { try { render(); } catch (__e) { __h('60-ui:540', __e); } } };
})();

/* ---------------------------------------------------------------------------------------------
 * Trades: reads the game's online trade board (read-only server calls the Trades screen itself
 * uses: Cloud.trades.species / offers / state / mine) and finds offers that GIVE a Pokémon you
 * don't own - or one that evolves on arrival into one you don't own - then checks what you could
 * give for each:
 *   spare   you have 2+ of the wanted Pokémon and one is free to give: your Pokédex keeps it
 *   last    your only one: trading it sends that entry back to "seen" (says if a Pokémon you keep lays its egg)
 *   busy    you have it, but in your team / Day Care / buddy, or it's too new to trade yet
 *   none    you don't have it (says where to get it)
 * Phone alert (kind "trade") once per offer when a missing Pokémon can be had for a spare.
 * Mega never trades on its own (Cloud.trades.accept / create / close stay FORBIDDEN, no goal trades).
 * Since 0.21: Jimmy can accept / post from Kinesis - only on his tap + confirm, through the game's own
 * Trades screen, after checking the game's confirmation matches what he approved (accept / post below).
 * Refreshes every 15 min (the game's own ONLINE_TRADE.REFRESH_MS), or with the Refresh button.
 * ------------------------------------------------------------------------------------------- */
const Trades = (() => {
  const E = Engine;
  const SEEN = 'mega-trade-seen', PREF = 'mega-trades';
  const G = () => E.get('Game'), S = () => E.get('Game.S') || {};
  const D = () => E.get('Game.DEX') || {};
  const name = (id) => D()[id]?.name || '#' + id;
  let data = null, busy = false, err = null;
  let prefs = (() => { try { return JSON.parse(localStorage.getItem(PREF) || '{}'); } catch { return {}; } })();
  const savePrefs = () => { try { localStorage.setItem(PREF, JSON.stringify(prefs)); } catch (__e) { __h('61-trades:24', __e); } };
  let seen = (() => { try { return JSON.parse(localStorage.getItem(SEEN) || '{}'); } catch { return {}; } })();
  const refreshMs = () => +E.get('CONFIG')?.ONLINE_TRADE?.REFRESH_MS || 900_000;

  // The game's own board: it keeps the species list it last read in localStorage
  // ("pokecatch-trades-sp-<account>" = {at, species}) and re-reads it every REFRESH_MS while its Trades
  // screen is open. Mega follows that clock: when the game reads, Mega reads the offers right after;
  // when the game isn't on Trades, Mega reads on the same 15-min schedule so the two stay together.
  function gameBoard() {
    try {
      const uid = E.get('Cloud.user')?.id;
      let key = uid ? 'pokecatch-trades-sp-' + uid : null;
      if (!key || localStorage.getItem(key) == null) key = Object.keys(localStorage).find((k) => k.startsWith('pokecatch-trades-sp-')) || null;
      const v = key ? JSON.parse(localStorage.getItem(key) || 'null') : null;
      return v && +v.at ? { at: +v.at, species: Array.isArray(v.species) ? v.species : null } : null;
    } catch { return null; }
  }
  const regs = () => [...new Set((E.get('STORY.REGIONS') || []).filter((r) => r.open && r.dex).map((r) => r.key))];
  const owns = (id) => { try { return !!G().owns(+id); } catch { return false; } };

  // family helpers (for "you can breed it back")
  function preOf() {
    const map = {}, EV = E.get('EVOLUTIONS') || {};
    for (const [f, list] of Object.entries(EV)) for (const e of list || []) if (e && e.to != null && map[e.to] == null) map[e.to] = +f;
    return map;
  }
  // trading away your last one: does a family member you keep lay the family's egg in the Day Care?
  // (Game.canLay: any non-legendary family member lays the first form's egg; it then evolves back up)
  function breedBack(id, st) {
    const pre = preOf(), EV = E.get('EVOLUTIONS') || {};
    const rootOf = (x) => { let r = +x; while (pre[r] != null) r = pre[r]; return r; };
    const root = rootOf(id);
    const fam = []; const walk = (x) => { if (fam.includes(+x)) return; fam.push(+x); for (const e of EV[x] || []) walk(e.to); }; walk(root);
    for (const p of fam) {
      if (p === +id || rootOf(p) !== root || !(st.get(p + '') || st.get(p + 's'))) continue; // (Mothim lays plain Burmy)
      let ok = false; try { ok = !!G().canLay({ id: p }); } catch (__e) { __h('61-trades:59', __e); }
      if (ok) return { parent: p, egg: root };
    }
    return null;
  }

  // everything you own, and which copies the game would let you give
  function stock() {
    const s = S(), g = G(), now = Date.now();
    const wait = new Map((data?.state?.wait || []).map(([u, t]) => [u, +t]));
    const all = E.read('Game.allMons', null) || [...(s.mons || []), ...((s.pension?.mons || []).map((x) => x.mon).filter(Boolean))];
    const by = new Map();
    for (const m of all) {
      const k = m.id + (m.shiny ? 's' : '');
      let blk = null;
      try { blk = g.tradeBlock(m); } catch { blk = 'unknown'; }
      if (!blk && s.buddy?.uid === m.uid) blk = 'your buddy';
      if (!blk && (s.team || []).includes(m.uid)) blk = 'in your team';
      if (!blk && wait.get(m.uid) > now) blk = `too new to trade until ${DexInfo.clock(wait.get(m.uid))}`;
      if (blk && !(s.mons || []).includes(m)) blk = 'in the Day Care';
      const o = by.get(k) || { total: 0, free: [], blocked: [] };
      o.total++; (blk ? o.blocked : o.free).push(blk ? { m, why: String(blk) } : m);
      by.set(k, o);
    }
    for (const o of by.values()) o.free.sort((a, b) => a.level - b.level);
    return by;
  }

  // what you'd give for one offer
  function judge(off, st) {
    const shiny = !!off.give_shiny;
    if (!+off.want_id) { // "any shiny of the same rarity they don't have"
      const tier = (x) => { try { return G().tierIndex(x); } catch { return -1; } };
      const t = tier(off.give_id), have = off.have || [];
      const cands = [...st.entries()].filter(([k, o]) => k.endsWith('s') && o.free.length && !have.includes(parseInt(k, 10)) && tier(parseInt(k, 10)) === t);
      const dup = cands.find(([, o]) => o.total >= 2);
      if (dup) return { kind: 'spare', want: parseInt(dup[0], 10), shiny: true, give: dup[1].free[0], n: dup[1].total, any: true };
      if (cands.length) return { kind: 'last', want: parseInt(cands[0][0], 10), shiny: true, give: cands[0][1].free[0], n: 1, any: true };
      return { kind: 'none', want: 0, shiny: true, any: true };
    }
    const want = +off.want_id, o = st.get(want + (shiny ? 's' : ''));
    if (!o) return { kind: 'none', want, shiny, where: whereTo(want) };
    if (o.free.length && o.total >= 2) return { kind: 'spare', want, shiny, give: o.free[0], n: o.total };
    if (o.free.length) {
      return { kind: 'last', want, shiny, give: o.free[0], n: 1, back: breedBack(want, st) };
    }
    return { kind: 'busy', want, shiny, n: o.total, why: [...new Set(o.blocked.map((b) => b.why))].join(', ') };
  }
  const whereCache = new Map();
  function whereTo(id) {
    if (whereCache.has(id)) return whereCache.get(id);
    let t = ''; try { t = DexInfo.route(id)?.text || ''; } catch (__e) { __h('61-trades:110', __e); }
    whereCache.set(id, t);
    return t;
  }

  // what you'd actually end up with (trade evolutions: Haunter -> Gengar...)
  function arrives(id, shiny) {
    try { return +G().tradePreview(+id, !!shiny, null, null)?.id || +id; } catch { return +id; }
  }

  async function refresh(force = false) {
    if (busy) return;
    const gb = gameBoard();
    const due = () => {
      if (!data) return true;
      if (data.failed) return Date.now() - data.at > 120_000; // the board didn't answer: try again in 2 min
      if (gb && gb.at > (data.boardAt || 0) + 1000) return true; // the game just read its board
      const last = Math.max(data.at || 0, gb?.at || 0);
      return Date.now() >= last + refreshMs(); // its next read time
    };
    if (!force && !due()) return;
    if (!E.ready() || !E.get('Cloud.trades')) return;
    busy = true; err = null;
    try {
      whereCache.clear();
      const R = regs(), st0 = stock();
      const can = [], shy = [];
      for (const [k, o] of st0) if (o.free.length) (k.endsWith('s') ? shy : can).push(parseInt(k, 10));
      // the game's fresh list if it's newer than ours, else read it ourselves (same call the game makes)
      const useGame = !force && gb?.species && gb.at > (data?.boardAt || 0) + 1000 && Date.now() - gb.at < refreshMs();
      const [sp, state, mine] = await Promise.all([
        useGame ? Promise.resolve({ data: gb.species }) : E.call('Cloud.trades.species', R, [...new Set(can)], [...new Set(shy)]),
        E.call('Cloud.trades.state').catch(() => ({ data: null })),
        E.call('Cloud.trades.mine').catch(() => ({ data: null })),
      ]);
      if (sp?.error) throw new Error(sp.error.message || 'the trade board did not answer');
      data = { ...(data || {}), state: state?.data || null };
      const st = stock(); // again, now with the "too new" list
      const rows = (sp.data || []).map(([id, shiny, offers, canDo]) => ({ id: +id, shiny: !!shiny, offers: +offers || 0, canDo: +canDo || 0 }));
      const targets = [];
      for (const r of rows) {
        if (r.shiny && !prefs.shiny) continue;
        const to = arrives(r.id, r.shiny);
        const newGet = !owns(r.id), newTo = to !== r.id && !owns(to);
        if (newGet || newTo) targets.push({ ...r, to, newGet, newTo });
      }
      for (const t of targets) {
        const res = await E.call('Cloud.trades.offers', R, t.id, t.shiny).catch(() => ({ data: [] }));
        t.list = (res?.data || []).map((off) => ({
          tid: off.id, who: off.owner_name || '?', lv: off.give_mon?.level ?? null, egg: !!off.give_mon?.egg,
          until: Date.parse(off.expires_at) || 0, want: +off.want_id || 0, j: judge(off, st),
        }));
        for (const x of t.list) { // accepting costs a fee (by rarity, more for shinies), paid from that region's wallet
          const m = x.j.give || (x.j.want ? { id: x.j.want, shiny: x.j.shiny } : null);
          try { x.fee = m ? +G().tradeFee(m) || 0 : 0; } catch { x.fee = 0; }
        }
        const rank = { spare: 0, last: 1, busy: 2, none: 3 };
        t.list.sort((a, b) => rank[a.j.kind] - rank[b.j.kind] || a.until - b.until);
        t.best = t.list[0]?.j.kind || 'none';
        t.can = t.list.filter((x) => x.j.kind === 'spare' || x.j.kind === 'last').length; // you have a free one to give
        t.canSpare = t.list.filter((x) => x.j.kind === 'spare').length;
      }
      const rk = { spare: 0, last: 1, busy: 2, none: 3 };
      targets.sort((a, b) => rk[a.best] - rk[b.best] || (b.newGet + b.newTo) - (a.newGet + a.newTo) || name(a.id).localeCompare(name(b.id)));
      data = { at: Date.now(), boardAt: useGame ? gb.at : Date.now(), fromGame: !!useGame, state: data.state, mine: mine?.data || null, targets, boardSize: rows.length };
      alerts();
    } catch (e) { err = e?.message || String(e); if (!data) data = { at: Date.now(), targets: [], failed: true }; else data.at = Date.now() - refreshMs() + 120_000; }
    finally { busy = false; }
  }

  function alerts() {
    const now = Date.now();
    for (const [k, u] of Object.entries(seen)) if (u < now) delete seen[k];
    for (const t of data.targets) for (const o of t.list || []) {
      if (o.j.kind !== 'spare' || seen[o.tid]) continue;
      seen[o.tid] = o.until || now + 3 * 86_400_000;
      const what = t.newGet ? name(t.id) : `${name(t.id)} (evolves into ${name(t.to)})`;
      Notify.send('trade', `Trade for ${what}${t.shiny ? ' (shiny)' : ''}`, `${o.who} wants ${o.j.any ? 'a shiny ' : ''}${name(o.j.want)} - you have ${o.j.n}, give your Lv ${o.j.give.level}. Offer ends ${DexInfo.clock(o.until)}.`);
      Log.add(`trade board: ${what} for a spare ${name(o.j.want)} (${o.who})`);
    }
    try { localStorage.setItem(SEEN, JSON.stringify(seen)); } catch (__e) { __h('61-trades:190', __e); }
  }

  // ---- open an offer on the game's own Trades screen ----
  // Switches the game to Trades, picks Normal / Shiny, opens the Pokémon's offer list and highlights the
  // offer. It stops there: tapping the offer starts the game's accept flow, and that stays Jimmy's tap.
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function until(fn, ms = 8000) { const t0 = Date.now(); for (;;) { const v = fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await sleep(150); } }
  const vis = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  let opening = null;
  async function openInGame(id, shiny, who, want) {
    if (opening) return opening;
    opening = (async () => {
      const scr = () => document.querySelector('#screen-trade');
      if (!scr()?.classList.contains('active')) { try { E.call('App.show', 'trade'); } catch { return 'the game would not open its Trades screen'; } }
      if (!await until(() => scr()?.classList.contains('active') && scr().querySelector('.ot-cell.ot-sp'))) return 'the Trades screen did not load';
      // Normal / Shiny switch
      const tog = [...scr().querySelectorAll('button')].find((b) => vis(b) && b.textContent.trim().toLowerCase() === (shiny ? 'shiny' : 'normal'));
      if (tog && !tog.classList.contains('on')) { tog.click(); await sleep(600); }
      const cell = await until(() => [...scr().querySelectorAll('.ot-cell.ot-sp')].find((c) => c.querySelector(`img[data-id="${+id}"]`)), 5000);
      if (!cell) return `${name(id)} isn't on the board any more`;
      const list = () => [...document.querySelectorAll('.ot-dr-list .ot-tile')].filter(vis);
      const mine = () => list().filter((t) => t.querySelector('.ot-box.get img')?.dataset.id === String(+id));
      if (!cell.classList.contains('on') || !mine().length) { cell.click(); await sleep(300); }
      if (!await until(() => mine().length)) { cell.scrollIntoView({ block: 'center' }); return `opened ${name(id)} - its offers are still loading`; }
      const key = (x) => String(x || '').replace(/\s+/g, '').toLowerCase();
      const tile = who ? mine().find((t) => key(t.querySelector('.ot-who')?.textContent) === key(who) && (!+want || t.querySelector('.ot-box.give img')?.dataset.id === String(+want))) : null;
      for (const t of document.querySelectorAll('.mega-pick')) { t.classList.remove('mega-pick'); t.querySelector('.mega-pick-tag')?.remove(); }
      if (!document.getElementById('mega-pick-css')) {
        const c = document.createElement('style'); c.id = 'mega-pick-css';
        c.textContent = `.mega-pick{outline:4px solid var(--gold) !important;outline-offset:2px;box-shadow:0 0 0 8px color-mix(in srgb,var(--gold) 33%,transparent),0 0 24px var(--gold) !important;animation:megaPick 1.2s ease-in-out 6}
          @keyframes megaPick{50%{box-shadow:0 0 0 14px color-mix(in srgb,var(--gold) 13%,transparent),0 0 34px var(--gold)}}
          .mega-pick-tag{position:absolute;left:50%;top:-12px;transform:translateX(-50%);z-index:5;background:var(--gold);color:var(--on-gold);font:800 12px/1 Inter,system-ui,sans-serif;padding:4px 10px;border-radius:99px;white-space:nowrap;pointer-events:none}`;
        document.head.appendChild(c);
      }
      if (!tile) { mine()[0]?.scrollIntoView({ block: 'center' }); return who ? `opened ${name(id)} - that offer is gone, here are the others` : `opened ${name(id)}`; }
      tile.classList.add('mega-pick'); tile.style.position ||= 'relative';
      const tag = document.createElement('div'); tag.className = 'mega-pick-tag'; tag.textContent = 'Mega: this one - tap to view'; tile.appendChild(tag);
      tile.scrollIntoView({ block: 'center', behavior: 'smooth' });
      setTimeout(() => { tile.classList.remove('mega-pick'); tag.remove(); }, 60_000);
      return 'opened - tap the highlighted offer in the game';
    })();
    try { return await opening; } finally { opening = null; }
  }

  // ---- trading from Kinesis: only when Jimmy taps it on his phone and confirms there ----------------
  // Mega never trades on its own: no plan or goal calls these. Mega drives the game's own Trades screen
  // (the taps Jimmy would make), so the game does its own checks, fee, cloud save and roll-back. Before
  // the final tap it reads the game's confirmation and compares it with what Jimmy approved; if anything
  // differs (another Pokémon, another level, another fee) it closes the dialog and nothing is traded.
  const modal = () => { const ms = [...document.querySelectorAll('.modal')].filter(vis); return ms[ms.length - 1] || null; };
  const txt = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim();
  const money = (n) => (+n || 0).toLocaleString('en-US');
  async function closeAll() { for (let i = 0; i < 5; i++) { const d = modal(); if (!d) break; (d.querySelector('.btn.ghost') && /cancel|back/i.test(txt(d.querySelector('.btn.ghost'))) && !d.classList.contains('ot-pickdlg') ? d.querySelector('.btn.ghost') : d.querySelector('.dc-x'))?.click(); await sleep(450); } const mvd = document.querySelector('.mvd'); if (vis(mvd)) { mvd.querySelector('.dc-x')?.click(); await sleep(300); } }
  let tradeBusy = false;
  function giveOptions(off) { // which of your Pokémon can pay for an offer (the game's rule: the species it wants, free to trade)
    const S0 = E.get('Game.S') || {}, away = new Set((E.read('Game.underMons', []) || []).map((m) => m.uid));
    return (S0.mons || []).filter((m) => +m.id === +off.want && !!m.shiny === !!off.shiny && !away.has(m.uid) && !(() => { try { return G().tradeBlock(m); } catch { return 'x'; } })()).sort((a, b) => a.level - b.level);
  }
  // the offers for one species, with what you'd give and pay
  function offersFor(id, shiny) {
    const t = (data?.targets || []).find((x) => +x.id === +id && !!x.shiny === !!shiny); if (!t) return null;
    const S0 = E.get('Game.S') || {};
    return { id: +id, shiny: !!shiny, to: t.to, newGet: t.newGet, newTo: t.newTo, list: (t.list || []).map((x) => {
      const opts = giveOptions({ want: x.want, shiny: x.j?.shiny });
      return { tid: x.tid, who: x.who, lv: x.lv, egg: x.egg, until: x.until, want: x.want, kind: x.j?.kind, fee: x.fee || 0,
        give: opts.map((m) => ({ uid: m.uid, id: +m.id, lv: +m.level, shiny: !!m.shiny, rank: +(m.rank || 0), team: (S0.team || []).includes(m.uid) })) };
    }) };
  }
  async function accept({ id, shiny, tid, who, want, give, fee, dry = false }) {
    if (tradeBusy) return 'error: another trade is running';
    tradeBusy = true;
    const S0 = () => E.get('Game.S') || {}, prev = E.get('App')?.current || 'adventure';
    const fail = async (why) => { await closeAll(); try { E.call('App.show', prev); } catch (__e) { __h('61-trades:263', __e); } return 'not traded - ' + why; };
    try {
      if (S0().tradeIn) return 'not traded - a trade is already waiting in the game (finish it there first)';
      const m = (S0().mons || []).find((x) => x.uid === give); if (!m) return 'not traded - that Pokémon is not in your PC any more';
      const block = (() => { try { return G().tradeBlock(m); } catch { return null; } })(); if (block) return 'not traded - ' + block;
      const giveName = name(m.id), lv = +m.level, money0 = +S0().money || 0;
      const opened = await openInGame(id, shiny, who, want);
      const tile = document.querySelector('.ot-tile.mega-pick');
      if (!tile) return await fail(/here are the others/.test(opened) ? `the game's offer list hasn't caught up with ${who}'s offer yet (it refreshes about every 15 min) - try again in a few minutes, or pick another offer` : opened);
      tile.querySelector('.mega-pick-tag')?.remove(); tile.classList.remove('mega-pick');
      tile.click();
      // the game's steps: maybe "which one to give", maybe a shiny check, then its confirmation
      let confirmed = false;
      for (let step = 0; step < 4 && !confirmed; step++) {
        const d = await until(() => { const x = modal(); return x && !x.classList.contains('mvd') ? x : null; }, 8000);
        if (!d) return await fail('the game did not show its trade dialog');
        const t = txt(d);
        if (d.classList.contains('ot-pickdlg')) { // choose the one you picked on the phone
          const b = [...d.querySelectorAll('button.ot-cell')].find((x) => x.querySelector('img')?.dataset.id === String(m.id) && new RegExp(`Lv\\.?\\s*${lv}(?!\\d)`).test(txt(x)));
          if (!b) return await fail(`the game did not offer your ${giveName} Lv ${lv} for this trade`);
          b.click(); await sleep(900); continue;
        }
        const primary = d.querySelector('.btn.primary');
        if (/trade fee|fee/i.test(t) && primary && /trade/i.test(txt(primary))) {
          // the game's own confirmation: must match what Jimmy approved
          if (!new RegExp(`give your ${giveName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} Lv\\. ${lv}(?!\\d)`, 'i').test(t)) return await fail(`the game wanted to give a different Pokémon (${(t.match(/give your ([^.]+Lv\. \d+)/i) || [])[1] || '?'})`);
          const feeTxt = (t.match(/Trade fee\s*([\d,]+|None)/i) || [])[1] || '';
          const gameFee = /none/i.test(feeTxt) ? 0 : +feeTxt.replace(/,/g, '');
          if (gameFee !== +fee) return await fail(`the fee is ₽${money(gameFee)}, not ₽${money(fee)}`);
          if (/you're missing|you are missing|missing/i.test(t)) return await fail('not enough money for the fee');
          if (dry) { await closeAll(); try { E.call('App.show', prev); } catch (__e) { __h('61-trades:293', __e); } return `dry run ok - the game's confirmation matched (give ${giveName} Lv ${lv}, fee ₽${money(gameFee)}); nothing was traded`; }
          primary.click(); confirmed = true; break;
        }
        if (/shiny/i.test(t) && primary && m.shiny) { primary.click(); await sleep(900); continue; } // the game's "you're giving a shiny" check - approved on the phone
        return await fail('the game showed an unexpected dialog: ' + t.slice(0, 80));
      }
      if (!confirmed) return await fail('the game did not get to its confirmation');
      // did it go through? the game takes the fee and sends your Pokémon
      const done = await until(() => { const s = S0(); return (+s.money < money0 || s.tradeIn || !(s.mons || []).some((x) => x.uid === give)) ? true : null; }, 20000);
      await sleep(1500);
      const msg = txt(modal());
      await closeAll(); try { E.call('App.show', prev); } catch (__e) { __h('61-trades:304', __e); }
      try { E.call('Game.save'); } catch (__e) { __h('61-trades:305', __e); }
      refresh(true);
      if (!done) return `sent to the game - no result yet${msg ? ' (' + msg.slice(0, 80) + ')' : ''}; check the Trades screen on the PC`;
      Log.add(`phone: traded your ${giveName} Lv ${lv} to ${who} for ${shiny ? 'a shiny ' : ''}${name(id)} (fee ₽${money(fee)})`);
      return `traded: your ${giveName} Lv ${lv} for ${shiny ? 'a shiny ' : ''}${name(id)} from ${who}${S0().tradeIn ? ' - the game is finishing it' : ''}`;
    } catch (e) { return await fail('error: ' + (e?.message || e)); }
    finally { tradeBusy = false; }
  }
  // post your own offer: you want `want`, you give your Pokémon `give` (same rarity, the game's rule)
  function postOptions(want) {
    const tier = (id) => { try { return G().tierIndex(+id); } catch { return null; } };
    const S0 = E.get('Game.S') || {}, away = new Set((E.read('Game.underMons', []) || []).map((m) => m.uid)), t = tier(want);
    return (S0.mons || []).filter((m) => !m.shiny && tier(m.id) === t && !away.has(m.uid) && !(() => { try { return G().tradeBlock(m); } catch { return 'x'; } })())
      .sort((a, b) => a.level - b.level).map((m) => ({ uid: m.uid, id: +m.id, lv: +m.level, rank: +(m.rank || 0), team: (S0.team || []).includes(m.uid) }));
  }
  async function post({ want, give, friends, dry = false }) {
    if (tradeBusy) return 'error: another trade is running';
    tradeBusy = true;
    const S0 = () => E.get('Game.S') || {}, prev = E.get('App')?.current || 'adventure';
    const fail = async (why) => { await closeAll(); try { E.call('App.show', prev); } catch (__e) { __h('61-trades:324', __e); } return 'not posted - ' + why; };
    try {
      if (S0().tradeOut) return 'not posted - you already have an offer posted (one at a time)';
      const m = (S0().mons || []).find((x) => x.uid === give); if (!m) return 'not posted - that Pokémon is not in your PC any more';
      const giveName = name(m.id), lv = +m.level;
      try { E.call('App.show', 'trade'); } catch { return 'not posted - the game would not open its Trades screen'; }
      const add = await until(() => { const b = document.querySelector('#screen-trade .ot-box.get.add'); return vis(b) ? b : null; }, 6000);
      if (!add) return await fail('the "create your trade offer" box is not there');
      add.click();
      // step 1: the wanted species
      let d = await until(() => { const x = modal(); return x?.classList.contains('ot-pickdlg') ? x : null; }, 6000);
      if (!d) return await fail('the species list did not open');
      const findSp = () => [...modal().querySelectorAll('button.ot-cell')].find((b) => b.querySelector('img')?.dataset.id === String(+want));
      let b = findSp();
      if (!b) { const inp = d.querySelector('input'); if (inp) { inp.value = name(want); inp.dispatchEvent(new Event('input', { bubbles: true })); await sleep(600); b = findSp(); } }
      if (!b) return await fail(`${name(want)} can't be asked for in a trade`);
      b.click(); await sleep(900);
      // step 2: your Pokémon (same rarity)
      d = await until(() => { const x = modal(); return x?.classList.contains('ot-pickdlg') && /step 2/i.test(txt(x)) ? x : null; }, 6000);
      if (!d) return await fail('the "your Pokémon" list did not open');
      const mine = [...d.querySelectorAll('button.ot-cell')].find((x) => x.querySelector('img')?.dataset.id === String(m.id) && new RegExp(`Lv\\.?\\s*${lv}(?!\\d)`).test(txt(x)));
      if (!mine) return await fail(`the game did not offer your ${giveName} Lv ${lv} (it must be the same rarity as ${name(want)})`);
      mine.click(); await sleep(900);
      // the game's confirmation: must name your Pokémon
      d = await until(() => { const x = modal(); return x && !x.classList.contains('ot-pickdlg') && x.querySelector('.btn.primary') ? x : null; }, 6000);
      if (!d) return await fail('the game did not show its confirmation');
      const t = txt(d);
      if (!new RegExp(`${giveName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} leaves your`, 'i').test(t)) return await fail('the game wanted to post a different Pokémon');
      if (dry) { await closeAll(); try { E.call('App.show', prev); } catch (__e) { __h('61-trades:352', __e); } return `dry run ok - the game's confirmation named your ${giveName} Lv ${lv}; nothing was posted`; }
      if (friends) { const fo = [...d.querySelectorAll('label, button, input')].find((x) => /friends only/i.test(txt(x.closest('label') || x))); fo?.click(); await sleep(300); }
      d.querySelector('.btn.primary').click();
      const ok = await until(() => (S0().tradeOut ? true : null), 15000);
      await sleep(800); await closeAll(); try { E.call('App.show', prev); } catch (__e) { __h('61-trades:356', __e); }
      refresh(true);
      if (!ok) return 'sent to the game - no result yet; check the Trades screen on the PC';
      Log.add(`phone: posted a trade - your ${giveName} Lv ${lv} for ${name(want)}${friends ? ' (friends only)' : ''}`);
      return `posted: your ${giveName} Lv ${lv} for ${name(want)} - it's out of your PC while the offer is live`;
    } catch (e) { return await fail('error: ' + (e?.message || e)); }
    finally { tradeBusy = false; }
  }
  function myOffer() { const S0 = E.get('Game.S') || {}; const o = S0.tradeOut; if (!o) return null; return { give: o.mon ? { id: +o.mon.id, lv: +o.mon.level, shiny: !!o.mon.shiny } : null, want: +(o.want || 0), until: +(o.expires || 0), live: !!o.id }; }

  let timer = null;
  function boot() { if (timer) return; setTimeout(() => refresh(), 20_000); timer = setInterval(() => refresh(), 5_000); } // cheap check; reads only when the game did or its time came

  return {
    boot, refresh,
    get data() { return data; }, get busy() { return busy; }, get err() { return err; },
    get prefs() { return prefs; },
    openMsg: '', pick: null,
    setShiny(v) { prefs.shiny = !!v; savePrefs(); refresh(true); },
    name, refreshMs, openInGame, gameAt: () => gameBoard()?.at || 0,
    offersFor, accept, postOptions, post, myOffer,
  };
})();

Views.trades = (esc) => {
  const d = Trades.data, nm = (id) => esc(Trades.name(id)), sp = (id) => `<img src="${Engine.sprite(id)}" width="56" height="56" style="image-rendering:pixelated;background:var(--well);border-radius:12px;flex:none">`;
  const ago = (t) => { const m = Math.round((Date.now() - t) / 60_000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`; };
  let o = `<div class="card"><h3>Trade Board</h3>
    <div class="dim">Pokémon you don't own on the board. Tap one for its offers.</div>
    <div style="margin-top:8px">${Trades.busy ? 'Reading the board…' : d ? `Updated ${ago(d.at)}${d.fromGame ? ' with the game' : ''} · next with the game at ${DexInfo.clock(Math.max(d.boardAt || 0, Trades.gameAt() || 0) + Trades.refreshMs())}` : 'Not read yet'}${Trades.err ? ` <span class="bad">· ${esc(Trades.err)}</span>` : ''}</div>
    ${Trades.openMsg ? `<div class="note" style="margin-top:8px">${esc(Trades.openMsg)}</div>` : ''}
    <button class="btn" data-act="tr-refresh" ${Trades.busy ? 'disabled' : ''}>Refresh Now</button>
    <label class="chk"><input type="checkbox" data-act="tr-shiny" ${Trades.prefs.shiny ? 'checked' : ''}> Include shiny offers</label></div>`;
  if (!d || d.failed) return o;
  const st = d.state, mine = d.mine;
  if (mine && mine.give_id) o += `<div class="card"><h3>Your Offer</h3><div style="display:flex;gap:12px;align-items:center">${sp(mine.give_id)}<div>You give <b>${nm(mine.give_id)}</b>${mine.give_mon?.level ? ` Lv ${mine.give_mon.level}` : ''} for <b>${+mine.want_id ? nm(mine.want_id) : 'any shiny'}</b><div class="dim">${mine.status ? esc(mine.status) + ' · ' : ''}ends ${DexInfo.clock(Date.parse(mine.expires_at))}${mine.taker_name ? ` · taken by ${esc(mine.taker_name)}` : ''}</div></div></div></div>`;
  const T = d.targets || [], c = (k) => T.filter((t) => t.best === k).length;
  o += `<div class="card"><div><b>${T.length}</b> Pokémon you're missing are on the board${T.length ? `: <span class="ok">${c('spare')} with a spare</span> · <span class="warn">${c('last')} only with your last one</span> · ${c('busy')} in use · ${c('none')} you don't have what they want` : ''}.</div>
    ${st?.wait?.length ? `<div class="dim" style="margin-top:4px">${st.wait.filter(([, t]) => t > Date.now()).length} of your Pokémon are too new to trade for now.</div>` : ''}</div>`;
  const BADGE = {
    spare: (j) => `<span class="ok">✓ Spare: you have ${j.n} ${j.any ? 'shiny ' : ''}${nm(j.want)}</span> · give your Lv ${j.give.level}`,
    last: (j) => `<span class="warn">⚠ Your only ${j.any ? 'shiny ' : ''}${nm(j.want)}</span> - your Pokédex entry goes back to "seen"${j.back ? `<div class="dim">You could get it back: your ${nm(j.back.parent)} lays ${nm(j.back.egg)} eggs in the Day Care${j.back.egg !== j.want ? `, then evolve it to ${nm(j.want)}` : ''}.</div>` : ''}`,
    busy: (j) => `<span class="warn">In use:</span> your ${nm(j.want)} ${esc(j.why)}`,
    none: (j) => j.any ? `<span class="bad">✗</span> wants a shiny of the same rarity you don't have spare` : `<span class="bad">✗ You don't have ${nm(j.want)}</span>${j.where ? `<div class="dim">${esc(j.where)}</div>` : ''}`,
  };
  // the list: one tile per Pokémon (picture, offers, NEW, best deal) - tap one for its offers
  const open = Trades.pick && T.find((t) => t.id === Trades.pick.id && t.shiny === Trades.pick.shiny);
  if (!open) {
    const TAG = { spare: ['ok', '✓ spare'], last: ['warn', 'your last'], busy: ['warn', 'in use'], none: ['dim', 'need it'] };
    if (T.length) o += `<div class="grid">${T.map((t) => { const [cls, txt] = TAG[t.best] || TAG.none; return `<div class="mon" data-act="tr-pick" data-id="${t.id}" data-shiny="${t.shiny ? 1 : ''}" style="cursor:pointer;${t.best === 'spare' ? 'border-color:var(--ok)' : ''}">
      <img src="${Engine.sprite(t.id)}" loading="lazy">${t.shiny ? '✨' : ''}${nm(t.id)}
      <div style="font-size:var(--t-s)">${(t.list || []).length} offer${(t.list || []).length === 1 ? '' : 's'}</div>
      <div style="font-size:var(--t-s)"><span class="${t.can ? 'ok' : 'dim'}">${t.can} can do</span> · <span class="dim">${(t.list || []).length - t.can} can't</span></div>
      ${t.newGet ? '<div class="ok" style="font-size:var(--t-s);font-weight:800">NEW</div>' : t.newTo ? `<div class="ok" style="font-size:var(--t-s)">→ ${nm(t.to)} NEW</div>` : ''}
      <div class="${cls}" style="font-size:var(--t-s)">${txt}</div></div>`; }).join('')}</div>`;
    return o;
  }
  // one Pokémon: every offer
  const t = open;
  o = `<button class="btn sm" data-act="tr-back" style="margin:0 0 10px">‹ Back to all trades</button>
    ${Trades.openMsg ? `<div class="note" style="margin-bottom:8px">${esc(Trades.openMsg)}</div>` : ''}
    <div class="card"><div style="display:flex;gap:12px;align-items:center">${sp(t.id)}<div style="flex:1">
    <div style="font-size:18px;font-weight:800">${t.shiny ? '✨ ' : ''}${nm(t.id)}</div>
    <div>${t.newGet ? '<span class="ok">New for your Pokédex</span>' : ''}${t.newTo ? `${t.newGet ? ' · ' : ''}<span class="ok">evolves into ${nm(t.to)} when it arrives (new!)</span>` : ''}</div>
    <div>${(t.list || []).length} offer${(t.list || []).length === 1 ? '' : 's'} · <span class="${t.can ? 'ok' : 'dim'}">${t.can} you can do</span>${t.can ? ` <span class="dim">(${t.canSpare} with a spare)</span>` : ''} · <span class="dim">${(t.list || []).length - t.can} you can't</span></div>
    <div class="dim">checked ${ago(d.at)}</div></div></div>
    <button class="btn" data-act="tr-open" data-id="${t.id}" data-shiny="${t.shiny ? 1 : ''}">Open All in Game</button>
    <button class="btn" data-act="dexinfo" data-id="${t.newGet ? t.id : t.to}">Pokédex Page</button></div>`;
  for (const x of t.list || []) {
    o += `<div class="card" style="${x.j.kind === 'spare' ? 'border-color:var(--ok)' : ''}">
      <div><b>${esc(x.who)}</b> wants <b>${x.want ? nm(x.want) : 'any shiny of the same rarity'}</b></div>
      <div class="dim">Theirs is Lv ${x.lv ?? '?'}${x.egg ? ' (from an egg)' : ''} · ends ${DexInfo.clock(x.until)}${x.fee ? ` · ₽${x.fee.toLocaleString()} to accept` : ''}</div>
      <div style="margin-top:4px">${BADGE[x.j.kind](x.j)}</div>
      <button class="btn${x.j.kind === 'spare' ? ' gold' : ''}" data-act="tr-open" data-id="${t.id}" data-shiny="${t.shiny ? 1 : ''}" data-who="${esc(x.who)}" data-want="${x.want}">Open in Game</button></div>`;
  }
  if (!(t.list || []).length) o += `<div class="note">No offers left for ${nm(t.id)} - they may have been taken.</div>`;
  return o;
};

/* ---------------------------------------------------------------------------------------------
 * Now tab: the screen Jimmy leaves up and checks from his phone after a few hours. One look should
 * answer: is it running, what is it doing this minute and how far along, what's next, did anything
 * need me, what happened while I was away, and how today's dailies / trades / Pokédex stand.
 * Re-rendered every 2 s with the panel; the heavier bits (Pokédex counts) are cached for 30 s.
 * ------------------------------------------------------------------------------------------- */
// shiny eggs coming (EggPredict, the game's own egg math): the next few with when they'd be laid
function eggForecast(dc, nm, at2) {
  try {
    const U = EggPredict.upcoming(400), per = (+Engine.get('CONFIG')?.PENSION?.EGG_MIN || 240) * 60_000;
    const when = (a) => (dc.nextEgg != null ? at2(Date.now() + dc.nextEgg + a * per) : null);
    const line = (r, what) => `<div style="margin:4px 0">Egg <b>#${r.k}</b> <span class="dim">(${r.ahead === 0 ? 'the next one' : r.ahead + ' after the next'}${when(r.ahead) ? ', about ' + when(r.ahead) : ''})</span>: ${what}</div>`;
    const now = U.rows.filter((r) => r.now).slice(0, 3), berry = U.rows.filter((r) => r.berry && !r.now).slice(0, 3), par = U.rows.filter((r) => r.needShinyParent && !r.parentShiny).slice(0, 2);
    let h = `<div style="margin-top:10px;border-top:1px solid var(--line);padding-top:8px"><b>✨ Shiny eggs coming</b> <span class="dim">· the next egg is #${U.next}${U.berryOn ? ' · a Belue Berry is active for it' : ''}</span>`;
    if (!U.layers.length) return h + `<div class="dim">Nobody in the Day Care can lay an egg right now.</div></div>`;
    h += now.map((r) => line(r, `<b class="gold">shiny</b> as things are${r.parent ? ` (from ${nm(r.parent)}${r.parentShiny ? ' ✨' : ''})` : ''}`)).join('');
    h += berry.map((r) => line(r, `shiny <b>with a Belue Berry</b> used ${r.k === U.next ? 'now' : `right after egg #${r.k - 1} is laid`}${r.parent ? ` (from ${nm(r.parent)}${r.parentShiny ? ' ✨' : ''})` : ''}`)).join('');
    h += par.map((r) => line(r, `shiny only from a shiny parent (with a Belue Berry) - it would come from ${nm(r.parent)} as things are`)).join('');
    if (!now.length && !berry.length) h += `<div class="dim">None in the next 400 eggs with these parents.</div>`;
    return h + `<div class="dim" style="font-size:var(--t-s);margin-top:4px">Exact, from the game's own egg numbers. The parent changes if you change who's in the Day Care; a full incubator holds up laying, so the times move.</div></div>`;
  } catch { return ''; }
}
// Best next rewards (Jimmy 2026-11-23, the Now overview): the easiest Elite legendary and Elite League tiers already
// simulated (never starts a sim here - those run from Simulate), gems ready to rank up, and shop gems your picks want.
function nowRewards() {
  const E = Engine, D = E.get('Game.DEX') || {}, out = { tiers: [], ready: [], shop: [] };
  const nm = (id) => Casing.names(D[id]?.name || '#' + id);
  try {
    for (const r of EliteInfo.elite().rows || []) { if (!r.next || !r.open || !r.can) continue; const s = EliteSim.legendFresh(r.id, r.next); if (s) out.tiers.push({ what: `${nm(r.foe)} · Elite tier ${r.next}`, pct: s.ko, reward: r.reward === 'gem' ? `${EliteInfo.gemLabel(r.gem)} gem` : 'a frame', go: 'elite', key: `e${r.id}`, id: +r.id, queued: Plan.goals.some((g) => !g.done && g.type === 'elite' && +g.foe === +r.id) }); }
  } catch (__e) { __h('62-nowview:30', __e); }
  try {
    const lz = E.get('LegendZones');
    for (const r of E.get('STORY.REGIONS') || []) { if (!r?.key || !lz.leagueOpen(r.key)) continue; const t = +lz.leagueNext(r.key); if (!t) continue; const s = EliteSim.leagueFresh(r.key, t); if (s) out.tiers.push({ what: `${r.key[0].toUpperCase() + r.key.slice(1)} Elite League · tier ${t}`, pct: s.ko, reward: `Legendary gem${E.get('CONFIG')?.ELITE?.LEAGUE?.FRAMES?.includes(t) ? ' + frame' : ''}`, go: 'league', key: `g${r.key}`, reg: r.key, queued: Plan.goals.some((g) => !g.done && g.type === 'league' && g.reg === r.key) }); }
  } catch (__e) { __h('62-nowview:34', __e); }
  out.tiers.sort((a, b) => b.pct - a.pct);
  try { out.ready = (EliteInfo.gems().top || []).map((c) => ({ name: nm(c.m.id), next: c.next, label: c.label })); } catch (__e) { __h('62-nowview:36', __e); }
  try { out.shop = (GemFocus.shopHits() || []).map((x) => ({ label: x.label, price: x.price, ok: x.ok, mons: x.mons })); } catch (__e) { __h('62-nowview:37', __e); }
  return out;
}
Views.now = (w, esc, fmtIn) => {
  if (!w.ok) return `<div class="note">The game engine isn't reachable, so Mega Alakazam can't show anything yet. See the Settings tab.</div>`;
  const E = Engine, S = E.get('Game.S') || {}, D = E.get('Game.DEX') || {};
  const nm = (id) => esc(D[id]?.name || '#' + id);
  const row = (k, v) => `<div class="row"><span class="k">${k}</span><span class="v">${v}</span></div>`;
  const ago = (t) => { if (!t || !isFinite(+t)) return 'not yet'; const m = Math.round((Date.now() - t) / 60_000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.floor(m / 60)} h ${m % 60 ? (m % 60) + ' min ' : ''}ago` : `${Math.round(m / 1440)} days ago`; };
  const at = (t) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const bar = (p) => `<div class="bar" style="margin-top:8px"><i style="width:${Math.max(0, Math.min(100, p * 100)).toFixed(1)}%"></i></div>`;
  const icon = (g) => ({ train: '📈', bloc: '🍡', under: '⛏️', region: '📘', candy: '🍬', tower: '🗼', raid: '✨', money: '💰', souls: '👻', loot: '🎁', breed: '🥚', level: '⬆️', elite: '🏆', league: '🎖️', wboss: '🌍', shinyWild: '✨', shinyBreed: '✨' }[g.type] || '🎯');
  const pic = (g, size = 52) => { const sp = GoalTypes[g.type]?.sprite?.(g); return sp ? `<img src="${E.sprite(sp)}" width="${size}" height="${size}" style="image-rendering:pixelated;flex:none;background:var(--well);border-radius:12px">` : `<span style="width:${size}px;text-align:center;font-size:${Math.round(size * 0.55)}px;flex:none">${icon(g)}</span>`; };
  // progress: the goal's own numbers if it has them, else "x/y" read from its status line
  const prog = (g, L) => {
    const pc = (Views.__nowProg ||= new Map()), c = pc.get(g.id);
    let p = null;
    if (c && Date.now() - c.at < 10_000) p = c.p; // some counts scan the whole region: not every 2 s
    else { try { p = GoalTypes[g.type]?.progress?.(g) || null; } catch (__e) { __h('62-nowview:55', __e); } pc.set(g.id, { at: Date.now(), p }); }
    if (!p) { const m = /(?<!stop\s*)(?<![\d,])₽?([\d,]+)\s*(?:\/|of)\s*₽?([\d,]+)/i.exec(L?.line || L?.why || ''); /* not "stop 21/50" */ if (m) { const a = +m[1].replace(/,/g, ''), b = +m[2].replace(/,/g, ''); if (b > 0 && a <= b) p = { have: a, need: b }; } }
    return p;
  };
  const goals = Plan.goals, open = goals.filter((g) => !g.done), live = (g) => Plan.live(g.id) || {};
  let h = '';
  // team check: who's fighting and the simulated chance (when the goal has one)
  const teamLine = (T) => {
    if (!T || (!T.uids?.length && !T.how)) return '';
    if (!T.uids?.length) return `<div class="dim" style="margin-top:6px;font-size:var(--t-s)">🛡️ ${esc(T.how)}</div>`;
    const names = T.uids.map((u) => { const m = Engine.read('Game.getMon', null, u); return m ? `${esc(Engine.get('Game.DEX')?.[m.id]?.name || '?')} ${m.level}` : null; }).filter(Boolean);
    const pct = T.win != null ? ` · <b class="${T.win >= 0.6 ? 'ok' : T.win >= 0.3 ? 'warn' : 'bad'}">${Math.round(T.win * 100)}%</b>` : '';
    return `<div class="dim" style="margin-top:6px;font-size:var(--t-s)">🛡️ Team: ${names.join(', ')}${pct}${T.how ? ` <span class="dim">(${esc(T.how)})</span>` : ''}</div>`;
  };

  // ---- 1. status line + needs-you ----
  const problems = [];
  if (Plan.oldOn()) problems.push('Alakazam 4.x is switched on, so the plan can\'t act (Plan tab → Switch 4.x off).');
  for (const g of open) { const L = live(g); if (/error|could not|refused|zone 3 times|did not|stuck/i.test((L.why || '') + ' ' + (L.line || ''))) problems.push(`${esc(Plan.label(g))}: ${esc(L.why || L.line)}`); }
  try { const pend = E.get('LegendZones')?.leaguePending?.() || []; if (pend.length) problems.push(`Pick your Legendary gem in the game: Elite League ${pend.map((p) => `${esc(p.reg)} tier ${p.tier}`).join(', ')}.`); } catch (__e) { __h('62-nowview:74', __e); }
  for (const f of Guard.failures()) problems.push(`Safety check: ${esc(f.label)} looks wrong (${esc(f.why)}) - goals that use it are paused until it looks right. Probably a game update.`);
  const miss = E.audit().missing || []; if (miss.length) problems.push(`${miss.length} game functions are missing after a game update - some goals may not work.`);
  try { const ug0 = w.dailies.underground; if (ug0?.finished) problems.push(`Underground: ${ug0.finished} expedition${ug0.finished === 1 ? '' : 's'} back - collect ${ug0.finished === 1 ? 'it' : 'them'}.`); } catch (__e) { __h('62-nowview:77', __e); }
  try { const rdy = (DayCare.info().eggs || []).filter((e) => e.ready).length; if (rdy) problems.push(`Day Care: ${rdy} egg${rdy === 1 ? '' : 's'} ready to hatch.`); } catch (__e) { __h('62-nowview:78', __e); }
  const status = `<span style="float:right;font-size:var(--t-s);font-weight:700" class="${Plan.running ? 'ok' : 'warn'}">${Plan.running ? '● running' : '❚❚ paused'} · ${open.length} goal${open.length === 1 ? '' : 's'}</span>`;
  if (!Plan.running) h += `<button class="btn gold" data-act="plan-run" style="margin-bottom:10px">▶ Start Plan</button>`;
  if (problems.length) h += `<div class="card" style="border-color:var(--bad)"><h3>⚠️ Needs You</h3>${problems.map((p) => `<div class="warn" style="margin:4px 0">${p}</div>`).join('')}</div>`;

  // ---- 2. today: what it's working on + the dailies ----
  // ---- 2. working on now: the screen goal + where the game is ----
  const scrGoal = open.find((g) => !g.paused && GoalTypes[g.type]?.uses !== 'background' && ['running', 'ready'].includes(live(g).state));
  const a = S.adv || {}, ST = E.get('STORY');
  let where = '';
  if (w.screen.kind === 'zone') where = `${nm(w.screen.id)}'s Legendary Zone`;
  else if (a.tower) where = a.tower.kind === 'candy' ? 'Candy Factory run' : 'Battle Tower run';
  else if (a.raid || a.event?.raid) where = RaidCount.label(a.event);
  else if (a.chapter != null) where = `${esc(ST?.CHAPTERS?.[a.chapter]?.name || 'Chapter ' + a.chapter)} · stop ${(+a.node || 0) + 1} of ${(a.nodes || []).length || '?'}`;
  const foes = (a.battle?.enemies || []).filter((e) => e && e.id != null);
  const fight = foes.length ? `fighting ${foes.map((e) => `${nm(e.id)}${e.level ? ' Lv ' + e.level : ''}`).join(', ')}` : '';
  if (scrGoal) {
    const L = live(scrGoal), p = prog(scrGoal, L);
    h += `<div class="card"><h3>Today ${status}</h3><div class="dim" style="font-size:var(--t-s);font-weight:700;letter-spacing:.04em">WORKING ON NOW</div><div style="display:flex;gap:12px;align-items:center;margin-top:6px">${pic(scrGoal, 64)}<div style="flex:1;min-width:0">
      <div style="font-size:var(--t-m);font-weight:800">${esc(Plan.label(scrGoal))}</div>
      ${p ? `<div style="font-size:22px;font-weight:800;margin-top:2px">${p.money ? '₽' : ''}${(+p.have).toLocaleString()} <span class="dim" style="font-size:var(--t-m)">of ${p.money ? '₽' : ''}${(+p.need).toLocaleString()}${p.unit ? ' ' + esc(p.unit) : ''}</span></div>` : ''}
      </div></div>${p ? bar(p.have / p.need) : ''}
      ${L.line ? `<div style="margin-top:8px">${esc(L.line)}</div>` : L.why ? `<div class="dim" style="margin-top:8px">${esc(L.why)}</div>` : ''}
      ${(() => { // Battle XP goal (Jimmy 2026-11-23): each Pokémon it levels - level, a bar to Lv 100, time left
        if (scrGoal.type !== 'discord' || !['xp', 'axsiom', 'mix'].includes(scrGoal.spot)) return '';
        const R = (() => { try { return GoalTypes.trainRows(scrGoal); } catch { return []; } })(); if (!R.length) return '';
        const nm = (id) => esc(Casing.names(Engine.get('Game.DEX')?.[id]?.name || '#' + id));
        return `<div style="margin-top:8px" title="Time to Lv 100 at each one's XP rate over the last 20 min">${R.map((r) => `<div style="display:grid;grid-template-columns:26px max-content minmax(24px,1fr) max-content;gap:8px;align-items:center;margin-top:3px"><img src="${Engine.sprite(r.id)}" width="26" height="26" style="image-rendering:pixelated"><span style="white-space:nowrap"><b>${nm(r.id)}</b>${r.shiny ? ' ✨' : ''}${RK(r.rank)} <span class="dim">Lv</span> ${r.level}</span><div class="bar" style="margin:0"><i style="width:${(r.pct * 100).toFixed(1)}%"></i></div><span class="dim" style="font-size:var(--t-s);white-space:nowrap">${GoalTypes.etaText(r.eta)}</span></div>`).join('')}</div>`;
      })()}
      ${(() => { // Axsiom Plan / Giant Chasm: what this run brought in
        if (scrGoal.type !== 'discord' || !['axsiom', 'mix'].includes(scrGoal.spot)) return '';
        const T = (() => { try { return GoalTypes.runTake(scrGoal); } catch { return null; } })(); if (!T) return '';
        const hrs = Math.max(1 / 60, (Date.now() - T.since) / 3.6e6), per = T.money / hrs;
        return `<div style="margin-top:8px;padding-top:6px;border-top:1px solid var(--line)"><div class="lbl">This run · ${hrs < 1 ? Math.round(hrs * 60) + ' min' : hrs.toFixed(1) + ' h'}</div><div style="margin-top:2px">₽ <b>${Math.round(T.money).toLocaleString()}</b> <span class="dim">(${Math.round(per).toLocaleString()}/h)</span></div><div style="margin-top:2px;font-size:var(--t-s)">${T.berries.length ? T.berries.map((b) => `${esc(b.name)} <b>×${b.n}</b>`).join(' · ') : '<span class="dim">no berries yet</span>'}</div></div>`;
      })()}
      ${teamLine(L.team)}
      ${where ? `<div class="dim" style="margin-top:6px">📍 ${where}${fight ? ' · ' + fight : ''}</div>` : ''}`;
  } else if (Plan.running && Plan.idle) {
    const I = Plan.idle, g = I.goal, lead = g?.uids?.[0] ? E.read('Game.getMon', null, g.uids[0]) : null;
    h += `<div class="card"><h3>Today ${status}</h3><div class="dim" style="font-size:var(--t-s);font-weight:700;letter-spacing:.04em">WORKING ON NOW · IDLE</div><div style="display:flex;gap:12px;align-items:center;margin-top:6px">
      ${lead ? `<img src="${E.sprite(lead.id)}" width="64" height="64" style="image-rendering:pixelated;flex:none;background:var(--well);border-radius:12px">` : '<span style="font-size:34px">💤</span>'}
      <div style="flex:1;min-width:0"><div style="font-size:var(--t-m);font-weight:800">${g ? 'Leveling while every goal waits' : 'Parked - nothing to level'}</div>
      ${g ? `<div>${g.uids.map((u) => { const m = E.read('Game.getMon', null, u); return m ? `${nm(m.id)}${RK(m.rank)}${m.shiny ? ' ✨' : ''} <b>Lv ${m.level}</b>` : ''; }).filter(Boolean).join(' · ')}</div>` : ''}</div></div>
      ${I.line ? `<div class="dim" style="margin-top:8px">${esc(I.line)}</div>` : ''}
      ${where ? `<div class="dim" style="margin-top:6px">📍 ${where}${fight ? ' · ' + fight : ''}</div>` : ''}`;
  } else {
    h += `<div class="card"><h3>Today ${status}</h3><div class="dim" style="font-size:var(--t-s);font-weight:700;letter-spacing:.04em">WORKING ON NOW</div><div style="margin-top:6px">${Plan.running ? (open.length ? 'Nothing can run right this minute - see Up Next for what each goal is waiting on.' : 'Nothing - your plan is empty. Add goals from the Pokédex, Legends or Plan tab.') : 'Nothing - the plan is paused.'}</div>
      ${where ? `<div class="dim" style="margin-top:6px">📍 ${where}${fight ? ' · ' + fight : ''}</div>` : ''}`;
  }

  // ---- 6. today: dailies ----
  const d = w.dailies, ug = d.underground, wb = d.worldBoss;
  // compact tiles: the label and the first part of the value; hover (or long-press) for the whole line
  const tile = (k, v) => { const t = document.createElement('div'); t.innerHTML = v; const full = (t.textContent || '').replace(/\s+/g, ' ').trim(); const first = (t.firstChild && t.firstChild.nodeType === 1 && t.firstChild.tagName === 'DIV') ? t.firstChild.innerHTML : v.replace(/<div[\s\S]*$/, '');
    return `<div title="${esc(k + ': ' + full)}" style="background:var(--well);border:1px solid var(--line);border-radius:10px;padding:5px 8px;min-width:0"><div class="lbl" style="font-size:var(--t-s)">${k}</div><div style="font-size:var(--t-s);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${first}</div></div>`; };
  h += `<div style="margin-top:10px;display:grid;grid-template-columns:repeat(auto-fill,minmax(118px,1fr));gap:6px">`;
  if (ug) h += tile('Underground', `${ug.left} of ${ug.perDay} left · ${ug.running}/${ug.slotsMax} bays busy${ug.finished ? ` · <span class="warn">${ug.finished} ready to collect</span>` : ug.nextBack ? ` · back in ${fmtIn(ug.nextBack)}` : ''}`);
  if (d.candy) {
    // like the raid: the day's type is only fetched when the game's Candy Factory screen opens, and until
    // then why() says "day" - Mega fetches it (read-only, every 5 min at most) instead of saying "closed"
    const C = E.get('CandyRun'), now = Date.now();
    let why = d.candy.why, type = null;
    if (why === 'day' && C?.loadDay && now - (Views.__candySync || 0) > 300_000) { Views.__candySync = now; try { C.loadDay(); } catch (__e) { __h('62-nowview:140', __e); } }
    try { why = C.why(); type = C.today?.()?.type || null; } catch (__e) { __h('62-nowview:141', __e); }
    const tname = type ? type[0].toUpperCase() + type.slice(1) : '';
    const inPlan = Plan.hasType('candy');
    h += tile('Candy Factory', d.candy.played || why === 'played' ? `<span class="ok">✔ done today</span>${tname ? ` <span class="dim">(${tname} day)</span>` : ''}`
      : why === 'running' ? `<span class="ok">● running now</span>${tname ? ` <span class="dim">(${tname} day)</span>` : ''}`
      : why === 'day' ? '<span class="dim">checking today\'s type…</span>'
      : why === 'locked' ? '<span class="dim">locked</span>'
      : why === 'team' ? `<span class="warn">open${tname ? ` (${tname} day)` : ''} · no Pokémon allowed today</span>`
      : `<span class="warn">open now${tname ? `: ${tname} day` : ''} · not run yet</span>${inPlan ? '' : '<div class="dim">add Candy Factory in the Plan tab and Mega runs it</div>'}`);
  }
  if (d.raid) {
    // the game only fetches the day's draw when its Raids screen opens: Mega fetches it (read-only),
    // at most every 5 min until it has today's, so this line is right without opening that screen
    const R = E.get('Raids'), now = Date.now();
    let ready = false; try { ready = !!R.ready(); } catch (__e) { __h('62-nowview:155', __e); }
    if (!ready && R?.sync && now - (Views.__raidSync || 0) > 300_000) { Views.__raidSync = now; try { R.sync(); } catch (__e) { __h('62-nowview:156', __e); } }
    let nx = null, reg = null, boss = null, won = false, tries = 0;
    try { nx = +R.nextDay(); } catch (__e) { __h('62-nowview:158', __e); }
    if (ready) { try { reg = R.drawn(); } catch (__e) { __h('62-nowview:159', __e); } }
    if (reg) { try { boss = (R.lane() || []).find((x) => x.key === reg)?.boss; won = !!R.done(reg); tries = +R.tried(reg) || 0; } catch (__e) { __h('62-nowview:160', __e); } }
    const inPlan = Plan.hasType('raid'), rname = reg ? esc((E.get('STORY.REGIONS') || []).find((x) => x.key === reg)?.name || reg) : '';
    h += tile('Shiny Raid', !ready ? '<span class="dim">checking today\'s draw…</span>'
      : !reg ? `<span class="dim">no raid today${nx ? ` · next ${DexInfo.clock(nx)}` : ''}</span>`
      : won ? `<span class="ok">✔ won today</span> <span class="dim">(✨ ${boss ? nm(boss) : ''} · ${rname}) · next ${DexInfo.clock(nx)}</span>`
      : `<span class="warn">open now: ✨ ${boss ? nm(boss) : '?'} (${rname})</span>${tries ? ` · ${tries} tries` : ''}<div class="dim">until ${DexInfo.clock(nx)}${inPlan ? '' : ' · add Shiny Raid in the Plan tab and Mega plays it'}</div>`);
  }
  if (d.tower) { const fl = S.tower?.best?.floor; h += tile('Battle Tower', `${fl ? `last run: floor ${fl} · ` : ''}resets in ${fmtIn(d.tower.weekEnds)}`); }
  try { const dc = DayCare.info(); if (dc.used || dc.mons.length) { const rdy = dc.eggs.filter((e) => e.ready).length; h += tile('Day Care', `${dc.used} of ${dc.max || '?'} eggs${rdy ? ` · <span class="warn">${rdy} ready</span>` : ''}${dc.full ? ' · <span class="warn">incubator full</span>' : dc.nextEgg != null ? ` · next egg in ${DayCare.left(dc.nextEgg)}` : ''}`); } } catch (__e) { __h('62-nowview:168', __e); }
  try { const B = Object.values(S.buffs || {}).filter((b) => b && b.until > Date.now()); if (B.length) h += tile('Berries on', B.map((b) => `${esc(Casing.names((E.get('CONFIG')?.BUFF_BERRIES?.[b.key]?.name) || b.key)).replace(/^Baie /, '')} <span class="dim">${fmtIn(b.until)}</span>`).join(' · ')); } catch (__e) { __h('62-nowview:169', __e); }
  h += tile('World Boss', wb.caught ? '<span class="ok">✔ caught this edition</span>' : wb.catchable ? '<span class="warn">catchable now</span>' : wb.open ? 'shield up' : '<span class="dim">closed</span>');
  { const sm = (() => { try { return History.sideMoney(); } catch { return null; } })();
    h += tile('Money', `₽${(+(() => { try { return History.homeMoney(); } catch { return S.money || 0; } })()).toLocaleString()}${sm ? ` <span class="dim">· ${esc(sm.name)} wallet ₽${sm.money.toLocaleString()}</span>` : ''}`); }
  h += `</div></div>`; // the dailies grid, then the Today card

  try { h += Mirror.fightCard(esc); } catch (__e) { __h('62-nowview:175', __e); }

  // ---- dailies (2.17.2, Jimmy 2026-11-25): what's up now, straight from the game. The game's day turns over at
  // 3 PM Pacific, so a daily finished last night is "next in 2 h 48 m", not "done today" ----
  try {
    const D = Dailies.list();
    if (D.length) {
      const rs = Dailies.resetAt(), wk = (() => { try { return +Engine.get('Tower').weekEnds(); } catch { return 0; } })();
      const left = (at) => { const m = Math.max(0, Math.round((at - Date.now()) / 60000)); return m < 60 ? `${m} min` : m < 48 * 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} m` : `${Math.round(m / 1440)} days`; };
      const nReady = D.filter((d) => d.state === 'ready').length;
      const lab = (d) => {
        if (d.state === 'ready') return ['🔔 Ready', 'gold'];
        if (d.state === 'run') return ['▶ Going', 'ok'];
        const at = d.week ? wk : rs;
        return [at ? `⏳ in ${left(at)}` : d.state === 'done' ? '✓ Done' : 'Not now', 'dim'];
      };
      h += `<div class="card dcard${nReady ? ' hot' : ''}"><h3>Dailies${nReady ? ` <span class="chip on" style="font-size:var(--t-s);padding:1px 8px">${nReady} ready</span>` : ''}</h3>`
        + D.map((d) => { const [l, cls] = lab(d); const inQ = Plan.goals.some((g) => !g.done && !g.paused && g.type === d.key);
          const why = d.state === 'done' ? (d.week ? 'done this week' : 'done - next round') : d.line;
          return `<div class="row"><span class="k">${d.icon} ${esc(d.name)}${why ? ` <span class="faint" style="font-size:var(--t-s)">· ${esc(why)}</span>` : ''}${d.state === 'ready' && !inQ ? ' <span class="warn" style="font-size:var(--t-s)">· not in your queue</span>' : ''}</span><span class="v"><b class="${cls}">${l}</b></span></div>`; }).join('')
        + `<div class="dim" style="font-size:var(--t-s);margin-top:6px">${rs ? `Dailies open again ${new Date(rs).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })} (in ${left(rs)})` : ''} · one phone alert per daily when it opens (Settings → phone alerts → Dailies ready)</div></div>`;
    }
  } catch (__e) { __h('62-nowview:197', __e); }
  // ---- best next rewards ----
  { const R = nowRewards(), pc = (x) => (x >= 0.995 ? '99+' : x > 0 && x < 0.01 ? '<1' : Math.round(x * 100)) + '%';
    const col = (x) => (x >= 0.6 ? 'ok' : x >= 0.25 ? 'warn' : 'bad');
    let r = '';
    // (Jimmy 2026-11-25) each tier says whether its goal is in the queue; tap one that isn't to add it, after a confirm
    const ask = Views.__rwAsk || null;
    const tierRow = (t) => {
      const tag = t.queued ? ' <span class="chip on" style="font-size:var(--t-s);padding:1px 7px">In queue</span>' : '';
      const act = t.queued ? 'data-act="tab" data-tab="plan"' : `data-act="rw-ask" data-k="${t.key}"`;
      let row = `<div class="row" ${act} style="cursor:pointer"><span class="k">${esc(t.what)}${tag} <span class="faint" style="font-size:var(--t-s)">→ ${esc(t.reward)}</span></span><span class="v"><b class="${col(t.pct)}">${pc(t.pct)}</b></span></div>`;
      if (!t.queued && ask === t.key) row += `<div class="note" style="margin:4px 0 6px">Add <b>${esc(t.go === 'league' ? t.what.replace(/ · tier \d+$/, '') : t.what.replace(/ · Elite tier \d+$/, ' Elite'))}</b> up to tier 5 to your queue?<div class="btns" style="margin-top:6px"><button class="btn sm gold" data-act="rw-add" data-k="${t.key}" ${t.id != null ? `data-id="${t.id}"` : ''} ${t.reg ? `data-reg="${esc(t.reg)}"` : ''}>Add to Queue</button><button class="btn sm" data-act="rw-cancel">Cancel</button></div></div>`;
      return row;
    };
    if (R.tiers.length) r += `<div class="lbl" style="margin-top:2px">Easiest tiers</div>` + R.tiers.slice(0, 3).map(tierRow).join('');
    else r += `<div class="dim">No tiers rated yet - open Simulate › Elite or › League and Mega rates them.</div>`;
    if (R.ready.length) r += `<div class="lbl" style="margin-top:8px">Ready to rank up</div><div>${R.ready.slice(0, 4).map((c) => `<b>${esc(c.name)}</b> <span class="dim">→ ${RK(c.next)} (${esc(c.label)})</span>`).join(' · ')}</div>`;
    if (R.shop.length) r += `<div class="lbl" style="margin-top:8px">Gem shop today</div><div>${R.shop.map((x) => `${esc(x.label)} <span class="${x.ok ? 'ok' : 'dim'}">${x.price ? x.price.toLocaleString() + ' shards' : ''}</span> <span class="dim">for ${esc(x.mons.slice(0, 2).join(', '))}</span>`).join(' · ')}</div>`;
    h += `<div class="card"><h3>Best Next Rewards</h3>${r}</div>`;
  }
  // ---- ready for candy (the Battle XP goal's rule: past ~5.5 M XP per level, Exp. Candies beat battling) ----
  { const g = Plan.goals.find((x) => !x.done && x.type === 'discord' && (x.spot === 'xp' || x.candyAt));
    const R = g ? (() => { try { return GoalTypes.candyReady(g); } catch { return []; } })() : [];
    if (R.length) {
      const M = (x) => (x >= 1e6 ? (x / 1e6).toFixed(1) + ' M' : Math.round(x / 1e3) + ' k');
      const have = ['exp-candy-s', 'exp-candy-m', 'exp-candy-big', 'exp-candy-xl'].map((k) => [k, +E.read('Game.itemCount', 0, k) || 0]).filter(([, n]) => n);
      h += `<div class="card"><h3>🍬 Ready for Candy <span class="dim" style="font-weight:600">· ${R.length}</span></h3><div class="dim" style="font-size:var(--t-s);margin-bottom:4px">Past ${((g.candyAt || GoalTypes.CANDY_AT) / 1e6).toFixed(1)} M XP per level, so battling is slow: feed these Exp. Candies. Discord tier-list picks first.</div>${R.slice(0, 8).map((r) => `<div style="display:grid;grid-template-columns:26px max-content minmax(0,1fr) max-content;gap:8px;align-items:center;margin-top:3px"><img src="${Engine.sprite(r.id)}" width="26" height="26" style="image-rendering:pixelated"><span style="white-space:nowrap"><b>${esc(Casing.names(E.get('Game.DEX')?.[r.id]?.name || '#' + r.id))}</b>${r.shiny ? ' ✨' : ''}${RK(r.rank)} <span class="dim">Lv</span> ${r.level}</span><span>${r.tier ? '<span class="ok" style="font-size:var(--t-s)">Discord pick</span>' : ''}</span><span class="dim" style="font-size:var(--t-s);white-space:nowrap">${M(r.left)} XP to 100</span></div>`).join('')}${R.length > 8 ? `<div class="dim" style="margin-top:4px">+ ${R.length - 8} more</div>` : ''}${have.length ? `<div class="dim" style="margin-top:6px;font-size:var(--t-s)">You have: ${have.map(([k, n]) => `${esc(Casing.names(E.get('CONFIG')?.ITEMS?.[k]?.name || k))} ×${n}`).join(' · ')}</div>` : ''}</div>`;
    }
  }

  // ---- 3. alongside (background goals) ----
  const bg = open.filter((g) => GoalTypes[g.type]?.uses === 'background' && !g.paused);
  // running alongside: one short line each, at the foot of Up Next
  const along = bg.map((g) => { const L = live(g), p = prog(g, L); return `<div style="margin:3px 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis"><b>${esc(Plan.label(g))}</b>${p ? ` <span class="dim">· ${(+p.have).toLocaleString()} of ${(+p.need).toLocaleString()}${p.unit ? ' ' + esc(p.unit) : ''}</span>` : ''} <span class="dim">· ${esc(L.line || L.why || L.state || '')}</span></div>`; }).join('');

  // ---- 3b. Day Care: eggs in the incubator and how long each has left ----
  try {
    const dc = DayCare.info();
    if (dc.used || dc.mons.length) {
      const at2 = (t) => new Date(t).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
      h += `<div class="card"><h3>🥚 Day Care</h3><div class="dim">Incubator ${dc.used} of ${dc.max || '?'}${dc.full ? ' · full - hatch one to make room' : dc.nextEgg != null ? ` · next egg in ${DayCare.left(dc.nextEgg)}` : dc.mons.length ? ' · no egg coming (these can\'t breed)' : ''}</div>`;
      for (const e of dc.eggs) {
        const pct = e.ready ? 1 : 1 - e.left / Math.max(1, e.hatchAt - e.laidAt);
        const sh = (() => { try { return EggPredict.eggs().find((x) => x.uid === e.uid)?.shiny; } catch { return null; } })();
        h += `<div style="display:flex;gap:10px;align-items:center;margin:8px 0"><img src="${E.sprite(e.id)}" width="44" height="44" style="image-rendering:pixelated;flex:none;background:var(--well);border-radius:12px;${e.ready ? '' : 'filter:grayscale(1);opacity:.5'}"><div style="flex:1;min-width:0"><b>${nm(e.id)}</b>${sh ? ' <b class="gold">✨ hatches shiny!</b>' : e.shinyParent ? ' <span class="dim" title="shiny parent">(shiny parent, not shiny)</span>' : ''}
          <div class="${e.ready ? 'ok' : 'dim'}">${e.ready ? '● ready to hatch' : `${DayCare.left(e.left)} left · hatches ${at2(e.hatchAt)}`}</div>${e.ready ? '' : bar(pct)}</div>${e.ready ? `<button class="btn sm gold" style="width:auto;padding:10px 14px;margin:0" data-act="m-egg-hatch" data-uid="${esc(e.uid)}">🐣 Hatch</button>` : ''}</div>`;
      }
      if (dc.eggs.filter((e) => e.ready).length > 1) h += `<button class="btn gold" data-act="m-egg-hatch" data-uid="">🐣 Hatch All Ready (${dc.eggs.filter((e) => e.ready).length})</button>`;
      if (dc.mons.length) h += `<div class="dim" style="margin-top:6px">Staying there: ${dc.mons.map((m) => `${nm(m.id)}${m.shiny ? ' ✨' : ''} Lv ${m.level}`).join(', ')}</div>`;
      h += eggForecast(dc, nm, at2);
      h += `</div>`;
    }
  } catch (__e) { __h('62-nowview:249', __e); }

  // ---- 4. up next ----
  // up next: not the ones that can't happen for now (zone closed, locked behind another catch)
  const next = open.filter((g) => g !== scrGoal && !bg.includes(g) && !(live(g).state === 'wait' && /\b(locked|closed)\b/i.test(live(g).why || '')));
  if (next.length || along) {
    h += `<div class="card"><h3>Up Next</h3>`;
    for (const g of next.slice(0, 3)) {
      const L = live(g), p = prog(g, L);
      const st = g.paused ? '❚❚ paused' : L.state === 'wait' ? `◐ ${esc(L.why || 'waiting')}` : L.state === 'queued' ? '○ after the one above' : esc(L.why || L.state || '');
      h += `<div style="display:flex;gap:8px;align-items:center;margin:5px 0" title="${esc(Plan.label(g))}"><span style="flex:none">${pic(g, 28)}</span><div style="flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis"><b>${esc(Plan.label(g))}</b>${p ? ` <span class="dim">· ${(+p.have).toLocaleString()}/${(+p.need).toLocaleString()}</span>` : ''} <span class="dim" style="font-size:var(--t-s)">${st}</span></div></div>`;
    }
    if (next.length > 3) h += `<div class="dim" data-act="tab" data-tab="plan" style="cursor:pointer">+ ${next.length - 3} more in the Plan tab ›</div>`;
    if (along) h += `<div class="lbl" style="margin-top:8px">Running alongside</div>${along}`;
    h += `</div>`;
  }

  // ---- 7. trades ----
  const td = Trades.data;
  if (td && !td.failed) {
    const T = td.targets || [], spare = T.filter((t) => t.best === 'spare');
    h += `<div class="card"><h3>Trades</h3><div>${T.length ? `${T.length} Pokémon you're missing are on the board${spare.length ? ` · <span class="ok">${spare.length} for a spare: ${spare.slice(0, 4).map((t) => nm(t.id)).join(', ')}</span>` : ' · none for a spare right now'}` : 'Nothing you\'re missing on the board right now.'}</div>
      <div class="dim">${td.at ? `checked ${ago(td.at)}` : "the board hasn&#39;t been checked yet"}</div>${spare.length ? `<button class="btn" data-act="tab" data-tab="trades">Open Trades</button>` : ''}</div>`;
  }

  // ---- 8. Pokédex + team ----
  const cache = Views.__nowDex && Date.now() - Views.__nowDex.at < 30_000 ? Views.__nowDex : (Views.__nowDex = {
    at: Date.now(),
    regs: w.regions.filter((r) => r.open && r.dex).map((r) => { const ids = DexInfo.regionIds(r.key); return { name: r.name || r.key, have: ids.filter((id) => World.dex.registered(id)).length, total: ids.length }; }),
  });
  if (cache.regs.length) {
    h += `<div class="card"><h3>Pokédex</h3>${cache.regs.map((r) => `<div style="margin:6px 0"><div style="display:flex;justify-content:space-between"><b>${esc(r.name)}</b><span>${r.have} / ${r.total}${r.have >= r.total ? ' <span class="ok">✔</span>' : ''}</span></div>${bar(r.have / Math.max(1, r.total))}</div>`).join('')}</div>`;
  }
  const team = (S.team || []).map((u) => E.read('Game.getMon', null, u)).filter(Boolean);
  if (team.length) {
    h += `<div class="card tmwrap"><h3>Team</h3><div class="tmgrid">${team.map((m) => `<div style="min-width:0"><img src="${E.sprite(m.id)}" width="48" height="48" style="image-rendering:pixelated;max-width:100%;height:auto"><div class="tmname" title="${nm(m.id)}">${nm(m.id)}</div><div class="dim" style="font-size:var(--t-s)">Lv ${m.level}${S.buddy?.uid === m.uid ? ' ★' : ''}</div></div>`).join('')}</div><button class="btn" data-act="team-edit">✏️ Change Team</button></div>`;
  }
  return h;
};

/* ---------------------------------------------------------------------------------------------
 * TopBar: one short line in the game's own top bar (stdAri's idea), between your money and the
 * game's buttons - what Mega is doing right now, and the next shiny egg when it's close. Tap it to open
 * Mega on the Plan tab. It only adds one element to the bar's empty spacer area and puts it back if the
 * game redraws the bar; nothing of the game's is moved or changed. Settings › Top Bar turns it off.
 * ------------------------------------------------------------------------------------------- */
const TopBar = (() => {
  const KEY = 'mega-topbar', ID = 'mega-topline';
  let on = (() => { try { return JSON.parse(localStorage.getItem(KEY) ?? 'true'); } catch { return true; } })();
  const cut = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
  function text() {
    let main = '';
    try {
      if (!Plan.running) main = 'plan paused';
      else {
        const g = Plan.goals.find((x) => !x.done && GoalTypes[x.type]?.uses === 'screen' && Plan.live(x.id)?.state === 'running');
        if (g) { const L = Plan.live(g.id); main = `${Plan.label(g)}${L?.line ? ': ' + L.line : ''}`; }
        else if (Plan.idle?.line) main = `idle: ${Plan.idle.line}`;
        else main = Plan.top || 'running';
      }
    } catch { main = ''; }
    let egg = '';
    try { const r = EggPredict.upcoming(30).rows.find((x) => x.now); if (r) egg = ` · ✨ shiny egg #${r.k}${r.ahead ? ` in ${r.ahead + 1} eggs` : ' next'}`; } catch (__e) { __h('62-topbar:23', __e); }
    return { short: cut(main, 90) + egg, full: main + egg };
  }
  function paint() {
    const bar = document.getElementById('topbar'), old = document.getElementById(ID);
    if (!on || !bar) { if (old) old.remove(); return; }
    // it lives INSIDE the bar's empty spacer (.tb-sep), so it only ever uses space nobody else needs: the game's
    // own items (your name, money, Pokédex count, buttons) never shrink for it (2.10.19 beta squeezed your name)
    const sep = bar.querySelector('.tb-sep');
    if (!sep) { if (old) old.remove(); return; }
    let el = old;
    if (!el || el.parentElement !== sep) {
      if (el) el.remove();
      if (getComputedStyle(sep).minWidth !== '0px') sep.style.minWidth = '0';
      sep.style.display = 'flex'; sep.style.alignItems = 'center'; sep.style.overflow = 'hidden';
      el = document.createElement('button');
      el.id = ID; el.type = 'button';
      el.style.cssText = 'display:block;min-width:0;max-width:100%;margin:0 10px;padding:5px 12px;border-radius:999px;border:1px solid rgba(255,255,255,.14);background:rgba(0,0,0,.28);color:inherit;font:inherit;font-size:var(--t-s);line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer;text-align:left';
      el.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); try { UI.openTab?.('plan'); } catch (__e) { __h('62-topbar:41', __e); } });
      sep.appendChild(el);
    }
    const t = text();
    const s = `🔮 ${t.short}`;
    if (el.textContent !== s) el.textContent = s;
    const tip = `Mega Alakazam: ${t.full}`;
    if (el.title !== tip) el.title = tip;
  }
  let timer = null;
  function boot() { if (timer) return; timer = setInterval(() => { try { paint(); } catch (__e) { __h('62-topbar:51', __e); } }, 3000); try { paint(); } catch (__e) { __h('62-topbar:51', __e); } }
  return { boot, paint, text, get on() { return on; }, set(v) { on = !!v; try { localStorage.setItem(KEY, JSON.stringify(on)); } catch (__e) { __h('62-topbar:52', __e); } try { paint(); } catch (__e) { __h('62-topbar:52', __e); } } };
})();

/* ---------------------------------------------------------------------------------------------
 * Pokéblocks tab (Jimmy 2026-11-20): a cheat sheet like Gems - what you have, who to give a Rainbow
 * Pokéblock to, which colour to feed each one, and today's Pokéblock Boss.
 * Rules (the game's TASTES + CONFIG.TASTES): a Rainbow Pokéblock draws a disliked stat (-20%, for good) and a
 * liked one (+10%); a coloured Pokéblock raises its stat up to +20% after 25 of them (fast at first, then
 * slower), and the raises of all stats together stay under +20%; two raised stats at most; a Pokéblock of the
 * disliked stat is refused; another colour switches the liked stat; a new Rainbow starts over; a trade resets it.
 * Suggestions only: Mega never feeds Pokéblocks.
 * ------------------------------------------------------------------------------------------- */
Views.blocs = (esc) => {
  const E = Engine, T = E.get('TASTES'), C = E.get('CONFIG.TASTES') || {}, DX = E.get('Game.DEX') || {};
  const G = E.get('Game'), S = E.get('Game.S') || {};
  if (!T) return '<div class="note">Pokéblocks are not in this game version.</div>';
  const nm = (id) => esc(DX[id]?.name || '#' + id);
  const STAT = { atk: 'Attack', def: 'Defense', spa: 'Sp. Atk', spd: 'Sp. Def', spe: 'Speed' };
  const COLOUR = { atk: 'Red', def: 'Yellow', spa: 'Blue', spd: 'Green', spe: 'Pink' };
  const DOT = { atk: '#e5484d', def: '#f5c542', spa: '#3b82f6', spd: '#3fb950', spe: '#f472b6' };
  const chip = (k) => `<span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${DOT[k]};margin-right:4px;vertical-align:-1px"></span>`;
  const count = (key) => { try { return +G.itemCount(key) || 0; } catch { return +(S.items?.[key] || 0); } };
  const MAX = +C.MAX || 25, pct = (x) => `${x >= 0 ? '+' : ''}${Math.round(x * 100)}%`;
  const rainbow = count('mystery-candy');
  let h = `<div class="card"><h3>Pokéblocks</h3>
    <div style="display:flex;flex-wrap:wrap;gap:12px;font-size:var(--t-m)"><span>🌈 <b>${rainbow}</b> Rainbow</span>${T.ORDER.map((k) => `<span>${chip(k)}<b>${count(T.ITEM[k])}</b> ${COLOUR[k]} <span class="dim">(${STAT[k]})</span></span>`).join('')}</div>
    <div class="dim" style="margin-top:8px;font-size:var(--t-s)">A <b>Rainbow</b> reveals a Pokémon's tastes: one stat it dislikes (−20%, for good) and one it likes (+10%), both at random. Then each <b>coloured</b> Pokéblock raises its stat, up to +20% after ${MAX} (the first ones count most). All raises together stay under +20%, two stats at most. It refuses its disliked colour; another colour moves its liked stat. A new Rainbow starts over from scratch, and a trade wipes it. Boosts count in every fight.</div>
    <div class="note dim" style="margin-top:8px">Suggestions only - Mega never feeds Pokéblocks. Get more from the Pokéblock Boss (weekends: every colour + 5 Rainbows) or the Battle Tower counter (20 BP each, Rainbow 150 BP).</div></div>`;

  // today's Pokéblock Boss
  const BB = E.get('BlocBoss');
  if (BB) {
    let why = null, day = null, last = null; try { why = BB.why(); day = BB.today(); last = BB.last(); } catch (__e) { __h('63-blocview:30', __e); }
    if (!day && Date.now() - (Views.__blocDayAt || 0) > 300_000) { Views.__blocDayAt = Date.now(); try { BB.loadDay(); } catch (__e) { __h('63-blocview:31', __e); } }
    const weekend = [0, 6].includes(new Date().getDay());
    h += `<div class="card"><h3>Pokéblock Boss</h3>
      <div class="row"><span class="k">Today</span><span class="v">${day ? `${nm(day.boss)} · ${day.taste === 'all' || (BB.isMulti && BB.isMulti(day.taste)) ? 'every colour (weekend)' : `${chip(day.taste)}${COLOUR[day.taste] || day.taste} day`}` : '<span class="dim">not loaded yet</span>'}</span></div>
      <div class="row"><span class="k">Status</span><span class="v">${why === 'played' ? '<span class="ok">✔ done today</span>' : why === 'locked' ? 'locked (beat the Unova League)' : Plan.hasType('bloc') ? 'Mega attacks it after the daily reset' : 'not in your plan'}</span></div>
      ${last ? `<div class="row"><span class="k">Last attack</span><span class="v">reached ${(() => { try { return esc(BB.stepName(last.step, last.taste)); } catch { return 'step ' + last.step; } })()} · ${last.got} Pokéblocks${last.rb ? ` + ${last.rb} Rainbow` : ''}</span></div>` : ''}
      <div class="row"><span class="k">Your record</span><span class="v">${(() => { try { const b = BB.best(); return b >= 0 ? esc(BB.stepName(b)) : '—'; } catch { return '—'; } })()}</span></div>
      ${weekend ? '' : '<div class="dim" style="font-size:var(--t-s);margin-top:4px">Saturday and Sunday: Pokéblocks of every colour and 5 Rainbows.</div>'}</div>`;
  }

  // who matters most: the Pokémon your saved teams use (legendary / roamer sims, raid pick, zone and event teams)
  const use = new Map(), bump = (u, n = 1) => { if (u) use.set(u, (use.get(u) || 0) + n); };
  try { for (const s of Object.values(Legends.sims() || {})) for (const u of s?.uids || []) bump(u, 2); } catch (__e) { __h('63-blocview:43', __e); }
  for (const [k, list] of Object.entries(S.eventTeams || {})) for (const u of list || []) bump(u, /^raid|^bloc/.test(k) ? 2 : 1);
  for (const g of Plan.goals || []) if (!g.done && g.pick?.mine) for (const u of g.pick.mine) bump(u, 3);
  const own = (E.read('Game.ownedMons', []) || []).filter((m) => m && !m.egg);
  const bst = (m) => Object.values(DX[m.id]?.stats || {}).reduce((a, x) => a + (+x || 0), 0);
  // the stat it attacks with: the category of its best move (Lugia's Aeroblast is special, Ho-Oh's Sacred Fire physical)
  const hitStat = (m) => { try { const mv = G.bestMoveAgainst(m, ['normal']); if (mv?.cat) return mv.cat === 'spec' ? 'spa' : 'atk'; } catch (__e) { __h('63-blocview:49', __e); } const s = DX[m.id]?.stats || {}; return (+s.spa || 0) > (+s.atk || 0) ? 'spa' : 'atk'; };
  const ups = (t) => { try { return T.ups(t) || []; } catch { return Object.keys(t?.up || {}); } };
  const boost = (t, k) => { try { return T.mult(t, k) - 1; } catch { return 0; } };

  // already revealed
  const revealed = own.filter((m) => m.taste && m.taste.h).sort((a, b) => (use.get(b.uid) || 0) - (use.get(a.uid) || 0) || bst(b) - bst(a));
  if (revealed.length) {
    h += `<div class="card" style="border-color:var(--ok)"><h3>Revealed (${revealed.length})</h3>`;
    for (const m of revealed) {
      const t = m.taste, hs = hitStat(m), liked = ups(t), up = t.up || {};
      const boosts = T.ORDER.filter((k) => Math.abs(boost(t, k)) > 0.0005).map((k) => `${chip(k)}${STAT[k]} <span class="${boost(t, k) > 0 ? 'ok' : 'warn'}">${pct(boost(t, k))}</span>`).join(' · ');
      let tip;
      if (t.h === hs) tip = `<span class="warn">Bad draw: it dislikes its attacking stat (${STAT[hs]} −20%). A new Rainbow rerolls both tastes.</span>`;
      else if (liked.includes(hs)) { const n = +up[hs] || 0; tip = n >= MAX - 1e-6 ? `<span class="ok">✓ ${STAT[hs]} is maxed (+20%).</span>` : `Feed it <b>${COLOUR[hs]}</b> (${STAT[hs]}): about ${Math.ceil(MAX - n)} more to reach +20%.`; }
      else tip = `It likes ${liked.map((k) => STAT[k]).join(' & ') || '—'}. Feed it <b>${COLOUR[hs]}</b> to move its liked stat to ${STAT[hs]}, the one it attacks with.`;
      h += `<div style="display:flex;gap:10px;align-items:center;margin-top:8px"><img src="${E.sprite(m.id)}" width="40" height="40" style="image-rendering:pixelated;flex:none">
        <div style="flex:1;min-width:0"><b>${nm(m.id)}${m.shiny ? ' ✨' : ''}</b> <span class="dim">Lv ${m.level} · dislikes ${chip(t.h)}${STAT[t.h]}</span>
        <div style="font-size:var(--t-s)">${boosts || '<span class="dim">no boosts yet</span>'}</div><div style="font-size:var(--t-s)">${tip}</div></div></div>`;
    }
    h += `</div>`;
  }

  // who to give a Rainbow to next
  const seen = new Set();
  const picks = own.filter((m) => !(m.taste && m.taste.h) && m.level >= 90)
    .sort((a, b) => (use.get(b.uid) || 0) - (use.get(a.uid) || 0) || bst(b) - bst(a) || b.level - a.level)
    .filter((m) => { const k = m.id + (m.shiny ? 's' : ''); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 10);
  h += `<div class="card"><h3>Who Gets a Rainbow</h3><div class="dim" style="margin-bottom:4px">The Pokémon your teams use most (legendary and roamer teams, the raid pick, zone and event teams), then the strongest. Pick ones you'll keep: a trade wipes the tastes.</div>`;
  picks.forEach((m, i) => {
    const hs = hitStat(m), n = use.get(m.uid) || 0;
    h += `<div style="display:flex;gap:10px;align-items:center;margin-top:8px"><b class="dim" style="width:18px">${i + 1}</b><img src="${E.sprite(m.id)}" width="40" height="40" style="image-rendering:pixelated;flex:none">
      <div style="flex:1;min-width:0"><b>${nm(m.id)}${m.shiny ? ' ✨' : ''}</b> <span class="dim">Lv ${m.level} · base ${bst(m)}${n ? ` · in ${n >= 6 ? 'many' : 'some'} of your teams` : ''}</span>
      <div style="font-size:var(--t-s)">Then feed ${chip(hs)}<b>${COLOUR[hs]}</b> (${STAT[hs]}, its attacking stat)${hs === 'atk' ? '' : ''}</div></div></div>`;
  });
  h += `<div class="dim" style="font-size:var(--t-s);margin-top:10px">1 in 5 draws makes its attacking stat the disliked one - check the Revealed list right after a Rainbow, and reroll that one if you have Rainbows to spare.</div></div>`;
  return h;
};

/* ---------------------------------------------------------------------------------------------
 * Simulate tab, Elite and Gems views (read-only for now: nothing is fought or spent from here).
 *
 * Elite legendaries (LegendZones.elite*): every legendary you've caught has tiers 1-5, unlocked one
 * after the other. You must KO it (no catch). Each tier: the boss takes less damage (ELITE.RESIST),
 * its poison/burn hits harder (ELITE.HURT = boss max HP / n), and HP / power scale (eliteKnobs).
 * Rewards (ELITE.REWARDS): tiers 1, 2, 4 = a legendary gem of its first type ("type:3"), 3 and 5 = frame.
 * Losing freezes that legendary's elite fights for ELITE.FREEZE_MS.
 *
 * Gems (Underground): a gem "type:tier" ranks up a Pokémon of that type and rarity tier
 * (0 common, 1 uncommon, 2 rare, 3 legendary). Rank n+1 costs n+1 gems, max rank 5, the Pokémon must
 * be Lv 100 in the PC, and it goes back to Lv 5 (x1.15 to every stat per rank).
 * ------------------------------------------------------------------------------------------- */
const EliteInfo = (() => {
  const E = Engine;
  const G = () => E.get('Game'), S = () => E.get('Game.S') || {}, D = () => E.get('Game.DEX') || {};
  const LZ = () => E.get('LegendZones'), C = () => E.get('CONFIG') || {};
  const TIER = ['Common', 'Uncommon', 'Rare', 'Legendary'];
  const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '');
  const gemLabel = (key) => { const [t, r] = String(key).split(':'); return `${cap(t)} · ${TIER[+r] || '?'}`; };

  function elite() {
    const lz = LZ(), cfg = C().ELITE || {};
    if (!lz?.ZONES || !cfg.ON) return { on: false, rows: [] };
    const gems = S().under?.gems || {};
    const owned = (E.read('Game.allMons', []) || []);
    const rows = [];
    for (const z of lz.ZONES) {
      let shown = false; try { shown = lz.eliteShown(z); } catch (__e) { __h('63-eliteview:29', __e); }
      if (!shown) continue;
      const id = z.id, d = D()[id] || {};
      let best = 0, next = 0, open = false, foe = id;
      try { best = +lz.eliteBest(id) || 0; } catch (__e) { __h('63-eliteview:33', __e); }
      try { next = +lz.eliteNext(id) || 0; } catch (__e) { __h('63-eliteview:34', __e); }
      try { open = !!lz.eliteOpen(z); } catch (__e) { __h('63-eliteview:35', __e); }
      try { foe = lz.eliteFoe(z) || id; } catch (__e) { __h('63-eliteview:36', __e); }
      const can = next ? (() => { try { return !!lz.eliteCan(id, next); } catch { return false; } })() : false;
      let kn = null; try { kn = next ? lz.eliteKnobs(id, null, next) : null; } catch (__e) { __h('63-eliteview:38', __e); }
      const gem = (() => { try { return lz.eliteGem(id); } catch { return null; } })();
      const reward = next ? cfg.REWARDS?.[next] : null;
      // who could use this legendary's gem: your legendaries of that type
      const gtype = gem ? gem.split(':')[0] : null;
      const users = gtype ? [...new Set(owned.filter((m) => (D()[m.id]?.legendary || D()[m.id]?.mythical) && (D()[m.id]?.types || []).includes(gtype)).map((m) => m.id))] : [];
      rows.push({
        id, foe, name: d.name || '#' + id, types: d.types || [], best, next, open, can, reward, gem, gemHave: gem ? +gems[gem] || 0 : 0, users,
        hpX: kn && z.hp ? kn.hp / z.hp : null, powX: kn && z.power ? kn.power / z.power : null,
        resist: next ? cfg.RESIST?.[next] : null, hurt: next ? cfg.HURT?.[next] : null,
      });
    }
    rows.sort((a, b) => (b.next > 0) - (a.next > 0) || (b.users.length > 0) - (a.users.length > 0) || a.next - b.next || a.name.localeCompare(b.name));
    return { on: true, rows, tiers: cfg.TIERS || [1, 2, 3, 4, 5], freezeMin: Math.round((cfg.FREEZE_MS || 0) / 60000) };
  }

  // gem advice: for each gem you hold, the best Pokémon to spend it on
  let gemCache = { at: 0, v: null };
  function gems() {
    if (gemCache.v && Date.now() - gemCache.at < 20_000) return gemCache.v;
    const U = E.get('Underground'), s = S(), held = s.under?.gems || {}, g = G();
    const max = +(C().UNDERGROUND?.RANK_MAX) || 5;
    const team = new Set(s.team || []);
    const simUids = new Set(Object.values((() => { try { return Legends.sims(); } catch { return {}; } })() || {}).flatMap((x) => x?.uids || []));
    const bst = (id) => Object.values(D()[id]?.stats || {}).reduce((t, x) => t + (+x || 0), 0);
    const tierOf = (id) => { try { return Math.max(0, Math.min(3, +g.tierIndex(id) || 0)); } catch { return 0; } };
    const mons = (s.mons || []).filter((m) => (m.rank || 0) < max);
    const rows = [], best = [];
    // what one more rank adds at Lv 100 (the game's own statsOf), all six stats
    const useful = (st) => (st.hp + st.atk + st.def + st.spa + st.spd + st.spe);
    function upgrade(m) {
      try {
        const a = useful(g.statsOf({ ...m, level: 100, rank: m.rank || 0 })), b = useful(g.statsOf({ ...m, level: 100, rank: (m.rank || 0) + 1 }));
        return { add: b - a, pct: a ? (b - a) / a : 0 };
      } catch { return { add: 0, pct: 0 }; }
    }
    for (const [key, have] of Object.entries(held)) {
      if (!(+have > 0)) continue;
      const [type, r] = key.split(':');
      const cands = [];
      for (const m of mons) {
        if (tierOf(m.id) !== +r || !(D()[m.id]?.types || []).includes(type)) continue;
        let ro = null; try { ro = U.rankOf(m, key); } catch (__e) { __h('63-eliteview:80', __e); }
        if (!ro || ro.key !== key) continue; // that species can't use this gem
        const use = (team.has(m.uid) ? 2 : 0) + (simUids.has(m.uid) ? 1 : 0);
        const gain = upgrade(m);
        // the strong get stronger: highest base stats first (Jimmy's rule), then the biggest total gain
        const b0 = bst(m.id);
        cands.push({ m, use, bst: b0, need: ro.need, why: ro.why || null, next: ro.next, gain: gain.add, pct: gain.pct, benefit: b0 * 1000 + gain.add, perGem: gain.add / Math.max(1, ro.need), ready: !ro.why });
      }
      cands.sort((a, b) => b.benefit - a.benefit || (b.m.level - a.m.level));
      const seen = new Set(), top = [];
      for (const c of cands) { if (seen.has(c.m.id)) continue; seen.add(c.m.id); top.push(c); if (top.length >= 3) break; }
      rows.push({ key, label: gemLabel(key), have: +have, top, more: cands.length - top.length, bestBenefit: top[0]?.benefit || 0 });
      for (const c of cands) if (c.ready) best.push({ ...c, key, label: gemLabel(key) });
    }
    rows.sort((a, b) => b.bestBenefit - a.bestBenefit);
    // the overall list: ready now, one line per Pokémon (its best gem), biggest benefit first
    best.sort((a, b) => b.benefit - a.benefit);
    const seenMon = new Set(), top5 = [];
    for (const c of best) { if (seenMon.has(c.m.uid)) continue; seenMon.add(c.m.uid); top5.push(c); if (top5.length >= 5) break; }
    const byTier = [0, 0, 0, 0]; for (const [k, n] of Object.entries(held)) byTier[+k.split(':')[1] || 0] += +n || 0;
    const v = { rows, top: top5, total: Object.values(held).reduce((t, n) => t + (+n || 0), 0), byTier, spent: +s.under?.gemsSpent || 0, max };
    gemCache = { at: Date.now(), v };
    return v;
  }
  // open a Pokémon's card in the game (its Team/PC sheet, UI.monDetail) and point at its rank-up
  // button. Stops there: pressing it (and choosing the gem) stays Jimmy's tap.
  async function openMon(uid) {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    if (!E.read('Game.getMon', null, uid)) return 'that Pokémon is gone';
    try { E.call('UI.monDetail', uid); } catch { return 'the game would not open that Pokémon'; }
    let modal = null;
    for (let i = 0; i < 30 && !modal; i++) { await sleep(100); modal = [...document.querySelectorAll('.modal.mon-modal')].filter((x) => x.getBoundingClientRect().width).pop() || null; }
    if (!modal) return 'the Pokémon card did not open';
    if (!document.getElementById('mega-pick-css')) {
      const c = document.createElement('style'); c.id = 'mega-pick-css';
      c.textContent = `.mega-pick{outline:4px solid var(--gold) !important;outline-offset:2px;box-shadow:0 0 0 8px color-mix(in srgb,var(--gold) 33%,transparent),0 0 24px var(--gold) !important;animation:megaPick 1.2s ease-in-out 6}
        @keyframes megaPick{50%{box-shadow:0 0 0 14px color-mix(in srgb,var(--gold) 13%,transparent),0 0 34px var(--gold)}}
        .mega-pick-tag{position:absolute;left:50%;top:-12px;transform:translateX(-50%);z-index:5;background:var(--gold);color:var(--on-gold);font:800 12px/1 Inter,system-ui,sans-serif;padding:4px 10px;border-radius:99px;white-space:nowrap;pointer-events:none}`;
      document.head.appendChild(c);
    }
    const btn = modal.querySelector('.rk-btn');
    if (!btn) return 'opened - this one has no rank-up button yet (it must be Lv 100)';
    btn.classList.add('mega-pick'); btn.style.position ||= 'relative';
    const tag = document.createElement('div'); tag.className = 'mega-pick-tag'; tag.textContent = 'Mega: rank up here'; btn.appendChild(tag);
    btn.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setTimeout(() => { btn.classList.remove('mega-pick'); tag.remove(); }, 60_000);
    return btn.disabled ? 'opened - the rank-up button is greyed out (see the card for why)' : 'opened - tap the highlighted Rank button in the game';
  }
  // a ranked-up Pokémon never evolves again (the game's own rule)
  const canEvolve = (id) => (E.get('EVOLUTIONS')?.[id] || []).length > 0;
  return { elite, gems, gemLabel, TIER, openMon, canEvolve, msg: '' };
})();

Views.elite = (esc, ui = {}) => {
  const d = EliteInfo.elite(), nm = (id) => esc(Engine.get('Game.DEX')?.[id]?.name || '#' + id);
  if (!d.on) return `<div class="note">Elite fights aren't open in this game yet.</div>`;
  if (!d.rows.length) return `<div class="note">No elite fights yet: they open for each legendary once you've caught it (and the Underground is unlocked).</div>`;
  const beaten = d.rows.reduce((t, r) => t + r.best, 0), total = d.rows.length * d.tiers.length;
  let h = `<div class="card"><h3>Elite Legendaries</h3>
    <div>${d.rows.length} legendaries · <b>${beaten}</b> of ${total} tiers beaten</div>
    <div class="dim" style="margin-top:6px">You must knock it out - no catching. Tiers unlock one after another and get harder: more HP and power, your status moves land less often, and its poison / burn hits harder. Tiers 1, 2 and 4 give a Legendary gem of its type (to rank up your legendaries of that type), 3 and 5 a frame. A lost fight is retried by the game itself, as often as it takes.</div>
    <div class="note dim" style="margin-top:8px">Odds come from the game's own battle engine (real tries played in a throwaway copy of your save). "Add: Beat Its Tiers" - Mega fights tier after tier, simulating each new tier first; a tier under 10% waits, and one not beaten in 15 min is set aside for 2 h so the next Elite goal can run. Your phone hears when one falls.</div></div>`;
  // Easiest Next Tier (Jimmy 2026-11-23, like the League screen): every legendary's next tier simulated in the
  // background, one at a time (~2 s each, kept 3 h), best odds first. Tap one to open it below.
  {
    const runs = EliteSim.leagueRunning, nx = d.rows.filter((r) => r.next);
    const rer = () => { const n = Date.now(); if (n - (Views.__elRer || 0) < 2500 && runs.size) return; Views.__elRer = n; setTimeout(() => { try { UI.refresh(); } catch (__e) { __h('63-eliteview:146', __e); } }, 0); };
    for (const r of nx) if (!EliteSim.legendFresh(r.id, r.next)) EliteSim.legendQueue(r.id, r.next, rer);
    if (nx.length) {
      const pctS = (x) => (x >= 0.995 ? '99+' : x > 0 && x < 0.01 ? '<1' : Math.round(x * 100)) + '%';
      const col = (x) => (x >= 0.6 ? 'var(--ok)' : x >= 0.25 ? 'var(--gold)' : 'var(--bad, #e66)');
      const rows = nx.map((r) => ({ r, s: EliteSim.legendFresh(r.id, r.next) })).sort((a, b) => (b.s ? b.s.ko : -1) - (a.s ? a.s.ko : -1));
      const done = rows.filter((x) => x.s).length, all = ui.eliteAll;
      const shown = all ? rows : rows.slice(0, 10);
      h += `<div class="card"><h3>Easiest Next Tier</h3>${done < rows.length ? `<div class="dim">Simulating… ${done} of ${rows.length} done</div>` : ''}
        ${shown.map(({ r, s }, i) => { const k = `L${r.id}:${r.next}`; const note = !r.open ? ' · closed now' : !r.can ? ' · locked for now' : ''; const rw = r.reward === 'gem' ? `${esc(EliteInfo.gemLabel(r.gem))} gem` : 'frame';
          return `<div data-act="elite-jump" data-id="${r.id}" style="display:flex;justify-content:space-between;gap:8px;margin-top:6px;cursor:pointer"><span>${i === 0 && s ? '⭐ ' : ''}<b>${nm(r.foe)}</b> tier ${r.next} <span class="dim" style="font-size:var(--t-s)">→ ${rw}${note}</span></span><span>${s ? `<b style="color:${col(s.ko)}">${pctS(s.ko)}</b>` : runs.has(k) ? `<span class="dim">${runs.get(k)}%…</span>` : '<span class="dim">waiting…</span>'}</span></div>`; }).join('')}
        ${rows.length > 10 ? `<button class="btn sm" data-act="elite-all" style="margin-top:8px">${all ? 'Show the Top 10' : `Show All ${rows.length}`}</button>` : ''}
        <div class="dim" style="margin-top:8px">The chance the best team Mega finds knocks it out (Elite rule: one Legendary per team). Sorted easiest first; tap one to open it below. Odds refresh every 3 h.</div></div>`;
    }
  }
  // one at a time, picked from a dropdown like the Legendary list (Jimmy 2026-11-21: no more scrolling).
  // Default: the first one with a tier left that's open now, else the first unfinished, else the first.
  const label = (r) => `${nm(r.foe)} · ${r.best}/${d.tiers.length} tiers${!r.next ? ' · done' : !(r.open && r.can) ? (r.open ? ' · locked for now' : ' · closed now') : Plan.goals.some((g) => !g.done && g.type === 'elite' && g.foe === r.id) ? ' · in your plan' : ''}`;
  const pick = d.rows.find((r) => r.id === +ui.elitePick) || d.rows.find((r) => r.next && r.open && r.can) || d.rows.find((r) => r.next) || d.rows[0];
  h += `<select class="sel" data-act="elite-pick" style="width:100%;margin:2px 0 10px">${d.rows.map((r) => `<option value="${r.id}" ${r === pick ? 'selected' : ''}>${label(r)}</option>`).join('')}</select>`;
  for (const r of [pick]) {
    const pips = d.tiers.map((t) => `<span style="display:inline-block;width:22px;height:8px;border-radius:4px;margin-right:3px;background:${t <= r.best ? 'var(--ok)' : t === r.next ? 'var(--gold)' : 'var(--line)'}"></span>`).join('');
    h += `<div class="card"><div style="display:flex;gap:12px;align-items:center">
      <img src="${Engine.sprite(r.foe)}" width="56" height="56" style="image-rendering:pixelated;background:var(--well);border-radius:12px;flex:none">
      <div style="flex:1;min-width:0"><div style="font-size:var(--t-m);font-weight:800">${nm(r.foe)}${r.foe !== r.id ? ` <span class="dim" style="font-size:var(--t-s)">(this week's form)</span>` : ''}</div>
      <div style="margin:4px 0">${pips} <span class="dim">${r.best}/${d.tiers.length}</span></div>
      ${r.next ? `<div>Next: <b>Tier ${r.next}</b> → ${r.reward === 'gem' ? `<span class="ok">${esc(EliteInfo.gemLabel(r.gem))} gem</span>` : 'a frame'}${r.open && r.can ? '' : ` <span class="warn">· ${r.open ? 'locked for now (recent loss)' : 'zone closed now'}</span>`}</div>` : '<div class="ok">All tiers beaten ✔</div>'}
      </div></div>
      ${r.next ? `<div class="dim" style="margin-top:6px">Tier ${r.next}: your status moves land ${Math.round((1 - (r.resist ?? 1)) * 100)}% less often · its poison / burn ticks take 1/${r.hurt ?? '?'} of its HP${r.hpX ? ` · HP ×${r.hpX.toFixed(1)}, power ×${r.powX.toFixed(1)} vs the catch fight` : ''}</div>` : ''}
      ${r.next ? (() => { const k = `L${r.id}:${r.next}`, sim = EliteSim.get(k), run = Views.__eliteRun?.[k];
        const inPlan = Plan.goals.some((g) => !g.done && g.type === 'elite' && g.foe === r.id);
        return `${run != null ? `<div style="margin-top:8px">Simulating tier ${r.next}… ${run}%</div>` : sim ? `<div style="margin-top:8px">Tier ${r.next} best team: <b>${Math.round(sim.ko * 100)}%</b> KO <span class="dim">· ${sim.uids.map((u) => { const m = Engine.read('Game.getMon', null, u); return m ? nm(m.id) : ''; }).filter(Boolean).join(', ')}</span></div>` : ''}
          <div class="tools" style="grid-template-columns:1fr 1fr"><button class="btn sm" data-act="elite-sim" data-id="${r.id}" data-tier="${r.next}" ${run != null ? 'disabled' : ''}>${sim ? 'Simulate Again' : `Simulate Tier ${r.next}`}</button>
          <button class="btn sm${sim && sim.ko >= 0.3 ? ' gold' : ''}" data-act="elite-add" data-id="${r.id}" ${inPlan ? 'disabled' : ''}>${inPlan ? 'In Your Plan' : 'Add: Beat Its Tiers'}</button></div>`; })() : ''}
      ${r.gem ? `<div class="dim" style="margin-top:4px">Its gem ranks up: ${r.users.length ? r.users.map(nm).join(', ') : '<i>none of your legendaries yet</i>'} · you hold ${r.gemHave}</div>` : ''}</div>`;
  }
  return h;
};

Views.gems = (esc) => {
  const g = EliteInfo.gems(), nm = (id) => esc(Engine.get('Game.DEX')?.[id]?.name || '#' + id);
  let h = `<div class="card"><h3>Gems</h3>
    <div><b>${g.total}</b> gems · ${EliteInfo.TIER.map((t, i) => `${t} ${g.byTier[i]}`).join(' · ')}${g.spent ? ` · ${g.spent} spent so far` : ''}</div>
    <div class="dim" style="margin-top:6px">A gem ranks up a Pokémon of its type and rarity: ×1.15 to every stat per rank (and it never evolves again), up to rank ${g.max} (about ×2). Rank 1 costs 1 gem, rank 2 costs 2, and so on. The Pokémon must be Lv 100, and it goes back to <b>Lv 5</b> - so spend them on the ones that fight the most, and plan to level them again.</div>
    <div class="note dim" style="margin-top:8px">Suggestions only - Mega doesn't spend gems. Strongest first: highest base stats get the gem, then the biggest stat gain.</div></div>`;
  if (EliteInfo.msg) h = `<div class="note" style="margin-bottom:8px">${esc(EliteInfo.msg)}</div>` + h;
  if (!g.rows.length) return h + `<div class="note">No gems yet. They come from the Underground and from elite legendary tiers 1, 2 and 4.</div>`;
  const role = (c) => (c.use >= 2 ? 'your team' : c.use ? 'a legend team' : '');
  if (g.top.length) {
    h += `<div class="card" style="border-color:var(--ok)"><h3>Strongest Get Stronger</h3><div class="dim" style="margin-bottom:4px">Ready to rank up today: highest base stats first, then the biggest stat gain. Ranking up sends it back to Lv 5</div>`;
    g.top.forEach((c, i) => {
      h += `<div style="display:flex;gap:10px;align-items:center;margin-top:8px"><b class="dim" style="width:18px">${i + 1}</b>
        <img src="${Engine.sprite(c.m.id)}" width="44" height="44" style="image-rendering:pixelated;flex:none">
        <div style="flex:1;min-width:0"><b>${nm(c.m.id)}${c.m.shiny ? ' ✨' : ''}</b> <span class="ok">+${c.gain} stats</span> <span class="dim">(+${Math.round(c.pct * 100)}%)</span>
        <div class="dim" style="font-size:var(--t-s)">rank ${c.m.rank || 0} → ${c.next} · ${c.need} ${esc(c.label)} gem${c.need > 1 ? 's' : ''}${role(c) ? ' · ' + role(c) : ''}</div>
        ${EliteInfo.canEvolve(c.m.id) ? `<div class="warn" style="font-size:var(--t-s)">⚠ won't evolve any more once ranked</div>` : ''}</div></div>
        <button class="btn${i === 0 ? ' gold' : ''}" data-act="gem-rank" data-uid="${c.m.uid}" data-key="${c.key}" data-rank="${c.m.rank || 0}" data-id="${c.m.id}" data-need="${c.need}" data-label="${esc(c.label)}" data-gain="${c.gain}" data-lv="${c.m.level}" data-ev="${EliteInfo.canEvolve(c.m.id) ? 1 : 0}">Rank Up (back to Lv 5)</button>
        <button class="btn" data-act="gem-open" data-uid="${c.m.uid}">Open in Game</button>`;
    });
    h += `</div>`;
  }
  // one line per gem, grouped by rarity (Jimmy 2026-11-23: a card each made this 29 screens long). The best
  // Pokémon for it is on the line; tap it to open that Pokémon in the game.
  const tierOf = (k) => +String(k).split(':')[1] || 0;
  for (let t = EliteInfo.TIER.length - 1; t >= 0; t--) {
    const R = g.rows.filter((r) => tierOf(r.key) === t); if (!R.length) continue;
    const held = R.filter((r) => +r.have > 0), none = R.filter((r) => !(+r.have > 0));
    const line = (r) => { const c = r.top[0];
      return `<div style="display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center;padding:5px 0;border-top:1px solid var(--line)"><div style="min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis"><b>${esc(r.label.split(' · ')[0])}</b> <span class="dim">×${r.have}</span>${c ? ` · <img src="${Engine.sprite(c.m.id)}" width="22" height="22" style="image-rendering:pixelated;vertical-align:middle"> ${nm(c.m.id)}${c.m.shiny ? ' ✨' : ''} <span class="dim">${c.m.rank ? RK(c.m.rank) : 'unranked'} → ${RK(c.next)}</span> <span class="${c.why ? 'dim' : 'ok'}" style="font-size:var(--t-s)">${c.why ? esc(c.why) : '✓ ready'}</span>${r.more + r.top.length > 1 ? ` <span class="faint" style="font-size:var(--t-s)">+${r.more + r.top.length - 1}</span>` : ''}` : ' <span class="faint">· nobody can use it yet</span>'}</div>${c ? `<button class="btn sm" data-act="gem-open" data-uid="${c.m.uid}" style="width:auto;margin:0">Open</button>` : ''}</div>`; };
    if (held.length) h += `<div class="card" data-sec="all"><h3>${esc(EliteInfo.TIER[t])} gems <span class="dim" style="font-weight:600">· ${held.length}</span></h3>${held.map(line).join('')}</div>`;
    if (none.length) h += `<div class="card" data-sec="none"><h3>${esc(EliteInfo.TIER[t])} gems you don't have <span class="dim" style="font-weight:600">· ${none.length}</span></h3>${none.map(line).join('')}</div>`;
  }
  return h;
};

// ---- the Simulate tab (was Legends): Legendary / Elite (Gems has its own tab) ----
{
  const legendary = Views.legends;
  Views.legends = (w, ui, esc) => {
    const mode = ui.mode || 'legendary';
    const MODES = [['legendary', 'Legendary'], ['elite', 'Elite'], ['league', 'Gyms & League']];
    const bar = `<div class="snav">${MODES.map(([k, l]) => `<button class="${mode === k ? 'on' : ''}" data-act="sim-mode" data-mode="${k}">${l}</button>`).join('')}</div>`;
    if (!w.ok) return bar + '<div class="note">Waiting for the game engine.</div>';
    // Sim › Elite (2.16.9, Jimmy 2026-11-25): everything Elite, as two cards - Elite Legendaries and Elite League,
    // each one card with its parts as sections. Sim › Gym / League keeps the story gyms only.
    const oneCard = (html, cls) => html.trim() ? `<div class="card ${cls}">${html.replace(/<div class="card"( data-sec="[^"]*")?( style="[^"]*")?>/g, '<div class="csec">')}</div>` : '';
    if (mode === 'elite') return bar + oneCard(Views.elite(esc, ui), 'elite-leg') + oneCard((() => { try { return Views.eliteLeague(esc); } catch { return ''; } })(), 'elite-lg');
    return bar + (mode === 'league' ? Views.league(esc) : legendary(w, ui, esc));
  };
}

/* ---------------------------------------------------------------------------------------------
 * GemFocus (Jimmy 2026-11-23): the Gems tab's planning tools.
 *  - Focus Pokémon: pick any of your Pokémon and see the gems it takes (its types, at its rarity's tier),
 *    what the next rank costs, what you have, how many to reach rank 5 - with Rank Up, Fuse and Buy buttons.
 *  - The gem shop today (the game's own offer, sold for event shards) and its reroll (₽, doubling).
 *  - Discord picks: the Discord's tier lists (@destryyy - "Legendary Gem Tier List" and "Rare & Uncommon
 *    Investment Tier List") checked against your copies - and a phone alert when the shop has a gem one of
 *    them needs and you have the shards for it.
 * The game's rules (read in its code): rank N costs N gems of one of the Pokémon's gem types (U.gemKeys), only at
 * Lv 100, and sends it back to Lv 5; fusing makes 1 gem from 3 of the tier below, but only up to Uncommon
 * (GEM_FUSE_TOP) - Rare and Legendary gems come from the Underground or the shop. Mega never spends gems, shards
 * or money by itself: every button here is your tap and asks first.
 * ------------------------------------------------------------------------------------------- */
const GemFocus = (() => {
  const E = Engine;
  const U = () => E.get('Underground');
  const TIER = ['Common', 'Uncommon', 'Rare', 'Legendary'];
  const MAX = () => +(E.get('CONFIG')?.UNDERGROUND?.RANK_MAX ?? 5);
  // the Discord's two gem tier lists (@destryyy, both rerun for game v0.5.161 on 2026-11-24, every Pokémon at
  // Lv 100 rank 5 in the game's own battle engine), in their order. Elite allows one Legendary, so the
  // legendary list fills that slot and the rare/uncommon list the other five.
  //  [name, list, tier/place, score or null, where it is strongest]
  const LEG = [
    ['White Kyurem', 'S', 1, null, '#1 overall'], ['Dialga', 'S', 2, null, 'leads Elite Leagues'], ['Reshiram', 'S', 3, null, ''], ['Black Kyurem', 'S', 4, null, ''],
    ['Kyogre', 'S', 5, null, ''], ['Ho-Oh', 'S', 6, null, 'leads Elite legendary fights'], ['Palkia', 'S', 7, null, ''],
    ['Giratina (Origin Forme)', 'A', 8, null, ''], ['Zekrom', 'A', 9, null, ''], ['Giratina', 'A', 10, null, ''], ['Regigigas', 'A', 11, null, ''], ['Arceus (Ice)', 'A', 12, null, ''],
    ['Groudon', 'A', 13, null, ''], ['Entei', 'A', 14, null, ''], ['Arceus (Dark)', 'A', 15, null, ''], ['Kyurem', 'A', 16, null, ''],
  ];
  const NON = [
    ['Metagross', 'Pseudo', 1, 79, 'Underground #2'], ['Garchomp', 'Pseudo', 2, 78, 'Underground #3'], ['Tyranitar', 'Pseudo', 3, 70, 'Elite #2'],
    ['Hydreigon', 'Pseudo', 4, 65, 'Elite #12'], ['Salamence', 'Pseudo', 5, 64, 'Underground #7'], ['Dragonite', 'Pseudo', 6, 61, 'Underground #11'],
    ['Slaking', 'Rare', 1, 92, 'Underground #1'], ['Gyarados', 'Rare', 2, 78, 'League #3'], ['Walrein', 'Rare', 3, 74, 'League #1'], ['Mamoswine', 'Rare', 4, 71, 'League #2'],
    ['Rhyperior', 'Rare', 5, 68, 'Elite #7'], ['Feraligatr', 'Rare', 6, 67, 'League #4'], ['Emboar', 'Rare', 7, 66, 'Elite #8'], ['Lapras', 'Rare', 8, 66, 'League #10'],
    ['Chandelure', 'Rare', 9, 65, 'Elite #1'], ['Glaceon', 'Rare', 10, 64, 'League #12'],
    ['Scrafty', 'Uncommon', 1, 61, 'Underground #15'], ['Escavalier', 'Uncommon', 2, 60, 'Elite #9'], ['Skuntank', 'Uncommon', 3, 53, 'Elite #3'], ['Golurk', 'Uncommon', 4, 52, 'Underground #36'],
    ['Dewgong', 'Uncommon', 5, 51, 'League #11'], ['Darmanitan', 'Uncommon', 6, 51, 'Underground #27'], ['Froslass', 'Uncommon', 7, 49, 'Elite #57'], ['Granbull', 'Uncommon', 8, 48, 'League #53'],
    ['Hariyama', 'Uncommon', 9, 48, 'Underground #26'], ['Gastrodon', 'Uncommon', 10, 48, 'League #45'],
  ];
  const tagOf = (r) => (r[1] === 'S' || r[1] === 'A' ? `${r[1]} tier · #${r[2]} of the legendaries` : `${r[1]} #${r[2]} · ${r[3]} pts`) + (r[4] ? ` · ${r[4]}` : '');
  // the Discord's top player (has cleared everything and every Elite tier) - his rank-5 picks, Jimmy 2026-11-23:
  // a tag on the ones the lists have, and listed last (after the lists) for the ones they don't
  const TOP = ['Skuntank', 'Venomoth', 'White Kyurem', 'Dialga', 'Metagross', 'Magcargo', 'Gardevoir'];
  const listed = new Set([...LEG, ...NON].map((r) => r[0]));
  const EXTRA = TOP.filter((n) => !listed.has(n)).map((n) => [n, 'Top', 0, 0, '']);
  const tagOf2 = (r) => (r[1] === 'Top' ? "the top player's rank-5 pick (not on the lists)" : tagOf(r));
  const WATCH = [...LEG, ...NON, ...EXTRA].map((r) => [r[0], tagOf2(r), r]);
  const nameOf = (id) => { try { return Casing.names(E.get('Game.DEX')[id].name); } catch { return '#' + id; } };
  const gems = () => E.get('Game.S')?.under?.gems || {};
  const tierOf = (k) => +String(k).split(':')[1] || 0;
  const typeOf = (k) => String(k).split(':')[0];
  const label = (k) => { try { return U().gemName(k); } catch { return `${TIER[tierOf(k)]} ${typeOf(k)} gem`; } };
  const owned = () => E.read('Game.ownedMons', []) || [];
  // a Pokémon on an expedition: the game can't rank it up (it answers "Not found.")
  const away = (m) => { try { return (E.read('Game.underMons', []) || []).some((x) => x.uid === m.uid); } catch { return false; } };
  // one Pokémon: its gem types, what it has, the next rank, and what rank 5 would take in all
  function status(m) {
    const u = U(), keys = (() => { try { return u.gemKeys(m.id) || []; } catch { return []; } })(), have = gems();
    const rank = +(m.rank || 0), max = MAX();
    const ro = (() => { try { return u.rankOf(m); } catch { return null; } })();
    let left = 0; for (let r = rank + 1; r <= max; r++) left += r;
    const best = keys.slice().sort((a, b) => (have[b] || 0) - (have[a] || 0))[0] || null;
    return { m, keys: keys.map((k) => ({ k, label: label(k), have: have[k] || 0, tier: tierOf(k) })), rank, max, next: ro?.next ?? rank + 1, need: ro?.need ?? rank + 1, why: rank >= max ? 'at the top rank' : away(m) ? 'in the Underground right now' : ro?.why || null, key: ro?.key || best, left, haveBest: best ? have[best] || 0 : 0 };
  }
  // fusing into one of this Pokémon's gem types: 3 of the tier below make 1 (only where the game allows it)
  function fuseFor(k) {
    const t = tierOf(k); if (t < 1) return null;
    const lower = `${typeOf(k)}:${t - 1}`;
    let to = null; try { to = U().fuseTo(lower); } catch (__e) { __h('63-gemfocus:68', __e); }
    if (to !== k) return { can: false, lower };
    const per = +(E.get('CONFIG')?.UNDERGROUND?.GEM_FUSE ?? 3), have = gems()[lower] || 0;
    return { can: true, lower, lowerLabel: label(lower), per, have, makes: Math.floor(have / per) };
  }
  const shop = () => { try { return U().offer(); } catch { return null; } };
  const price = (k) => { try { return +U().gemPrice(k); } catch { return null; } };
  const shards = () => { try { return +U().shards(); } catch { return 0; } };
  // your best copy of each Discord pick (highest rank, then level)
  function watchRows() {
    const all = owned(), out = [];
    for (const [n, tag, r] of WATCH) {
      const ms = all.filter((m) => nameOf(m.id) === n).sort((a, b) => (b.rank || 0) - (a.rank || 0) || b.level - a.level);
      if (ms.length) out.push({ ...status(ms[0]), tag: tag + (TOP.includes(n) && listed.has(n) ? " · top player's pick" : ''), name: n, leg: r[1] === 'S' || r[1] === 'A', list: r[1], place: r[2], pts: r[3] });
    }
    // the five other slots: best score first (the list's own order inside a tier)
    const leg = out.filter((x) => x.leg), non = out.filter((x) => !x.leg).sort((a, b) => b.pts - a.pts || a.place - b.place);
    return [...leg, ...non];
  }
  // the shop's gems that one of your Discord picks (still below rank 5) can use
  function shopHits() {
    const o = shop(); if (!o) return [];
    const want = new Map();
    for (const r of watchRows()) if (r.rank < r.max) for (const x of r.keys) { if (!want.has(x.k)) want.set(x.k, []); want.get(x.k).push(r.name); }
    return (o.ids || []).filter((k) => want.has(k)).map((k) => ({ k, label: label(k), price: price(k), mons: want.get(k), ok: shards() >= (price(k) || Infinity) }));
  }
  // the phone alert: once per shop offer and gem, when you can afford it
  const TOLD = 'mega-gemshop-told';
  function watchShop() {
    try {
      const o = shop(); if (!o) return;
      let told = {}; try { told = JSON.parse(localStorage.getItem(TOLD) || '{}'); } catch (__e) { __h('63-gemfocus:99', __e); }
      if (told.ends !== o.ends) told = { ends: o.ends, keys: [] };
      const fresh = shopHits().filter((h) => h.ok && !told.keys.includes(h.k));
      if (!fresh.length) return;
      for (const h of fresh) told.keys.push(h.k);
      localStorage.setItem(TOLD, JSON.stringify(told));
      const ends = new Date(o.ends).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
      // (Jimmy 2026-11-25: no phone alert for the gem shop - it stays on the Now screen and in Rank Up)
      Log.add(`gem shop: ${fresh.map((h) => `${h.label} for ${h.mons.join(', ')}`).join('; ')} - you can afford it`);
    } catch (__e) { __h('63-gemfocus:108', __e); }
  }
  let timer = null;
  function boot() { if (timer) return; timer = setInterval(watchShop, 5 * 60_000); setTimeout(watchShop, 30_000); }
  // the buttons (each asks first, in the UI)
  function fuse(k, n) { const f = fuseFor(k); if (!f?.can) return null; try { return U().fuseGems(f.lower, n); } catch { return null; } }
  function buy(k) { try { return U().buyGem(k, 1); } catch { return false; } }
  function reroll() { try { return U().reroll(); } catch { return { error: 'the game refused' }; } }
  // the menu: Discord picks first, then everyone by name
  function choices() {
    const picks = new Set(WATCH.map((x) => x[0]));
    return owned().map((m) => ({ uid: m.uid, name: nameOf(m.id), lv: m.level, rank: m.rank || 0, shiny: !!m.shiny, pick: picks.has(nameOf(m.id)) }))
      .sort((a, b) => (b.pick - a.pick) || a.name.localeCompare(b.name) || b.rank - a.rank || b.lv - a.lv);
  }
  return { status, fuseFor, shop, price, shards, watchRows, shopHits, watchShop, boot, fuse, buy, reroll, choices, label, TIER, nameOf };
})();

// ---- the Gems tab: Focus Pokémon, the shop, the Discord picks - above the gem lists that were already there ----
{
  const gemsView = Views.gems;
  Views.gems = (esc) => {
    const F = GemFocus, ui = Views.gemUi || (Views.gemUi = { focus: (() => { try { return localStorage.getItem('mega-gem-focus') || ''; } catch { return ''; } })() });
    const sp = (id, n = 44) => `<img src="${Engine.sprite(id)}" width="${n}" height="${n}" style="image-rendering:pixelated;flex:none">`;
    let h = '';
    // 1. Focus Pokémon
    const ch = F.choices();
    h += `<div class="card"><h3>🎯 Focus Pokémon</h3><select class="sel" data-act="gem-focus"><option value="">Pick one of your Pokémon…</option>${ch.map((c) => `<option value="${c.uid}" ${ui.focus === c.uid ? 'selected' : ''}>${c.pick ? '★ ' : ''}${esc(c.name)}${c.shiny ? ' ✨' : ''} · Lv ${c.lv} · rank ${c.rank}</option>`).join('')}</select><div class="dim" style="font-size:var(--t-s);margin-top:4px">★ = on the Discord's gem tier lists</div>`;
    const m = ui.focus ? Engine.read('Game.getMon', null, ui.focus) : null;
    if (m) {
      const s = F.status(m), o = F.shop() || { ids: [] };
      h += `<div style="display:flex;gap:10px;align-items:center;margin-top:10px">${sp(m.id, 56)}<div style="flex:1"><b style="font-size:var(--t-m)">${esc(F.nameOf(m.id))}${m.shiny ? ' ✨' : ''}</b><div class="dim">Lv ${m.level} · rank ${s.rank} of ${s.max} · ${s.rank < s.max ? `${s.left} more gems to reach rank ${s.max}` : 'top rank'}</div></div></div>`;
      if (!s.keys.length) h += `<div class="dim" style="margin-top:8px">This one can't take gems.</div>`;
      else {
        h += `<div style="margin-top:8px"><b>Takes:</b> ${s.keys.map((x) => `${esc(x.label)} <span class="${x.have ? 'ok' : 'dim'}">(you have ${x.have})</span>`).join(' or ')}</div>`;
        if (s.rank < s.max) {
          h += `<div style="margin-top:6px">Next: rank ${s.next} needs <b>${s.need}</b> of one of them · ${s.why ? `<span class="warn">${esc(s.why)}</span>` : '<span class="ok">✓ ready</span>'}</div>`;
          if (!s.why) h += `<button class="btn gold" data-act="gem-rank" data-uid="${m.uid}" data-key="${s.key}" data-rank="${s.rank}" data-id="${m.id}" data-need="${s.need}" data-label="${esc(F.label(s.key))}" data-lv="${m.level}">Rank Up to ${s.next} (${s.need} × ${esc(F.label(s.key))})</button>`;
        }
        for (const x of s.keys) {
          const f = F.fuseFor(x.k);
          if (f?.can) h += `<div style="margin-top:8px;border-top:1px solid var(--line);padding-top:6px"><b>Fuse</b> ${f.per} ${esc(f.lowerLabel)} → 1 ${esc(x.label)} · you have ${f.have} (makes up to ${f.makes})${f.makes ? (() => { const short = s.rank < s.max ? Math.max(0, s.need - x.have) : 0, enough = Math.min(f.makes, short); return `<div style="display:flex;gap:6px;margin-top:4px;flex-wrap:wrap"><button class="btn sm" data-act="gem-fuse" data-key="${x.k}" data-n="1" style="width:auto">Fuse 1</button>${enough > 1 && enough < f.makes ? `<button class="btn sm" data-act="gem-fuse" data-key="${x.k}" data-n="${enough}" style="width:auto">Fuse ${enough} (enough for rank ${s.next})</button>` : ''}${f.makes > 1 ? `<button class="btn sm" data-act="gem-fuse" data-key="${x.k}" data-n="${f.makes}" style="width:auto">Fuse All (${f.makes})</button>` : ''}</div>`; })() : ''}</div>`;
          else if (x.tier >= 2) h += `<div class="dim" style="margin-top:6px;font-size:var(--t-s)">${esc(x.label)}s can't be made by fusing - they come from the Underground (deeper floors) or the gem shop (${F.price(x.k) ?? '?'} shards).</div>`;
          if ((o.ids || []).includes(x.k)) h += `<div style="margin-top:6px"><span class="ok">In the shop today:</span> ${esc(x.label)} for ${F.price(x.k)} shards (you have ${F.shards()}) <button class="btn sm" data-act="gem-buy" data-key="${x.k}" ${F.shards() >= (F.price(x.k) || Infinity) ? '' : 'disabled'}>Buy 1</button></div>`;
        }
        h += `<button class="btn sm" data-act="gem-open" data-uid="${m.uid}" style="margin-top:8px">Open in Game</button>`;
      }
    }
    h += `</div>`;
    // 2. the shop today
    const o = F.shop();
    if (o) {
      const hits = new Map(F.shopHits().map((x) => [x.k, x]));
      h += `<div class="card"><h3>🛒 Gem Shop Today</h3><div class="dim">You have ${F.shards()} shards · changes ${new Date(o.ends).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</div>`;
      for (const k of o.ids || []) { const p = F.price(k), hit = hits.get(k); h += `<div class="row" style="align-items:center;margin-top:6px"><span>${esc(F.label(k))} · ${p} shards${hit ? ` <span class="ok">for ${esc(hit.mons.slice(0, 3).join(', '))}</span>` : ''}</span><button class="btn sm" data-act="gem-buy" data-key="${k}" style="width:auto;margin:0" ${F.shards() >= (p || Infinity) ? '' : 'disabled'}>Buy 1</button></div>`; }
      h += `<button class="btn sm" data-act="gem-reroll" style="margin-top:8px">New Offer (₽${(+o.cost || 0).toLocaleString()})</button><div class="dim" style="font-size:var(--t-s);margin-top:4px">Mega sends your phone a note when the shop has a gem one of the Discord picks needs and you can afford it. It never buys by itself.</div></div>`;
    }
    // 3. the Discord picks: the legendary slot, then the five others (best score first)
    const W = F.watchRows();
    if (W.length) {
      const row = (r) => {
        const st = r.rank >= r.max ? '<span class="ok">rank 5 ✓</span>' : r.why ? `<span class="dim">${esc(r.why)}</span>` : `<span class="ok">✓ ready for rank ${r.next}</span>`;
        return `<div style="display:flex;gap:8px;align-items:center;margin-top:6px">${sp(r.m.id, 36)}<div style="flex:1;min-width:0"><b>${esc(r.name)}</b> <span class="dim">· Lv ${r.m.level} · rank ${r.rank}</span><div class="dim" style="font-size:var(--t-s)">${esc(r.tag)}</div><div style="font-size:var(--t-s)">${r.keys.map((x) => `${esc(x.label)} ${x.have}`).join(' · ')} · ${st}</div></div><button class="btn sm" data-act="gem-focus-pick" data-uid="${r.m.uid}" style="width:auto;margin:0;flex:none">Focus</button></div>`;
      };
      // the next gems worth spending: the first picks (list order) that can rank up right now
      const ready = W.filter((r) => r.rank < r.max && !r.why);
      const gap = W.filter((r) => r.rank === 0 && r.m.level >= 100 && (r.leg ? r.list === 'S' : r.pts >= 70));
      h += `<div class="card"><h3>📋 Discord Picks</h3><div class="dim" style="margin-bottom:4px">The Discord's two gem tier lists (rerun for game v0.5.161, Nov 24): Elite allows one Legendary, so the legendary list fills that slot and the rare &amp; uncommon list the other five. Each rank costs its number in gems (rank 5 = 15 in all) and sends the Pokémon back to Lv 5.</div>`;
      if (ready.length) h += `<div style="margin-top:4px"><b class="ok">Ready now:</b> ${ready.slice(0, 4).map((r) => esc(r.name)).join(', ')}</div>`;
      if (gap.length) h += `<div style="margin-top:2px"><b class="warn">Top picks still at rank 0:</b> ${gap.slice(0, 5).map((r) => esc(r.name)).join(', ')}</div>`;
      // the list filter (Jimmy 2026-11-24): every tier, or one at a time
      const TIERS = [['', 'All tiers'], ['S', 'Legendary · Tier S'], ['A', 'Legendary · Tier A'], ['Pseudo', 'Pseudo-legendaries'], ['Rare', 'Top 10 Rare'], ['Uncommon', 'Top 10 Uncommon'], ['Top', "Top player's other picks"]];
      let tf = ''; try { tf = localStorage.getItem('mega-gem-tier') || ''; } catch (__e) { __h('63-gemfocus:179', __e); }
      if (!TIERS.some(([k]) => k === tf)) tf = '';
      const n = (k) => (k ? W.filter((r) => r.list === k).length : W.length);
      h += `<select class="sel" data-act="gem-tier" style="margin-top:8px">${TIERS.filter(([k]) => !k || n(k)).map(([k, t]) => `<option value="${k}" ${tf === k ? 'selected' : ''}>${t} (${n(k)})</option>`).join('')}</select>`;
      const Wf = tf ? W.filter((r) => r.list === tf) : W;
      const L = Wf.filter((r) => r.leg), N = Wf.filter((r) => !r.leg);
      if (L.length) h += `<div style="margin-top:10px"><b>👑 Your Legendary slot</b></div>` + L.map(row).join('');
      if (N.length) h += `<div style="margin-top:12px"><b>⚔️ Your 5 other Elite slots</b> <span class="dim">best score first</span></div>` + N.map(row).join('');
      h += `</div>`;
    }
    return h + gemsView(esc);
  };
}

/* ---------------------------------------------------------------------------------------------
 * Simulate → Gyms & League (read-only for now).
 *
 * Elite League (LegendZones.league*): once a region's League is won, its Elite Four + Champion can
 * be fought again in tiers 1-5, one after another. Tiers 3 and 5 give a frame; the others let you
 * pick a Legendary gem ("type:3") among the League's types (leaguePending = won, gem not picked).
 *
 * Story: the next chapter to beat is STORY's first one past S.adv.unlocked's region. Going to a new
 * "aside" region is a fresh start the game itself handles (money, items and team set aside, back
 * to ₽0 with an empty team, older Pokédexes hidden until that League is won) - Mega never does it.
 * Gym odds: GymPlan.estimate - the old helper's gym simulator (Sim.gymEval).
 * ------------------------------------------------------------------------------------------- */
const LeagueInfo = (() => {
  const E = Engine;
  const S = () => E.get('Game.S') || {}, D = () => E.get('Game.DEX') || {}, LZ = () => E.get('LegendZones'), ST = () => E.get('STORY');
  const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '');
  function league() {
    const lz = LZ(), tiers = E.get('CONFIG')?.ELITE?.TIERS || [1, 2, 3, 4, 5];
    if (!lz?.leagueOpen) return [];
    const pending = (() => { try { return lz.leaguePending() || []; } catch { return []; } })();
    return (ST().REGIONS || []).filter((r) => r?.key && r.dex).map((r) => {
      const k = r.key; let open = false, best = 0, next = 0, members = [], types = [];
      try { open = !!lz.leagueOpen(k); } catch (__e) { __h('64-leagueview:23', __e); }
      try { best = +lz.leagueBest(k) || 0; } catch (__e) { __h('64-leagueview:24', __e); }
      try { next = +lz.leagueNext(k) || 0; } catch (__e) { __h('64-leagueview:25', __e); }
      try { members = lz.leagueMembers(k) || []; } catch (__e) { __h('64-leagueview:26', __e); }
      try { types = lz.leagueTypes(k) || []; } catch (__e) { __h('64-leagueview:27', __e); }
      const frame = next ? (() => { try { return !!lz.leagueFrame(next); } catch { return false; } })() : false;
      return { key: k, name: cap(k), open, best, next, members, types, frame, tiers, pending: pending.filter((p) => p.reg === k).map((p) => p.tier) };
    }).filter((x) => x.open || x.best);
  }
  // Unova: some League foes change at night (the game picks the version when the League run is built)
  function nightNote(reg, esc) {
    try {
      const st = ST(), night = Sim.isNight(), nm = (id) => { try { return Casing.names(E.get('Game.DEX')[id].name); } catch { return '#' + id; } };
      const rows = (st.chaptersOf(reg) || []).map((ch) => { const g = (st.CHAPTERS[ch].steps || []).find((x) => x.kind === 'gym' && x.atNight); return g ? { ch, g } : null; }).filter(Boolean);
      if (!rows.length) return '';
      const say = rows.map(({ g }) => {
        const n = g.atNight;
        if (n.leader) return `${esc(g.leader)}'s fight is ${esc(n.leader)} at night`;
        const a = (g.team || []).map((x) => x[0]), b = (n.team || []).map((x) => x[0]), was = a.filter((x) => !b.includes(x)), is = b.filter((x) => !a.includes(x));
        return `${esc(g.leader)} uses ${is.map(nm).join(', ')} at night (${was.map(nm).join(', ')} by day)`;
      });
      return `<div class="dim" style="font-size:var(--t-s);margin-top:4px">🌙 ${say.join(' · ')}. Right now: <b>${night ? 'night' : 'day'}</b> version. The version is set when you enter the League.</div>`;
    } catch { return ''; }
  }
  // the next story gym: the frontier chapter's gym (with its team at the game's levels) and the cap
  function story() {
    const st = ST(), s = S(), ch = +(s.adv?.unlocked ?? 0), c = st?.CHAPTERS?.[ch];
    if (!c) return null;
    const reg = (() => { try { return st.regionOf(ch); } catch { return null; } })();
    const cur = (() => { try { return E.call('Game.currentRegion'); } catch { return null; } })();
    const gym = Sim.gymNow((c.steps || []).find((x) => x.kind === 'gym'), ch);
    let foes = []; try { if (gym) foes = st.gymTeam(ch, gym).map(([id, lv], i) => ({ uid: 'foe' + i, id, level: lv })); } catch (__e) { __h('64-leagueview:54', __e); }
    let capLv = null; try { capLv = st.capOf(ch); } catch (__e) { __h('64-leagueview:55', __e); }
    const travel = reg && cur && reg.key !== cur.key; // the frontier is in a region you haven't gone to
    let win = null;
    if (!travel && foes.length) { try { win = GymPlan.estimate(+ch, E.get('Game.S')?.team || [])?.p ?? null; } catch (__e) { __h('64-leagueview:58', __e); } }
    return { ch, chapter: c.name, reg, cur, gym, foes, cap: capLv, travel, win, aside: !!reg?.aside };
  }
  return { league, story, cap, nightNote };
})();

Views.league = (esc) => {
  const nm = (id) => esc(Engine.get('Game.DEX')?.[id]?.name || '#' + id);
  let h = '';
  // ---- story ----
  const s = LeagueInfo.story();
  if (s) {
    h += `<div class="card"><h3>Story · Next Gym</h3>`;
    if (s.travel) {
      h += `<div>Your next chapter is <b>${esc(s.chapter)}</b>, the start of <b>${esc(s.reg?.name || '?')}</b>. You're in ${esc(s.cur?.name || '?')}.</div>
        <div class="note" style="margin-top:8px">Going to ${esc(s.reg?.name || 'a new region')} is a fresh start the game handles itself: your money, items and team are set aside (you get them back when you switch sides), you start at ₽0 with an empty team and a new starter, and the earlier regions' Pokédexes are hidden until you win ${esc(s.reg?.name || 'its')} League. Mega never travels for you - do it from the game's map when you're ready.</div>`;
    } else if (s.gym) h += `<div><b>${esc(s.gym.leader || 'Gym Leader')}</b> · ${esc(s.chapter)}</div>`;
    if (s.gym) {
      h += `<div class="dim" style="margin-top:6px">${esc(Casing.title(s.gym.type || ''))} type · power ×${(+s.gym.power || 1).toFixed(2)}${s.cap ? ` · level cap ${s.cap}` : ''}${s.gym.byStarter ? ' · the leader depends on your starter' : ''}</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">${s.foes.map((f) => `<div style="text-align:center"><img src="${Engine.sprite(f.id)}" width="48" height="48" style="image-rendering:pixelated"><div style="font-size:var(--t-s)">${nm(f.id)}</div><div class="dim" style="font-size:var(--t-s)">Lv ${f.level}</div></div>`).join('')}</div>`;
      const pctB = (x) => `<b class="${x >= 0.6 ? 'ok' : x >= 0.3 ? 'warn' : 'bad'}">${Math.round(x * 100)}%</b>`;
      if (s.win != null) h += `<div style="margin-top:10px">Your current team vs ${esc(s.gym.leader ? Casing.names(String(s.gym.leader)) : 'the leader')}: ${pctB(s.win)} <span class="dim">at today's levels: half fresh, half after the trainers since the last Pokémon Center (HP carries over)</span></div>`;
      // what Mega is doing about it, in its own words (the "Beat the League" goal)
      const sg = (() => { try { return (Plan.goals || []).find((g) => !g.done && g.type === 'story') || null; } catch { return null; } })();
      const sl = sg ? (() => { try { return Plan.live(sg.id); } catch { return null; } })() : null;
      if (sl && (sl.line || sl.why)) h += `<div class="dim" style="margin-top:2px">Mega: ${esc(sl.line || sl.why)}</div>`;
      // the gym plan: best team from what you have + what you can catch, at the level cap
      if (!s.travel && s.foes.length) {
        const P = (() => { try { return GymPlan.get(s.ch); } catch { return null; } })(), B = (() => { try { return GymPlan.busy; } catch { return null; } })();
        let canTrain = false;
        const pct = (x) => `<b class="${x >= 0.6 ? 'ok' : x >= 0.3 ? 'warn' : 'bad'}">${Math.round(x * 100)}%</b>`;
        h += `<div class="note" style="margin-top:10px"><b>Gym plan</b> <span class="dim">· your Unova Pokémon and what you can catch, judged at the level cap${s.cap ? ' (Lv ' + s.cap + ')' : ''}</span>`;
        if (!P) h += `<div style="margin-top:6px">${B ? `Thinking… ${B.done} estimates so far` : 'Starting…'}</div>`;
        else {
          // only suggest a team when it's really better than the one you have (Jimmy: less training wins ties)
          const curSet = new Set(Engine.get('Game.S')?.team || []), same = P.plan.team.every((t) => t.kind === 'own' && curSet.has(t.uid));
          const keep = same || P.plan.ready && P.plan.team.every((t) => curSet.has(t.uid)) || (s.win != null && P.plan.win <= s.win + 0.03);
          if (keep) h += `<div style="margin-top:6px"><b>Suggestion:</b> <span class="ok">keep your current team</span> <span class="dim">- nothing you could train or catch does better</span></div>`;
          else h += `<div style="margin-top:6px"><b>A better team:</b> ${P.plan.ready ? `${pct(P.plan.win)} with no training` : `${P.today != null ? `${pct(P.today)} as they are today → ` : ''}${pct(P.plan.win)} once trained to Lv ${P.cap || s.cap}`}</div>`;
          // the old helper's bars: current team, suggested team today, suggested team at the cap - and how far the levelling is
          const bar = (label, x) => `<div style="display:flex;align-items:center;gap:8px;margin-top:6px"><span style="flex:0 0 44%;font-size:var(--t-s)">${label}</span><div class="bar" style="flex:1;margin:0"><i style="width:${Math.round((x || 0) * 100)}%;background:${x >= 0.6 ? 'var(--ok)' : x >= 0.3 ? 'var(--warn)' : 'var(--bad)'}"></i></div><b style="width:38px;text-align:right;font-size:var(--t-s)">${Math.round((x || 0) * 100)}%</b></div>`;
          if (P.plan.run && P.plan.run.survive != null) h += `<div class="dim" style="margin-top:4px">Run to the leader (suggested team): gets there ${pct(P.plan.run.survive)} of the time, with about ${pct(P.plan.run.arrive)} HP left</div>`;
          h += `<div style="margin-top:8px">${s.win != null ? bar('Your current team', s.win) : ''}${keep ? '' : bar('Suggested team (now)', P.plan.ready ? P.plan.win : (P.today ?? 0)) + bar(`Suggested team at Lv ${P.cap || s.cap}`, P.plan.win)}</div>`;
          const capM = (m) => { try { return +Engine.read('Game.capFor', 0, m) || P.cap || s.cap || 100; } catch { return P.cap || s.cap || 100; } };
          const planMons = P.plan.team.map((t) => (t.kind === 'own' ? Engine.read('Game.getMon', null, t.uid) : null)).filter(Boolean);
          const atCap = planMons.filter((m) => m.level >= capM(m)).length;
          canTrain = atCap < planMons.length;
          if (planMons.length && atCap < planMons.length && (sg?.levelFirst || !keep)) {
            h += `<div style="margin-top:10px"><b>Training to Lv ${P.cap || s.cap}:</b> ${atCap} of ${planMons.length} there${sg?.levelFirst ? ' <span class="dim">- then Mega tries again</span>' : ''}</div><div class="bar" style="margin-top:4px"><i style="width:${Math.round(atCap / planMons.length * 100)}%"></i></div>`;
            h += `<div class="dim" style="font-size:var(--t-s);margin-top:4px">${planMons.filter((m) => m.level < capM(m)).map((m) => `${nm(m.id)} ${m.level}/${capM(m)}`).join(' · ')}</div>`;
          }
          if (!keep) h += `<div class="grid" style="margin-top:8px">${P.plan.team.map((t) => {
            const own = t.kind === 'own' ? Engine.read('Game.getMon', null, t.uid) : null;
            const how = t.kind === 'catch' ? `catch ${nm(t.base)}<br><span class="dim">${esc(t.where || '')}</span>` : own && own.id !== t.id ? `your ${nm(own.id)} Lv ${own.level} → evolve` : own && s.cap && own.level < s.cap && !P.plan.ready ? `yours · level ${own.level} → ${s.cap}` : `<span class="ok">✓ ready${own ? ' · Lv ' + own.level : ''}</span>`;
            return `<div class="mon"><img src="${Engine.sprite(t.id)}" alt="">${nm(t.id)}<br><span style="font-size:var(--t-s)">${how}</span></div>`; }).join('')}</div>`;
          // the gym after: what to catch for it while you're in these chapters
          const nx = (() => { try { return GymPlan.nextGym(s.ch); } catch { return null; } })(), NP = nx != null ? (() => { try { return GymPlan.saved[nx] || null; } catch { return null; } })() : null;
          if (NP) { const c = NP.plan.team.filter((t) => t.kind === 'catch'); h += `<div style="margin-top:8px"><b>Next: ${esc(NP.gym)}</b> · best possible ${pct(NP.plan.win)}${c.length ? ` · catch ${c.map((t) => `${nm(t.base)} <span class="dim">(${esc(t.where || '')})</span>`).join(', ')}` : ' · nothing new to catch'}</div>`; }
          else if (nx != null) h += `<div class="dim" style="margin-top:8px">The gym after this one gets planned once this plan is ready.</div>`;
          h += `<div class="dim" style="margin-top:6px">Mega fights when your team wins 60% or more; below that it trains (or catches) toward this plan first. Win chances come from the old helper's gym simulator (300 fights each, Auto Switch, the leader's full power) - the one whose teams beat the last two gyms. Planned ${new Date(P.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.</div>`;
        }
        // the old helper's Next boss buttons: simulate (checks every Pokémon you have), go fight now, train these to the cap
        const on = (() => { try { return Plan.running && !sg?.paused; } catch { return false; } })();
        h += `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">
          <button class="btn" data-act="gymplan-run" data-ch="${s.ch}" ${B ? 'disabled' : ''}>${B ? 'Simulating…' : 'Simulate the Fight'}</button>
          ${sg ? `<button class="btn${sg.goFight ? '' : ' gold'}" data-act="gym-go" ${sg.goFight ? 'disabled' : ''}>${sg.goFight ? 'Fighting…' : 'Go Fight'}</button>` : ''}
          ${sg && canTrain ? `<button class="btn${sg.levelFirst ? '' : ' gold'}" data-act="gym-train">${sg.levelFirst ? 'Train These (training now)' : 'Train These'}</button>` : ''}</div>
          <div class="dim" style="font-size:var(--t-s);margin-top:4px">${sg?.goFight ? 'Going for the chapter and the leader now with the best team at today\'s levels. After 2 losses Mega goes back to leveling.' : sg?.levelFirst ? 'Leveling the planned team to the level cap, then Mega tries again by itself. Simulate the Fight changes who trains right away; Train These again sends the newest team in now.' : `Simulate the Fight checks every Pokémon you have. Go Fight: try the chapter and leader now.${canTrain ? ' Train These: level the planned team to the cap first.' : ' Everyone in the plan is at the level cap, so there is nothing to train.'}`}${sg && !on ? ' <span class="warn">The plan is paused - these start when it runs.</span>' : ''}</div></div>`;
      }
    }
    h += `</div>`;
  }
  // the recorder for the simulator rebuild: every real gym / League fight, as the game ran it
  { const n = (() => { try { return BossLog.count; } catch { return null; } })(), c = (() => { try { return BossLog.current; } catch { return null; } })();
    h += `<div class="card"><h3>Fight Recorder</h3><div>${c ? `<b class="ok">● Recording now:</b> ${esc(Casing.names(String(c.trainer || 'a boss')))}${c.replay ? ' (a replay)' : ''}` : 'Waiting for the next gym or League fight.'}</div><div class="dim" style="margin-top:4px">${n == null ? 'Counting…' : `${n} real fight${n === 1 ? '' : 's'} recorded so far`} - the leader's real team, levels and HP, your team, and the result. The new simulator has to match these before it's used.</div></div>`; }
  return h || `<div class="note">Nothing here yet.</div>`;
};

// Elite League (2.16.9, Jimmy 2026-11-25): moved to Sim › Elite - one card, below the Elite legendaries
Views.eliteLeague = (esc) => {
  let h = '';
  // ---- Elite League ----
  const L = LeagueInfo.league();
  if (L.length) {
    const won = L.reduce((t, r) => t + r.best, 0);
    h += `<div class="card"><h3>Elite League</h3><div>${won} of ${L.length * 5} tiers won</div>
      <div class="dim" style="margin-top:6px">Each region's Elite Four + Champion again at Lv 100, in tiers 1-5, one after another. <b>Every tier pays once: a Legendary gem</b> you pick from that League's types; tiers 3 and 5 also give a frame.</div>
      <div class="note dim" style="margin-top:8px">Every trainer Pokémon is ranked as high as the tier, and there's a Pokémon Center before each one - win all five in a row to win the tier. The odds below are whole League runs played in the game's own battle engine, with the best 6 Mega finds for that tier (any region's Pokémon can join). "Add: Win Its Tiers" fights tier after tier with that team, reminds you on your phone to pick each gem, and steps back if a tier is lost 10 times.</div></div>`;
    // the next tier of each League, easiest first (sims run one at a time; a sim is kept 3 h)
    const runs = EliteSim.leagueRunning, rer = () => { const n = Date.now(); if (n - (Views.__lgRer || 0) < 2000 && EliteSim.leagueRunning.size) return; Views.__lgRer = n; setTimeout(() => { try { UI.refresh(); } catch (__e) { __h('64-leagueview:147', __e); } }, 0); };
    const open = L.filter((r) => r.next);
    for (const r of open) if (!EliteSim.leagueFresh(r.key, r.next)) EliteSim.leagueQueue(r.key, r.next, rer);
    const pctS = (x) => (x >= 0.995 ? '99+' : x > 0 && x < 0.01 ? '<1' : Math.round(x * 100)) + '%';
    const col = (x) => (x >= 0.6 ? 'var(--ok)' : x >= 0.25 ? 'var(--gold)' : 'var(--bad, #e66)');
    if (open.length) {
      const rows = open.map((r) => ({ r, s: EliteSim.leagueFresh(r.key, r.next) })).sort((a, b) => (b.s ? b.s.ko : -1) - (a.s ? a.s.ko : -1));
      h += `<div class="card"><h3>Easiest Next Tier</h3>${rows.map(({ r, s }, i) => `<div style="display:flex;justify-content:space-between;gap:8px;margin-top:6px"><span>${i === 0 && s ? '⭐ ' : ''}<b>${esc(r.name)}</b> tier ${r.next}</span><span>${s ? `<b style="color:${col(s.ko)}">${pctS(s.ko)}</b>` : runs.has(`${r.key}:${r.next}`) ? `<span class="dim">simulating ${runs.get(`${r.key}:${r.next}`)}%…</span>` : '<span class="dim">waiting…</span>'}</span></div>`).join('')}
        <div class="dim" style="margin-top:8px">Chance to win all five fights with the best team Mega finds. Sorted easiest first.</div></div>`;
    }
    for (const r of L) {
      const pips = r.tiers.map((t) => `<span style="display:inline-block;width:22px;height:8px;border-radius:4px;margin-right:3px;background:${t <= r.best ? 'var(--ok)' : t === r.next ? 'var(--gold)' : 'var(--line)'}"></span>`).join('');
      h += `<div class="card"><div style="display:flex;justify-content:space-between;align-items:center"><b style="font-size:var(--t-m)">${esc(r.name)} League</b><span>${pips} <span class="dim">${r.best}/5</span></span></div>
        ${r.pending.length ? `<div class="warn" style="margin-top:6px">⚠ Tier ${r.pending.join(', ')} won - pick your gem in the game!</div>` : ''}
        ${r.next ? `<div style="margin-top:6px">Next: <b>Tier ${r.next}</b> → <span class="ok">a Legendary gem</span> of your choice: ${r.types.map((t) => esc(LeagueInfo.cap(t))).join(', ')}${r.frame ? ' + a frame' : ''}</div>` : '<div class="ok" style="margin-top:6px">All tiers won ✔</div>'}
        ${r.next ? (() => { const s = EliteSim.leagueFresh(r.key, r.next), k = `${r.key}:${r.next}`; const nm = (u) => { try { return Casing.names(Engine.get('Game.DEX')[Engine.read('Game.getMon', {}, u).id].name); } catch { return '?'; } };
          return s ? `<div style="margin-top:6px">Tier ${r.next} sim: <b style="color:${col(s.ko)}">${pctS(s.ko)}</b> to win all 5 <span class="dim">(${s.per.map((p) => `${esc(p.leader)} ${pctS(p.win)}`).join(' · ')})</span></div><div class="dim" style="font-size:var(--t-s);margin-top:2px">Team: ${s.uids.map((u) => esc(nm(u))).join(', ')}</div>`
            : `<div class="dim" style="margin-top:6px">Tier ${r.next} sim: ${runs.has(k) ? `simulating ${runs.get(k)}%…` : 'waiting for its turn…'}</div>`; })() : ''}
        <div class="dim" style="font-size:var(--t-s);margin-top:4px">${r.members.map((m) => `${esc(m.leader)}${m.champion ? ' (Champion)' : ''} · ${esc(LeagueInfo.cap(m.type || ''))}`).join(' · ')}</div>
        ${LeagueInfo.nightNote(r.key, esc)}
        ${r.next ? (() => { const inPlan = Plan.goals.some((g) => !g.done && g.type === 'league' && g.reg === r.key);
          return `<button class="btn${inPlan ? '' : ' gold'}" data-act="league-add" data-reg="${r.key}" ${inPlan ? 'disabled' : ''}>${inPlan ? 'In Your Plan' : 'Add: Win Its Tiers'}</button>`; })() : ''}</div>`;
    }
  }
  return h;
};

/* ---------------------------------------------------------------------------------------------
 * EliteSim: teams for the elite fights.
 *
 *  - Elite legendaries: Sim.search(foe, { tier }) - the legendary simulator with the game's elite
 *    settings for that tier. Saved per legendary + tier ("mega-elite-sims").
 *  - Elite League: each of the 5 trainers sends their League team at Lv MAX_LEVEL, every Pokémon
 *    ranked = the tier (the game: leagueElite node -> rank = elite = tier, full HP). Odds come from
 *    the game's own estimator, Adventure.winChance(team, foes, 'gym', field, power), multiplied over
 *    the five fights (you must win all five in a row). Any of your Pokémon may join (no region rule
 *    while no region link is active). The team: greedy - best 6 for that product, from your 30
 *    strongest.
 * ------------------------------------------------------------------------------------------- */
const EliteSim = (() => {
  const E = Engine, KEY = 'mega-elite-sims';
  const G = () => E.get('Game'), ST = () => E.get('STORY'), LZ = () => E.get('LegendZones');
  let saved = (() => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } })();
  const store = () => { try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch (__e) { __h('65-elitesim:17', __e); } };
  // 2.16.0: legendary tiers are scored in the game's own engine (GameSim); older saved odds came from Mega's
  // model (Rayquaza tier 4: 99.6% saved, 2% real) and are dropped - they're simulated again when needed
  const get = (k) => { const v = saved[k] || null; return v && k[0] === 'L' && !v.v2 ? null : v; };
  const put = (k, v) => { saved[k] = { ...v, at: Date.now() }; store(); return saved[k]; };
  const drop = (k) => { delete saved[k]; store(); };
  const yieldNow = () => new Promise((r) => setTimeout(r, 0));

  // ---- elite legendaries ----
  // 2.16.5: one legendary search at a time - each plays hundreds of fights in the game's engine on the page's
  // own thread, and eight at once dropped the game to ~9 frames a second
  let lq = Promise.resolve();
  function legend(foe, tier, opts = {}) { const p = lq.then(() => legendRun(foe, tier, opts)); lq = p.catch(() => {}); return p; }
  async function legendRun(foe, tier, opts = {}) {
    const r = await Sim.search(foe, { tier, asMax: !!opts.asMax, onProgress: opts.onProgress });
    return put(`L${foe}:${tier}`, { uids: r.team.map((m) => m.uid), ko: r.final.ko, today: r.today?.ko ?? r.final.ko, asMax: !!r.asMax, engine: !!r.engine, left: r.final.left ?? null, v2: true });
  }

  // ---- Elite League ----
  function members(reg) {
    const st = ST(), out = [];
    for (const ch of st.chaptersOf(reg) || []) {
      const c = st.CHAPTERS[ch]; if (!c?.league) continue;
      const step = (c.steps || []).find((x) => x.kind === 'gym'); if (!step) continue;
      const gym = Sim.gymNow(step, ch); // Unova: the night version when the League is entered at night
      let team = []; try { team = st.gymTeam(ch, gym); } catch (__e) { __h('65-elitesim:42', __e); }
      let field = 1; try { field = +E.call('Adventure.fieldSize', gym) || 1; } catch (__e) { __h('65-elitesim:43', __e); }
      out.push({ ch, leader: gym.leader, champion: !!gym.champion, type: gym.type, power: gym.power || 1, field, team, swaps: !!step.atNight, night: !!step.atNight && (gym.leader !== step.leader || JSON.stringify(gym.team) !== JSON.stringify(step.team)) });
    }
    return out;
  }
  // The game's quick estimator (Adventure.winChance) rates even the original Champion at 0% for a
  // Lv 100 team that has beaten him, so it doesn't describe real League fights: no odds here. The
  // League team is your strongest six (one per species, the stats each one uses), and the goal
  // learns from real results instead (the game retries a lost fight by itself).
  function leagueTeam(reg, tier) {
    const g = G();
    const useful = (m) => { try { const s = g.statsOf(m); return s.hp + s.def + s.spd + s.spe + Math.max(s.atk, s.spa); } catch { return 0; } };
    const away = new Set((E.read('Game.underMons', []) || []).map((m) => m.uid)), seen = new Set();
    const team = (g.S.mons || []).filter((m) => !away.has(m.uid)).sort((a, b) => useful(b) - useful(a))
      .filter((m) => { const sp = Sim.species(m); if (seen.has(sp)) return false; seen.add(sp); return true; }).slice(0, 6);
    return put(`G${reg}:${tier}`, { uids: team.map((m) => m.uid) });
  }
  // ---- Elite League with the gym simulator (2026-11-23) ----
  // The game (Adventure: league run): a Pokémon Center before every leader (full heal), then the leader's
  // League team at MAX_LEVEL, each Pokémon rank = elite = the tier, gym power x ELITE.LEAGUE.POWER[tier].
  // A tier is won only by beating all five in a row, so its chance = the product of the five fights.
  // Team: greedy (best sum, then best product) from your 18 strongest (one per species), then swaps.
  function leagueFights(reg, tier) {
    const st = ST(), C = E.get('CONFIG') || {}, MAX = +C.MAX_LEVEL || 100, PW = +(C.ELITE?.LEAGUE?.POWER?.[tier]) || 1, out = [];
    for (const ch of st.chaptersOf(reg) || []) {
      const c = st.CHAPTERS[ch]; if (!c?.league) continue;
      const step = (c.steps || []).find((x) => x.kind === 'gym'); if (!step) continue;
      const gym = Sim.gymNow(step, ch) || step;
      const foes = (gym.team || []).map(([id], i) => ({ uid: `lg${ch}_${i}`, id: +id, level: MAX, rank: tier, elite: tier }));
      if (foes.length) out.push({ ch, leader: gym.leader || gym.name || 'Leader', champion: !!gym.champion, gym: { ...gym, power: (+gym.power || 1) * PW }, foes });
    }
    return out;
  }
  async function leagueSim(reg, tier, opts = {}) {
    const g = G(), fights = leagueFights(reg, tier); if (!fights.length) throw new Error('no League found for ' + reg);
    const useful = (m) => { try { const s = g.statsOf(m); return s.hp + s.def + s.spd + s.spe + Math.max(s.atk, s.spa); } catch { return 0; } };
    const away = new Set((E.read('Game.underMons', []) || []).map((m) => m.uid)), seen = new Set();
    const fresh = (m) => { const c = { ...m }; delete c.hp; delete c.curHp; return c; };
    const pool = (g.S.mons || []).filter((m) => !away.has(m.uid) && m.level >= 30).sort((a, b) => useful(b) - useful(a))
      .filter((m) => { const sp = Sim.species(m); if (seen.has(sp)) return false; seen.add(sp); return true; }).slice(0, opts.pool || 18).map(fresh);
    if (!pool.length) throw new Error('no Pokémon to send');
    const each = (team, runs) => fights.map((f) => Sim.gymEval(team, f.foes, f.gym, runs).win);
    const rate = (w) => ({ prod: w.reduce((a, b) => a * b, 1), sum: w.reduce((a, b) => a + b, 0) });
    const better = (a, b) => a.prod > b.prod + 1e-9 || (Math.abs(a.prod - b.prod) <= 1e-9 && a.sum > b.sum + 1e-9);
    let team = [], best = null, done = 0;
    const total = 6 * pool.length + 2 * 6 * pool.length;
    const tick = async () => { done++; if (done % 3 === 0) { opts.onProgress?.(Math.min(0.99, done / total)); await yieldNow(); } };
    // greedy: add the Pokémon that helps most, slot by slot
    while (team.length < Math.min(6, pool.length)) {
      let pick = null, pr = null;
      for (const m of pool) { if (team.includes(m)) continue; const r = rate(each([...team, m], 24)); if (!pr || better(r, pr)) { pick = m; pr = r; } await tick(); }
      team.push(pick); best = pr;
    }
    // swaps: try every outside Pokémon in every slot, keep any that raises the odds (2 passes)
    for (let pass = 0; pass < 2; pass++) {
      let moved = false;
      for (let i = 0; i < team.length; i++) for (const m of pool) {
        if (team.includes(m)) continue;
        const t2 = team.slice(); t2[i] = m; const r = rate(each(t2, 24));
        if (better(r, best)) { team = t2; best = r; moved = true; }
        await tick();
      }
      if (!moved) break;
    }
    // 2.16.3: the game's own engine has the last word - whole League runs played in a sandboxed copy. The
    // model's team is the start; swaps with the strongest outsiders are kept when the real runs say so.
    try {
      if (typeof GameSim !== 'undefined') {
        const N = fights.length, uidsOf = (t) => t.map((m) => m.uid);
        const sc = (r) => r.ko + 0.02 * r.per.reduce((a, b) => a + (b || 0), 0);
        let cur = { team, r: await GameSim.league(reg, tier, uidsOf(team), 24, N) };
        const outs = pool.filter((m) => !team.includes(m)).slice(0, 8);
        for (let pass = 0; pass < 2; pass++) {
          let moved = false;
          for (let i = 0; i < cur.team.length; i++) for (const m of outs) {
            if (cur.team.includes(m)) continue;
            const t2 = cur.team.slice(); t2[i] = m;
            const q = await GameSim.league(reg, tier, uidsOf(t2), 10, N); if (sc(q) < sc(cur.r) - 0.05) continue;
            const r = await GameSim.league(reg, tier, uidsOf(t2), 24, N); if (sc(r) > sc(cur.r) + 0.02) { cur = { team: t2, r }; moved = true; }
          }
          if (!moved) break;
        }
        const fin = await GameSim.league(reg, tier, uidsOf(cur.team), 100, N);
        opts.onProgress?.(1);
        return put(`G${reg}:${tier}`, { uids: uidsOf(cur.team), ko: fin.ko, per: fights.map((f, i) => ({ leader: f.leader, champion: f.champion, win: fin.per[i] ?? 0 })), sim: 2, engine: true });
      }
    } catch (e) { try { Log.add(`Elite League sim in the game's engine failed (${e?.message || e}) - using Mega's own model`); } catch (__e) { __h('65-elitesim:129', __e); } }
    // the final odds with more runs (Mega's own model - only if the engine couldn't run)
    const wins = each(team, 160), fin = rate(wins);
    opts.onProgress?.(1);
    return put(`G${reg}:${tier}`, { uids: team.map((m) => m.uid), ko: fin.prod, per: fights.map((f, i) => ({ leader: f.leader, champion: f.champion, win: wins[i] })), sim: 2, engine: false });
  }
  // a saved League sim from the gym simulator, if under 3 h old (levels / ranks change)
  const leagueFresh = (reg, tier) => { const r = get(`G${reg}:${tier}`); return r && r.sim === 2 && 'engine' in r && Date.now() - (r.at || 0) < 3 * 3600e3 ? r : null; };
  // one League sim at a time, for the League screen and the goal (the goal's own sims go through here too)
  let queue = Promise.resolve();
  const running = new Map(), failed = new Map(); // "reg:tier" -> progress 0-100 / when it last failed
  function leagueQueue(reg, tier, onChange) {
    const k = `${reg}:${tier}`; if (running.has(k) || Date.now() - (failed.get(k) || 0) < 10 * 60e3) return;
    running.set(k, 0); onChange?.();
    queue = queue.then(() => leagueSim(reg, tier, { onProgress: (p) => { const v = Math.round(p * 100); if (v !== running.get(k)) { running.set(k, v); onChange?.(); } } })
      .then((r) => { try { Log.add(`Elite League ${reg} tier ${tier}: best team ${Math.round(r.ko * 100)}% to win all 5 (${r.per.map((p) => `${p.leader} ${Math.round(p.win * 100)}%`).join(', ')})`); } catch (__e) { __h('65-elitesim:144', __e); } })
      .catch((e) => { failed.set(k, Date.now()); try { Log.add(`Elite League sim failed: ${e?.message || e}`); } catch (__e) { __h('65-elitesim:145', __e); } })
      .finally(() => { running.delete(k); onChange?.(); }));
  }
  // the same for elite legendaries (the Elite screen's "Easiest Next Tier"): one search at a time, kept 3 h
  const legendFresh = (id, tier) => { const r = get(`L${id}:${tier}`); return r && Date.now() - (r.at || 0) < 3 * 3600e3 ? r : null; };
  function legendQueue(id, tier, onChange) {
    const k = `L${id}:${tier}`; if (running.has(k) || Date.now() - (failed.get(k) || 0) < 10 * 60e3) return;
    running.set(k, 0); onChange?.();
    queue = queue.then(() => legend(+id, +tier, { onProgress: (p) => { const v = Math.round(p * 100); if (v !== running.get(k)) { running.set(k, v); onChange?.(); } } })
      .catch((e) => { failed.set(k, Date.now()); try { Log.add(`Elite sim failed (#${id} tier ${tier}): ${e?.message || e}`); } catch (__e) { __h('65-elitesim:154', __e); } })
      .finally(() => { running.delete(k); onChange?.(); }));
  }
  return { get, put, drop, legend, members, leagueTeam, leagueSim, leagueFights, leagueFresh, leagueQueue, legendFresh, legendQueue, leagueRunning: running };
})();

/* ---------------------------------------------------------------------------------------------
 * Berries: keeps the right boost going while a goal runs. From CONFIG.BUFF_BERRIES (family, mult,
 * rank). One at a time per family, only when none is active (or it has < 2 min left), and never
 * replacing a stronger berry of the same family. Every berry used is logged with how many are left.
 * Families: capture (Razz / Golden Razz) · dex (Enigma) · rare (Nanab) · xp (Pinap) ·
 *           money (Lansat) · shiny (Starf) · roam (Rowap)
 * ------------------------------------------------------------------------------------------- */
const Berries = (() => {
  const E = Engine;
  const KEY = 'mega-berries';
  let on = (() => { try { return JSON.parse(localStorage.getItem(KEY) ?? 'true'); } catch { return true; } })();
  const out = new Set(); // families we already said are out of stock
  // per berry (stdAri's idea): on/off, and how many to keep - Mega never uses one below that number
  const PKEY = 'mega-berry-prefs';
  let prefs = (() => { try { return JSON.parse(localStorage.getItem(PKEY) || '{}') || {}; } catch { return {}; } })();
  const savePrefs = () => { try { localStorage.setItem(PKEY, JSON.stringify(prefs)); } catch (__e) { __h('66-berries:16', __e); } };
  const pref = (k) => ({ off: !!prefs[k]?.off, keep: Math.max(0, +prefs[k]?.keep || 0) });
  function setPref(k, { off, keep } = {}) {
    if (!all()[k]) return false;
    const p = { ...pref(k) }; if (off != null) p.off = !!off; if (keep != null) p.keep = Math.max(0, Math.min(9999, Math.round(+keep || 0)));
    prefs[k] = p; savePrefs(); out.clear(); return true;
  }
  // for the Settings card / phone: every boost berry with its family, stock, setting and whether it's running now
  function list() {
    return Object.entries(all()).map(([k, v]) => ({ key: k, family: v.family, mult: v.mult, have: +E.read('Game.itemCount', 0, k) || 0, ...pref(k), active: active(v.family)?.key === k }))
      .sort((a, b) => a.family.localeCompare(b.family) || (a.mult - b.mult));
  }
  const all = () => E.get('CONFIG')?.BUFF_BERRIES || {};
  const label = (k) => (all()[k]?.name ? `${k.replace(/-/g, ' ')}` : k.replace(/-/g, ' '));
  // the family's berries, strongest first (or weakest first), and which of them Mega may use right now:
  // in stock above the number you keep, switched on, and never weaker than one already running
  const order = (fam, strongest = true) => Object.entries(all()).filter(([, v]) => v.family === fam).sort((x, y) => (strongest ? 1 : -1) * ((y[1].rank || 0) - (x[1].rank || 0)) || (strongest ? y[1].mult - x[1].mult : x[1].mult - y[1].mult));
  function usable(fam, strongest = true, a = active(fam)) {
    const aRank = a ? all()[a.key]?.rank || 0 : -1;
    return order(fam, strongest).filter(([key, v]) => {
      if (a && (v.rank || 0) < aRank) return false;
      const have = +E.read('Game.itemCount', 0, key) || 0, p = pref(key);
      return have > 0 && !p.off && have > p.keep;
    }).map(([key]) => key);
  }
  function active(fam) { return (E.read('Game.activeBuffs', []) || []).find((b) => b.family === fam) || null; }
  // returns a short status like " · Pinap 42 min", or '' when off / nothing to show
  function keep(fam, why, { strongest = true } = {}) {
    if (!on) return '';
    const a = active(fam);
    if (a && a.left > 120_000) return ` · ${Casing.title(label(a.key))} ${Math.ceil(a.left / 60_000)} min left`;
    const ber = order(fam, strongest);
    for (const key of usable(fam, strongest, a)) {
      const have = +E.read('Game.itemCount', 0, key) || 0;
      try { E.call('Game.useBuffBerry', key); } catch (__e) { __h('66-berries:50', __e); }
      const now = active(fam);
      if (now && now.left > 120_000) { out.delete(fam); Log.add(`used ${/^[aeiou]/i.test(label(key)) ? 'an' : 'a'} ${Casing.title(label(key))} (${why}) - ${have - 1} left`); return ` · ${Casing.title(label(key)).replace(/ Berry$/, '')} ${Math.ceil(now.left / 60_000)} min`; }
    }
    if (ber.length && !out.has(fam)) {
      out.add(fam);
      const held = ber.filter(([k]) => { const p = pref(k); return p.off || (+E.read('Game.itemCount', 0, k) || 0) > 0; });
      Log.add(held.length ? `not using ${fam === 'capture' ? 'Razz' : Casing.title(label(ber[0][0]))} berries for ${why}: switched off or down to the number you keep (Settings › Berries)` : `no ${fam === 'capture' ? 'Razz' : Casing.title(label(ber[0][0]))} berries left for ${why}`);
    }
    return '';
  }
  return { keep, active, list, setPref, pref, usable, get on() { return on; }, set(v) { on = !!v; try { localStorage.setItem(KEY, JSON.stringify(on)); } catch (__e) { __h('66-berries:61', __e); } } };
})();

/* ===================================================================================================
 * GymPlan - the team that beats the next gym of a region run (Unova), and how to get it.
 *
 * Scored with the game's own estimate (Adventure.winChance, the same one its gym screen uses). Pool:
 *   - your Pokémon on that region's side, at the level cap and evolved as far as the cap allows
 *   - every species you can catch in that region's unlocked chapters, the same way
 * A search (best single matchups first, then swapping members and order) finds the best 6. The result
 * says, per member: already yours / catch it in chapter X / level it (and evolve) to the cap.
 * It runs in small slices so the game never freezes, and is kept per gym until your side changes.
 * =================================================================================================== */
const GymPlan = (() => {
  const E = Engine, KEY = 'mega-gymplan';
  const S = () => E.get('Game.S') || {}, D = () => E.get('Game.DEX') || {}, ST = () => E.get('STORY');
  const safe = (f, d = null) => { try { const v = f(); return v === undefined ? d : v; } catch { return d; } };
  let saved = {}; try { saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (__e) { __h('66-gymplan:15', __e); }
  const keep = () => { try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch (__e) { __h('66-gymplan:16', __e); } };
  let busy = null; // { ch, done, total }

  function gymOf(ch) {
    const st = ST(), c = st?.CHAPTERS?.[ch]; if (!c) return null;
    const gym = Sim.gymNow((c.steps || []).find((x) => x.kind === 'gym'), ch); if (!gym) return null; // night version at night
    let foes = []; try { foes = st.gymTeam(ch, gym).map(([id, lv], i) => ({ uid: 'foe' + i, id: +id, level: +lv })); } catch (__e) { __h('66-gymplan:22', __e); }
    const cap = safe(() => +st.capOf(ch), null);
    // the stretch: trainers between the chapter's last Pokémon Center and the gym. There's no heal before the
    // leader, so the team arrives worn down - each trainer is modelled as 2 of the chapter's own Pokémon
    const steps = c.steps || [], gi = steps.findIndex((x) => x.kind === 'gym'), hi = steps.slice(0, gi).map((x) => x.kind).lastIndexOf('heal');
    let trainers = steps.slice(hi + 1, gi).reduce((n, x) => n + (+x.trainers || 0) + (x.kind === 'trainer' ? 1 : 0), 0);
    // in the chapter you're playing, the game's real map is better than the outline (it can place more trainers)
    const adv = E.get('Game.S')?.adv, nodes = adv && +adv.chapter === +ch ? adv.nodes || [] : null;
    if (nodes?.length) { const gn = nodes.findIndex((x) => x.type === 'gym'), hn = nodes.slice(0, gn).map((x) => x.type).lastIndexOf('heal'); if (gn > 0) trainers = nodes.slice(hn + 1, gn).filter((x) => x.type === 'trainer').length; }
    const pool = (safe(() => Sim.chapterPool(ch), []) || []).slice().sort((a, b) => b.w - a.w);
    const stretch = []; for (let i = 0; pool.length && i < trainers * 2; i++) { const p = pool[i % pool.length]; stretch.push({ uid: 'way' + i, id: +p.id, level: +p.lv }); }
    // the chapter's 5 most common wild Pokémon (the old helper's rule): the team has to get through them too
    const route = pool.slice(0, 5).map((p, i) => ({ uid: 'wild' + i, id: +p.id, level: +p.lv }));
    // the run to the leader as the game plays it (HP carries over, no heal): trainers, berry trees (+25%) and the
    // game's gym trainers (CONFIG.GYM_TRAINERS: 1-3 of them, the leader's type, ace level minus 4/2/2, damage x0.8)
    const GT = E.get('CONFIG')?.GYM_TRAINERS || {}, pick2 = (pl, lv, tag) => {
      const ps = (pl || []).slice().sort((a, b) => (b.w || 0) - (a.w || 0)).slice(0, 2);
      return ps.map((p, i) => ({ uid: tag + i, id: +p.id, level: +(lv ?? p.lv ?? p.min) || 50 }));
    };
    const chain = [];
    const gnLive = nodes?.length ? nodes.findIndex((x) => x.type === 'gym') : -1;
    if (gnLive > 0) {
      const gn = gnLive, hn = nodes.slice(0, gn).map((x) => x.type).lastIndexOf('heal');
      nodes.slice(hn + 1, gn).forEach((x, k) => {
        if (x.type === 'berry') chain.push({ berry: true });
        else if (x.type === 'trainer') { const f = pick2(x.pool?.length ? x.pool : pool, x.lv?.[0], 'n' + k); if (f.length) chain.push({ foes: f, plain: x.gymTrainer ? +GT.damage || 0.8 : 1 }); }
        else if (x.type === 'wild' && x.pool?.length) { // a wild Pokémon on the way: one foe, ENEMY_DAMAGE.wild
          const p = x.pool.slice().sort((a, b) => (b.w || 0) - (a.w || 0))[0], ED = E.get('CONFIG')?.ENEMY_DAMAGE || {};
          chain.push({ foes: [{ uid: 'w' + k, id: +p.id, level: Math.round(((+p.min || 50) + (+p.max || +p.min || 50)) / 2) }], plain: (+ED.wild || 0.85) / (+ED.trainer || 0.9) });
        }
      });
    } else {
      for (let i = 0; i < trainers; i++) { const f = pick2(pool.slice(i % Math.max(1, pool.length)), null, 'w' + i); if (f.length) chain.push({ foes: f, plain: 1 }); }
      const ace = safe(() => +st.aceOf(ch), null), counts = GT.counts || [], below = GT.below || [];
      if (ace && counts.length && !gym.champion && !c.league) {
        const nth = safe(() => st.chaptersOf(st.regionOf(ch).key).filter((x) => x < ch && st.CHAPTERS[x].steps.some((y) => y.kind === 'gym' && y.badge)).length, 0);
        const n = nth > 0 ? counts[Math.min(nth, counts.length) - 1] || 0 : 0; // the game: counts[min(n, len) - 1] - none before a region's first gym
        for (let k = 0; k < n; k++) { const lv = ace - (below[Math.min(k, below.length - 1)] || 0); chain.push({ foes: foes.slice(0, 2).map((f, i) => ({ uid: 'g' + k + i, id: f.id, level: lv })), plain: +GT.damage || 0.8 }); }
      }
    }
    return { ch, gym, foes, stretch, route, trainers, chain, cap, name: gym.leader || 'Gym Leader', chapter: c.name, power: +gym.power || 1 };
  }
  // the species a Pokémon becomes by levelling to `lv` (level evolutions only)
  function evolveTo(id, lv) {
    const EV = E.get('EVOLUTIONS') || {}; let cur = +id;
    for (let i = 0; i < 3; i++) { const nx = (EV[cur] || []).find((e) => e.level && e.level <= lv && !e.item); if (!nx) break; cur = +nx.to; }
    return cur;
  }
  const fam = (id) => safe(() => [...(E.read('Game.familyOf', [], id) || [])].map(Number), [+id]);
  const winRaw = (team, foes, power) => safe(() => +E.call('Adventure.winChance', team, foes, 'gym', 1, power) || 0, 0);
  // ---- the game's Auto Switch: in a real fight the healthy Pokémon with the best matchup against the foe on the
  // field goes out (slot order only breaks ties). The game's estimate fights in slot order, which under-rates
  // teams built on matchups (9% vs 78% for the team that beat Brycen). So Mega also scores the lineup Auto Switch
  // would make: for each foe in turn, its best still-free counter goes next. The better of the two counts.
  let duel1 = new Map(); // 1-on-1 scores, kept for one plan run
  const one = (a, f) => { const k = `${a.uid}:${a.id}:${a.level}|${f.id}:${f.level}`; if (!duel1.has(k)) duel1.set(k, winRaw([a], [f], 1)); return duel1.get(k); };
  function autoOrder(team, foes) {
    const left = [...team], out = [];
    for (const f of foes) { if (!left.length) break; left.sort((a, b) => one(b, f) - one(a, f)); out.push(left.shift()); }
    return [...out, ...left];
  }
  const win = (team, foes, power) => (team.length > 1 && foes.length ? Math.max(winRaw(team, foes, power), winRaw(autoOrder(team, foes), foes, power)) : winRaw(team, foes, power));
  // ---- how much of a gym's power bonus the estimate should apply. The simulation already makes gyms harder
  // (its gym edge), so the full bonus on top double-counts (every team read 0% against Brycen's 1.2, then a
  // Lv 53 team beat him). Mega starts at 3/4 of the bonus and learns from your real gym fights: a win the
  // estimate called unlikely lowers it, a loss it called likely raises it.
  const CAL = 'mega-gym-k';
  const calib = () => { try { return JSON.parse(localStorage.getItem(CAL) || 'null') || { k: 0.75, n: 0, log: [] }; } catch { return { k: 0.75, n: 0, log: [] }; } };
  const effP = (P) => 1 + (P - 1) * calib().k;
  function learn(fight, won) {
    const c = calib(), before = c.k;
    c.k = Math.max(0.2, Math.min(1.2, c.k + 0.15 * ((fight.p || 0) - (won ? 1 : 0))));
    c.n++; c.log = [...(c.log || []), { at: Date.now(), gym: fight.gym, p: Math.round((fight.p || 0) * 100), won: !!won, k: Math.round(c.k * 100) / 100 }].slice(-30);
    try { localStorage.setItem(CAL, JSON.stringify(c)); } catch (__e) { __h('66-gymplan:95', __e); }
    try { Log.add(`gym estimate: ${won ? 'won' : 'lost'} against ${fight.gym} (estimate was ${Math.round((fight.p || 0) * 100)}%) - power weighting ${before.toFixed(2)} → ${c.k.toFixed(2)}`); } catch (__e) { __h('66-gymplan:96', __e); }
    if (fight.ch != null && saved[fight.ch]) saved[fight.ch].at = 0; // re-plan that gym with the new weighting (not every saved plan)
  }
  // the estimate for a team you're sending in right now (used when a gym fight starts)
  // (kept a minute per chapter + team + time of day: the League tab redraws every 2 s)
  const estMemo = new Map();
  function estimate(ch, uids) {
    const night = safe(() => Sim.isNight(), false), mons0 = (uids || []).map((u) => E.read('Game.getMon', null, u)).filter(Boolean);
    const key = `${ch}|${night}|${mons0.map((m) => m.uid + ':' + m.level + ':' + m.id + ':' + (m.ban || []).join('.')).join(',')}`, hit = estMemo.get(key);
    if (hit && Date.now() - hit.at < 60_000) return hit.r;
    const G = gymOf(ch); if (!G || !G.foes.length) return null;
    const r = { gym: G.name, p: simWin(mons0.map(fresh), G) };
    if (estMemo.size > 50) estMemo.clear();
    estMemo.set(key, { at: Date.now(), r });
    return r;
  }
  // 0..1: the win chance at full gym power counts most; 70% and 40% of the gym's extra power count less
  const LEVELS = [[1, 1], [0.7, 0.35], [0.4, 0.15]];
  const PLAN_V = 16; // bump when the scoring changes: saved plans from before are redone
  // fast: only the Auto Switch lineup (what really happens), used while searching
  const winA = (team, foes, power) => (team.length > 1 && foes.length ? winRaw(autoOrder(team, foes), foes, power) : winRaw(team, foes, power));
  const grade = (team, foes, P, wf = win) => {
    const full = wf(team, foes, P); if (full >= 0.995) return full; // wins at full power: the weaker levels can only read the same
    return LEVELS.reduce((s, [k, w], i) => s + w * (i === 0 ? full : wf(team, foes, 1 + (P - 1) * k)), 0) / LEVELS.reduce((s, [, w]) => s + w, 0);
  };
  // the leader fresh and after the run to him (HP worn down by the trainers since the last heal), counted half each:
  // the game doesn't heal on the way, but a lap can also stop at a berry tree or a lucky draw of trainers
  const simWin = (team, G, runs = 300) => {
    const fresh = safe(() => Sim.gymEval(team, G.foes, G.gym, runs).win, 0) || 0;
    if (!G.chain?.length) return fresh;
    const chain = safe(() => Sim.gymChain(team, G.chain, G.foes, G.gym, Math.max(20, Math.round(runs / 4))).win, null);
    return chain == null || !isFinite(chain) ? fresh : 0.5 * fresh + 0.5 * chain; // a chain error falls back to the leader alone
  };
  const simRun = (team, G) => safe(() => (G.chain?.length ? Sim.gymChain(team, G.chain, G.foes, G.gym, 100) : null), null);
  const fresh = (m) => { const c = { ...m }; delete c.hp; delete c.curHp; return c; };
  const sideMons = () => (E.read('Game.sideMons', []) || []).filter((m) => !(() => { try { return GoalKit.dexHold(m); } catch { return false; } })());
  // the plan is redone when your side's Pokémon change (caught, evolved), not on every level-up
  const sig = (ch) => sideMons().map((m) => m.uid + ':' + m.id + (m.ban?.length ? ':' + m.ban.join('.') : '')).sort().join('|') + '#' + JSON.stringify(bans[ch] || []);
  // Teams that lost twice with everyone already at the level cap (the stdAri idea: when levels aren't the problem,
  // change the team, don't train it again). Kept per gym chapter; the plan picks the next-best team instead.
  const BKEY = 'mega-gym-bans';
  let bans = {}; try { bans = JSON.parse(localStorage.getItem(BKEY) || '{}') || {}; } catch (__e) { __h('66-gymplan:137', __e); }
  const teamKey = (uids) => [...uids].map(String).sort().join(',');
  function ban(ch, uids) {
    const k = teamKey(uids); if (!k) return false;
    const L = (bans[ch] ||= []); if (L.includes(k)) return false;
    L.push(k); if (L.length > 12) L.shift();
    try { localStorage.setItem(BKEY, JSON.stringify(bans)); } catch (__e) { __h('66-gymplan:143', __e); }
    if (saved[ch]) saved[ch].at = 0;
    return true;
  }
  // a team sharing 5 or more Pokémon with one set aside counts as that team (swapping one filler isn't a new team)
  const banned = (ch, uids) => { const mine = new Set([...uids].map(String)); return (bans[ch] || []).some((k) => { const b = k.split(','); return b.filter((u) => mine.has(u)).length >= Math.min(5, b.length); }); };
  function clearBans(ch) { if (bans[ch]) { delete bans[ch]; try { localStorage.setItem(BKEY, JSON.stringify(bans)); } catch (__e) { __h('66-gymplan:149', __e); } } }

  function candidates(G) {
    const st = ST(), cap = G.cap || 100, out = [], seen = new Set();
    const reg = safe(() => st.regionOf(G.ch)?.key), chs = safe(() => st.chaptersOf(reg), []) || [];
    const ownFam = new Set();
    for (const m of sideMons()) {
      const id = evolveTo(m.id, Math.max(cap, m.level)); fam(m.id).forEach((x) => ownFam.add(x));
      const k = 'o' + id;
      // two of yours that end up the same Pokémon (Ferroseed 53 + Ferrothorn 52): the one already in that form wins
      // unless the other is 5+ levels ahead - an evolution still to happen is extra work and may not happen at all
      const worth = (x) => x.level - (+x.id === +id ? 0 : 5);
      if (seen.has(k)) { const o = out.find((x) => x.key === k); if (o && worth(m) > worth(o.from)) { o.from = m; o.uid = m.uid; } continue; }
      seen.add(k); out.push({ key: k, kind: 'own', uid: m.uid, from: m, id, mon: { uid: 'p' + m.uid, id, level: cap, shiny: false } });
    }
    // speed-running the gyms: only what spawns RIGHT NOW (weather, time of day) and is quick to find -
    // about 15 minutes or less, from its share of the chapter's wild fights and your wins per hour there.
    // Waiting hours for a Pokémon is for the Pokédex and legendaries, not for a gym (Jimmy).
    for (const ch of chs) {
      if (ch > G.ch) break;
      const rate = safe(() => XpChap.rateOf(ch).rate, 450) || 450;
      for (const p of safe(() => Sim.chapterPool(ch), []) || []) {
        if (ownFam.has(+p.id)) continue;
        const mins = (1 / Math.max(p.w, 1e-6)) / (rate / 60);
        if (mins > 15) continue;
        const id = evolveTo(p.id, cap), k = 'c' + id;
        const prev = out.find((x) => x.key === k);
        if (prev) { if (mins < prev.mins) Object.assign(prev, { base: +p.id, ch, mins, where: st.CHAPTERS[ch]?.name }); continue; }
        if (seen.has('o' + id)) continue; seen.add(k);
        out.push({ key: k, kind: 'catch', base: +p.id, ch, mins, where: st.CHAPTERS[ch]?.name, id, mon: { uid: 'c' + p.id, id, level: cap, shiny: false } });
      }
    }
    return out;
  }
  const sleep = () => new Promise((r) => setTimeout(r, 0));
  // best 6 from `pool` (entries with .mon) against the gym; yields every few estimates
  async function search(pool, G, budget, tick) {
    const foes = G.foes, P = effP(G.power), sp = (x) => Sim.species(x.mon);
    // graded score: the estimate at the gym's full power falls off a cliff (a whole box can read 0% against a
    // 1.2 gym and 100% at plain strength), so each team is also scored at power levels in between: a team that
    // still wins when the gym is stronger ranks higher, even when every team reads 0% at full power
    let n = 0, slice = performance.now(); const memo = new Map(), fid = new Map();
    const W = async (t, f) => {
      if (!fid.has(f)) fid.set(f, fid.size); const key = fid.get(f) + '|' + t.map((x) => x.key).sort().join(',');
      if (memo.has(key)) return memo.get(key);
      ++n; if (performance.now() - slice > 40) { tick?.(n); await sleep(); slice = performance.now(); }
      const v = f === foes ? simWin(t.map((x) => x.mon), G, 80) : Math.round(grade(t.map((x) => x.mon), f, P, winA) * 50) / 50; memo.set(key, v); return v; /* the old helper's simulator (seeded: same team, same answer) */
    };
    // the gym fight itself (each foe in turn, the whole team counting most), plus the full run: the trainers after
    // the last heal and then the leader in one go, HP carrying over - a team that arrives healthy wins more
    // training cost (Jimmy's rule, from the old helper): levels still to gain (per 10) and catches still to make.
    // Small next to a real difference in winning, so it decides between teams that win about the same.
    const cost = (t) => t.reduce((c, x) => c + (x.kind === 'catch' ? 2 + (x.mins || 0) / 30 : x.kind === 'own' ? Math.max(0, (x.mon.level || 0) - (x.from?.level ?? x.mon.level)) / 10 + (x.from && x.from.id !== x.id ? 0.3 : 0) : 0), 0);
    // the old helper's coverage against the leader + the chapter's 5 most common wild Pokémon, with diminishing
    // returns (a foe nobody handles counts far more than one already crushed). Win chances read 100% for almost
    // any team at the cap, so this is what tells them apart - Mega picked Chandelure where the old helper picked
    // Escavalier, and only the old helper's team got past stop 11.
    const covFoes = [...foes, ...(G.route || [])], covOf = new Map();
    const kOf = (x) => { if (!covOf.has(x)) covOf.set(x, safe(() => Sim.coverage(x.mon, covFoes), covFoes.map(() => 0)) || covFoes.map(() => 0)); return covOf.get(x); };
    const covScore = (t) => { const c = covFoes.map(() => 0); for (const x of t) kOf(x).forEach((v, i) => (c[i] += v)); return c.reduce((s, v) => s + Math.log1p(v), 0) / Math.max(1, covFoes.length); };
    const COV_W = 3;
    const isBanned = (t) => banned(G.ch, t.filter((x) => x.uid).map((x) => x.uid));
    const obj = async (t) => (isBanned(t) ? -1e6 : (await objWin(t)) + COV_W * covScore(t) - 0.12 * cost(t));
    const objWin = async (t) => (await W(t, foes)) * foes.length; // the 0%-for-everyone stretch run and the separate wild run are gone: coverage covers the chapter
    // the old helper's pick, exactly: greedy on coverage gain, ties to the one closest to ready today
    const greedy = []; { const c = covFoes.map(() => 0);
      while (greedy.length < 6) {
        let b = null, bv = -Infinity;
        for (const x of pool) {
          if (greedy.includes(x) || greedy.some((y) => sp(y) === sp(x))) continue;
          const k = kOf(x), ready = 0.5 + 0.5 * Math.min(1, (x.from?.level ?? x.mon.level) / Math.max(1, x.mon.level));
          const v = k.reduce((a, v, i) => a + Math.log1p(c[i] + v) - Math.log1p(c[i]), 0) + 1e-6 * k.reduce((a, v) => a + v, 0) * ready - (x.kind === 'catch' ? 0.05 : 0);
          if (v > bv) { bv = v; b = x; }
        }
        if (!b) break; greedy.push(b); kOf(b).forEach((v, i) => (c[i] += v));
      } }
    // the old helper's candidates: the 18 best by coverage (one per species), plus its greedy pick
    const byCov = pool.map((x) => ({ x, v: kOf(x).reduce((a, v) => a + Math.log1p(v), 0) })).sort((a, b) => b.v - a.v).map((y) => y.x).filter((x, i, a) => a.findIndex((y) => sp(y) === sp(x)) === i);
    const top = [...new Set([...greedy, ...byCov.slice(0, 18)])];
    // the same Pokémon always give the same answer: shuffles use a fixed seed (they used Math.random, so the
    // plan flipped between equal teams every time it was redone)
    const shuffle = (a, seed) => { const rnd = Sim.mulberry(seed * 7919 + 17), b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
    let best = null, bs = -1;
    for (let r = 0; r < 3 && n < budget; r++) {
      let t = r === 0 && greedy.length ? [...greedy] : shuffle(top, r).filter((x, i, a) => a.findIndex((y) => sp(y) === sp(x)) === i).slice(0, 6);
      let s = await obj(t), imp = true, pass = 0;
      while (imp && n < budget && pass++ < 2) {
        imp = false;
        for (let i = 0; i < t.length; i++) for (const x of top) { if (t.includes(x)) continue; const t2 = [...t]; t2[i] = x; if (new Set(t2.map(sp)).size < t2.length) continue; const s2 = await obj(t2); if (s2 > s) { t = t2; s = s2; imp = true; } }
      }
      if (s > bs) { bs = s; best = t; }
    }
    return { greedy: greedy.map((x) => x.id), cov: best ? covScore(best) : 0, team: best || [], win: best ? simWin(best.map((x) => x.mon), G) : 0, soft: best ? simWin(best.map((x) => x.mon), G) : 0, run: best ? simRun(best.map((x) => x.mon), G) : null };
  }
  // plan the gym of chapter `ch` (cached per gym + side). Returns the saved plan, or null while it's thinking.
  function get(ch, { force = false } = {}) {
    const p = saved[ch];
    // redone every 30 min: what's spawning changes with the time of day and the weather
    if (p && !force && p.sig === sig(ch) && Date.now() - p.at < 30 * 60_000 && p.v === PLAN_V) return p; // (plans made by an older scoring are redone)
    if (!busy) run(ch);
    return p || null;
  }
  // one plan at a time: a second start (the story goal, the Simulate button) waits for the one already running
  let running = null, runCh = null;
  function run(ch) {
    if (running && runCh === ch) return running; // that gym is already being planned
    const prev = running || Promise.resolve();
    const mine = prev.catch(() => {}).then(() => { runCh = ch; return runOne(ch); }).finally(() => { if (running === mine) { running = null; runCh = null; } });
    running = mine; runCh = ch;
    return mine;
  }
  async function runOne(ch) {
    const G = gymOf(ch); if (!G || !G.foes.length) return null;
    const b = (busy = { ch, done: 0, total: 1 }); duel1 = new Map();
    try {
      const pool = candidates(G);
      // now: the Pokémon you have, at their real levels
      const nowPool = sideMons().map((m) => ({ key: 'n' + m.uid, kind: 'own', uid: m.uid, id: m.id, from: m, mon: fresh(m) }));
      const now = await search(nowPool, G, 700, (n) => { b.done = n; });
      // your actual current team always competes too (the search samples, and could miss it)
      const curMons = (E.get('Game.S')?.team || []).map((u) => E.read('Game.getMon', null, u)).filter(Boolean);
      if (curMons.length && !banned(ch, curMons.map((m) => m.uid))) { const cur = curMons.map((m) => nowPool.find((x) => x.uid === m.uid)).filter(Boolean); const cw = simWin(cur.map((x) => x.mon), G); if (cw >= now.win - 0.02) Object.assign(now, { team: cur, win: Math.max(cw, now.win), soft: Math.max(cw, now.win), current: true }); /* a tie keeps the team you have (no swapping back and forth) */ }
      let plan = await search(pool, G, 1600, (n) => { b.done = 700 + n; });
      // always the one that needs less training: if what's ready right now wins about as well, that's the plan
      if (now.team.length && now.win >= plan.win - 0.03) plan = { ...now, ready: true };
      const r = {
        v: PLAN_V, ch, at: Date.now(), sig: sig(ch), gym: G.name, chapter: G.chapter, cap: G.cap, foes: G.foes.map((f) => [f.id, f.level]),
        trainers: G.trainers || 0,
        // the suggested team as it is today (your Pokémon at their real levels, not evolved yet, catches missing)
        today: (() => { const ms = plan.team.filter((x) => x.kind === 'own').map((x) => E.read('Game.getMon', null, x.uid)).filter(Boolean).map(fresh); return ms.length ? simWin(ms, G) : 0; })(),
        now: { uids: now.team.map((x) => x.uid), win: now.win, soft: now.soft, run: now.team.length ? simRun(now.team.map((x) => x.mon), G) : null },
        bans: (bans[ch] || []).length,
        plan: { win: plan.win, soft: plan.soft, run: plan.run, ready: !!plan.ready, team: plan.team.map((x) => x.kind === 'own' ? { kind: 'own', uid: x.uid, id: x.id, from: x.from.id, level: x.from.level } : { kind: 'catch', id: x.id, base: x.base, ch: x.ch, where: x.where, mins: Math.round(x.mins || 0) }) },
      };
      saved[ch] = r; for (const k of Object.keys(saved).sort((a, b) => saved[b].at - saved[a].at).slice(3)) delete saved[k]; keep();
      try { Log.add(`gym plan for ${G.name}: your team now ${Math.round(now.win * 100)}%, best possible ${Math.round(plan.win * 100)}% (${r.plan.team.map((t) => D()[t.id]?.name).join(', ')})${G.trainers ? ` - ranked on the ${G.trainers} trainers after the last Pokémon Center too` : ''}`); } catch (__e) { __h('66-gymplan:284', __e); }
      try { UI.refresh?.(); } catch (__e) { __h('66-gymplan:285', __e); }
      return r;
    } finally { busy = null; }
  }
  // Pokémon stuck at the cap with an evolution waiting (they only evolve when they level up): evolve them
  function evolveStuck() {
    const out = [];
    for (const m of sideMons()) {
      const ev = safe(() => E.read('Game.levelEvolutions', [], m), []) || [];
      if (!ev.length || m.level < (safe(() => +E.read('Game.capFor', 0, m), 0) || 999)) continue;
      if (m.shiny) continue; // game 0.5.133: shinies stay unevolved unless you evolve them from the card (and only base-form shinies trade)
      // never your only copy of a species: evolving it would take that entry out of your Pokédex ('lost')
      if ((E.read('Game.ownedMons', []) || []).filter((x) => +x.id === +m.id).length <= 1) continue;
      const to = +ev[0].to; const before = m.id;
      try { E.call('Game.evolveMon', m.uid, to); } catch (__e) { __h('66-gymplan:299', __e); }
      const now = E.read('Game.getMon', null, m.uid);
      if (now && now.id !== before) { out.push([before, now.id]); try { Log.add(`${D()[before]?.name} evolved into ${D()[now.id]?.name} (it was waiting at the level cap)`); } catch (__e) { __h('66-gymplan:301', __e); } }
    }
    return out;
  }
  // the gym after this one (the next chapter of the region that has a gym)
  function nextGym(ch) {
    const st = ST(); const reg = safe(() => st.regionOf(ch)?.key); const chs = safe(() => st.chaptersOf(reg), []) || [];
    for (const c of chs) if (c > ch && (st.CHAPTERS[c]?.steps || []).some((x) => x.kind === 'gym')) return c;
    return null;
  }
  // on a region's side, a Pokémon stuck at the level cap with an evolution waiting is evolved every 5 min
  setInterval(() => { try { if (E.get('Game.S')?.link?.side === 'to' && Plan.running && E.ready()) evolveStuck(); } catch (__e) { __h('66-gymplan:312', __e); } }, 5 * 60_000);
  return { gymOf, get, run, ban, banned, clearBans, teamKey, sigOf: (ch) => sig(ch), simRun: (team, G) => simRun(team, G), evolveStuck, evolveTo, nextGym, estimate, learn, calib, autoOrder, get busy() { return busy; }, get saved() { return saved; } };
})();

/* ---------------------------------------------------------------------------------------------
 * Mirror: what Kinesis (the phone app) can do, Mega's panel on the PC can do too - so the two match
 * whether Jimmy is at the PC all day or away on his phone (2026-11-17).
 *   Activity tab   the whole log (search + filters), history graphs, "since you last looked"
 *   PC tab         every Pokémon you own: filters, sort, details, put in team, level to the cap
 *   Pokédex        every Pokémon of the open regions as a grid + a ✨ Hunt Shiny card on each page
 *   Now            🐣 Hatch on ready eggs, the 🥊 boss-fight numbers, ✏️ Change Team, 🔄 Re-pick Raid Team
 * Trading stays in the game's own Trades screen on the PC (Kinesis drives that same screen).
 * ------------------------------------------------------------------------------------------- */
const Mirror = (() => {
  const E = Engine;
  const D = () => E.get('Game.DEX') || {};
  const nmRaw = (id) => D()[id]?.name || '#' + id;
  const S = () => E.get('Game.S') || {};
  const ui = {
    act: { f: 'all', q: '', range: 24, show: 40 },
    box: { f: 'all', q: '', sort: 'level', type: '', sel: null, show: 48 },
    dex: { reg: null, f: 'all', show: 300 },
    tm: { draft: null, slot: 0, q: '', add: null },
  };
  const row = (k, v) => `<div class="row"><span class="k">${k}</span><span class="v">${v}</span></div>`;
  const sp = (id, n = 52, dark = false) => `<img src="${E.sprite(id)}" width="${n}" height="${n}" style="image-rendering:pixelated;background:var(--well);border-radius:12px;flex:none;${dark ? 'filter:brightness(0);opacity:.45' : ''}">`;
  const hm = (ms) => { const m = Math.max(1, Math.round(ms / 60000)); return m < 60 ? `${m} min` : m < 2880 ? `${Math.floor(m / 60)} h${m % 60 ? ' ' + (m % 60) + ' min' : ''}` : `${Math.round(m / 1440)} days`; };
  const at = (t) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const cap1 = (w) => String(w || '').charAt(0).toUpperCase() + String(w || '').slice(1);
  const chips = (list, cur, act) => `<div style="display:flex;flex-wrap:wrap;gap:6px;margin:8px 0">${list.map(([k, l]) => `<button class="btn sm" style="width:auto;padding:8px 12px;${cur === k ? 'background:linear-gradient(90deg,var(--acc),var(--acc))' : ''}" data-act="${act}" data-v="${k}">${l}</button>`).join('')}</div>`;

  // ---- "since you last looked": the moment the game tab was hidden or Mega's panel was closed ----
  const AWAY = 'mega-away-at';
  const markAway = () => { try { localStorage.setItem(AWAY, String(Date.now())); } catch (__e) { __h('67-mirror:30', __e); } };
  document.addEventListener('visibilitychange', () => { if (document.hidden) markAway(); });
  const awaySince = () => +(localStorage.getItem(AWAY) || 0);

  // ---- graphs (same as Kinesis) ----
  function chart(esc, title, pts, opt = {}) {
    if (pts.length < 2) return `<div class="card"><h3>${esc(title)}</h3><div class="dim">Not enough history yet - a sample every 10 minutes.</div></div>`;
    const W = 340, H = 110, P = 6, t0 = pts[0][0], t1 = pts[pts.length - 1][0];
    let lo = Math.min(...pts.map((p) => p[1])), hi = Math.max(...pts.map((p) => p[1]), opt.need || -Infinity); if (hi === lo) { hi += 1; lo -= opt.need ? 0 : 1; }
    const X = (t) => P + (W - 2 * P) * (t - t0) / Math.max(1, t1 - t0), Y = (v) => H - P - (H - 2 * P) * (v - lo) / (hi - lo);
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join('');
    const ch = pts[pts.length - 1][1] - pts[0][1], hrs = (t1 - t0) / 3.6e6, rate = hrs > 0.3 ? ch / hrs : null, f = opt.fmt || ((v) => Math.round(v).toLocaleString());
    const eta = opt.need && rate > 0 && pts[pts.length - 1][1] < opt.need ? ` · done in about ${hm((opt.need - pts[pts.length - 1][1]) / rate * 3.6e6)}` : '';
    return `<div class="card"><h3>${esc(title)}</h3><div style="display:flex;justify-content:space-between"><b style="font-size:19px">${f(pts[pts.length - 1][1])}${opt.need ? ` <span class="dim" style="font-size:var(--t-m)">of ${f(opt.need)}</span>` : ''}</b><span class="${ch > 0 ? 'ok' : ch < 0 ? 'warn' : 'dim'}">${ch > 0 ? '+' : ''}${f(ch)}</span></div>
      <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;margin-top:6px;background:var(--well);border-radius:12px">${opt.need ? `<line x1="${P}" x2="${W - P}" y1="${Y(opt.need)}" y2="${Y(opt.need)}" stroke="var(--gold-lo)" stroke-dasharray="4 4"/>` : ''}<path d="${d}" fill="none" stroke="var(--acc)" stroke-width="2.5" stroke-linejoin="round"/></svg>
      ${rate != null && ch ? `<div class="dim">${rate >= 0 ? '+' : ''}${Math.abs(rate) < 10 && !opt.fmt ? rate.toFixed(1).replace(/\.0$/, '') : f(rate)} per hour${eta}</div>` : ''}</div>`;
  }
  // ---- Activity tab ----
  const FRX = { raid: /raid/i, under: /underground|floor|gem|plate|geode/i, legend: /legend|zone|caught|catch|elite|league/i, phone: /^phone/i, err: /error|could not|refused|failed|stuck|lost|did not start/i };
  function activity(esc) {
    let h = '';
    const since = awaySince(), lines = Log.lines || [];
    if (since && Date.now() - since > 10 * 60000) {
      const H0 = History.since(since - 600000), a = H0.rows.find((r) => r[0] >= since) || H0.rows[0], b = H0.rows[H0.rows.length - 1], deltas = [];
      if (a && b && a !== b) {
        const d = (i, label, money) => { const v = b[i] - a[i]; if (v) deltas.push(`<b class="${v > 0 ? 'ok' : 'warn'}">${v > 0 ? '+' : ''}${money ? '₽' : ''}${v.toLocaleString()}</b> ${label}`); };
        d(1, 'money', 1); d(2, 'Pokédex'); d(3, 'shiny'); d(4, 'Lv 100'); d(5, 'levels');
        for (const [id, v] of Object.entries(b[6] || {})) { const was = a[6]?.[id], nm = H0.names?.[id]; if (was != null && v !== was && nm) deltas.push(`<b class="ok">${v > was ? '+' : ''}${(v - was).toLocaleString()}</b> ${esc(nm[0])}`); }
      }
      const key = lines.filter((l) => l.at > since && /caught|won|done|shiny|hatched|started|reached|badge|finished|raid|traded|posted/i.test(l.text)).slice(-8).reverse();
      h += `<div class="card" style="border-color:var(--acc)"><h3>Since You Last Looked · ${hm(Date.now() - since)}</h3>${deltas.length ? `<div style="line-height:1.9">${deltas.join('<br>')}</div>` : '<div class="dim">No changes in the numbers.</div>'}
        ${key.length ? `<div class="dim" style="margin-top:8px;font-weight:700">HIGHLIGHTS</div>${key.map((l) => `<div style="margin:3px 0"><span class="dim">${at(l.at)}</span> ${esc(Casing.names(l.text))}</div>`).join('')}` : ''}
        <button class="btn sm" style="margin-top:8px" data-act="m-away-ok">Got It</button></div>`;
    }
    const cut = Date.now() - ui.act.range * 3.6e6, H1 = History.since(cut - 1), rows = H1.rows.filter((r) => r[0] >= cut), col = (i) => rows.map((r) => [r[0], r[i]]);
    h += `<div class="card"><h3>History</h3>${chips([[6, '6 h'], [24, '24 h'], [168, '7 days']], ui.act.range, 'm-act-range')}</div>`;
    for (const [id, nm] of Object.entries(H1.names || {})) { if (nm[3] || !nm[1]) continue; const pts = rows.filter((r) => r[6]?.[id] != null).map((r) => [r[0], r[6][id]]); if (pts.length >= 2) h += chart(esc, nm[0], pts, { need: nm[1] }); }
    h += chart(esc, 'Money', col(1), { fmt: (v) => (v < 0 ? '-₽' : '₽') + Math.abs(Math.round(v)).toLocaleString() }) + chart(esc, 'Pokédex', col(2)) + chart(esc, 'Total Levels (All Pokémon)', col(5)) + chart(esc, 'Shinies', col(3)) + chart(esc, 'Lv 100 Pokémon', col(4));
    const rx = FRX[ui.act.f], q = ui.act.q.trim().toLowerCase();
    const list = lines.filter((l) => (!rx || rx.test(l.text)) && (!q || l.text.toLowerCase().includes(q))).slice().reverse();
    h += `<div class="card"><h3>Log</h3><input class="q" data-mq="act" value="${esc(ui.act.q)}" placeholder="Search the log…">
      ${chips([['all', 'All'], ['raid', 'Raid'], ['under', 'Underground'], ['legend', 'Legends'], ['phone', 'Phone'], ['err', 'Problems']], ui.act.f, 'm-act-f')}
      ${list.slice(0, ui.act.show).map((l, i, arr) => { const day = new Date(l.at).toDateString(), prev = i ? new Date(arr[i - 1].at).toDateString() : ''; return `${day !== prev ? `<div class="dim" style="margin-top:10px;font-weight:700">${new Date(l.at).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })}</div>` : ''}<div style="margin:4px 0"><span class="dim">${at(l.at)}</span> ${esc(Casing.names(l.text))}</div>`; }).join('') || '<div class="dim">Nothing matches.</div>'}
      ${list.length > ui.act.show ? `<button class="btn" data-act="m-act-more">Show More (${list.length - ui.act.show} older)</button>` : ''}</div>`;
    return h;
  }

  // ---- PC tab ----
  const TYPES = ['normal', 'fire', 'water', 'grass', 'electric', 'ice', 'fighting', 'poison', 'ground', 'flying', 'psychic', 'bug', 'rock', 'ghost', 'dragon', 'dark', 'steel', 'fairy'];
  function boxRows() {
    const S0 = S(), team = new Set(S0.team || []), under = new Set((E.read('Game.underMons', []) || []).map((m) => m.uid));
    const care = (S0.pension?.mons || []).map((x) => x?.mon || x).filter(Boolean), careSet = new Set(care.map((m) => m.uid));
    const all = [...(E.read('Game.ownedMons', []) || [])]; for (const m of care) if (!all.some((x) => x.uid === m.uid)) all.push(m);
    return all.map((m) => ({ m, where: team.has(m.uid) ? 't' : under.has(m.uid) ? 'u' : careSet.has(m.uid) ? 'd' : '', buddy: S0.buddy?.uid === m.uid }));
  }
  function box(esc) {
    const B = ui.box, all = boxRows(), q = B.q.trim().toLowerCase();
    let list = all.filter(({ m, where }) => (!q || nmRaw(m.id).toLowerCase().includes(q)) && (!B.type || (D()[m.id]?.types || []).includes(B.type))
      && (B.f === 'all' || (B.f === 'shiny' && m.shiny) || (B.f === 'l100' && m.level >= 100) || (B.f === 'under100' && m.level < 100) || (B.f === 'ranked' && m.rank) || (B.f === 'busy' && where)));
    const SO = { level: (a, b) => b.m.level - a.m.level || (b.m.rank || 0) - (a.m.rank || 0), newest: (a, b) => (b.m.caughtAt || 0) - (a.m.caughtAt || 0), rank: (a, b) => (b.m.rank || 0) - (a.m.rank || 0) || b.m.level - a.m.level, name: (a, b) => nmRaw(a.m.id).localeCompare(nmRaw(b.m.id)) || b.m.level - a.m.level, dex: (a, b) => (a.m.id % 10000) - (b.m.id % 10000) || a.m.id - b.m.id };
    list.sort(SO[B.sort] || SO.level);
    const ic = { t: '⚔️', u: '⛏️', d: '🥚' };
    let h = detail(esc);
    h += `<div class="card"><h3>PC Box · ${all.length} Pokémon</h3><div class="dim">✨ ${all.filter((x) => x.m.shiny).length} shiny · Lv 100: ${all.filter((x) => x.m.level >= 100).length} · ★ ranked: ${all.filter((x) => x.m.rank).length}</div>
      <input class="q" data-mq="box" value="${esc(B.q)}" placeholder="Search by name…" style="margin-top:8px">
      ${chips([['all', 'All'], ['shiny', '✨ Shiny'], ['l100', 'Lv 100'], ['under100', 'Under 100'], ['ranked', '★ Ranked'], ['busy', 'Team / Away']], B.f, 'm-box-f')}
      <div style="display:flex;gap:8px"><select class="sel" data-msel="sort">${[['level', 'Sort: Level'], ['newest', 'Sort: Newest'], ['rank', 'Sort: Rank'], ['name', 'Sort: Name'], ['dex', 'Sort: Pokédex No.']].map(([k, l]) => `<option value="${k}" ${B.sort === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <select class="sel" data-msel="type"><option value="">All types</option>${TYPES.map((t) => `<option value="${t}" ${B.type === t ? 'selected' : ''}>${cap1(t)}</option>`).join('')}</select></div>
      <div class="grid">${list.slice(0, B.show).map(({ m, where, buddy }) => `<div class="mon" data-act="m-box-open" data-uid="${esc(m.uid)}" style="cursor:pointer;position:relative;${B.sel === m.uid ? 'border-color:var(--acc);box-shadow:0 0 0 2px var(--focus)' : ''}">${ic[where] ? `<span style="position:absolute;top:3px;right:5px;font-size:var(--t-s)">${ic[where]}</span>` : ''}<img src="${E.sprite(m.id)}" loading="lazy">${esc(nmRaw(m.id))}<div class="dim">Lv ${m.level}${RK(m.rank)}${m.shiny ? ' ✨' : ''}${buddy ? ' 💛' : ''}</div></div>`).join('') || '<div class="dim">Nothing matches.</div>'}</div>
      ${list.length > B.show ? `<button class="btn" data-act="m-box-more">Show More (${list.length - B.show})</button>` : ''}</div>`;
    return h;
  }
  function detail(esc) {
    const uid = ui.box.sel; if (!uid) return '';
    const S0 = S(), care = (S0.pension?.mons || []).map((x) => x?.mon || x).filter(Boolean);
    const under = E.read('Game.underMons', []) || [];
    const m = E.read('Game.getMon', null, uid) || care.find((x) => x.uid === uid) || under.find((x) => x.uid === uid);
    if (!m) { ui.box.sel = null; return ''; }
    const d = D()[m.id] || {}, st = E.read('Game.statsOf', null, m) || {}, cap = +E.read('Game.capFor', 100, m) || 100;
    const where = (S0.team || []).includes(uid) ? 'On your team' : under.some((x) => x.uid === uid) ? 'In the Underground' : care.some((x) => x.uid === uid) ? 'In the Day Care' : 'In your PC';
    const stats = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'].map((k) => Math.round(+st[k] || 0)), mx = Math.max(...stats, 1), names = ['HP', 'Atk', 'Def', 'SpA', 'SpD', 'Spe'];
    const lvGoal = Plan.goals.some((g) => !g.done && g.type === 'level' && (g.uids || []).includes(uid));
    const team = (S0.team || []).map((u) => E.read('Game.getMon', null, u)).filter(Boolean);
    return `<div class="card" style="border-color:var(--acc)"><div style="display:flex;gap:12px;align-items:center">${sp(m.id, 72)}<div style="flex:1"><div style="font-size:19px;font-weight:800">${esc(d.name || '#' + m.id)}${m.shiny ? ' ✨' : ''}${S0.buddy?.uid === uid ? ' 💛' : ''}</div><div class="dim">${esc(d.genus || '')}</div><div>${(d.types || []).map(cap1).join(' / ')}</div></div><button class="btn sm" style="width:auto;padding:8px 12px" data-act="m-box-close">✕</button></div>
      ${row('Level', `${m.level}${cap > m.level ? ` <span class="dim">(cap ${cap})</span>` : ''}`)}${m.rank ? row('Rank', RK(m.rank)) : ''}${row('Where', where)}
      ${m.where ? row('Caught', `${esc(Casing.names(m.where))}${m.caughtAt ? ` <span class="dim">· ${new Date(m.caughtAt).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}</span>` : ''}`) : ''}${m.ot ? row('From', esc(m.ot)) : ''}
      <div class="dim" style="margin-top:8px;font-weight:700">STATS</div>
      ${stats.map((v, i) => `<div style="display:grid;grid-template-columns:40px 1fr 44px;gap:8px;align-items:center;margin:3px 0"><span class="dim">${names[i]}</span><div class="bar" style="margin:0"><i style="width:${(100 * v / mx).toFixed(0)}%"></i></div><b style="text-align:right">${v}</b></div>`).join('')}
      ${where === 'In your PC' ? (team.length < 6 ? `<button class="btn gold" data-act="m-box-team" data-uid="${esc(uid)}" data-out="">⚔️ Add to Team</button>`
        : `<div class="dim" style="margin-top:8px;font-weight:700">⚔️ PUT IN TEAM - REPLACE…</div><div style="display:grid;grid-template-columns:repeat(6,1fr);gap:4px;text-align:center">${team.map((t) => `<div class="mon" style="cursor:pointer;padding:4px 2px" data-act="m-box-team" data-uid="${esc(uid)}" data-out="${esc(t.uid)}"><img src="${E.sprite(t.id)}" style="width:40px;height:40px">${esc(nmRaw(t.id))}</div>`).join('')}</div>`) : ''}
      ${m.level < cap ? (lvGoal ? `<div class="dim" style="margin-top:8px">⬆️ Already in your plan to level up.</div>` : `<button class="btn" data-act="m-box-level" data-uid="${esc(uid)}">⬆️ Level to ${cap}</button>`) : ''}</div>`;
  }
  function putInTeam(uid, out) {
    const team = [...(S().team || [])];
    if (out) { const i = team.indexOf(out); if (i < 0) return 'that one isn\'t on the team'; team[i] = uid; } else { if (team.length >= 6) return 'the team is full'; team.push(uid); }
    const why = Guard.team(team, { need: team.length, minLevel: 1 }); if (why) return why;
    GoalTypes.setChapterTeam(team);
    Log.add(`team changed: ${team.map((u) => nmRaw(E.read('Game.getMon', {}, u)?.id)).join(', ')}`);
    return null;
  }
  function levelUp(uid) {
    const m = E.read('Game.getMon', null, uid); if (!m) return 'not found';
    const cap = +E.read('Game.capFor', 100, m) || 100; if (m.level >= cap) return `already at its cap (Lv ${cap})`;
    return Plan.add('level', { uids: [uid], target: cap }) ? null : 'already in the plan';
  }

  // ---- Pokédex grid (replaces the "missing" lists) + the shiny card on each Pokémon's page ----
  function dexGrid(w, esc) {
    const regs = (w.regions || []).filter((r) => r.open && r.dex); if (!regs.length) return '';
    const R = regs.find((r) => r.key === ui.dex.reg) || regs[regs.length - 1]; ui.dex.reg = R.key;
    const owned = E.read('Game.ownedMons', []) || [], shiny = new Set(owned.filter((m) => m.shiny).map((m) => +m.id));
    const hunts = new Set(Plan.goals.filter((g) => !g.done && ['shinyWild', 'shinyBreed'].includes(g.type)).map((g) => +(g.target || g.foe)));
    const ids = DexInfo.regionIds(R.key), reg = (id) => World.dex.registered(id);
    const list = ids.filter((id) => ui.dex.f === 'all' || (ui.dex.f === 'missing' && !reg(id)) || (ui.dex.f === 'noshiny' && !shiny.has(+id)) || (ui.dex.f === 'shiny' && shiny.has(+id)) || (ui.dex.f === 'hunt' && hunts.has(+id)));
    return `<div class="card"><div style="display:flex;flex-wrap:wrap;gap:6px">${regs.map((r) => { const l = DexInfo.regionIds(r.key); return `<button class="btn sm" style="width:auto;padding:8px 12px;${r.key === R.key ? 'background:linear-gradient(90deg,var(--acc),var(--acc))' : ''}" data-act="m-dex-reg" data-v="${r.key}">${esc(r.name)} ${l.filter(reg).length}/${l.length}</button>`; }).join('')}</div>
      <div class="dim" style="margin-top:8px">${esc(R.name)}: ${ids.filter(reg).length} of ${ids.length} registered · ✨ ${ids.filter((id) => shiny.has(+id)).length} shiny</div>
      ${chips([['all', 'All'], ['missing', 'Missing'], ['noshiny', 'No Shiny Yet'], ['shiny', '✨ Have Shiny'], ['hunt', '🎯 Hunting']], ui.dex.f, 'm-dex-f')}
      <div class="grid">${list.slice(0, ui.dex.show).map((id) => `<div class="mon" data-act="dexinfo" data-id="${id}" style="cursor:pointer;position:relative">${shiny.has(+id) ? '<span style="position:absolute;top:3px;right:5px">✨</span>' : hunts.has(+id) ? '<span style="position:absolute;top:3px;right:5px">🎯</span>' : ''}<img src="${E.sprite(id)}" loading="lazy" style="${reg(id) ? '' : 'filter:brightness(0);opacity:.45'}"><span class="${reg(id) ? '' : 'dim'}">${esc(nmRaw(id))}</span><div class="dim">#${id % 10000}</div></div>`).join('') || '<div class="dim">Nothing here.</div>'}</div>
      ${list.length > ui.dex.show ? `<button class="btn" data-act="m-dex-more">Show More (${list.length - ui.dex.show})</button>` : ''}
      <div class="dim" style="margin-top:8px">Dark = not registered yet · ✨ = you have a shiny · 🎯 = Mega is hunting its shiny. Click one for how to get it and to hunt a shiny.</div></div>`;
  }
  function shinyCard(id, esc) {
    let sw = { owned: false, ways: [] }; try { sw = GoalTypes.shinyWays(+id); } catch (__e) { __h('67-mirror:152', __e); }
    const hunt = Plan.goals.find((g) => !g.done && ['shinyWild', 'shinyBreed'].includes(g.type) && +(g.target || g.foe) === +id);
    let h = `<div class="card"><h3>✨ Shiny ${esc(nmRaw(id))}</h3>`;
    if (sw.owned) h += `<div class="ok">You have a shiny one.</div>`;
    else if (hunt) h += `<div class="ok">🎯 Already hunting: ${esc(Plan.label(hunt))}</div>`;
    else if (!sw.ways.length) h += `<div class="dim">No way for Mega to hunt this one yet: it isn't in the wild anywhere you can go, and you have no shiny from its family to breed.</div>`;
    else sw.ways.forEach((w, i) => { h += `<div style="${i ? 'border-top:1px solid #ffffff12;margin-top:10px;padding-top:10px' : ''}"><div class="dim" style="font-weight:700">${sw.ways.length > 1 ? (i ? 'OR' : 'FASTEST') + ' · ' : ''}${w.hours ? `ABOUT ${hm(w.hours * 3.6e6).toUpperCase()}` : ''}</div><div>${esc(Casing.names(w.text))}</div>
      ${w.way === 'raid' ? `<button class="btn" data-act="m-shiny-add" data-id="${id}" data-way="${i}">Use the Shiny Raid</button>` : `<button class="btn${i ? '' : ' gold'}" data-act="m-shiny-add" data-id="${id}" data-way="${i}">✨ Hunt Shiny</button>`}</div>`; });
    if (!sw.owned && sw.ways.length && !hunt) h += `<div class="dim" style="font-size:var(--t-s);margin-top:8px">Times are rough averages - shinies are luck. Non-shiny catches and hatches stay in your PC (Mega never releases).</div>`;
    return h + `</div>`;
  }
  function shinyAdd(id, way) {
    const sw = GoalTypes.shinyWays(+id); if (sw.owned) return 'you already have a shiny one';
    const w = sw.ways[+way || 0]; if (!w) return 'no way to hunt it right now';
    const ok = w.way === 'breed' ? Plan.add('shinyBreed', { foe: +id, way: 'breed', parent: w.parent, parentId: w.parentId, egg: w.egg, steps: w.steps, rate: w.rate })
      : w.way === 'wild' ? Plan.add('shinyWild', { foe: w.foe || +id, target: +id, way: 'wild', ch: w.ch, rate: w.rate, steps: w.steps || null })
      : Plan.add('raid', {});
    return ok ? null : 'already in your plan';
  }

  // ---- Now: the boss-fight numbers (same as Kinesis's 🥊 box) ----
  function fightCard(esc) {
    let f = null; try { f = Remote.fight; } catch (__e) { __h('67-mirror:174', __e); }
    if (!f) return '';
    const pct = (x) => (x == null ? '?' : x >= 0.1 ? Math.round(x * 100) + '%' : (x * 100).toFixed(1).replace(/\.0$/, '') + '%');
    const label = { raid: 'SHINY RAID BOSS', legend: 'LEGENDARY', elite: 'ELITE LEGENDARY', wboss: 'WORLD BOSS' }[f.k] || 'BOSS';
    const rc = f.rate == null ? 'dim' : f.rate >= 0.8 ? 'ok' : f.rate >= 0.5 ? 'warn' : 'bad';
    const best = f.tPity != null && (f.t50 == null || f.tPity < f.t50 * 1.5) ? { t: f.tPity, txt: `guaranteed catch in ${f.left} more KOs` } : f.t50 != null ? { t: f.t50, txt: `50% chance in ${f.n50} KOs` } : null;
    const verdict = f.fights < 3 ? 'Still measuring - a few more fights for a good estimate.' : f.rate === 0 ? '<b class="bad">No KOs yet today</b> - this team isn\'t beating it. Worth doing something else or re-running Simulate.'
      : best ? `${best.t < 2 * 3.6e6 ? '<b class="ok">Good pace</b>' : best.t < 8 * 3.6e6 ? '<b class="warn">Slow</b>' : '<b class="bad">Very slow</b>'} - about <b>${hm(best.t)}</b> for a ${best.txt}.` : '';
    return `<div class="card"><h3>🥊 ${label} · ${esc(nmRaw(f.foe))}</h3><div style="display:grid;grid-template-columns:repeat(3,1fr);text-align:center;gap:6px">
      <div><div class="ok" style="font-size:22px;font-weight:800">${f.kos}</div><div class="dim">KOs today</div></div><div><div style="font-size:22px;font-weight:800">${f.wipes}</div><div class="dim">wipes</div></div><div><div class="${rc}" style="font-size:22px;font-weight:800">${f.rate == null ? '-' : Math.round(f.rate * 100) + '%'}</div><div class="dim">KO rate</div></div></div>
      ${row('Catch chance per KO', pct(f.chance))}${f.pity ? row('Tries toward the guarantee', `${f.tries} of ${f.pity}`) : row('Capture tries so far', f.tries)}${f.per ? row('Time per fight', hm(f.per)) : ''}
      ${verdict ? `<div style="margin-top:6px">${verdict}</div>` : ''}${f.k === 'raid' ? `<button class="btn" data-act="m-raid-repick">🔄 Re-pick Raid Team</button>` : ''}</div>`;
  }

  // ---- Change Team (same as Kinesis) ----
  function teamEdit(esc) {
    const T = ui.tm, S0 = S();
    if (!T.draft) { T.draft = [...(S0.team || [])]; T.slot = Math.min(T.draft.length, 5); }
    const mon = (u) => E.read('Game.getMon', null, u);
    const cell = (m, big) => `<img src="${E.sprite(m.id)}" style="width:${big ? 48 : 40}px;height:${big ? 48 : 40}px">${esc(nmRaw(m.id))}<div class="dim">Lv ${m.level}${RK(m.rank)}${m.shiny ? ' ✨' : ''}</div>`;
    const busy = Plan.goals.filter((g) => !g.done && Plan.live(g.id)?.state === 'running' && GoalTypes[g.type]?.uses === 'screen').map((g) => Plan.label(g));
    let h = `<div class="card"><h3>Change Team</h3><div class="dim">Click a slot, then a Pokémon below. Pokémon in the Underground aren't listed.</div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:8px">${[0, 1, 2, 3, 4, 5].map((i) => { const m = T.draft[i] && mon(T.draft[i]); return `<div class="mon" data-act="m-tm-slot" data-v="${i}" style="cursor:pointer;min-height:80px;${T.slot === i ? 'border:2px solid var(--acc)' : ''}">${m ? cell(m, true) + `<div class="dim" data-act="m-tm-drop" data-v="${i}" style="cursor:pointer">✕ remove</div>` : '<div class="dim" style="padding-top:24px">empty</div>'}</div>`; }).join('')}</div>
      ${busy.length ? `<div class="warn" style="margin-top:8px">Mega is running ${esc(busy.join(', '))} - it may use its own team for that and put yours back after.</div>` : ''}
      <button class="btn gold" data-act="m-tm-save" ${T.draft.filter(Boolean).length ? '' : 'disabled'}>Save Team</button><button class="btn" data-act="m-tm-cancel">Cancel</button></div>`;
    const q = T.q.trim().toLowerCase();
    const opts = GoalTypes.here().filter((m) => !T.draft.includes(m.uid) && (!q || nmRaw(m.id).toLowerCase().includes(q))).sort((a, b) => b.level - a.level || (b.rank || 0) - (a.rank || 0)).slice(0, 120);
    h += `<div class="card"><input class="q" data-mq="tm" value="${esc(T.q)}" placeholder="Search your Pokémon…"><div class="grid">${opts.map((m) => `<div class="mon" data-act="m-tm-pick" data-uid="${esc(m.uid)}" style="cursor:pointer">${cell(m)}</div>`).join('') || '<div class="dim">Nothing matches.</div>'}</div></div>`;
    return h;
  }
  function teamSave() {
    const uids = [...new Set(ui.tm.draft.filter(Boolean))].slice(0, 6); if (!uids.length) return 'pick at least one Pokémon';
    const why = Guard.team(uids, { need: uids.length, minLevel: 1 }); if (why) return why;
    GoalTypes.setChapterTeam(uids); Log.add(`team changed: ${uids.map((u) => nmRaw(E.read('Game.getMon', {}, u)?.id)).join(', ')}`);
    ui.tm.draft = null; return null;
  }

  // ---- clicks / typing from the panel (60-ui passes them here); returns true when handled ----
  async function act(a, t, done) {
    const v = t.dataset.v, say = (m) => { if (m) Log.add(m); };
    switch (a) {
      case 'm-away-ok': localStorage.setItem(AWAY, '0'); break;
      case 'm-act-range': ui.act.range = +v; break;
      case 'm-act-f': ui.act.f = v; ui.act.show = 40; break;
      case 'm-act-more': ui.act.show += 60; break;
      case 'm-box-f': ui.box.f = v; ui.box.show = 48; break;
      case 'm-box-more': ui.box.show += 96; break;
      case 'm-box-open': ui.box.sel = t.dataset.uid; break;
      case 'm-box-close': ui.box.sel = null; break;
      case 'm-box-team': say(putInTeam(t.dataset.uid, t.dataset.out || null)); break;
      case 'm-box-level': say(levelUp(t.dataset.uid)); break;
      case 'm-dex-reg': ui.dex.reg = v; ui.dex.show = 300; break;
      case 'm-dex-f': ui.dex.f = v; ui.dex.show = 300; break;
      case 'm-dex-more': ui.dex.show += 400; break;
      case 'm-shiny-add': say(shinyAdd(+t.dataset.id, +t.dataset.way)); break;
      case 'm-egg-hatch': Log.add(DayCare.hatch(t.dataset.uid || null)); break;
      case 'm-raid-repick': Log.add('Shiny Raid: re-picking the team (about 10 s)…'); done(); Log.add('Shiny Raid: ' + await GoalTypes.raidRepick()); break;
      case 'm-tm-slot': ui.tm.slot = +v; break;
      case 'm-tm-drop': ui.tm.draft[+v] = undefined; ui.tm.draft = ui.tm.draft.filter(Boolean); ui.tm.slot = Math.min(ui.tm.draft.length, 5); break;
      case 'm-tm-pick': { const d = ui.tm.draft.slice(); d[ui.tm.slot] = t.dataset.uid; ui.tm.draft = d.filter(Boolean).slice(0, 6); ui.tm.slot = Math.min(ui.tm.draft.length, 5); break; }
      case 'm-tm-save': { const r = teamSave(); if (r) say('team not changed: ' + r); else return 'back'; break; }
      case 'm-tm-cancel': ui.tm.draft = null; return 'back';
      default: return false;
    }
    return true;
  }
  return { ui, activity, box, dexGrid, shinyCard, fightCard, teamEdit, act, markAway };
})();
Views.activity = (esc) => Mirror.activity(esc);
Views.box = (esc) => Mirror.box(esc);
Views.teamEdit = (esc) => Mirror.teamEdit(esc);
{ const base = Views.dexDetail; Views.dexDetail = (id, esc) => { const h = base(id, esc), card = Mirror.shinyCard(id, esc), i = h.indexOf('<div class="card"', h.indexOf('<div class="card"') + 1); return i > 0 ? h.slice(0, i) + card + h.slice(i) : h + card; }; }

/* ---------------------------------------------------------------------------------------------
 * Guard: Mega never starts something you can't take back on bad information.
 *
 *  1. Team check before every start that costs something (Candy Factory and Shiny Raid - once a
 *     day; Underground trips; World Boss attacks - 3 a day; elite zones; the Elite League):
 *     the team the GAME will actually use is read back and must be complete, at a real level, not
 *     away in the Underground, and the team Mega picked. If not, Mega does not start, says why in
 *     the log, shows it under Needs You and sends a problem alert.
 *  2. Data checks: every 10 minutes the game data each goal depends on is tested for the shape Mega
 *     expects (floors have trainers, the raid boss list has bosses, zones have strength numbers, the
 *     simulator returns real numbers…). A game update that changes any of it pauses only the goals
 *     that use it, until it looks right again - instead of acting on an empty or wrong list.
 * Read-only: nothing here changes the game.
 * ------------------------------------------------------------------------------------------- */
const Guard = (() => {
  const E = Engine;
  const DEX = () => E.get('Game.DEX') || {};
  const name = (id) => DEX()[id]?.name || '#' + id;
  const num = (x) => typeof x === 'number' && isFinite(x);

  // ---- 1. the team about to be used ----
  // uids: what the game will use (read back from the game). need: how many it must have.
  // want: what Mega picked (same set, if given). minLevel: lowest acceptable level.
  function team(uids, { need = 1, want = null, minLevel = 50, allowBots = false } = {}) {
    uids = (uids || []).filter((u) => u != null);
    if (uids.length < need) return `the team has ${uids.length} of ${need} Pokémon`;
    const downs = E.read('Game.underMons', []) || [], away = new Set(downs.map((m) => m.uid)), bad = [];
    for (const u of uids) {
      if (allowBots && String(u).startsWith('bot')) continue;
      if (away.has(u)) { bad.push(`${name(downs.find((m) => m.uid === u)?.id)} is in the Underground`); continue; }
      const m = E.read('Game.getMon', null, u);
      if (!m) { bad.push('a Pokémon that isn\'t in your PC'); continue; }
      if ((+m.level || 0) < minLevel) bad.push(`${name(m.id)} is only Lv ${m.level}`);
    }
    if (bad.length) return bad.slice(0, 3).join(', ');
    if (want && want.length) { const a = [...uids].sort().join(','), b = [...want].sort().join(','); if (a !== b) return 'the game\'s team is not the one Mega picked'; }
    return null;
  }
  // stop, tell Jimmy, and give the goal a status line the Needs You box picks up
  const told = new Map();
  function stop(label, why) {
    const k = label + '|' + why;
    if (Date.now() - (told.get(k) || 0) > 30 * 60_000) { told.set(k, Date.now()); Log.add(`${label}: did not start - ${why}`); try { Notify.send('problem', `Mega stopped before ${label}`, why); } catch (__e) { __h('68-guard:43', __e); } }
    return `did not start - safety check: ${why}`;
  }

  // ---- 2. the game data each goal type relies on ----
  const CHECKS = [
    { key: 'save', label: 'your Pokémon', types: '*', test() {
      const owned = E.read('Game.ownedMons', null); if (!Array.isArray(owned) || !owned.length) return 'the list of your Pokémon is empty';
      const m = owned[0]; if (!m.uid || !DEX()[m.id] || !num(+m.level)) return 'Pokémon entries look different';
      if (!num(DEX()[m.id]?.stats?.hp)) return 'Pokédex base stats are missing';
      if (!Array.isArray(E.read('Game.underMons', null))) return 'can\'t tell who is in the Underground';
      return true; } },
    { key: 'candy', label: 'Candy Factory floors', types: ['candy'], test() {
      const c = E.get('CandyRun'); if (!c || !E.read('CandyRun.unlocked', false)) return true;
      if (!c.today?.()) return true; // the day's type isn't loaded yet - the goal loads it first
      const f = c.floorOf?.(1); const t = f?.team;
      if (!Array.isArray(t) || !t.length) return 'floor 1 has no trainers listed';
      const id = Array.isArray(t[0]) ? t[0][0] : t[0]?.id; if (!DEX()[id]) return 'floor trainers have no Pokémon ids';
      if (!num(+E.get('CONFIG')?.CANDY_RUN?.TEAM)) return 'the team size setting is missing';
      if (typeof c.allowed !== 'function') return 'can\'t tell which Pokémon are allowed';
      return true; } },
    { key: 'raid', label: 'Shiny Raid data', types: ['raid'], test() {
      const r = E.get('Raids'); if (!r || !E.read('Raids.unlocked', false)) return true;
      const B = E.get('CONFIG')?.RAID; if (!B || !num(+B.MINE) || !num(+B.BOSS?.HP) || !num(+B.BOSS?.POWER)) return 'raid settings (team size, boss strength) are missing';
      for (const f of ['teamKey', 'pity', 'bots', 'lane', 'drawn', 'setPick']) if (typeof r[f] !== 'function') return `the raid's ${f} is missing`;
      let reg = null; try { reg = r.drawn(); } catch (__e) { __h('68-guard:68', __e); }
      if (reg) {
        const lane = r.lane() || []; if (!Array.isArray(lane) || !lane.length) return 'the list of raid bosses is empty';
        const cur = lane.find((x) => x.key === reg); if (!cur || !DEX()[cur.boss]) return 'today\'s raid boss can\'t be read';
        const bots = r.bots(reg) || []; if (!Array.isArray(bots) || !bots.length || !bots.every((b) => b.key && Array.isArray(b.mons) && b.mons.every((x) => DEX()[x.id]))) return 'the ally trainers can\'t be read';
      }
      return true; } },
    { key: 'zones', label: 'Legendary zones', types: ['legend', 'elite', 'wboss'], test() {
      const Z = E.get('LegendZones')?.ZONES; if (!Array.isArray(Z) || !Z.length) return 'the list of legendary zones is empty';
      const z = Z.find((x) => DEX()[x.id]); if (!z || !num(+z.hp) || !num(+z.power)) return 'zones have no strength numbers';
      try { const A = E.get('Adventure'), p = +A.catchProb(A.catchCtx({ id: z.id, level: 100 })); if (!(p > 0 && p <= 1)) return 'the catch chance isn\'t a real number'; } catch { return 'the catch chance can\'t be worked out'; }
      return true; } },
    { key: 'sim', label: 'the fight simulator', types: ['legend', 'elite', 'raid'], test() {
      const Z = E.get('LegendZones')?.ZONES || [], z = Z.find((x) => DEX()[x.id]); if (!z) return true;
      const six = (E.read('Game.ownedMons', []) || []).slice().sort((a, b) => b.level - a.level).slice(0, 6);
      if (six.length < 2) return true;
      let r; try { r = Sim.evaluate(six, z.id, 12, 3); } catch (e) { return 'the simulator failed: ' + (e?.message || e); }
      return num(r?.ko) && r.ko >= 0 && r.ko <= 1 && num(r?.dealt) ? true : 'the simulator returned no numbers'; } },
    { key: 'under', label: 'the Underground', types: ['under'], test() {
      const u = E.get('Underground'); if (!u) return true;
      for (const f of ['why', 'themeOf', 'send', 'simulate']) if (typeof u[f] !== 'function') return `the Underground's ${f} is missing`;
      if (!num(+E.get('CONFIG')?.UNDERGROUND?.TEAM)) return 'the team size setting is missing';
      return true; } },
    { key: 'wboss', label: 'the World Boss', types: ['wboss'], test() {
      const W = E.get('WorldBoss'); if (!W) return true;
      for (const f of ['state', 'autoTeam', 'attack', 'left']) if (typeof W[f] !== 'function') return `the World Boss's ${f} is missing`;
      try { if (!W.open()) return true; const st = W.state(); if (st && typeof st.phase !== 'string') return 'its state can\'t be read'; } catch (e) { return 'its state can\'t be read'; }
      return true; } },
    { key: 'league', label: 'the Elite League', types: ['league'], test() {
      const L = E.get('LegendZones'); for (const f of ['leagueOpen', 'leagueNext', 'leagueBest']) if (typeof L?.[f] !== 'function') return `${f} is missing`;
      if (typeof E.get('Adventure')?.startLeague !== 'function') return 'starting a League run isn\'t possible';
      return true; } },
  ];
  let results = {}, lastRun = 0;
  function run() {
    if (!E.ready()) return;
    lastRun = Date.now();
    const prev = results; results = {};
    for (const c of CHECKS) {
      let r; try { r = c.test(); } catch (e) { r = 'check failed: ' + (e?.message || e); }
      results[c.key] = r === true ? { ok: true } : { ok: false, why: String(r) };
      if (!results[c.key].ok && prev[c.key]?.ok !== false) { Log.add(`safety check: ${c.label} - ${results[c.key].why}. Goals that use it are paused until it looks right.`); try { Notify.send('problem', `Mega paused: ${c.label} looks wrong`, `${results[c.key].why} - probably a game update. Goals that use it wait until it looks right.`); } catch (__e) { __h('68-guard:109', __e); } }
      if (results[c.key].ok && prev[c.key]?.ok === false) Log.add(`safety check: ${c.label} looks right again`);
    }
  }
  // the failed check that blocks this goal type, if any
  function blocks(type) {
    if (!lastRun || Date.now() - lastRun > 10 * 60_000) run();
    for (const c of CHECKS) { const r = results[c.key]; if (r && !r.ok && (c.types === '*' || c.types.includes(type))) return `${c.label}: ${r.why}`; }
    return null;
  }
  const failures = () => CHECKS.filter((c) => results[c.key] && !results[c.key].ok).map((c) => ({ key: c.key, label: c.label, why: results[c.key].why }));
  let timer = null;
  function boot() { if (timer) return; setTimeout(() => { try { run(); } catch (__e) { __h('68-guard:121', __e); } }, 15_000); timer = setInterval(() => { try { run(); } catch (__e) { __h('68-guard:121', __e); } }, 10 * 60_000); }
  return { team, stop, blocks, failures, run, boot, get results() { return results; }, CHECKS };
})();

/* ---------------------------------------------------------------------------------------------
 * Buddy (x1.3 XP plus a candy every few KOs) - one rule for every activity (Jimmy):
 *   1. the lowest-level Pokémon on the team that can still gain XP (below Lv 100 and below its level cap)
 *   2. nobody on the team can level -> the Pokémon in the PC closest to Lv 100 that still can; when it gets
 *      there, the next closest, and so on
 * A tie keeps the current buddy (no flipping). Checked every 5 s while the plan runs; the goals no longer
 * set the buddy themselves, so nothing fights over it.
 * ------------------------------------------------------------------------------------------- */
const Buddy = (() => {
  const E = Engine;
  const S = () => E.get('Game.S') || {};
  const cap = (m) => { let c = 100; try { c = +E.read('Game.capFor', 0, m) || 100; } catch (__e) { __h('69-buddy:12', __e); } return Math.min(100, c); };
  const canLevel = (m) => m && m.level < cap(m);
  const bad = new Map(); // uid -> until: the game refused it as buddy (other side, Day Care...)
  function pick() {
    const team = (S().team || []).map((u) => E.read('Game.getMon', null, u)).filter(Boolean);
    const cur = E.read('Game.getMon', null, S().buddy?.uid);
    const ok = (m) => canLevel(m) && !(bad.get(m.uid) > Date.now()) && !(() => { try { return GoalKit.dexHold(m); } catch { return false; } })(); // never push a Pokédex keeper into evolving
    const growing = team.filter(ok);
    if (growing.length) {
      const low = Math.min(...growing.map((m) => m.level));
      if (cur && growing.includes(cur) && cur.level === low) return { m: cur, why: 'lowest on the team' };
      return { m: growing.find((m) => m.level === low), why: 'lowest on the team' };
    }
    // everyone on the team is at Lv 100 (or the cap): the PC Pokémon closest to 100 that can still level
    let pc = []; try { pc = (E.read('Game.sideMons', null) || E.read('Game.allMons', []) || []).filter(ok); } catch (__e) { __h('69-buddy:26', __e); }
    if (!pc.length) return null;
    const top = Math.max(...pc.map((m) => m.level));
    if (cur && pc.includes(cur) && cur.level === top) return { m: cur, why: 'closest to Lv 100 in the PC' };
    return { m: pc.find((m) => m.level === top), why: 'closest to Lv 100 in the PC (the team is maxed)' };
  }
  function check() {
    if (S().adv?.zone && S().adv?.battle) return; // never mid-battle in a zone
    const p = pick(); if (!p || S().buddy?.uid === p.m.uid) return;
    try { E.call('Game.setBuddy', p.m.uid); } catch (__e) { __h('69-buddy:35', __e); }
    if (S().buddy?.uid === p.m.uid) { try { Log.add(`buddy: ${Engine.get('Game.DEX')?.[p.m.id]?.name || 'a Pokémon'} (Lv ${p.m.level}) - ${p.why}`); } catch (__e) { __h('69-buddy:36', __e); } }
    else bad.set(p.m.uid, Date.now() + 60 * 60_000); // the game said no: try the next one
  }
  setInterval(() => { try { if (typeof Plan !== 'undefined' && Plan.running && E.ready()) check(); } catch (__e) { __h('69-buddy:39', __e); } }, 5000);
  return { pick, check };
})();

/* ---------------------------------------------------------------------------------------------
 * MoveTune: which status moves a boss team should use (game v0.5.12: a Pokémon's card lets you turn a
 * learned move off; Jimmy 2026-11-22: "Mega taps the move itself").
 * The game's rule (read in its code): a Pokémon with a status move that can land uses it 30% of the time
 * (STATUS_MOVE_CHANCE) - the last one it learned - and otherwise its best attack on that foe. So turning a
 * damaging move off never helps (the best one is already chosen); turning a status move off makes it attack
 * every turn, or makes it use an earlier status move instead. Before a Legendary / Elite / World Boss fight,
 * Mega tries those options in its tuned boss simulation, one Pokémon at a time, and keeps a change only when
 * the fight clearly improves.
 * Applying = exactly what the card's tap does (the game's own handler): the Pokémon's `ban` list, refused if no
 * attacking move would be left, then Game.save() and the game's "mon-moves" signal. Mega only ever changes
 * STATUS moves, and only the ones it turned off itself: moves you turned off stay off. Settings › Moves turns
 * it off and gives back every move Mega took away.
 * ------------------------------------------------------------------------------------------- */
const MoveTune = (() => {
  const E = Engine, KEY = 'mega-movetune', PKEY = 'mega-movetune-on';
  const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k) ?? 'null') ?? d; } catch { return d; } };
  let mine = load(KEY, {}); // uid -> status moves Mega turned off
  let on = load(PKEY, true);
  const done = {}; // signature -> result (per fight + team + levels + your own switches)
  let busy = false;
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(mine)); } catch (__e) { __h('69-movetune:22', __e); } };
  const G = () => E.get('Game');
  const live = (u) => { try { return G().getMon(u); } catch { return null; } };
  const isStatus = (k, m) => { try { return G().movePower(k, m) <= 0 && !!E.get('STATUS')?.MOVES?.[k]; } catch { return false; } };
  const attacks = (k, m) => { try { return G().movePower(k, m) > 0; } catch { return false; } };
  // the status moves it has learned by now (turned off or not), in the order it learned them
  const statusMoves = (m) => { try { return G().learnAllOf(m).filter(([lv, k]) => lv <= m.level && isStatus(k, m)).map(([, k]) => k).filter((k, i, a) => a.indexOf(k) === i); } catch { return []; } };
  const yours = (m) => (m.ban || []).filter((k) => !(mine[m.uid] || []).includes(k)); // switches you made yourself
  // the choices for one Pokémon: as it is (all its status moves on), none (always attack), or just one of them
  function options(m) {
    const S = statusMoves(m).filter((k) => !yours(m).includes(k));
    if (!S.length) return [];
    const out = [[], [...S]];
    if (S.length > 1) for (const k of S) out.push(S.filter((x) => x !== k));
    return out;
  }
  const withOff = (m, off) => ({ ...m, ban: [...new Set([...yours(m), ...off])] });
  const sigOf = (foe, mons, zone) => `${foe}|${zone?.id ?? ''}|${zone?.elite ?? ''}|${Sim.isNight()}|` + mons.map((m) => `${m.uid}:${m.level}:${yours(m).join('.')}`).join(',');
  const nm = (k) => { try { return E.get('Game').MOVES?.[k]?.name || Casing.title(k.replace(/-/g, ' ')); } catch { return k; } };

  // what to turn off for this fight: [{ uid, off: [...] }] and the simulated gain
  async function tune(foe, mons, zone) {
    const ev = (t) => { try { return Sim.evaluate(t, +foe, 120, 7, null, zone).score; } catch { return -1; } };
    const pause = () => new Promise((ok) => setTimeout(ok, 0));
    let team = mons.map((m) => withOff(m, [])), base = ev(team), best = base;
    const pick = Object.fromEntries(mons.map((m) => [m.uid, []]));
    for (let i = 0; i < mons.length; i++) {
      const opts = options(mons[i]); if (!opts.length) continue;
      for (const off of opts.slice(1)) {
        await pause();
        const trial = team.slice(); trial[i] = withOff(mons[i], off);
        const v = ev(trial);
        if (v > best + 0.015) { best = v; team = trial; pick[mons[i].uid] = off; } // a clear gain only (about 1.5 KO points)
      }
    }
    return { base, best, pick };
  }
  // the card tap, as the game does it
  function setOff(uid, off) {
    const m = live(uid); if (!m) return false;
    const want = [...new Set([...yours(m), ...off])];
    const left = G().learnAllOf(m).some(([lv, k]) => lv <= m.level && attacks(k, m) && !want.includes(k));
    if (!left) return false; // the game refuses this too (it always keeps an attacking move)
    const now = (m.ban || []).slice().sort().join(), next = want.slice().sort().join();
    if (now === next) { if (off.length) mine[uid] = off; else delete mine[uid]; save(); return true; }
    m.ban = want.length ? want : undefined;
    if (off.length) mine[uid] = off; else delete mine[uid];
    save();
    try { E.call('Game.save'); } catch (__e) { __h('69-movetune:70', __e); }
    try { E.ns().dispatchEvent(new CustomEvent('mon-moves', { detail: uid })); } catch (__e) { __h('69-movetune:71', __e); }
    return true;
  }
  // before a boss fight: returns '' when the moves are set (or there's nothing to do), or a status while it works
  async function ensure(foe, uids, zone, who) {
    if (!on) return '';
    const mons = (uids || []).map(live).filter(Boolean);
    if (!mons.some((m) => options(m).length)) { for (const m of mons) if (mine[m.uid]) setOff(m.uid, []); return ''; }
    const sig = sigOf(foe, mons, zone);
    if (done[sig]) return '';
    if (busy) return 'checking which status moves to use…';
    busy = true;
    try {
      const r = await tune(foe, mons, zone);
      const changed = [];
      for (const m of mons) {
        const off = r.pick[m.uid] || [], before = mine[m.uid] || [];
        if (off.slice().sort().join() === before.slice().sort().join()) continue;
        if (setOff(m.uid, off)) changed.push(off.length ? `${Casing.names(E.get('Game.DEX')[m.id].name)} stops using ${off.map(nm).join(' and ')}` : `${Casing.names(E.get('Game.DEX')[m.id].name)} gets ${before.map(nm).join(' and ')} back`);
      }
      done[sig] = { at: Date.now(), ...r };
      if (changed.length) Log.add(`moves for ${who || 'the fight'}: ${changed.join('; ')} - simulated ${Math.round(r.base * 100)} → ${Math.round(r.best * 100)} points`);
      return '';
    } catch (e) { done[sig] = { at: Date.now(), error: String(e) }; return ''; } finally { busy = false; }
  }
  // Settings: turn it off / give every move back
  function giveBack() { let n = 0; for (const u of Object.keys(mine)) if (setOff(u, [])) n++; else delete mine[u]; save(); return n; }
  function set(v) { on = !!v; try { localStorage.setItem(PKEY, JSON.stringify(on)); } catch (__e) { __h('69-movetune:98', __e); } if (!on) giveBack(); }
  const list = () => Object.entries(mine).map(([uid, off]) => ({ uid, id: live(uid)?.id, off: off.map(nm) })).filter((x) => x.id);
  return { ensure, tune, options, statusMoves, setOff, giveBack, set, list, get on() { return on; }, get mine() { return mine; } };
})();

/* ---------------------------------------------------------------------------------------------
 * Risk: how likely a lap of a chapter is lost, for the money and XP spot rankings (the idea from
 * ZGRay00's helper: a League lap it might lose is worth less). Only chapters with a leader at the end
 * (gyms, the Elite Four, the Champion) can be lost in a way that costs the lap: Mega simulates your
 * strongest six against that leader (the game's gym rules, night version at night) and keeps the
 * answer 30 minutes. A measured ₽ or XP per hour already includes real losses, so the discount only
 * touches estimates: worth = estimate x (0.5 + 0.5 x win chance) - the trainers before the leader still
 * pay when you lose to him.
 * ------------------------------------------------------------------------------------------- */
const Risk = (() => {
  const E = Engine, TTL = 30 * 60_000, memo = {};
  const ST = () => E.get('STORY');
  // never a long freeze: at most ~25 ms of new simulations per second; a chapter not worked out yet counts as
  // no discount until its turn comes. Each answer is kept 30-40 min (spread out, so they don't all expire at once).
  let slot = 0, spent = 0, team = null, teamAt = 0;
  const budgetOk = () => { const now = performance.now(); if (now - slot > 1000) { slot = now; spent = 0; } return spent < 25; };
  function strongestCached() { if (!team || Date.now() - teamAt > 5 * 60_000) { team = strongest(); teamAt = Date.now(); } return team; }
  function strongest() {
    const g = E.get('Game'), seen = new Set();
    const useful = (m) => { try { const s = g.statsOf(m); return s.hp + s.def + s.spd + s.spe + Math.max(s.atk, s.spa); } catch { return 0; } };
    const away = new Set((E.read('Game.underMons', []) || []).map((m) => m.uid));
    return (E.read('Game.ownedMons', []) || []).filter((m) => !away.has(m.uid)).sort((a, b) => useful(b) - useful(a))
      .filter((m) => { const sp = Sim.species(m); if (seen.has(sp)) return false; seen.add(sp); return true; }).slice(0, 6);
  }
  // { win, who } for a chapter's leader, or null when the chapter has no leader to lose to
  function of(ch) {
    const night = Sim.isNight(), m = memo[ch];
    if (m && Date.now() - m.at < m.ttl && m.night === night) return m.r;
    if (!budgetOk()) return m ? m.r : null; // over this second's budget: the old answer (or none) for now
    const t0 = performance.now();
    let r = null;
    try {
      const st = ST(), step = (st.CHAPTERS[ch]?.steps || []).find((x) => x.kind === 'gym' && Array.isArray(x.team) && x.team.length);
      // a beaten leader the game keeps out of later laps (step.keep, adv.kept) isn't fought again
      const kept = step?.keep && (E.get('Game.S')?.adv?.kept?.[ch] || []).includes(step.leader);
      if (step && !kept) {
        const gym = Sim.gymNow(step, ch), foes = st.gymTeam(ch, gym).map(([id, lv], i) => ({ uid: 'r' + i, id: +id, level: +lv }));
        const team = strongestCached();
        if (team.length && foes.length) r = { win: Sim.gymEval(team, foes, gym, 60).win, who: gym.leader || 'the leader' };
      }
    } catch { r = null; }
    memo[ch] = { at: Date.now(), ttl: TTL + Math.random() * 10 * 60_000, night, r };
    spent += performance.now() - t0;
    return r;
  }
  const factor = (ch) => { const r = of(ch); return r ? 0.5 + 0.5 * r.win : 1; };
  return { of, factor };
})();

/* ===================================================================================================
 * XpChap - which chapter levels Pokémon fastest, in XP per hour.
 *
 *   XP per win  = the game's own formula, averaged over the chapter's wild Pokémon as they spawn:
 *                 levelXp(foe Lv) / XP_WINS_PER_LEVEL x sqrt(BASE_EXP[foe] / XP_BASE_REF), x1.5 for a trainer.
 *                 (REGION_XP is NOT a reward: it is how much more XP every level costs once your newest region
 *                 is Johto/Hoenn/Sinnoh/Unova - the same wherever you train. Until 2.10.5 Mega counted it as a
 *                 bonus for the chapter's own region, so older regions looked 25-35% worse than they are.)
 *   wins / hour = learned: Mega counts the game's battles while it trains in a chapter (5+ min of data).
 *                 Chapters it hasn't trained in yet use your average from the chapters it has.
 *   XP / hour   = the two multiplied.
 *
 * Close calls: when another chapter predicts within 10% of the best and has under 10 minutes of real
 * data, Mega trains there for 10 minutes first, then keeps whichever really pays more.
 * =================================================================================================== */
const XpChap = (() => {
  const E = Engine, KEY = 'mega-xprate';
  const S = () => E.get('Game.S') || {};
  const LEARN = 5 * 60_000, SCOUT = 10 * 60_000, CLOSE = 0.9, DEFAULT_RATE = 450;
  let rates = {}; try { rates = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (__e) { __h('69-xpchap:20', __e); }
  const keep = () => { try { localStorage.setItem(KEY, JSON.stringify(rates)); } catch (__e) { __h('69-xpchap:21', __e); } };
  let last = null;

  function perWin(ch) {
    const C = E.get('CONFIG') || {}, B = E.get('BASE_EXP') || {}, ST = E.get('STORY');
    const ref = +C.XP_BASE_REF || 60, wins = +C.XP_WINS_PER_LEVEL || 15;
    let pool = []; try { pool = Sim.chapterPool(ch); } catch (__e) { __h('69-xpchap:27', __e); }
    if (!pool.length) {
      // trainer-only chapters (Elite Four rooms, N's Castle, Ghetis): no wild pool - every fight is a trainer (x1.5)
      let t = 0; for (const st of ST?.CHAPTERS?.[ch]?.steps || []) if (st.kind === 'route') t += +st.trainers || 0;
      const band = (() => { try { return ST.bandOf(ch); } catch { return null; } })(), top = band && Math.max(...band.filter((x) => x != null));
      return t && top && isFinite(top) ? (E.read('Game.levelXp', 0, top) || 0) / wins * 1.5 : 0;
    }
    const xp = pool.reduce((t, p) => t + p.w * (E.read('Game.levelXp', 0, p.lv) || 0) / wins * Math.sqrt((+B[p.id] || ref) / ref), 0);
    // trainers pay x1.5: weight by the chapter's wild and trainer stops (route steps: wild: n, trainers: n)
    let w = 0, t = 0; for (const st of ST?.CHAPTERS?.[ch]?.steps || []) { if (st.kind === 'route') { w += +st.wild || 0; t += +st.trainers || 0; } }
    return w + t > 0 ? xp * (w + 1.5 * t) / (w + t) : xp;
  }
  function avgRate() {
    let b = 0, ms = 0; for (const r of Object.values(rates)) if (r.ms >= LEARN) { b += r.b; ms += r.ms; }
    return ms ? b / ms * 3.6e6 : DEFAULT_RATE;
  }
  function rateOf(ch) { const r = rates[ch]; return r && r.ms >= LEARN ? { rate: r.b / r.ms * 3.6e6, learned: true } : { rate: avgRate(), learned: false }; }
  // every unlocked chapter with wild Pokémon, best XP per hour first
  function rank() {
    const ST = E.get('STORY'), unlocked = +(S().adv?.unlocked ?? 0), out = [];
    for (let ch = 0; ch <= unlocked && ch < (ST?.CHAPTERS?.length || 0); ch++) {
      const band = (() => { try { return ST.bandOf(ch); } catch { return null; } })();
      const top = band && Math.max(...band.filter((x) => x != null));
      if (!top || !isFinite(top)) continue;
      const pw = perWin(ch); if (!pw) continue;
      // the band's top is the real level of the last stops (the game scales every chapter to its band)
      const wildTop = top;
      const { rate, learned } = rateOf(ch);
      const rx = rates[ch], real = rx && rx.xms >= SCOUT && rx.x > 0 ? rx.x / rx.xms * 3.6e6 : null;
      out.push({ ch, top: isFinite(wildTop) ? wildTop : top, name: ST.CHAPTERS[ch]?.name || 'chapter ' + ch, perWin: pw, rate, learned, min: Math.round((rates[ch]?.ms || 0) / 60_000), est: pw * rate, risk: real == null ? Risk.factor(ch) : 1, real: real != null, xpHr: real ?? pw * rate * (real == null ? Risk.factor(ch) : 1), score: real ?? pw * rate * (real == null ? Risk.factor(ch) : 1) });
    }
    return out.sort((a, b) => b.xpHr - a.xpHr || b.ch - a.ch);
  }
  // the chapter to train in; with a level goal (g) it remembers its choice for 10 minutes and scouts close calls
  function pick(g) {
    const r = rank(); if (!r.length) return null;
    if (!g) return r[0];
    // g.xpTest: chapters to measure 10 min each first (real XP), then the best measured
    if (g.xpTest?.length) {
      const todo = g.xpTest.map((c) => r.find((x) => x.ch === +c)).find((x) => x && !x.real);
      const choice = todo || r.filter((x) => x.real)[0] || r[0];
      if (g.chPick !== choice.ch) { try { Log.add(todo ? `XP test: measuring ${choice.name} for 10 min (estimate ${fmt(choice.est)} XP/h)` : `XP test done: ${r.filter((x) => x.real && g.xpTest.includes(x.ch)).map((x) => `${x.name} ${fmt(x.xpHr)}/h`).join(' · ')}`); } catch (__e) { __h('69-xpchap:68', __e); } }
      g.chPick = choice.ch; g.chPickAt = Date.now(); g.chScout = !!todo;
      return { ...choice, scout: !!todo };
    }
    const kept = r.find((x) => x.ch === g.chPick);
    if (kept && Date.now() - (g.chPickAt || 0) < SCOUT) return { ...kept, scout: !!g.chScout };
    const top = r[0], close = r.filter((x) => x.xpHr >= top.xpHr * CLOSE);
    const untested = close.find((x) => (rates[x.ch]?.ms || 0) < SCOUT);
    const choice = (rates[top.ch]?.ms || 0) < SCOUT ? top : (untested || top);
    const scout = choice.ch !== top.ch;
    if (g.chPick !== choice.ch) {
      try { Log.add(scout ? `checking ${choice.name} for 10 min: predicted ${fmt(choice.xpHr)} XP/h, close to ${top.name} (${fmt(top.xpHr)})` : `best leveling chapter: ${choice.name} - ${fmt(choice.xpHr)} XP/h${choice.learned ? ' (measured)' : ' (predicted)'}`); } catch (__e) { __h('69-xpchap:79', __e); }
    }
    g.chPick = choice.ch; g.chPickAt = Date.now(); g.chScout = scout;
    return { ...choice, scout };
  }
  // count the game's battles while training in ch (gaps over 2 min - tab asleep, PC off - don't count)
  // ---- real XP per hour (Jimmy 2026-11-21: "did we ever run an XP test?"): the XP the game really hands out.
  // Every team member gets the same XP per knock-out, so Mega follows one team member below its cap (rank 0 if
  // possible) and adds up its XP across level-ups (Game.xpForNext). Stored as x (XP) over xms (time watched).
  let probe = null;
  const need = (lv, m) => { try { return +E.get('Game').xpForNext(lv, m) || 0; } catch { return 0; } };
  function xpGain(ch, t) {
    const team = (() => { try { return E.get('Game').teamMons() || []; } catch { return []; } })();
    const capOf = (m) => Math.min(100, E.read('Game.capFor', 100, m) || 100);
    let m = probe && team.find((x) => x.uid === probe.uid && x.id === probe.id && x.level < capOf(x));
    let got = null;
    if (m && probe.ch === ch && t - probe.t < 120_000) {
      if (m.level === probe.lv) got = m.xp - probe.xp;
      else if (m.level > probe.lv) { got = need(probe.lv, m) - probe.xp + m.xp; for (let l = probe.lv + 1; l < m.level; l++) got += need(l, m); }
      if (got != null && got < 0) got = null;
    }
    if (!m) m = [...team].filter((x) => x.level < capOf(x)).sort((a, b) => (a.rank || 0) - (b.rank || 0) || a.level - b.level)[0];
    probe = m ? { uid: m.uid, id: m.id, lv: m.level, xp: m.xp, ch, t } : null;
    return got;
  }
  function tick(ch) {
    { const t0 = Date.now(), g = xpGain(ch, t0), r = rates[ch] || (rates[ch] = { b: 0, ms: 0 });
      if (g != null && last && last.ch === ch) { r.x = (r.x || 0) + g; r.xms = (r.xms || 0) + Math.min(t0 - last.t, 120_000); } }
    const b = +S().stats?.battles || 0, t = Date.now();
    if (last && last.ch === ch && b >= last.b && t - last.t < 120_000) {
      const r = rates[ch] || (rates[ch] = { b: 0, ms: 0 });
      r.b += b - last.b; r.ms += t - last.t;
      // keep it about the last 2 hours so speed or team changes show up
      if (r.ms > 2 * 3.6e6) { const k = 2 * 3.6e6 / r.ms; r.b *= k; r.ms *= k; }
      if ((r.xms || 0) > 2 * 3.6e6) { const k = 2 * 3.6e6 / r.xms; r.x *= k; r.xms *= k; }
      keep();
    }
    last = { ch, b, t };
  }
  const fmt = (n) => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(Math.round(n));
  return { perWin, rank, pick, tick, rateOf, fmt, get rates() { return rates; } };
})();

// The plan engine, one file per goal type (1.0). Files 70-plan-00 … 70-plan-20 are joined in order into one
// script, so together they are the GoalTypes and Plan blocks: shared helpers live in 00-core, the runner in 20-engine.
/* ---------------------------------------------------------------------------------------------
 * Log: what Mega did and why, newest last. Kept in localStorage (last 200 lines).
 * ------------------------------------------------------------------------------------------- */
const Log = (() => {
  const KEY = 'mega-log';
  let lines = (() => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } })();
  function add(text) {
    lines.push({ at: Date.now(), text });
    if (lines.length > 1000) lines = lines.slice(-1000);
    try { localStorage.setItem(KEY, JSON.stringify(lines)); } catch { lines = lines.slice(-300); try { localStorage.setItem(KEY, JSON.stringify(lines)); } catch (__e) { __h('70-plan-00-core:12', __e); } }
    console.log('[Mega Alakazam] ' + text);
    try { Remote.soon(); } catch (__e) { __h('70-plan-00-core:14', __e); } // phone sees it right away
  }
  return { add, get lines() { return lines; } };
})();

/* ---------------------------------------------------------------------------------------------
 * Goal types. Each type says what it needs and how to do one step of it:
 *   uses:  'screen'      needs the battle screen (only one such goal runs at a time)
 *          'background'  runs alongside (none yet - the Underground comes next)
 *   label(g)            short name for the list
 *   check(g)            -> { state: 'done' | 'ready' | 'wait', why }   (read-only, cheap)
 *   step(g, ctx)        do one step; returns a status line
 * ------------------------------------------------------------------------------------------- */
const GoalTypes = {}; // every goal type registers itself here (70-plan-01 … 19), plus a few helpers other parts of Mega use

// ---- GoalKit: the helpers more than one goal uses. Each goal file takes what it needs from here. ----
const GoalKit = (() => {
  const E = Engine;
  const S = () => E.get('Game.S') || {};
  const name = (id) => E.get('Game.DEX')?.[id]?.name || '#' + id;
  const pending = new Set(); // legend ids whose team search is running

  // the battle screen is held by a run Mega must never interrupt
  function holder() {
    const s = S(), a = s.adv || {};
    if (a.event?.raid) return 'a ' + RaidCount.label(a.event) + ' run';
    if (a.tower != null) return a.tower.kind === 'candy' ? 'a Candy Factory run' : 'a Battle Tower run';
    if (s.candy?.run) return 'a Candy Factory run';
    if (s.tower?.run) return 'a Battle Tower run';
    if (a.league) return 'a League run';
    return null;
  }

  function setTeam(id, uids) {
    const have = new Set((E.read('Game.allMons', []) || []).map((m) => m.uid));
    const team = uids.filter((u) => have.has(u)).slice(0, 6);
    if (team.length < uids.length) return { ok: false, why: 'some of those Pokémon are away (Underground or a trade)' };
    const s = S();
    s.eventTeams = s.eventTeams || {};
    s.eventTeams['zone:' + id] = team;
    try { E.call('Game.save'); } catch (__e) { __h('70-plan-00-core:54', __e); }
    try { E.call('App.refresh'); } catch (__e) { __h('70-plan-00-core:55', __e); }
    const now = E.read('Game.zoneTeam', [], +id) || [];
    const ok = now.length === team.length && team.every((u, i) => now[i] === u);
    const dropped = team.filter((u) => !now.includes(u)).map((u) => name(E.read('Game.getMon', {}, u)?.id));
    Log.add(ok ? `${name(id)}: team set (${team.map((u) => name(E.read('Game.getMon', {}, u)?.id)).join(', ')})` : `${name(id)}: the game kept only ${now.length} of ${team.length}${dropped.length ? ` - it dropped ${dropped.join(', ')}` : ''}`);
    if (!ok) { Legends.dropSim(+id); }
    return { ok, why: ok ? null : `the game dropped ${dropped.join(', ') || 'part of the team'} - finding a new team` };
  }

  // find a team with the simulator, in the background, once per legendary
  const LEVEL_WORTH = 0.15; // leveling has to win at least 15 points of KO chance to be worth the time
  function autoTeam(id) {
    if (pending.has(id)) return;
    pending.add(id);
    Log.add(`${name(id)}: no team yet - simulating with your Pokémon as they are, and as if all were Lv 100`);
    (async () => {
      const now = await Sim.search(id, {});
      const max = await Sim.search(id, { asMax: true });
      const pick = max.toLevel.length && max.final.ko - now.final.ko >= LEVEL_WORTH ? max : now;
      Legends.saveSim(id, pick);
      Log.add(`${name(id)}: best team today ${Math.round(now.final.ko * 100)}%, once leveled ${Math.round(max.final.ko * 100)}% - ${pick === max ? 'leveling first' : 'no leveling needed'}`);
    })().catch((e) => Log.add(`${name(id)}: the simulator stopped (${e?.message || e})`)).finally(() => pending.delete(id));
  }
  // the saved team still has Pokémon below the level it was simulated at -> a level goal goes first
  function levelFirst(g) {
    const sim = Legends.sims()[g.foe];
    if (!sim?.asMax || !sim.toLevel?.length) return null;
    const low = sim.toLevel.filter((x) => (E.read('Game.getMon', null, x.uid)?.level ?? 100) < x.to).map((x) => x.uid);
    return low.length ? low : null;
  }


  const safe = (f, d = null) => { try { const v = f(); return v === undefined ? d : v; } catch { return d; } };
  // a region run only counts Pokémon on that region's side (the game's sideMons), any stage of the family
  const sideHas = (id) => { const f = new Set(safe(() => [...(E.read('Game.familyOf', [], id) || [])].map(Number), [+id])); f.add(+id); return (E.read('Game.sideMons', []) || []).some((m) => f.has(+m.id)); };
  const sideOf = (id) => { const f = new Set(safe(() => [...(E.read('Game.familyOf', [], id) || [])].map(Number), [+id])); f.add(+id); return (E.read('Game.sideMons', []) || []).filter((m) => f.has(+m.id)).sort((a, b) => b.level - a.level)[0] || null; };
  const lvl = (u) => E.read('Game.getMon', null, u)?.level ?? null;
  const capOf = (u) => { const m = E.read('Game.getMon', null, u); return Math.min(100, E.read('Game.capFor', 100, m) || 100); };
  // Rule: a chapter team is always full. Goals pick the Pokémon that matter (trainees, carriers, the gym
  // plan); any slot left over gets the strongest free Pokémon from this side (not in the Underground,
  // not an egg, no repeats), so nothing ever fights with 4 or 5 by accident.
  // Pokédex keepers (2026-11-19: a Deino leveled on through Zweilous into Hydreigon, and both Deino and
  // Zweilous went to 'lost' in the Pokédex): your ONLY copy of a species, within 3 levels of evolving by level,
  // loses that Pokédex entry when it evolves. Mega keeps it off the teams it fills, out of idle leveling and
  // never makes it the buddy - unless a goal is leveling it on purpose to evolve it.
  function dexHold(m) {
    if (!m || m.level >= 100) return false; // Lv 100 can't level up, so it can't evolve any more
    const next = ((E.get('EVOLUTIONS') || {})[m.id] || []).filter((e) => e.level && !e.item).map((e) => +e.level);
    if (!next.length || m.level < Math.min(...next) - 3) return false;
    if ((E.read('Game.ownedMons', []) || []).filter((x) => +x.id === +m.id).length > 1) return false;
    try { if (Plan.goals.some((g) => !g.done && g.type === 'level' && g.forDex && (g.uids || []).includes(m.uid))) return false; } catch (__e) { __h('70-plan-00-core:105', __e); }
    return true;
  }
  function fullTeam(uids) {
    const out = [...new Set((uids || []).filter(Boolean))].slice(0, 6);
    if (out.length >= 6) return out;
    const away = awayNow(), have = new Set(out);
    const spare = (E.read('Game.sideMons', []) || []).filter((m) => m && !have.has(m.uid) && !away.has(m.uid) && !dexHold(m)).sort((a, b) => b.level - a.level);
    for (const m of spare) { if (out.length >= 6) break; out.push(m.uid); }
    return out;
  }
  function setChapterTeam(uids) {
    const s = S();
    uids = fullTeam(uids);
    s.team = uids.slice(0, 6);
    s.road = null; // the game rebuilds the road team from .team (same as its own team editor)
    try { E.call('Game.save'); } catch (__e) { __h('70-plan-00-core:121', __e); }
    try { E.call('App.refresh'); } catch (__e) { __h('70-plan-00-core:122', __e); }
    const now = (E.read('Game.teamMons', []) || []).map((m) => m.uid);
    return uids.every((u) => now.includes(u));
  }

  const U = () => E.get('Underground');
  // Pokémon down in the Underground: the game won't put them on any team until they come back
  const awayNow = () => new Set((E.read('Game.underMons', []) || []).map((m) => m.uid));
  const here = () => { const a = awayNow(); return (E.read('Game.ownedMons', []) || []).filter((m) => !a.has(m.uid)); };
  const power = (m) => { const st = E.read('Game.statsOf', null, m) || {}; return (st.hp || 0) + (st.atk || 0) + (st.def || 0) + (st.spa || 0) + (st.spd || 0) + (st.spe || 0); };
  const poolAt = (stop, ch) => E.pool(stop, ch);
  const RD = () => E.get('Raids');
  const bst = (id) => { const st = (E.get('Game.DEX') || {})[id]?.stats || {}; return (st.hp || 0) + (st.atk || 0) + (st.def || 0) + (st.spa || 0) + (st.spd || 0) + (st.spe || 0); };
  const ownsShiny = (id) => (E.read('Game.ownedMons', []) || []).some((m) => +m.id === +id && m.shiny);
  // how much you'd want this region's boss: a shiny you don't own counts most, then its base stats
  const want = (id) => (ownsShiny(id) ? 0 : 1000) + bst(id);
  function hatchMissing() {
    for (const e of [...(S().pension?.eggs || [])]) {
      if (E.read('Game.inDex', false, +e.id) || !E.read('Game.eggReady', false, e)) continue;
      let r = null; try { r = E.call('Game.hatchEgg', e.uid); } catch (__e) { __h('70-plan-00-core:141', __e); }
      if (r) { try { E.call('Game.save'); } catch (__e) { __h('70-plan-00-core:142', __e); } try { E.call('App.refresh'); } catch (__e) { __h('70-plan-00-core:142', __e); } Log.add(`hatched a ${name(e.id)} egg from the Day Care`); }
    }
  }
  const LZ = () => E.get('LegendZones');
  // the World Boss zone: game 0.5.10 keeps it out of LegendZones.ZONES (only LegendZones.get finds it; the boss is Arceus, #493)
  const wbZone = () => { const L = LZ(); return (L?.ZONES || []).find((z) => z.wb) || (() => { try { const z = L?.get?.(493); return z?.wb ? z : null; } catch { return null; } })(); };

  // ---- shared: go to a chapter and keep it (remember what to put back) -------------------------------
  // the best team for a chapter you're only passing through (catching, a special encounter, souls,
  // a rare item): its 6 best carriers for that chapter's foes, from the side that can play it. The team
  // you had comes back when the goal is done. Pokémon in the Underground or on a raid stay put.
  function passTeam(g, ch) {
    if (g.teamSet === ch) return;
    let picks = []; try { picks = Sim.carriers(+ch, { n: 6, minLevel: 1 }).picks; } catch (__e) { __h('70-plan-00-core:155', __e); }
    const uids = picks.map((p) => p.m.uid);
    if (!g.restore.team) g.restore.team = (S().team || []).slice();
    if (uids.length >= Math.min(6, (S().team || []).length || 1) && uids.join() !== (S().team || []).slice(0, 6).join()) { if (setChapterTeam(uids)) Log.add(`team for ${E.get('STORY')?.CHAPTERS?.[ch]?.name || 'chapter ' + ch}: ${picks.map((p) => `${name(p.m.id)} Lv ${p.m.level}`).join(', ')}`); }
    g.teamSet = +ch; Plan.save();
  }
  // a special encounter's own fight: the simulator searches the Pokémon that can play this chapter for the
  // team that wins it most (like a legendary). Until it's done, the chapter's carriers play; redone every 6 h.
  const bossBusy = new Set();
  function bossTeam(g, ch, foe) {
    const z = safe(() => Sim.staticZone(ch, foe)); if (!z) return;
    if (g.boss && Date.now() - g.boss.at < 6 * 3.6e6) {
      if (g.boss.uids.join() !== (S().team || []).slice(0, 6).join() && g.boss.uids.every((u) => E.read('Game.getMon', null, u))) { if (setChapterTeam(g.boss.uids)) Log.add(`${name(foe)}: team from the simulator (~${Math.round(g.boss.win * 100)}%)`); }
      return;
    }
    if (bossBusy.has(g.id)) return; bossBusy.add(g.id);
    (async () => {
      try {
        const r = await Sim.search(+foe, { pool: Sim.sidePool(ch), zone: z });
        g.boss = { uids: r.team.map((m) => m.uid), win: r.final.ko, at: Date.now() }; g.teamWin = r.final.ko; g.teamHow = 'simulated for this encounter'; Plan.save();
        Log.add(`${name(foe)}: best team ${r.team.map((m) => name(m.id)).join(', ')} - wins ${Math.round(r.final.ko * 100)}% of simulated fights`);
      } catch (e) { Log.add(`${name(foe)}: team search failed (${e?.message || e})`); }
      finally { bossBusy.delete(g.id); }
    })();
  }
  function goChapter(g, ch, label) {
    const a = S().adv || {};
    if (!g.restore) { g.restore = { chapter: a.chapter, loopAdded: null }; Plan.save(); Log.add(`${label}: going to ${E.get('STORY')?.CHAPTERS?.[ch]?.name || 'chapter ' + ch}. Your chapter comes back when it's done.`); }
    if (a.zone) { if (fighting()) return 'waiting for this fight to end before leaving the zone…'; try { E.call('Adventure.leaveZone'); } catch (__e) { __h('70-plan-00-core:183', __e); } return 'leaving the legendary zone…'; }
    if (a.capture && (!a.capture.on || !/new|missing/.test(a.capture.target || ''))) { a.capture.on = true; a.capture.target = 'new'; try { E.call('Game.save'); } catch (__e) { __h('70-plan-00-core:184', __e); } Log.add('turned auto-catch on ("new")'); }
    if (+a.chapter !== +ch && fighting()) return 'waiting for this fight to end before moving…';
    if (+a.chapter !== +ch) { if (E.call('Adventure.setChapter', +ch) === false) return 'waiting: the game would not open that chapter'; return 'moving to the chapter…'; }
    if (!E.read('Adventure.isLooping', false, +ch)) { try { E.call('Adventure.toggleLoop', +ch); g.restore.loopAdded = +ch; Plan.save(); } catch (__e) { __h('70-plan-00-core:187', __e); } }
    passTeam(g, ch);
    return null;
  }
  // rebuild a chapter from stop 0: the game's own Restart (Screens.adventure.restartChapter) when you're in it;
  // otherwise (or if that's missing) step out and back - re-opening the same chapter just continues (Jimmy)
  // Chrome crashed / froze 3 times right after Mega changed or restarted the chapter while a fight was starting
  // (black box 2026-11-21 18:14: setChapter, then a trainer fight at turn 0, then nothing). Until that is
  // understood, chapter moves and restarts wait for the current fight to end.
  const fighting = () => { const b = (S().adv || {}).battle; return !!b && !b.over && !b.done; };
  function rebuild(ch) {
    const a = S().adv || {}, scr = E.get('Screens')?.adventure;
    if (fighting()) return false;
    if (+a.chapter === +ch && typeof scr?.restartChapter === 'function') { try { scr.restartChapter(+ch); return true; } catch (__e) { __h('70-plan-00-core:200', __e); } }
    const unlocked = +(a.unlocked ?? 0), other = +ch > 0 ? +ch - 1 : Math.min(unlocked, +ch + 1);
    if (other === +ch || E.call('Adventure.setChapter', other) === false) return false;
    E.call('Adventure.setChapter', +ch);
    return true;
  }
  const putBack = (g) => GoalTypes.wild.finish(g);


  return { wbZone, E, S, name, pending, holder, setTeam, fullTeam, dexHold, LEVEL_WORTH, autoTeam, levelFirst, safe, sideHas, sideOf, lvl, capOf, setChapterTeam, U, awayNow, here, power, poolAt, RD, bst, ownsShiny, want, hatchMissing, LZ, passTeam, bossBusy, bossTeam, goChapter, rebuild, putBack };
})();
Object.assign(GoalTypes, { dexHold: GoalKit.dexHold, holder: GoalKit.holder, setTeam: GoalKit.setTeam, setChapterTeam: GoalKit.setChapterTeam, here: GoalKit.here, hatchMissing: GoalKit.hatchMissing });

// goal module: legend (takes shared helpers from GoalKit, registers itself in GoalTypes)
(() => {
  const { E, S, name, pending, setTeam, autoTeam, levelFirst, here } = GoalKit;
  const legend = {
    uses: 'screen',
    label: (g) => g.forms ? `Catch every ${name(g.foe)} form` : `Catch ${name(g.foe)}`,
    sprite: (g) => g.formNow || g.foe,
    check(g) {
      const z = Legends.get(g.foe);
      if (z?.roam) { g.type = 'roam'; Plan.save(); return { state: 'wait', why: 'a roamer - chased by following it from chapter to chapter' }; }
      if (!z) {
        // a roamer (Tornadus, Thundurus...) has no zone: it's chased by the 'roam' goal instead
        if ((E.get('CONFIG')?.ROAMING?.GROUPS || []).some((x) => x.ids.includes(+g.foe))) { g.type = 'roam'; Plan.save(); return { state: 'wait', why: 'a roamer - chased by following it from chapter to chapter' }; }
        return { state: 'wait', why: 'not in the game data' };
      }
      if (z.forms) {
        // weekly forms: done when you own every form; otherwise hunt this week's, then wait for the reset
        if (!g.forms) { g.forms = true; Plan.save(); }
        if (z.allForms) return { state: 'done', why: `every form caught (${z.forms.length})` };
        const left = z.forms.filter((f) => !f.owned).map((f) => f.name.replace(/^.*\(|\)$/g, '')).join(', ');
        if (z.form && g.formNow !== z.form) {
          const first = g.formNow == null; g.formNow = z.form; Plan.save();
          Legends.dropSim(g.foe); // last week's team was built for another form
          if (!E.read('Game.owns', false, z.form)) {
            Log.add(`${z.formName} is at ${z.place || 'its zone'} this week - still missing: ${left}`);
            if (!first) try { Notify.send('win', `${z.formName} is here this week`, `New weekly form at ${z.place || 'its zone'}. Mega will hunt it. Still missing: ${left}.`); } catch (__e) { __h('70-plan-01-legend:26', __e); }
          }
        }
        if (!z.form || E.read('Game.owns', false, z.form)) return { state: 'wait', why: `this week's form is caught - a new one comes at the weekly reset (Sunday 4 PM). Still missing: ${left}` };
      } else if (z.state === 'done' || E.read('Game.owns', false, g.foe)) return { state: 'done', why: 'caught' };
      if (z.state === 'closed') return { state: 'wait', why: `zone closed right now (${z.when || 'time window'})` };
      if (z.state !== 'open') {
        // goals that plan themselves: add what this legendary still needs (every 30 min)
        let manual = g.chainManual || [];
        if (Date.now() - (g.chainAt || 0) > 30 * 60_000) { g.chainAt = Date.now(); try { const r = Chains.addFor(g); manual = g.chainManual = r.manual; } catch (__e) { __h('70-plan-01-legend:35', __e); } Plan.save(); }
        return { state: 'wait', why: `locked - ${z.progress?.text || 'requirement missing'}${manual.length ? ` · needs you: ${manual.join(', ')}` : ''}` };
      }
      if (pending.has(g.foe)) return { state: 'wait', why: 'finding the best team…' };
      { const sim = Legends.sims()[g.foe], mons = (sim?.uids || []).map((u) => E.read('Game.getMon', null, u)).filter(Boolean);
        if (sim && !Sim.dupFree(mons)) { Legends.dropSim(g.foe); Log.add(`${name(g.foe)}: the saved team had two forms of the same Pokémon, which the game doesn't allow - finding a new team`); autoTeam(g.foe); return { state: 'wait', why: 'finding the best team…' }; } }
      const low = levelFirst(g);
      if (low) {
        const lg = Plan.goals.find((x) => x.type === 'level' && x.forFoe === g.foe && !x.done);
        if (!lg) Plan.insertBefore(g.id, 'level', { uids: low, target: 100, forFoe: g.foe });
        else if (lg.paused) return { state: 'ready', why: null }; // you paused the leveling: hunt with the team as it is
        return { state: 'wait', why: `waiting for ${low.map((u) => name(E.read('Game.getMon', {}, u)?.id)).join(', ')} to reach Lv 100` };
      }
      return { state: 'ready', why: null };
    },
    async step(g, ctx) {
      const id = g.foe;
      const inZone = +(S().adv?.zone?.id) === id;
      if (!inZone) {
        const sim = Legends.sims()[id], zt = E.read('Game.zoneTeam', [], id) || [];
        if (sim) {
          // the simulated team (yours from "Find best team", or the plan's own) is the one to hunt with
          const same = zt.length === sim.uids.length && sim.uids.every((u, i) => zt[i] === u);
          if (!same) { const r = setTeam(id, sim.uids); if (!r.ok) return 'waiting: ' + r.why; }
        } else if (zt.length < 6) { autoTeam(id); return 'finding the best team…'; }
        { const mt = await MoveTune.ensure(id, E.read('Game.zoneTeam', [], id) || sim?.uids || [], undefined, name(id)); if (mt) return mt; } // which status moves to use (v0.5.12)
        return (await ctx.enter(id)) ? `entered ${name(id)}'s zone` : `entering ${name(id)}'s zone…`;
      }
      const b = S().adv?.battle, form = g.forms ? g.formNow : null;
      const vs = b && (b.enemies || []).some((e) => +e.id === id || (form && +e.id === form));
      // already inside, but with a different team than planned (a new search, or the game dropped
      // someone): switch between fights - set the team, then leave and re-enter (re-entering heals)
      const sim = Legends.sims()[id], zt = E.read('Game.zoneTeam', [], id) || [];
      if (sim && !vs && !(zt.length === sim.uids.length && sim.uids.every((u, i) => zt[i] === u))) {
        const r = setTeam(id, sim.uids);
        if (!r.ok) return 'waiting: ' + r.why;
        try { E.call('Adventure.leaveZone'); } catch (__e) { __h('70-plan-01-legend:71', __e); }
        await new Promise((x) => setTimeout(x, 600));
        await ctx.enter(id, true);
        return `switched to the planned team (${sim.uids.length} Pokémon) and re-entered`;
      }
      const tries = +(S().legTries?.[form || id] ?? 0);
      const berry = Berries.keep('capture', `catching ${name(form || id)}`);
      return `${form ? name(form) + ' · ' : ''}${vs ? 'fighting' : 'in the zone'} · ${tries} capture tr${tries === 1 ? 'y' : 'ies'} so far${berry}`;
    },
  };
  Object.assign(GoalTypes, { legend });
})();

// goal module: story (takes shared helpers from GoalKit, registers itself in GoalTypes)
(() => {
  const { E, S, name, safe, sideHas, sideOf, capOf, setChapterTeam, here, fullTeam } = GoalKit;
  // ---- story: beat a new region's gyms and League (Unova) -------------------------------------
  // A new region is its own side until its League: own money, bag and team, only Pokémon caught there
  // (Game.sideMons). Mega stays in that region's chapters (opening an older chapter would swap sides),
  // plays the frontier chapter with the loop off so it moves on, picks the 6 side Pokémon the simulator
  // rates best against that chapter (its gym leader counts as a whole stop), and when the team keeps
  // wiping there it trains in the best cleared chapter of the region for 30 minutes, then tries again.
  const story = {
    uses: 'screen',
    label: (g) => `Beat the ${g.regionName || 'Unova'} League`,
    // the picture follows what Mega is doing: the team member furthest from the cap while leveling,
    // otherwise the leader's strongest Pokémon (the one you're going for)
    sprite: (g) => g.face || g.lead || 643,
    // real progress (the Now screen used to grab the first "57/63" in the status line - one Pokémon's level):
    // while leveling, how many of the gym team are at the cap; otherwise the region's chapters done
    progress(g) {
      if (g.lvProg) return { have: g.lvProg.have, need: g.lvProg.need, unit: `at the cap (Lv ${g.lvProg.lv})` };
      if (g.chProg) return { have: g.chProg.have, need: g.chProg.need, unit: 'chapters done' };
      return null;
    },
    check(g) {
      const ST = E.get('STORY'), reg = g.region || 'unova';
      if (safe(() => E.read('Game.regionCleared', false, reg))) return { state: 'done', why: 'League beaten - the two sides are linked now' };
      const chs = safe(() => ST.chaptersOf(reg), []) || [];
      if (!chs.length) return { state: 'wait', why: 'region not in the game data' };
      const un = +(S().adv?.unlocked ?? 0);
      if (un < chs[0]) return { state: 'wait', why: 'region not unlocked yet' };
      const pend = S().adv?.pending;
      if (pend) { if (!g.askedPend) { g.askedPend = true; Plan.save(); try { Notify.send('problem', 'Poke\'Catch needs you', 'The game is waiting for a choice in your story run (a gift or a question). Open the game and choose.'); } catch (__e) { __h('70-plan-02-story:31', __e); } } return { state: 'wait', why: 'the game is waiting for you to choose something' }; }
      g.askedPend = false;
      const mons = (E.read('Game.sideMons', []) || []);
      if (!mons.length) return { state: 'wait', why: 'no Pokémon on this side yet - pick your starter' };
      // catch jobs for the gym plan go first - but only ones that can run now: a catch that waits for
      // the weather or the time of day never holds up the gyms (it's dropped at the next step)
      // (jobs made before 2.5.1 have no 'next' flag: they're for now only if this gym's plan wants that Pokémon)
      const curPlan = safe(() => GymPlan.saved?.[un]);
      const forNow = (c) => c.next === false || (c.next == null && !!curPlan?.plan?.team?.some((t) => t.kind === 'catch' && +t.base === +c.foe));
      // catches for a LATER gym never hold this one up, and nothing holds up a button you pressed (Train These / Go Fight)
      const kids = g.levelFirst || g.goFight ? [] : Plan.goals.filter((c) => !c.done && c.parent === g.id && forNow(c) && safe(() => GoalTypes[c.type].check(c).state) !== 'wait');
      if (kids.length) return { state: 'wait', why: `catching for the gym plan first: ${kids.map((c) => name(c.foe)).join(', ')}` };
      return { state: 'ready', why: null };
    },
    async step(g) {
      const ST = E.get('STORY'), a = S().adv || {}, reg = g.region || 'unova';
      if (a.zone) return 'waiting: inside a legendary zone';
      const chs = safe(() => ST.chaptersOf(reg), []) || [];
      const un = +(a.unlocked ?? 0), front = Math.min(un, chs[chs.length - 1]);
      const deaths = +(a.deaths?.[front] ?? 0);
      // where the team wipes: the fight in progress is remembered every tick (after a wipe the game has already
      // sent you back to the chapter's start, so "where am I now" would always say stop 1)
      if (a.battle?.enemies?.length && +a.chapter === front) {
        const b = a.battle, n = +b.slots || 1;
        g.lastFight = { at: Date.now(), node: (+a.node || 0) + 1, of: (a.nodes || []).length, kind: b.kind, who: b.trainer ? Casing.names(String(E.read('STORY.trainerLabel', b.trainer, b.trainer))) : '', foes: b.enemies.map((m) => name(m.id)).slice(0, 4), size: n === 3 ? 'triple battle' : n === 2 ? 'double battle' : '' };
      }
      if (g.seenDeaths == null || g.seenDeathsCh !== front) { g.seenDeaths = deaths; g.seenDeathsCh = front; }
      else if (deaths > g.seenDeaths) {
        const f = g.lastFight && Date.now() - g.lastFight.at < 3 * 60_000 ? g.lastFight : null;
        const where = !f ? 'somewhere in the chapter' : f.kind === 'gym' ? `at ${f.who || 'the leader'} (stop ${f.node} of ${f.of})`
          : `on the way, stop ${f.node} of ${f.of}: ${[f.size, f.kind === 'trainer' ? `vs ${f.who || 'a trainer'}` : f.kind].filter(Boolean).join(' ')} (${f.foes.join(', ')})`;
        Log.add(`story: lost at ${ST.CHAPTERS[front]?.name} - ${where}`);
        g.lossWhere = f ? (f.kind === 'gym' ? 'leader' : 'way') : null; g.seenDeaths = deaths; g.lossTeam = (S().team || []).slice(0, 6); Plan.save();
      }
      // learn from real gym fights: note the estimate when one starts, then whether it ended in a badge or a loss
      try {
        const b = a.battle, inGym = b && b.kind === 'gym';
        if (inGym && !g.gymFight) { const e = GymPlan.estimate(+a.chapter, S().team || []); if (e) { g.gymFight = { ch: +a.chapter, gym: e.gym, p: e.p, at: Date.now(), badges: (a.badges || []).length, deaths: +(a.deaths?.[a.chapter] ?? 0) }; Plan.save(); Log.add(`gym fight started: ${e.gym} - estimate ${Math.round(e.p * 100)}% for this team`); } }
        else if (!inGym && g.gymFight) {
          const f = g.gymFight, won = (a.badges || []).length > f.badges || +(a.unlocked ?? 0) > f.ch, lost = +(a.deaths?.[f.ch] ?? 0) > f.deaths;
          if (won || lost) GymPlan.learn(f, won);
          if (won || lost || Date.now() - f.at > 15 * 60_000) { g.gymFight = null; Plan.save(); }
        }
      } catch (__e) { __h('70-plan-02-story:74', __e); }
      if (g.front !== front) { if (g.front != null && g.front < front) safe(() => GymPlan.clearBans(g.front)); g.swaps = 0; g.runNote = null; g.front = front; g.deaths0 = deaths; g.lossBase = deaths; g.trainUntil = 0; g.teamAt = 0; g.goFight = null; g.levelFirst = false; g.trainTap = false; Plan.save(); Log.add(`story: next up ${ST.CHAPTERS[front]?.name || 'chapter ' + front}`); }
      const mons = (E.read('Game.sideMons', []) || []);
      const sp = (m) => Sim.species(m);
      // stuck: 2 losses in the frontier chapter since the last try -> level the planned team to the level cap,
      // then try again (Jimmy: train to the cap, not for a fixed time). Already all at the cap: re-plan and retry now.
      const now = Date.now();
      if (g.trainUntil) { g.trainUntil = 0; g.levelFirst = true; Plan.save(); } // (older versions trained for 30 min)
      // levels aren't the problem (stdAri's rule): the team that lost twice was already all at the level cap - so
      // training it again can't help. That exact team is set aside for this gym and the plan picks the next best.
      const capOk = (u) => { const m = E.read('Game.getMon', null, u); return !!m && m.level >= (safe(() => +E.read('Game.capFor', 0, m), 0) || 100); };
      if (deaths - (g.deaths0 || 0) >= 2 && g.lossTeam?.length && g.lossTeam.every(capOk) && safe(() => GymPlan.ban(front, g.lossTeam), false)) {
        const who = g.lossTeam.map((u) => name(E.read('Game.getMon', null, u)?.id)).join(', ');
        g.deaths0 = deaths; g.levelFirst = false; g.goFight = null; g.trainTap = false; g.teamAt = 0; g.swaps = (g.swaps || 0) + 1; g.lossTeam = null; g.banAt = Date.now(); Plan.save();
        Log.add(`story: lost twice at ${ST.CHAPTERS[front]?.name} with everyone at the level cap (${who}) - levels aren't the problem, so that team is set aside and the plan picks the next best`);
        try { GymPlan.get(front, { force: true }); } catch (__e) { __h('70-plan-02-story:89', __e); }
      }
      if (deaths - (g.deaths0 || 0) >= 2) {
        g.deaths0 = deaths; g.levelFirst = true; g.goFight = null; g.trainTap = false; g.trainWhy = g.lossWhere === 'way' ? 'on the way, before the leader' : g.lossWhere === 'leader' ? 'against the leader' : '';
        Plan.save(); Log.add(`story: lost twice at ${ST.CHAPTERS[front]?.name}${g.trainWhy ? ' (' + g.trainWhy + ')' : ''} - leveling the planned team to the cap, then trying again`);
        try { GymPlan.get(front, { force: true }); } catch (__e) { __h('70-plan-02-story:94', __e); }
      }
      const training = false; // (training is now "level the plan to the cap", done in the gym plan below)
      // where: the frontier chapter (loop off so a win moves on), or the best cleared chapter of the region to train
      let ch = front;
      if (training) {
        const done = chs.filter((c) => c < front);
        const r = safe(() => XpChap.rank().filter((x) => done.includes(x.ch)), []) || [];
        ch = r[0]?.ch ?? done[done.length - 1] ?? front;
      }
      // ---- gym plan: the team that beats this gym (game's own estimate), and how to get it ----
      try { GymPlan.evolveStuck(); } catch (__e) { __h('70-plan-02-story:105', __e); }
      const G = safe(() => GymPlan.gymOf(front));
      const plan = G && G.foes.length ? safe(() => GymPlan.get(front)) : null;
      // a plan made before a team was set aside (or for different Pokémon) is being redone: don't act on it
      // (only the set-aside case: a plan that's merely older keeps being used while the new one is worked out, as before)
      if (plan && safe(() => GymPlan.banned(front, plan.now.uids) || (plan.plan.team.every((t) => t.uid) && GymPlan.banned(front, plan.plan.team.map((t) => t.uid))), false)) {
        if (plan.at > (g.banAt || 0)) { // re-planned after the ban and still nothing else: there's no other team, so fight with it
          safe(() => GymPlan.clearBans(front)); Log.add(`story: no other team for ${plan.gym} - trying it again`);
        } else {
          try { GymPlan.get(front); } catch (__e) { __h('70-plan-02-story:114', __e); }
          return `re-planning ${plan.gym} without the team that lost twice at the level cap…`;
        }
      }
      g.planWin = plan ? plan.plan.win : null; g.nowWin = plan ? plan.now.win : null;
      if (plan && !training) {
        // fight the gym once your team wins 60% (Jimmy) - or when the best possible team
        // wouldn't do meaningfully better (then preparing longer can't help)
        const capOfM0 = (m) => safe(() => +E.read('Game.capFor', 0, m), 0) || G.cap || 100;
        const lowPlan = plan.plan.team.map((t) => t.kind === 'own' ? E.read('Game.getMon', null, t.uid) : sideOf(t.base)).filter(Boolean).filter((m) => m.level < capOfM0(m));
        if (g.levelFirst && !lowPlan.length) { g.levelFirst = false; g.trainTap = false; Plan.save(); Log.add(`story: the planned team is at the level cap (${G.cap}) - trying ${plan.gym} again`); }
        const ace = [...G.foes].sort((x, y) => y.level - x.level)[0]; if (ace) g.face = ace.id;
        // the whole chapter has to work too (stdAri's check): the team Mega would send must get through the trainers
        // and wild Pokémon since the last Pokémon Center at least half the time in the simulation (HP carrying over),
        // or Mega levels the planned team first. At the level cap it fights anyway - and if that team then loses
        // twice, it's set aside for the next best (above)
        const runOk = !plan.now.run || plan.now.run.survive >= 0.5;
        const good = !!g.goFight || !g.levelFirst && runOk && (plan.now.win >= 0.6 || (plan.plan.win - plan.now.win < 0.05 && (plan.plan.soft ?? 0) - (plan.now.soft ?? 0) < 0.05));
        g.runNote = plan.now.run && !runOk ? `your team reaches the leader only ${Math.round(plan.now.run.survive * 100)}% of the time in the simulation` : null;
        if (good) g.lvProg = null;
        if (!good) {
          // 1) catch the members you don't have (a catch job each, done when it's on this side) - and,
          //    while you're at it, the ones the NEXT gym's plan wants from chapters you've unlocked
          const nx = safe(() => GymPlan.nextGym(front)), nplan = nx != null && !GymPlan.busy ? safe(() => GymPlan.get(nx)) : (nx != null ? GymPlan.saved?.[nx] : null);
          const wantNow = plan.plan.team.filter((x) => x.kind === 'catch' && !sideHas(x.base));
          const wantNext = !wantNow.length && nplan ? nplan.plan.team.filter((x) => x.kind === 'catch' && !sideHas(x.base) && x.ch <= front) : [];
          // drop catch jobs that aren't in the plan any more, or that are waiting (weather, time of day)
          const wantIds = new Set([...wantNow, ...wantNext].map((t) => +t.base));
          for (const c of Plan.goals.filter((c) => !c.done && c.type === 'wild' && c.parent === g.id)) {
            const waiting = safe(() => GoalTypes.wild.check(c).state) === 'wait';
            if (!wantIds.has(+c.foe) || waiting) { if (waiting) (g.noCatch ||= {})[c.foe] = Date.now(); Plan.remove(c.id); Log.add(`gym plan: dropped catching ${name(c.foe)} (${waiting ? 'not catchable right now - skipped for an hour' : 'not needed any more'})`); }
          }
          for (const t of [...wantNow, ...wantNext]) {
            if (Date.now() - (g.noCatch?.[t.base] || 0) < 60 * 60_000) continue; // just found not catchable: don't re-add it for an hour
            if (!Plan.goals.some((c) => !c.done && c.type === 'wild' && c.parent === g.id && +c.foe === +t.base)) { Plan.insertAfter(g.id, 'wild', { foe: t.base, ch: t.ch, parent: g.id, side: true, next: !wantNow.includes(t) }); Log.add(`gym plan: catching ${name(t.base)} (${t.where}) for ${wantNow.includes(t) ? plan.gym : 'the gym after (' + (nplan?.gym || 'next') + ')'}`); }
          }
          // 2) level the members below the cap: they train together, the 2 strongest capped ones carry
          const members = plan.plan.team.map((t) => t.kind === 'own' ? E.read('Game.getMon', null, t.uid) : sideOf(t.base)).filter(Boolean);
          const capOfM = (m) => safe(() => +E.read('Game.capFor', 0, m), 0) || G.cap || 100;
          const low = members.filter((m) => m.level < capOfM(m)).sort((x, y) => x.level - y.level); // the furthest behind train first
          g.lvProg = { have: members.length - low.length, need: members.length, lv: G.cap };
          if (low.length) {
            g.face = [...low].sort((x, y) => x.level - y.level)[0]?.id || g.face;
            // the plan's own members first: everyone still below the cap (furthest behind first), then plan members
            // already there, then the strongest Pokémon at the cap - never two random high-level fillers (Jimmy:
            // "why is it leveling Herdier and Stoutland" - 4 + 2 carriers left the slots to the 6-team top-up)
            const capped = members.filter((m) => !low.includes(m));
            const carriers = (E.read('Game.sideMons', []) || []).filter((m) => !members.includes(m) && m.level >= capOfM(m)).sort((a, b) => b.level - a.level);
            const uids = [...low, ...capped, ...carriers].map((m) => m.uid).filter((u, i, a) => a.indexOf(u) === i).slice(0, 6);
            const done = chs.filter((c) => c < front);
            const r = safe(() => XpChap.rank().filter((x) => done.includes(x.ch)), []) || [];
            const tch = r[0]?.ch ?? done[done.length - 1] ?? front;
            if (fullTeam(uids).slice().sort().join() !== (S().team || []).slice(0, 6).slice().sort().join()) { setChapterTeam(uids); Log.add(`gym plan: leveling ${low.map((m) => `${name(m.id)} Lv ${m.level}`).join(', ')} to the cap (${G.cap})`); }
            if (+a.chapter !== tch) { if (E.call('Adventure.setChapter', tch) === false) return `waiting: the game would not open ${ST.CHAPTERS[tch]?.name}`; return `moving to ${ST.CHAPTERS[tch]?.name} to level the gym team…`; }
            if (!E.read('Adventure.isLooping', false, tch)) { try { E.call('Adventure.toggleLoop', tch); g.loopOn = tch; Plan.save(); } catch (__e) { __h('70-plan-02-story:168', __e); } }
            return `${g.trainTap ? 'you pressed Train These - ' : g.levelFirst ? `lost twice${g.trainWhy ? ' ' + g.trainWhy : ''} - ` : g.runNote ? `${g.runNote} - ` : ''}leveling the gym team in ${ST.CHAPTERS[tch]?.name} (${low.map((m) => `${name(m.id)} ${m.level}/${capOfM(m)}`).join(', ')}), then ${plan.gym}: your team wins ${Math.round(plan.now.win * 100)}% now, ${Math.round(plan.plan.win * 100)}% once they reach Lv ${G.cap} (it fights at 60%)${plan.plan.win < 0.05 && plan.plan.soft != null ? ` · a hard gym: on type matchups alone, ${Math.round((plan.now.soft || 0) * 100)}% now, ${Math.round(plan.plan.soft * 100)}% with the best team` : ''}`;
          }
          // 3) everyone's here and at the cap: fight with the planned team, in the planned order
          const uids = plan.plan.team.map((t) => (t.kind === 'own' ? t.uid : sideOf(t.base)?.uid)).filter(Boolean);
          if (uids.length && fullTeam(uids).join() !== (S().team || []).slice(0, 6).join()) { setChapterTeam(uids); Log.add(`gym plan team for ${plan.gym}: ${uids.map((u) => name(E.read('Game.getMon', null, u)?.id)).join(', ')} (~${Math.round(plan.plan.win * 100)}%)`); }
          g.teamAt = now; g.teamFor = ch;
        } else if (plan.now.uids.length && (!g.teamAt || g.teamFor !== ch || now - g.teamAt > 10 * 60_000)) {
          // the team you have is good enough: catch jobs for this gym aren't needed
          for (const c of Plan.goals.filter((c) => !c.done && c.type === 'wild' && c.parent === g.id)) { Plan.remove(c.id); Log.add(`gym plan: dropped catching ${name(c.foe)} (your team is ready)`); }
          if (fullTeam(plan.now.uids).join() !== (S().team || []).slice(0, 6).join()) { setChapterTeam(plan.now.uids); Log.add(`story team for ${plan.gym} (~${Math.round(plan.now.win * 100)}%): ${plan.now.uids.map((u) => name(E.read('Game.getMon', null, u)?.id)).join(', ')}`); }
          g.teamAt = now; g.teamFor = ch;
        }
      }
      // team: the 6 side Pokémon the simulator rates best against where we're going (re-picked every 10 min)
      if (!plan && (!g.teamAt || now - g.teamAt > 10 * 60_000 || g.teamFor !== ch)) {
        const foes = safe(() => Sim.chapterFoes(front), []) || [];
        const rated = mons.map((m) => ({ m, s: foes.length ? (Sim.clearScore(m, foes).score || 0) : m.level })).sort((x, y) => y.s - x.s);
        const pick = []; for (const r of rated) { if (pick.length >= 6) break; if (!pick.some((p) => sp(p) === sp(r.m))) pick.push(r.m); }
        // training: the lowest-level of the picks get the XP anyway (everyone on the team does) - keep the best team
        const uids = pick.map((m) => m.uid), cur = (S().team || []).slice(0, 6);
        if (uids.length && uids.join() !== cur.join()) { setChapterTeam(uids); Log.add(`story team: ${pick.map((m) => `${name(m.id)} Lv ${m.level}`).join(', ')}`); }
        g.teamAt = now; g.teamFor = ch; g.lead = pick[0]?.id || g.lead; Plan.save();
      }
      // (the buddy is handled for every activity by Buddy: lowest on the team that can still level)
      if (+a.chapter !== ch) { if (E.call('Adventure.setChapter', ch) === false) return `waiting: the game would not open ${ST.CHAPTERS[ch]?.name}`; return `moving to ${ST.CHAPTERS[ch]?.name}…`; }
      const looping = !!E.read('Adventure.isLooping', false, ch);
      if (training && !looping) { try { E.call('Adventure.toggleLoop', ch); g.loopOn = ch; Plan.save(); } catch (__e) { __h('70-plan-02-story:195', __e); } }
      if (!training && looping) { try { E.call('Adventure.toggleLoop', ch); } catch (__e) { __h('70-plan-02-story:196', __e); } } // the frontier must not loop, or a win wouldn't move on
      if (!training && g.loopOn != null && g.loopOn !== ch && E.read('Adventure.isLooping', false, g.loopOn)) { try { E.call('Adventure.toggleLoop', g.loopOn); } catch (__e) { __h('70-plan-02-story:197', __e); } g.loopOn = null; Plan.save(); }
      const badges = chs.filter((c) => c < front).length; g.chProg = { have: badges, need: chs.length };
      return `${g.goFight ? 'Go Fight: ' : ''}${g.swaps ? `trying team #${g.swaps + 1} (the last lost twice at the cap) · ` : ''}playing ${ST.CHAPTERS[ch]?.name} · stop ${(+a.node || 0) + 1} of ${a.nodes?.length || '?'} · ${badges}/${chs.length} chapters done · ${deaths - (g.lossBase ?? g.deaths0 ?? 0)} loss${deaths - (g.lossBase ?? g.deaths0 ?? 0) === 1 ? '' : 'es'} here`;
    },
    // the Gyms & League buttons (Jimmy's taps, like the old helper's Next boss box)
    goFight(g) {
      const a = S().adv || {}, front = +(g.front ?? a.unlocked ?? 0), deaths = +(a.deaths?.[front] ?? 0);
      g.goFight = { at: Date.now(), deaths }; g.deaths0 = deaths; g.levelFirst = false; g.trainTap = false; g.teamAt = 0; Plan.save();
      Log.add(`story: you pressed Go Fight - trying ${E.get('STORY')?.CHAPTERS?.[front]?.name || 'the chapter'} and its leader now with the best team at today's levels (after 2 losses Mega goes back to leveling)`);
    },
    trainThese(g) {
      const a = S().adv || {}, front = +(g.front ?? a.unlocked ?? 0);
      g.goFight = null; g.levelFirst = true; g.trainTap = true; g.deaths0 = +(a.deaths?.[front] ?? 0); g.teamAt = 0; Plan.save();
      try { GymPlan.get(front, { force: true }); } catch (__e) { __h('70-plan-02-story:210', __e); } // the newest plan: training follows it from the next step
      Log.add('story: you pressed Train These - leveling the planned team to the level cap, then trying again');
    },
    finish(g) { try { if (g.loopOn != null && E.read('Adventure.isLooping', false, g.loopOn)) E.call('Adventure.toggleLoop', g.loopOn); } catch (__e) { __h('70-plan-02-story:213', __e); } },
  };
  Object.assign(GoalTypes, { story });
})();

// goal module: level, bestChapter (takes shared helpers from GoalKit, registers itself in GoalTypes)
(() => {
  const { E, S, name, pending, safe, lvl, capOf, setChapterTeam, awayNow, here, want } = GoalKit;
  // ---- leveling -------------------------------------------------------------------------
  // XP per win = levelXp(enemy level) / XP_WINS_PER_LEVEL x region bonus, and every team member
  // gets it (fighting or not). So: strongest chapter you have unlocked, best region bonus.
  // the leveling chapter: XP per hour (XpChap - game XP formula x measured wins per hour, scouting
  // close calls). The old foe-level-only pick stays as a fallback.
  function bestChapter(g) {
    // a fixed spot (the Discord Recommended goals): that chapter - or that League, run as one loop - and nothing else
    if (g?.force) return { ch: g.force.ch, top: 100, name: g.force.name, forced: true };
    try { const p = XpChap.pick(g); if (p) return p; } catch (e) { Log.add('XP/hour chapter pick failed: ' + (e?.message || e)); }
    const ST = E.get('STORY'), C = E.get('CONFIG') || {}, unlocked = +(S().adv?.unlocked ?? 0);
    let best = null;
    for (let ch = 0; ch <= unlocked && ch < (ST?.CHAPTERS?.length || 0); ch++) {
      const band = (() => { try { return ST.bandOf(ch); } catch { return null; } })();
      const top = band && Math.max(...band.filter((x) => x != null));
      if (!top || !isFinite(top)) continue;
      const reg = (() => { try { return ST.regionOf(ch)?.key; } catch { return null; } })();
      const score = (E.read('Game.levelXp', 0, top) || 0); // REGION_XP is a cost on every level, not a chapter bonus
      if (!best || score > best.score || (score === best.score && ch > best.ch)) best = { ch, top, reg, score, name: ST.CHAPTERS[ch]?.name || 'chapter ' + ch };
    }
    return best;
  }
  // who lifts a Pokémon's level cap: its region's next gym leader / Elite Four member / Champion
  function capBoss(m) {
    const ST = E.get('STORY'), adv = S().adv || {};
    const reg = m?.reg || safe(() => ST.regionOf(adv.chapter)?.key);
    const ch = safe(() => ST.nextGymOf(reg, adv));
    const gym = ch != null ? (ST.CHAPTERS[ch]?.steps || []).find((x) => x.kind === 'gym') : null;
    return gym ? `beat ${gym.leader || ST.CHAPTERS[ch]?.name} to raise it, then training picks back up` : 'it goes up as you beat the next boss';
  }
  // the evolution this goal is after (forDex): the game's own entry, so a party partner / time of day is known
  const evoRule = (g) => { if (!g.forDex || !g.fromId) return null; return ((E.get('EVOLUTIONS') || {})[g.fromId] || []).find((e) => +e.to === +g.forDex) || null; };
  const timeOk = (t) => { if (!t) return true; try { return !!E.get('DAYTIME').matches(t); } catch { return true; } };
  // a partner the game counts: one you own, here (not away), not a Pokémon this goal is leveling
  const partnerOf = (g, id) => (E.read('Game.ownedMons', []) || []).filter((m) => +m.id === +id && !g.uids.includes(m.uid) && E.read('Game.getMon', null, m.uid) && !awayNow().has(m.uid)).sort((a, b) => b.level - a.level)[0] || null;
  // g.candyAt (the Discord Battle XP goal): a Pokémon whose next level needs that much XP or more is done here - it
  // goes on the "Ready for Candy" list instead (the Discord's way: battle to ~5-6 M XP per level, then Exp. Candies)
  const slowNow = (g, u) => { if (!g.candyAt) return false; const m = E.read('Game.getMon', null, u); try { return !!m && +E.get('Game').xpForNext(m.level, m) >= g.candyAt; } catch { return false; } };
  const needs = (g) => g.uids.filter((u) => lvl(u) != null && lvl(u) < Math.min(g.target || 100, capOf(u)) && !slowNow(g, u));

  // Rule: while leveling, keep a Pinap Berry (XP x1.25, 60 min) going. One at a time, never
  // stacked ahead, and only from a leveling goal you put in the plan.
  let pinapOut = false;
  function keepPinap() {
    const buff = (E.read('Game.activeBuffs', []) || []).find((b) => b.family === 'xp');
    if (buff && buff.left > 120_000) { pinapOut = false; return ` · Pinap ${Math.ceil(buff.left / 60_000)} min`; }
    const have = +E.read('Game.itemCount', 0, 'pinap-berry') || 0;
    if (!have) { if (!pinapOut) Log.add('out of Pinap Berries - training continues without the XP boost'); pinapOut = true; return ' · no Pinap Berries left'; }
    let ok = null;
    try { ok = E.call('Game.useBuffBerry', 'pinap-berry'); } catch (__e) { __h('70-plan-03-level:52', __e); }
    const now = (E.read('Game.activeBuffs', []) || []).find((b) => b.family === 'xp');
    if (now && now.left > 120_000) { Log.add(`used a Pinap Berry (XP x1.25 for 60 min) - ${have - 1} left`); return ` · Pinap ${Math.ceil(now.left / 60_000)} min`; }
    return ok == null ? ' · could not use a Pinap Berry' : '';
  }

  const level = {
    uses: 'screen',
    progress: (g) => { // levels gained across the Pokémon, from where they started
      const t = g.target || 100, lv = g.uids.map((u) => Math.min(t, lvl(u) || 0));
      if (!g.startLv) { g.startLv = Object.fromEntries(g.uids.map((u, i) => [u, lv[i]])); }
      const need = g.uids.reduce((n, u) => n + t - (g.startLv[u] ?? 0), 0), have = g.uids.reduce((n, u, i) => n + lv[i] - (g.startLv[u] ?? 0), 0);
      return need > 0 ? { have: Math.max(0, have), need, unit: 'levels' } : null;
    },
    label: (g) => `Level ${g.forDex && g.fromId ? name(g.fromId) : g.uids.map((u) => name(E.read('Game.getMon', {}, u)?.id)).join(', ')} to ${g.target || 100}${g.forFoe ? ` (for ${name(g.forFoe)})` : g.forDex ? ` (evolves into ${name(g.forDex)})` : ''}`,
    sprite: (g) => E.read('Game.getMon', {}, g.uids[0])?.id,
    check(g) {
      if (g.forDex && E.read('Game.inDex', false, g.forDex)) return { state: 'done', why: `${name(g.forDex)} registered` };
      if (g.forDex) {
        // the species it has to evolve FROM (Deino for Zweilous) - names the goal, even after the Pokémon changed
        if (!g.fromId) { for (const [f, l] of Object.entries(E.get('EVOLUTIONS') || {})) if ((l || []).some((e) => +e.to === +g.forDex)) { g.fromId = +f; Plan.save(); break; } }
        const m = E.read('Game.getMon', null, g.uids[0]);
        if (m && +m.id === +g.forDex) return { state: 'done', why: `evolved into ${name(g.forDex)}` };
        if (m && g.fromId && +m.id !== +g.fromId) return { state: 'done', why: `it evolved past ${name(g.forDex)} (now ${name(m.id)}) - the Pokédex goal finds another way` };
        // evolving happens when it GAINS a level: one caught at (or above) the evolution level needs one more
        if (m && +m.id === +g.fromId && m.level >= (g.target || 100) && !g.bumped) { g.target = m.level + 1; g.bumped = true; Plan.save(); }
        const rule = evoRule(g), when = rule ? (DexInfo.timeOf(g.forDex) || null) : null;
        if (rule?.party && !partnerOf(g, rule.party)) return { state: 'wait', why: `evolves only with ${name(rule.party)} in the team - you have no ${name(rule.party)} free to bring (catch or hatch one)` };
        // it gained a level but the condition wasn't met (wrong time of day): the next level-up can still do it
        if (m && +m.id === +g.fromId && m.level >= (g.target || 100) && (rule?.party || when)) { g.target = m.level + 1; Plan.save(); }
        if (when && !timeOk(when)) return { state: 'wait', why: `evolves into ${name(g.forDex)} only ${when === 'night' ? 'at night' : 'during the day'} - training waits for ${when === 'night' ? 'night' : 'daytime'}` };
        if (g.uids.every((u) => (lvl(u) || 0) > (g.target || 100))) return { state: 'wait', why: `passed Lv ${g.target} but did not evolve - evolve it from its Pokémon screen` };
      }
      const gone = g.uids.filter((u) => !E.read('Game.getMon', null, u));
      if (gone.length === g.uids.length) return { state: 'done', why: 'those Pokémon are gone' };
      if (!needs(g).length) {
        // at the level cap, short of the target: wait - beating the next gym / Elite Four member lifts the cap
        // (each League member raises it a step: 83, 88, 93, 95, 100) and training picks back up by itself
        const capped = g.uids.filter((u) => lvl(u) != null && lvl(u) < (g.target || 100) && lvl(u) >= capOf(u));
        if (!capped.length) return { state: 'done', why: 'all at their level' };
        return { state: 'wait', why: `at the level cap (Lv ${capOf(capped[0])}) - ${capBoss(E.read('Game.getMon', null, capped[0]))}` };
      }
      const away = needs(g).filter((u) => (E.read('Game.underMons', []) || []).some((m) => m.uid === u));
      if (away.length) return { state: 'wait', why: `${away.map((u) => name(E.read('Game.getMon', {}, u)?.id)).join(', ')} in the Underground` };
      if (!bestChapter()) return { state: 'wait', why: 'no chapter to train in' };
      return { state: 'ready', why: null };
    },
    async step(g) {
      const s = S(), a = s.adv || {};
      const best = bestChapter(g);
      if (!best) return 'waiting: no chapter to train in';
      const inSpot = (c) => (g.force ? g.force.chs.includes(+c) : +c === best.ch);
      if (!a.zone && inSpot(a.chapter)) { try { XpChap.tick(+a.chapter); } catch (__e) { __h('70-plan-03-level:104', __e); } }
      if (!g.restore) {
        g.restore = { team: [...(s.team || [])], chapter: a.chapter, loopAdded: null, buddy: s.buddy?.uid ?? null, loops: g.force ? [...(a.loops || [])] : undefined };
        Plan.save();
        Log.add(`${level.label(g)}: training in ${best.name} (wild Lv ${best.top}). Your team, buddy and chapter come back when it's done.`);
      }
      // leave a legendary zone first (the game's own way back)
      if (a.zone) { try { E.call('Adventure.leaveZone'); } catch (__e) { __h('70-plan-03-level:111', __e); } return 'leaving the legendary zone…'; }
      // team: 4 trainees + 2 carriers (Jimmy's rule - every team member gets the full XP of each win).
      // A 3rd carrier only when the simulator says it raises total XP per hour: 3 trainees earn 25% less
      // per win, so the 3rd carrier has to make wins come more than a third faster (hard chapters).
      // Fewer than 4 left in this goal: the free trainee slots go to the idle order (prestiged, then
      // shinies, then closest to Lv 100) - they level along for free, the goal still ends with its own.
      const pending = needs(g), list = [...pending];
      const room = g.force?.carry1 ? 5 : 4; // a fixed spot can run 1 carrier: then 5 level (trimmed below if it ends up 2)
      if (list.length < room) {
        const sp = (u) => Sim.species(E.read('Game.getMon', {}, u));
        for (const u of GoalTypes.idlePick(40)) { if (list.length >= room) break; if (!list.includes(u) && !g.uids.includes(u) && !(g.refused || []).includes(u) && !slowNow(g, u) && !list.some((x) => sp(x) === sp(u))) list.push(u); }
      }
      // carriers: the fully-leveled Pokémon that clear this chapter fastest (simulated against its wild
      // Pokémon and boss); re-picked when the chapter changes or the picker itself improved (CARRIER_V)
      if (g.carriersFor !== best.ch || g.carriersV !== Sim.CARRIER_V || (g.force?.carrier || null) !== (g.carrierWas || null)) {
        g.carrierWas = g.force?.carrier || null;
        let picks = [];
        try { picks = Sim.carriers(best.ch, { exclude: [...g.uids, ...list, ...(g.refused || [])], n: 10 }).picks.filter((p) => p.m.level >= capOf(p.m.uid)); } catch (e) { Log.add('could not rate carriers: ' + (e?.message || e)); }
        // your chosen carrier (a Discord spot's "Carrier" setting): always first, when it's here and fully leveled
        const mine = g.force?.carrier ? E.read('Game.getMon', null, g.force.carrier) : null;
        if (mine && mine.level >= capOf(mine.uid) && !awayNow().has(mine.uid)) picks = [{ m: mine }, ...picks.filter((p) => p.m.uid !== mine.uid)];
        g.carriers = picks.map((p) => p.m.uid); g.carriersFor = best.ch; g.carriersV = Sim.CARRIER_V;
        // 2 or 3 carriers: whichever gives more total XP per hour
        g.nCarry = 2; let why = '';
        try {
          const foes = g.force ? g.force.chs.flatMap((c) => { try { return Sim.chapterFoes(c); } catch { return []; } }) : Sim.chapterFoes(best.ch), mons = picks.slice(0, 3).map((p) => p.m);
          // time per win ~ the best carrier's hits to KO each foe (the game sends the best matchup), + 1 for
          // the fight itself, + 2 per KO it risks taking (a fainted carrier means a trainee fights)
          const cost = (ms) => foes.reduce((t, f) => t + f.w * (1 + Math.min(...ms.map((m) => { const c = Sim.clearScore(m, [{ ...f, w: 1 }]); return 1 / Math.max(c.kill, 0.02) + 2 * c.hurt; }))), 0);
          if (mons.length >= 3) {
            const c2 = cost(mons.slice(0, 2)), c3 = cost(mons), x2 = 4 / c2, x3 = 3 / c3;
            if (x3 > x2 * 1.02) g.nCarry = 3;
            why = ` - 2 carriers ${Math.round(x2 / Math.max(x2, x3) * 100)}% vs 3 carriers ${Math.round(x3 / Math.max(x2, x3) * 100)}% of the best XP/h`;
          }
          // a fixed spot (the Discord's way): ONE carrier that sweeps it and 5 leveling, when the simulator says one
          // alone still gives more XP per hour (every team member gets the full XP of each win)
          if (g.force?.carrier && picks[0]?.m.uid === g.force.carrier) { g.nCarry = 1; why = ' - your chosen carrier, alone'; }
          else if (g.force?.carry1 && mons.length >= 2) {
            const c1 = cost(mons.slice(0, 1)), c2 = cost(mons.slice(0, 2)), x1 = 5 / c1, x2 = 4 / c2;
            if (x1 > x2 * 1.02) { g.nCarry = 1; why = ` - 1 carrier ${Math.round(x1 / x2 * 100)}% of 2 carriers' XP/h (it sweeps alone)`; }
            else why = ` - 2 carriers (1 alone would be ${Math.round(x1 / x2 * 100)}% as fast)`;
          }
        } catch (__e) { __h('70-plan-03-level:153', __e); }
        Plan.save();
        if (picks.length) Log.add(`carriers for ${best.name}: ${picks.slice(0, g.nCarry).map((p) => name(p.m.id)).join(', ')}${why}`);
      }
      const trainees = list.slice(0, 6 - (g.nCarry || 2));
      const extra = trainees.filter((u) => !g.uids.includes(u));
      if (extra.join() !== (g.extra || []).join()) { g.extra = extra; Plan.save(); if (extra.length) Log.add(`free trainee slots: also leveling ${extra.map((u) => `${name(E.read('Game.getMon', {}, u)?.id)} Lv ${lvl(u)}`).join(', ')}`); }
      const want = [...trainees];
      // a party evolution (Shelmet needs Karrablast in the team): the partner rides along in a carrier slot
      { const rule = evoRule(g); const p = rule?.party ? partnerOf(g, rule.party) : null;
        if (p && !want.includes(p.uid)) { want.push(p.uid); if (g.partnerLog !== p.uid) { g.partnerLog = p.uid; Plan.save(); Log.add(`${level.label(g)}: ${name(p.id)} (Lv ${p.level}) joins the team - ${name(g.fromId)} evolves only with it there${p.level < capOf(p.uid) ? `; note ${name(p.id)} may evolve too if it gains a level` : ''}`); } } }
      const byLevel = [...(g.carriers || []), ...(g.restore.team || []), ...here().sort((x, y) => y.level - x.level).map((m) => m.uid)].filter(((aw) => (u) => !aw.has(u))(awayNow()));
      for (const u of byLevel) { if (want.length >= 6) break; if (!want.includes(u) && (lvl(u) || 0) >= 90 && (lvl(u) || 0) >= capOf(u) && !g.uids.includes(u) && !(g.refused || []).includes(u) && E.read('Game.getMon', null, u) && !want.some((w) => Sim.species(E.read('Game.getMon', {}, w)) === Sim.species(E.read('Game.getMon', {}, u)))) want.push(u); }
      // the one carrier of a fixed spot leads every fight (Jimmy 2026-11-23: "the carry always fights"). The game's
      // auto-switch orders the team by TYPE matchup only - not level - so a Lv 30 trainee with a type edge went out
      // before a Lv 100 carrier and fainted. While a 1-carrier spot runs: auto-switch off (your team order decides)
      // and the carrier first. Your setting comes back when the goal stops.
      const lead = g.force && g.nCarry === 1 ? (g.carriers || []).find((u) => want.includes(u)) : null;
      if (lead) {
        want.splice(want.indexOf(lead), 1); want.unshift(lead);
        const S0 = S();
        if (S0.autoSwitch !== false) { if (g.restore.autoSwitch === undefined) g.restore.autoSwitch = S0.autoSwitch ?? true; S0.autoSwitch = false; try { E.call('Game.save'); } catch (__e) { __h('70-plan-03-level:174', __e); } Plan.save(); Log.add(`${name(E.read('Game.getMon', {}, lead)?.id)} leads every fight: the game's auto-switch is off while this runs (it picks by type matchup, not strength) - it comes back on after`); }
      } else if (g.restore.autoSwitch !== undefined && S().autoSwitch === false) { S().autoSwitch = g.restore.autoSwitch; delete g.restore.autoSwitch; try { E.call('Game.save'); } catch (__e) { __h('70-plan-03-level:175', __e); } Plan.save(); }
      const cur = (E.read('Game.teamMons', []) || []).map((m) => m.uid);
      if (!want.every((u) => cur.includes(u)) || (lead && cur[0] !== lead)) {
        if (!setChapterTeam(want)) {
          // the game left someone out (not allowed in this chapter): skip them next time
          const took = (E.read('Game.teamMons', []) || []).map((m) => m.uid);
          const refused = want.filter((u) => !took.includes(u) && !g.uids.includes(u));
          if (refused.length) {
            g.carriers = (g.carriers || []).filter((u) => !refused.includes(u)); g.refused = [...(g.refused || []), ...refused]; Plan.save();
            Log.add(`the game did not allow ${refused.map((u) => name(E.read('Game.getMon', {}, u)?.id)).join(', ')} on the chapter team - picking others`);
            return 'choosing other carriers…';
          }
          return 'waiting: the game did not take the training team';
        }
        Log.add(`training team: ${want.map((u) => `${name(E.read('Game.getMon', {}, u)?.id)} Lv ${lvl(u)}`).join(', ')}`);
      }
      if (!inSpot(a.chapter)) {
        if (E.call('Adventure.setChapter', best.ch) === false) return `waiting: the game would not open ${best.name}`;
        Log.add(`moved to ${best.name} to train`);
      }
      // a fixed spot: that spot is the ONLY loop while it runs (the game goes on to the next looped chapter after
      // each one, so other loops would take it elsewhere); your list comes back when the goal stops
      if (g.force) { GoalTypes.soloLoop(g.force.key); }
      // (the buddy is handled for every activity by Buddy: lowest on the team that can still level)
      // moved chapters (better XP or a 10-minute check): turn off the loop Mega added on the old one
      if (!g.force && g.restore.loopAdded != null && g.restore.loopAdded !== best.ch) {
        try { if (E.read('Adventure.isLooping', false, g.restore.loopAdded)) E.call('Adventure.toggleLoop', g.restore.loopAdded); } catch (__e) { __h('70-plan-03-level:201', __e); }
        g.restore.loopAdded = null; Plan.save();
      }
      if (!g.force && !E.read('Adventure.isLooping', false, best.ch)) {
        try { E.call('Adventure.toggleLoop', best.ch); g.restore.loopAdded = best.ch; Plan.save(); Log.add(`turned on loop for ${best.name} so training stays there`); } catch (__e) { __h('70-plan-03-level:205', __e); }
      }
      const berry = Berries.keep('xp', 'training');
      return `training in ${best.name}${best.scout ? ' (10-min XP check)' : ''}${best.xpHr ? ` ~${XpChap.fmt(best.xpHr)} XP/h` : ''}${berry} · ` + g.uids.filter((u) => lvl(u) != null).map((u) => `${name(E.read('Game.getMon', {}, u)?.id)} ${lvl(u)}/${Math.min(g.target || 100, capOf(u))}`).join(', ');
    },
    // put things back: your team, the loop setting, and the chapter you were in
    finish(g) {
      const r = g.restore; if (!r) return;
      try { if (r.loopAdded != null && E.read('Adventure.isLooping', false, r.loopAdded)) E.call('Adventure.toggleLoop', r.loopAdded); } catch (__e) { __h('70-plan-03-level:213', __e); }
      if (r.loops) GoalTypes.loopsBack(r.loops);
      if (r.autoSwitch !== undefined) { try { S().autoSwitch = r.autoSwitch; E.call('Game.save'); } catch (__e) { __h('70-plan-03-level:215', __e); } }
      try { const back = (r.team || []).filter((u) => E.read('Game.getMon', null, u)); if (back.length && back.join() !== (S().team || []).join()) setChapterTeam(back); } catch (__e) { __h('70-plan-03-level:216', __e); }
      const back = (r.team || []).filter((u) => E.read('Game.getMon', null, u));
      if (back.length) setChapterTeam(back);
      if (!S().adv?.zone && r.chapter != null && +S().adv?.chapter !== +r.chapter) { try { E.call('Adventure.setChapter', +r.chapter); } catch (__e) { __h('70-plan-03-level:219', __e); } }
      g.restore = null; Plan.save();
      Log.add(`${level.label(g)}: done - your team, buddy and chapter are back`);
    },
  };
  Object.assign(GoalTypes, { level, bestChapter });
})();

// goal module: under, reserved (takes shared helpers from GoalKit, registers itself in GoalTypes)
(() => {
  const { E, S, name, pending, U, power } = GoalKit;
  // ---- Underground --------------------------------------------------------------------------
  // Runs alongside the other goals. Each tick: bring finished expeditions home (only once their
  // time is up), then fill free bays while runs are left today. Teams are picked with the game's
  // own expedition simulation (Underground.simulate, run in its sandbox - your save is untouched),
  // from Pokémon no other goal or your chapter team is using.
  const ugPlans = {}; // bay -> { sig, uids, floors }
  let ugBusy = false, ugStatus = '';
  const booked = () => { try { return JSON.parse(localStorage.getItem('mega-ug-book') || 'null'); } catch { return null; } };
  const saveBook = (b) => { try { if (b) localStorage.setItem('mega-ug-book', JSON.stringify(b)); else localStorage.removeItem('mega-ug-book'); } catch (__e) { __h('70-plan-04-underground:12', __e); } };
  // noTeam: leave out the active team (a booked team may be in it - the game takes a Pokémon out of the team
  // itself when it is sent, takeOutMon)
  // booked (a team Jimmy booked): only goals running right now hold a Pokémon back - a waiting goal picks again later
  function reserved(noTeam, booked) {
    const out = new Set(noTeam ? [] : S().team || []);
    for (const g of Plan.goals) {
      if (g.done) continue;
      if (booked && Plan.live(g.id)?.state !== 'running') continue;
      if (g.type === 'legend') { for (const u of E.read('Game.zoneTeam', [], g.foe) || []) out.add(u); for (const u of Legends.sims()[g.foe]?.uids || []) out.add(u); }
      if (g.type === 'level') { for (const u of [...(g.uids || []), ...(g.carriers || [])]) out.add(u); }
      // the Shiny Raid team and roamer teams (2026-11-19: Palkia went to the Underground mid-raid, leaving Dialga alone)
      if (g.type === 'raid') { for (const u of g.pick?.mine || []) out.add(u); try { const r = E.get('Raids'), reg = S().adv?.event?.raid ? S().adv.event.reg : r.drawn(); for (const u of S().eventTeams?.[r.teamKey(reg)] || []) out.add(u); } catch (__e) { __h('70-plan-04-underground:24', __e); } }
      if (g.type === 'roam') { for (const u of Legends.sims()[g.foe]?.uids || []) out.add(u); }
      // the World Boss capture team: expeditions take Pokémon out for hours, and the capture window comes once an edition
      if (g.type === 'wboss') { const z = GoalKit.wbZone(); if (z) { for (const u of E.read('Game.zoneTeam', [], z.id) || []) out.add(u); for (const u of Legends.sims()[z.id]?.uids || []) out.add(u); } }
    }
    return out;
  }
  function eligible(noTeam, booked) {
    const used = S().under?.used || {}, rsv = reserved(noTeam, booked);
    const away = new Set((E.read('Game.underMons', []) || []).map((m) => m.uid));
    return (E.read('Game.ownedMons', []) || []).filter((m) => !used[m.uid] && !rsv.has(m.uid) && !away.has(m.uid) && (() => { try { return !U().why(m); } catch { return false; } })());
  }
  // One expedition by the game's own simulation. r.floors is the floor it reached (floors below the start count as
  // passed: a team that starts at 100 and loses to that floor's guard reads 99 with nothing earned), r.loot one list
  // per floor. Mega used to add the start floor on top (99 + 99 = "floor 198") - fixed.
  const LOOT_V = { shards: 400, geode: 2500, plate: 8000, fossil: 3000, item: 600 }; // rough ₽ worth, for "most loot"
  // runs = 2 while searching (fast); the finalists get FINAL_RUNS and are judged on a BAD run, not the average
  // (Jimmy 2026-11-22: estimates ran ~13 floors high - 5 of 10 teams stopped at 99, in front of floor 100's guard).
  // With: deep / cleared = the 25th percentile (one run in four does worse), med = the middle run.
  const FINAL_RUNS = 12, FINALISTS = 4;
  const q = (a, p) => { const b = a.slice().sort((x, y) => x - y); return b.length ? b[Math.min(b.length - 1, Math.floor(p * b.length))] : 0; };
  async function depth(team, theme, from, runs = 2) {
    const deeps = [], cls = []; let value = 0;
    for (let i = 0; i < runs; i++) {
      const r = await U().simulate(team, theme, from);
      const fl = +r?.floors || 0; deeps.push(fl); cls.push(Math.max(0, fl - (from - 1)));
      for (const f of r?.loot || []) for (const x of f || []) value += x.k === 'money' ? +x.n || 0 : x.k === 'shards' ? (+x.n || 0) * LOOT_V.shards : LOOT_V[x.k] || 0;
      await new Promise((x) => setTimeout(x, 0));
    }
    const avg = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
    return runs >= 4
      ? { deep: q(deeps, 0.25), cleared: q(cls, 0.25), value: value / runs, med: q(deeps, 0.5), runs }
      : { deep: avg(deeps), cleared: avg(cls), value: value / runs, med: avg(deeps), runs };
  }
  // what the goal is after: the deepest floor (raises your record, which opens higher start floors and better loot
  // bands) or the most loot this run
  // A run that clears nothing (a start above what the team can handle: it loses to that floor's guard) is never
  // picked. "Deepest": floors past your record count most, then floors cleared (loot and XP on every one of them).
  const record = () => { try { return +U().best() || 0; } catch { return 0; } };
  const scoreOf = (d, aim) => (d.cleared < 1 ? -1e9 + d.cleared : aim === 'loot' ? d.value + d.deep : Math.max(0, d.deep - record()) * 1e6 + d.cleared * 1000 + d.value / 1e6);
  // the Pokémon worth trying for this bay: the strongest, plus the best against the theme's types and the guards of
  // the floors the run starts at (a guard every GUARD_EVERY floors, x GUARD_MULT strength - the start floor's
  // guard is the first wall: a plain Lv 100 team lost to it on floor 100)
  // the Discord guide "Underground Expedition Picks" (@destryyy, game v0.5.06, Rank 0, from floor 1): the best 8 per
  // theme, then the best 8 non-legendaries. Added 2026-11-23 (Jimmy): the ones you own always get tried by the
  // simulator, and the guide's top trio you own is a starting team. The simulator still decides (your levels, ranks,
  // start floor and today's guards differ from the guide's).
  const GUIDE = {
    flooded: ['White Kyurem', 'Dialga', 'Reshiram', 'Arceus (Poison)', 'Giratina (Origin Forme)', 'Regigigas', 'Genesect (Burn Drive)', 'Zekrom',
      'Slaking', 'Ferrothorn', 'Venusaur', 'Vileplume', 'Salamence', 'Garchomp', 'Amoonguss', 'Dragonite'],
    volcanic: ['Kyogre', 'Arceus (Water)', 'Palkia', 'Groudon', 'Giratina', 'Keldeo', 'Suicune', 'White Kyurem',
      'Garchomp', 'Slaking', 'Walrein', 'Vaporeon', 'Kingdra', 'Feraligatr', 'Milotic', 'Blastoise'],
    crystal: ['Regigigas', 'Giratina', 'Reshiram', 'Dialga', 'Arceus (Ghost)', 'Palkia', 'Groudon', 'Kyogre',
      'Slaking', 'Metagross', 'Chandelure', 'Arcanine', 'Volcarona', 'Snorlax', 'Darmanitan', 'Gallade'],
    dark: ['White Kyurem', 'Dialga', 'Arceus (Steel)', 'Zekrom', 'Reshiram', 'Slaking', 'Ho-Oh', 'Groudon',
      'Darmanitan', 'Arcanine', 'Tyranitar', 'Emboar', 'Hydreigon', 'Gyarados', 'Braviary'],
    ancient: ['Lugia', 'Arceus (Psychic)', 'Ho-Oh', 'Landorus (Therian Forme)', 'Rayquaza', 'Mewtwo', 'Giratina', 'Groudon',
      'Gyarados', 'Garchomp', 'Salamence', 'Musharna', 'Charizard', 'Dragonite', 'Slowbro', 'Slaking'],
    galleries: ['White Kyurem', 'Zekrom', 'Regigigas', 'Giratina (Origin Forme)', 'Dialga', 'Arceus (Rock)', 'Zapdos', 'Kyogre',
      'Magnezone', 'Slaking', 'Rhyperior', 'Gigalith', 'Armaldo', 'Rampardos', 'Ampharos', 'Glaceon'],
  };
  const norm = (n) => String(n || '').toLowerCase().replace(/[^a-z]/g, '');
  // your best copy (highest level, then rank) of each guide pick for this theme, in the guide's order
  function guidePicks(pool, theme) {
    const list = GUIDE[theme?.key] || []; if (!list.length) return [];
    const by = new Map();
    for (const m of pool) { let n = ''; try { n = norm(GemFocus.nameOf(m.id)); } catch (__e) { __h('70-plan-04-underground:90', __e); } const o = by.get(n); if (!o || m.level > o.level || (m.level === o.level && (m.rank || 0) > (o.rank || 0))) by.set(n, m); }
    return list.map((n) => by.get(norm(n))).filter(Boolean);
  }
  function candidates(pool, theme, from) {
    const u = U(), cfg = E.get('CONFIG')?.UNDERGROUND || {}, every = +cfg.GUARD_EVERY || 10;
    const lv = (f) => { try { return +u.levelOf(f) || 50; } catch { return 50; } };
    const foes = [];
    for (let f = Math.ceil(Math.max(1, from) / every) * every, k = 0; k < 2; f += every, k++) {
      let ids = []; try { ids = u.guardsOf(f) || []; } catch (__e) { __h('70-plan-04-underground:98', __e); }
      ids.slice(0, 5).forEach((id, i) => foes.push({ id: +id, level: lv(f), w: 2 }));
    }
    const TT = theme?.types || [], DEX = E.get('Game.DEX') || {};
    const themeIds = Object.keys(DEX).filter((id) => (DEX[id].types || []).some((t) => TT.includes(t)) && !DEX[id].legendary && !DEX[id].mythical).slice(0, 400);
    for (let i = 0; i < Math.min(6, themeIds.length); i++) foes.push({ id: +themeIds[Math.floor(i * themeIds.length / 6)], level: lv(from + 5), w: 1 });
    const cov = (m) => { try { return Sim.coverage(m, foes).reduce((a, v, i) => a + Math.log1p(v) * foes[i].w, 0); } catch { return 0; } };
    const byPow = pool.slice(0, 16), byMatch = pool.map((m) => ({ m, v: cov(m) })).sort((a, b) => b.v - a.v).slice(0, 14).map((x) => x.m);
    const guide = guidePicks(pool, theme);
    return { short: [...new Set([...guide, ...byMatch, ...byPow])], cov, guide };
  }
  async function ugPick(bay, from, taken, aim) {
    // the theme this bay sends into next: theme(bay). (themeOf(key) turns a theme KEY into its object - given a bay
    // number it fell back to Flooded, so before 2.15.8 every bay was picked and simulated as Flooded)
    const theme = U().theme(bay);
    const pool = eligible().filter((m) => !taken.has(m.uid)).sort((a, b) => b.level - a.level || power(b) - power(a));
    const size = (E.get('CONFIG')?.UNDERGROUND?.TEAM) || 3;
    if (pool.length < size) return { error: `only ${pool.length} Pokémon free to send today` };
    const { short, cov, guide } = candidates(pool, theme, from);
    let team = []; for (const m of short.slice().sort((a, b) => cov(b) - cov(a))) { if (team.length >= size) break; if (!team.some((t) => Sim.species(t) === Sim.species(m))) team.push(m); }
    // the guide's top trio you own: start there when it does better (the search then tries swaps from the better one)
    const gTeam = []; for (const m of guide) { if (gTeam.length >= size) break; if (!gTeam.some((t) => Sim.species(t) === Sim.species(m))) gTeam.push(m); }
    // the search keeps the best few teams it saw, then re-runs each FINAL_RUNS times and keeps the one that does best
    // on a bad run - one lucky pair of runs no longer decides
    const seen = new Map(), key = (t) => t.map((m) => m.uid).sort().join(',');
    const note = (t, d) => { const k = key(t), v = scoreOf(d, aim); if (!seen.has(k) || seen.get(k).v < v) seen.set(k, { t, v }); };
    let bestD = await depth(team, theme, from), best = scoreOf(bestD, aim); note(team, bestD);
    if (gTeam.length === size && key(gTeam) !== key(team)) { const d = await depth(gTeam, theme, from), v = scoreOf(d, aim); note(gTeam, d); if (v > best) { team = gTeam; bestD = d; best = v; } }
    for (let pass = 0; pass < 2; pass++) {
      let better = false;
      for (let slot = 0; slot < size; slot++) {
        for (const c of short) {
          if (team.some((t, k) => t.uid === c.uid || (k !== slot && Sim.species(t) === Sim.species(c)))) continue;
          const trial = team.slice(); trial[slot] = c;
          const d = await depth(trial, theme, from), v = scoreOf(d, aim); note(trial, d);
          if (v > best * 1.005 + 0.5) { best = v; bestD = d; team = trial; better = true; }
        }
      }
      if (!better) break;
    }
    let fin = null;
    for (const { t } of [...seen.values()].sort((a, b) => b.v - a.v).slice(0, FINALISTS)) {
      const d = await depth(t, theme, from, FINAL_RUNS), v = scoreOf(d, aim);
      if (!fin || v > fin.v) fin = { t, d, v };
    }
    if (fin) { team = fin.t; bestD = fin.d; }
    const gs = new Set(guide.map((m) => m.uid));
    return { uids: team.map((m) => m.uid), guide: team.filter((m) => gs.has(m.uid)).length, floors: Math.round(bestD.med ?? bestD.deep), low: Math.round(bestD.deep), cleared: Math.round(bestD.cleared), value: Math.round(bestD.value), from, theme: theme?.name || theme?.key };
  }
  // "Best (auto)": a team for each start floor the game offers, keep the one that does best for the aim
  async function ugPickAuto(bay, taken, aim) {
    const starts = (() => { try { const s = U().starts(); return s?.length ? s : [1]; } catch { return [1]; } })();
    let win = null;
    for (const f of starts) {
      ugStatus = `trying a start at floor ${f} (${starts.length} start floors)…`;
      const r = await ugPick(bay, f, taken, aim); if (r.error) return r;
      const v = scoreOf({ deep: r.low ?? r.floors, cleared: r.cleared, value: r.value }, aim);
      if (!win || v > win.v) win = { ...r, v };
    }
    if (win && win.cleared < 1) return { error: 'no start floor where a free team clears even one floor' };
    return win;
  }

  const under = {
    uses: 'background',
    label: (g) => `Underground · ${g.from === 'auto' ? 'best start floor' : 'from floor ' + (g.from || 1)} · ${g.aim === 'loot' ? 'most loot' : 'deepest floor'}`,
    sprite: () => null,
    check(g) {
      if (!E.read('Underground.unlocked', false)) return { state: 'wait', why: 'the Underground is not open yet' };
      return { state: 'ready', why: null };
    },
    async step(g) {
      if (ugBusy) return ugStatus || 'picking a team…';
      const u = U(), now = Date.now();
      // 1) bring finished runs home - never before their end time (taking back early recalls them)
      for (const sl of [...(S().under?.slots || [])]) {
        let pr = null; try { pr = u.progress(sl); } catch (__e) { __h('70-plan-04-underground:174', __e); }
        if (pr?.done && now > +sl.end + 2000) {
          const reached = pr.floor ?? sl.res?.at?.length;
          try { u.collect(sl.id); } catch (e) { Log.add('Underground: could not bring a run home (' + (e?.message || e) + ')'); continue; }
          try { E.call('Game.save'); } catch (__e) { __h('70-plan-04-underground:178', __e); }
          try { E.call('App.refresh'); } catch (__e) { __h('70-plan-04-underground:179', __e); }
          Log.add(`Underground bay ${(sl.bay || 0) + 1}: back from floor ${reached ?? '?'} (${sl.team.map((x) => name(E.read('Game.getMon', {}, x)?.id)).join(', ')})`);
          Notify.send('daily', `Underground: back from floor ${reached ?? '?'}`, `Bay ${(sl.bay || 0) + 1} · ${sl.team.map((x) => name(E.read('Game.getMon', {}, x)?.id)).join(', ')} · ${+u.left() || 0} runs left today`);
        }
      }
      // 2) fill free bays
      const left = +u.left() || 0, max = +u.slotsMax() || 1, slots = S().under?.slots || [];
      const busyBays = new Set(slots.map((x) => x.bay || 0));
      const free = Array.from({ length: max }, (_, i) => i).filter((b) => !busyBays.has(b));
      const runningTxt = slots.length ? `${slots.length} down there, next back in ${Math.max(0, Math.ceil((Math.min(...slots.map((x) => +x.end)) - now) / 60_000))} min` : 'none down there';
      if (!left) return `no expeditions left today (${u.perDay()}/day) · ${runningTxt}`;
      if (!free.length) return `${left} left today · ${runningTxt}`;
      if (ugStatus && /only \d+ Pokémon|could not send|error/.test(ugStatus) && Date.now() - (g.lastTry || 0) < 5 * 60_000) return ugStatus;
      g.lastTry = Date.now();
      // let a catch goal finish picking its team first, so the Underground doesn't take its Pokémon
      if (Plan.goals.some((x) => !x.done && x.type === 'legend' && pending.has(x.foe))) return 'letting a catch goal pick its team first';
      const auto = g.from === 'auto', from = auto ? 0 : (u.starts() || [1]).includes(+g.from || 1) ? (+g.from || 1) : 1, aim = g.aim === 'loot' ? 'loot' : 'deep';
      ugBusy = true;
      ugStatus = 'picking a team with the game\'s own expedition simulation…';
      (async () => { try {
        const taken = new Set();
        for (const bay of free.slice(0, left)) {
          const sig = [S().under?.day, bay, JSON.stringify(u.theme(bay)), g.from, aim, JSON.stringify(u.starts()), [...reserved()].sort().join(',')].join('|');
          let pl = ugPlans[bay];
          // a team Jimmy booked for one bay theme on one Underground day (2.15.3: White Kyurem / Dialga / Reshiram for
          // Galleries on 2026-11-25). It waits for them up to 3 h into the day (he frees them from other plans), then gives up.
          const bk = booked();
          if (bk && bk.day === S().under?.day && u.theme(bay)?.key === bk.theme) {
            // the active team doesn't hold a booked Pokémon back - unless a run is using it right now (raid, League, tower)
            const run = !!GoalKit.holder(), busy = reserved(!run, true), el = new Set(eligible(!run, true).map((m) => m.uid));
            const free2 = bk.uids.every((x) => el.has(x) && !busy.has(x) && !taken.has(x));
            if (!free2) {
              bk.seen = bk.seen || Date.now(); saveBook(bk);
              if (Date.now() - bk.seen < 3 * 3600_000) { ugStatus = `bay ${bay + 1} is kept for your booked team (${bk.label}) - one of them is still busy`; continue; }
              Log.add(`Underground: your booked team (${bk.label}) was still busy 3 h into the day - bay ${bay + 1} gets a normal pick`); saveBook(null);
            } else {
              const th = u.theme(bay), team = bk.uids.map((x) => E.read('Game.getMon', null, x));
              const d = await depth(team, th, 1, 6);
              pl = { sig, uids: bk.uids.slice(), guide: 0, floors: Math.round(d.med ?? d.deep), low: Math.round(d.deep), cleared: Math.round(d.cleared), value: Math.round(d.value), from: 1, theme: th?.name || bk.theme, booked: 1 };
              ugPlans[bay] = pl;
            }
          }
          if (!pl || pl.sig !== sig || pl.uids.some((x) => taken.has(x))) {
            const r = (auto ? await ugPickAuto(bay, taken, aim) : await ugPick(bay, from, taken, aim)) || { error: 'no team found' };
            if (r.error) { ugStatus = r.error; return; }
            pl = ugPlans[bay] = { sig, ...r };
          }
          pl.uids.forEach((x) => taken.add(x));
          if (!Plan.running || Plan.oldOn() || !Plan.hasType('under')) return; // paused or removed while picking
          // the pick takes a while (the game's expedition sim): a raid / catch goal may have claimed one of these meanwhile
          // (2026-11-20: Lugia and Gyarados went underground right after the Shiny Raid picked them) - check again just before sending
          { const now = pl.booked ? reserved(!GoalKit.holder(), true) : reserved(); if (pl.uids.some((x) => now.has(x))) { delete ugPlans[bay]; ugStatus = 'a goal just claimed one of the picked Pokémon - picking again'; return; } }
          const who = pl.uids.map((x) => name(E.read('Game.getMon', {}, x)?.id)).join(', '); // before: once sent, they're out of the PC
          { const why = Guard.team(pl.uids, { need: (E.get('CONFIG')?.UNDERGROUND?.TEAM) || 3, minLevel: 1 });
            if (why) { ugStatus = Guard.stop(`Underground bay ${bay + 1}`, why); delete ugPlans[bay]; return; } }
          const res = await u.send(pl.uids, bay, pl.from || 1);
          if (res?.error) { Log.add(`Underground bay ${bay + 1}: the game said "${res.error}"`); delete ugPlans[bay]; ugStatus = 'could not send: ' + res.error; return; }
          try { E.call('Game.save'); } catch (__e) { __h('70-plan-04-underground:236', __e); }
          try { E.call('App.refresh'); } catch (__e) { __h('70-plan-04-underground:237', __e); }
          Log.add(`Underground bay ${bay + 1} (${pl.theme}): sent ${who}${pl.guide ? ` (${pl.guide} of them from the Discord guide's picks)` : ''} from floor ${pl.from} - about floor ${pl.floors}, floor ${pl.low ?? pl.floors} on a bad run (${pl.cleared}+ floors cleared, about ₽${pl.value.toLocaleString()} worth of loot) by the game's own simulation`);
          g.lastSend = { at: Date.now(), from: pl.from, floors: pl.floors, low: pl.low, cleared: pl.cleared, theme: pl.theme };
          if (pl.booked) { saveBook(null); Log.add('Underground: your booked team is on its way'); }
          delete ugPlans[bay];
        }
        ugStatus = '';
      } catch (e) { ugStatus = 'error: ' + (e?.message || e); Log.add('Underground: ' + ugStatus); } finally { ugBusy = false; } })();
      return ugStatus;
    },
  };
  // "Preview": what the goal would send to bay 1 right now (start floor, team, floors), without sending anything
  // (its own busy flag and no touching the goal's status: a preview must not clear the 5-minute wait after an error)
  let pvBusy = false;
  function ugPreview(g) { // answers at once when busy (the phone says so), otherwise a promise of the preview
    if (ugBusy || pvBusy) return { error: 'Mega is already picking an Underground team - try the preview again in a minute', at: Date.now() };
    return ugPreviewRun(g);
  }
  async function ugPreviewRun(g) {
    pvBusy = true; ugBusy = true; g.preview = { busy: true, at: Date.now() };
    const keepStatus = ugStatus;
    try {
      const aim = g.aim === 'loot' ? 'loot' : 'deep';
      const st = (() => { try { const s = U().starts(); return s?.length ? s : [1]; } catch { return [1]; } })();
      const from = g.from === 'auto' ? null : st.includes(+g.from || 1) ? +g.from || 1 : 1; // the same fallback the real send uses
      const r = from ? await ugPick(0, from, new Set(), aim) : await ugPickAuto(0, new Set(), aim);
      g.preview = !r || r.error ? { error: r?.error || 'no team found', at: Date.now() } : { at: Date.now(), guide: r.guide || 0, from: r.from, floors: r.floors, low: r.low, cleared: r.cleared, value: r.value, theme: r.theme, team: r.uids.map((u) => name(E.read('Game.getMon', {}, u)?.id)) };
    } catch (e) { g.preview = { error: e?.message || String(e), at: Date.now() }; } finally { pvBusy = false; ugBusy = false; ugStatus = keepStatus; Plan.save(); }
    return g.preview;
  }
  Object.assign(GoalTypes, { under, reserved, ugPreview });
})();

// goal module: shinyWays, shinyWild, shinyBreed, ownsShinyId, wild, wildChapters (takes shared helpers from GoalKit, registers itself in GoalTypes)
(() => {
  const { E, S, name, sideHas, here, poolAt, RD, passTeam, setChapterTeam, capOf, awayNow } = GoalKit;
  // ---- catch a wild Pokémon in a chapter ---------------------------------------------------------
  // Goes to the chapter, keeps it looping and auto-catch on, and restarts the chapter (free, back to
  // stop 0) as soon as none of the stops ahead can hold the target.
  function wildSpots(id, ch) {
    const steps = E.get('STORY')?.CHAPTERS?.[ch]?.steps || [], out = [];
    for (const st of steps) { if (st.kind !== 'route' || !st.areas?.length) continue; const p = poolAt(st, ch).find((x) => x.id === +id); if (p) out.push({ name: st.name, pct: p.pct || 0, on: p.on !== false, when: p.when || null }); }
    return out;
  }
  // where a species lives in chapters you have unlocked, best chance first
  function wildChapters(id) {
    const ST = E.get('STORY'), unlocked = +(S().adv?.unlocked ?? 0), out = [];
    for (let ch = 0; ch <= unlocked && ch < (ST?.CHAPTERS?.length || 0); ch++) {
      const spots = wildSpots(id, ch); if (!spots.length) continue;
      out.push({ ch, name: ST.CHAPTERS[ch]?.name || 'chapter ' + ch, best: Math.max(...spots.map((x) => x.pct)), now: spots.some((x) => x.on), spots });
    }
    return out.sort((a, b) => (b.now - a.now) || (b.best - a.best));
  }
  // ---- shiny hunts --------------------------------------------------------------------------------
  // The game's shiny odds (2026-11-17): wild 1/2048 x2 (Game.shinyRate) x2 with a Starf Berry; Day Care
  // eggs 1/512, but 1/16 when the parent is shiny (CONFIG.PENSION.SHINY_PARENT_RATE). So: breeding a
  // shiny you own from the same family is usually fastest; otherwise the wild spot where it's most common.
  const ownsShinyId = (id) => (E.read('Game.ownedMons', []) || []).some((m) => +m.id === +id && m.shiny);
  function eggOf(id) { const L = E.get('CONFIG')?.PENSION?.LAYS || {}; if (L[id] != null) return +L[id]; let f = []; try { f = E.get('Game').familyOf(+id) || []; } catch (__e) { __h('70-plan-05-wild-shiny:26', __e); } return +(f[0] ?? id); }
  // level-up steps from the egg's species to the target (null if a stone / trade / item is needed)
  function levelPath(from, to) {
    const PV = E.get('Game')?.PREVO || {}, steps = []; let cur = +to, n = 0;
    while (cur !== +from && n++ < 5) { const p = PV[cur]; if (!p || !p.level) return null; steps.unshift({ from: +p.from, to: cur, level: +p.level }); cur = +p.from; }
    return cur === +from ? steps : null;
  }
  const WILD_PER_HOUR = 300; // wild encounters an hour on a route at speed 4 (measured ~480 battles/h incl. trainers)
  function shinyWays(id) {
    id = +id;
    const Gm = E.get('Game'), out = [];
    if (ownsShinyId(id)) return { owned: true, ways: [] };
    let fam = []; try { fam = Gm.familyOf(id) || []; } catch (__e) { __h('70-plan-05-wild-shiny:38', __e); }
    // 1. breed a shiny you own from the same family (1/16 an egg)
    const perDay = 86_400_000 / (+(S().pension?.eggGoal) || 10_800_000);
    for (const m of here().filter((x) => x.shiny && fam.includes(+x.id))) {
      let ok = false; try { ok = Gm.canLay(m); } catch (__e) { __h('70-plan-05-wild-shiny:42', __e); } if (!ok) continue;
      const egg = eggOf(m.id), steps = egg === id ? [] : levelPath(egg, id); if (!steps) continue;
      let rate = 0.0625; try { rate = +Gm.eggRate({ id: egg, reg: m.reg, sp: 2 }) || rate; } catch (__e) { __h('70-plan-05-wild-shiny:44', __e); }
      const hours = (1 / (rate * perDay) + 0.25) * 24 + (steps.length ? 2 : 0);
      out.push({ way: 'breed', parent: m.uid, parentId: +m.id, egg, steps, rate, hours,
        text: `breed your shiny ${name(m.id)} in the Day Care: each egg is a ${name(egg)} with a 1 in ${Math.round(1 / rate)} shiny chance${steps.length ? `, then level it to ${steps.map((x) => `${name(x.to)} (Lv ${x.level})`).join(', then ')}` : ''}` });
      break;
    }
    // 2. the wild: where it's most common (share of all encounters in that chapter)
    let r = 1 / 1024; try { r = +Gm.shinyRate(id) || r; } catch (__e) { __h('70-plan-05-wild-shiny:51', __e); }
    for (const c of wildChapters(id).slice(0, 3)) {
      const routes = (E.get('STORY')?.CHAPTERS?.[c.ch]?.steps || []).filter((x) => x.kind === 'route' && x.areas?.length).length || 1;
      const share = c.spots.reduce((t, x) => t + (x.on ? x.pct : 0), 0) / routes || c.best / routes;
      const hours = 1 / (WILD_PER_HOUR * share * r * 2); // with a Starf Berry
      out.push({ way: 'wild', ch: c.ch, now: c.now, share, rate: r * 2, hours,
        text: `hunt it in ${Casing.names(c.name)} (about ${share >= 0.1 ? Math.round(share * 100) : (share * 100).toFixed(1)}% of encounters there${c.now ? '' : ', not at this time / weather'}): 1 in ${Math.round(1 / (r * 2))} with a Starf Berry` });
    }
    // 2b. a shiny pre-evolution caught in the wild, then evolved (Mega levels it; a stone/item is up to you)
    const PV = Gm.PREVO || {}, pres = []; { let cur = id, n = 0; while (PV[cur]?.from != null && n++ < 4) { cur = +PV[cur].from; pres.push(cur); } }
    if (!pres.length && fam.length && +fam[0] !== id) pres.push(+fam[0]);
    for (const pre of pres) {
      const steps = levelPath(pre, id), c = wildChapters(pre)[0]; if (!c) continue;
      let rp = 1 / 1024; try { rp = +Gm.shinyRate(pre) || rp; } catch (__e) { __h('70-plan-05-wild-shiny:64', __e); }
      const routes = (E.get('STORY')?.CHAPTERS?.[c.ch]?.steps || []).filter((x) => x.kind === 'route' && x.areas?.length).length || 1;
      const share = c.spots.reduce((t, x) => t + (x.on ? x.pct : 0), 0) / routes || c.best / routes;
      out.push({ way: 'wild', foe: pre, target: id, ch: c.ch, now: c.now, share, rate: rp * 2, steps, hours: 1 / (WILD_PER_HOUR * share * rp * 2) + (steps ? 2 : 0),
        text: `hunt a shiny ${name(pre)} in ${Casing.names(c.name)} (about ${share >= 0.1 ? Math.round(share * 100) : (share * 100).toFixed(1)}% of encounters${c.now ? '' : ', not at this time / weather'}), then ${steps ? `Mega levels it to ${steps.map((x) => `${name(x.to)} (Lv ${x.level})`).join(', then ')}` : `evolve it into ${name(id)} yourself (it needs a stone or item)`}` });
    }
    // 3. the Shiny Raid: today's boss is always shiny
    try { const lane = RD()?.lane?.() || []; const hit = lane.find((x) => +x.boss === id && !x.won); if (hit) out.push({ way: 'raid', reg: hit.key, hours: 0, text: `it's today's Shiny Raid boss in ${hit.key} - the boss is always shiny (the Shiny Raid goal catches it)` }); } catch (__e) { __h('70-plan-05-wild-shiny:71', __e); }
    return { owned: false, ways: out.sort((a, b) => a.hours - b.hours) };
  }
  const shinyLabel = (g) => `Shiny ${name(g.target || g.foe)}${g.way === 'breed' ? ` (breeding your shiny ${name(g.parentId)})` : ` (${g.target && g.target !== g.foe ? `as ${name(g.foe)}, ` : ''}${E.get('STORY')?.CHAPTERS?.[g.ch]?.name || 'chapter ' + g.ch})`}`;
  // ---- hunt team (Jimmy 2026-11-23): like the leveling job. When 1-2 fully leveled carriers knock out most of
  // the chapter in one hit (simulated against its wild Pokémon), they lead every fight (auto-switch off, carriers
  // first) and the other slots level Pokémon that need it: the top player's rank-5 picks first (GemFocus), then
  // ranked Pokémon, then the closest to their cap. Every team member gets the full XP of each win, so the hunt
  // runs at the same pace and the bench levels for free. Otherwise: the chapter's 6 best (as before).
  // Your team and auto-switch come back when the hunt ends. Decided again every 2 h (levels change).
  const HT_EVERY = 2 * 3.6e6;
  function trainees(n, skip) {
    const away = awayNow(), out = [], seen = new Set(skip);
    const ok = (m) => m && !seen.has(m.uid) && !away.has(m.uid) && m.level < capOf(m.uid);
    const add = (m) => { if (ok(m) && out.length < n) { out.push(m.uid); seen.add(m.uid); } };
    // Mega's trainee order (GoalTypes.idlePick - Jimmy 2026-11-25: favourites by rank, then the rest by rank, shinies first)
    const mons = here(), ord = new Map(GoalTypes.idlePick(2000).map((u, i) => [u, i]));
    for (const m of mons.slice().sort((a, b) => (ord.get(a.uid) ?? 1e9) - (ord.get(b.uid) ?? 1e9) || b.level - a.level)) add(m);
    return out;
  }
  function huntPlan(g) {
    let picks = []; try { picks = Sim.carriers(+g.ch, { n: 4, minLevel: 90 }).picks.filter((p) => p.m.level >= capOf(p.m.uid)); } catch (__e) { __h('70-plan-05-wild-shiny:92', __e); }
    if (!picks.length) return null;
    const foes = (() => { try { return Sim.chapterFoes(+g.ch); } catch { return []; } })(); if (!foes.length) return null;
    const W = foes.reduce((t, f) => t + (f.w || 1), 0);
    // time per win ~ hits to KO + 1, +2 per KO it risks taking (the leveling job's measure)
    const cost = (ms) => foes.reduce((t, f) => t + (f.w || 1) * (1 + Math.min(...ms.map((m) => { const c = Sim.clearScore(m, [{ ...f, w: 1 }]); return 1 / Math.max(c.kill, 0.02) + 2 * c.hurt; }))), 0) / W;
    const kill = (ms) => foes.reduce((t, f) => t + (f.w || 1) * Math.max(...ms.map((m) => Sim.clearScore(m, [{ ...f, w: 1 }]).kill)), 0) / W;
    const c1 = cost([picks[0].m]), c2 = picks[1] ? cost([picks[0].m, picks[1].m]) : Infinity;
    const n = c1 <= c2 * 1.05 ? 1 : 2, carry = picks.slice(0, n).map((p) => p.m);
    const k = kill(carry);
    if (k < 0.6) return { n: 0, kill: k }; // they don't clear most of it: keep the 6 best
    return { n, kill: k, carry: carry.map((m) => m.uid), team: [...carry.map((m) => m.uid), ...trainees(6 - n, carry.map((m) => m.uid))] };
  }
  function huntTeam(g) {
    const a = S().adv || {};
    if (+a.chapter !== +g.ch || (a.battle && !a.battle.over)) return ''; // only between fights, in the chapter
    if (!g.ht || g.ht.ch !== g.ch || Date.now() - g.ht.at > HT_EVERY) {
      const p = huntPlan(g); g.ht = { ch: g.ch, at: Date.now(), ...(p || { n: 0 }) }; Plan.save();
      if (p?.n) Log.add(`${shinyWild.label(g)}: ${p.carry.map((u) => name(E.read('Game.getMon', {}, u)?.id)).join(' + ')} lead every fight (one-hit KO on ~${Math.round(p.kill * 100)}% of the chapter); leveling: ${p.team.slice(p.n).map((u) => { const m = E.read('Game.getMon', {}, u); return `${name(m?.id)} Lv ${m?.level}`; }).join(', ') || 'nobody'}`);
      else Log.add(`${shinyWild.label(g)}: no 1-2 Pokémon clear this chapter alone (${p ? Math.round((p.kill || 0) * 100) + '%' : 'no data'}) - the 6 best play`);
    }
    const ht = g.ht; if (!ht.n) return '';
    if (!g.restore.team) g.restore.team = (S().team || []).slice();
    // still have all of them? (a trainee that hit its cap, or one sent to the Underground, gets replaced)
    const live = ht.team.filter((u) => { const m = E.read('Game.getMon', null, u); return m && !awayNow().has(u); });
    const tr = live.slice(ht.n).filter((u) => { const m = E.read('Game.getMon', null, u); return m.level < capOf(u); });
    let want = [...ht.carry.filter((u) => live.includes(u)), ...tr];
    if (want.length < ht.carry.length) { g.ht = null; Plan.save(); return ''; }
    if (want.length < 6) want = [...want, ...trainees(6 - want.length, want)];
    if (want.join() !== ht.team.join()) { ht.team = want; Plan.save(); }
    const S0 = S();
    if (S0.autoSwitch !== false) { if (g.restore.autoSwitch === undefined) g.restore.autoSwitch = S0.autoSwitch ?? true; S0.autoSwitch = false; try { E.call('Game.save'); } catch (__e) { __h('70-plan-05-wild-shiny:123', __e); } Plan.save(); Log.add(`${shinyWild.label(g)}: auto-switch off so the carrier${ht.n > 1 ? 's' : ''} lead every fight (yours comes back when the hunt ends)`); }
    const cur = (S0.team || []).slice(0, 6);
    if (cur.join() !== want.join()) { if (!setChapterTeam(want)) return ' · could not set the hunt team'; }
    return ` · ${name(E.read('Game.getMon', {}, ht.carry[0])?.id)}${ht.n > 1 ? ' + 1' : ''} leads, ${want.length - ht.n} leveling`;
  }
  // hunt in the wild: like catching it (go there, loop, restart trick), with auto-catch on for shinies
  const shinyWild = {
    uses: 'screen',
    label: (g) => Casing.names(shinyLabel(g)),
    sprite: (g) => g.target || g.foe,
    progress: (g) => (g.seen ? { have: g.seen, need: Math.max(g.seen + 1, Math.round(1 / (g.rate || 1 / 512))), unit: 'seen' } : null),
    check(g) {
      const tgt = g.target || g.foe;
      if (ownsShinyId(tgt)) return { state: 'done', why: `shiny ${name(tgt)}!${g.seen ? ` (${g.seen} seen)` : ''}` };
      if (tgt !== g.foe && ownsShinyId(g.foe)) { // caught the shiny pre-evolution: evolve it
        if (!g.steps) return { state: 'done', why: `shiny ${name(g.foe)} caught - evolve it into ${name(tgt)} yourself (it needs a stone or item)` };
        if (!g.leveling) { const m = (E.read('Game.ownedMons', []) || []).find((x) => +x.id === +g.foe && x.shiny); if (m) { g.leveling = m.uid; Plan.save(); Plan.add('level', { uids: [m.uid], target: Math.min(100, Math.max(...g.steps.map((x) => x.level))) }); Log.add(`shiny hunt: leveling your new shiny ${name(g.foe)} so it becomes ${name(tgt)}`); } }
        return { state: 'wait', why: `shiny ${name(g.foe)} caught - a leveling goal is evolving it into ${name(tgt)}` };
      }
      if (g.ch > +(S().adv?.unlocked ?? 0)) return { state: 'wait', why: 'that chapter is not unlocked yet' };
      const spots = wildSpots(g.foe, g.ch);
      if (!spots.length) return { state: 'wait', why: 'not found in that chapter any more' };
      if (!spots.some((x) => x.on)) { const w = [...new Set(spots.flatMap((x) => x.when || []))]; const nx = spots.map((x) => DexInfo.nextWhen(g.ch, x.name, x.when)).filter(Boolean).sort((a, b) => a.at - b.at)[0]; return { state: 'wait', why: `only appears ${w.length ? 'in ' + w.map((k) => DexInfo.whenText([k])).join(' / ') : 'at another time'} · ${DexInfo.whenLine(nx)}` }; }
      return { state: 'ready', why: null };
    },
    async step(g) {
      const a = S().adv || {};
      if (a.capture && !a.capture.shiny) { a.capture.shiny = true; try { E.call('Game.save'); } catch (__e) { __h('70-plan-05-wild-shiny:150', __e); } Log.add('turned on "always catch shinies" for the shiny hunt'); }
      // count each new encounter with the target (and the battles, for the real pace)
      // both the species hunted and the target itself (Stunky and Skuntank): a shiny of either is caught
      const ids = [...new Set([+g.foe, +(g.target || g.foe)])];
      const b = a.battle, foes = (b?.enemies || []).filter((e) => ids.includes(+e.id));
      for (const e of foes) if (e.uid && e.uid !== g.lastUid) { g.lastUid = e.uid; if (e.shiny) Log.add(`✨ a shiny ${name(e.id)} appeared - catching!`); }
      // how many were met: the game's own count (every one beaten is caught - a duplicate turns into candy).
      // Mega used to count battles it happened to see, and missed the short ones (9 counted vs ~37 met).
      const cnt = (id) => +(S().dex?.[id]?.caught || 0);
      if (g.c0 == null) { g.c0 = Object.fromEntries(ids.map((id) => [id, cnt(id)])); g.seenBase = g.seen || 0; g.tgtBase = g.seenTgt || 0; Plan.save(); }
      { const d = (id) => Math.max(0, cnt(id) - (g.c0[id] ?? cnt(id))); const ns = g.seenBase + ids.reduce((t, id) => t + d(id), 0), nt = +(g.target || g.foe) !== +g.foe ? g.tgtBase + d(+g.target) : 0; if (ns !== g.seen || nt !== (g.seenTgt || 0)) { g.seen = ns; g.seenTgt = nt; Plan.save(); } }
      const bt = +(S().stats?.battles ?? 0); if (!g.b0) { g.b0 = bt; g.t0 = Date.now(); Plan.save(); }
      if (!g.restore) await wild.step(g); // sets up the restore first
      let ht = ''; try { ht = g.parent ? '' : huntTeam(g); } catch (e) { Log.add('hunt team: ' + (e?.message || e)); }
      // carriers + trainees replace the chapter's 6 best (passTeam); back to those when the carriers stop clearing it
      if (g.ht?.n) g.teamSet = g.ch; else if (g.htWas) g.teamSet = null;
      if (!!g.ht?.n !== !!g.htWas) { g.htWas = !!g.ht?.n; Plan.save(); }
      const line = await wild.step(g);
      // Starf: shiny x2. Nanab: rare-rarity Pokémon appear x2 as often (the game's spawn weight), so a rare target is met twice as often
      let rare = false; try { rare = E.get('Game').tierOf(+g.foe)?.key === 'rare'; } catch (__e) { __h('70-plan-05-wild-shiny:169', __e); }
      const berry = Berries.keep('shiny', `hunting a shiny ${name(g.foe)}`) + (rare ? Berries.keep('rare', `finding ${name(g.foe)} (rare) more often`) : '');
      const hrs = (Date.now() - g.t0) / 3.6e6, perH = hrs > 0.2 ? (bt - g.b0) / hrs : null;
      return `${foes.length ? (foes.some((e) => e.shiny) ? `✨ SHINY ${name(foes.find((e) => e.shiny).id)} - catching!` : `${name(foes[0].id)} found - not shiny`) : line.replace(/^[^·]*· /, '')} · ${g.seen || 0} seen${g.seenTgt ? ` (${g.seenTgt} ${name(g.target)})` : ''} (1 in ${Math.round(1 / (g.rate || 1 / 512))} each)${perH ? ` · ${Math.round(perH)} fights/h` : ''}${ht}${berry}`;
    },
    finish(g) {
      const r = g.restore;
      if (r?.autoSwitch !== undefined) { try { S().autoSwitch = r.autoSwitch; E.call('Game.save'); } catch (__e) { __h('70-plan-05-wild-shiny:176', __e); } }
      if (g.ht?.n && r?.team?.length) { const back = r.team.filter((u) => E.read('Game.getMon', null, u)); if (back.length) setChapterTeam(back); }
      g.ht = null;
      wild.finish(g);
    },
  };
  // breed it: your shiny parent + Ditto in the Day Care, hatch the eggs (1 in 16 is shiny), level it if needed
  const shinyBreed = {
    uses: 'background',
    label: (g) => Casing.names(shinyLabel(g)),
    sprite: (g) => g.foe,
    progress: (g) => (g.hatched ? { have: g.hatched, need: Math.max(g.hatched + 1, Math.round(1 / (g.rate || 0.0625))), unit: 'eggs hatched' } : null),
    check(g) {
      if (ownsShinyId(g.foe)) return { state: 'done', why: `shiny ${name(g.foe)}!${g.hatched ? ` (${g.hatched} eggs)` : ''}` };
      if (g.shinyEgg && g.steps?.length) return { state: 'wait', why: `shiny ${name(g.egg)} hatched - leveling it to ${name(g.foe)}` };
      const p = E.read('Game.getMon', null, g.parent) || (S().pension?.mons || []).map((x) => x.mon || x).find((m) => m?.uid === g.parent);
      if (!p) return { state: 'wait', why: `your shiny ${name(g.parentId)} isn't in your PC any more` };
      return { state: 'ready', why: null };
    },
    async step(g) {
      const P = S().pension || {}, inCare = (uid) => (P.mons || []).some((x) => (x.mon || x)?.uid === uid);
      // 1. hatch this hunt's ready eggs (only eggs of the hunted species with a shiny parent)
      for (const e of [...(P.eggs || [])]) {
        if (+e.id !== +g.egg || !e.sp || !E.read('Game.eggReady', false, e)) continue;
        const before = new Set((E.read('Game.ownedMons', []) || []).map((m) => m.uid));
        let r = null; try { r = E.call('Game.hatchEgg', e.uid); } catch (__e) { __h('70-plan-05-wild-shiny:201', __e); }
        if (!r) continue;
        try { E.call('Game.save'); } catch (__e) { __h('70-plan-05-wild-shiny:203', __e); } try { E.call('App.refresh'); } catch (__e) { __h('70-plan-05-wild-shiny:203', __e); }
        g.hatched = (g.hatched || 0) + 1; Plan.save();
        const baby = (E.read('Game.ownedMons', []) || []).find((m) => !before.has(m.uid) && +m.id === +g.egg);
        if (baby?.shiny) {
          Log.add(`✨ shiny ${name(g.egg)} hatched after ${g.hatched} eggs!`);
          if (g.steps?.length) { g.shinyEgg = baby.uid; Plan.save(); Plan.add('level', { uids: [baby.uid], target: Math.min(100, Math.max(...g.steps.map((x) => x.level))), forDex: null }); Log.add(`shiny hunt: leveling the shiny ${name(g.egg)} to Lv ${Math.max(...g.steps.map((x) => x.level))} so it becomes ${name(g.foe)}`); }
        } else Log.add(`shiny hunt: hatched a ${name(g.egg)} (not shiny) - ${g.hatched} so far`);
      }
      if (g.shinyEgg) return `shiny ${name(g.egg)} hatched - a leveling goal is evolving it`;
      // 2. Ditto + the shiny parent in the Day Care (only into free slots - your other Pokémon stay)
      const free = () => (S().pension?.mons || []).length < +(S().pension?.open?.slots ?? 0);
      if (!E.read('Game.pensionHasDitto', false)) {
        const ditto = here().filter((m) => +m.id === 132).sort((a, b) => b.level - a.level)[0];
        if (!ditto) return 'waiting: you need a Ditto for the Day Care';
        if (!free()) return 'waiting: the Day Care is full - make room for Ditto';
        try { E.call('Game.toPension', ditto.uid); E.call('Game.save'); } catch (__e) { __h('70-plan-05-wild-shiny:218', __e); }
        if (E.read('Game.pensionHasDitto', false)) { g.placedDitto = ditto.uid; Plan.save(); Log.add('shiny hunt: put Ditto in the Day Care'); }
        return 'putting Ditto in the Day Care…';
      }
      if (!inCare(g.parent)) {
        if (!free()) return `waiting: the Day Care is full - make room for your shiny ${name(g.parentId)}`;
        const why = Guard.team([g.parent], { need: 1, minLevel: 1 }); if (why) return 'waiting: ' + why;
        try { E.call('Game.toPension', g.parent); E.call('Game.save'); } catch (__e) { __h('70-plan-05-wild-shiny:225', __e); }
        if ((S().pension?.mons || []).some((x) => (x.mon || x)?.uid === g.parent)) { g.placed = g.parent; Plan.save(); Log.add(`shiny hunt: put your shiny ${name(g.parentId)} in the Day Care`); }
        return `putting your shiny ${name(g.parentId)} in the Day Care…`;
      }
      const sl = DexInfo.eggSlots(), mine = (P.eggs || []).filter((e) => +e.id === +g.egg && e.sp).sort((a, b) => a.hatchAt - b.hatchAt);
      return `${g.hatched || 0} eggs hatched · ${mine.length} on the way${mine.length ? ` (next hatches ${DexInfo.clock(mine[0].hatchAt)})` : ''} · 1 in ${Math.round(1 / (g.rate || 0.0625))} each${sl.used >= sl.max ? ' · incubator full - hatch other eggs to make room' : ''}`;
    },
    finish(g) {
      for (const k of ['placed', 'placedDitto']) if (g[k]) { try { E.call('Game.fromPension', g[k]); } catch (__e) { __h('70-plan-05-wild-shiny:233', __e); } g[k] = null; }
      try { E.call('Game.save'); } catch (__e) { __h('70-plan-05-wild-shiny:234', __e); } Plan.save();
    },
  };
  const wild = {
    uses: 'screen',
    label: (g) => `Catch ${name(g.foe)} (${E.get('STORY')?.CHAPTERS?.[g.ch]?.name || 'chapter ' + g.ch})`,
    sprite: (g) => g.foe,
    check(g) {
      if (g.side ? sideHas(g.foe) : E.read('Game.inDex', false, g.foe)) return { state: 'done', why: 'caught' };
      if (g.ch > +(S().adv?.unlocked ?? 0)) return { state: 'wait', why: 'that chapter is not unlocked yet' };
      const spots = wildSpots(g.foe, g.ch);
      if (!spots.length) return { state: 'wait', why: 'not found in that chapter any more' };
      if (!spots.some((x) => x.on)) { const w = [...new Set(spots.flatMap((x) => x.when || []))]; const nx = spots.map((x) => DexInfo.nextWhen(g.ch, x.name, x.when)).filter(Boolean).sort((a, b) => a.at - b.at)[0]; return { state: 'wait', why: `only appears ${w.length ? 'in ' + w.map((k) => DexInfo.whenText([k])).join(' / ') : 'at another time'} · ${DexInfo.whenLine(nx)}` }; }
      return { state: 'ready', why: null };
    },
    async step(g) {
      const s = S(), a = s.adv || {};
      if (!g.restore) { g.restore = { chapter: a.chapter, loopAdded: null, capture: a.capture ? { ...a.capture } : null }; Plan.save(); Log.add(`${wild.label(g)}: going there. Your chapter comes back when it's done.`); }
      if (a.zone) { try { E.call('Adventure.leaveZone'); } catch (__e) { __h('70-plan-05-wild-shiny:252', __e); } return 'leaving the legendary zone…'; }
      // auto-catch must be on and catching new species
      if (a.capture && (!a.capture.on || !/new|missing/.test(a.capture.target || ''))) { a.capture.on = true; a.capture.target = 'new'; try { E.call('Game.save'); } catch (__e) { __h('70-plan-05-wild-shiny:254', __e); } Log.add('turned auto-catch on ("new") so the target gets caught'); }
      if (+a.chapter !== +g.ch) { if (E.call('Adventure.setChapter', +g.ch) === false) return 'waiting: the game would not open that chapter'; return 'moving to the chapter…'; }
      if (!E.read('Adventure.isLooping', false, +g.ch)) { try { E.call('Adventure.toggleLoop', +g.ch); g.restore.loopAdded = +g.ch; Plan.save(); } catch (__e) { __h('70-plan-05-wild-shiny:256', __e); } }
      if (!g.parent) passTeam(g, g.ch); // a gym-plan catch keeps the gym team leveling instead
      // restart trick: no stop ahead can hold the target -> back to stop 0
      const nodes = a.nodes || [], at = +a.node || 0;
      const can = nodes.map((n, i) => (n.areas?.length && poolAt(n, g.ch).some((x) => x.id === +g.foe && x.on !== false) ? i : -1)).filter((i) => i >= 0);
      const lastStop = can.length ? Math.max(...can) : -1;
      const b = a.battle, vs = b && (b.enemies || []).some((e) => +e.id === +g.foe);
      if (lastStop >= 0 && at > lastStop && !vs) {
        // the game's own Restart button (Map: "Restart" on the chapter you're in) - Screens.adventure.restartChapter;
        // going to the same chapter again just carries on, so Mega used to hop out and back (Jimmy, 2026-11-17)
        const scr = E.get('Screens')?.adventure;
        if (typeof scr?.restartChapter === 'function') { try { scr.restartChapter(+g.ch); } catch (__e) { __h('70-plan-05-wild-shiny:267', __e); } }
        else {
          const unlocked = +(a.unlocked ?? 0), other = +g.ch > 0 ? +g.ch - 1 : Math.min(unlocked, +g.ch + 1);
          if (other === +g.ch || E.call('Adventure.setChapter', other) === false) return 'waiting: could not step out of the chapter to restart it';
          E.call('Adventure.setChapter', +g.ch);
        }
        const back = +(S().adv?.node ?? -1);
        g.restarts = (g.restarts || 0) + 1; Plan.save();
        if (back !== 0) Log.add(`${wild.label(g)}: restart did not go back to stop 1 (now at stop ${back + 1})`);
        return `restarted the chapter - no ${name(g.foe)} past stop ${lastStop + 1} (${g.restarts} restart${g.restarts === 1 ? '' : 's'})`;
      }
      let dexHelps = true; try { dexHelps = !E.get('Game').caughtHere(+g.foe); } catch (__e) { __h('70-plan-05-wild-shiny:278', __e); } // Enigma: x3 only for Pokémon not caught in this region (the game's spawn weight)
      const berry = (dexHelps ? Berries.keep('dex', `catching ${name(g.foe)}`) : '') + Berries.keep('capture', `catching ${name(g.foe)}`, { strongest: false });
      const pct = Math.max(0, ...wildSpots(g.foe, g.ch).filter((x) => x.on).map((x) => x.pct));
      return `${vs ? `${name(g.foe)} found - catching!` : `Stop ${at + 1} of ${nodes.length}`} · shows up at ${can.length} stop${can.length === 1 ? '' : 's'} (${Math.round(pct * 1000) / 10}% each)${g.restarts ? ` · chapter restarted ${g.restarts} time${g.restarts === 1 ? '' : 's'}` : ''}${berry}`;
    },
    finish(g) {
      const r = g.restore; if (!r) return;
      try { if (r.loopAdded != null && E.read('Adventure.isLooping', false, r.loopAdded)) E.call('Adventure.toggleLoop', r.loopAdded); } catch (__e) { __h('70-plan-05-wild-shiny:285', __e); }
      if (!S().adv?.zone && r.chapter != null && +S().adv?.chapter !== +r.chapter) { try { E.call('Adventure.setChapter', +r.chapter); } catch (__e) { __h('70-plan-05-wild-shiny:286', __e); } }
      g.restore = null; Plan.save();
    },
  };
  Object.assign(GoalTypes, { shinyWays, shinyWild, shinyBreed, ownsShinyId, wild, wildChapters });
})();

// goal module: roam - roaming Legendaries (Tornadus, Thundurus; Raikou, Entei, Suicune, Latias, Latios, Cresselia...)
// Jimmy (2026-11-19): "Tornadus is roaming but I don't see it in the plan to chase it". The old helper chased
// roamers; Mega never had it. Same approach, on the game's own Roaming module:
//  - Roaming.update() is the game's refresh of where each roamer is (it runs when you open the chapter list);
//    a roamer stays ~15 min in a chapter of its region, then moves
//  - go to that chapter with your strongest team and loop it; a roamer shows up there as a wild encounter
//  - it got away (a wipe, or a KO without the 4% catch)
//    -> restart the chapter so it can appear again
//  - it moved -> follow it. Done when the game marks it caught.
(() => {
  const { E, S, name, safe, setChapterTeam, fullTeam, autoTeam, pending } = GoalKit;
  const R = () => E.get('Roaming');
  const caught = (id) => (S().roam?.caught || []).includes(+id) || !!E.read('Game.owns', false, +id);
  const spot = (id) => { const list = safe(() => R().update(), null) || []; return list.find((r) => +r.id === +id) || (S().roam?.at?.[id] ? { id: +id, ...S().roam.at[id] } : null); };
  const groupOf = (id) => (E.get('CONFIG')?.ROAMING?.GROUPS || []).find((g) => g.ids.includes(+id));
  const chName = (ch) => safe(() => Casing.names(E.get('STORY').CHAPTERS[ch].name), 'chapter ' + ch);
  const roam = {
    uses: 'screen',
    label: (g) => `Chase ${name(g.foe)} (roaming)`,
    sprite: (g) => g.foe,
    check(g) {
      if (caught(g.foe)) return { state: 'done', why: 'caught' };
      if (!safe(() => R().free(+g.foe), false)) {
        const grp = groupOf(g.foe);
        return { state: 'wait', why: `not roaming yet - ${grp ? `unlocks when you become ${Casing.names(grp.unlock)}` : 'locked'}` };
      }
      const s = spot(g.foe);
      if (!s) return { state: 'wait', why: 'not anywhere right now - checking again shortly' };
      // a simulated team first (Jimmy: "my current team isn't sim'd for it, it keeps wiping")
      if (!Legends.sims()[g.foe]) { autoTeam(+g.foe); return { state: 'wait', why: 'finding the best team for it…' }; }
      if (pending.has(+g.foe)) return { state: 'wait', why: 'finding the best team for it…' };
      return { state: 'ready', why: null };
    },
    step(g) {
      const s = spot(g.foe); if (!s) return 'waiting for it to show up somewhere';
      const a = S().adv || {}, b = a.battle;
      if (!g.restore) { g.restore = { team: (S().team || []).slice(), chapter: a.chapter, loopAdded: null }; Plan.save(); }
      // the simulated team (Simulate > Legendary) - put back if something else changed it, never mid-fight
      const sim = Legends.sims()[g.foe], want = (sim?.uids || []).filter((u) => E.read('Game.getMon', null, u));
      const inFight0 = b && (b.enemies || []).length;
      if (want.length && !inFight0 && [...want].sort().join() !== (S().team || []).slice(0, 6).slice().sort().join()) {
        if (setChapterTeam(fullTeam(want))) Log.add(`${name(g.foe)}: hunting with the simulated team (${Math.round((sim.ko || 0) * 100)}% KO)`);
      }
      // a fight with it right now: let it play out (never touch anything mid-fight)
      const inFight = b && ((b.enemies || []).some((e) => +e.id === +g.foe) || +b.roam === +g.foe);
      if (inFight) { g.sawFight = true; g.kos0 ??= +(S().legTries?.[g.foe] ?? 0); return `fighting ${name(g.foe)} in ${chName(s.ch)}!`; }
      // the fight just ended and it's still free: it broke free - restart the chapter so it can show up again
      if (g.sawFight) {
        g.sawFight = false; g.tries = (g.tries || 0) + 1; Plan.save();
        Log.add(`${name(g.foe)} got away (fight ${g.tries} - a wipe, or a KO without the 4% catch) - restarting ${chName(s.ch)}`);
        try { E.call('Adventure.setChapter', +s.ch); } catch (__e) { __h('70-plan-06-roam:51', __e); }
      }
      // follow it: go to its chapter and keep looping there
      if (+a.chapter !== +s.ch) {
        if (E.call('Adventure.setChapter', +s.ch) === false) return `waiting: the game would not open ${chName(s.ch)}`;
        Log.add(`${name(g.foe)} is roaming in ${chName(s.ch)} - going there`);
        if (g.restore.loopAdded != null && g.restore.loopAdded !== +s.ch) { try { if (E.read('Adventure.isLooping', false, g.restore.loopAdded)) E.call('Adventure.toggleLoop', g.restore.loopAdded); } catch (__e) { __h('70-plan-06-roam:57', __e); } g.restore.loopAdded = null; }
      }
      if (!E.read('Adventure.isLooping', false, +s.ch)) { try { E.call('Adventure.toggleLoop', +s.ch); g.restore.loopAdded = +s.ch; Plan.save(); } catch (__e) { __h('70-plan-06-roam:59', __e); } }
      // a Rowap Berry doubles how long it stays in this chapter (the game's Roaming.boost: each roamer's current
      // stay, once per stay) - kept going while Mega hunts it here
      const berry = +a.chapter === +s.ch ? Berries.keep('roam', `keeping ${name(g.foe)} in ${chName(s.ch)} longer`) : '';
      const s2 = spot(g.foe) || s, mins = Math.max(0, Math.round((+s2.until - Date.now()) / 60000));
      const simKo = Legends.sims()[g.foe]?.ko;
      return `hunting ${name(g.foe)} in ${chName(s.ch)}${berry} - it moves in ~${mins} min${simKo != null ? ` · team KOs it ${Math.round(simKo * 100)}% in the simulator` : ''}${g.tries ? ` · fought ${g.tries}x` : ''} · 4% catch per KO`;
    },
    // put back your team, the loop setting and the chapter you were in
    finish(g) {
      const r = g.restore; if (!r) return;
      try { if (r.loopAdded != null && E.read('Adventure.isLooping', false, r.loopAdded)) E.call('Adventure.toggleLoop', r.loopAdded); } catch (__e) { __h('70-plan-06-roam:70', __e); }
      const back = (r.team || []).filter((u) => E.read('Game.getMon', null, u));
      if (back.length) try { setChapterTeam(back); } catch (__e) { __h('70-plan-06-roam:72', __e); }
      if (!S().adv?.zone && r.chapter != null && +S().adv?.chapter !== +r.chapter) { try { E.call('Adventure.setChapter', +r.chapter); } catch (__e) { __h('70-plan-06-roam:73', __e); } }
      g.restore = null; g.teamSet = false; Plan.save();
    },
  };
  Object.assign(GoalTypes, { roam });
})();

// goal module: special (takes shared helpers from GoalKit, registers itself in GoalTypes)
(() => {
  const { E, S, name, bossTeam, goChapter, rebuild, putBack } = GoalKit;
  // ---- special encounter: rebuild the chapter until the stop appears (right time + weather + roll) ----
  const special = {
    uses: 'screen',
    label: (g) => `Find ${name(g.foe)} (${g.place || 'special encounter'})`,
    sprite: (g) => g.foe,
    check(g) {
      if (E.read('Game.inDex', false, g.foe)) return { state: 'done', why: 'caught' };
      const sp = DexInfo.special(g.foe).find((x) => x.ch === +g.ch) || DexInfo.special(g.foe)[0];
      if (!sp) return { state: 'wait', why: 'no special encounter for it in the game data' };
      if (sp.blockers.length) return { state: 'wait', why: 'needs ' + sp.blockers.join(' · ') };
      if (!sp.window?.now) return { state: 'wait', why: `${DexInfo.conditionText(sp)} at ${sp.place} · ${DexInfo.windowText(sp)}` };
      return { state: 'ready', why: null };
    },
    async step(g) {
      const w = goChapter(g, g.ch, special.label(g)); if (w) return w;
      bossTeam(g, g.ch, g.foe);
      const a = S().adv || {}, nodes = a.nodes || [], at = +a.node || 0;
      const idx = nodes.findIndex((n, i) => n.type === 'static' && +n.id === +g.foe && i >= at);
      const b = a.battle, vs = b && (b.enemies || []).some((e) => +e.id === +g.foe);
      if (vs) return `${name(g.foe)} appeared - catching!${Berries.keep('capture', `catching ${name(g.foe)}`)}`;
      if (idx >= 0) { const berry = Berries.keep('capture', `catching ${name(g.foe)}`); return `it's in this run at stop ${idx + 1} - now at stop ${at + 1}/${nodes.length}${g.rebuilds ? ` · took ${g.rebuilds} rebuild${g.rebuilds === 1 ? '' : 's'}` : ''}${berry}`; }
      if (Date.now() - (g.lastRebuild || 0) < 2500) return 'rebuilding the chapter…';
      g.lastRebuild = Date.now();
      if (!rebuild(g.ch)) return 'waiting for the fight to end to restart the chapter';
      g.rebuilds = (g.rebuilds || 0) + 1; Plan.save();
      const sp = DexInfo.special(g.foe).find((x) => x.ch === +g.ch);
      return `rebuilding the chapter until it shows up (${g.rebuilds} tries · ${sp ? DexInfo.pct(sp.chance) : '?'} each)`;
    },
    finish: (g) => putBack(g),
  };
  Object.assign(GoalTypes, { special });
})();

// goal module: souls (takes shared helpers from GoalKit, registers itself in GoalTypes)
(() => {
  const { E, S, name, here, poolAt, goChapter, rebuild, putBack } = GoalKit;
  // ---- farm an item that drops from a type (Spiritomb's souls: Ghost types in Sinnoh, 10% each) ----
  function soulChapter(cfg) {
    const ST = E.get('STORY'), unlocked = +(S().adv?.unlocked ?? 0), D = E.get('Game.DEX') || {};
    let best = null;
    for (let ch = 0; ch <= unlocked && ch < (ST?.CHAPTERS?.length || 0); ch++) {
      if (cfg.region && (() => { try { return ST.regionOf(ch)?.key; } catch { return null; } })() !== cfg.region) continue;
      let tot = 0, hit = 0, fights = 0, cut = null;
      const steps = ST.CHAPTERS[ch].steps || [];
      steps.forEach((st, i) => {
        if (st.kind === 'route') fights += (st.wild || 0) + (st.trainers || 0); else if (/gym|trainer|elite|league/.test(st.kind || '')) fights++;
        if (st.kind !== 'route' || !st.areas?.length) return;
        const pool = poolAt(st, ch).filter((x) => x.on !== false), w = pool.reduce((t, x) => t + (x.pct || 0), 0) || 1;
        let here = 0;
        for (const x of pool) { const share = (x.pct || 0) / w * (st.wild || 1); tot += share; if ((D[x.id]?.types || []).includes(cfg.type)) { hit += share; here += share; } }
        // restart right after this stop? (the game's Restart costs about one fight of time)
        if (here > 0) { const sc = hit / (fights + 1); if (!cut || sc > cut.score) cut = { stop: i, score: sc, share: hit / tot }; }
      });
      if (!hit) continue;
      const whole = hit / Math.max(1, fights); // ghost fights per fight = per minute of farming
      // playing to the end vs restarting after the last good stop (Cobble Badge: 9.6% -> 21.6%, Jimmy 2026-11-17)
      const useCut = cut && cut.score > whole * 1.05 && cut.stop < steps.length - 1;
      const score = useCut ? cut.score : whole;
      if (!best || score > best.score) best = { ch, score, share: hit / tot, cut: useCut ? cut.stop : null, name: ST.CHAPTERS[ch]?.name || 'chapter ' + ch };
    }
    return best;
  }
  // ---- an item that drops at one chapter stop (Axew's Broken Tusks: Mistralton Cave in the Jet Badge chapter, 5% at
  // each item find - only 'item' stops roll it, not fights. A run whose cave has no item find left is restarted at once. Jimmy 2026-11-19 - Mega was hunting Ghost types for it). The game marks those stops loot: { item: {...} }.
  function lootChapter(item) {
    const ST = E.get('STORY'), unlocked = +(S().adv?.unlocked ?? 0);
    let best = null;
    for (let ch = 0; ch <= unlocked && ch < (ST?.CHAPTERS?.length || 0); ch++) {
      const steps = ST.CHAPTERS[ch].steps || [];
      steps.forEach((st, i) => {
        const L = st.loot?.[item]; if (!L) return;
        const p = +L.p || 0;
        if (!best || p > best.score) best = { ch, score: p, share: p, cut: i < steps.length - 1 ? i : null, stop: st.name || null, loot: true, name: ST.CHAPTERS[ch]?.name || 'chapter ' + ch };
      });
    }
    return best;
  }
  const isLoot = (g) => !!lootChapter(g.item);
  const iname = (g) => { try { return DexInfo.itemName(g.item); } catch { return g.item; } };
  const plural = (g) => { const n = iname(g); return /s$/.test(n) ? n : n + 's'; };
  // the item belongs to the region it's farmed in (Spiritomb's souls: Sinnoh) - count that region's bag,
  // even while you're on Unova's side (the game keeps the other bag in its stash)
  const soulHave = (g) => DexInfo.itemFor(g.item, g.pick?.ch ?? g.ch ?? (() => { try { return DexInfo.special(g.forDex)[0]?.ch; } catch { return null; } })());
  const souls = {
    uses: 'screen',
    progress: (g) => ({ have: Math.min(g.need, soulHave(g)), need: g.need, unit: plural(g) }),
    label: (g) => `Collect ${g.need} ${plural(g)}${g.forDex ? ` (for ${name(g.forDex)})` : ''}`,
    sprite: (g) => g.forDex || null,
    check(g) {
      const have = soulHave(g);
      if (have >= g.need) return { state: 'done', why: `${have}/${g.need}` };
      const cfg = E.get('CONFIG')?.SOULS || {};
      if (isLoot(g)) return { state: 'ready', why: null };
      if (!soulChapter(cfg)) return { state: 'wait', why: `no ${cfg.type || ''} Pokémon in reach right now (time of day / weather)` };
      return { state: 'ready', why: null };
    },
    async step(g) {
      const cfg = E.get('CONFIG')?.SOULS || {};
      // re-pick every 10 minutes: Ghost types depend on the time of day
      const loot = lootChapter(g.item);
      if (!g.pick || !!g.pick.loot !== !!loot || Date.now() - (g.pickAt || 0) > 600_000) { const old = g.pick; g.pick = loot || soulChapter(cfg); g.pickAt = Date.now(); Plan.save(); if (g.pick && (old?.ch !== g.pick.ch || old?.cut !== g.pick.cut)) Log.add(g.pick.loot ? `${souls.label(g)}: farming in ${g.pick.name}${g.pick.stop ? `, restarting after ${g.pick.stop}` : ''} (${Math.round(g.pick.score * 100)}% at each item find)` : `${souls.label(g)}: farming in ${g.pick.name}${g.pick.cut != null ? `, restarting after stop ${g.pick.cut + 1}` : ''} (${Math.round(g.pick.score * 100)}% of fights are ${(cfg.type || '').toLowerCase()})`); }
      if (!g.pick) return 'no chapter with them right now';
      const w = goChapter(g, g.pick.ch, souls.label(g)); if (w) return w;
      // past the last stop with ghosts: restart the chapter (the game's own Restart) instead of playing it out
      // (the run's own stops: a run can have more stops than the chapter map)
      const a = S().adv || {}, at = +a.node || 0, inFight = !!a.battle, nodes = a.nodes || [], D0 = E.get('Game.DEX') || {};
      const ghostAt = g.pick.loot ? (() => { return nodes.map((n, i) => (n?.type === 'item' && n?.loot?.[g.item] ? i : -1)).filter((i) => i >= 0); })() : nodes.map((n, i) => (n?.areas?.length && poolAt(n, g.pick.ch).some((x) => x.on !== false && (D0[x.id]?.types || []).includes(cfg.type)) ? i : -1)).filter((i) => i >= 0);
      const last = ghostAt.length ? Math.max(...ghostAt) : -1;
      if ((g.pick.loot ? nodes.length > 0 : g.pick.cut != null && last >= 0) && at > last && !inFight && !a.event && !a.zone) {
        if (rebuild(g.pick.ch)) { g.restarts = (g.restarts || 0) + 1; Plan.save(); return g.pick.loot ? `restarted ${g.pick.name} - ${last < 0 ? `no item find in ${g.pick.stop || 'the cave'} this time` : `no more item finds with ${plural(g)} after stop ${last + 1}`} (${g.restarts} restarts)` : `restarted ${g.pick.name} - no ${cfg.type || ''} Pokémon after stop ${last + 1} (${g.restarts} restarts)`; }
      }
      const have = soulHave(g);
      if (g.startHave == null) { g.startHave = have; g.startAt = Date.now(); Plan.save(); }
      const got = have - g.startHave, hrs = (Date.now() - g.startAt) / 3_600_000, rate = hrs > 0.05 ? got / hrs : null;
      return `${have}/${g.need} ${plural(g)} · ${g.pick.name}${g.pick.cut != null ? ` stops 1-${g.pick.cut + 1}` : ''} (${g.pick.loot ? `${Math.round(g.pick.score * 100)}% at each item find${g.pick.stop ? ` in ${g.pick.stop}` : ''}` : `${Math.round(g.pick.score * 100)}% of fights ${cfg.type}`})${rate ? ` · ~${Math.round(rate)}/h, about ${Math.ceil((g.need - have) / Math.max(0.1, rate))} h to go` : ''}`;
    },
    finish: (g) => putBack(g),
  };
  Object.assign(GoalTypes, { souls });
})();

// goal module: loot (takes shared helpers from GoalKit, registers itself in GoalTypes)
(() => {
  const { E, S, name, goChapter, rebuild, putBack } = GoalKit;
  // ---- rare item hunt: rebuild the chapter until its item stop is there, pass it, repeat ----------------
  // An item stop exists in a chapter run 70% of the time (CONFIG.ITEM_EVENT_CHANCE, rolled when the
  // chapter is built); the rare drop is then rolled when you reach it.
  const lootWatch = new Map(); // goal id -> { run (the chapter's stop list), idx } - kept in memory only
  const loot = {
    uses: 'screen',
    label: (g) => `Find ${g.need > 1 ? g.need + ' × ' : 'the '}${DexInfo.itemName(g.item)} (${g.place})`,
    sprite: (g) => (g.item.startsWith('egg:') ? +g.item.slice(4) : null),
    check(g) {
      const got = S().adv?.gifts?.[g.item] || (g.item.startsWith('egg:') ? DexInfo.eggs(+g.item.slice(4)).length || E.read('Game.inDex', false, +g.item.slice(4)) : (+E.read('Game.itemCount', 0, g.item) || 0) >= (g.need || 1));
      if (got) return { state: 'done', why: 'found!' };
      const L = DexInfo.loot(g.item).find((x) => x.ch === +g.ch) || DexInfo.loot(g.item)[0];
      if (!L) return { state: 'wait', why: 'not in the game data' };
      if (L.blockers.length) return { state: 'wait', why: 'needs ' + L.blockers.join(' · ') };
      if (g.item.startsWith('egg:')) {
        const sl = DexInfo.eggSlots();
        const readyEgg = (S().pension?.eggs || []).some((e) => E.read('Game.eggReady', false, e));
        if (sl.used >= sl.max && !readyEgg) return { state: 'wait', why: `the Day Care's egg slots are full (${sl.used}/${sl.max}) - the egg needs a free one; the next egg is ready ${DexInfo.clock(sl.next)} and Mega hatches it then` };
      }
      // the weather at that very stop (its own climate, not just its name - 2026-11-21) and when it comes next
      if (L.skies) { const nx = DexInfo.nextWhen(L.ch, L.place, L.skies); if (!nx?.now) return { state: 'wait', why: `only in ${DexInfo.whenText(L.skies)} at ${L.place} · ${DexInfo.whenLine(nx)}` }; }
      return { state: 'ready', why: null };
    },
    async step(g) {
      // the egg needs a free Day Care egg slot: hatch a ready egg to make room
      if (g.item.startsWith('egg:')) {
        const sl = DexInfo.eggSlots();
        if (sl.used >= sl.max) {
          const e = (S().pension?.eggs || []).find((x) => E.read('Game.eggReady', false, x));
          if (e) { let r = null; try { r = E.call('Game.hatchEgg', e.uid); } catch (__e) { __h('70-plan-09-loot:33', __e); } if (r) { try { E.call('Game.save'); } catch (__e) { __h('70-plan-09-loot:33', __e); } Log.add(`hatched a ${name(e.id)} egg to free a Day Care egg slot for the ${DexInfo.itemName(g.item)}`); } }
          return 'making room in the Day Care…';
        }
      }
      const w = goChapter(g, g.ch, loot.label(g)); if (w) return w;
      const a = S().adv || {}, nodes = a.nodes || [], at = +a.node || 0;
      const isStop = (n) => n.type === 'item' && !n.find && n.name === g.place;
      // count each item stop we get past (that's one roll); a run is told apart by its stop list
      let w8 = lootWatch.get(g.id);
      if (!w8 || w8.run !== a.nodes) { w8 = { run: a.nodes, stop: nodes.findIndex(isStop), counted: false }; lootWatch.set(g.id, w8); }
      if (w8.stop >= 0 && at > w8.stop && !w8.counted) { w8.counted = true; g.visits = (g.visits || 0) + 1; Plan.save(); }
      const idx = nodes.findIndex((n, i) => isStop(n) && i >= at);
      if (idx >= 0) { return `item stop in this run at stop ${idx + 1} - now at ${at + 1}/${nodes.length} · ${g.visits || 0} stop${g.visits === 1 ? '' : 's'} checked so far (${DexInfo.pct((DexInfo.loot(g.item).find((x) => x.ch === +g.ch) || {}).chance || 0)} each)${g.need > 1 ? ` · have ${+E.read('Game.itemCount', 0, g.item) || 0}/${g.need}` : ''}`; }
      if (Date.now() - (g.lastRebuild || 0) < 2500) return 'rebuilding the chapter…';
      g.lastRebuild = Date.now();
      if (!rebuild(g.ch)) return 'waiting for the fight to end to restart the chapter';
      g.rebuilds = (g.rebuilds || 0) + 1; Plan.save();
      return `no item stop at ${g.place} in this run - rebuilding (${g.visits || 0} checked so far)`;
    },
    finish: (g) => putBack(g),
  };
  Object.assign(GoalTypes, { loot });
})();

// goal module: breed (takes shared helpers from GoalKit, registers itself in GoalTypes)
(() => {
  const { E, S, name, here } = GoalKit;
  // ---- breeding (Phione from Manaphy): the parent goes in the Day Care next to Ditto -------------------
  const breed = {
    uses: 'background',
    label: (g) => `Breed ${name(g.foe)} from ${name(g.from)}`,
    sprite: (g) => g.foe,
    check(g) {
      if (E.read('Game.inDex', false, g.foe)) return { state: 'done', why: 'registered' };
      if (DexInfo.eggs(g.foe).length) return { state: 'wait', why: `egg on the way - hatches ${DexInfo.clock(DexInfo.eggs(g.foe)[0].hatchAt)} (Mega hatches it)` };
      if (!E.read('Game.owns', false, g.from)) return { state: 'wait', why: `get ${name(g.from)} first` };
      return { state: 'ready', why: null };
    },
    async step(g) {
      const P = S().pension || {};
      const inCare = (P.mons || []).some((x) => +(x.mon || x)?.id === +g.from);
      if (!E.read('Game.pensionHasDitto', false)) return `waiting: put Ditto in the Day Care (it's needed to breed ${name(g.from)})`;
      if (inCare) { const sl = DexInfo.eggSlots(); return sl.used >= sl.max ? `${name(g.from)} is in the Day Care - waiting for a free egg slot (${sl.used}/${sl.max})` : `${name(g.from)} is in the Day Care with Ditto - waiting for an egg`; }
      const free = (P.mons || []).length < +(P.open?.slots ?? 0);
      const mon = here().filter((m) => +m.id === +g.from).sort((a, b) => b.level - a.level)[0];
      if (!free) return `waiting: the Day Care is full - make room for ${name(g.from)} next to Ditto`;
      if (mon) { try { E.call('Game.toPension', mon.uid); } catch (__e) { __h('70-plan-10-breed:23', __e); } try { E.call('Game.save'); } catch (__e) { __h('70-plan-10-breed:23', __e); } if ((S().pension?.mons || []).some((x) => (x.mon || x)?.uid === mon.uid)) { g.placed = mon.uid; Plan.save(); Log.add(`put ${name(g.from)} in the Day Care to breed ${name(g.foe)}`); } }
      return `putting ${name(g.from)} in the Day Care…`;
    },
    finish(g) { if (g.placed) { try { E.call('Game.fromPension', g.placed); } catch (__e) { __h('70-plan-10-breed:26', __e); } try { E.call('Game.save'); } catch (__e) { __h('70-plan-10-breed:26', __e); } Log.add(`took ${name(g.from)} back from the Day Care`); g.placed = null; Plan.save(); } },
  };

  // hatch ready Day Care eggs of species you're missing (eggs of things you have are left alone)
  Object.assign(GoalTypes, { breed });
})();

// goal module: candy (takes shared helpers from GoalKit, registers itself in GoalTypes)
(() => {
  const { E, S, name, here, bst, want } = GoalKit;
  // ---- Candy Factory: one run a day, of the day's type ----------------------------------------------
  // CandyRun.why(): 'running' | 'played' | 'day' (closed today) | 'team' | 'locked' | null (ready).
  // The day's type comes from the game's server (CandyRun.loadDay, what opening the Factory does).
  const CR = () => E.get('CandyRun');
  function candyPool(from) {
    const out = new Map();
    for (let f = from; f < from + 40; f += 4) {
      // the trainers on each floor (the game moved this to floorOf().team = [[id, level], ...];
      // poolOf is now empty, which made Mega skip picking a team and start with a leftover one)
      let p = []; try { p = (CR().floorOf(f)?.team || []).map((x) => (Array.isArray(x) ? { id: x[0], lv: x[1] } : x)); } catch (__e) { __h('70-plan-11-candy:13', __e); }
      if (!p.length) { try { p = CR().poolOf(f) || []; } catch (__e) { __h('70-plan-11-candy:14', __e); } }
      const lv = +(p[0]?.lv) || +(() => { try { return CR().levelOf(f); } catch { return 0; } })() || 80;
      for (const x of p) { const id = +(x?.id ?? x); if (!id) continue; const o = out.get(id) || { id, lv, w: 0 }; o.w += 1; o.lv = Math.max(o.lv, lv); out.set(id, o); }
    }
    const all = [...out.values()], W = all.reduce((t, x) => t + x.w, 0) || 1;
    return all.map((x) => ({ ...x, w: x.w / W }));
  }
  // How far a team gets in today's Candy Factory: floor by floor with the game's real trainers and
  // levels (floorOf), HP carried over (a camp every CONFIG.CAMP floors heals the ones still up), each
  // foe taken by the member it costs the least HP to beat (damage model of Sim.clearScore, foe
  // strength x the floor's statMult and rank). Used to compare teams, not as an exact floor.
  function candyDepth(team, from, max = 140) {
    const C = E.get('CONFIG')?.CANDY_RUN || {}, camp = +C.CAMP || 0, cache = candyDepth.cache || (candyDepth.cache = new Map());
    const cost = (m, id, lv, mult) => {
      const k = `${m.uid}|${id}|${lv}|${mult.toFixed(2)}`; let v = cache.get(k);
      if (v == null) { const r = Sim.clearScore(m, [{ id, lv, w: 1 }]); v = r.kill > 0.04 ? Math.min(1.5, r.hurt * mult * mult + 0.0001) : Infinity; cache.set(k, v); }
      return v;
    };
    const hp = team.map(() => 1);
    let floors = 0;
    for (let f = from; f < from + max; f++) {
      let fl = null; try { fl = CR().floorOf(f); } catch (__e) { __h('70-plan-11-candy:35', __e); }
      const foes = (fl?.team || []).map((x) => (Array.isArray(x) ? { id: +x[0], lv: +x[1] } : { id: +x.id, lv: +x.lv || +x.level }));
      if (!foes.length) break;
      const mult = (+fl.statMult || 1) * (1 + 0.05 * (+fl.rank || 0));
      for (const foe of foes) {
        let bi = -1, bc = Infinity;
        for (let i = 0; i < team.length; i++) { if (hp[i] <= 0) continue; const c0 = cost(team[i], foe.id, foe.lv, mult); if (c0 < bc) { bc = c0; bi = i; } }
        if (bi < 0 || !isFinite(bc)) return floors + 0.5; // nobody can beat this one
        hp[bi] -= bc;
        if (hp.every((x) => x <= 0)) return floors + 0.5;
      }
      floors++;
      if (camp && f % camp === 0) for (let i = 0; i < hp.length; i++) if (hp[i] > 0) hp[i] = 1;
    }
    return floors;
  }
  // the six that get furthest: start from the best single scorers, then swap one at a time while it helps
  async function candyTeam(cands, from, size) {
    const yieldNow = () => new Promise((ok) => setTimeout(ok, 0));
    const pool = cands.slice(0, 16).map((x) => x.m);
    let team = pool.slice(0, size), best = candyDepth(team, from), tries = 1;
    for (let round = 0; round < 3; round++) {
      let improved = false;
      for (let slot = 0; slot < team.length; slot++) {
        for (const c of pool) {
          if (team.includes(c) || team.some((t, i) => i !== slot && Sim.species(t) === Sim.species(c))) continue;
          const trial = team.slice(); trial[slot] = c; const d = candyDepth(trial, from); tries++;
          if (d > best) { best = d; team = trial; improved = true; }
        }
        await yieldNow();
      }
      if (!improved) break;
    }
    return { uids: team.map((m) => m.uid), floors: best, tries };
  }
  const candy = {
    uses: 'screen', daily: true,
    label: () => 'Candy Factory (every day)',
    sprite: () => null,
    check(g) {
      const c = CR(); if (!c || !E.read('CandyRun.unlocked', false)) return { state: 'wait', why: 'the Candy Factory is not open yet' };
      const why = (() => { try { return c.why(); } catch { return null; } })();
      if (why === 'running') return { state: 'ready', why: null };
      if (why === 'played' && g && (() => { try { return c.last()?.day; } catch { return null; } })() && g.told !== c.last().day) { const l = c.last(); g.told = l.day; Plan.save(); Notify.send('daily', `Candy Factory: floor ${l.floor}`, `Today's ${l.type} run is done${(() => { try { return c.best() ? ` · best ever floor ${c.best()}` : ''; } catch { return ''; } })()}`); }
      if (why === 'played') { const nd = (() => { try { return +E.get('Raids').nextDay(); } catch { return 0; } })(); return { state: 'wait', why: `done today${(() => { try { const l = c.last(); return l ? ` (${Casing.title(String(l.type))} day, floor ${l.floor})` : ''; } catch { return ''; } })()} · next run ${nd ? DexInfo.clock(nd) : 'after the daily reset'}` }; }
      if (why === 'day') return { state: 'wait', why: 'closed today' };
      if (why === 'locked') return { state: 'wait', why: 'locked' };
      return { state: 'ready', why: null };
    },
    async step(g) {
      const c = CR(), why = (() => { try { return c.why(); } catch { return null; } })();
      if (why === 'running') {
        const r = c.run();
        if (S().adv?.tower?.kind !== 'candy') {
          if (Date.now() - (g.resumeAt || 0) < 60_000) return 'waiting before putting the run back on screen…';
          g.resumeAt = Date.now();
          try { E.call('Adventure.startTower', false, 'candy'); E.call('App.refresh'); } catch (__e) { __h('70-plan-11-candy:91', __e); } Log.add('Candy Factory: put the paused run back on screen'); return 'putting the run back on screen…';
        }
        return `run in progress · ${r?.type || ''} · floor ${r?.floor ?? '?'}`;
      }
      if (!c.today()) { try { await c.loadDay(); } catch (__e) { __h('70-plan-11-candy:95', __e); } if (!c.today()) return 'reading today\'s type…'; }
      const day = c.today(), from = Math.max(...((() => { try { return c.starts(); } catch { return [1]; } })() || [1]));
      // team: the best clearers against the day's Pokémon (same damage math as the training carriers)
      const pool = candyPool(from);
      if (!pool.length) Log.add('Candy Factory: could not read the floors - picking the strongest Pokémon instead');
      let candyWant = null, candyNeed = +(E.get('CONFIG')?.CANDY_RUN?.TEAM) || 6;
      {
        const ok = (m) => { try { return c.allowed(m); } catch { return true; } };
        const cands = here().filter((m) => m.level >= 50 && ok(m));
        const seen = new Set(), ranked = [];
        for (const m of cands.sort((a, b) => b.level - a.level)) { const k = Sim.species(m); if (seen.has(k)) continue; seen.add(k); ranked.push({ m, ...(pool.length ? Sim.clearScore(m, pool) : { score: m.level * 1000 + bst(m.id) }) }); }
        ranked.sort((a, b) => b.score - a.score);
        const size = +(E.get('CONFIG')?.CANDY_RUN?.TEAM) || 6;
        let uids = ranked.slice(0, size).map((x) => x.m.uid), est = null;
        if (pool.length && ranked.length > size) { try { const t = await candyTeam(ranked, from, size); uids = t.uids; est = t; } catch (e) { Log.add('Candy Factory: run estimate failed (' + (e?.message || e) + ') - using the best single scores'); } }
        candyWant = uids; candyNeed = Math.min(size, ranked.length);
        if (est) Log.add(`Candy Factory: tested ${est.tries} teams floor by floor - best gets to about floor ${from + Math.floor(est.floors)}`);
        const s0 = S(); s0.eventTeams = s0.eventTeams || {}; const old = (s0.eventTeams[c.TEAM_KEY || 'candy'] || []).join(',');
        if (uids.length && old !== uids.join(',')) { s0.eventTeams[c.TEAM_KEY || 'candy'] = uids; try { E.call('Game.save'); } catch (__e) { __h('70-plan-11-candy:113', __e); } Log.add(`Candy Factory (${day.type}): team ${uids.map((u) => name(E.read('Game.getMon', {}, u)?.id)).join(', ')}`); }
      }
      // safety: the team the game will really use (read back) must be the full team Mega picked
      { const key = c.TEAM_KEY || 'candy';
        let game = null; try { game = (c.picked() || []).map((m) => m?.uid ?? m); } catch (__e) { __h('70-plan-11-candy:117', __e); }
        if (!game || !game.length) game = S().eventTeams?.[key] || [];
        const why = candyNeed < 1 ? 'no Pokémon are allowed today' : Guard.team(game, { need: candyNeed, want: candyWant, minLevel: 50 });
        if (why) return Guard.stop('the Candy Factory', why); }
      let r = null; try { r = E.call('Adventure.startTower', false, 'candy', from); } catch (e) { Log.add('Candy Factory: the game refused to start (' + (e?.message || e) + ')'); }
      try { E.call('App.refresh'); } catch (__e) { __h('70-plan-11-candy:122', __e); }
      if (r && c.run()) { Log.add(`Candy Factory: started today's ${day.type} run from floor ${from}`); return `started today's ${day.type} run`; }
      return 'could not start the run - ' + (((() => { try { return c.why(); } catch { return null; } })()) || 'see the log');
    },
  };
  Object.assign(GoalTypes, { candy });
})();

// goal module: tower (takes shared helpers from GoalKit, registers itself in GoalTypes)
(() => {
  const { E, S } = GoalKit;
  // ---- Battle Tower: one run a week (the game picks the lineup from all your Pokémon) -----------------
  const TW = () => E.get('Tower');
  const tower = {
    uses: 'screen', daily: true,
    label: () => 'Battle Tower (every week)',
    sprite: () => null,
    check(g) {
      const t = TW(); if (!t || !E.read('Tower.unlocked', false)) return { state: 'wait', why: 'the Battle Tower is not open yet' };
      if (S().adv?.tower?.kind === 'tower' || (() => { try { return !!t.run(); } catch { return false; } })()) return { state: 'ready', why: null };
      const best = S().tower?.best, wk = (() => { try { return t.weekKey(); } catch { return null; } })();
      if (best && wk && best.week === wk && g && g.told !== wk) { g.told = wk; Plan.save(); Notify.send('daily', `Battle Tower: floor ${best.floor}`, `This week's run is done · best ever floor ${S().tower?.top ?? best.floor}`); }
      if (best && wk && best.week === wk) return { state: 'wait', why: `done this week: floor ${best.floor} (best ever ${S().tower?.top ?? best.floor}) · resets ${DexInfo.clock(+t.weekEnds())}` };
      return { state: 'ready', why: null };
    },
    async step(g) {
      const t = TW(), run = (() => { try { return t.run(); } catch { return null; } })();
      const standing = (() => { try { return +t.left(); } catch { return null; } })();
      if (run && S().adv?.tower?.kind === 'tower') return `run in progress · floor ${run.floor} · ${standing ?? '?'} Pokémon still standing`;
      // the run is over (nobody standing): the game wraps it up itself (recap) - leave it alone
      if (run && standing === 0) return `run over at floor ${run.floor} - the game is wrapping it up`;
      // a run paused off screen: resume it, but never more than once a minute
      if (run && Date.now() - (g.resumeAt || 0) < 60_000) return 'waiting before resuming the run…';
      if (run) g.resumeAt = Date.now();
      let ok = false; try { ok = E.call('Adventure.startTower', false, 'tower'); } catch (e) { Log.add('Battle Tower: the game refused to start (' + (e?.message || e) + ')'); }
      try { E.call('App.refresh'); } catch (__e) { __h('70-plan-12-tower:28', __e); }
      if (ok && S().adv?.tower) { Log.add(run ? 'Battle Tower: resumed this week\'s run' : 'Battle Tower: started this week\'s run'); return run ? 'resumed the run' : 'started this week\'s run'; }
      return 'could not start the Tower - see the log';
    },
  };
  Object.assign(GoalTypes, { tower });
})();

// goal module: raid, raidRepick (takes shared helpers from GoalKit, registers itself in GoalTypes)
(() => {
  const { E, S, name, awayNow, here, power, RD, bst, ownsShiny, want } = GoalKit;
  // ---- Shiny Raid: today's drawn region, best 2 of yours + best ally trainers, one smart reroll -------
  // The draw (which region's raid you get) comes from the game's server (Raids.sync). Raids.lane()
  // lists every region's boss of the day, so a reroll (random other region, once a day, right after
  // the draw) is only used when it can only help.
  let raidSyncAt = 0;
  // The raid boss, as the game builds it: CONFIG.RAID.BOSS scales HP and power by base stats
  // (HP x (BST_REF / bst)^HP_EXP, power x (BST_REF / bst)^POWER_EXP, x a per-species ADJ). Checked
  // against a live raid node (Nidoran F: 9.68 / 1.27). When the raid is running, its node is exact.
  function raidZone(boss) {
    const node = (S().adv?.nodes || []).find((n) => n?.raid && +n.id === +boss && n.hpPower);
    let hp, power;
    if (node) { hp = +node.hpPower; power = +node.power; }
    else {
      const B = E.get('CONFIG')?.RAID?.BOSS || {}, bs = bst(boss) || 500, adj = +(B.ADJ?.[boss] ?? 1);
      hp = (+B.HP || 3.3) * Math.pow((+B.BST_REF || 500) / bs, +B.HP_EXP || 1.8) * adj;
      power = (+B.POWER || 0.7) * Math.pow((+B.BST_REF || 500) / bs, +B.POWER_EXP || 1) * adj;
    }
    return { id: +boss, foe: +boss, hp, power, weather: null, burst: null, counter: null, level: +(E.get('CONFIG')?.RAID?.LEVEL) || 100, static: true, raid: true };
  }
  // Pick the raid team by simulating fights (the old pick rated Pokémon by how fast they one-shot
  // route Pokémon - meaningless against a boss with ~30,000 HP):
  //  1. every Pokémon you have (Lv 90+, best copy of each species, not in the Underground or busy
  //     elsewhere) next to your strongest one, with two default allies
  //  2. every pair among the top 10   3. every pair of today's ally trainers with the best pair
  async function raidPick(reg, boss, C) {
    // nothing else runs during a raid (it takes the screen), so only the Underground keeps a Pokémon out
    const zone = raidZone(boss), r = RD(), busy = new Set();
    const yieldNow = () => new Promise((ok) => setTimeout(ok, 0));
    const ev = (team, runs) => { try { return Sim.evaluate(team, +boss, runs, 7, null, zone); } catch { return { ko: 0, dealt: 0 }; } };
    const bstOf = (m) => bst(m.id);
    let pool = here().filter((m) => m.level >= 90 && !busy.has(m.uid));
    if (pool.length < 2) pool = here().filter((m) => m.level >= 70 && !busy.has(m.uid));
    const seen = new Set(), cands = [];
    for (const m of pool.sort((a, b) => b.level - a.level || (b.rank || 0) - (a.rank || 0))) { const k = Sim.species(m); if (seen.has(k)) continue; seen.add(k); cands.push(m); }
    const mult = +C.BOT_STATS || 0.9;
    const bots = (() => { try { return r.bots(reg) || []; } catch { return []; } })().filter((b) => (b.mons || []).length);
    const botMons = (b, i) => (b.mons || []).map((x, k) => ({ ...x, uid: `sim-${i}-${k}`, bot: true, statMult: x.statMult ?? mult }));
    const allyN = +C.ALLIES || 2;
    const byPower = bots.map((b, i) => ({ b, i, v: (b.mons || []).reduce((t, x) => t + bst(x.id), 0) })).sort((a, b) => b.v - a.v);
    let allies = byPower.slice(0, allyN), allyTeam = allies.flatMap((x) => botMons(x.b, x.i));
    let tested = 0;
    if (cands.length < 2) return { mine: cands.map((m) => m.uid), allies: allies.map((x) => x.b.key), allyNames: allies.map((x) => x.b.name), ko: 0, tested };
    // 1. singles next to the strongest
    const anchor = [...cands].sort((a, b) => bstOf(b) - bstOf(a) || b.level - a.level)[0];
    const solo = [];
    for (let i = 0; i < cands.length; i++) { const c = cands[i]; if (c === anchor) continue; solo.push({ c, ...ev([anchor, c, ...allyTeam], 150) }); tested++; if (i % 8 === 0) await yieldNow(); }
    solo.sort((a, b) => b.ko - a.ko || b.dealt - a.dealt);
    // 2. pairs among the top
    const top = [anchor, ...solo.slice(0, 10).map((x) => x.c)], pairs = [];
    for (let i = 0; i < top.length; i++) for (let j = i + 1; j < top.length; j++) { pairs.push({ p: [top[i], top[j]], ...ev([top[i], top[j], ...allyTeam], 300) }); tested++; await yieldNow(); }
    pairs.sort((a, b) => b.ko - a.ko || b.dealt - a.dealt);
    let best = pairs[0];
    // 3. the ally trainers for that pair
    if (bots.length > allyN) {
      const combos = [];
      const pick = (start, acc) => { if (acc.length === allyN) { combos.push(acc); return; } for (let i = start; i < byPower.length; i++) pick(i + 1, [...acc, byPower[i]]); };
      pick(0, []);
      let bestA = { set: allies, ko: -1 };
      for (const set of combos.slice(0, 40)) { const e = ev([...best.p, ...set.flatMap((x) => botMons(x.b, x.i))], 400); tested++; if (e.ko > bestA.ko || (e.ko === bestA.ko && e.dealt > (bestA.dealt || 0))) bestA = { set, ko: e.ko, dealt: e.dealt }; await yieldNow(); }
      allies = bestA.set; allyTeam = allies.flatMap((x) => botMons(x.b, x.i));
      // the top few pairs again with those allies (a different pair can fit them better)
      let again = null;
      for (const pr of pairs.slice(0, 4)) { const e = ev([...pr.p, ...allyTeam], 400); tested++; if (!again || e.ko > again.ko) again = { p: pr.p, ...e }; await yieldNow(); }
      best = again;
    }
    // 4. (2.16.1) the game's own engine decides among the finalists: the model above narrows hundreds of
    // teams down quickly, then the top pairs x ally sets are played as real raid tries in a sandboxed copy
    let engine = false;
    try {
      const live = (() => { try { return r.drawn() === reg; } catch { return false; } })() || (S().adv?.event?.raid && S().adv.event.reg === reg);
      if (live && typeof GameSim !== 'undefined') {
        const allySets = [allies];
        if (bots.length > allyN) { const combos = []; const pick = (start, acc) => { if (acc.length === allyN) { combos.push(acc); return; } for (let i = start; i < byPower.length; i++) pick(i + 1, [...acc, byPower[i]]); }; pick(0, []); for (const c of combos.sort((a, b) => b.reduce((t, x) => t + x.v, 0) - a.reduce((t, x) => t + x.v, 0)).slice(0, 4)) if (!allySets.some((s) => s.map((x) => x.b.key).join() === c.map((x) => x.b.key).join())) allySets.push(c); }
        const finalists = [best.p, ...pairs.slice(0, 6).map((x) => x.p)].filter((p, i, a) => a.findIndex((q) => q.map((m) => m.uid).join() === p.map((m) => m.uid).join()) === i).slice(0, 6);
        let top = null;
        for (const p of finalists) for (const set of allySets.slice(0, 3)) {
          const e = await GameSim.raid(reg, p.map((m) => m.uid), set.map((x) => x.b.key), 30); tested++;
          if (!top || e.ko > top.e.ko || (e.ko === top.e.ko && e.left < top.e.left)) top = { p, set, e };
        }
        if (top) {
          const fin = await GameSim.raid(reg, top.p.map((m) => m.uid), top.set.map((x) => x.b.key), 100);
          best = { p: top.p, ko: fin.ko }; allies = top.set; engine = true;
        }
      }
    } catch (e) { try { Log.add(`Shiny Raid sim in the game's engine failed (${e?.message || e}) - using Mega's own model`); } catch (__e) { __h('70-plan-13-raid:88', __e); } }
    return { mine: best.p.map((m) => m.uid), allies: allies.map((x) => x.b.key), allyNames: allies.map((x) => x.b.name), ko: best.ko, tested, engine };
  }
  async function raidRepick(by = 'from the phone') {
    const r = RD(), C = E.get('CONFIG')?.RAID || {}, a = S().adv || {};
    if (RaidCount.fete(a.event)) return 'that\'s the 15,000 Trainers raid - change its team in the game\'s banner';
    const g = Plan.goals.find((x) => x.type === 'raid' && !x.done);
    let reg = a.event?.raid ? a.event.reg : null; if (!reg) { try { reg = r.drawn(); } catch (__e) { __h('70-plan-13-raid:95', __e); } }
    if (!reg) { if (g) { delete g.pick; Plan.save(); } return 'today\'s raid isn\'t drawn yet - it will pick when it starts'; }
    const lane = (() => { try { return r.lane() || []; } catch { return []; } })(), boss = a.event?.raid ? +a.event.id : lane.find((x) => x.key === reg)?.boss;
    if (!boss) return 'can\'t read today\'s boss';
    const blocked = Guard.blocks('raid'); if (blocked) return 'safety check: ' + blocked;
    const pick = await raidPick(reg, boss, C); let day = null; try { day = r.dateKey(); } catch (__e) { __h('70-plan-13-raid:100', __e); }
    if (g) { g.pick = { ...pick, day, reg }; Plan.save(); }
    const names = pick.mine.map((u) => name(E.read('Game.getMon', {}, u)?.id)).join(' & ');
    if (a.event?.raid) { // running now: swap the team for the next fight
      const why = Guard.team(pick.mine, { need: +C.MINE || 2, minLevel: 70 }); if (why) return 'not changed - ' + why;
      const s0 = S(); s0.eventTeams = s0.eventTeams || {}; s0.eventTeams[r.teamKey(reg)] = pick.mine;
      pick.allies.slice(0, +C.ALLIES || 2).forEach((k, i) => { try { r.setPick(reg, i, k); } catch (__e) { __h('70-plan-13-raid:106', __e); } });
      try { E.call('Game.save'); } catch (__e) { __h('70-plan-13-raid:107', __e); } try { E.call('App.refresh'); } catch (__e) { __h('70-plan-13-raid:107', __e); }
      Log.add(`Shiny Raid: re-picked ${by} - ${names} + ${pick.allyNames.join(' & ')} (${Math.round(pick.ko * 100)}% in the simulator)`);
      return `now ${names} + ${pick.allyNames.join(' & ')} (sim ${Math.round(pick.ko * 100)}%)`;
    }
    return `picked ${names} + ${pick.allyNames.join(' & ')} for when the raid starts (sim ${Math.round(pick.ko * 100)}%)`;
  }
  const raid = {
    uses: 'screen', daily: true,
    label: () => 'Shiny Raid (every day)',
    sprite: () => null,
    check(g) {
      const r = RD(); if (!r || !E.read('Raids.unlocked', false)) return { state: 'wait', why: 'Shiny Raids are not open yet' };
      // the 15,000 Trainers event raid is yours: its team and counters aren't the Shiny Raid's, so hands off
      if (RaidCount.fete(S().adv?.event)) return { state: 'wait', why: 'the 15,000 Trainers raid is running - Mega leaves it to you' };
      if (S().adv?.event?.raid) return { state: 'ready', why: null };
      if (Date.now() - raidSyncAt > 10 * 60_000) { raidSyncAt = Date.now(); try { r.sync(); } catch (__e) { __h('70-plan-13-raid:122', __e); } }
      const reg = (() => { try { return r.drawn(); } catch { return null; } })();
      if (!reg) { const from = r.state?.drawFrom; return { state: 'wait', why: `today's raid isn't drawn yet${from && from > Date.now() ? ` - draws ${DexInfo.clock(from)}` : ''}` }; }
      if ((() => { try { return r.done(reg); } catch { return false; } })()) { const b = (r.lane() || []).find((x) => x.key === reg);
        const day = (() => { try { return r.dateKey(); } catch { return null; } })();
        if (g && day && g.told !== day) { g.told = day; Plan.save(); Notify.send('daily', `Shiny Raid won${b ? `: ${name(b.boss)}` : ''}`, `${reg} · ${(() => { try { return r.tried(reg, day); } catch { return '?'; } })()} tries`); } const nd = (() => { try { return +r.nextDay(); } catch { return 0; } })(); return { state: 'wait', why: `won today${b ? ` (${name(b.boss)})` : ''} - next raid ${nd ? DexInfo.clock(nd) : 'after the daily reset'}` }; }
      return { state: 'ready', why: null };
    },
    async step(g) {
      const r = RD(), C = E.get('CONFIG')?.RAID || {};
      if (S().adv?.event?.raid) {
        const ev = S().adv.event;
        // a raid Pokémon left mid-raid (sent to the Underground, traded...): refill the team before the next fight
        const team = S().eventTeams?.[r.teamKey(ev.reg)] || [], need = +C.MINE || 2;
        const inTeam = team.filter((u) => E.read('Game.getMon', null, u) && !awayNow().has(u)).length;
        // the first pick was replaced because one was away (2026-11-20: Lugia went underground, the fill-in team won
        // 12 of 18 vs Machop): when they're all back, put the first pick back in
        if (g.wanted && g.wanted.seq === ev.seq) {
          const back = g.wanted.mine.every((u) => E.read('Game.getMon', null, u) && !awayNow().has(u));
          if (back && g.wanted.mine.some((u) => !team.includes(u))) {
            const names = g.wanted.mine.map((u) => name(E.read('Game.getMon', {}, u)?.id)).join(' & ');
            delete g.wanted; Plan.save();
            Log.add(`Shiny Raid: ${names} are back - simulating again with everyone home`);
            try { const msg = await raidRepick('automatically'); return `raid on · ${names} back: ${msg}`; } catch (e) { Log.add('Shiny Raid: could not re-pick (' + (e?.message || e) + ')'); }
          }
        } else if (g.wanted) { delete g.wanted; Plan.save(); }
        if (inTeam < need && (!g.refillAt || Date.now() - g.refillAt > 10 * 60_000)) {
          g.refillAt = Date.now();
          if (!g.wanted && g.pick?.mine?.length) g.wanted = { seq: ev.seq, mine: g.pick.mine.slice(), allies: g.pick.allies, allyNames: g.pick.allyNames, ko: g.pick.ko };
          Plan.save();
          Log.add(`Shiny Raid: the raid team is down to ${inTeam} of ${need} (one was sent away) - picking a full team again`);
          try { const msg = await raidRepick('automatically'); return `raid on · team refilled: ${msg}`; } catch (e) { Log.add('Shiny Raid: could not refill the team (' + (e?.message || e) + ')'); }
        }
        return `raid on · ${name(ev.id)} (${ev.reg}) · try ${(() => { try { return r.tried(ev.reg, ev.date); } catch { return '?'; } })()}${inTeam < need ? ` · only ${inTeam} of your Pokémon in it` : ''}`;
      }
      let reg = r.drawn(); try { r.reveal(); } catch (__e) { __h('70-plan-13-raid:157', __e); }
      const day = r.dateKey(), lane = (() => { try { return r.lane() || []; } catch { return []; } })();
      const bossOf = (k) => lane.find((x) => x.key === k)?.boss;
      // the reroll: once a day, only when today's boss is a shiny you own or clearly weak, and
      // another region's boss would be better
      if (g.rerollDay !== day) {
        g.rerollDay = day; Plan.save();
        const cur = bossOf(reg), others = lane.filter((x) => x.key !== reg && !x.won && x.boss);
        const better = others.filter((x) => want(x.boss) > want(cur));
        const weak = cur && others.length && bst(cur) < 0.85 * (others.reduce((t, x) => t + bst(x.boss), 0) / others.length);
        const canR = (() => { try { return r.canReroll(); } catch { return false; } })();
        if (cur && canR && better.length && (ownsShiny(cur) || weak)) {
          const res = await r.reroll().catch((e) => ({ error: e?.message || e }));
          if (res?.error) Log.add(`Shiny Raid: reroll refused (${res.error})`);
          else { const was = reg; reg = r.drawn(); Log.add(`Shiny Raid: rerolled ${name(cur)} (${was}${ownsShiny(cur) ? ', shiny already owned' : ', weak base stats'}) - now ${name(bossOf(reg))} (${reg})`); }
        } else if (cur) Log.add(`Shiny Raid: today is ${name(cur)} (${reg})${ownsShiny(cur) ? ' - shiny already owned' : ''}${canR && (ownsShiny(cur) || weak) && !better.length ? ' - no better region to reroll into' : ''}${!canR ? '' : better.length ? '' : ' - keeping it'}`);
      }
      const boss = bossOf(reg); if (!boss) return 'reading today\'s boss…';
      // the team: simulate real raid fights against today's boss (your best 2 + the best ally trainers)
      // - once a day, kept on the goal so a reload doesn't search again
      const gone = (g.pick?.mine || []).some((u) => awayNow().has(u) || !E.read('Game.getMon', null, u)); // sent to the Underground since
      if (!g.pick || g.pick.day !== day || g.pick.reg !== reg || gone) {
        g.pick = await raidPick(reg, boss, C); g.pick.day = day; g.pick.reg = reg; Plan.save();
        Log.add(`Shiny Raid: simulated ${g.pick.tested} teams vs ${name(boss)} - best: ${g.pick.mine.map((u) => name(E.read('Game.getMon', {}, u)?.id)).join(' & ')} + ${g.pick.allyNames.join(' & ')} (${Math.round(g.pick.ko * 100)}% KOs ${g.pick.engine ? "in the game's own engine" : 'in the simulator'})`);
      }
      const mine = g.pick.mine.map((u) => E.read('Game.getMon', null, u)).filter(Boolean);
      const s0 = S(); s0.eventTeams = s0.eventTeams || {}; s0.eventTeams[r.teamKey(reg)] = mine.map((m) => m.uid);
      const allyN = +C.ALLIES || 2;
      const bots = g.pick.allies.slice(0, allyN).map((key) => ({ b: { key, name: g.pick.allyNames[g.pick.allies.indexOf(key)] } }));
      bots.forEach((x, i) => { try { r.setPick(reg, i, x.b.key); } catch (__e) { __h('70-plan-13-raid:186', __e); } });
      try { E.call('Game.save'); } catch (__e) { __h('70-plan-13-raid:187', __e); }
      // safety: your 2 (read back from the game) and the ally trainers must be set as picked
      { const read = S().eventTeams?.[r.teamKey(reg)] || [];
        let why = Guard.team(read, { need: +C.MINE || 2, want: g.pick.mine, minLevel: 70 });
        const picks = (() => { try { return (r.picks(reg) || []).filter(Boolean); } catch { return []; } })();
        if (!why && g.pick.allies.length && picks.length < Math.min(allyN, g.pick.allies.length)) why = 'the ally trainers are not set';
        if (why) return Guard.stop('the Shiny Raid', why); }
      // ask the game first (Raids.block = its own reason it won't start). 2026-11-19: the ally trainers picked in
      // the afternoon were gone from the board by evening - the game said "Pick 2 allies" and Mega only showed
      // "could not start - see the log" with nothing in the log
      { const blk = (() => { try { return r.block(reg); } catch { return null; } })();
        if (blk) {
          if (/all(y|ies)|alli/i.test(String(blk)) && !g.repickedAt || (/all(y|ies)|alli/i.test(String(blk)) && Date.now() - g.repickedAt > 10 * 60_000)) {
            g.pick = null; g.repickedAt = Date.now(); Plan.save();
            Log.add('Shiny Raid: the ally trainers you had are no longer on the board - picking new ones');
            return 'picking new ally trainers (the board changed)';
          }
          if (g.blockSaid !== String(blk)) { g.blockSaid = String(blk); Log.add(`Shiny Raid: the game won't start it yet - "${Casing.names(String(blk))}"`); }
          return `waiting: the game says "${Casing.names(String(blk))}"`;
        }
        g.blockSaid = null; }
      let ok = false; try { ok = E.call('Adventure.startRaid', reg); } catch (e) { Log.add('Shiny Raid: the game refused to start (' + (e?.message || e) + ')'); }
      try { E.call('App.refresh'); } catch (__e) { __h('70-plan-13-raid:209', __e); }
      if (ok && S().adv?.event?.raid) { Log.add(`Shiny Raid: started vs ${name(boss)} (${reg}) with ${mine.map((m) => name(m.id)).join(' & ')} + ${bots.slice(0, allyN).map((x) => x.b.name).join(' & ')}`); return `started vs ${name(boss)}`; }
      Log.add('Shiny Raid: the game did not start it and gave no reason - trying again shortly');
      return 'could not start the raid - trying again shortly';
    },
  };
  Object.assign(GoalTypes, { raid, raidRepick });
})();

// goal module: money (takes shared helpers from GoalKit, registers itself in GoalTypes)
(() => {
  const { E, S, name, setChapterTeam, here, goChapter, putBack } = GoalKit;
  // ---- money: farm the best-paying chapter until a target ---------------------------------------
  // Only trainers pay (CONFIG.TRAINER_MONEY = 30 x level; WILD_MONEY is 0). Score each unlocked
  // chapter by what its trainers pay per loop, go there with the fastest-clearing carriers + Lansat.
  // ₽ per hour (Jimmy 2026-11-21: "how do you measure it?"). The game's own rules:
  //  - only trainers pay: CONFIG.TRAINER_MONEY(level) = 30 x level each (WILD_MONEY = 0)
  //  - a chapter in an older region than your newest pays less: CONFIG.BEHIND_MONEY = x0.75 one region behind,
  //    x0.6 two, x0.5 three or more (until 2.10.6 Mega ignored this and could farm an old region)
  //  - fights per hour: measured by XpChap while Mega trains / farms there (same counter as XP per hour)
  //  ₽/hour = (trainer pay x behind factor) per fight x fights per hour (the share of trainer fights in its steps)
  function behind(ch) {
    const ST = E.get('STORY'), A = E.get('CONFIG')?.BEHIND_MONEY || [];
    try {
      const R = ST.REGIONS, un = +(S().adv?.unlocked ?? 0);
      let f = un; while (f > 0 && !ST.regionOf(f).open) f--;
      const d = R.indexOf(ST.regionOf(f)) - R.indexOf(ST.regionOf(ch));
      return d > 0 && A.length ? +A[Math.min(d, A.length) - 1] : 1;
    } catch { return 1; }
  }
  function moneyRank() {
    const ST = E.get('STORY'), C = E.get('CONFIG') || {}, unlocked = +(S().adv?.unlocked ?? 0), out = [];
    const pay = (lv) => { try { return +C.TRAINER_MONEY(lv) || 0; } catch { return lv * 30; } };
    for (let ch = 0; ch <= unlocked && ch < (ST?.CHAPTERS?.length || 0); ch++) {
      const band = (() => { try { return ST.bandOf(ch); } catch { return null; } })(); const top = band && Math.max(...band.filter((x) => x != null));
      if (!top || !isFinite(top)) continue;
      let w = 0, t = 0; for (const st of ST.CHAPTERS[ch].steps || []) if (st.kind === 'route') { w += +st.wild || 0; t += +st.trainers || 0; }
      if (!t) continue;
      const k = behind(ch), perFight = (t / (w + t)) * pay(top) * k;
      const r = (() => { try { return XpChap.rateOf(ch); } catch { return { rate: 400, learned: false }; } })();
      out.push({ ch, top, behind: k, perFight, rate: r.rate, learned: r.learned, perHr: perFight * r.rate, run: t * pay(top) * k, name: ST.CHAPTERS[ch]?.name || 'chapter ' + ch });
    }
    return out.sort((a, b) => b.perHr - a.perHr);
  }
  // ---- real ₽ per hour (Jimmy 2026-11-21: the Discord says Unova's chapter 18, Giant Chasm, beats Mega's estimate):
  // while farming, Mega adds up every rise of your money in that chapter and the time spent there. After 10
  // minutes a chapter's real ₽/hour replaces its estimate. Before trusting the ranking, the top 3 estimates are each
  // tried for 10 minutes (a test goal can name its own list of chapters to try).
  const RKEY = 'mega-moneyrate', LEARN = 10 * 60_000;
  let real = {}; try { real = JSON.parse(localStorage.getItem(RKEY) || '{}') || {}; } catch (__e) { __h('70-plan-14-money:41', __e); }
  const keepReal = () => { try { localStorage.setItem(RKEY, JSON.stringify(real)); } catch (__e) { __h('70-plan-14-money:42', __e); } };
  const measured = (ch) => { const r = real[ch]; return r && r.ms >= LEARN ? r.g / r.ms * 3.6e6 : null; };
  let lastSeen = null;
  function measure(ch) {
    const s = S(), a = s.adv || {}, money = +(s.money ?? 0), now = Date.now();
    const ok = !a.zone && !a.event && !a.league && +a.chapter === +ch;
    if (lastSeen && ok && lastSeen.ch === ch) {
      const dt = Math.min(now - lastSeen.t, 30_000), d = money - lastSeen.m;
      const r = real[ch] || (real[ch] = { g: 0, ms: 0 }); r.ms += dt; if (d > 0 && d < 500_000) r.g += d; keepReal();
    }
    lastSeen = ok ? { ch, t: now, m: money } : null;
  }
  function rankReal() {
    // estimates are discounted by the chance of losing to the chapter's leader (Risk); measured rates already include losses
    return moneyRank().map((x) => { const m = measured(x.ch), rk = m == null ? Risk.factor(x.ch) : 1; return { ...x, est: x.perHr, risk: rk, perHr: m ?? x.perHr * rk, real: m != null, spent: real[x.ch]?.ms || 0 }; }).sort((a, b) => b.perHr - a.perHr);
  }
  function moneyPick(g) {
    const R = rankReal();
    // g.alsoTry: chapters to measure as well (the Discord's pick), ahead of the top 3 estimates
    const want = g?.test?.length ? g.test : [...(g?.alsoTry || []), ...R.slice(0, 3).map((x) => x.ch)];
    const scout = want.map((ch) => R.find((x) => x.ch === +ch)).find((x) => x && !x.real);
    return scout ? { ...scout, scout: true } : (g?.test?.length ? R.find((x) => g.test.includes(x.ch)) : R[0]) || null;
  }
  const moneyChapter = (g) => moneyPick(g);
  const money = {
    uses: 'screen',
    progress: (g) => (g.test?.length ? null : { have: Math.min(+g.target, History.homeMoney()), need: +g.target, money: true }),
    label: (g) => (g.test?.length ? 'Money test: real ₽/hour, 10 min per chapter' : `Farm money to ₽${(+g.target).toLocaleString()}`),
    sprite: () => null,
    check(g) {
      const have = History.homeMoney();
      if (!g.test?.length && have >= +g.target) return { state: 'done', why: `₽${have.toLocaleString()}` };
      if (!moneyChapter()) return { state: 'wait', why: 'no chapter to farm in' };
      return { state: 'ready', why: null };
    },
    async step(g) {
      const best = moneyChapter(g), s = S();
      if (!best) return 'no chapter to farm in';
      measure(best.ch);
      if (!g.restore) { g.restore = { team: [...(s.team || [])], chapter: s.adv?.chapter, loopAdded: null }; Plan.save(); Log.add(`${money.label(g)}: farming in ${best.name} (Lv ${best.top}). Your team and chapter come back when it's done.`); }
      const w = goChapter(g, best.ch, money.label(g)); if (w) return w;
      try { XpChap.tick(best.ch); } catch (__e) { __h('70-plan-14-money:83', __e); } // fights per hour here feed the ₽/hour ranking too
      // carriers: the fastest clearers of this chapter
      if (g.carriersFor !== best.ch || g.carriersV !== Sim.CARRIER_V) {
        let picks = []; try { picks = Sim.carriers(best.ch, { n: 6 }).picks; } catch (__e) { __h('70-plan-14-money:86', __e); }
        g.carriersFor = best.ch; g.carriersV = Sim.CARRIER_V; g.carriers = picks.map((p) => p.m.uid); Plan.save();
        if (picks.length && setChapterTeam(g.carriers)) Log.add(`money team for ${best.name}: ${picks.map((p) => name(p.m.id)).join(', ')}`);
      }
      const have = +(s.money ?? 0);
      if (g.from == null) { g.from = have; g.fromAt = Date.now(); Plan.save(); }
      const hrs = (Date.now() - g.fromAt) / 3_600_000, rate = hrs > 0.05 ? (have - g.from) / hrs : null;
      const berry = Berries.keep('money', 'farming money');
      // test mode: every chapter on the list measured - report and finish
      if (g.test?.length && !best.scout) {
        const R = rankReal().filter((x) => g.test.includes(x.ch));
        if (!g.reported) { g.reported = true; Plan.save(); Log.add(`Money test done (10 min each, real money gained): ${R.map((x) => `${x.name} ₽${Math.round(x.perHr).toLocaleString()}/h`).join(' · ')}`); Notify.send('important', 'Money test done', R.slice(0, 2).map((x) => `${x.name} ₽${Math.round(x.perHr / 1000)}k/h`).join(' · ')); }
        g.done = Date.now(); Plan.save(); this.finish?.(g); return 'money test done';
      }
      if (best.scout) return `measuring ${best.name}: ${Math.round((real[best.ch]?.ms || 0) / 60_000)}/10 min · ₽${Math.round((real[best.ch]?.g || 0)).toLocaleString()} so far (estimate ₽${Math.round(best.est || best.perHr).toLocaleString()}/h)${berry}`;
      return `₽${have.toLocaleString()} of ₽${(+g.target).toLocaleString()} · ${best.name}${rate ? ` · ~₽${Math.round(rate).toLocaleString()}/h, about ${Math.max(0, Math.ceil((g.target - have) / Math.max(1, rate)))} h to go` : ''}${berry}`;
    },
    finish(g) {
      const r = g.restore; if (!r) return;
      const back = (r.team || []).filter((u) => E.read('Game.getMon', null, u)); if (back.length) setChapterTeam(back);
      putBack(g);
    },
  };
  Object.assign(GoalTypes, { money, moneyRank, moneyRankReal: rankReal, moneyPick });
})();

// goal module: region, regionMissing (takes shared helpers from GoalKit, registers itself in GoalTypes)
(() => {
  const { E, hatchMissing } = GoalKit;
  // ---- complete a region's Pokédex ------------------------------------------------------------------
  // A planner: for each missing species it finds a way in (wild / evolve by level / legendary zone)
  // and adds that job to the plan right after itself. What it can't do yet is listed with the reason.
  function regionMissing(key) { return DexInfo.regionIds(key).filter((id) => !E.read('Game.inDex', false, id)); }
  const region = {
    uses: 'background',
    progress: (g) => { const ids = DexInfo.regionIds(g.reg) || []; return ids.length ? { have: ids.length - regionMissing(g.reg).length, need: ids.length, unit: 'registered' } : null; },
    label: (g) => `Complete the ${(E.get('STORY.REGIONS') || []).find((x) => x?.key === g.reg)?.name || g.reg} Pokédex`,
    sprite: () => null,
    check(g) { return regionMissing(g.reg).length ? { state: 'ready', why: null } : { state: 'done', why: 'all registered' }; },
    async step(g) {
      hatchMissing();
      const miss = regionMissing(g.reg), rows = [];
      // a full scan reads every chapter's wild Pokémon: once a minute, or when something got registered
      const sig = miss.join(',') + '|' + Plan.goals.filter((x) => !x.done).length;
      if (g.scanSig === sig && Date.now() - (g.scanAt || 0) < 60_000 && g.line) return g.line;
      g.scanSig = sig; g.scanAt = Date.now();
      let added = 0;
      for (const id of miss) {
        const r = DexInfo.route(id);
        const have = Plan.goals.find((x) => !x.done && ((['legend', 'roam', 'wild', 'special', 'breed'].includes(x.type)) && +x.foe === +id || (x.type === 'level' && x.forDex === id) || (x.type === 'loot' && x.item === 'egg:' + id)));
        if (!have) {
          if (r.kind === 'legend') { const roamer = !!Legends.get(id)?.roam; Plan.insertAfter(g.id, roamer ? 'roam' : 'legend', { foe: id, parent: g.id }); added++; }
          if (r.kind === 'wild') { Plan.insertAfter(g.id, 'wild', { foe: id, ch: r.ch, parent: g.id }); added++; }
          if (r.kind === 'evolve' && !Plan.goals.some((x) => x.type === 'level' && +x.forDex === +id && x.done && Date.now() - x.done < 60 * 60_000 && (x.uids || [])[0] === r.uid)) { const pm = E.read('Game.getMon', null, r.uid); Plan.insertAfter(g.id, 'level', { uids: [r.uid], target: Math.max(r.level, (pm?.level || 0) + 1), forDex: id, fromId: pm ? +pm.id : null, parent: g.id }); added++; }
          if (r.kind === 'loot') { Plan.insertAfter(g.id, 'loot', { item: r.item, ch: r.ch, place: r.place, foe: id, parent: g.id }); added++; }
          if (r.kind === 'breed') { Plan.insertAfter(g.id, 'breed', { foe: id, from: r.parent, parent: g.id }); added++; }
          if (r.kind === 'special') {
            // an item it needs first (Spiritomb's souls): one farming job per item, ahead of the encounter
            if (r.soul && !Plan.goals.some((x) => !x.done && x.type === 'souls' && x.item === r.soul.item)) { Plan.insertAfter(g.id, 'souls', { item: r.soul.item, need: r.soul.need, forDex: id, parent: g.id }); added++; }
            Plan.insertAfter(g.id, 'special', { foe: id, ch: r.ch, place: r.place, parent: g.id }); added++;
          }
        }
        rows.push({ id, kind: r.kind, text: r.text, job: !!have || ['legend', 'wild', 'evolve', 'special', 'loot', 'breed', 'egg'].includes(r.kind) });
      }
      g.rows = rows; Plan.save();
      const jobs = rows.filter((x) => x.job).length;
      return g.line = `${miss.length} missing · ${jobs} being worked on${miss.length - jobs ? ` · ${miss.length - jobs} not automatic yet` : ''}${added ? ` · added ${added} job${added === 1 ? '' : 's'}` : ''}`;
    },
  };
  Object.assign(GoalTypes, { region, regionMissing });
})();

// goal module: elite (takes shared helpers from GoalKit, registers itself in GoalTypes)
(() => {
  const { E, S, name, setTeam, want, LZ } = GoalKit;
  // ---- elite legendaries: beat a legendary's elite tiers, one after another ----------------------
  // The game retries a lost fight by itself ("try 2…") with no limit - it only ends on a win, when you
  // leave, or when a timed zone closes. Team and odds: EliteSim, scored in the game's own engine (GameSim).
  // Move-on rule (Jimmy 2026-11-25): skip a tier whose best team sims under SKIP; leave a tier after CAP of
  // trying (between tries, never mid-fight) and let the next Elite goal run; a tier set aside comes back
  // after REST, simulated again (rank-ups and levels since then count).
  const SKIP = 0.10, CAP = 15 * 60_000, REST = 2 * 3600_000, RESIM = 6 * 3600_000;
  const eliteBusy = new Set();
  const zoneObj = (id) => (LZ()?.ZONES || []).find((z) => +z.id === +id) || null;
  const elite = {
    uses: 'screen',
    label: (g) => `Elite ${name(g.foe)} up to tier ${g.upTo || 5}`,
    sprite: (g) => g.foe,
    progress: (g) => ({ have: Math.min(g.upTo || 5, +(LZ()?.eliteBest(g.foe)) || 0), need: g.upTo || 5, unit: 'tiers' }),
    check(g) {
      const lz = LZ(), z = zoneObj(g.foe); if (!lz || !z) return { state: 'wait', why: 'not in the game data' };
      const best = +lz.eliteBest(g.foe) || 0, next = +lz.eliteNext(g.foe) || 0;
      if (best >= (g.upTo || 5) || !next) return { state: 'done', why: `tier ${best} beaten` };
      if (!lz.eliteShown(z)) return { state: 'wait', why: 'catch it first (and unlock the Underground)' };
      const inIt = +(S().adv?.zone?.id) === +g.foe && +(S().adv?.zone?.elite) === next;
      if (!inIt && !lz.eliteOpen(z)) return { state: 'wait', why: 'its zone is closed right now' };
      if (!inIt && !lz.eliteCan(g.foe, next)) return { state: 'wait', why: `tier ${next} is locked for a while after a loss` };
      if (eliteBusy.has(`L${g.foe}:${next}`)) return { state: 'wait', why: `simulating tier ${next}…` };
      if (!inIt && g.rest && g.rest.tier === next && Date.now() < g.rest.until) return { state: 'wait', why: `tier ${next} set aside after ${g.rest.why} - back ${new Date(g.rest.until).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` };
      // an old result is simulated again (ranks and levels change)
      { const o = EliteSim.get(`L${g.foe}:${next}`); if (o && !inIt && Date.now() - (o.at || 0) > RESIM) EliteSim.drop(`L${g.foe}:${next}`); }
      const sim = EliteSim.get(`L${g.foe}:${next}`);
      if (!sim) { eliteBusy.add(`L${g.foe}:${next}`); EliteSim.legend(g.foe, next).then((r) => Log.add(`${name(g.foe)} elite tier ${next}: best team ${Math.round(r.ko * 100)}%`)).catch((e) => Log.add(`elite sim failed: ${e?.message || e}`)).finally(() => eliteBusy.delete(`L${g.foe}:${next}`)); return { state: 'wait', why: `simulating tier ${next}…` }; }
      if (sim.ko < SKIP && !g.force && !inIt) return { state: 'wait', why: `tier ${next} looks too strong for now (best team ${Math.round(sim.ko * 100)}% a try in the game's engine) - rank up / level, or press ▶ to try anyway` };
      return { state: 'ready', why: null };
    },
    async step(g) {
      const lz = LZ(), next = +lz.eliteNext(g.foe) || 0, a = S().adv || {};
      if ((g.lastBest ?? null) !== null && (+lz.eliteBest(g.foe) || 0) > g.lastBest) {
        const b = +lz.eliteBest(g.foe), rw = E.get('CONFIG')?.ELITE?.REWARDS?.[b];
        Log.add(`${name(g.foe)}: elite tier ${b} beaten!`); Notify.send('win', `Elite ${name(g.foe)} tier ${b} beaten!`, rw === 'gem' ? `You earned a ${EliteInfo.gemLabel(lz.eliteGem(g.foe))} gem` : 'You earned its frame');
      }
      g.lastBest = +lz.eliteBest(g.foe) || 0; Plan.save();
      const inIt = +(a.zone?.id) === +g.foe && +(a.zone?.elite) === next;
      let sim = EliteSim.get(`L${g.foe}:${next}`);
      // only CONFIG.ELITE.LEGENDS (1) Legendary/Mythical per Elite team - the game drops the others, so a team of 6
      // Legendaries fights 1v1 (2026-11-21, Elite Genesect). Drop such a saved sim and simulate a legal team.
      const cap = +(E.get('CONFIG')?.ELITE?.LEGENDS) || 1, DX = E.get('Game.DEX') || {};
      const legs = (uids) => (uids || []).filter((u) => { const m = E.read('Game.getMon', null, u); const d = m && DX[m.id]; return d && (d.legendary || d.mythical); }).length;
      if (sim && legs(sim.uids) > cap) { try { EliteSim.drop(`L${g.foe}:${next}`); } catch (__e) { __h('70-plan-16-elite:48', __e); } sim = null; }
      const zt0 = E.read('Game.zoneTeam', [], g.foe) || [];
      if (!sim && legs(zt0) > cap) {
        if (!g.simming) { g.simming = Date.now(); Log.add(`${name(g.foe)} elite: the team had ${legs(zt0)} Legendaries but Elite allows ${cap} - simulating a legal team`); EliteSim.legend(g.foe, next).catch(() => {}).finally(() => { g.simming = 0; Plan.save(); }); }
        if (inIt && !(a.battle && !a.battle.over)) { try { E.call('Adventure.leaveZone'); } catch (__e) { __h('70-plan-16-elite:52', __e); } }
        return `simulating an Elite team with at most ${cap} Legendary…`;
      }
      if (inIt && sim && legs(zt0) > cap) { if (!(a.battle && !a.battle.over)) { try { E.call('Adventure.leaveZone'); } catch (__e) { __h('70-plan-16-elite:55', __e); } } return 'leaving to swap in the legal Elite team…'; }
      if (!inIt) {
        if (a.zone) { try { E.call('Adventure.leaveZone'); } catch (__e) { __h('70-plan-16-elite:57', __e); } return 'leaving the current zone…'; }
        if (sim?.uids?.length) { const zt = E.read('Game.zoneTeam', [], g.foe) || []; if (!(zt.length === sim.uids.length && sim.uids.every((u, i) => zt[i] === u))) { const r = setTeam(g.foe, sim.uids); if (!r.ok) return 'waiting: ' + r.why; } }
        if (Date.now() - (g.enterAt || 0) < 15_000) return 'entering…';
        { const mt = await MoveTune.ensure(g.foe, E.read('Game.zoneTeam', [], g.foe) || [], Sim.zoneOf(g.foe, next), `${name(g.foe)} elite tier ${next}`); if (mt) return mt; } // which status moves to use (v0.5.12)
        g.enterAt = Date.now();
        { const zt = E.read('Game.zoneTeam', [], g.foe) || []; const why = Guard.team(zt, { need: Math.min(6, sim?.uids?.length || 1), want: sim?.uids || null, minLevel: 50 }); if (why) return Guard.stop(`${name(g.foe)} elite tier ${next}`, why); }
        let ok = false; try { ok = E.call('Adventure.startZone', g.foe, next) !== false; } catch (__e) { __h('70-plan-16-elite:63', __e); }
        try { E.call('App.refresh'); } catch (__e) { __h('70-plan-16-elite:64', __e); }
        if (ok) Log.add(`${name(g.foe)}: started elite tier ${next}${sim ? ` (sim ${Math.round(sim.ko * 100)}%)` : ''}`);
        return ok ? `started elite tier ${next}` : `the game would not start tier ${next}`;
      }
      // the 15-minute cap: counted from the first try of this tier; leave only between tries
      if (!g.tierAt || g.tierAt.tier !== next) { g.tierAt = { tier: next, at: Date.now() }; Plan.save(); }
      if (!g.force && Date.now() - g.tierAt.at > CAP && !(a.battle && !a.battle.over)) {
        g.rest = { tier: next, until: Date.now() + REST, why: `${Math.round(CAP / 60000)} min without a win` }; g.tierAt = null; Plan.save();
        try { EliteSim.drop(`L${g.foe}:${next}`); } catch (__e) { __h('70-plan-16-elite:72', __e); }
        Log.add(`${name(g.foe)} elite tier ${next}: no win in ${Math.round(CAP / 60000)} min (${+(a.zone?.tries || 1)} tries) - moving on, back in ${Math.round(REST / 3600000)} h`);
        try { E.call('Adventure.leaveZone'); } catch (__e) { __h('70-plan-16-elite:74', __e); }
        return `tier ${next}: 15 min without a win - moving on to the next Elite goal`;
      }
      const tries = +(a.zone?.tries || 1);
      return `elite tier ${next} vs ${name(a.zone?.foe || g.foe)} · try ${tries}${sim ? ` · sim ${Math.round(sim.ko * 100)}%` : ''}`;
    },
    finish(g) { const a = S().adv || {}; if (+(a.zone?.id) === +g.foe && a.zone?.elite) { try { E.call('Adventure.leaveZone'); } catch (__e) { __h('70-plan-16-elite:80', __e); } } },
  };
  Object.assign(GoalTypes, { elite });
})();

// goal module: league (takes shared helpers from GoalKit, registers itself in GoalTypes)
(() => {
  const { E, S, name, setChapterTeam, want, LZ } = GoalKit;
  // ---- Elite League: a region's Elite Four + Champion, tiers 1-5 ---------------------------------
  // the simulator (EliteSim.leagueSim) picks the team; redone when older than 3 h (levels/ranks change)
  const simOf = (reg, tier) => EliteSim.leagueFresh(reg, tier);
  const pct = (x) => (x >= 0.995 ? '99+' : x > 0 && x < 0.01 ? '<1' : Math.round(x * 100)) + '%';
  const simulate = (reg, tier) => EliteSim.leagueQueue(reg, tier);
  const regName = (reg) => String(reg || '').replace(/^./, (c) => c.toUpperCase()); // the key: English (the game's names are French: Unys)
  const league = {
    uses: 'screen',
    label: (g) => `Elite League ${regName(g.reg)} up to tier ${g.upTo || 5} (Legendary gems)`,
    sprite: () => null,
    progress: (g) => ({ have: Math.min(g.upTo || 5, +(LZ()?.leagueBest(g.reg)) || 0), need: g.upTo || 5, unit: 'tiers' }),
    check(g) {
      const lz = LZ(); if (!lz?.leagueOpen) return { state: 'wait', why: 'not in this game version' };
      const best = +lz.leagueBest(g.reg) || 0, next = +lz.leagueNext(g.reg) || 0;
      if (best >= (g.upTo || 5) || !next) return { state: 'done', why: `tier ${best} won` };
      const inIt = S().adv?.league?.reg === g.reg && +S().adv?.league?.tier === next;
      if (!inIt && !lz.leagueOpen(g.reg)) return { state: 'wait', why: 'win that region\'s League first' };
      if (!inIt && !lz.leagueCan(g.reg, next)) return { state: 'wait', why: `tier ${next} can't be started right now` };
      // learn from real fights: after 10 tries at one tier, step back and say so (▶ = try again)
      if (!inIt && (g.lost?.[next] || 0) >= 10 && !g.force) return { state: 'wait', why: `tier ${next} lost ${g.lost[next]} times - level / rank up your team, or press ▶ to try anyway` };
      if (!inIt) {
        const sim = simOf(g.reg, next);
        if (!sim) { simulate(g.reg, next); return { state: 'wait', why: `simulating tier ${next} (Lv ${+(E.get('CONFIG')?.MAX_LEVEL) || 100} rank-${next} Elite Four + Champion)…` }; }
        if (sim.ko < 0.01 && !g.force) return { state: 'wait', why: `tier ${next} looks too strong for now (best team ${pct(sim.ko)} - weakest: ${[...sim.per].sort((a, b) => a.win - b.win)[0]?.leader}) - level / rank up, or press ▶ to try anyway` };
      }
      return { state: 'ready', why: null };
    },
    async step(g) {
      const lz = LZ(), next = +lz.leagueNext(g.reg) || 0, a = S().adv || {};
      const best = +lz.leagueBest(g.reg) || 0;
      if ((g.lastBest ?? null) !== null && best > g.lastBest) {
        Log.add(`Elite League ${g.reg}: tier ${best} won!`);
        Notify.send('win', `Elite League tier ${best} won!`, `Pick your Legendary gem in the game (${(lz.leagueTypes(g.reg) || []).join(', ')})${lz.leagueFrame(best) ? ' - and you got the frame' : ''}`);
      }
      g.lastBest = best; Plan.save();
      const inIt = a.league?.reg === g.reg && +a.league?.tier === next;
      if (inIt) { const tries = +(a.league?.tries || 1); g.lost = { ...(g.lost || {}), [next]: Math.max(g.lost?.[next] || 0, tries - 1) }; Plan.save(); }
      if (inIt && (g.lost?.[next] || 0) >= 10 && !g.force) { try { E.call('Adventure.leaveLeague'); } catch (__e) { __h('70-plan-17-league:41', __e); } Log.add(`Elite League ${g.reg}: tier ${next} lost 10 times - stepping back`); Notify.send('problem', `Elite League tier ${next} is too strong for now`, 'Lost 10 times in a row - level or rank up your team, then press ▶ on the goal'); return 'stepped back after 10 losses'; }
      if (g.force && best > (g.forceAt ?? -1)) { g.force = false; g.forceAt = best; }
      const sim = simOf(g.reg, next) || EliteSim.get(`G${g.reg}:${next}`) || EliteSim.leagueTeam(g.reg, next);
      if (!inIt) {
        if (a.zone) { try { E.call('Adventure.leaveZone'); } catch (__e) { __h('70-plan-17-league:45', __e); } return 'leaving the current zone…'; }
        if (a.league) { try { E.call('Adventure.leaveLeague'); } catch (__e) { __h('70-plan-17-league:46', __e); } return 'leaving the other League run…'; }
        if (!g.restore) { g.restore = { team: [...(S().team || [])], chapter: a.chapter }; Plan.save(); }
        if (sim?.uids?.length) { const cur = S().team || []; if (!(cur.length === sim.uids.length && sim.uids.every((u) => cur.includes(u)))) setChapterTeam(sim.uids); }
        // the game locks in its ROAD team (S.road), not .team: a list it only rebuilds from its own team editor, so it can
        // be an older team (2026-11-23: Sinnoh got Heatran + Sableye instead of the simulated six and lost 8 times).
        // Set it to the simulated six, in order, right before starting.
        if (sim?.uids?.length && (S().road || []).join() !== sim.uids.join()) { S().road = sim.uids.slice(); try { E.call('Game.save'); } catch (__e) { __h('70-plan-17-league:52', __e); } }
        // ...and the game's own saved team for this League (its League team picker: eventTeams["league:<region>"]) wins
        // over both when it has anyone in it - that's what Sinnoh used. Put the simulated six there; yours comes back
        // when the goal ends.
        if (sim?.uids?.length) {
          const s0 = S(), k = 'league:' + g.reg; s0.eventTeams = s0.eventTeams || {};
          const cur = s0.eventTeams[k] || [];
          if (cur.join() !== sim.uids.join()) {
            if (g.restore.leagueTeam === undefined) { g.restore.leagueTeam = cur.slice(); Plan.save(); if (cur.length) Log.add(`Elite League ${regName(g.reg)}: your saved League team (${cur.map((u) => name(E.read('Game.getMon', {}, u)?.id)).join(', ')}) is set aside for the simulated one - it comes back when the goal ends`); }
            s0.eventTeams[k] = sim.uids.slice(); try { E.call('Game.save'); } catch (__e) { __h('70-plan-17-league:61', __e); }
          }
        }
        if (Date.now() - (g.enterAt || 0) < 15_000) return 'starting…';
        g.enterAt = Date.now();
        { const why = Guard.team(S().team || [], { need: Math.min(6, sim?.uids?.length || 1), want: sim?.uids || null, minLevel: 50 }); if (why) return Guard.stop(`Elite League ${g.reg} tier ${next}`, why); }
        let ok = false; try { ok = E.call('Adventure.startLeague', g.reg, next) !== false; } catch (__e) { __h('70-plan-17-league:67', __e); }
        try { E.call('App.refresh'); } catch (__e) { __h('70-plan-17-league:68', __e); }
        if (ok) {
          Log.add(`Elite League ${regName(g.reg)}: started tier ${next} with ${sim.uids.map((u) => name(E.read('Game.getMon', {}, u)?.id)).join(', ')}${sim.ko != null ? ` (sim ${pct(sim.ko)})` : ''}`);
          // the game locks the team in at the start (adv.league.team); with a Link Cable it can be the other region's team
          const lt = S().adv?.league?.team || [];
          if (sim.uids.some((u) => !lt.includes(u))) Log.add(`Elite League ${regName(g.reg)}: heads up - the game locked in a different team (${lt.map((u) => name(E.read('Game.getMon', {}, u)?.id)).join(', ')})`);
        }
        return ok ? `started tier ${next}` : `the game would not start tier ${next}`;
      }
      // a run that locked in another team than the simulated one: leave it between fights and start again (twice at most)
      { const lt = a.league?.team || [], want = sim?.uids || [];
        if (want.length && lt.length && want.some((u) => !lt.includes(u)) && !a.battle && (g.relock || 0) < 2) {
          g.relock = (g.relock || 0) + 1; Plan.save();
          Log.add(`Elite League ${regName(g.reg)}: this run has a different team than the simulated one (${lt.map((u) => name(E.read('Game.getMon', {}, u)?.id)).join(', ')}) - starting it again with ${want.map((u) => name(E.read('Game.getMon', {}, u)?.id)).join(', ')}`);
          try { E.call('Adventure.leaveLeague'); } catch (__e) { __h('70-plan-17-league:82', __e); }
          return 'restarting the run with the simulated team…';
        }
        if (want.length && lt.length && !want.some((u) => !lt.includes(u)) && g.relock) { g.relock = 0; Plan.save(); } }
      const at = +a.node || 0, n = (a.nodes || []).length;
      const sm = simOf(g.reg, next);
      return `Elite League ${regName(g.reg)} tier ${next} · stop ${at + 1} of ${n || '?'} · try ${+(a.league?.tries || 1)}${sm ? ` · sim ${pct(sm.ko)}` : ''}`;
    },
    finish(g) { const a = S().adv || {}; if (a.league?.reg === g.reg) { try { E.call('Adventure.leaveLeague'); } catch (__e) { __h('70-plan-17-league:90', __e); } } const r = g.restore;
      if (r && r.leagueTeam !== undefined) { const s0 = S(); s0.eventTeams = s0.eventTeams || {}; s0.eventTeams['league:' + g.reg] = r.leagueTeam.filter((u) => E.read('Game.getMon', null, u)); try { E.call('Game.save'); } catch (__e) { __h('70-plan-17-league:91', __e); } } if (r?.team?.length) setChapterTeam(r.team.filter((u) => E.read('Game.getMon', null, u))); },
  };
    // for the add menu: every region with an Elite League, its progress and the gem types it gives
  const eliteLeagues = () => { const lz = LZ(); return (E.get('STORY.REGIONS') || []).filter((r) => r?.key).map((r) => { let open = false, best = 0, types = []; try { open = !!lz?.leagueOpen?.(r.key); best = +lz.leagueBest(r.key) || 0; types = lz.leagueTypes(r.key) || []; } catch (__e) { __h('70-plan-17-league:94', __e); } const s = best < 5 ? EliteSim.leagueFresh(r.key, best + 1) : null; return { key: r.key, name: regName(r.key), open, best, types, odds: s ? s.ko : null, inPlan: Plan.goals.some((g) => !g.done && g.type === 'league' && g.reg === r.key) }; }).filter((r) => r.types.length); };
  Object.assign(GoalTypes, { league, eliteLeagues });
})();

// goal module: wboss (takes shared helpers from GoalKit, registers itself in GoalTypes)
(() => {
  const { E, name, wbZone } = GoalKit;
  // ---- World Boss: 3 attacks a day while its shield is up, then the capture window ----------------
  // Attacks: the game's own pick (WorldBoss.autoTeam: your strongest that haven't attacked today) and
  // its own server call (WorldBoss.attack). Capture: its zone, like a legendary (Golden Razz on).
  let wbRefreshAt = 0;
  const wboss = {
    uses: 'screen', daily: true,
    label: () => 'World Boss (every edition)',
    sprite: () => wbZone()?.id || null,
    check(g) {
      const W = E.get('WorldBoss'); if (!W) return { state: 'wait', why: 'not in this game version' };
      if (!W.open()) return { state: 'wait', why: 'opens once you beat the Sinnoh League' };
      let st = {}; try { st = W.state() || {}; } catch (__e) { __h('70-plan-18-worldboss:15', __e); }
      // right after a reload the game only knows "soon" until its World Boss screen asks the server: ask it ourselves
      if ((!st.phase || st.phase === 'soon') && !st.n && Date.now() - (wbRefreshAt || 0) > 5 * 60_000) { wbRefreshAt = Date.now(); try { W.refresh(); } catch (__e) { __h('70-plan-18-worldboss:17', __e); } }
      if (st.phase === 'shield') { const left = +W.left(st) || 0; return left > 0 ? { state: 'ready', why: null } : { state: 'wait', why: `today's 3 attacks are done · ${Math.round((st.pct ?? 0) * 100)}% of its shield left` }; }
      if (st.phase === 'capture') return W.caught(st) ? { state: 'wait', why: `caught this edition ✔ · next ${DexInfo.clock(st.next)}` } : { state: 'ready', why: null };
      return { state: 'wait', why: st.next ? `next edition ${DexInfo.clock(st.next)}` : 'no edition yet' };
    },
    async step(g, ctx) {
      const W = E.get('WorldBoss'), st = W.state() || {};
      if (st.phase === 'shield') {
        if (Date.now() - (g.lastHit || 0) < 8000) return 'attacking…';
        g.lastHit = Date.now();
        const team = W.autoTeam(st) || [];
        if (!team.length) return 'waiting: nobody left who can attack today';
        { const why = Guard.team(team.map((x) => x?.uid ?? x), { need: 1, minLevel: 1 }); if (why) return Guard.stop('the World Boss attack', why); }
        const r = await W.attack(team);
        if (r?.error) { Log.add(`World Boss: the game said "${r.error}"`); return 'could not attack: ' + r.error; }
        try { E.call('Game.save'); } catch (__e) { __h('70-plan-18-worldboss:32', __e); } try { E.call('App.refresh'); } catch (__e) { __h('70-plan-18-worldboss:32', __e); }
        const dmg = r?.dmg ?? r?.damage ?? null;
        Log.add(`World Boss: attacked with ${team.map((m) => name(m.id)).join(', ')}${dmg ? ` - ${(+dmg).toLocaleString()} damage` : ''} (${W.left()} left today)`);
        if (!W.left()) Notify.send('daily', 'World Boss: today\'s attacks done', `${Math.round((W.state()?.pct ?? 0) * 100)}% of its shield left`);
        return `attacked (${W.left()} left today)`;
      }
      if (st.phase === 'capture') {
        const z = wbZone(); if (!z) return 'waiting: no World Boss zone in the data';
        if (!g.told || g.told !== st.n) { g.told = st.n; Plan.save(); Notify.send('win', 'World Boss is down - catching it!', `Capture window until ${DexInfo.clock(st.captureEnd)}`); }
        return GoalTypes.legend.step({ ...g, foe: z.id }, ctx); // same as catching a legendary (team from the simulator, Golden Razz)
      }
      return 'waiting';
    },
  };
  Object.assign(GoalTypes, { wboss });
})();

// goal module: idlePick (takes shared helpers from GoalKit, registers itself in GoalTypes)
(() => {
  const { E, S, capOf, dexHold } = GoalKit;
  // ---- idle leveling: what Mega trains when every goal is done or waiting ----
  // Jimmy's order (2026-11-25): favourites first, highest rank to lowest; then the rest, highest rank to lowest;
  // within the same rank shinies before non-shinies; then the ones closest to Lv 100. Only below their level cap, in the PC (not the Underground /
  // Day Care). Four at a time; the level goal adds two carriers and picks the chapter.
  function idlePick(n = 4) {
    const away = new Set((E.read('Game.underMons', []) || []).map((m) => m.uid));
    return (S().mons || [])
      .filter((m) => !away.has(m.uid) && m.level < capOf(m.uid) && !dexHold(m))
      .sort((a, b) => (!!b.fav - !!a.fav) || ((b.rank || 0) - (a.rank || 0)) || (!!b.shiny - !!a.shiny) || b.level - a.level)
      .slice(0, n).map((m) => m.uid);
  }
  Object.assign(GoalTypes, { idlePick });
})();


/* ---------------------------------------------------------------------------------------------
 * Plan: your goals, in your order. One runner:
 *  - the highest goal that is ready gets the battle screen; the others say why they wait
 *  - background goals (later) run alongside on what the screen goal doesn't use
 *  - a goal that finishes is marked done and the next one takes over
 *  - nothing happens while the plan is paused or Alakazam 4.x is switched on
 *  - never interrupts a Raid / Candy Factory / Tower / League run
 * ------------------------------------------------------------------------------------------- */
const Plan = (() => {
  const E = Engine;
  const KEY = 'mega-plan';
  let st = load();
  let timer = null, busy = false, lastEnter = 0, fails = 0, failsFor = null;
  const live = {}; // goal id -> { state, why, line }
  let top = ''; // one line for the whole plan
  // Safety net (Jimmy's rule: never fight short-handed): after every step, a chapter team with fewer than 6
  // gets topped up with your strongest free Pokémon from this side - whatever code path left it short.
  // Never during a Raid / Factory / Tower / League run (those pick their own lineup).
  function fillTeam() {
    try {
      if (GoalTypes.holder()) return;
      const S0 = E.get('Game.S') || {}, cur = (S0.team || []).filter(Boolean);
      if (cur.length >= 6) return;
      GoalTypes.setChapterTeam(cur);
      const now = (E.get('Game.S')?.team || []).length;
      if (now > cur.length) Log.add(`team had only ${cur.length} - filled to ${now} with your strongest free Pokémon`);
    } catch (__e) { __h('70-plan-20-engine:28', __e); }
  }
  // status lines are written lowercase in the goals; screens show them as sentences
  const cap = (s) => (typeof s === 'string' && s ? s[0].toUpperCase() + s.slice(1) : s);

  function load() {
    let p;
    try { p = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (__e) { __h('70-plan-20-engine:35', __e); }
    p = p && Array.isArray(p.goals) ? p : { running: false, goals: [] };
    // 0.3.x: a running hunt becomes the first goal
    try {
      const h = JSON.parse(localStorage.getItem('mega-hunt') || 'null');
      if (h && h.target && !p.goals.some((g) => g.type === 'legend' && g.foe === h.target)) { p.goals.unshift(newGoal('legend', { foe: h.target })); p.running = true; }
      localStorage.removeItem('mega-hunt');
    } catch (__e) { __h('70-plan-20-engine:42', __e); }
    return p;
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (__e) { __h('70-plan-20-engine:45', __e); } }
  function newGoal(type, data) { return { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), type, ...data, paused: false, done: null, added: Date.now() }; }

  const type = (g) => GoalTypes[g.type];
  const name = (g) => { const l = type(g) ? type(g).label(g) : g.type; try { return Casing.title(l); } catch { return l; } };

  // one open catch goal per Legendary, whoever asks: a Legendary goal and a roamer goal for the same Pokémon
  // count as the same (2026-11-19: the Pokédex goal kept adding "Catch Tornadus" every 3 s - 1,100 goals)
  const dupCatch = (t, data) => ['legend', 'roam'].includes(t) && st.goals.some((g) => !g.done && ['legend', 'roam'].includes(g.type) && +g.foe === +data?.foe && !!g.forms === !!data?.forms);
  function add(t, data) {
    if (dupCatch(t, data)) return false;
    if (['shinyWild', 'shinyBreed'].includes(t) && st.goals.some((g) => ['shinyWild', 'shinyBreed'].includes(g.type) && (g.target || g.foe) === +(data.target || data.foe) && !g.done)) return false;
    if (t === 'under' && st.goals.some((g) => g.type === 'under' && !g.done)) return false;
    if (['candy', 'tower', 'raid', 'money', 'bloc', 'wboss', 'train'].includes(t) && st.goals.some((g) => g.type === t && !g.done)) return false;
    if (t === 'region' && st.goals.some((g) => g.type === 'region' && g.reg === data.reg && !g.done)) return false;
    if (['wild', 'special', 'breed'].includes(t) && st.goals.some((g) => g.type === t && g.foe === +data.foe && !g.done)) return false;
    if (t === 'loot' && st.goals.some((g) => g.type === 'loot' && g.item === data.item && !g.done)) return false;
    if (t === 'elite' && st.goals.some((g) => g.type === 'elite' && g.foe === +data.foe && !g.done)) return false;
    if (t === 'league' && st.goals.some((g) => g.type === 'league' && g.reg === data.reg && !g.done)) return false;
    if (t === 'wboss' && st.goals.some((g) => g.type === 'wboss' && !g.done)) return false;
    if (t === 'story' && st.goals.some((g) => g.type === 'story' && g.region === data.region && !g.done)) return false;
    if (t === 'level' && data.forDex && st.goals.some((g) => g.type === 'level' && g.forDex === +data.forDex && !g.done)) return false;
    const g = newGoal(t, t === 'legend' ? { foe: +data.foe } : t === 'under' ? { from: +data.from || 1 } : t === 'region' ? { reg: data.reg } : t === 'money' ? { target: Math.max(1, Math.round(+data.target || 0)) } : data);
    st.goals.push(g); save(); Log.add(`added to the plan: ${name(g)}`); return true;
  }
  function insertBefore(id, t, data) {
    if (dupCatch(t, data)) return null;
    const g = newGoal(t, data), i = st.goals.findIndex((x) => x.id === id);
    st.goals.splice(i < 0 ? st.goals.length : i, 0, g); save();
    Log.add(`added to the plan: ${name(g)}`);
    return g;
  }
  function insertAfter(id, t, data) {
    if (dupCatch(t, data)) return null;
    const g = newGoal(t, data);
    let i = st.goals.findIndex((x) => x.id === id);
    if (i < 0) i = st.goals.length - 1;
    // after the parent and any jobs it already added: keep them in the order they were found
    let j = i + 1; while (j < st.goals.length && st.goals[j].parent === id) j++;
    // quick jobs (wild / evolve) before legendaries
    if (t !== 'legend') { let k = i + 1; while (k < j && st.goals[k].type !== 'legend') k++; j = k; }
    st.goals.splice(j, 0, g); save();
    Log.add(`added to the plan: ${name(g)}`);
    return g;
  }
  function finish(g) { try { type(g)?.finish?.(g); } catch (e) { Log.add(`${name(g)}: could not put things back (${e?.message || e})`); } }
  function remove(id) { const g = st.goals.find((x) => x.id === id); if (g && !g.done) { finish(g); try { Chains.forget(g); } catch (__e) { __h('70-plan-20-engine:91', __e); } } st.goals = st.goals.filter((x) => x.id !== id); save(); if (g) Log.add(`removed from the plan: ${name(g)}`); }
  function move(id, d) {
    const open = st.goals.filter((g) => !g.done), i = open.findIndex((g) => g.id === id), j = i + d;
    if (i < 0 || j < 0 || j >= open.length) return;
    [open[i], open[j]] = [open[j], open[i]];
    st.goals = [...open, ...st.goals.filter((g) => g.done)]; save();
  }
  function toTop(id) {
    const open = st.goals.filter((g) => !g.done), i = open.findIndex((g) => g.id === id);
    if (i <= 0) return;
    const [g] = open.splice(i, 1); open.unshift(g);
    st.goals = [...open, ...st.goals.filter((x) => x.done)]; save();
  }
  function pause(id) { const g = st.goals.find((x) => x.id === id); if (g) { g.paused = !g.paused; if (g.paused && type(g)?.finishOnPause) finish(g); save(); Log.add(`${g.paused ? 'paused' : 'resumed'}: ${name(g)}`); } }
  function clearDone() { st.goals = st.goals.filter((g) => !g.done); save(); }
  function setRunning(on) { st.running = !!on; save(); Log.add(on ? 'plan started' : 'plan paused'); top = on ? 'starting…' : 'paused'; tick(); }

  // Alakazam 4.x: present and switched on?
  function oldOn() {
    if (!document.querySelector('#pch')) return false;
    try { return JSON.parse(localStorage.getItem('pc-helper-cfg') || '{}').on !== false; } catch { return true; }
  }
  function turnOldOff() {
    const box = document.querySelector('#pch input[data-k="on"]');
    if (box && box.checked) { box.click(); Log.add('switched Alakazam 4.x off so Mega can run the plan'); return true; }
    return false;
  }

  // enter a legendary zone with the game's own entry (validates + heals), then check it worked
  async function enter(id, force = false) {
    if (!force && Date.now() - lastEnter < 15_000) return false;
    lastEnter = Date.now();
    let ok = false;
    { const why = Guard.team(E.read('Game.zoneTeam', [], +id) || [], { need: 1, minLevel: 1 }); if (why) { Guard.stop(`${E.get('Game.DEX')?.[id]?.name}'s zone`, why); return false; } }
    try { ok = E.call('Adventure.startZone', +id) !== false; } catch (e) { Log.add(`${E.get('Game.DEX')?.[id]?.name}: the game refused to enter (${e.message})`); }
    try { E.call('App.refresh'); } catch (__e) { __h('70-plan-20-engine:126', __e); }
    await new Promise((r) => setTimeout(r, 800));
    if (ok && +(E.get('Game.S')?.adv?.zone?.id) === +id) { fails = 0; Log.add(`entered ${E.get('Game.DEX')?.[id]?.name}'s zone`); return true; }
    if (failsFor !== id) { failsFor = id; fails = 0; }
    fails++;
    Log.add(`${E.get('Game.DEX')?.[id]?.name}: entering did not work (${fails}/3)`);
    return false;
  }
  const ctx = { enter };

  async function tick() {
    if (busy || !E.ready()) return;
    busy = true;
    try {
      let screenTaken = null;
      // "dailies win" (as in 4.x): a daily that's ready gets the screen before your other screen goals
      let order = [...st.goals.filter((g) => type(g)?.daily), ...st.goals.filter((g) => !type(g)?.daily)];
      // finish what's on the screen first (Jimmy 2026-11-25): the goal whose zone is open right now (an Elite tier or a
      // legendary zone) goes first, so a goal higher in the queue that just finished simulating its next tier waits for
      // this run to end (a win, the 15-min Elite cap, or a catch) instead of pulling Mega out of it
      { const zid = +(E.get('Game.S')?.adv?.zone?.id) || 0;
        const cur = zid ? st.goals.find((g) => !g.done && !g.paused && ['elite', 'legend'].includes(g.type) && +g.foe === zid) : null;
        if (cur) order = [cur, ...order.filter((g) => g !== cur)]; }
      for (const g of order) {
        if (g.done) continue;
        const T = type(g);
        if (!T) { live[g.id] = { state: 'wait', why: 'unknown goal type' }; continue; }
        const c = (() => { try { return T.check(g); } catch (e) { Health.goalErr(g, e, name(g)); return { state: 'wait', why: 'error: ' + (e?.message || e) }; } })();
        if (c.state === 'done') { g.done = Date.now(); save(); Log.add(`done: ${name(g)}`); try { const k = 'mega-week-done', l = JSON.parse(localStorage.getItem(k) || '[]'); l.push(name(g)); localStorage.setItem(k, JSON.stringify(l.slice(-40))); } catch (__e) { __h('70-plan-20-engine:154', __e); } finish(g);
          if (['region', 'loot', 'souls', 'level'].includes(g.type)) Notify.send('win', `Done: ${name(g)}`, g.type === 'region' ? 'Every Pokémon of that region is in your Pokédex!' : c.why || 'goal finished'); live[g.id] = { state: 'done', why: c.why }; continue; }
        if (g.paused) { live[g.id] = { state: 'paused', why: null }; continue; }
        if (c.state !== 'ready') { live[g.id] = { state: 'wait', why: c.why }; if (!waitSince.has(g.id)) waitSince.set(g.id, { at: Date.now(), why: c.why }); else waitSince.get(g.id).why = c.why; continue; }
        { const gb = Guard.blocks(g.type); if (gb) { live[g.id] = { state: 'wait', why: `did not start - safety check: ${gb} (probably a game update; waits until it looks right)` }; continue; } }
        if (T.uses === 'screen' && screenTaken) { live[g.id] = { state: 'queued', why: `after ${name(screenTaken)}` }; continue; }
        if (T.uses === 'screen') screenTaken = g;
        if (g.type === 'legend' && failsFor === g.foe && fails >= 3) { live[g.id] = { state: 'wait', why: 'could not enter the zone 3 times - see the log, then press ▶ to retry' }; continue; }
        live[g.id] = { ...(live[g.id] || {}), state: 'ready', why: null };
      }
      if (!st.running) { if (st.idle) await idleStop('plan paused'); top = 'paused - press Start to run the plan'; return; }
      if (oldOn()) { top = 'waiting: Alakazam 4.x is switched on'; return; }
      if (GameMode.on()) { top = 'Game Mode is open on your phone - Mega is stepping aside'; return; }
      const h = GoalTypes.holder();
      let runs = st.goals.filter((g) => !g.done && live[g.id]?.state === 'ready');
      // the goal whose run it is keeps going (an Elite League goal must see its own run: the 10-loss step back and the
      // wrong-team restart ran only between runs before - 2026-11-23)
      const own = (x) => (/Candy/.test(h || '') && x.type === 'candy') || (/Tower/.test(h || '') && x.type === 'tower') || (/Raid/.test(h || '') && x.type === 'raid') || (/League/.test(h || '') && x.type === 'league' && x.reg === E.get('Game.S')?.adv?.league?.reg);
      if (h) { for (const g of runs.filter((x) => type(x).uses === 'screen' && !own(x))) live[g.id] = { state: 'wait', why: `${h} is using the battle screen` }; runs = runs.filter((x) => type(x).uses !== 'screen' || own(x)); }
      const screenRuns = runs.some((g) => type(g).uses === 'screen');
      // a real goal wants the screen: end the idle job first (team, buddy, loop and chapter go back)
      if ((screenRuns || h) && st.idle) await idleStop(screenRuns ? 'a goal is ready' : `${h} started`);
      for (const g of runs) {
        // a goal that waited a while (weather, time of day, a zone, a chapter) is finally going: tell Jimmy once
        const ws = waitSince.get(g.id);
        if (ws && Date.now() - ws.at > 30 * 60_000) { Log.add(`started: ${name(g)} (was waiting: ${ws.why || 'its conditions'})`); Notify.send('daily', `Started: ${name(g)}`, `It was waiting ${Math.round((Date.now() - ws.at) / 3_600_000 * 10) / 10} h: ${ws.why || 'its conditions'}`); }
        waitSince.delete(g.id);
        try { Blackbox.mark('goal ' + g.type + ' ' + (g.foe || g.item || '')); live[g.id].line = await type(g).step(g, ctx); live[g.id].state = 'running'; Health.goalOk(g); live[g.id].team = teamInfo(g); fillTeam(); }
        catch (e) { live[g.id] = { state: 'wait', why: 'error: ' + (e?.message || e) }; Log.add(`${name(g)}: error - ${e?.message || e}`); Health.goalErr(g, e, name(g)); }
      }
      // idle only after 2 min with no screen goal, so a goal that waits a moment between runs doesn't flip-flop
      if (screenRuns || h) freeSince = 0; else if (!freeSince) freeSince = Date.now();
      if (!screenRuns && !h && idleOn() && (st.idle || Date.now() - freeSince > 120_000)) { await idleStep(); top = (runs.length ? `running: ${runs.map(name).join(', ')} · ` : '') + `idle: ${idleLine || 'leveling'}`; return; }
      if (!runs.length) { top = h ? `waiting: ${h} is using the battle screen` : st.goals.some((g) => !g.done) ? 'every goal is waiting - see the reasons below' : 'nothing to do - add a goal'; return; }
      top = `running: ${runs.map(name).join(', ')}`;
    } finally { busy = false; }
  }

  // ---- team check: who's fighting for a running goal, and the simulated chance when there is one ----
  function teamInfo(g) {
    try {
      const S0 = E.get('Game.S') || {};
      // background goals don't use the battle screen's team: Underground shows its own way, the rest nothing
      if (type(g)?.uses === 'background') return g.type === 'under' ? { uids: [], win: null, how: "the game's own expedition simulation" } : null;
      let uids = (S0.team || []).slice(0, 6), win = null, how = '';
      if (g.type === 'legend' || g.type === 'elite') { const zt = E.read('Game.zoneTeam', [], g.foe) || []; if (zt.length) uids = zt; const sim = Legends.sims()[g.foe]; if (sim?.final) { win = sim.final.ko; how = 'simulated'; } }
      else if (g.type === 'raid' && g.pick) { uids = g.pick.mine || uids; win = g.pick.ko ?? null; how = 'simulated with ally trainers'; }
      else if (g.type === 'story') { win = g.planWin ?? g.nowWin ?? null; how = "the game's win estimate"; }
      else if (g.type === 'special' && g.boss) { win = g.boss.win; how = 'simulated for this encounter'; }
      else if (g.type === 'wboss') how = "the game's pick - the most damage possible (damage grows with total power)";
      else if (g.type === 'under') how = "the game's own expedition simulation";
      else if (g.type === 'candy') how = 'simulated floor by floor';
      else if (['level', 'money', 'wild', 'souls', 'loot', 'shinyWild'].includes(g.type)) how = 'best carriers for this chapter';
      return { uids, win, how };
    } catch { return null; }
  }

  // ---- idle job: when every goal is done or waiting, level Pokémon (see GoalTypes.idlePick) ----
  // Uses the level goal itself (training chapter, carriers, buddy, Pinap, loop on - so the game never
  // wanders into new story chapters) and puts everything back when a real goal needs the screen.
  let idleLine = '', freeSince = 0;
  const waitSince = new Map(); // goal id -> when it started waiting and why (for the "Started" alert)
  const idleOn = () => st.idleLevel !== false;
  async function idleStep() {
    const L = GoalTypes.level;
    if (!st.idle) {
      const uids = GoalTypes.idlePick();
      if (!uids.length) { idleLine = 'nothing to level - every Pokémon is at its cap'; return idlePark(); }
      st.idle = { id: 'idle', type: 'level', uids, target: 100, idle: true, started: Date.now() }; save();
      const names = uids.map((u) => E.get('Game.DEX')?.[E.read('Game.getMon', {}, u)?.id]?.name).join(', ');
      Log.add(`plan idle (every goal done or waiting): leveling ${names}`);
      const next = st.goals.filter((g) => !g.done && live[g.id]?.why).slice(0, 1).map((g) => `next: ${name(g)} - ${live[g.id].why}`)[0];
      Notify.send('daily', 'Plan is idle - leveling Pokémon', `${names}${next ? ' · ' + next : ''}`);
    }
    const g = st.idle;
    // someone reached the cap: swap in the next in line (the restore point stays the same)
    if (GoalTypes.level.check(g)?.state === 'done' || g.uids.every((u) => (E.read('Game.getMon', null, u)?.level ?? 999) >= Math.min(100, E.read('Game.capFor', 100, E.read('Game.getMon', null, u)) || 100))) {
      const uids = GoalTypes.idlePick();
      if (!uids.length) { idleLine = 'every Pokémon is at its cap'; await idleStop('nothing left to level'); return idlePark(); }
      if (uids.join() !== g.uids.join()) { g.uids = uids; g.carriersFor = null; g.startLv = null; save(); Log.add(`idle leveling: now ${uids.map((u) => E.get('Game.DEX')?.[E.read('Game.getMon', {}, u)?.id]?.name).join(', ')}`); }
    }
    try { idleLine = 'leveling ' + (await L.step(g, ctx)); } catch (e) { idleLine = 'error: ' + (e?.message || e); }
    live.idle = { state: 'running', line: idleLine };
  }
  async function idleStop(why) {
    const g = st.idle; if (!g) return;
    try { GoalTypes.level.finish(g); } catch (__e) { __h('70-plan-20-engine:240', __e); }
    st.idle = null; delete live.idle; save();
    Log.add(`idle leveling stopped: ${why}`);
  }
  // nothing to level: keep the current chapter looping so the game can't move on to new story chapters
  function idlePark() {
    const ch = +(E.get('Game.S')?.adv?.chapter);
    if (Number.isFinite(ch) && !E.read('Adventure.isLooping', false, ch)) { try { E.call('Adventure.toggleLoop', ch); Log.add('plan idle: looping the current chapter so the story doesn\'t move on'); } catch (__e) { __h('70-plan-20-engine:247', __e); } }
    live.idle = { state: 'running', line: idleLine };
  }

  function retry(id) { const g0 = st.goals.find((x) => x.id === id); if (g0 && ['elite', 'league'].includes(g0.type)) { g0.force = true; g0.lost = {}; save(); }
    const g = g0; if (g && g.type === 'legend' && failsFor === g.foe) { fails = 0; lastEnter = 0; } tick(); }

  // weekly-form zones (Deoxys): once its zone is unlocked and a form is still missing, add a
  // "Catch every <name> form" goal - once; if you remove it, Mega won't add it again
  // on a new region's side (Unova) with its League not beaten: add "Beat the Unova League" at the top - once
  function storyGoal() {
    storyPlace(); // keep it below the dailies, every minute
    return; // you add "Beat a region's League" yourself from the Plan tab now (any region, future ones too)
    try {
      const link = E.get('Game.S')?.link; if (!link || link.side !== 'to') return;
      const reg = link.to, key = 'mega-storygoal-' + reg;
      if (localStorage.getItem(key) || E.read('Game.regionCleared', false, reg)) return;
      if (!Plan.goals.some((g) => g.type === 'story' && !g.done)) {
        const nm = { unova: 'Unova', kalos: 'Kalos' }[reg] || (E.get('STORY')?.REGIONS || []).find((r) => r.key === reg)?.name || reg;
        Plan.add('story', { region: reg, regionName: nm });
        Log.add(`added "Beat the ${nm} League" right after your dailies - they take the screen when they're due, Unova gets it the rest of the time`);
      }
      localStorage.setItem(key, '1');
    } catch (__e) { __h('70-plan-20-engine:270', __e); }
    storyPlace();
  }
  // the story goal sits right after the daily screen jobs (Shiny Raid, Candy Factory, Battle Tower, World
  // Boss): they run when due, and the story - always ready - would block them if it were above them
  function storyPlace() {
    try {
      const open = Plan.goals.filter((g) => !g.done), si = open.findIndex((g) => g.type === 'story');
      if (si < 0) return;
      const daily = ['raid', 'candy', 'tower', 'wboss', 'bloc'];
      let last = -1; open.forEach((g, i) => { if (daily.includes(g.type)) last = i; });
      if (si > last) return; // already below every daily (wherever you put it) - leave it
      const want = last;
      const id = open[si].id;
      for (let n = 0; n < 60; n++) { const cur = Plan.goals.filter((g) => !g.done).findIndex((g) => g.id === id); if (cur === want) break; Plan.move(id, cur < want ? 1 : -1); }
    } catch (__e) { __h('70-plan-20-engine:285', __e); }
  }
  function formGoals() {
    try {
      for (const z of Legends.list()) {
        if (!z.forms || z.allForms || z.state === 'locked' || z.state === 'sealed') continue;
        const key = 'mega-formgoal-' + z.id; if (localStorage.getItem(key)) continue;
        if (!Plan.goals.some((g) => g.type === 'legend' && g.foe === z.id && !g.done)) { Plan.add('legend', { foe: z.id, forms: true }); Log.add(`added "Catch every ${z.name} form" - a new form appears each week until you have all ${z.forms.length}`); }
        localStorage.setItem(key, '1');
      }
    } catch (__e) { __h('70-plan-20-engine:295', __e); }
  }
  function boot() {
    setTimeout(formGoals, 20_000); setInterval(storyGoal, 60_000); setTimeout(storyGoal, 25_000);
    if (timer) return;
    timer = setInterval(tick, 3000); setTimeout(tick, 1500);
    Recorder.onFight((f) => { if (st.goals.some((g) => g.type === 'legend' && g.foe === f.foeId && !g.done)) Log.add(`${E.get('Game.DEX')?.[f.foeId]?.name} fight: ${f.outcome === 'ko' ? 'KO' : f.outcome}`); });
  }
  return {
    boot, add, insertBefore, insertAfter, save, remove, move, toTop, pause, retry, clearDone, setRunning, oldOn, turnOldOff,
    get goals() { return st.goals; }, get running() { return st.running; }, get top() { return cap(top); },
    live: (id) => { const L = live[id]; return L ? { ...L, why: cap(L.why), line: cap(L.line) } : null; }, label: name,
    get idle() { return st.idle ? { goal: st.idle, line: live.idle?.line || idleLine } : (live.idle ? { goal: null, line: live.idle.line } : null); },
    get idleOn() { return idleOn(); }, setIdle(v) { st.idleLevel = !!v; save(); if (!v && st.idle) idleStop('switched off'); },
    has: (foe) => st.goals.find((g) => g.type === 'legend' && g.foe === +foe && !g.done) || null,
    hasType: (t) => st.goals.find((g) => g.type === t && !g.done) || null,
  };
})();

// goal module: bloc (takes shared helpers from GoalKit, registers itself in GoalTypes)
(() => {
  const { E, S, name } = GoalKit;
  // ---- Pokéblock Boss (Jimmy 2026-11-20): one attack a day with 10 Pokémon, opens after the Unova League -------
  // The attack is instant: the game's own BlocBoss.plan works the whole fight out from the day and the team (it is
  // seeded, so the same 10 on the same day always reach the same step), then BlocBoss.attack hands out the
  // Pokéblocks. Nobody is sent away - the 10 stay free for raids, the Underground and everything else.
  // Mega tries many teams with that same plan (under 1 ms each) and attacks with the one that goes furthest.
  const B = () => E.get('BlocBoss');
  let dayAskAt = 0;
  // the daily reset is the Shiny Raid's (3 PM Pacific - midnight in France)
  const nextReset = () => { try { return DexInfo.clock(+E.get('Raids').nextDay()); } catch { return 'at the daily reset'; } };
  const val = (p) => (p ? p.step + (p.pct || 0) : -1);
  function search(day) {
    const BB = B(), away = new Set((E.read('Game.underMons', []) || []).map((m) => m.uid));
    const size = +(E.get('CONFIG')?.BLOC_BOSS?.TEAM) || 10;
    const pool = (E.read('Game.ownedMons', []) || []).filter((m) => m && !m.egg && !away.has(m.uid) && (() => { try { return BB.allowed(m); } catch { return false; } })());
    if (pool.length < 1) return null;
    const plan = (team) => { try { return BB.plan(team, day); } catch { return null; } };
    // each one alone: how much it does to today's boss
    const solo = pool.map((m) => ({ m, d: plan([m])?.dmg || 0 })).sort((a, b) => b.d - a.d);
    const cands = solo.slice(0, 40).map((x) => x.m);
    let team = cands.slice(0, size), best = plan(team), tried = 1 + pool.length;
    for (let pass = 0; pass < 3; pass++) {
      let better = false;
      for (let slot = 0; slot < team.length; slot++) {
        for (const c of cands) {
          if (team.includes(c)) continue;
          const trial = team.slice(); trial[slot] = c;
          const p = plan(trial); tried++;
          if (val(p) > val(best) + 1e-6 || (val(p) === val(best) && (p?.dmg || 0) > (best?.dmg || 0))) { best = p; team = trial; better = true; }
        }
      }
      if (!better) break;
    }
    return { team, plan: best, tried };
  }
  const stepText = (p, day) => { try { return `${B().stepName(p.step, day.taste)} (${Math.round((p.pct || 0) * 100)}% of the next bar)`; } catch { return `step ${p.step}`; } };
  const bloc = {
    uses: 'background', daily: true,
    label: () => 'Pokéblock Boss (every day)',
    sprite: () => { try { return B().today()?.boss || null; } catch { return null; } },
    check() {
      const BB = B(); if (!BB) return { state: 'wait', why: 'not in this game version' };
      let why = null; try { why = BB.why(); } catch { why = 'locked'; }
      if (why === 'locked') return { state: 'wait', why: 'opens after you beat the Unova League' };
      if (why === 'played') { const l = (() => { try { return BB.last(); } catch { return null; } })(); return { state: 'wait', why: `done today${l ? ` · ${l.got} Pokéblocks${l.rb ? ` + ${l.rb} Rainbow` : ''}` : ''} · next ${nextReset()}` }; }
      if (why === 'day' && Date.now() - dayAskAt > 5 * 60_000) { dayAskAt = Date.now(); try { BB.loadDay(); } catch (__e) { __h('70-plan-21-bloc:48', __e); } }
      if (why === 'day') return { state: 'wait', why: 'checking today\'s boss…' };
      return { state: 'ready', why: null };
    },
    async step(g) {
      const BB = B();
      let day = null; try { day = BB.today() || await BB.loadDay(); } catch (__e) { __h('70-plan-21-bloc:54', __e); }
      if (!day) return 'waiting for today\'s boss';
      const r = search(day);
      if (!r || !r.team.length) return 'no Pokémon free to send';
      const uids = r.team.map((m) => m.uid);
      { const why = Guard.team(uids, { need: 1, minLevel: 1 }); if (why) return Guard.stop('the Pokéblock Boss', why); }
      const s0 = S(); s0.eventTeams = s0.eventTeams || {}; s0.eventTeams[BB.TEAM_KEY || 'bloc'] = uids;
      try { E.call('Game.save'); } catch (__e) { __h('70-plan-21-bloc:61', __e); }
      // the game's own result must match what Mega planned with (same team, same day)
      const res = BB.attack();
      if (!res) { let why = '?'; try { why = BB.why(); } catch (__e) { __h('70-plan-21-bloc:64', __e); } return `the game would not attack (${why})`; }
      try { E.call('Game.save'); } catch (__e) { __h('70-plan-21-bloc:65', __e); } try { E.call('App.refresh'); } catch (__e) { __h('70-plan-21-bloc:65', __e); }
      const items = Object.entries(res.items || {}).map(([k, n]) => `${n} ${DexInfo.itemName(k)}`).join(', ');
      g.lastRun = { day: day.day, step: res.step, pct: res.pct, got: res.got, rb: res.rb, tried: r.tried }; Plan.save();
      Log.add(`Pokéblock Boss (${name(day.boss)}, ${day.taste} day): ${r.tried} teams tried - reached ${stepText(res, day)}${res.record ? ' - new record!' : ''}: ${items || 'nothing'} · team ${r.team.map((m) => name(m.id)).join(', ')}`);
      Notify.send('daily', `Pokéblock Boss: ${stepText(res, day)}`, items || 'no Pokéblocks');
      return `attacked: ${stepText(res, day)} · ${items || 'nothing'}`;
    },
  };
  Object.assign(GoalTypes, { bloc, blocSearch: search });
})();

// goal module: train (takes shared helpers from GoalKit, registers itself in GoalTypes)
(() => {
  const { E, name } = GoalKit;
  // ---- Level Pokémon (Jimmy 2026-11-21): the idle leveling as a goal you can place in the plan -------------
  // Exactly what the plan does when it has nothing else to do: GoalTypes.idlePick() chooses who levels (team
  // members below their cap first, then your strongest in the PC), the level goal trains them in the chapter with
  // the best XP per hour (XpChap) with fast carriers, and the next in line steps in when one reaches its cap.
  // As a goal it runs in its place in the plan order: goals above it go first, goals below wait for it.
  // It never finishes by itself - remove it (or pause it) when you're done.
  const L = () => GoalTypes.level;
  const train = {
    uses: 'screen',
    label: () => 'Level Pokémon (like idle)',
    sprite: (g) => { const m = g.job?.uids?.[0] && E.read('Game.getMon', null, g.job.uids[0]); return m?.id || null; },
    check() {
      const uids = (() => { try { return GoalTypes.idlePick(); } catch { return []; } })();
      return uids.length ? { state: 'ready', why: null } : { state: 'wait', why: 'every Pokémon is at its level cap' };
    },
    async step(g, ctx) {
      const pick = GoalTypes.idlePick();
      if (!pick.length) return 'every Pokémon is at its level cap';
      const atCap = (j) => L().check(j)?.state === 'done' || j.uids.every((u) => (E.read('Game.getMon', null, u)?.level ?? 999) >= Math.min(100, E.read('Game.capFor', 100, E.read('Game.getMon', null, u)) || 100));
      if (!g.job) { g.job = { id: g.id + ':job', type: 'level', uids: pick, target: 100, idle: true, started: Date.now() }; Plan.save(); Log.add(`${train.label(g)}: leveling ${pick.map((u) => name(E.read('Game.getMon', {}, u)?.id)).join(', ')}`); }
      else if (atCap(g.job) && pick.join() !== g.job.uids.join()) { g.job.uids = pick; g.job.carriersFor = null; g.job.startLv = null; Plan.save(); Log.add(`${train.label(g)}: now ${pick.map((u) => name(E.read('Game.getMon', {}, u)?.id)).join(', ')}`); }
      if (g.xpTest) g.job.xpTest = g.xpTest; // an XP test: measure these chapters first
      return 'leveling ' + (await L().step(g.job, ctx));
    },
    finish(g) { if (g.job) { try { L().finish(g.job); } catch (__e) { __h('70-plan-22-train:28', __e); } } },
  };
  Object.assign(GoalTypes, { train });
})();

// goal module: discord (takes shared helpers from GoalKit, registers itself in GoalTypes)
(() => {
  const { E, S, name, setChapterTeam, safe } = GoalKit;
  // ---- Discord Recommended (Jimmy 2026-11-23): the four picks of the Discord's "Auto-Replay Farming Guide"
  // (@destryyy, made on game v0.5.091 - the game's own battle engine, every loop simulated):
  //   money  -> Legend Badge (Unova)               a team that sweeps it: a faster lap is more money
  //   xp     -> the Kanto League, run as ONE loop  every team member gets each win's XP: 1 carry + 5 leveling
  //   mix    -> Giant Chasm (Unova)                the best mix of money, battle XP and Exp. Candies
  //   candy  -> Kanto Victory Road                 the most Exp. Candy drops
  // The game, read in its code: after a chapter it goes on to the NEXT looped chapter (in order) - so while one
  // of these runs, its spot is the only loop; your loops, team and chapter come back when it's paused / removed.
  const ST = () => E.get('STORY');
  const eng = (c) => safe(() => Casing.names(c.name), c?.name || '');
  const findCh = (test) => safe(() => ST().CHAPTERS.findIndex((c) => test(c)), -1);
  const SPOTS = {
    money: { title: 'Money', where: 'Legend Badge', kind: 'sweep', find: () => findCh((c) => (c.reg || 'kanto') === 'unova' && eng(c) === 'Legend Badge'), berry: 'money' },
    xp: { title: 'Battle XP for your party', where: 'Kanto Pokémon League', kind: 'level', league: 'kanto', berry: 'xp' },
    mix: { title: 'Money + battle XP + candies', where: 'Giant Chasm', kind: 'level', find: () => findCh((c) => (c.reg || 'kanto') === 'unova' && eng(c) === 'Giant Chasm'), berry: 'xp' },
    // Axsiom's run (Jimmy 2026-11-23, from the Discord): Giant Chasm with ONE carrier (his are rank V), the rest leveling,
    // and the Shiny berry on 24/7 with Money and XP - Giant Chasm can drop Shiny berries, so it keeps itself going
    axsiom: { title: 'Axsiom Plan', where: 'Giant Chasm', kind: 'level', find: () => findCh((c) => (c.reg || 'kanto') === 'unova' && eng(c) === 'Giant Chasm'), berry: 'xp', keep: ['shiny', 'capture', 'money'] }, // capture: a shiny gets one ball - Golden Razz x1.5 / Razz x1.25 (Jimmy 2026-11-23)
    candy: { title: 'Exp. Candies', where: 'Kanto Victory Road', kind: 'sweep', find: () => findCh((c) => (c.reg || 'kanto') === 'kanto' && eng(c) === 'Victory Road') },
  };
  // where a spot is: its first chapter, every chapter of it (a League is several), and the game's loop key for it
  function spotOf(key) {
    const sp = SPOTS[key]; if (!sp) return null;
    if (sp.league) {
      const chs = safe(() => ST().CHAPTERS.map((c, i) => (c.league && (c.reg || 'kanto') === sp.league ? i : -1)).filter((i) => i >= 0), []);
      if (!chs.length) return null;
      return { ...sp, ch: chs[0], chs, key: safe(() => E.read('Adventure.loopKey', null, chs[0]), null) ?? (sp.league === 'kanto' ? 'L' : 'L:' + sp.league) };
    }
    const ch = sp.find(); if (ch == null || ch < 0) return null;
    return { ...sp, ch, chs: [ch], key: ch };
  }
  const unlocked = () => +(S().adv?.unlocked ?? 0);
  // the only loop while a spot runs (the game's own loop switch, Adventure.toggleLoop) ...
  function soloLoop(key) {
    const loops = [...(S().adv?.loops || [])];
    for (const k of loops) if (k !== key) { try { E.call('Adventure.toggleLoop', k); } catch (__e) { __h('70-plan-23-discord:39', __e); } }
    if (!E.read('Adventure.isLooping', false, key)) { try { E.call('Adventure.toggleLoop', key); } catch (__e) { __h('70-plan-23-discord:40', __e); } }
  }
  // ... and your own list back afterwards
  function loopsBack(want) {
    const now = [...(S().adv?.loops || [])];
    for (const k of now) if (!want.includes(k)) { try { E.call('Adventure.toggleLoop', k); } catch (__e) { __h('70-plan-23-discord:45', __e); } }
    for (const k of want) if (!E.read('Adventure.isLooping', false, k)) { try { E.call('Adventure.toggleLoop', k); } catch (__e) { __h('70-plan-23-discord:46', __e); } }
  }
  const fighting = () => { const b = S().adv?.battle; return !!b && !b.over && !b.done; };
  const discord = {
    uses: 'screen',
    finishOnPause: true, // pausing puts your loops, team and chapter back too
    label: (g) => `Discord Recommended: ${SPOTS[g.spot]?.title || g.spot} (${SPOTS[g.spot]?.where || '?'})`,
    // the trainee on the team closest to Lv 100 (2.13.9 - Jimmy: the picture was one that had left the team at 100)
    sprite: (g) => { const f = focusRow(g); if (f) return f.id; const m = g.job?.uids?.[0] && E.read('Game.getMon', null, g.job.uids[0]); return m?.id || null; },
    progress: (g) => { const f = focusRow(g); return f ? { have: f.level, need: 100 } : null; },
    check(g) {
      const sp = spotOf(g.spot);
      if (!sp) return { state: 'wait', why: `can't find ${SPOTS[g.spot]?.where || 'that spot'} in this game version` };
      if (sp.ch > unlocked()) return { state: 'wait', why: `${sp.where} isn't unlocked yet` };
      if (sp.kind === 'level' && g.spot !== 'xp' && !safe(() => GoalTypes.idlePick().length, 0)) return { state: 'wait', why: 'every Pokémon is at its level cap' };
      return { state: 'ready', why: null };
    },
    async step(g, ctx) {
      const sp = spotOf(g.spot); if (!sp) return `can't find ${SPOTS[g.spot]?.where}`;
      const s = S(), a = s.adv || {};
      // leveling spots: Mega's leveling job, held to this spot, 1 carrier when that's faster
      if (sp.kind === 'level') {
        // Battle XP (Jimmy 2026-11-23, from the chart's author): battle a Pokémon until its next level needs ~5-6 M XP,
        // then it's "Ready for Candy"; when nobody is left under that, this goal becomes the Exp. Candies spot
        const xp = g.spot === 'xp';
        if (xp && g.candyAt == null) { g.candyAt = CANDY_AT; Plan.save(); }
        const pick = xp ? xpPick(g) : GoalTypes.idlePick();
        if (xp) { try { tellCandy(g); } catch (__e) { __h('70-plan-23-discord:73', __e); } }
        if (!pick.length && xp) {
          if (g.job) { try { GoalTypes.level.finish(g.job); } catch (__e) { __h('70-plan-23-discord:75', __e); } g.job = null; }
          const n = candyReady(g).length;
          g.spot = 'candy'; g.restore = null; Plan.save();
          Log.add(`Battle XP: nobody left under ${(g.candyAt / 1e6).toFixed(1)} M XP per level - switching to ${SPOTS.candy.title} (${SPOTS.candy.where}). ${n} Pokémon ready for candy.`);
          try { Notify.send('win', 'Battle XP done - on to Exp. Candies', `Everyone trainable is past ${(g.candyAt / 1e6).toFixed(1)} M XP per level. ${n} Pokémon are ready for candy; Mega now farms Exp. Candies at ${SPOTS.candy.where}.`); } catch (__e) { __h('70-plan-23-discord:79', __e); }
          return 'switching to Exp. Candies…';
        }
        if (!pick.length) return 'every Pokémon is at its level cap';
        // a re-added goal keeps the carrier you last chose for this spot (Jimmy 2026-11-23: removed + re-added -> back to Giratina)
        if (!('carrier' in g)) { const u = carrierMemo()[g.spot]; g.carrier = u && E.read('Game.getMon', null, u) ? u : null; Plan.save(); if (g.carrier) Log.add(`${discord.label(g)}: carrier ${name(E.read('Game.getMon', {}, g.carrier)?.id)} (your last choice for this spot)`); }
        const force = { ch: sp.ch, chs: sp.chs, key: sp.key, name: sp.where, carry1: true, carrier: g.carrier || null };
        const atCap = (j) => j.uids.every((u) => (E.read('Game.getMon', null, u)?.level ?? 999) >= Math.min(100, E.read('Game.capFor', 100, E.read('Game.getMon', null, u)) || 100));
        if (!g.job) { g.job = { id: g.id + ':job', type: 'level', uids: pick, target: 100, idle: true, started: Date.now(), force }; Plan.save(); Log.add(`${discord.label(g)}: leveling ${pick.map((u) => name(E.read('Game.getMon', {}, u)?.id)).join(', ')}`); }
        else if (xp && g.job.uids.some((u) => !pick.includes(u))) { const keep = g.job.uids.filter((u) => pick.includes(u)); g.job.uids = [...keep, ...pick.filter((u) => !keep.includes(u))].slice(0, pick.length); g.job.startLv = null; Plan.save(); Log.add(`${discord.label(g)}: now ${g.job.uids.map((u) => name(E.read('Game.getMon', {}, u)?.id)).join(', ')} (the others reached ${(g.candyAt / 1e6).toFixed(1)} M XP per level - ready for candy)`); }
        else if (atCap(g.job) && pick.join() !== g.job.uids.join()) { g.job.uids = pick; g.job.carriersFor = null; g.job.startLv = null; Plan.save(); Log.add(`${discord.label(g)}: now ${pick.map((u) => name(E.read('Game.getMon', {}, u)?.id)).join(', ')}`); }
        g.job.force = force; g.job.candyAt = xp ? g.candyAt : null;
        if (sp.berry === 'xp' && g.spot === 'mix') Berries.keep('money', 'farming Giant Chasm');
        let kept = '';
        for (const fam of SPOTS[g.spot]?.keep || []) { try { kept += Berries.keep(fam, `${SPOTS[g.spot].title}: ${fam} berry 24/7`); } catch (__e) { __h('70-plan-23-discord:93', __e); } }
        const line = await GoalTypes.level.step(g.job, ctx);
        if (['xp', 'axsiom', 'mix'].includes(g.spot)) { try { sampleXp(g); } catch (__e) { __h('70-plan-23-discord:95', __e); } }
        try { tallyRun(g); } catch (__e) { __h('70-plan-23-discord:96', __e); }
        return `${line}${g.job.nCarry === 1 ? ' · 1 carrier' : ''}${kept}`;
      }
      // sweep spots: your 6 fastest clearers of it, on a loop
      if (!g.restore) { g.restore = { team: [...(s.team || [])], chapter: a.chapter, loops: [...(a.loops || [])] }; Plan.save(); Log.add(`${discord.label(g)}: going to ${sp.where}. Your team, chapter and loops come back when it stops.`); }
      if (a.zone) { if (fighting()) return 'waiting for this fight to end before leaving the zone…'; try { E.call('Adventure.leaveZone'); } catch (__e) { __h('70-plan-23-discord:101', __e); } return 'leaving the legendary zone…'; }
      if (!sp.chs.includes(+a.chapter)) {
        if (fighting()) return 'waiting for this fight to end before moving…';
        if (E.call('Adventure.setChapter', sp.ch) === false) return `waiting: the game would not open ${sp.where}`;
        return `moving to ${sp.where}…`;
      }
      soloLoop(sp.key);
      try { XpChap.tick(+a.chapter); } catch (__e) { __h('70-plan-23-discord:108', __e); }
      if (g.carriersFor !== sp.ch || g.carriersV !== Sim.CARRIER_V) {
        let picks = []; try { picks = Sim.carriers(sp.ch, { n: 6 }).picks; } catch (__e) { __h('70-plan-23-discord:110', __e); }
        g.carriersFor = sp.ch; g.carriersV = Sim.CARRIER_V; g.carriers = picks.map((p) => p.m.uid); Plan.save();
        if (picks.length && setChapterTeam(g.carriers)) Log.add(`${discord.label(g)}: team ${picks.map((p) => name(p.m.id)).join(', ')} (fastest to clear it)`);
      }
      const berry = sp.berry ? Berries.keep(sp.berry, `farming ${sp.where}`) : '';
      const have = +(s.money ?? 0);
      if (g.from == null) { g.from = have; g.fromAt = Date.now(); g.candy0 = candyNow(); Plan.save(); }
      const hrs = (Date.now() - g.fromAt) / 3_600_000;
      const money = hrs > 0.05 ? ` · ~₽${Math.round((have - g.from) / hrs).toLocaleString()}/h so far` : '';
      const cd = candyNow() - (g.candy0 || 0), candy = g.spot === 'candy' && hrs > 0.05 ? ` · ${cd} Exp. Candies so far` : '';
      return `farming ${sp.where}${money}${candy}${berry}`;
    },
    finish(g) {
      if (g.job) { try { GoalTypes.level.finish(g.job); } catch (__e) { __h('70-plan-23-discord:123', __e); } g.job = null; }
      const r = g.restore; if (!r) { Plan.save(); return; }
      if (r.loops) loopsBack(r.loops);
      const back = (r.team || []).filter((u) => E.read('Game.getMon', null, u)); if (back.length) setChapterTeam(back);
      if (!S().adv?.zone && r.chapter != null && +S().adv?.chapter !== +r.chapter) { try { E.call('Adventure.setChapter', +r.chapter); } catch (__e) { __h('70-plan-23-discord:127', __e); } }
      g.restore = null; Plan.save();
      Log.add(`${discord.label(g)}: stopped - your team, chapter and loops are back`);
    },
  };
  // who can be the carrier (the goal's "Carrier" menu): your fully-leveled Pokémon, strongest first
  function carrierChoices(n = 40) {
    const G = E.get('Game'), st = (m) => { try { const s = G.statsOf(m); return s.hp + s.def + s.spd + s.spe + Math.max(s.atk, s.spa); } catch { return 0; } };
    return (E.read('Game.ownedMons', []) || []).filter((m) => m.level >= 100).sort((a, b) => st(b) - st(a)).slice(0, n).map((m) => ({ uid: m.uid, id: m.id, rank: m.rank || 0, name: `${name(m.id)}${m.shiny ? ' ✨' : ''}${m.rank ? ' ' + (['', 'I', 'II', 'III', 'IV', 'V'][m.rank] || m.rank) : ''}` }));
  }
  // every Exp. Candy you hold (the candy spot counts what it brings in)
  function candyNow() { let n = 0; for (const k of ['exp-candy-s', 'exp-candy-m', 'exp-candy-big', 'exp-candy-xl', 'rare-candy']) n += +E.read('Game.itemCount', 0, k) || 0; return n; }
  // ---- Battle XP card (Jimmy 2026-11-23): each Pokémon it levels, its level, a bar to Lv 100 and the time left ----
  // Total XP so far = the XP of every level below + the XP into this one (Game.xpForNext(level, mon) - it grows with
  // rank). Sampled every step; the rate is each Pokémon's own gain over the last 20 min (a rank-up resets it).
  const xpNeed = (m, l) => +safe(() => E.get('Game').xpForNext(l, m), 0) || 0;
  const xpTotal = (m) => { let t = 0; for (let l = 1; l < m.level; l++) t += xpNeed(m, l); return t + (+m.xp || 0); };
  const xpTo100 = (m) => { if (m.level >= 100) return 0; let t = Math.max(0, xpNeed(m, m.level) - (+m.xp || 0)); for (let l = m.level + 1; l < 100; l++) t += xpNeed(m, l); return t; };
  const xpLog = new Map(); // uid -> [[t, total, rank]]
  function sampleXp(g) {
    const now = Date.now();
    for (const u of new Set([...(S().team || []), ...(g.job?.uids || []), ...(g.job?.extra || [])])) {
      const m = E.read('Game.getMon', null, u); if (!m) continue;
      const tot = xpTotal(m), r = +(m.rank || 0), L = xpLog.get(u) || [];
      if (L.length && (tot < L[L.length - 1][1] || r !== L[L.length - 1][2])) L.length = 0; // ranked up / reset
      if (!L.length || now - L[L.length - 1][0] > 15e3) L.push([now, tot, r]);
      while (L.length > 2 && now - L[0][0] > 20 * 60e3) L.shift();
      xpLog.set(u, L);
    }
  }
  function focusRow(g) {
    let R = []; try { R = trainRows(g); } catch { return null; }
    const left = R.filter((r) => r.level < 100).sort((x, y) => y.pct - x.pct);
    return left[0] || null;
  }
  function trainRows(g) {
    if (g?.type !== 'discord' || !['xp', 'axsiom', 'mix'].includes(g.spot) || !g.job) return [];
    const carry = new Set(g.job.nCarry ? (g.job.carriers || []).slice(0, g.job.nCarry) : []);
    // the team as it is now (a trainee that reached Lv 100 is swapped out for the next one - Jimmy 2026-11-23: the card
    // still showed Gyarados after it hit 100); the goal's own list only when the team isn't set yet
    const team = (S().team || []).filter((u) => !carry.has(u));
    const list = team.length ? team : [...new Set([...(g.job.uids || []), ...(g.job.extra || [])])].filter((u) => !carry.has(u));
    return list.map((u) => {
      const m = E.read('Game.getMon', null, u); if (!m) return null;
      const need = xpNeed(m, m.level), frac = m.level >= 100 ? 1 : Math.min(0.999, (+m.xp || 0) / Math.max(1, need));
      const L = xpLog.get(u) || [], span = L.length > 1 ? (L[L.length - 1][0] - L[0][0]) : 0;
      const rate = span >= 120e3 ? (L[L.length - 1][1] - L[0][1]) / span : null; // XP per ms, after 2 min of data
      const left = xpTo100(m), eta = m.level >= 100 ? 0 : rate > 0 ? left / rate : null;
      return { uid: u, id: m.id, shiny: !!m.shiny, rank: +(m.rank || 0), level: m.level, pct: Math.min(1, (m.level + frac) / 100), eta, perH: rate ? rate * 3.6e6 : null };
    }).filter(Boolean);
  }
  const etaText = (ms) => { if (ms == null) return 'measuring…'; if (ms <= 0) return 'Lv 100 ✔'; const m = Math.round(ms / 60e3); return m < 60 ? `~${m} min` : m < 48 * 60 ? `~${Math.floor(m / 60)} h${m % 60 ? ' ' + (m % 60) + ' min' : ''}` : `~${Math.round(m / 1440)} days`; };
  // ---- this run's take (Jimmy 2026-11-23, the Axsiom card): money earned and berries collected since the goal began ----
  // Money: the game's own running total of money earned (stats.earned). Berries: every rise in a berry's count is
  // counted (sampled each step), so berries the plan uses up meanwhile don't hide the ones that dropped.
  const berryCounts = () => Object.fromEntries(Object.entries(S().items || {}).filter(([k]) => /berry/.test(k)).map(([k, n]) => [k, +n || 0]));
  function tallyRun(g) {
    const earned = +(S().stats?.earned || 0), now = berryCounts();
    if (!g.run) { g.run = { at: Date.now(), e0: earned, got: {}, last: now }; Plan.save(); return; }
    let ch = false;
    // money: add each rise of stats.earned (2.13.14 - the game keeps it per region, so a total minus the start went to 0)
    if (g.run.eLast == null) { g.run.eLast = earned; g.run.money = g.run.money || 0; ch = true; }
    else if (earned !== g.run.eLast) { if (earned > g.run.eLast) g.run.money = (g.run.money || 0) + (earned - g.run.eLast); g.run.eLast = earned; ch = true; }
    for (const [k, n] of Object.entries(now)) { const d = n - (g.run.last[k] ?? n); if (d > 0) { g.run.got[k] = (g.run.got[k] || 0) + d; ch = true; } }
    if (Object.keys(now).some((k) => now[k] !== g.run.last[k])) { g.run.last = now; ch = true; }
    if (ch) Plan.save();
  }
  // English from the item's own key (the game's display names are French: "Baie Frist"): "starf-berry" / "berry-oran"
  const berryName = (k) => String(k).replace(/^berry-/, '').replace(/-berry$/, '').split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') + ' Berry';
  function runTake(g) {
    if (!g?.run) return null;
    const money = g.run.money != null ? g.run.money : Math.max(0, +(S().stats?.earned || 0) - (g.run.e0 || 0));
    const berries = Object.entries(g.run.got || {}).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ key: k, name: berryName(k), n }));
    return { since: g.run.at, money, berries };
  }
  // ---- Ready for Candy ----
  const CANDY_AT = 5.5e6; // XP to the next level where battling stops paying (the chart author's ~5-6 M)
  const tierOrder = () => { const o = new Map(); try { GemFocus.watchRows().forEach((r, i) => o.set(r.m?.uid, i)); } catch (__e) { __h('70-plan-23-discord:204', __e); } return o; };
  const awaySet = () => new Set((E.read('Game.underMons', []) || []).map((m) => m.uid));
  const capFor = (m) => Math.min(100, +E.read('Game.capFor', 100, m) || 100);
  const slow = (m, at) => xpNeed(m, m.level) >= at;
  // who battles next: under the limit, in Mega's trainee order (favourites by rank, then the rest by rank, shinies first); one per species
  function xpPick(g, n = 5) {
    const away = awaySet(), seen = new Set(), out = [];
    const idle = GoalTypes.idlePick(400), rank = new Map(idle.map((u, i) => [u, i]));
    const mons = idle.map((u) => E.read('Game.getMon', null, u)).filter((m) => m && !away.has(m.uid) && m.level < capFor(m) && !slow(m, g.candyAt || CANDY_AT) && m.uid !== g.carrier);
    mons.sort((a, b) => rank.get(a.uid) - rank.get(b.uid)); // Mega's idle order (the tier-list order is for the candy list)
    for (const m of mons) { const sp = safe(() => Sim.species(m), m.id); if (seen.has(sp)) continue; seen.add(sp); out.push(m.uid); if (out.length >= n) break; }
    return out;
  }
  // everyone past the limit who still has levels to go: tier-list picks first, then the highest level
  function candyReady(g) {
    const at = g?.candyAt || CANDY_AT, ord = tierOrder(), away = awaySet();
    return (S().mons || []).filter((m) => !away.has(m.uid) && m.level < capFor(m) && slow(m, at))
      .map((m) => ({ uid: m.uid, id: m.id, level: m.level, rank: +(m.rank || 0), shiny: !!m.shiny, left: xpTo100(m), next: xpNeed(m, m.level), tier: ord.has(m.uid) }))
      .sort((a, b) => (b.tier - a.tier) || (a.tier ? ord.get(a.uid) - ord.get(b.uid) : 0) || b.level - a.level);
  }
  // a phone alert when a Pokémon this goal trained joins the list (once each)
  function tellCandy(g) {
    const R = candyReady(g), told = new Set(g.candyTold || []), mine = new Set([...(g.job?.uids || []), ...(g.job?.extra || [])]);
    const fresh = R.filter((r) => mine.has(r.uid) && !told.has(r.uid));
    if (!fresh.length) return;
    g.candyTold = [...told, ...fresh.map((r) => r.uid)].slice(-200); Plan.save();
    const nm = fresh.map((r) => name(r.id)).join(', ');
    Log.add(`Ready for candy: ${nm} (next level needs ${(fresh[0].next / 1e6).toFixed(1)} M XP)`);
    try { Notify.send('win', 'Ready for candy', `${nm} ${fresh.length === 1 ? 'is' : 'are'} past ${((g.candyAt || CANDY_AT) / 1e6).toFixed(1)} M XP per level - battling is slow now. Use Exp. Candies (Mega's Now tab lists them).`); } catch (__e) { __h('70-plan-23-discord:232', __e); }
  }
  // your carrier choice per spot, kept across goals (localStorage mega-discord-carrier: { spot: uid })
  const MEMO = 'mega-discord-carrier';
  function carrierMemo() { try { return JSON.parse(localStorage.getItem(MEMO) || '{}') || {}; } catch { return {}; } }
  function setCarrier(g, uid) { g.carrier = uid || null; if (g.job) g.job.carriersFor = null; const m = carrierMemo(); if (g.carrier) m[g.spot] = g.carrier; else delete m[g.spot]; try { localStorage.setItem(MEMO, JSON.stringify(m)); } catch (__e) { __h('70-plan-23-discord:237', __e); } Plan.save(); }
  Object.assign(GoalTypes, { discord, carrierChoices, setCarrier, trainRows, etaText, candyReady, CANDY_AT, runTake, soloLoop, loopsBack, discordSpots: SPOTS, discordSpot: spotOf });
})();

/* ===================================================================================================
 * Chains - goals that plan themselves. A legendary that's locked gets the goals it needs added for it.
 * The game describes each unlock with a few building blocks (LegendZones.ZONES[].cond):
 *   owns {ids}      -> a catch goal for each one you don't own (its legendary zone, or its best route)
 *   item {item}     -> find that item where the game hides it (a rare-item goal)
 *   dex             -> complete that region's Pokédex
 *   league {region} -> beat that region's League
 *   all {list}      -> every one of the above
 * The rest (braille doors, a trainer tally, owning N species, a type count) Mega can't do for you:
 * they're listed as "needs you". Each locked goal is looked at every 30 minutes; a goal you remove
 * is not added back for the same legendary.
 * =================================================================================================== */
const Chains = (() => {
  const E = Engine, LZ = () => E.get('LegendZones'), D = () => E.get('Game.DEX') || {};
  const own = (id) => !!E.read('Game.owns', false, +id);
  const nameOf = (id) => D()[+id]?.name || '#' + id;
  const KEY = 'mega-chain-removed';
  let removed = {}; try { removed = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (__e) { __h('71-chains:18', __e); }
  const on = () => { try { return JSON.parse(localStorage.getItem('mega-chains') ?? 'true') !== false; } catch { return true; } };
  function setOn(v) { try { localStorage.setItem('mega-chains', JSON.stringify(!!v)); } catch (__e) { __h('71-chains:20', __e); } }
  const zoneOf = (id) => (LZ()?.ZONES || []).find((z) => +z.id === +id || (z.forms || []).includes(+id));

  // what one condition still needs, as steps
  function steps(cond, z, out = []) {
    if (!cond) return out;
    if (cond.kind === 'all') { for (const c of cond.list || []) steps(c, z, out); return out; }
    if (cond.kind === 'owns') { for (const id of cond.ids || []) if (!own(id)) out.push({ kind: 'own', id: +id }); return out; }
    if (cond.kind === 'item') { if (!(+E.read('Game.itemCount', 0, cond.item) > 0) && !E.get('Game.S')?.adv?.gifts?.[cond.item]) out.push({ kind: 'item', item: cond.item, text: cond.text }); return out; }
    if (cond.kind === 'dex') { const reg = z?.region; if (reg && !dexDone(z)) out.push({ kind: 'dex', region: reg }); return out; }
    if (cond.kind === 'league') { if (!E.read('Game.regionCleared', false, cond.region)) out.push({ kind: 'league', region: cond.region }); return out; }
    out.push({ kind: 'manual', text: cond.text || cond.kind }); return out;
  }
  // the game's own count for that zone (Shaymin: 101 of 102 Sinnoh entries)
  function dexDone(z) {
    try { const p = LZ().progress(z); const line = (p?.lines || []).find((l) => /Pokédex|Pokedex/i.test(l.text || '')) || p; return !line || +line.have >= +line.need; } catch { return true; }
  }
  // the goal that covers one step (or null when Mega can't do it); returns [type, data, label]
  function goalFor(s) {
    if (s.kind === 'own') {
      const z = zoneOf(s.id);
      if (z && +z.id === +s.id) return ['legend', { foe: s.id }, `Catch ${nameOf(s.id)}`];
      return ['dex', { id: s.id }, `Catch ${nameOf(s.id)}`];
    }
    if (s.kind === 'item') {
      const it = (() => { try { return DexInfo.rareItems().find((x) => x.key === s.item); } catch { return null; } })();
      const L = it?.spots?.[0]; if (!L) return null;
      return ['loot', { item: it.key, ch: L.ch, place: L.place, need: it.need }, `Find ${it.name}`];
    }
    if (s.kind === 'dex') return ['region', { reg: s.region }, `Complete the ${s.region} Pokédex`];
    if (s.kind === 'league') return ['story', { region: s.region, regionName: s.region[0].toUpperCase() + s.region.slice(1) }, `Beat the ${s.region} League`];
    return null;
  }
  const has = (type, data) => Plan.goals.some((g) => !g.done && g.type === type && (
    type === 'legend' ? +g.foe === +data.foe : type === 'loot' ? g.item === data.item : type === 'region' ? g.reg === data.reg : type === 'story' ? g.region === data.region : false));
  // add what goal g's legendary still needs; returns { added: [labels], manual: [texts] }
  function addFor(g) {
    const z = zoneOf(g.foe); if (!z || !z.cond || !on()) return { added: [], manual: [] };
    const need = steps(z.cond, z), added = [], manual = [];
    for (const s of need) {
      if (s.kind === 'manual') { manual.push(s.text); continue; }
      const k = `${g.foe}:${s.kind}:${s.id || s.item || s.region}`;
      if (removed[k]) continue;
      const gf = goalFor(s); if (!gf) { manual.push(s.text || `${s.kind} ${s.item || ''}`); continue; }
      const [type, data, label] = gf;
      if (type === 'dex') { if (Plan.goals.some((x) => !x.done && +x.foe === +data.id)) continue; try { if (addDexJob(data.id)) added.push(label); } catch (__e) { __h('71-chains:65', __e); } }
      else if (!has(type, data)) { if (Plan.add(type, data)) added.push(label); }
      const kid = Plan.goals.filter((x) => !x.done).slice(-1)[0]; if (kid && added.includes(label)) { kid.chainFor = g.foe; kid.chainKey = k; }
    }
    if (added.length) { try { Log.add(`${nameOf(g.foe)} needs more first - added: ${added.join(', ')}`); Plan.save(); } catch (__e) { __h('71-chains:69', __e); } }
    return { added, manual };
  }
  // a chained goal you removed is not added back for the same legendary
  function forget(g) { if (g?.chainKey) { removed[g.chainKey] = Date.now(); try { localStorage.setItem(KEY, JSON.stringify(removed)); } catch (__e) { __h('71-chains:73', __e); } } }
  return { steps, addFor, forget, setOn, get on() { return on(); } };
})();

/* ---------------------------------------------------------------------------------------------
 * Notify: phone alerts through ntfy.sh (same as Alakazam 4.x, and the same topic by default, so a
 * phone already subscribed keeps working). Only the title and text below are sent.
 *   kinds:  win (legendary / shiny / goal done)  ·  dex (new Pokédex entries, Lv 100)
 *           daily (raid / factory / tower / Underground results)  ·  ready (a daily is up for the day)
 *           problem (Mega is stuck)
 * Quiet hours (11 PM - 8 AM) hold everything but problems. The same alert isn't repeated within 6 h.
 * Milestones are found by comparing the save every 10 s (dex, shinies, Lv 100, badges).
 * ------------------------------------------------------------------------------------------- */
const Notify = (() => {
  const E = Engine;
  const KEY = 'mega-notify', MS = 'mega-ms';
  const KINDS = { win: 'Big wins (legendaries, shinies, goals done)', dex: 'New Pokédex entries and Lv 100s', daily: 'Daily results (raid, factory, tower, Underground)', ready: 'Dailies ready (one alert each when it is up for the day)', problem: 'Problems (Mega is stuck and needs you)', egg: 'Day Care: an egg is ready to hatch', trade: 'Trades: a Pokémon you\'re missing, for a spare you have' };
  const newTopic = () => 'mega-alakazam-' + Array.from(crypto.getRandomValues(new Uint8Array(9))).map((n) => 'abcdefghijkmnpqrstuvwxyz23456789'[n % 32]).join('');
  let cfg = (() => {
    let c = null; try { c = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (__e) { __h('75-notify:16', __e); }
    if (!c) { // first time: take over 4.x's topic so the phone that already gets alerts keeps getting them
      let old = {}; try { old = JSON.parse(localStorage.getItem('pc-helper-cfg') || '{}'); } catch (__e) { __h('75-notify:18', __e); }
      c = { on: !!old.pushTopic, topic: old.pushTopic || '', kinds: { win: true, dex: true, daily: true, ready: true, problem: true }, quiet: !!old.pushQuiet, last: null };
    }
    return c;
  })();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (__e) { __h('75-notify:23', __e); } };
  const seen = new Map();
  const clean = (t) => { const v = String(t || '').replace(/\s+/g, ' ').trim(); try { return Casing.names(v); } catch { return v; } };

  // Alerts through Mega Relay (Web Push to the phone's Home Screen app - no ntfy, no limit) when
  // the relay is on and at least one phone turned alerts on there; ntfy is the backup.
  let viaRelay = null; // { at, ok, subs, err }
  async function relaySend(kind, title, body) {
    let on = false; try { on = Remote.info?.relay; } catch (__e) { __h('75-notify:31', __e); }
    if (!on) return false;
    try {
      const r = await fetch('http://127.0.0.1:8787/push/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: clean(title).slice(0, 110), body: clean(body).slice(0, 380), tag: kind, urgent: kind === 'problem' }) });
      if (!r.ok) throw new Error('Mega Relay said ' + r.status);
      const j = await r.json(); viaRelay = { at: Date.now(), ok: j.sent > 0, subs: j.subs, err: j.err };
      return j.sent > 0;
    } catch (e) { viaRelay = { at: Date.now(), ok: false, subs: viaRelay?.subs ?? null, err: e.message }; return false; }
  }
  async function send(kind, title, body, force = false) {
    try { title = Casing.names(String(title)); body = Casing.names(String(body)); } catch (__e) { __h('75-notify:41', __e); }
    let relayOn = false; try { relayOn = !!Remote.info?.relay; } catch (__e) { __h('75-notify:42', __e); }
    if (!cfg.topic && !relayOn) return false;
    if (!force) {
      if (cfg.kinds[kind] == null) { cfg.kinds[kind] = true; save(); } // new kinds start on
      if (!cfg.on || !cfg.kinds[kind]) return false;
      if (cfg.quiet && kind !== 'problem') { const h = new Date().getHours(); if (h >= 23 || h < 8) return false; }
      const k = `${kind}|${title}|${body}`;
      if (Date.now() - (seen.get(k) || 0) < 6 * 3_600_000) return false;
      seen.set(k, Date.now());
    }
    if (await relaySend(kind, title, body)) { cfg.last = { at: Date.now(), ok: true, what: clean(title), via: 'relay' }; save(); return true; }
    if (!cfg.topic) { cfg.last = { at: Date.now(), ok: false, err: 'Mega Relay could not deliver it' + (viaRelay?.err ? ' (' + viaRelay.err + ')' : viaRelay?.subs === 0 ? ' - no phone has turned alerts on yet' : '') }; save(); return false; }
    try {
      const click = (() => { try { return Remote.on ? Remote.pairLink() : null; } catch { return null; } })(); // tap the alert -> Kinesis
      const r = await fetch('https://ntfy.sh/', { method: 'POST', body: JSON.stringify({ topic: cfg.topic, title: clean(title).slice(0, 90), message: clean(body).slice(0, 300), priority: kind === 'problem' ? 4 : 3, tags: [{ win: 'trophy', dex: 'book', daily: 'calendar', problem: 'warning', trade: 'arrows_counterclockwise' }[kind] || 'sparkles'], ...(click ? { click } : {}) }) });
      if (!r.ok) throw new Error('ntfy said ' + r.status);
      cfg.last = { at: Date.now(), ok: true, what: clean(title), via: 'ntfy' }; save();
      return true;
    } catch (e) { cfg.last = { at: Date.now(), ok: false, err: e.message }; save(); Log.add('phone alert failed: ' + e.message); return false; }
  }

  // ---- milestones from the save ----
  const name = (id) => E.get('Game.DEX')?.[id]?.name || '#' + id;
  const list = (n) => (n.length === 1 ? n[0] : n.length === 2 ? `${n[0]} and ${n[1]}` : n.length === 3 ? `${n[0]}, ${n[1]} and ${n[2]}` : `${n[0]}, ${n[1]} and ${n.length - 2} more`);
  // each region's level cap (the game's own regionCap): it goes up with every gym and Elite Four member
  function capsNow(S) {
    const ST = E.get('STORY'), out = {};
    try { for (let i = 0; i < ST.CHAPTERS.length; i++) { const r = ST.regionOf(i)?.key; if (r && out[r] == null) out[r] = +ST.regionCap(S.adv, r) || 100; } } catch (__e) { __h('75-notify:69', __e); }
    return out;
  }
  function snap() {
    const S = E.get('Game.S') || {}, mons = E.read('Game.allMons', []) || [];
    return { dex: Object.keys(S.dex || {}).map(Number), shiny: mons.filter((m) => m.shiny).map((m) => m.uid), l100: mons.filter((m) => m.level >= 100).map((m) => m.uid), badges: (S.adv?.badges || []).length, caps: capsNow(S) };
  }
  let last = (() => { try { return JSON.parse(localStorage.getItem(MS) || 'null'); } catch { return null; } })();
  function milestones() {
    if (!E.ready()) return;
    // Remember everything ever seen (never forget): Pokémon away on an activity (Underground,
    // Day Care…) drop out of the list and come back later - that's not a new shiny or a new Lv 100.
    const cur = snap(), union = (a, b) => [...new Set([...(a || []), ...(b || [])])];
    const keep = () => { last = { dex: union(cur.dex, last?.dex), shiny: union(cur.shiny, last?.shiny), l100: union(cur.l100, last?.l100), badges: Math.max(cur.badges, last?.badges || 0), caps: { ...(last?.caps || {}), ...cur.caps }, v: 2 }; try { localStorage.setItem(MS, JSON.stringify(last)); } catch (__e) { __h('75-notify:82', __e); } };
    if (!cur.dex.length) return; // save not loaded yet
    if (!last || !Array.isArray(last.dex) || last.v !== 2) return keep(); // first run of this version: learn quietly, no alerts
    const added = (a, b) => { const had = new Set(b || []); return (a || []).filter((x) => !had.has(x)); };
    const D = E.get('Game.DEX') || {}, total = Object.keys(D).length;
    const nd = added(cur.dex, last.dex), leg = nd.filter((id) => D[id]?.legendary || D[id]?.mythical), mon = nd.filter((id) => !leg.includes(id));
    if (leg.length) send('win', `${list(leg.map(name))} caught!`, `${cur.dex.length} of ${total} in the Pokédex`);
    if (mon.length) send('dex', `${list(mon.map(name))} added to the Pokédex`, `${cur.dex.length} of ${total} recorded`);
    const sh = added(cur.shiny, last.shiny);
    if (sh.length) send('win', `Shiny ${list(sh.map((u) => name(E.read('Game.getMon', {}, u)?.id)))}!`, `You now have ${cur.shiny.length} shiny Pokémon`);
    const l1 = added(cur.l100, last.l100);
    if (l1.length) send('dex', `${list(l1.map((u) => name(E.read('Game.getMon', {}, u)?.id)))} reached Lv 100`, `${cur.l100.length} of your Pokémon are Lv 100`);
    if (cur.badges > last.badges) send('win', 'Badge earned', `${cur.badges} badges now`);
    for (const [r, c] of Object.entries(cur.caps || {})) {
      const was = last.caps?.[r];
      if (was && c > was) send('win', `${r[0].toUpperCase() + r.slice(1)} level cap is now Lv ${c}`, c >= 100 ? 'No cap left there - your Pokémon from that region can reach Lv 100' : `Up from Lv ${was} - leveling picks back up`);
    }
    keep();
  }

  // ---- problems: a goal stuck on an error, or the whole plan blocked for a while ----
  const stuckSince = new Map();
  function problems() {
    if (!Plan.running) { stuckSince.clear(); return; }
    const check = (key, bad, title, body) => {
      if (!bad) { stuckSince.delete(key); return; }
      if (!stuckSince.has(key)) stuckSince.set(key, Date.now());
      else if (Date.now() - stuckSince.get(key) > 10 * 60_000) { send('problem', title, body); stuckSince.set(key, Date.now() + 6 * 3_600_000); }
    };
    check('old', Plan.oldOn(), 'Mega is waiting', 'Alakazam 4.x is switched on, so the plan can\'t act. Switch it off in Mega\'s Plan tab.');
    for (const g of Plan.goals.filter((x) => !x.done)) {
      const L = Plan.live(g.id) || {};
      check('g' + g.id, /error|could not|refused|zone 3 times|did not/i.test((L.why || '') + ' ' + (L.line || '')), `Mega: ${Plan.label(g)} is stuck`, L.why || L.line || 'see the log');
    }
    const a = E.audit(); check('engine', a.missing?.length, 'Mega lost part of the game', `${a.missing.length} game functions are missing after a game update - Mega may not work right`);
  }

  let timer = null;
  // ---- weekly summary: Sunday 6 PM (your PC's time) - levels, catches, gems, money, goals finished ----
  const WK = 'mega-week';
  function weekNow() {
    const S = E.get('Game.S') || {}, mons = E.read('Game.allMons', []) || [];
    let gems = { total: 0, spent: 0 }; try { const g = EliteInfo.gems(); gems = { total: +g.total || 0, spent: +g.spent || 0 }; } catch (__e) { __h('75-notify:124', __e); }
    return { at: Date.now(), dex: Object.keys(S.dex || {}).length, shiny: mons.filter((m) => m.shiny).length, l100: mons.filter((m) => m.level >= 100).length,
      lv: Object.fromEntries(mons.map((m) => [m.uid, m.level])), money: History.homeMoney(), gems };
  }
  function nextSunday(t) { const d = new Date(t); d.setHours(18, 0, 0, 0); d.setDate(d.getDate() + ((7 - d.getDay()) % 7)); if (d.getTime() <= t) d.setDate(d.getDate() + 7); return d.getTime(); }
  function weekly(force) {
    if (!E.ready()) return;
    let base = null; try { base = JSON.parse(localStorage.getItem(WK) || 'null'); } catch (__e) { __h('75-notify:131', __e); }
    const cur = weekNow(); if (!cur.dex) return; // save not loaded yet
    if (!base) { localStorage.setItem(WK, JSON.stringify(cur)); localStorage.setItem('mega-week-done', '[]'); return; } // first run: start counting from now
    if (!force && Date.now() < nextSunday(base.at)) return;
    let levels = 0; for (const [u, lv] of Object.entries(cur.lv)) { const was = base.lv?.[u]; levels += was == null ? 0 : Math.max(0, lv - was); }
    const gemsIn = (cur.gems.total - base.gems.total) + (cur.gems.spent - base.gems.spent), money = cur.money - base.money;
    let done = []; try { done = JSON.parse(localStorage.getItem('mega-week-done') || '[]'); } catch (__e) { __h('75-notify:137', __e); }
    const n = (x, one, many) => `${x.toLocaleString()} ${x === 1 ? one : many}`;
    const lines = [
      `${n(levels, 'level', 'levels')} gained · ${n(cur.l100 - base.l100, 'new Lv 100', 'new Lv 100s')}`,
      `${n(cur.dex - base.dex, 'new Pokédex entry', 'new Pokédex entries')} (${cur.dex} now) · ${n(cur.shiny - base.shiny, 'new shiny', 'new shinies')}`,
      `${n(Math.max(0, gemsIn), 'gem', 'gems')} earned${cur.gems.spent > base.gems.spent ? `, ${cur.gems.spent - base.gems.spent} spent` : ''} · money ${money >= 0 ? '+' : '-'}₽${Math.abs(money).toLocaleString()}`,
      done.length ? `Goals finished (${done.length}): ${done.slice(-6).join(', ')}${done.length > 6 ? '…' : ''}` : 'No goals finished this week',
    ];
    send('daily', 'Your week in Poke\'Catch', lines.join('\n'), true);
    if (!force) { localStorage.setItem(WK, JSON.stringify(cur)); localStorage.setItem('mega-week-done', '[]'); }
    return lines;
  }
  function boot() { if (timer) return; timer = setInterval(() => { try { milestones(); } catch (__e) { __h('75-notify:149', __e); } try { problems(); } catch (__e) { __h('75-notify:149', __e); } try { weekly(); } catch (__e) { __h('75-notify:149', __e); } }, 10_000); }
  return {
    boot, send, KINDS, weekly,
    get cfg() { return cfg; },
    get viaRelay() { return viaRelay; },
    set(k, v) { cfg[k] = v; save(); },
    setKind(k, v) { cfg.kinds[k] = !!v; save(); },
    newTopic() { cfg.topic = newTopic(); save(); return cfg.topic; },
    test: () => send('win', 'Mega Alakazam test', 'Phone alerts work! You\'ll get wins, Pokédex entries, daily results and problems here.', true),
  };
})();

/* ---------------------------------------------------------------------------------------------
 * Dailies (2.17.0, Jimmy 2026-11-25): which dailies are up for the day, read straight from the game.
 * One phone alert per daily when it comes up (kind 'ready' - its own switch in Settings), a
 * "Today's Dailies" card at the top of Now (Mega and Kinesis), and a line in the status card.
 * Game day = the Shiny Raid's (resets 3 PM Pacific); the Battle Tower goes by its week.
 * ------------------------------------------------------------------------------------------- */
const Dailies = (() => {
  const E = Engine, KEY = 'mega-daily-told';
  const t = (f, d = null) => { try { return f(); } catch { return d; } };
  const name = (id) => t(() => Casing.names(E.get('Game.DEX')[id].name), '#' + id);
  const day = () => t(() => E.get('Raids').dateKey(), new Date().toISOString().slice(0, 10));
  // state: ready (up and not done) · run (going now) · done (finished for today) · closed (not today) · off (locked)
  const LIST = [
    { key: 'raid', icon: '✨', name: 'Shiny Raid', read() {
      const R = E.get('Raids'); if (!R || !t(() => R.unlocked(), false)) return { state: 'off' };
      const reg = t(() => R.drawn()); if (!reg) return { state: 'closed', line: 'not drawn yet' };
      const ev = E.get('Game.S')?.adv?.event;
      if (ev?.raid && ev.reg === reg && ev.date !== 'fete15') return { state: 'run', line: 'raid going' };
      if (t(() => R.done(reg), false)) return { state: 'done', line: 'caught' };
      const boss = t(() => R.lane().find((x) => x.key === reg)?.boss);
      return { state: 'ready', line: boss ? `today: ${name(boss)}` : `today: ${reg}` };
    } },
    { key: 'bloc', icon: '🍡', name: 'Pokéblock Boss', read() {
      const B = E.get('BlocBoss'); if (!B || !t(() => B.unlocked(), false)) return { state: 'off' };
      if (t(() => B.playedToday(), false)) return { state: 'done' };
      // the game's own reason: 'played' (done), 'day' (today's boss isn't loaded yet), anything else = not now
      const w = t(() => B.why());
      if (w === 'played') return { state: 'done' };
      if (w === 'day' && Date.now() - (this.ask || 0) > 5 * 60_000) { this.ask = Date.now(); try { B.loadDay(); } catch (__e) { __h('76-dailies:29', __e); } } // ask the game for today's boss (the Pokéblock goal does the same)
      if (w) return { state: 'closed', line: w === 'day' ? "today's boss not loaded yet" : String(w) };
      const d = t(() => B.today());
      return { state: 'ready', line: d?.boss ? `today: ${name(d.boss)}` : '' };
    } },
    { key: 'candy', icon: '🍬', name: 'Candy Factory', read() {
      const C = E.get('CandyRun'); if (!C || !t(() => C.unlocked(), false)) return { state: 'off' };
      const w = t(() => C.why());
      if (w === 'running') return { state: 'run' };
      if (w === 'played') return { state: 'done' };
      if (w === 'day') return { state: 'closed', line: 'closed today' };
      if (w === 'locked') return { state: 'off' };
      return { state: 'ready' };
    } },
    { key: 'under', icon: '⛏️', name: 'Underground', read() {
      const U = E.get('Underground'); if (!U || !t(() => U.unlocked(), false)) return { state: 'off' };
      const left = +t(() => U.left(), 0), per = +t(() => U.perDay(), 0);
      if (left <= 0) return { state: 'done', line: `${per} of ${per} sent` };
      return { state: left < per ? 'run' : 'ready', line: `${left} of ${per} expeditions left` };
    } },
    { key: 'wboss', icon: '🌍', name: 'World Boss', read() {
      const W = E.get('WorldBoss'); if (!W || !t(() => W.open(), false)) return { state: 'off' };
      if (t(() => W.resting(), false)) return { state: 'closed', line: 'resting' };
      const left = +t(() => W.left(), 0);
      return left > 0 ? { state: 'ready', line: `${left} attack${left === 1 ? '' : 's'} left` } : { state: 'done' };
    } },
    { key: 'tower', icon: '🗼', name: 'Battle Tower', week: true, read() {
      const T = E.get('Tower'); if (!T || !t(() => T.unlocked(), false)) return { state: 'off' };
      if (E.get('Game.S')?.adv?.tower) return { state: 'run' };
      const left = +t(() => T.left(), 0);
      return left > 0 ? { state: 'ready', line: `${left} run${left === 1 ? '' : 's'} left this week` } : { state: 'done', line: 'this week' };
    } },
  ];
  function list() { return LIST.map((d) => ({ key: d.key, icon: d.icon, name: d.name, week: !!d.week, ...(t(() => d.read(), { state: 'off' })) })).filter((d) => d.state !== 'off'); }
  const resetAt = () => t(() => +E.get('Raids').nextDay(), 0);
  // ---- one alert per daily per day, when it comes up ----
  let told = t(() => JSON.parse(localStorage.getItem(KEY) || '{}'), {}) || {};
  function tick() {
    if (!E.ready()) return;
    const d = day(), wk = t(() => E.get('Tower').weekKey(), d);
    for (const x of list()) {
      if (x.state !== 'ready') continue;
      const id = x.week ? 'w' + wk : d;
      if (told[x.key] === id) continue;
      told[x.key] = id; try { localStorage.setItem(KEY, JSON.stringify(told)); } catch (__e) { __h('76-dailies:73', __e); }
      try { Notify.send('ready', `${x.icon} ${x.name} is ready`, `${x.line ? x.line + ' · ' : ''}${x.week ? 'new week' : 'up for today'}${Plan.goals.some((g) => !g.done && !g.paused && g.type === x.key) ? ' - Mega will run it' : ' - not in your queue'}`); } catch (__e) { __h('76-dailies:74', __e); }
    }
  }
  let timer = null;
  function boot() { if (!timer) timer = setInterval(() => { try { tick(); } catch (__e) { __h('76-dailies:78', __e); } }, 30_000); }
  return { list, resetAt, tick, boot };
})();

/* ---------------------------------------------------------------------------------------------
 * Cards: the game stops while some popups are open (its main loop waits), so unattended runs
 * would stall until you tap. Mega taps exactly two kinds, nothing else:
 *   1. the "new Pokémon" Pokédex card - one button, and it says Continue (4.x's proven rule)
 *   2. the end-of-run recap (Battle Tower / Factory: class tw-back) - its gold button
 *      ("Super !" or "Open the egg"), the one a player taps
 * Never while you've clicked or typed in the game in the last 8 s, never while any other popup
 * is open alongside (the "Two saves found" dialog, trades, shop, settings… are never touched).
 * ------------------------------------------------------------------------------------------- */
const Cards = (() => {
  const KEY = 'mega-cards';
  let on = (() => { try { return JSON.parse(localStorage.getItem(KEY) ?? 'true'); } catch { return true; } })();
  const NOT = ['ot-dlg', 'bag-modal', 'ug-dlg', 'raid-dlg', 'rd-dlg', 'gd-modal', 'opt-modal', 'mk-dlg', 'mkc-modal', 'tc-modal', 'tab-modal', 'merge-dlg', 'rk-modal', 'lgp-modal', 'pl-modal', 'mon-modal', 'bs-modal', 'dp-modal', 'cl-wiped', 'cl-modal', 'gift-dlg', 'sup-modal', 'up-modal', 'hof-modal', 'pn-modal', 'op-modal'];
  let userAt = 0, seenAt = new Map(), timer = null;
  const vis = (e) => { if (!e) return false; const r = e.getBoundingClientRect(), cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const fromMega = (ev) => ev.composedPath?.().some((n) => n && n.id === 'mega-alakazam');
  function watchUser() {
    for (const t of ['pointerdown', 'keydown', 'wheel']) window.addEventListener(t, (ev) => { if (ev.isTrusted && !fromMega(ev)) userAt = Date.now(); }, true);
  }
  function kindOf(m) {
    if (m.classList.contains('tw-back')) return 'recap';
    if (m.classList.contains('dexcard-modal') && !NOT.some((c) => m.classList.contains(c)) && !m.classList.contains('oc-modal')) return 'dex';
    return null;
  }
  function tick() {
    if (!on || Date.now() - userAt < 8000) { seenAt.clear(); return; }
    const modals = [...document.querySelectorAll('.modal')].filter(vis);
    if (!modals.length) { seenAt.clear(); return; }
    if (modals.length > 1) return; // something else is open too - leave everything to you
    const m = modals[0], kind = kindOf(m);
    if (!kind) return;
    let btn = null;
    if (kind === 'dex') {
      const btns = [...m.querySelectorAll('button')].filter((b) => vis(b) && !b.disabled);
      if (btns.length === 1 && /continue|continuer/i.test(btns[0].textContent || '')) btn = btns[0];
    } else {
      btn = [...m.querySelectorAll('button.gold, .btn.gold, [class*="gold"]')].find((b) => b.tagName === 'BUTTON' && vis(b) && !b.disabled) || null;
    }
    if (!btn) return;
    if (!seenAt.has(m)) { seenAt.set(m, Date.now()); return; }
    if (Date.now() - seenAt.get(m) < (kind === 'dex' ? 3000 : 5000)) return;
    const title = ((m.querySelector('h2, h3') || m).innerText || '').trim().split('\n')[0].slice(0, 60);
    seenAt.delete(m);
    btn.click();
    Log.add(kind === 'dex' ? `closed the Pokédex card${title ? ` (${title})` : ''} so the game keeps running` : `closed the end-of-run recap${title ? ` (${title})` : ''} - pressed "${(btn.textContent || '').trim()}"`);
  }
  function boot() { if (timer) return; watchUser(); timer = setInterval(() => { try { tick(); } catch (__e) { __h('77-cards:47', __e); } }, 1000); }
  return { boot, get on() { return on; }, set(v) { on = !!v; try { localStorage.setItem(KEY, JSON.stringify(on)); } catch (__e) { __h('77-cards:48', __e); } } };
})();

/* ---------------------------------------------------------------------------------------------
 * Decisions: the test pack's live half. Just before an update reloads the game, Mega writes down
 * what it would decide on your save right now (where to level, who carries, the gem order, the gym
 * plan, each goal's state). The new version decides again on the same save in its first minutes and
 * the self-test flags anything that changed and wasn't planned (EXPECTED lists what this version
 * means to change). Read-only: nothing here moves a Pokémon or changes the plan.
 * ------------------------------------------------------------------------------------------- */
const Decisions = (() => {
  const KEY = 'mega-decisions', DIFF = 'mega-decisions-diff';
  // decision keys this version is meant to change (empty = nothing should change)
  const EXPECTED = [];
  const E = Engine, nm = (id) => E.get('Game.DEX')?.[id]?.name || '#' + id;
  const monName = (u) => nm(E.read('Game.getMon', null, u)?.id);
  const safe = (f) => { try { const v = f(); return v == null ? '' : String(v); } catch (e) { return 'error: ' + (e?.message || e); } };
  function now() {
    const r = {};
    const top = (() => { try { return XpChap.rank()[0] || null; } catch { return null; } })();
    r['leveling chapter'] = safe(() => top?.name);
    r['leveling carriers'] = safe(() => top ? Sim.carriers(top.ch, { n: 2 }).picks.map((p) => nm(p.m.id)).sort().join(', ') : '');
    r['idle trainees'] = safe(() => GoalTypes.idlePick(4).map(monName).join(', '));
    r['gem order'] = safe(() => EliteInfo.gems().top.map((c) => `${nm(c.m.id)} (${c.key})`).join(', '));
    const story = (Plan.goals || []).find((g) => !g.done && g.type === 'story');
    if (story && GymPlan.saved) for (const [ch, p] of Object.entries(GymPlan.saved)) {
      if (!p?.plan) continue;
      r[`gym plan ${p.gym || ch}`] = safe(() => `${Math.round(p.plan.win * 20) * 5}% · ` + p.plan.team.map((t) => nm(t.id || t.base)).join(', '));
    }
    for (const g of Plan.goals || []) if (!g.done) r[`goal: ${Plan.label ? Plan.label(g) : g.type}`] = safe(() => GoalTypes[g.type]?.check(g)?.state);
    try { const ST = E.get('STORY'); for (const reg of new Set(ST.CHAPTERS.map((c, i) => ST.regionOf(i)?.key).filter(Boolean))) r[`level cap ${reg}`] = safe(() => ST.regionCap(E.get('Game.S')?.adv, reg)); } catch (__e) { __h('77-decisions:28', __e); }
    return r;
  }
  // the version that is about to be replaced writes its decisions down
  function save() { try { if (!Engine.ready()) return; localStorage.setItem(KEY, JSON.stringify({ ver: VERSION, at: Date.now(), r: now() })); } catch (__e) { __h('77-decisions:32', __e); } }
  // the new version (once): what changed since that record
  function compare() {
    // not connected to the game yet: every decision would read blank, so compare nothing and record nothing
    // (a reload that missed the hook once turned 15 decisions into "Mont Abrupt -> (blank)" and a false warning)
    if (!Engine.ready()) return null;
    let rec = null; try { rec = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (__e) { __h('77-decisions:38', __e); }
    if (!rec || rec.ver === VERSION) {
      let d = null; try { d = JSON.parse(localStorage.getItem(DIFF) || 'null'); } catch (__e) { __h('77-decisions:40', __e); }
      // a diff recorded while disconnected (every new value blank) proves nothing: drop it
      if (d?.changed?.length && d.changed.every((c) => c.now === '' || c.now === '(none)')) { try { localStorage.removeItem(DIFF); } catch (__e) { __h('77-decisions:42', __e); } return null; }
      return d;
    }
    if (Date.now() - rec.at > 60 * 60_000) { localStorage.removeItem(KEY); return null; } // too old: the save has moved on
    const cur = now(), changed = [];
    for (const k of new Set([...Object.keys(rec.r), ...Object.keys(cur)])) {
      if ((rec.r[k] ?? '') === (cur[k] ?? '')) continue;
      if (k.startsWith('goal: ') && (!(k in rec.r) || !(k in cur))) continue; // a goal added or finished in between
      changed.push({ k, was: rec.r[k] ?? '(none)', now: cur[k] ?? '(none)', expected: EXPECTED.some((x) => k.startsWith(x)) });
    }
    const d = { from: rec.ver, to: VERSION, at: Date.now(), n: Object.keys(cur).length, changed };
    try { localStorage.setItem(DIFF, JSON.stringify(d)); localStorage.setItem(KEY, JSON.stringify({ ver: VERSION, at: Date.now(), r: cur })); } catch (__e) { __h('77-decisions:53', __e); }
    return d;
  }
  return { now, save, compare, EXPECTED };
})();

/* ---------------------------------------------------------------------------------------------
 * GameGuard: Poke'Catch ships new builds now and then. Mega notices (the game's bundle name
 * changes), re-checks every game function it relies on and runs the self-test. If anything broke,
 * it pauses your plan and tells your phone, instead of guessing with a game it no longer understands.
 * If everything still passes, the new build is accepted and the plan keeps going.
 * ------------------------------------------------------------------------------------------- */
const GameGuard = (() => {
  const KEY = 'mega-game-build', HELD = 'mega-guard';
  function build() {
    try {
      const names = performance.getEntriesByType('resource').map((r) => r.name).concat([...document.scripts].map((s) => s.src || ''));
      const n = names.find((x) => /\/bundle\/app\.[0-9a-f]+\.js/.test(x));
      return n ? n.match(/\/bundle\/app\.([0-9a-f]+)\.js/)[1] : null;
    } catch { return null; }
  }
  let busy = false;
  const held = () => { try { return JSON.parse(localStorage.getItem(HELD) || 'null'); } catch { return null; } };
  async function check() {
    if (busy || !Engine.ready()) return;
    const id = build(); if (!id) return;
    const known = localStorage.getItem(KEY), miss = Engine.audit().missing || [];
    if (known === id && !miss.length) return;
    if (!known && !miss.length) { localStorage.setItem(KEY, id); return; } // first run: this build is the known one
    const h = held(); if (h && h.build === id) return; // already paused for this build: Jimmy decides (Start resumes)
    busy = true;
    try {
      const changed = known && known !== id;
      const r = await Health.selfTest(changed ? 'the game updated' : 'game functions missing');
      if (miss.length || r.failed) {
        const why = miss.length ? `${miss.length} game function${miss.length === 1 ? '' : 's'} Mega uses ${miss.length === 1 ? 'is' : 'are'} gone (${miss.slice(0, 3).join(', ')})`
          : `${r.failed} self-test check${r.failed === 1 ? '' : 's'} failed (${(r.results || []).filter((x) => !x.warn).slice(0, 2).map((x) => x.name).join(', ')})`;
        const was = Plan.running;
        if (was) Plan.setRunning(false);
        localStorage.setItem(HELD, JSON.stringify({ at: Date.now(), build: id, why, paused: was }));
        Log.add(`game guard: Poke'Catch ${changed ? 'updated' : 'changed'} and ${why} - ${was ? 'plan paused' : 'plan was already paused'}`);
        Notify.send('problem', changed ? "Poke'Catch updated - Mega paused your plan" : 'Mega paused your plan', `${why}. Mega won't guess with a game it no longer understands. Tell Claude; Start in the Plan tab resumes anyway.`, true);
      } else {
        localStorage.setItem(KEY, id); localStorage.removeItem(HELD);
        if (changed) {
          Log.add(`game guard: Poke'Catch updated (build ${id.slice(0, 6)}) - all ${r.n} checks still pass`);
          Notify.send('daily', "Poke'Catch updated", `Mega re-checked everything it uses on the new version: all ${r.n} checks pass. Your plan keeps running.`);
        }
      }
    } catch (e) { try { Health.record('gameguard', e); } catch (__e) { __h('77-gameguard:44', __e); } } finally { busy = false; }
  }
  return { check, build, held, boot() { setTimeout(check, 60_000); setInterval(check, 10 * 60_000); } };
})();

/* ---------------------------------------------------------------------------------------------
 * History: a sample every 10 minutes while the game is open (money, Pokédex, shinies, Lv 100s, total
 * levels, and every open goal's progress), kept 7 days on this PC. The phone draws graphs from it
 * and works out "while you were away". Read-only: nothing here touches the game.
 * ------------------------------------------------------------------------------------------- */
const History = (() => {
  const E = Engine, KEY = 'mega-hist', EVERY = 10 * 60_000, KEEP = 7 * 86_400_000;
  // sample: [t, money, dex, shiny, l100, levels, {goalId: have}]
  let rows = (() => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } })();
  // your main money: while you're on a new region's side (Unova) the game keeps it in its stash
  // (link.stash.money) and S.money is that region's own wallet - the graphs follow your main money
  function homeMoney() { const S = E.get('Game.S') || {}, L = S.link; return L && L.side === 'to' && L.stash ? +L.stash.money || 0 : +S.money || 0; }
  function sideMoney() { const S = E.get('Game.S') || {}, L = S.link; return L && L.side === 'to' ? { name: { unova: 'Unova' }[L.to] || L.to, money: +S.money || 0 } : null; }
  function take() {
    const S = E.get('Game.S') || {}, mons = E.read('Game.ownedMons', []) || [];
    const goals = {};
    for (const g of Plan.goals.filter((x) => !x.done)) { try { const p = GoalTypes[g.type]?.progress?.(g); if (p && p.need) goals[g.id] = +p.have; } catch (__e) { __h('78-history:17', __e); } }
    return [Date.now(), homeMoney(), Object.keys(S.dex || {}).length, mons.filter((m) => m.shiny).length, mons.filter((m) => m.level >= 100).length, mons.reduce((t, m) => t + (+m.level || 0), 0), goals];
  }
  function tick(force) {
    if (!E.ready()) return;
    const last = rows[rows.length - 1];
    if (!force && last && Date.now() - last[0] < EVERY) return;
    const r = take(); if (!r[2]) return; // save not loaded yet
    rows.push(r); rows = rows.filter((x) => Date.now() - x[0] < KEEP);
    try { localStorage.setItem(KEY, JSON.stringify(rows)); } catch { rows = rows.slice(-500); try { localStorage.setItem(KEY, JSON.stringify(rows)); } catch (__e) { __h('78-history:26', __e); } }
  }
  let timer = null;
  function boot() { if (timer) return; setTimeout(() => tick(), 20_000); timer = setInterval(() => { try { tick(); } catch (__e) { __h('78-history:29', __e); } }, 60_000); }
  // what the phone asks for: samples since a time (plus a live one at the end), goal names
  function since(t = 0) {
    const out = rows.filter((x) => x[0] > t);
    try { out.push(take()); } catch (__e) { __h('78-history:33', __e); }
    const names = {}; for (const g of Plan.goals) { try { const p = GoalTypes[g.type]?.progress?.(g); names[g.id] = [Casing.names(Plan.label(g)), p?.need || 0, p?.unit || '', g.done ? 1 : 0]; } catch (__e) { __h('78-history:34', __e); } }
    return { rows: out, names };
  }
  return { boot, since, tick, homeMoney, sideMoney, get rows() { return rows; } };
})();

/* ===================================================================================================
 * Updater - Mega checks GitHub for a newer version every 10 minutes (the header file, about 1 KB).
 * When there is one, the header shows "⬆ Update to x.y.z": clicking it opens Tampermonkey's install
 * page for the new version - you press Update, then reload the game. Nothing installs on its own.
 * Tampermonkey also checks by itself (@updateURL) on its own schedule.
 * =================================================================================================== */
const Updater = (() => {
  const BASE = 'https://raw.githubusercontent.com/Murillo0211/mega-remote/main/';
  const META = BASE + 'mega-alakazam.meta.js', SCRIPT = BASE + 'mega-alakazam.user.js';
  // GitHub's raw-file servers keep an old copy for minutes; its API serves the current file right away
  // (60 requests an hour per home - Mega uses about 7). Falls back to the raw file if the API says no.
  const API = 'https://api.github.com/repos/Murillo0211/mega-remote/contents/';
  async function getFile(name, raw) {
    // stable PCs read main; a PC switched to the beta channel (localStorage mega-channel = beta) reads the beta branch
    const ref = localStorage.getItem('mega-channel') === 'beta' ? 'beta' : 'main';
    try { const r = await fetch(API + name + '?ref=' + ref, { headers: { Accept: 'application/vnd.github.raw' }, cache: 'no-store' }); if (r.ok) return await r.text(); } catch (__e) { __h('79-update:16', __e); }
    if (ref !== 'main') throw new Error('GitHub did not answer for the beta channel');
    const r = await fetch(raw + '?t=' + Date.now(), { cache: 'no-store' }); if (!r.ok) throw new Error('GitHub said ' + r.status); return await r.text();
  }
  let latest = null, checkedAt = 0, err = null, got = null;
  try { const v = localStorage.getItem('mega-next-ver'); if (v && localStorage.getItem('mega-next-code')) got = v; } catch (__e) { __h('79-update:21', __e); }
  // download the new version itself, so a plain reload runs it (see the header). Kept only if it's
  // really that version, and only while the page's storage has room - the game save always comes first.
  async function download(v) {
    if (got === v) return true;
    if (localStorage.getItem('mega-next-bad') === v) { err = `${v} failed its self-test and was rolled back - waiting for the next version`; return false; }
    try {
      const code = await getFile('mega-alakazam.user.js', SCRIPT);
      if (code.length < 100_000 || !new RegExp('@version\\s+' + v.replace(/\./g, '\\.') + '\\s').test(code) || !code.includes('window.__MEGA_HOT_OK')) return false;
      let used = 0; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (!/^mega-(next|prev)-/.test(k)) used += k.length + (localStorage.getItem(k) || '').length; }
      if (used + code.length > 1_800_000) { err = 'not enough room in the page storage to keep the update'; return false; }
      // the copy kept for a roll-back only stays when there's room for it too (2.13.4: it blocked 2.13.1-2.13.3)
      const keepPrev = used + 2 * code.length <= 1_800_000;
      if (!keepPrev) { try { localStorage.removeItem('mega-prev-code'); localStorage.removeItem('mega-prev-ver'); } catch (__e) { __h('79-update:34', __e); } }
      // keep the version running now (if it came this way) so a bad update can go back to it
      if (keepPrev && window.__MEGA_HOT === VERSION) { const cur = localStorage.getItem('mega-next-code'); if (cur && localStorage.getItem('mega-next-ver') === VERSION) { try { localStorage.setItem('mega-prev-code', cur); localStorage.setItem('mega-prev-ver', VERSION); } catch { localStorage.removeItem('mega-prev-code'); localStorage.removeItem('mega-prev-ver'); } } }
      localStorage.setItem('mega-next-code', code); localStorage.setItem('mega-next-ver', v);
      localStorage.setItem('mega-next-try', '0'); localStorage.removeItem('mega-next-bad');
      got = v; return true;
    } catch (e) { try { localStorage.removeItem('mega-next-code'); localStorage.removeItem('mega-next-ver'); } catch (__e) { __h('79-update:40', __e); } err = 'could not keep the update: ' + (e?.message || e); return false; }
  }
  const parts = (v) => String(v).split('.').map((x) => +x || 0);
  const newer = (a, b) => { const x = parts(a), y = parts(b); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };
  async function check() {
    try {
      const m = (await getFile('mega-alakazam.meta.js', META)).match(/@version\s+(\S+)/);
      if (m) { const was = latest; latest = m[1]; err = null; if (newer(latest, VERSION)) { await download(latest); if (latest !== was) { try { Log.add(`New Update ${latest} is ready${got === latest ? ' - it runs on the next reload' : ''}`); } catch (__e) { __h('79-update:47', __e); } try { UI.refresh?.(); } catch (__e) { __h('79-update:47', __e); } } } }
    } catch (e) { err = e?.message || String(e); }
    checkedAt = Date.now();
  }
  // Auto-reload: Tampermonkey installs updates on its own (its update interval), but a running tab keeps
  // the old code until it reloads. When GitHub has a newer version, Mega reloads the tab at a safe moment
  // (not inside a legendary zone, Battle Tower, league or raid) - once per 30 minutes per version, 4 tries
  // at most; after that it just shows the gold button. After a reload that worked, the log says so.
  const KEY = 'mega-upd-reload';
  const memo = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { return {}; } };
  const keep = (m) => { try { localStorage.setItem(KEY, JSON.stringify(m)); } catch (__e) { __h('79-update:57', __e); } };
  function safe() {
    try {
      const a = E.get('Game.S')?.adv || {};
      if (a.zone || a.tower || a.league || a.event) return false;
      if (GameMode.on()) return false; // never reload under Jimmy's thumb in Game Mode
      const busy = (Plan.goals || []).some((g) => !g.done && Plan.live(g.id)?.state === 'running' && ['raid', 'wboss', 'candy', 'tower', 'trade'].includes(g.type)); // 2.16.5: Elite, League and legendary goals keep their state in the plan, so the gap between two of their fights (checked above: no zone or League open) is a safe moment - a chain of them used to hold an update back for hours
      return !busy;
    } catch { return false; }
  }
  function autoReload() {
    const v = Updater.available; if (!v || got !== v || autoOn() === false) return;
    const m = memo(), r = m[v] || { tries: 0, at: 0 };
    if (r.tries >= 4 || Date.now() - r.at < 30 * 60_000 || !safe()) return;
    m[v] = { tries: r.tries + 1, at: Date.now() }; keep(m);
    try { Log.add(`reloading the game to pick up Mega ${v} (try ${r.tries + 1} of 4)`); } catch (__e) { __h('79-update:72', __e); }
    try { E.call('Game.save'); } catch (__e) { __h('79-update:73', __e); }
    try { Decisions.save(); } catch (__e) { __h('79-update:74', __e); }
    setTimeout(() => location.reload(), 1500);
  }
  const autoOn = () => { try { return JSON.parse(localStorage.getItem('mega-upd-auto') ?? 'true'); } catch { return true; } };
  function setAuto(on) { try { localStorage.setItem('mega-upd-auto', JSON.stringify(!!on)); } catch (__e) { __h('79-update:78', __e); } }
  function afterLoad() {
    const m = memo(), mine = m[VERSION];
    if (mine && !mine.done) { m[VERSION] = { ...mine, done: true }; keep(m); try { Log.add(`updated to Mega ${VERSION}`); } catch (__e) { __h('79-update:81', __e); } }
    // first run of this version: self-test once the game is up; a failure rolls back to the version before
    if (localStorage.getItem('mega-tested-ver') !== VERSION) setTimeout(firstTest, 90_000);
  }
  async function firstTest() {
    if (!Engine.ready()) { setTimeout(firstTest, 30_000); return; }
    let r = null; try { r = await Health.selfTest('first run of ' + VERSION); } catch (e) { r = { failed: 1, results: [{ name: 'self-test', detail: String(e?.message || e) }] }; }
    if (!r.failed) { localStorage.setItem('mega-tested-ver', VERSION); return; }
    const why = (r.results || []).filter((x) => !x.warn).slice(0, 2).map((x) => `${x.name}: ${x.detail}`).join(' | ');
    if (window.__MEGA_HOT !== VERSION) { // installed through Tampermonkey: nothing to go back to here - just tell you
      try { Notify.send('problem', `Mega ${VERSION} failed its self-test`, `${r.failed} check(s) failed: ${why}. It keeps running; tell Claude.`); } catch (__e) { __h('79-update:91', __e); }
      localStorage.setItem('mega-tested-ver', VERSION); return;
    }
    const pv = localStorage.getItem('mega-prev-ver'), pc = localStorage.getItem('mega-prev-code');
    localStorage.setItem('mega-next-bad', VERSION);
    if (pv && pc && pv !== VERSION) { localStorage.setItem('mega-next-code', pc); localStorage.setItem('mega-next-ver', pv); localStorage.setItem('mega-next-try', '0'); }
    else { localStorage.removeItem('mega-next-code'); localStorage.removeItem('mega-next-ver'); }
    try { Log.add(`rolling back: Mega ${VERSION} failed its self-test (${why}) - going back to ${pv || 'the Tampermonkey copy'}`); } catch (__e) { __h('79-update:98', __e); }
    try { Notify.send('problem', `Mega ${VERSION} rolled back`, `It failed its self-test (${why}), so Mega went back to ${pv || 'the Tampermonkey copy'} by itself. Tell Claude.`); } catch (__e) { __h('79-update:99', __e); }
    reloadNow('reloading into the version before');
  }
  const E = Engine;
  // After a reload the game waits on its title screen: press its own Continue button (only that one,
  // only on the title screen). "Two saves found" is never touched - it sends a Needs You alert instead.
  const contOn = () => { try { return JSON.parse(localStorage.getItem('mega-auto-continue') ?? 'true'); } catch { return true; } };
  function setContinue(on) { try { localStorage.setItem('mega-auto-continue', JSON.stringify(!!on)); } catch (__e) { __h('79-update:106', __e); } }
  function autoContinue() {
    const t0 = Date.now(); let pressed = false, warned = false;
    const tick = () => {
      if (Date.now() - t0 > 120_000) return;
      try {
        const txt = document.body?.innerText || '';
        if (/two saves|deux sauvegardes/i.test(txt)) {
          if (!warned) { warned = true; try { Log.add('the game is asking which save to keep - Mega leaves that to you'); Notify.send('problem', 'Poke\'Catch needs you', 'The game is asking which save to keep (Two saves found). Mega won\'t choose - open the game and pick.'); } catch (__e) { __h('79-update:114', __e); } }
          return setTimeout(tick, 2000);
        }
        if (!pressed && contOn() && document.body?.classList.contains('titled')) {
          const b = [...document.querySelectorAll('.title-fx .ti-go')].find((x) => /^\s*(continue|continuer)\s*$/i.test(x.textContent || ''));
          if (b && !document.querySelector('.modal:not([hidden])')) { pressed = true; b.click(); try { Log.add('pressed Continue on the title screen'); } catch (__e) { __h('79-update:119', __e); } }
        }
        if (pressed && !document.body?.classList.contains('titled')) return;
      } catch (__e) { __h('79-update:122', __e); }
      setTimeout(tick, 700);
    };
    setTimeout(tick, 1500);
  }
  function boot() {
    autoContinue(); setTimeout(afterLoad, 5_000); setTimeout(check, 15_000); setInterval(check, 10 * 60_000); setInterval(autoReload, 60_000); }
  // after you click Update: Tampermonkey's page opens in a new tab; when you come back to the game tab
  // (you pressed Update there), Mega reloads the game so the new version runs
  function install() {
    if (got && got === latest) { reloadNow(`reloading the game to run Mega ${latest}`); return; }
    try { window.open(SCRIPT + '?v=' + encodeURIComponent(latest || ''), '_blank'); } catch (__e) { __h('79-update:133', __e); }
    const back = () => { if (document.visibilityState !== 'visible') return; document.removeEventListener('visibilitychange', back); window.removeEventListener('focus', back); reloadNow(`reloading the game to run Mega ${latest}`); };
    setTimeout(() => { document.addEventListener('visibilitychange', back); window.addEventListener('focus', back); }, 800);
  }
  function reloadNow(why) { try { Decisions.save(); } catch (__e) { __h('79-update:137', __e); } try { Log.add(why || 'reloading the game'); } catch (__e) { __h('79-update:137', __e); } try { E.call('Game.save'); } catch (__e) { __h('79-update:137', __e); } setTimeout(() => location.reload(), 1500); }
  return { boot, check, install, reloadNow, setAuto, setContinue, get autoContinue() { return contOn() !== false; }, get downloaded() { return got; }, get auto() { return autoOn() !== false; }, get available() { return latest && newer(latest, VERSION) ? latest : null; }, get info() { return { latest, checkedAt, err }; } };
})();

/* ---------------------------------------------------------------------------------------------
 * Remote: control Mega from Jimmy's phone while the game runs on the PC.
 *
 *   PC (this script)  --status-->  ntfy.sh/<status topic>  -->  phone page (Kinesis)
 *   PC (this script)  <--command--  ntfy.sh/<command topic> <--  phone page
 *
 * Both topics are long random names, and every message is encrypted + authenticated with AES-GCM
 * under a 256-bit key that only this PC and the paired phone have (paired by a link sent to the
 * phone's ntfy app). So ntfy only ever sees ciphertext, and nobody without the key can send Mega a
 * command. Commands are a fixed list (below): plan controls, adding goals, Pokédex look-ups, sims,
 * settings. Nothing touches the clock, trades, gems, releases, saves or the PIN.
 *
 * Wire format: "M1|<id>|<i>/<n>|<base64url(iv12 + AES-GCM(gzip(JSON)))>" - split into <=3000-char
 * parts because ntfy messages stop at 4 KB. Status goes out when it changes (checked every 20 s,
 * at least every 5 min), and right after each command.
 * ------------------------------------------------------------------------------------------- */
const Remote = (() => {
  const E = Engine;
  const KEY = 'mega-remote', PAGE = 'https://murillo0211.github.io/mega-remote/';
  const rnd = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n))).map((x) => 'abcdefghijkmnpqrstuvwxyz23456789'[x % 32]).join('');
  const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
  let cfg = (() => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } })() || { on: false };
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (__e) { __h('80-remote:24', __e); } };
  function newKeys() { cfg.status = 'mega-st-' + rnd(24); cfg.cmd = 'mega-cmd-' + rnd(24); cfg.key = b64u(crypto.getRandomValues(new Uint8Array(32))); cfg.lastCmd = null; save(); }
  let cryptoKey = null, keyFor = null;
  async function key() { if (keyFor !== cfg.key) { cryptoKey = await crypto.subtle.importKey('raw', unb64u(cfg.key), 'AES-GCM', false, ['encrypt', 'decrypt']); keyFor = cfg.key; } return cryptoKey; }
  async function gz(bytes, mode) { const s = new Blob([bytes]).stream().pipeThrough(mode === 'c' ? new CompressionStream('gzip') : new DecompressionStream('gzip')); return new Uint8Array(await new Response(s).arrayBuffer()); }
  // everything that goes to the phone is in English: the game's data is French (chapters, places,
  // gym leaders, badges); Casing.names uses the game's own dictionary (I18N.en)
  const english = (txt) => { try { return Casing.names(txt); } catch { return txt; } };
  async function seal(obj) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(), await gz(new TextEncoder().encode(english(JSON.stringify(obj))), 'c'));
    const all = new Uint8Array(12 + ct.byteLength); all.set(iv); all.set(new Uint8Array(ct), 12);
    return b64u(all);
  }
  async function open(text) {
    const all = unb64u(text), iv = all.slice(0, 12);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, await key(), all.slice(12));
    return JSON.parse(new TextDecoder().decode(await gz(new Uint8Array(pt), 'd')));
  }
  // ntfy.sh's free service allows about 250 messages a day per internet connection - shared with
  // the phone alerts. So: a daily budget for the remote (alerts keep the rest), and a pause when
  // ntfy says 429 (too many).
  const BUDGET = 150, HARD = 190;
  const today = () => new Date().toISOString().slice(0, 10); // ntfy counts per UTC day
  const used = () => (cfg.day?.d === today() ? cfg.day.n : 0);
  let holdUntil = 0;
  if (cfg.ably) { delete cfg.ably; try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (__e) { __h('80-remote:50', __e); } } // Ably is gone: forget the old key
  // Mega Relay on this PC (first choice when switched on): no outside service, no limits
  const RELAY = 'http://127.0.0.1:8787';
  const relay = () => (cfg.relayOn ? RELAY : null);
  const fast = () => !!relay();
  async function post(topic, text, force) {
    if (relay()) {
      const r = await fetch(`${RELAY}/pub/${encodeURIComponent(topic)}`, { method: 'POST', body: text });
      if (!r.ok) throw new Error('Mega Relay said ' + r.status);
      return;
    }
    if (Date.now() < holdUntil) throw new Error(`ntfy asked us to slow down - trying again at ${new Date(holdUntil).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`);
    if (used() >= (force ? HARD : BUDGET)) throw new Error(`today's ntfy budget is used (${used()} messages) - live updates resume at 4 PM`);
    const r = await fetch('https://ntfy.sh/', { method: 'POST', body: JSON.stringify({ topic, message: text, priority: 1 }) });
    cfg.day = { d: today(), n: used() + 1 }; save();
    if (r.status === 429) { holdUntil = Date.now() + 30 * 60_000; throw new Error('ntfy said too many messages (429) - pausing 30 min'); }
    if (!r.ok) throw new Error('ntfy said ' + r.status);
  }
  async function send(topic, obj, force) {
    const body = await seal(obj), id = rnd(6), size = fast() ? 50_000 : 3000, n = Math.ceil(body.length / size);
    for (let i = 0; i < n; i++) await post(topic, `M1|${id}|${i + 1}/${n}|${body.slice(i * size, (i + 1) * size)}`, force);
  }

  // ---- what the phone sees ----
  const replies = {}; // request id -> {at, data}
  const acks = [];    // last command ids done (with their result)
  const strip = (h) => String(h || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  function snapshot() {
    const S = E.get('Game.S') || {}, D = E.get('Game.DEX') || {}, w = World.build();
    const prog = (g) => { try { const p = GoalTypes[g.type]?.progress?.(g); return p ? [p.have, p.need, p.unit || '', p.money ? 1 : 0] : null; } catch { return null; } };
    const goals = Plan.goals.filter((g) => !g.done).map((g) => { const L = Plan.live(g.id) || {}; let sp = null; try { sp = GoalTypes[g.type]?.sprite?.(g) || null; } catch (__e) { __h('80-remote:80', __e); } return { id: g.id, t: g.type, l: Casing.names(Plan.label(g)), s: g.paused ? 'paused' : L.state || 'wait', y: Casing.names(L.why || ''), n: Casing.names(L.line || ''), sp, p: prog(g), bg: GoalTypes[g.type]?.uses === 'background' ? 1 : 0, cr: g.type === 'discord' && ['xp', 'mix', 'axsiom'].includes(g.spot) ? (g.carrier || '') : undefined, tk: g.type === 'discord' && ['axsiom', 'mix'].includes(g.spot) ? (() => { try { const T = GoalTypes.runTake(g); return T ? [T.since, Math.round(T.money), T.berries.map((b) => [b.name, b.n])] : undefined; } catch { return undefined; } })() : undefined, tr: g.type === 'discord' && ['xp', 'axsiom', 'mix'].includes(g.spot) ? (() => { try { return GoalTypes.trainRows(g).map((r) => [r.id, r.level, Math.round(r.pct * 1000) / 1000, r.eta == null ? null : Math.round(r.eta / 60e3), r.shiny ? 1 : 0, r.rank]); } catch { return undefined; } })() : undefined, ug: g.type === 'under' ? [g.from ?? 1, g.aim || 'deep', g.preview && !g.preview.busy && !g.preview.error ? `Preview: ${g.preview.team.join(', ')} from floor ${g.preview.from}, about floor ${g.preview.floors}${g.preview.low != null && g.preview.low !== g.preview.floors ? ` (${g.preview.low} on a bad run)` : ''} (${g.preview.cleared} cleared)` : g.lastSend ? `Last sent from floor ${g.lastSend.from}: about floor ${g.lastSend.floors}${g.lastSend.low != null && g.lastSend.low !== g.lastSend.floors ? ` (${g.lastSend.low} on a bad run)` : ''}, ${g.lastSend.cleared} floors cleared` : ''] : undefined, d: GoalTypes[g.type]?.daily ? 1 : 0, tm: L.team ? [(L.team.uids || []).map((u) => { const m = E.read('Game.getMon', null, u); return m ? [m.id, m.level] : null; }).filter(Boolean), L.team.win, L.team.how || ''] : null }; });
    const done = Plan.goals.filter((g) => g.done && Date.now() - g.done < 86_400_000).map((g) => [Casing.names(Plan.label(g)), g.done]);
    const a = S.adv || {}, ST = E.get('STORY');
    const where = w.screen?.kind === 'zone' ? `${D[w.screen.id]?.name}'s Legendary Zone` : a.tower ? (a.tower.kind === 'candy' ? 'Candy Factory run' : 'Battle Tower run') : a.chapter != null ? `${ST?.CHAPTERS?.[a.chapter]?.name || 'Chapter ' + a.chapter} · stop ${(+a.node || 0) + 1} of ${(a.nodes || []).length || '?'}` : '';
    const foes = (a.battle?.enemies || []).filter((e) => e && e.id != null).map((e) => `${D[e.id]?.name || '#' + e.id}${e.level ? ' Lv ' + e.level : ''}`);
    const team = (S.team || []).map((u) => E.read('Game.getMon', null, u)).filter(Boolean).map((m) => [m.id, m.level, m.rank || 0, m.shiny ? 1 : 0, S.buddy?.uid === m.uid ? 1 : 0]);
    // Today: take the rows the Now tab shows (one renderer, so the two never disagree)
    let today = [];
    try {
      const div = document.createElement('div');
      div.innerHTML = Views.now(w, (x) => String(x ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])), (t) => { const m = Math.max(0, Math.round((t - Date.now()) / 60000)); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`; });
      const card = [...div.querySelectorAll('.card')].find((c) => /^Today/.test(c.querySelector('h3')?.textContent || ''));
      today = [...(card?.querySelectorAll('.row') || [])].map((r) => [strip(r.querySelector('.k')?.textContent), Casing.names(strip(r.querySelector('.v')?.innerHTML))]);
    } catch (__e) { __h('80-remote:93', __e); }
    const dex = (w.regions || []).filter((r) => r.open && r.dex).map((r) => { const ids = DexInfo.regionIds(r.key); return [r.name || r.key, ids.filter((id) => World.dex.registered(id)).length, ids.length, r.key]; });
    const td = Trades.data;
    const trades = td && !td.failed ? { at: td.at, t: (td.targets || []).map((t) => [t.id, t.shiny ? 1 : 0, (t.list || []).length, t.can || 0, t.newGet ? 1 : 0, t.newTo ? t.to : 0, t.best]) } : null;
    let gems = null; try { const g = EliteInfo.gems(); gems = { total: g.total, top: g.top.map((c) => [c.m.id, c.gain, c.label, c.need, c.m.rank || 0, c.m.shiny ? 1 : 0, c.bst, c.m.uid, c.key, c.m.level, (() => { try { return EliteInfo.canEvolve(c.m.id) ? 1 : 0; } catch { return 0; } })()]) }; } catch (__e) { __h('80-remote:97', __e); }
    const idle = Plan.idle ? { l: Casing.names(Plan.idle.line || ''), u: (Plan.idle.goal?.uids || []).map((u) => E.read('Game.getMon', null, u)).filter(Boolean).map((m) => [m.id, m.level, m.rank || 0, m.shiny ? 1 : 0]) } : null;
    for (const [k, r] of Object.entries(replies)) if (Date.now() - r.at > 10 * 60_000) delete replies[k];
    // names for every Pokémon the phone will show (trades, gems, team, idle, goal pictures)
    const ids = new Set([...team.map((x) => x[0]), ...(trades?.t || []).flatMap((x) => [x[0], x[5]]), ...(gems?.top || []).map((x) => x[0]), ...(idle?.u || []).map((x) => x[0]), ...goals.map((g) => g.sp)].filter(Boolean));
    try { for (const e of DayCare.info().eggs) ids.add(e.id); for (const m of DayCare.info().mons) ids.add(m.id); } catch (__e) { __h('80-remote:102', __e); }
    const nm = Object.fromEntries([...ids].map((id) => [id, D[id]?.name || '#' + id]));
    return {
      v: 1, at: Date.now(), ver: VERSION, stat: UI.statusFor(), run: Plan.running, top: Casing.names(Plan.top || ''), old: Plan.oldOn() ? 1 : 0,
      nm, goals, done, idle, tabs: (() => { try { return JSON.parse(localStorage.getItem('mega-alakazam-ui') || '{}').tabOrder || null; } catch { return null; } })(), theme: (() => { try { return JSON.parse(localStorage.getItem('mega-alakazam-ui') || '{}').theme || 'auto'; } catch { return 'auto'; } })(), where: Casing.names(where), foes, team, today, money: History.homeMoney(), side: History.sideMoney(), dex, trades, gems, carriers: (Plan.goals.some((g) => g.type === 'discord' && !g.done) ? (() => { try { return GoalTypes.carrierChoices(30).map((c) => [c.uid, c.name]); } catch { return []; } })() : undefined), ugStarts: (() => { try { return E.get('Underground').starts() || [1]; } catch { return [1]; } })(),
      log: (Log.lines || []).slice(-15).map((l) => [l.at, Casing.names(l.text)]),
      set: { berries: Berries.on, idle: Plan.idleOn, alerts: !!Notify.cfg.on },
      gemPick: (() => { try { return (E.get('LegendZones')?.leaguePending?.() || []).map((p) => [p.reg, p.tier]); } catch { return []; } })(),
      wb: Plan.hasType('wboss') ? 1 : 0,
      myTrade: (() => { try { return Trades.myOffer(); } catch { return null; } })(),
      leagues: (() => { try { return storyLeagues().map((r) => [r.key, r.name, r.inPlan ? 1 : 0]); } catch { return []; } })(),
      rc: (() => { try { const g = Plan.goals.find((x) => !x.done && x.type === 'discord' && (x.spot === 'xp' || x.candyAt)); if (!g) return null; return { at: g.candyAt || GoalTypes.CANDY_AT, l: GoalTypes.candyReady(g).slice(0, 10).map((r) => [r.id, r.level, r.rank, r.shiny ? 1 : 0, Math.round(r.left / 1e5) / 10, r.tier ? 1 : 0]) }; } catch { return null; } })(),
      rw: (() => { try { const R = nowRewards(); return { t: R.tiers.slice(0, 4).map((x) => [x.what, Math.round(x.pct * 1000) / 1000, x.reward]), r: R.ready.slice(0, 4).map((c) => [c.name, c.next, c.label]), s: R.shop.map((x) => [x.label, x.price || 0, x.ok ? 1 : 0, x.mons.slice(0, 2)]) }; } catch { return null; } })(),
      eliteLg: (() => { try { return (GoalTypes.eliteLeagues?.() || []).map((r) => [r.key, r.name, r.best, r.open ? 1 : 0, r.inPlan ? 1 : 0, r.types, r.odds == null ? null : Math.round(r.odds * 100)]); } catch { return []; } })(), upd: (() => { try { return Updater.available; } catch { return null; } })(),
      guard: (() => { try { return Guard.failures().map((f) => `${f.label}: ${f.why}`); } catch { return []; } })(),
      dc: (() => { try { const d = DayCare.info(); const sh = (() => { try { return Object.fromEntries(EggPredict.eggs().map((x) => [x.uid, x.shiny ? 1 : 0])); } catch { return {}; } })();
            const fc = (() => { try { const U = EggPredict.upcoming(400); return { k: U.next, b: U.berryOn ? 1 : 0, r: U.rows.filter((r) => r.now || r.berry).slice(0, 5).map((r) => [r.k, r.ahead, r.parent, r.parentShiny ? 1 : 0, r.now ? 1 : 0]), per: (+E.get('CONFIG')?.PENSION?.EGG_MIN || 240) * 60_000, none: (E.read('Game.pensionLayers', []) || []).length ? 0 : 1 }; } catch { return null; } })();
            return { e: d.eggs.map((e) => [e.id, e.left, e.ready ? 1 : 0, e.shinyParent ? 1 : 0, e.hatchAt - e.laidAt, e.uid, sh[e.uid] || 0]), fc, m: d.mons.map((m) => [m.id, m.level, m.shiny ? 1 : 0]), u: d.used, x: d.max, f: d.full ? 1 : 0, n: d.nextEgg }; } catch { return null; } })(),
      acks: acks.slice(-20), re: replies,
    };
  }

  // ---- what the phone may ask (the whole list) ----
  const D = () => E.get('Game.DEX') || {};
  const ADD_OK = ['legend', 'under', 'bloc', 'train', 'discord', 'candy', 'tower', 'raid', 'money', 'region', 'wboss', 'elite', 'league', 'story'];
  // Leagues you can add "Beat a region's League" for: unlocked, not beaten (same list as Mega's Plan tab)
  function storyLeagues() {
    const ST = E.get('STORY'), un = +(E.get('Game.S')?.adv?.unlocked ?? 0), NM = { unova: 'Unova', kalos: 'Kalos', alola: 'Alola', galar: 'Galar', paldea: 'Paldea' };
    return (ST?.REGIONS || []).filter((r) => r && r.key).map((r) => { let chs = []; try { chs = ST.chaptersOf(r.key) || []; } catch (__e) { __h('80-remote:130', __e); } return { key: r.key, name: NM[r.key] || r.name, chs }; })
      .filter((r) => r.chs.length && un >= r.chs[0] && !E.read('Game.regionCleared', false, r.key))
      .map((r) => ({ key: r.key, name: r.name, inPlan: Plan.goals.some((g) => !g.done && g.type === 'story' && g.region === r.key) }));
  }
  const CMDS = {
    'plan.run': (a) => { Plan.setRunning(!!a.on); return a.on ? 'plan started' : 'plan paused'; },
    'goal.pause': (a) => { Plan.pause(a.id); return 'ok'; },
    'goal.remove': (a) => { Plan.remove(a.id); return 'removed'; },
    'goal.up': (a) => { Plan.move(a.id, -1); return 'ok'; },
    'goal.down': (a) => { Plan.move(a.id, 1); return 'ok'; },
    'goal.top': (a) => { Plan.toTop(a.id); return 'ok'; },
    'goal.retry': (a) => { Plan.retry(a.id); return 'ok'; },
    'goal.ugpreview': (a) => { const g = Plan.goals.find((x) => x.id === a.id && x.type === 'under'); if (!g) throw new Error('no Underground goal'); const p = GoalTypes.ugPreview(g); if (p && !p.then && p.error) return p.error; Promise.resolve(p).finally(() => push(true)); return 'trying start floors - the pick shows on the goal in a minute or two'; },
    'goal.carrier': (a) => {
      const g = Plan.goals.find((x) => x.id === a.id && x.type === 'discord'); if (!g) throw new Error('no Discord goal');
      GoalTypes.setCarrier(g, a.uid || null); Log.add(`${Plan.label(g)} (phone): carrier ${g.carrier ? (() => { try { return Casing.names(Engine.get('Game.DEX')[Engine.read('Game.getMon', {}, g.carrier)?.id].name); } catch { return 'that Pokémon'; } })() : 'picked by Mega'}`); return 'saved';
    },
    'goal.ug': (a) => {
      const g = Plan.goals.find((x) => x.id === a.id && x.type === 'under'); if (!g) throw new Error('no Underground goal');
      if (a.from != null) g.from = a.from === 'auto' ? 'auto' : Math.max(1, +a.from || 1);
      if (a.aim != null) g.aim = a.aim === 'loot' ? 'loot' : 'deep';
      Plan.save(); Log.add(`Underground (phone): ${Plan.label(g)}`); return 'saved';
    },
    'goal.add': (a) => {
      if (!ADD_OK.includes(a.type)) throw new Error('that goal type can only be added on the PC');
      if (a.type === 'elite' && !(E.get('LegendZones')?.ZONES || []).some((z) => +z.id === +a.foe)) throw new Error('not a legendary zone');
      if (a.type === 'league' && !(E.get('STORY.REGIONS') || []).some((r) => r.key === String(a.reg))) throw new Error('unknown region');
      if (a.type === 'league' && Plan.goals.some((g) => !g.done && g.type === 'league' && g.reg === String(a.reg))) throw new Error('already in your plan');
      const data = a.type === 'discord' ? { spot: ['money', 'xp', 'mix', 'axsiom', 'candy'].includes(a.spot) ? a.spot : 'money' } : a.type === 'elite' ? { foe: +a.foe, upTo: 5 } : a.type === 'league' ? { reg: String(a.reg), upTo: 5 } : a.type === 'legend' ? { foe: +a.foe } : a.type === 'money' ? { target: Math.max(1, +a.target || 0) } : a.type === 'region' ? { reg: String(a.reg) } : a.type === 'under' ? { from: a.from === 'auto' || a.from == null ? 'auto' : Math.max(1, +a.from || 1), aim: a.aim === 'loot' ? 'loot' : 'deep' } : {};
      if (a.type === 'legend' && !D()[+a.foe]) throw new Error('unknown Pokémon');
      if (a.type === 'story') {
        const L = storyLeagues().find((r) => r.key === String(a.region)); if (!L) throw new Error('that League is not open, or already beaten');
        return Plan.add('story', { region: L.key, regionName: L.name }) ? 'added' : 'already in your plan';
      }
      return Plan.add(a.type, data) ? 'added' : 'already in your plan';
    },
    'dex.add': (a) => { if (!D()[+a.id]) throw new Error('unknown Pokémon'); return addDexJob(+a.id, +a.way || 0) ? 'added' : 'could not add (already in your plan?)'; },
    'dex.wild': (a) => { // catch it in one chosen chapter
      const id = +a.id, ch = +a.ch;
      if (!D()[id] || !DexInfo.wild(id).some((c) => c.ch === ch && c.open)) throw new Error('it isn\'t in that chapter (or the chapter is locked)');
      return Plan.add('wild', { foe: id, ch }) ? 'added' : 'already in your plan';
    },
    'item.list': (a, rid) => {
      replies[rid] = { at: Date.now(), data: DexInfo.rareItems().map((x) => ({ key: x.key, name: x.name, have: x.have, need: x.need, uses: x.uses, inPlan: Plan.goals.some((g) => !g.done && g.type === 'loot' && g.item === x.key) ? 1 : 0, spots: x.spots.map((L) => [L.ch, Casing.names(L.chapter), Casing.names(L.place), L.chance, Casing.names(L.blockers.join(' · ')), L.skies ? L.skies.join(' / ') : '']) })) };
      return 'ok';
    },
    'item.add': (a) => {
      const it = DexInfo.rareItems().find((x) => x.key === String(a.key)); if (!it) throw new Error('unknown item');
      const L = it.spots.find((x) => x.ch === +a.ch); if (!L) throw new Error('that item is not in that chapter');
      return Plan.add('loot', { item: it.key, ch: L.ch, place: L.place, need: it.need }) ? 'added' : 'already in your plan';
    },
    'dex.missing': (a, rid) => { // every missing Pokémon of the open regions, for the phone's Pokédex tab
      const regs = (World.build().regions || []).filter((r) => r.open && r.dex);
      replies[rid] = { at: Date.now(), data: regs.map((r) => [r.name || r.key, r.key, DexInfo.regionIds(r.key).filter((id) => !World.dex.registered(id)).map((id) => [id, D()[id]?.name || '#' + id, DexInfo.availableNow(id) ? 1 : 0])]) };
      return 'ok';
    },
    'dex.all': (a, rid) => { // every Pokémon of the open regions: registered, owned, shiny owned
      const regs = (World.build().regions || []).filter((r) => r.open && r.dex), owned = E.read('Game.ownedMons', []) || [];
      const have = new Set(owned.map((m) => +m.id)), shiny = new Set(owned.filter((m) => m.shiny).map((m) => +m.id));
      const hunts = new Set(Plan.goals.filter((g) => !g.done && ['shinyWild', 'shinyBreed'].includes(g.type)).map((g) => +(g.target || g.foe)));
      const ids = new Set();
      const data = regs.map((r) => { const list = DexInfo.regionIds(r.key); list.forEach((id) => ids.add(id)); return [r.name || r.key, r.key, list.map((id) => [id, World.dex.registered(id) ? 1 : 0, have.has(+id) ? 1 : 0, shiny.has(+id) ? 1 : 0, hunts.has(+id) ? 1 : 0])]; });
      replies[rid] = { at: Date.now(), once: 1, data: { regs: data, nm: Object.fromEntries([...ids].map((id) => [id, D()[id]?.name || '#' + id])) } };
      return 'ok';
    },
    'shiny.add': (a) => { // start a shiny hunt with one of the ways shiny.ways listed (0 = fastest)
      const id = +a.id; if (!D()[id]) throw new Error('unknown Pokémon');
      const sw = GoalTypes.shinyWays(id); if (sw.owned) return 'you already have a shiny one';
      const w = sw.ways[+a.way || 0]; if (!w) throw new Error('no way to hunt it right now');
      const ok = w.way === 'breed' ? Plan.add('shinyBreed', { foe: id, way: 'breed', parent: w.parent, parentId: w.parentId, egg: w.egg, steps: w.steps, rate: w.rate })
        : w.way === 'wild' ? Plan.add('shinyWild', { foe: w.foe || id, target: id, way: 'wild', ch: w.ch, rate: w.rate, steps: w.steps || null })
        : Plan.add('raid', {});
      return ok ? `added: shiny ${D()[id]?.name} hunt` : (w.way === 'raid' ? 'the Shiny Raid goal is already in your plan' : 'already hunting it');
    },
    'dex.search': (a, rid) => {
      const q = String(a.q || '').toLowerCase().trim().slice(0, 30);
      replies[rid] = { at: Date.now(), data: q.length < 2 ? [] : Object.values(D()).filter((p) => (p.name || '').toLowerCase().includes(q)).slice(0, 30).map((p) => [p.id, p.name, World.dex.registered(p.id) ? 1 : 0]) };
      return 'ok';
    },
    'dex.info': (a, rid) => {
      const id = +a.id; if (!D()[id]) throw new Error('unknown Pokémon');
      const h = DexInfo.howTo(id), ways = DexInfo.routes(id).map((r) => [r.kind, Casing.names(r.text)]);
      const inPlan = Plan.goals.find((g) => !g.done && (g.foe === id || g.forDex === id || g.item === 'egg:' + id));
      const wild = DexInfo.wild(id).map((c) => [c.ch, Casing.names(c.chapter), c.best, c.open ? 1 : 0, c.now ? 1 : 0, Casing.names(c.spots.map((x) => `${x.place} (${DexInfo.pct(x.pct)}${x.when?.length ? `, ${DexInfo.whenText(x.when)} only` : ''}${x.fights ? `, ${x.fights} fights per run` : ''})`).join(' · '))]);
      let sw = { owned: false, ways: [] }; try { sw = GoalTypes.shinyWays(id); } catch (__e) { __h('80-remote:214', __e); }
      const hunt = Plan.goals.find((g) => !g.done && ['shinyWild', 'shinyBreed'].includes(g.type) && +(g.target || g.foe) === id);
      replies[rid] = { at: Date.now(), data: { id, name: h.name, types: h.types, reg: h.registered ? 1 : 0, owned: h.owned || 0, now: Casing.names(DexInfo.availableNow(id) || ''), ways, wild, plan: inPlan ? Casing.names(Plan.label(inPlan)) : null,
        shiny: { owned: sw.owned ? 1 : 0, hunt: hunt ? Casing.names(Plan.label(hunt)) : null, ways: sw.ways.map((w) => [w.way, Casing.names(w.text), Math.round(w.hours * 10) / 10]) } } };
      return 'ok';
    },
    'sim.list': (a, rid) => {
      const sims = Legends.sims() || {};
      replies[rid] = { at: Date.now(), data: Legends.list().filter((z) => z.state !== 'done').map((z) => [z.id, z.name, z.state, sims[z.id]?.ko ?? null, Plan.has(z.id) ? 1 : 0]) };
      return 'ok';
    },
    'sim.run': async (a, rid) => {
      const id = +a.id; if (!Legends.get(id)) throw new Error('not a legendary zone');
      replies[rid] = { at: Date.now(), data: { id, running: 1 } };
      const r = await Sim.search(id, { asMax: !!a.asMax });
      Legends.saveSim(id, r);
      Log.add(`${D()[id]?.name}: best simulated team ${Math.round(r.final.ko * 100)}%${r.asMax ? ` as if Lv 100 (today ${Math.round(r.today.ko * 100)}%)` : ''} (from the phone)`);
      replies[rid] = { at: Date.now(), data: { id, ko: r.final.ko, today: r.today?.ko ?? null, asMax: r.asMax ? 1 : 0, team: (r.team || []).map((m) => [m.id, m.level]) } };
      return 'simulated';
    },
    'elite.list': (a, rid) => {
      const rows = EliteInfo.elite().rows || [];
      replies[rid] = { at: Date.now(), data: rows.map((r) => { const sim = r.next ? EliteSim.get(`L${r.id}:${r.next}`) : null; return [r.id, r.foe, D()[r.foe]?.name || D()[r.id]?.name, r.best, r.next, r.reward || '', r.gem ? EliteInfo.gemLabel(r.gem) : '', r.open && r.can ? 1 : 0, sim ? sim.ko : null, Plan.goals.some((g) => !g.done && g.type === 'elite' && g.foe === r.id) ? 1 : 0, r.users.map((u) => D()[u]?.name).slice(0, 5)]; }) };
      return 'ok';
    },
    'elite.sim': async (a, rid) => {
      const id = +a.id, tier = +a.tier; if (!(E.get('LegendZones')?.ZONES || []).some((z) => +z.id === id) || !(tier >= 1 && tier <= 5)) throw new Error('bad request');
      replies[rid] = { at: Date.now(), data: { id, tier, running: 1 } };
      const r = await EliteSim.legend(id, tier);
      Log.add(`${D()[id]?.name} elite tier ${tier}: best team ${Math.round(r.ko * 100)}% (from the phone)`);
      replies[rid] = { at: Date.now(), data: { id, tier, ko: r.ko, team: r.uids.map((u) => E.read('Game.getMon', null, u)).filter(Boolean).map((m) => [m.id, m.level]) } };
      return 'simulated';
    },
    'league.list': (a, rid) => {
      replies[rid] = { at: Date.now(), data: LeagueInfo.league().map((r) => [r.key, Casing.names(r.name), r.best, r.next, r.frame ? 1 : 0, r.types, r.pending, r.members.map((m) => Casing.names(m.leader) + (m.champion ? ' (Champion)' : '')), Plan.goals.some((g) => !g.done && g.type === 'league' && g.reg === r.key) ? 1 : 0]) };
      return 'ok';
    },
    'trades.refresh': () => { Trades.refresh(true); return 'refreshing'; },
    // ---- trading: only ever from a tap on the phone + its confirmation (the phone sends ok:true) ----
    'trade.offers': (a, rid) => { // one species' offers: who, what they want, which of yours can pay, the fee
      const o = Trades.offersFor(+a.id, !!a.shiny);
      const ids = new Set([+a.id, ...(o?.list || []).flatMap((x) => [x.want, ...x.give.map((g) => g.id)]), o?.to].filter(Boolean));
      replies[rid] = { at: Date.now(), once: 1, data: { o, money: +(E.get('Game.S')?.money || 0), mine: Trades.myOffer(), nm: Object.fromEntries([...ids].map((id) => [id, D()[id]?.name || '#' + id])) } };
      return 'ok';
    },
    'trade.accept': (a) => { if (a.ok !== true) throw new Error('not confirmed'); return Trades.accept({ id: +a.id, shiny: !!a.shiny, tid: a.tid, who: String(a.who || ''), want: +a.want, give: String(a.give || ''), fee: +a.fee || 0 }); },
    'trade.postopts': (a, rid) => { // your Pokémon that can be offered for a wanted species (same rarity)
      const opts = Trades.postOptions(+a.want);
      replies[rid] = { at: Date.now(), once: 1, data: { want: +a.want, opts, mine: Trades.myOffer(), nm: Object.fromEntries([+a.want, ...opts.map((x) => x.id)].map((id) => [id, D()[id]?.name || '#' + id])) } };
      return 'ok';
    },
    'trade.post': (a) => { if (a.ok !== true) throw new Error('not confirmed'); return Trades.post({ want: +a.want, give: String(a.give || ''), friends: !!a.friends }); },
    'set.berries': (a) => { Berries.set(!!a.on); return 'ok'; },
    'set.idle': (a) => { Plan.setIdle(!!a.on); return 'ok'; },
    'ping': () => 'pong',
    // ---- actions from Kinesis ----
    // Mega's own screens on the phone (Settings, Fights): the HTML, and a button press on them
    'ui.html': async (a, rid) => { replies[rid] = { at: Date.now(), once: 1, data: { tab: a.tab, html: await UI.mvHtml(String(a.tab)) } }; return 'ok'; },
    'ui.act': async (a, rid) => { await UI.mvAct(a); replies[rid] = { at: Date.now(), once: 1, data: { tab: a.tab, html: await UI.mvHtml(String(a.tab || 'engine')) } }; return 'ok'; },
    // rank up a Pokémon with a gem - only from your tap and a confirmation on the phone; the game's own
    // rank-up (Underground.rankUp): rank +1, back to Lv 5. Mega never spends gems by itself.
    'gem.rank': (a) => {
      const U = E.get('Underground'), m = E.read('Game.getMon', null, String(a.uid)); if (!U || !m) throw new Error('that Pokémon is gone');
      const ro = U.rankOf(m, String(a.key)); if (!ro || ro.key !== String(a.key)) throw new Error('that gem doesn\'t fit it'); if (ro.why) throw new Error(ro.why);
      if (+a.rank !== (+m.rank || 0)) throw new Error('its rank changed - refresh and try again');
      const r = U.rankUp(m.uid, String(a.key)); if (!r) throw new Error('the game said no');
      Log.add(`phone: ranked up ${D()[m.id]?.name} to rank ${r.rank} with ${r.spent} gem${r.spent === 1 ? '' : 's'} (back to Lv 5)`); try { push(true); } catch (__e) { __h('80-remote:280', __e); }
      return `${D()[m.id]?.name} is rank ${r.rank} now (back to Lv 5)`;
    },
    'update.check': async () => {
      await Updater.check(); try { push(true); } catch (__e) { __h('80-remote:284', __e); }
      const v = Updater.available, I = Updater.info;
      if (I.err && !I.latest) return 'could not reach GitHub: ' + I.err;
      return v ? `New Update ${v} is ready${Updater.downloaded === v ? ' - downloaded, tap Reload Game to run it' : ''}` : `you're up to date (${VERSION})`;
    },
    // Game Mode (2.15): the game's screen on the phone, a tap there presses it here; Mega steps aside meanwhile
    'gm.css': (a, rid) => { GameMode.hold(); replies[rid] = { at: Date.now(), once: 1, data: GameMode.css() }; return 'ok'; },
    'gm.frame': (a, rid) => { replies[rid] = { at: Date.now(), once: 1, data: GameMode.get(String(a.h || '')) }; return 'ok'; },
    'gm.tap': (a) => GameMode.tap(a.f, a.i),
    'gm.set': (a) => GameMode.set(a.f, a.i, a.v),
    'gm.off': () => { GameMode.off(); return 'Mega is back in charge'; },
    'game.reload': () => { Updater.reloadNow('phone: reloading the game'); return 'reloading the game - back in a few seconds'; },
    'egg.hatch': (a) => { const r = DayCare.hatch(a.uid || null); if (/^hatched/.test(r)) Log.add('phone: ' + r); return r; },
    'team.get': (a, rid) => { // your team + everyone who can join it (not in the Underground)
      const team = (E.get('Game.S')?.team || []).map((u) => E.read('Game.getMon', null, u)).filter(Boolean);
      const opts = GoalTypes.here().sort((x, y) => y.level - x.level || (y.rank || 0) - (x.rank || 0) || (y.shiny ? 1 : 0) - (x.shiny ? 1 : 0)).slice(0, 400);
      const row = (m) => [m.uid, m.id, m.level, m.rank || 0, m.shiny ? 1 : 0];
      replies[rid] = { at: Date.now(), once: 1, data: { team: team.map(row), opts: opts.map(row), nm: Object.fromEntries([...team, ...opts].map((m) => [m.id, D()[m.id]?.name || '#' + m.id])), busy: Plan.goals.filter((g) => !g.done && Plan.live(g.id)?.state === 'running' && GoalTypes[g.type]?.uses === 'screen').map((g) => Casing.names(Plan.label(g))) } };
      return 'ok';
    },
    'team.set': (a) => {
      const uids = [...new Set((a.uids || []).map(String))].slice(0, 6);
      if (!uids.length) throw new Error('pick at least one Pokémon');
      const why = Guard.team(uids, { need: uids.length, minLevel: 1 }); if (why) throw new Error(why);
      GoalTypes.setChapterTeam(uids);
      return 'team set: ' + uids.map((u) => D()[E.read('Game.getMon', {}, u)?.id]?.name).join(', ');
    },
    'raid.repick': () => GoalTypes.raidRepick(),
    // ---- the PC box: every Pokémon you own, where it is, and one Pokémon's details ----
    'box.list': (a, rid) => {
      const S0 = E.get('Game.S') || {}, team = new Set(S0.team || []), under = new Set((E.read('Game.underMons', []) || []).map((m) => m.uid));
      const care = (S0.pension?.mons || []).map((x) => x?.mon || x).filter(Boolean), careSet = new Set(care.map((m) => m.uid));
      const all = [...(E.read('Game.ownedMons', []) || [])]; for (const m of care) if (!all.some((x) => x.uid === m.uid)) all.push(m);
      const where = (m) => (team.has(m.uid) ? 't' : under.has(m.uid) ? 'u' : careSet.has(m.uid) ? 'd' : '') + (S0.buddy?.uid === m.uid ? 'b' : '');
      const ids = new Set(all.map((m) => +m.id));
      replies[rid] = { at: Date.now(), once: 1, data: {
        mons: all.map((m) => [m.uid, +m.id, +m.level || 1, +(m.rank || 0), m.shiny ? 1 : 0, where(m), +m.caughtAt || 0]),
        nm: Object.fromEntries([...ids].map((id) => [id, D()[id]?.name || '#' + id])),
        ty: Object.fromEntries([...ids].map((id) => [id, D()[id]?.types || []])),
      } };
      return 'ok';
    },
    'box.info': (a, rid) => {
      const S0 = E.get('Game.S') || {}, care = (S0.pension?.mons || []).map((x) => x?.mon || x).filter(Boolean);
      const m = E.read('Game.getMon', null, a.uid) || care.find((x) => x.uid === a.uid) || (E.read('Game.underMons', []) || []).find((x) => x.uid === a.uid);
      if (!m) throw new Error('not found');
      const d = D()[m.id] || {}, st = E.read('Game.statsOf', null, m) || {}, cap = +E.read('Game.capFor', 100, m) || 100;
      const under = (E.read('Game.underMons', []) || []).some((x) => x.uid === m.uid);
      const lvGoal = Plan.goals.some((g) => !g.done && g.type === 'level' && (g.uids || []).includes(m.uid));
      replies[rid] = { at: Date.now(), once: 1, data: {
        uid: m.uid, id: +m.id, name: d.name, types: d.types || [], level: +m.level || 1, cap, rank: +(m.rank || 0), shiny: !!m.shiny,
        stats: ['hp', 'atk', 'def', 'spa', 'spd', 'spe'].map((k) => Math.round(+st[k] || 0)), base: ['hp', 'atk', 'def', 'spa', 'spd', 'spe'].map((k) => +(d.stats?.[k] || 0)),
        where: (S0.team || []).includes(m.uid) ? 'On your team' : under ? 'In the Underground' : care.some((x) => x.uid === m.uid) ? 'In the Day Care' : 'In your PC',
        buddy: S0.buddy?.uid === m.uid, caught: Casing.names(m.where || m.orig?.where || ''), caughtAt: +m.caughtAt || 0, ot: m.ot || '', lvGoal,
        legendary: !!(d.legendary || d.mythical), genus: d.genus || '',
      } };
      return 'ok';
    },
    'box.level': (a) => { // level this one to its cap with the plan's leveling goal
      const m = E.read('Game.getMon', null, a.uid); if (!m) throw new Error('not found');
      const cap = +E.read('Game.capFor', 100, m) || 100; if ((+m.level || 0) >= cap) return `already at its cap (Lv ${cap})`;
      if (Plan.goals.some((g) => !g.done && g.type === 'level' && (g.uids || []).includes(m.uid))) return 'already being leveled';
      return Plan.add('level', { uids: [m.uid], target: cap }) ? `added: level ${D()[m.id]?.name} to ${cap}` : 'could not add';
    },
    // the whole log (the phone's Activity tab), newest last; ?since a time
    'log.all': (a, rid) => { const t = +a.since || 0; replies[rid] = { at: Date.now(), once: 1, data: (Log.lines || []).filter((l) => l.at > t).map((l) => [l.at, Casing.names(l.text)]) }; return 'ok'; },
    // history samples for the graphs and "while you were away"
    'hist': (a, rid) => { replies[rid] = { at: Date.now(), once: 1, data: History.since(+a.since || 0) }; return 'ok'; },
    'watch': () => { watchedAt = Date.now(); return 'ok'; }, // the phone app is open: live updates for a few minutes
  };

  // ---- listening for commands (one ntfy stream) ----
  let lastPair = 0;
  let es = null, seen = new Set(), parts = new Map(), lastSig = '', lastSent = 0, pushing = false, lastErr = null, watchedAt = 0;
  function listen() {
    try { es?.close(); } catch (__e) { __h('80-remote:359', __e); }
    es = null;
    if (!cfg.on || !cfg.cmd) return;
    if (relay()) {
      es = new EventSource(`${RELAY}/sub/${encodeURIComponent(cfg.cmd)}`);
      es.onmessage = (ev) => { try { const m = JSON.parse(ev.data); onMsg({ id: 'r' + m.t + Math.random(), message: m.d }); } catch (__e) { __h('80-remote:364', __e); } };
      pairRelay();
    } else {
      es = new EventSource(`https://ntfy.sh/${cfg.cmd}/sse?since=${cfg.lastCmd || '10m'}`);
      es.onmessage = (ev) => { try { const m = JSON.parse(ev.data); if (m.event === 'message') onMsg(m); } catch (__e) { __h('80-remote:368', __e); } };
    }
    es.onerror = () => { lastErr = 'phone link reconnecting…'; };
    es.onopen = () => { lastErr = null; };
  }
  async function pairRelay() {
    try { const r = await fetch(`${RELAY}/pair`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ s: cfg.status, c: cfg.cmd, k: cfg.key, relay: 1 }) }); relayOk = r.ok; if (!r.ok) lastErr = 'Mega Relay refused the pairing (' + r.status + ')'; }
    catch { relayOk = false; lastErr = 'Mega Relay isn\'t running on this PC (start-mega-relay)'; }
  }
  let relayOk = null;
  async function onMsg(m) {
    cfg.lastCmd = m.id; save();
    const [tag, id, pos, body] = String(m.message || '').split('|');
    if (tag !== 'M1' || !body) return;
    const [i, n] = pos.split('/').map(Number);
    const p = parts.get(id) || []; p[i - 1] = body; parts.set(id, p);
    if (p.filter(Boolean).length < n) return;
    parts.delete(id);
    let c; try { c = await open(p.join('')); } catch { return; } // not ours (wrong key): ignore
    if (!c || seen.has(c.id) || Math.abs(Date.now() - (+c.ts || 0)) > 10 * 60_000) return; // replays / stale
    seen.add(c.id);
    const fn = CMDS[c.cmd];
    let res;
    try { res = fn ? await fn(c.args || {}, c.id) : 'unknown command'; } catch (e) { res = 'error: ' + (e?.message || e); }
    acks.push([c.id, String(res)]); if (acks.length > 30) acks.shift();
    if (!['ping', 'watch'].includes(c.cmd) && !/^ui\.html|^dex\.|^log\.|^hist|^shiny\.ways|^trade\.(offers|postopts)|^box\.(list|info)|^team\.get|^sim\.list|^elite\.list|^league\.list|^item\.list/.test(c.cmd)) Log.add(`phone: ${c.cmd.replace('.', ' ')} → ${res}`);
    watchedAt = Date.now();
    push(true);
  }
  // Updates go out: right after each phone command; about once a minute while the phone app is open
  // (it says so every 2 min); otherwise once an hour - the phone shows "last update" when idle.
  // instant updates (Mega Relay only - no limits there): something happened, send within ~0.5 s
  let soonT = null, again = false;
  function soon() { if (!relay() || !cfg.on || soonT) return; soonT = setTimeout(() => { soonT = null; push(true); }, 500); }
  async function push(force = false) {
    if (pushing && force) { again = true; return; }
    if (!cfg.on || !cfg.status || pushing || !E.ready()) return;
    if (relay() && (relayOk !== true || Date.now() - lastPair > 60_000)) { lastPair = Date.now(); await pairRelay(); if (relayOk && es?.readyState === 2) listen(); }
    const watched = Date.now() - watchedAt < 4 * 60_000;
    if (!force && Date.now() - lastSent < (relay() ? 10_000 : (watched ? 75_000 : 60 * 60_000))) return;
    pushing = true;
    try {
      let snap;
      try { snap = snapshot(); } catch (e) { lastErr = 'could not build the update: ' + (e?.message || e); return; }
      const sig = JSON.stringify({ ...snap, at: 0 });
      if (!force && sig === lastSig) return;
      await send(cfg.status, snap, force);
      lastSig = sig; lastSent = Date.now(); lastErr = null;
      // big one-time answers (full log, history) go out in one update, not in every update after
      for (const [k, r] of Object.entries(replies)) if (r.once && snap.re?.[k]) delete replies[k];
    } catch (e) { lastErr = (relay() ? 'could not reach Mega Relay: ' : 'could not reach ntfy: ') + (e?.message || e); }
    finally { pushing = false; if (again) { again = false; setTimeout(() => push(true), 50); } }
  }

  // ---- live ticks: while the phone app is open (and on Mega Relay), the numbers that move, every 2 s ----
  // A few hundred bytes: the running goals' progress / status, the battle (who, HP), team HP, money.
  // The full update still goes out every 15 s; the phone merges ticks into it.
  // ---- boss fight numbers (legendary zone, Shiny Raid, World Boss): is it worth doing right now? ----
  // KOs vs wipes come from the Recorder (every boss fight is written down), the catch chance from the
  // game's own formula (berries included), time per try from real fights. Recomputed every 10 s.
  let fightCache = null, fightAt = 0, fightBusy = false;
  async function fightCalc() {
    const S = E.get('Game.S') || {}, a = S.adv || {}, b = a.battle, ev = a.event, C = E.get('CONFIG') || {}, A = E.get('Adventure');
    let kind = null, foe = null, reg = null;
    if (ev?.raid) { kind = 'raid'; foe = +ev.id; reg = ev.reg; }
    else if (a.zone) { foe = +(a.zone.foe ?? a.zone.id); kind = a.zone.wb ? 'wboss' : a.zone.tier ? 'elite' : 'legend'; }
    if (!kind || !foe) return null;
    let fights = []; try { fights = await Recorder.all(foe); } catch (__e) { __h('80-remote:435', __e); }
    const day = Date.now() - 86_400_000;
    // boss fights today against this foe (raid: the raid's static boss; zone: zone fights)
    // (a Legendary like Cresselia is also a 'static' encounter, so 'static' can't mean raid - only the raid flag does)
    const boss = fights.filter((f) => f.at > day && (kind === 'raid' ? !!f.raid : !f.raid));
    let kos, wipes;
    if (kind === 'raid' && !RaidCount.fete(ev)) { const t = RaidCount.kos(ev); kos = t; wipes = Math.max(0, boss.length - t); } // the raid's own KO counter (resets daily)
    else { kos = boss.filter((f) => f.outcome === 'ko').length; wipes = boss.filter((f) => f.outcome === 'wipe').length; } // zones, and the event raid (its counter never resets)
    // time per fight: the median gap between boss fights (travel + fight), else the raid loop time
    const st = boss.map((f) => f.at).sort((x, y) => x - y), gaps = [];
    for (let i = 1; i < st.length; i++) { const g = st[i] - st[i - 1]; if (g < 15 * 60_000) gaps.push(g); }
    gaps.sort((x, y) => x - y);
    const per = gaps.length ? gaps[Math.floor(gaps.length / 2)] : kind === 'raid' ? +ev.loopMs || null : boss[0]?.ms || null;
    let chance = null;
    if (kind === 'raid') chance = +(C.RAID?.CATCH) || 0.01;
    else { try { const e = b?.enemies?.[0] || { id: foe, level: 100 }; chance = +A.catchProb(A.catchCtx(e)); } catch (__e) { __h('80-remote:450', __e); } }
    if (!(chance > 0)) chance = fightCache?.foe === foe ? fightCache.chance : null;
    let tries = 0, pity = null;
    if (kind === 'raid') { tries = RaidCount.gauge(ev); pity = +(C.RAID?.PITY) || null; }
    else if (kind === 'wboss') { try { tries = +E.get('WorldBoss').tries() || 0; } catch (__e) { __h('80-remote:454', __e); } }
    else tries = +(S.legTries?.[foe] ?? 0);
    const koRate = kos + wipes ? kos / (kos + wipes) : null;
    // expected: KOs for a 50% / 90% chance, and the time that takes at today's KO rate
    const need = (q) => (chance > 0 && chance < 1 ? Math.ceil(Math.log(1 - q) / Math.log(1 - chance)) : chance >= 1 ? 1 : null);
    const msPerKo = per && koRate ? per / koRate : koRate === 0 ? null : per;
    const n50 = need(0.5), n90 = need(0.9);
    const left = pity ? Math.max(0, pity - tries) : null;
    return { k: kind, foe, kos, wipes, rate: koRate, chance, tries, pity, left, per, n50, n90, t50: n50 && msPerKo ? n50 * msPerKo : null, t90: n90 && msPerKo ? n90 * msPerKo : null, tPity: left != null && msPerKo ? left * msPerKo : null, fights: kos + wipes };
  }
  function fightNow() {
    if (Date.now() - fightAt > 10_000 && !fightBusy) { fightBusy = true; fightAt = Date.now(); fightCalc().then((f) => { fightCache = f; }).catch(() => {}).finally(() => { fightBusy = false; }); }
    return fightCache;
  }
  function tick() {
    const S = E.get('Game.S') || {}, Dx = E.get('Game.DEX') || {}, a = S.adv || {}, g = E.get('Game');
    const hp = (m) => { try { return [Math.max(0, Math.round(g.curHp(m))), Math.round(g.maxHp(m))]; } catch { return [0, 0]; } };
    const goals = Plan.goals.filter((x) => !x.done && ['running', 'ready'].includes(Plan.live(x.id)?.state)).map((x) => {
      let p = null; try { const q = GoalTypes[x.type]?.progress?.(x); if (q) p = [q.have, q.need, q.unit || '', q.money ? 1 : 0]; } catch (__e) { __h('80-remote:472', __e); }
      return [x.id, Casing.names(Plan.live(x.id)?.line || ''), p];
    });
    const foes = (a.battle?.enemies || []).filter((e) => e && e.id != null).map((e) => [e.id, e.level || 0, ...hp(e)]);
    const R = E.get('Raids'), uids = E.read('Game.activeTeam', null) || S.team || [];
    const team = uids.map((u) => (typeof u === 'object' ? u : E.read('Game.getMon', null, u) || (() => { try { return R?.allyMon(u); } catch { return null; } })())).filter(Boolean).map((m) => [m.id, m.level, ...hp(m), m.bot ? String(m.owner || 'ally') : '']);
    const node = a.chapter != null ? [(+a.node || 0) + 1, (a.nodes || []).length] : null;
    const fight = fightNow();
    // who you're fighting: [kind, name] - a trainer or gym leader by the game's own English label, else just the kind (wild, raid…)
    const b = a.battle || null;
    const opp = b && b.kind ? [String(b.kind), b.trainer ? Casing.names(String(E.read('STORY.trainerLabel', b.trainer, b.trainer))) : ''] : null;
    return { k: 'tick', at: Date.now(), fight, opp, top: Casing.names(Plan.top || ''), goals, foes, team, node, money: History.homeMoney(), side: History.sideMoney(), idle: Plan.idle ? Casing.names(Plan.idle.line || '') : null, nm: Object.fromEntries([...foes.map((f) => f[0]), ...team.map((t) => t[0]), ...(fight ? [fight.foe] : [])].map((id) => [id, Dx[id]?.name || '#' + id])) };
  }
  let ticking = false, lastTickAt = 0;
  async function liveTick() {
    if (!cfg.on || !fast() || ticking || pushing || !E.ready()) return;
    ticking = true;
    try { await send(cfg.status, tick()); } catch (e) { lastErr = e?.message || String(e); } finally { ticking = false; }
  }

  let timer = null;
  function boot() { if (timer) return; listen(); timer = setInterval(() => push(), 5_000); setInterval(() => { if (relay() || Date.now() - lastTickAt > 1900) { lastTickAt = Date.now(); liveTick(); } }, 1_000); setTimeout(() => push(true), 8_000); }
  const pairCode = () => b64u(new TextEncoder().encode(JSON.stringify({ s: cfg.status, c: cfg.cmd, k: cfg.key })));
  return {
    testSnapshot: () => { try { JSON.stringify(snapshot()); return true; } catch (e) { return 'threw: ' + (e?.message || e); } },
    boot, soon, get fight() { return fightNow(); },
    get on() { return !!cfg.on; },
    get info() { return { on: !!cfg.on, lastSent, lastErr, paired: !!cfg.key, page: PAGE, used: used(), budget: BUDGET, watched: Date.now() - watchedAt < 4 * 60_000, relay: !!relay(), relayOk }; },
    setRelay(on) { cfg.relayOn = !!on; if (on && !cfg.key) newKeys(); save(); relayOk = null; lastErr = null; listen(); push(true); },
    set(on) { cfg.on = !!on; if (on && !cfg.key) newKeys(); save(); listen(); if (on) push(true); },
    reKey() { newKeys(); listen(); push(true); },
    pairLink: () => (cfg.key ? `${PAGE}#pair-${pairCode()}` : null),
    // the setup link goes to the phone through its ntfy app (your alert topic), tap it to pair
    async sendPair() {
      const link = Remote.pairLink(); if (!link || !Notify.cfg.topic) return false;
      const r = await fetch('https://ntfy.sh/', { method: 'POST', body: JSON.stringify({ topic: Notify.cfg.topic, title: 'Kinesis: tap to pair this phone', message: 'Opens Kinesis and pairs it with your PC. Delete this alert afterwards.', click: link, tags: ['iphone'], priority: 3 }) });
      return r.ok;
    },
  };
})();

/* ---------------------------------------------------------------------------------------------
 * Game Mode (2.15, Jimmy 2026-11-23: "a button in Kinesis called Game Mode - the exact layout of the
 * game minus the animated window, and every tap presses it on my actual game"). While the phone has
 * Game Mode open, Mega copies what's on the game's screen (top bar, menu, the open page, pop-ups -
 * never the battle arena or the canvases) and sends it to the phone; a tap there presses the same
 * element here. Mega steps aside meanwhile (the plan waits; an Elite League or Legendary run the game is
 * already in keeps going on its own), and picks up again 45 s after the phone stops asking.
 * Never from the phone: "Two saves found", releasing Pokémon, password / PIN boxes.
 * ------------------------------------------------------------------------------------------- */
const GameMode = (() => {
  let until = 0, frame = 0, lastHtml = '', lastHash = '';
  const maps = new Map(); // frame -> [element]
  const on = () => Date.now() < until;
  const hold = () => { const was = on(); until = Date.now() + 45_000; if (!was) Log.add('Game Mode on the phone - Mega steps aside'); };
  const off = () => { if (on()) Log.add('Game Mode closed - Mega picks up again'); until = 0; maps.clear(); };
  const SKIP = new Set(['SCRIPT', 'STYLE', 'LINK', 'CANVAS', 'NOSCRIPT', 'TEMPLATE', 'IFRAME', 'VIDEO', 'AUDIO', 'META']);
  const SKIP_ID = new Set(['mega-alakazam', 'arena', 'mega-topline']);
  const BLOCK = /two saves|deux sauvegardes|release|relâcher|relacher|libérer|liberer|relâch|delete save|supprimer/i;
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const attr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36) + ':' + s.length; };
  const KEEP = ['class', 'style', 'alt', 'title', 'aria-label', 'role', 'type', 'placeholder', 'colspan', 'rowspan', 'width', 'height', 'viewBox', 'd', 'fill', 'stroke', 'points', 'x', 'y', 'cx', 'cy', 'r', 'rx', 'ry', 'x1', 'x2', 'y1', 'y2', 'transform', 'stroke-width', 'opacity', 'min', 'max', 'step'];
  // the game's stylesheets: its own files by address (they load on the phone straight from the game's site),
  // and the styles it writes into the page as text
  function css() {
    // in the page's own order (2.15.4: the game's first <style> sets a plain font for the loading screen and its main
    // file then sets the pixel font - out of order, the plain one won everywhere)
    const links = [], text = [], order = [];
    for (const s of document.styleSheets) {
      const n = s.ownerNode; if (!n || n.closest?.('#mega-alakazam') || /^mega-/.test(n.id || '')) continue; // Mega's own (the panel dock moves the game over)
      if (s.href) { links.push(s.href); order.push({ href: s.href }); continue; }
      try { const t = [...s.cssRules].map((r) => r.cssText).join('\n'); text.push(t); order.push({ text: t }); } catch (__e) { __h('82-gamemode:32', __e); }
    }
    return { links, order, text: text.join('\n'), html: attr(document.documentElement.className || ''), hstyle: attr(document.documentElement.getAttribute('style') || ''), body: attr(document.body.className || '') };
  }
  // one copy of the screen; every element gets data-gm=<n> so a tap can be pressed on the real one
  function snap() {
    const els = [];
    const blockedBox = (el) => { const m = el.closest?.('#modal-root, .modal, [role=dialog]'); return !!(m && BLOCK.test(m.textContent || '') && /two saves|deux sauvegardes/i.test(m.textContent || '')); };
    function ser(n) {
      if (n.nodeType === 3) return esc(n.nodeValue);
      if (n.nodeType !== 1) return '';
      const tag = n.tagName; if (SKIP.has(tag) || SKIP_ID.has(n.id)) return '';
      let cs; try { cs = getComputedStyle(n); } catch { return ''; }
      // the game has its own phone layout (at 640 px and below), so parts the wide screen hides stay in: only the
      // pages that aren't open (and anything marked hidden) are left out
      if (n.hidden || (cs.display === 'none' && (n.matches('#app main > .screen, #modal-root, .modal, [role=dialog], .tooltip, .tip') || n.querySelectorAll('*').length > 150))) return '';
      const i = els.push(n) - 1, t = tag.toLowerCase();
      let a = ` data-gm="${i}"`;
      for (const k of KEEP) { const v = n.getAttribute(k); if (v != null && v !== '') a += ` ${k}="${attr(v)}"`; }
      // the game's data-* attributes too: its CSS shows a page by them (2.15.16: the Underground's open tab is
      // .ug[data-tab=geo] - without it Expeditions, Geodes and Shop were all hidden on the phone)
      for (const at of n.attributes) if (at.name.startsWith('data-') && !at.name.startsWith('data-gm') && at.value.length < 200) a += ` ${at.name}="${attr(at.value)}"`;
      if (n.id) a += ` id="${attr(n.id)}"`;
      if (t === 'img') { if (n.currentSrc || n.src) a += ` src="${attr(n.currentSrc || n.src)}"`; a += ' loading="lazy"'; }
      if (n.disabled) a += ' disabled';
      if (cs.cursor === 'pointer') a += ' data-gmp="1"';
      const label = (n.textContent || '').trim().slice(0, 80);
      const pw = t === 'input' && /password/i.test(n.type || '') || /pin|password|mot de passe/i.test(n.getAttribute('name') || '') || /pin|password|mot de passe/i.test(n.getAttribute('placeholder') || '');
      if (pw || ((t === 'button' || cs.cursor === 'pointer') && BLOCK.test(label) && label.length < 40) || blockedBox(n)) a += ' data-gmx="1"';
      if (t === 'input') { if (!pw && n.type !== 'file') a += ` value="${attr(n.value)}"`; if (n.checked) a += ' checked'; return `<input${a}>`; }
      if (t === 'textarea') return `<textarea${a}>${esc(n.value)}</textarea>`;
      if (t === 'select') return `<select${a}>${[...n.options].map((o) => `<option value="${attr(o.value)}"${o.selected ? ' selected' : ''}>${esc(o.text)}</option>`).join('')}</select>`;
      if (t === 'img' || t === 'br' || t === 'hr') return `<${t}${a}>`;
      let inner = ''; for (const c of n.childNodes) inner += ser(c);
      return `<${t}${a}>${inner}</${t}>`;
    }
    const parts = [];
    for (const c of document.body.children) parts.push(ser(c));
    const html = parts.join('');
    frame += 1; maps.set(frame, els); for (const k of [...maps.keys()]) if (k < frame - 3) maps.delete(k);
    return { f: frame, html };
  }
  // the phone asks for the screen: the same hash back means nothing changed
  function get(h) {
    hold();
    const s = snap(), hh = hash(s.html);
    if (hh === h) { maps.delete(s.f); frame -= 1; return { same: 1, f: frame }; }
    lastHtml = s.html; lastHash = hh;
    return { f: s.f, h: hh, html: s.html };
  }
  function find(f, i) { const els = maps.get(+f); const el = els?.[+i]; if (!el || !el.isConnected) throw new Error('the screen changed - tap again'); return el; }
  function guard(el) {
    const label = (el.textContent || '').trim();
    if (el.tagName === 'INPUT' && /password/i.test(el.type || '')) throw new Error('passwords and PINs stay on the Mac');
    const m = el.closest('#modal-root, .modal, [role=dialog]'); if (m && /two saves|deux sauvegardes/i.test(m.textContent || '')) throw new Error('"Two saves found" stays on the Mac');
    if (label.length < 40 && BLOCK.test(label)) throw new Error('releasing Pokémon stays on the Mac');
  }
  // press it the way a mouse would (some of the game's buttons listen for the press, not the click)
  function tap(f, i) {
    hold();
    const el = find(f, i); guard(el);
    const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2, o = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0 };
    try { el.dispatchEvent(new PointerEvent('pointerdown', { ...o, pointerId: 1, isPrimary: true })); } catch (__e) { __h('82-gamemode:94', __e); }
    el.dispatchEvent(new MouseEvent('mousedown', o));
    try { el.dispatchEvent(new PointerEvent('pointerup', { ...o, pointerId: 1, isPrimary: true })); } catch (__e) { __h('82-gamemode:96', __e); }
    el.dispatchEvent(new MouseEvent('mouseup', o));
    el.click();
    return 'ok';
  }
  function set(f, i, v) {
    hold();
    const el = find(f, i); guard(el);
    if (!/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) throw new Error('that is not a box you can type in');
    if (el.type === 'checkbox' || el.type === 'radio') el.checked = !!v; else el.value = String(v ?? '');
    el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
    return 'ok';
  }
  return { on, hold, off, css, get, tap, set, _last: () => ({ hash: lastHash, size: lastHtml.length }) };
})();

/* ---------------------------------------------------------------------------------------------
 * Main: wait for the page and the engine, then mount the panel.
 * ------------------------------------------------------------------------------------------- */
function start() {
  const t0 = Date.now();
  const wait = setInterval(() => {
    const domReady = document.readyState !== 'loading' && document.body;
    if (!domReady) return;
    if (Engine.ready() || Date.now() - t0 > 30_000) { clearInterval(wait); try { UI.mount(); } catch (e) { console.error('[Mega Alakazam] UI failed to start', e); } try { TopBar.set(false); } catch (e) { console.error('[Mega Alakazam] top bar failed to start', e); } try { GemFocus.boot(); } catch (__e) { __h('90-main:9', __e); } }
  }, 300);
}
start();
Recorder.start();
// debug handle (read-only use from the console / Claude)
window.__MEGA = { VERSION, GameMode, Engine, EliteSim, EliteInfo, GemFocus, MoveTune, TopBar, Berries, EggPredict, Risk, LeagueInfo, XpChap, TradePick, Blackbox, World, Views, Recorder, Analyse, Sim, Legends, Plan, GoalTypes, Log, Health, Notify, Casing, UI, Decisions, GameGuard, GymPlan, Buddy, BossLog,
  // proves the whole path: a silent catch, rewritten by the build, reaching Health
  healthProbe: () => { try { throw new Error('health probe'); } catch (__e) { __h('90-main:17', __e); } return Object.keys(Health.sites).some((k) => k.startsWith('90-main:')); } };
// self-update: tell the copy that loaded us that we came up; after a healthy minute, clear the try count
if (window.__MEGA_HOT === VERSION) { window.__MEGA_HOT_OK = VERSION; setTimeout(() => { try { localStorage.setItem('mega-next-try', '0'); } catch (__e) { __h('90-main:19', __e); } }, 60_000); }
})();
