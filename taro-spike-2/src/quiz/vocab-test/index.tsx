import { useEffect, useState } from 'react';
import { Text, View } from '@tarojs/components';
import { VocabTestPage } from '../../../../frontend/src/pages/VocabTestPage';
import { ensureDatabase } from '../../platform/database-runtime.weapp';
import PreviewTimingBoundary from '../../platform/preview-timing.weapp';

export default function VocabTestRoute() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (ready) return;
    ensureDatabase().then(() => setReady(true)).catch((cause) => setError(String(cause?.message || cause?.errMsg || JSON.stringify(cause))));
  }, [ready]);

  if (error) return <View className="theme-light p-4"><Text>{error}</Text></View>;
  if (!ready) return <View className="theme-light p-4"><Text>正在载入学习数据…</Text></View>;
  return <View className="theme-light"><PreviewTimingBoundary kind="vocab"><VocabTestPage /></PreviewTimingBoundary></View>;
}
