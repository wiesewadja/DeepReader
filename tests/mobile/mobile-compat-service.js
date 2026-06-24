/**
 * 自定义 wdio service：注入 window.ready、is-mobile class、window.wdioObsidianService，
 * 绕过 enhance.js / helper plugin 在移动端加载失败的问题。
 *
 * prepareApp() 等待顺序：
 *   1. window.ready（enhance.js 设置，移动端无 enhance.js → 永远不设）
 *   2. document.body.classList.contains("is-mobile")（2s 超时 → OBSIDIAN_HANG_ERROR → retry）
 *   3. window.wdioObsidianService（helper plugin 设置，移动端 helper 加载失败）
 *
 * 本 service 在 obsidian service 的 before() → prepareApp() 之前运行，
 * 注入这三个全局变量，让 prepareApp 顺利通过。
 */
class MobileCompatService {
  async before(capabilities, specs, browser) {
    // 等待 Obsidian WebView 就绪（window.app 存在）
    try {
      await browser.waitUntil(
        async () => {
          return await browser.execute(() => !!window.app);
        },
        { timeout: 60000, interval: 500 },
      );
    } catch {}

    try {
      await browser.execute(() => {
        // 1. window.ready — enhance.js 在移动端不加载，手动设置
        if (!window.ready) {
          window.ready = true;
          console.log('[mobile-compat] Injected window.ready = true');
        }

        // 2. is-mobile class — prepareApp 等待此 class，否则抛 OBSIDIAN_HANG_ERROR
        if (!document.body?.classList.contains('is-mobile')) {
          document.body?.classList.add('is-mobile');
          console.log('[mobile-compat] Added is-mobile class to body');
        }

        // 3. window.wdioObsidianService — helper plugin 设置，移动端加载失败
        if (!window.wdioObsidianService) {
          window.wdioObsidianService = () => ({
            app: window.app,
            obsidian: window.obsidian || (typeof require !== 'undefined' ? require('obsidian') : {}),
            plugins: window.app?.plugins?.plugins || {},
            require: typeof require !== 'undefined' ? require : (mod) => { throw new Error('require not available: ' + mod); },
          });
          console.log('[mobile-compat] Injected window.wdioObsidianService');
        }
      });
    } catch (e) {
      console.warn('[mobile-compat] Failed to inject:', e);
    }
  }
}

module.exports = { default: MobileCompatService };
