// ============================================================
// Kitchen Chaos - サーバー本体
// Express で静的配信、Socket.IO でルーム管理 & リアルタイム同期
// ============================================================
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { GameRoom } from './game.js';
import { attachAI } from './ai.js';
import { LEVELS } from '../shared/gamedata.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const server = createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3000;

// 静的ファイル
app.use(express.static(join(__dirname, '..', 'public')));
// sharedを配信(クライアントからimportするため)
app.use('/shared', express.static(join(__dirname, '..', 'shared')));

app.get('/health', (req, res) => res.json({ ok: true, rooms: rooms.size }));

// ============================================================
// ルーム管理
// ============================================================
const rooms = new Map(); // code -> GameRoom

function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = '';
    for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  } while (rooms.has(code));
  return code;
}

function broadcastLobby(room) {
  io.to(room.code).emit('lobby', room.lobbySnapshot());
}

io.on('connection', (socket) => {
  let currentRoom = null;
  let playerName = 'Chef';

  // --- ルーム作成 ---
  socket.on('create_room', ({ name, mode }, cb) => {
    const code = genCode();
    const room = new GameRoom(code, { mode: mode || 'multi', levelIndex: 0 });
    rooms.set(code, room);
    room.loadLevel(0);
    room.addPlayer(socket.id, name);
    if (mode === 'ai') attachAI(room);
    socket.join(code);
    currentRoom = room;
    playerName = name;
    cb && cb({ ok: true, code, you: socket.id });
    broadcastLobby(room);
  });

  // --- ルーム参加 ---
  socket.on('join_room', ({ name, code }, cb) => {
    code = (code || '').toUpperCase().trim();
    const room = rooms.get(code);
    if (!room) return cb && cb({ ok: false, error: 'ルームが見つかりません' });
    if (room.players.size >= 4) return cb && cb({ ok: false, error: 'ルームが満員です' });
    if (room.state === 'playing') return cb && cb({ ok: false, error: 'ゲーム進行中です' });
    room.addPlayer(socket.id, name);
    socket.join(code);
    currentRoom = room;
    playerName = name;
    cb && cb({ ok: true, code, you: socket.id });
    broadcastLobby(room);
  });

  // --- AIシェフ追加(ホストのみ) ---
  socket.on('add_ai', (_, cb) => {
    if (!currentRoom || currentRoom.hostId !== socket.id) return;
    if (currentRoom.players.size >= 4) return cb && cb({ ok: false, error: '満員です' });
    const aiId = 'AI_' + Math.random().toString(36).slice(2, 8);
    const aiNames = ['ロボシェフ', 'クッキーAI', 'シェフボット', 'みならいAI'];
    const n = aiNames[currentRoom.aiPlayers.length % aiNames.length];
    currentRoom.addPlayer(aiId, n, true);
    if (!currentRoom._aiBrain) attachAI(currentRoom);
    broadcastLobby(currentRoom);
    cb && cb({ ok: true });
  });

  socket.on('remove_ai', (_, cb) => {
    if (!currentRoom || currentRoom.hostId !== socket.id) return;
    const aiId = currentRoom.aiPlayers[currentRoom.aiPlayers.length - 1];
    if (aiId) currentRoom.removePlayer(aiId);
    broadcastLobby(currentRoom);
    cb && cb({ ok: true });
  });

  // --- レベル選択(ホスト) ---
  socket.on('set_level', ({ levelIndex }, cb) => {
    if (!currentRoom || currentRoom.hostId !== socket.id) return;
    currentRoom.levelIndex = Math.max(0, Math.min(LEVELS.length - 1, levelIndex | 0));
    currentRoom.loadLevel(currentRoom.levelIndex);
    broadcastLobby(currentRoom);
    cb && cb({ ok: true });
  });

  // --- ゲーム開始(ホスト) ---
  socket.on('start_game', (_, cb) => {
    if (!currentRoom) return;
    if (currentRoom.hostId !== socket.id) return cb && cb({ ok: false, error: 'ホストのみ開始できます' });
    currentRoom.start();
    io.to(currentRoom.code).emit('game_start', currentRoom.snapshot());
    cb && cb({ ok: true });
  });

  // --- 入力 ---
  socket.on('input', (input) => {
    if (currentRoom && currentRoom.state === 'playing') {
      currentRoom.setInput(socket.id, input);
    }
  });

  // --- ロビーへ戻る(リザルト後) ---
  socket.on('back_to_lobby', () => {
    if (currentRoom) {
      currentRoom.state = 'lobby';
      broadcastLobby(currentRoom);
    }
  });

  // --- 退出 ---
  socket.on('leave_room', () => {
    leave();
  });

  socket.on('disconnect', () => {
    leave();
  });

  function leave() {
    if (currentRoom) {
      currentRoom.removePlayer(socket.id);
      socket.leave(currentRoom.code);
      if (currentRoom.players.size === 0 || [...currentRoom.players.values()].every(p => p.isAI)) {
        rooms.delete(currentRoom.code);
      } else {
        broadcastLobby(currentRoom);
      }
      currentRoom = null;
    }
  }
});

// ============================================================
// ゲームループ: 全playing中ルームを更新し、スナップショット配信
// ============================================================
const TICK_MS = 1000 / 30; // 30fps配信
setInterval(() => {
  for (const room of rooms.values()) {
    if (room.state === 'playing') {
      const prevState = room.state;
      room.update();
      io.to(room.code).emit('snapshot', room.snapshot());
      if (prevState === 'playing' && room.state === 'finished') {
        io.to(room.code).emit('game_over', {
          score: room.score,
          level: room.level ? room.level.name : '',
        });
      }
    }
  }
}, TICK_MS);

// 物理は内部で dt 計算するので別途高頻度update不要だが、
// 移動を滑らかにするため update を高頻度で回し、配信だけ間引く構成にする。
// ↑ 上のsetIntervalで update+配信を同時実行(30fps)。十分滑らか。

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🍳 Kitchen Chaos server running on http://0.0.0.0:${PORT}`);
});
