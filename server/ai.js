// ============================================================
// Kitchen Chaos - AIシェフの行動ロジック
// シンプルな「ステートマシン + 目標ステーションへの移動」方式。
// 各AIは「現在のサブタスク」を持ち、最寄りの必要ステーションへ移動して
// interactを行うことでタスクを進める。
// ============================================================
import {
  STATION, RECIPES, INGREDIENTS, CRATE_TO_INGREDIENT, TILE, TILE_SIZE,
} from '../shared/gamedata.js';

// 食材タイプ -> 取り出せるcrate station
const INGREDIENT_TO_CRATE = {};
for (const [crate, ing] of Object.entries(CRATE_TO_INGREDIENT)) {
  INGREDIENT_TO_CRATE[ing] = crate;
}

export function attachAI(room) {
  room._aiBrain = (room, dt) => {
    for (const id of room.aiPlayers) {
      const p = room.players.get(id);
      if (p) updateAIPlayer(room, p, dt);
    }
  };
}

function updateAIPlayer(room, p, dt) {
  const ai = p.ai;
  ai.cooldown = (ai.cooldown || 0) - dt;
  ai.replan = (ai.replan || 0) - dt;

  // 一定間隔で目標を再計画
  if (!ai.goal || ai.replan <= 0) {
    planGoal(room, p);
    ai.replan = 0.8;
  }

  if (!ai.goal) {
    // 目標なし: 待機
    p.input.mx = 0; p.input.my = 0; p.input.interact = false;
    return;
  }

  // 目標セルへ移動
  const target = ai.goal.cell; // {tx, ty}
  const standPos = bestStandPosition(room, target.tx, target.ty);
  if (!standPos) { p.input.mx = 0; p.input.my = 0; p.input.interact = false; ai.goal = null; return; }

  const dx = standPos.x - p.x;
  const dy = standPos.y - p.y;
  const dist = Math.hypot(dx, dy);

  if (dist > TILE_SIZE * 0.45) {
    // 移動
    p.input.mx = dx / dist;
    p.input.my = dy / dist;
    p.input.interact = false;
    // 向きをターゲットへ
    const fx = target.tx * TILE_SIZE + TILE_SIZE / 2 - p.x;
    const fy = target.ty * TILE_SIZE + TILE_SIZE / 2 - p.y;
  } else {
    // 到着: ターゲットの方を向く
    p.input.mx = 0; p.input.my = 0;
    const cx = target.tx * TILE_SIZE + TILE_SIZE / 2;
    const cy = target.ty * TILE_SIZE + TILE_SIZE / 2;
    const fdx = cx - p.x, fdy = cy - p.y;
    const fl = Math.hypot(fdx, fdy) || 1;
    p.facing = { x: fdx / fl, y: fdy / fl };
    p.dir = Math.atan2(fdy, fdx);

    // アクション実行
    performAIAction(room, p);
  }
}

// 向いているセルがターゲットになるよう、隣接の床位置を返す
function bestStandPosition(room, tx, ty) {
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  let best = null, bestDist = Infinity;
  for (const [ox, oy] of dirs) {
    const fx = tx + ox, fy = ty + oy;
    if (fx < 0 || fy < 0 || fx >= room.width || fy >= room.height) continue;
    if (room.tiles[fy][fx] !== TILE.FLOOR) continue;
    const wx = fx * TILE_SIZE + TILE_SIZE / 2;
    const wy = fy * TILE_SIZE + TILE_SIZE / 2;
    if (!best) { best = { x: wx, y: wy }; }
    best = { x: wx, y: wy };
    return best; // 最初に見つかった床でOK(簡易)
  }
  return best;
}

// セル検索ユーティリティ
function findStations(room, stationType) {
  const out = [];
  for (let y = 0; y < room.height; y++)
    for (let x = 0; x < room.width; x++)
      if (room.stations[y][x].station === stationType) out.push({ tx: x, ty: y, cell: room.stations[y][x] });
  return out;
}

