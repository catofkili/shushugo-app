import { useEffect, useState } from 'react';
import { Text, View } from '@tarojs/components';
import { VocabTestPage } from '../../../../frontend/src/pages/VocabTestPage';
import { ensureDatabase } from '../../platform/database-runtime.weapp';
import { StartupLoading } from '../../platform/StartupLoading';
import PreviewTimingBoundary from '../../platform/preview-timing.weapp';

export default function VocabTestRoute() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [startupTimings, setStartupTimings] = useState<Record<string, number>>({});
  const [downloadPercent, setDownloadPercent] = useState<number | null | undefined>(undefined);

  useEffect(() => {
    if (ready) return;
    ensureDatabase('vocab-test', {
      onStage: (name, elapsedMs) => setStartupTimings((previous) => ({ ...previous, [name]: elapsedMs })),
      onDownload: ({ percent }) => setDownloadPercent(percent)
    }).then(() => setReady(true)).catch((cause) => setError(String(cause?.message || cause?.errMsg || JSON.stringify(cause))));
  }, [ready]);

  if (error) return <View className="theme-light p-4"><Text>{error}</Text></View>;
  if (!ready) return <StartupLoading downloadPercent={downloadPercent} />;
  return <View className="theme-light"><PreviewTimingBoundary kind="vocab" startupTimings={startupTimings}><VocabTestPage /></PreviewTimingBoundary></View>;
}
