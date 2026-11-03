// Generator checks shared by tests/digest.html. Every device must print the same
// digest. A different digest on any browser means the two players can see different
// rooms without knowing it, which blocks release.
(function (root) {
  'use strict';

  // Set from the first verified run. Update together with GEN_VERSION only.
  const GOLDEN = { version: 2, digest: '778aa886' };

  const ATTEMPTS = 3;

  function fnv(h, text) {
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  function isPermutation(list, n) {
    return list.length === n && new Set(list).size === n && list.every((v) => v >= 0 && v < n);
  }

  function checkPipes(room, problems, where) {
    const previous = [room.layout[0].spawn, room.layout[1].spawn];
    room.turns.forEach((turn, i) => {
      if (turn.active !== (room.turns[0].active + i) % 2) problems.push(`${where}: sıra dönüşümlü değil`);
      if (turn.labels.length !== room.pipes) problems.push(`${where}: etiket sayısı yanlış`);
      if (new Set(turn.labels.map((l) => l.value)).size !== room.pipes) problems.push(`${where}: aynı etiket iki kez`);
      if (turn.correct < 0 || turn.correct >= room.pipes) problems.push(`${where}: doğru boru sınır dışı`);
      if (turn.correct === previous[turn.active]) problems.push(`${where}: doğru boru değişmedi`);
      previous[turn.active] = turn.correct;

      if (!isPermutation(turn.hazards.map((h) => h.pipe), room.pipes)) problems.push(`${where}: her boru bir kez patlamalı`);
      const end = turn.hazards[turn.hazards.length - 1].at + room.hazardShakeMs + room.hazardFlameMs;
      if (end > room.turnMs) problems.push(`${where}: patlama tur bitiminden sonra`);
      if (turn.hazards[0].at <= 1400) problems.push(`${where}: patlama kendi alevinle çakışıyor`);
    });
  }

  // Walks the door chain the way two real players would, so an unwinnable seed fails.
  function checkDoors(room, problems, where) {
    const same = (a, b) => a.symbol === b.symbol && a.color === b.color;
    const position = [0, 0];
    const heard = [];
    let moved = true;
    while (moved) {
      moved = false;
      [0, 1].forEach((role) => {
        const chamber = room.players[role][position[role]];
        if (chamber.sign && !heard.some((c) => same(c, chamber.sign))) {
          heard.push(chamber.sign);
          moved = true;
        }
        if (chamber.correct >= 0 && heard.some((c) => same(c, chamber.doors[chamber.correct]))) {
          position[role]++;
          moved = true;
        }
      });
    }
    [0, 1].forEach((role) => {
      if (position[role] !== room.players[role].length - 1) problems.push(`${where}: çıkışa ulaşılamıyor`);
      room.players[role].forEach((chamber) => {
        if (chamber.correct < 0) return;
        if (chamber.doors.length !== 4) problems.push(`${where}: kapı sayısı yanlış`);
        chamber.doors.forEach((d, i) => {
          if (chamber.doors.some((o, j) => j !== i && same(d, o))) problems.push(`${where}: aynı kapı iki kez`);
        });
      });
    });
  }

  function run(G) {
    const problems = [];
    let h = 0x811c9dc5;
    let doorsCopies = 0;

    for (let code = 0; code < 10000; code++) {
      const order = G.runOrder(code);
      if (!isPermutation(order, G.POOL.length)) problems.push(`${code}: oda sırası bozuk`);
      h = fnv(h, JSON.stringify(order) + G.confirmCode(code));

      for (let index = 0; index < G.POOL.length; index++) {
        for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
          const room = G.room(code, index, attempt);
          const where = `${code}/${index}/${attempt}`;
          if (room.type === 'pipes') {
            checkPipes(room, problems, where);
            const extra = order[order.length - 1] === index ? G.LAST_ROOM_EXTRA_TURNS : 0;
            if (room.turns.length !== G.POOL[index].turns + extra) problems.push(`${where}: tur sayısı yanlış`);
            if (room.turns.length % 2 !== 0) problems.push(`${where}: oyuncuların tur sayısı eşit değil`);
          } else if (attempt === 0) checkDoors(room, problems, where);
          else if (JSON.stringify(room) === JSON.stringify(G.room(code, index, 0))) doorsCopies++;
          else problems.push(`${where}: kapı odası denemeye göre değişti`);
          h = fnv(h, JSON.stringify(room));
        }
      }
    }

    return {
      digest: h.toString(16).padStart(8, '0'),
      problems,
      version: G.GEN_VERSION,
      golden: GOLDEN,
      doorsCopies,
    };
  }

  root.Digest = { run };
})(this);
