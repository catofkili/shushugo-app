import { useEffect, useState } from 'react';
import { Text, View } from '@tarojs/components';
import { VocabTestPage } from '../../../../frontend/src/pages/VocabTestPage';
import { ensureDatabase, getStatus } from '../../../../wechat-miniprogram/src/runtime/database-store';

export default function VocabTestRoute() {
  const [ready, setReady] = useState(getStatus().ready);
  const [error, setError] = useState('');

  useEffect(() => {
    if (ready) return;
    ensureDatabase().then(() => setReady(true)).catch((cause) => setError(String(cause?.message || cause?.errMsg || JSON.stringify(cause))));
  }, [ready]);

  if (error) return <View className="p-4"><Text>{error}</Text></View>;
  if (!ready) return <View className="p-4"><Text>正在载入出厂词库…</Text></View>;
  return <VocabTestPage />;
}
