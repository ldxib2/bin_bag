'use strict';

const { Plugin, PluginSettingTab, Setting, Notice, Modal, TFile } = require('obsidian');
const engine = require('./engine.js');

const DEFAULT_SETTINGS = {
  reportFolder: 'Agent Reports',
  linkThreshold: 0.15,
  clusterThreshold: 0.15,
  duplicateThreshold: 0.85,
  minWords: 40,
  excludeFolders: 'attachments, .trash',
};

class AskModal extends Modal {
  constructor(app, onSubmit) {
    super(app);
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass('vault-agent-modal');
    contentEl.createEl('h2', { text: 'Ask your vault (100% local)' });
    contentEl.createEl('p', { text: 'Keyword search over every note, answered with excerpts. Nothing leaves this device.' });
    let value = '';
    const text = new Setting(contentEl).addText(t => {
      t.setPlaceholder('e.g. ideas for onboarding, color contrast rules')
        .onChange(v => { value = v; });
      t.inputEl.addEventListener('keydown', e => {
        if (e.key === 'Enter' && value.trim()) {
          this.close();
          this.onSubmit(value.trim());
        }
      });
    });
    text.addButton(b => b.setButtonText('Ask').setCta().onClick(() => {
      if (value.trim()) {
        this.close();
        this.onSubmit(value.trim());
      }
    }));
    text.textEl.focus();
  }

  onClose() {
    this.contentEl.empty();
  }
}

class VaultAgentSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: 'Vault Agent (Local) settings' });

    new Setting(containerEl)
      .setName('Report folder')
      .setDesc('Where scan reports are written inside your vault. This folder is excluded from scans.')
      .addText(t => t.setPlaceholder('Agent Reports').setValue(this.plugin.settings.reportFolder).onChange(async v => {
        this.plugin.settings.reportFolder = v.trim() || DEFAULT_SETTINGS.reportFolder;
        await this.plugin.saveSettings();
      }));

    new Setting(containerEl)
      .setName('Link suggestion threshold')
      .setDesc('Minimum similarity (0-1) for suggesting a new link between two notes. Lower = more suggestions.')
      .addSlider(s => s.setLimits(0.05, 0.5, 0.01).setValue(this.plugin.settings.linkThreshold).setDynamicTooltip().onChange(async v => {
        this.plugin.settings.linkThreshold = v;
        await this.plugin.saveSettings();
      }));

    new Setting(containerEl)
      .setName('Theme cluster threshold')
      .setDesc('Minimum similarity for grouping notes into themes/MOCs.')
      .addSlider(s => s.setLimits(0.05, 0.5, 0.01).setValue(this.plugin.settings.clusterThreshold).setDynamicTooltip().onChange(async v => {
        this.plugin.settings.clusterThreshold = v;
        await this.plugin.saveSettings();
      }));

    new Setting(containerEl)
      .setName('Duplicate threshold')
      .setDesc('Similarity at which two notes are flagged as near-duplicates.')
      .addSlider(s => s.setLimits(0.5, 0.99, 0.01).setValue(this.plugin.settings.duplicateThreshold).setDynamicTooltip().onChange(async v => {
        this.plugin.settings.duplicateThreshold = v;
        await this.plugin.saveSettings();
      }));

    new Setting(containerEl)
      .setName('Stub word count')
      .setDesc('Notes shorter than this many words are flagged as stubs.')
      .addText(t => t.setPlaceholder('40').setValue(String(this.plugin.settings.minWords)).onChange(async v => {
        const n = parseInt(v, 10);
        if (!Number.isNaN(n)) {
          this.plugin.settings.minWords = n;
          await this.plugin.saveSettings();
        }
      }));

    new Setting(containerEl)
      .setName('Excluded folders')
      .setDesc('Comma-separated folder names to skip during scans.')
      .addText(t => t.setPlaceholder('attachments, .trash').setValue(this.plugin.settings.excludeFolders).onChange(async v => {
        this.plugin.settings.excludeFolders = v;
        await this.plugin.saveSettings();
      }));

    new Setting(containerEl)
      .setName('Privacy')
      .setDesc('This plugin makes zero network calls: no fetch, no sockets, no API keys. You can verify by searching the source for "fetch" — there are none. All analysis runs inside Obsidian on your machine.')
      .addButton(b => b.setButtonText('Run full scan now').setCta().onClick(() => this.plugin.runFullScan()));
  }
}

