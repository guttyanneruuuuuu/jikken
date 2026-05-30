// ============================================================
// Kitchen Chaos - AIシェフの行動ロジック (v2: 堅牢化)
//
// 設計方針(デッドロック回避):
//  - 「皿は移動させず、食材を皿のところへ運んで盛る」方式。
//  - 共有の「組み立て皿」を空きカウンターに1枚用意し、そこへ全員が盛る。
//  - 各AIは「今いちばん作るべき注文」を共有で選び、足りない食材を1つ担当。
//  - 食材は crate→(切る)→(焼く)→皿へ盛る の順で1人が最後まで運ぶ。
//  - 皿が完成したら誰かが提供口へ運ぶ。汚れ皿は洗い場へ。
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
      if (p) updateAIPlayer(room, p, dt);
    }
  };
}

// ============================================================
// 各AIの毎フレーム更新
// ============================================================
function updateAIPlayer(room, p, dt) {
  const ai = p.ai;
  ai.replan = (ai.replan || 0) - dt;
  ai.pulseCd = Math.max(0, (ai.pulseCd || 0) - dt);
  ai.stuck = (ai.stuck || 0);

  // 作業中(その場で長押し)は再計画しない
  const busy = ai.goal && (ai.goal.type === 'chop' || ai.goal.type === 'cook' || ai.goal.type === 'wash');

  if ((!ai.goal || ai.replan <= 0) && !busy) {
    planGoal(room, p);
    ai.replan = 0.5;
  }

  if (!ai.goal) {
    p.input.mx = 0; p.input.my = 0; p.input.interact = false;
    return;
  }

  const target = ai.goal.cell;
  const stand = bestStandPosition(room, p, target.tx, target.ty);
  if (!stand) { p.input.mx = 0; p.input.my = 0; p.input.interact = false; ai.goal = null; return; }

  const dx = stand.x - p.x, dy = stand.y - p.y;
  const dist = Math.hypot(dx, dy);
  const faceX = target.tx - stand.tx, faceY = target.ty - stand.ty;

  if (dist > TILE_SIZE * 0.30) {
    p.input.mx = dx / dist;
    p.input.my = dy / dist;
    p.input.interact = false;
    // スタック検知(動けていない)
    if (ai.lastX !== undefined) {
      const moved = Math.hypot(p.x - ai.lastX, p.y - ai.lastY);
      if (moved < 0.5) ai.stuck += dt; else ai.stuck = 0;
    }
    ai.lastX = p.x; ai.lastY = p.y;
    if (ai.stuck > 1.2) {
      // 詰まり: 目標を捨てて再計画 + 軽くランダムに回避
      ai.goal = null; ai.stuck = 0;
      p.input.mx = (Math.random() - 0.5) * 2;
      p.input.my = (Math.random() - 0.5) * 2;
    }
  } else {
    // 到着: 微調整しつつターゲットに正対
    p.input.mx = dx / TILE_SIZE;
    p.input.my = dy / TILE_SIZE;
    p.facing = { x: faceX, y: faceY };
    p.dir = Math.atan2(faceY, faceX);
    performAIAction(room, p);
  }
}

