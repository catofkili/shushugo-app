import { Profiler, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { perfPhases, perfTime, topSql } from '../../../frontend/src/lib/perf-marks';
import { Text, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { TaroRootElement } from '@tarojs/runtime';

// 计时版专用（普通构建整个模块被 preview-timing-off 替换）：Taro 把虚拟 DOM 序列化成 setData 的那一步单独计时，
// 用来区分「卡住」里有多少是渲染、多少是业务逻辑 / SQL（2026-10-19 真机首次进主页卡 8.6 秒）。
const rootProto = TaroRootElement.prototype as unknown as { scheduleTask: (task: () => void) => void; __perfTimed?: boolean };
if (!rootProto.__perfTimed) {
  rootProto.__perfTimed = true;
  const schedule = rootProto.scheduleTask;
  rootProto.scheduleTask = function (this: unknown, task: () => void) {
    return schedule.call(this, () => perfTime('渲染 · 序列化+setData', task));
  };
}

type Kind = 'study' | 'vocab';
type Sample = { startedAt: number; beforeId: string; beforeText: string };
type Props = { kind: Kind; children: ReactNode; startupTimings?: Record<string, number> };
const LIMIT = 20;

function stats(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return {
    median: sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2),
    p90: sorted[Math.ceil(sorted.length * 0.9) - 1]
  };
}

function studyNode() {
  const node = document.getElementsByClassName('zoo-enter')[0] as any;
  return {
    id: String(node?.sid || node?.dataset?.sid || node?.id || ''),
    text: String(node?.textContent || '')
  };
}

function feedbackVisible() {
  const nodes = document.getElementsByClassName('ds-say-onbg');
  for (let index = 0; index < nodes.length; index += 1) {
    const text = String(nodes[index]?.textContent || '');
    if (text.includes('答对了') || text.includes('这题选错了')) return true;
  }
  return false;
}

function closestClass(node: any, name: string) {
  for (let current = node; current; current = current.parentNode) {
    const className = String(current.className || current.getAttribute?.('class') || '');
    if (className.split(/\s+/).includes(name)) return current;
  }
  return null;
}

export default function PreviewTimingBoundary({ kind, children, startupTimings = {} }: Props) {
  const pending = useRef<Sample | null>(null);
  const samplesRef = useRef<number[]>([]);
  const [samples, setSamples] = useState<number[]>([]);

  const onClick = useCallback((event: any) => {
    if (pending.current || samplesRef.current.length >= LIMIT) return;
    const targetId = event.target?.dataset?.sid;
    const target = targetId ? document.getElementById(targetId) : event.target;
    const button = kind === 'study'
      ? closestClass(target, 'rate-know')
      : closestClass(target, 'ds-choice');
    if (!button) return;
    const before = kind === 'study' ? studyNode() : { id: '', text: '' };
    pending.current = {
      startedAt: Number(event.timeStamp) || Date.now(),
      beforeId: before.id,
      beforeText: before.text
    };
  }, [kind]);

  const onRender = useCallback(() => {
    const sample = pending.current;
    if (!sample) return;
    Taro.nextTick(() => {
      if (pending.current !== sample) return;
      if (kind === 'study') {
        const after = studyNode();
        const changed = after.id !== sample.beforeId || (after.text && after.text !== sample.beforeText);
        if (!after.id && !after.text) return;
        if (!changed) return;
      } else if (!feedbackVisible()) return;

      const elapsed = Math.max(0, Math.round(Date.now() - sample.startedAt));
      pending.current = null;
      const next = [...samplesRef.current, elapsed].slice(0, LIMIT);
      samplesRef.current = next;
      setSamples(next);
      const result = stats(next);
      console.log(`[preview-timing] Taro ${kind} ${next.length}/${LIMIT} median=${result.median}ms p90=${result.p90}ms`);
    });
  }, [kind]);

  const result = samples.length ? stats(samples) : null;
  const title = kind === 'study' ? 'WordStudy' : '查词汇量';
  const label = `${title} ${samples.length}/${LIMIT} · 中位 ${result?.median ?? '—'} ms · p90 ${result?.p90 ?? '—'} ms`;
  const startupLabel = Object.entries(startupTimings).map(([name, ms]) => `${name} ${ms}ms`).join(' · ');

  return (
    <View className="preview-timing-host" onClick={onClick}>
      <Profiler id={`preview-${kind}`} onRender={onRender}>{children}</Profiler>
      <View style={{ position: 'fixed', top: '12rpx', right: '12rpx', zIndex: 9999, padding: '8rpx 12rpx', borderRadius: '12rpx', backgroundColor: 'rgba(28, 35, 34, 0.88)', color: '#fff', fontSize: '20rpx', lineHeight: 1.4, pointerEvents: 'none' }}>
        <Text>{label}</Text>
        {startupLabel ? <Text style={{ display: 'block', maxWidth: '690rpx', whiteSpace: 'normal' }}>启动 {startupLabel}</Text> : null}
      </View>
    </View>
  );
}

/**
 * 分段计时浮层（计时版预览才有；普通构建换成 preview-timing-off 里的空组件）。
 * 每段显示最近 20 次的中位 / 最大，数据来自 frontend/src/lib/perf-marks。截图发回来就知道 iPhone 上时间花在哪。
 */
export function PerfOverlay() {
  const [lines, setLines] = useState<string[]>([]);
  useEffect(() => {
    let last = '';
    const timer = setInterval(() => {
      // 数据没变就不 setState：浮层自己每秒重画一次，会和点击抢逻辑线程（用户怀疑过计时器本身拖慢）
      const signature = [...perfPhases.values()].map((values) => values.length + ':' + values[values.length - 1]).join('|');
      if (signature === last) return;
      last = signature;
      const next: string[] = [];
      let startup: string[] = [];
      let other: string[] = [];
      perfPhases.forEach((values, phase) => {
        if (!values.length) return;
        if (phase.startsWith('启动 · ')) {
          const labels: Record<string, string> = {
            '页面内容分包就绪': '内容包',
            '主页第一帧': '主页帧',
            '本地数据库文件读取': '本地库',
            'sql.js WASM 初始化': 'WASM',
            '打开 SQLite 数据库': 'SQLite',
            '本机存档检查与恢复': '本机恢复',
            '本机学习库恢复完成': '恢复完成',
            '用户表结构': '用户表',
            '同步结构': '同步表',
            '今日主页数据计算': '首页算',
            '主页数据就位': '首页就绪',
            '出厂库字节到手': '出厂库到手',
            '导入出厂库': '导入',
            '首次保存出厂库': '首次存档',
            '单词进度初始化': '单词进度',
            '语法进度初始化': '语法进度',
            '汉字和辨析内容就绪': '汉字/辨析'
          };
          const label = phase.slice(5);
          startup.push(`${labels[label] ?? label} ${values[values.length - 1]}ms`);
          return;
        }
        const sorted = [...values].sort((a, b) => a - b);
        other.push(`${phase} 中位${sorted[Math.floor(sorted.length / 2)]} 最大${sorted[sorted.length - 1]} (${values.length}次)`);
      });
      if (startup.length) next.push('启动（onLaunch 起）', ...startup);
      // 「卡住 · …」排最前：真机上用户只会截一张图
      other.sort((a, b) => Number(b.startsWith('卡住')) - Number(a.startsWith('卡住')));
      if (other.length) next.push('分段 / 卡住（中位 最大 次数）', ...other);
      const sql = topSql(6).filter(([, entry]) => entry.ms >= 100);
      if (sql.length) next.push('最慢 SQL（累计 次数）', ...sql.map(([text, entry]) => `${Math.round(entry.ms)}ms ×${entry.n} ${text.slice(0, 60)}`));
      setLines(next);
    }, 1000);
    return () => clearInterval(timer);
  }, []);
  if (!lines.length) return null;
  return (
    <View className="perf-overlay-marker" style={{ position: 'fixed', top: '0', left: '48%', right: '12rpx', zIndex: 9999, padding: '4rpx 6rpx', borderRadius: '12rpx', backgroundColor: 'rgba(28, 35, 34, 0.88)', color: '#fff', fontSize: '16rpx', lineHeight: 1.1, pointerEvents: 'none' }}>
      {lines.map((line, index) => index === 0 || line.startsWith('分段') || line.startsWith('最慢') || !line.endsWith('ms')
        ? <Text key={line} style={{ display: 'block', paddingBottom: '2rpx' }}>{line}</Text>
        : <Text key={line} style={{ display: 'inline-block', width: '50%', whiteSpace: 'nowrap' }}>{line}</Text>)}
    </View>
  );
}