function nearest(room, p, list) {
  let best = null, bd = Infinity;
  for (const s of list) {
    const wx = s.tx * TILE_SIZE, wy = s.ty * TILE_SIZE;
    const d = Math.hypot(wx - p.x, wy - p.y);
    if (d < bd) { bd = d; best = s; }
  }
  return best;
}

// ============================================================
// 目標計画: AIが今何をすべきか決める
// ============================================================
function planGoal(room, p) {
  const ai = p.ai;
  ai.goal = null;

  // 提供できる完成皿を持っているなら提供口へ
  if (p.holding && p.holding.kind === 'plate' && p.holding.contents.length > 0) {
    if (matchesAnyOrder(room, p.holding)) {
      const serve = nearest(room, p, findStations(room, STATION.SERVE));
      if (serve) { ai.goal = { type: 'serve', cell: serve }; return; }
    } else {
      // 不正な皿の中身 → ゴミ箱へ
      const trash = nearest(room, p, findStations(room, STATION.TRASH));
      if (trash) { ai.goal = { type: 'trash', cell: trash }; return; }
    }
  }

  // 汚れた皿を持っていたら洗い場へ
  if (p.holding && p.holding.kind === 'plate' && p.holding.dirty) {
    const wash = nearest(room, p, findStations(room, STATION.WASH));
    if (wash) { ai.goal = { type: 'wash', cell: wash }; return; }
  }

  // 注文を1つ選んで作業を進める
  const order = pickOrder(room, p);
  if (!order) {
    // やることがない: アイドル(中央付近をうろつかない・停止)
    return;
  }
  const recipe = RECIPES[order.recipe];

  // このAIに割り当てる「次に用意すべき食材」を決定
  const step = nextIngredientStep(room, p, recipe);
  if (!step) {
    // 全部揃っている → どこかにある完成食材を皿に集める/提供
    // 皿を持っていなければ皿を取りに行く
    if (!p.holding) {
      const plate = nearest(room, p, findStations(room, STATION.PLATE_STACK).filter(s => s.cell.plates.length > 0));
      if (plate) { ai.goal = { type: 'getplate', cell: plate }; return; }
    }
    // 既に皿を持っている → 完成食材を探して盛る
    if (p.holding && p.holding.kind === 'plate') {
      const ingCell = findReadyIngredientForRecipe(room, recipe, p.holding);
      if (ingCell) { ai.goal = { type: 'plate', cell: ingCell }; return; }
    }
    return;
  }

  // step に従って行動
  ai.goal = stepToGoal(room, p, step);
}

// レシピに対し、次に用意すべき食材ステップを返す
// 返り値: { type, fromState, toState, action } のような指示
function nextIngredientStep(room, p, recipe) {
  // 既に完成済み(必要状態)としてキッチン上に存在する食材を数える
  const needCounts = {};
  for (const r of recipe.requires) {
    const k = `${r.type}:${r.state}`;
    needCounts[k] = (needCounts[k] || 0) + 1;
  }
  // キッチン上 & 手持ち & 皿の上 で既に満たしている分を引く
  const available = countAvailableIngredients(room);
  for (const k of Object.keys(needCounts)) {
    needCounts[k] -= (available[k] || 0);
  }
  // まだ足りない最初のものを返す
  for (const r of recipe.requires) {
    const k = `${r.type}:${r.state}`;
    if (needCounts[k] > 0) {
      return { type: r.type, targetState: r.state };
    }
  }
  return null;
}

// キッチン上の「使える(完成状態の)食材」をカウント
function countAvailableIngredients(room) {
  const counts = {};
  const add = (type, state) => {
    const k = `${type}:${state}`;
    counts[k] = (counts[k] || 0) + 1;
  };
  for (let y = 0; y < room.height; y++) {
    for (let x = 0; x < room.width; x++) {
      const c = room.stations[y][x];
      if (c.item && c.item.kind === 'ingredient') add(c.item.type, c.item.state);
    }
  }
  for (const pl of room.players.values()) {
    if (pl.holding && pl.holding.kind === 'ingredient') add(pl.holding.type, pl.holding.state);
  }
  return counts;
}

