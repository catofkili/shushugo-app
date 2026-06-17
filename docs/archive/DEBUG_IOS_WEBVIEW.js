// iOS WebView 诊断脚本
// 在 Safari 开发者工具中运行此脚本

console.log('=== iOS WebView 诊断 ===');

// 1. 检查 #root
const root = document.getElementById('root');
if (root) {
  const rootStyle = window.getComputedStyle(root);
  console.log('1. #root 元素:');
  console.log('  - transform:', rootStyle.transform);
  console.log('  - position:', rootStyle.position);
  console.log('  - height:', rootStyle.height);
  console.log('  - overflow:', rootStyle.overflow);
}

// 2. 检查 body
const bodyStyle = window.getComputedStyle(document.body);
console.log('2. body 元素:');
console.log('  - transform:', bodyStyle.transform);
console.log('  - position:', bodyStyle.position);
console.log('  - height:', bodyStyle.height);
console.log('  - overflow:', bodyStyle.overflow);
console.log('  - -webkit-overflow-scrolling:', bodyStyle.webkitOverflowScrolling);

// 3. 检查导航栏
const nav = document.querySelector('nav[style*="position"]');
if (nav) {
  const navStyle = window.getComputedStyle(nav);
  console.log('3. 导航栏 <nav>:');
  console.log('  - position:', navStyle.position);
  console.log('  - transform:', navStyle.transform);
  console.log('  - bottom:', navStyle.bottom);
  console.log('  - zIndex:', navStyle.zIndex);
  console.log('  - willChange:', navStyle.willChange);

  // 检查导航栏的位置
  const rect = nav.getBoundingClientRect();
  console.log('  - 实际位置:', {
    top: rect.top,
    bottom: rect.bottom,
    left: rect.left,
    right: rect.right
  });
  console.log('  - 视口高度:', window.innerHeight);
  console.log('  - 距离底部:', window.innerHeight - rect.bottom);
}

// 4. 检查所有父元素的 transform
console.log('4. 检查父元素链的 transform:');
let element = nav;
let level = 0;
while (element && level < 10) {
  const style = window.getComputedStyle(element);
  const transform = style.transform;
  if (transform !== 'none') {
    console.log(`  - ${element.tagName}.${element.className}: transform = ${transform}`);
  }
  element = element.parentElement;
  level++;
}

// 5. 检查是否在 iOS
console.log('5. 环境信息:');
console.log('  - userAgent:', navigator.userAgent);
console.log('  - platform:', navigator.platform);
console.log('  - 是否 iOS:', /iPad|iPhone|iPod/.test(navigator.userAgent));

// 6. 滚动信息
console.log('6. 滚动信息:');
console.log('  - window.scrollY:', window.scrollY);
console.log('  - document.documentElement.scrollTop:', document.documentElement.scrollTop);
console.log('  - body.scrollTop:', document.body.scrollTop);

console.log('=== 诊断完成 ===');
