// Input, platformer physics, particles and sound. Physics never affects what the
// partner sees, so floats are fine here; only generator.js has to be deterministic.
(function (root) {
  'use strict';

  const W = 960;
  const H = 540;
  const MOVE = 290;
  const JUMP = 650;
  const GRAVITY = 1900;
  const MAX_FALL = 900;
  const COYOTE = 0.08;
  const JUMP_BUFFER = 0.12;

  const KEYS = {
    ArrowLeft: ['left'], KeyA: ['left'],
    ArrowRight: ['right'], KeyD: ['right'],
    Space: ['jump'],
    ArrowUp: ['jump', 'action'], KeyW: ['jump', 'action'],
    KeyE: ['action'],
  };

  const Input = {
    left: false, right: false, jump: false, action: false,
    jumpPressed: false, actionPressed: false,
    set(name, down) {
      if (name === 'jump' && down && !this.jump) this.jumpPressed = true;
      if (name === 'action' && down && !this.action) this.actionPressed = true;
      this[name] = down;
    },
    endStep() {
      this.jumpPressed = false;
      this.actionPressed = false;
    },
    clear() {
      this.left = this.right = this.jump = this.action = false;
      this.endStep();
    },
    bindKeys(isPlaying) {
      const handle = (down) => (e) => {
        const names = KEYS[e.code];
        if (!names || !isPlaying()) return;
        e.preventDefault();
        if (down && e.repeat) return;
        names.forEach((name) => this.set(name, down));
      };
      addEventListener('keydown', handle(true));
      addEventListener('keyup', handle(false));
      addEventListener('blur', () => this.clear());
    },
    bindTouch(container) {
      container.querySelectorAll('[data-key]').forEach((button) => {
        const name = button.dataset.key;
        const release = () => {
          this.set(name, false);
          button.classList.remove('down');
        };
        button.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          this.set(name, true);
          button.classList.add('down');
        });
        button.addEventListener('pointerup', release);
        button.addEventListener('pointercancel', release);
        button.addEventListener('pointerleave', release);
      });
    },
  };

  function overlaps(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  class Player {
    constructor(x, y, color) {
      this.x = x; // centre
      this.y = y; // feet
      this.w = 26;
      this.h = 38;
      this.vx = 0;
      this.vy = 0;
      this.color = color;
      this.facing = 1;
      this.onGround = true;
      this.ride = null;
      this.coyote = 0;
      this.buffer = 0;
    }

    rect() {
      return { x: this.x - this.w / 2, y: this.y - this.h, w: this.w, h: this.h };
    }

    step(dt, solids) {
      const direction = (Input.right ? 1 : 0) - (Input.left ? 1 : 0);
      if (direction) this.facing = direction;
      const accel = (this.onGround ? 3200 : 2200) * dt;
      const target = direction * MOVE;
      this.vx += Math.max(-accel, Math.min(accel, target - this.vx));

      this.buffer = Input.jumpPressed ? JUMP_BUFFER : Math.max(0, this.buffer - dt);
      this.coyote = this.onGround ? COYOTE : Math.max(0, this.coyote - dt);
      if (this.buffer > 0 && this.coyote > 0) {
        this.vy = -JUMP;
        this.buffer = 0;
        this.coyote = 0;
        this.onGround = false;
        this.ride = null;
        Sfx.jump();
      }

      const released = !Input.jump && this.vy < 0;
      this.vy = Math.min(MAX_FALL, this.vy + GRAVITY * (released ? 2.4 : 1) * dt);

      if (this.ride && this.ride.dx) this.x += this.ride.dx;

      this.x += this.vx * dt;
      this.x = Math.max(this.w / 2, Math.min(W - this.w / 2, this.x));
      for (const s of solids) {
        if (s.oneWay || !overlaps(this.rect(), s)) continue;
        this.x = this.vx > 0 ? s.x - this.w / 2 : s.x + s.w + this.w / 2;
        this.vx = 0;
      }

      const previousFeet = this.y;
      this.y += this.vy * dt;
      this.onGround = false;
      this.ride = null;
      for (const s of solids) {
        if (!overlaps(this.rect(), s)) continue;
        if (this.vy >= 0 && (!s.oneWay || previousFeet <= s.y + 1)) {
          this.y = s.y;
          this.vy = 0;
          this.onGround = true;
          this.ride = s;
        } else if (!s.oneWay) {
          this.y = s.y + s.h + this.h;
          this.vy = 0;
        }
      }
    }

    draw(ctx) {
      const stretch = Math.max(-0.12, Math.min(0.12, this.vy / 3000));
      const h = this.h * (1 + stretch);
      const w = this.w * (1 - stretch);
      const x = this.x - w / 2;
      const y = this.y - h;
      ctx.fillStyle = this.color;
      roundRect(ctx, x, y, w, h, 8);
      ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      roundRect(ctx, x, y + h * 0.68, w, h * 0.32, 8);
      ctx.fill();
      const eyeX = this.x + this.facing * 5;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(eyeX - 5, y + 13, 4.5, 0, Math.PI * 2);
      ctx.arc(eyeX + 5, y + 13, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#1b1320';
      ctx.beginPath();
      ctx.arc(eyeX - 5 + this.facing * 1.5, y + 13, 2.2, 0, Math.PI * 2);
      ctx.arc(eyeX + 5 + this.facing * 1.5, y + 13, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function roundRect(ctx, x, y, w, h, r) {
    const radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  }

  const Particles = {
    burst(list, x, y, color, count) {
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 80 + Math.random() * 320;
        list.push({
          x, y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 120,
          life: 0.5 + Math.random() * 0.5,
          size: 3 + Math.random() * 5,
          color,
        });
      }
    },
    step(list, dt) {
      for (let i = list.length - 1; i >= 0; i--) {
        const p = list[i];
        p.life -= dt;
        if (p.life <= 0) {
          list.splice(i, 1);
          continue;
        }
        p.vy += 900 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      }
    },
    draw(ctx, list) {
      for (const p of list) {
        ctx.globalAlpha = Math.min(1, p.life * 2);
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      }
      ctx.globalAlpha = 1;
    },
  };

  // Kept quiet: the players are talking over it.
  const Sfx = (() => {
    let ctx = null;
    let muted = false;

    function tone(freq, duration, type, volume, slideTo, delay) {
      if (muted || !ctx) return;
      const start = ctx.currentTime + (delay || 0);
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, start);
      if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, start + duration);
      gain.gain.setValueAtTime(volume, start);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + duration);
    }

    return {
      unlock() {
        try {
          const Context = root.AudioContext || root.webkitAudioContext;
          if (!ctx && Context) ctx = new Context();
          if (ctx && ctx.state === 'suspended') ctx.resume();
        } catch (e) {
          ctx = null;
        }
      },
      toggle() {
        muted = !muted;
        return !muted;
      },
      jump: () => tone(420, 0.08, 'square', 0.015, 640),
      tick: () => tone(880, 0.07, 'square', 0.03),
      turn: () => tone(660, 0.12, 'triangle', 0.05),
      erupt: () => tone(160, 0.5, 'sawtooth', 0.05, 60),
      ok() {
        tone(660, 0.1, 'triangle', 0.06);
        tone(990, 0.16, 'triangle', 0.06, null, 0.1);
      },
      die: () => tone(320, 0.5, 'sawtooth', 0.05, 50),
    };
  })();

  root.Engine = { W, H, Input, Player, Particles, Sfx, overlaps, roundRect };
})(this);
