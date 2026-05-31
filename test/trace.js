import { GameRoom } from '../server/game.js';
import { attachAI } from '../server/ai.js';
let vn = 1e6; Date.now = () => vn;
const room = new GameRoom('T', { mode: 'ai', levelIndex: 0 }); room.loadLevel(0);
room.addPlayer('AI_a', 'A', true); attachAI(room); room.start();
room.orders = [{ id: 9, recipe: 'salad', timeLeft: 999, maxTime: 999 }]; room._spawnOrder = () => {};
const p = room.players.get('AI_a');
const FPS = 30, dtm = 1000 / FPS;
for (let i = 0; i < FPS * 25; i++) {
  vn += dtm; room.update();
  if (i % 20 === 0) {
    let board = [];
    for (let y = 0; y < room.height; y++) for (let x = 0; x < room.width; x++) {
      const c = room.stations[y][x];
      if (c.item) board.push(`(${x},${y})` + c.station + '=' + (c.item.kind === 'plate' ? 'PL[' + c.item.contents.map(t => t.type[0] + t.state[0]).join(',') + ']' : c.item.type[0] + c.item.state[0]));
    }
    const hold = p.holding ? (p.holding.kind === 'plate' ? 'PL[' + p.holding.contents.map(t => t.type[0]).join('') + ']' : p.holding.type[0] + p.holding.state[0]) : '-';
    console.log((i / FPS).toFixed(1), 'hold=' + hold, 'goal=' + (p.ai.goal ? p.ai.goal.type : 'X'), 'ctr=' + p.ai.counterKey, '|', board.join(' '));
  }
}
console.log('score', room.score);
