import { Text, View } from "@tarojs/components";

/** Keep the base in the text line; only the reading floats above it like web ruby. */
export const JapaneseRubyText = ({ base, reading }: { base: string; reading: string }) => (
  <View className="jp-ruby-weapp">
    <Text className="jp-ruby-reading-weapp">{reading}</Text>
    <Text className="jp-ruby-base-weapp">{base}</Text>
  </View>
);
