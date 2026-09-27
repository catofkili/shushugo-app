import { Text, View } from '@tarojs/components';

// lazy 分包只装 import() 出来的异步代码块；分包至少要有一个页面，这页从不被打开。
export default function LazyPlaceholder() {
  return <View className="p-4"><Text>按需加载的代码块。</Text></View>;
}
