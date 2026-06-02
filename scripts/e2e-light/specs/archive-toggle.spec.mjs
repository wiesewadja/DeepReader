/**
 * archive-toggle: 书籍软归档切换流程（I/O 契约层）
 *
 * 锚定: c0da03bc 替代品 archive.ts
 * 测试: catalog.json 的读写契约
 *   - 真实路径: <vaultPath>/.obsidian/plugins/deepreader-dev/pageindex/catalog.json
 *   - 注: toggleArchive() 是 CJS 模块函数，evalObsidian 调不到
 *         本 spec 验证 I/O 契约（读 → 改 → 写 → 再读），函数本身由 archive.test.ts 单测覆盖
 */

const CATALOG_PATH = '.obsidian/plugins/deepreader-dev/pageindex/catalog.json';

export default {
  id: 'archive-toggle',
  name: '书籍软归档切换流程（I/O 契约）',
  feature: 'F-13',  // F-13 书库
  timeout: 30_000,
  requires: {
    files: [CATALOG_PATH],
  },

  async run({ log, evalObsidian }) {
    const steps = [];
    const pass = (n, d, det) => steps.push({ name: n, status: 'pass', duration: d, detail: det });
    const fail = (n, d, e) => steps.push({ name: n, status: 'fail', duration: d, error: e.message });
    const skip = (n, d, r) => steps.push({ name: n, status: 'skip', duration: d, error: r });

    const readCatalogExpr = `
      (async () => {
        try {
          const raw = await app.vault.adapter.read(${JSON.stringify(CATALOG_PATH)});
          return JSON.stringify({ ok: true, data: JSON.parse(raw) });
        } catch (e) {
          return JSON.stringify({ ok: false, error: e.message });
        }
      })()
    `;

    function writeCatalogExpr(catalog) {
      return `
        (async () => {
          try {
            await app.vault.adapter.write(${JSON.stringify(CATALOG_PATH)}, JSON.stringify(${JSON.stringify(catalog)}, null, 2));
            return JSON.stringify({ ok: true });
          } catch (e) {
            return JSON.stringify({ ok: false, error: e.message });
          }
        })()
      `;
    }

    // Step 1: 读取 catalog
    let originalCatalog = null;
    let bookIds = [];
    {
      const t0 = Date.now();
      try {
        const raw = await evalObsidian(readCatalogExpr);
        const r = JSON.parse(raw);
        if (!r.ok) throw new Error('读取失败: ' + r.error);
        originalCatalog = r.data;
        bookIds = Object.keys(originalCatalog.books || {});
        if (bookIds.length === 0) {
          skip('catalog 读取', Date.now() - t0, 'catalog.books 为空（test-vault 无索引书籍，跳过）');
          return { steps };
        }
        pass('catalog 读取', Date.now() - t0, `${bookIds.length} 本书: ${bookIds.slice(0, 3).join(', ')}`);
      } catch (e) {
        fail('catalog 读取', Date.now() - t0, e);
        return { steps };
      }
    }

    // Step 2: toggle 首本书 archived 字段
    const targetId = bookIds[0];
    let toggledState = null;
    {
      const t0 = Date.now();
      try {
        const modified = JSON.parse(JSON.stringify(originalCatalog));
        const entry = modified.books[targetId];
        const wasArchived = entry.archived === true;
        entry.archived = !wasArchived;
        const raw = await evalObsidian(writeCatalogExpr(modified));
        const r = JSON.parse(raw);
        if (!r.ok) throw new Error('写入失败: ' + r.error);
        toggledState = !wasArchived;
        pass('toggle 首本', Date.now() - t0, `${targetId}: archived ${wasArchived} → ${toggledState}`);
      } catch (e) {
        fail('toggle 首本', Date.now() - t0, e);
      }
    }

    // Step 3: 重新读取验证
    {
      const t0 = Date.now();
      try {
        const raw = await evalObsidian(readCatalogExpr);
        const r = JSON.parse(raw);
        if (!r.ok) throw new Error('读取失败: ' + r.error);
        const actual = r.data.books[targetId]?.archived === true;
        if (actual !== toggledState) {
          throw new Error(`状态不一致: 期望 ${toggledState}, 实际 ${actual}`);
        }
        pass('读取验证', Date.now() - t0, `archived=${actual}`);
      } catch (e) {
        fail('读取验证', Date.now() - t0, e);
      }
    }

    // Step 4: 批量 toggle 剩余 2 本（如有）
    {
      const t0 = Date.now();
      try {
        const remaining = bookIds.slice(1, 3);
        if (remaining.length === 0) {
          skip('批量 toggle', Date.now() - t0, '无更多书籍可批量');
        } else {
          const modified = JSON.parse(JSON.stringify(originalCatalog));
          for (const id of remaining) {
            const entry = modified.books[id] || { title: '', vectorModel: '', dimensions: 0, nodeCount: 0, hasPropositions: false };
            entry.archived = true;
            modified.books[id] = entry;
          }
          const raw = await evalObsidian(writeCatalogExpr(modified));
          const r = JSON.parse(raw);
          if (!r.ok) throw new Error('写入失败: ' + r.error);
          pass('批量 toggle', Date.now() - t0, `${remaining.length} 本设为 archived=true`);
        }
      } catch (e) {
        fail('批量 toggle', Date.now() - t0, e);
      }
    }

    // Step 5: 还原（恢复 originalCatalog）
    {
      const t0 = Date.now();
      try {
        const raw = await evalObsidian(writeCatalogExpr(originalCatalog));
        const r = JSON.parse(raw);
        if (!r.ok) throw new Error('还原失败: ' + r.error);
        pass('还原 catalog', Date.now() - t0);
      } catch (e) {
        fail('还原 catalog', Date.now() - t0, e);
      }
    }

    return { steps };
  },
};