// ============================================================
// 目標計画
// ============================================================
function planGoal(room, p) {
  const ai = p.ai;
  ai.goal = null;

  // 1) 完成皿(注文一致)を持っている → 提供
  if (p.holding && p.holding.kind === 'plate' && p.holding.contents.length > 0 && !p.holding.dirty) {
    if (matchesAnyOrder(room, p.holding)) {
      const serve = nearestStation(room, p, STATION.SERVE);
      if (serve) { ai.goal = { type: 'serve', cell: serve }; return; }
    } else {
      const trash = nearestStation(room, p, STATION.TRASH);
      if (trash) { ai.goal = { type: 'trash', cell: trash }; return; }
    }
  }

  // 2) 汚れ皿を持っている → 洗い場
  if (p.holding && p.holding.kind === 'plate' && p.holding.dirty) {
    const wash = nearestStation(room, p, STATION.WASH);
    if (wash) { ai.goal = { type: 'wash', cell: wash }; return; }
  }

  // 3) 焦げ食材/不要物を持っている → 捨てる
  if (p.holding && p.holding.kind === 'ingredient' && p.holding.state === 'burnt') {
    const trash = nearestStation(room, p, STATION.TRASH);
    if (trash) { ai.goal = { type: 'trash', cell: trash }; return; }
  }

  // 作るべき注文を選ぶ
  const order = pickOrder(room, p);
  if (!order) { return; }
  const recipe = RECIPES[order.recipe];

  // 組み立て皿(このレシピ用)を取得 or 準備
  const plateCell = getAssemblyPlate(room, recipe);

  // 4) 食材を手に持っている → 加工 or 盛り付けへ
  if (p.holding && p.holding.kind === 'ingredient') {
    const goal = advanceHeldIngredient(room, p, recipe, plateCell);
    if (goal) { ai.goal = goal; return; }
  }

  // 5) 皿が完成している(全材料が揃った) → 提供のため皿を取りに行く
  if (plateCell && plateIsComplete(plateCell.cell.item, recipe)) {
    if (!p.holding) {
      ai.goal = { type: 'takeplate', cell: plateCell };
      return;
    }
  }

  // 6) 盤上に「完成状態だが皿に未投入」の必要食材があれば、それを拾って皿へ運ぶ
  if (!p.holding && plateCell) {
    const ready = findReadyIngredientForPlate(room, recipe, plateCell.cell.item);
    if (ready) { ai.goal = { type: 'pickup', cell: ready }; return; }
  }

  // 7) まだ足りない食材を担当して用意する(手ぶら時)
  if (!p.holding) {
    const need = nextNeededIngredient(room, recipe, plateCell);
    if (need) {
      // すでにキッチン上に「途中の同種食材」があれば拾って続きをやる
      const existing = findIngredientOnBoardToward(room, need);
      if (existing) { ai.goal = { type: 'pickup', cell: existing }; return; }
      // crateから取る
      const crate = nearestStation(room, p, INGREDIENT_TO_CRATE[need.type]);
      if (crate) { ai.goal = { type: 'getcrate', cell: crate }; return; }
    }
    // 8) 皿がまだ無い → 皿置き場から取る
    if (!plateCell) {
      const stack = nearestStation(room, p, STATION.PLATE_STACK, s => (s.cell.plates || 0) > 0 || (Array.isArray(s.cell.plates) && s.cell.plates.length > 0));
      if (stack) { ai.goal = { type: 'getplate', cell: stack }; return; }
    }
  }

  // 8) 皿を手に持っていて、組み立て位置が無い → 空きカウンターへ置く
  if (p.holding && p.holding.kind === 'plate' && !p.holding.dirty && p.holding.contents.length === 0) {
    const counter = nearestEmptyCounter(room, p);
    if (counter) { ai.goal = { type: 'putdown', cell: counter }; return; }
  }
}

// 手持ち食材を「次の工程」へ進める目標を返す
function advanceHeldIngredient(room, p, recipe, plateCell) {
  const item = p.holding;
  const ing = INGREDIENTS[item.type];
  // この食材がレシピで要求される状態
  const req = recipe.requires.find(r => r.type === item.type);

  if (item.state === 'burnt') {
    const trash = nearestStation(room, p, STATION.TRASH);
    return trash ? { type: 'trash', cell: trash } : null;
  }

  // この食材はレシピに不要 → カウンターに置く
  if (!req) {
    const counter = nearestEmptyCounter(room, p);
    return counter ? { type: 'putdown', cell: counter } : null;
  }

  const targetState = req.state;

  // 切る必要があるのにまだ生
  if (ing.needChop && item.state === 'raw' && targetState !== 'raw') {
    const cut = nearestFreeStation(room, p, STATION.CUTTING, item);
    if (cut) return { type: 'chop', cell: cut };
  }
  // 焼く必要があるのにまだ焼いてない
  const cookReady = (item.state === 'chopped') || (item.state === 'raw' && !ing.needChop);
  if (ing.needCook && targetState === 'cooked' && cookReady && item.state !== 'cooked') {
    const stove = nearestFreeStation(room, p, STATION.STOVE, item);
    if (stove) return { type: 'cook', cell: stove };
  }

  // 目標状態に到達 → 皿へ盛る
  if (item.state === targetState) {
    if (plateCell) return { type: 'plate', cell: plateCell };
    // 皿がまだ無ければカウンターに一旦置く
    const counter = nearestEmptyCounter(room, p);
    return counter ? { type: 'putdown', cell: counter } : null;
  }

  // それ以外(中間状態でステーションが埋まってる等) → 少し待つ:カウンターに置く
  const counter = nearestEmptyCounter(room, p);
  return counter ? { type: 'putdown', cell: counter } : null;
}

// レシピ用の組み立て皿(カウンター上の皿)を探す。
// 一致する内容/未完成の皿を優先。無ければnull。
function getAssemblyPlate(room, recipe) {
  let candidate = null;
  for (let y = 0; y < room.height; y++)
    for (let x = 0; x < room.width; x++) {
      const c = room.stations[y][x];
      if (c.item && c.item.kind === 'plate' && !c.item.dirty
          && c.station !== STATION.WASH && c.station !== STATION.PLATE_STACK) {
        // この皿の中身がレシピと矛盾しないか
        if (plateCompatible(c.item, recipe)) {
          // より埋まっている皿を優先
          if (!candidate || c.item.contents.length > candidate.cell.item.contents.length) {
            candidate = { tx: x, ty: y, cell: c };
          }
        }
      }
    }
  return candidate;
}

