'use strict';

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

const files = walk(ROOT).map(p => ({ path: path.relative(ROOT, p), content: fs.readFileSync(p, 'utf8') }));
const a = engine.analyze(files, { minWords: 12 });
const now = new Date().toISOString().slice(0, 16).replace('T', ' ');

console.log(engine.renderDashboard(a, { now, reports: { health: 'Scan.md', org: 'Organization.md', ideas: 'Ideas & themes.md' } }));
console.log('\n========================================\n');
console.log(engine.renderOrg(a, now));
console.log('\n========================================\n');
console.log(engine.renderIdeas(a, now).split('\n').slice(0, 30).join('\n'));
console.log('\n========================================\n');
console.log(engine.renderHealth(a, now).split('\n').slice(0, 30).join('\n'));
console.log('\n========================================\n');
console.log(engine.renderAnswer('ideas for making onboarding fun', a.search('onboarding fun ideas engaging', 5)));