// ステップを具体的な移動目標に変換
function stepToGoal(room, p, step) {
  const ing = INGREDIENTS[step.type];
  const targetState = step.targetState;

  // 既にこの食材を手に持っている?
  const holdingThis = p.holding && p.holding.kind === 'ingredient' && p.holding.type === step.type;

  if (!holdingThis) {
    // この食材がキッチン上に「加工途中/未加工」で存在し拾えるなら拾う
    // まず手が塞がってたら…皿を持ってるなら一旦置く必要があるが簡易化: 何も持ってなければcrateへ
    if (p.holding) {
      // 違うものを持っている: カウンターに置く
      const counter = nearestEmptyCounter(room, p);
      if (counter) return { type: 'putdown', cell: counter };
      return null;
    }
    // 未加工/途中の同種食材がまな板やカウンターにある→それを取る
    const existing = findIngredientOnBoard(room, step.type, ['raw', 'chopped']);
    if (existing && stateRank(existing.cell.item.state) < stateRank(targetState)) {
      return { type: 'pickup', cell: existing };
    }
    // crateから取る
    const crate = nearest(room, p, findStations(room, INGREDIENT_TO_CRATE[step.type]));
    if (crate) return { type: 'getcrate', cell: crate, ingType: step.type };
    return null;
  }

  // 手に持っている → 次の加工先へ
  const cur = p.holding.state;
  if (cur === 'raw' && ing.needChop && targetState !== 'raw') {
    const cut = nearest(room, p, findStations(room, STATION.CUTTING).filter(s => !s.cell.item || s.cell.item.id === p.holding.id));
    if (cut) return { type: 'chop', cell: cut };
  }
  if ((cur === 'chopped' || (cur === 'raw' && !ing.needChop)) && ing.needCook && targetState === 'cooked') {
    const stove = nearest(room, p, findStations(room, STATION.STOVE).filter(s => !s.cell.item || s.cell.item.id === p.holding.id));
    if (stove) return { type: 'cook', cell: stove };
  }
  // 目標状態に到達済み → 皿へ盛る or カウンターに置く
  // 完成皿が近くにあれば盛る
  const plateCell = findPlateToFill(room, p);
  if (plateCell) return { type: 'plate', cell: plateCell };
  // なければカウンターに置いて他AIに任せる
  const counter = nearestEmptyCounter(room, p);
  if (counter) return { type: 'putdown', cell: counter };
  return null;
}

function stateRank(s) {
  return { raw: 0, chopped: 1, cooked: 2, burnt: -1 }[s] ?? 0;
}

function findIngredientOnBoard(room, type, states) {
  const list = [];
  for (let y = 0; y < room.height; y++)
    for (let x = 0; x < room.width; x++) {
      const c = room.stations[y][x];
      if (c.item && c.item.kind === 'ingredient' && c.item.type === type && states.includes(c.item.state))
        list.push({ tx: x, ty: y, cell: c });
    }
  return list[0] || null;
}

function findPlateToFill(room, p) {
  // カウンター上に空き or 盛り付け可能な皿
  for (let y = 0; y < room.height; y++)
    for (let x = 0; x < room.width; x++) {
      const c = room.stations[y][x];
      if (c.item && c.item.kind === 'plate' && !c.item.dirty && c.item.contents.length < 5
          && c.station !== STATION.WASH)
        return { tx: x, ty: y, cell: c };
    }
  return null;
}

function findReadyIngredientForRecipe(room, recipe, plate) {
  for (let y = 0; y < room.height; y++)
    for (let x = 0; x < room.width; x++) {
      const c = room.stations[y][x];
      if (c.item && c.item.kind === 'ingredient') {
        const needed = recipe.requires.some(r => r.type === c.item.type && r.state === c.item.state);
        const already = plate.contents.filter(ct => ct.type === c.item.type && ct.state === c.item.state).length;
        const need = recipe.requires.filter(r => r.type === c.item.type && r.state === c.item.state).length;
        if (needed && already < need) return { tx: x, ty: y, cell: c };
      }
    }
  return null;
}

