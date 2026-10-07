/* 弹射怪兽 · 零依赖冒烟测试
 *
 *   node test_smoke.js
 *
 * 不装任何依赖：用 Node 内置 vm + 手写桩 DOM，在无浏览器环境下真实加载
 * style/script（含仓库内置的 vendor/matter.min.js），把"能不能玩"验到底：
 *   1. script.js 语法可解析
 *   2. 桩 DOM 下正常加载（localStorage 故意抛 SecurityError，复现沙箱 / 无痕场景）
 *   3. load 事件 → 菜单渲染（关卡格子 / 皮肤卡片）
 *   4. 90 个程序生成关结构合规（不越界、刚体数不超限、31 关前无炸弹）
 *   5. 石墙硬度随关卡递增（31→100 关 HP 120→168）
 *   6. 场景主题按关卡段轮换（每 20 关一套）
 *   7. 星级 = 剩余弹药（剩 ≥2 / 1 / 0 发 → 3 / 2 / 1 颗星）
 *   8. 发射链路：拖拽 → 松手 → 真实物理推进（细帧 60fps 驱动）
 *   9. 主动技能：空格触发分身
 *  10. 弹尽未通关 → 判负；目标清空 → 判胜
 *
 * 注意：驱动循环用的是真实 60fps 细帧（每帧 16.7ms），而不是大跨度时间戳——
 * 用 250ms 大跨度戳驱动会一次性跨过所有计时阈值，把"蛇不动"这类累加器缺陷假性放过。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const os = require('os');

const ROOT = __dirname;
const JS_FILE = path.join(ROOT, 'script.js');
const MATTER_FILE = path.join(ROOT, 'vendor', 'matter.min.js');

let pass = 0;
const fails = [];
function ok(cond, name, info) {
  if (cond) { pass++; console.log('  \u2713 ' + name); }
  else { fails.push(name); console.log('  \u2717 ' + name + (info ? '  \u2192 ' + info : '')); }
}
function head(t) { console.log('\n' + t); }

/* ---------------- 桩 DOM ---------------- */
function makeCtxStub() {
  const grad = { addColorStop() {} };
  const store = {};
  return new Proxy(store, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'canvas') return { width: 1280, height: 720 };
      if (k === 'measureText') return () => ({ width: 8 });
      if (k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createPattern') return () => grad;
      if (k === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
      return () => {};               // 其余绘图方法一律空实现
    },
    set(t, k, v) { t[k] = v; return true; },
  });
}
function makeEl(tag) {
  const el = {
    tagName: (tag || 'div').toUpperCase(),
    children: [], innerHTML: '', textContent: '', width: 1280, height: 720,
    clientWidth: 1280, clientHeight: 720, disabled: false, dataset: {},
    style: {},
    classList: {
      _s: new Set(),
      add(...c) { c.forEach((x) => this._s.add(x)); },
      remove(...c) { c.forEach((x) => this._s.delete(x)); },
      contains(c) { return this._s.has(c); },
      toggle(c, f) { const on = f === undefined ? !this._s.has(c) : !!f; on ? this._s.add(c) : this._s.delete(c); return on; },
    },
    appendChild(c) { this.children.push(c); return c; },
    insertBefore(c) { this.children.unshift(c); return c; },
    removeChild(c) { this.children = this.children.filter((x) => x !== c); return c; },
    setAttribute() {}, removeAttribute() {}, remove() {}, focus() {}, blur() {},
    setPointerCapture() {}, releasePointerCapture() {},
    getContext() { return makeCtxStub(); },
    getBoundingClientRect() { return { left: 0, top: 0, right: 1280, bottom: 720, width: 1280, height: 720 }; },
    querySelector() { return null; }, querySelectorAll() { return []; },
    addEventListener(t, f) { (this._h = this._h || {}); (this._h[t] = this._h[t] || []).push(f); },
    removeEventListener() {},
    dispatch(t, e) { ((this._h || {})[t] || []).forEach((f) => f(Object.assign({ type: t, preventDefault() {}, stopPropagation() {} }, e))); },
  };
  return el;
}

/* 假时钟 + 假定时器 + 假 rAF（可确定性推进） */
const clock = { now: 0 };
let timers = [], tid = 1, rafQ = [], rafId = 1;
const errors = [];
function setTimeoutFake(fn, ms) { timers.push({ id: tid++, fn, due: clock.now + (ms || 0) }); return tid; }
function clearTimeoutFake(id) { timers = timers.filter((t) => t.id !== id); }
function runDue() {
  let guard = 0;
  for (;;) {
    const due = timers.filter((t) => t.due <= clock.now);
    if (!due.length) break;
    timers = timers.filter((t) => t.due > clock.now);
    due.forEach((t) => { try { t.fn(); } catch (e) { errors.push('timer: ' + e.message); } });
    if (++guard > 500) break;
  }
}

