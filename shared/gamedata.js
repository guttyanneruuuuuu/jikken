// ============================================================
// Kitchen Chaos - 共有ゲームデータ定義
// クライアント & サーバー両方で利用する定数・レシピ・レベル
// ============================================================

// --- タイル種別 ---
export const TILE = {
  FLOOR: 0,      // 床（歩ける）
  COUNTER: 1,    // カウンター（物を置ける・壁）
  WALL: 2,       // 壁（通れない・置けない）
};

// --- ステーション種別 ---
export const STATION = {
  NONE: 'none',
  CRATE_TOMATO: 'crate_tomato',   // トマト箱
  CRATE_LETTUCE: 'crate_lettuce', // レタス箱
  CRATE_BREAD: 'crate_bread',     // パン箱
  CRATE_MEAT: 'crate_meat',       // 肉箱
  CRATE_FISH: 'crate_fish',       // 魚箱
  CUTTING: 'cutting',             // まな板（切る）
  STOVE: 'stove',                 // コンロ（焼く）
  PLATE_STACK: 'plate_stack',     // 皿置き場
  SERVE: 'serve',                 // 提供口
  WASH: 'wash',                   // 洗い場（汚れた皿を洗う）
  TRASH: 'trash',                 // ゴミ箱
  COUNTER: 'counter',             // ただのカウンター（置き場）
};

// --- 食材の状態 ---
// raw: 生 / chopped: 切った / cooked: 焼いた / burnt: 焦げた
export const INGREDIENTS = {
  tomato:  { name: 'トマト',  color: '#e44', needChop: true,  needCook: false, emoji: '🍅' },
  lettuce: { name: 'レタス',  color: '#5c5', needChop: true,  needCook: false, emoji: '🥬' },
  bread:   { name: 'パン',    color: '#d9a24a', needChop: false, needCook: false, emoji: '🍞' },
  meat:    { name: '肉',      color: '#c66', needChop: true,  needCook: true,  emoji: '🥩' },
  fish:    { name: '魚',      color: '#6ad', needChop: true,  needCook: true,  emoji: '🐟' },
};

// --- レシピ定義 ---
// requires: 必要な「加工済み食材」のリスト（状態込み）
// 各食材: { type, state } state= chopped/cooked など
export const RECIPES = {
  salad: {
    name: 'サラダ',
    emoji: '🥗',
    requires: [
      { type: 'tomato', state: 'chopped' },
      { type: 'lettuce', state: 'chopped' },
    ],
    score: 30,
    color: '#7c5',
  },
  burger: {
    name: 'バーガー',
    emoji: '🍔',
    requires: [
      { type: 'meat', state: 'cooked' },
      { type: 'bread', state: 'raw' },
    ],
    score: 50,
    color: '#c83',
  },
  fishplate: {
    name: 'グリルフィッシュ',
    emoji: '🍽️',
    requires: [
      { type: 'fish', state: 'cooked' },
      { type: 'lettuce', state: 'chopped' },
    ],
    score: 60,
    color: '#5ad',
  },
  deluxeburger: {
    name: 'デラックスバーガー',
    emoji: '🍔',
    requires: [
      { type: 'meat', state: 'cooked' },
      { type: 'tomato', state: 'chopped' },
      { type: 'lettuce', state: 'chopped' },
      { type: 'bread', state: 'raw' },
    ],
    score: 90,
    color: '#e94',
  },
};

// crate種別 -> 食材タイプ のマッピング
export const CRATE_TO_INGREDIENT = {
  [STATION.CRATE_TOMATO]: 'tomato',
  [STATION.CRATE_LETTUCE]: 'lettuce',
  [STATION.CRATE_BREAD]: 'bread',
  [STATION.CRATE_MEAT]: 'meat',
  [STATION.CRATE_FISH]: 'fish',
};

// --- タイミング定数（ミリ秒） ---
export const TIMING = {
  CHOP_TIME: 2500,        // 切るのにかかる時間
  COOK_TIME: 5000,        // 焼くのにかかる時間
  BURN_TIME: 4000,        // 焼き上がってから焦げるまでの猶予
  WASH_TIME: 3000,        // 皿洗い
  PLAYER_SPEED: 3.2,      // プレイヤー移動速度(px/frame@60fps想定)
  INTERACT_RANGE: 1,      // インタラクト範囲(タイル)
};

// --- レベル定義 ---
// map: 文字列の2D配列。各文字がタイル/ステーションを表す
//   '.' = 床
//   '#' = 壁
//   その他 = ステーション(カウンター扱い)
// ステーション記号:
//   T=トマト箱 L=レタス箱 B=パン箱 M=肉箱 F=魚箱
//   C=まな板 O=コンロ P=皿置き S=提供口 W=洗い場 X=ゴミ箱 c=普通カウンター
export const SYMBOL_TO_STATION = {
  '.': { tile: TILE.FLOOR, station: STATION.NONE },
  '#': { tile: TILE.WALL, station: STATION.NONE },
  'T': { tile: TILE.COUNTER, station: STATION.CRATE_TOMATO },
  'L': { tile: TILE.COUNTER, station: STATION.CRATE_LETTUCE },
  'B': { tile: TILE.COUNTER, station: STATION.CRATE_BREAD },
  'M': { tile: TILE.COUNTER, station: STATION.CRATE_MEAT },
  'F': { tile: TILE.COUNTER, station: STATION.CRATE_FISH },
  'C': { tile: TILE.COUNTER, station: STATION.CUTTING },
  'O': { tile: TILE.COUNTER, station: STATION.STOVE },
  'P': { tile: TILE.COUNTER, station: STATION.PLATE_STACK },
  'S': { tile: TILE.COUNTER, station: STATION.SERVE },
  'W': { tile: TILE.COUNTER, station: STATION.WASH },
  'X': { tile: TILE.COUNTER, station: STATION.TRASH },
  'c': { tile: TILE.COUNTER, station: STATION.COUNTER },
};

// レベル1: チュートリアル的キッチン
export const LEVELS = [
  {
    id: 1,
    name: 'こうえんのキッチンカー',
    duration: 180, // 秒
    // メニュー（このレベルで注文されうる料理）
    menu: ['salad', 'burger'],
    map: [
      '#############',
      '#T....c....O#',
      '#L.........O#',
      '#c.........C#',
      '#B.........C#',
      '#P....c....X#',
      '#S.........W#',
      '#############',
    ],
  },
  {
    id: 2,
    name: 'まちかどダイナー',
    duration: 210,
    menu: ['salad', 'burger', 'fishplate'],
    map: [
      '###############',
      '#T...c...c...O#',
      '#L...........O#',
      '#M...####....C#',
      '#F...####....C#',
      '#B...........P#',
      '#X...c...c...W#',
      '#S...........c#',
      '###############',
    ],
  },
  {
    id: 3,
    name: 'グランドレストラン',
    duration: 240,
    menu: ['salad', 'burger', 'fishplate', 'deluxeburger'],
    map: [
      '#################',
      '#T...c...c...c.O#',
      '#L.............O#',
      '#M...#####.....C#',
      '#F...#####.....C#',
      '#B...#####.....C#',
      '#P.............P#',
      '#X...c...c...c.W#',
      '#S.............c#',
      '#################',
    ],
  },
];

export const TILE_SIZE = 64; // 論理タイルサイズ(px)
