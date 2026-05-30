// ============================================================
// Kitchen Chaos - 操作入力 (仮想ジョイスティック + ボタン + キーボード)
// 入力状態を {mx, my, interact, dash} で保持し、Gameが定期送信する
// ============================================================
export class Controls {
  constructor() {
    this.state = { mx: 0, my: 0, interact: false, dash: false };
    this.enabled = false;

    this.joy = document.getElementById('joystick');
    this.knob = document.getElementById('joy-knob');
    this.actBtn = document.getElementById('btn-action');
    this.dashBtn = document.getElementById('btn-dash');

    this.joyActive = false;
    this.joyId = null;
    this.joyCenter = { x: 0, y: 0 };
    this.maxDist = 52;

    this._bindJoystick();
    this._bindButtons();
    this._bindKeyboard();
  }

  enable() { this.enabled = true; }
  disable() {
    this.enabled = false;
    this.state = { mx: 0, my: 0, interact: false, dash: false };
    this._resetKnob();
  }

  // ---- ジョイスティック ----
  _bindJoystick() {
    const start = (e) => {
      if (!this.enabled) return;
      const t = e.changedTouches ? e.changedTouches[0] : e;
      this.joyActive = true;
      this.joyId = e.changedTouches ? t.identifier : 'mouse';
      const rect = this.joy.getBoundingClientRect();
      this.joyCenter = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      this._moveJoy(t.clientX, t.clientY);
      e.preventDefault();
    };
    const move = (e) => {
      if (!this.joyActive) return;
      let t;
      if (e.changedTouches) {
        t = [...e.changedTouches].find(ct => ct.identifier === this.joyId);
        if (!t) return;
      } else { t = e; }
      this._moveJoy(t.clientX, t.clientY);
      e.preventDefault();
    };
    const end = (e) => {
      if (!this.joyActive) return;
      if (e.changedTouches) {
        const ended = [...e.changedTouches].some(ct => ct.identifier === this.joyId);
        if (!ended) return;
      }
      this.joyActive = false; this.joyId = null;
      this.state.mx = 0; this.state.my = 0;
      this._resetKnob();
    };

    this.joy.addEventListener('touchstart', start, { passive: false });
    window.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('touchend', end);
    window.addEventListener('touchcancel', end);
    // マウス(デスクトップ検証用)
    this.joy.addEventListener('mousedown', start);
    window.addEventListener('mousemove', (e) => { if (this.joyId === 'mouse') move(e); });
    window.addEventListener('mouseup', (e) => { if (this.joyId === 'mouse') end(e); });
  }

  _moveJoy(cx, cy) {
    let dx = cx - this.joyCenter.x;
    let dy = cy - this.joyCenter.y;
    const dist = Math.hypot(dx, dy);
    if (dist > this.maxDist) { dx = dx / dist * this.maxDist; dy = dy / dist * this.maxDist; }
    this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    this.state.mx = dx / this.maxDist;
    this.state.my = dy / this.maxDist;
  }

  _resetKnob() {
    this.knob.style.transform = 'translate(-50%, -50%)';
  }

  // ---- アクションボタン ----
  _bindButtons() {
    const press = (btn, key) => {
      const down = (e) => { if (this.enabled) this.state[key] = true; e.preventDefault(); };
      const up = (e) => { this.state[key] = false; e.preventDefault(); };
      btn.addEventListener('touchstart', down, { passive: false });
      btn.addEventListener('touchend', up, { passive: false });
      btn.addEventListener('touchcancel', up);
      btn.addEventListener('mousedown', down);
      btn.addEventListener('mouseup', up);
      btn.addEventListener('mouseleave', up);
    };
    press(this.actBtn, 'interact');
    press(this.dashBtn, 'dash');
  }

  // ---- キーボード(デスクトップ) ----
  _bindKeyboard() {
    const keys = {};
    const update = () => {
      let mx = 0, my = 0;
      if (keys['ArrowLeft'] || keys['a']) mx -= 1;
      if (keys['ArrowRight'] || keys['d']) mx += 1;
      if (keys['ArrowUp'] || keys['w']) my -= 1;
      if (keys['ArrowDown'] || keys['s']) my += 1;
      this.state.mx = mx; this.state.my = my;
      this.state.interact = !!(keys[' '] || keys['e'] || keys['Enter']);
      this.state.dash = !!(keys['Shift']);
    };
    window.addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      keys[e.key] = true;
      if ([' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) e.preventDefault();
      update();
    });
    window.addEventListener('keyup', (e) => { keys[e.key] = false; update(); });
  }

  get() { return this.state; }
}