const els = {};
const documentStub = {
  getElementById(id) { if (!els[id]) { els[id] = makeEl(id === 'cv' ? 'canvas' : 'div'); els[id].id = id; } return els[id]; },
  createElement(tag) { return makeEl(tag); },
  head: makeEl('head'), body: makeEl('body'),
  activeElement: { blur() {}, tagName: 'BODY' },
  addEventListener() {},
};
const winHandlers = {};
const windowStub = {
  addEventListener(t, f) { (winHandlers[t] = winHandlers[t] || []).push(f); },
  removeEventListener() {},
  requestAnimationFrame(cb) { rafQ.push({ id: rafId++, cb }); return rafId; },
  cancelAnimationFrame(id) { rafQ = rafQ.filter((x) => x.id !== id); },
  setTimeout: setTimeoutFake, clearTimeout: clearTimeoutFake,
  innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1,
};

/* localStorage 故意抛异常：复现沙箱 iframe / 无痕模式 */
const localStorageStub = {
  getItem() { throw new Error('SecurityError: localStorage is not available in sandbox'); },
  setItem() { throw new Error('SecurityError: localStorage is not available in sandbox'); },
  removeItem() { throw new Error('SecurityError: localStorage is not available in sandbox'); },
};

console.log('弹射怪兽 · 冒烟测试');

/* ---------------- 1. 语法 ---------------- */
head('[1] 语法与依赖');
ok(fs.existsSync(JS_FILE), 'script.js 存在');
ok(fs.existsSync(MATTER_FILE), 'vendor/matter.min.js 存在（离线可玩）');
const jsSrc = fs.readFileSync(JS_FILE, 'utf8');
let syntaxOk = true, syntaxErr = '';
try { new vm.Script(jsSrc, { filename: 'script.js' }); } catch (e) { syntaxOk = false; syntaxErr = e.message; }
ok(syntaxOk, 'script.js 语法可解析', syntaxErr);

const cssSrc = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
ok(cssSrc.includes('.overlay') && cssSrc.includes('#levels'), 'style.css 关键样式存在');
const htmlSrc = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
ok(htmlSrc.includes('href="style.css"') && htmlSrc.includes('src="script.js"'), 'index.html 正确引用 style.css / script.js');

/* ---------------- 2. 加载 ---------------- */
head('[2] 桩 DOM 加载（localStorage 抛异常）');
const sandbox = {
  document: documentStub, window: windowStub, navigator: { userAgent: 'node-smoke' },
  localStorage: localStorageStub, location: { href: 'file:///' },
  setTimeout: setTimeoutFake, clearTimeout: clearTimeoutFake, setInterval: setTimeoutFake, clearInterval: clearTimeoutFake,
  performance: { now: () => clock.now },
  requestAnimationFrame: windowStub.requestAnimationFrame, cancelAnimationFrame: windowStub.cancelAnimationFrame,
  console, Math, JSON, Date,
  module: { exports: {} }, exports: {},
};
sandbox.globalThis = sandbox;
const ctx = vm.createContext(sandbox);
let loadErr = '';
try {
  vm.runInContext(fs.readFileSync(MATTER_FILE, 'utf8'), ctx, { filename: 'matter.min.js' });
  if (!ctx.Matter && ctx.module && ctx.module.exports && ctx.module.exports.Engine) ctx.Matter = ctx.module.exports;
  vm.runInContext(jsSrc, ctx, { filename: 'script.js' });
} catch (e) { loadErr = e.message; }
ok(!loadErr, '脚本在沙箱环境完整加载（不因 localStorage 崩）', loadErr);
ok(typeof ctx.Matter === 'object' && !!ctx.Matter.Engine, 'Matter 物理引擎就绪');
ok(typeof ctx.start === 'function' && typeof ctx.buildLevel === 'function', '核心函数挂载到全局');

const get = (expr) => vm.runInContext(expr, ctx);

/* ---------------- 3. 启动 → 菜单 ---------------- */
head('[3] 启动流程');
let bootErr = '';
try { (winHandlers.load || []).forEach((f) => f()); } catch (e) { bootErr = e.message; }
ok(!bootErr, 'load 事件无异常', bootErr);
ok(get('state') === 'menu', '初始进入菜单态');
ok(documentStub.getElementById('levels').children.length >= 100, '100 个关卡格子已渲染',
  '实际 ' + documentStub.getElementById('levels').children.length);
