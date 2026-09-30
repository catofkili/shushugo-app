import { useEffect, useState } from 'react';
import { Text, View } from '@tarojs/components';
import { WordStudy } from '../../../../frontend/src/pages/WordStudy';
import { ensureDatabase } from '../../platform/database-runtime.weapp';
import { StartupLoading } from '../../platform/StartupLoading';
import { prepareWordStudy } from '../../platform/prepare-word-study.weapp';
import PreviewTimingBoundary from '../../platform/preview-timing.weapp';
import { usePortalHost } from '../../platform/portal-host.weapp';

export default function WordStudyRoute() {
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<'picked'>('picked');
  const [error, setError] = useState('');
  const [startupTimings, setStartupTimings] = useState<Record<string, number>>({});
  const [downloadPercent, setDownloadPercent] = useState<number | null | undefined>(undefined);
  const portalHost = usePortalHost();

  useEffect(() => {
    if (ready) return;
    ensureDatabase('word-study', {
      onStage: (name, elapsedMs) => setStartupTimings((previous) => ({ ...previous, [name]: elapsedMs })),
      onDownload: ({ percent }) => setDownloadPercent(percent)
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
  if (!ready) return <StartupLoading downloadPercent={downloadPercent} />;
  return <View className="theme-light" ref={portalHost}><PreviewTimingBoundary kind="study" startupTimings={startupTimings}><WordStudy initialMode={mode} /></PreviewTimingBoundary></View>;
}
