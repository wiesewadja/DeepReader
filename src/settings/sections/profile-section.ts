/**
 * 用户画像 Tab
 */

import { Notice, Setting } from 'obsidian';
import type { SectionContext } from '../types';
import { DEFAULT_DIMENSIONS } from '../../services/profile-facts';
import { FolderSuggestModal } from '../components/folder-suggest';

export function renderProfileSection(
  container: HTMLElement,
  ctx: SectionContext,
  onRerender: () => void,
): void {
  container.createEl('h3', { text: '用户画像设置' });
  container.createEl('p', {
    text: '指定包含你日记、随笔、感悟的目录，奚童会从中了解你，提供更贴心的阅读陪伴。',
    cls: 'setting-item-description',
  });

  new Setting(container)
    .setName('笔记目录')
    .setDesc('存放日记、随笔、感悟的 Obsidian 文件夹路径（相对于 Vault 根目录）')
    .addText(text => {
      text
        .setPlaceholder('点击下方按钮选择目录')
        .setValue(ctx.plugin.settings.journalDir || '')
        .inputEl.readOnly = true;
    })
    .addButton(btn => btn
      .setButtonText('选择目录')
      .setCta()
      .onClick(() => {
        new FolderSuggestModal(ctx.app, async (path) => {
          if (path === ctx.plugin.settings.journalDir) return;
          ctx.plugin.settings.journalDir = path;
          await ctx.plugin.saveSettings();
          (ctx.plugin as any).profileBuilder = path
            ? new (await import('../../services/profile-builder')).ProfileBuilder(ctx.app, ctx.plugin.settings)
            : undefined;
          new Notice('笔记目录已保存');
          onRerender();
        }).open();
      }));

  // 自定义维度管理
  container.createEl('h4', { text: '画像维度' });
  container.createEl('p', {
    text: '内置 7 个维度覆盖核心方面。你也可以添加自定义维度，画像会从更多角度理解你。',
    cls: 'setting-item-description',
  });

  const builtInEl = container.createDiv({ cls: 'deeppdf-dimension-list' });
  builtInEl.createEl('div', { text: '内置维度', cls: 'deeppdf-dimension-group-label' });
  for (const d of DEFAULT_DIMENSIONS) {
    builtInEl.createDiv({ cls: 'deeppdf-dimension-tag' }, el => {
      el.createSpan({ text: d.label });
    });
  }

  const customDimensions = ctx.plugin.settings.profileDimensions || [];
  if (customDimensions.length > 0) {
    const customEl = container.createDiv({ cls: 'deeppdf-dimension-list' });
    customEl.createEl('div', { text: '自定义维度', cls: 'deeppdf-dimension-group-label' });
    for (let i = 0; i < customDimensions.length; i++) {
      const dim = customDimensions[i];
      const row = customEl.createDiv({ cls: 'deeppdf-dimension-row' });
      row.createDiv({ cls: 'deeppdf-dimension-tag' }, el => {
        el.createSpan({ text: dim.label });
      });
      const removeBtn = row.createEl('button', { text: '✕', cls: 'deeppdf-dimension-remove' });
      const dimKey = dim.key;
      removeBtn.addEventListener('click', async () => {
        ctx.plugin.settings.profileDimensions =
          ctx.plugin.settings.profileDimensions.filter(d => d.key !== dimKey);
        await ctx.plugin.saveSettings();
        onRerender();
      });
    }
  }

  new Setting(container)
    .setName('添加自定义维度')
    .addText(text => {
      text.setPlaceholder('维度名称，如「学习」「健康」');
      text.inputEl.addEventListener('keydown', async (e: KeyboardEvent) => {
        if (e.key === 'Enter') {
          addDimension(text.inputEl.value.trim(), ctx, onRerender);
        }
      });
    })
    .addButton(btn => btn
      .setButtonText('添加')
      .onClick(async () => {
        const input = btn.buttonEl.closest('.setting-item')?.querySelector('input');
        const label = input?.value?.trim();
        if (!label) return;
        addDimension(label, ctx, onRerender);
      }));

  const builder = (ctx.plugin as any).profileBuilder;
  renderProfileActions(container, ctx, builder, onRerender);
}

function addDimension(label: string, ctx: SectionContext, onRerender: () => void): void {
  if (!label) return;
  const rawKey = label.toLowerCase().replace(/[^a-z0-9一-鿿぀-ゟ゠-ヿ]/g, '_').replace(/^_+|_+$/g, '');
  const key = rawKey || `custom_${Date.now()}`;
  if (!ctx.plugin.settings.profileDimensions) {
    ctx.plugin.settings.profileDimensions = [];
  }
  const allLabels = [...DEFAULT_DIMENSIONS, ...ctx.plugin.settings.profileDimensions].map(d => d.label);
  if (allLabels.includes(label)) {
    new Notice('该维度已存在');
    return;
  }
  ctx.plugin.settings.profileDimensions.push({ key, label });
  ctx.plugin.saveSettings().then(() => onRerender());
}