ok(documentStub.getElementById('skins').children.length >= 6, '皮肤卡片已渲染',
  '实际 ' + documentStub.getElementById('skins').children.length);
ok(rafQ.length > 0, '主循环已注册（requestAnimationFrame）');

/* ---------------- 4. 关卡生成合规 ---------------- */
head('[4] 关卡生成（90 个程序生成关）');
const gen = get(`(function(){
  const bad = [], bombsEarly = [], matStat = {};
  for (let i = 10; i < 100; i++){
    const L = generateLevel(i);
    if (!L.B.length) bad.push(i + ':空结构');
    if (L.B.length + (L.T||[]).length + (L.BOM||[]).length > 60) bad.push(i + ':刚体超限');
    L.B.forEach(function(b, k){
      if (b[0]-b[2]/2 < -30 || b[0]+b[2]/2 > W+30 || b[1]-b[3]/2 < -30 || b[1]+b[3]/2 > GROUND_Y+20) bad.push(i + ':越界#' + k);
      if (b[4] === 'stone') matStat['stone'] = (matStat['stone']||0) + 1;
      matStat[b[4]] = (matStat[b[4]]||0) + 0;
    });
    if (i < 30 && (L.BOM||[]).length) bombsEarly.push(i);
  }
  return { bad: bad, bombsEarly: bombsEarly, stone: matStat['stone'] || 0 };
})()`);
ok(gen.bad.length === 0, '所有生成关结构合规（不越界 / 不超限）', gen.bad.slice(0, 3).join(', '));
ok(gen.bombsEarly.length === 0, '第 31 关前不出现小炸弹', gen.bombsEarly.join(','));
ok(gen.stone > 200, '石墙材质确实出现', '石头方块 ' + gen.stone + ' 块');

const ramp = get(`(function(){
  const seg = [];
  for (let s = 0; s < 7; s++){
    let stone = 0, tot = 0;
    for (let i = 20 + s*10; i < 30 + s*10; i++){
      const L = generateLevel(i);
      L.B.forEach(function(b){ tot++; if (b[4] === 'stone') stone++; });
    }
    seg.push(+(stone/tot).toFixed(2));
  }
  return seg;
})()`);
let rampUp = true;
for (let i = 1; i < ramp.length; i++) if (ramp[i] < ramp[i - 1] - 0.12) rampUp = false;
ok(rampUp, '石头占比随关卡上升（难度爬坡）', ramp.join(' → '));

/* ---------------- 5. 石墙硬度爬坡 ---------------- */
head('[5] 石墙硬度（31→100 关 120→168）');
const hpRows = get(`(function(){
  const out = [];
  [30, 50, 70, 99].forEach(function(i){
    buildLevel(i);
    let mx = 0, mn = 999;
    blocks.forEach(function(b){ if (b.plugin.mat === 'stone'){ mx = Math.max(mx, b.plugin.hp); mn = Math.min(mn, b.plugin.hp); } });
    out.push({ lv: i + 1, hp: mx });
  });
  return out;
})()`);
ok(hpRows[0].hp >= 100 && hpRows[0].hp <= 122, '第 31 关石墙 HP ≈ 120', JSON.stringify(hpRows[0]));
ok(hpRows[3].hp > hpRows[1].hp && hpRows[1].hp >= hpRows[0].hp, '石墙 HP 随关卡递增', JSON.stringify(hpRows.map((r) => r.lv + ':' + r.hp)));
ok(hpRows[3].hp <= 170 && hpRows[3].hp >= 160, '第 100 关石墙 HP ≈ 168', JSON.stringify(hpRows[3]));

/* ---------------- 6. 场景主题轮换 ---------------- */
head('[6] 场景主题（每 20 关一套）');
const themes = get(`(function(){
  const out = [];
  state = 'aim';
  [0, 19, 20, 39, 40, 59, 60, 79, 80, 99].forEach(function(i){ curLevel = i; out.push(i + 1 + ':' + curTheme().name); });
  state = 'menu';
  out.push('菜单:' + curTheme().name);
  return out;
})()`);
const themeNames = themes.map((s) => s.split(':')[1]);
ok(themeNames[0] === themeNames[1] && themeNames[2] === themeNames[3], '第 1-20 关同一套主题', themes.slice(0, 4).join(' '));
ok(themeNames[2] !== themeNames[0] && themeNames[4] !== themeNames[2] && themeNames[6] !== themeNames[4] && themeNames[8] !== themeNames[6], '每 20 关切换主题', themes.join(' '));
ok(themes[themes.length - 1].endsWith(themeNames[0]), '菜单固定用第一套主题');

