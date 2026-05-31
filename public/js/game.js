// ============================================================
// Kitchen Chaos - ゲーム本体(クライアント)
// サーバースナップショットを受け取り、補間して描画。
// 入力は一定間隔でサーバーへ送信(権威サーバー方式)。
// ============================================================
import { TILE, STATION, RECIPES, INGREDIENTS, TILE_SIZE } from '/shared/gamedata.js';
import { Renderer, STATION_STYLE } from './render.js';
import { Controls } from './controls.js';

export class Game {
  constructor(socket, getMyId) {
    this.socket = socket;
    this.getMyId = getMyId;
    this.canvas = document.getElementById('game-canvas');
    this.renderer = new Renderer(this.canvas);
    this.controls = new Controls();

    this.running = false;
    this.level = null;
    this.tiles = null;
    this.stations = null;

    // 補間用: 現在表示状態と目標状態
    this.players = new Map();      // id -> {render:{x,y,dir}, target:{x,y,dir}, data}
    this.orders = [];
    this.score = 0; this.combo = 0; this.timeLeft = 0;

    this.toasts = [];
    this.lastInputSend = 0;
    this.rafId = null;
    this._loop = this._loop.bind(this);
  }

  start(snap) {
    this.running = true;
    this.controls.enable();
    this.applyStatic(snap);
    this.onSnapshot(snap, true);
    this.renderer.resize();
    this.renderer.setupCamera(snap.level);
    if (!this.rafId) this.rafId = requestAnimationFrame(this._loop);
  }

  stop() {
    this.running = false;
    this.controls.disable();
    if (this.rafId) { cancelAnimationFrame(this.rafId); this.rafId = null; }
  }

  applyStatic(snap) {
    this.level = snap.level;
    this.tiles = snap.tiles;
  }

  onSnapshot(snap, immediate = false) {
    if (!this.level) this.applyStatic(snap);
    this.stations = snap.stations;
    this.orders = snap.orders;
    this.score = snap.score;
    this.combo = snap.combo;
    this.timeLeft = snap.timeLeft;

    // プレイヤー補間更新
    const seen = new Set();
    for (const pd of snap.players) {
      seen.add(pd.id);
      let pl = this.players.get(pd.id);
      if (!pl) {
        pl = { render: { x: pd.x, y: pd.y, dir: pd.dir }, target: { x: pd.x, y: pd.y, dir: pd.dir }, data: pd };
        this.players.set(pd.id, pl);
      } else {
        pl.target = { x: pd.x, y: pd.y, dir: pd.dir };
        pl.data = pd;
        if (immediate) pl.render = { ...pl.target };
      }
    }
    for (const id of [...this.players.keys()]) if (!seen.has(id)) this.players.delete(id);

    // イベント→トースト/演出
    if (snap.events) for (const ev of snap.events) this._handleEvent(ev);

    this.updateHUD();
  }

  _handleEvent(ev) {
    switch (ev.type) {
      case 'serve_ok':
        this._spawnToast(ev.x, ev.y, `+${ev.score}`, '#7CFF8A');
        if (ev.combo >= 2) this._spawnToast(ev.x, ev.y - 30, `🔥x${ev.combo}`, '#ffce3a');
        break;
      case 'serve_bad':
        this._spawnToast(ev.x, ev.y, '✖ 注文ちがい', '#ff6b8a');
        break;
      case 'order_fail':
        this._screenFlash('rgba(255,60,90,0.25)');
        break;
      case 'burnt':
        this._spawnToast(ev.x + TILE_SIZE / 2, ev.y, '💀こげた!', '#ff9f1c');
        break;
      case 'cook_done':
        this._spawnToast(ev.x + TILE_SIZE / 2, ev.y, '✨やけた', '#ffd84d');
        break;
    }
  }

  _spawnToast(wx, wy, text, color) {
    const p = this.renderer.project(wx, wy, 50);
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = text;
    el.style.color = color;
    el.style.left = p.x + 'px';
    el.style.top = p.y + 'px';
    document.getElementById('toast-layer').appendChild(el);
    setTimeout(() => el.remove(), 1000);
  }

