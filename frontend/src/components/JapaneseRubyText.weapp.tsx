import { Text } from "@tarojs/components";

/** WXML has no ruby/rt element; keep the base text and expose its reading inline. */
export const JapaneseRubyText = ({ base, reading }: { base: string; reading: string }) => (
  <Text className="jp-ruby-weapp">
    {base}<Text className="jp-ruby-reading-weapp">（{reading}）</Text>
  </Text>
);
