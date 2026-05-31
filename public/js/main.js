// ============================================================
// Kitchen Chaos - クライアント メイン制御
// 画面遷移 / Socket通信 / ロビー / ゲーム起動
// ============================================================
import { LEVELS } from '/shared/gamedata.js';
import { Game } from './game.js';

const socket = io();
let myId = null;
let roomCode = null;
let isHost = false;
let lobbyState = null;
let game = null;

// ---- DOM ----
const screens = {
  menu: document.getElementById('screen-menu'),
  lobby: document.getElementById('screen-lobby'),
  game: document.getElementById('screen-game'),
  result: document.getElementById('screen-result'),
};
function show(name) {
  for (const k in screens) screens[k].classList.toggle('active', k === name);
}

const nameInput = document.getElementById('player-name');
nameInput.value = localStorage.getItem('kc_name') || '';
nameInput.addEventListener('input', () => localStorage.setItem('kc_name', nameInput.value));
function getName() { return (nameInput.value || '').trim() || 'シェフ' + Math.floor(Math.random() * 99); }

const menuError = document.getElementById('menu-error');

// ---- メニュー操作 ----
document.getElementById('btn-ai').onclick = () => {
  socket.emit('create_room', { name: getName(), mode: 'ai' }, (res) => {
    if (res.ok) { enterLobby(res); }
    else menuError.textContent = res.error || 'エラー';
  });
};
document.getElementById('btn-create').onclick = () => {
  socket.emit('create_room', { name: getName(), mode: 'multi' }, (res) => {
    if (res.ok) { enterLobby(res); }
    else menuError.textContent = res.error || 'エラー';
  });
};
const joinBox = document.getElementById('join-box');
document.getElementById('btn-join').onclick = () => {
  joinBox.classList.toggle('hidden');
  document.getElementById('join-code').focus();
};
document.getElementById('btn-join-go').onclick = doJoin;
document.getElementById('join-code').addEventListener('keydown', e => { if (e.key === 'Enter') doJoin(); });
function doJoin() {
  const code = document.getElementById('join-code').value.toUpperCase().trim();
  if (code.length < 4) { menuError.textContent = 'コードを4文字入力してね'; return; }
  socket.emit('join_room', { name: getName(), code }, (res) => {
    if (res.ok) { enterLobby(res); }
    else menuError.textContent = res.error || 'エラー';
  });
}

// URLに ?room=XXXX があれば自動で参加欄に入れる
const urlParams = new URLSearchParams(location.search);
const presetRoom = urlParams.get('room');
if (presetRoom) {
  document.getElementById('join-code').value = presetRoom.toUpperCase();
  joinBox.classList.remove('hidden');
}

// ---- ロビー ----
function enterLobby(res) {
  myId = res.you;
  roomCode = res.code;
  menuError.textContent = '';
  document.getElementById('lobby-code').textContent = roomCode;
  show('lobby');
  buildLevelButtons();
}

socket.on('connect', () => { myId = socket.id; });

socket.on('lobby', (state) => {
  lobbyState = state;
  isHost = state.hostId === myId;
  renderLobby(state);
});

function renderLobby(state) {
  document.getElementById('lobby-code').textContent = state.code;
  const modeHint = document.getElementById('lobby-mode-hint');
  modeHint.textContent = state.mode === 'ai'
    ? 'AIモード: AIシェフと協力プレイ'
    : '協力モード: 友達を招待しよう (最大4人)';

  // 招待リンク行はAIモードでは隠す
  document.getElementById('share-row').style.display = state.mode === 'ai' ? 'none' : 'flex';

  // プレイヤー一覧
  const list = document.getElementById('player-list');
  list.innerHTML = '';
  for (const p of state.players) {
    const row = document.createElement('div');
    row.className = 'player-row';
    const tags = [];
    if (p.id === state.hostId) tags.push('<span class="player-tag host">ホスト</span>');
    if (p.isAI) tags.push('<span class="player-tag ai">AI</span>');
    if (p.id === myId) tags.push('<span class="player-tag">あなた</span>');
    row.innerHTML = `
      <span class="player-dot" style="background:${p.color}"></span>
      <span class="player-name">${escapeHtml(p.name)}</span>
      ${tags.join('')}`;
    list.appendChild(row);
  }

  // ホスト専用操作
  const startBtn = document.getElementById('btn-start');
  startBtn.disabled = !isHost;
  startBtn.textContent = isHost ? 'スタート！' : 'ホストの開始を待っています…';
  document.getElementById('btn-add-ai').style.display = isHost ? '' : 'none';
  document.getElementById('btn-remove-ai').style.display = (isHost && state.players.some(p => p.isAI)) ? '' : 'none';

  // レベル選択ハイライト
  document.querySelectorAll('.level-btn').forEach((b, i) => {
    b.classList.toggle('selected', i === state.levelIndex);
    b.style.pointerEvents = isHost ? 'auto' : 'none';
    b.style.opacity = isHost ? '1' : '.7';
  });
}

