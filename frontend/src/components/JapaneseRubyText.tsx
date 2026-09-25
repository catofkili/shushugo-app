export const JapaneseRubyText = ({ base, reading }: { base: string; reading: string }) => (
  <ruby className="jp-ruby">
    {base}
    <rt>{reading}</rt>
  </ruby>
);