  _screenFlash(color) {
    const el = document.createElement('div');
    el.style.cssText = `position:absolute;inset:0;background:${color};pointer-events:none;animation:none;`;
    el.style.transition = 'opacity .5s'; el.style.opacity = '1';
    document.getElementById('toast-layer').appendChild(el);
    requestAnimationFrame(() => { el.style.opacity = '0'; });
    setTimeout(() => el.remove(), 520);
  }

  // ============================================================
  // メインループ
  // ============================================================
  _loop(now) {
    if (!this.running) return;
    const dt = this._lastNow ? Math.min(0.05, (now - this._lastNow) / 1000) : 0.016;
    this._lastNow = now;
    // 入力送信(30Hz)
    if (now - this.lastInputSend > 33) {
      this.socket.emit('input', this.controls.get());
      this.lastInputSend = now;
    }
    // 補間
    for (const pl of this.players.values()) {
      const ddx = pl.target.x - pl.render.x, ddy = pl.target.y - pl.render.y;
      pl.render.x += ddx * 0.35;
      pl.render.y += ddy * 0.35;
      // 移動判定(バウンドアニメ用)
      pl.moving = Math.hypot(ddx, ddy) > 0.6;
      if (pl.phase === undefined) pl.phase = Math.random() * 6;
      // 角度補間(最短回り)
      let d = pl.target.dir - pl.render.dir;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      pl.render.dir += d * 0.35;
    }
    this._dt = dt;
    this.render();
    this.rafId = requestAnimationFrame(this._loop);
  }

