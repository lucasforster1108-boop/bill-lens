// BillLens 界面冒烟测试：用最小 DOM 桩跑通“点示例数据 → 渲染看板 → 生成报告图”全链路。
// ECharts 未加载，走简易条形图兜底分支。用法：node tests/dom-smoke.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
if (blocks.length !== 2) { console.error('FAIL: 期望 2 个内联脚本块，实际 ' + blocks.length); process.exit(1); }

// ---- 最小 DOM 桩 ----
function makeEl(id) {
  const listeners = {};
  const el = {
    id: id || '',
    children: [],
    style: {},
    dataset: {},
    classList: { add() {}, remove() {}, toggle() {} },
    hidden: false, disabled: false, checked: false, value: '', textContent: '',
    _html: '',
    addEventListener(name, fn) { (listeners[name] = listeners[name] || []).push(fn); },
    appendChild(child) { el.children.push(child); return child; },
    click() { (listeners.click || []).forEach((fn) => fn({})); },
    setAttribute() {}, getAttribute() { return null; },
    getContext() {
      // canvas 2d 上下文桩：所有方法空操作
      return new Proxy({}, { get: (t, p) => (p === 'measureText' ? () => ({ width: 0 }) : () => {}) ,
        set: () => true });
    },
    toDataURL() { return 'data:image/png;base64,xxxx'; },
    _fire(name, ev) { (listeners[name] || []).forEach((fn) => fn(ev || {})); },
  };
  Object.defineProperty(el, 'innerHTML', {
    get() { return el._html; },
    set(v) {
      el._html = String(v);
      if (String(v) === '') el.children = [];
      el.textContent = String(v).replace(/<[^>]*>/g, '');
    },
  });
  return el;
}
const els = {};
const documentStub = {
  getElementById(id) { return (els[id] = els[id] || makeEl(id)); },
  createElement(tag) { return makeEl(tag); },
  addEventListener() {},
};
const localStorageStub = { _s: {}, getItem(k) { return this._s[k] ?? null; }, setItem(k, v) { this._s[k] = String(v); } };

const sandbox = {
  window: {}, document: documentStub, localStorage: localStorageStub,
  console, TextDecoder, addEventListener() {},
};
sandbox.window = sandbox; // window.window 自指不重要；脚本用 window.BillLens / window.echarts
vm.createContext(sandbox);
vm.runInContext(blocks[0], sandbox); // 纯逻辑
vm.runInContext(blocks[1], sandbox); // 界面 wiring（document 存在才跑）

let fail = 0;
function check(cond, label) {
  if (cond) console.log('  ok  ' + label);
  else { fail++; console.log(' FAIL  ' + label); }
}

const B = sandbox.window.BillLens;
check(!!B, 'BillLens 已挂载');

// 点“先试试示例数据”（页面 HTML 里 hideExcluded 默认勾选，桩里先还原这一点）
els.hideExcluded.checked = true;
els.demoBtn._fire('click');
check(els.dashboard.hidden === false, '看板已显示');
check(els.statSpend.textContent === '¥913.60', '本月支出显示 ¥913.60（实际：' + els.statSpend.textContent + '）');
check(els.statIncome.textContent === '¥8588.00', '本月收入显示 ¥8588.00（实际：' + els.statIncome.textContent + '）');
check(els.statCount.innerHTML.includes('22'), '消费笔数显示 22 笔');
check(els.txTable.children.length === 24, '明细表 24 行（27 条减去转账/退款/还款 3 条非消费；工资与红包收入行保留，实际 ' + els.txTable.children.length + '）');
check(els.monthSelect.children.length === 1 && els.monthSelect.children[0].value === '2026-11', '月份下拉只有 2026-11');

// 取消“隐藏非消费流水”，应多出 5 行（转账/退款/还款/红包收入）
els.hideExcluded.checked = false;
els.hideExcluded._fire('change');
check(els.txTable.children.length === 27, '取消隐藏后明细表 27 行（实际 ' + els.txTable.children.length + '）');

// 生成报告图（脱敏关）
els.reportBtn._fire('click');
check(els.reportCanvas.hidden === false, '报告 canvas 已显示');
check(els.downloadBtn.disabled === false, '下载按钮已启用');

// 脱敏开 → 报告数据商家名被掩码（通过纯逻辑复核）
const agg = B.aggregate(B.parseBill(B.DEMO_CSV).txs.map((t) => ({ ...t, category: B.classify(t) })), '2026-11');
check(B.buildReportData(agg, '2026-11', true).topMerchants[0].name === '淘**', '脱敏报告商家名掩码（淘宝 187.90 居首 → 淘**）');

// 清空
els.clearBtn._fire('click');
check(els.dashboard.hidden === true, '清空后看板隐藏');

console.log(fail ? `\n冒烟测试：${fail} 项失败` : '\n冒烟测试：全部通过');
process.exit(fail ? 1 : 0);
