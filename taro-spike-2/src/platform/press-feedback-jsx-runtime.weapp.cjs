const jsxRuntime = require('../../node_modules/react/jsx-runtime.js');
const jsxDevRuntime = require('../../node_modules/react/jsx-dev-runtime.js');

const hasCheckbox = (child) => {
  if (!child || typeof child !== 'object') return false;
  if (Array.isArray(child)) return child.some(hasCheckbox);
  return child?.type === 'input' && child.props?.type === 'checkbox'
    || hasCheckbox(child?.props?.children);
};

const withPressFeedback = (type, props) => {
  const button = type === 'button';
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
