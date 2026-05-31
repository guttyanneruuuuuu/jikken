// ============================================================
// Kitchen Chaos - 権威サーバー側ゲームシミュレーション
// 1つの GameRoom が1部屋のゲーム状態をすべて保持・更新する。
// クライアントは入力(move方向, interactフラグ)だけ送る。
// ============================================================
import {
  TILE, STATION, RECIPES, INGREDIENTS, CRATE_TO_INGREDIENT,
  SYMBOL_TO_STATION, LEVELS, TIMING, TILE_SIZE,
} from '../shared/gamedata.js';

let _itemId = 1;
function newItemId() { return _itemId++; }

// 食材アイテムを生成
function makeIngredient(type) {
  return {
    id: newItemId(),
    kind: 'ingredient',
    type,
    state: 'raw',        // raw / chopped / cooked / burnt
    // 加工進行(0..1)。まな板/コンロに置かれているときに進む
    progress: 0,
  };
}

// 皿アイテムを生成
function makePlate(dirty = false) {
  return {
    id: newItemId(),
    kind: 'plate',
    dirty,
    contents: [],        // [{type, state}] 盛り付けた食材
    progress: 0,         // 洗浄進行
  };
}

export class GameRoom {
  constructor(code, options = {}) {
    this.code = code;
    this.mode = options.mode || 'multi';   // 'multi' or 'ai'
    this.levelIndex = options.levelIndex || 0;
    this.players = new Map(); // id -> player
    this.aiPlayers = [];      // AI制御プレイヤーのid配列
    this.state = 'lobby';     // lobby / playing / finished
    this.hostId = null;

    this.tiles = [];
    this.stations = [];       // 各セル: {station, item, progress, cooking, cookedTimer, plates}
    this.width = 0;
    this.height = 0;

    this.orders = [];
    this.score = 0;
    this.timeLeft = 0;
    this.lastOrderTime = 0;
    this.orderInterval = 8000;
    this.startTime = 0;
    this.combo = 0;

    this.lastTick = Date.now();
    this.events = []; // 一時イベント(エフェクト通知用)
  }

  // ---- プレイヤー管理 ----
  addPlayer(id, name, isAI = false) {
    const colors = ['#ff5252', '#4d8bff', '#2ecc71', '#ffd24d'];
    const idx = this.players.size;
    const player = {
      id, name: name || `Chef${idx + 1}`,
      isAI,
      color: colors[idx % colors.length],
      x: 0, y: 0,           // ワールド座標(px)
      dir: 0,               // 向き(rad)
      facing: { x: 0, y: 1 },
      holding: null,        // 持っているアイテム
      input: { mx: 0, my: 0, interact: false, dash: false },
      lastInteract: false,
      action: null,         // 現在の動作(chop/cook)station coord
      ai: isAI ? { task: null, path: null, cooldown: 0 } : null,
    };
    this.players.set(id, player);
    if (isAI) this.aiPlayers.push(id);
    if (!this.hostId && !isAI) this.hostId = id;
    this._placePlayerAtSpawn(player, idx);
    return player;
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (p && p.holding) {
      // 落とし物は消える(簡易)
    }
    this.players.delete(id);
    this.aiPlayers = this.aiPlayers.filter(a => a !== id);
    if (this.hostId === id) {
      // 次の人間プレイヤーをホストに
      const next = [...this.players.values()].find(pl => !pl.isAI);
      this.hostId = next ? next.id : null;
    }
  }