function buildLevelButtons() {
  const c = document.getElementById('level-buttons');
  c.innerHTML = '';
  LEVELS.forEach((lv, i) => {
    const b = document.createElement('button');
    b.className = 'level-btn';
    b.textContent = `${i + 1}. ${lv.name}`;
    b.onclick = () => { if (isHost) socket.emit('set_level', { levelIndex: i }); };
    c.appendChild(b);
  });
}

document.getElementById('btn-add-ai').onclick = () => socket.emit('add_ai', {}, () => {});
document.getElementById('btn-remove-ai').onclick = () => socket.emit('remove_ai', {}, () => {});
document.getElementById('btn-start').onclick = () => {
  socket.emit('start_game', {}, (res) => {
    if (res && !res.ok) document.getElementById('lobby-error').textContent = res.error;
  });
};
document.getElementById('btn-leave').onclick = () => {
  socket.emit('leave_room');
  roomCode = null; isHost = false;
  show('menu');
};

document.getElementById('btn-copy').onclick = async () => {
  const link = `${location.origin}${location.pathname}?room=${roomCode}`;
  try {
    await navigator.clipboard.writeText(link);
    document.getElementById('copy-done').textContent = 'コピーしました！';
  } catch {
    document.getElementById('copy-done').textContent = link;
  }
  setTimeout(() => document.getElementById('copy-done').textContent = '', 2500);
};

// ---- ゲーム開始 ----
socket.on('game_start', (snap) => {
  show('game');
  if (!game) game = new Game(socket, () => myId);
  game.start(snap);
});

socket.on('snapshot', (snap) => {
  if (game) game.onSnapshot(snap);
});

socket.on('game_over', (data) => {
  if (game) game.stop();
  showResult(data);
});

function showResult(data) {
  show('result');
  document.getElementById('result-score').textContent = '⭐ ' + data.score;
  document.getElementById('result-level').textContent = data.level || '';
  // 星評価
  let stars = 1;
  if (data.score >= 250) stars = 3;
  else if (data.score >= 120) stars = 2;
  document.getElementById('result-stars').textContent = '⭐'.repeat(stars) + '☆'.repeat(3 - stars);
  document.getElementById('result-title').textContent =
    stars === 3 ? 'パーフェクト！🎉' : stars === 2 ? 'グッジョブ！👍' : 'クリア！';
}

document.getElementById('btn-result-back').onclick = () => {
  socket.emit('back_to_lobby');
  show('lobby');
};

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// 接続切れ
socket.on('disconnect', () => {
  if (game) game.stop();
});

// ---- デバッグ: ?auto=1 でAIゲームを自動開始(描画検証用) ----
if (urlParams.get('auto') === '1') {
  socket.on('connect', () => {
    setTimeout(() => {
      socket.emit('create_room', { name: 'Tester', mode: 'ai' }, (res) => {
        if (!res.ok) { console.error('AUTO create fail', res.error); return; }
        myId = res.you; roomCode = res.code;
        const lvl = parseInt(urlParams.get('lvl') || '0', 10);
        socket.emit('set_level', { levelIndex: lvl });
        socket.emit('add_ai', {}, () => {
          socket.emit('add_ai', {}, () => {
            socket.emit('start_game', {}, (r) => {
              if (r && !r.ok) console.error('AUTO start fail', r.error);
              else console.log('AUTO game started');
            });
          });
        });
      });
    }, 300);
  });
}