function renderProfileActions(
  container: HTMLElement,
  ctx: SectionContext,
  builder: any,
  onRerender: () => void,
): void {
  (async () => {
    try {
      const hasProfile = !!(await builder?.readMeta?.());
      if (!container.isConnected) return;

      new Setting(container)
        .setName(hasProfile ? '重建画像' : '构建画像')
        .setDesc(hasProfile ? '忽略已有数据，完全重新构建画像' : '扫描指定目录中的笔记，生成你的专属画像')
        .addButton(btn => {
          btn
            .setButtonText(builder?.getIsBuilding() ? '取消构建' : (hasProfile ? '重建' : '构建画像'))
            .setCta()
            .onClick(async () => {
              await handleBuildProfile(ctx, builder, btn, container, hasProfile, onRerender);
            });
        })
        .addButton(btn => {
          btn
            .setButtonText('删除')
            .setWarning()
            .setDisabled(!hasProfile);
          if (hasProfile) {
            btn.onClick(async () => {
              if (builder) {
                await builder.deleteProfile();
                new Notice('画像已删除');
                onRerender();
              }
            });
          }
        });

      const statusEl = container.createDiv({ cls: 'deeppdf-profile-status' });
      const progressEl = container.createDiv({ cls: 'deeppdf-profile-progress' });

      if (builder?.getIsBuilding()) {
        pollBuildProgress(ctx, builder, null, statusEl, progressEl, hasProfile, onRerender);
      } else {
        refreshProfileStatus(builder, statusEl);
      }
    } catch {
      // Silently handle — container may have been cleaned up
    }
  })();
}

function refreshProfileStatus(builder: any, el: HTMLElement): void {
  el.empty();
  if (!builder) {
    el.createSpan({ text: '未配置笔记目录', cls: 'setting-item-description' });
    return;
  }

  builder.readMeta().then((meta: any) => {
    if (!el.isConnected) return;
    if (meta) {
      const date = new Date(meta.lastBuildTime).toLocaleDateString('zh-CN');
      el.createSpan({ text: `上次构建：${date} · 涵盖 ${meta.fileCount} 篇笔记` });
    } else {
      el.createSpan({ text: '尚未构建画像', cls: 'setting-item-description' });
    }
  });
}

function showBuildProgress(builder: any, el: HTMLElement): void {
  if (!builder) return;
  const p = builder.latestProgress;
  if (!p) return;

  el.empty();

  const stageLabels: Record<string, string> = {
    scanning: '扫描笔记文件',
    indexing: '建立索引',
    extracting: '抽取维度事实',
    synthesizing: '生成画像',
    summarizing: '生成摘要',
    done: '构建完成',
  };

  const stageLabel = stageLabels[p.stage] || p.stage;
  const bar = el.createDiv({ cls: 'deeppdf-profile-progress-bar' });
  const label = el.createDiv({ cls: 'deeppdf-profile-progress-label' });

  if (p.total > 0) {
    const pct = Math.round((p.current / p.total) * 100);
    const fill = bar.createDiv({ cls: 'deeppdf-profile-progress-fill' });
    fill.style.width = `${pct}%`;
    label.setText(`${stageLabel}：${p.current} / ${p.total}（${pct}%）`);
  } else {
    label.setText(stageLabel);
  }
}

let activePollTimer: ReturnType<typeof setTimeout> | null = null;

function pollBuildProgress(
  ctx: SectionContext,
  builder: any,
  btn: any,
  statusEl: HTMLElement,
  progressEl: HTMLElement,
  force: boolean,
  onRerender: () => void,
): void {
  showBuildProgress(builder, progressEl);

  if (builder.getIsBuilding()) {
    if (!statusEl.isConnected) return;
    activePollTimer = setTimeout(() => pollBuildProgress(ctx, builder, btn, statusEl, progressEl, force, onRerender), 500);
  } else {
    activePollTimer = null;
    if (btn) btn.setButtonText(force ? '重建' : '构建画像');
    if (progressEl.isConnected) progressEl.empty();
    refreshProfileStatus(builder, statusEl);
    (ctx.plugin as any).frontendAgent?.invalidateProfileCache?.();
    setTimeout(() => {
      if (statusEl.isConnected) onRerender();
    }, 800);
  }
}

async function handleBuildProfile(
  ctx: SectionContext,
  builder: any,
  btn: any,
  container: HTMLElement,
  force: boolean,
  onRerender: () => void,
): Promise<void> {
  if (!builder) {
    new Notice('请先配置笔记目录');
    return;
  }

  if (builder.getIsBuilding()) {
    builder.cancel();
    btn.setButtonText(force ? '重建' : '构建画像');
    return;
  }

  btn.setButtonText('取消构建');

  const statusEl = container.querySelector('.deeppdf-profile-status') as HTMLElement | null;
  const progressEl = container.querySelector('.deeppdf-profile-progress') as HTMLElement | null;

  if (progressEl) {
    progressEl.empty();
    const startLabel = progressEl.createDiv({ cls: 'deeppdf-profile-progress-label' });
    startLabel.setText('正在启动构建...');
  }
  if (statusEl) statusEl.empty();

  builder.build(undefined, force).catch((e: any) => {
    if (e.name !== 'AbortError') {
      new Notice(`构建失败：${e.message}`);
    }
  });

  // Clear any existing poll timer before starting a new one
  if (activePollTimer) clearTimeout(activePollTimer);

  setTimeout(() => {
    pollBuildProgress(
      ctx, builder, btn,
      statusEl || container.createDiv({ cls: 'deeppdf-profile-status' }),
      progressEl || container.createDiv({ cls: 'deeppdf-profile-progress' }),
      force,
      onRerender,
    );
  }, 100);
}
