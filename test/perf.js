// 全レベル × AI人数 のパフォーマンス計測 (ヘッドレス, 仮想時計)
import { GameRoom } from '../server/game.js';
import { attachAI } from '../server/ai.js';
import { LEVELS } from '../shared/gamedata.js';

let virtualNow = 1_000_000;
const realNow = Date.now;
Date.now = () => virtualNow;

function run(levelIndex, aiCount) {
  virtualNow = 1_000_000 + Math.floor(Math.random() * 1000);
  const room = new GameRoom('T', { mode: 'ai', levelIndex });
  room.loadLevel(levelIndex);
  room.addPlayer('human1', 'P', false);
  for (let i = 0; i < aiCount; i++) room.addPlayer('AI_' + i, 'AI' + i, true);
  attachAI(room);
  room.start();

  const FPS = 30, dt_ms = 1000 / FPS;
  const steps = FPS * room.level.duration;
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
  return { serves, fails, score: room.score };
}

console.log('=== Kitchen Chaos AI performance ===');
for (let lvl = 0; lvl < LEVELS.length; lvl++) {
  for (const ai of [1, 2, 3]) {
    const r = run(lvl, ai);
    const ratio = r.serves + r.fails > 0 ? (100 * r.serves / (r.serves + r.fails)).toFixed(0) : '--';
    console.log(`Lv${lvl + 1} (${LEVELS[lvl].name}) AI×${ai}: serve=${r.serves} fail=${r.fails} success=${ratio}% score=${r.score}`);
  }
}
Date.now = realNow;
