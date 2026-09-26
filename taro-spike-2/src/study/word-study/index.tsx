import { useEffect, useState } from 'react';
import { Text, View } from '@tarojs/components';
import { WordStudy } from '../../../../frontend/src/pages/WordStudy';
import { ensureDatabase } from '../../platform/database-runtime.weapp';
import { prepareWordStudy } from '../../platform/prepare-word-study.weapp';
import PreviewTimingBoundary from '../../platform/preview-timing.weapp';
import { usePortalHost } from '../../platform/portal-host.weapp';

export default function WordStudyRoute() {
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<'picked'>('picked');
  const [error, setError] = useState('');
  const portalHost = usePortalHost();

  useEffect(() => {
    if (ready) return;
    ensureDatabase().then(() => {
      const prepared = prepareWordStudy();
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
  if (!ready) return <View className="theme-light p-4"><Text>正在载入学习数据…</Text></View>;
  return <View className="theme-light" ref={portalHost}><PreviewTimingBoundary kind="study"><WordStudy initialMode={mode} /></PreviewTimingBoundary></View>;
}
