// ==UserScript==
// @name         Mega Alakazam
// @namespace    jimmy.pokecatch.mega
// @version      0.32.4
// @description  The Poke'Catch helper, rebuilt on the game's own engine. Every number comes from the game itself.
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
const VERSION = '0.32.4';
// every "catch (__e) { __h('00-header:22', __e); }" in Mega is built into a call to this (build.mjs): see Health in 01-health.js
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
    await run('no "undefined" or "NaN" on screen', () => { const o = UI.renderTest.odd || []; return o.length ? 'on ' + o.join(', ') : true; }, true);
    await run('phone update builds', () => { const r = Remote.testSnapshot?.(); return r === undefined || r === true ? true : r; });
    const failed = out.filter((x) => !x.ok && !x.warn);
    test = { at: Date.now(), v: VERSION, why, n: out.length, failed: failed.length, warns: out.filter((x) => !x.ok && x.warn).length, results: out.filter((x) => !x.ok), names: out.length };
    try { localStorage.setItem('mega-selftest', JSON.stringify(test)); } catch (x) {}
    try { Log.add(failed.length ? `self-test (${why}): ${failed.length} of ${out.length} checks failed - ${failed.slice(0, 3).map((x) => x.name + ': ' + x.detail).join(' | ')}` : `self-test (${why}): all ${out.length} checks passed`); } catch (x) {}
    return test;
  }
  return { record, recent, clear, flush, goalErr, goalOk, selfTest, get test() { return test; }, get sites() { return sites; } };
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

  for (const name of ['appendChild', 'insertBefore']) {
    const real = Node.prototype[name];
    Node.prototype[name] = function (node, ...rest) { intercept(node); return real.call(this, node, ...rest); };
  }
  // confirm the hand-over once the game is up
  const started = Date.now();
  const watch = setInterval(() => {
    let up = false;
    try { const G = window.__MEGA_NS; up = !!(G && G.POKEDEX && G.CONFIG); } catch (__e) { __h('10-hook:59', __e); }
    if (up) { clearInterval(watch); Object.assign(report, { ok: true, reason: 'engine available' }); }
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
    'Adventure.startZone', 'Adventure.leaveZone', 'Adventure.effectiveness', 'Adventure.rankAura', 'Game.zoneTeam', 'Game.save', 'Game.curHp', 'Game.DEX', 'Game.bestMoveAgainst', 'Game.learnOf', 'STATUS.effectOf', 'Adventure.setChapter', 'Adventure.isLooping', 'Adventure.toggleLoop', 'STORY.bandOf', 'STORY.regionOf', 'STORY.CHAPTERS', 'Game.levelXp', 'Game.capFor', 'Game.teamMons', 'Game.setBuddy', 'Game.activeBuffs', 'Game.useBuffBerry', 'Game.itemCount', 'Adventure.zonePool', 'Underground.send', 'Underground.collect', 'Underground.progress', 'Underground.simulate', 'Underground.themeOf', 'Underground.starts', 'Underground.why', 'EVOLUTIONS', 'Game.inDex', 'WEATHER.current', 'WEATHER.hours', 'DAYTIME.phase', 'DAYTIME.PHASES', 'STORY.staticLevel', 'Game.eggReady', 'Game.hatchEgg', 'Game.pensionHasDitto', 'Game.toPension', 'Game.fromPension', 'Adventure.startTower', 'Tower.weekKey', 'Tower.run', 'CandyRun.why', 'CandyRun.loadDay', 'Adventure.startRaid', 'Raids.drawn', 'Raids.lane', 'Raids.reroll', 'Raids.canReroll', 'Raids.setPick', 'Raids.bots', 'Raids.teamKey',
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
    return f.apply(owner, args);
  }
  // for reads: never throws, returns fallback on any problem
  function read(path, fallback, ...args) {
    try { const v = typeof get(path) === 'function' ? call(path, ...args) : get(path); return v === undefined ? fallback : v; } catch { return fallback; }
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
    try { if (get('STORY.CHAPTERS')?.[ch]?.league) return []; } catch (__e) { __h('20-engine:70', __e); } // nothing is caught in the League
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
    if (a.event?.raid) return { kind: 'raid', label: 'Shiny Raid run' };
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
  const isNight = () => G().DAYTIME?.phase?.()?.key === 'night';
  const bestKey = (att, def) => { try { return Gm().bestMoveAgainst(att, typesOf(def))?.key || 'struggle'; } catch { return 'struggle'; } };
  const blacklisted = (k) => (C().MOVE_BLACKLIST || []).includes(k);
  const recharges = (k) => (C().MOVE_RECHARGE || []).includes(k);
  // the game's canGet for sim units (unit carries id + status), plus the boss's sleep cooldown
  const canGet = (u, st) => {
    if (st === 'confusion') return !u.confused;
    if (u.status) return false;
    if (st === 'sleep' && u.sleepCd > 0) return false;
    try { return !!G().STATUS.canGet({ id: u.id, status: null }, st); } catch { return true; }
  };

  function mulberry(seed) {
    return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  // multi-hit moves: a fixed count, a list of per-hit powers (Triple Kick), or "2-5"
  function hitsOf(k, rnd) {
    const v = (C().MULTI_HIT || {})[k];
    if (v == null) return [1];
    if (typeof v === 'number') return Array(v).fill(1);
    if (Array.isArray(v)) { const p = power(k) || v[0] || 1; return v.map((x) => x / p); }
    const odds = C().MULTI_HIT_ODDS || [0.35, 0.35, 0.15, 0.15];
    let r = rnd(), n = 2;
    for (let i = 0; i < odds.length; i++) { if (r < odds[i]) { n = 2 + i; break; } r -= odds[i]; n = 2 + i; }
    return Array(n).fill(1);
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
  function zoneOf(foeId, tier = 0) {
    const LZ = G().LegendZones, z = LZ.get(foeId);
    if (!z) return null;
    // weekly forms (Deoxys): fight this week's form with its own stats and strength
    let form = null; if (!tier && Array.isArray(z.forms)) { try { form = +LZ.foe(z) || null; } catch (__e) { __h('35-sim:112', __e); } }
    const fk = form && form !== foeId ? (z.formKnobs || {})[form] : null;
    const base = { id: foeId, foe: fk ? form : foeId, hp: fk?.hp ?? z.hp, power: fk?.power ?? z.power, weather: z.weather || null, burst: z.burst || null, counter: z.counter || null, level: z.level || 100, static: true };
    // the strength the game really used the last time you fought it (Calib keeps it from the Recorder);
    // not for a new form - those fights were against a different form
    let obs = null; if (!fk) { try { obs = Calib.observed(foeId, tier); } catch (__e) { __h('35-sim:117', __e); } }
    if (!tier) return obs ? { ...base, hp: obs.hp, power: obs.power, observed: true } : base;
    const EL = C().ELITE || {};
    let kn = null; try { kn = LZ.eliteKnobs(foeId, null, tier); } catch (__e) { __h('35-sim:120', __e); }
    let foe = foeId; try { foe = LZ.eliteFoe(z) || foeId; } catch (__e) { __h('35-sim:121', __e); }
    return { ...base, foe, hp: obs?.hp ?? kn?.hp ?? base.hp, power: obs?.power ?? kn?.power ?? base.power, observed: !!obs, level: C().MAX_LEVEL || 100, elite: tier, hurt: EL.HURT?.[tier] ?? null, resist: EL.RESIST?.[tier] ?? 1 };
  }

  function setup(team, foeId, zone = zoneOf(foeId)) {
    const c = C(), LZ = c.LEGEND_ZONE || {}, ED = c.ENEMY_DAMAGE || {};
    const boss = { uid: 'boss', id: +(zone?.foe ?? foeId), level: zone?.level || 100, shiny: false, foe: true };
    const wx = zone?.weather ? c.WEATHER?.TYPES?.[zone.weather]?.damage || null : null;
    let aura = 1;
    try { aura = (LZ.AURA || 0) ? G().Adventure.rankAura(team) || 1 : 1; } catch (__e) { __h('35-sim:130', __e); }
    // tuning learned from your real fights (Calib): boss power / HP per kind of fight
    const ctx = zone?.raid ? 'raid' : zone?.elite ? 'elite' : 'zone';
    let cal = zone?.cal || null; if (!cal) { try { cal = Calib.get(ctx); } catch (__e) { __h('35-sim:133', __e); } }
    const pk = +(cal?.pk) || 1, hk = +(cal?.hk) || 1;
    const P = (zone?.power ?? 1) * aura * aura * (ED.static ?? 1) * pk;
    const PR = P;
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
    const A = st.allies.map((a, i) => ({ ...a, cur: Math.max(1, Math.min(a.hp, st.startHp?.[i] ?? a.hp)), status: null, sleep: 0, confused: 0, recharge: false }));
    const B = { ...st.boss, cur: st.boss.hp, status: null, sleep: 0, confused: 0, rage: 0, sleepCd: 0, boss: true, recharge: false };
    const alive = () => A.filter((a) => a.cur > 0);
    const roll1 = (atk, burnMult, mult, scale = 1) => {
      if (rnd() * 100 > atk.acc) return 0;
      const cr = rnd() < crit ? critM : 1;
      const burn = burnMult && atk.phys ? burnMult : 1;
      const d = Math.max(1, Math.floor(atk.base * scale * burn * cr * (0.85 + rnd() * 0.15)));
      return mult === 1 ? d : Math.max(1, Math.round(d * mult));
    };
    const roll = (atk, burnMult, mult) => {
      if (!atk.base) return 0;
      if (!atk.multi) return roll1(atk, burnMult, mult);
      let sum = 0;
      for (const s of hitsOf(atk.k, rnd)) { const d = roll1(atk, burnMult, mult, s); if (!d && sum === 0) return 0; sum += d; }
      return sum;
    };
    const inflict = (u, s) => {
      if (s === 'tri') s = ['burn', 'paralysis', 'freeze'][Math.floor(rnd() * 3)];
      if (!canGet(u, s)) return false;
      if (s === 'confusion') u.confused = 2 + Math.floor(rnd() * 4);
      else { u.status = s; if (s === 'sleep') u.sleep = 1 + Math.floor(rnd() * 3); }
      return true;
    };
    let calm = 0, rounds = 0;
    const blocked = (u) => {
      if (u.recharge) { u.recharge = false; return true; }
      if (u.boss && u.status === 'sleep') { u.status = null; u.sleep = 0; u.sleepCd = SLEEP_CD + 1; return true; }
      if (u.status === 'sleep') { if (u.sleep > 0) { u.sleep--; return true; } u.status = null; }
      else if (u.status === 'freeze') { if (rnd() >= THAW) return true; u.status = null; }
      else if (u.status === 'paralysis' && rnd() < PARA) return true;
      if (u.confused) { if (--u.confused <= 0) u.confused = 0; else if (rnd() < CONF) { u.cur -= u.selfHit; calm = 0; return true; } }
      return false;
    };
    const tick = (u) => { if ((u.status === 'burn' || u.status === 'poison') && u.cur > 0) { u.cur -= Math.max(1, Math.floor(u.hp / (u.boss ? HURT : 8))); calm = 0; } };
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
              if (rnd() * 100 < a.sm.chance * RESIST) { inflict(B, a.sm.st); calm = 0; }
            } else {
              const atk = fin ? fin.atk : a.atk, drain = fin ? fin.drain : a.atkDrain, before = B.cur;
              dmg = roll(atk, a.status === 'burn' ? 0.5 : 0, 1);
              if (atk.recharge) a.recharge = true;
              if (dmg) {
                calm = 0; B.cur -= dmg;
                if (drain && a.cur > 0) a.cur = Math.min(a.hp, a.cur + Math.max(1, Math.ceil(Math.min(dmg, before) * drain)));
                thaw(B, atk, dmg);
                if (B.cur > 0 && atk.fx && rnd() * 100 < atk.fx[1]) inflict(B, atk.fx[0]);
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
              const bm = B.status === 'burn' ? BURN_ATK : 0;
              if (B.rage >= RAGE) { B.rage = 0; for (const t of targets) t.cur -= roll(t.burst, bm, PR * BURST); }
              else { const t = targets[Math.floor(rnd() * targets.length)]; t.cur -= roll(t.counter, bm, PR * CNT); }
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
                if (rnd() * 100 < t.bossSm.chance) { inflict(t, t.bossSm.st); calm = 0; }
              } else {
                const atk = fin ? fin.atk : t.bossHit, drain = fin ? fin.drain : t.bossDrain, before = t.cur;
                const dmg = roll(atk, B.status === 'burn' ? BURN_ATK : 0, P);
                if (atk.recharge) B.recharge = true;
                if (dmg) {
                  calm = 0; t.cur -= dmg;
                  if (drain) B.cur = Math.min(B.hp, B.cur + Math.max(1, Math.ceil(Math.min(dmg, before) * drain)));
                  thaw(t, atk, dmg);
                  if (t.cur > 0 && atk.fx && rnd() * 100 < atk.fx[1]) inflict(t, atk.fx[0]);
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
    return { ko: ko / runs, dealt: dealt / runs, rounds: rounds / runs, score: ko / runs + 0.25 * (dealt / runs), aura: st.aura };
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
    const info = cands.map((m) => { const a = setup([m], foeId, z).allies[0]; return { m, v: (a.atk.base * (a.atk.recharge ? 0.5 : 1) * a.hp) / Math.max(1, a.bossHit.base + a.burst.base * 0.4), sm: a.sm, para: (a.atk.fx && a.atk.fx[0] === 'paralysis') || (a.sm && a.sm.st === 'paralysis') }; });
    const byV = [...info].sort((x, y) => y.v - x.v);
    const statusUsers = byV.filter((x) => x.sm && x.sm.st !== 'paralysis').slice(0, 6);
    const pool = [...new Set([...byV.slice(0, 22), ...statusUsers, ...byV.filter((x) => x.sm).slice(0, 8)].map((x) => x.m))];
    const fill = (start, avoidPara) => { const t = [...start]; for (const x of byV) { if (t.length >= 6) break; if (t.some((y) => species(y) === species(x.m)) || (avoidPara && x.para)) continue; t.push(x.m); } return t; };
    const cur = (Gm().zoneTeam?.(foeId) || []).map((u) => Gm().getMon(u)).filter(Boolean);
    const starts = [cur.length === 6 && dupFree(cur) ? cur.map(lift) : null, fill([], false), fill([], true), ...statusUsers.slice(0, 3).map((x) => fill([x.m], true))].filter(Boolean);
    const total = starts.length * 6 * pool.length;
    let evals = 0, best = null, slice = performance.now();
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
            const trial = team.slice(); trial[slot] = cnd; ++evals;
            const quick = evaluate(trial, foeId, 50, 1, null, z);
            if (quick.score >= res.score - 0.12) { const r = full(trial); if (r.score > res.score + 0.005) { res = r; swap = cnd; } }
            if (performance.now() - slice > 50) { onProgress?.(Math.min(0.97, evals / total)); await yieldNow(); slice = performance.now(); }
          }
          if (swap) { team[slot] = swap; curRes = res; improved = true; }
        }
        if (!improved) break;
      }
      if (!best || curRes.score > best.res.score) best = { team: team.slice(), res: curRes };
    }
    const final = evaluate(best.team, foeId, 1000, 99, null, z);
    const current = cur.length === 6 ? evaluate(cur, foeId, 1000, 99, null, z) : null;
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
      const hits = dmg > 0 ? Math.max(1, Math.ceil(hp / (mine.base * 0.925))) / Math.max(0.3, mine.acc / 100) : 20;
      const first = me.spe > statsOf(foe).spe;
      const taken = theirs.base * 0.925 * (ED.wild ?? 0.85) * Math.max(0, hits - (first ? 1 : 0));
      kill += p.w / hits;
      hurt += p.w * Math.min(1, taken / Math.max(1, myHp));
      if (hits <= 1.05) oneShot += p.w;
    }
    return { score: kill - 0.5 * hurt, kill, hurt, oneShot };
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
    let side = null; try { side = G().STORY.regionOf(ch)?.key === L.to ? 'to' : 'from'; } catch (__e) { __h('35-sim:418', __e); }
    return all.filter((m) => { try { return (Gm().groupOf(m.reg) === 'to' ? 'to' : 'from') === side; } catch { return true; } });
  }
  function carriers(ch, { exclude = [], n = 4, minLevel = 90 } = {}) {
    const pool = chapterFoes(ch);
    if (!pool.length) return { pool, picks: [] };
    const away = new Set((Gm().underMons?.() || []).map((m) => m.uid));
    // a new region (Unova) is its own side until its League: only Pokémon of the chapter's side can play it
    const L = Gm().S?.link; let chSide = null;
    if (L) { try { chSide = G().STORY.regionOf(ch)?.key === L.to ? 'to' : 'from'; } catch (__e) { __h('35-sim:427', __e); } }
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

  return { CARRIER_V: 4, bandOf, staticZone, sidePool, zoneOf, setup, run, evaluate, trace, search, mulberry, chapterPool, chapterFoes, clearScore, carriers, species, dupFree };
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
    if (cur.raid) { cur.raidReg = S0.adv?.event?.reg || null; try { cur.pity0 = +E.get('Raids').pity(cur.raidReg) || 0; } catch (__e) { __h('40-record:81', __e); } }
    cur.tries0 = +(S0.legTries?.[cur.foeId] ?? 0);
    cur.hadDex = !!E.read('Game.inDex', false, cur.foeId);
    cur.teamStart = prev.team.slice(); // HP at the start - not always full
  }

  function step(b) {
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
    if (f.raid && f.pity0 != null) { try { return +E.get('Raids').pity(f.raidReg) > f.pity0 ? 'ko' : 'wipe'; } catch (__e) { __h('40-record:117', __e); } }
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
    for (const fn of listeners) try { fn(f); } catch (__e) { __h('40-record:136', __e); }
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
  const ctxOf = (f, t) => (f.raid ? 'raid' : t > 0 ? 'elite' : 'zone');
  async function fights() {
    let all = []; try { all = await Recorder.all(); } catch (__e) { __h('46-calib:31', __e); }
    return all.filter((f) => f.kind === 'static' && (f.outcome === 'ko' || f.outcome === 'wipe') && f.team?.length && isFinite(+f.power) && isFinite(+f.hpPower) && Date.now() - f.at < 14 * DAY);
  }
  // remember the strength the game really used for each legendary + tier
  async function learnObserved() {
    const fs = await fights(); const next = {};
    for (const f of fs.filter((x) => !x.raid).sort((a, b) => a.at - b.at)) { const t = tierOf(f); next[`${f.foeId}:${t}`] = { hp: +f.hpPower, power: +f.power, at: f.at }; }
    obs = next; try { localStorage.setItem(OBS, JSON.stringify(obs)); } catch (__e) { __h('46-calib:38', __e); }
  }
  function zoneFor(f, t) {
    if (f.raid) return { id: f.foeId, foe: f.foeId, level: f.foeLevel || 100, static: true, raid: true, weather: null, burst: null, counter: null, hp: +f.hpPower, power: +f.power };
    let z = null; try { z = Sim.zoneOf(f.foeId, t); } catch (__e) { __h('46-calib:42', __e); }
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
        Log.add(`simulator tuned for ${ctx === 'raid' ? 'Shiny Raids' : ctx === 'elite' ? 'elite tiers' : 'legendary zones'} from ${n} real fights: off by ${Math.round(Math.sqrt(before) * 100)} points before, ${Math.round(Math.sqrt(best.e) * 100)} after (boss power x${pk}, HP x${hk})`);
      }
      cal = out; try { localStorage.setItem(KEY, JSON.stringify(cal)); } catch (__e) { __h('46-calib:76', __e); }
      return cal;
    } finally { busy = false; }
  }
  let timer = null, newFights = 0;
  function boot() {
    if (timer) return;
    setTimeout(() => { learnObserved().catch(() => {}); }, 20_000);
    setTimeout(() => { fit().catch(() => {}); }, 90_000);
    timer = setInterval(() => { fit().catch(() => {}); }, 6 * 3_600_000);
    try { Recorder.onFight((f) => { if (f.kind === 'static') { learnObserved().catch(() => {}); if (++newFights >= 25) { newFights = 0; fit().catch(() => {}); } } }); } catch (__e) { __h('46-calib:86', __e); }
  }
  return { get, observed, fit, boot, learnObserved, tierOf, get info() { return cal; }, get observedAll() { return obs; } };
})();

