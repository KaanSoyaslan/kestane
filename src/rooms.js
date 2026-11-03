// Room scenes. Each receives only its own role's view of the generated content;
// nothing here can reach the other device, so all sync is by voice and shared rules.
(function (root) {
  'use strict';

  const { W, H, Input, Player, Particles, Sfx, overlaps, roundRect } = root.Engine;
  const { drawLabel } = root.Glyphs;

  const ROLE_COLORS = ['#ffb04a', '#6fe3d2'];

  function text(ctx, value, x, y, size, color, align, weight) {
    ctx.fillStyle = color;
    ctx.font = `${weight || 700} ${size}px system-ui, sans-serif`;
    ctx.textAlign = align || 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(value, x, y);
  }

  function box(ctx, x, y, w, h) {
    ctx.fillStyle = 'rgba(12, 8, 18, 0.78)';
    roundRect(ctx, x, y, w, h, 12);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  function drawClueBox(ctx, caption, label, placeholder) {
    box(ctx, 660, 12, 288, 100);
    text(ctx, caption, 804, 32, 15, '#d9d2e6');
    if (label) drawLabel(ctx, label, 804, 72, 54);
    else if (placeholder) text(ctx, placeholder, 804, 72, 40, 'rgba(255,255,255,0.3)');
  }

  // ---------------------------------------------------------------- Lava pipes

  const PRECOUNT_MS = 3000;
  const ERUPT_MS = 1400;
  const LAVA_Y = 488;
  const SCRAMBLE_MS = 350;

  const DEATH_TEXT = {
    lava: 'Lava düştün.',
    wrong: 'Süre bittiğinde yanlış borudaydın.',
    late: 'Süre bittiğinde doğru boruda değildin.',
    hazard: 'Sallanan boru patladı, üstünden kaçamadın.',
  };

  class PipesRoom {
    constructor(content, role, title, hooks) {
      this.timed = true;
      this.content = content;
      this.role = role;
      this.title = title;
      this.hooks = hooks;
      this.ownKind = role === content.symbolRole ? 'symbol' : 'number';

      const count = content.pipes;
      const pipeW = count === 4 ? 112 : 96;
      const gap = count === 4 ? 104 : 84;
      const left = (W - (count * pipeW + (count - 1) * gap)) / 2;
      const layout = content.layout[role];
      this.pipes = layout.tops.map((top, i) => ({ x: left + i * (pipeW + gap), y: top, w: pipeW, h: H - top }));

      const spawn = this.pipes[layout.spawn];
      this.player = new Player(spawn.x + spawn.w / 2, spawn.y, ROLE_COLORS[role]);

      this.t0 = performance.now() + PRECOUNT_MS;
      this.turn = -1;
      this.revealed = content.turns.map(() => false);
      this.erupt = null;
      this.dead = false;
      this.deadAt = 0;
      this.deathKey = '';
      this.reported = false;
      this.ended = false;
      this.lastSecond = null;
      this.particles = [];
      this.shakeUntil = 0;
      this.scramble = this.pipes.map(() => 0);
      this.scrambleAt = 0;
      this.firedHazards = new Set();
    }

    enterTurn(index, now) {
      const turns = this.content.turns;
      const previous = this.turn;
      this.turn = index;
      if (previous >= 0 && previous < turns.length && turns[previous].active === this.role) {
        this.erupt = { turn: previous, correct: turns[previous].correct, start: now, until: now + ERUPT_MS };
        this.shakeUntil = now + 350;
        Sfx.erupt();
      }
      if (index < turns.length && turns[index].active === this.role) Sfx.turn();
    }

    columnTop(pipe, since) {
      const progress = Math.min(1, since / 180);
      return pipe.y - progress * (pipe.y + 20);
    }

    inColumn(pipe, since) {
      const top = this.columnTop(pipe, since);
      return overlaps(this.player.rect(), { x: pipe.x + 8, y: top, w: pipe.w - 16, h: pipe.y - top + 4 });
    }

    // Resting is not idle: pipes shake, then erupt. This stays on this device; the
    // partner never sees it. flameSince is negative while the pipe is only shaking.
    hazardPhases(now) {
      const turns = this.content.turns;
      if (this.dead || this.turn < 0 || this.turn >= turns.length || turns[this.turn].active === this.role) return [];
      const { hazardShakeMs: shake, hazardFlameMs: flame, turnMs } = this.content;
      const elapsed = now - this.t0 - this.turn * turnMs;
      const phases = [];
      for (const h of turns[this.turn].hazards) {
        const since = elapsed - h.at;
        if (since >= 0 && since < shake + flame) phases.push({ pipe: h.pipe, flameSince: since - shake });
      }
      return phases;
    }

    die(key, now) {
      if (this.dead) return;
      this.dead = true;
      this.deadAt = now;
      this.deathKey = key;
      this.erupt = null;
      Particles.burst(this.particles, this.player.x, this.player.y - 18, this.player.color, 40);
      Sfx.die();
    }

    update(dt, now) {
      Particles.step(this.particles, dt);

      if (this.dead) {
        if (!this.reported && now - this.deadAt > 1000) {
          this.reported = true;
          this.hooks.onDeath(DEATH_TEXT[this.deathKey]);
        }
        return;
      }

      const t = now - this.t0;
      const { turns, turnMs } = this.content;

      if (t < 0) {
        const second = Math.ceil(-t / 1000);
        if (second !== this.lastSecond) {
          this.lastSecond = second;
          Sfx.tick();
        }
        return;
      }

      const index = Math.floor(t / turnMs);
      if (index !== this.turn) this.enterTurn(Math.min(index, turns.length), now);

      if (this.turn < turns.length && turns[this.turn].active === this.role) {
        const second = Math.ceil(((this.turn + 1) * turnMs - t) / 1000);
        if (second !== this.lastSecond) {
          this.lastSecond = second;
          if (second <= 3) Sfx.tick();
        }
      }

      this.player.step(dt, this.pipes);
      if (this.player.y > LAVA_Y + 8) {
        this.die('lava', now);
        return;
      }

      if (this.erupt) {
        const e = this.erupt;
        for (let i = 0; i < this.pipes.length; i++) {
          if (i !== e.correct && this.inColumn(this.pipes[i], now - e.start)) {
            this.die('wrong', now);
            return;
          }
        }
        if (!this.revealed[e.turn] && this.player.onGround && this.player.ride === this.pipes[e.correct]) {
          this.revealed[e.turn] = true;
          Sfx.ok();
        }
        if (now >= e.until) {
          if (!this.revealed[e.turn]) {
            this.die('late', now);
            return;
          }
          this.erupt = null;
        }
      }

      for (const hazard of this.hazardPhases(now)) {
        if (hazard.flameSince < 0) continue;
        const key = `${this.turn}:${hazard.pipe}`;
        if (!this.firedHazards.has(key)) {
          this.firedHazards.add(key);
          this.shakeUntil = now + 150;
          Sfx.erupt();
        }
        if (this.inColumn(this.pipes[hazard.pipe], hazard.flameSince)) {
          this.die('hazard', now);
          return;
        }
      }

      if (!this.ended && t >= turns.length * turnMs + ERUPT_MS) {
        this.ended = true;
        this.hooks.onEnd();
      }
    }

    labelFor(i, now) {
      const t = now - this.t0;
      if (t < 0) return { label: null, alpha: 1 };
      const turns = this.content.turns;
      if (this.erupt) return { label: turns[this.erupt.turn].labels[i], alpha: 1 };
      if (this.turn < turns.length && turns[this.turn].active === this.role) {
        return { label: turns[this.turn].labels[i], alpha: 1 };
      }
      // Resting: the signs keep changing so the player cannot plan ahead. Visual only.
      if (now - this.scrambleAt > SCRAMBLE_MS) {
        this.scrambleAt = now;
        this.scramble = this.pipes.map(() => (
          this.ownKind === 'symbol' ? Math.floor(Math.random() * 8) : 1 + Math.floor(Math.random() * 9)
        ));
      }
      return { label: { kind: this.ownKind, value: this.scramble[i] }, alpha: 0.3 };
    }

    drawBackground(ctx, now) {
      const sky = ctx.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, '#150d20');
      sky.addColorStop(0.65, '#2b1226');
      sky.addColorStop(1, '#6b1f1a');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      for (let i = 0; i < 12; i++) {
        const x = i * 84 + 8;
        const depth = 36 + ((i * 53) % 70);
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x + 40, depth);
        ctx.lineTo(x + 80, 0);
        ctx.fill();
      }
      const pulse = 0.14 + Math.sin(now / 700) * 0.03;
      const glow = ctx.createLinearGradient(0, LAVA_Y - 160, 0, LAVA_Y);
      glow.addColorStop(0, 'rgba(255,110,40,0)');
      glow.addColorStop(1, `rgba(255,110,40,${pulse})`);
      ctx.fillStyle = glow;
      ctx.fillRect(0, LAVA_Y - 160, W, 160);
    }

    drawPipe(ctx, pipe, i, now) {
      const warning = this.hazardPhases(now).some((h) => h.pipe === i && h.flameSince < 0);
      let shaking = 0;
      if (warning) shaking = Math.sin(now / 22) * 4;
      else if (this.isActive(now) && this.secondsLeft(now) <= 2) shaking = Math.sin(now / 28 + i) * 1.5;
      const x = pipe.x + shaking;
      const body = ctx.createLinearGradient(x, 0, x + pipe.w, 0);
      body.addColorStop(0, '#14632b');
      body.addColorStop(0.35, '#3fbf5f');
      body.addColorStop(1, '#0f4d22');
      ctx.fillStyle = body;
      ctx.fillRect(x + 6, pipe.y + 20, pipe.w - 12, H - pipe.y - 20);

      const safe = this.erupt && this.erupt.correct === i;
      ctx.fillStyle = safe ? '#a7ffb9' : warning ? '#ff8a3c' : body;
      roundRect(ctx, x - 4, pipe.y, pipe.w + 8, 26, 5);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 2;
      ctx.stroke();

      const size = 56;
      const cx = x + pipe.w / 2;
      const cy = pipe.y + 58;
      ctx.fillStyle = 'rgba(10, 16, 12, 0.72)';
      roundRect(ctx, cx - size / 2, cy - size / 2, size, size, 8);
      ctx.fill();
      const { label, alpha } = this.labelFor(i, now);
      if (label) {
        ctx.globalAlpha = alpha;
        drawLabel(ctx, label, cx, cy, 38);
        ctx.globalAlpha = 1;
      } else {
        text(ctx, '?', cx, cy, 30, 'rgba(255,255,255,0.35)');
      }

      if (this.hooks.debug && this.isActive(now) && this.content.turns[this.turn].correct === i) {
        ctx.fillStyle = '#7dff9a';
        ctx.beginPath();
        ctx.arc(cx, pipe.y - 56, 7, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    drawColumn(ctx, pipe, now, since, remaining) {
      const top = this.columnTop(pipe, since);
      const x = pipe.x + 8;
      const w = pipe.w - 16;
      const fade = Math.min(1, remaining / 200);
      const flame = ctx.createLinearGradient(0, top, 0, pipe.y);
      flame.addColorStop(0, 'rgba(255,220,90,0.95)');
      flame.addColorStop(1, 'rgba(255,70,20,0.95)');
      ctx.globalAlpha = Math.max(0, fade);
      ctx.fillStyle = flame;
      ctx.beginPath();
      ctx.moveTo(x, pipe.y);
      for (let y = pipe.y; y > top; y -= 18) ctx.lineTo(x + Math.sin(y / 14 + now / 40) * 7, y);
      ctx.lineTo(x + w / 2, top - 18);
      for (let y = top; y < pipe.y; y += 18) ctx.lineTo(x + w + Math.sin(y / 11 + now / 35) * 7, y);
      ctx.lineTo(x + w, pipe.y);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    drawLava(ctx, now) {
      ctx.fillStyle = '#e8481c';
      ctx.beginPath();
      ctx.moveTo(0, H);
      for (let x = 0; x <= W; x += 16) ctx.lineTo(x, LAVA_Y + Math.sin(x / 46 + now / 480) * 4);
      ctx.lineTo(W, H);
      ctx.fill();
      ctx.fillStyle = '#ff8a2a';
      ctx.beginPath();
      ctx.moveTo(0, H);
      for (let x = 0; x <= W; x += 16) ctx.lineTo(x, LAVA_Y + 16 + Math.sin(x / 34 - now / 380) * 5);
      ctx.lineTo(W, H);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,214,120,0.8)';
      for (let i = 0; i < 9; i++) {
        const phase = (now / (900 + i * 130) + i * 0.37) % 1;
        ctx.beginPath();
        ctx.arc((i * 113 + 40) % W, LAVA_Y + 30 - phase * 24, 2 + phase * 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    isActive(now) {
      const turns = this.content.turns;
      return now >= this.t0 && this.turn >= 0 && this.turn < turns.length && turns[this.turn].active === this.role;
    }

    secondsLeft(now) {
      const t = now - this.t0;
      return Math.max(0, Math.ceil(((this.turn + 1) * this.content.turnMs - t) / 1000));
    }

    clueNow() {
      const turns = this.content.turns;
      const i = this.turn;
      if (i < 0 || i >= turns.length || turns[i].active === this.role) return null;
      if (i === 0 || this.revealed[i - 1]) return turns[i].labels[turns[i].correct];
      return null;
    }

    drawHud(ctx, now) {
      text(ctx, this.title, 14, 28, 15, '#e7e1f2', 'left');
      const t = now - this.t0;
      const turns = this.content.turns;

      if (t < 0) {
        box(ctx, 360, 150, 240, 150);
        text(ctx, 'HAZIR OL', 480, 180, 18, '#d9d2e6');
        text(ctx, String(Math.ceil(-t / 1000)), 480, 240, 76, '#ffffff', 'center', 800);
        return;
      }

      const finished = this.turn >= turns.length;
      const active = this.isActive(now);
      box(ctx, 360, 12, 240, 100);
      const shownTurn = Math.min(this.turn + 1, turns.length);
      const caption = finished ? 'ODA BİTİYOR' : active ? 'SIRA SENDE' : 'ORTAĞININ SIRASI';
      text(ctx, `${caption} · ${shownTurn}/${turns.length}`, 480, 32, 15, active ? '#9dffb0' : '#a9c8ff');
      const seconds = finished ? 0 : this.secondsLeft(now);
      text(ctx, String(seconds), 480, 74, 54, active && seconds <= 3 ? '#ff6b5e' : '#ffffff', 'center', 800);

      if (!finished) {
        const clue = this.clueNow();
        if (clue) {
          drawClueBox(ctx, 'ORTAĞINA SÖYLE', clue);
          text(ctx, 'İşareti ortağına anlat, sallanan borudan kaç!', 480, 132, 17, '#efeaf7');
        } else if (active) {
          drawClueBox(ctx, 'ORTAĞIN SÖYLEYECEK', null, '?');
          text(ctx, 'Ortağının anlattığı işaretli boruya geç.', 480, 132, 17, '#efeaf7');
        } else {
          drawClueBox(ctx, 'DOĞRU BORUYA İN', null, '…');
        }
      }
    }

    draw(ctx, now) {
      ctx.save();
      if (now < this.shakeUntil) ctx.translate((Math.random() - 0.5) * 7, (Math.random() - 0.5) * 7);
      this.drawBackground(ctx, now);
      this.pipes.forEach((pipe, i) => this.drawPipe(ctx, pipe, i, now));
      if (this.erupt) {
        const since = now - this.erupt.start;
        this.pipes.forEach((pipe, i) => {
          if (i !== this.erupt.correct) this.drawColumn(ctx, pipe, now, since, this.erupt.until - now);
        });
      }
      for (const hazard of this.hazardPhases(now)) {
        if (hazard.flameSince >= 0) {
          this.drawColumn(ctx, this.pipes[hazard.pipe], now, hazard.flameSince, this.content.hazardFlameMs - hazard.flameSince);
        }
      }
      if (!this.dead) this.player.draw(ctx);
      this.drawLava(ctx, now);
      Particles.draw(ctx, this.particles);
      ctx.restore();
      this.drawHud(ctx, now);
      if (this.dead) {
        ctx.fillStyle = `rgba(150, 10, 10, ${Math.min(0.5, (now - this.deadAt) / 1000)})`;
        ctx.fillRect(0, 0, W, H);
      }
    }
  }

  // ---------------------------------------------------------------- Door chambers

  const GROUND_Y = 470;
  const FADE_MS = 450;
  const RESPAWN_MS = 650;

  function ground(x, w) {
    return { x, y: GROUND_Y, w, h: H - GROUND_Y };
  }

  function ledge(x, y, w) {
    return { x, y, w, h: 14, oneWay: true };
  }

  function pillar(x, y, w) {
    return { x, y, w, h: H - y };
  }

  const TEMPLATES = [
    {
      solids: [ground(0, 230), ledge(262, 420, 76), ground(370, 590), ledge(410, 395, 80), ledge(520, 320, 90)],
      spikes: [{ x: 230, w: 140 }],
      sign: { x: 565, y: 320 },
      doorXs: [650, 730, 810, 890],
    },
    {
      solids: [ground(0, 170), ground(600, 360), ledge(440, 350, 90)],
      moving: { x0: 185, x1: 490, y: 440, w: 96, period: 3400 },
      spikes: [{ x: 170, w: 430 }],
      sign: { x: 485, y: 350 },
      doorXs: [650, 730, 810, 890],
    },
    {
      solids: [ground(0, 150), ledge(185, 405, 70), ledge(290, 335, 70), ledge(395, 265, 80), ledge(500, 335, 70), ground(590, 370)],
      spikes: [{ x: 150, w: 440 }],
      sign: { x: 435, y: 265 },
      doorXs: [630, 710, 790, 870],
    },
    {
      solids: [ground(0, 120), pillar(160, 420, 60), pillar(275, 360, 60), pillar(390, 420, 60), ground(495, 465)],
      spikes: [{ x: 120, w: 40 }, { x: 220, w: 55 }, { x: 335, w: 55 }, { x: 450, w: 45 }],
      sign: { x: 305, y: 360 },
      doorXs: [560, 660, 760, 860],
    },
  ];

  const PALETTES = [
    { top: '#16233c', bottom: '#2a4264', solid: '#51709c', edge: '#8fb0de', door: '#27436e' },
    { top: '#2c1a34', bottom: '#57304e', solid: '#94607f', edge: '#e0a3c2', door: '#6a2f54' },
  ];

  const DOOR_W = 60;
  const DOOR_H = 96;
  const SPIKE_TOP = 506;

  class DoorsRoom {
    constructor(content, role, title, hooks) {
      this.timed = false;
      this.role = role;
      this.title = title;
      this.hooks = hooks;
      this.chambers = content.players[role];
      this.palette = PALETTES[role];
      this.index = 0;
      this.particles = [];
      this.toast = null;
      this.fadeUntil = 0;
      this.respawnAt = 0;
      this.shakeUntil = 0;
      this.startedAt = performance.now();
      this.ended = false;
      this.loadChamber();
    }

    loadChamber() {
      const chamber = this.chambers[this.index];
      const t = TEMPLATES[chamber.template];
      this.template = t;
      this.solids = t.solids.slice();
      this.lift = null;
      if (t.moving) {
        this.lift = { x: t.moving.x0, y: t.moving.y, w: t.moving.w, h: 14, oneWay: true, dx: 0 };
        this.solids.push(this.lift);
      }
      this.sign = chamber.sign ? { x: t.sign.x, y: t.sign.y, label: chamber.sign, read: false } : null;
      this.doors = chamber.correct >= 0
        ? chamber.doors.map((label, i) => ({ x: t.doorXs[i], label, ok: i === chamber.correct }))
        : [{ x: t.doorXs[t.doorXs.length - 1], exit: true }];
      this.spawnPlayer();
    }

    spawnPlayer() {
      this.player = new Player(60, GROUND_Y, ROLE_COLORS[this.role]);
    }

    say(message, now) {
      this.toast = { message, until: now + 2600 };
    }

    nearDoor() {
      if (!this.player.onGround) return null;
      return this.doors.find((d) => Math.abs(this.player.x - d.x) < DOOR_W / 2 + 4) || null;
    }

    enter(door, now) {
      if (door.exit) {
        if (this.sign && !this.sign.read) {
          this.say('Önce tabelayı oku: ortağının ona ihtiyacı var.', now);
          return;
        }
        if (!this.ended) {
          this.ended = true;
          Sfx.ok();
          this.hooks.onEnd();
        }
        return;
      }
      if (door.ok) {
        Sfx.ok();
        door.open = true;
        this.fadeUntil = now + FADE_MS;
        return;
      }
      Sfx.die();
      this.shakeUntil = now + 300;
      this.say('Yanlış kapı! Bölüm başına döndün.', now);
      this.spawnPlayer();
    }

    update(dt, now) {
      Particles.step(this.particles, dt);

      if (this.fadeUntil) {
        if (now >= this.fadeUntil) {
          this.fadeUntil = 0;
          this.index++;
          this.loadChamber();
        }
        return;
      }
      if (this.respawnAt) {
        if (now >= this.respawnAt) {
          this.respawnAt = 0;
          this.spawnPlayer();
        }
        return;
      }

      if (this.lift) {
        const m = this.template.moving;
        const wave = 0.5 - 0.5 * Math.cos(((now - this.startedAt) / m.period) * Math.PI * 2);
        const x = m.x0 + (m.x1 - m.x0) * wave;
        this.lift.dx = x - this.lift.x;
        this.lift.x = x;
      }

      const near = this.nearDoor();
      root.document.body.classList.toggle('near-door', !!near);
      if (Input.actionPressed && near) {
        Input.jumpPressed = false;
        this.enter(near, now);
        return;
      }

      this.player.step(dt, this.solids);

      const body = this.player.rect();
      const onSpikes = this.template.spikes.some((s) => overlaps(body, { x: s.x, y: SPIKE_TOP, w: s.w, h: H - SPIKE_TOP }));
      if (onSpikes || this.player.y > H + 40) {
        Particles.burst(this.particles, this.player.x, Math.min(this.player.y, H) - 18, this.player.color, 30);
        Sfx.die();
        this.say('Dikenler! Sadece sen bölüm başına döndün.', now);
        this.respawnAt = now + RESPAWN_MS;
        return;
      }

      if (this.sign && !this.sign.read
        && Math.abs(this.player.x - this.sign.x) < 48 && Math.abs(this.player.y - this.sign.y) < 40) {
        this.sign.read = true;
        Sfx.ok();
      }
    }

    drawBackground(ctx) {
      const p = this.palette;
      const sky = ctx.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, p.top);
      sky.addColorStop(1, p.bottom);
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = 'rgba(255,255,255,0.025)';
      for (let y = 0; y < H; y += 54) {
        const shift = (y / 54) % 2 === 0 ? 0 : 54;
        for (let x = -54; x < W; x += 108) ctx.fillRect(x + shift, y, 102, 48);
      }
    }

    drawSolid(ctx, s) {
      const p = this.palette;
      ctx.fillStyle = p.solid;
      ctx.fillRect(s.x, s.y, s.w, s.h);
      ctx.fillStyle = p.edge;
      ctx.fillRect(s.x, s.y, s.w, 5);
    }

    drawSpikes(ctx) {
      ctx.fillStyle = '#d7dbe6';
      for (const s of this.template.spikes) {
        const count = Math.max(1, Math.floor(s.w / 22));
        const size = s.w / count;
        for (let i = 0; i < count; i++) {
          ctx.beginPath();
          ctx.moveTo(s.x + i * size, H);
          ctx.lineTo(s.x + i * size + size / 2, SPIKE_TOP);
          ctx.lineTo(s.x + (i + 1) * size, H);
          ctx.fill();
        }
      }
    }

    drawDoor(ctx, door, near, now) {
      const x = door.x - DOOR_W / 2;
      const y = GROUND_Y - DOOR_H;
      ctx.fillStyle = door.open ? '#0b0810' : this.palette.door;
      roundRect(ctx, x, y, DOOR_W, DOOR_H, 10);
      ctx.fill();
      ctx.strokeStyle = near ? '#ffffff' : 'rgba(255,255,255,0.25)';
      ctx.lineWidth = near ? 3 : 2;
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.beginPath();
      ctx.arc(x + DOOR_W - 13, y + DOOR_H / 2, 4, 0, Math.PI * 2);
      ctx.fill();

      const plateY = y - 34;
      ctx.fillStyle = 'rgba(8, 6, 12, 0.85)';
      roundRect(ctx, door.x - 28, plateY - 28, 56, 56, 8);
      ctx.fill();
      if (door.exit) text(ctx, 'ÇIKIŞ', door.x, plateY, 15, '#9dffb0');
      else drawLabel(ctx, door.label, door.x, plateY, 38);

      if (this.hooks.debug && door.ok) {
        ctx.fillStyle = '#7dff9a';
        ctx.beginPath();
        ctx.arc(door.x, plateY - 40, 6, 0, Math.PI * 2);
        ctx.fill();
      }
      if (near && Math.sin(now / 160) > -0.5) text(ctx, '↑', door.x, y + 26, 24, '#ffffff');
    }

    drawSign(ctx) {
      const s = this.sign;
      ctx.fillStyle = '#6d5138';
      ctx.fillRect(s.x - 4, s.y - 44, 8, 44);
      ctx.fillStyle = s.read ? '#17110c' : '#3a2a1c';
      roundRect(ctx, s.x - 36, s.y - 102, 72, 62, 8);
      ctx.fill();
      ctx.strokeStyle = s.read ? '#ffe9a8' : '#8b6a48';
      ctx.lineWidth = 3;
      ctx.stroke();
      if (s.read) drawLabel(ctx, s.label, s.x, s.y - 71, 42);
      else text(ctx, '?', s.x, s.y - 71, 32, '#c7a981');
    }

    drawHud(ctx, now) {
      text(ctx, this.title, 14, 28, 15, '#e7e1f2', 'left');
      box(ctx, 380, 12, 200, 60);
      text(ctx, `BÖLÜM ${this.index + 1}/${this.chambers.length}`, 480, 32, 15, '#a9c8ff');
      text(ctx, 'ZAMANSIZ', 480, 54, 15, '#d9d2e6');

      if (this.sign) {
        if (this.sign.read) drawClueBox(ctx, 'ORTAĞINA SÖYLE', this.sign.label);
        else drawClueBox(ctx, 'TABELAYA ULAŞ', null, '?');
      }

      let hint = 'Çıkış kapısına gir. Ortağın da çıkınca devam edersiniz.';
      if (this.sign && !this.sign.read) hint = 'Tabelaya ulaş, gördüğünü ortağına anlat.';
      else if (!this.doors[0].exit) {
        const touch = root.document.body.classList.contains('touch');
        hint = `Doğru kapıyı ortağın biliyor. Kapının önünde ${touch ? 'Gir tuşuna bas' : '↑ veya E'}.`;
      }
      const message = this.toast && now < this.toast.until ? this.toast.message : hint;
      text(ctx, message, 340, 100, 16, this.toast && now < this.toast.until ? '#ffd27a' : '#efeaf7');
    }

    draw(ctx, now) {
      ctx.save();
      if (now < this.shakeUntil) ctx.translate((Math.random() - 0.5) * 7, (Math.random() - 0.5) * 7);
      this.drawBackground(ctx);
      this.drawSpikes(ctx);
      this.solids.forEach((s) => this.drawSolid(ctx, s));
      if (this.sign) this.drawSign(ctx);
      const near = !this.respawnAt ? this.nearDoor() : null;
      this.doors.forEach((door) => this.drawDoor(ctx, door, door === near, now));
      if (!this.respawnAt && !this.fadeUntil) this.player.draw(ctx);
      Particles.draw(ctx, this.particles);
      ctx.restore();
      this.drawHud(ctx, now);
      if (this.fadeUntil) {
        ctx.fillStyle = `rgba(0,0,0,${1 - Math.max(0, this.fadeUntil - now) / FADE_MS})`;
        ctx.fillRect(0, 0, W, H);
      }
    }
  }

  root.Rooms = { PipesRoom, DoorsRoom };
})(this);
