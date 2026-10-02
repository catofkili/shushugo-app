import { LoginShell } from './LoginShell.weapp';
import { useEffect, useState } from 'react';
import { Button, Text } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { AuthDialog } from '../../../../frontend/src/components/AuthDialog';
import {
  autoSyncCloudDatabase,
  getCloudSession,
  registerCloudAutoSyncLifecycle,
  type CloudSession
} from '../../../../frontend/src/lib/sync-api';

export default function CloudAccountPage() {
  const [session, setSession] = useState<CloudSession>({ configured: false });
  const [authOpen, setAuthOpen] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState('正在读取云同步账号…');

  useEffect(() => {
    registerCloudAutoSyncLifecycle();
    void getCloudSession().then((value) => {
      setSession(value);
      if (!value.token) setMessage('登录后会自动同步本机学习进度。');
      else setMessage('账号已登录。');
    });
  }, []);

  const sync = async () => {
    setSyncing(true);
    setMessage('正在检查云端学习进度…');
    try {
      const result = await autoSyncCloudDatabase('login');
      setMessage(result.message || `云同步状态：${result.status}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '云同步失败，请稍后重试。');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <LoginShell>
      <Text className="block text-lg font-bold">微信登录与云同步</Text>
      <Text className="mt-3 block">{session.email || (session.token ? '微信账号已登录' : '尚未登录')}</Text>
      <Text className="mt-2 block text-sm">{message}</Text>
      {session.token && (
        <Button className="mt-4" disabled={syncing} onClick={() => void sync()}>
          {syncing ? '同步中…' : '立即同步'}
        </Button>
      )}
      {!session.token && <Button className="mt-4" onClick={() => Taro.navigateBack()}>返回</Button>}
      <AuthDialog
        open={authOpen && !session.token}
        onClose={() => setAuthOpen(false)}
        onAuthenticated={async (value) => {
          setSession(value);
          setMessage('已登录，同步已启动。');
          setAuthOpen(false);
        }}
      />
    </LoginShell>
  );
}