/* ---------------------------------------------------------------------------------------------
 * Views: pure functions World -> HTML. No reads of their own, so what each screen shows is
 * exactly what the World snapshot says.
 * ------------------------------------------------------------------------------------------- */
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
      <button class="btn" data-act="n-test">Send a test</button><button class="btn" data-act="n-new">New topic</button>
      <div class="note dim" style="margin-top:8px">Uses the free <b>ntfy</b> app: on your iPhone install ntfy, tap +, "Subscribe to topic", type the topic above exactly. Mega took over Alakazam 4.x's topic, so if 4.x alerts reach your phone, these will too - then turn off "Send alerts to my phone" in 4.x so you don't get everything twice.</div></div>`;
    try { const r = XpChap.rank().slice(0, 6), best = r[0];
      h += `<div class="card"><h3>📈 Leveling Chapters</h3><div class="dim" style="font-size:13px">XP per hour = the game's XP formula for each chapter's wild Pokémon x the wins per hour Mega measures while training there. Close calls (within 10%) get a 10-minute check before Mega settles.</div>${r.map((x) => `<div class="row"><span class="k">${x === best ? '⭐ ' : ''}${esc(x.name)} <span class="dim">Lv ${x.top}</span></span><span class="v">${XpChap.fmt(x.xpHr)} XP/h <span class="dim">· ${XpChap.fmt(x.perWin)}/win · ${Math.round(x.rate)} wins/h ${x.learned ? `measured (${x.min} min)` : 'estimated'}</span></span></div>`).join('') || '<div class="dim">No chapters yet.</div>'}</div>`; } catch (__e) { __h('50-views:75', __e); }
    // ---- health: self-test + every swallowed error, by place ----
    try {
      const T = Health.test, R = Health.recent(), when = (t) => new Date(t).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
      h += `<div class="card"><h3>🩺 Health</h3>`;
      h += T ? `<div class="row"><span class="k">Self-test</span><span class="v ${T.failed ? 'bad' : 'ok'}">${T.failed ? `${T.failed} of ${T.n} failed` : `all ${T.n} passed`}${T.warns ? ` <span class="warn">· ${T.warns} warning${T.warns === 1 ? '' : 's'}</span>` : ''}</span></div><div class="row"><span class="k">Last run</span><span class="v dim">${esc(when(T.at))} · v${esc(T.v)} · ${esc(T.why)}</span></div>${(T.results || []).map((r) => `<div class="note ${r.warn ? '' : 'bad'}" style="margin-top:4px"><b>${r.warn ? '⚠' : '✖'} ${esc(r.name)}</b><br>${esc(r.detail || '')}</div>`).join('')}` : '<div class="dim">The self-test hasn\'t run yet.</div>';
      h += `<button class="btn" data-act="health-test">Run Self-Test</button>`;
      h += `<div class="row" style="margin-top:8px"><span class="k">Errors (24 h)</span><span class="v ${R.length ? 'warn' : 'ok'}">${R.length ? `${R.reduce((t, x) => t + (x.n || 0), 0)} in ${R.length} place${R.length === 1 ? '' : 's'}` : 'none'}</span></div>`;
      h += R.slice(0, 8).map((x) => `<div class="row"><span class="k" style="font-size:12px">${esc(x.site)} ×${x.n}</span><span class="v dim" style="font-size:12px">${esc(x.msg || '')} · ${esc(when(x.last))}</span></div>`).join('');
      if (R.length) h += `<button class="btn" data-act="health-clear">Clear the Error List</button>`;
      h += `<div class="note dim" style="margin-top:8px">Mega checks every goal, planner and screen against your save after each update. A new version that fails is rolled back to the one before by itself, and your phone gets an alert. A goal that keeps failing (5 errors in 30 min) alerts you too.</div></div>`;
    } catch (__e) { __h('50-views:86', __e); }
    { const U = Updater.info, av = Updater.available;
      h += `<div class="card"><h3>⬆ Updates</h3><div class="row"><span class="k">This version</span><span class="v">${esc(VERSION)}</span></div><div class="row"><span class="k">Newest on GitHub</span><span class="v ${U.err ? 'bad' : ''}">${U.err ? 'could not check: ' + esc(U.err) : U.latest ? esc(U.latest) + (av ? ' <span class="ok">· ready</span>' : ' · up to date') : 'checking…'}</span></div>${U.checkedAt ? `<div class="row"><span class="k">Checked</span><span class="v dim">${new Date(U.checkedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span></div>` : ''}
        ${av ? `<button class="btn" data-act="update">New Update ${esc(av)}</button>` : ''}<button class="btn" data-act="update-check">Check now</button>
        <label class="chk" style="margin-top:6px"><input type="checkbox" data-act="update-auto" ${Updater.auto ? 'checked' : ''}> Reload the game by itself to run an update (at a safe moment)</label>
        <label class="chk"><input type="checkbox" data-act="update-continue" ${Updater.autoContinue ? 'checked' : ''}> Press Continue on the title screen after a reload</label>
        <button class="btn" data-act="update-tm">Install in Tampermonkey too</button>
        <div class="note dim" style="margin-top:8px">Mega checks every 10 minutes and downloads a new version by itself; it runs the next time the game reloads (Mega reloads it at a safe moment - not during a zone, raid, tower or league - or use Reload Game on Kinesis). A version that fails to start is skipped and this one keeps running. "Install in Tampermonkey too" makes it permanent there (optional - Tampermonkey also catches up by itself).</div></div>`; }
    try { h += `<div class="card"><h3>🔗 Goal Chains</h3><label class="chk"><input type="checkbox" data-act="chains-on" ${Chains.on ? 'checked' : ''}> When a legendary is locked, add the goals it needs (catches, items, a Pokédex, a League)</label><div class="dim" style="font-size:13px">Checked every 30 minutes. A goal you remove isn't added back for the same legendary. Things Mega can't do (braille doors, trainer counts) show as "needs you" on the goal.</div></div>`; } catch (__e) { __h('50-views:94', __e); }
    h += `<div class="card"><h3>🗂️ Tabs</h3><div class="dim" style="font-size:13px">Drag a tab at the top onto another to move it. Your order is saved.</div><button class="btn" data-act="tabs-reset" style="margin-top:6px">Reset tab order</button></div>`;
    { const ci = Calib.info, names = { raid: 'Shiny Raids', elite: 'Elite tiers', zone: 'Legendary zones' };
      const rows = Object.entries(names).map(([k, l]) => { const c = ci[k]; return `<div class="row"><span class="k">${l}</span><span class="v">${c ? `off by ${Math.round(c.errAfter * 100)} pts <span class="dim">(was ${Math.round(c.errBefore * 100)}) · ${c.n} fights · ${new Date(c.at).toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>` : '<span class="dim">not enough fights yet (needs 12)</span>'}</span></div>`; }).join('');
      h += `<div class="card"><h3>🎯 Simulator Accuracy</h3><div class="dim" style="font-size:13px">Every boss fight is recorded. Once a day Mega replays them in the simulator and tunes it until its KO predictions match what really happened - so team picks and the 🥊 numbers on your phone stay honest. "Off by" is the average gap between predicted and real KO rates.</div>${rows}<button class="btn" data-act="calib-run">Tune Now</button></div>`; }
    { const G = Guard.results, list = Guard.CHECKS.map((c) => { const r = G[c.key]; return `<div class="row"><span class="k">${esc(c.label)}</span><span class="v ${r && !r.ok ? 'bad' : ''}">${!r ? 'not checked yet' : r.ok ? '<span class="ok">● looks right</span>' : esc(r.why)}</span></div>`; }).join('');
      h += `<div class="card"><h3>🛡️ Safety Checks</h3><div class="dim" style="font-size:13px">Before Mega starts anything you can't take back (Candy Factory, Shiny Raid, Underground, World Boss, elite zones, Elite League), it reads back the team the game will really use and won't start if it's short, too low, away or not the one it picked. Every 10 minutes it also checks the game data each goal relies on; anything that looks wrong after a game update pauses just those goals.</div>${list}<button class="btn" data-act="guard-run">Check Now</button></div>`; }
    { const R = Remote.info, ago = R.lastSent ? Math.round((Date.now() - R.lastSent) / 1000) : null;
      h += `<div class="card"><h3>📱 Kinesis (Phone App)</h3>
      <label class="chk"><input type="checkbox" data-act="rm-on" ${R.on ? 'checked' : ''}> Let my phone see and control Mega</label>
      ${R.on ? `<div style="margin-top:6px">${R.lastErr ? `<span class="warn">${esc(R.lastErr)}</span>` : ago != null ? `<span class="ok">●</span> ${R.relay ? 'live (every second)' : R.watched ? 'phone open - live' : 'phone closed - updates every hour'} · last update ${ago < 60 ? ago + ' s' : Math.round(ago / 60) + ' min'} ago` : 'starting…'}</div>
      <label class="chk" style="margin-top:6px"><input type="checkbox" data-act="rm-relay" ${R.relay ? 'checked' : ''}> Use Mega Relay on this PC (no outside service, no limits)</label>
      ${R.relay ? `<div class="${R.relayOk ? 'ok' : 'warn'}" style="font-size:13px">${R.relayOk ? '● Mega Relay is running - live numbers every second. On your phone open your PC\'s Tailscale address.' : R.relayOk === false ? 'Mega Relay isn\'t running: start it with start-mega-relay on this PC.' : 'checking Mega Relay…'}</div>` : ''}
      ${R.relay ? '' : `<div class="dim" style="font-size:13px">ntfy messages today: ${R.used} of ${R.budget} for the remote (ntfy's free limit is about 250 a day, shared with phone alerts). For live updates with no limit, use Mega Relay above.</div>`}
      <button class="btn gold" data-act="rm-pair" ${Notify.cfg.topic ? '' : 'disabled'}>Send Setup Link to My Phone</button>
      <button class="btn" data-act="rm-rekey">New Keys (Unpair Every Phone)</button>` : ''}
      <div class="note dim" style="margin-top:8px">Kinesis is a web page for your phone (${esc(R.page)}): the Now screen, your plan (start, pause, add, remove, reorder), the Pokédex with its "ways to get it", legendary sims and settings - while the game keeps running here. Everything goes through ntfy.sh encrypted with a key only this PC and your phone have. Trades and gems still need the game window. The setup link arrives as a phone alert: tap it once on your iPhone, then add the page to your Home Screen.</div></div>`; }
    h += `<div class="card"><h3>💤 When the Plan Is Idle</h3>
      <label class="chk"><input type="checkbox" data-act="idle-level" ${Plan.idleOn ? 'checked' : ''}> Level Pokémon when every goal is done or waiting</label>
      <div class="note dim" style="margin-top:8px">After 2 minutes with nothing to run, Mega levels three at a time: Pokémon that took a gem first, then shinies, then the ones closest to Lv 100 (up to your level cap). It uses the best training chapter with carriers and a Pinap Berry, keeps that chapter looping so the story never moves on by itself, sends a phone alert, and puts your team, buddy and chapter back as soon as a real goal is ready.</div></div>`;
    h += `<div class="card"><h3>🍓 Berries</h3>
      <label class="chk"><input type="checkbox" data-act="berries" ${Berries.on ? 'checked' : ''}> Use berries while goals run</label>
      <div class="note dim" style="margin-top:8px">One at a time, only for the goal that's running, never replacing a stronger one: Enigma + Razz while catching a missing Pokémon in the wild, Golden Razz (or Razz) at a legendary or special encounter, Pinap while leveling, Lansat while farming money, Rowap while chasing a roamer. Shiny (Starf) berries are left for you.</div></div>`;
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
    h += `<div class="card"><h3>Never called (safety rules)</h3><div class="dim" style="font-size:13px">${[...Engine.FORBIDDEN].map((p) => `<code>${esc(p)}</code>`).join(' · ')}</div></div>`;
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
      h += `<div class="card"><div data-act="foe" data-foe="${id}" style="display:flex;gap:8px;align-items:center;cursor:pointer"><img src="${Engine.sprite(id)}" width="40" height="40" style="image-rendering:pixelated">
        <div style="flex:1"><b>${esc(World.dex.name(id))}</b> <span class="dim">${list.length} fight${list.length === 1 ? '' : 's'}</span><div>${rate}</div></div><span class="dim">${open ? '▾' : '▸'}</span></div>`;
      if (open) {
        h += row('Turns to KO / to wipe', `${A.turnsKo ? A.turnsKo.toFixed(1) : '-'} / ${A.turnsWipe ? A.turnsWipe.toFixed(1) : '-'}`);
        h += row(`${esc(World.dex.name(id))}'s hit on one target`, A.bossHit ? `${Math.round(A.bossHit)} <span class="dim">(${A.bossHitN})</span>` : '-');
        h += row('Rage burst on each of yours', A.burst ? `${Math.round(A.burst)} <span class="dim">(${A.burstN})</span>` : '-');
        for (const t of A.ticks) h += row(`${t.st === 'burn' ? 'Burn' : 'Poison'} tick on ${esc(World.dex.name(id))}`, `<b class="ok">${Math.round(t.avg)}</b> <span class="dim">(${t.n} ticks)</span>`);
        if (A.statusShare != null && A.ticks.length) h += row('Damage from poison / burn', `<b>${Math.round(A.statusShare * 100)}%</b> <span class="dim">of all damage dealt</span>`);
        h += row('Counter-hit on one of yours', A.counter ? `${Math.round(A.counter)} <span class="dim">(${A.counterN})</span>` : '-');
        h += `<div style="margin-top:6px;font-weight:700;color:#d9d3ff">Your damage per action</div>`;
        for (const t of A.attackers) h += `<div class="row"><span class="k" style="display:flex;align-items:center;gap:6px"><img src="${Engine.sprite(t.id)}" width="28" height="28" style="image-rendering:pixelated">${esc(World.dex.name(t.id))}${t.shiny ? ' ✨' : ''}${t.rank ? ` r${t.rank}` : ''}</span><span class="v">${t.avg ? Math.round(t.avg) : '-'} <span class="dim">· ${t.n} actions${t.missRate ? `, ${Math.round(t.missRate * 100)}% no damage` : ''}</span></span></div>`;
      }
      h += `</div>`;
    }
    return h;
  }

  return { now, dex, engine, fights, row };
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
    try { for (const [re, map] of list) v = v.replace(re, (m, pre, k) => pre + (map.get(k) ?? k)); } catch (__e) { __h('54-case:58', __e); }
    if (memo.size > 3000) memo.clear();
    memo.set(s, v);
    return v;
  }
  const TITLE = 'h3, .row > .k, .tabs button, button.btn, option, summary, label.chk, .gt';
  function textNodes(el, fn) { const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); const list = []; while (w.nextNode()) list.push(w.currentNode); for (const n of list) { const v = fn(n.nodeValue); if (v !== n.nodeValue) n.nodeValue = v; } }
  function apply(root) {
    if (!root) return;
    textNodes(root, (t) => terms(names(t)));
    for (const el of root.querySelectorAll(TITLE)) {
      if (el.closest('[data-raw]')) continue;
      // label.chk: only its own words (not nested inputs)
      textNodes(el, (t) => (t.trim() ? title(t) : t));
    }
  }
  return { apply, title, terms, names };
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
    const zs = E.get('LegendZones.ZONES') || [];
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
        id: z.id, name: DX[z.id]?.name || '#' + z.id, region: z.region, place: z.zone || z.at,
        level: z.level, hp: kn?.hp ?? z.hp, power: kn?.power ?? z.power, burst: z.burst, weather: z.weather || null,
        forms, form, formName: form ? DX[form]?.name || null : null, allForms,
        state: safe(() => LZ().state(z), 'locked'), when: safe(() => LZ().whenText(z)),
        progress: p ? { text: p.text, have: p.have, need: p.need, braille: !!p.braille, lines: (p.lines || []).map((l) => ({ text: l.text, have: l.have, need: l.need })) } : null,
      };
    });
  }
  const get = (id) => list().find((x) => x.id === +id) || null;

  // simulated best teams (kept per legendary until you ask again)
  const sims = () => { try { return JSON.parse(localStorage.getItem(SIM_KEY) || '{}'); } catch { return {}; } };
  function saveSim(id, r) {
    const all = sims();
    all[id] = { uids: r.team.map((m) => m.uid), ko: r.final.ko, today: r.today ? r.today.ko : r.final.ko, toLevel: r.toLevel || [], asMax: !!r.asMax, rounds: r.final.rounds, current: r.current ? r.current.ko : null, at: r.at };
    try { localStorage.setItem(SIM_KEY, JSON.stringify(all)); } catch (__e) { __h('55-legends:43', __e); }
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

  function dropSim(id) { const all = sims(); delete all[id]; try { localStorage.setItem(SIM_KEY, JSON.stringify(all)); } catch (__e) { __h('55-legends:56', __e); } }
  return { list, get, sims, saveSim, dropSim, realFor };
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
  const wxName = (k) => (k ? WX[k] || k : 'clear');
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

  // ---- places ----
  const placeOf = (ch, st) => ({ name: st.name, bg: st.bg, scene: st.scene, indoor: st.indoor, climate: st.climate, habitat: st.habitat, ch });
  const weatherNow = (place) => safe(() => E.get('WEATHER').current(place));
  // next hour (game forecast) where the weather is one of `keys` and the time-of-day test passes
  function nextWindow(place, keys, timeOk) {
    const hours = safe(() => E.get('WEATHER').hours(place), []) || [];
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
      if (st.needs && have < (st.needN || 1)) blockers.push(`${st.needN} ${st.needs.replace(/-/g, ' ')}${st.needN > 1 ? 's' : ''} (you have ${have})`);
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
  const itemName = (key) => {
    if (key.startsWith('egg:')) return `${name(+key.slice(4))} Egg`;
    let n = null; try { n = E.get('UI')?.itemName?.(key); } catch (__e) { __h('56-dexinfo:150', __e); }
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
  function evoText(e) {
    if (!e) return '';
    if (e.item === 'link-cable') return 'when traded';
    const bits = [];
    if (e.level) bits.push(`at Lv ${e.level}`);
    if (e.item) bits.push(`with ${e.item.replace(/-/g, ' ')}`);
    if (e.time) bits.push(`at ${e.time}`);
    if (e.happy || e.friendship) bits.push('with high friendship');
    return bits.join(', ') || 'by a special condition';
  }

  // ---- everything about one Pokémon ----
  function howTo(id) {
    id = +id;
    const d = D()[id] || {}, s = S();
    const owned = (E.read('Game.ownedMons', []) || []).filter((m) => +m.id === id);
    const evo = evoFrom(id);
    const pre = evo ? (E.read('Game.ownedMons', []) || []).filter((m) => +m.id === evo.from).sort((a, b) => b.level - a.level)[0] || null : null;
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
      out.push({ kind: 'special', ch: sp.ch, place: sp.place, soul, regMiss, text: `special encounter at ${sp.place} (${sp.chapter}) · ${conditionText(sp)}${sp.chance < 1 ? ` · ${pct(sp.chance)} each time the chapter is built` : ''}${soul ? ` · needs ${soul.need} ${soul.item}s, you have ${soul.have}` : ''}${regMiss ? ` · register ${sp.missingCaught.map(name).join(', ')} first` : ''}` });
    }
    let evo = null;
    if (h.evolve?.pre) {
      const copies = (E.read('Game.allMons', []) || []).filter((m) => +m.id === +h.evolve.from).length;
      const last = copies <= 1;
      const warn = last ? ` - it's your only ${h.evolve.fromName}, so ${h.evolve.fromName} leaves your Pokédex (getting it back means a Day Care egg)` : ` - you have ${copies}, so you keep a ${h.evolve.fromName}`;
      if (h.evolve.level && !h.evolve.item) evo = { kind: 'evolve', uid: h.evolve.pre.uid, level: h.evolve.level, from: h.evolve.from, last, text: `level your ${h.evolve.fromName} (Lv ${h.evolve.pre.level}) to ${h.evolve.level} to evolve${warn}` };
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

  return { itemFor, howTo, route, routes, whenText, rareItems, availableNow, eggs, eggSlots, loot, itemName, breedFrom, special, wild, forms, regionIds, conditionText, windowText, wxName, clock, pct, evoText };
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
    if (ready.length) {
      const n = ready.map((e) => name(e.id) + (e.shinyParent ? ' ✨' : ''));
      Notify.send('egg', ready.length === 1 ? `${n[0]} egg is ready to hatch` : `${ready.length} eggs are ready to hatch`, ready.length === 1 ? 'Open the Day Care to hatch it' : n.join(', '));
    }
    const live = new Set(d.eggs.map((e) => e.uid));
    told = [...told.filter((u) => live.has(u)), ...ready.map((e) => e.uid)];
    try { localStorage.setItem(DONE, JSON.stringify(told)); } catch (__e) { __h('57-daycare:34', __e); }
  }
  let timer = null;
  function boot() { if (timer) return; timer = setInterval(() => { try { check(); } catch (__e) { __h('57-daycare:37', __e); } }, 30_000); }
  const left = (ms) => { const m = Math.ceil(ms / 60_000); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ' ' + (m % 60) + ' min' : ''}`; };
  // hatch ready eggs (one by uid, or every ready one) - for a tap in Mega or Kinesis
  function hatch(uid) {
    const eggs = (E.get('Game.S')?.pension?.eggs || []).filter((e) => (uid ? e.uid === uid : true) && E.read('Game.eggReady', false, e));
    if (!eggs.length) return 'no egg is ready yet';
    const got = [];
    for (const e of eggs) { let r = null; try { r = E.call('Game.hatchEgg', e.uid); } catch (__e) { __h('57-daycare:44', __e); } if (r) got.push(name(e.id)); }
    try { E.call('Game.save'); } catch (__e) { __h('57-daycare:45', __e); } try { E.call('App.refresh'); } catch (__e) { __h('57-daycare:45', __e); }
    return got.length ? `hatched ${got.join(', ')}` : 'the game didn\'t hatch it - open the Day Care';
  }
  return { info, boot, left, name, hatch };
})();

/* ---------------------------------------------------------------------------------------------
 * Legends tab view. ui = { pick, simRun: {id, pct, result, error}, real: {id, ...} }
 * ------------------------------------------------------------------------------------------- */
Views.legends = (w, ui, esc) => {
  if (!w.ok) return `<div class="note">Waiting for the game engine.</div>`;
  const all = Legends.list();
  const order = { open: 0, closed: 1, locked: 2, done: 3 };
  const label = { open: '<span class="ok">open</span>', closed: '<span class="warn">closed now</span>', locked: '<span class="dim">locked</span>', done: '<span class="dim">caught</span>' };
  const name = (id) => esc(World.dex.name(id));
  const mon = (uid) => Engine.read('Game.getMon', null, uid);
  const pct = (x) => (x == null ? '?' : Math.round(x * 100) + '%');
  let h = '';

  const sel = ui.pick ? Legends.get(ui.pick) : null;
  h += `<select class="sel" data-act="pick"><option value="">Choose a legendary…</option>${[...all].sort((a, b) => order[a.state] - order[b.state] || a.id - b.id).map((z) =>
    `<option value="${z.id}" ${+ui.pick === z.id ? 'selected' : ''}>${esc(z.name)} · ${esc(z.region)} · ${z.state === 'done' ? 'caught' : z.state}</option>`).join('')}</select>`;

  if (sel) {
    h += `<div class="card"><h3>${esc(sel.name)} <span class="dim">Lv ${sel.level}</span></h3>
      <div class="row"><span class="k">Zone</span><span class="v">${label[sel.state] || esc(sel.state)}</span></div>
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
    const cur = Engine.read('Game.zoneTeam', [], sel.id) || [];
    const saved = Legends.sims()[sel.id];
    const teamRow = (uids) => `<div class="grid">${uids.map((u) => { const m = mon(u); return m ? `<div class="mon"><img src="${Engine.sprite(m.id)}" alt="">${name(m.id)}${m.shiny ? ' ✨' : ''}<br><span class="dim">Lv ${m.level}</span></div>` : `<div class="mon unk"><span class="dim">away</span></div>`; }).join('')}</div>`;
    h += `<div class="card"><h3>Zone team now</h3>${cur.length ? teamRow(cur) : '<div class="note">No team set for this zone yet.</div>'}`;
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
      if (saved.current != null) h += `<div class="row"><span class="k">Zone team now</span><span class="v dim">${pct(saved.current)}</span></div>`;
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
    h += `<div class="card goal">
        <div style="display:flex;align-items:center;gap:10px">
          <b class="dim" style="width:20px;font-size:16px">${i + 1}</b>
          ${sp ? `<img src="${Engine.sprite(sp)}" width="44" height="44" style="image-rendering:pixelated;flex:none">` : `<span style="width:44px;text-align:center;font-size:26px;flex:none">${g.type === 'under' ? '⛏️' : g.type === 'region' ? '📘' : g.type === 'candy' ? '🍬' : g.type === 'tower' ? '🗼' : g.type === 'raid' ? '✨' : g.type === 'elite' ? '🏆' : g.type === 'league' ? '🎖️' : g.type === 'wboss' ? '🌍' : g.type === 'money' ? '💰' : '•'}</span>`}
          <div style="flex:1;min-width:0"><b class="gt" style="font-size:16px">${esc(Plan.label(g))}</b>${bg ? ' <span class="dim gt" style="font-size:13px">· alongside</span>' : ''}</div>
        </div>
        <div class="${cls} st" style="margin:6px 0 0 30px">${dot} ${word}${L.why ? ' · ' + esc(L.why) : ''}${L.state === 'running' && L.line ? ' · ' + esc(L.line) : ''}</div>${L.state === 'running' && L.team && (L.team.win != null || L.team.how) ? `<div class="dim" style="margin:2px 0 0 30px;font-size:12px">🛡️ ${L.team.win != null ? Math.round(L.team.win * 100) + '% · ' : ''}${esc(L.team.how || '')}</div>` : ''}
        ${g.type === 'region' && g.rows?.length ? `<details style="margin:8px 0 0 30px" ${ui.openRows?.[g.id] ? 'open' : ''}><summary data-act="rows" data-id="${g.id}" style="cursor:pointer;color:#c9a8ff">Show the ${g.rows.length} missing</summary>${g.rows.map((r) => `<div class="row" style="justify-content:flex-start;align-items:center;gap:8px"><img src="${Engine.sprite(r.id)}" width="36" height="36" style="image-rendering:pixelated;flex:none"><span style="flex:1"><b>${esc(World.dex.name(r.id))}</b><br><span class="${r.job ? 'ok' : 'dim'}">${esc(r.text)}</span></span></div>`).join('')}</details>` : ''}
        <div class="tools">
          <button class="btn sm" data-act="g-top" data-id="${g.id}" ${i === 0 ? 'disabled' : ''} title="Move to the top">⤒ Top</button>
          <button class="btn sm" data-act="g-up" data-id="${g.id}" ${i === 0 ? 'disabled' : ''} title="Move up">↑ Up</button>
          <button class="btn sm" data-act="g-down" data-id="${g.id}" ${i === open.length - 1 ? 'disabled' : ''} title="Move down">↓ Down</button>
          <button class="btn sm" data-act="g-pause" data-id="${g.id}">${g.paused ? '▶ Resume' : '❚❚ Pause'}</button>
          <button class="btn sm danger" data-act="g-del" data-id="${g.id}" title="Remove from the plan">✕ Remove</button>
        </div>
        ${g.type === 'raid' ? `<button class="btn sm" style="margin-top:6px" data-act="m-raid-repick">🔄 Re-pick Raid Team</button>` : ''}${/3 times|try anyway/.test(L.why || '') ? `<button class="btn sm" style="margin-top:6px" data-act="g-retry" data-id="${g.id}">${/try anyway/.test(L.why || '') ? 'Try Anyway' : 'Try again'}</button>` : ''}</div>`;
  });

  // add a goal - shown right under Start / Pause, above the list
  const goalsHtml = h; h = head;
  const legends = Legends.list().filter((z) => z.state !== 'done' && !Plan.has(z.id));
  const order = { open: 0, closed: 1, locked: 2 };
  h += `<div class="card"><h3>Add a goal</h3>
    <select class="sel" data-act="add-type"><option value="legend" ${ui.addType !== 'under' ? 'selected' : ''}>Catch a legendary</option><option value="under" ${ui.addType === 'under' ? 'selected' : ''} ${Plan.hasType('under') ? 'disabled' : ''}>Underground (runs alongside)${Plan.hasType('under') ? ' - already in your plan' : ''}</option><option value="item" ${ui.addType === 'item' ? 'selected' : ''}>Find a rare item</option><option value="wboss" ${ui.addType === 'wboss' ? 'selected' : ''} ${Plan.hasType('wboss') ? 'disabled' : ''}>World Boss (every edition)</option><option value="region" ${ui.addType === 'region' ? 'selected' : ''}>Complete a region's Pokédex</option><option value="story" ${ui.addType === 'story' ? 'selected' : ''}>Beat a region's League</option><option value="money" ${ui.addType === 'money' ? 'selected' : ''} ${Plan.hasType('money') ? 'disabled' : ''}>Farm money${Plan.hasType('money') ? ' - already in your plan' : ''}</option><option value="raid" ${ui.addType === 'raid' ? 'selected' : ''} ${Plan.hasType('raid') ? 'disabled' : ''}>Shiny Raid every day${Plan.hasType('raid') ? ' - already in your plan' : ''}</option><option value="tower" ${ui.addType === 'tower' ? 'selected' : ''} ${Plan.hasType('tower') ? 'disabled' : ''}>Battle Tower every week${Plan.hasType('tower') ? ' - already in your plan' : ''}</option><option value="candy" ${ui.addType === 'candy' ? 'selected' : ''} ${Plan.hasType('candy') ? 'disabled' : ''}>Candy Factory every day${Plan.hasType('candy') ? ' - already in your plan' : ''}</option><option value="" disabled>More coming: dailies, items</option></select>`;
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
      <div class="dim" style="font-size:13px;margin-top:6px">${on.length ? `Hunting now: ${on.map((x) => esc(x.name)).join(', ')} · ` : ''}${have.length ? `You have: ${have.map((x) => esc(x.name)).join(', ')}` : ''}${later.length ? `<br>Not yet: ${later.map((x) => `${esc(x.name)} (${esc(x.spots[0]?.blockers[0] || 'locked')})`).join(', ')}` : ''}</div>`;
    if (it) {
      h += `<div style="margin-top:8px">${it.uses.length ? `<div>Used to: ${esc(it.uses.join(', '))}</div>` : ''}${it.need > 1 ? `<div>You collect up to ${it.need} (have ${it.have}).</div>` : ''}</div>`;
      for (const L of it.spots.filter((x) => !x.blockers.length)) h += `<div style="padding:8px 0;border-top:1px solid #2b2450"><div><b>${esc(L.place)}</b> · ${esc(L.chapter)} <span class="dim">ch ${L.ch}</span> · ${DexInfo.pct(L.chance)} at its item stop</div>
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
  } else if (ui.addType === 'candy') {
    h += `<button class="btn" data-act="plan-add-candy" ${Plan.hasType('candy') ? 'disabled' : ''}>Add to plan</button>
    <div class="note dim">Runs the Candy Factory once a day as soon as it opens: reads the day's type, picks the six that beat it best, starts the run, and lets it play out. Dailies go ahead of your other goals, like in 4.x.</div></div>`;
  } else if (ui.addType === 'story') {
    // regions you've unlocked whose League isn't beaten yet (new regions show up here as the game adds them)
    const ST = Engine.get('STORY'), un = +(Engine.get('Game.S')?.adv?.unlocked ?? 0), NM = { unova: 'Unova', kalos: 'Kalos', alola: 'Alola', galar: 'Galar', paldea: 'Paldea' };
    const regs = (ST?.REGIONS || []).filter((r) => r && r.key).map((r) => { let chs = []; try { chs = ST.chaptersOf(r.key) || []; } catch (__e) { __h('58-planview:79', __e); } return { key: r.key, name: NM[r.key] || r.name, chs }; })
      .filter((r) => r.chs.length && un >= r.chs[0] && !Engine.read('Game.regionCleared', false, r.key));
    h += regs.length ? `<select class="sel" data-act="add-story"><option value="">Choose a region…</option>${regs.map((r) => `<option value="${r.key}" ${ui.addStory === r.key ? 'selected' : ''} ${Plan.goals.some((g) => !g.done && g.type === 'story' && g.region === r.key) ? 'disabled' : ''}>${esc(r.name)} League${Plan.goals.some((g) => !g.done && g.type === 'story' && g.region === r.key) ? ' (in your plan)' : ''}</option>`).join('')}</select>
    <button class="btn" data-act="plan-add-story" ${ui.addStory ? '' : 'disabled'}>Add to plan</button>` : `<div class="note">Every League you've unlocked is beaten.</div>`;
    h += `<div class="note dim">Plays that region's chapters in order with the Pokémon caught there: the simulator picks the 6 best for each chapter and its gym, and after 2 losses in a row it trains for 30 minutes in the best cleared chapter, then tries again. It stays in that region's chapters (an older chapter would swap your money, bag and team) and sits below your dailies, which take the screen when they're due.</div></div>`;
  } else if (ui.addType === 'region') {
    const regs = (Engine.get('STORY.REGIONS') || []).filter((r) => r && r.key).map((r) => ({ ...r, miss: GoalTypes.regionMissing(r.key).length })).filter((r) => r.miss);
    h += `<select class="sel" data-act="add-reg"><option value="">Choose a region…</option>${regs.map((r) => `<option value="${r.key}" ${ui.addReg === r.key ? 'selected' : ''} ${Plan.goals.some((g) => !g.done && g.type === 'region' && g.reg === r.key) ? 'disabled' : ''}>${esc(r.name || r.key)} · ${r.miss} missing</option>`).join('')}</select>
    <button class="btn" data-act="plan-add-reg" ${ui.addReg ? '' : 'disabled'}>Add to plan</button>
    <div class="note dim">Finds a way to get each missing Pokémon and adds those jobs to your plan right below it: catch in the wild (restarting the chapter when it can't show up any more), level to evolve, or catch the legendary. What it can't do yet is listed with the reason.</div></div>`;
  } else
  if (ui.addType === 'under') {
    const starts = (() => { try { return Engine.get('Underground').starts() || [1]; } catch { return [1]; } })();
    h += `<select class="sel" data-act="add-from">${starts.map((f) => `<option value="${f}" ${+ui.addFrom === f ? 'selected' : ''}>Start at floor ${f}${f === 1 ? ' (most loot in total)' : ''}</option>`).join('')}</select>
    <button class="btn" data-act="plan-add-ug" ${Plan.hasType('under') ? 'disabled' : ''}>Add to plan</button>
    <div class="note dim">Runs next to your other goals: brings finished expeditions home (never early), sends new ones while you have runs left today, and picks each team with the game's own expedition simulation from Pokémon your other goals and chapter team aren't using.</div></div>`;
  } else {
  h += `
    <select class="sel" data-act="add-foe"><option value="">Choose a legendary…</option>${[...legends].sort((a, b) => order[a.state] - order[b.state] || a.id - b.id).map((z) =>
      `<option value="${z.id}" ${+ui.addFoe === z.id ? 'selected' : ''}>${esc(z.name)} · ${z.state === 'open' ? 'open' : z.state === 'closed' ? 'closed now' : 'locked'}</option>`).join('')}</select>
    <button class="btn" data-act="plan-add" ${ui.addFoe ? '' : 'disabled'}>Add to plan</button>
    <div class="note dim">Locked ones can go on the list too: they wait until you unlock them. A legendary with no team gets one from the simulator automatically.</div></div>`;
  }

  h += goalsHtml;
  if (done.length) h += `<div class="card"><h3>Done</h3>${done.map((g) => `<div class="row"><span class="k">✔ ${esc(Plan.label(g))}</span><span class="v dim">${new Date(g.done).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span></div>`).join('')}<button class="btn sm" style="margin-top:6px" data-act="plan-clear">Clear done</button></div>`;

  const lines = Log.lines.slice(ui.showLog ? -40 : -6).reverse();
  h += `<div class="card"><h3>What Mega did</h3>${lines.length ? lines.map((l) => `<div class="row" style="justify-content:flex-start"><span class="k" style="white-space:nowrap;flex:none;width:78px">${new Date(l.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span><span style="text-align:left">${esc(l.text)}</span></div>`).join('') : '<div class="dim">Nothing yet.</div>'}<button class="btn" data-act="log-more">${ui.showLog ? 'Show less' : 'Show more'}</button></div>`;
  return h;
};

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
      <img src="${Engine.sprite(id)}" width="96" height="96" style="image-rendering:pixelated;background:var(--well,#16122b);border-radius:14px;flex:none">
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
        o += `<div style="${k ? 'border-top:1px solid #2b2450;margin-top:10px;padding-top:10px' : ''}">
          ${ways.length > 1 ? `<div class="dim" style="font-size:13px;font-weight:700">${k === 0 ? 'BEST' : 'OR'}</div>` : ''}
          <div>${esc(wy.text)}</div>`;
        if (wy.kind === 'wild') { // every chapter it lives in: pick the one to add
          const W = DexInfo.wild(id);
          o += `<div style="margin-top:6px">${W.map((c) => `<div style="padding:8px 0;border-top:1px solid #2b2450">
            <div><b>${esc(c.chapter)}</b> <span class="dim">ch ${c.ch}</span> · ${DexInfo.pct(c.best)}${c.open ? (c.now ? ' <span class="ok">● now</span>' : ' <span class="warn">not at this time / weather</span>') : ' <span class="dim">· not unlocked</span>'}</div>
            <div class="dim" style="font-size:13px">${c.spots.map((x) => `${esc(x.place)} (${DexInfo.pct(x.pct)}${x.when?.length ? ` · ${x.on ? '' : '<span class="warn">'}${esc(DexInfo.whenText(x.when))} only${x.on ? '' : '</span>'}` : ''}${x.fights ? ` · ${x.fights} wild fight${x.fights > 1 ? 's' : ''} per run` : ''})`).join(' · ')}</div>
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
 * UI: the Mega Alakazam panel. Lives in a shadow root so neither the game's styles nor Alakazam
 * 4.x's can leak in or out. Docked as a full-height column on the left; the game is moved right by
 * the same width (and back when folded), so nothing of the game is covered.
 * ------------------------------------------------------------------------------------------- */
const UI = (() => {
  const PREFS_KEY = 'mega-alakazam-ui';
  const prefs = (() => { try { return { tab: 'now', open: true, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') }; } catch { return { tab: 'now', open: true }; } })();
  const savePrefs = () => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (__e) { __h('60-ui:9', __e); } };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtIn = (t) => {
    if (!t) return '';
    const s = Math.max(0, Math.round((t - Date.now()) / 1000));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
  };
  const CSS = `
    :host{all:initial}
    .wrap{position:fixed;left:0;top:0;bottom:0;z-index:99998;font:15px/1.5 Inter,system-ui,-apple-system,"Segoe UI",sans-serif;color:#eceaf6;display:flex}
    .rail{width:64px;height:100%;display:flex;flex-direction:column;align-items:center;gap:14px;padding-top:14px;box-sizing:border-box;
          background:linear-gradient(180deg,#171330,#0d0b18);border-right:1px solid #352d5a;cursor:pointer}
    .rail img,.hd img{image-rendering:pixelated;filter:drop-shadow(0 0 6px #f6c744aa) drop-shadow(0 0 2px #fff6)}
    .rail .open{color:#c9a8ff;font-size:22px;font-weight:800}
    .panel{height:100%;display:flex;flex-direction:column;background:#141127;border-right:1px solid #352d5a;box-shadow:8px 0 30px #0007;position:relative;box-sizing:border-box}
    .grip{position:absolute;top:0;right:-4px;width:8px;height:100%;cursor:ew-resize;z-index:2}
    .grip:hover{background:linear-gradient(90deg,transparent,#7a5cff88,transparent)}
    .hd{display:flex;align-items:center;gap:6px;padding:10px 10px;background:linear-gradient(90deg,#2a1f55,#171330);border-bottom:1px solid #352d5a;user-select:none}
    .hd .t{font-weight:800;letter-spacing:.2px;font-size:16px;white-space:nowrap;background:linear-gradient(90deg,#ffe27a,#f6c744 40%,#c9a8ff);-webkit-background-clip:text;background-clip:text;color:transparent}
    .hd .v{color:#a39ec2;font-size:13px;margin-left:auto;margin-right:4px}
    .hd .fold{all:unset;cursor:pointer;color:#cfc9ef;font-size:18px;font-weight:800;padding:2px 8px;border-radius:8px} .hd .fold:hover{background:#ffffff14} .hd .fold[disabled]{opacity:.35;cursor:default}
    .dot{width:11px;height:11px;border-radius:50%;background:#5ad68a;box-shadow:0 0 8px #5ad68a;flex:none}
    .dot.warn{background:#ffb547;box-shadow:0 0 8px #ffb547} .dot.err{background:#ff6b6b;box-shadow:0 0 8px #ff6b6b}
    .tabs{display:grid;grid-template-columns:repeat(5,1fr);gap:6px;padding:10px 12px;border-bottom:1px solid #2b2450;background:#171330}
    .tabs button{all:unset;cursor:pointer;text-align:center;padding:8px 4px;border-radius:10px;color:#b7b1d6;font-weight:700;font-size:15px;background:#1f1a38}
    .tmwrap{container-type:inline-size} .tmgrid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px 6px;text-align:center}
    @container (min-width:380px){.tmgrid{grid-template-columns:repeat(6,minmax(0,1fr))}}
    .tmname{font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .tabs button{touch-action:none}
    .card h3.foldh{cursor:pointer;user-select:none;display:flex;align-items:center} .card h3.foldh::after{content:'▾';margin-left:auto;opacity:.6;font-size:14px;transition:transform .15s}
    .card.folded h3.foldh::after{transform:rotate(-90deg)} .card.folded > :not(h3){display:none !important} .card.folded h3.foldh{margin-bottom:0} .hd .fold.upd{background:linear-gradient(90deg,#d4a017,#f5c542);color:#1b1533;font-weight:800;font-size:13px;padding:4px 9px} .tabs button.drag{opacity:.4} .tabs button.dropto{outline:2px dashed #b59cff;outline-offset:-2px}
    .hd{position:relative} .hd .vtip{position:absolute;left:8px;top:100%;margin-top:2px;padding:3px 8px;border-radius:8px;background:#2a2350;color:#fff;font-size:12px;font-weight:700;white-space:nowrap;opacity:0;pointer-events:none;transition:opacity .12s;z-index:5;box-shadow:0 2px 10px #0008}
    .hd img.ver:hover + .vtip{opacity:1}
    .tabs button:hover{background:#2a2350;color:#fff} .tabs button.on{background:linear-gradient(90deg,#5b3fd6,#7a5cff);color:#fff;box-shadow:0 2px 10px #7a5cff55}
    .body{padding:12px;overflow:auto;flex:1;scrollbar-width:thin;scrollbar-color:#3a3260 transparent}
    .note{font-size:14px;color:#cdc7ee;background:#221c40;border:1px solid #3a3260;border-radius:12px;padding:9px 12px;margin-bottom:10px}
    .card{background:#1d1836;border:1px solid #2e2752;border-radius:14px;padding:12px 14px;margin-bottom:10px}
    .card h3{all:unset;display:block;font-weight:800;font-size:16px;color:#e4dfff;margin-bottom:8px;letter-spacing:.2px}
    .row{display:flex;justify-content:space-between;gap:10px;padding:5px 0;border-top:1px solid #ffffff0d} .row:first-of-type{border-top:0}
    .row .k{color:#b0aacf} .row .v{text-align:right}
    .ok{color:#62e096} .warn{color:#ffbe5c} .bad{color:#ff7a7a} .dim{color:#a39ec2}
    .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(84px,1fr));gap:8px}
    .mon{background:#16122b;border:1px solid #2e2752;border-radius:12px;padding:6px 4px;text-align:center;font-size:13px;line-height:1.3;color:#dcd7f5}
    .mon img{width:56px;height:56px;image-rendering:pixelated;display:block;margin:0 auto}
    .mon.leg{border-color:#7a5cff} .mon.now{border:2px solid #3ddc84;box-shadow:0 0 10px #3ddc8466} .mon.seen{opacity:.95} .mon.unk img{filter:brightness(0) invert(.35)}
    .bar{height:8px;border-radius:5px;background:#2e2752;overflow:hidden;margin-top:6px} .bar i{display:block;height:100%;background:linear-gradient(90deg,#7a5cff,#f6c744)}
    input.q{all:unset;box-sizing:border-box;width:100%;background:#16122b;border:1px solid #3a3260;border-radius:10px;padding:10px 12px;color:#fff;margin-bottom:10px;font-size:15px}
    .btn{all:unset;box-sizing:border-box;cursor:pointer;display:block;width:100%;text-align:center;background:#2e2752;color:#fff;border-radius:12px;padding:12px 14px;margin:10px 0 0;font-weight:700;font-size:16px;min-height:46px;line-height:22px}
    .btn:hover{background:#3d3470} .btn[disabled]{opacity:.4;cursor:default} .btn.sm{padding:10px 4px;margin:0;font-size:14px;min-height:44px}
    .btn.danger{background:#4a2233} .btn.danger:hover{background:#5e2a40}
    .btn.gold{background:linear-gradient(90deg,#7a5cff,#c79a2b);margin-top:12px;font-size:17px}
    label.chk{display:block;margin-top:10px;color:#dcd7f5;cursor:pointer} label.chk input{vertical-align:middle;margin-right:6px;width:17px;height:17px}
    .goal .tools{display:grid;grid-template-columns:repeat(5,1fr);gap:6px;margin-top:10px} .goal .tools .btn{width:100%}
    .goal .st{font-size:14px;margin-top:2px}
    select.sel{box-sizing:border-box;width:100%;background:#16122b;border:1px solid #3a3260;border-radius:10px;padding:9px 10px;color:#fff;margin-bottom:10px;font-size:15px}
    code{font:13px ui-monospace,Menlo,Consolas,monospace;color:#c9a8ff}
    /* ===== Field Device theme: a glossy handheld shell around LCD-style screens. Night = dark screen, Day = paper screen ===== */
    .wrap.th-night,.wrap.th-day{--shell1:#c4283a;--shell2:#7d1222;--seam:#4a0a14}
    .th-night .panel,.th-day .panel{border-right:3px solid var(--seam)}
    .th-night .hd,.th-day .hd{background:linear-gradient(180deg,var(--shell1),var(--shell2));border-bottom:3px solid var(--seam);box-shadow:inset 0 1px 0 #ffffff40,inset 0 -6px 12px #0003}
    .th-night .hd .t,.th-day .hd .t{background:none;color:#fff;-webkit-background-clip:initial;background-clip:initial;text-shadow:0 1px 0 #0006;letter-spacing:1px}
    .th-night .hd .fold,.th-day .hd .fold{color:#ffe9ec}
    .th-night .hd .dot,.th-day .hd .dot{width:13px;height:13px;border:2px solid #ffffffb0;box-sizing:border-box}
    .th-night .rail,.th-day .rail{background:linear-gradient(180deg,var(--shell1),var(--shell2));border-right:3px solid var(--seam)}
    .th-night .rail .open,.th-day .rail .open{color:#fff}
    .th-night .tabs,.th-day .tabs{background:var(--shell2);border-bottom:3px solid var(--seam)}
    .th-night .tabs button,.th-day .tabs button{background:#00000030;color:#ffdfe3;border:1px solid #ffffff22;box-shadow:inset 0 -2px 0 #0003}
    .th-night .tabs button:hover,.th-day .tabs button:hover{background:#ffffff26;color:#fff}
    .th-night .tabs button.on,.th-day .tabs button.on{background:var(--scr);color:var(--ink);border-color:var(--scrEdge);box-shadow:inset 0 0 0 1px var(--scrEdge),0 0 10px var(--glow)}
    /* night: dark LCD */
    .wrap.th-night{--well:#0a1517;--scr:#0e1b1d;--scrEdge:#2a5c5a;--card:#12262a;--line:#214448;--ink:#d8fff3;--mute:#86b8ae;--acc:#4fe0bc;--glow:#4fe0bc55;color:var(--ink)}
    /* day: paper screen */
    .wrap.th-day{--well:#ebe2c8;--scr:#f3eddc;--scrEdge:#c8b98f;--card:#fffaf0;--line:#e3d6b6;--ink:#2b2420;--mute:#6f6455;--acc:#0f7a68;--glow:#0f7a6833;color:var(--ink)}
    .th-night .panel,.th-day .panel{background:var(--scr)}
    .th-night .body,.th-day .body{background:var(--scr);scrollbar-color:var(--scrEdge) transparent}
    .th-night .card,.th-day .card{background:var(--card);border:1px solid var(--line);box-shadow:inset 0 0 0 1px #ffffff08,0 1px 0 #0002}
    .th-night .card h3,.th-day .card h3{color:var(--ink);text-transform:uppercase;font-size:14px;letter-spacing:1.2px;border-bottom:2px solid var(--line);padding-bottom:6px}
    .th-night .card.folded h3,.th-day .card.folded h3{border-bottom:0;padding-bottom:0}
    .th-night .row,.th-day .row{border-top:1px dashed var(--line)} .th-night .row .k,.th-day .row .k{color:var(--mute)}
    .th-night .dim,.th-day .dim{color:var(--mute)}
    .th-night .note,.th-day .note{background:var(--card);border:1px solid var(--line);color:var(--ink)}
    .th-night .mon,.th-day .mon{background:var(--scr);border:1px solid var(--line);color:var(--ink)}
    .th-night .bar,.th-day .bar{background:var(--line)} .th-night .bar i,.th-day .bar i{background:linear-gradient(90deg,var(--acc),#f6c744)}
    .th-night .btn,.th-day .btn{background:var(--shell2);color:#fff;border:1px solid var(--seam);box-shadow:inset 0 1px 0 #ffffff30,0 2px 0 var(--seam)}
    .th-night .btn:hover,.th-day .btn:hover{background:var(--shell1)}
    .th-night .btn.gold,.th-day .btn.gold{background:linear-gradient(180deg,#f5c542,#d4a017);color:#2b1d00;border-color:#9a7410;box-shadow:inset 0 1px 0 #fff8,0 2px 0 #9a7410}
    .th-night .btn.danger,.th-day .btn.danger{background:#3a3a3a;border-color:#222}
    .th-night input.q,.th-day input.q,.th-night select.sel,.th-day select.sel{background:var(--card);border:1px solid var(--scrEdge);color:var(--ink)}
    .th-night label.chk,.th-day label.chk{color:var(--ink)} .th-night code,.th-day code{color:var(--acc)}
    .th-day .ok{color:#137a3e} .th-day .warn{color:#a8650a} .th-day .bad{color:#b4232c}
    .th-night .ok{color:#5ef0a0}
    .th-day .hd .vtip,.th-night .hd .vtip{background:#1d0a0e}
    .hd .fold.theme{font-size:16px}
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
  const TABS = [['now', 'Now'], ['act', 'Activity'], ['plan', 'Plan'], ['box', 'PC'], ['dex', 'Pokédex'], ['legends', 'Simulate'], ['fights', 'Fights'], ['trades', 'Trades'], ['gems', 'Gems'], ['engine', 'Settings']];
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
        prefs.tabOrder = keys; savePrefs(); render(); try { Remote.soon(); } catch (__e) { __h('60-ui:146', __e); }
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
  const MV = { engine: (w) => Views.engine(w, esc), fights: (w) => Views.fights(w, fightData, prefs, esc), league: () => Views.league(esc) };
  async function mvHtml(tab) {
    if (!MV[tab]) throw new Error('that screen is not on the phone');
    if (tab === 'fights' && !fightData) { try { fightData = { list: await Recorder.all(), at: Date.now() }; } catch { fightData = { list: [], at: Date.now() }; } }
    return MV[tab](World.build());
  }
  async function mvAct(d) {
    const data = { ...(d.data || {}) }, act = data.act;
    const cls = { contains: () => false, toggle() {}, add() {}, remove() {} };
    const t = { dataset: data, checked: !!d.checked, value: d.value ?? '', classList: cls, tagName: (d.tag || 'BUTTON').toUpperCase(),
      closest: (sel) => (sel === '[data-act]' ? t : null), matches: (sel) => !!act && sel.includes(`[data-act="${act}"]`) && sel.toLowerCase().startsWith((d.tag || 'button').toLowerCase()) };
    if (act === 'fold-card' || act === 'toggle' || act === 'bigger' || act === 'smaller' || act === 'tab') return 'ok'; // just the PC's own layout
    if (act === 'fights-reload' || (d.tab === 'fights' && /^f-?/.test(act || ''))) fightData = null;
    if (d.kind === 'change' && changeH) changeH({ target: t }); else if (d.kind === 'input' && inputH) inputH({ target: t }); else onClick({ target: { closest: () => t }, preventDefault() {}, stopPropagation() {} });
    await new Promise((r) => setTimeout(r, 400));
    return 'ok';
  }
  const dexUi = { dexOpen: null };
  const planUi = { addMoney: null, addFoe: null, addType: 'legend', addFrom: 1, addReg: null, showLog: false };
  const legUi = { pick: null, simRun: null, real: null, asMax: false, mode: 'legendary' };
  async function loadReal(id) {
    const cur = Engine.read('Game.zoneTeam', [], id) || [], sim = Legends.sims()[id];
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
    root.addEventListener('change', changeH = (e) => { if (e.target.dataset.msel) { Mirror.ui.box[e.target.dataset.msel] = e.target.value; renderBody(true); return; } if (e.target.matches('select[data-act="add-foe"]')) { planUi.addFoe = +e.target.value || null; renderBody(true); return; }
      if (e.target.matches('select[data-act="add-type"]')) { planUi.addType = e.target.value || 'legend'; renderBody(true); return; }
      if (e.target.matches('select[data-act="add-from"]')) { planUi.addFrom = +e.target.value || 1; return; }
      if (e.target.matches('select[data-act="add-money"]')) { planUi.addMoney = +e.target.value; return; }
      if (e.target.matches('select[data-act="add-item"]')) { planUi.addItem = e.target.value || null; renderBody(true); return; }
      if (e.target.matches('select[data-act="add-story"]')) { planUi.addStory = e.target.value || null; renderBody(true); return; }
      if (e.target.matches('select[data-act="add-reg"]')) { planUi.addReg = e.target.value || null; renderBody(true); return; }
      if (e.target.matches('select.sel')) { legUi.pick = +e.target.value || null; prefs.leg = legUi.pick; savePrefs(); legUi.real = null; renderBody(true); if (legUi.pick) loadReal(legUi.pick); } });
    root.addEventListener('input', inputH = (e) => { if (e.target.dataset.mq) { const k = e.target.dataset.mq; Mirror.ui[k].q = e.target.value; renderBody(true); return; } if (e.target.matches('input.q')) { prefs.q = e.target.value; savePrefs(); renderBody(true); } });
    legUi.pick = prefs.leg || null;
    legUi.asMax = !!prefs.asMax;
    legUi.mode = ['elite', 'league'].includes(prefs.simMode) ? prefs.simMode : 'legendary';
    if (legUi.pick) setTimeout(() => loadReal(legUi.pick), 1500);
    Plan.boot();
    Notify.boot();
    Cards.boot();
    Trades.boot();
    DayCare.boot();
    History.boot();
    Guard.boot();
    Calib.boot();
    Updater.boot();
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
    if (act && act.startsWith('m-')) { Mirror.act(act, t, () => renderBody(true)).then((r) => { if (r === 'back') { prefs.tab = 'now'; savePrefs(); render(); } else renderBody(true); }); return; }
    if (act === 'toggle') { prefs.open = !prefs.open; if (!prefs.open) Mirror.markAway(); savePrefs(); render(); }
    if (act === 'bigger' || act === 'smaller') {
      const i = Math.max(0, Math.min(SCALES.length - 1, (prefs.scaleIdx ?? 2) + (act === 'bigger' ? 1 : -1)));
      // keep the same amount of text per line: the column grows with the text, within what the screen allows
      const old = scale(); prefs.scaleIdx = i;
      prefs.width = Math.max(W_MIN, Math.min(W_MAX, Math.round(width() * scale() / old), Math.round(innerWidth * 0.42)));
      savePrefs(); render();
    }
    if (act === 'tab') { prefs.tab = t.dataset.tab; savePrefs(); render(); if (prefs.tab === 'trades') Trades.refresh().then(() => renderBody(true)); }
    if (act === 'tr-refresh') { Trades.refresh(true).then(() => renderBody(true)); setTimeout(() => renderBody(true), 50); }
    if (act === 'tr-open') { Trades.openMsg = 'Opening in the game…'; renderBody(true); Trades.openInGame(+t.dataset.id, !!t.dataset.shiny, t.dataset.who || null, +t.dataset.want || 0).then((m) => { Trades.openMsg = m ? m[0].toUpperCase() + m.slice(1) + '.' : ''; renderBody(true); setTimeout(() => { Trades.openMsg = ''; }, 30_000); }); }
    if (act === 'gem-open') { EliteInfo.msg = 'Opening in the game…'; renderBody(true); EliteInfo.openMon(t.dataset.uid).then((m) => { EliteInfo.msg = m ? m[0].toUpperCase() + m.slice(1) + '.' : ''; renderBody(true); setTimeout(() => { EliteInfo.msg = ''; }, 30_000); }); }
    if (act === 'elite-sim' || act === 'league-sim') {
      const tier = +t.dataset.tier, k = act === 'elite-sim' ? `L${t.dataset.id}:${tier}` : `G${t.dataset.reg}:${tier}`;
      Views.__eliteRun = Views.__eliteRun || {}; Views.__eliteRun[k] = 0; renderBody(true);
      const onProgress = (p) => { Views.__eliteRun[k] = Math.round(p * 100); renderBody(true); };
      (act === 'elite-sim' ? EliteSim.legend(+t.dataset.id, tier, { onProgress }) : EliteSim.leagueTeam(t.dataset.reg, tier, { onProgress }))
        .then((r) => Log.add(`${act === 'elite-sim' ? `${World.dex.name(+t.dataset.id)} elite` : `Elite League ${t.dataset.reg}`} tier ${tier}: ${Math.round(r.ko * 100)}%`))
        .catch((e) => Log.add('simulation failed: ' + (e?.message || e))).finally(() => { delete Views.__eliteRun[k]; renderBody(true); });
    }
    if (act === 'elite-add') { Plan.add('elite', { foe: +t.dataset.id, upTo: 5 }); renderBody(true); }
    if (act === 'league-add') { Plan.add('league', { reg: t.dataset.reg, upTo: 5 }); renderBody(true); }
    if (act === 'plan-add-wboss') { Plan.add('wboss', {}); renderBody(true); }
    if (act === 'sim-mode') { legUi.mode = t.dataset.mode || 'legendary'; prefs.simMode = legUi.mode; savePrefs(); renderBody(true); root.querySelector('.body')?.scrollTo?.(0, 0); }
    if (act === 'tr-pick') { Trades.pick = { id: +t.dataset.id, shiny: !!t.dataset.shiny }; Trades.openMsg = ''; renderBody(true); root.querySelector('.body')?.scrollTo?.(0, 0); }
    if (act === 'tr-back') { Trades.pick = null; Trades.openMsg = ''; renderBody(true); }
    if (act === 'tr-shiny') { Trades.setShiny(t.checked); setTimeout(() => renderBody(true), 50); }
    const id = legUi.pick;
    if (act === 'asmax') { legUi.asMax = !!t.checked; prefs.asMax = legUi.asMax; savePrefs(); }
    if (act === 'sim' && id) runSim(id);
    if (act === 'use' && id) { const sim = Legends.sims()[id]; if (sim) { const r = GoalTypes.setTeam(id, sim.uids); if (!r.ok) legUi.simRun = { id, error: r.why }; loadReal(id); } }
    if (act === 'leg-add' && id) { Plan.add('legend', { foe: id }); renderBody(true); }
    if (act === 'oldoff') { Plan.turnOldOff(); setTimeout(() => renderBody(true), 300); }
    const gid = t.dataset.id;
    if (act === 'plan-run') { Plan.setRunning(!Plan.running); renderBody(true); }
    if (act === 'plan-add' && planUi.addFoe) { Plan.add('legend', { foe: planUi.addFoe }); planUi.addFoe = null; renderBody(true); }
    if (act === 'plan-add-ug') { Plan.add('under', { from: planUi.addFrom || 1 }); planUi.addType = 'legend'; renderBody(true); }
    if (act === 'plan-add-story' && planUi.addStory) { const NM = { unova: 'Unova', kalos: 'Kalos', alola: 'Alola', galar: 'Galar', paldea: 'Paldea' }; Plan.add('story', { region: planUi.addStory, regionName: NM[planUi.addStory] || planUi.addStory }); planUi.addStory = null; planUi.addType = 'legend'; try { GoalTypes.storyPlace?.(); } catch (__e) { __h('60-ui:284', __e); } renderBody(true); return; }
    if (act === 'plan-add-reg' && planUi.addReg) { Plan.add('region', { reg: planUi.addReg }); planUi.addReg = null; planUi.addType = 'legend'; renderBody(true); }
    if (act === 'rows') { e.preventDefault(); planUi.openRows = planUi.openRows || {}; planUi.openRows[gid] = !planUi.openRows[gid]; renderBody(true); }
    if (act === 'dexinfo') { dexUi.dexOpen = +t.dataset.id; if (prefs.tab !== 'dex') { prefs.tab = 'dex'; savePrefs(); render(); } else renderBody(true); root.querySelector('.body')?.scrollTo?.(0, 0); }
    if (act === 'dexback') { dexUi.dexOpen = null; renderBody(true); }
    if (act === 'plan-add-item') { Plan.add('loot', { item: t.dataset.item, ch: +t.dataset.ch, place: t.dataset.place, need: +t.dataset.need || 1 }); renderBody(true); }
    if (act === 'dex-add-wild') { Plan.add('wild', { foe: +t.dataset.id, ch: +t.dataset.ch }); DexView.clear(); renderBody(true); }
    if (act === 'dex-add') { addDexJob(+t.dataset.id, +t.dataset.way || 0); DexView.clear(); renderBody(true); }
    if (act === 'n-on') { Notify.set('on', !!t.checked); if (t.checked && !Notify.cfg.topic) Notify.newTopic(); renderBody(true); }
    if (act === 'n-kind') { Notify.setKind(t.dataset.k, !!t.checked); }
    if (act === 'n-quiet') { Notify.set('quiet', !!t.checked); }
    if (act === 'berries') { Berries.set(!!t.checked); }
    if (act === 'idle-level') { Plan.setIdle(!!t.checked); }
    if (act === 'rm-on') { Remote.set(!!t.checked); setTimeout(() => renderBody(true), 50); }
    if (act === 'rm-pair') { Remote.sendPair().then((ok) => { Log.add(ok ? 'phone remote: setup link sent to your phone' : 'phone remote: could not send the setup link (check Phone Alerts)'); renderBody(true); }); }
    if (act === 'calib-run') { Log.add('simulator: tuning against your recorded fights…'); Calib.fit(true).then(() => renderBody(true)); }
    if (act === 'guard-run') { Guard.run(); renderBody(true); }
    if (act === 'rm-relay') { Remote.setRelay(!!t.checked); setTimeout(() => renderBody(true), 300); }
    if (act === 'rm-rekey') { Remote.reKey(); Log.add('phone remote: new keys - pair your phone again'); renderBody(true); }
    if (act === 'cards') { Cards.set(!!t.checked); }
    if (act === 'n-test') { Notify.test().then(() => renderBody(true)); }
    if (act === 'n-new') { Notify.newTopic(); renderBody(true); }
    if (act === 'plan-add-money') { const sel = root.querySelector('select[data-act="add-money"]'); Plan.add('money', { target: planUi.addMoney || +sel?.value || 1e7 }); planUi.addType = 'legend'; renderBody(true); }
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
    if (act === 'gem-rank') {
      // your click + the game's own confirm text; the game's rank-up (rank +1, back to Lv 5). Mega never does this by itself.
      const m = Engine.read('Game.getMon', null, t.dataset.uid), U = Engine.get('Underground'); if (!m || !U) return;
      const ro = (() => { try { return U.rankOf(m, t.dataset.key); } catch { return null; } })(); if (!ro || ro.why) { Log.add('gem: ' + (ro?.why || 'that gem does not fit')); renderBody(true); return; }
      const nm = Engine.get('Game.DEX')?.[m.id]?.name || 'it';
      if (!t.dataset.sure && !window.confirm(`Rank up ${nm} (Lv ${m.level}) to rank ${ro.next} with ${ro.need} gem${ro.need === 1 ? '' : 's'}?\n\nIt goes back to Lv 5 and has to level up again. This can't be undone.`)) return;
      const r = U.rankUp(m.uid, t.dataset.key); if (r) Log.add(`ranked up ${nm} to rank ${r.rank} with ${r.spent} gem${r.spent === 1 ? '' : 's'} (back to Lv 5)`);
      renderBody(true); return;
    }
    if (act === 'gymplan-run') { try { GymPlan.run(+t.dataset.ch); } catch (__e) { __h('60-ui:327', __e); } setTimeout(() => renderBody(true), 300); return; }
    if (act === 'theme') { prefs.theme = THEMES[(THEMES.indexOf(prefs.theme || 'auto') + 1) % 3]; savePrefs(); render(); try { Remote.soon(); } catch (__e) { __h('60-ui:328', __e); } return; }
    if (act === 'update') { Updater.install(); return; }
    if (act === 'update-continue') { Updater.setContinue(t.checked); renderBody(true); return; }
    if (act === 'update-tm') { try { window.open('https://raw.githubusercontent.com/Murillo0211/mega-remote/main/mega-alakazam.user.js?t=' + Date.now(), '_blank'); } catch (__e) { __h('60-ui:331', __e); } return; }
    if (act === 'update-auto') { Updater.setAuto(t.checked); renderBody(true); return; }
    if (act === 'update-check') { Updater.check().then(() => renderBody(true)); return; }
    if (act === 'tabs-reset') { delete prefs.tabOrder; savePrefs(); render(); try { Remote.soon(); } catch (__e) { __h('60-ui:334', __e); } return; }
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

  // theme: Auto (day 7 AM - 7 PM on this PC's clock), Day or Night; the header button cycles them
  const THEMES = ['auto', 'day', 'night'];
  const themeNow = () => { const t = prefs.theme || 'auto'; if (t !== 'auto') return t; const h = new Date().getHours(); return h >= 7 && h < 19 ? 'day' : 'night'; };
  function render() {
    const w = World.build();
    const wrap = root.querySelector('.wrap');
    wrap.classList.remove('th-day', 'th-night'); wrap.classList.add('th-' + themeNow());
    const [cls, tip] = health(w);
    layout();
    if (!prefs.open) { wrap.innerHTML = `<div class="rail" data-act="toggle" title="Open Mega Alakazam v${esc(VERSION)}"><img src="${MEGA_ICON}" width="44" height="47" alt=""><span class="dot ${cls}" title="${esc(tip)}"></span><span class="open">›</span></div>`; return; }
    const z = scale();
    wrap.innerHTML = `<div class="panel" style="width:${Math.round(width() / z)}px;zoom:${z}"><div class="grip" title="Drag to resize"></div>
      <div class="hd"><img src="${MEGA_ICON}" width="34" height="36" alt="" class="ver" title="Mega Alakazam v${esc(VERSION)}"><span class="vtip">v${esc(VERSION)}</span><span class="t">MEGA ALAKAZAM</span><span class="dot ${cls}" title="${esc(tip)} · v${esc(VERSION)}"></span><span style="flex:1"></span>${Updater.available ? `<button class="fold upd" data-act="update" title="Reloads the game into Mega ${esc(Updater.available)}">New Update ${esc(Updater.available)}</button>` : ''}<button class="fold theme" data-act="theme" title="Theme: ${{ auto: 'Auto (day/night by time)', day: 'Day', night: 'Night' }[prefs.theme || 'auto']} - click to change">${{ auto: '◐', day: '☀', night: '☾' }[prefs.theme || 'auto']}</button>
        <button class="fold" data-act="smaller" title="Smaller text" ${prefs.scaleIdx === 0 ? 'disabled' : ''}>A−</button><button class="fold" data-act="bigger" title="Bigger text">A+</button>
        <button class="fold" data-act="toggle" title="Fold to a thin rail">‹</button></div>
      <div class="tabs">${tabList().map(([k, l]) => `<button data-act="tab" data-tab="${k}" class="${prefs.tab === k ? 'on' : ''}" title="Drag to rearrange">${l}</button>`).join('')}</div>
      <div class="body"></div></div>`;
    const grip = root.querySelector('.grip'), panel = root.querySelector('.panel');
    grip.onpointerdown = (e) => {
      e.preventDefault(); grip.setPointerCapture(e.pointerId);
      const move = (ev) => { prefs.width = Math.max(W_MIN, Math.min(W_MAX, ev.clientX)); panel.style.width = Math.round(prefs.width / scale()) + 'px'; layout(); };
      const up = () => { grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); savePrefs(); };
      grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', up);
    };
    try { Casing.apply(root.querySelector('.tabs')); } catch (__e) { __h('60-ui:376', __e); }
    try { tabDrag(root.querySelector('.tabs')); } catch (__e) { __h('60-ui:377', __e); }
    renderBody(true, w);
  }

  function renderBody(force, w = World.build()) {
    const body = root.querySelector('.body');
    if (!body) return;
    // keep the search box focused while typing
    const focused = root.activeElement && root.activeElement.matches('input.q, select.sel');
    if (focused && !force) return;
    const html = prefs.tab === 'act' ? Views.activity(esc) : prefs.tab === 'box' ? (w.ok ? Views.box(esc) : '<div class="note">Waiting for the game engine.</div>') : prefs.tab === 'team' ? Views.teamEdit(esc) : prefs.tab === 'plan' ? Views.plan(w, planUi, esc) : prefs.tab === 'legends' ? Views.legends(w, legUi, esc) : prefs.tab === 'dex' ? Views.dex(w, prefs, esc, dexUi) : prefs.tab === 'engine' ? Views.engine(w, esc) : prefs.tab === 'fights' ? Views.fights(w, fightData, prefs, esc) : prefs.tab === 'trades' ? Views.trades(esc) : prefs.tab === 'gems' ? (w.ok ? Views.gems(esc) : '<div class="note">Waiting for the game engine.</div>') : Views.now(w, esc, fmtIn);
    if (body.dataset.html === html) return;
    body.innerHTML = html; body.dataset.html = html;
    if (prefs.tab === 'engine') foldCards(body);
    try { Casing.apply(body); } catch (__e) { __h('60-ui:391', __e); }
    if (focused) { const q = root.querySelector('input.q'); if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } }
  }

  // self-test: draw every tab's screen (no DOM) and report the ones that throw
  function renderTest() {
    const w = World.build(), bad = [], odd = [];
    const tabs = { now: () => Views.now(w, esc, fmtIn), act: () => Views.activity(esc), plan: () => Views.plan(w, planUi, esc), box: () => Views.box(esc), dex: () => Views.dex(w, prefs, esc, dexUi),
      legends: () => Views.legends(w, legUi, esc), engine: () => Views.engine(w, esc), fights: () => Views.fights(w, fightData || { list: [], at: 0 }, prefs, esc), trades: () => Views.trades(esc), gems: () => Views.gems(esc), league: () => Views.league(esc) };
    for (const [k, f] of Object.entries(tabs)) { try { const h = f(); if (typeof h !== 'string') bad.push(`${k}: drew nothing`); else if (/\bundefined\b|\bNaN\b|\[object Object\]/.test(h.replace(/<[^>]+>/g, ' '))) odd.push(k); } catch (e) { bad.push(`${k}: ${e?.message || e}`); } }
    renderTest.odd = odd; return bad;
  }
  return { mount, mvHtml, mvAct, renderTest, refresh: () => { try { render(); } catch (__e) { __h('60-ui:403', __e); } } };
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
        c.textContent = `.mega-pick{outline:4px solid #ffd45e !important;outline-offset:2px;box-shadow:0 0 0 8px #ffd45e55,0 0 24px #ffd45e !important;animation:megaPick 1.2s ease-in-out 6}
          @keyframes megaPick{50%{box-shadow:0 0 0 14px #ffd45e22,0 0 34px #ffd45e}}
          .mega-pick-tag{position:absolute;left:50%;top:-12px;transform:translateX(-50%);z-index:5;background:#ffd45e;color:#1a1405;font:800 12px/1 Inter,system-ui,sans-serif;padding:4px 10px;border-radius:99px;white-space:nowrap;pointer-events:none}`;
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
  const d = Trades.data, nm = (id) => esc(Trades.name(id)), sp = (id) => `<img src="${Engine.sprite(id)}" width="56" height="56" style="image-rendering:pixelated;background:var(--well,#16122b);border-radius:12px;flex:none">`;
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
    if (T.length) o += `<div class="grid">${T.map((t) => { const [cls, txt] = TAG[t.best] || TAG.none; return `<div class="mon" data-act="tr-pick" data-id="${t.id}" data-shiny="${t.shiny ? 1 : ''}" style="cursor:pointer;${t.best === 'spare' ? 'border-color:#2f8f5b' : ''}">
      <img src="${Engine.sprite(t.id)}" loading="lazy">${t.shiny ? '✨' : ''}${nm(t.id)}
      <div style="font-size:12px">${(t.list || []).length} offer${(t.list || []).length === 1 ? '' : 's'}</div>
      <div style="font-size:12px"><span class="${t.can ? 'ok' : 'dim'}">${t.can} can do</span> · <span class="dim">${(t.list || []).length - t.can} can't</span></div>
      ${t.newGet ? '<div class="ok" style="font-size:12px;font-weight:800">NEW</div>' : t.newTo ? `<div class="ok" style="font-size:12px">→ ${nm(t.to)} NEW</div>` : ''}
      <div class="${cls}" style="font-size:12px">${txt}</div></div>`; }).join('')}</div>`;
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
    o += `<div class="card" style="${x.j.kind === 'spare' ? 'border-color:#2f8f5b' : ''}">
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
Views.now = (w, esc, fmtIn) => {
  if (!w.ok) return `<div class="note">The game engine isn't reachable, so Mega Alakazam can't show anything yet. See the Settings tab.</div>`;
  const E = Engine, S = E.get('Game.S') || {}, D = E.get('Game.DEX') || {};
  const nm = (id) => esc(D[id]?.name || '#' + id);
  const row = (k, v) => `<div class="row"><span class="k">${k}</span><span class="v">${v}</span></div>`;
  const ago = (t) => { const m = Math.round((Date.now() - t) / 60_000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.floor(m / 60)} h ${m % 60 ? (m % 60) + ' min ' : ''}ago` : `${Math.round(m / 1440)} days ago`; };
  const at = (t) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const bar = (p) => `<div class="bar" style="margin-top:8px"><i style="width:${Math.max(0, Math.min(100, p * 100)).toFixed(1)}%"></i></div>`;
  const icon = (g) => ({ under: '⛏️', region: '📘', candy: '🍬', tower: '🗼', raid: '✨', money: '💰', souls: '👻', loot: '🎁', breed: '🥚', level: '⬆️', elite: '🏆', league: '🎖️', wboss: '🌍', shinyWild: '✨', shinyBreed: '✨' }[g.type] || '🎯');
  const pic = (g, size = 52) => { const sp = GoalTypes[g.type]?.sprite?.(g); return sp ? `<img src="${E.sprite(sp)}" width="${size}" height="${size}" style="image-rendering:pixelated;flex:none;background:var(--well,#16122b);border-radius:12px">` : `<span style="width:${size}px;text-align:center;font-size:${Math.round(size * 0.55)}px;flex:none">${icon(g)}</span>`; };
  // progress: the goal's own numbers if it has them, else "x/y" read from its status line
  const prog = (g, L) => {
    const pc = (Views.__nowProg ||= new Map()), c = pc.get(g.id);
    let p = null;
    if (c && Date.now() - c.at < 10_000) p = c.p; // some counts scan the whole region: not every 2 s
    else { try { p = GoalTypes[g.type]?.progress?.(g) || null; } catch (__e) { __h('62-nowview:22', __e); } pc.set(g.id, { at: Date.now(), p }); }
    if (!p) { const m = /(?<!stop\s*)(?<![\d,])₽?([\d,]+)\s*(?:\/|of)\s*₽?([\d,]+)/i.exec(L?.line || L?.why || ''); /* not "stop 21/50" */ if (m) { const a = +m[1].replace(/,/g, ''), b = +m[2].replace(/,/g, ''); if (b > 0 && a <= b) p = { have: a, need: b }; } }
    return p;
  };
  const goals = Plan.goals, open = goals.filter((g) => !g.done), live = (g) => Plan.live(g.id) || {};
  let h = '';
  // team check: who's fighting and the simulated chance (when the goal has one)
  const teamLine = (T) => {
    if (!T || (!T.uids?.length && !T.how)) return '';
    if (!T.uids?.length) return `<div class="dim" style="margin-top:6px;font-size:13px">🛡️ ${esc(T.how)}</div>`;
    const names = T.uids.map((u) => { const m = Engine.read('Game.getMon', null, u); return m ? `${esc(Engine.get('Game.DEX')?.[m.id]?.name || '?')} ${m.level}` : null; }).filter(Boolean);
    const pct = T.win != null ? ` · <b class="${T.win >= 0.6 ? 'ok' : T.win >= 0.3 ? 'warn' : 'bad'}">${Math.round(T.win * 100)}%</b>` : '';
    return `<div class="dim" style="margin-top:6px;font-size:13px">🛡️ Team: ${names.join(', ')}${pct}${T.how ? ` <span class="dim">(${esc(T.how)})</span>` : ''}</div>`;
  };

  // ---- 1. status line + needs-you ----
  const problems = [];
  if (Plan.oldOn()) problems.push('Alakazam 4.x is switched on, so the plan can\'t act (Plan tab → Switch 4.x off).');
  for (const g of open) { const L = live(g); if (/error|could not|refused|3 times|did not|stuck/i.test((L.why || '') + ' ' + (L.line || ''))) problems.push(`${esc(Plan.label(g))}: ${esc(L.why || L.line)}`); }
  try { const pend = E.get('LegendZones')?.leaguePending?.() || []; if (pend.length) problems.push(`Pick your Legendary gem in the game: Elite League ${pend.map((p) => `${esc(p.reg)} tier ${p.tier}`).join(', ')}.`); } catch (__e) { __h('62-nowview:41', __e); }
  for (const f of Guard.failures()) problems.push(`Safety check: ${esc(f.label)} looks wrong (${esc(f.why)}) - goals that use it are paused until it looks right. Probably a game update.`);
  const miss = E.audit().missing || []; if (miss.length) problems.push(`${miss.length} game functions are missing after a game update - some goals may not work.`);
  h += `<div class="card" style="border-color:${Plan.running ? '#2f8f5b' : '#8a6d1f'}">
    <div style="display:flex;align-items:center;gap:10px"><span style="font-size:26px">${Plan.running ? '🟢' : '⏸️'}</span>
    <div style="flex:1"><div style="font-size:18px;font-weight:800">${Plan.running ? 'Plan running' : 'Plan paused'}</div>
    <div class="dim">${open.length} goal${open.length === 1 ? '' : 's'} left · updated ${at(Date.now())}</div></div></div>
    ${Plan.running ? '' : `<button class="btn gold" data-act="plan-run">▶ Start Plan</button>`}</div>`;
  if (problems.length) h += `<div class="card" style="border-color:#c0392b"><h3>⚠️ Needs You</h3>${problems.map((p) => `<div class="warn" style="margin:4px 0">${p}</div>`).join('')}</div>`;

  // ---- 2. today: what it's working on + the dailies ----
  // ---- 2. working on now: the screen goal + where the game is ----
  const scrGoal = open.find((g) => !g.paused && GoalTypes[g.type]?.uses !== 'background' && ['running', 'ready'].includes(live(g).state));
  const a = S.adv || {}, ST = E.get('STORY');
  let where = '';
  if (w.screen.kind === 'zone') where = `${nm(w.screen.id)}'s Legendary Zone`;
  else if (a.tower) where = a.tower.kind === 'candy' ? 'Candy Factory run' : 'Battle Tower run';
  else if (a.raid) where = 'Shiny Raid';
  else if (a.chapter != null) where = `${esc(ST?.CHAPTERS?.[a.chapter]?.name || 'Chapter ' + a.chapter)} · stop ${(+a.node || 0) + 1} of ${(a.nodes || []).length || '?'}`;
  const foes = (a.battle?.enemies || []).filter((e) => e && e.id != null);
  const fight = foes.length ? `fighting ${foes.map((e) => `${nm(e.id)}${e.level ? ' Lv ' + e.level : ''}`).join(', ')}` : '';
  if (scrGoal) {
    const L = live(scrGoal), p = prog(scrGoal, L);
    h += `<div class="card"><h3>Today</h3><div class="dim" style="font-size:13px;font-weight:700;letter-spacing:.04em">WORKING ON NOW</div><div style="display:flex;gap:12px;align-items:center;margin-top:6px">${pic(scrGoal, 64)}<div style="flex:1;min-width:0">
      <div style="font-size:17px;font-weight:800">${esc(Plan.label(scrGoal))}</div>
      ${p ? `<div style="font-size:22px;font-weight:800;margin-top:2px">${p.money ? '₽' : ''}${(+p.have).toLocaleString()} <span class="dim" style="font-size:15px">of ${p.money ? '₽' : ''}${(+p.need).toLocaleString()}${p.unit ? ' ' + esc(p.unit) : ''}</span></div>` : ''}
      </div></div>${p ? bar(p.have / p.need) : ''}
      ${L.line ? `<div style="margin-top:8px">${esc(L.line)}</div>` : L.why ? `<div class="dim" style="margin-top:8px">${esc(L.why)}</div>` : ''}
      ${teamLine(L.team)}
      ${where ? `<div class="dim" style="margin-top:6px">📍 ${where}${fight ? ' · ' + fight : ''}</div>` : ''}`;
  } else if (Plan.running && Plan.idle) {
    const I = Plan.idle, g = I.goal, lead = g?.uids?.[0] ? E.read('Game.getMon', null, g.uids[0]) : null;
    h += `<div class="card"><h3>Today</h3><div class="dim" style="font-size:13px;font-weight:700;letter-spacing:.04em">WORKING ON NOW · IDLE</div><div style="display:flex;gap:12px;align-items:center;margin-top:6px">
      ${lead ? `<img src="${E.sprite(lead.id)}" width="64" height="64" style="image-rendering:pixelated;flex:none;background:var(--well,#16122b);border-radius:12px">` : '<span style="font-size:34px">💤</span>'}
      <div style="flex:1;min-width:0"><div style="font-size:17px;font-weight:800">${g ? 'Leveling while every goal waits' : 'Parked - nothing to level'}</div>
      ${g ? `<div>${g.uids.map((u) => { const m = E.read('Game.getMon', null, u); return m ? `${nm(m.id)}${m.rank ? ' ★' + m.rank : ''}${m.shiny ? ' ✨' : ''} <b>Lv ${m.level}</b>` : ''; }).filter(Boolean).join(' · ')}</div>` : ''}</div></div>
      ${I.line ? `<div class="dim" style="margin-top:8px">${esc(I.line)}</div>` : ''}
      ${where ? `<div class="dim" style="margin-top:6px">📍 ${where}${fight ? ' · ' + fight : ''}</div>` : ''}`;
  } else {
    h += `<div class="card"><h3>Today</h3><div class="dim" style="font-size:13px;font-weight:700;letter-spacing:.04em">WORKING ON NOW</div><div style="margin-top:6px">${Plan.running ? (open.length ? 'Nothing can run right this minute - see Up Next for what each goal is waiting on.' : 'Nothing - your plan is empty. Add goals from the Pokédex, Legends or Plan tab.') : 'Nothing - the plan is paused.'}</div>
      ${where ? `<div class="dim" style="margin-top:6px">📍 ${where}${fight ? ' · ' + fight : ''}</div>` : ''}`;
  }

  // ---- 6. today: dailies ----
  const d = w.dailies, ug = d.underground, wb = d.worldBoss;
  h += `<div style="border-top:1px solid #2b2450;margin-top:12px;padding-top:6px"></div>`;
  if (ug) h += row('Underground', `${ug.left} of ${ug.perDay} left · ${ug.running}/${ug.slotsMax} bays busy${ug.finished ? ` · <span class="warn">${ug.finished} ready to collect</span>` : ug.nextBack ? ` · back in ${fmtIn(ug.nextBack)}` : ''}`);
  if (d.candy) {
    // like the raid: the day's type is only fetched when the game's Candy Factory screen opens, and until
    // then why() says "day" - Mega fetches it (read-only, every 5 min at most) instead of saying "closed"
    const C = E.get('CandyRun'), now = Date.now();
    let why = d.candy.why, type = null;
    if (why === 'day' && C?.loadDay && now - (Views.__candySync || 0) > 300_000) { Views.__candySync = now; try { C.loadDay(); } catch (__e) { __h('62-nowview:93', __e); } }
    try { why = C.why(); type = C.today?.()?.type || null; } catch (__e) { __h('62-nowview:94', __e); }
    const tname = type ? type[0].toUpperCase() + type.slice(1) : '';
    const inPlan = Plan.hasType('candy');
    h += row('Candy Factory', d.candy.played || why === 'played' ? `<span class="ok">✔ done today</span>${tname ? ` <span class="dim">(${tname} day)</span>` : ''}`
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
    let ready = false; try { ready = !!R.ready(); } catch (__e) { __h('62-nowview:108', __e); }
    if (!ready && R?.sync && now - (Views.__raidSync || 0) > 300_000) { Views.__raidSync = now; try { R.sync(); } catch (__e) { __h('62-nowview:109', __e); } }
    let nx = null, reg = null, boss = null, won = false, tries = 0;
    try { nx = +R.nextDay(); } catch (__e) { __h('62-nowview:111', __e); }
    if (ready) { try { reg = R.drawn(); } catch (__e) { __h('62-nowview:112', __e); } }
    if (reg) { try { boss = (R.lane() || []).find((x) => x.key === reg)?.boss; won = !!R.done(reg); tries = +R.tried(reg) || 0; } catch (__e) { __h('62-nowview:113', __e); } }
    const inPlan = Plan.hasType('raid'), rname = reg ? esc((E.get('STORY.REGIONS') || []).find((x) => x.key === reg)?.name || reg) : '';
    h += row('Shiny Raid', !ready ? '<span class="dim">checking today\'s draw…</span>'
      : !reg ? `<span class="dim">no raid today${nx ? ` · next ${DexInfo.clock(nx)}` : ''}</span>`
      : won ? `<span class="ok">✔ won today</span> <span class="dim">(✨ ${boss ? nm(boss) : ''} · ${rname}) · next ${DexInfo.clock(nx)}</span>`
      : `<span class="warn">open now: ✨ ${boss ? nm(boss) : '?'} (${rname})</span>${tries ? ` · ${tries} tries` : ''}<div class="dim">until ${DexInfo.clock(nx)}${inPlan ? '' : ' · add Shiny Raid in the Plan tab and Mega plays it'}</div>`);
  }
  if (d.tower) { const fl = S.tower?.best?.floor; h += row('Battle Tower', `${fl ? `last run: floor ${fl} · ` : ''}resets in ${fmtIn(d.tower.weekEnds)}`); }
  h += row('World Boss', wb.caught ? '<span class="ok">✔ caught this edition</span>' : wb.catchable ? '<span class="warn">catchable now</span>' : wb.open ? 'shield up' : '<span class="dim">closed</span>');
  { const sm = (() => { try { return History.sideMoney(); } catch { return null; } })();
    h += row('Money', `₽${(+(() => { try { return History.homeMoney(); } catch { return S.money || 0; } })()).toLocaleString()}${sm ? ` <span class="dim">· ${esc(sm.name)} wallet ₽${sm.money.toLocaleString()}</span>` : ''}`); }
  h += `</div>`;

  try { h += Mirror.fightCard(esc); } catch (__e) { __h('62-nowview:126', __e); }

  // ---- 3. alongside (background goals) ----
  const bg = open.filter((g) => GoalTypes[g.type]?.uses === 'background' && !g.paused);
  if (bg.length) {
    h += `<div class="card"><h3>Running Alongside</h3>`;
    for (const g of bg) { const L = live(g), p = prog(g, L); h += `<div style="display:flex;gap:10px;align-items:center;margin:8px 0">${pic(g, 40)}<div style="flex:1;min-width:0"><b>${esc(Plan.label(g))}</b>${p ? ` <span class="dim">· ${(+p.have).toLocaleString()} of ${(+p.need).toLocaleString()}</span>` : ''}<div class="dim">${esc(L.line || L.why || L.state || '')}</div></div></div>`; }
    h += `</div>`;
  }

  // ---- 3b. Day Care: eggs in the incubator and how long each has left ----
  try {
    const dc = DayCare.info();
    if (dc.used || dc.mons.length) {
      const at2 = (t) => new Date(t).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
      h += `<div class="card"><h3>🥚 Day Care</h3><div class="dim">Incubator ${dc.used} of ${dc.max || '?'}${dc.full ? ' · full - hatch one to make room' : dc.nextEgg != null ? ` · next egg in ${DayCare.left(dc.nextEgg)}` : dc.mons.length ? ' · no egg coming (these can\'t breed)' : ''}</div>`;
      for (const e of dc.eggs) {
        const pct = e.ready ? 1 : 1 - e.left / Math.max(1, e.hatchAt - e.laidAt);
        h += `<div style="display:flex;gap:10px;align-items:center;margin:8px 0"><img src="${E.sprite(e.id)}" width="44" height="44" style="image-rendering:pixelated;flex:none;background:var(--well,#16122b);border-radius:12px;${e.ready ? '' : 'filter:grayscale(1);opacity:.5'}"><div style="flex:1;min-width:0"><b>${nm(e.id)}</b>${e.shinyParent ? ' <span title="shiny parent - better shiny odds">✨</span>' : ''}
          <div class="${e.ready ? 'ok' : 'dim'}">${e.ready ? '● ready to hatch' : `${DayCare.left(e.left)} left · hatches ${at2(e.hatchAt)}`}</div>${e.ready ? '' : bar(pct)}</div>${e.ready ? `<button class="btn sm gold" style="width:auto;padding:10px 14px;margin:0" data-act="m-egg-hatch" data-uid="${esc(e.uid)}">🐣 Hatch</button>` : ''}</div>`;
      }
      if (dc.eggs.filter((e) => e.ready).length > 1) h += `<button class="btn gold" data-act="m-egg-hatch" data-uid="">🐣 Hatch All Ready (${dc.eggs.filter((e) => e.ready).length})</button>`;
      if (dc.mons.length) h += `<div class="dim" style="margin-top:6px">Staying there: ${dc.mons.map((m) => `${nm(m.id)}${m.shiny ? ' ✨' : ''} Lv ${m.level}`).join(', ')}</div>`;
      h += `</div>`;
    }
  } catch (__e) { __h('62-nowview:151', __e); }

  // ---- 4. up next ----
  // up next: not the ones that can't happen for now (zone closed, locked behind another catch)
  const next = open.filter((g) => g !== scrGoal && !bg.includes(g) && !(live(g).state === 'wait' && /\b(locked|closed)\b/i.test(live(g).why || '')));
  if (next.length) {
    h += `<div class="card"><h3>Up Next</h3>`;
    for (const g of next.slice(0, 5)) {
      const L = live(g), p = prog(g, L);
      const st = g.paused ? '❚❚ paused' : L.state === 'wait' ? `◐ ${esc(L.why || 'waiting')}` : L.state === 'queued' ? '○ after the one above' : esc(L.why || L.state || '');
      h += `<div style="display:flex;gap:10px;align-items:center;margin:8px 0">${pic(g, 40)}<div style="flex:1;min-width:0"><b>${esc(Plan.label(g))}</b>${p ? ` <span class="dim">· ${(+p.have).toLocaleString()} of ${(+p.need).toLocaleString()}</span>` : ''}<div class="dim">${st}</div></div></div>`;
    }
    if (next.length > 5) h += `<div class="dim">+ ${next.length - 5} more in the Plan tab</div>`;
    h += `</div>`;
  }

  // ---- 7. trades ----
  const td = Trades.data;
  if (td && !td.failed) {
    const T = td.targets || [], spare = T.filter((t) => t.best === 'spare');
    h += `<div class="card"><h3>Trades</h3><div>${T.length ? `${T.length} Pokémon you're missing are on the board${spare.length ? ` · <span class="ok">${spare.length} for a spare: ${spare.slice(0, 4).map((t) => nm(t.id)).join(', ')}</span>` : ' · none for a spare right now'}` : 'Nothing you\'re missing on the board right now.'}</div>
      <div class="dim">checked ${ago(td.at)}</div>${spare.length ? `<button class="btn" data-act="tab" data-tab="trades">Open Trades</button>` : ''}</div>`;
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
    h += `<div class="card tmwrap"><h3>Team</h3><div class="tmgrid">${team.map((m) => `<div style="min-width:0"><img src="${E.sprite(m.id)}" width="48" height="48" style="image-rendering:pixelated;max-width:100%;height:auto"><div class="tmname" title="${nm(m.id)}">${nm(m.id)}</div><div class="dim" style="font-size:12px">Lv ${m.level}${S.buddy?.uid === m.uid ? ' ★' : ''}</div></div>`).join('')}</div><button class="btn" data-act="team-edit">✏️ Change Team</button></div>`;
  }
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
      c.textContent = `.mega-pick{outline:4px solid #ffd45e !important;outline-offset:2px;box-shadow:0 0 0 8px #ffd45e55,0 0 24px #ffd45e !important;animation:megaPick 1.2s ease-in-out 6}
        @keyframes megaPick{50%{box-shadow:0 0 0 14px #ffd45e22,0 0 34px #ffd45e}}
        .mega-pick-tag{position:absolute;left:50%;top:-12px;transform:translateX(-50%);z-index:5;background:#ffd45e;color:#1a1405;font:800 12px/1 Inter,system-ui,sans-serif;padding:4px 10px;border-radius:99px;white-space:nowrap;pointer-events:none}`;
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

Views.elite = (esc) => {
  const d = EliteInfo.elite(), nm = (id) => esc(Engine.get('Game.DEX')?.[id]?.name || '#' + id);
  if (!d.on) return `<div class="note">Elite fights aren't open in this game yet.</div>`;
  if (!d.rows.length) return `<div class="note">No elite fights yet: they open for each legendary once you've caught it (and the Underground is unlocked).</div>`;
  const beaten = d.rows.reduce((t, r) => t + r.best, 0), total = d.rows.length * d.tiers.length;
  let h = `<div class="card"><h3>Elite Legendaries</h3>
    <div>${d.rows.length} legendaries · <b>${beaten}</b> of ${total} tiers beaten</div>
    <div class="dim" style="margin-top:6px">You must knock it out - no catching. Tiers unlock one after another and get harder: more HP and power, your status moves land less often, and its poison / burn hits harder. Tiers 1, 2 and 4 give a Legendary gem of its type (to rank up your legendaries of that type), 3 and 5 a frame. A loss locks that legendary's elite fights for ${d.freezeMin} min.</div>
    <div class="note dim" style="margin-top:8px">Simulate a tier to see the best team, then "Add: Beat Its Tiers" - Mega fights tier after tier (the game retries a lost fight by itself), simulating each new tier first, and tells you on your phone when one falls.</div></div>`;
  for (const r of d.rows) {
    const pips = d.tiers.map((t) => `<span style="display:inline-block;width:22px;height:8px;border-radius:4px;margin-right:3px;background:${t <= r.best ? '#5ad68a' : t === r.next ? '#ffd45e' : '#2e2752'}"></span>`).join('');
    h += `<div class="card"><div style="display:flex;gap:12px;align-items:center">
      <img src="${Engine.sprite(r.foe)}" width="56" height="56" style="image-rendering:pixelated;background:var(--well,#16122b);border-radius:12px;flex:none">
      <div style="flex:1;min-width:0"><div style="font-size:16px;font-weight:800">${nm(r.foe)}${r.foe !== r.id ? ` <span class="dim" style="font-size:13px">(this week's form)</span>` : ''}</div>
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
    h += `<div class="card" style="border-color:#2f8f5b"><h3>Strongest Get Stronger</h3><div class="dim" style="margin-bottom:4px">Ready to rank up today: highest base stats first, then the biggest stat gain. Ranking up sends it back to Lv 5</div>`;
    g.top.forEach((c, i) => {
      h += `<div style="display:flex;gap:10px;align-items:center;margin-top:8px"><b class="dim" style="width:18px">${i + 1}</b>
        <img src="${Engine.sprite(c.m.id)}" width="44" height="44" style="image-rendering:pixelated;flex:none">
        <div style="flex:1;min-width:0"><b>${nm(c.m.id)}${c.m.shiny ? ' ✨' : ''}</b> <span class="ok">+${c.gain} stats</span> <span class="dim">(+${Math.round(c.pct * 100)}%)</span>
        <div class="dim" style="font-size:13px">rank ${c.m.rank || 0} → ${c.next} · ${c.need} ${esc(c.label)} gem${c.need > 1 ? 's' : ''}${role(c) ? ' · ' + role(c) : ''}</div>
        ${EliteInfo.canEvolve(c.m.id) ? `<div class="warn" style="font-size:13px">⚠ won't evolve any more once ranked</div>` : ''}</div></div>
        <button class="btn${i === 0 ? ' gold' : ''}" data-act="gem-rank" data-uid="${c.m.uid}" data-key="${c.key}" data-rank="${c.m.rank || 0}">Rank Up (back to Lv 5)</button>
        <button class="btn" data-act="gem-open" data-uid="${c.m.uid}">Open in Game</button>`;
    });
    h += `</div>`;
  }
  for (const r of g.rows) {
    h += `<div class="card"><div style="display:flex;justify-content:space-between;align-items:center"><b style="font-size:16px">${esc(r.label)}</b><span>×${r.have}</span></div>`;
    if (!r.top.length) h += `<div class="dim" style="margin-top:4px">None of your Pokémon can use it right now.</div>`;
    for (const c of r.top) {
      h += `<div style="display:flex;gap:10px;align-items:center;margin-top:8px">
        <img src="${Engine.sprite(c.m.id)}" width="40" height="40" style="image-rendering:pixelated;flex:none">
        <div style="flex:1;min-width:0"><b>${nm(c.m.id)}${c.m.shiny ? ' ✨' : ''}</b> <span class="ok">+${c.gain}</span> <span class="dim">base ${c.bst} · Lv ${c.m.level} · rank ${c.m.rank || 0} → ${c.next}${c.use >= 2 ? ' · in your team' : c.use ? ' · in a legend team' : ''}</span>
        <div class="${c.why ? 'dim' : 'ok'}" style="font-size:13px">${c.why ? esc(c.why) : `✓ can rank up now (uses ${c.need})`}${EliteInfo.canEvolve(c.m.id) ? ' <span class="warn">· won\'t evolve once ranked</span>' : ''}</div></div>
        <button class="btn sm" data-act="gem-open" data-uid="${c.m.uid}" style="width:auto;margin:0;flex:none">Open</button></div>`;
    }
    if (r.more > 0) h += `<div class="dim" style="margin-top:6px">+ ${r.more} more that could use it</div>`;
    h += `</div>`;
  }
  return h;
};

// ---- the Simulate tab (was Legends): Legendary / Elite (Gems has its own tab) ----
{
  const legendary = Views.legends;
  Views.legends = (w, ui, esc) => {
    const mode = ui.mode || 'legendary';
    const MODES = [['legendary', 'Legendary'], ['elite', 'Elite'], ['league', 'Gyms & League']];
    const bar = `<div style="display:grid;grid-template-columns:repeat(${MODES.length},1fr);gap:6px;margin-bottom:10px">${MODES.map(([k, l]) => `<button class="btn sm${mode === k ? ' gold' : ''}" data-act="sim-mode" data-mode="${k}" style="margin:0">${l}</button>`).join('')}</div>`;
    if (!w.ok) return bar + '<div class="note">Waiting for the game engine.</div>';
    return bar + (mode === 'elite' ? Views.elite(esc) : mode === 'league' ? Views.league(esc) : legendary(w, ui, esc));
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
 * Gym odds: the game's own estimator, Adventure.winChance(team, foes, 'gym', field, power).
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
      return { key: k, name: r.name || k, open, best, next, members, types, frame, tiers, pending: pending.filter((p) => p.reg === k).map((p) => p.tier) };
    }).filter((x) => x.open || x.best);
  }
  // the next story gym: the frontier chapter's gym (with its team at the game's levels) and the cap
  function story() {
    const st = ST(), s = S(), ch = +(s.adv?.unlocked ?? 0), c = st?.CHAPTERS?.[ch];
    if (!c) return null;
    const reg = (() => { try { return st.regionOf(ch); } catch { return null; } })();
    const cur = (() => { try { return E.call('Game.currentRegion'); } catch { return null; } })();
    const gym = (c.steps || []).find((x) => x.kind === 'gym');
    let foes = []; try { if (gym) foes = st.gymTeam(ch, gym).map(([id, lv], i) => ({ uid: 'foe' + i, id, level: lv })); } catch (__e) { __h('64-leagueview:39', __e); }
    let capLv = null; try { capLv = st.capOf(ch); } catch (__e) { __h('64-leagueview:40', __e); }
    const travel = reg && cur && reg.key !== cur.key; // the frontier is in a region you haven't gone to
    let win = null;
    if (!travel && foes.length) { try { win = E.call('Adventure.winChance', E.read('Game.teamMons', []) || [], foes, 'gym', 1, gym.power || 1); } catch (__e) { __h('64-leagueview:43', __e); } }
    return { ch, chapter: c.name, reg, cur, gym, foes, cap: capLv, travel, win, aside: !!reg?.aside };
  }
  return { league, story, cap };
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
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">${s.foes.map((f) => `<div style="text-align:center"><img src="${Engine.sprite(f.id)}" width="48" height="48" style="image-rendering:pixelated"><div style="font-size:12px">${nm(f.id)}</div><div class="dim" style="font-size:12px">Lv ${f.level}</div></div>`).join('')}</div>`;
      if (s.win != null) h += `<div style="margin-top:8px">Your current team wins about <b>${Math.round(s.win * 100)}%</b> <span class="dim">(the game's own estimate)</span></div>`;
      // the gym plan: best team from what you have + what you can catch, at the level cap
      if (!s.travel && s.foes.length) {
        const P = (() => { try { return GymPlan.get(s.ch); } catch { return null; } })(), B = (() => { try { return GymPlan.busy; } catch { return null; } })();
        const pct = (x) => `<b class="${x >= 0.6 ? 'ok' : x >= 0.3 ? 'warn' : 'bad'}">${Math.round(x * 100)}%</b>`;
        h += `<div class="note" style="margin-top:10px"><b>Gym plan</b> <span class="dim">· the best team from your ${esc(s.reg?.name || '')} Pokémon plus everything you can catch in unlocked chapters, all at the level cap${s.cap ? ' (' + s.cap + ')' : ''} - scored with the game's own estimate</span>`;
        if (!P) h += `<div style="margin-top:6px">${B ? `Thinking… ${B.done} estimates so far` : 'Starting…'}</div>`;
        else {
          h += `<div style="margin-top:6px">Best team you have right now: ${pct(P.now.win)} · best possible: ${pct(P.plan.win)}</div>`;
          h += `<div class="grid" style="margin-top:8px">${P.plan.team.map((t) => {
            const own = t.kind === 'own' ? Engine.read('Game.getMon', null, t.uid) : null;
            const how = t.kind === 'catch' ? `catch ${nm(t.base)}<br><span class="dim">${esc(t.where || '')}</span>` : own && own.id !== t.id ? `your ${nm(own.id)} Lv ${own.level} → evolve` : own && s.cap && own.level < s.cap ? `yours · level ${own.level} → ${s.cap}` : '<span class="ok">✓ ready</span>';
            return `<div class="mon"><img src="${Engine.sprite(t.id)}" alt="">${nm(t.id)}<br><span style="font-size:12px">${how}</span></div>`; }).join('')}</div>`;
          // the gym after: what to catch for it while you're in these chapters
          const nx = (() => { try { return GymPlan.nextGym(s.ch); } catch { return null; } })(), NP = nx != null ? (() => { try { return GymPlan.saved[nx] || null; } catch { return null; } })() : null;
          if (NP) { const c = NP.plan.team.filter((t) => t.kind === 'catch'); h += `<div style="margin-top:8px"><b>Next: ${esc(NP.gym)}</b> · best possible ${pct(NP.plan.win)}${c.length ? ` · catch ${c.map((t) => `${nm(t.base)} <span class="dim">(${esc(t.where || '')})</span>`).join(', ')}` : ' · nothing new to catch'}</div>`; }
          else if (nx != null) h += `<div class="dim" style="margin-top:8px">The gym after this one gets planned once this plan is ready.</div>`;
          h += `<div class="dim" style="margin-top:6px">The "Beat the League" goal fights as soon as your team wins 60%. Below that it follows this plan: catches what's quick to get right now, levels the team to the cap (evolving on the way, and anyone stuck at the cap), then fights. Planned ${new Date(P.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.</div>`;
        }
        h += `<button class="btn" data-act="gymplan-run" data-ch="${s.ch}" style="margin-top:6px">${P ? 'Plan Again' : 'Plan Now'}</button></div>`;
      }
    }
    h += `</div>`;
  }
  // ---- Elite League ----
  const L = LeagueInfo.league();
  if (L.length) {
    const won = L.reduce((t, r) => t + r.best, 0);
    h += `<div class="card"><h3>Elite League</h3><div>${won} of ${L.length * 5} tiers won</div>
      <div class="dim" style="margin-top:6px">Each region's Elite Four + Champion again, in tiers 1-5, one after another. Tiers 3 and 5 give a frame; the others let you <b>pick a Legendary gem</b> from that League's types (to rank up your legendaries).</div>
      <div class="note dim" style="margin-top:8px">Every trainer Pokémon is ranked as high as the tier. "Add: Win Its Tiers" fights tier after tier with your strongest six (the game retries a lost fight by itself), reminds you on your phone to pick each gem, and steps back if a tier is lost 10 times. No win odds here: the game's quick estimator says 0% even for the Champion you've already beaten, so Mega goes by real results.</div></div>`;
    for (const r of L) {
      const pips = r.tiers.map((t) => `<span style="display:inline-block;width:22px;height:8px;border-radius:4px;margin-right:3px;background:${t <= r.best ? '#5ad68a' : t === r.next ? '#ffd45e' : '#2e2752'}"></span>`).join('');
      h += `<div class="card"><div style="display:flex;justify-content:space-between;align-items:center"><b style="font-size:16px">${esc(r.name)} League</b><span>${pips} <span class="dim">${r.best}/5</span></span></div>
        ${r.pending.length ? `<div class="warn" style="margin-top:6px">⚠ Tier ${r.pending.join(', ')} won - pick your gem in the game!</div>` : ''}
        ${r.next ? `<div style="margin-top:6px">Next: <b>Tier ${r.next}</b> → ${r.frame ? 'a frame' : `<span class="ok">a Legendary gem</span> of your choice: ${r.types.map((t) => esc(LeagueInfo.cap(t))).join(', ')}`}</div>` : '<div class="ok" style="margin-top:6px">All tiers won ✔</div>'}
        <div class="dim" style="font-size:13px;margin-top:4px">${r.members.map((m) => `${esc(m.leader)}${m.champion ? ' (Champion)' : ''} · ${esc(LeagueInfo.cap(m.type || ''))}`).join(' · ')}</div>
        ${r.next ? (() => { const inPlan = Plan.goals.some((g) => !g.done && g.type === 'league' && g.reg === r.key);
          return `<button class="btn${inPlan ? '' : ' gold'}" data-act="league-add" data-reg="${r.key}" ${inPlan ? 'disabled' : ''}>${inPlan ? 'In Your Plan' : 'Add: Win Its Tiers'}</button>`; })() : ''}</div>`;
    }
  }
  return h || `<div class="note">Nothing here yet.</div>`;
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
  const get = (k) => saved[k] || null;
  const put = (k, v) => { saved[k] = { ...v, at: Date.now() }; store(); return saved[k]; };
  const drop = (k) => { delete saved[k]; store(); };
  const yieldNow = () => new Promise((r) => setTimeout(r, 0));

  // ---- elite legendaries ----
  async function legend(foe, tier, opts = {}) {
    const r = await Sim.search(foe, { tier, asMax: !!opts.asMax, onProgress: opts.onProgress });
    return put(`L${foe}:${tier}`, { uids: r.team.map((m) => m.uid), ko: r.final.ko, today: r.today?.ko ?? r.final.ko, asMax: !!r.asMax });
  }

  // ---- Elite League ----
  function members(reg) {
    const st = ST(), out = [];
    for (const ch of st.chaptersOf(reg) || []) {
      const c = st.CHAPTERS[ch]; if (!c?.league) continue;
      const gym = (c.steps || []).find((x) => x.kind === 'gym'); if (!gym) continue;
      let team = []; try { team = st.gymTeam(ch, gym); } catch (__e) { __h('65-elitesim:35', __e); }
      let field = 1; try { field = +E.call('Adventure.fieldSize', gym) || 1; } catch (__e) { __h('65-elitesim:36', __e); }
      out.push({ ch, leader: gym.leader, champion: !!gym.champion, type: gym.type, power: gym.power || 1, field, team });
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
  return { get, put, drop, legend, members, leagueTeam };
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
  const all = () => E.get('CONFIG')?.BUFF_BERRIES || {};
  const label = (k) => (all()[k]?.name ? `${k.replace(/-/g, ' ')}` : k.replace(/-/g, ' '));
  function active(fam) { return (E.read('Game.activeBuffs', []) || []).find((b) => b.family === fam) || null; }
  // returns a short status like " · Pinap 42 min", or '' when off / nothing to show
  function keep(fam, why, { strongest = true } = {}) {
    if (!on) return '';
    const a = active(fam);
    if (a && a.left > 120_000) return ` · ${label(a.key).replace(/ berry$/, '')} ${Math.ceil(a.left / 60_000)} min`;
    const ber = Object.entries(all()).filter(([, v]) => v.family === fam).sort((x, y) => (strongest ? 1 : -1) * ((y[1].rank || 0) - (x[1].rank || 0)) || (strongest ? y[1].mult - x[1].mult : x[1].mult - y[1].mult));
    const aRank = a ? all()[a.key]?.rank || 0 : -1;
    for (const [key, v] of ber) {
      if (a && (v.rank || 0) < aRank) continue; // never replace a stronger one (the game would ask)
      const have = +E.read('Game.itemCount', 0, key) || 0;
      if (!have) continue;
      try { E.call('Game.useBuffBerry', key); } catch (__e) { __h('66-berries:27', __e); }
      const now = active(fam);
      if (now && now.left > 120_000) { out.delete(fam); Log.add(`used ${/^[aeiou]/i.test(label(key)) ? 'an' : 'a'} ${Casing.title(label(key))} (${why}) - ${have - 1} left`); return ` · ${Casing.title(label(key)).replace(/ Berry$/, '')} ${Math.ceil(now.left / 60_000)} min`; }
    }
    if (ber.length && !out.has(fam)) { out.add(fam); Log.add(`no ${fam === 'capture' ? 'Razz' : Casing.title(label(ber[0][0]))} berries left for ${why}`); }
    return '';
  }
  return { keep, active, get on() { return on; }, set(v) { on = !!v; try { localStorage.setItem(KEY, JSON.stringify(on)); } catch (__e) { __h('66-berries:34', __e); } } };
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
    const gym = (c.steps || []).find((x) => x.kind === 'gym'); if (!gym) return null;
    let foes = []; try { foes = st.gymTeam(ch, gym).map(([id, lv], i) => ({ uid: 'foe' + i, id: +id, level: +lv })); } catch (__e) { __h('66-gymplan:22', __e); }
    const cap = safe(() => +st.capOf(ch), null);
    return { ch, gym, foes, cap, name: gym.leader || 'Gym Leader', chapter: c.name, power: +gym.power || 1 };
  }
  // the species a Pokémon becomes by levelling to `lv` (level evolutions only)
  function evolveTo(id, lv) {
    const EV = E.get('EVOLUTIONS') || {}; let cur = +id;
    for (let i = 0; i < 3; i++) { const nx = (EV[cur] || []).find((e) => e.level && e.level <= lv && !e.item); if (!nx) break; cur = +nx.to; }
    return cur;
  }
  const fam = (id) => safe(() => [...(E.read('Game.familyOf', [], id) || [])].map(Number), [+id]);
  const win = (team, foes, power) => safe(() => +E.call('Adventure.winChance', team, foes, 'gym', 1, power) || 0, 0);
  const fresh = (m) => { const c = { ...m }; delete c.hp; delete c.curHp; return c; };
  const sideMons = () => (E.read('Game.sideMons', []) || []).filter((m) => !m.egg);
  // the plan is redone when your side's Pokémon change (caught, evolved), not on every level-up
  const sig = () => sideMons().map((m) => m.uid + ':' + m.id).sort().join('|');

  function candidates(G) {
    const st = ST(), cap = G.cap || 100, out = [], seen = new Set();
    const reg = safe(() => st.regionOf(G.ch)?.key), chs = safe(() => st.chaptersOf(reg), []) || [];
    const ownFam = new Set();
    for (const m of sideMons()) {
      const id = evolveTo(m.id, Math.max(cap, m.level)); fam(m.id).forEach((x) => ownFam.add(x));
      const k = 'o' + id; if (seen.has(k)) { const o = out.find((x) => x.key === k); if (o && m.level > o.from.level) { o.from = m; o.uid = m.uid; } continue; }
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
    const foes = G.foes, P = G.power, sp = (x) => Sim.species(x.mon);
    let n = 0; const W = async (t, f) => { if (++n % 12 === 0) { tick?.(n); await sleep(); } return win(t.map((x) => x.mon), f, P); };
    const obj = async (t) => { let s = 0; for (let k = 1; k <= foes.length; k++) s += (await W(t, foes.slice(0, k))) * (k === foes.length ? foes.length : 1); return s; };
    // single matchups (the hardest foe counts double)
    const hard = []; for (const x of pool) { let s = 0; for (const f of foes) s += await W([x], [f]); hard.push(s); }
    const lastHard = []; for (const x of pool) lastHard.push(await W([x], [foes[foes.length - 1]]));
    const top = pool.map((x, i) => ({ x, s: hard[i] + lastHard[i] })).sort((a, b) => b.s - a.s).slice(0, 16).map((y) => y.x);
    let best = null, bs = -1;
    for (let r = 0; r < 5 && n < budget; r++) {
      let t = [...top].sort(() => Math.random() - 0.5).filter((x, i, a) => a.findIndex((y) => sp(y) === sp(x)) === i).slice(0, 6);
      let s = await obj(t), imp = true;
      while (imp && n < budget) {
        imp = false;
        for (let i = 0; i < t.length; i++) for (const x of top) { if (t.includes(x)) continue; const t2 = [...t]; t2[i] = x; if (new Set(t2.map(sp)).size < t2.length) continue; const s2 = await obj(t2); if (s2 > s) { t = t2; s = s2; imp = true; } }
        for (let i = 0; i < t.length; i++) for (let j = i + 1; j < t.length; j++) { const t2 = [...t]; [t2[i], t2[j]] = [t2[j], t2[i]]; const s2 = await obj(t2); if (s2 > s) { t = t2; s = s2; imp = true; } }
      }
      if (s > bs) { bs = s; best = t; }
    }
    return { team: best || [], win: best ? win(best.map((x) => x.mon), foes, P) : 0 };
  }
  // plan the gym of chapter `ch` (cached per gym + side). Returns the saved plan, or null while it's thinking.
  function get(ch, { force = false } = {}) {
    const p = saved[ch];
    // redone every 30 min: what's spawning changes with the time of day and the weather
    if (p && !force && p.sig === sig() && Date.now() - p.at < 30 * 60_000) return p;
    if (!busy) run(ch);
    return p || null;
  }
  async function run(ch) {
    const G = gymOf(ch); if (!G || !G.foes.length) return null;
    busy = { ch, done: 0, total: 1 };
    try {
      const pool = candidates(G);
      // now: the Pokémon you have, at their real levels
      const nowPool = sideMons().map((m) => ({ key: 'n' + m.uid, kind: 'own', uid: m.uid, id: m.id, mon: fresh(m) }));
      const now = await search(nowPool, G, 700, (n) => { busy.done = n; });
      const plan = await search(pool, G, 1600, (n) => { busy.done = 700 + n; });
      const r = {
        ch, at: Date.now(), sig: sig(), gym: G.name, chapter: G.chapter, cap: G.cap, foes: G.foes.map((f) => [f.id, f.level]),
        now: { uids: now.team.map((x) => x.uid), win: now.win },
        plan: { win: plan.win, team: plan.team.map((x) => x.kind === 'own' ? { kind: 'own', uid: x.uid, id: x.id, from: x.from.id, level: x.from.level } : { kind: 'catch', id: x.id, base: x.base, ch: x.ch, where: x.where, mins: Math.round(x.mins || 0) }) },
      };
      saved[ch] = r; for (const k of Object.keys(saved).sort((a, b) => saved[b].at - saved[a].at).slice(3)) delete saved[k]; keep();
      try { Log.add(`gym plan for ${G.name}: your team now ${Math.round(now.win * 100)}%, best possible ${Math.round(plan.win * 100)}% (${r.plan.team.map((t) => D()[t.id]?.name).join(', ')})`); } catch (__e) { __h('66-gymplan:113', __e); }
      try { UI.refresh?.(); } catch (__e) { __h('66-gymplan:114', __e); }
      return r;
    } finally { busy = null; }
  }
  // Pokémon stuck at the cap with an evolution waiting (they only evolve when they level up): evolve them
  function evolveStuck() {
    const out = [];
    for (const m of sideMons()) {
      const ev = safe(() => E.read('Game.levelEvolutions', [], m), []) || [];
      if (!ev.length || m.level < (safe(() => +E.read('Game.capFor', 0, m), 0) || 999)) continue;
      const to = +ev[0].to; const before = m.id;
      try { E.call('Game.evolveMon', m.uid, to); } catch (__e) { __h('66-gymplan:125', __e); }
      const now = E.read('Game.getMon', null, m.uid);
      if (now && now.id !== before) { out.push([before, now.id]); try { Log.add(`${D()[before]?.name} evolved into ${D()[now.id]?.name} (it was waiting at the level cap)`); } catch (__e) { __h('66-gymplan:127', __e); } }
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
  setInterval(() => { try { if (E.get('Game.S')?.link?.side === 'to' && Plan.running && E.ready()) evolveStuck(); } catch (__e) { __h('66-gymplan:138', __e); } }, 5 * 60_000);
  return { gymOf, get, run, evolveStuck, evolveTo, nextGym, get busy() { return busy; }, get saved() { return saved; } };
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
    act: { f: 'all', q: '', range: 24, show: 120 },
    box: { f: 'all', q: '', sort: 'level', type: '', sel: null, show: 160 },
    dex: { reg: null, f: 'all', show: 300 },
    tm: { draft: null, slot: 0, q: '', add: null },
  };
  const row = (k, v) => `<div class="row"><span class="k">${k}</span><span class="v">${v}</span></div>`;
  const sp = (id, n = 52, dark = false) => `<img src="${E.sprite(id)}" width="${n}" height="${n}" style="image-rendering:pixelated;background:var(--well,#16122b);border-radius:12px;flex:none;${dark ? 'filter:brightness(0);opacity:.45' : ''}">`;
  const hm = (ms) => { const m = Math.max(1, Math.round(ms / 60000)); return m < 60 ? `${m} min` : m < 2880 ? `${Math.floor(m / 60)} h${m % 60 ? ' ' + (m % 60) + ' min' : ''}` : `${Math.round(m / 1440)} days`; };
  const at = (t) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const cap1 = (w) => String(w || '').charAt(0).toUpperCase() + String(w || '').slice(1);
  const chips = (list, cur, act) => `<div style="display:flex;flex-wrap:wrap;gap:6px;margin:8px 0">${list.map(([k, l]) => `<button class="btn sm" style="width:auto;padding:8px 12px;${cur === k ? 'background:linear-gradient(90deg,#5b3fd6,#7a5cff)' : ''}" data-act="${act}" data-v="${k}">${l}</button>`).join('')}</div>`;

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
    return `<div class="card"><h3>${esc(title)}</h3><div style="display:flex;justify-content:space-between"><b style="font-size:19px">${f(pts[pts.length - 1][1])}${opt.need ? ` <span class="dim" style="font-size:14px">of ${f(opt.need)}</span>` : ''}</b><span class="${ch > 0 ? 'ok' : ch < 0 ? 'warn' : 'dim'}">${ch > 0 ? '+' : ''}${f(ch)}</span></div>
      <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;margin-top:6px;background:var(--well,#16122b);border-radius:12px">${opt.need ? `<line x1="${P}" x2="${W - P}" y1="${Y(opt.need)}" y2="${Y(opt.need)}" stroke="#c79a2b" stroke-dasharray="4 4"/>` : ''}<path d="${d}" fill="none" stroke="#9c86ff" stroke-width="2.5" stroke-linejoin="round"/></svg>
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
      h += `<div class="card" style="border-color:#5b3fd6"><h3>Since You Last Looked · ${hm(Date.now() - since)}</h3>${deltas.length ? `<div style="line-height:1.9">${deltas.join('<br>')}</div>` : '<div class="dim">No changes in the numbers.</div>'}
        ${key.length ? `<div class="dim" style="margin-top:8px;font-weight:700">HIGHLIGHTS</div>${key.map((l) => `<div style="margin:3px 0"><span class="dim">${at(l.at)}</span> ${esc(Casing.names(l.text))}</div>`).join('')}` : ''}
        <button class="btn sm" style="margin-top:8px" data-act="m-away-ok">Got It</button></div>`;
    }
    const cut = Date.now() - ui.act.range * 3.6e6, H1 = History.since(cut - 1), rows = H1.rows.filter((r) => r[0] >= cut), col = (i) => rows.map((r) => [r[0], r[i]]);
    h += `<div class="card"><h3>History</h3>${chips([[6, '6 h'], [24, '24 h'], [168, '7 days']], ui.act.range, 'm-act-range')}</div>`;
    for (const [id, nm] of Object.entries(H1.names || {})) { if (nm[3] || !nm[1]) continue; const pts = rows.filter((r) => r[6]?.[id] != null).map((r) => [r[0], r[6][id]]); if (pts.length >= 2) h += chart(esc, nm[0], pts, { need: nm[1] }); }
    h += chart(esc, 'Money', col(1), { fmt: (v) => '₽' + Math.round(v).toLocaleString() }) + chart(esc, 'Pokédex', col(2)) + chart(esc, 'Total Levels (All Pokémon)', col(5)) + chart(esc, 'Shinies', col(3)) + chart(esc, 'Lv 100 Pokémon', col(4));
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
      <div class="grid">${list.slice(0, B.show).map(({ m, where, buddy }) => `<div class="mon" data-act="m-box-open" data-uid="${esc(m.uid)}" style="cursor:pointer;position:relative;${B.sel === m.uid ? 'border-color:#9c86ff;box-shadow:0 0 0 2px #9c86ff55' : ''}">${ic[where] ? `<span style="position:absolute;top:3px;right:5px;font-size:12px">${ic[where]}</span>` : ''}<img src="${E.sprite(m.id)}" loading="lazy">${esc(nmRaw(m.id))}<div class="dim">Lv ${m.level}${m.rank ? ' ★' + m.rank : ''}${m.shiny ? ' ✨' : ''}${buddy ? ' 💛' : ''}</div></div>`).join('') || '<div class="dim">Nothing matches.</div>'}</div>
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
    return `<div class="card" style="border-color:#7a5cff"><div style="display:flex;gap:12px;align-items:center">${sp(m.id, 72)}<div style="flex:1"><div style="font-size:19px;font-weight:800">${esc(d.name || '#' + m.id)}${m.shiny ? ' ✨' : ''}${S0.buddy?.uid === uid ? ' 💛' : ''}</div><div class="dim">${esc(d.genus || '')}</div><div>${(d.types || []).map(cap1).join(' / ')}</div></div><button class="btn sm" style="width:auto;padding:8px 12px" data-act="m-box-close">✕</button></div>
      ${row('Level', `${m.level}${cap > m.level ? ` <span class="dim">(cap ${cap})</span>` : ''}`)}${m.rank ? row('Rank', '★' + m.rank) : ''}${row('Where', where)}
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
    return `<div class="card"><div style="display:flex;flex-wrap:wrap;gap:6px">${regs.map((r) => { const l = DexInfo.regionIds(r.key); return `<button class="btn sm" style="width:auto;padding:8px 12px;${r.key === R.key ? 'background:linear-gradient(90deg,#5b3fd6,#7a5cff)' : ''}" data-act="m-dex-reg" data-v="${r.key}">${esc(r.name)} ${l.filter(reg).length}/${l.length}</button>`; }).join('')}</div>
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
    if (!sw.owned && sw.ways.length && !hunt) h += `<div class="dim" style="font-size:13px;margin-top:8px">Times are rough averages - shinies are luck. Non-shiny catches and hatches stay in your PC (Mega never releases).</div>`;
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
    const cell = (m, big) => `<img src="${E.sprite(m.id)}" style="width:${big ? 48 : 40}px;height:${big ? 48 : 40}px">${esc(nmRaw(m.id))}<div class="dim">Lv ${m.level}${m.rank ? ' ★' + m.rank : ''}${m.shiny ? ' ✨' : ''}</div>`;
    const busy = Plan.goals.filter((g) => !g.done && Plan.live(g.id)?.state === 'running' && GoalTypes[g.type]?.uses === 'screen').map((g) => Plan.label(g));
    let h = `<div class="card"><h3>Change Team</h3><div class="dim">Click a slot, then a Pokémon below. Pokémon in the Underground aren't listed.</div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:8px">${[0, 1, 2, 3, 4, 5].map((i) => { const m = T.draft[i] && mon(T.draft[i]); return `<div class="mon" data-act="m-tm-slot" data-v="${i}" style="cursor:pointer;min-height:80px;${T.slot === i ? 'border:2px solid #9c86ff' : ''}">${m ? cell(m, true) + `<div class="dim" data-act="m-tm-drop" data-v="${i}" style="cursor:pointer">✕ remove</div>` : '<div class="dim" style="padding-top:24px">empty</div>'}</div>`; }).join('')}</div>
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
      case 'm-act-f': ui.act.f = v; ui.act.show = 120; break;
      case 'm-act-more': ui.act.show += 200; break;
      case 'm-box-f': ui.box.f = v; ui.box.show = 160; break;
      case 'm-box-more': ui.box.show += 240; break;
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

/* ===================================================================================================
 * XpChap - which chapter levels Pokémon fastest, in XP per hour.
 *
 *   XP per win  = the game's own formula, averaged over the chapter's wild Pokémon as they spawn:
 *                 levelXp(foe Lv) / XP_WINS_PER_LEVEL x sqrt(BASE_EXP[foe] / XP_BASE_REF) x REGION_XP
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
  let rates = {}; try { rates = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (__e) { __h('69-xpchap:17', __e); }
  const keep = () => { try { localStorage.setItem(KEY, JSON.stringify(rates)); } catch (__e) { __h('69-xpchap:18', __e); } };
  let last = null;

  function perWin(ch) {
    const C = E.get('CONFIG') || {}, B = E.get('BASE_EXP') || {}, ST = E.get('STORY');
    const ref = +C.XP_BASE_REF || 60, wins = +C.XP_WINS_PER_LEVEL || 15;
    let pool = []; try { pool = Sim.chapterPool(ch); } catch (__e) { __h('69-xpchap:24', __e); }
    if (!pool.length) return 0;
    const reg = (() => { try { return ST.regionOf(ch)?.key; } catch { return null; } })();
    const xp = pool.reduce((t, p) => t + p.w * (E.read('Game.levelXp', 0, p.lv) || 0) / wins * Math.sqrt((+B[p.id] || ref) / ref), 0);
    return xp * ((C.REGION_XP || {})[reg] || 1);
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
      out.push({ ch, top: isFinite(wildTop) ? wildTop : top, name: ST.CHAPTERS[ch]?.name || 'chapter ' + ch, perWin: pw, rate, learned, min: Math.round((rates[ch]?.ms || 0) / 60_000), xpHr: pw * rate, score: pw * rate });
    }
    return out.sort((a, b) => b.xpHr - a.xpHr || b.ch - a.ch);
  }
  // the chapter to train in; with a level goal (g) it remembers its choice for 10 minutes and scouts close calls
  function pick(g) {
    const r = rank(); if (!r.length) return null;
    if (!g) return r[0];
    const kept = r.find((x) => x.ch === g.chPick);
    if (kept && Date.now() - (g.chPickAt || 0) < SCOUT) return { ...kept, scout: !!g.chScout };
    const top = r[0], close = r.filter((x) => x.xpHr >= top.xpHr * CLOSE);
    const untested = close.find((x) => (rates[x.ch]?.ms || 0) < SCOUT);
    const choice = (rates[top.ch]?.ms || 0) < SCOUT ? top : (untested || top);
    const scout = choice.ch !== top.ch;
    if (g.chPick !== choice.ch) {
      try { Log.add(scout ? `checking ${choice.name} for 10 min: predicted ${fmt(choice.xpHr)} XP/h, close to ${top.name} (${fmt(top.xpHr)})` : `best leveling chapter: ${choice.name} - ${fmt(choice.xpHr)} XP/h${choice.learned ? ' (measured)' : ' (predicted)'}`); } catch (__e) { __h('69-xpchap:61', __e); }
    }
    g.chPick = choice.ch; g.chPickAt = Date.now(); g.chScout = scout;
    return { ...choice, scout };
  }
  // count the game's battles while training in ch (gaps over 2 min - tab asleep, PC off - don't count)
  function tick(ch) {
    const b = +S().stats?.battles || 0, t = Date.now();
    if (last && last.ch === ch && b >= last.b && t - last.t < 120_000) {
      const r = rates[ch] || (rates[ch] = { b: 0, ms: 0 });
      r.b += b - last.b; r.ms += t - last.t;
      // keep it about the last 2 hours so speed or team changes show up
      if (r.ms > 2 * 3.6e6) { const k = 2 * 3.6e6 / r.ms; r.b *= k; r.ms *= k; }
      keep();
    }
    last = { ch, b, t };
  }
  const fmt = (n) => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(Math.round(n));
  return { perWin, rank, pick, tick, rateOf, fmt, get rates() { return rates; } };
})();

/* ---------------------------------------------------------------------------------------------
 * Log: what Mega did and why, newest last. Kept in localStorage (last 200 lines).
 * ------------------------------------------------------------------------------------------- */
const Log = (() => {
  const KEY = 'mega-log';
  let lines = (() => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } })();
  function add(text) {
    lines.push({ at: Date.now(), text });
    if (lines.length > 1000) lines = lines.slice(-1000);
    try { localStorage.setItem(KEY, JSON.stringify(lines)); } catch { lines = lines.slice(-300); try { localStorage.setItem(KEY, JSON.stringify(lines)); } catch (__e) { __h('70-plan:10', __e); } }
    console.log('[Mega Alakazam] ' + text);
    try { Remote.soon(); } catch (__e) { __h('70-plan:12', __e); } // phone sees it right away
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
const GoalTypes = (() => {
  const E = Engine;
  const S = () => E.get('Game.S') || {};
  const name = (id) => E.get('Game.DEX')?.[id]?.name || '#' + id;
  const pending = new Set(); // legend ids whose team search is running

  // the battle screen is held by a run Mega must never interrupt
  function holder() {
    const s = S(), a = s.adv || {};
    if (a.event?.raid) return 'a Shiny Raid run';
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
    try { E.call('Game.save'); } catch (__e) { __h('70-plan:49', __e); }
    try { E.call('App.refresh'); } catch (__e) { __h('70-plan:50', __e); }
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

  const legend = {
    uses: 'screen',
    label: (g) => g.forms ? `Catch every ${name(g.foe)} form` : `Catch ${name(g.foe)}`,
    sprite: (g) => g.formNow || g.foe,
    check(g) {
      const z = Legends.get(g.foe);
      if (!z) return { state: 'wait', why: 'not in the game data' };
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
            if (!first) try { Notify.send('win', `${z.formName} is here this week`, `New weekly form at ${z.place || 'its zone'}. Mega will hunt it. Still missing: ${left}.`); } catch (__e) { __h('70-plan:98', __e); }
          }
        }
        if (!z.form || E.read('Game.owns', false, z.form)) return { state: 'wait', why: `this week's form is caught - a new one comes at the weekly reset (Sunday 4 PM). Still missing: ${left}` };
      } else if (z.state === 'done' || E.read('Game.owns', false, g.foe)) return { state: 'done', why: 'caught' };
      if (z.state === 'closed') return { state: 'wait', why: `zone closed right now (${z.when || 'time window'})` };
      if (z.state !== 'open') {
        // goals that plan themselves: add what this legendary still needs (every 30 min)
        let manual = g.chainManual || [];
        if (Date.now() - (g.chainAt || 0) > 30 * 60_000) { g.chainAt = Date.now(); try { const r = Chains.addFor(g); manual = g.chainManual = r.manual; } catch (__e) { __h('70-plan:107', __e); } Plan.save(); }
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
        try { E.call('Adventure.leaveZone'); } catch (__e) { __h('70-plan:142', __e); }
        await new Promise((x) => setTimeout(x, 600));
        await ctx.enter(id, true);
        return `switched to the planned team (${sim.uids.length} Pokémon) and re-entered`;
      }
      const tries = +(S().legTries?.[form || id] ?? 0);
      const berry = Berries.keep('capture', `catching ${name(form || id)}`);
      return `${form ? name(form) + ' · ' : ''}${vs ? 'fighting' : 'in the zone'} · ${tries} capture tr${tries === 1 ? 'y' : 'ies'} so far${berry}`;
    },
  };

  // ---- story: beat a new region's gyms and League (Unova) -------------------------------------
  // A new region is its own side until its League: own money, bag and team, only Pokémon caught there
  // (Game.sideMons). Mega stays in that region's chapters (opening an older chapter would swap sides),
  // plays the frontier chapter with the loop off so it moves on, picks the 6 side Pokémon the simulator
  // rates best against that chapter (its gym leader counts as a whole stop), and when the team keeps
  // wiping there it trains in the best cleared chapter of the region for 30 minutes, then tries again.
  const safe = (f, d = null) => { try { const v = f(); return v === undefined ? d : v; } catch { return d; } };
  // a region run only counts Pokémon on that region's side (the game's sideMons), any stage of the family
  const sideHas = (id) => { const f = new Set(safe(() => [...(E.read('Game.familyOf', [], id) || [])].map(Number), [+id])); f.add(+id); return (E.read('Game.sideMons', []) || []).some((m) => f.has(+m.id)); };
  const sideOf = (id) => { const f = new Set(safe(() => [...(E.read('Game.familyOf', [], id) || [])].map(Number), [+id])); f.add(+id); return (E.read('Game.sideMons', []) || []).filter((m) => f.has(+m.id)).sort((a, b) => b.level - a.level)[0] || null; };
  const story = {
    uses: 'screen',
    label: (g) => `Beat the ${g.regionName || 'Unova'} League`,
    sprite: (g) => g.lead || 643,
    check(g) {
      const ST = E.get('STORY'), reg = g.region || 'unova';
      if (safe(() => E.read('Game.regionCleared', false, reg))) return { state: 'done', why: 'League beaten - the two sides are linked now' };
      const chs = safe(() => ST.chaptersOf(reg), []) || [];
      if (!chs.length) return { state: 'wait', why: 'region not in the game data' };
      const un = +(S().adv?.unlocked ?? 0);
      if (un < chs[0]) return { state: 'wait', why: 'region not unlocked yet' };
      const pend = S().adv?.pending;
      if (pend) { if (!g.askedPend) { g.askedPend = true; Plan.save(); try { Notify.send('problem', 'Poke\'Catch needs you', 'The game is waiting for a choice in your story run (a gift or a question). Open the game and choose.'); } catch (__e) { __h('70-plan:175', __e); } } return { state: 'wait', why: 'the game is waiting for you to choose something' }; }
      g.askedPend = false;
      const mons = (E.read('Game.sideMons', []) || []).filter((m) => !m.egg);
      if (!mons.length) return { state: 'wait', why: 'no Pokémon on this side yet - pick your starter' };
      // catch jobs for the gym plan go first - but only ones that can run now: a catch that waits for
      // the weather or the time of day never holds up the gyms (it's dropped at the next step)
      const kids = Plan.goals.filter((c) => !c.done && c.parent === g.id && safe(() => GoalTypes[c.type].check(c).state) !== 'wait');
      if (kids.length) return { state: 'wait', why: `catching for the gym plan first: ${kids.map((c) => name(c.foe)).join(', ')}` };
      return { state: 'ready', why: null };
    },
    async step(g) {
      const ST = E.get('STORY'), a = S().adv || {}, reg = g.region || 'unova';
      if (a.zone) return 'waiting: inside a legendary zone';
      const chs = safe(() => ST.chaptersOf(reg), []) || [];
      const un = +(a.unlocked ?? 0), front = Math.min(un, chs[chs.length - 1]);
      const deaths = +(a.deaths?.[front] ?? 0);
      if (g.front !== front) { g.front = front; g.deaths0 = deaths; g.trainUntil = 0; g.teamAt = 0; Plan.save(); Log.add(`story: next up ${ST.CHAPTERS[front]?.name || 'chapter ' + front}`); }
      const mons = (E.read('Game.sideMons', []) || []).filter((m) => !m.egg);
      const sp = (m) => Sim.species(m);
      // stuck: 2 wipes in the frontier chapter since the last try -> train for 30 minutes
      const now = Date.now();
      if (!g.trainUntil && deaths - (g.deaths0 || 0) >= 2) {
        const capped = mons.filter((m) => m.level >= capOf(m.uid)).length;
        if (capped >= Math.min(6, mons.length)) { g.deaths0 = deaths; Plan.save(); Log.add('story: lost twice, but everyone is at the level cap - trying again with the best team'); }
        else { g.trainUntil = now + 30 * 60_000; Plan.save(); Log.add(`story: lost twice at ${ST.CHAPTERS[front]?.name} - training for 30 minutes first`); }
        try { GymPlan.get(front, { force: true }); } catch (__e) { __h('70-plan:200', __e); }
      }
      const training = g.trainUntil && now < g.trainUntil;
      if (g.trainUntil && !training) { g.trainUntil = 0; g.deaths0 = deaths; Plan.save(); Log.add('story: training done - back to the next chapter'); }
      // where: the frontier chapter (loop off so a win moves on), or the best cleared chapter of the region to train
      let ch = front;
      if (training) {
        const done = chs.filter((c) => c < front);
        const r = safe(() => XpChap.rank().filter((x) => done.includes(x.ch)), []) || [];
        ch = r[0]?.ch ?? done[done.length - 1] ?? front;
      }
      // ---- gym plan: the team that beats this gym (game's own estimate), and how to get it ----
      try { GymPlan.evolveStuck(); } catch (__e) { __h('70-plan:212', __e); }
      const G = safe(() => GymPlan.gymOf(front));
      const plan = G && G.foes.length ? safe(() => GymPlan.get(front)) : null;
      g.planWin = plan ? plan.plan.win : null; g.nowWin = plan ? plan.now.win : null;
      if (plan && !training) {
        // fight the gym once your team wins 60% (Jimmy) - or when the best possible team
        // wouldn't do meaningfully better (then preparing longer can't help)
        const good = plan.now.win >= 0.6 || plan.plan.win - plan.now.win < 0.05;
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
            if (!wantIds.has(+c.foe) || waiting) { Plan.remove(c.id); Log.add(`gym plan: dropped catching ${name(c.foe)} (${waiting ? 'not catchable right now' : 'not needed any more'})`); }
          }
          for (const t of [...wantNow, ...wantNext]) {
            if (!Plan.goals.some((c) => !c.done && c.type === 'wild' && c.parent === g.id && +c.foe === +t.base)) { Plan.insertAfter(g.id, 'wild', { foe: t.base, ch: t.ch, parent: g.id, side: true }); Log.add(`gym plan: catching ${name(t.base)} (${t.where}) for ${wantNow.includes(t) ? plan.gym : 'the gym after (' + (nplan?.gym || 'next') + ')'}`); }
          }
          // 2) level the members below the cap: they train together, the 2 strongest capped ones carry
          const members = plan.plan.team.map((t) => t.kind === 'own' ? E.read('Game.getMon', null, t.uid) : sideOf(t.base)).filter(Boolean);
          const capOfM = (m) => safe(() => +E.read('Game.capFor', 0, m), 0) || G.cap || 100;
          const low = members.filter((m) => m.level < capOfM(m));
          if (low.length) {
            const carriers = (E.read('Game.sideMons', []) || []).filter((m) => !low.includes(m) && m.level >= capOfM(m)).sort((a, b) => b.level - a.level).slice(0, 2);
            const uids = [...low.slice(0, 4), ...carriers].map((m) => m.uid).slice(0, 6);
            const done = chs.filter((c) => c < front);
            const r = safe(() => XpChap.rank().filter((x) => done.includes(x.ch)), []) || [];
            const tch = r[0]?.ch ?? done[done.length - 1] ?? front;
            if (uids.join() !== (S().team || []).slice(0, 6).join()) { setChapterTeam(uids); Log.add(`gym plan: leveling ${low.map((m) => `${name(m.id)} Lv ${m.level}`).join(', ')} to the cap (${G.cap})`); }
            if (+a.chapter !== tch) { if (E.call('Adventure.setChapter', tch) === false) return `waiting: the game would not open ${ST.CHAPTERS[tch]?.name}`; return `moving to ${ST.CHAPTERS[tch]?.name} to level the gym team…`; }
            if (!E.read('Adventure.isLooping', false, tch)) { try { E.call('Adventure.toggleLoop', tch); g.loopOn = tch; Plan.save(); } catch (__e) { __h('70-plan:247', __e); } }
            return `leveling the gym team in ${ST.CHAPTERS[tch]?.name}: ${low.map((m) => `${name(m.id)} ${m.level}/${capOfM(m)}`).join(', ')} · then ${plan.gym} (best plan ${Math.round(plan.plan.win * 100)}%)`;
          }
          // 3) everyone's here and at the cap: fight with the planned team, in the planned order
          const uids = plan.plan.team.map((t) => (t.kind === 'own' ? t.uid : sideOf(t.base)?.uid)).filter(Boolean);
          if (uids.length && uids.join() !== (S().team || []).slice(0, 6).join()) { setChapterTeam(uids); Log.add(`gym plan team for ${plan.gym}: ${uids.map((u) => name(E.read('Game.getMon', null, u)?.id)).join(', ')} (~${Math.round(plan.plan.win * 100)}%)`); }
          g.teamAt = now; g.teamFor = ch;
        } else if (plan.now.uids.length && (!g.teamAt || g.teamFor !== ch || now - g.teamAt > 10 * 60_000)) {
          // the team you have is good enough: catch jobs for this gym aren't needed
          for (const c of Plan.goals.filter((c) => !c.done && c.type === 'wild' && c.parent === g.id)) { Plan.remove(c.id); Log.add(`gym plan: dropped catching ${name(c.foe)} (your team is ready)`); }
          if (plan.now.uids.join() !== (S().team || []).slice(0, 6).join()) { setChapterTeam(plan.now.uids); Log.add(`story team for ${plan.gym} (~${Math.round(plan.now.win * 100)}%): ${plan.now.uids.map((u) => name(E.read('Game.getMon', null, u)?.id)).join(', ')}`); }
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
      // buddy: x1.3 XP plus a candy every few KOs - the lowest-level team member under the cap gets it,
      // so the team stays even (the gym is only as easy as your weakest Pokémon)
      { const team = (S().team || []).slice(0, 6).map((u) => E.read('Game.getMon', null, u)).filter(Boolean).filter((m) => m.level < capOf(m.uid));
        const bud = team.sort((x, y) => x.level - y.level)[0];
        if (bud && S().buddy?.uid !== bud.uid) { try { E.call('Game.setBuddy', bud.uid); } catch (__e) { __h('70-plan:275', __e); } if (S().buddy?.uid === bud.uid) Log.add(`story: made ${name(bud.id)} (Lv ${bud.level}) your buddy - it's the lowest on the team`); } }
      if (+a.chapter !== ch) { if (E.call('Adventure.setChapter', ch) === false) return `waiting: the game would not open ${ST.CHAPTERS[ch]?.name}`; return `moving to ${ST.CHAPTERS[ch]?.name}…`; }
      const looping = !!E.read('Adventure.isLooping', false, ch);
      if (training && !looping) { try { E.call('Adventure.toggleLoop', ch); g.loopOn = ch; Plan.save(); } catch (__e) { __h('70-plan:278', __e); } }
      if (!training && looping) { try { E.call('Adventure.toggleLoop', ch); } catch (__e) { __h('70-plan:279', __e); } } // the frontier must not loop, or a win wouldn't move on
      if (!training && g.loopOn != null && g.loopOn !== ch && E.read('Adventure.isLooping', false, g.loopOn)) { try { E.call('Adventure.toggleLoop', g.loopOn); } catch (__e) { __h('70-plan:280', __e); } g.loopOn = null; Plan.save(); }
      const badges = chs.filter((c) => c < front).length;
      return training ? `training in ${ST.CHAPTERS[ch]?.name} for ${Math.ceil((g.trainUntil - now) / 60_000)} more min (lost twice at ${ST.CHAPTERS[front]?.name})`
        : `playing ${ST.CHAPTERS[ch]?.name} · stop ${(+a.node || 0) + 1} of ${a.nodes?.length || '?'} · ${badges}/${chs.length} chapters done · ${deaths - (g.deaths0 || 0)} loss${deaths - (g.deaths0 || 0) === 1 ? '' : 'es'} here`;
    },
    finish(g) { try { if (g.loopOn != null && E.read('Adventure.isLooping', false, g.loopOn)) E.call('Adventure.toggleLoop', g.loopOn); } catch (__e) { __h('70-plan:285', __e); } },
  };

  // ---- leveling -------------------------------------------------------------------------
  // XP per win = levelXp(enemy level) / XP_WINS_PER_LEVEL x region bonus, and every team member
  // gets it (fighting or not). So: strongest chapter you have unlocked, best region bonus.
  // the leveling chapter: XP per hour (XpChap - game XP formula x measured wins per hour, scouting
  // close calls). The old foe-level-only pick stays as a fallback.
  function bestChapter(g) {
    try { const p = XpChap.pick(g); if (p) return p; } catch (e) { Log.add('XP/hour chapter pick failed: ' + (e?.message || e)); }
    const ST = E.get('STORY'), C = E.get('CONFIG') || {}, unlocked = +(S().adv?.unlocked ?? 0);
    let best = null;
    for (let ch = 0; ch <= unlocked && ch < (ST?.CHAPTERS?.length || 0); ch++) {
      const band = (() => { try { return ST.bandOf(ch); } catch { return null; } })();
      const top = band && Math.max(...band.filter((x) => x != null));
      if (!top || !isFinite(top)) continue;
      const reg = (() => { try { return ST.regionOf(ch)?.key; } catch { return null; } })();
      const score = (E.read('Game.levelXp', 0, top) || 0) * ((C.REGION_XP || {})[reg] || 1);
      if (!best || score > best.score || (score === best.score && ch > best.ch)) best = { ch, top, reg, score, name: ST.CHAPTERS[ch]?.name || 'chapter ' + ch };
    }
    return best;
  }
  const lvl = (u) => E.read('Game.getMon', null, u)?.level ?? null;
  const capOf = (u) => { const m = E.read('Game.getMon', null, u); return Math.min(100, E.read('Game.capFor', 100, m) || 100); };
  const needs = (g) => g.uids.filter((u) => lvl(u) != null && lvl(u) < Math.min(g.target || 100, capOf(u)));

  function setChapterTeam(uids) {
    const s = S();
    s.team = uids.slice(0, 6);
    s.road = null; // the game rebuilds the road team from .team (same as its own team editor)
    try { E.call('Game.save'); } catch (__e) { __h('70-plan:315', __e); }
    try { E.call('App.refresh'); } catch (__e) { __h('70-plan:316', __e); }
    const now = (E.read('Game.teamMons', []) || []).map((m) => m.uid);
    return uids.every((u) => now.includes(u));
  }

  // Rule: while leveling, keep a Pinap Berry (XP x1.25, 60 min) going. One at a time, never
  // stacked ahead, and only from a leveling goal you put in the plan.
  let pinapOut = false;
  function keepPinap() {
    const buff = (E.read('Game.activeBuffs', []) || []).find((b) => b.family === 'xp');
    if (buff && buff.left > 120_000) { pinapOut = false; return ` · Pinap ${Math.ceil(buff.left / 60_000)} min`; }
    const have = +E.read('Game.itemCount', 0, 'pinap-berry') || 0;
    if (!have) { if (!pinapOut) Log.add('out of Pinap Berries - training continues without the XP boost'); pinapOut = true; return ' · no Pinap Berries left'; }
    let ok = null;
    try { ok = E.call('Game.useBuffBerry', 'pinap-berry'); } catch (__e) { __h('70-plan:330', __e); }
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
    label: (g) => `Level ${g.uids.map((u) => name(E.read('Game.getMon', {}, u)?.id)).join(', ')} to ${g.target || 100}${g.forFoe ? ` (for ${name(g.forFoe)})` : g.forDex ? ` (evolves into ${name(g.forDex)})` : ''}`,
    sprite: (g) => E.read('Game.getMon', {}, g.uids[0])?.id,
    check(g) {
      if (g.forDex && E.read('Game.inDex', false, g.forDex)) return { state: 'done', why: `${name(g.forDex)} registered` };
      if (g.forDex && g.uids.every((u) => (lvl(u) || 0) >= (g.target || 100)) && !E.read('Game.inDex', false, g.forDex)) return { state: 'wait', why: `reached Lv ${g.target} but did not evolve - evolve it from its Pokémon screen` };
      const gone = g.uids.filter((u) => !E.read('Game.getMon', null, u));
      if (gone.length === g.uids.length) return { state: 'done', why: 'those Pokémon are gone' };
      if (!needs(g).length) return { state: 'done', why: 'all at their level' };
      const away = needs(g).filter((u) => (E.read('Game.underMons', []) || []).some((m) => m.uid === u));
      if (away.length) return { state: 'wait', why: `${away.map((u) => name(E.read('Game.getMon', {}, u)?.id)).join(', ')} in the Underground` };
      if (!bestChapter()) return { state: 'wait', why: 'no chapter to train in' };
      return { state: 'ready', why: null };
    },
    async step(g) {
      const s = S(), a = s.adv || {};
      const best = bestChapter(g);
      if (!best) return 'waiting: no chapter to train in';
      if (!a.zone && +a.chapter === best.ch) { try { XpChap.tick(best.ch); } catch (__e) { __h('70-plan:361', __e); } }
      if (!g.restore) {
        g.restore = { team: [...(s.team || [])], chapter: a.chapter, loopAdded: null, buddy: s.buddy?.uid ?? null };
        Plan.save();
        Log.add(`${level.label(g)}: training in ${best.name} (wild Lv ${best.top}). Your team, buddy and chapter come back when it's done.`);
      }
      // leave a legendary zone first (the game's own way back)
      if (a.zone) { try { E.call('Adventure.leaveZone'); } catch (__e) { __h('70-plan:368', __e); } return 'leaving the legendary zone…'; }
      // team: 4 trainees + 2 carriers (Jimmy's rule - every team member gets the full XP of each win).
      // A 3rd carrier only when the simulator says it raises total XP per hour: 3 trainees earn 25% less
      // per win, so the 3rd carrier has to make wins come more than a third faster (hard chapters).
      // Fewer than 4 left in this goal: the free trainee slots go to the idle order (prestiged, then
      // shinies, then closest to Lv 100) - they level along for free, the goal still ends with its own.
      const pending = needs(g), list = [...pending];
      if (list.length < 4) {
        const sp = (u) => Sim.species(E.read('Game.getMon', {}, u));
        for (const u of idlePick(40)) { if (list.length >= 4) break; if (!list.includes(u) && !g.uids.includes(u) && !(g.refused || []).includes(u) && !list.some((x) => sp(x) === sp(u))) list.push(u); }
      }
      // carriers: the fully-leveled Pokémon that clear this chapter fastest (simulated against its wild
      // Pokémon and boss); re-picked when the chapter changes or the picker itself improved (CARRIER_V)
      if (g.carriersFor !== best.ch || g.carriersV !== Sim.CARRIER_V) {
        let picks = [];
        try { picks = Sim.carriers(best.ch, { exclude: [...g.uids, ...list, ...(g.refused || [])], n: 10 }).picks.filter((p) => p.m.level >= capOf(p.m.uid)); } catch (e) { Log.add('could not rate carriers: ' + (e?.message || e)); }
        g.carriers = picks.map((p) => p.m.uid); g.carriersFor = best.ch; g.carriersV = Sim.CARRIER_V;
        // 2 or 3 carriers: whichever gives more total XP per hour
        g.nCarry = 2; let why = '';
        try {
          const foes = Sim.chapterFoes(best.ch), mons = picks.slice(0, 3).map((p) => p.m);
          // time per win ~ the best carrier's hits to KO each foe (the game sends the best matchup), + 1 for
          // the fight itself, + 2 per KO it risks taking (a fainted carrier means a trainee fights)
          const cost = (ms) => foes.reduce((t, f) => t + f.w * (1 + Math.min(...ms.map((m) => { const c = Sim.clearScore(m, [{ ...f, w: 1 }]); return 1 / Math.max(c.kill, 0.02) + 2 * c.hurt; }))), 0);
          if (mons.length >= 3) {
            const c2 = cost(mons.slice(0, 2)), c3 = cost(mons), x2 = 4 / c2, x3 = 3 / c3;
            if (x3 > x2 * 1.02) g.nCarry = 3;
            why = ` - 2 carriers ${Math.round(x2 / Math.max(x2, x3) * 100)}% vs 3 carriers ${Math.round(x3 / Math.max(x2, x3) * 100)}% of the best XP/h`;
          }
        } catch (__e) { __h('70-plan:397', __e); }
        Plan.save();
        if (picks.length) Log.add(`carriers for ${best.name}: ${picks.slice(0, g.nCarry).map((p) => name(p.m.id)).join(', ')}${why}`);
      }
      const trainees = list.slice(0, 6 - (g.nCarry || 2));
      const extra = trainees.filter((u) => !g.uids.includes(u));
      if (extra.join() !== (g.extra || []).join()) { g.extra = extra; Plan.save(); if (extra.length) Log.add(`free trainee slots: also leveling ${extra.map((u) => `${name(E.read('Game.getMon', {}, u)?.id)} Lv ${lvl(u)}`).join(', ')}`); }
      const want = [...trainees];
      const byLevel = [...(g.carriers || []), ...(g.restore.team || []), ...here().sort((x, y) => y.level - x.level).map((m) => m.uid)].filter(((aw) => (u) => !aw.has(u))(awayNow()));
      for (const u of byLevel) { if (want.length >= 6) break; if (!want.includes(u) && (lvl(u) || 0) >= 90 && (lvl(u) || 0) >= capOf(u) && !g.uids.includes(u) && !(g.refused || []).includes(u) && E.read('Game.getMon', null, u) && !want.some((w) => Sim.species(E.read('Game.getMon', {}, w)) === Sim.species(E.read('Game.getMon', {}, u)))) want.push(u); }
      const cur = (E.read('Game.teamMons', []) || []).map((m) => m.uid);
      if (!want.every((u) => cur.includes(u))) {
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
      if (+a.chapter !== best.ch) {
        if (E.call('Adventure.setChapter', best.ch) === false) return `waiting: the game would not open ${best.name}`;
        Log.add(`moved to ${best.name} to train`);
      }
      // buddy: x1.3 XP plus a candy every few KOs - the trainee furthest from its goal gets it
      const bud = [...(pending.length ? pending.filter((u) => trainees.includes(u)) : trainees)].sort((x, y) => (lvl(x) || 0) - (lvl(y) || 0))[0];
      if (bud && S().buddy?.uid !== bud) {
        try { E.call('Game.setBuddy', bud); } catch (__e) { __h('70-plan:429', __e); }
        if (S().buddy?.uid === bud) Log.add(`made ${name(E.read('Game.getMon', {}, bud)?.id)} your buddy while it trains`);
      }
      // moved chapters (better XP or a 10-minute check): turn off the loop Mega added on the old one
      if (g.restore.loopAdded != null && g.restore.loopAdded !== best.ch) {
        try { if (E.read('Adventure.isLooping', false, g.restore.loopAdded)) E.call('Adventure.toggleLoop', g.restore.loopAdded); } catch (__e) { __h('70-plan:434', __e); }
        g.restore.loopAdded = null; Plan.save();
      }
      if (!E.read('Adventure.isLooping', false, best.ch)) {
        try { E.call('Adventure.toggleLoop', best.ch); g.restore.loopAdded = best.ch; Plan.save(); Log.add(`turned on loop for ${best.name} so training stays there`); } catch (__e) { __h('70-plan:438', __e); }
      }
      const berry = Berries.keep('xp', 'training');
      return `training in ${best.name}${best.scout ? ' (10-min XP check)' : ''}${best.xpHr ? ` ~${XpChap.fmt(best.xpHr)} XP/h` : ''}${berry} · ` + g.uids.map((u) => `${name(E.read('Game.getMon', {}, u)?.id)} ${lvl(u)}/${Math.min(g.target || 100, capOf(u))}`).join(', ');
    },
    // put things back: your team, the loop setting, and the chapter you were in
    finish(g) {
      const r = g.restore; if (!r) return;
      try { if (r.loopAdded != null && E.read('Adventure.isLooping', false, r.loopAdded)) E.call('Adventure.toggleLoop', r.loopAdded); } catch (__e) { __h('70-plan:446', __e); }
      try { const back = (r.team || []).filter((u) => E.read('Game.getMon', null, u)); if (back.length && back.join() !== (S().team || []).join()) setChapterTeam(back); } catch (__e) { __h('70-plan:447', __e); }
      if (r.buddy && S().buddy?.uid !== r.buddy && E.read('Game.getMon', null, r.buddy)) { try { E.call('Game.setBuddy', r.buddy); } catch (__e) { __h('70-plan:448', __e); } }
      const back = (r.team || []).filter((u) => E.read('Game.getMon', null, u));
      if (back.length) setChapterTeam(back);
      if (!S().adv?.zone && r.chapter != null && +S().adv?.chapter !== +r.chapter) { try { E.call('Adventure.setChapter', +r.chapter); } catch (__e) { __h('70-plan:451', __e); } }
      g.restore = null; Plan.save();
      Log.add(`${level.label(g)}: done - your team, buddy and chapter are back`);
    },
  };

  // ---- Underground --------------------------------------------------------------------------
  // Runs alongside the other goals. Each tick: bring finished expeditions home (only once their
  // time is up), then fill free bays while runs are left today. Teams are picked with the game's
  // own expedition simulation (Underground.simulate, run in its sandbox - your save is untouched),
  // from Pokémon no other goal or your chapter team is using.
  const U = () => E.get('Underground');
  const ugPlans = {}; // bay -> { sig, uids, floors }
  let ugBusy = false, ugStatus = '';
  // Pokémon down in the Underground: the game won't put them on any team until they come back
  const awayNow = () => new Set((E.read('Game.underMons', []) || []).map((m) => m.uid));
  const here = () => { const a = awayNow(); return (E.read('Game.ownedMons', []) || []).filter((m) => !a.has(m.uid)); };
  function reserved() {
    const out = new Set(S().team || []);
    for (const g of Plan.goals) {
      if (g.done) continue;
      if (g.type === 'legend') { for (const u of E.read('Game.zoneTeam', [], g.foe) || []) out.add(u); for (const u of Legends.sims()[g.foe]?.uids || []) out.add(u); }
      if (g.type === 'level') { for (const u of [...(g.uids || []), ...(g.carriers || [])]) out.add(u); }
    }
    return out;
  }
  function eligible() {
    const used = S().under?.used || {}, rsv = reserved();
    const away = new Set((E.read('Game.underMons', []) || []).map((m) => m.uid));
    return (E.read('Game.ownedMons', []) || []).filter((m) => !used[m.uid] && !rsv.has(m.uid) && !away.has(m.uid) && (() => { try { return !U().why(m); } catch { return false; } })());
  }
  const power = (m) => { const st = E.read('Game.statsOf', null, m) || {}; return (st.hp || 0) + (st.atk || 0) + (st.def || 0) + (st.spa || 0) + (st.spd || 0) + (st.spe || 0); };
  async function depth(team, theme, from, runs = 2) {
    let f = 0;
    for (let i = 0; i < runs; i++) { const r = await U().simulate(team, theme, from); f += (r?.at?.length || 0) + from - 1; await new Promise((x) => setTimeout(x, 0)); }
    return f / runs;
  }
  async function ugPick(bay, from, taken) {
    const theme = U().themeOf(bay);
    const pool = eligible().filter((m) => !taken.has(m.uid)).sort((a, b) => b.level - a.level || power(b) - power(a));
    const size = (E.get('CONFIG')?.UNDERGROUND?.TEAM) || 3;
    if (pool.length < size) return { error: `only ${pool.length} Pokémon free to send today` };
    const short = pool.slice(0, 24);
    let team = []; for (const m of short) { if (team.length >= size) break; if (!team.some((t) => Sim.species(t) === Sim.species(m))) team.push(m); }
    let best = await depth(team, theme, from);
    for (let pass = 0; pass < 2; pass++) {
      let better = false;
      for (let slot = 0; slot < size; slot++) {
        for (const c of short) {
          if (team.some((t, k) => t.uid === c.uid || (k !== slot && Sim.species(t) === Sim.species(c)))) continue;
          const trial = team.slice(); trial[slot] = c;
          const d = await depth(trial, theme, from);
          if (d > best + 0.5) { best = d; team = trial; better = true; }
        }
      }
      if (!better) break;
    }
    return { uids: team.map((m) => m.uid), floors: Math.round(best), theme: theme?.name || theme?.key };
  }

  const under = {
    uses: 'background',
    label: (g) => `Underground from floor ${g.from || 1}`,
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
        let pr = null; try { pr = u.progress(sl); } catch (__e) { __h('70-plan:524', __e); }
        if (pr?.done && now > +sl.end + 2000) {
          const reached = pr.floor ?? sl.res?.at?.length;
          try { u.collect(sl.id); } catch (e) { Log.add('Underground: could not bring a run home (' + (e?.message || e) + ')'); continue; }
          try { E.call('Game.save'); } catch (__e) { __h('70-plan:528', __e); }
          try { E.call('App.refresh'); } catch (__e) { __h('70-plan:529', __e); }
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
      const from = (u.starts() || [1]).includes(+g.from || 1) ? (+g.from || 1) : 1;
      ugBusy = true;
      ugStatus = 'picking a team with the game\'s own expedition simulation…';
      (async () => { try {
        const taken = new Set();
        for (const bay of free.slice(0, left)) {
          const sig = [S().under?.day, bay, JSON.stringify(u.themeOf(bay)), from, [...reserved()].sort().join(',')].join('|');
          let pl = ugPlans[bay];
          if (!pl || pl.sig !== sig || pl.uids.some((x) => taken.has(x))) {
            const r = await ugPick(bay, from, taken);
            if (r.error) { ugStatus = r.error; return; }
            pl = ugPlans[bay] = { sig, ...r };
          }
          pl.uids.forEach((x) => taken.add(x));
          if (!Plan.running || Plan.oldOn() || !Plan.hasType('under')) return; // paused or removed while picking
          const who = pl.uids.map((x) => name(E.read('Game.getMon', {}, x)?.id)).join(', '); // before: once sent, they're out of the PC
          { const why = Guard.team(pl.uids, { need: (E.get('CONFIG')?.UNDERGROUND?.TEAM) || 3, minLevel: 1 });
            if (why) { ugStatus = Guard.stop(`Underground bay ${bay + 1}`, why); delete ugPlans[bay]; return; } }
          const res = await u.send(pl.uids, bay, from);
          if (res?.error) { Log.add(`Underground bay ${bay + 1}: the game said "${res.error}"`); delete ugPlans[bay]; ugStatus = 'could not send: ' + res.error; return; }
          try { E.call('Game.save'); } catch (__e) { __h('70-plan:565', __e); }
          try { E.call('App.refresh'); } catch (__e) { __h('70-plan:566', __e); }
          Log.add(`Underground bay ${bay + 1} (${pl.theme}): sent ${who} from floor ${from} - about floor ${pl.floors} by the game's own simulation`);
          delete ugPlans[bay];
        }
        ugStatus = '';
      } catch (e) { ugStatus = 'error: ' + (e?.message || e); Log.add('Underground: ' + ugStatus); } finally { ugBusy = false; } })();
      return ugStatus;
    },
  };

  // ---- catch a wild Pokémon in a chapter ---------------------------------------------------------
  // Goes to the chapter, keeps it looping and auto-catch on, and restarts the chapter (free, back to
  // stop 0) as soon as none of the stops ahead can hold the target.
  const poolAt = (stop, ch) => E.pool(stop, ch);
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
  function eggOf(id) { const L = E.get('CONFIG')?.PENSION?.LAYS || {}; if (L[id] != null) return +L[id]; let f = []; try { f = E.get('Game').familyOf(+id) || []; } catch (__e) { __h('70-plan:599', __e); } return +(f[0] ?? id); }
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
    let fam = []; try { fam = Gm.familyOf(id) || []; } catch (__e) { __h('70-plan:611', __e); }
    // 1. breed a shiny you own from the same family (1/16 an egg)
    const perDay = 86_400_000 / (+(S().pension?.eggGoal) || 10_800_000);
    for (const m of here().filter((x) => x.shiny && fam.includes(+x.id))) {
      let ok = false; try { ok = Gm.canLay(m); } catch (__e) { __h('70-plan:615', __e); } if (!ok) continue;
      const egg = eggOf(m.id), steps = egg === id ? [] : levelPath(egg, id); if (!steps) continue;
      let rate = 0.0625; try { rate = +Gm.eggRate({ id: egg, reg: m.reg, sp: 2 }) || rate; } catch (__e) { __h('70-plan:617', __e); }
      const hours = (1 / (rate * perDay) + 0.25) * 24 + (steps.length ? 2 : 0);
      out.push({ way: 'breed', parent: m.uid, parentId: +m.id, egg, steps, rate, hours,
        text: `breed your shiny ${name(m.id)} in the Day Care: each egg is a ${name(egg)} with a 1 in ${Math.round(1 / rate)} shiny chance${steps.length ? `, then level it to ${steps.map((x) => `${name(x.to)} (Lv ${x.level})`).join(', then ')}` : ''}` });
      break;
    }
    // 2. the wild: where it's most common (share of all encounters in that chapter)
    let r = 1 / 1024; try { r = +Gm.shinyRate(id) || r; } catch (__e) { __h('70-plan:624', __e); }
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
      let rp = 1 / 1024; try { rp = +Gm.shinyRate(pre) || rp; } catch (__e) { __h('70-plan:637', __e); }
      const routes = (E.get('STORY')?.CHAPTERS?.[c.ch]?.steps || []).filter((x) => x.kind === 'route' && x.areas?.length).length || 1;
      const share = c.spots.reduce((t, x) => t + (x.on ? x.pct : 0), 0) / routes || c.best / routes;
      out.push({ way: 'wild', foe: pre, target: id, ch: c.ch, now: c.now, share, rate: rp * 2, steps, hours: 1 / (WILD_PER_HOUR * share * rp * 2) + (steps ? 2 : 0),
        text: `hunt a shiny ${name(pre)} in ${Casing.names(c.name)} (about ${share >= 0.1 ? Math.round(share * 100) : (share * 100).toFixed(1)}% of encounters${c.now ? '' : ', not at this time / weather'}), then ${steps ? `Mega levels it to ${steps.map((x) => `${name(x.to)} (Lv ${x.level})`).join(', then ')}` : `evolve it into ${name(id)} yourself (it needs a stone or item)`}` });
    }
    // 3. the Shiny Raid: today's boss is always shiny
    try { const lane = RD()?.lane?.() || []; const hit = lane.find((x) => +x.boss === id && !x.won); if (hit) out.push({ way: 'raid', reg: hit.key, hours: 0, text: `it's today's Shiny Raid boss in ${hit.key} - the boss is always shiny (the Shiny Raid goal catches it)` }); } catch (__e) { __h('70-plan:644', __e); }
    return { owned: false, ways: out.sort((a, b) => a.hours - b.hours) };
  }
  const shinyLabel = (g) => `Shiny ${name(g.target || g.foe)}${g.way === 'breed' ? ` (breeding your shiny ${name(g.parentId)})` : ` (${g.target && g.target !== g.foe ? `as ${name(g.foe)}, ` : ''}${E.get('STORY')?.CHAPTERS?.[g.ch]?.name || 'chapter ' + g.ch})`}`;
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
      if (!spots.some((x) => x.on)) { const w = [...new Set(spots.flatMap((x) => x.when || []))]; return { state: 'wait', why: `only appears ${w.length ? 'in ' + w.join(' / ') : 'at another time'}` }; }
      return { state: 'ready', why: null };
    },
    async step(g) {
      const a = S().adv || {};
      if (a.capture && !a.capture.shiny) { a.capture.shiny = true; try { E.call('Game.save'); } catch (__e) { __h('70-plan:670', __e); } Log.add('turned on "always catch shinies" for the shiny hunt'); }
      // count each new encounter with the target (and the battles, for the real pace)
      const b = a.battle, foes = (b?.enemies || []).filter((e) => +e.id === +g.foe);
      for (const e of foes) if (e.uid && e.uid !== g.lastUid) { g.lastUid = e.uid; g.seen = (g.seen || 0) + 1; if (e.shiny) Log.add(`✨ a shiny ${name(g.foe)} appeared - catching!`); Plan.save(); }
      const bt = +(S().stats?.battles ?? 0); if (!g.b0) { g.b0 = bt; g.t0 = Date.now(); Plan.save(); }
      const line = await wild.step(g);
      // Starf: shiny x2. Nanab: rare-rarity Pokémon appear x2 as often (the game's spawn weight), so a rare target is met twice as often
      let rare = false; try { rare = E.get('Game').tierOf(+g.foe)?.key === 'rare'; } catch (__e) { __h('70-plan:677', __e); }
      const berry = Berries.keep('shiny', `hunting a shiny ${name(g.foe)}`) + (rare ? Berries.keep('rare', `finding ${name(g.foe)} (rare) more often`) : '');
      const hrs = (Date.now() - g.t0) / 3.6e6, perH = hrs > 0.2 ? (bt - g.b0) / hrs : null;
      return `${foes.length ? (foes.some((e) => e.shiny) ? `✨ SHINY ${name(g.foe)} - catching!` : `${name(g.foe)} found - not shiny`) : line.replace(/^[^·]*· /, '')} · ${g.seen || 0} seen (1 in ${Math.round(1 / (g.rate || 1 / 512))} each)${perH ? ` · ${Math.round(perH)} fights/h` : ''}${berry}`;
    },
    finish(g) { wild.finish(g); },
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
        let r = null; try { r = E.call('Game.hatchEgg', e.uid); } catch (__e) { __h('70-plan:703', __e); }
        if (!r) continue;
        try { E.call('Game.save'); } catch (__e) { __h('70-plan:705', __e); } try { E.call('App.refresh'); } catch (__e) { __h('70-plan:705', __e); }
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
        try { E.call('Game.toPension', ditto.uid); E.call('Game.save'); } catch (__e) { __h('70-plan:720', __e); }
        if (E.read('Game.pensionHasDitto', false)) { g.placedDitto = ditto.uid; Plan.save(); Log.add('shiny hunt: put Ditto in the Day Care'); }
        return 'putting Ditto in the Day Care…';
      }
      if (!inCare(g.parent)) {
        if (!free()) return `waiting: the Day Care is full - make room for your shiny ${name(g.parentId)}`;
        const why = Guard.team([g.parent], { need: 1, minLevel: 1 }); if (why) return 'waiting: ' + why;
        try { E.call('Game.toPension', g.parent); E.call('Game.save'); } catch (__e) { __h('70-plan:727', __e); }
        if ((S().pension?.mons || []).some((x) => (x.mon || x)?.uid === g.parent)) { g.placed = g.parent; Plan.save(); Log.add(`shiny hunt: put your shiny ${name(g.parentId)} in the Day Care`); }
        return `putting your shiny ${name(g.parentId)} in the Day Care…`;
      }
      const sl = DexInfo.eggSlots(), mine = (P.eggs || []).filter((e) => +e.id === +g.egg && e.sp).sort((a, b) => a.hatchAt - b.hatchAt);
      return `${g.hatched || 0} eggs hatched · ${mine.length} on the way${mine.length ? ` (next hatches ${DexInfo.clock(mine[0].hatchAt)})` : ''} · 1 in ${Math.round(1 / (g.rate || 0.0625))} each${sl.used >= sl.max ? ' · incubator full - hatch other eggs to make room' : ''}`;
    },
    finish(g) {
      for (const k of ['placed', 'placedDitto']) if (g[k]) { try { E.call('Game.fromPension', g[k]); } catch (__e) { __h('70-plan:735', __e); } g[k] = null; }
      try { E.call('Game.save'); } catch (__e) { __h('70-plan:736', __e); } Plan.save();
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
      if (!spots.some((x) => x.on)) { const w = [...new Set(spots.flatMap((x) => x.when || []))]; return { state: 'wait', why: `only appears ${w.length ? 'in ' + w.join(' / ') : 'at another time'}` }; }
      return { state: 'ready', why: null };
    },
    async step(g) {
      const s = S(), a = s.adv || {};
      if (!g.restore) { g.restore = { chapter: a.chapter, loopAdded: null, capture: a.capture ? { ...a.capture } : null }; Plan.save(); Log.add(`${wild.label(g)}: going there. Your chapter comes back when it's done.`); }
      if (a.zone) { try { E.call('Adventure.leaveZone'); } catch (__e) { __h('70-plan:754', __e); } return 'leaving the legendary zone…'; }
      // auto-catch must be on and catching new species
      if (a.capture && (!a.capture.on || !/new|missing/.test(a.capture.target || ''))) { a.capture.on = true; a.capture.target = 'new'; try { E.call('Game.save'); } catch (__e) { __h('70-plan:756', __e); } Log.add('turned auto-catch on ("new") so the target gets caught'); }
      if (+a.chapter !== +g.ch) { if (E.call('Adventure.setChapter', +g.ch) === false) return 'waiting: the game would not open that chapter'; return 'moving to the chapter…'; }
      if (!E.read('Adventure.isLooping', false, +g.ch)) { try { E.call('Adventure.toggleLoop', +g.ch); g.restore.loopAdded = +g.ch; Plan.save(); } catch (__e) { __h('70-plan:758', __e); } }
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
        if (typeof scr?.restartChapter === 'function') { try { scr.restartChapter(+g.ch); } catch (__e) { __h('70-plan:769', __e); } }
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
      const berry = Berries.keep('dex', `catching ${name(g.foe)}`) + Berries.keep('capture', `catching ${name(g.foe)}`, { strongest: false });
      const pct = Math.max(0, ...wildSpots(g.foe, g.ch).filter((x) => x.on).map((x) => x.pct));
      return `${vs ? `${name(g.foe)} found - catching!` : `stop ${at + 1}/${nodes.length}`} · can appear at ${can.length} stop${can.length === 1 ? '' : 's'} (${Math.round(pct * 1000) / 10}%)${g.restarts ? ` · ${g.restarts} restarts` : ''}${berry}`;
    },
    finish(g) {
      const r = g.restore; if (!r) return;
      try { if (r.loopAdded != null && E.read('Adventure.isLooping', false, r.loopAdded)) E.call('Adventure.toggleLoop', r.loopAdded); } catch (__e) { __h('70-plan:786', __e); }
      if (!S().adv?.zone && r.chapter != null && +S().adv?.chapter !== +r.chapter) { try { E.call('Adventure.setChapter', +r.chapter); } catch (__e) { __h('70-plan:787', __e); } }
      g.restore = null; Plan.save();
    },
  };

  // ---- shared: go to a chapter and keep it (remember what to put back) -------------------------------
  // the best team for a chapter you're only passing through (catching, a special encounter, souls,
  // a rare item): its 6 best carriers for that chapter's foes, from the side that can play it. The team
  // you had comes back when the goal is done. Pokémon in the Underground or on a raid stay put.
  function passTeam(g, ch) {
    if (g.teamSet === ch) return;
    let picks = []; try { picks = Sim.carriers(+ch, { n: 6, minLevel: 1 }).picks; } catch (__e) { __h('70-plan:798', __e); }
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
    if (a.zone) { try { E.call('Adventure.leaveZone'); } catch (__e) { __h('70-plan:826', __e); } return 'leaving the legendary zone…'; }
    if (a.capture && (!a.capture.on || !/new|missing/.test(a.capture.target || ''))) { a.capture.on = true; a.capture.target = 'new'; try { E.call('Game.save'); } catch (__e) { __h('70-plan:827', __e); } Log.add('turned auto-catch on ("new")'); }
    if (+a.chapter !== +ch) { if (E.call('Adventure.setChapter', +ch) === false) return 'waiting: the game would not open that chapter'; return 'moving to the chapter…'; }
    if (!E.read('Adventure.isLooping', false, +ch)) { try { E.call('Adventure.toggleLoop', +ch); g.restore.loopAdded = +ch; Plan.save(); } catch (__e) { __h('70-plan:829', __e); } }
    passTeam(g, ch);
    return null;
  }
  // rebuild a chapter from stop 0: the game's own Restart (Screens.adventure.restartChapter) when you're in it;
  // otherwise (or if that's missing) step out and back - re-opening the same chapter just continues (Jimmy)
  function rebuild(ch) {
    const a = S().adv || {}, scr = E.get('Screens')?.adventure;
    if (+a.chapter === +ch && typeof scr?.restartChapter === 'function') { try { scr.restartChapter(+ch); return true; } catch (__e) { __h('70-plan:837', __e); } }
    const unlocked = +(a.unlocked ?? 0), other = +ch > 0 ? +ch - 1 : Math.min(unlocked, +ch + 1);
    if (other === +ch || E.call('Adventure.setChapter', other) === false) return false;
    E.call('Adventure.setChapter', +ch);
    return true;
  }
  const putBack = (g) => wild.finish(g);

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
      if (!rebuild(g.ch)) return 'waiting: could not rebuild the chapter';
      g.rebuilds = (g.rebuilds || 0) + 1; Plan.save();
      const sp = DexInfo.special(g.foe).find((x) => x.ch === +g.ch);
      return `rebuilding the chapter until it shows up (${g.rebuilds} tries · ${sp ? DexInfo.pct(sp.chance) : '?'} each)`;
    },
    finish: (g) => putBack(g),
  };

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
  // the item belongs to the region it's farmed in (Spiritomb's souls: Sinnoh) - count that region's bag,
  // even while you're on Unova's side (the game keeps the other bag in its stash)
  const soulHave = (g) => DexInfo.itemFor(g.item, g.pick?.ch ?? g.ch ?? (() => { try { return DexInfo.special(g.forDex)[0]?.ch; } catch { return null; } })());
  const souls = {
    uses: 'screen',
    progress: (g) => ({ have: Math.min(g.need, soulHave(g)), need: g.need, unit: g.item + 's' }),
    label: (g) => `Collect ${g.need} ${g.item}s${g.forDex ? ` (for ${name(g.forDex)})` : ''}`,
    sprite: (g) => g.forDex || null,
    check(g) {
      const have = soulHave(g);
      if (have >= g.need) return { state: 'done', why: `${have}/${g.need}` };
      const cfg = E.get('CONFIG')?.SOULS || {};
      if (!soulChapter(cfg)) return { state: 'wait', why: `no ${cfg.type || ''} Pokémon in reach right now (time of day / weather)` };
      return { state: 'ready', why: null };
    },
    async step(g) {
      const cfg = E.get('CONFIG')?.SOULS || {};
      // re-pick every 10 minutes: Ghost types depend on the time of day
      if (!g.pick || Date.now() - (g.pickAt || 0) > 600_000) { const old = g.pick; g.pick = soulChapter(cfg); g.pickAt = Date.now(); Plan.save(); if (g.pick && (old?.ch !== g.pick.ch || old?.cut !== g.pick.cut)) Log.add(`${souls.label(g)}: farming in ${g.pick.name}${g.pick.cut != null ? `, restarting after stop ${g.pick.cut + 1}` : ''} (${Math.round(g.pick.score * 100)}% of fights are ${cfg.type})`); }
      if (!g.pick) return 'no chapter with them right now';
      const w = goChapter(g, g.pick.ch, souls.label(g)); if (w) return w;
      // past the last stop with ghosts: restart the chapter (the game's own Restart) instead of playing it out
      // (the run's own stops: a run can have more stops than the chapter map)
      const a = S().adv || {}, at = +a.node || 0, inFight = !!a.battle, nodes = a.nodes || [], D0 = E.get('Game.DEX') || {};
      const ghostAt = nodes.map((n, i) => (n?.areas?.length && poolAt(n, g.pick.ch).some((x) => x.on !== false && (D0[x.id]?.types || []).includes(cfg.type)) ? i : -1)).filter((i) => i >= 0);
      const last = ghostAt.length ? Math.max(...ghostAt) : -1;
      if (g.pick.cut != null && last >= 0 && at > last && !inFight && !a.event && !a.zone) {
        if (rebuild(g.pick.ch)) { g.restarts = (g.restarts || 0) + 1; Plan.save(); return `restarted ${g.pick.name} - no ${cfg.type || ''} Pokémon after stop ${last + 1} (${g.restarts} restarts)`; }
      }
      const have = soulHave(g);
      if (g.startHave == null) { g.startHave = have; g.startAt = Date.now(); Plan.save(); }
      const got = have - g.startHave, hrs = (Date.now() - g.startAt) / 3_600_000, rate = hrs > 0.05 ? got / hrs : null;
      return `${have}/${g.need} ${g.item}s · ${g.pick.name}${g.pick.cut != null ? ` stops 1-${g.pick.cut + 1}` : ''} (${Math.round(g.pick.score * 100)}% of fights ${cfg.type})${rate ? ` · ~${Math.round(rate)}/h, about ${Math.ceil((g.need - have) / Math.max(0.1, rate))} h to go` : ''}`;
    },
    finish: (g) => putBack(g),
  };

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
      if (L.skies && !L.skies.includes((() => { try { return E.get('WEATHER').current({ name: L.place, ch: L.ch }); } catch { return null; } })())) return { state: 'wait', why: `only in ${L.skies.join(' / ')}` };
      return { state: 'ready', why: null };
    },
    async step(g) {
      // the egg needs a free Day Care egg slot: hatch a ready egg to make room
      if (g.item.startsWith('egg:')) {
        const sl = DexInfo.eggSlots();
        if (sl.used >= sl.max) {
          const e = (S().pension?.eggs || []).find((x) => E.read('Game.eggReady', false, x));
          if (e) { let r = null; try { r = E.call('Game.hatchEgg', e.uid); } catch (__e) { __h('70-plan:967', __e); } if (r) { try { E.call('Game.save'); } catch (__e) { __h('70-plan:967', __e); } Log.add(`hatched a ${name(e.id)} egg to free a Day Care egg slot for the ${DexInfo.itemName(g.item)}`); } }
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
      if (!rebuild(g.ch)) return 'waiting: could not rebuild the chapter';
      g.rebuilds = (g.rebuilds || 0) + 1; Plan.save();
      return `no item stop at ${g.place} in this run - rebuilding (${g.visits || 0} checked so far)`;
    },
    finish: (g) => putBack(g),
  };

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
      if (mon) { try { E.call('Game.toPension', mon.uid); } catch (__e) { __h('70-plan:1008', __e); } try { E.call('Game.save'); } catch (__e) { __h('70-plan:1008', __e); } if ((S().pension?.mons || []).some((x) => (x.mon || x)?.uid === mon.uid)) { g.placed = mon.uid; Plan.save(); Log.add(`put ${name(g.from)} in the Day Care to breed ${name(g.foe)}`); } }
      return `putting ${name(g.from)} in the Day Care…`;
    },
    finish(g) { if (g.placed) { try { E.call('Game.fromPension', g.placed); } catch (__e) { __h('70-plan:1011', __e); } try { E.call('Game.save'); } catch (__e) { __h('70-plan:1011', __e); } Log.add(`took ${name(g.from)} back from the Day Care`); g.placed = null; Plan.save(); } },
  };

  // hatch ready Day Care eggs of species you're missing (eggs of things you have are left alone)
  function hatchMissing() {
    for (const e of [...(S().pension?.eggs || [])]) {
      if (E.read('Game.inDex', false, +e.id) || !E.read('Game.eggReady', false, e)) continue;
      let r = null; try { r = E.call('Game.hatchEgg', e.uid); } catch (__e) { __h('70-plan:1018', __e); }
      if (r) { try { E.call('Game.save'); } catch (__e) { __h('70-plan:1019', __e); } try { E.call('App.refresh'); } catch (__e) { __h('70-plan:1019', __e); } Log.add(`hatched a ${name(e.id)} egg from the Day Care`); }
    }
  }

  // ---- Candy Factory: one run a day, of the day's type ----------------------------------------------
  // CandyRun.why(): 'running' | 'played' | 'day' (closed today) | 'team' | 'locked' | null (ready).
  // The day's type comes from the game's server (CandyRun.loadDay, what opening the Factory does).
  const CR = () => E.get('CandyRun');
  function candyPool(from) {
    const out = new Map();
    for (let f = from; f < from + 40; f += 4) {
      // the trainers on each floor (the game moved this to floorOf().team = [[id, level], ...];
      // poolOf is now empty, which made Mega skip picking a team and start with a leftover one)
      let p = []; try { p = (CR().floorOf(f)?.team || []).map((x) => (Array.isArray(x) ? { id: x[0], lv: x[1] } : x)); } catch (__e) { __h('70-plan:1032', __e); }
      if (!p.length) { try { p = CR().poolOf(f) || []; } catch (__e) { __h('70-plan:1033', __e); } }
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
      let fl = null; try { fl = CR().floorOf(f); } catch (__e) { __h('70-plan:1054', __e); }
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
      if (why === 'played') { const nd = (() => { try { return +E.get('Raids').nextDay(); } catch { return 0; } })(); return { state: 'wait', why: `done today${(() => { try { const l = c.last(); return l ? ` (${l.type}, floor ${l.floor})` : ''; } catch { return ''; } })()} - next run ${nd ? DexInfo.clock(nd) : 'after the daily reset'}` }; }
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
          try { E.call('Adventure.startTower', false, 'candy'); E.call('App.refresh'); } catch (__e) { __h('70-plan:1110', __e); } Log.add('Candy Factory: put the paused run back on screen'); return 'putting the run back on screen…';
        }
        return `run in progress · ${r?.type || ''} · floor ${r?.floor ?? '?'}`;
      }
      if (!c.today()) { try { await c.loadDay(); } catch (__e) { __h('70-plan:1114', __e); } if (!c.today()) return 'reading today\'s type…'; }
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
        if (uids.length && old !== uids.join(',')) { s0.eventTeams[c.TEAM_KEY || 'candy'] = uids; try { E.call('Game.save'); } catch (__e) { __h('70-plan:1132', __e); } Log.add(`Candy Factory (${day.type}): team ${uids.map((u) => name(E.read('Game.getMon', {}, u)?.id)).join(', ')}`); }
      }
      // safety: the team the game will really use (read back) must be the full team Mega picked
      { const key = c.TEAM_KEY || 'candy';
        let game = null; try { game = (c.picked() || []).map((m) => m?.uid ?? m); } catch (__e) { __h('70-plan:1136', __e); }
        if (!game || !game.length) game = S().eventTeams?.[key] || [];
        const why = candyNeed < 1 ? 'no Pokémon are allowed today' : Guard.team(game, { need: candyNeed, want: candyWant, minLevel: 50 });
        if (why) return Guard.stop('the Candy Factory', why); }
      let r = null; try { r = E.call('Adventure.startTower', false, 'candy', from); } catch (e) { Log.add('Candy Factory: the game refused to start (' + (e?.message || e) + ')'); }
      try { E.call('App.refresh'); } catch (__e) { __h('70-plan:1141', __e); }
      if (r && c.run()) { Log.add(`Candy Factory: started today's ${day.type} run from floor ${from}`); return `started today's ${day.type} run`; }
      return 'could not start the run - ' + (((() => { try { return c.why(); } catch { return null; } })()) || 'see the log');
    },
  };

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
      try { E.call('App.refresh'); } catch (__e) { __h('70-plan:1171', __e); }
      if (ok && S().adv?.tower) { Log.add(run ? 'Battle Tower: resumed this week\'s run' : 'Battle Tower: started this week\'s run'); return run ? 'resumed the run' : 'started this week\'s run'; }
      return 'could not start the Tower - see the log';
    },
  };

  // ---- Shiny Raid: today's drawn region, best 2 of yours + best ally trainers, one smart reroll -------
  // The draw (which region's raid you get) comes from the game's server (Raids.sync). Raids.lane()
  // lists every region's boss of the day, so a reroll (random other region, once a day, right after
  // the draw) is only used when it can only help.
  const RD = () => E.get('Raids');
  const bst = (id) => { const st = (E.get('Game.DEX') || {})[id]?.stats || {}; return (st.hp || 0) + (st.atk || 0) + (st.def || 0) + (st.spa || 0) + (st.spd || 0) + (st.spe || 0); };
  const ownsShiny = (id) => (E.read('Game.ownedMons', []) || []).some((m) => +m.id === +id && m.shiny);
  // how much you'd want this region's boss: a shiny you don't own counts most, then its base stats
  const want = (id) => (ownsShiny(id) ? 0 : 1000) + bst(id);
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
    return { mine: best.p.map((m) => m.uid), allies: allies.map((x) => x.b.key), allyNames: allies.map((x) => x.b.name), ko: best.ko, tested };
  }
  async function raidRepick() {
    const r = RD(), C = E.get('CONFIG')?.RAID || {}, a = S().adv || {};
    const g = Plan.goals.find((x) => x.type === 'raid' && !x.done);
    let reg = a.event?.raid ? a.event.reg : null; if (!reg) { try { reg = r.drawn(); } catch (__e) { __h('70-plan:1252', __e); } }
    if (!reg) { if (g) { delete g.pick; Plan.save(); } return 'today\'s raid isn\'t drawn yet - it will pick when it starts'; }
    const lane = (() => { try { return r.lane() || []; } catch { return []; } })(), boss = a.event?.raid ? +a.event.id : lane.find((x) => x.key === reg)?.boss;
    if (!boss) return 'can\'t read today\'s boss';
    const blocked = Guard.blocks('raid'); if (blocked) return 'safety check: ' + blocked;
    const pick = await raidPick(reg, boss, C); let day = null; try { day = r.dateKey(); } catch (__e) { __h('70-plan:1257', __e); }
    if (g) { g.pick = { ...pick, day, reg }; Plan.save(); }
    const names = pick.mine.map((u) => name(E.read('Game.getMon', {}, u)?.id)).join(' & ');
    if (a.event?.raid) { // running now: swap the team for the next fight
      const why = Guard.team(pick.mine, { need: +C.MINE || 2, minLevel: 70 }); if (why) return 'not changed - ' + why;
      const s0 = S(); s0.eventTeams = s0.eventTeams || {}; s0.eventTeams[r.teamKey(reg)] = pick.mine;
      pick.allies.slice(0, +C.ALLIES || 2).forEach((k, i) => { try { r.setPick(reg, i, k); } catch (__e) { __h('70-plan:1263', __e); } });
      try { E.call('Game.save'); } catch (__e) { __h('70-plan:1264', __e); } try { E.call('App.refresh'); } catch (__e) { __h('70-plan:1264', __e); }
      Log.add(`Shiny Raid: re-picked from the phone - ${names} + ${pick.allyNames.join(' & ')} (${Math.round(pick.ko * 100)}% in the simulator)`);
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
      if (S().adv?.event?.raid) return { state: 'ready', why: null };
      if (Date.now() - raidSyncAt > 10 * 60_000) { raidSyncAt = Date.now(); try { r.sync(); } catch (__e) { __h('70-plan:1277', __e); } }
      const reg = (() => { try { return r.drawn(); } catch { return null; } })();
      if (!reg) { const from = r.state?.drawFrom; return { state: 'wait', why: `today's raid isn't drawn yet${from && from > Date.now() ? ` - draws ${DexInfo.clock(from)}` : ''}` }; }
      if ((() => { try { return r.done(reg); } catch { return false; } })()) { const b = (r.lane() || []).find((x) => x.key === reg);
        const day = (() => { try { return r.dateKey(); } catch { return null; } })();
        if (g && day && g.told !== day) { g.told = day; Plan.save(); Notify.send('daily', `Shiny Raid won${b ? `: ${name(b.boss)}` : ''}`, `${reg} · ${(() => { try { return r.tried(reg, day); } catch { return '?'; } })()} tries`); } const nd = (() => { try { return +r.nextDay(); } catch { return 0; } })(); return { state: 'wait', why: `won today${b ? ` (${name(b.boss)})` : ''} - next raid ${nd ? DexInfo.clock(nd) : 'after the daily reset'}` }; }
      return { state: 'ready', why: null };
    },
    async step(g) {
      const r = RD(), C = E.get('CONFIG')?.RAID || {};
      if (S().adv?.event?.raid) { const ev = S().adv.event; return `raid on · ${name(ev.id)} (${ev.reg}) · try ${(() => { try { return r.tried(ev.reg, ev.date); } catch { return '?'; } })()}`; }
      let reg = r.drawn(); try { r.reveal(); } catch (__e) { __h('70-plan:1288', __e); }
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
        Log.add(`Shiny Raid: simulated ${g.pick.tested} teams vs ${name(boss)} - best: ${g.pick.mine.map((u) => name(E.read('Game.getMon', {}, u)?.id)).join(' & ')} + ${g.pick.allyNames.join(' & ')} (${Math.round(g.pick.ko * 100)}% KOs in the simulator)`);
      }
      const mine = g.pick.mine.map((u) => E.read('Game.getMon', null, u)).filter(Boolean);
      const s0 = S(); s0.eventTeams = s0.eventTeams || {}; s0.eventTeams[r.teamKey(reg)] = mine.map((m) => m.uid);
      const allyN = +C.ALLIES || 2;
      const bots = g.pick.allies.slice(0, allyN).map((key) => ({ b: { key, name: g.pick.allyNames[g.pick.allies.indexOf(key)] } }));
      bots.forEach((x, i) => { try { r.setPick(reg, i, x.b.key); } catch (__e) { __h('70-plan:1317', __e); } });
      try { E.call('Game.save'); } catch (__e) { __h('70-plan:1318', __e); }
      // safety: your 2 (read back from the game) and the ally trainers must be set as picked
      { const read = S().eventTeams?.[r.teamKey(reg)] || [];
        let why = Guard.team(read, { need: +C.MINE || 2, want: g.pick.mine, minLevel: 70 });
        const picks = (() => { try { return (r.picks(reg) || []).filter(Boolean); } catch { return []; } })();
        if (!why && g.pick.allies.length && picks.length < Math.min(allyN, g.pick.allies.length)) why = 'the ally trainers are not set';
        if (why) return Guard.stop('the Shiny Raid', why); }
      let ok = false; try { ok = E.call('Adventure.startRaid', reg); } catch (e) { Log.add('Shiny Raid: the game refused to start (' + (e?.message || e) + ')'); }
      try { E.call('App.refresh'); } catch (__e) { __h('70-plan:1326', __e); }
      if (ok && S().adv?.event?.raid) { Log.add(`Shiny Raid: started vs ${name(boss)} (${reg}) with ${mine.map((m) => name(m.id)).join(' & ')} + ${bots.slice(0, allyN).map((x) => x.b.name).join(' & ')}`); return `started vs ${name(boss)}`; }
      return 'could not start the raid - see the log';
    },
  };

  // ---- money: farm the best-paying chapter until a target ---------------------------------------
  // Only trainers pay (CONFIG.TRAINER_MONEY = 30 x level; WILD_MONEY is 0). Score each unlocked
  // chapter by what its trainers pay per loop, go there with the fastest-clearing carriers + Lansat.
  function moneyChapter() {
    const ST = E.get('STORY'), C = E.get('CONFIG') || {}, unlocked = +(S().adv?.unlocked ?? 0);
    // wild Pokémon pay nothing here (WILD_MONEY = 0); trainers pay CONFIG.TRAINER_MONEY(level)
    const pay = (lv) => { try { return +C.TRAINER_MONEY(lv) || 0; } catch { return lv * 30; } };
    let best = null;
    for (let ch = 0; ch <= unlocked && ch < (ST?.CHAPTERS?.length || 0); ch++) {
      const band = (() => { try { return ST.bandOf(ch); } catch { return null; } })(); const top = band && Math.max(...band.filter((x) => x != null));
      if (!top || !isFinite(top)) continue;
      let run = 0; for (const st of ST.CHAPTERS[ch].steps || []) if (st.kind === 'route') run += (st.trainers || 0) * pay(top);
      if (run && (!best || run > best.run)) best = { ch, run, top, name: ST.CHAPTERS[ch]?.name || 'chapter ' + ch };
    }
    return best;
  }
  const money = {
    uses: 'screen',
    progress: (g) => ({ have: Math.min(+g.target, History.homeMoney()), need: +g.target, money: true }),
    label: (g) => `Farm money to ₽${(+g.target).toLocaleString()}`,
    sprite: () => null,
    check(g) {
      const have = History.homeMoney();
      if (have >= +g.target) return { state: 'done', why: `₽${have.toLocaleString()}` };
      if (!moneyChapter()) return { state: 'wait', why: 'no chapter to farm in' };
      return { state: 'ready', why: null };
    },
    async step(g) {
      const best = moneyChapter(), s = S();
      if (!g.restore) { g.restore = { team: [...(s.team || [])], chapter: s.adv?.chapter, loopAdded: null }; Plan.save(); Log.add(`${money.label(g)}: farming in ${best.name} (Lv ${best.top}). Your team and chapter come back when it's done.`); }
      const w = goChapter(g, best.ch, money.label(g)); if (w) return w;
      // carriers: the fastest clearers of this chapter
      if (g.carriersFor !== best.ch || g.carriersV !== Sim.CARRIER_V) {
        let picks = []; try { picks = Sim.carriers(best.ch, { n: 6 }).picks; } catch (__e) { __h('70-plan:1365', __e); }
        g.carriersFor = best.ch; g.carriersV = Sim.CARRIER_V; g.carriers = picks.map((p) => p.m.uid); Plan.save();
        if (picks.length && setChapterTeam(g.carriers)) Log.add(`money team for ${best.name}: ${picks.map((p) => name(p.m.id)).join(', ')}`);
      }
      const have = +(s.money ?? 0);
      if (g.from == null) { g.from = have; g.fromAt = Date.now(); Plan.save(); }
      const hrs = (Date.now() - g.fromAt) / 3_600_000, rate = hrs > 0.05 ? (have - g.from) / hrs : null;
      const berry = Berries.keep('money', 'farming money');
      return `₽${have.toLocaleString()} of ₽${(+g.target).toLocaleString()} · ${best.name}${rate ? ` · ~₽${Math.round(rate).toLocaleString()}/h, about ${Math.max(0, Math.ceil((g.target - have) / Math.max(1, rate)))} h to go` : ''}${berry}`;
    },
    finish(g) {
      const r = g.restore; if (!r) return;
      const back = (r.team || []).filter((u) => E.read('Game.getMon', null, u)); if (back.length) setChapterTeam(back);
      putBack(g);
    },
  };

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
        const have = Plan.goals.find((x) => !x.done && ((['legend', 'wild', 'special', 'breed'].includes(x.type)) && x.foe === id || (x.type === 'level' && x.forDex === id) || (x.type === 'loot' && x.item === 'egg:' + id)));
        if (!have) {
          if (r.kind === 'legend') { Plan.insertAfter(g.id, 'legend', { foe: id, parent: g.id }); added++; }
          if (r.kind === 'wild') { Plan.insertAfter(g.id, 'wild', { foe: id, ch: r.ch, parent: g.id }); added++; }
          if (r.kind === 'evolve') { Plan.insertAfter(g.id, 'level', { uids: [r.uid], target: r.level, forDex: id, parent: g.id }); added++; }
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

  // ---- elite legendaries: beat a legendary's elite tiers, one after another ----------------------
  // The game retries a lost fight by itself ("try 2…"); a loss can also lock that legendary's elite
  // fights for ELITE.FREEZE_MS - the goal then waits. Team: the elite simulator per tier (EliteSim).
  const eliteBusy = new Set();
  const LZ = () => E.get('LegendZones');
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
      const sim = EliteSim.get(`L${g.foe}:${next}`);
      if (!sim) { eliteBusy.add(`L${g.foe}:${next}`); EliteSim.legend(g.foe, next).then((r) => Log.add(`${name(g.foe)} elite tier ${next}: best team ${Math.round(r.ko * 100)}%`)).catch((e) => Log.add(`elite sim failed: ${e?.message || e}`)).finally(() => eliteBusy.delete(`L${g.foe}:${next}`)); return { state: 'wait', why: `simulating tier ${next}…` }; }
      if (sim.ko < 0.03 && !g.force) return { state: 'wait', why: `tier ${next} looks too strong for now (best team ${Math.round(sim.ko * 100)}%) - rank up / level, or press ▶ to try anyway` };
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
      const sim = EliteSim.get(`L${g.foe}:${next}`);
      if (!inIt) {
        if (a.zone) { try { E.call('Adventure.leaveZone'); } catch (__e) { __h('70-plan:1458', __e); } return 'leaving the current zone…'; }
        if (sim?.uids?.length) { const zt = E.read('Game.zoneTeam', [], g.foe) || []; if (!(zt.length === sim.uids.length && sim.uids.every((u, i) => zt[i] === u))) { const r = setTeam(g.foe, sim.uids); if (!r.ok) return 'waiting: ' + r.why; } }
        if (Date.now() - (g.enterAt || 0) < 15_000) return 'entering…';
        g.enterAt = Date.now();
        { const zt = E.read('Game.zoneTeam', [], g.foe) || []; const why = Guard.team(zt, { need: Math.min(6, sim?.uids?.length || 1), want: sim?.uids || null, minLevel: 50 }); if (why) return Guard.stop(`${name(g.foe)} elite tier ${next}`, why); }
        let ok = false; try { ok = E.call('Adventure.startZone', g.foe, next) !== false; } catch (__e) { __h('70-plan:1463', __e); }
        try { E.call('App.refresh'); } catch (__e) { __h('70-plan:1464', __e); }
        if (ok) Log.add(`${name(g.foe)}: started elite tier ${next}${sim ? ` (sim ${Math.round(sim.ko * 100)}%)` : ''}`);
        return ok ? `started elite tier ${next}` : `the game would not start tier ${next}`;
      }
      const tries = +(a.zone?.tries || 1);
      return `elite tier ${next} vs ${name(a.zone?.foe || g.foe)} · try ${tries}${sim ? ` · sim ${Math.round(sim.ko * 100)}%` : ''}`;
    },
    finish(g) { const a = S().adv || {}; if (+(a.zone?.id) === +g.foe && a.zone?.elite) { try { E.call('Adventure.leaveZone'); } catch (__e) { __h('70-plan:1471', __e); } } },
  };

  // ---- Elite League: a region's Elite Four + Champion, tiers 1-5 ---------------------------------
  const league = {
    uses: 'screen',
    label: (g) => `Elite League ${(E.get('STORY.REGIONS') || []).find((r) => r.key === g.reg)?.name || g.reg} up to tier ${g.upTo || 5}`,
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
      if (inIt && (g.lost?.[next] || 0) >= 10 && !g.force) { try { E.call('Adventure.leaveLeague'); } catch (__e) { __h('70-plan:1501', __e); } Log.add(`Elite League ${g.reg}: tier ${next} lost 10 times - stepping back`); Notify.send('problem', `Elite League tier ${next} is too strong for now`, 'Lost 10 times in a row - level or rank up your team, then press ▶ on the goal'); return 'stepped back after 10 losses'; }
      if (g.force && best > (g.forceAt ?? -1)) { g.force = false; g.forceAt = best; }
      const sim = EliteSim.get(`G${g.reg}:${next}`) || EliteSim.leagueTeam(g.reg, next);
      if (!inIt) {
        if (a.zone) { try { E.call('Adventure.leaveZone'); } catch (__e) { __h('70-plan:1505', __e); } return 'leaving the current zone…'; }
        if (a.league) { try { E.call('Adventure.leaveLeague'); } catch (__e) { __h('70-plan:1506', __e); } return 'leaving the other League run…'; }
        if (!g.restore) { g.restore = { team: [...(S().team || [])], chapter: a.chapter }; Plan.save(); }
        if (sim?.uids?.length) { const cur = S().team || []; if (!(cur.length === sim.uids.length && sim.uids.every((u) => cur.includes(u)))) setChapterTeam(sim.uids); }
        if (Date.now() - (g.enterAt || 0) < 15_000) return 'starting…';
        g.enterAt = Date.now();
        { const why = Guard.team(S().team || [], { need: Math.min(6, sim?.uids?.length || 1), want: sim?.uids || null, minLevel: 50 }); if (why) return Guard.stop(`Elite League ${g.reg} tier ${next}`, why); }
        let ok = false; try { ok = E.call('Adventure.startLeague', g.reg, next) !== false; } catch (__e) { __h('70-plan:1512', __e); }
        try { E.call('App.refresh'); } catch (__e) { __h('70-plan:1513', __e); }
        if (ok) Log.add(`Elite League ${g.reg}: started tier ${next} with ${sim.uids.map((u) => name(E.read('Game.getMon', {}, u)?.id)).join(', ')}`);
        return ok ? `started tier ${next}` : `the game would not start tier ${next}`;
      }
      const at = +a.node || 0, n = (a.nodes || []).length;
      return `Elite League tier ${next} · stop ${at + 1} of ${n || '?'} · try ${+(a.league?.tries || 1)}`;
    },
    finish(g) { const a = S().adv || {}; if (a.league?.reg === g.reg) { try { E.call('Adventure.leaveLeague'); } catch (__e) { __h('70-plan:1520', __e); } } const r = g.restore; if (r?.team?.length) setChapterTeam(r.team.filter((u) => E.read('Game.getMon', null, u))); },
  };

  // ---- World Boss: 3 attacks a day while its shield is up, then the capture window ----------------
  // Attacks: the game's own pick (WorldBoss.autoTeam: your strongest that haven't attacked today) and
  // its own server call (WorldBoss.attack). Capture: its zone, like a legendary (Golden Razz on).
  const wboss = {
    uses: 'screen', daily: true,
    label: () => 'World Boss (every edition)',
    sprite: () => (LZ()?.ZONES || []).find((z) => z.wb)?.id || null,
    check(g) {
      const W = E.get('WorldBoss'); if (!W) return { state: 'wait', why: 'not in this game version' };
      if (!W.open()) return { state: 'wait', why: 'opens once you beat the Sinnoh League' };
      let st = {}; try { st = W.state() || {}; } catch (__e) { __h('70-plan:1533', __e); }
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
        try { E.call('Game.save'); } catch (__e) { __h('70-plan:1548', __e); } try { E.call('App.refresh'); } catch (__e) { __h('70-plan:1548', __e); }
        const dmg = r?.dmg ?? r?.damage ?? null;
        Log.add(`World Boss: attacked with ${team.map((m) => name(m.id)).join(', ')}${dmg ? ` - ${(+dmg).toLocaleString()} damage` : ''} (${W.left()} left today)`);
        if (!W.left()) Notify.send('daily', 'World Boss: today\'s attacks done', `${Math.round((W.state()?.pct ?? 0) * 100)}% of its shield left`);
        return `attacked (${W.left()} left today)`;
      }
      if (st.phase === 'capture') {
        const z = (LZ()?.ZONES || []).find((x) => x.wb); if (!z) return 'waiting: no World Boss zone in the data';
        if (!g.told || g.told !== st.n) { g.told = st.n; Plan.save(); Notify.send('win', 'World Boss is down - catching it!', `Capture window until ${DexInfo.clock(st.captureEnd)}`); }
        return legend.step({ ...g, foe: z.id }, ctx); // same as catching a legendary (team from the simulator, Golden Razz)
      }
      return 'waiting';
    },
  };

  // ---- idle leveling: what Mega trains when every goal is done or waiting ----
  // Jimmy's order: Pokémon that took a gem (ranked up - they went back to Lv 5) first, then shinies,
  // then the ones closest to Lv 100. Only below their level cap, in the PC (not the Underground /
  // Day Care). Four at a time; the level goal adds two carriers and picks the chapter.
  function idlePick(n = 4) {
    const away = new Set((E.read('Game.underMons', []) || []).map((m) => m.uid));
    return (S().mons || [])
      .filter((m) => !away.has(m.uid) && m.level < capOf(m.uid))
      .sort((a, b) => ((b.rank || 0) > 0) - ((a.rank || 0) > 0) || (!!b.shiny - !!a.shiny) || b.level - a.level)
      .slice(0, n).map((m) => m.uid);
  }
  return { story, shinyWays, shinyWild, shinyBreed, ownsShinyId, raidRepick, setChapterTeam, here, idlePick, elite, league, wboss, legend, level, under, wild, special, souls, loot, breed, candy, tower, raid, money, region, hatchMissing, holder, setTeam, bestChapter, reserved, regionMissing, wildChapters };
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

  function load() {
    let p;
    try { p = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (__e) { __h('70-plan:1595', __e); }
    p = p && Array.isArray(p.goals) ? p : { running: false, goals: [] };
    // 0.3.x: a running hunt becomes the first goal
    try {
      const h = JSON.parse(localStorage.getItem('mega-hunt') || 'null');
      if (h && h.target && !p.goals.some((g) => g.type === 'legend' && g.foe === h.target)) { p.goals.unshift(newGoal('legend', { foe: h.target })); p.running = true; }
      localStorage.removeItem('mega-hunt');
    } catch (__e) { __h('70-plan:1602', __e); }
    return p;
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (__e) { __h('70-plan:1605', __e); } }
  function newGoal(type, data) { return { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), type, ...data, paused: false, done: null, added: Date.now() }; }

  const type = (g) => GoalTypes[g.type];
  const name = (g) => { const l = type(g) ? type(g).label(g) : g.type; try { return Casing.title(l); } catch { return l; } };

  function add(t, data) {
    if (['shinyWild', 'shinyBreed'].includes(t) && st.goals.some((g) => ['shinyWild', 'shinyBreed'].includes(g.type) && (g.target || g.foe) === +(data.target || data.foe) && !g.done)) return false;
    if (t === 'legend' && st.goals.some((g) => g.type === 'legend' && g.foe === +data.foe && !g.done)) return false;
    if (t === 'under' && st.goals.some((g) => g.type === 'under' && !g.done)) return false;
    if (['candy', 'tower', 'raid', 'money'].includes(t) && st.goals.some((g) => g.type === t && !g.done)) return false;
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
    const g = newGoal(t, data), i = st.goals.findIndex((x) => x.id === id);
    st.goals.splice(i < 0 ? st.goals.length : i, 0, g); save();
    Log.add(`added to the plan: ${name(g)}`);
    return g;
  }
  function insertAfter(id, t, data) {
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
  function remove(id) { const g = st.goals.find((x) => x.id === id); if (g && !g.done) { finish(g); try { Chains.forget(g); } catch (__e) { __h('70-plan:1646', __e); } } st.goals = st.goals.filter((x) => x.id !== id); save(); if (g) Log.add(`removed from the plan: ${name(g)}`); }
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
  function pause(id) { const g = st.goals.find((x) => x.id === id); if (g) { g.paused = !g.paused; save(); Log.add(`${g.paused ? 'paused' : 'resumed'}: ${name(g)}`); } }
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
    try { E.call('App.refresh'); } catch (__e) { __h('70-plan:1681', __e); }
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
      const order = [...st.goals.filter((g) => type(g)?.daily), ...st.goals.filter((g) => !type(g)?.daily)];
      for (const g of order) {
        if (g.done) continue;
        const T = type(g);
        if (!T) { live[g.id] = { state: 'wait', why: 'unknown goal type' }; continue; }
        const c = (() => { try { return T.check(g); } catch (e) { Health.goalErr(g, e, name(g)); return { state: 'wait', why: 'error: ' + (e?.message || e) }; } })();
        if (c.state === 'done') { g.done = Date.now(); save(); Log.add(`done: ${name(g)}`); finish(g);
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
      const h = GoalTypes.holder();
      let runs = st.goals.filter((g) => !g.done && live[g.id]?.state === 'ready');
      const own = (x) => (/Candy/.test(h || '') && x.type === 'candy') || (/Tower/.test(h || '') && x.type === 'tower') || (/Raid/.test(h || '') && x.type === 'raid');
      if (h) { for (const g of runs.filter((x) => type(x).uses === 'screen' && !own(x))) live[g.id] = { state: 'wait', why: `${h} is using the battle screen` }; runs = runs.filter((x) => type(x).uses !== 'screen' || own(x)); }
      const screenRuns = runs.some((g) => type(g).uses === 'screen');
      // a real goal wants the screen: end the idle job first (team, buddy, loop and chapter go back)
      if ((screenRuns || h) && st.idle) await idleStop(screenRuns ? 'a goal is ready' : `${h} started`);
      for (const g of runs) {
        // a goal that waited a while (weather, time of day, a zone, a chapter) is finally going: tell Jimmy once
        const ws = waitSince.get(g.id);
        if (ws && Date.now() - ws.at > 30 * 60_000) { Log.add(`started: ${name(g)} (was waiting: ${ws.why || 'its conditions'})`); Notify.send('daily', `Started: ${name(g)}`, `It was waiting ${Math.round((Date.now() - ws.at) / 3_600_000 * 10) / 10} h: ${ws.why || 'its conditions'}`); }
        waitSince.delete(g.id);
        try { live[g.id].line = await type(g).step(g, ctx); live[g.id].state = 'running'; Health.goalOk(g); live[g.id].team = teamInfo(g); }
        catch (e) { live[g.id] = { state: 'wait', why: 'error: ' + (e?.message || e) }; Log.add(`${name(g)}: error - ${e?.message || e}`); Health.goalErr(g, e, name(g)); }
      }
      // idle only after 2 min with no screen goal, so a goal that waits a moment between runs doesn't flip-flop
      if (screenRuns || h) freeSince = 0; else if (!freeSince) freeSince = Date.now();
      if (!screenRuns && !h && idleOn() && (st.idle || Date.now() - freeSince > 120_000)) { await idleStep(); top = (runs.length ? `running: ${runs.map(name).join(' + ')} · ` : '') + `idle: ${idleLine || 'leveling'}`; return; }
      if (!runs.length) { top = h ? `waiting: ${h} is using the battle screen` : st.goals.some((g) => !g.done) ? 'every goal is waiting - see the reasons below' : 'nothing to do - add a goal'; return; }
      top = `running: ${runs.map(name).join(' + ')}`;
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
      else if (g.type === 'story') { win = g.planWin ?? g.nowWin ?? null; how = "the game's own gym estimate"; }
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
    try { GoalTypes.level.finish(g); } catch (__e) { __h('70-plan:1786', __e); }
    st.idle = null; delete live.idle; save();
    Log.add(`idle leveling stopped: ${why}`);
  }
  // nothing to level: keep the current chapter looping so the game can't move on to new story chapters
  function idlePark() {
    const ch = +(E.get('Game.S')?.adv?.chapter);
    if (Number.isFinite(ch) && !E.read('Adventure.isLooping', false, ch)) { try { E.call('Adventure.toggleLoop', ch); Log.add('plan idle: looping the current chapter so the story doesn\'t move on'); } catch (__e) { __h('70-plan:1793', __e); } }
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
    } catch (__e) { __h('70-plan:1816', __e); }
    storyPlace();
  }
  // the story goal sits right after the daily screen jobs (Shiny Raid, Candy Factory, Battle Tower, World
  // Boss): they run when due, and the story - always ready - would block them if it were above them
  function storyPlace() {
    try {
      const open = Plan.goals.filter((g) => !g.done), si = open.findIndex((g) => g.type === 'story');
      if (si < 0) return;
      const daily = ['raid', 'candy', 'tower', 'wboss'];
      let last = -1; open.forEach((g, i) => { if (daily.includes(g.type)) last = i; });
      if (si > last) return; // already below every daily (wherever you put it) - leave it
      const want = last;
      const id = open[si].id;
      for (let n = 0; n < 60; n++) { const cur = Plan.goals.filter((g) => !g.done).findIndex((g) => g.id === id); if (cur === want) break; Plan.move(id, cur < want ? 1 : -1); }
    } catch (__e) { __h('70-plan:1831', __e); }
  }
  function formGoals() {
    try {
      for (const z of Legends.list()) {
        if (!z.forms || z.allForms || z.state === 'locked' || z.state === 'sealed') continue;
        const key = 'mega-formgoal-' + z.id; if (localStorage.getItem(key)) continue;
        if (!Plan.goals.some((g) => g.type === 'legend' && g.foe === z.id && !g.done)) { Plan.add('legend', { foe: z.id, forms: true }); Log.add(`added "Catch every ${z.name} form" - a new form appears each week until you have all ${z.forms.length}`); }
        localStorage.setItem(key, '1');
      }
    } catch (__e) { __h('70-plan:1841', __e); }
  }
  function boot() {
    setTimeout(formGoals, 20_000); setInterval(storyGoal, 60_000); setTimeout(storyGoal, 25_000);
    if (timer) return;
    timer = setInterval(tick, 3000); setTimeout(tick, 1500);
    Recorder.onFight((f) => { if (st.goals.some((g) => g.type === 'legend' && g.foe === f.foeId && !g.done)) Log.add(`${E.get('Game.DEX')?.[f.foeId]?.name} fight: ${f.outcome === 'ko' ? 'KO' : f.outcome}`); });
  }
  return {
    boot, add, insertBefore, insertAfter, save, remove, move, toTop, pause, retry, clearDone, setRunning, oldOn, turnOldOff,
    get goals() { return st.goals; }, get running() { return st.running; }, get top() { return top; },
    live: (id) => live[id] || null, label: name,
    get idle() { return st.idle ? { goal: st.idle, line: live.idle?.line || idleLine } : (live.idle ? { goal: null, line: live.idle.line } : null); },
    get idleOn() { return idleOn(); }, setIdle(v) { st.idleLevel = !!v; save(); if (!v && st.idle) idleStop('switched off'); },
    has: (foe) => st.goals.find((g) => g.type === 'legend' && g.foe === +foe && !g.done) || null,
    hasType: (t) => st.goals.find((g) => g.type === t && !g.done) || null,
  };
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
 *           daily (raid / factory / tower / Underground results)  ·  problem (Mega is stuck)
 * Quiet hours (11 PM - 8 AM) hold everything but problems. The same alert isn't repeated within 6 h.
 * Milestones are found by comparing the save every 10 s (dex, shinies, Lv 100, badges).
 * ------------------------------------------------------------------------------------------- */
const Notify = (() => {
  const E = Engine;
  const KEY = 'mega-notify', MS = 'mega-ms';
  const KINDS = { win: 'Big wins (legendaries, shinies, goals done)', dex: 'New Pokédex entries and Lv 100s', daily: 'Daily results (raid, factory, tower, Underground)', problem: 'Problems (Mega is stuck and needs you)', egg: 'Day Care: an egg is ready to hatch', trade: 'Trades: a Pokémon you\'re missing, for a spare you have' };
  const newTopic = () => 'mega-alakazam-' + Array.from(crypto.getRandomValues(new Uint8Array(9))).map((n) => 'abcdefghijkmnpqrstuvwxyz23456789'[n % 32]).join('');
  let cfg = (() => {
    let c = null; try { c = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (__e) { __h('75-notify:15', __e); }
    if (!c) { // first time: take over 4.x's topic so the phone that already gets alerts keeps getting them
      let old = {}; try { old = JSON.parse(localStorage.getItem('pc-helper-cfg') || '{}'); } catch (__e) { __h('75-notify:17', __e); }
      c = { on: !!old.pushTopic, topic: old.pushTopic || '', kinds: { win: true, dex: true, daily: true, problem: true }, quiet: !!old.pushQuiet, last: null };
    }
    return c;
  })();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (__e) { __h('75-notify:22', __e); } };
  const seen = new Map();
  const clean = (t) => { const v = String(t || '').replace(/\s+/g, ' ').trim(); try { return Casing.names(v); } catch { return v; } };

  // Alerts through Mega Relay (Web Push to the phone's Home Screen app - no ntfy, no limit) when
  // the relay is on and at least one phone turned alerts on there; ntfy is the backup.
  let viaRelay = null; // { at, ok, subs, err }
  async function relaySend(kind, title, body) {
    let on = false; try { on = Remote.info?.relay; } catch (__e) { __h('75-notify:30', __e); }
    if (!on) return false;
    try {
      const r = await fetch('http://127.0.0.1:8787/push/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: clean(title).slice(0, 110), body: clean(body).slice(0, 380), tag: kind, urgent: kind === 'problem' }) });
      if (!r.ok) throw new Error('Mega Relay said ' + r.status);
      const j = await r.json(); viaRelay = { at: Date.now(), ok: j.sent > 0, subs: j.subs, err: j.err };
      return j.sent > 0;
    } catch (e) { viaRelay = { at: Date.now(), ok: false, subs: viaRelay?.subs ?? null, err: e.message }; return false; }
  }
  async function send(kind, title, body, force = false) {
    let relayOn = false; try { relayOn = !!Remote.info?.relay; } catch (__e) { __h('75-notify:40', __e); }
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
  function snap() {
    const S = E.get('Game.S') || {}, mons = E.read('Game.allMons', []) || [];
    return { dex: Object.keys(S.dex || {}).map(Number), shiny: mons.filter((m) => m.shiny).map((m) => m.uid), l100: mons.filter((m) => m.level >= 100).map((m) => m.uid), badges: (S.adv?.badges || []).length };
  }
  let last = (() => { try { return JSON.parse(localStorage.getItem(MS) || 'null'); } catch { return null; } })();
  function milestones() {
    if (!E.ready()) return;
    // Remember everything ever seen (never forget): Pokémon away on an activity (Underground,
    // Day Care…) drop out of the list and come back later - that's not a new shiny or a new Lv 100.
    const cur = snap(), union = (a, b) => [...new Set([...(a || []), ...(b || [])])];
    const keep = () => { last = { dex: union(cur.dex, last?.dex), shiny: union(cur.shiny, last?.shiny), l100: union(cur.l100, last?.l100), badges: Math.max(cur.badges, last?.badges || 0), v: 2 }; try { localStorage.setItem(MS, JSON.stringify(last)); } catch (__e) { __h('75-notify:74', __e); } };
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
      check('g' + g.id, /error|could not|refused|3 times|did not/i.test((L.why || '') + ' ' + (L.line || '')), `Mega: ${Plan.label(g)} is stuck`, L.why || L.line || 'see the log');
    }
    const a = E.audit(); check('engine', a.missing?.length, 'Mega lost part of the game', `${a.missing.length} game functions are missing after a game update - Mega may not work right`);
  }

  let timer = null;
  function boot() { if (timer) return; timer = setInterval(() => { try { milestones(); } catch (__e) { __h('75-notify:108', __e); } try { problems(); } catch (__e) { __h('75-notify:108', __e); } }, 10_000); }
  return {
    boot, send, KINDS,
    get cfg() { return cfg; },
    get viaRelay() { return viaRelay; },
    set(k, v) { cfg[k] = v; save(); },
    setKind(k, v) { cfg.kinds[k] = !!v; save(); },
    newTopic() { cfg.topic = newTopic(); save(); return cfg.topic; },
    test: () => send('win', 'Mega Alakazam test', 'Phone alerts work! You\'ll get wins, Pokédex entries, daily results and problems here.', true),
  };
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
    try { const r = await fetch(API + name + '?ref=main', { headers: { Accept: 'application/vnd.github.raw' }, cache: 'no-store' }); if (r.ok) return await r.text(); } catch (__e) { __h('79-update:14', __e); }
    const r = await fetch(raw + '?t=' + Date.now(), { cache: 'no-store' }); if (!r.ok) throw new Error('GitHub said ' + r.status); return await r.text();
  }
  let latest = null, checkedAt = 0, err = null, got = null;
  try { const v = localStorage.getItem('mega-next-ver'); if (v && localStorage.getItem('mega-next-code')) got = v; } catch (__e) { __h('79-update:18', __e); }
  // download the new version itself, so a plain reload runs it (see the header). Kept only if it's
  // really that version, and only while the page's storage has room - the game save always comes first.
  async function download(v) {
    if (got === v) return true;
    if (localStorage.getItem('mega-next-bad') === v) { err = `${v} failed its self-test and was rolled back - waiting for the next version`; return false; }
    try {
      const code = await getFile('mega-alakazam.user.js', SCRIPT);
      if (code.length < 100_000 || !new RegExp('@version\\s+' + v.replace(/\./g, '\\.') + '\\s').test(code) || !code.includes('window.__MEGA_HOT_OK')) return false;
      let used = 0; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (!/^mega-next-/.test(k)) used += k.length + (localStorage.getItem(k) || '').length; }
      if (used + code.length > 1_800_000) { err = 'not enough room in the page storage to keep the update'; return false; }
      // keep the version running now (if it came this way) so a bad update can go back to it
      if (window.__MEGA_HOT === VERSION) { const cur = localStorage.getItem('mega-next-code'); if (cur && localStorage.getItem('mega-next-ver') === VERSION) { try { localStorage.setItem('mega-prev-code', cur); localStorage.setItem('mega-prev-ver', VERSION); } catch { localStorage.removeItem('mega-prev-code'); localStorage.removeItem('mega-prev-ver'); } } }
      localStorage.setItem('mega-next-code', code); localStorage.setItem('mega-next-ver', v);
      localStorage.setItem('mega-next-try', '0'); localStorage.removeItem('mega-next-bad');
      got = v; return true;
    } catch (e) { try { localStorage.removeItem('mega-next-code'); localStorage.removeItem('mega-next-ver'); } catch (__e) { __h('79-update:34', __e); } err = 'could not keep the update: ' + (e?.message || e); return false; }
  }
  const parts = (v) => String(v).split('.').map((x) => +x || 0);
  const newer = (a, b) => { const x = parts(a), y = parts(b); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };
  async function check() {
    try {
      const m = (await getFile('mega-alakazam.meta.js', META)).match(/@version\s+(\S+)/);
      if (m) { const was = latest; latest = m[1]; err = null; if (newer(latest, VERSION)) { await download(latest); if (latest !== was) { try { Log.add(`New Update ${latest} is ready${got === latest ? ' - it runs on the next reload' : ''}`); } catch (__e) { __h('79-update:41', __e); } try { UI.refresh?.(); } catch (__e) { __h('79-update:41', __e); } } } }
    } catch (e) { err = e?.message || String(e); }
    checkedAt = Date.now();
  }
  // Auto-reload: Tampermonkey installs updates on its own (its update interval), but a running tab keeps
  // the old code until it reloads. When GitHub has a newer version, Mega reloads the tab at a safe moment
  // (not inside a legendary zone, Battle Tower, league or raid) - once per 30 minutes per version, 4 tries
  // at most; after that it just shows the gold button. After a reload that worked, the log says so.
  const KEY = 'mega-upd-reload';
  const memo = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { return {}; } };
  const keep = (m) => { try { localStorage.setItem(KEY, JSON.stringify(m)); } catch (__e) { __h('79-update:51', __e); } };
  function safe() {
    try {
      const a = E.get('Game.S')?.adv || {};
      if (a.zone || a.tower || a.league || a.event) return false;
      const busy = (Plan.goals || []).some((g) => !g.done && Plan.live(g.id)?.state === 'running' && ['raid', 'elite', 'league', 'wboss', 'legend', 'candy', 'tower', 'trade'].includes(g.type));
      return !busy;
    } catch { return false; }
  }
  function autoReload() {
    const v = Updater.available; if (!v || got !== v || autoOn() === false) return;
    const m = memo(), r = m[v] || { tries: 0, at: 0 };
    if (r.tries >= 4 || Date.now() - r.at < 30 * 60_000 || !safe()) return;
    m[v] = { tries: r.tries + 1, at: Date.now() }; keep(m);
    try { Log.add(`reloading the game to pick up Mega ${v} (try ${r.tries + 1} of 4)`); } catch (__e) { __h('79-update:65', __e); }
    try { E.call('Game.save'); } catch (__e) { __h('79-update:66', __e); }
    setTimeout(() => location.reload(), 1500);
  }
  const autoOn = () => { try { return JSON.parse(localStorage.getItem('mega-upd-auto') ?? 'true'); } catch { return true; } };
  function setAuto(on) { try { localStorage.setItem('mega-upd-auto', JSON.stringify(!!on)); } catch (__e) { __h('79-update:70', __e); } }
  function afterLoad() {
    const m = memo(), mine = m[VERSION];
    if (mine && !mine.done) { m[VERSION] = { ...mine, done: true }; keep(m); try { Log.add(`updated to Mega ${VERSION}`); } catch (__e) { __h('79-update:73', __e); } }
    // first run of this version: self-test once the game is up; a failure rolls back to the version before
    if (localStorage.getItem('mega-tested-ver') !== VERSION) setTimeout(firstTest, 90_000);
  }
  async function firstTest() {
    if (!Engine.ready()) { setTimeout(firstTest, 30_000); return; }
    let r = null; try { r = await Health.selfTest('first run of ' + VERSION); } catch (e) { r = { failed: 1, results: [{ name: 'self-test', detail: String(e?.message || e) }] }; }
    if (!r.failed) { localStorage.setItem('mega-tested-ver', VERSION); return; }
    const why = (r.results || []).filter((x) => !x.warn).slice(0, 2).map((x) => `${x.name}: ${x.detail}`).join(' | ');
    if (window.__MEGA_HOT !== VERSION) { // installed through Tampermonkey: nothing to go back to here - just tell you
      try { Notify.send('problem', `Mega ${VERSION} failed its self-test`, `${r.failed} check(s) failed: ${why}. It keeps running; tell Claude.`); } catch (__e) { __h('79-update:83', __e); }
      localStorage.setItem('mega-tested-ver', VERSION); return;
    }
    const pv = localStorage.getItem('mega-prev-ver'), pc = localStorage.getItem('mega-prev-code');
    localStorage.setItem('mega-next-bad', VERSION);
    if (pv && pc && pv !== VERSION) { localStorage.setItem('mega-next-code', pc); localStorage.setItem('mega-next-ver', pv); localStorage.setItem('mega-next-try', '0'); }
    else { localStorage.removeItem('mega-next-code'); localStorage.removeItem('mega-next-ver'); }
    try { Log.add(`rolling back: Mega ${VERSION} failed its self-test (${why}) - going back to ${pv || 'the Tampermonkey copy'}`); } catch (__e) { __h('79-update:90', __e); }
    try { Notify.send('problem', `Mega ${VERSION} rolled back`, `It failed its self-test (${why}), so Mega went back to ${pv || 'the Tampermonkey copy'} by itself. Tell Claude.`); } catch (__e) { __h('79-update:91', __e); }
    reloadNow('reloading into the version before');
  }
  const E = Engine;
  // After a reload the game waits on its title screen: press its own Continue button (only that one,
  // only on the title screen). "Two saves found" is never touched - it sends a Needs You alert instead.
  const contOn = () => { try { return JSON.parse(localStorage.getItem('mega-auto-continue') ?? 'true'); } catch { return true; } };
  function setContinue(on) { try { localStorage.setItem('mega-auto-continue', JSON.stringify(!!on)); } catch (__e) { __h('79-update:98', __e); } }
  function autoContinue() {
    const t0 = Date.now(); let pressed = false, warned = false;
    const tick = () => {
      if (Date.now() - t0 > 120_000) return;
      try {
        const txt = document.body?.innerText || '';
        if (/two saves|deux sauvegardes/i.test(txt)) {
          if (!warned) { warned = true; try { Log.add('the game is asking which save to keep - Mega leaves that to you'); Notify.send('problem', 'Poke\'Catch needs you', 'The game is asking which save to keep (Two saves found). Mega won\'t choose - open the game and pick.'); } catch (__e) { __h('79-update:106', __e); } }
          return setTimeout(tick, 2000);
        }
        if (!pressed && contOn() && document.body?.classList.contains('titled')) {
          const b = [...document.querySelectorAll('.title-fx .ti-go')].find((x) => /^\s*(continue|continuer)\s*$/i.test(x.textContent || ''));
          if (b && !document.querySelector('.modal:not([hidden])')) { pressed = true; b.click(); try { Log.add('pressed Continue on the title screen'); } catch (__e) { __h('79-update:111', __e); } }
        }
        if (pressed && !document.body?.classList.contains('titled')) return;
      } catch (__e) { __h('79-update:114', __e); }
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
    try { window.open(SCRIPT + '?v=' + encodeURIComponent(latest || ''), '_blank'); } catch (__e) { __h('79-update:125', __e); }
    const back = () => { if (document.visibilityState !== 'visible') return; document.removeEventListener('visibilitychange', back); window.removeEventListener('focus', back); reloadNow(`reloading the game to run Mega ${latest}`); };
    setTimeout(() => { document.addEventListener('visibilitychange', back); window.addEventListener('focus', back); }, 800);
  }
  function reloadNow(why) { try { Log.add(why || 'reloading the game'); } catch (__e) { __h('79-update:129', __e); } try { E.call('Game.save'); } catch (__e) { __h('79-update:129', __e); } setTimeout(() => location.reload(), 1500); }
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
  async function seal(obj) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(), await gz(new TextEncoder().encode(JSON.stringify(obj)), 'c'));
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
  if (cfg.ably) { delete cfg.ably; try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (__e) { __h('80-remote:47', __e); } } // Ably is gone: forget the old key
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
    const goals = Plan.goals.filter((g) => !g.done).map((g) => { const L = Plan.live(g.id) || {}; let sp = null; try { sp = GoalTypes[g.type]?.sprite?.(g) || null; } catch (__e) { __h('80-remote:77', __e); } return { id: g.id, t: g.type, l: Casing.names(Plan.label(g)), s: g.paused ? 'paused' : L.state || 'wait', y: Casing.names(L.why || ''), n: Casing.names(L.line || ''), sp, p: prog(g), bg: GoalTypes[g.type]?.uses === 'background' ? 1 : 0, d: GoalTypes[g.type]?.daily ? 1 : 0, tm: L.team ? [(L.team.uids || []).map((u) => { const m = E.read('Game.getMon', null, u); return m ? [m.id, m.level] : null; }).filter(Boolean), L.team.win, L.team.how || ''] : null }; });
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
    } catch (__e) { __h('80-remote:90', __e); }
    const dex = (w.regions || []).filter((r) => r.open && r.dex).map((r) => { const ids = DexInfo.regionIds(r.key); return [r.name || r.key, ids.filter((id) => World.dex.registered(id)).length, ids.length, r.key]; });
    const td = Trades.data;
    const trades = td && !td.failed ? { at: td.at, t: (td.targets || []).map((t) => [t.id, t.shiny ? 1 : 0, (t.list || []).length, t.can || 0, t.newGet ? 1 : 0, t.newTo ? t.to : 0, t.best]) } : null;
    let gems = null; try { const g = EliteInfo.gems(); gems = { total: g.total, top: g.top.map((c) => [c.m.id, c.gain, c.label, c.need, c.m.rank || 0, c.m.shiny ? 1 : 0, c.bst, c.m.uid, c.key, c.m.level, (() => { try { return EliteInfo.canEvolve(c.m.id) ? 1 : 0; } catch { return 0; } })()]) }; } catch (__e) { __h('80-remote:94', __e); }
    const idle = Plan.idle ? { l: Casing.names(Plan.idle.line || ''), u: (Plan.idle.goal?.uids || []).map((u) => E.read('Game.getMon', null, u)).filter(Boolean).map((m) => [m.id, m.level, m.rank || 0, m.shiny ? 1 : 0]) } : null;
    for (const [k, r] of Object.entries(replies)) if (Date.now() - r.at > 10 * 60_000) delete replies[k];
    // names for every Pokémon the phone will show (trades, gems, team, idle, goal pictures)
    const ids = new Set([...team.map((x) => x[0]), ...(trades?.t || []).flatMap((x) => [x[0], x[5]]), ...(gems?.top || []).map((x) => x[0]), ...(idle?.u || []).map((x) => x[0]), ...goals.map((g) => g.sp)].filter(Boolean));
    try { for (const e of DayCare.info().eggs) ids.add(e.id); for (const m of DayCare.info().mons) ids.add(m.id); } catch (__e) { __h('80-remote:99', __e); }
    const nm = Object.fromEntries([...ids].map((id) => [id, D[id]?.name || '#' + id]));
    return {
      v: 1, at: Date.now(), ver: VERSION, run: Plan.running, top: Casing.names(Plan.top || ''), old: Plan.oldOn() ? 1 : 0,
      nm, goals, done, idle, tabs: (() => { try { return JSON.parse(localStorage.getItem('mega-alakazam-ui') || '{}').tabOrder || null; } catch { return null; } })(), theme: (() => { try { return JSON.parse(localStorage.getItem('mega-alakazam-ui') || '{}').theme || 'auto'; } catch { return 'auto'; } })(), where: Casing.names(where), foes, team, today, money: History.homeMoney(), side: History.sideMoney(), dex, trades, gems,
      log: (Log.lines || []).slice(-15).map((l) => [l.at, Casing.names(l.text)]),
      set: { berries: Berries.on, idle: Plan.idleOn, alerts: !!Notify.cfg.on },
      gemPick: (() => { try { return (E.get('LegendZones')?.leaguePending?.() || []).map((p) => [p.reg, p.tier]); } catch { return []; } })(),
      wb: Plan.hasType('wboss') ? 1 : 0,
      myTrade: (() => { try { return Trades.myOffer(); } catch { return null; } })(),
      leagues: (() => { try { return storyLeagues().map((r) => [r.key, r.name, r.inPlan ? 1 : 0]); } catch { return []; } })(), ver: VERSION, upd: (() => { try { return Updater.available; } catch { return null; } })(),
      guard: (() => { try { return Guard.failures().map((f) => `${f.label}: ${f.why}`); } catch { return []; } })(),
      dc: (() => { try { const d = DayCare.info(); return { e: d.eggs.map((e) => [e.id, e.left, e.ready ? 1 : 0, e.shinyParent ? 1 : 0, e.hatchAt - e.laidAt, e.uid]), m: d.mons.map((m) => [m.id, m.level, m.shiny ? 1 : 0]), u: d.used, x: d.max, f: d.full ? 1 : 0, n: d.nextEgg }; } catch { return null; } })(),
      acks: acks.slice(-20), re: replies,
    };
  }

  // ---- what the phone may ask (the whole list) ----
  const D = () => E.get('Game.DEX') || {};
  const ADD_OK = ['legend', 'under', 'candy', 'tower', 'raid', 'money', 'region', 'wboss', 'elite', 'league', 'story'];
  // Leagues you can add "Beat a region's League" for: unlocked, not beaten (same list as Mega's Plan tab)
  function storyLeagues() {
    const ST = E.get('STORY'), un = +(E.get('Game.S')?.adv?.unlocked ?? 0), NM = { unova: 'Unova', kalos: 'Kalos', alola: 'Alola', galar: 'Galar', paldea: 'Paldea' };
    return (ST?.REGIONS || []).filter((r) => r && r.key).map((r) => { let chs = []; try { chs = ST.chaptersOf(r.key) || []; } catch (__e) { __h('80-remote:122', __e); } return { key: r.key, name: NM[r.key] || r.name, chs }; })
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
    'goal.add': (a) => {
      if (!ADD_OK.includes(a.type)) throw new Error('that goal type can only be added on the PC');
      if (a.type === 'elite' && !(E.get('LegendZones')?.ZONES || []).some((z) => +z.id === +a.foe)) throw new Error('not a legendary zone');
      if (a.type === 'league' && !(E.get('STORY.REGIONS') || []).some((r) => r.key === String(a.reg))) throw new Error('unknown region');
      const data = a.type === 'elite' ? { foe: +a.foe, upTo: 5 } : a.type === 'league' ? { reg: String(a.reg), upTo: 5 } : a.type === 'legend' ? { foe: +a.foe } : a.type === 'money' ? { target: Math.max(1, +a.target || 0) } : a.type === 'region' ? { reg: String(a.reg) } : a.type === 'under' ? { from: Math.max(1, +a.from || 1) } : {};
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
      let sw = { owned: false, ways: [] }; try { sw = GoalTypes.shinyWays(id); } catch (__e) { __h('80-remote:194', __e); }
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
      Log.add(`phone: ranked up ${D()[m.id]?.name} to rank ${r.rank} with ${r.spent} gem${r.spent === 1 ? '' : 's'} (back to Lv 5)`); try { push(true); } catch (__e) { __h('80-remote:260', __e); }
      return `${D()[m.id]?.name} is rank ${r.rank} now (back to Lv 5)`;
    },
    'update.check': async () => {
      await Updater.check(); try { push(true); } catch (__e) { __h('80-remote:264', __e); }
      const v = Updater.available, I = Updater.info;
      if (I.err && !I.latest) return 'could not reach GitHub: ' + I.err;
      return v ? `New Update ${v} is ready${Updater.downloaded === v ? ' - downloaded, tap Reload Game to run it' : ''}` : `you're up to date (${VERSION})`;
    },
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
    try { es?.close(); } catch (__e) { __h('80-remote:333', __e); }
    es = null;
    if (!cfg.on || !cfg.cmd) return;
    if (relay()) {
      es = new EventSource(`${RELAY}/sub/${encodeURIComponent(cfg.cmd)}`);
      es.onmessage = (ev) => { try { const m = JSON.parse(ev.data); onMsg({ id: 'r' + m.t + Math.random(), message: m.d }); } catch (__e) { __h('80-remote:338', __e); } };
      pairRelay();
    } else {
      es = new EventSource(`https://ntfy.sh/${cfg.cmd}/sse?since=${cfg.lastCmd || '10m'}`);
      es.onmessage = (ev) => { try { const m = JSON.parse(ev.data); if (m.event === 'message') onMsg(m); } catch (__e) { __h('80-remote:342', __e); } };
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
    let fights = []; try { fights = await Recorder.all(foe); } catch (__e) { __h('80-remote:409', __e); }
    const day = Date.now() - 86_400_000;
    // boss fights today against this foe (raid: the raid's static boss; zone: zone fights)
    const boss = fights.filter((f) => f.at > day && (kind === 'raid' ? (f.raid || f.kind === 'static') : !f.raid && f.kind !== 'static'));
    let kos, wipes;
    if (kind === 'raid') { let t = 0; try { t = +E.get('Raids').pity(reg) || 0; } catch (__e) { __h('80-remote:414', __e); } kos = t; wipes = Math.max(0, boss.length - t); } // the raid's own KO counter
    else { kos = boss.filter((f) => f.outcome === 'ko').length; wipes = boss.filter((f) => f.outcome === 'wipe').length; }
    // time per fight: the median gap between boss fights (travel + fight), else the raid loop time
    const st = boss.map((f) => f.at).sort((x, y) => x - y), gaps = [];
    for (let i = 1; i < st.length; i++) { const g = st[i] - st[i - 1]; if (g < 15 * 60_000) gaps.push(g); }
    gaps.sort((x, y) => x - y);
    const per = gaps.length ? gaps[Math.floor(gaps.length / 2)] : kind === 'raid' ? +ev.loopMs || null : boss[0]?.ms || null;
    let chance = null;
    if (kind === 'raid') chance = +(C.RAID?.CATCH) || 0.01;
    else { try { const e = b?.enemies?.[0] || { id: foe, level: 100 }; chance = +A.catchProb(A.catchCtx(e)); } catch (__e) { __h('80-remote:423', __e); } }
    if (!(chance > 0)) chance = fightCache?.foe === foe ? fightCache.chance : null;
    let tries = 0, pity = null;
    if (kind === 'raid') { try { tries = +E.get('Raids').pity(reg) || 0; } catch (__e) { __h('80-remote:426', __e); } pity = +(C.RAID?.PITY) || null; }
    else if (kind === 'wboss') { try { tries = +E.get('WorldBoss').tries() || 0; } catch (__e) { __h('80-remote:427', __e); } }
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
      let p = null; try { const q = GoalTypes[x.type]?.progress?.(x); if (q) p = [q.have, q.need, q.unit || '', q.money ? 1 : 0]; } catch (__e) { __h('80-remote:445', __e); }
      return [x.id, Casing.names(Plan.live(x.id)?.line || ''), p];
    });
    const foes = (a.battle?.enemies || []).filter((e) => e && e.id != null).map((e) => [e.id, e.level || 0, ...hp(e)]);
    const R = E.get('Raids'), uids = E.read('Game.activeTeam', null) || S.team || [];
    const team = uids.map((u) => (typeof u === 'object' ? u : E.read('Game.getMon', null, u) || (() => { try { return R?.allyMon(u); } catch { return null; } })())).filter(Boolean).map((m) => [m.id, m.level, ...hp(m), m.bot ? String(m.owner || 'ally') : '']);
    const node = a.chapter != null ? [(+a.node || 0) + 1, (a.nodes || []).length] : null;
    const fight = fightNow();
    return { k: 'tick', at: Date.now(), fight, top: Casing.names(Plan.top || ''), goals, foes, team, node, money: History.homeMoney(), side: History.sideMoney(), idle: Plan.idle ? Casing.names(Plan.idle.line || '') : null, nm: Object.fromEntries([...foes.map((f) => f[0]), ...team.map((t) => t[0]), ...(fight ? [fight.foe] : [])].map((id) => [id, Dx[id]?.name || '#' + id])) };
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
 * Main: wait for the page and the engine, then mount the panel.
 * ------------------------------------------------------------------------------------------- */
function start() {
  const t0 = Date.now();
  const wait = setInterval(() => {
    const domReady = document.readyState !== 'loading' && document.body;
    if (!domReady) return;
    if (Engine.ready() || Date.now() - t0 > 30_000) { clearInterval(wait); try { UI.mount(); } catch (e) { console.error('[Mega Alakazam] UI failed to start', e); } }
  }, 300);
}
start();
Recorder.start();
// debug handle (read-only use from the console / Claude)
window.__MEGA = { VERSION, Engine, World, Views, Recorder, Analyse, Sim, Legends, Plan, GoalTypes, Log, Health,
  // proves the whole path: a silent catch, rewritten by the build, reaching Health
  healthProbe: () => { try { throw new Error('health probe'); } catch (__e) { __h('90-main:17', __e); } return Object.keys(Health.sites).some((k) => k.startsWith('90-main:')); } };
// self-update: tell the copy that loaded us that we came up; after a healthy minute, clear the try count
if (window.__MEGA_HOT === VERSION) { window.__MEGA_HOT_OK = VERSION; setTimeout(() => { try { localStorage.setItem('mega-next-try', '0'); } catch (__e) { __h('90-main:19', __e); } }, 60_000); }
})();