// 皿の中身がレシピのサブセットか(余分な物が無いか)
function plateCompatible(plate, recipe) {
  const need = {};
  for (const r of recipe.requires) need[`${r.type}:${r.state}`] = (need[`${r.type}:${r.state}`] || 0) + 1;
  const have = {};
  for (const c of plate.contents) have[`${c.type}:${c.state}`] = (have[`${c.type}:${c.state}`] || 0) + 1;
  for (const k in have) if (!need[k] || have[k] > need[k]) return false;
  return true;
}

function plateIsComplete(plate, recipe) {
  if (!plate || plate.kind !== 'plate') return false;
  const need = recipe.requires.map(r => `${r.type}:${r.state}`).sort().join(',');
  const have = plate.contents.map(c => `${c.type}:${c.state}`).sort().join(',');
  return need === have && need.length > 0;
}

// 次に用意すべき食材(皿にまだ盛られていない要求材料)
function nextNeededIngredient(room, recipe, plateCell) {
  const need = {};
  for (const r of recipe.requires) need[`${r.type}:${r.state}`] = (need[`${r.type}:${r.state}`] || 0) + 1;

  // 皿に盛り済みの分を引く
  if (plateCell && plateCell.cell.item) {
    for (const c of plateCell.cell.item.contents) {
      const k = `${c.type}:${c.state}`;
      if (need[k]) need[k]--;
    }
  }
  // 既に「完成状態でキッチン上 or 誰かが手に持って運搬中」の分も引く
  const inProgress = countCompletedOrInProgress(room);
  for (const k in need) {
    if (inProgress[k]) {
      const used = Math.min(need[k], inProgress[k]);
      need[k] -= used;
      inProgress[k] -= used;
    }
  }
  for (const r of recipe.requires) {
    const k = `${r.type}:${r.state}`;
    if (need[k] > 0) return { type: r.type, state: r.state };
  }
  return null;
}

// 完成状態の食材(カウンター上) + 運搬/加工中(手持ち&ステーション上で目標へ向かう食材)をカウント
function countCompletedOrInProgress(room) {
  const counts = {};
  const add = (type, state) => { const k = `${type}:${state}`; counts[k] = (counts[k] || 0) + 1; };
  // カウンター/まな板/コンロ上の食材を「最終状態」とみなしてカウント
  for (let y = 0; y < room.height; y++)
    for (let x = 0; x < room.width; x++) {
      const c = room.stations[y][x];
      if (c.item && c.item.kind === 'ingredient') add(c.item.type, finalState(c.item.type, c.item.state));
    }
  // 手持ち食材
  for (const pl of room.players.values()) {
    if (pl.holding && pl.holding.kind === 'ingredient')
      add(pl.holding.type, finalState(pl.holding.type, pl.holding.state));
  }
  return counts;
}

// その食材が最終的に到達する状態を推定(切る→焼く)
function finalState(type, cur) {
  const ing = INGREDIENTS[type];
  if (cur === 'burnt') return 'burnt';
  if (ing.needCook) return 'cooked';
  if (ing.needChop) return 'chopped';
  return cur;
}

// 目標に向かって進められる(同種で目標状態未満)食材を盤上から探す
function findIngredientOnBoardToward(room, need) {
  for (let y = 0; y < room.height; y++)
    for (let x = 0; x < room.width; x++) {
      const c = room.stations[y][x];
      if (c.item && c.item.kind === 'ingredient' && c.item.type === need.type) {
        // まな板/コンロで加工中のものは触らない(他AIが担当中かもしれない)が、
        // カウンターに放置された途中食材は拾って進める
        if (c.station === STATION.COUNTER && stateRank(c.item.state) < stateRank(need.state)) {
          return { tx: x, ty: y, cell: c };
        }
      }
    }
  return null;
}

function stateRank(s) { return { raw: 0, chopped: 1, cooked: 2, burnt: -1 }[s] ?? 0; }

// 皿に盛るべき「完成状態の食材」を盤上から探す(皿にまだ足りない分)
function findReadyIngredientForPlate(room, recipe, plate) {
  // 皿にまだ必要な (type:state) を算出
  const need = {};
  for (const r of recipe.requires) need[`${r.type}:${r.state}`] = (need[`${r.type}:${r.state}`] || 0) + 1;
  if (plate) for (const c of plate.contents) { const k = `${c.type}:${c.state}`; if (need[k]) need[k]--; }

  for (let y = 0; y < room.height; y++)
    for (let x = 0; x < room.width; x++) {
      const c = room.stations[y][x];
      if (c.item && c.item.kind === 'ingredient'
          && c.station !== STATION.PLATE_STACK) {
        const k = `${c.item.type}:${c.item.state}`;
        if (need[k] > 0) {
          // コンロ/まな板上で「まだ加工中」のものは触らない(完成状態のみ回収)
          return { tx: x, ty: y, cell: c };
        }
      }
    }
  return null;
}

