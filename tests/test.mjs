// BillLens 自测：从 index.html 抽出纯逻辑脚本，在 Node 里跑断言。
// 用法：node tests/test.mjs   （退出码 0 = 全部通过）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

let pass = 0, fail = 0;
function eq(actual, expected, label) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log('  ok  ' + label); }
  else { fail++; console.log(' FAIL  ' + label + '\n       实际: ' + a + '\n       期望: ' + e); }
}
function ok(cond, label) {
  if (cond) { pass++; console.log('  ok  ' + label); }
  else { fail++; console.log(' FAIL  ' + label); }
}

// ---- 载入 index.html 里的纯逻辑脚本 ----
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const m = html.match(/<script>\n'use strict';([\s\S]*?)<\/script>/);
if (!m) { console.error('FAIL: index.html 里找不到纯逻辑脚本块'); process.exit(1); }
const sandbox = { window: {}, console, TextDecoder };
vm.createContext(sandbox);
vm.runInContext(m[1], sandbox);
const B = sandbox.window.BillLens;
ok(!!B, 'BillLens 挂载成功');
ok(html.includes('echarts.min.js'), '页面引用 ECharts CDN');

console.log('\n[1] 示例账单解析');
const wc = B.parseBill(fs.readFileSync(path.join(root, 'examples/wechat-sample.csv'), 'utf8'), 'wechat-sample.csv');
eq(wc.source, 'wechat', '微信示例识别为 wechat');
eq(wc.txs.length, 22, '微信示例解析出 22 条流水');
eq(wc.skipped, 0, '微信示例无跳过行');
eq(wc.error, null, '微信示例无错误');
const ali = B.parseBill(fs.readFileSync(path.join(root, 'examples/alipay-sample.csv'), 'utf8'), 'alipay-sample.csv');
eq(ali.source, 'alipay', '支付宝示例识别为 alipay');
eq(ali.txs.length, 20, '支付宝示例解析出 20 条流水');
eq(ali.skipped, 0, '支付宝示例无跳过行');

console.log('\n[2] 汇总（微信 + 支付宝，2026-10）');
const all = [...wc.txs, ...ali.txs];
all.forEach((t) => { t.category = B.classify(t); });
const agg = B.aggregate(all, '2026-10');
eq(agg.spend, 1356.8, '总支出 1356.80');
eq(agg.income, 17066, '总收入 17066（两笔工资 8500 + 红包 66）');
eq(agg.count, 34, '消费笔数 34（已剔除转账/退款/信用卡还款）');
eq(agg.byCategory, { '餐饮': 801.2, '交通': 71.8, '订阅': 50, '娱乐': 90, '购物': 243.8, '生活': 100 }, '分类汇总');
eq(agg.byMerchant[0], { name: '海底捞', amount: 334 }, '商家第一是海底捞 334');
eq(agg.biggest.merchant, '海底捞', '最大一笔是海底捞');
eq(agg.biggest.amount, 178, '最大一笔金额 178');
eq(agg.byDay['2026-10-18'], 266, '10 月 18 日单日支出 266（微信海底捞 178 + 支付宝淘宝 88）');

console.log('\n[3] 内置示例数据（2026-11）');
const demo = B.parseBill(B.DEMO_CSV, 'demo.csv');
eq(demo.txs.length, 27, '示例数据 27 条');
demo.txs.forEach((t) => { t.category = B.classify(t); });
const dagg = B.aggregate(demo.txs, '2026-11');
eq(dagg.spend, 913.6, '示例 11 月支出 913.60');
eq(dagg.income, 8588, '示例 11 月收入 8588（工资 8500 + 红包 88）');
eq(dagg.count, 22, '示例消费笔数 22');
eq(dagg.biggest.amount, 186, '示例最大一笔 186');
eq(B.aggregate(all, '2026-11').count, 0, '按月过滤：10 月数据在 11 月为 0 笔');