function nearestEmptyCounter(room, p) {
  const counters = [];
  for (let y = 0; y < room.height; y++)
    for (let x = 0; x < room.width; x++) {
      const c = room.stations[y][x];
      if (c.station === STATION.COUNTER && !c.item) counters.push({ tx: x, ty: y, cell: c });
    }
  return nearest(room, p, counters);
}

function pickOrder(room, p) {
  if (room.orders.length === 0) return null;
  // 時間が少ない順
  const sorted = [...room.orders].sort((a, b) => a.timeLeft - b.timeLeft);
  // AIごとに少しずらして担当(idのハッシュで分散)
  const idx = (hashId(p.id)) % sorted.length;
  return sorted[idx] || sorted[0];
}

function hashId(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h;
}

function matchesAnyOrder(room, plate) {
  const have = plate.contents.map(c => `${c.type}:${c.state}`).sort().join(',');
  for (const o of room.orders) {
    const recipe = RECIPES[o.recipe];
    const need = recipe.requires.map(r => `${r.type}:${r.state}`).sort().join(',');
    if (need === have) return true;
  }
  return false;
}

// ============================================================
// 到着後のアクション実行(interactのパルスを送る)
// ============================================================
function performAIAction(room, p) {
  const ai = p.ai;
  const goal = ai.goal;
  if (!goal) { p.input.interact = false; return; }

  const f = room._facingCell(p);
  const onTarget = f && f.tx === goal.cell.tx && f.ty === goal.cell.ty;
  if (!onTarget) { p.input.interact = false; return; }

  switch (goal.type) {
    case 'chop': {
      // 食材を置く→切れるまで長押し→切れたら取る
      const cell = f.cell;
      if (p.holding && !cell.item) {
        // 置く: 1パルス
        pulse(p);
      } else if (cell.item && cell.item.state === 'raw') {
        // 切る: 長押し
        p.input.interact = true;
        p.lastInteract = true; // justPressedを起こさず継続作業
      } else if (cell.item && cell.item.state !== 'raw' && !p.holding) {
        // 切れた: 取る
        pulse(p);
        ai.goal = null;
      } else {
        p.input.interact = false;
      }
      break;
    }
    case 'cook': {
      const cell = f.cell;
      if (p.holding && !cell.item) {
        pulse(p);
      } else if (cell.item && cell.item.state !== 'cooked' && cell.item.state !== 'burnt') {
        // 焼け待ち(コンロは自動進行なので待機)
        p.input.interact = false;
      } else if (cell.item && cell.item.state === 'cooked' && !p.holding) {
        pulse(p);
        ai.goal = null;
      } else {
        p.input.interact = false;
      }
      break;
    }
    case 'getcrate': {
      if (!p.holding) { pulse(p); }
      ai.goal = null;
      break;
    }
    case 'getplate': {
      if (!p.holding) pulse(p);
      ai.goal = null;
      break;
    }
    case 'pickup': {
      if (!p.holding && f.cell.item) pulse(p);
      ai.goal = null;
      break;
    }
    case 'putdown': {
      if (p.holding && !f.cell.item) pulse(p);
      ai.goal = null;
      break;
    }
    case 'plate': {
      // 皿に盛る or 皿を持って食材に近づいて盛る
      pulse(p);
      ai.goal = null;
      break;
    }
    case 'serve': {
      pulse(p);
      ai.goal = null;
      break;
    }
    case 'wash': {
      const cell = f.cell;
      if (p.holding && p.holding.dirty && !cell.item) {
        pulse(p);
      } else if (cell.item && cell.item.dirty) {
        p.input.interact = true; p.lastInteract = true; // 洗い続ける
      } else if (cell.item && !cell.item.dirty && !p.holding) {
        pulse(p);
        ai.goal = null;
      } else {
        p.input.interact = false;
        ai.goal = null;
      }
      break;
    }
    case 'trash': {
      pulse(p);
      ai.goal = null;
      break;
    }
    default:
      p.input.interact = false;
  }
}

// 1フレームだけ interact を true にして「押した瞬間」を発生させる
function pulse(p) {
  // lastInteract=false の状態で interact=true にすると justPressed が発火
  p.lastInteract = false;
  p.input.interact = true;
}