  _placePlayerAtSpawn(player, idx) {
    // 床タイルを探してスポーン
    const floors = [];
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (this.tiles[y] && this.tiles[y][x] === TILE.FLOOR) floors.push({ x, y });
      }
    }
    if (floors.length) {
      const sp = floors[Math.floor(idx * floors.length / Math.max(1, this.players.size)) % floors.length]
        || floors[idx % floors.length];
      player.x = sp.x * TILE_SIZE + TILE_SIZE / 2;
      player.y = sp.y * TILE_SIZE + TILE_SIZE / 2;
    } else {
      player.x = TILE_SIZE * 1.5;
      player.y = TILE_SIZE * 1.5;
    }
  }

  // ---- レベル読み込み ----
  loadLevel(index) {
    const level = LEVELS[index] || LEVELS[0];
    this.level = level;
    this.height = level.map.length;
    this.width = level.map[0].length;
    this.tiles = [];
    this.stations = [];
    for (let y = 0; y < this.height; y++) {
      const trow = [];
      const srow = [];
      for (let x = 0; x < this.width; x++) {
        const ch = level.map[y][x];
        const def = SYMBOL_TO_STATION[ch] || SYMBOL_TO_STATION['.'];
        trow.push(def.tile);
        srow.push({
          station: def.station,
          item: null,        // カウンター上のアイテム
          plates: [],        // 皿置き場の皿スタック
          progress: 0,       // 加工進行(まな板/コンロ/洗い場)
          cooking: false,
          cookDone: false,
          cookTimer: 0,      // 焼き上がってからの経過(焦げ用)
        });
      }
      this.tiles.push(trow);
      this.stations.push(srow);
    }
    // 皿置き場に皿を補充
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (this.stations[y][x].station === STATION.PLATE_STACK) {
          this.stations[y][x].plates = [makePlate(false), makePlate(false)];
        }
      }
    }
  }

  // ---- ゲーム開始 ----
  start() {
    this.loadLevel(this.levelIndex);
    this.state = 'playing';
    this.score = 0;
    this.combo = 0;
    this.orders = [];
    this.timeLeft = this.level.duration;
    this.startTime = Date.now();
    this.lastOrderTime = Date.now();
    this.lastTick = Date.now();
    // 注文ペース設定(プレイ人数に応じて緩急)
    // 1人あたり「サラダ約22秒」を捌ける想定。難易度はレベルで段階的に。
    const crew = Math.max(1, this.players.size);
    const diff = (this.level.difficulty || 1); // 1,1.15,1.3...
    // 1人あたりの基準間隔(緩め)。人数が増えるほど密度UP。
    this.baseInterval = Math.round((22000 / crew) / diff);
    this.orderInterval = Math.max(8000, this.baseInterval + 4000); // 立ち上がりは少し余裕
    this.maxOrders = Math.min(1 + crew, 5);                        // 同時注文上限(捌ける範囲)
    // プレイヤー再配置
    let i = 0;
    for (const p of this.players.values()) {
      p.holding = null;
      this._placePlayerAtSpawn(p, i++);
    }
    // 最初の注文を1つ(立ち上がりを優しく)
    this._spawnOrder();
  }

  _spawnOrder() {
    const menu = this.level.menu;
    const recipeKey = menu[Math.floor(Math.random() * menu.length)];
    const recipe = RECIPES[recipeKey];
    // レシピの工程数に応じて制限時間を設定(作るのに必要な時間+余裕)
    const steps = recipe.requires.length;
    const limit = 50 + steps * 14; // 2材料=78s, 4材料=106s 程度
    this.orders.push({
      id: newItemId(),
      recipe: recipeKey,
      timeLimit: limit,
      timeLeft: limit,
      maxTime: limit,
    });
  }

  setInput(id, input) {
    const p = this.players.get(id);
    if (!p) return;
    p.input.mx = clamp(input.mx || 0, -1, 1);
    p.input.my = clamp(input.my || 0, -1, 1);
    p.input.interact = !!input.interact;
    p.input.dash = !!input.dash;
  }

  // ============================================================
  // メインアップデート (サーバーループから呼ばれる)
  // ============================================================
  update() {
    const now = Date.now();
    let dt = (now - this.lastTick) / 1000;
    if (dt > 0.1) dt = 0.1; // スパイク防止
    this.lastTick = now;
    this.events = [];

    if (this.state !== 'playing') return;

    // 時間
    this.timeLeft = Math.max(0, this.level.duration - (now - this.startTime) / 1000);
    if (this.timeLeft <= 0) {
      this.state = 'finished';
      return;
    }

    // 注文スポーン
    const maxOrders = this.maxOrders || 4;
    if (now - this.lastOrderTime > this.orderInterval && this.orders.length < maxOrders) {
      this._spawnOrder();
      this.lastOrderTime = now;
      // 基準間隔±20%でゆらぎ(捌ける範囲を維持)
      const base = this.baseInterval || 12000;
      this.orderInterval = Math.round(base * (0.85 + Math.random() * 0.3));
    }

    // 注文タイマー
    for (const o of this.orders) {
      o.timeLeft -= dt;
    }
    const before = this.orders.length;
    this.orders = this.orders.filter(o => {
      if (o.timeLeft <= 0) {
        this.combo = 0;
        this.events.push({ type: 'order_fail' });
        this.score = Math.max(0, this.score - 10);
        return false;
      }
      return true;
    });

    // AI思考
    if (this.aiPlayers.length) this._updateAI(dt);

    // プレイヤー更新
    for (const p of this.players.values()) {
      this._updatePlayer(p, dt);
    }

    // ステーション更新(調理進行)
    this._updateStations(dt);
  }

  _updatePlayer(p, dt) {
    // 移動
    const speed = (p.input.dash ? TIMING.PLAYER_SPEED * 1.6 : TIMING.PLAYER_SPEED) * 60 * dt;
    let mx = p.input.mx, my = p.input.my;
    const len = Math.hypot(mx, my);
    if (len > 1) { mx /= len; my /= len; }

    if (len > 0.05) {
      p.facing = { x: mx / (len || 1), y: my / (len || 1) };
      p.dir = Math.atan2(my, mx);
    }

    // 軸ごとに移動 & 衝突
    this._tryMove(p, mx * speed, 0);
    this._tryMove(p, 0, my * speed);

    // インタラクト(押した瞬間)
    const justPressed = p.input.interact && !p.lastInteract;
    if (justPressed) {
      this._interact(p);
    }
    // 長押し中は加工継続(まな板等はupdateStationsで処理)
    p.lastInteract = p.input.interact;
  }

  _tryMove(p, dx, dy) {
    const r = TILE_SIZE * 0.30; // プレイヤー半径
    const nx = p.x + dx;
    const ny = p.y + dy;
    // 衝突判定: 移動先の周囲セルが歩行不可なら止める
    if (!this._circleCollides(nx, p.y, r) && dx !== 0) p.x = nx;
    if (!this._circleCollides(p.x, ny, r) && dy !== 0) p.y = ny;
  }

  _circleCollides(cx, cy, r) {
    // 円(中心cx,cy 半径r)が歩行不可タイルと重なるか
    const minX = Math.floor((cx - r) / TILE_SIZE);
    const maxX = Math.floor((cx + r) / TILE_SIZE);
    const minY = Math.floor((cy - r) / TILE_SIZE);
    const maxY = Math.floor((cy + r) / TILE_SIZE);
    for (let ty = minY; ty <= maxY; ty++) {
      for (let tx = minX; tx <= maxX; tx++) {
        if (tx < 0 || ty < 0 || tx >= this.width || ty >= this.height) return true;
        if (this.tiles[ty][tx] !== TILE.FLOOR) {
          // セルの矩形と円の最近接点で判定
          const rx = tx * TILE_SIZE, ry = ty * TILE_SIZE;
          const closestX = clamp(cx, rx, rx + TILE_SIZE);
          const closestY = clamp(cy, ry, ry + TILE_SIZE);
          const ddx = cx - closestX, ddy = cy - closestY;
          if (ddx * ddx + ddy * ddy < r * r) return true;
        }
      }
    }
    return false;
  }

  // プレイヤーが向いている前方のステーションセルを取得
  _facingCell(p) {
    const fx = p.x + p.facing.x * TILE_SIZE * 0.95;
    const fy = p.y + p.facing.y * TILE_SIZE * 0.95;
    const tx = Math.floor(fx / TILE_SIZE);
    const ty = Math.floor(fy / TILE_SIZE);
    if (tx < 0 || ty < 0 || tx >= this.width || ty >= this.height) return null;
    return { tx, ty, cell: this.stations[ty][tx], tile: this.tiles[ty][tx] };
  }

  // ============================================================
  // インタラクション処理(ピックアップ/設置/加工/提供)
  // ============================================================
  _interact(p) {
    const f = this._facingCell(p);
    if (!f) return;
    const { cell, tile } = f;
    if (tile === TILE.FLOOR) return; // 何もない床

    const st = cell.station;
    // 壁(ステーション無し)には何も置けない/取れない
    if (st === STATION.NONE) return;

    // --- 食材箱: 食材を取り出して持つ ---
    if (CRATE_TO_INGREDIENT[st]) {
      if (!p.holding) {
        p.holding = makeIngredient(CRATE_TO_INGREDIENT[st]);
        this.events.push({ type: 'pickup', x: p.x, y: p.y });
      }
      return;
    }

    // --- 皿置き場: 皿を取る / 戻す ---
    if (st === STATION.PLATE_STACK) {
      if (!p.holding && cell.plates.length > 0) {
        p.holding = cell.plates.pop();
      } else if (p.holding && p.holding.kind === 'plate' && !p.holding.dirty && p.holding.contents.length === 0) {
        cell.plates.push(p.holding);
        p.holding = null;
      }
      return;
    }

    // --- ゴミ箱: 持っているものを捨てる(皿の中身/食材) ---
    if (st === STATION.TRASH) {
      if (p.holding) {
        if (p.holding.kind === 'plate') {
          // 中身だけ捨てる
          p.holding.contents = [];
        } else {
          p.holding = null;
        }
        this.events.push({ type: 'trash', x: p.x, y: p.y });
      }
      return;
    }

    // --- 洗い場: 汚れた皿を置いて洗う ---
    if (st === STATION.WASH) {
      if (p.holding && p.holding.kind === 'plate' && p.holding.dirty && !cell.item) {
        cell.item = p.holding;
        cell.progress = 0;
        p.holding = null;
      } else if (!p.holding && cell.item && cell.item.kind === 'plate' && !cell.item.dirty) {
        p.holding = cell.item;
        cell.item = null;
      }
      return;
    }

    // --- 提供口: 完成した料理を提供 ---
    if (st === STATION.SERVE) {
      if (p.holding && p.holding.kind === 'plate' && p.holding.contents.length > 0) {
        this._tryServe(p);
      }
      return;
    }

    // --- まな板: 食材を置く/切る/取る ---
    if (st === STATION.CUTTING) {
      this._interactCutting(p, cell);
      return;
    }

    // --- コンロ: 食材を置く/焼く/取る ---
    if (st === STATION.STOVE) {
      this._interactStove(p, cell);
      return;
    }

    // --- 普通カウンター / その他: 置く・取る・盛り付け ---
    this._interactCounter(p, cell);
  }

  _interactCutting(p, cell) {
    // 生の切れる食材を置く
    if (p.holding && p.holding.kind === 'ingredient' && !cell.item) {
      if (INGREDIENTS[p.holding.type].needChop && p.holding.state === 'raw') {
        cell.item = p.holding;
        cell.item.progress = 0;
        cell.progress = 0;
        p.holding = null;
      }
      return;
    }
    // 置かれているものを取る
    if (!p.holding && cell.item) {
      p.holding = cell.item;
      cell.item = null;
    }
  }

  _interactStove(p, cell) {
    // 焼ける食材(切った肉/魚)を置く
    if (p.holding && p.holding.kind === 'ingredient' && !cell.item) {
      const ing = INGREDIENTS[p.holding.type];
      const canCook = ing.needCook && (p.holding.state === 'chopped' || (!ing.needChop && p.holding.state === 'raw'));
      if (canCook) {
        cell.item = p.holding;
        cell.item.progress = 0;
        cell.cooking = true;
        cell.cookDone = false;
        cell.cookTimer = 0;
        p.holding = null;
      }
      return;
    }
    if (!p.holding && cell.item) {
      p.holding = cell.item;
      cell.item = null;
      cell.cooking = false;
      cell.cookDone = false;
    }
  }

  _interactCounter(p, cell) {
    // 皿に食材を盛り付ける or カウンターに置く/取る
    if (p.holding) {
      // 持っているのが食材で、カウンター上に皿がある → 盛り付け
      if (p.holding.kind === 'ingredient' && cell.item && cell.item.kind === 'plate') {
        if (this._addToPlate(cell.item, p.holding)) {
          p.holding = null;
        }
        return;
      }
      // 持っているのが皿で、カウンター上に食材がある → 盛り付け
      if (p.holding.kind === 'plate' && cell.item && cell.item.kind === 'ingredient') {
        if (this._addToPlate(p.holding, cell.item)) {
          cell.item = null;
        }
        return;
      }
      // 空きカウンターに置く
      if (!cell.item) {
        cell.item = p.holding;
        p.holding = null;
      }
    } else if (cell.item) {
      p.holding = cell.item;
      cell.item = null;
    }
  }

  // 皿に食材を追加(状態が適切なものだけ)
  _addToPlate(plate, ingredient) {
    if (plate.dirty) return false;
    const ing = INGREDIENTS[ingredient.type];
    // 加工が必要なのに未加工なものは盛れない
    if (ing.needChop && ingredient.state === 'raw') return false;
    if (ingredient.state === 'burnt') return false;
    if (plate.contents.length >= 5) return false;
    plate.contents.push({ type: ingredient.type, state: ingredient.state });
    this.events.push({ type: 'plate_add' });
    return true;
  }

  // 提供チェック: 皿の中身が注文と一致するか
  _tryServe(p) {
    const plate = p.holding;
    const have = plate.contents.map(c => `${c.type}:${c.state}`).sort();
    // 一致する注文を探す
    let matchedOrder = null;
    for (const o of this.orders) {
      const recipe = RECIPES[o.recipe];
      const need = recipe.requires.map(r => `${r.type}:${r.state}`).sort();
      if (need.length === have.length && need.every((n, i) => n === have[i])) {
        matchedOrder = o; break;
      }
    }
    if (matchedOrder) {
      const recipe = RECIPES[matchedOrder.recipe];
      // タイムボーナス + コンボ
      const timeBonus = Math.round((matchedOrder.timeLeft / matchedOrder.maxTime) * 20);
      this.combo = Math.min(this.combo + 1, 10);
      const comboBonus = (this.combo - 1) * 5;
      const gain = recipe.score + timeBonus + comboBonus;
      this.score += gain;
      this.orders = this.orders.filter(o => o.id !== matchedOrder.id);
      this.events.push({ type: 'serve_ok', x: p.x, y: p.y, score: gain, combo: this.combo });
      // 皿は汚れた状態で消える(=新しい汚れ皿に)。簡易化: 皿は空になり手元に残す→洗い場へ
      plate.contents = [];
      plate.dirty = true;
    } else {
      // 不一致: ペナルティ無し、ただ提供できない
      this.events.push({ type: 'serve_bad', x: p.x, y: p.y });
    }
  }

  // ============================================================
  // ステーションの時間進行(切る/焼く/洗う)
  // ============================================================
  _updateStations(dt) {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const cell = this.stations[y][x];
        const st = cell.station;

        if (st === STATION.CUTTING && cell.item && cell.item.state === 'raw') {
          // 誰かが前にいてinteract長押し中なら進む
          if (this._someoneWorking(x, y)) {
            cell.item.progress += dt * 1000 / TIMING.CHOP_TIME;
            cell.progress = cell.item.progress;
            if (cell.item.progress >= 1) {
              cell.item.state = 'chopped';
              cell.item.progress = 1;
              this.events.push({ type: 'chop_done', x: x * TILE_SIZE, y: y * TILE_SIZE });
            }
          }
        }

        if (st === STATION.STOVE && cell.item && cell.cooking) {
          if (cell.item.state !== 'cooked' && cell.item.state !== 'burnt') {
            cell.item.progress += dt * 1000 / TIMING.COOK_TIME;
            cell.progress = cell.item.progress;
            if (cell.item.progress >= 1) {
              cell.item.state = 'cooked';
              cell.cookDone = true;
              cell.cookTimer = 0;
              this.events.push({ type: 'cook_done', x: x * TILE_SIZE, y: y * TILE_SIZE });
            }
          } else if (cell.item.state === 'cooked') {
            // 焦げカウント
            cell.cookTimer += dt * 1000;
            if (cell.cookTimer >= TIMING.BURN_TIME) {
              cell.item.state = 'burnt';
              this.events.push({ type: 'burnt', x: x * TILE_SIZE, y: y * TILE_SIZE });
            }
          }
        }

        if (st === STATION.WASH && cell.item && cell.item.dirty) {
          if (this._someoneWorking(x, y)) {
            cell.progress += dt * 1000 / TIMING.WASH_TIME;
            if (cell.progress >= 1) {
              cell.item.dirty = false;
              cell.progress = 0;
            }
          }
        }
      }
    }
  }

  // 指定セルの前で誰かがinteractを押しているか
  _someoneWorking(tx, ty) {
    for (const p of this.players.values()) {
      if (!p.input.interact) continue;
      const f = this._facingCell(p);
      if (f && f.tx === tx && f.ty === ty) return true;
    }
    return false;
  }

  // ============================================================
  // クライアント送信用スナップショット
  // ============================================================
  snapshot() {
    return {
      code: this.code,
      mode: this.mode,
      state: this.state,
      level: this.level ? {
        id: this.level.id, name: this.level.name,
        width: this.width, height: this.height,
        duration: this.level.duration, menu: this.level.menu,
      } : null,
      tiles: this.tiles,
      stations: this.state === 'playing' || this.state === 'finished'
        ? this.stations.map(row => row.map(c => ({
            station: c.station,
            item: c.item ? this._itemSnap(c.item) : null,
            plates: c.plates.length,
            progress: +c.progress.toFixed(3),
            cooking: c.cooking,
            cookDone: c.cookDone,
            burning: c.cookDone && c.cookTimer > TIMING.BURN_TIME * 0.5,
          }))) : null,
      players: [...this.players.values()].map(p => ({
        id: p.id, name: p.name, isAI: p.isAI, color: p.color,
        x: +p.x.toFixed(1), y: +p.y.toFixed(1), dir: +p.dir.toFixed(2),
        holding: p.holding ? this._itemSnap(p.holding) : null,
      })),
      orders: this.orders.map(o => ({
        id: o.id, recipe: o.recipe,
        timeLeft: +o.timeLeft.toFixed(1), maxTime: o.maxTime,
      })),
      score: this.score,
      combo: this.combo,
      timeLeft: +this.timeLeft.toFixed(1),
      hostId: this.hostId,
      events: this.events,
    };
  }

  _itemSnap(item) {
    if (item.kind === 'plate') {
      return { kind: 'plate', dirty: item.dirty, contents: item.contents, progress: +(item.progress || 0).toFixed(2) };
    }
    return { kind: 'ingredient', type: item.type, state: item.state, progress: +(item.progress || 0).toFixed(2) };
  }

  // lobbyスナップショット(軽量)
  lobbySnapshot() {
    return {
      code: this.code, mode: this.mode, state: this.state,
      hostId: this.hostId,
      levelIndex: this.levelIndex,
      players: [...this.players.values()].map(p => ({ id: p.id, name: p.name, isAI: p.isAI, color: p.color })),
    };
  }

  // ---- AI(別ファイルから注入) ----
  _updateAI(dt) {
    if (this._aiBrain) this._aiBrain(this, dt);
  }
}

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
