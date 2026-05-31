// ============================================================
// Kitchen Chaos - AIシェフ (v3: 明示的ステートマシン)
//
// 各AIは独立して1つの注文を担当し、以下のフェーズを順に実行:
//   IDLE        : 担当注文を決める
//   GET_PLATE   : 皿置き場から皿を取る
//   PLACE_PLATE : 自分の専用カウンターに皿を置く
//   MAKE        : 不足食材を1つ作る(crate→切る→焼く→皿へ盛る)
//   SERVE       : 皿が完成したら持って提供口へ
//   CLEAN       : 汚れ皿を洗い場へ
//
// 専用カウンターを各AIに割り当て、皿の取り合いを防ぐ。
// 1つのサブゴール(移動先セル+動作)を ai.goal に持ち、到達したら実行。
// ============================================================
import {
  STATION, RECIPES, INGREDIENTS, CRATE_TO_INGREDIENT, TILE, TILE_SIZE,
} from '../shared/gamedata.js';

const INGREDIENT_TO_CRATE = {};
for (const [crate, ing] of Object.entries(CRATE_TO_INGREDIENT)) INGREDIENT_TO_CRATE[ing] = crate;

export function attachAI(room) {
  room._aiBrain = (room, dt) => {
    for (const id of room.aiPlayers) {
      const p = room.players.get(id);
      if (p) tickAI(room, p, dt);
    }
  };
}

// ============================================================
// 毎フレーム: 思考(=goal決定) → 移動/実行
// ============================================================
function tickAI(room, p, dt) {
  const ai = p.ai;
  ai.pulseCd = Math.max(0, (ai.pulseCd || 0) - dt);
  ai.think = (ai.think || 0) - dt;
  ai.stuck = ai.stuck || 0;

  // 作業中(その場長押し)は思考を止める
  const working = ai.goal && (ai.goal.act === 'chop' || ai.goal.act === 'cook' || ai.goal.act === 'wash');

  if (!working && (ai.think <= 0 || !ai.goal)) {
    decide(room, p);
    ai.think = 0.25;
  }

  if (!ai.goal) { p.input.mx = 0; p.input.my = 0; p.input.interact = false; return; }

  moveAndAct(room, p, dt);
}

