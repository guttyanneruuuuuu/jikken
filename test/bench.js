// 各設定をN回走らせて平均を出す(分散が大きいので平均で評価)
import { GameRoom } from '../server/game.js';
import { attachAI } from '../server/ai.js';
import { LEVELS } from '../shared/gamedata.js';

let virtualNow = 1_000_000;
const realNow = Date.now;
Date.now = () => virtualNow;

function run(levelIndex, aiCount, seed) {
  virtualNow = 1_000_000 + seed * 137;
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

const N = 6;
console.log(`=== AI bench (avg of ${N} runs) ===`);
for (let lvl = 0; lvl < LEVELS.length; lvl++) {
  for (const ai of [1, 2, 3]) {
    let s = 0, f = 0, sc = 0;
    for (let seed = 0; seed < N; seed++) { const r = run(lvl, ai, seed); s += r.serves; f += r.fails; sc += r.score; }
    const avgS = (s / N).toFixed(1), avgF = (f / N).toFixed(1), avgSc = Math.round(sc / N);
    const ratio = s + f > 0 ? (100 * s / (s + f)).toFixed(0) : '--';
    console.log(`Lv${lvl + 1} AI×${ai}: serve=${avgS} fail=${avgF} success=${ratio}% score=${avgSc}`);
  }
}
Date.now = realNow;
