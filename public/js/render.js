// ============================================================
// Kitchen Chaos - 描画ヘルパー
// 2.5D風(疑似3D): 床はタイル、オブジェクトは「高さ」を持つ箱として
// 上面+側面を描き、影を落として立体的に見せる。ブロスタ風のポップ調。
// ============================================================
import { STATION, INGREDIENTS, RECIPES, TILE_SIZE } from '/shared/gamedata.js';

// ステーションの見た目定義(色・高さ・アイコン)
export const STATION_STYLE = {
  [STATION.COUNTER]:       { top: '#caa37a', side: '#9c7c54', h: 18, icon: '' },
  [STATION.CRATE_TOMATO]:  { top: '#b06b3a', side: '#7d4a26', h: 26, icon: '🍅' },
  [STATION.CRATE_LETTUCE]: { top: '#b06b3a', side: '#7d4a26', h: 26, icon: '🥬' },
  [STATION.CRATE_BREAD]:   { top: '#b06b3a', side: '#7d4a26', h: 26, icon: '🍞' },
  [STATION.CRATE_MEAT]:    { top: '#b06b3a', side: '#7d4a26', h: 26, icon: '🥩' },
  [STATION.CRATE_FISH]:    { top: '#b06b3a', side: '#7d4a26', h: 26, icon: '🐟' },
  [STATION.CUTTING]:       { top: '#d9c29a', side: '#a8895f', h: 18, icon: '🔪' },
  [STATION.STOVE]:         { top: '#444', side: '#2a2a2a', h: 18, icon: '🔥' },
  [STATION.PLATE_STACK]:   { top: '#bcd', side: '#89a', h: 18, icon: '🍽️' },
  [STATION.SERVE]:         { top: '#3a7', side: '#286', h: 16, icon: '🛎️' },
  [STATION.WASH]:          { top: '#7ac', side: '#589', h: 18, icon: '🚿' },
  [STATION.TRASH]:         { top: '#555', side: '#333', h: 22, icon: '🗑️' },
};

const WALL_STYLE = { top: '#3a2c5e', side: '#241a3e', h: 40 };
const FLOOR_A = '#e8ddc8';
const FLOOR_B = '#ddd0b6';

