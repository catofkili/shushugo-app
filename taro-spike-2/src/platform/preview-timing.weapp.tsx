import { Profiler, useCallback, useRef, useState, type ReactNode } from 'react';
import { Text, View } from '@tarojs/components';
import Taro from '@tarojs/taro';

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
