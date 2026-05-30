// AIシェフが実際に料理を完成・提供できるかをヘッドレスでシミュレーション
// 仮想時計でゲームを高速に進める
import { GameRoom } from '../server/game.js';
import { attachAI } from '../server/ai.js';

// Date.now をモックして仮想時間を進める
let virtualNow = 1_000_000;
const realNow = Date.now;
Date.now = () => virtualNow;

const room = new GameRoom('TEST', { mode: 'ai', levelIndex: 0 });
room.loadLevel(0);
room.addPlayer('human1', 'Player', false);
room.addPlayer('AI_a', 'AI-A', true);
room.addPlayer('AI_b', 'AI-B', true);
attachAI(room);
room.start();

const FPS = 30;
const dt_ms = 1000 / FPS;
const dur = room.level.duration; // フルレベル
const steps = FPS * dur;
let serves = 0, fails = 0;

for (let i = 0; i < steps; i++) {
  virtualNow += dt_ms;
  room.update();
  for (const ev of room.events) {
    if (ev.type === 'serve_ok') serves++;
    if (ev.type === 'order_fail') fails++;
  }
  if (room.state === 'finished') break;
}

Date.now = realNow;

console.log('=== AI Simulation result (Level 1, full duration) ===');
console.log('提供成功:', serves, '/ 注文失敗:', fails);
console.log('Score:', room.score);
console.log('Orders remaining:', room.orders.length);
for (const id of room.aiPlayers) {
  const p = room.players.get(id);
  console.log(`  ${p.name}: holding=`, p.holding ? (p.holding.kind === 'plate' ? `plate[${p.holding.contents.map(c=>c.type+':'+c.state)}]` : p.holding.type+':'+p.holding.state) : 'nothing', 'goal=', p.ai.goal?.type);
}
let onBoard = [];
for (let y=0;y<room.height;y++) for (let x=0;x<room.width;x++){
  const c = room.stations[y][x];
  if (c.item) onBoard.push(`${c.station}=${c.item.kind==='plate'?'plate['+c.item.contents.map(ct=>ct.type+':'+ct.state)+']':c.item.type+':'+c.item.state}`);
}
console.log('On board:', onBoard);
