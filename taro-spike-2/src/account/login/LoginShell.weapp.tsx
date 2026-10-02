import type { ReactNode } from 'react';
import { View } from '@tarojs/components';
import { getResolvedTheme } from '../../../../frontend/src/lib/studyPreferences';
import { usePortalHost } from '../../platform/portal-host.weapp';

// This route bypasses WeappPage; its dialogs still need the same theme and portal host.
export function LoginShell({ children }: { children: ReactNode }) {
  const portalHost = usePortalHost();
  return <View ref={portalHost} className={`p-4 theme-${getResolvedTheme()} attr-data-theme`}>{children}</View>;
}