const deco = get(`(function(){
  const bad = [];
  [0, 25, 45, 65, 95].forEach(function(i){
    const th = (function(){ state='aim'; curLevel=i; return curTheme(); })();
    ['skyTop','skyBot','ground','deco','bound'].forEach(function(k){ if (!th[k]) bad.push(i + ':' + k); });
    if (!Array.isArray(th.deco) || !th.deco.length) bad.push(i + ':deco空');
  });
  state = 'menu';
  return bad;
})()`);
ok(deco.length === 0, '5 套主题字段完整（含装饰列表）', deco.join(', '));

/* ---------------- 7. 星级 = 剩余弹药 ---------------- */
head('[7] 星级规则（剩余弹药）');
const starRows = get(`(function(){
  const out = [];
  [0, 1, 2, 3, 6].forEach(function(n){
    state = 'fly'; shotsLeft = n; curLevel = 9; win();
    out.push({ shots: n, stars: save.stars[9], msg: document.getElementById('endMsg').textContent });
  });
  return out;
})()`);
ok(starRows[0].stars === 1, '剩 0 发（最后一发通关）→ 1 星', JSON.stringify(starRows[0]));
ok(starRows[1].stars === 2, '剩 1 发 → 2 星', JSON.stringify(starRows[1]));
ok(starRows[2].stars === 3 && starRows[3].stars === 3, '剩 ≥2 发 → 3 星', JSON.stringify(starRows.slice(2, 4)));
ok(starRows[0].msg.includes('1 颗星'), '结算文案随星级变化', starRows[0].msg);

/* ---------------- 8. 发射链路（细帧驱动） ---------------- */
head('[8] 发射链路（真实物理，60fps 细帧）');
get('curLevel = 0; state = "menu"; start(0);');
ok(get('state') === 'aim', '开局进入瞄准态');
ok(get('shotsLeft') > 0, '弹药已装填', 'shotsLeft=' + get('shotsLeft'));

const cvEl = documentStub.getElementById('cv');
const aim = get('({ x: aimPos.x, y: aimPos.y, sx: SLING.x })');
cvEl.dispatch('pointerdown', { clientX: aim.x, clientY: aim.y, pointerId: 1 });
ok(get('drag') === true, '按下时抓住小怪兽');
cvEl.dispatch('pointermove', { clientX: aim.sx - 85, clientY: aim.y + 62, pointerId: 1 });
const pulled = get('({ x: aimPos.x, y: aimPos.y })');
ok(Math.hypot(pulled.x - aim.x, pulled.y - aim.y) > 40, '拖动改变拉弓位置');
cvEl.dispatch('pointerup', { pointerId: 1 });
ok(get('state') === 'fly', '松手后进入飞行态');
ok(get('!!birdBody') === true, '发射瞬间创建动态刚体（绕开 setStatic 质量 bug）');

const shotsAfter = get('shotsLeft');
const startPos = get('({ x: birdBody.position.x, y: birdBody.position.y })');
/* 逐帧采样小鸟轨迹：60fps 细帧驱动，同时统计最大位移 / 是否出现 NaN
   （注意持续 120 帧会撞墙反弹，不能拿末位置直接对比，要看过程中的最大位移） */
const SAMPLE = 'if (birdBody) window.__s = [birdBody.position.x, birdBody.position.y, birdBody.speed];';
let maxDx = 0, badSample = null, last = { x: startPos.x, y: startPos.y }, landingX = null;
function step(frames) {
  for (let i = 0; i < frames; i++) {
    clock.now += 16.6667;
    runDue();
    const q = rafQ; rafQ = [];
    q.forEach((x) => { try { x.cb(clock.now); } catch (e) { errors.push('frame: ' + e.message); } });
    vm.runInContext(SAMPLE, ctx);
    const s = windowStub.__s;
    if (s) {
      if (!Number.isFinite(s[0]) || !Number.isFinite(s[1]) || !Number.isFinite(s[2])) badSample = s.slice();
      maxDx = Math.max(maxDx, Math.abs(s[0] - startPos.x));
      last = { x: s[0], y: s[1] };
      landingX = s[0];
    }
  }
}
step(120);
ok(maxDx > 120, '小鸟真实飞出去了（细帧 60fps 推进 120 帧）', '最大位移=' + Math.round(maxDx) + 'px');
ok(!badSample, '位置 / 速度未出现 NaN（物理未失效）', JSON.stringify(badSample));
ok(get('shotsLeft') === shotsAfter, '飞行中不重复扣弹药');
ok(get('errFrames') === 0, '主循环零异常帧', 'errFrames=' + get('errFrames') + ' lastErr=' + get('lastErr'));

