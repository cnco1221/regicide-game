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
      enemyCard.className = `enemy-card suit-${cls}` + (art ? ' has-art' : '');
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

    // turn banner
    const meTurn = s.currentPlayerIdx === s.yourIdx;
    const curName = s.players[s.currentPlayerIdx] ? s.players[s.currentPlayerIdx].name : '';
    $('turnBanner').textContent = meTurn ? '⭐ 당신의 차례입니다!' : `${curName}의 차례를 기다리는 중...`;

    // defend panel
    const inDefend = s.phase === 'defend';
    $('defendPanel').classList.toggle('hidden', !inDefend);
    if (inDefend) {
      const need = s.pendingDefend.required;
      $('defendText').textContent = meTurn
        ? `적의 반격! 카드 합계 ${need} 이상이 되도록 버릴 카드를 고르세요.`
        : `${curName}가 ${need}만큼 피해를 방어하는 중입니다...`;
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
    $('btnJester').classList.toggle('hidden', !inPlay);
    $('btnYield').classList.toggle('hidden', !inPlay);
    $('btnDiscardConfirm').classList.toggle('hidden', !inDefend);

    $('btnPlay').disabled = selected.size === 0;
    $('btnYield').disabled = !!s.lastActionWasYield;
    const hasJoker = s.yourHand.some((c) => c.rank === 'JOKER');
    $('btnJester').disabled = !hasJoker;

    let info = '';
    if (inPlay && selected.size > 0) {
      const sum = [...selected].reduce((acc, i) => acc + s.yourHand[i].value, 0);
      info = `선택한 카드 합계: ${sum}`;
    } else if (inDefend) {
      const sum = [...selected].reduce((acc, i) => acc + s.yourHand[i].value, 0);
      info = `선택한 카드 합계: ${sum} / 필요: ${s.pendingDefend.required}`;
      $('btnDiscardConfirm').disabled = sum < s.pendingDefend.required;
    }
    $('selectionInfo').textContent = info;

    // log
    const logBox = $('logBox');
    logBox.innerHTML = s.log.slice().reverse().map((l) => `<div>${escapeHtml(l)}</div>`).join('');
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
  $('btnJester').onclick = () => sendAction('jester');
  $('btnYield').onclick = () => sendAction('yield');
  $('btnDiscardConfirm').onclick = () => {
    sendAction('discard', { indices: [...selected] });
  };
  $('btnReload').onclick = () => {
    sessionStorage.removeItem('regicide_playerId');
    sessionStorage.removeItem('regicide_code');
    location.reload();
  };

  connect();
})();
