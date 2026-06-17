/**
 * iOS WebView 优化工具
 * 用于改善 Capacitor 应用在 iOS 中的显示和性能
 */

import { Capacitor } from '@capacitor/core';
// import { StatusBar, Style } from '@capacitor/status-bar';
// import { Keyboard, KeyboardResize } from '@capacitor/keyboard';

export class WebViewOptimizer {
  private static initialized = false;

  /**
   * 初始化 WebView 优化
   */
  static async initialize(): Promise<void> {
    if (this.initialized) return;

    console.log('[WebView] 开始初始化优化...');

    try {
      // 仅在原生平台执行
      if (Capacitor.isNativePlatform()) {
        await this.setupStatusBar();
        await this.setupKeyboard();
        this.setupViewportFixes();
        this.setupPerformanceOptimizations();
        this.setupScrollOptimizations();
      } else {
        console.log('[WebView] 浏览器环境，跳过原生优化');
      }

      this.initialized = true;
      console.log('[WebView] ✅ 优化初始化完成');
    } catch (error) {
      console.error('[WebView] ⚠️ 优化初始化失败:', error);
    }
  }

  /**
   * 配置状态栏
   */
  private static async setupStatusBar(): Promise<void> {
    try {
      if (Capacitor.getPlatform() === 'ios') {
        // StatusBar 插件暂时禁用，避免兼容性问题
        console.log('[WebView] ⚠️ StatusBar 插件已禁用');
      }
    } catch (error) {
      console.warn('[WebView] 状态栏配置失败:', error);
    }
  }

  /**
   * 配置键盘行为
   */
  private static async setupKeyboard(): Promise<void> {
    try {
      if (Capacitor.getPlatform() === 'ios') {
        // Keyboard 插件暂时禁用，避免兼容性问题
        console.log('[WebView] ⚠️ Keyboard 插件已禁用');
      }
    } catch (error) {
      console.warn('[WebView] 键盘配置失败:', error);
    }
  }

  /**
   * 修复 iOS WebView 的 viewport 问题
   */
  private static setupViewportFixes(): void {
    // 防止双击缩放
    let lastTouchEnd = 0;
    document.addEventListener('touchend', (event) => {
      const now = Date.now();
      if (now - lastTouchEnd <= 300) {
        event.preventDefault();
      }
      lastTouchEnd = now;
    }, false);

    // 防止意外的文字选择
    document.addEventListener('selectstart', (event) => {
      const target = event.target as HTMLElement;
      if (!target.matches('input, textarea')) {
        // event.preventDefault(); // 根据需要取消注释
      }
    });

    // 修复 iOS 滚动问题
    document.addEventListener('touchmove', (event) => {
      const target = event.target as HTMLElement;

      // 允许可滚动元素滚动
      if (target.scrollHeight > target.clientHeight) {
        // 不阻止默认行为
        return;
      }
    }, { passive: true });

    console.log('[WebView] ✅ Viewport 修复完成');
  }

  /**
   * 性能优化
   */
  private static setupPerformanceOptimizations(): void {
    // 启用 passive event listeners
    const passiveSupported = this.testPassiveSupport();
    if (passiveSupported) {
      // 将 touch 事件标记为 passive 以提升滚动性能
      ['touchstart', 'touchmove', 'wheel'].forEach(eventType => {
        document.addEventListener(eventType, () => {}, { passive: true });
      });
    }

    // 启用硬件加速（通过 CSS 类）
    document.documentElement.classList.add('hw-accelerated');

    // 添加 iOS 特定的类
    if (Capacitor.getPlatform() === 'ios') {
      document.documentElement.classList.add('platform-ios');
    }

    console.log('[WebView] ✅ 性能优化完成');
  }

  /**
   * 滚动优化
   */
  private static setupScrollOptimizations(): void {
    // 监听滚动，添加阴影效果
    let scrollTimer: number | null = null;
    let isScrolling = false;

    const handleScroll = () => {
      if (!isScrolling) {
        document.body.classList.add('is-scrolling');
        isScrolling = true;
      }

      if (scrollTimer !== null) {
        clearTimeout(scrollTimer);
      }

      scrollTimer = window.setTimeout(() => {
        document.body.classList.remove('is-scrolling');
        isScrolling = false;
      }, 150);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });

    console.log('[WebView] ✅ 滚动优化完成');
  }

  /**
   * 测试浏览器是否支持 passive events
   */
  private static testPassiveSupport(): boolean {
    let passiveSupported = false;
    try {
      const options: AddEventListenerOptions = {
        get passive() {
          passiveSupported = true;
          return false;
        }
      };
      window.addEventListener('test', null as any, options);
      window.removeEventListener('test', null as any, options);
    } catch (err) {
      passiveSupported = false;
    }
    return passiveSupported;
  }

  /**
   * 获取安全区域 insets
   */
  static getSafeAreaInsets() {
    const style = getComputedStyle(document.documentElement);
    return {
      top: style.getPropertyValue('--safe-area-inset-top') || '0px',
      bottom: style.getPropertyValue('--safe-area-inset-bottom') || '0px',
      left: style.getPropertyValue('--safe-area-inset-left') || '0px',
      right: style.getPropertyValue('--safe-area-inset-right') || '0px',
    };
  }

  /**
   * 检测是否在 WebView 中运行
   */
  static isWebView(): boolean {
    return Capacitor.isNativePlatform();
  }

  /**
   * 获取平台信息
   */
  static getPlatformInfo() {
    return {
      platform: Capacitor.getPlatform(),
      isNative: Capacitor.isNativePlatform(),
      isIOS: Capacitor.getPlatform() === 'ios',
      isAndroid: Capacitor.getPlatform() === 'android',
      isWeb: Capacitor.getPlatform() === 'web',
    };
  }
}

// 自动初始化（在应用启动时调用）
export const initWebViewOptimizer = () => {
  if (typeof window !== 'undefined') {
    // 等待 DOM 完全加载
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        WebViewOptimizer.initialize();
      });
    } else {
      WebViewOptimizer.initialize();
    }
  }
};
