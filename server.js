const express = require('express');
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');
const crypto = require('crypto');

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// ---------- Game constants ----------
const SUITS = ['S', 'H', 'D', 'C'];
const MAX_HAND = { 1: 8, 2: 7, 3: 6, 4: 5 };
const JOKERS = { 1: 2, 2: 0, 3: 1, 4: 2 };
const FACE_INFO = {
  J: { value: 10, health: 20 },
  Q: { value: 15, health: 30 },
  K: { value: 20, health: 40 },
};

// ---------- In-memory rooms ----------
/** @type {Map<string, Room>} */
const rooms = new Map();

function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code;
  do {
    code = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function genId() {
  return crypto.randomBytes(8).toString('hex');
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function sumValues(cards) {
  return cards.reduce((s, c) => s + c.value, 0);
}

// ---------- Room / game state ----------
function createRoom() {
  const code = genCode();
  const room = {
    code,
    players: [], // {id, name, ws, connected}
    started: false,
    numPlayers: 0,
    maxHand: 0,
    castleDeck: [],
    tavernDeck: [],
    discardPile: [],
    cardsInPlayThisFight: [],
    currentEnemy: null,
    enemyHealthRemaining: 0,
    enemySpadeReduction: 0,
    enemyImmunityRemoved: false,
    currentPlayerIdx: 0,
    lastActionWasYield: false,
    phase: 'lobby', // lobby | play | defend | chooseNext | win | lose
    pendingDefend: null,
    log: [],
  };
  rooms.set(code, room);
  return room;
}

function pushLog(room, msg) {
  room.log.push(msg);
  if (room.log.length > 200) room.log.shift();
}

function buildDecks(room) {
  const numberRanks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10'];
  const tavern = [];
  for (const s of SUITS) {
    for (const r of numberRanks) {
      tavern.push({ suit: s, rank: r, value: r === 'A' ? 1 : parseInt(r, 10) });
    }
  }
  const jokerCount = JOKERS[room.numPlayers] || 0;
  for (let i = 0; i < jokerCount; i++) {
    tavern.push({ suit: null, rank: 'JOKER', value: 0 });
  }
  shuffle(tavern);

  const castle = [];
  for (const faceRank of ['J', 'Q', 'K']) {
    const tier = SUITS.map((s) => ({
      suit: s,
      rank: faceRank,
      value: FACE_INFO[faceRank].value,
      health: FACE_INFO[faceRank].health,
    }));
    shuffle(tier);
    castle.push(...tier);
  }

  room.tavernDeck = tavern;
  room.castleDeck = castle;
}

function startGame(room) {
  room.numPlayers = room.players.length;
  room.maxHand = MAX_HAND[room.numPlayers];
  buildDecks(room);
  room.discardPile = [];
  room.cardsInPlayThisFight = [];
  room.enemySpadeReduction = 0;
  room.enemyImmunityRemoved = false;
  room.currentPlayerIdx = 0;
  room.lastActionWasYield = false;
  room.pendingDefend = null;
  room.log = [];

  for (const p of room.players) {
    p.hand = [];
    for (let i = 0; i < room.maxHand; i++) {
      if (room.tavernDeck.length) p.hand.push(room.tavernDeck.shift());
    }
  }

  room.currentEnemy = room.castleDeck.shift();
  room.enemyHealthRemaining = room.currentEnemy.health;
  room.started = true;
  room.phase = 'play';
  pushLog(room, `게임을 시작합니다! 첫 번째 적: ${cardLabel(room.currentEnemy)}`);
  pushLog(room, `${room.players[0].name}의 차례입니다.`);
}

function cardLabel(c) {
  if (!c) return '';
  if (c.rank === 'JOKER') return '어릿광대(조커)';
  const suitNames = { S: '스페이드', H: '하트', D: '다이아몬드', C: '클럽' };
  return `${suitNames[c.suit]} ${c.rank}`;
}

function currentEnemyAttack(room) {
  if (!room.currentEnemy) return 0;
  return Math.max(0, room.currentEnemy.value - room.enemySpadeReduction);
}

function validateSelection(hand, indices) {
  const uniq = [...new Set(indices)];
  if (uniq.length !== indices.length) return null;
  if (uniq.some((i) => i < 0 || i >= hand.length)) return null;
  const cards = uniq.map((i) => hand[i]);
  if (cards.length === 0) return null;
  if (cards.some((c) => c.rank === 'JOKER')) return null;

  if (cards.length === 1) return cards;

  const hasAce = cards.some((c) => c.rank === 'A');
  if (cards.length === 2 && hasAce) return cards; // animal companion pairing

  const ranks = new Set(cards.map((c) => c.rank));
  if (ranks.size === 1 && cards.length <= 4 && sumValues(cards) <= 10) return cards;

  return null;
}

function removeIndices(hand, indices) {
  const sorted = [...new Set(indices)].sort((a, b) => b - a);
  const removed = [];
  for (const i of sorted) removed.unshift(hand.splice(i, 1)[0]);
  return removed;
}

function heartsPower(room, n) {
  shuffle(room.discardPile);
  const take = room.discardPile.splice(0, Math.min(n, room.discardPile.length));
  room.tavernDeck.push(...take);
  if (take.length) pushLog(room, `하트 효과: 버린 카드 ${take.length}장이 여관 더미 밑으로 돌아갑니다.`);
}

function diamondsPower(room, n, startIdx) {
  let drawn = 0;
  let idx = startIdx;
  let guard = 0;
  const maxGuard = room.numPlayers * (n + 2) + 10;
  while (drawn < n && room.tavernDeck.length > 0 && guard < maxGuard) {
    const p = room.players[idx];
    if (p.hand.length < room.maxHand) {
      p.hand.push(room.tavernDeck.shift());
      drawn++;
    }
    idx = (idx + 1) % room.numPlayers;
    guard++;
  }
  if (drawn) pushLog(room, `다이아몬드 효과: 카드 ${drawn}장을 나눠 뽑았습니다.`);
}

function checkStuck(room) {
  if (room.phase !== 'play') return;
  const p = room.players[room.currentPlayerIdx];
  // In solo mode there's no yield to fall back on, so an empty hand is an
  // immediate dead end. In multiplayer, a player can still yield unless the
  // previous player already did.
  const stuck = p.hand.length === 0 && (room.numPlayers === 1 || room.lastActionWasYield);
  if (stuck) {
    room.phase = 'lose';
    pushLog(room, `${p.name}에게 낼 카드가 없어 더 이상 진행할 수 없습니다. 패배했습니다.`);
  }
}

function advanceToNextPlayer(room) {
  room.currentPlayerIdx = (room.currentPlayerIdx + 1) % room.numPlayers;
  room.phase = 'play';
  room.pendingDefend = null;
  checkStuck(room);
  if (room.phase === 'play') {
    pushLog(room, `${room.players[room.currentPlayerIdx].name}의 차례입니다.`);
  }
}

function defeatEnemy(room, exact) {
  if (exact) {
    room.tavernDeck.unshift(room.currentEnemy);
    pushLog(room, `${cardLabel(room.currentEnemy)}을(를) 정확히 처치! 여관 더미 위로 돌아갑니다.`);
  } else {
    room.discardPile.push(room.currentEnemy);
    pushLog(room, `${cardLabel(room.currentEnemy)}을(를) 처치했습니다!`);
  }
  room.discardPile.push(...room.cardsInPlayThisFight);
  room.cardsInPlayThisFight = [];
  room.enemySpadeReduction = 0;
  room.enemyImmunityRemoved = false;

  if (room.castleDeck.length === 0) {
    room.currentEnemy = null;
    room.phase = 'win';
    pushLog(room, '모든 적을 물리쳤습니다! 플레이어들의 승리입니다!');
    return;
  }
  room.currentEnemy = room.castleDeck.shift();
  room.enemyHealthRemaining = room.currentEnemy.health;
  room.phase = 'play';
  room.lastActionWasYield = false;
  pushLog(room, `다음 적이 나타났습니다: ${cardLabel(room.currentEnemy)}`);
  checkStuck(room);
}

function handlePlay(room, playerIdx, indices) {
  if (room.phase !== 'play' || playerIdx !== room.currentPlayerIdx) return { error: '지금은 카드를 낼 수 없습니다.' };
  const hand = room.players[playerIdx].hand;
  const selected = validateSelection(hand, indices);
  if (!selected) return { error: '유효하지 않은 카드 조합입니다.' };

  const attackValue = sumValues(selected);
  const suitsInPlay = [...new Set(selected.map((c) => c.suit).filter(Boolean))];

  // Played cards leave the hand immediately (placed on the table) before any
  // suit power resolves, so e.g. Diamonds' draw sees the player's true hand size.
  removeIndices(hand, indices);
  room.cardsInPlayThisFight.push(...selected.map((c) => ({ ...c, by: playerIdx })));

  let multiplier = 1;
  for (const suit of suitsInPlay) {
    const immune = room.currentEnemy.suit === suit && !room.enemyImmunityRemoved;
    if (immune) {
      pushLog(room, `${cardLabel(room.currentEnemy)}은(는) 이 문양에 면역입니다. (효과 무시)`);
      continue;
    }
    if (suit === 'H') heartsPower(room, attackValue);
    else if (suit === 'D') diamondsPower(room, attackValue, playerIdx);
    else if (suit === 'C') multiplier = 2;
    else if (suit === 'S') {
      room.enemySpadeReduction += attackValue;
      pushLog(room, `스페이드 효과: 적의 공격력이 ${attackValue}만큼 감소합니다.`);
    }
  }

  const damage = attackValue * multiplier;
  room.enemyHealthRemaining -= damage;

  pushLog(
    room,
    `${room.players[playerIdx].name}가 ${selected.map(cardLabel).join(' + ')} 냄 (공격력 ${attackValue}) → ${damage} 피해!`
  );

  if (room.enemyHealthRemaining <= 0) {
    defeatEnemy(room, room.enemyHealthRemaining === 0);
  } else {
    const required = currentEnemyAttack(room);
    if (required === 0) {
      pushLog(room, `${cardLabel(room.currentEnemy)}의 공격력이 0이 되어 피해를 받지 않습니다.`);
      advanceToNextPlayer(room);
    } else {
      const handSum = sumValues(hand);
      if (handSum < required) {
        room.phase = 'lose';
        pushLog(room, `${room.players[playerIdx].name}가 ${required} 피해를 감당할 카드가 부족합니다. 패배했습니다.`);
      } else {
        room.phase = 'defend';
        room.pendingDefend = { required, isYield: false };
        pushLog(room, `적의 반격! ${room.players[playerIdx].name}는 ${required}만큼 카드를 버려야 합니다.`);
      }
    }
  }
  return {};
}

function handleJester(room, playerIdx) {
  if (room.phase !== 'play' || playerIdx !== room.currentPlayerIdx) return { error: '지금은 어릿광대를 낼 수 없습니다.' };
  const hand = room.players[playerIdx].hand;
  const jokerIdx = hand.findIndex((c) => c.rank === 'JOKER');
  if (jokerIdx === -1) return { error: '어릿광대 카드가 없습니다.' };
  const [joker] = hand.splice(jokerIdx, 1);
  room.discardPile.push(joker);

  if (room.numPlayers === 1) {
    // Solo variant: instead of removing enemy immunity, discard the rest
    // of the hand and draw a fresh one.
    room.discardPile.push(...hand.splice(0, hand.length));
    let drawn = 0;
    while (hand.length < room.maxHand && room.tavernDeck.length) {
      hand.push(room.tavernDeck.shift());
      drawn++;
    }
    pushLog(room, `${room.players[playerIdx].name}가 어릿광대를 냈습니다. 손패를 모두 버리고 ${drawn}장을 새로 뽑았습니다.`);
    return {};
  }

  room.enemyImmunityRemoved = true;
  room.phase = 'chooseNext';
  pushLog(room, `${room.players[playerIdx].name}가 어릿광대를 냈습니다. ${cardLabel(room.currentEnemy)}의 면역이 사라집니다.`);
  return {};
}

function handleChooseNext(room, playerIdx, targetIdx) {
  if (room.phase !== 'chooseNext' || playerIdx !== room.currentPlayerIdx) return { error: '지금은 다음 플레이어를 고를 수 없습니다.' };
  if (targetIdx === playerIdx || targetIdx < 0 || targetIdx >= room.numPlayers) return { error: '유효하지 않은 대상입니다.' };
  room.currentPlayerIdx = targetIdx;
  room.phase = 'play';
  room.lastActionWasYield = false;
  pushLog(room, `${room.players[targetIdx].name}의 차례로 넘어갑니다.`);
  checkStuck(room);
  return {};
}

function handleRequestYield(room, playerIdx) {
  if (room.phase !== 'play') return { error: '지금은 요청할 수 없습니다.' };
  if (playerIdx === room.currentPlayerIdx) return { error: '자신에게는 요청할 수 없습니다.' };
  const requester = room.players[playerIdx].name;
  const current = room.players[room.currentPlayerIdx].name;
  pushLog(room, `🙏 ${requester}가 ${current}에게 양보를 요청했습니다!`);
  return {};
}

function handleYield(room, playerIdx) {
  if (room.numPlayers === 1) return { error: '싱글모드에서는 양보할 수 없습니다.' };
  if (room.phase !== 'play' || playerIdx !== room.currentPlayerIdx) return { error: '지금은 양보할 수 없습니다.' };
  if (room.lastActionWasYield) return { error: '연속으로 양보할 수 없습니다.' };
  const required = currentEnemyAttack(room);
  const hand = room.players[playerIdx].hand;
  pushLog(room, `${room.players[playerIdx].name}가 양보했습니다.`);
  if (required === 0) {
    advanceToNextPlayer(room);
    room.lastActionWasYield = true;
  } else {
    const handSum = sumValues(hand);
    if (handSum < required) {
      room.phase = 'lose';
      pushLog(room, `${room.players[playerIdx].name}가 ${required} 피해를 감당할 카드가 부족합니다. 패배했습니다.`);
    } else {
      room.phase = 'defend';
      room.pendingDefend = { required, isYield: true };
    }
  }
  return {};
}

function handleDiscard(room, playerIdx, indices) {
  if (room.phase !== 'defend' || playerIdx !== room.currentPlayerIdx) return { error: '지금은 카드를 버릴 수 없습니다.' };
  const hand = room.players[playerIdx].hand;
  const uniq = [...new Set(indices)];
  if (uniq.some((i) => i < 0 || i >= hand.length)) return { error: '유효하지 않은 카드입니다.' };
  const selected = uniq.map((i) => hand[i]);
  const sum = sumValues(selected);
  if (sum < room.pendingDefend.required) return { error: `충분하지 않습니다. (${sum} / ${room.pendingDefend.required} 필요)` };

  removeIndices(hand, uniq);
  room.discardPile.push(...selected);
  const wasYield = room.pendingDefend.isYield;
  pushLog(room, `${room.players[playerIdx].name}가 카드 ${selected.length}장을 버려 피해를 막았습니다.`);
  advanceToNextPlayer(room);
  room.lastActionWasYield = !!wasYield;
  return {};
}

// ---------- Broadcasting ----------
function lobbyView(room) {
  return {
    type: 'lobby',
    code: room.code,
    started: room.started,
    players: room.players.map((p) => ({ name: p.name, connected: p.connected })),
  };
}

function stateViewFor(room, viewerIdx) {
  const you = room.players[viewerIdx];
  return {
    type: 'state',
    code: room.code,
    phase: room.phase,
    yourIdx: viewerIdx,
    numPlayers: room.numPlayers,
    players: room.players.map((p, i) => ({
      name: p.name,
      connected: p.connected,
      handCount: p.hand ? p.hand.length : 0,
    })),
    currentPlayerIdx: room.currentPlayerIdx,
    currentEnemy: room.currentEnemy
      ? {
          suit: room.currentEnemy.suit,
          rank: room.currentEnemy.rank,
          baseValue: room.currentEnemy.value,
          value: currentEnemyAttack(room),
          health: room.currentEnemy.health,
          healthRemaining: room.enemyHealthRemaining,
        }
      : null,
    enemyImmunityRemoved: room.enemyImmunityRemoved,
    castleCount: room.castleDeck.length,
    tavernCount: room.tavernDeck.length,
    discardCount: room.discardPile.length,
    discardTop: room.discardPile.length
      ? (({ suit, rank, value }) => ({ suit, rank, value }))(room.discardPile[room.discardPile.length - 1])
      : null,
    cardsInPlay: room.cardsInPlayThisFight.map(({ suit, rank, value, by }) => ({ suit, rank, value, by })),
    pendingDefend: room.pendingDefend,
    lastActionWasYield: room.lastActionWasYield,
    log: room.log.slice(-40),
    yourHand: you && you.hand ? you.hand : [],
  };
}

function broadcastLobby(room) {
  const msg = JSON.stringify(lobbyView(room));
  for (const p of room.players) {
    if (p.ws && p.ws.readyState === 1) p.ws.send(msg);
  }
}

function broadcastState(room) {
  room.players.forEach((p, i) => {
    if (p.ws && p.ws.readyState === 1) {
      p.ws.send(JSON.stringify(stateViewFor(room, i)));
    }
  });
}

function broadcast(room) {
  if (room.started) broadcastState(room);
  else broadcastLobby(room);
}

// ---------- WebSocket routing ----------
wss.on('connection', (ws) => {
  let room = null;
  let playerId = null;
  let seat = -1;

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (e) {
      return;
    }

    if (msg.type === 'create') {
      room = createRoom();
      playerId = genId();
      const name = (msg.name || '플레이어').slice(0, 20);
      room.players.push({ id: playerId, name, ws, connected: true, hand: [] });
      seat = 0;
      ws.send(JSON.stringify({ type: 'joined', code: room.code, playerId, seat }));
      broadcastLobby(room);
      return;
    }

    if (msg.type === 'join') {
      const code = (msg.code || '').toUpperCase();
      const target = rooms.get(code);
      if (!target) {
        ws.send(JSON.stringify({ type: 'error', message: '방을 찾을 수 없습니다.' }));
        return;
      }
      if (target.started) {
        ws.send(JSON.stringify({ type: 'error', message: '이미 시작된 게임입니다.' }));
        return;
      }
      if (target.players.length >= 4) {
        ws.send(JSON.stringify({ type: 'error', message: '방이 가득 찼습니다. (최대 4명)' }));
        return;
      }
      room = target;
      playerId = genId();
      const name = (msg.name || '플레이어').slice(0, 20);
      room.players.push({ id: playerId, name, ws, connected: true, hand: [] });
      seat = room.players.length - 1;
      ws.send(JSON.stringify({ type: 'joined', code: room.code, playerId, seat }));
      broadcastLobby(room);
      return;
    }

    if (msg.type === 'rejoin') {
      const code = (msg.code || '').toUpperCase();
      const target = rooms.get(code);
      if (!target) {
        ws.send(JSON.stringify({ type: 'error', message: '방을 찾을 수 없습니다.' }));
        return;
      }
      const idx = target.players.findIndex((p) => p.id === msg.playerId);
      if (idx === -1) {
        ws.send(JSON.stringify({ type: 'error', message: '재접속 정보를 찾을 수 없습니다.' }));
        return;
      }
      room = target;
      playerId = msg.playerId;
      seat = idx;
      room.players[idx].ws = ws;
      room.players[idx].connected = true;
      ws.send(JSON.stringify({ type: 'joined', code: room.code, playerId, seat }));
      broadcast(room);
      return;
    }

    if (!room || seat === -1) return;

    if (msg.type === 'start') {
      if (seat !== 0) return;
      if (room.players.length < 1) return;
      if (room.started) return;
      startGame(room);
      broadcastState(room);
      return;
    }

    if (msg.type === 'action' && room.started) {
      let result = {};
      if (msg.action === 'play') result = handlePlay(room, seat, msg.indices || []);
      else if (msg.action === 'jester') result = handleJester(room, seat);
      else if (msg.action === 'yield') result = handleYield(room, seat);
      else if (msg.action === 'discard') result = handleDiscard(room, seat, msg.indices || []);
      else if (msg.action === 'chooseNext') result = handleChooseNext(room, seat, msg.targetIdx);
      else if (msg.action === 'requestYield') result = handleRequestYield(room, seat);

      if (result && result.error) {
        ws.send(JSON.stringify({ type: 'error', message: result.error }));
      } else {
        broadcastState(room);
      }
      return;
    }
  });

  ws.on('close', () => {
    if (room && seat !== -1 && room.players[seat]) {
      room.players[seat].connected = false;
      broadcast(room);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Regicide server listening on port ${PORT}`);
});