console.log('\n[4] 分类规则');
const c = (merchant, item, type) => B.classify({ merchant, item, type: type || '商户消费' });
eq(c('瑞幸咖啡', '美式咖啡'), '餐饮', '瑞幸 → 餐饮');
eq(c('滴滴出行', '快车'), '交通', '滴滴 → 交通');
eq(c('腾讯视频', '会员续费'), '订阅', '腾讯视频 → 订阅');
eq(c('淘宝', '日用品'), '购物', '淘宝 → 购物');
eq(c('中国移动', '话费充值'), '生活', '中国移动话费 → 生活');
eq(c('猫眼电影', '电影票'), '娱乐', '猫眼 → 娱乐');
eq(c('某不知名小店', '杂货'), '其他', '未知商家 → 其他');
eq(B.classify({ merchant: '瑞幸咖啡', item: '美式咖啡', type: '商户消费' }, { '瑞幸咖啡': '医疗' }), '医疗', '用户改类优先于关键词');

console.log('\n[5] 非消费剔除');
const nc = (type, direction, merchant, item, status) =>
  B.isNonConsumption({ type, direction, merchant, item: item || '', status: status || '支付成功' });
ok(nc('转账', '支出', '张三'), '转账支出不计消费');
ok(nc('信用卡还款', '支出', '招商银行信用卡'), '信用卡还款不计消费');
ok(nc('商户消费', '支出', '淘宝', '衣服', '已退款'), '已退款不计消费');
ok(!nc('商户消费', '支出', '中国移动', '话费充值'), '话费充值算消费（不被“充值”误伤）');
ok(!nc('转账', '收入', '公司', '工资'), '工资转账收入要算进收入');
ok(nc('商户消费', '不计收支', '余额宝', '转入'), '不计收支不算');

console.log('\n[6] CSV 与金额解析');
eq(B.parseCSV('"a,b",c\n"d""e",f'), [['a,b', 'c'], ['d"e', 'f']], '引号内逗号与双引号转义');
eq(B.parseAmount('¥1,234.56'), 1234.56, '金额去 ¥ 与千分位');
ok(Number.isNaN(B.parseAmount('—')), '非数字金额返回 NaN');
eq(B.parseBill('hello world\nfoo bar', 'x.csv').error, '找不到含“交易时间”的表头行，文件格式可能不对', '无表头文件报错');
eq(B.monthOf('2026-10-05 08:10:22'), '2026-10', 'monthOf 取 YYYY-MM');

console.log('\n[7] GBK 解码（支付宝常导出 GBK）');
// "你好" 的 GBK 编码：C4 E3 BA C3；UTF-8 解会出替换字符，应回落到 GBK
const gbkBuf = Buffer.from([0xc4, 0xe3, 0xba, 0xc3]);
const dec = B.decodeBillBytes(gbkBuf.buffer.slice(gbkBuf.byteOffset, gbkBuf.byteOffset + gbkBuf.byteLength));
eq(dec, '你好', 'GBK 字节正确解码为“你好”');
ok(!dec.includes('\uFFFD'), '解码结果无替换字符');
const utf8Buf = Buffer.from('交易时间,交易类型', 'utf8');
eq(B.decodeBillBytes(utf8Buf.buffer.slice(utf8Buf.byteOffset, utf8Buf.byteOffset + utf8Buf.byteLength)), '交易时间,交易类型', 'UTF-8 字节正常解码');

console.log('\n[8] 报告图数据与脱敏');
const rep = B.buildReportData(agg, '2026-10', false);
eq(rep.spend, 1356.8, '报告数据支出一致');
eq(rep.topCategories[0].name, '餐饮', '报告分类第一是餐饮');
eq(rep.topMerchants[0].name, '海底捞', '报告商家第一是海底捞');
const repHide = B.buildReportData(agg, '2026-10', true);
eq(repHide.topMerchants[0].name, '海**', '脱敏后商家名只留首字');
eq(B.maskAmount(123.45, true), '¥ ***', '脱敏后金额隐藏');
eq(B.maskAmount(123.45, false), '¥123.45', '不脱敏显示金额');

console.log(`\n结果：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
