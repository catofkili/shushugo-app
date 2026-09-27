import { Text, View } from "@tarojs/components";

/** WXML has no ruby/rt element; stack the reading above the base like the web ruby. */
export const JapaneseRubyText = ({ base, reading }: { base: string; reading: string }) => (
  <View className="jp-ruby-weapp">
    <Text className="jp-ruby-reading-weapp">{reading}</Text>
    <Text>{base}</Text>
  </View>
);
