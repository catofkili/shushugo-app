import { Text, View } from '@tarojs/components';
import { CapybaraWalk } from '../../../frontend/src/components/CapybaraMascot';

export function StartupLoading({ downloadPercent }: { downloadPercent?: number | null }) {
  const percent = typeof downloadPercent === 'number' && Number.isFinite(downloadPercent)
    ? Math.max(0, Math.min(100, downloadPercent))
    : null;
  // 下完之后还要解压、建库，那段不能停在「下载词库 100%」上。
  const downloading = downloadPercent !== undefined && percent !== 100;

  return (
    <View className="theme-light" style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <View style={{ marginBottom: '12px' }}><CapybaraWalk size={72} /></View>
        <Text style={{ color: 'var(--ds-ink-2, #5E5448)', fontSize: '14px', fontWeight: '600', lineHeight: '20px' }}>
          {downloading ? percent === null ? '下载词库…' : `下载词库 ${Math.round(percent)}%` : '正在加载…'}
        </Text>
        {downloading && percent !== null && (
          <View style={{ width: '160px', height: '4px', marginTop: '8px', overflow: 'hidden', borderRadius: '999px', backgroundColor: 'var(--ds-inset, #F3F0EA)' }}>
            <View style={{ width: `${percent}%`, height: '100%', borderRadius: '999px', backgroundColor: 'var(--ds-primary, #7EBE4F)' }} />
          </View>
        )}
      </View>
    </View>
  );
}
