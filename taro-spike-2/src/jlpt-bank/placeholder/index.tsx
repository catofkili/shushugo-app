import { Text, View } from '@tarojs/components';

// jlpt-bank 分包只装 JLPT 题库的异步代码块（lib/jlpt-practice/bank.ts）；分包至少要有一个页面，这页从不被打开。
export default function JlptBankPlaceholder() {
  return <View className="p-4"><Text>按需加载的题库。</Text></View>;
}