// ============================================================
// 意思決定: ai.goal = { tx, ty, act } を設定
// act: 'pickup'(取る/置く兼用のpulse), 'chop', 'cook', 'wash', 'serve'... 実体はpulse/work
// ============================================================
function decide(room, p) {
  const ai = p.ai;
  ai.goal = null;

  const myCounter = ensureMyCounter(room, p);
  const h = p.holding;

  // === 持ち物による分岐 ===
  if (h) {
    if (h.kind === 'plate') {
      if (h.dirty) {
        // 汚れ皿 → 洗い場
        return setGoalStation(room, p, STATION.WASH, 'wash');
      }
      if (h.contents.length > 0) {
        // 中身あり皿
        if (matchesAnyOrder(room, h)) {
          return setGoalStation(room, p, STATION.SERVE, 'pulse'); // 提供
        }
        // 注文に合わない → ゴミ箱で中身を捨てる
        return setGoalStation(room, p, STATION.TRASH, 'pulse');
      }
      // 空の皿 → 自分のカウンターへ置く
      if (myCounter) {
        if (!myCounter.cell.item) return setGoal(myCounter.tx, myCounter.ty, 'pulse', ai);
        // 自分のカウンターが埋まってる(既に皿) → 別の空きカウンターへ
        const c = nearestEmptyCounter(room, p);
        if (c) return setGoal(c.tx, c.ty, 'pulse', ai);
      }
      return;
    }
    // 食材を持っている
    if (h.kind === 'ingredient') {
      if (h.state === 'burnt') return setGoalStation(room, p, STATION.TRASH, 'pulse');

      // 担当注文を決める
      const order = pickOrderFor(room, p, myCounter);
      const recipe = order ? RECIPES[order.recipe] : null;
      const req = recipe ? recipe.requires.find(r => r.type === h.type) : null;

      if (!recipe || !req) {
        // 不要な食材 → 捨てる
        return setGoalStation(room, p, STATION.TRASH, 'pulse');
      }
      const ing = INGREDIENTS[h.type];
      const target = req.state;

      // 切る
      if (ing.needChop && h.state === 'raw' && target !== 'raw') {
        const cut = nearestFree(room, p, STATION.CUTTING, h);
        if (cut) return setGoal(cut.tx, cut.ty, 'chop', ai);
      }
      // 焼く
      const cookReady = (h.state === 'chopped') || (h.state === 'raw' && !ing.needChop);
      if (ing.needCook && target === 'cooked' && cookReady && h.state !== 'cooked') {
        const stove = nearestFree(room, p, STATION.STOVE, h);
        if (stove) return setGoal(stove.tx, stove.ty, 'cook', ai);
      }
      // 完成 → 自分の皿へ盛る
      if (h.state === target) {
        if (myCounter && myCounter.cell.item && myCounter.cell.item.kind === 'plate' && !myCounter.cell.item.dirty) {
          return setGoal(myCounter.tx, myCounter.ty, 'pulse', ai);
        }
        // 皿が無い → 一旦空きカウンターへ置く(後で皿を用意)
        const c = nearestEmptyCounter(room, p, myCounter);
        if (c) return setGoal(c.tx, c.ty, 'pulse', ai);
      }
      // 加工先が埋まっている等 → 少し待つ(その場停止)
      return;
    }
  }

  // === 手ぶら ===
  const order = pickOrderFor(room, p, myCounter);
  if (!order) return; // やることなし
  ai.orderId = order.id;
  const recipe = RECIPES[order.recipe];
  const plate = (myCounter && myCounter.cell.item && myCounter.cell.item.kind === 'plate' && !myCounter.cell.item.dirty)
    ? myCounter.cell.item : null;

  // 皿が完成 → 提供のため取る
  if (plate && plateComplete(plate, recipe)) {
    return setGoal(myCounter.tx, myCounter.ty, 'pulse', ai);
  }

  // 皿がまだ無い → 皿置き場から取る
  if (myCounter && !myCounter.cell.item) {
    const stack = nearestStation(room, p, STATION.PLATE_STACK,
      s => (Array.isArray(s.cell.plates) ? s.cell.plates.length : (s.cell.plates || 0)) > 0);
    if (stack) return setGoal(stack.tx, stack.ty, 'pulse', ai);
  }

  // 自分のカウンター付近に「完成状態だが皿未投入」の食材があれば拾って盛る準備
  // (自分が直前にカウンターへ置いた完成食材を回収)
  const stray = findStrayCompleted(room, p, recipe, plate, myCounter);
  if (stray) return setGoal(stray.tx, stray.ty, 'pulse', ai);

  // 足りない食材を作る → crateから取得
  const need = nextNeeded(recipe, plate);
  if (need) {
    const crate = nearestStation(room, p, INGREDIENT_TO_CRATE[need.type]);
    if (crate) return setGoal(crate.tx, crate.ty, 'pulse', ai);
  }
}