// ============================================================
// ステーション検索ヘルパー
// ============================================================
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
    const d = Math.hypot(s.tx * TILE_SIZE - p.x, s.ty * TILE_SIZE - p.y);
    if (d < bd) { bd = d; best = s; }
  }
  return best;
}

function nearestStation(room, p, type, filter) {
  let list = findStations(room, type);
  if (filter) list = list.filter(filter);
  return nearest(room, p, list);
}

// 空き or このアイテムが既に置かれているステーション
function nearestFreeStation(room, p, type, item) {
  const list = findStations(room, type).filter(s =>
    !s.cell.item || (item && s.cell.item.id === item.id));
  return nearest(room, p, list);
}

function nearestEmptyCounter(room, p) {
  const counters = findStations(room, STATION.COUNTER).filter(s => !s.cell.item);
  return nearest(room, p, counters);
}

function pickOrder(room, p) {
  if (room.orders.length === 0) return null;
  const sorted = [...room.orders].sort((a, b) => a.timeLeft - b.timeLeft);
  // AIごとに担当を分散(idハッシュ)。ただし全員が最も急ぎの注文を手伝えるよう、
  // まずは最短期限の注文を優先。
  const idx = hashId(p.id) % sorted.length;
  // 急ぎ(残り15秒未満)があれば全員でそれを優先
  const urgent = sorted.find(o => o.timeLeft < 15);
  return urgent || sorted[idx] || sorted[0];
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

// ターゲットに隣接する、pに最も近い歩行可能床の中心
function bestStandPosition(room, p, tx, ty) {
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

// ============================================================
// 到着後のアクション実行
// ============================================================
function performAIAction(room, p) {
  const ai = p.ai;
  const goal = ai.goal;
  if (!goal) { hold(p); return; }

  const f = room._facingCell(p);
  const onTarget = f && f.tx === goal.cell.tx && f.ty === goal.cell.ty;
  if (!onTarget) { hold(p); return; }

  const cell = f.cell;

  switch (goal.type) {
    case 'chop': {
      if (p.holding && p.holding.kind === 'ingredient' && !cell.item) {
        pulse(p, ai);                                   // 置く
      } else if (cell.item && cell.item.kind === 'ingredient' && cell.item.state === 'raw') {
        work(p);                                        // 切る(長押し)
      } else if (cell.item && cell.item.kind === 'ingredient' && cell.item.state !== 'raw' && !p.holding) {
        pulse(p, ai); ai.goal = null;                   // 取る
      } else { hold(p); ai.goal = null; }
      break;
    }
    case 'cook': {
      if (p.holding && p.holding.kind === 'ingredient' && !cell.item) {
        pulse(p, ai);                                   // 置く
      } else if (cell.item && cell.item.kind === 'ingredient'
                 && cell.item.state !== 'cooked' && cell.item.state !== 'burnt') {
        hold(p);                                        // 焼き待ち
      } else if (cell.item && cell.item.kind === 'ingredient'
                 && (cell.item.state === 'cooked' || cell.item.state === 'burnt') && !p.holding) {
        pulse(p, ai); ai.goal = null;                   // 取る(焦げてても回収)
      } else { hold(p); ai.goal = null; }
      break;
    }
    case 'getcrate':
    case 'getplate':
    case 'takeplate':
    case 'pickup': {
      if (!p.holding) pulse(p, ai);
      ai.goal = null;
      break;
    }
    case 'putdown': {
      if (p.holding && !cell.item) pulse(p, ai);
      ai.goal = null;
      break;
    }
    case 'plate': {
      pulse(p, ai); ai.goal = null;
      break;
    }
    case 'serve': {
      pulse(p, ai); ai.goal = null;
      break;
    }
    case 'wash': {
      if (p.holding && p.holding.kind === 'plate' && p.holding.dirty && !cell.item) {
        pulse(p, ai);
      } else if (cell.item && cell.item.kind === 'plate' && cell.item.dirty) {
        work(p);
      } else if (cell.item && cell.item.kind === 'plate' && !cell.item.dirty && !p.holding) {
        pulse(p, ai); ai.goal = null;
      } else { hold(p); ai.goal = null; }
      break;
    }
    case 'trash': {
      pulse(p, ai); ai.goal = null;
      break;
    }
    default:
      hold(p);
  }
}

function hold(p) { p.input.interact = false; }
function work(p) { p.input.interact = true; p.lastInteract = true; }
function pulse(p, ai) {
  if (ai.pulseCd && ai.pulseCd > 0) { p.input.interact = false; return; }
  p.lastInteract = false;
  p.input.interact = true;
  ai.pulseCd = 0.3;
}