// Y方向の見かけ縮み(疑似奥行き)。1=真上, <1で斜め見下ろし感
export const Y_SQUASH = 0.82;
// オブジェクト高さ→画面上シフトの倍率
export const HEIGHT_SCALE = 1.0;

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.cam = { x: 0, y: 0, scale: 1 };
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.canvas.width = w * this.dpr;
    this.canvas.height = h * this.dpr;
    this.vw = w; this.vh = h;
  }

  // ワールド座標→スクリーン座標(疑似3D投影)
  // 高さhは画面上方向(マイナスY)へオフセット
  project(wx, wy, h = 0) {
    const sx = (wx - this.cam.x) * this.cam.scale + this.vw / 2;
    const sy = (wy * Y_SQUASH - this.cam.y) * this.cam.scale + this.vh / 2 - h * this.cam.scale;
    return { x: sx, y: sy };
  }

  // カメラを盤面全体が入るように設定(固定 or 追従)
  setupCamera(level) {
    const mapW = level.width * TILE_SIZE;
    const mapH = level.height * TILE_SIZE * Y_SQUASH;
    // 全体が見えるスケール
    const margin = 1.12;
    const scale = Math.min(this.vw / (mapW * margin), this.vh / (mapH * margin + 90));
    this.cam.scale = scale;
    this.cam.x = mapW / 2;
    this.cam.y = mapH / 2 + 12; // 少し下げてHUDと干渉回避
  }

  clear() {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.vw, this.vh);
    // 背景グラデ
    const g = ctx.createLinearGradient(0, 0, 0, this.vh);
    g.addColorStop(0, '#1a1233');
    g.addColorStop(1, '#0d0820');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.vw, this.vh);
  }

  // ---- 床描画 ----
  drawFloor(tiles, width, height, TILE) {
    const ctx = this.ctx;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (tiles[y][x] !== TILE.FLOOR) continue;
        const wx = x * TILE_SIZE, wy = y * TILE_SIZE;
        const p = this.project(wx, wy, 0);
        const w = TILE_SIZE * this.cam.scale;
        const hh = TILE_SIZE * Y_SQUASH * this.cam.scale;
        ctx.fillStyle = (x + y) % 2 === 0 ? FLOOR_A : FLOOR_B;
        ctx.fillRect(p.x, p.y, w + 1, hh + 1);
        // タイルの溝
        ctx.strokeStyle = 'rgba(0,0,0,0.06)';
        ctx.lineWidth = 1;
        ctx.strokeRect(p.x, p.y, w, hh);
      }
    }
  }

  // ---- 高さのある箱(壁/カウンター/ステーション)を描く ----
  drawBox(wx, wy, style, scaleBoost = 1) {
    const ctx = this.ctx;
    const s = this.cam.scale;
    const w = TILE_SIZE * s;
    const depth = TILE_SIZE * Y_SQUASH * s;
    const h = style.h * s * scaleBoost;

    const top = this.project(wx, wy, style.h * scaleBoost);
    const base = this.project(wx, wy, 0);

    // 影(地面)
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(base.x + 3, base.y + depth - 4, w, 6);

    // 側面(前面)
    ctx.fillStyle = style.side;
    ctx.fillRect(top.x, top.y + depth, w, h);
    // 上面
    ctx.fillStyle = style.top;
    ctx.fillRect(top.x, top.y, w, depth);
    // ハイライト
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(top.x, top.y, w, depth * 0.25);
    // 縁取り
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(top.x, top.y, w, depth);
    ctx.strokeRect(top.x, top.y + depth, w, h);

    return { top, base, w, depth, h };
  }

  drawWall(wx, wy) {
    this.drawBox(wx, wy, WALL_STYLE);
  }

  // アイコン(emoji)を箱の上面中央に描く
  drawStationIcon(wx, wy, style) {
    if (!style.icon) return;
    const ctx = this.ctx;
    const top = this.project(wx + TILE_SIZE / 2, wy + TILE_SIZE / 2, style.h + 2);
    const fs = TILE_SIZE * 0.5 * this.cam.scale;
    ctx.font = `${fs}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(style.icon, top.x, top.y);
  }

  // ---- アイテム(食材/皿)をある位置・高さに描く ----
  drawItem(item, wx, wy, baseHeight) {
    const ctx = this.ctx;
    const s = this.cam.scale;
    const p = this.project(wx, wy, baseHeight);
    if (item.kind === 'ingredient') {
      this._drawIngredient(item, p.x, p.y, s);
    } else if (item.kind === 'plate') {
      this._drawPlate(item, p.x, p.y, s);
    }
  }

  _drawIngredient(item, x, y, s) {
    const ctx = this.ctx;
    const info = INGREDIENTS[item.type];
    const size = TILE_SIZE * 0.42 * s;
    // 状態で見た目変化
    let emoji = info.emoji;
    let tint = null;
    if (item.state === 'chopped') { /* 切った: 小さい粒で表現 */ }
    if (item.state === 'cooked') tint = 'rgba(120,60,20,0.0)';
    if (item.state === 'burnt') tint = 'rgba(0,0,0,0.55)';

    ctx.font = `${size}px serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';

    if (item.state === 'chopped') {
      // 刻んだ食材: 3粒
      const o = size * 0.22;
      ctx.font = `${size * 0.62}px serif`;
      ctx.fillText(emoji, x - o, y - o * 0.5);
      ctx.fillText(emoji, x + o, y - o * 0.5);
      ctx.fillText(emoji, x, y + o * 0.6);
    } else {
      ctx.fillText(emoji, x, y);
    }
    if (item.state === 'cooked') {
      // 焼き目: 軽い茶色オーバーレイ + ✨
      ctx.font = `${size * 0.5}px serif`;
      ctx.fillText('✨', x + size * 0.4, y - size * 0.4);
    }
    if (item.state === 'burnt' && tint) {
      ctx.fillStyle = tint;
      ctx.beginPath(); ctx.arc(x, y, size * 0.5, 0, Math.PI * 2); ctx.fill();
      ctx.font = `${size * 0.6}px serif`;
      ctx.fillText('💀', x, y);
    }
  }

  _drawPlate(item, x, y, s) {
    const ctx = this.ctx;
    const r = TILE_SIZE * 0.34 * s;
    // 皿
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.55, 0, 0, Math.PI * 2);
    ctx.fillStyle = item.dirty ? '#9a8' : '#f3f3f8';
    ctx.fill();
    ctx.strokeStyle = item.dirty ? '#6b6' : '#c4c4d4';
    ctx.lineWidth = 2; ctx.stroke();
    // 内側
    ctx.beginPath();
    ctx.ellipse(x, y - r * 0.05, r * 0.62, r * 0.34, 0, 0, Math.PI * 2);
    ctx.fillStyle = item.dirty ? '#7a6' : '#e3e3ef';
    ctx.fill();

    if (item.dirty) {
      ctx.font = `${r * 0.8}px serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('🧽', x, y - r * 0.1);
      return;
    }
    // 盛り付けた食材
    const n = item.contents.length;
    item.contents.forEach((c, i) => {
      const info = INGREDIENTS[c.type];
      const ang = (i / Math.max(1, n)) * Math.PI * 2;
      const ox = Math.cos(ang) * r * 0.28;
      const oy = Math.sin(ang) * r * 0.16;
      ctx.font = `${r * 0.7}px serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(info.emoji, x + ox, y - r * 0.15 + oy);
    });
  }

  // ---- プログレスバー(切る/焼く/洗う進行) ----
  drawProgress(wx, wy, baseHeight, progress, color) {
    const ctx = this.ctx;
    const p = this.project(wx, wy, baseHeight + 22);
    const w = TILE_SIZE * 0.7 * this.cam.scale;
    const h = 7 * this.cam.scale;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(p.x - w / 2, p.y, w, h);
    ctx.fillStyle = color;
    ctx.fillRect(p.x - w / 2, p.y, w * Math.min(1, progress), h);
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 1;
    ctx.strokeRect(p.x - w / 2, p.y, w, h);
  }

  // ---- プレイヤーキャラ描画(人型・カプセル+頭+コック帽) ----
  drawPlayer(player, isMe) {
    const ctx = this.ctx;
    const s = this.cam.scale;
    const base = this.project(player.x, player.y, 0);
    const bodyH = 30 * s;
    const headR = 11 * s;
    const bodyR = 13 * s;

    // 影
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(base.x, base.y, bodyR * 1.1, bodyR * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // 体(下が床、上に伸びる) — カプセル
    const topY = base.y - bodyH;
    ctx.fillStyle = player.color;
    this._roundRect(ctx, base.x - bodyR, topY, bodyR * 2, bodyH + bodyR, bodyR);
    ctx.fill();
    // 体の陰影
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    this._roundRect(ctx, base.x, topY, bodyR, bodyH + bodyR, bodyR * 0.8);
    ctx.fill();

    // 頭
    const headY = topY - headR * 0.4;
    ctx.fillStyle = '#ffe0bd';
    ctx.beginPath();
    ctx.arc(base.x, headY, headR, 0, Math.PI * 2);
    ctx.fill();

    // コック帽
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.ellipse(base.x, headY - headR * 0.9, headR * 1.05, headR * 0.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(base.x - headR * 0.75, headY - headR * 0.9, headR * 1.5, headR * 0.7);
    ctx.fillStyle = '#eee';
    ctx.fillRect(base.x - headR * 0.8, headY - headR * 0.25, headR * 1.6, headR * 0.35);

    // 顔の向きインジケータ(目)
    const fx = Math.cos(player.dir) * headR * 0.4;
    const fyy = Math.sin(player.dir) * headR * 0.3;
    ctx.fillStyle = '#333';
    ctx.beginPath(); ctx.arc(base.x - headR * 0.35 + fx, headY + fyy, 1.8 * s, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(base.x + headR * 0.35 + fx, headY + fyy, 1.8 * s, 0, Math.PI * 2); ctx.fill();

    // 自分のキャラには矢印マーカー
    if (isMe) {
      const m = this.project(player.x, player.y, 58);
      ctx.fillStyle = '#ffce3a';
      ctx.beginPath();
      ctx.moveTo(m.x, m.y + 8 * s);
      ctx.lineTo(m.x - 7 * s, m.y - 4 * s);
      ctx.lineTo(m.x + 7 * s, m.y - 4 * s);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 1; ctx.stroke();
    }

    // 名前
    const nameP = this.project(player.x, player.y, 64);
    ctx.font = `${Math.max(10, 11 * s)}px sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillText(player.name + (player.isAI ? ' 🤖' : ''), nameP.x + 1, nameP.y + 1);
    ctx.fillStyle = '#fff';
    ctx.fillText(player.name + (player.isAI ? ' 🤖' : ''), nameP.x, nameP.y);

    // 持っているアイテム(頭上)
    if (player.holding) {
      const hp = this.project(player.x, player.y, bodyH / s + 20);
      this.drawItemAt(player.holding, hp.x, hp.y, s);
    }
  }

  drawItemAt(item, x, y, s) {
    if (item.kind === 'ingredient') this._drawIngredient(item, x, y, s);
    else this._drawPlate(item, x, y, s);
  }

  _roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
}
