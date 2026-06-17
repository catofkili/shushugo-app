// 在浏览器 Console 中运行这个脚本来诊断导航栏问题

console.log('=== 导航栏诊断脚本 ===\n');

// 1. 找到导航栏
const nav = document.querySelector('nav');
if (!nav) {
  console.error('❌ 找不到 <nav> 元素');
} else {
  console.log('✅ 找到导航栏:', nav);
  
  // 2. 检查计算样式
  const computed = window.getComputedStyle(nav);
  console.log('\n📊 导航栏的计算样式:');
  console.log('  position:', computed.position);
  console.log('  bottom:', computed.bottom);
  console.log('  left:', computed.left);
  console.log('  right:', computed.right);
  console.log('  zIndex:', computed.zIndex);
  console.log('  transform:', computed.transform);
  
  // 3. 检查父元素的 transform
  console.log('\n🔍 检查父元素的 transform:');
  let parent = nav.parentElement;
  let level = 1;
  while (parent && level <= 5) {
    const style = window.getComputedStyle(parent);
    const hasTransform = style.transform !== 'none';
    console.log(`  ${level}. ${parent.tagName}${parent.className ? '.' + parent.className.split(' ')[0] : ''}:`, 
                hasTransform ? `⚠️ transform: ${style.transform}` : '✅ 无 transform');
    if (hasTransform) {
      console.log('     👆 这可能是问题所在！');
    }
    parent = parent.parentElement;
    level++;
  }
  
  // 4. 检查滚动容器
  console.log('\n📜 检查滚动容器:');
  parent = nav.parentElement;
  level = 1;
  while (parent && level <= 5) {
    const style = window.getComputedStyle(parent);
    const canScroll = style.overflow !== 'visible' || style.overflowY !== 'visible';
    console.log(`  ${level}. ${parent.tagName}:`, 
                canScroll ? `⚠️ overflow: ${style.overflow}` : '✅ 无滚动');
    parent = parent.parentElement;
    level++;
  }
  
  // 5. 强制修复测试
  console.log('\n🔧 尝试强制修复...');
  nav.style.position = 'fixed';
  nav.style.bottom = '0';
  nav.style.left = '0';
  nav.style.right = '0';
  nav.style.zIndex = '99999';
  console.log('✅ 已应用强制样式');
  console.log('   如果现在固定了，说明是 CSS 优先级问题');
  console.log('   如果还是滚动，说明是父元素的问题');
}

console.log('\n=== 诊断完成 ===');
