'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { loadPlugin } = require('./obsidian-stub.js');

test('plugin module loads and exports a Plugin class with engine attached', () => {
  const mod = loadPlugin();
  assert.strictEqual(typeof mod, 'function');
  assert.ok(mod.engine, 'engine API exposed for tests');
  assert.strictEqual(typeof mod.engine.analyze, 'function');
});

test('onload registers ribbon, all commands, and settings tab without a real vault', async () => {
  const VaultAgentPlugin = loadPlugin();
  const app = { vault: {}, workspace: {} };
  const plugin = new VaultAgentPlugin(app, { id: 'vault-agent', name: 'Vault Agent (Local)' });
  await plugin.onload();
  assert.ok(plugin.ribbon, 'ribbon icon registered');
  assert.strictEqual(plugin.ribbon.icon, 'brain');
  const ids = plugin.commands.map(c => c.id);
  const expected = [
    'vault-agent-full-scan',
    'vault-agent-suggest-links',
    'vault-agent-ideas',
    'vault-agent-organization',
    'vault-agent-ask',
    'vault-agent-apply-checked',
    'vault-agent-open-dashboard',
  ];
  for (const id of expected) assert.ok(ids.includes(id), 'missing command ' + id);
  assert.ok(plugin.settingTab, 'settings tab registered');
  assert.ok(plugin.settings.reportFolder.length > 0);
  for (const c of plugin.commands) assert.strictEqual(typeof c.callback, 'function');
});

test('settings defaults are sane and engineOpts parses them', async () => {
  const VaultAgentPlugin = loadPlugin();
  const plugin = new VaultAgentPlugin({ vault: {}, workspace: {} }, { id: 'vault-agent' });
  await plugin.onload();
  const o = plugin.engineOpts();
  assert.ok(o.linkThreshold > 0 && o.linkThreshold < 1);
  assert.ok(o.clusterThreshold > 0 && o.clusterThreshold < 1);
  assert.ok(o.duplicateThreshold > 0.5);
  assert.ok(o.minWords >= 1);
});

test('generated file names are legal on all platforms (no \\ / : * ? " < > |)', async () => {
  const VaultAgentPlugin = loadPlugin();
  const plugin = new VaultAgentPlugin({ vault: {}, workspace: {} }, { id: 'vault-agent' });
  await plugin.onload();
  const illegal = /[\\/:*?"<>|]/;
  assert.ok(!illegal.test(plugin.stamp()), 'stamp must be filename-safe, got: ' + plugin.stamp());
  assert.ok(!illegal.test(plugin.sanitizeFileName('a/b:c*d?e"f<g>h|i')));
  assert.strictEqual(plugin.sanitizePath('Answers/weird:name?.md'), 'Answers/weird-name-.md');
  const fullPath = plugin.sanitizePath('Agent Reports/Scan ' + plugin.stamp() + '.md');
  for (const seg of fullPath.split('/')) assert.ok(!illegal.test(seg), 'illegal char in segment: ' + seg);
});

test('isExcluded skips the report folder and configured folders', async () => {
  const VaultAgentPlugin = loadPlugin();
  const plugin = new VaultAgentPlugin({ vault: {}, workspace: {} }, { id: 'vault-agent' });
  await plugin.onload();
  assert.ok(plugin.isExcluded('Agent Reports/Dashboard.md'));
  assert.ok(plugin.isExcluded('attachments/img.png'));
  assert.ok(!plugin.isExcluded('Design/Design System.md'));
});