  // ============================================================
  // 描画(depthソートで奥→手前)
  // ============================================================
  render() {
    const r = this.renderer;
    const myId = this.getMyId();
    r.clear(this._dt || 0.016);
    if (!this.level || !this.tiles) return;
    const W = this.level.width, H = this.level.height;

    // 0) ステージ土台(浮遊感)
    r.drawStage(this.level, TILE);
    // 1) 床を全部描く
    r.drawFloor(this.tiles, W, H, TILE);

    // 2) 描画対象を集めてYソート(疑似3D depth)
    const drawables = [];

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const tile = this.tiles[y][x];
        if (tile === TILE.WALL) {
          drawables.push({ sortY: y * TILE_SIZE, type: 'wall', x, y });
        } else if (tile === TILE.COUNTER) {
          const cell = this.stations ? this.stations[y][x] : null;
          drawables.push({ sortY: y * TILE_SIZE, type: 'station', x, y, cell });
        }
      }
    }
    // プレイヤー
    for (const pl of this.players.values()) {
      drawables.push({ sortY: pl.render.y, type: 'player', pl });
    }

    drawables.sort((a, b) => a.sortY - b.sortY);

    for (const d of drawables) {
      if (d.type === 'wall') {
        r.drawWall(d.x * TILE_SIZE, d.y * TILE_SIZE);
      } else if (d.type === 'station') {
        this._drawStation(d.x, d.y, d.cell);
      } else if (d.type === 'player') {
        r.drawPlayer({ ...d.pl.data, x: d.pl.render.x, y: d.pl.render.y, dir: d.pl.render.dir, moving: d.pl.moving, phase: d.pl.phase },
          d.pl.data.id === myId);
      }
    }

    // 仕上げ: ビネット
    r.drawVignette();
  }

  _drawStation(x, y, cell) {
    const r = this.renderer;
    const wx = x * TILE_SIZE, wy = y * TILE_SIZE;
    const stType = cell ? cell.station : STATION.COUNTER;
    const style = STATION_STYLE[stType] || STATION_STYLE[STATION.COUNTER];
    r.drawBox(wx, wy, style);
    r.drawStationIcon(wx, wy, style);

    if (!cell) return;

    // コンロの炎(調理中)
    if (stType === STATION.STOVE && cell.cooking && cell.item && !cell.cookDone) {
      // アイコンですでに🔥。進行中の追加演出は控えめに。
    }

    // 皿置き場の皿スタック
    if (stType === STATION.PLATE_STACK && cell.plates > 0) {
      const top = style.h;
      r.drawItem({ kind: 'plate', dirty: false, contents: [] }, wx + TILE_SIZE / 2, wy + TILE_SIZE / 2, top + 4);
    }

    // カウンター/ステーション上のアイテム
    if (cell.item) {
      r.drawItem(cell.item, wx + TILE_SIZE / 2, wy + TILE_SIZE / 2, style.h + 6);
    }

    // プログレスバー
    if (stType === STATION.CUTTING && cell.item && cell.item.state === 'raw' && cell.progress > 0) {
      r.drawProgress(wx + TILE_SIZE / 2, wy + TILE_SIZE / 2, style.h, cell.progress, '#ffd84d');
    }
    if (stType === STATION.STOVE && cell.item && cell.cooking && !cell.cookDone) {
      r.drawProgress(wx + TILE_SIZE / 2, wy + TILE_SIZE / 2, style.h, cell.progress,
        cell.burning ? '#ff5d4d' : '#ff9f1c');
    }
    if (stType === STATION.STOVE && cell.cookDone && cell.burning) {
      // 焦げ警告
      r.drawProgress(wx + TILE_SIZE / 2, wy + TILE_SIZE / 2, style.h, 1, '#ff3b3b');
    }
    if (stType === STATION.WASH && cell.item && cell.item.dirty && cell.progress > 0) {
      r.drawProgress(wx + TILE_SIZE / 2, wy + TILE_SIZE / 2, style.h, cell.progress, '#4dd2ff');
    }
  }

  // ============================================================
  // HUD更新
  // ============================================================
  updateHUD() {
    // タイマー
    const t = Math.max(0, Math.floor(this.timeLeft));
    const mm = Math.floor(t / 60), ss = String(t % 60).padStart(2, '0');
    const timerEl = document.getElementById('hud-timer');
    timerEl.textContent = `⏱ ${mm}:${ss}`;
    timerEl.classList.toggle('urgent', t <= 20);

    document.getElementById('hud-score').textContent = `⭐ ${this.score}`;
    const comboEl = document.getElementById('hud-combo');
    comboEl.textContent = this.combo >= 2 ? `🔥 コンボ x${this.combo}` : '';

    // 注文カード
    const oc = document.getElementById('hud-orders');
    // 既存と差分更新(チラつき防止: idベース)
    const existing = new Map([...oc.children].map(c => [c.dataset.id, c]));
    const keep = new Set();
    for (const o of this.orders) {
      keep.add(String(o.id));
      const recipe = RECIPES[o.recipe];
      let card = existing.get(String(o.id));
      const ratio = Math.max(0, o.timeLeft / o.maxTime);
      if (!card) {
        card = document.createElement('div');
        card.className = 'order-card';
        card.dataset.id = o.id;
        const items = recipe.requires.map(req => {
          const info = INGREDIENTS[req.type];
          const tag = req.state === 'chopped' ? '🔪' : req.state === 'cooked' ? '🔥' : '';
          return `${info.emoji}${tag}`;
        }).join(' ');
        card.innerHTML = `
          <div class="order-emoji">${recipe.emoji}</div>
          <div class="order-name">${recipe.name}</div>
          <div class="order-items">${items}</div>
          <div class="order-bar"><div></div></div>`;
        oc.appendChild(card);
      }
      const bar = card.querySelector('.order-bar');
      const fill = bar.querySelector('div');
      fill.style.width = (ratio * 100) + '%';
      bar.classList.toggle('warn', ratio < 0.5 && ratio >= 0.25);
      bar.classList.toggle('danger', ratio < 0.25);
    }
    // 消えた注文を削除
    for (const [id, el] of existing) {
      if (!keep.has(id)) el.remove();
    }
  }
}
