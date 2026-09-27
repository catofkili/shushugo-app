import { useEffect, useState } from 'react';
import { Text, View } from '@tarojs/components';
import { VocabTestPage } from '../../../../frontend/src/pages/VocabTestPage';
import { ensureDatabase } from '../../platform/database-runtime.weapp';
import PreviewTimingBoundary from '../../platform/preview-timing.weapp';

export default function VocabTestRoute() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [startupTimings, setStartupTimings] = useState<Record<string, number>>({});
  const [downloadStatus, setDownloadStatus] = useState('');

  useEffect(() => {
    if (ready) return;
    ensureDatabase('vocab-test', {
      onStage: (name, elapsedMs) => setStartupTimings((previous) => ({ ...previous, [name]: elapsedMs })),
      onDownload: ({ compressed, percent, fallback }) => setDownloadStatus(
        `${fallback ? '压缩库回退原库 · ' : ''}${compressed ? '下载压缩出厂库' : '下载出厂库'}${percent === null ? '…' : ` ${percent}%`}`
      )
    }).then(() => setReady(true)).catch((cause) => setError(String(cause?.message || cause?.errMsg || JSON.stringify(cause))));
  }, [ready]);

  if (error) return <View className="theme-light p-4"><Text>{error}</Text></View>;
  if (!ready) return <View className="theme-light p-4"><Text>{downloadStatus || '正在载入学习数据…'}</Text></View>;
  return <View className="theme-light"><PreviewTimingBoundary kind="vocab" startupTimings={startupTimings}><VocabTestPage /></PreviewTimingBoundary></View>;
}