class VaultAgentPlugin extends Plugin {
  async onload() {
    await this.loadSettings();

    this.addRibbonIcon('brain', 'Vault Agent: full scan', () => this.runFullScan());

    this.addCommand({
      id: 'vault-agent-full-scan',
      name: 'Full scan (health, links, ideas, organization)',
      callback: () => this.runFullScan(),
    });

    this.addCommand({
      id: 'vault-agent-suggest-links',
      name: 'Suggest links',
      callback: () => this.runReport('links'),
    });

    this.addCommand({
      id: 'vault-agent-ideas',
      name: 'Ideas & themes',
      callback: () => this.runReport('ideas'),
    });

    this.addCommand({
      id: 'vault-agent-organization',
      name: 'Organization suggestions',
      callback: () => this.runReport('org'),
    });

    this.addCommand({
      id: 'vault-agent-ask',
      name: 'Ask the vault (local)',
      callback: () => {
        new AskModal(this.app, q => this.ask(q));
      },
    });

    this.addCommand({
      id: 'vault-agent-apply-checked',
      name: 'Apply checked suggestions in this note',
      callback: () => this.applyCheckedSuggestions(),
    });

    this.addCommand({
      id: 'vault-agent-open-dashboard',
      name: 'Open dashboard',
      callback: () => {
        const p = this.settings.reportFolder + '/Dashboard.md';
        this.openPath(p);
      },
    });

    this.addSettingTab(new VaultAgentSettingTab(this.app, this));
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  engineOpts() {
    return {
      linkThreshold: Number(this.settings.linkThreshold) || DEFAULT_SETTINGS.linkThreshold,
      clusterThreshold: Number(this.settings.clusterThreshold) || DEFAULT_SETTINGS.clusterThreshold,
      duplicateThreshold: Number(this.settings.duplicateThreshold) || DEFAULT_SETTINGS.duplicateThreshold,
      minWords: Number(this.settings.minWords) || DEFAULT_SETTINGS.minWords,
    };
  }

  isExcluded(path) {
    const p = path.toLowerCase();
    const reportFolder = this.settings.reportFolder.toLowerCase();
    if (p === reportFolder || p.startsWith(reportFolder + '/')) return true;
    return this.settings.excludeFolders
      .split(',')
      .map(s => s.trim().toLowerCase())
      .filter(Boolean)
      .some(ex => p === ex || p.startsWith(ex + '/') || p.includes('/' + ex + '/') || p.endsWith('/' + ex));
  }

  async collectNotes() {
    const out = [];
    for (const f of this.app.vault.getMarkdownFiles()) {
      if (this.isExcluded(f.path)) continue;
      out.push({ path: f.path, content: await this.app.vault.cachedRead(f) });
    }
    return out;
  }

  analyzeNow() {
    return this.collectNotes().then(files => {
      if (!files.length) throw new Error('No notes found to scan.');
      return engine.analyze(files, this.engineOpts());
    });
  }

  async ensureFolder(folder) {
    const parts = folder.split('/').filter(Boolean);
    let current = '';
    for (const part of parts) {
      current = current ? current + '/' + part : part;
      if (!this.app.vault.getAbstractFileByPath(current)) {
        await this.app.vault.createFolder(current);
      }
    }
  }

  async writeReport(name, content) {
    const folder = this.settings.reportFolder;
    await this.ensureFolder(folder);
    const path = folder + '/' + name;
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) {
      await this.app.vault.modify(existing, content);
    } else {
      await this.app.vault.create(path, content);
    }
    return path;
  }

  async openPath(path) {
    const f = this.app.vault.getAbstractFileByPath(path);
    if (f instanceof TFile) await this.app.workspace.getLeaf(false).openFile(f);
  }

