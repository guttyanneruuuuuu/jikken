// ============================================================
// Kitchen Chaos - 描画ヘルパー (v2: デザイン強化)
// 2.5D風(疑似3D): 床はタイル、オブジェクトは「高さ」を持つ箱として
// 上面+側面を描き、影を落として立体的に見せる。ブロスタ風のポップ調。
//  - 丸角・グラデ・縁取り・キャラの上下バウンドアニメ
//  - ビネット/グロー/床の質感アップ
// ============================================================
import { STATION, INGREDIENTS, RECIPES, TILE_SIZE } from '/shared/gamedata.js';

// ステーションの見た目定義(色・高さ・アイコン)
export const STATION_STYLE = {
  [STATION.COUNTER]:       { top: '#d8b487', side: '#a07c52', h: 20, icon: '',    label: '' },
  [STATION.CRATE_TOMATO]:  { top: '#e07a45', side: '#9c4f28', h: 30, icon: '🍅', label: '' },
  [STATION.CRATE_LETTUCE]: { top: '#6fbf4c', side: '#3f7d2c', h: 30, icon: '🥬', label: '' },
  [STATION.CRATE_BREAD]:   { top: '#d9a24a', side: '#9c6f28', h: 30, icon: '🍞', label: '' },
  [STATION.CRATE_MEAT]:    { top: '#d06b6b', side: '#8c3c3c', h: 30, icon: '🥩', label: '' },
  [STATION.CRATE_FISH]:    { top: '#5aa6d6', side: '#356f96', h: 30, icon: '🐟', label: '' },
  [STATION.CUTTING]:       { top: '#e7d2a8', side: '#a8895f', h: 20, icon: '🔪', label: 'きる' },
  [STATION.STOVE]:         { top: '#3a3a44', side: '#202028', h: 20, icon: '🔥', label: 'やく' },
  [STATION.PLATE_STACK]:   { top: '#cdd6e6', side: '#8f9bb3', h: 22, icon: '🍽️', label: 'さら' },
  [STATION.SERVE]:         { top: '#3ec98a', side: '#249a66', h: 18, icon: '🛎️', label: 'だす' },
  [STATION.WASH]:          { top: '#5ab6e0', side: '#357f9c', h: 20, icon: '🚿', label: 'あらう' },
  [STATION.TRASH]:         { top: '#5a5a64', side: '#34343c', h: 24, icon: '🗑️', label: 'すてる' },
};

const WALL_STYLE = { top: '#4a3a72', side: '#2a1f4a', h: 44 };
const FLOOR_A = '#efe6d2';
const FLOOR_B = '#e3d7bd';
const FLOOR_LINE = 'rgba(120,90,50,0.10)';

