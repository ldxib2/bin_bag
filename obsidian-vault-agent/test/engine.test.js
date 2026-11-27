'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const engine = require('../engine.js');

const ROOT = path.join(__dirname, 'fixture-vault');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.md')) out.push(p);
  }
  return out;
}

function loadFixture() {
  return walk(ROOT).map(p => ({ path: path.relative(ROOT, p), content: fs.readFileSync(p, 'utf8') }));
}

const files = loadFixture();
const analysis = engine.analyze(files, { minWords: 12 });

test('parses frontmatter, links, tags, headings', () => {
  const n = engine.parseNote('Design/Design System.md', files.find(f => f.path === 'Design/Design System.md').content);
  assert.strictEqual(n.title, 'Design System');
  assert.deepStrictEqual(n.tags.sort(), ['design', 'system']);
  assert.ok(n.links.includes('Color Palette'));
  assert.ok(n.links.includes('Typography'));
  assert.ok(n.headings.includes('Principles'));
  assert.ok(n.wordCount > 20);
});

test('does not treat headings or link anchors as tags', () => {
  const n = engine.parseNote('x.md', '# Big Heading\n\nSee [[Note#Section]] here.\n\n#real-tag\n');
  assert.deepStrictEqual(n.tags, ['real-tag']);
  assert.deepStrictEqual(n.links, ['Note']);
});

test('strips code blocks from keywords', () => {
  const n = engine.parseNote('x.md', '```\nsecretkeyword123\n```\nhello world foo\n');
  assert.ok(!n.words.includes('secretkeyword123'));
});

test('detects orphans', () => {
  assert.ok(analysis.orphans.includes('Random/Shopping.md'));
  assert.ok(analysis.orphans.includes('Random/Loose thought.md'));
  assert.ok(analysis.orphans.includes('Notes/Meeting notes.md'));
  assert.ok(!analysis.orphans.includes('Design/Design System.md'));
  assert.ok(!analysis.orphans.includes('Design/Typography.md'), 'Typography is backlinked from the Design MOC');
});

test('detects broken links', () => {
  assert.deepStrictEqual(analysis.broken, [{ from: 'References/Sources.md', target: 'Nonexistent Note' }]);
});

test('detects near-duplicates', () => {
  assert.strictEqual(analysis.duplicates.length, 1);
  assert.ok(analysis.duplicates[0].score >= 0.85);
  assert.ok(analysis.duplicates[0].a.includes('draft'));
});

test('clusters notes into themes', () => {
  const design = analysis.clusters.find(c => c.terms.includes('design'));
  assert.ok(design, 'expected a design cluster');
  assert.ok(design.notes.includes('Design/Design System.md'));
  assert.ok(design.notes.includes('Design/Color Palette.md'));
  assert.ok(design.notes.includes('Design/Typography.md'));
  const ideas = analysis.clusters.find(c => c.terms.includes('gamification') || c.terms.includes('onboarding'));
  assert.ok(ideas, 'expected an ideas cluster');
  assert.ok(ideas.notes.includes('Ideas/Onboarding Ideas.md'));
  assert.ok(ideas.notes.includes('Ideas/Gamification Ideas.md'));
});

test('suggests links for unlinked similar notes, excluding duplicates', () => {
  const s = analysis.suggestions;
  assert.ok(s.length >= 2);
  assert.ok(s.every(p => p.score < analysis.opts.duplicateThreshold));
  const typo = s.find(p => p.a.includes('Typography') || p.b.includes('Typography'));
  assert.ok(typo, 'expected a suggestion linking the orphan Typography note');
});

test('detects tag case variants', () => {
  assert.deepStrictEqual(analysis.tagIssues, [{ tag: 'design', variants: ['Design', 'design'] }]);
});

test('search ranks the right note first', () => {
  const res = analysis.search('onboarding flow ideas', 3);
  assert.strictEqual(res[0].path, 'Ideas/Onboarding Ideas.md');
  assert.ok(res[0].score > 0);
  assert.ok(res[0].snippet.length > 0);
});

test('answer produces markdown with sources and no empty result', () => {
  const res = analysis.answer('streaks badges gamification', 5);
  assert.ok(res.results.length > 0);
  assert.ok(res.results[0].path.includes('Gamification'));
  assert.ok(res.markdown.includes('## Sources'));
  assert.ok(res.markdown.includes('[['));
});

test('idea extraction finds strong markers, ignores weak design mentions', () => {
  const paths = analysis.ideas.map(i => i.path);
  assert.ok(paths.includes('Ideas/Onboarding Ideas.md'));
  assert.ok(paths.includes('Random/Loose thought.md'));
  const componentLine = analysis.ideas.find(i => i.path === 'Design/Component Library.md' && i.line.includes('design tokens'));
  assert.ok(!componentLine, 'weak "design tokens" mention should not count as an idea');
  const strong = analysis.ideas.filter(i => i.strong > 0);
  assert.ok(strong.length >= 5);
});

test('folder moves skip MOC notes', () => {
  assert.ok(!analysis.moves.some(m => /MOC/i.test(m.path)));
  assert.ok(analysis.moves.some(m => m.path === 'Notes/Design critique.md' && m.to === 'Design'));
});

test('renderers produce markdown reports', () => {
  const health = engine.renderHealth(analysis, '2026-01-01');
  assert.ok(health.includes('# Vault health report'));
  assert.ok(health.includes('Shopping'));
  assert.ok(health.includes('Nonexistent Note'));
  const org = engine.renderOrg(analysis, '2026-01-01');
  assert.ok(org.includes('- [ ] [['));
  assert.ok(org.includes('MOC:'));
  const ideas = engine.renderIdeas(analysis, '2026-01-01');
  assert.ok(ideas.includes('# Ideas & themes'));
  assert.ok(ideas.includes('Gamification'));
  const dash = engine.renderDashboard(analysis, { now: '2026-01-01', reports: { health: 'H.md', org: 'O.md', ideas: 'I.md' } });
  assert.ok(dash.includes('Scanned **15** notes'));
  assert.ok(dash.includes('zero network calls'));
});

test('privacy: engine and plugin source contain no network calls or API endpoints', () => {
  for (const f of ['engine.js', 'main.js']) {
    const src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    assert.ok(!/\bfetch\s*\(/.test(src), f + ' must not call fetch');
    assert.ok(!/XMLHttpRequest|WebSocket|EventSource/.test(src), f + ' must not open sockets');
    assert.ok(!/require\s*\(\s*['"](https?|net|tls|node-fetch|axios|got)['"]\s*\)/.test(src), f + ' must not require network modules');
    assert.ok(!/https?:\/\//.test(src), f + ' must not contain URLs');
    assert.ok(!/mistral|anthropic|openai/i.test(src), f + ' must not reference AI APIs');
  }
});
