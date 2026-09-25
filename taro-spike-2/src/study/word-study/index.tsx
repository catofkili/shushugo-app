import { useEffect, useState } from 'react';
import { Text, View } from '@tarojs/components';
import { WordStudy } from '../../../../frontend/src/pages/WordStudy';
import { ensureDatabase, getStatus } from '../../../../wechat-miniprogram/src/runtime/database-store';
import { prepareFactoryWordStudy } from '../../platform/prepare-word-study.weapp';

export default function WordStudyRoute() {
  const [ready, setReady] = useState(getStatus().ready);
  const [mode, setMode] = useState<'picked'>('picked');
  const [error, setError] = useState('');

  useEffect(() => {
    if (ready) return;
    ensureDatabase().then(() => {
      const prepared = prepareFactoryWordStudy();
      console.log(`WordStudy fixture prepared: ${prepared.count} words; first ${prepared.card.kanji} (${prepared.card.kana})`);
      setMode('picked');
      setReady(true);
    }).catch((cause) => {
      const message = String(cause?.message || cause?.errMsg || JSON.stringify(cause));
      console.error('WORDSTUDY_FIXTURE_ERROR', message);
      setError(message);
    });
  }, [ready]);

  if (error) return <View className="p-4"><Text>{error}</Text></View>;
  if (!ready) return <View className="p-4"><Text>正在载入隔离出厂词库…</Text></View>;
  return <WordStudy initialMode={mode} />;
}