  stamp() {
    return new Date().toISOString().slice(0, 16).replace('T', ' ');
  }

  async runFullScan() {
    new Notice('Vault Agent: scanning vault...');
    try {
      const a = await this.analyzeNow();
      const now = this.stamp();
      const healthPath = await this.writeReport('Scan ' + now + '.md', engine.renderHealth(a, now));
      const orgPath = await this.writeReport('Organization.md', engine.renderOrg(a, now));
      const ideasPath = await this.writeReport('Ideas & themes.md', engine.renderIdeas(a, now));
      const dashPath = await this.writeReport('Dashboard.md', engine.renderDashboard(a, {
        now,
        reports: { health: healthPath, org: orgPath, ideas: ideasPath },
      }));
      new Notice('Vault Agent: scanned ' + a.notes.length + ' notes. Dashboard opened.');
      await this.openPath(dashPath);
    } catch (err) {
      new Notice('Vault Agent error: ' + err.message);
      console.error(err);
    }
  }

  async runReport(kind) {
    new Notice('Vault Agent: analyzing...');
    try {
      const a = await this.analyzeNow();
      const now = this.stamp();
      let path;
      if (kind === 'links') {
        path = await this.writeReport('Suggested links.md', engine.renderOrg(a, now));
      } else if (kind === 'ideas') {
        path = await this.writeReport('Ideas & themes.md', engine.renderIdeas(a, now));
      } else {
        path = await this.writeReport('Organization.md', engine.renderOrg(a, now));
      }
      new Notice('Vault Agent: report updated.');
      await this.openPath(path);
    } catch (err) {
      new Notice('Vault Agent error: ' + err.message);
      console.error(err);
    }
  }

  async ask(query) {
    new Notice('Vault Agent: searching locally...');
    try {
      const a = await this.analyzeNow();
      const res = a.answer(query, 6);
      const safe = query.slice(0, 60).replace(/[\\/:*?"<>|]/g, '-');
      await this.ensureFolder(this.settings.reportFolder + '/Answers');
      const path = await this.writeReport('Answers/' + safe + '.md', res.markdown);
      new Notice('Vault Agent: answered from ' + res.results.length + ' note(s), fully offline.');
      await this.openPath(path);
    } catch (err) {
      new Notice('Vault Agent error: ' + err.message);
      console.error(err);
    }
  }

  findByName(name) {
    const want = name.toLowerCase();
    return this.app.vault.getMarkdownFiles().find(f => f.basename.toLowerCase() === want) || null;
  }

  async appendRelated(file, otherName) {
    const content = await this.app.vault.read(file);
    if (content.includes('[[' + otherName + ']]')) return false;
    let updated;
    if (/\n## Related\s*$/m.test(content)) {
      updated = content.replace(/\n## Related\s*$/m, '\n## Related\n- [[' + otherName + ']]');
    } else {
      updated = content.replace(/\s*$/, '') + '\n\n## Related\n- [[' + otherName + ']]\n';
    }
    await this.app.vault.modify(file, updated);
    return true;
  }

  async applyCheckedSuggestions() {
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      new Notice('Vault Agent: open the Suggested links report first.');
      return;
    }
    const content = await this.app.vault.read(file);
    const re = /- \[x\] \[\[([^\]|]+)(?:\|[^\]]+)?\]\]\s*[^\[]*?\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
    const pairs = [];
    let m;
    while ((m = re.exec(content))) pairs.push([m[1], m[2]]);
    if (!pairs.length) {
      new Notice('Vault Agent: no checked suggestions (- [x]) found in this note.');
      return;
    }
    let applied = 0;
    for (const [a, b] of pairs) {
      const fa = this.findByName(a);
      const fb = this.findByName(b);
      if (!fa || !fb) continue;
      const ok1 = await this.appendRelated(fa, fb.basename);
      const ok2 = await this.appendRelated(fb, fa.basename);
      if (ok1 || ok2) applied++;
    }
    new Notice('Vault Agent: applied ' + applied + ' suggested link(s).');
  }
}

module.exports = VaultAgentPlugin;