// ============================================================
// 移動 & 到達時アクション
// ============================================================
function moveAndAct(room, p, dt) {
  const ai = p.ai;
  const g = ai.goal;
  const stand = bestStand(room, p, g.tx, g.ty);
  if (!stand) { ai.goal = null; p.input.mx = 0; p.input.my = 0; p.input.interact = false; return; }

  const dx = stand.x - p.x, dy = stand.y - p.y;
  const dist = Math.hypot(dx, dy);

  if (dist > TILE_SIZE * 0.28) {
    p.input.mx = dx / dist; p.input.my = dy / dist; p.input.interact = false;
    // スタック検知
    if (ai.lastX !== undefined) {
      const moved = Math.hypot(p.x - ai.lastX, p.y - ai.lastY);
      ai.stuck = moved < 0.4 ? ai.stuck + dt : 0;
    }
    ai.lastX = p.x; ai.lastY = p.y;
    if (ai.stuck > 1.0) {
      ai.stuck = 0; ai.goal = null;
      p.input.mx = (Math.random() - 0.5) * 2;
      p.input.my = (Math.random() - 0.5) * 2;
    }
    return;
  }

  // 到達: 正対
  p.input.mx = dx / TILE_SIZE; p.input.my = dy / TILE_SIZE;
  p.facing = { x: g.tx - stand.tx, y: g.ty - stand.ty };
  p.dir = Math.atan2(p.facing.y, p.facing.x);

  const f = room._facingCell(p);
  if (!f || f.tx !== g.tx || f.ty !== g.ty) { p.input.interact = false; return; }

  // アクション
  if (g.act === 'chop') {
    const c = f.cell;
    if (p.holding && p.holding.kind === 'ingredient' && !c.item) pulse(p, ai);          // 置く
    else if (c.item && c.item.kind === 'ingredient' && c.item.state === 'raw') work(p);  // 切る
    else if (c.item && c.item.kind === 'ingredient' && c.item.state !== 'raw' && !p.holding) { pulse(p, ai); ai.goal = null; } // 取る
    else { p.input.interact = false; ai.goal = null; }
  } else if (g.act === 'cook') {
    const c = f.cell;
    if (p.holding && p.holding.kind === 'ingredient' && !c.item) pulse(p, ai);
    else if (c.item && c.item.kind === 'ingredient' && c.item.state !== 'cooked' && c.item.state !== 'burnt') p.input.interact = false; // 焼き待ち
    else if (c.item && c.item.kind === 'ingredient' && (c.item.state === 'cooked' || c.item.state === 'burnt') && !p.holding) { pulse(p, ai); ai.goal = null; }
    else { p.input.interact = false; ai.goal = null; }
  } else if (g.act === 'wash') {
    const c = f.cell;
    if (p.holding && p.holding.kind === 'plate' && p.holding.dirty && !c.item) pulse(p, ai);
    else if (c.item && c.item.kind === 'plate' && c.item.dirty) work(p);
    else if (c.item && c.item.kind === 'plate' && !c.item.dirty && !p.holding) { pulse(p, ai); ai.goal = null; }
    else { p.input.interact = false; ai.goal = null; }
  } else {
    // 'pulse' 系: 取る/置く/盛る/提供 などワンショット
    pulse(p, ai);
    ai.goal = null;
  }
}

// ============================================================
// ヘルパー
// ============================================================
function setGoal(tx, ty, act, ai) { ai.goal = { tx, ty, act }; }

function setGoalStation(room, p, type, act) {
  const s = nearestStation(room, p, type);
  if (s) setGoal(s.tx, s.ty, act, p.ai);
}

function ensureMyCounter(room, p) {
  const ai = p.ai;
  const counters = findStations(room, STATION.COUNTER);
  if (!counters.length) return null;
  if (ai.counterKey) {
    const [cx, cy] = ai.counterKey.split(',').map(Number);
    const found = counters.find(c => c.tx === cx && c.ty === cy);
    if (found) return found;
  }
  const taken = new Set();
  for (const id of room.aiPlayers) {
    if (id === p.id) continue;
    const o = room.players.get(id);
    if (o && o.ai && o.ai.counterKey) taken.add(o.ai.counterKey);
  }
  const free = counters.find(c => !taken.has(`${c.tx},${c.ty}`));
  const chosen = free || counters[Math.max(0, room.aiPlayers.indexOf(p.id)) % counters.length];
  ai.counterKey = `${chosen.tx},${chosen.ty}`;
  return chosen;
}

function pickOrderFor(room, p, myCounter) {
  if (room.orders.length === 0) return null;
  // 自分の皿に中身がある → 一致注文を継続
  if (myCounter && myCounter.cell.item && myCounter.cell.item.kind === 'plate' && myCounter.cell.item.contents.length > 0) {
    const m = room.orders.find(o => plateCompatible(myCounter.cell.item, RECIPES[o.recipe]));
    if (m) return m;
  }
  const sorted = [...room.orders].sort((a, b) => a.timeLeft - b.timeLeft);
  const urgent = sorted.find(o => o.timeLeft < 12);
  if (urgent) return urgent;
  const idx = Math.max(0, room.aiPlayers.indexOf(p.id));
  return sorted[idx % sorted.length] || sorted[0];
}

function nextNeeded(recipe, plate) {
  const need = {};
  for (const r of recipe.requires) need[`${r.type}:${r.state}`] = (need[`${r.type}:${r.state}`] || 0) + 1;
  if (plate) for (const c of plate.contents) { const k = `${c.type}:${c.state}`; if (need[k]) need[k]--; }
  for (const r of recipe.requires) { const k = `${r.type}:${r.state}`; if (need[k] > 0) return { type: r.type, state: r.state }; }
  return null;
}

