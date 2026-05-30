// 1体のAIだけを追って、なぜ料理が進まないかをトレース
import { GameRoom } from '../server/game.js';
import { attachAI } from '../server/ai.js';

let virtualNow = 1_000_000;
Date.now = () => virtualNow;

const room = new GameRoom('TEST', { mode: 'ai', levelIndex: 0 });
room.loadLevel(0);
room.addPlayer('AI_a', 'AI-A', true);
attachAI(room);
room.start();
// 注文を1つに固定(saladのみ)
room.orders = [{ id: 999, recipe: 'salad', timeLeft: 999, maxTime: 999 }];
room.lastOrderTime = Date.now() + 1e9; // 新規注文止める
room._spawnOrder = () => {};

const FPS = 30, dt_ms = 1000 / FPS;
const p = room.players.get('AI_a');

for (let i = 0; i < FPS * 30; i++) {
  virtualNow += dt_ms;
  room.update();
  if (i % 15 === 0) {
    const f = room._facingCell(p);
    console.log(
      `t=${(i/FPS).toFixed(1)}s pos=(${p.x.toFixed(0)},${p.y.toFixed(0)})`,
      'hold=', p.holding ? (p.holding.kind==='plate'?'plate['+p.holding.contents.map(c=>c.type+':'+c.state)+']':p.holding.type+':'+p.holding.state) : 'none',
      'goal=', p.ai.goal ? `${p.ai.goal.type}@(${p.ai.goal.cell.tx},${p.ai.goal.cell.ty})` : 'none',
      'facing=', f ? `(${f.tx},${f.ty})${f.cell.station}` : 'none',
      'interact=', p.input.interact
    );
  }
  for (const ev of room.events) if (ev.type === 'serve_ok') console.log('  >>> SERVED! score', room.score);
}
console.log('final score', room.score);
