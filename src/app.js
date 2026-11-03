// Screen flow and main loop. All shared state is what the players say to each other:
// the 4-digit code, the room they are in and the attempt number.
(function (root) {
  'use strict';

  const { W, H, Input, Sfx } = root.Engine;
  const { PipesRoom, DoorsRoom } = root.Rooms;
  const G = root.Generator;

  const params = new URLSearchParams(location.search);
  const DEBUG = params.has('debug');
  const SAVE_KEY = `kestane.save.${params.get('slot') || 'main'}`;
  const STEP = 1 / 120;
  const INTERRUPT_MS = 2000;

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const stage = document.getElementById('stage');
  const screenEl = document.getElementById('screen');
  const hud = document.getElementById('hud');
  const partnerButton = document.getElementById('partner-died');
  const soundButton = document.getElementById('sound');

  const S = { code: 0, role: 0, order: [], step: 0, attempt: 0, deaths: 0, startedAt: 0 };

  let scene = null;
  let running = false;
  let scale = 1;
  let last = performance.now();
  let accumulator = 0;
  let hiddenAt = 0;
  let wakeLock = null;
  let partnerArmedUntil = 0;

  // ---------------------------------------------------------------- Persistence

  function save() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        v: G.GEN_VERSION, code: S.code, role: S.role, step: S.step, attempt: S.attempt, deaths: S.deaths,
      }));
    } catch (e) { /* private mode: the game still runs, only resume is lost */ }
  }

  function loadSave() {
    try {
      const data = JSON.parse(localStorage.getItem(SAVE_KEY));
      return data && data.v === G.GEN_VERSION ? data : null;
    } catch (e) {
      return null;
    }
  }

  function clearSave() {
    try {
      localStorage.removeItem(SAVE_KEY);
    } catch (e) { /* see save() */ }
  }

  // ---------------------------------------------------------------- Screens

  function codeText(code) {
    return String(code).padStart(4, '0');
  }

  function roleText(role) {
    return role === G.ROLE_A ? '1. oyuncu' : '2. oyuncu';
  }

  function show(html) {
    running = false;
    Input.clear();
    document.body.classList.remove('playing', 'near-door');
    hud.hidden = true;
    screenEl.innerHTML = `<div class="panel">${html}</div>`;
    screenEl.hidden = false;
    screenEl.scrollTop = 0;
  }

  function on(id, handler) {
    const element = document.getElementById(id);
    element.addEventListener('click', (e) => {
      Sfx.unlock();
      handler(e);
    });
    return element;
  }

  function showMenu() {
    scene = null;
    const saved = loadSave();
    show(`
      <h1>Kestane</h1>
      <p class="sub">Prototip · Geçici kod adı</p>
      <p>İki oyuncu, iki cihaz, sıfır bağlantı. Aynı kodu girin, konuşarak birlikte geçin.
         Ekranınızda gördüğünüz işaret ortağınızın anahtarıdır.</p>
      <div class="actions">
        ${saved ? `<button class="btn" id="resume">Devam et · Kod ${codeText(saved.code)}</button>` : ''}
        <button class="btn${saved ? ' ghost' : ''}" id="create">Oyun oluştur</button>
        <button class="btn ghost" id="join">Oyuna katıl</button>
      </div>
      <p class="fine">Sesli görüşme açın ya da yan yana oturun.
        ${document.body.classList.contains('touch')
          ? 'Ekrandaki tuşlarla oynanır, telefonu yan çevirmek rahat ettirir.'
          : 'Klavyede ← → hareket, boşluk zıplama.'}</p>
    `);
    if (saved) {
      on('resume', () => {
        Object.assign(S, saved, { order: G.runOrder(saved.code), startedAt: Date.now() });
        showRoomIntro();
      });
    }
    on('create', showCreate);
    on('join', showJoin);
  }

  function randomCode() {
    return Math.floor(Math.random() * 10000);
  }

  function bindCodeInput(onValid) {
    const input = document.getElementById('code');
    const error = document.getElementById('code-error');
    input.addEventListener('input', () => {
      input.value = input.value.replace(/[^0-9]/g, '').slice(0, 4);
      error.textContent = '';
    });
    const submit = () => {
      if (input.value.length !== 4) {
        error.textContent = 'Kod 4 haneli olmalı.';
        input.focus();
        return;
      }
      onValid(parseInt(input.value, 10));
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
    });
    on('go', submit);
    on('back', showMenu);
    return input;
  }

  function showCreate() {
    show(`
      <h2>Oyun oluştur</h2>
      <p>Bu kodu ortağına söyle. İstersen kendi kodunu yaz.</p>
      <input id="code" class="code-input" inputmode="numeric" autocomplete="off" maxlength="4"
             aria-label="4 haneli kod" value="${codeText(randomCode())}">
      <p class="error" id="code-error" role="alert"></p>
      <div class="actions">
        <button class="btn" id="go">Devam</button>
        <button class="btn ghost" id="reroll">Başka kod</button>
        <button class="btn ghost" id="back">Geri</button>
      </div>
    `);
    const input = bindCodeInput((code) => showConfirm(code, G.ROLE_A));
    on('reroll', () => {
      input.value = codeText(randomCode());
    });
  }

  function showJoin() {
    show(`
      <h2>Oyuna katıl</h2>
      <p>Ortağının söylediği 4 haneli kodu yaz.</p>
      <input id="code" class="code-input" inputmode="numeric" autocomplete="off" maxlength="4"
             aria-label="4 haneli kod" placeholder="0000">
      <p class="error" id="code-error" role="alert"></p>
      <div class="actions">
        <button class="btn" id="go">Devam</button>
        <button class="btn ghost" id="back">Geri</button>
      </div>
    `);
    bindCodeInput((code) => showConfirm(code, G.ROLE_B)).focus();
  }

  function showConfirm(code, role) {
    show(`
      <h2>Onay</h2>
      <p>Kod <b>${codeText(code)}</b> · Sen <b>${roleText(role)}</b>sun. Biriniz 1, biriniz 2 olmalı.</p>
      <p>Onay numarasını karşılaştırın:</p>
      <div class="code">${G.confirmCode(code)}</div>
      <div class="actions">
        <button class="btn" id="same">Aynı, başlayalım</button>
        <button class="btn ghost" id="different">Farklı</button>
      </div>
    `);
    on('same', () => {
      Object.assign(S, {
        code, role, order: G.runOrder(code), step: 0, attempt: 0, deaths: 0, startedAt: Date.now(),
      });
      save();
      showRoomIntro();
    });
    on('different', () => {
      show(`
        <h2>Numaralar farklı</h2>
        <p>Önce kodu birbirinize tekrar okuyun. Kod aynıysa oyunun farklı sürümlerindesiniz:
           ikiniz de sayfayı yenileyin.</p>
        <div class="actions"><button class="btn" id="back">Başa dön</button></div>
      `);
      on('back', showMenu);
    });
  }

  function currentRoom() {
    return G.room(S.code, S.order[S.step], S.attempt);
  }

  function roomTitle(room) {
    const base = `Oda ${S.step + 1}/${S.order.length} · ${room.name}`;
    return room.type === 'pipes' ? `${base} · Deneme ${S.attempt + 1}` : base;
  }

  function showRoomIntro() {
    const room = currentRoom();
    const timed = room.type === 'pipes';
    const seconds = timed ? room.turnMs / 1000 : 0;
    const body = timed
      ? `<p>Sırayla oynayın, her tur ${seconds} saniye. Sıra sendeyken ortağının anlattığı işaretli boruya geç.
           Süre bitince yanlış borulardan alev çıkar. Doğru borudaysan ortağına anlatacağın işaret ekranında belirir.</p>
         <p>Sıra ortağındayken boş durma: borular rastgele sallanıp patlar, sallanan borudan kaç.</p>
         <p>Biriniz ölürse diğeriniz <b>Ortağım öldü</b>ye basar, ikiniz de odanın başına dönersiniz.</p>
         <p class="callout"><b>Birlikte sayın: 3, 2, 1…</b> “Başla” derken ikiniz aynı anda basın.</p>`
      : `<p>Bu oda zamansız, acele yok. Tabelaları bulun, gördüğünüzü anlatın, ortağınızın anlattığı kapıdan geçin.
           Odalarınız farklı. Burada düşen yalnız kendi bölümünün başına döner.</p>`;
    const attemptRow = timed && S.attempt > 0
      ? `<div class="attempt">
           <button class="btn ghost small" id="attempt-down" aria-label="Denemeyi azalt">−</button>
           <span>Deneme <b>${S.attempt + 1}</b></span>
           <button class="btn ghost small" id="attempt-up" aria-label="Denemeyi artır">+</button>
         </div>
         <p class="fine">Deneme numaranız aynı olmalı. Farklıysa buradan düzeltin.</p>`
      : '';
    show(`
      <p class="sub">Kod ${codeText(S.code)} · ${roleText(S.role)}</p>
      <h2>Oda ${S.step + 1}/${S.order.length}: ${room.name}</h2>
      ${attemptRow}
      ${body}
      <div class="actions"><button class="btn big" id="start">BAŞLA</button></div>
    `);
    on('start', startRoom);
    if (attemptRow) {
      on('attempt-down', () => {
        S.attempt = Math.max(0, S.attempt - 1);
        save();
        showRoomIntro();
      });
      on('attempt-up', () => {
        S.attempt += 1;
        save();
        showRoomIntro();
      });
    }
  }

  function requestWakeLock() {
    if (!navigator.wakeLock || wakeLock) return;
    navigator.wakeLock.request('screen').then((lock) => {
      wakeLock = lock;
      lock.addEventListener('release', () => {
        wakeLock = null;
      });
    }).catch(() => { /* not available here: the phone may sleep, handled as an interruption */ });
  }

  function startRoom() {
    const room = currentRoom();
    const hooks = { onDeath: handleDeath, onEnd: handleRoomEnd, debug: DEBUG };
    const Scene = room.type === 'pipes' ? PipesRoom : DoorsRoom;
    scene = new Scene(room, S.role, roomTitle(room), hooks);
    screenEl.hidden = true;
    screenEl.innerHTML = '';
    hud.hidden = false;
    partnerButton.hidden = !scene.timed;
    resetPartnerButton();
    if (document.activeElement) document.activeElement.blur();
    document.body.classList.add('playing');
    document.body.classList.toggle('door-room', !scene.timed);
    accumulator = 0;
    running = true;
    requestWakeLock();
  }

  function retryRoom() {
    S.attempt += 1;
    save();
    showRoomIntro();
  }

  function handleDeath(reason) {
    S.deaths += 1;
    show(`
      <h2 class="danger">Öldün</h2>
      <p>${reason}</p>
      <p class="callout">Ortağına <b>“öldüm”</b> de. O da <b>Ortağım öldü</b>ye bassın.</p>
      <div class="actions"><button class="btn" id="retry">Odanın başına dön</button></div>
    `);
    on('retry', retryRoom);
  }

  function handleRoomEnd() {
    const timed = scene.timed;
    show(`
      <h2 class="success">Oda bitti</h2>
      <p>${timed ? 'Ortağın da hayatta mı?' : 'Ortağın da çıkınca birlikte devam edin.'}</p>
      <div class="actions">
        <button class="btn" id="both">${timed ? 'İkimiz de geçtik' : 'İkimiz de çıktık'}</button>
        ${timed ? '<button class="btn ghost" id="partner-failed">Ortağım öldü</button>' : ''}
      </div>
    `);
    on('both', nextRoom);
    if (timed) on('partner-failed', retryRoom);
  }

  function nextRoom() {
    S.step += 1;
    S.attempt = 0;
    if (S.step >= S.order.length) {
      showEnd();
      return;
    }
    save();
    showRoomIntro();
  }

  function showEnd() {
    clearSave();
    scene = null;
    const minutes = Math.max(1, Math.round((Date.now() - S.startedAt) / 60000));
    show(`
      <h2 class="success">Bitirdiniz!</h2>
      <p>Bu cihazda ${S.deaths} ölüm, yaklaşık ${minutes} dakika.</p>
      <p>Başka bir kodla odaların sırası ve bütün işaretler değişir.</p>
      <div class="actions"><button class="btn" id="menu">Ana menü</button></div>
    `);
    on('menu', showMenu);
  }

  function showInterrupted() {
    S.deaths += 1;
    show(`
      <h2 class="danger">Sayaç kesildi</h2>
      <p>Ekran kapandı ya da başka bir uygulamaya geçildi, sayaçlarınız artık aynı değil.</p>
      <p class="callout">Ortağına söyle. O da <b>Ortağım öldü</b>ye bassın.</p>
      <div class="actions"><button class="btn" id="retry">Odanın başına dön</button></div>
    `);
    on('retry', retryRoom);
  }

  // A stray tap would send only this device back, so it takes two presses.
  function resetPartnerButton() {
    partnerArmedUntil = 0;
    partnerButton.textContent = 'Ortağım öldü';
    partnerButton.classList.remove('armed');
  }

  partnerButton.addEventListener('click', () => {
    const now = performance.now();
    if (now < partnerArmedUntil) {
      resetPartnerButton();
      retryRoom();
      return;
    }
    partnerArmedUntil = now + 2500;
    partnerButton.textContent = 'Emin misin?';
    partnerButton.classList.add('armed');
    partnerButton.blur();
  });

  soundButton.addEventListener('click', () => {
    Sfx.unlock();
    const onNow = Sfx.toggle();
    soundButton.textContent = onNow ? 'Ses: açık' : 'Ses: kapalı';
    soundButton.blur();
  });

  // ---------------------------------------------------------------- Loop

  function resize() {
    const touch = document.body.classList.contains('touch');
    const portrait = innerHeight > innerWidth;
    const reserved = touch && portrait ? 180 : 0;
    const fit = Math.min(innerWidth / W, (innerHeight - reserved) / H);
    const ratio = Math.min(root.devicePixelRatio || 1, 2);
    stage.style.width = `${Math.floor(W * fit)}px`;
    stage.style.height = `${Math.floor(H * fit)}px`;
    canvas.width = Math.floor(W * fit * ratio);
    canvas.height = Math.floor(H * fit * ratio);
    scale = canvas.width / W;
  }

  function drawIdle() {
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#150d20');
    sky.addColorStop(1, '#3a1420');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);
  }

  function frame() {
    requestAnimationFrame(frame);
    const now = performance.now();
    const dt = Math.min(now - last, 100) / 1000;
    last = now;

    if (running && scene) {
      accumulator += dt;
      while (accumulator >= STEP && running) {
        scene.update(STEP, now);
        Input.endStep();
        accumulator -= STEP;
      }
      if (now > partnerArmedUntil && partnerArmedUntil) resetPartnerButton();
    }

    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    if (scene) scene.draw(ctx, now);
    else drawIdle();
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      hiddenAt = Date.now();
      Input.clear();
      return;
    }
    if (running) requestWakeLock();
    if (running && scene && scene.timed && Date.now() - hiddenAt > INTERRUPT_MS) showInterrupted();
  });

  function enableTouch() {
    if (document.body.classList.contains('touch')) return;
    document.body.classList.add('touch');
    resize();
  }

  Input.bindKeys(() => running);
  Input.bindTouch(document.getElementById('touch'));
  if (matchMedia('(pointer: coarse)').matches) document.body.classList.add('touch');
  addEventListener('touchstart', enableTouch, { once: true, passive: true });
  addEventListener('resize', resize);
  addEventListener('orientationchange', () => setTimeout(resize, 250)); // iOS reports the new size late
  resize();
  showMenu();
  requestAnimationFrame(frame);

  if (DEBUG) {
    document.body.classList.add('debug');
    addEventListener('keydown', (e) => {
      if (e.code === 'BracketRight' && running && scene) handleRoomEnd();
    });
    root.__kestane = { S, G, Input, getScene: () => scene };
  }

  // Offline play after the first visit. Only available on https and localhost.
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* still playable while online */ });
  }
})(this);