// 自分が置いた完成食材(カウンター上, 皿に未投入)を探す
function findStrayCompleted(room, p, recipe, plate, myCounter) {
  const need = nextNeeded(recipe, plate);
  if (!need) return null;
  // 近場のカウンター/まな板/コンロ上にある完成状態の必要食材
  let best = null, bd = Infinity;
  for (let y = 0; y < room.height; y++)
    for (let x = 0; x < room.width; x++) {
      const c = room.stations[y][x];
      if (c.item && c.item.kind === 'ingredient'
          && c.item.type === need.type && c.item.state === need.state
          && c.station !== STATION.PLATE_STACK) {
        const d = Math.hypot(x * TILE_SIZE - p.x, y * TILE_SIZE - p.y);
        if (d < bd) { bd = d; best = { tx: x, ty: y, cell: c }; }
      }
    }
  return best;
}

function plateComplete(plate, recipe) {
  if (!plate) return false;
  const need = recipe.requires.map(r => `${r.type}:${r.state}`).sort().join(',');
  const have = plate.contents.map(c => `${c.type}:${c.state}`).sort().join(',');
  return need.length > 0 && need === have;
}

function plateCompatible(plate, recipe) {
  const need = {};
  for (const r of recipe.requires) need[`${r.type}:${r.state}`] = (need[`${r.type}:${r.state}`] || 0) + 1;
  const have = {};
  for (const c of plate.contents) have[`${c.type}:${c.state}`] = (have[`${c.type}:${c.state}`] || 0) + 1;
  for (const k in have) if (!need[k] || have[k] > need[k]) return false;
  return true;
}

function matchesAnyOrder(room, plate) {
  const have = plate.contents.map(c => `${c.type}:${c.state}`).sort().join(',');
  for (const o of room.orders) {
    const need = RECIPES[o.recipe].requires.map(r => `${r.type}:${r.state}`).sort().join(',');
    if (need === have) return true;
  }
  return false;
}

function findStations(room, type) {
  const out = [];
  for (let y = 0; y < room.height; y++)
    for (let x = 0; x < room.width; x++)
      if (room.stations[y][x].station === type) out.push({ tx: x, ty: y, cell: room.stations[y][x] });
  return out;
}
function nearest(room, p, list) {
  let best = null, bd = Infinity;
  for (const s of list) { const d = Math.hypot(s.tx * TILE_SIZE - p.x, s.ty * TILE_SIZE - p.y); if (d < bd) { bd = d; best = s; } }
  return best;
}
function nearestStation(room, p, type, filter) {
  let list = findStations(room, type);
  if (filter) list = list.filter(filter);
  return nearest(room, p, list);
}
function nearestFree(room, p, type, item) {
  const list = findStations(room, type).filter(s => !s.cell.item || (item && s.cell.item.id === item.id));
  return nearest(room, p, list);
}
function nearestEmptyCounter(room, p, exclude) {
  let list = findStations(room, STATION.COUNTER).filter(s => !s.cell.item);
  if (exclude) list = list.filter(s => !(s.tx === exclude.tx && s.ty === exclude.ty));
  return nearest(room, p, list);
}

function bestStand(room, p, tx, ty) {
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  let best = null, bd = Infinity;
  for (const [ox, oy] of dirs) {
    const fx = tx + ox, fy = ty + oy;
    if (fx < 0 || fy < 0 || fx >= room.width || fy >= room.height) continue;
    if (room.tiles[fy][fx] !== TILE.FLOOR) continue;
    const wx = fx * TILE_SIZE + TILE_SIZE / 2, wy = fy * TILE_SIZE + TILE_SIZE / 2;
    const d = Math.hypot(wx - p.x, wy - p.y);
    if (d < bd) { bd = d; best = { x: wx, y: wy, tx: fx, ty: fy }; }
  }
  return best;
}

function work(p) { p.input.interact = true; p.lastInteract = true; }
function pulse(p, ai) {
  if (ai.pulseCd && ai.pulseCd > 0) { p.input.interact = false; return; }
  p.lastInteract = false; p.input.interact = true; ai.pulseCd = 0.3;
}
