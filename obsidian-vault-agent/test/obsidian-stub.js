'use strict';

const Module = require('node:module');

function makeEl() {
  const el = {
    children: [],
    tag: '',
    text: '',
    createEl(tag, opts) {
      const c = makeEl();
      c.tag = tag;
      c.text = (opts && opts.text) || '';
      el.children.push(c);
      return c;
    },
    addClass() {},
    empty() { el.children = []; },
    focus() {},
  };
  return el;
}

function chainable(extra) {
  const obj = Object.assign({
    setPlaceholder() { return obj; },
    setValue() { return obj; },
    onChange() { return obj; },
    setButtonText() { return obj; },
    setCta() { return obj; },
    onClick() { return obj; },
    setLimits() { return obj; },
    setDynamicTooltip() { return obj; },
    inputEl: Object.assign(makeEl(), { addEventListener() {} }),
  }, extra || {});
  return obj;
}

function makeObsidianStub() {
  class Plugin {
    constructor(app, manifest) {
      this.app = app;
      this.manifest = manifest;
      this.commands = [];
    }
    addCommand(c) { this.commands.push(c); return c; }
    addRibbonIcon(icon, title, cb) { this.ribbon = { icon, title, cb }; return makeEl(); }
    addSettingTab(t) { this.settingTab = t; }
    async loadData() { return null; }
    async saveData(d) { this.savedData = d; }
  }
  class PluginSettingTab {
    constructor(app, plugin) {
      this.app = app;
      this.plugin = plugin;
      this.containerEl = makeEl();
    }
  }
  class Modal {
    constructor(app) {
      this.app = app;
      this.contentEl = makeEl();
    }
    open() { if (this.onOpen) this.onOpen(); }
    close() { if (this.onClose) this.onClose(); }
  }
  class Setting {
    constructor(el) { this.el = el; }
    setName() { return this; }
    setDesc() { return this; }
    addText(cb) { if (cb) cb(chainable()); return this; }
    addSlider(cb) { if (cb) cb(chainable()); return this; }
    addButton(cb) { if (cb) cb(chainable()); return this; }
  }
  class Notice {
    constructor(msg) { this.msg = msg; Notice.last = msg; }
  }
  class TFile {
    constructor(path) {
      this.path = path;
      this.basename = path.split('/').pop().replace(/\.md$/i, '');
    }
  }
  return { Plugin, PluginSettingTab, Modal, Setting, Notice, TFile };
}

function loadPlugin() {
  const stub = makeObsidianStub();
  const origLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === 'obsidian') return stub;
    return origLoad.call(this, request, parent, isMain);
  };
  try {
    const resolved = require.resolve('../main.js');
    delete require.cache[resolved];
    const mod = require(resolved);
    return mod;
  } finally {
    Module._load = origLoad;
  }
}

module.exports = { loadPlugin, makeObsidianStub };
