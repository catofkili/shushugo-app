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
  const clickableView = (type === 'div' || type === 'view') && typeof props?.onClick === 'function';
  const switchRow = type === 'div' && (Array.isArray(props?.children) ? props.children : [props?.children])
    .some((child) => child?.type === 'label' && hasCheckbox(child.props?.children));
  if (!button && !clickableView && !switchRow) return props;
  return { ...props, hoverClass: 'is-pressed', hoverStartTime: 20, hoverStayTime: 70 };
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
