const jsxRuntime = require('../../node_modules/react/jsx-runtime.js');
const jsxDevRuntime = require('../../node_modules/react/jsx-dev-runtime.js');

const hasCheckbox = (child) => {
  if (!child || typeof child !== 'object') return false;
  if (Array.isArray(child)) return child.some(hasCheckbox);
  return child?.type === 'input' && child.props?.type === 'checkbox'
    || hasCheckbox(child?.props?.children);
};

const stopTap = (event) => event?.stopPropagation?.();

// ⚠️ 不把 disabled 交给微信的 <button>：微信内置 `button[disabled]:not([type])`（白字 + 浅灰底）的优先级比我们任何单类选择器都高，
// 禁用的选项/按钮会变成「白字配米色底」几乎不可读（2026-10-12：JLPT 选项、起点水平「内容准备中」）。
// 改成不带 disabled 的普通按钮 + `is-disabled` 类 + 吞掉点击；网页的 `:disabled` 规则由 scripts/weapp-press-feedback.cjs 同步生成 `.is-disabled` 版本。
const withoutNativeDisabled = ({ disabled, className, onClick, ...rest }) => ({
  ...rest,
  className: className ? `${className} is-disabled` : 'is-disabled',
  'aria-disabled': true,
  onClick: stopTap,
  hoverClass: 'none'
});

const withPressFeedback = (type, props) => {
  const button = type === 'button';
  if (button && props?.disabled) return withoutNativeDisabled(props);
  // ⚠️ 只认显式声明成按钮的 div（role="button"），别按「有 onClick」认：AppShell 最外层为了记诊断的「最近操作」挂了 onClick，
  // 按「有 onClick」认的话整个应用都成了可按的，按哪儿整页都变淡（2026-09-27 真机：「点任何地方按住屏幕都会变白」）。
  const clickableView = (type === 'div' || type === 'view') && typeof props?.onClick === 'function' && props?.role === 'button';
  const switchRow = type === 'div' && (Array.isArray(props?.children) ? props.children : [props?.children])
    .some((child) => child?.type === 'label' && hasCheckbox(child.props?.children));
  if (!button && !clickableView && !switchRow) return props;
  // hoverStopPropagation：微信的 hover-class 默认会一路激活祖先，按一个按钮外面的卡片也跟着变淡。
  return { ...props, hoverClass: 'is-pressed', hoverStopPropagation: true, hoverStartTime: 20, hoverStayTime: 70 };
};

exports.Fragment = jsxRuntime.Fragment;
exports.jsx = (type, props, key) => jsxRuntime.jsx(type, withPressFeedback(type, props), key);
exports.jsxs = (type, props, key) => jsxRuntime.jsxs(type, withPressFeedback(type, props), key);
exports.jsxDEV = (type, props, key, isStaticChildren, source, self) => jsxDevRuntime.jsxDEV(
  type,
  withPressFeedback(type, props),
  key,
  isStaticChildren,
  source,
  self
);
