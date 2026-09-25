import { Button, View, Text } from '@tarojs/components';
import Taro from '@tarojs/taro';

export default function IndexPage() {
  return (
    <View className="p-4">
      <Text>路线 A 试验</Text>
      <Button className="mt-4" onClick={() => Taro.navigateTo({ url: '/features/vocab-test/index' })}>打开查词汇量页</Button>
    </View>
  );
}
