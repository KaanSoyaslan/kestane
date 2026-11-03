// Deterministic room generator: the only link between the two devices.
// Integer logic only. No Math.random, floats, Date, sort or locale calls, so the
// same (code, version) gives the same rooms on every browser and, later, in Unity.
// Any change to the output must bump GEN_VERSION and update tests/digest.js.
(function (root) {
  'use strict';

  const GEN_VERSION = 2;
  const SYMBOL_COUNT = 8;
  const COLOR_COUNT = 4;
  const ROLE_A = 0;
  const ROLE_B = 1;

  // A pipe room in the run's final slot is the climax, so it lasts longer. Keep even:
  // both players need the same number of turns.
  const LAST_ROOM_EXTRA_TURNS = 4;

  // While resting, every pipe erupts once per turn in random order, so standing still
  // on any pipe gets the player hit. Starts after the player's own eruption has ended.
  const HAZARD_SHAKE_MS = 800;
  const HAZARD_FLAME_MS = 600;
  const HAZARD_FIRST_MS = 1600;
  const HAZARD_MARGIN_MS = 200;

  const POOL = [
    { salt: 101, type: 'pipes', name: 'Lav Boruları', pipes: 4, turns: 4, turnMs: 10000 },
    { salt: 102, type: 'doors', name: 'Kapılar' },
    { salt: 103, type: 'pipes', name: 'Hızlı Borular', pipes: 5, turns: 6, turnMs: 8000 },
  ];

  function mix(h, v) {
    let k = Math.imul(v | 0, 0xcc9e2d51);
    k = (k << 15) | (k >>> 17);
    k = Math.imul(k, 0x1b873593);
    h ^= k;
    h = (h << 13) | (h >>> 19);
    return (Math.imul(h, 5) + 0xe6546b64) | 0;
  }

  function hash(...values) {
    let h = 0x9747b28c | 0;
    for (const v of values) h = mix(h, v);
    h ^= values.length;
    h ^= h >>> 16;
    h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return h >>> 0;
  }

  // sfc32, seeded from hash() so nearby codes do not give nearby streams.
  function makeRng(...values) {
    let a = hash(1, ...values) | 0;
    let b = hash(2, ...values) | 0;
    let c = hash(3, ...values) | 0;
    let d = 1;

    function next() {
      const t = (((a + b) | 0) + d) | 0;
      d = (d + 1) | 0;
      a = b ^ (b >>> 9);
      b = (c + (c << 3)) | 0;
      c = (c << 21) | (c >>> 11);
      c = (c + t) | 0;
      return t >>> 0;
    }

    for (let i = 0; i < 12; i++) next();

    function int(n) {
      return next() % n;
    }

    function shuffle(items) {
      const out = items.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = int(i + 1);
        const tmp = out[i];
        out[i] = out[j];
        out[j] = tmp;
      }
      return out;
    }

    return { int, shuffle, sample: (items, n) => shuffle(items).slice(0, n) };
  }

  function range(from, count) {
    const out = [];
    for (let i = 0; i < count; i++) out.push(from + i);
    return out;
  }

  function runOrder(code) {
    return makeRng(code, GEN_VERSION, 11).shuffle(range(0, POOL.length));
  }

  // Short check both players read aloud. Catches a mistyped code or different versions.
  function confirmCode(code) {
    return String(hash(code, GEN_VERSION, 7777) % 100).padStart(2, '0');
  }

  function restHazards(r, def) {
    const lastStart = def.turnMs - HAZARD_SHAKE_MS - HAZARD_FLAME_MS - HAZARD_MARGIN_MS;
    const gap = ((lastStart - HAZARD_FIRST_MS) / (def.pipes - 1)) | 0;
    return r.shuffle(range(0, def.pipes)).map((pipe, i) => ({ pipe, at: HAZARD_FIRST_MS + i * gap }));
  }

  function pipesRoom(code, def, attempt, turnCount) {
    const r = makeRng(code, GEN_VERSION, def.salt, attempt);
    const first = r.int(2);
    const symbolRole = r.int(2);

    const layout = [ROLE_A, ROLE_B].map(() => {
      const tops = [];
      for (let i = 0; i < def.pipes; i++) tops.push(330 + 15 * r.int(5));
      return { tops, spawn: r.int(def.pipes) };
    });

    const lastCorrect = [layout[ROLE_A].spawn, layout[ROLE_B].spawn];
    const symbols = range(0, SYMBOL_COUNT);
    const numbers = range(1, 9);
    const turns = [];

    for (let i = 0; i < turnCount; i++) {
      const active = (first + i) % 2;
      const kind = active === symbolRole ? 'symbol' : 'number';
      const values = r.sample(kind === 'symbol' ? symbols : numbers, def.pipes);

      // Always a different pipe from the previous answer, so the player has to jump.
      let correct = r.int(def.pipes - 1);
      if (correct >= lastCorrect[active]) correct++;
      lastCorrect[active] = correct;

      turns.push({
        active,
        correct,
        labels: values.map((value) => ({ kind, value })),
        hazards: restHazards(r, def),
      });
    }

    return {
      type: 'pipes',
      pipes: def.pipes,
      turnMs: def.turnMs,
      hazardShakeMs: HAZARD_SHAKE_MS,
      hazardFlameMs: HAZARD_FLAME_MS,
      symbolRole,
      layout,
      turns,
    };
  }

  function doorLabel(symbol, color) {
    return { kind: 'door', symbol, color };
  }

  // Four doors: the answer, two near misses that sound alike when spoken, one other.
  function doorSet(r, clue) {
    const labels = [clue];
    const add = (symbol, color) => {
      if (!labels.some((l) => l.symbol === symbol && l.color === color)) labels.push(doorLabel(symbol, color));
    };
    add(clue.symbol, (clue.color + 1 + r.int(COLOR_COUNT - 1)) % COLOR_COUNT);
    add((clue.symbol + 1 + r.int(SYMBOL_COUNT - 1)) % SYMBOL_COUNT, clue.color);
    while (labels.length < 4) add(r.int(SYMBOL_COUNT), r.int(COLOR_COUNT));

    const order = r.shuffle(range(0, labels.length));
    return { doors: order.map((i) => labels[i]), correct: order.indexOf(0) };
  }

  function doorsRoom(code, def) {
    const r = makeRng(code, GEN_VERSION, def.salt);
    const lead = r.int(2);
    const other = 1 - lead;
    const templates = r.shuffle(range(0, 4));

    const clues = [];
    while (clues.length < 4) {
      const clue = doorLabel(r.int(SYMBOL_COUNT), r.int(COLOR_COUNT));
      if (!clues.some((c) => c.symbol === clue.symbol && c.color === clue.color)) clues.push(clue);
    }

    const chamber = (index, sign, clue) => {
      const doors = clue ? doorSet(r, clue) : { doors: [], correct: -1 };
      return { template: templates[index % templates.length], sign, doors: doors.doors, correct: doors.correct };
    };

    // Each sign opens a door on the other device, so neither player can finish alone:
    // lead reads 0 -> other passes and reads 1 -> lead passes and reads 2 -> other
    // passes and reads 3 -> lead passes -> both reach an exit.
    const players = [];
    players[lead] = [
      chamber(0, clues[0], clues[1]),
      chamber(2, clues[2], clues[3]),
      chamber(4, null, null),
    ];
    players[other] = [
      chamber(1, null, clues[0]),
      chamber(3, clues[1], clues[2]),
      chamber(5, clues[3], null),
    ];

    return { type: 'doors', lead, players };
  }

  // Pure function of its inputs. Doors ignore attempt: a death there is local and
  // must not change what the partner's device shows.
  function room(code, poolIndex, attempt) {
    const def = POOL[poolIndex];
    let content;
    if (def.type === 'pipes') {
      const isLast = runOrder(code)[POOL.length - 1] === poolIndex;
      content = pipesRoom(code, def, attempt, def.turns + (isLast ? LAST_ROOM_EXTRA_TURNS : 0));
    } else {
      content = doorsRoom(code, def);
    }
    content.name = def.name;
    return content;
  }

  const api = {
    GEN_VERSION, POOL, SYMBOL_COUNT, COLOR_COUNT, ROLE_A, ROLE_B, LAST_ROOM_EXTRA_TURNS,
    hash, runOrder, confirmCode, room,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Generator = api;
})(this);