step(500);
const settled = get('({ st: state, sp: birdBody ? birdBody.speed : 0, err: errFrames })');
ok(get('errFrames') === 0, '长时间推进无隐藏异常帧', 'errFrames=' + get('errFrames'));
ok(settled.st !== 'fly', '小鸟最终落定（回合正常收束）', 'state=' + settled.st);
ok(Number.isFinite(landingX) && landingX >= 0 && landingX <= 1300, '轨迹全程留在场地内（三面墙反弹生效）', 'x=' + Math.round(landingX));

/* ---------------- 9. 主动技能 ---------------- */
head('[9] 主动技能（空格 = 分身）');
get('save.skin = "monster"; curLevel = 0; state = "menu"; start(0);');
const aim2 = get('({ x: aimPos.x, y: aimPos.y, sx: SLING.x })');
cvEl.dispatch('pointerdown', { clientX: aim2.x, clientY: aim2.y, pointerId: 1 });
cvEl.dispatch('pointermove', { clientX: aim2.sx - 88, clientY: aim2.y + 50, pointerId: 1 });
cvEl.dispatch('pointerup', { pointerId: 1 });
ok(get('state') === 'fly', '橙橙怪兽已发射');
step(6);
(winHandlers.keydown || []).forEach((f) => f({ code: 'Space', key: ' ', preventDefault() {} }));
ok(get('clones.length') >= 1, '空格触发分身（1 → 2 个怪兽）', 'clones=' + get('clones.length'));
const before = get('clones.length');
(winHandlers.keydown || []).forEach((f) => f({ code: 'Space', key: ' ', preventDefault() {} }));
ok(get('clones.length') === before, '同一发不重复分身（防重复触发）');
step(400);
ok(get('errFrames') === 0, '分身回合同样零异常帧');

/* ---------------- 10. 胜负判定 ---------------- */
head('[10] 胜负判定');
get('curLevel = 0; state = "menu"; start(0);');
const targetsAtStart = get('targets.length');
get('targets.slice().forEach(function(t){ damage(t, 9999); });');
ok(get('targets.length') === 0, '目标全部被击倒', targetsAtStart + ' → 0');
ok(get('state') !== 'win', '结算走 700ms 延时（不是立即判胜）');
clock.now += 800; runDue();   // 推进结算定时器
ok(get('state') === 'win', '目标清空 → 延时后判胜');
ok(get('save.stars[0]') >= 1 && get('save.stars[0]') <= 3, '通关写入星级', 'stars=' + get('save.stars[0]'));
ok(documentStub.getElementById('endOverlay').classList.contains('hidden') === false, '结算界面弹出');

get('curLevel = 3; state = "menu"; shotsLeft = 0; start(3); shotsLeft = 0; birdDone();');
ok(get('state') === 'lose', '弹尽且目标未清完 → 判负');
const starsLocked = get('save.stars[0]');
get('state = "win"; shotsLeft = 6; curLevel = 0; win();');   // 状态守卫：已结算不再重复判定
ok(get('state') === 'win' && get('save.stars[0]') === starsLocked, '已结算状态不会被重复判定覆盖（不刷星）',
  '锁定 ' + starsLocked + ' → ' + get('save.stars[0]'));

get('state = "menu"; curLevel = 0; buildLevel(0);');
ok(get('blocks.length') > 0 && get('targets.length') > 0, '重开新局结构正常');

/* ---------------- 汇总 ---------------- */
console.log('\n' + '─'.repeat(46));
console.log('通过 ' + pass + ' 项，失败 ' + fails.length + ' 项');
if (errors.length) console.log('运行期捕获异常 ' + errors.length + ' 条：' + errors.slice(0, 3).join(' | '));
if (fails.length) { console.log('失败项：'); fails.forEach((f) => console.log('  - ' + f)); }

const reportPath = process.env.SMOKE_REPORT;
if (reportPath) {
  const lines = ['通过 ' + pass + ' 项，失败 ' + fails.length + ' 项'];
  if (fails.length) lines.push('失败：' + fails.join(' / '));
  else lines.push('全部通过');
  if (errors.length) lines.push('异常：' + errors.join(' | '));
  fs.writeFileSync(reportPath, lines.join('\n') + '\n', 'utf8');
}
process.exit(fails.length ? 1 : 0);
