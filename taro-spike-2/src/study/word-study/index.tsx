import { useEffect, useState } from 'react';
import { Text, View } from '@tarojs/components';
import { WordStudy } from '../../../../frontend/src/pages/WordStudy';
import { ensureDatabase } from '../../platform/database-runtime.weapp';
import { prepareWordStudy } from '../../platform/prepare-word-study.weapp';
import PreviewTimingBoundary from '../../platform/preview-timing.weapp';

export default function WordStudyRoute() {
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<'picked'>('picked');
  const [error, setError] = useState('');
  const [startupTimings, setStartupTimings] = useState<Record<string, number>>({});
  const [downloadStatus, setDownloadStatus] = useState('');

  useEffect(() => {
    if (ready) return;
    ensureDatabase('word-study', {
      onStage: (name, elapsedMs) => setStartupTimings((previous) => ({ ...previous, [name]: elapsedMs })),
      onDownload: ({ compressed, percent, fallback }) => setDownloadStatus(
        `${fallback ? '压缩库回退原库 · ' : ''}${compressed ? '下载压缩出厂库' : '下载出厂库'}${percent === null ? '…' : ` ${percent}%`}`
      )
    }).then(() => {
      const started = Date.now();
      const prepared = prepareWordStudy();
      setStartupTimings((previous) => ({ ...previous, firstCard: Math.max(0, Math.round(Date.now() - started)) }));
      console.log(`WordStudy prepared: ${prepared.count} words; first ${prepared.card.kanji} (${prepared.card.kana})`);
      setMode('picked');
      setReady(true);
    }).catch((cause) => {
      const message = String(cause?.message || cause?.errMsg || JSON.stringify(cause));
      console.error('WORDSTUDY_INIT_ERROR', message);
      setError(message);
    });
  }, [ready]);

  if (error) return <View className="theme-light p-4"><Text>{error}</Text></View>;
  if (!ready) return <View className="theme-light p-4"><Text>{downloadStatus || '正在载入学习数据…'}</Text></View>;
  return <View className="theme-light"><PreviewTimingBoundary kind="study" startupTimings={startupTimings}><WordStudy initialMode={mode} /></PreviewTimingBoundary></View>;
}