// Y方向の見かけ縮み(疑似奥行き)。1=真上, <1で斜め見下ろし感
export const Y_SQUASH = 0.80;
export const HEIGHT_SCALE = 1.0;

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.cam = { x: 0, y: 0, scale: 1 };
    this.t = 0; // アニメーション時刻
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

  project(wx, wy, h = 0) {
    const sx = (wx - this.cam.x) * this.cam.scale + this.vw / 2;
    const sy = (wy * Y_SQUASH - this.cam.y) * this.cam.scale + this.vh / 2 - h * this.cam.scale;
    return { x: sx, y: sy };
  }

  setupCamera(level) {
    const mapW = level.width * TILE_SIZE;
    const mapH = level.height * TILE_SIZE * Y_SQUASH;
    const margin = 1.14;
    const scale = Math.min(this.vw / (mapW * margin), this.vh / (mapH * margin + 100));
    this.cam.scale = scale;
    this.cam.x = mapW / 2;
    this.cam.y = mapH / 2 + 14;
  }

  clear(dt = 0.016) {
    this.t += dt;
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.vw, this.vh);
    // 背景グラデ(奥が暗い舞台照明風)
    const g = ctx.createRadialGradient(this.vw / 2, this.vh * 0.42, 40, this.vw / 2, this.vh * 0.5, Math.max(this.vw, this.vh) * 0.8);
    g.addColorStop(0, '#2a1f52');
    g.addColorStop(0.6, '#1a1336');
    g.addColorStop(1, '#0c0820');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.vw, this.vh);
  }

  // 盤面の外周に床下のステージ(土台)を敷いて浮遊感を出す
  drawStage(level, TILE) {
    const ctx = this.ctx;
    const s = this.cam.scale;
    const mapW = level.width * TILE_SIZE;
    const mapH = level.height * TILE_SIZE;
    const pad = TILE_SIZE * 0.5;
    const tl = this.project(-pad, -pad, 0);
    const w = (mapW + pad * 2) * s;
    const d = (mapH + pad * 2) * Y_SQUASH * s;
    const stageH = 26 * s;
    // 落ち影
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    this._roundRect(ctx, tl.x + 10, tl.y + d + 6, w, stageH + 8, 18 * s);
    ctx.fill();
    // 側面
    ctx.fillStyle = '#3a2c5e';
    this._roundRect(ctx, tl.x, tl.y + d, w, stageH, 14 * s);
    ctx.fill();
    // 上面(床の下地)
    ctx.fillStyle = '#5a4a86';
    this._roundRect(ctx, tl.x, tl.y, w, d, 16 * s);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 2 * s;
    this._roundRect(ctx, tl.x, tl.y, w, d, 16 * s);
    ctx.stroke();
  }

  // ---- 床描画 ----
  drawFloor(tiles, width, height, TILE) {
    const ctx = this.ctx;
    const s = this.cam.scale;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (tiles[y][x] !== TILE.FLOOR) continue;
        const wx = x * TILE_SIZE, wy = y * TILE_SIZE;
        const p = this.project(wx, wy, 0);
        const w = TILE_SIZE * s;
        const hh = TILE_SIZE * Y_SQUASH * s;
        ctx.fillStyle = (x + y) % 2 === 0 ? FLOOR_A : FLOOR_B;
        ctx.fillRect(p.x, p.y, w + 1, hh + 1);
        // タイルの溝(柔らかいライン)
        ctx.strokeStyle = FLOOR_LINE;
        ctx.lineWidth = 1;
        ctx.strokeRect(p.x + 0.5, p.y + 0.5, w, hh);
        // ほんのりハイライト(左上)
        ctx.fillStyle = 'rgba(255,255,255,0.05)';
        ctx.fillRect(p.x, p.y, w, hh * 0.18);
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
    const r = Math.min(8 * s, w * 0.2);

    const top = this.project(wx, wy, style.h * scaleBoost);
    const base = this.project(wx, wy, 0);

    // 影(地面・楕円ソフト)
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath();
    ctx.ellipse(base.x + w / 2, base.y + depth - 2 * s, w * 0.52, depth * 0.32, 0, 0, Math.PI * 2);
    ctx.fill();

    // 側面(前面) — グラデで丸み
    const sg = ctx.createLinearGradient(0, top.y + depth, 0, top.y + depth + h);
    sg.addColorStop(0, style.side);
    sg.addColorStop(1, this._shade(style.side, -18));
    ctx.fillStyle = sg;
    this._roundRectMixed(ctx, top.x, top.y + depth - r, w, h + r, 0, 0, r, r);
    ctx.fill();

    // 上面 — 丸角+ハイライトグラデ
    const tg = ctx.createLinearGradient(0, top.y, 0, top.y + depth);
    tg.addColorStop(0, this._shade(style.top, 12));
    tg.addColorStop(1, style.top);
    ctx.fillStyle = tg;
    this._roundRect(ctx, top.x, top.y, w, depth, r);
    ctx.fill();

    // 上面ハイライト
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    this._roundRectMixed(ctx, top.x + 2, top.y + 2, w - 4, depth * 0.32, r, r, 0, 0);
    ctx.fill();

    // 縁取り
    ctx.strokeStyle = 'rgba(0,0,0,0.30)';
    ctx.lineWidth = 1.5;
    this._roundRect(ctx, top.x, top.y, w, depth, r);
    ctx.stroke();

    return { top, base, w, depth, h };
  }

  drawWall(wx, wy) {
    this.drawBox(wx, wy, WALL_STYLE);
  }

  // アイコン(emoji)を箱の上面中央に描く + ラベル
  drawStationIcon(wx, wy, style) {
    if (!style.icon) return;
    const ctx = this.ctx;
    const s = this.cam.scale;
    const top = this.project(wx + TILE_SIZE / 2, wy + TILE_SIZE / 2, style.h + 3);
    const fs = TILE_SIZE * 0.5 * s;
    // アイコン下に淡い円
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.beginPath();
    ctx.ellipse(top.x, top.y + fs * 0.1, fs * 0.62, fs * 0.42, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = `${fs}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(style.icon, top.x, top.y);
    // ラベル
    if (style.label) {
      const lp = this.project(wx + TILE_SIZE / 2, wy + TILE_SIZE / 2, 2);
      ctx.font = `700 ${Math.max(8, 9 * s)}px sans-serif`;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillText(style.label, lp.x, lp.y + 2);
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.fillText(style.label, lp.x, lp.y + 1);
    }
  }

  // ---- アイテム(食材/皿)をある位置・高さに描く ----
  drawItem(item, wx, wy, baseHeight) {
    const s = this.cam.scale;
    const p = this.project(wx, wy, baseHeight);
    if (item.kind === 'ingredient') this._drawIngredient(item, p.x, p.y, s);
    else if (item.kind === 'plate') this._drawPlate(item, p.x, p.y, s);
  }

  _drawIngredient(item, x, y, s) {
    const ctx = this.ctx;
    const info = INGREDIENTS[item.type];
    const size = TILE_SIZE * 0.44 * s;
    let emoji = info.emoji;

    ctx.font = `${size}px serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';

    if (item.state === 'chopped') {
      // 刻んだ食材: まな板色の小皿に3粒
      ctx.font = `${size * 0.6}px serif`;
      const o = size * 0.22;
      ctx.fillText(emoji, x - o, y - o * 0.4);
      ctx.fillText(emoji, x + o, y - o * 0.4);
      ctx.fillText(emoji, x, y + o * 0.6);
    } else {
      ctx.fillText(emoji, x, y);
    }
    if (item.state === 'cooked') {
      ctx.font = `${size * 0.5}px serif`;
      ctx.fillText('✨', x + size * 0.42, y - size * 0.42);
    }
    if (item.state === 'burnt') {
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.beginPath(); ctx.arc(x, y, size * 0.5, 0, Math.PI * 2); ctx.fill();
      ctx.font = `${size * 0.6}px serif`;
      ctx.fillText('💀', x, y);
    }
  }

  _drawPlate(item, x, y, s) {
    const ctx = this.ctx;
    const r = TILE_SIZE * 0.36 * s;
    // 皿の影
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.beginPath(); ctx.ellipse(x, y + r * 0.2, r * 1.02, r * 0.5, 0, 0, Math.PI * 2); ctx.fill();
    // 皿
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.55, 0, 0, Math.PI * 2);
    const pg = ctx.createLinearGradient(0, y - r * 0.5, 0, y + r * 0.5);
    if (item.dirty) { pg.addColorStop(0, '#b5c79a'); pg.addColorStop(1, '#8fa07a'); }
    else { pg.addColorStop(0, '#ffffff'); pg.addColorStop(1, '#e2e2ee'); }
    ctx.fillStyle = pg;
    ctx.fill();
    ctx.strokeStyle = item.dirty ? '#6b8a4d' : '#c4c4d8';
    ctx.lineWidth = 2; ctx.stroke();
    // 内側
    ctx.beginPath();
    ctx.ellipse(x, y - r * 0.05, r * 0.62, r * 0.34, 0, 0, Math.PI * 2);
    ctx.fillStyle = item.dirty ? '#7a8f5c' : '#ececf6';
    ctx.fill();

    if (item.dirty) {
      ctx.font = `${r * 0.8}px serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('🧼', x, y - r * 0.1);
      return;
    }
    // 盛り付けた食材
    const n = item.contents.length;
    item.contents.forEach((c, i) => {
      const info = INGREDIENTS[c.type];
      const ang = (i / Math.max(1, n)) * Math.PI * 2 - Math.PI / 2;
      const ox = Math.cos(ang) * r * (n > 1 ? 0.3 : 0);
      const oy = Math.sin(ang) * r * (n > 1 ? 0.17 : 0);
      ctx.font = `${r * 0.66}px serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(info.emoji, x + ox, y - r * 0.12 + oy);
    });
  }

  // ---- プログレスバー(切る/焼く/洗う進行) ----
  drawProgress(wx, wy, baseHeight, progress, color) {
    const ctx = this.ctx;
    const s = this.cam.scale;
    const p = this.project(wx, wy, baseHeight + 24);
    const w = TILE_SIZE * 0.74 * s;
    const h = 8 * s;
    const r = h / 2;
    // 背景
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    this._roundRect(ctx, p.x - w / 2, p.y, w, h, r); ctx.fill();
    // バー
    const cw = Math.max(h, w * Math.min(1, progress));
    ctx.fillStyle = color;
    this._roundRect(ctx, p.x - w / 2, p.y, cw, h, r); ctx.fill();
    // 光沢
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    this._roundRect(ctx, p.x - w / 2 + 1, p.y + 1, cw - 2, h * 0.4, r); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1;
    this._roundRect(ctx, p.x - w / 2, p.y, w, h, r); ctx.stroke();
  }

  // ---- プレイヤーキャラ描画 ----
  drawPlayer(player, isMe) {
    const ctx = this.ctx;
    const s = this.cam.scale;
    // 移動中は上下バウンド
    const moving = player.moving;
    const bob = moving ? Math.abs(Math.sin(this.t * 10 + (player.phase || 0))) * 4 * s : 0;
    const base = this.project(player.x, player.y, 0);
    base.y -= bob;
    const bodyH = 30 * s;
    const headR = 11 * s;
    const bodyR = 13 * s;

    // 影(地面・バウンドで小さくなる)
    const shadowScale = 1 - bob / (8 * s) * 0.3;
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath();
    ctx.ellipse(this.project(player.x, player.y, 0).x, this.project(player.x, player.y, 0).y, bodyR * 1.15 * shadowScale, bodyR * 0.5 * shadowScale, 0, 0, Math.PI * 2);
    ctx.fill();

    // 体(カプセル) — 縁取り付き
    const topY = base.y - bodyH;
    ctx.lineWidth = 2.5 * s;
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    this._roundRect(ctx, base.x - bodyR, topY, bodyR * 2, bodyH + bodyR, bodyR);
    const bg = ctx.createLinearGradient(base.x - bodyR, topY, base.x + bodyR, topY);
    bg.addColorStop(0, this._shade(player.color, 14));
    bg.addColorStop(1, this._shade(player.color, -14));
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.stroke();
    // 体ハイライト
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    this._roundRect(ctx, base.x - bodyR + 2 * s, topY + 2 * s, bodyR * 0.7, bodyH * 0.7, bodyR * 0.5);
    ctx.fill();

    // 頭
    const headY = topY - headR * 0.35;
    ctx.beginPath();
    ctx.arc(base.x, headY, headR, 0, Math.PI * 2);
    ctx.fillStyle = '#ffe0bd';
    ctx.fill();
    ctx.lineWidth = 2 * s;
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.stroke();

    // コック帽
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.ellipse(base.x, headY - headR * 0.95, headR * 1.1, headR * 0.62, 0, 0, Math.PI * 2);
    ctx.fill();
    this._roundRect(ctx, base.x - headR * 0.78, headY - headR * 0.95, headR * 1.56, headR * 0.78, headR * 0.2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.12)';
    ctx.lineWidth = 1.5 * s;
    ctx.beginPath();
    ctx.ellipse(base.x, headY - headR * 0.95, headR * 1.1, headR * 0.62, 0, 0, Math.PI * 2);
    ctx.stroke();

    // 目(向き反映)
    const fx = Math.cos(player.dir) * headR * 0.35;
    const fyy = Math.sin(player.dir) * headR * 0.25;
    ctx.fillStyle = '#2a2a3a';
    ctx.beginPath(); ctx.arc(base.x - headR * 0.32 + fx, headY + fyy, 2.0 * s, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(base.x + headR * 0.32 + fx, headY + fyy, 2.0 * s, 0, Math.PI * 2); ctx.fill();

    // 自分マーカー(回転する菱形リング)
    if (isMe) {
      const m = this.project(player.x, player.y, 60);
      m.y -= bob;
      const pulse = 1 + Math.sin(this.t * 4) * 0.12;
      ctx.save();
      ctx.translate(m.x, m.y);
      ctx.scale(pulse, pulse);
      ctx.fillStyle = '#ffce3a';
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, 9 * s);
      ctx.lineTo(-7 * s, -3 * s);
      ctx.lineTo(7 * s, -3 * s);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.restore();
    }

    // 名前ラベル(角丸ピル)
    const nameP = this.project(player.x, player.y, isMe ? 74 : 66);
    nameP.y -= bob;
    const nm = player.name + (player.isAI ? ' 🤖' : '');
    ctx.font = `700 ${Math.max(10, 11 * s)}px sans-serif`;
    const tw = ctx.measureText(nm).width;
    const padX = 6 * s, ph = 16 * s;
    ctx.fillStyle = isMe ? 'rgba(255,206,58,0.92)' : 'rgba(20,16,40,0.72)';
    this._roundRect(ctx, nameP.x - tw / 2 - padX, nameP.y - ph, tw + padX * 2, ph, ph / 2);
    ctx.fill();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = isMe ? '#3a2a00' : '#fff';
    ctx.fillText(nm, nameP.x, nameP.y - ph / 2);

    // 持っているアイテム(頭上)
    if (player.holding) {
      const hp = this.project(player.x, player.y, bodyH / s + 22);
      hp.y -= bob;
      this.drawItemAt(player.holding, hp.x, hp.y, s);
    }
  }

  drawItemAt(item, x, y, s) {
    if (item.kind === 'ingredient') this._drawIngredient(item, x, y, s);
    else this._drawPlate(item, x, y, s);
  }

  // 画面端ビネット
  drawVignette() {
    const ctx = this.ctx;
    const g = ctx.createRadialGradient(this.vw / 2, this.vh / 2, this.vh * 0.35, this.vw / 2, this.vh / 2, this.vh * 0.85);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.35)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.vw, this.vh);
  }

  // 色を明暗調整
  _shade(hex, amt) {
    const c = hex.replace('#', '');
    const n = c.length === 3 ? c.split('').map(x => x + x).join('') : c;
    let r = parseInt(n.slice(0, 2), 16), g = parseInt(n.slice(2, 4), 16), b = parseInt(n.slice(4, 6), 16);
    r = Math.max(0, Math.min(255, r + amt));
    g = Math.max(0, Math.min(255, g + amt));
    b = Math.max(0, Math.min(255, b + amt));
    return `rgb(${r},${g},${b})`;
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

  // 角ごとに半径を変えられる角丸(tl,tr,br,bl)
  _roundRectMixed(ctx, x, y, w, h, tl, tr, br, bl) {
    ctx.beginPath();
    ctx.moveTo(x + tl, y);
    ctx.lineTo(x + w - tr, y);
    ctx.arcTo(x + w, y, x + w, y + tr, tr);
    ctx.lineTo(x + w, y + h - br);
    ctx.arcTo(x + w, y + h, x + w - br, y + h, br);
    ctx.lineTo(x + bl, y + h);
    ctx.arcTo(x, y + h, x, y + h - bl, bl);
    ctx.lineTo(x, y + tl);
    ctx.arcTo(x, y, x + tl, y, tl);
    ctx.closePath();
  }
}
