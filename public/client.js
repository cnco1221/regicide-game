(() => {
  const SUIT_SYMBOL = { S: '♠', H: '♥', D: '♦', C: '♣' };
  const SUIT_CLASS = { S: 'black', H: 'red', D: 'yellow', C: 'green' };
  const SUIT_NAME = { S: '스페이드', H: '하트', D: '다이아몬드', C: '클럽' };
  const CARD_ART = {
    J: { S: 'cards/jack_of_spades.png', H: 'cards/jack_of_hearts.png', D: 'cards/jack_of_diamonds.png', C: 'cards/jack_of_clubs.png' },
  };
  function cardArt(rank, suit) {
    return (CARD_ART[rank] && CARD_ART[rank][suit]) || null;
  }

  // ---- Synthesized sound effects (no audio files needed) ----
  let audioCtx = null;
  function ensureAudio() {
    if (!audioCtx) {
      try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      } catch (e) {
        return null;
      }
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }
  document.addEventListener('pointerdown', ensureAudio, { once: true });

  function playTone({ freq, startFreq, endFreq, duration = 0.15, type = 'sine', gain = 0.2, delay = 0 }) {
    const ctx = ensureAudio();
    if (!ctx) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();
    osc.type = type;
    if (startFreq && endFreq) {
      osc.frequency.setValueAtTime(startFreq, t0);
      osc.frequency.exponentialRampToValueAtTime(Math.max(endFreq, 1), t0 + duration);
    } else {
      osc.frequency.setValueAtTime(freq, t0);
    }
    gainNode.gain.setValueAtTime(0.0001, t0);
    gainNode.gain.linearRampToValueAtTime(gain, t0 + 0.012);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(gainNode).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.03);
  }

  function sfxClick() {
    playTone({ type: 'triangle', startFreq: 950, endFreq: 620, duration: 0.045, gain: 0.12 });
  }
  function sfxHit() {
    playTone({ type: 'square', startFreq: 190, endFreq: 55, duration: 0.14, gain: 0.22 });
    playTone({ type: 'sawtooth', startFreq: 90, endFreq: 40, duration: 0.1, gain: 0.14, delay: 0.015 });
  }
  function sfxYourTurn() {
    playTone({ type: 'sine', freq: 523.25, duration: 0.13, gain: 0.16 });
    playTone({ type: 'sine', freq: 783.99, duration: 0.2, gain: 0.16, delay: 0.1 });
  }
  function sfxEnemyDeath() {
    playTone({ type: 'sawtooth', startFreq: 420, endFreq: 55, duration: 0.55, gain: 0.2 });
    playTone({ type: 'square', startFreq: 210, endFreq: 40, duration: 0.4, gain: 0.12, delay: 0.05 });
  }

  let ws = null;
  let myPlayerId = sessionStorage.getItem('regicide_playerId') || null;
  let myCode = sessionStorage.getItem('regicide_code') || null;
  let mySeat = -1;
  let latestState = null;
  let selected = new Set();

  const $ = (id) => document.getElementById(id);

  function showScreen(name) {
    ['home', 'lobby', 'game', 'end'].forEach((s) => {
      $(`screen-${s}`).classList.toggle('hidden', s !== name);
    });
  }

  function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}`);
    ws.addEventListener('open', () => {
      if (myPlayerId && myCode) {
        ws.send(JSON.stringify({ type: 'rejoin', code: myCode, playerId: myPlayerId }));
      }
    });
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      handleMessage(msg);
    });
    ws.addEventListener('close', () => {
      setTimeout(connect, 1500);
    });
  }

  function handleMessage(msg) {
    if (msg.type === 'joined') {
      myPlayerId = msg.playerId;
      myCode = msg.code;
      mySeat = msg.seat;
      sessionStorage.setItem('regicide_playerId', myPlayerId);
      sessionStorage.setItem('regicide_code', myCode);
      $('lobbyCode').textContent = myCode;
      showScreen('lobby');
    } else if (msg.type === 'lobby') {
      renderLobby(msg);
    } else if (msg.type === 'state') {
      const prev = latestState;
      latestState = msg;
      mySeat = msg.yourIdx;
      if (msg.phase === 'win' || msg.phase === 'lose') {
        renderState(msg, prev);
        if (!prev || prev.phase !== msg.phase) {
          triggerEndEffect(msg.phase === 'win');
          setTimeout(() => renderEnd(msg), 1500);
        } else {
          renderEnd(msg);
        }
      } else {
        showScreen('game');
        renderState(msg, prev);
      }
    } else if (msg.type === 'error') {
      $('homeError').textContent = msg.message;
      $('actionError').textContent = msg.message;
      setTimeout(() => { $('actionError').textContent = ''; }, 4000);
    }
  }

  function renderLobby(msg) {
    showScreen('lobby');
    $('lobbyCode').textContent = msg.code;
    const list = $('lobbyPlayers');
    list.innerHTML = '';
    msg.players.forEach((p, i) => {
      const li = document.createElement('li');
      if (!p.connected) li.classList.add('offline');
      li.innerHTML = `<span>${i === 0 ? '👑 ' : ''}${escapeHtml(p.name)}</span><span class="dot">${p.connected ? '● 접속중' : '○ 끊김'}</span>`;
      list.appendChild(li);
    });
    const isHost = mySeat === 0;
    const alone = msg.players.length === 1;
    $('btnStart').classList.toggle('hidden', !isHost || alone);
    $('btnStart').disabled = msg.players.length < 2;
    $('btnStartSolo').classList.toggle('hidden', !isHost || !alone);
    $('lobbyHint').textContent = isHost
      ? (alone ? '친구를 기다리거나, 혼자 싱글모드로 시작할 수 있습니다.' : '게임을 시작할 수 있습니다. (최대 4명)')
      : '방장이 게임을 시작할 때까지 기다려주세요.';
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function cardHtml(card) {
    if (card.rank === 'JOKER') {
      return `<div class="pc-suit-center">🃏</div>`;
    }
    const art = cardArt(card.rank, card.suit);
    if (art) {
      return `<img class="card-art" src="${art}" alt="${card.rank} ${SUIT_SYMBOL[card.suit]}" />`;
    }
    const cls = SUIT_CLASS[card.suit];
    const sym = SUIT_SYMBOL[card.suit];
    return `
      <div class="pc-corner top ${cls}"><span class="r">${card.rank}</span><span class="s">${sym}</span></div>
      <div class="pc-suit-center ${cls}">${sym}</div>
      <div class="pc-corner bottom ${cls}"><span class="r">${card.rank}</span><span class="s">${sym}</span></div>
    `;
  }

  function smallCardHtml(card) {
    if (card.rank === 'JOKER') {
      return `<div class="suit">🃏</div>`;
    }
    const art = cardArt(card.rank, card.suit);
    if (art) {
      return `<img class="card-art" src="${art}" alt="${card.rank} ${SUIT_SYMBOL[card.suit]}" />`;
    }
    const cls = SUIT_CLASS[card.suit];
    const sym = SUIT_SYMBOL[card.suit];
    return `<div class="rank ${cls}">${card.rank}</div><div class="suit ${cls}">${sym}</div>`;
  }

  function renderPlayedCards(s) {
    const area = $('playedArea');
    const box = $('playedCards');
    if (!s.cardsInPlay || s.cardsInPlay.length === 0) {
      area.classList.add('hidden');
      box.innerHTML = '';
      return;
    }
    area.classList.remove('hidden');
    box.innerHTML = s.cardsInPlay.map((c) => {
      const owner = s.players[c.by];
      const name = owner ? owner.name : '?';
      const jokerCls = c.rank === 'JOKER' ? ' joker' : '';
      return `<div class="played-card-wrap"><div class="mini-card${jokerCls}">${smallCardHtml(c)}</div><div class="played-by">${escapeHtml(name)}</div></div>`;
    }).join('');
  }

  function triggerRedFlash() {
    const el = $('flashOverlay');
    el.classList.remove('flash-red');
    void el.offsetWidth;
    el.classList.add('flash-red');
  }

  function spawnDamageNumber(n) {
    const host = document.querySelector('.enemy-block');
    if (!host) return;
    const el = document.createElement('div');
    el.className = 'dmg-float';
    el.textContent = '-' + n;
    host.appendChild(el);
    setTimeout(() => el.remove(), 950);
  }

  function triggerEnemyHit(damage) {
    const card = $('enemyCard');
    card.classList.remove('hit');
    void card.offsetWidth;
    card.classList.add('hit');
    // The 'hit' shake and the persistent 'immunity-removed' glow both use the
    // `animation` shorthand, so a lingering 'hit' class would permanently
    // mask the glow. Clear it once its one-shot animation has finished.
    setTimeout(() => card.classList.remove('hit'), 450);
    if (damage > 0) spawnDamageNumber(damage);
  }

  function triggerEnemyDefeat() {
    const area = $('enemyArea');
    area.classList.remove('defeat-flash');
    void area.offsetWidth;
    area.classList.add('defeat-flash');
  }

  function triggerEndEffect(win) {
    const el = $('deathOverlay');
    el.classList.toggle('win', win);
    el.classList.toggle('lose', !win);
    el.querySelector('.death-icon').textContent = win ? '👑' : '💀';
    el.querySelector('.death-text').textContent = win ? '승리!' : '패배...';
    el.classList.remove('hidden');
    el.classList.remove('play');
    void el.offsetWidth;
    el.classList.add('play');
  }

  function sameEnemy(a, b) {
    return !!a && !!b && a.suit === b.suit && a.rank === b.rank;
  }

  const FALL_MS = 550;
  let enemyCardTimer = null;

  function paintEnemyCard(s) {
    const enemyCard = $('enemyCard');
    const e = s.currentEnemy;
    if (e) {
      const cls = SUIT_CLASS[e.suit];
      const art = cardArt(e.rank, e.suit);
      enemyCard.className = `enemy-card suit-${cls}`
        + (art ? ' has-art' : '')
        + (s.enemyImmunityRemoved ? ' immunity-removed' : '');
      enemyCard.innerHTML = art
        ? `<img class="card-art" src="${art}" alt="${e.rank} ${SUIT_SYMBOL[e.suit]}" />`
        : `<div class="rank">${e.rank}</div><div class="suit">${SUIT_SYMBOL[e.suit]}</div>`;
      $('enemyHealthText').textContent = `${Math.max(0, e.healthRemaining)}/${e.health}`;
      $('enemyAttackText').textContent = e.value !== e.baseValue ? `${e.value} (원래 ${e.baseValue})` : `${e.value}`;
      $('immuneNote').classList.toggle('hidden', !s.enemyImmunityRemoved);
    } else {
      enemyCard.className = 'enemy-card';
      enemyCard.innerHTML = '';
      $('enemyHealthText').textContent = '-';
      $('enemyAttackText').textContent = '-';
      $('immuneNote').classList.add('hidden');
    }
  }

  function renderEnemy(s, prev) {
    const enemyCard = $('enemyCard');
    const defeated = prev && prev.currentEnemy && !sameEnemy(prev.currentEnemy, s.currentEnemy);

    if (enemyCardTimer) {
      clearTimeout(enemyCardTimer);
      enemyCardTimer = null;
    }

    if (defeated) {
      // keep showing the old (defeated) enemy while it topples over
      enemyCard.classList.remove('rising');
      enemyCard.classList.remove('hit');
      void enemyCard.offsetWidth;
      enemyCard.classList.add('falling');
      triggerEnemyDefeat();
      sfxEnemyDeath();
      enemyCardTimer = setTimeout(() => {
        paintEnemyCard(s);
        enemyCard.classList.remove('falling');
        if (s.currentEnemy) {
          void enemyCard.offsetWidth;
          enemyCard.classList.add('rising');
          enemyCardTimer = setTimeout(() => enemyCard.classList.remove('rising'), 550);
        }
      }, FALL_MS);
      return;
    }

    paintEnemyCard(s);
    if (prev && sameEnemy(prev.currentEnemy, s.currentEnemy) && s.currentEnemy.healthRemaining < prev.currentEnemy.healthRemaining) {
      triggerEnemyHit(prev.currentEnemy.healthRemaining - s.currentEnemy.healthRemaining);
    }
  }

  function renderState(s, prev) {
    // deck counts
    $('castleCount').textContent = s.castleCount;

    // players strip
    const strip = $('playersStrip');
    strip.innerHTML = '';
    s.players.forEach((p, i) => {
      const div = document.createElement('div');
      div.className = 'player-chip';
      if (i === s.currentPlayerIdx) div.classList.add('active');
      if (!p.connected) div.classList.add('offline');
      div.innerHTML = `<div class="pname">${i === s.yourIdx ? '🙂 ' : ''}${escapeHtml(p.name)}</div><div class="pcards">${p.handCount}장</div>`;
      strip.appendChild(div);
    });

    // enemy
    renderEnemy(s, prev);
    if (prev && prev.phase !== 'defend' && s.phase === 'defend') {
      triggerRedFlash();
    }
    if (prev && (s.cardsInPlay ? s.cardsInPlay.length : 0) > (prev.cardsInPlay ? prev.cardsInPlay.length : 0)) {
      sfxHit();
    }

    // piles
    $('tavernPileCard').classList.remove('empty');
    $('tavernCount').textContent = `${s.tavernCount}장`;
    const discardCard = $('discardPileCard');
    if (s.discardTop) {
      discardCard.classList.remove('empty');
      discardCard.classList.toggle('has-art', !!cardArt(s.discardTop.rank, s.discardTop.suit));
      discardCard.innerHTML = smallCardHtml(s.discardTop);
    } else {
      discardCard.classList.add('empty');
      discardCard.classList.remove('has-art');
      discardCard.innerHTML = '';
    }
    $('discardCount').textContent = `${s.discardCount}장`;

    // cards currently in play against this enemy
    renderPlayedCards(s);

    const meTurn = s.currentPlayerIdx === s.yourIdx;
    $('btnRequestYield').classList.toggle('hidden', meTurn || s.phase !== 'play');
    if (prev && s.phase === 'play' && meTurn && !(prev.phase === 'play' && prev.currentPlayerIdx === prev.yourIdx)) {
      sfxYourTurn();
    }

    // choose next panel (jester)
    const choosing = s.phase === 'chooseNext';
    $('chooseNextPanel').classList.toggle('hidden', !(choosing && meTurn));
    if (choosing && meTurn) {
      const box = $('chooseNextButtons');
      box.innerHTML = '';
      s.players.forEach((p, i) => {
        if (i === s.yourIdx) return;
        const b = document.createElement('button');
        b.className = 'btn';
        b.textContent = p.name;
        b.onclick = () => sendAction('chooseNext', { targetIdx: i });
        box.appendChild(b);
      });
    }

    // hand
    selected.clear();
    const handBox = $('handCards');
    handBox.innerHTML = '';
    $('handCount').textContent = `(${s.yourHand.length}장)`;
    s.yourHand.forEach((card, idx) => {
      const div = document.createElement('div');
      div.className = 'playing-card'
        + (card.rank === 'JOKER' ? ' joker' : '')
        + (cardArt(card.rank, card.suit) ? ' has-art' : '');
      div.innerHTML = cardHtml(card);
      div.dataset.idx = idx;
      div.onclick = () => toggleSelect(idx, div);
      handBox.appendChild(div);
    });

    updateActionButtons(s, meTurn);
  }

  function toggleSelect(idx, div) {
    const s = latestState;
    const canSelect = s.phase === 'play' || s.phase === 'defend';
    const meTurn = s.currentPlayerIdx === s.yourIdx;
    if (!canSelect || !meTurn) return;
    sfxClick();
    if (selected.has(idx)) {
      selected.delete(idx);
      div.classList.remove('selected');
    } else {
      selected.add(idx);
      div.classList.add('selected');
    }
    updateActionButtons(s, meTurn);
  }

  function updateActionButtons(s, meTurn) {
    const inPlay = s.phase === 'play' && meTurn;
    const inDefend = s.phase === 'defend' && meTurn;

    $('btnPlay').classList.toggle('hidden', !inPlay);
    $('btnYield').classList.toggle('hidden', !inPlay || s.numPlayers === 1);
    $('btnDiscardConfirm').classList.toggle('hidden', !inDefend);

    $('btnPlay').disabled = selected.size === 0;
    $('btnYield').disabled = !!s.lastActionWasYield;

    let info = '';
    if (inPlay && selected.size === 1 && s.yourHand[[...selected][0]] && s.yourHand[[...selected][0]].rank === 'JOKER') {
      info = '🃏 어릿광대: 적의 면역을 없앱니다' + (s.numPlayers === 1 ? ' (+ 손패를 버리고 새로 뽑습니다)' : '');
    } else if (inPlay && selected.size > 0) {
      const sum = [...selected].reduce((acc, i) => acc + s.yourHand[i].value, 0);
      info = `선택한 카드 합계: ${sum}`;
    } else if (inDefend) {
      const sum = [...selected].reduce((acc, i) => acc + s.yourHand[i].value, 0);
      info = `선택한 카드 합계: ${sum} / 필요: ${s.pendingDefend.required}`;
      $('btnDiscardConfirm').disabled = sum < s.pendingDefend.required;
    }
    $('selectionInfo').textContent = info;

    // log: single most-recent line, shown above the hand
    $('logLine').textContent = s.log[s.log.length - 1] || '';
  }

  function renderEnd(s) {
    const el = $('deathOverlay');
    el.classList.add('hidden');
    el.classList.remove('play');
    showScreen('end');
    if (s.phase === 'win') {
      $('endTitle').textContent = '🎉 승리했습니다!';
      $('endText').textContent = '모든 왕과 여왕, 기사를 물리쳤습니다. 왕국에 평화가 돌아왔습니다.';
    } else {
      $('endTitle').textContent = '💀 패배했습니다';
      $('endText').textContent = '적의 부패가 왕국을 뒤덮었습니다. 다시 도전해보세요.';
    }
  }

  function sendAction(action, payload = {}) {
    ws.send(JSON.stringify({ type: 'action', action, ...payload }));
  }

  // ---- UI wiring ----
  $('btnCreate').onclick = () => {
    const name = $('nameInput').value.trim() || '플레이어';
    sessionStorage.removeItem('regicide_playerId');
    sessionStorage.removeItem('regicide_code');
    myPlayerId = null; myCode = null;
    ws.send(JSON.stringify({ type: 'create', name }));
  };
  $('btnJoin').onclick = () => {
    const name = $('nameInput').value.trim() || '플레이어';
    const code = $('codeInput').value.trim().toUpperCase();
    if (!code) { $('homeError').textContent = '방 코드를 입력하세요.'; return; }
    sessionStorage.removeItem('regicide_playerId');
    sessionStorage.removeItem('regicide_code');
    myPlayerId = null; myCode = null;
    ws.send(JSON.stringify({ type: 'join', code, name }));
  };
  $('btnStart').onclick = () => ws.send(JSON.stringify({ type: 'start' }));
  $('btnStartSolo').onclick = () => ws.send(JSON.stringify({ type: 'start' }));
  $('btnCopyCode').onclick = () => {
    navigator.clipboard?.writeText($('lobbyCode').textContent).catch(() => {});
  };
  $('btnPlay').onclick = () => {
    if (selected.size === 0) return;
    sendAction('play', { indices: [...selected] });
  };
  $('btnYield').onclick = () => sendAction('yield');
  $('btnSort').onclick = () => sendAction('sortHand');
  $('btnDiscardConfirm').onclick = () => {
    sendAction('discard', { indices: [...selected] });
  };
  $('btnReload').onclick = () => {
    sessionStorage.removeItem('regicide_playerId');
    sessionStorage.removeItem('regicide_code');
    location.reload();
  };

  let yieldRequestCooldown = false;
  $('btnRequestYield').onclick = () => {
    if (yieldRequestCooldown) return;
    sendAction('requestYield');
    yieldRequestCooldown = true;
    const btn = $('btnRequestYield');
    btn.disabled = true;
    btn.textContent = '요청함';
    setTimeout(() => {
      yieldRequestCooldown = false;
      btn.disabled = false;
      btn.textContent = '🙏 양보 요청';
    }, 5000);
  };

  $('btnHelp').onclick = () => $('helpModal').classList.remove('hidden');
  $('btnCloseHelp').onclick = () => $('helpModal').classList.add('hidden');
  $('helpModal').addEventListener('click', (e) => {
    if (e.target.id === 'helpModal') $('helpModal').classList.add('hidden');
  });

  connect();
})();
