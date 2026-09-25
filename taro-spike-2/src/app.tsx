import type { PropsWithChildren } from 'react';
import './platform/iframe-polyfill.weapp';
import '../../frontend/src/styles.css';
import '../../frontend/src/app.css';
import '../../frontend/src/design.css';
import '../../frontend/src/skins.css';

export default function App({ children }: PropsWithChildren) {
  return children;
}
