'use strict';

const STOPWORDS = new Set(("a about above after again against all am an and any are aren't as at be because been before being below between both but by can can't cannot could couldn't did didn't do does doesn't doing don't down during each few for from further had hadn't has hasn't have haven't having he he'd he'll he's her here here's hers herself him himself his how how's i i'd i'll i'm i've if in into is isn't it it's its itself let's me more most mustn't my myself no nor not of off on once only or other ought our ours ourselves out over own same shan't she she'd she'll she's should shouldn't so some such than that that's the their theirs them themselves then there there's these they they'd they'll they're they've this those through to too under until up very was wasn't we we'd we'll we're we've were weren't what what's when when's where where's which while who who's whom why why's will with won't would wouldn't you you'd you'll you're you've your yours yourself yourselves also just like get got make made one two new use used using uses way ways thing things something anything many much even still back need needs want wants know knows knew think thinks thought say says said go goes going take takes took see sees really well now may might shall must always never ever every often sometimes us way per via").split(" "));

const STRONG_MARKER_SOURCE = "\\b(ideas?|what if|maybe|perhaps|todo|fixme|brainstorm\\w*|concepts?|hypothes\\w+|someday|promising|rough idea|possib\\w+)\\b";
const WEAK_MARKER_SOURCE = "\\b(designs?|thoughts?|could|might|alternatives?|options?)\\b";
const IDEA_MARKER_RE = new RegExp(STRONG_MARKER_SOURCE + "|" + WEAK_MARKER_SOURCE, "i");

function tokenize(text) {
  const out = [];
  const lower = text.toLowerCase();
  const re = /[a-z0-9]+(?:['-][a-z0-9]+)*/g;
  let m;
  while ((m = re.exec(lower))) {
    const w = m[0];
    if (w.length < 3 || /^\d+$/.test(w)) continue;
    if (STOPWORDS.has(w)) continue;
    out.push(w);
  }
  return out;
}

function parseFrontmatter(raw) {
  const m = raw.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!m) return { fields: {}, body: raw };
  const yaml = m[1];
  const body = raw.slice(m[0].length);
  const fields = {};
  let currentKey = null;
  for (const line of yaml.split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (kv) {
      currentKey = kv[1].toLowerCase();
      fields[currentKey] = kv[2].trim();
    } else {
      const li = line.match(/^\s*-\s*(.+)$/);
      if (li && currentKey) {
        fields[currentKey] = (fields[currentKey] ? fields[currentKey] + ", " : "") + li[1].trim();
      }
    }
  }
  return { fields, body };
}

function tagsFromFields(fields) {
  const out = [];
  const raw = (fields.tags || fields.tag || "").trim();
  if (raw) {
    for (const part of raw.replace(/^\[|\]$/g, "").split(",")) {
      const p = part.trim().replace(/^#/, "");
      if (p) out.push(p);
    }
  }
  return out;
}

function parseNote(path, raw) {
  const name = path.split("/").pop().replace(/\.md$/i, "");
  const folder = path.includes("/") ? path.split("/").slice(0, -1).join("/") : "";
  const fm = parseFrontmatter(raw);
  const body = fm.body;

  const links = [];
  const embeds = [];
  const linkRe = /(!?)\[\[([^\]]+)\]\]/g;
  let m;
  while ((m = linkRe.exec(body))) {
    const target = m[2].split("|")[0].split("#")[0].trim();
    if (target) (m[1] ? embeds : links).push(target);
  }

  const headings = [];
  for (const line of body.split(/\r?\n/)) {
    const h = line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/);
    if (h) headings.push(h[1].trim());
  }

  const codeStripped = body
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`\n]*`/g, " ");

  const tags = new Set(tagsFromFields(fm.fields));
  for (const tm of codeStripped.matchAll(/(?:^|[\s>])#([A-Za-z0-9_/-]+)/g)) tags.add(tm[1]);

  const text = codeStripped
    .replace(/!?\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/!?\[\[([^\]|]+)\]\]/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/<[^>]+>/g, " ");

  const words = tokenize(text);
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map(s => s.replace(/\s+/g, " ").trim())
    .filter(s => s.length > 3);

  let title = (fm.fields.title || "").replace(/^["']|["']$/g, "").trim();
  if (!title && headings.length) title = headings[0];
  if (!title) title = name;

  return {
    path,
    name,
    folder,
    title,
    tags: [...tags],
    headings,
    links,
    embeds,
    words,
    wordCount: words.length,
    sentences,
    rawLines: codeStripped.split(/\r?\n/),
  };
}

function buildVault(notes) {
  const byPath = new Map(notes.map(n => [n.path, n]));
  const byBase = new Map();
  for (const n of notes) {
    const k = n.name.toLowerCase();
    if (!byBase.has(k)) byBase.set(k, n.path);
  }
  const N = notes.length;
  const df = new Map();
  for (const n of notes) for (const w of new Set(n.words)) df.set(w, (df.get(w) || 0) + 1);
  const idf = new Map();
  for (const [w, d] of df) idf.set(w, Math.log((N + 1) / (d + 1)) + 1);
  const vectors = new Map();
  for (const n of notes) {
    const tf = new Map();
    for (const w of n.words) tf.set(w, (tf.get(w) || 0) + 1);
    const v = new Map();
    let norm = 0;
    for (const [w, c] of tf) {
      const wt = c * (idf.get(w) || 1);
      v.set(w, wt);
      norm += wt * wt;
    }
    norm = Math.sqrt(norm) || 1;
    for (const [w, wt] of v) v.set(w, wt / norm);
    vectors.set(n.path, v);
  }
  const links = new Map();
  const backlinks = new Map();
  for (const n of notes) links.set(n.path, new Set());
  for (const n of notes) {
    for (const l of n.links) {
      const target = byBase.get(l.toLowerCase());
      if (target && target !== n.path) {
        links.get(n.path).add(target);
        if (!backlinks.has(target)) backlinks.set(target, new Set());
        backlinks.get(target).add(n.path);
      }
    }
  }
  return { notes, byPath, byBase, df, idf, vectors, links, backlinks, N };
}

function cosine(vault, a, b) {
  const va = vault.vectors.get(a);
  const vb = vault.vectors.get(b);
  if (!va || !vb) return 0;
  const small = va.size <= vb.size ? va : vb;
  const big = va.size <= vb.size ? vb : va;
  let dot = 0;
  for (const [k, w] of small) {
    const o = big.get(k);
    if (o) dot += w * o;
  }
  return dot;
}

function allPairs(vault, threshold) {
  const notes = vault.notes;
  const pairs = [];
  for (let i = 0; i < notes.length; i++) {
    for (let j = i + 1; j < notes.length; j++) {
      const s = cosine(vault, notes[i].path, notes[j].path);
      if (s >= threshold) pairs.push({ a: notes[i].path, b: notes[j].path, score: Math.round(s * 1000) / 1000 });
    }
  }
  pairs.sort((x, y) => y.score - x.score);
  return pairs;
}

function findClusters(vault, pairs, threshold) {
  const parent = new Map(vault.notes.map(n => [n.path, n.path]));
  const find = x => {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)));
      x = parent.get(x);
    }
    return x;
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const p of pairs) if (p.score >= threshold) union(p.a, p.b);
  const groups = new Map();
  for (const n of vault.notes) {
    const r = find(n.path);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(n.path);
  }
  const clusters = [];
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const termScore = new Map();
    for (const p of g) {
      for (const [w, wt] of vault.vectors.get(p)) termScore.set(w, (termScore.get(w) || 0) + wt);
    }
    const terms = [...termScore.entries()].sort((x, y) => y[1] - x[1]).slice(0, 5).map(e => e[0]);
    clusters.push({ notes: g, size: g.length, terms });
  }
  clusters.sort((a, b) => b.size - a.size);
  return clusters;
}

function findIdeas(notes, maxPerNote, maxTotal) {
  const per = maxPerNote || 6;
  const total = maxTotal || 60;
  const ideas = [];
  const strongRe = new RegExp(STRONG_MARKER_SOURCE, "gi");
  const weakRe = new RegExp(WEAK_MARKER_SOURCE, "gi");
  for (const n of notes) {
    let count = 0;
    for (const line of n.rawLines) {
      const clean = line.replace(/^[>\s]*[-*]?\s*(\[[ xX]\]\s*)?/, "").replace(/^[>\s]+/, "").trim();
      if (clean.length < 8) continue;
      const strong = (clean.match(strongRe) || []).length;
      const weakTerms = new Set((clean.match(weakRe) || []).map(w => w.toLowerCase()));
      if ((strong > 0 || weakTerms.size >= 2) && count < per) {
        ideas.push({ path: n.path, title: n.title, line: clean.slice(0, 240), markers: strong + weakTerms.size, strong });
        count++;
      }
    }
  }
  ideas.sort((a, b) => b.strong - a.strong || b.markers - a.markers || a.path.localeCompare(b.path));
  return ideas.slice(0, total);
}

function queryVector(vault, query) {
  const words = tokenize(query);
  const tf = new Map();
  for (const w of words) tf.set(w, (tf.get(w) || 0) + 1);
  const v = new Map();
  let norm = 0;
  for (const [w, c] of tf) {
    const idf = vault.idf.get(w) || Math.log(vault.N + 1) + 1;
    const wt = c * idf;
    v.set(w, wt);
    norm += wt * wt;
  }
  norm = Math.sqrt(norm) || 1;
  for (const [w, wt] of v) v.set(w, wt / norm);
  return { v, terms: new Set(words) };
}

function bestSnippet(note, terms) {
  let best = null;
  let bestScore = 0;
  for (const s of note.sentences) {
    const lower = s.toLowerCase();
    let score = 0;
    for (const t of terms) if (lower.includes(t)) score++;
    if (score > bestScore) {
      bestScore = score;
      best = s;
    }
  }
  if (!best && note.sentences.length) best = note.sentences[0];
  if (!best) return "";
  return best.length > 220 ? best.slice(0, 217) + "..." : best;
}

function search(vault, query, k) {
  const { v, terms } = queryVector(vault, query);
  const limit = k || 10;
  const res = [];
  for (const n of vault.notes) {
    const dv = vault.vectors.get(n.path);
    let dot = 0;
    for (const [w, wt] of v) {
      const o = dv.get(w);
      if (o) dot += wt * o;
    }
    if (dot > 0.005) res.push({ path: n.path, title: n.title, score: Math.round(dot * 1000) / 1000, snippet: bestSnippet(n, terms) });
  }
  res.sort((a, b) => b.score - a.score);
  return res.slice(0, limit);
}

function analyze(files, opts) {
  const o = Object.assign(
    { linkThreshold: 0.15, clusterThreshold: 0.15, duplicateThreshold: 0.85, minWords: 40, maxSuggestions: 30 },
    opts || {}
  );
  const notes = files.map(f => parseNote(f.path, f.content));
  const vault = buildVault(notes);
  const pairs = allPairs(vault, Math.min(o.linkThreshold, o.clusterThreshold, 0.1));
  const clusters = findClusters(vault, pairs, o.clusterThreshold);

  const isLinked = (a, b) =>
    (vault.links.get(a) && vault.links.get(a).has(b)) || (vault.links.get(b) && vault.links.get(b).has(a));

  const suggestions = pairs
    .filter(p =>
      p.score >= o.linkThreshold &&
      p.score < o.duplicateThreshold &&
      !isLinked(p.a, p.b) &&
      vault.byPath.get(p.a).wordCount >= o.minWords &&
      vault.byPath.get(p.b).wordCount >= o.minWords
    )
    .slice(0, o.maxSuggestions);

  const duplicates = pairs.filter(p => p.score >= o.duplicateThreshold);

  const orphans = notes
    .filter(n => !(vault.links.get(n.path) && vault.links.get(n.path).size) && !(vault.backlinks.get(n.path) && vault.backlinks.get(n.path).size))
    .map(n => n.path);

  const broken = [];
  for (const n of notes) {
    for (const l of n.links) {
      if (!vault.byBase.has(l.toLowerCase())) broken.push({ from: n.path, target: l });
    }
  }

  const stubs = notes.filter(n => n.wordCount < o.minWords).map(n => ({ path: n.path, words: n.wordCount }));

  const tagCount = new Map();
  const tagVariants = new Map();
  for (const n of notes) {
    for (const t of n.tags) {
      const k = t.toLowerCase();
      tagCount.set(k, (tagCount.get(k) || 0) + 1);
      if (!tagVariants.has(k)) tagVariants.set(k, new Set());
      tagVariants.get(k).add(t);
    }
  }
  const tagIssues = [...tagVariants.entries()]
    .filter(([, s]) => s.size > 1)
    .map(([k, s]) => ({ tag: k, variants: [...s].sort() }));
  const unusedTags = [...tagCount.entries()].filter(([, c]) => c === 1).map(([t]) => t).sort();

  const folders = new Map();
  for (const n of notes) {
    const f = n.folder || "(root)";
    folders.set(f, (folders.get(f) || 0) + 1);
  }

  const ideas = findIdeas(notes);

  const hubs = notes
    .map(n => ({
      path: n.path,
      title: n.title,
      backlinks: (vault.backlinks.get(n.path) && vault.backlinks.get(n.path).size) || 0,
      outlinks: (vault.links.get(n.path) && vault.links.get(n.path).size) || 0,
    }))
    .sort((a, b) => b.backlinks - a.backlinks || b.outlinks - a.outlinks)
    .slice(0, 10);

  const moves = [];
  for (const c of clusters) {
    if (c.size < 3) continue;
    const folderCount = new Map();
    for (const p of c.notes) {
      const f = vault.byPath.get(p).folder || "(root)";
      folderCount.set(f, (folderCount.get(f) || 0) + 1);
    }
    const sorted = [...folderCount.entries()].sort((a, b) => b[1] - a[1]);
    const domFolder = sorted[0][0];
    const domCount = sorted[0][1];
    if (domCount < 2) continue;
    for (const p of c.notes) {
      const n = vault.byPath.get(p);
      if (/moc/i.test(n.name)) continue;
      const f = n.folder || "(root)";
      if (f !== domFolder) moves.push({ path: p, from: f, to: domFolder, cluster: c.terms.slice(0, 3).join(", ") });
    }
  }

  const linkCount = notes.reduce((acc, n) => acc + n.links.length, 0);

  const analysis = {
    opts: o,
    vault,
    notes,
    pairs,
    clusters,
    suggestions,
    duplicates,
    orphans,
    broken,
    stubs,
    tagCount,
    tagIssues,
    unusedTags,
    folders,
    ideas,
    hubs,
    moves,
    linkCount,
  };
  analysis.search = (q, k) => search(vault, q, k);
  analysis.answer = (q, k) => {
    const results = search(vault, q, k || 6);
    return { query: q, results, markdown: renderAnswer(q, results) };
  };
  return analysis;
}

function mdLink(analysis, path) {
  const n = analysis.vault.byPath.get(path);
  return "[[" + (n ? n.name : path) + "]]";
}

function renderHealth(a, now) {
  const L = [];
  L.push("# Vault health report" + (now ? " — " + now : ""));
  L.push("");
  L.push("- Notes scanned: **" + a.notes.length + "**");
  L.push("- Wiki links: **" + a.linkCount + "** (broken: **" + a.broken.length + "**)");
  L.push("- Tags in use: **" + a.tagCount.size + "**");
  L.push("- Orphans: **" + a.orphans.length + "** · Stubs: **" + a.stubs.length + "** · Near-duplicates: **" + a.duplicates.length + "**");
  L.push("");
  L.push("## Orphans (no links in or out)");
  L.push("");
  if (!a.orphans.length) L.push("None — every note is connected.");
  for (const p of a.orphans) L.push("- " + mdLink(a, p) + " — `" + p + "`");
  L.push("");
  L.push("## Broken links");
  L.push("");
  if (!a.broken.length) L.push("None.");
  for (const b of a.broken) L.push("- `[[" + b.target + "]]` linked from " + mdLink(a, b.from));
  L.push("");
  L.push("## Stub notes (under " + a.opts.minWords + " words)");
  L.push("");
  if (!a.stubs.length) L.push("None.");
  for (const s of a.stubs) L.push("- " + mdLink(a, s.path) + " (" + s.words + " words)");
  L.push("");
  L.push("## Near-duplicates");
  L.push("");
  if (!a.duplicates.length) L.push("None.");
  for (const d of a.duplicates) L.push("- " + mdLink(a, d.a) + " ↔ " + mdLink(a, d.b) + " — similarity " + d.score.toFixed(2));
  L.push("");
  L.push("## Tag hygiene");
  L.push("");
  if (a.tagIssues.length) {
    L.push("Case variants to merge:");
    for (const t of a.tagIssues) L.push("- `#" + t.variants.join("`, `#") + "`");
  } else {
    L.push("No case-variant tags.");
  }
  if (a.unusedTags.length) L.push("Tags used only once (review): " + a.unusedTags.map(t => "`#" + t + "`").join(", "));
  L.push("");
  L.push("## Folders");
  L.push("");
  L.push("| Folder | Notes |");
  L.push("| --- | --- |");
  for (const [f, c] of [...a.folders.entries()].sort((x, y) => y[1] - x[1])) L.push("| " + f + " | " + c + " |");
  L.push("");
  return L.join("\n");
}

function renderOrg(a, now) {
  const L = [];
  L.push("# Organization suggestions" + (now ? " — " + now : ""));
  L.push("");
  L.push("## Suggested new links");
  L.push("");
  L.push("Check the boxes, then run the command **Vault Agent: Apply checked suggestions** while this note is open.");
  L.push("");
  if (!a.suggestions.length) L.push("None — your link graph looks well connected at this threshold.");
  for (const s of a.suggestions) {
    L.push("- [ ] " + mdLink(a, s.a) + " ↔ " + mdLink(a, s.b) + " — similarity " + s.score.toFixed(2));
  }
  L.push("");
  L.push("## Suggested Maps of Content (MOCs)");
  L.push("");
  const big = a.clusters.filter(c => c.size >= 3);
  if (!big.length) L.push("No clusters of 3+ similar notes found.");
  for (const c of big) {
    L.push("### MOC: " + c.terms.join(" / "));
    L.push("");
    for (const p of c.notes) L.push("- " + mdLink(a, p));
    L.push("");
  }
  L.push("## Suggested folder moves");
  L.push("");
  if (!a.moves.length) L.push("None.");
  for (const m of a.moves) L.push("- `" + m.path + "` → `" + m.to + "/` (cluster: " + m.cluster + ")");
  L.push("");
  L.push("## Tag consolidation");
  L.push("");
  if (!a.tagIssues.length && !a.unusedTags.length) L.push("Nothing to clean up.");
  for (const t of a.tagIssues) L.push("- Merge `#" + t.variants.join("` into `#") + "`");
  if (a.unusedTags.length) L.push("- Review single-use tags: " + a.unusedTags.map(t => "`#" + t + "`").join(", "));
  L.push("");
  return L.join("\n");
}

function renderIdeas(a, now) {
  const L = [];
  L.push("# Ideas & themes" + (now ? " — " + now : ""));
  L.push("");
  L.push("## Themes across your vault");
  L.push("");
  if (!a.clusters.length) L.push("No multi-note themes detected yet.");
  for (const c of a.clusters) {
    L.push("### " + c.terms.join(" / ") + " (" + c.size + " notes)");
    L.push("");
    for (const p of c.notes) L.push("- " + mdLink(a, p));
    L.push("");
  }
  L.push("## Captured idea lines");
  L.push("");
  if (!a.ideas.length) L.push("No idea markers found. Try words like *idea*, *what if*, *maybe*, *design*, *TODO* in your notes.");
  for (const i of a.ideas) {
    L.push("- " + mdLink(a, i.path) + ": \"" + i.line.replace(/"/g, "'") + "\"");
  }
  L.push("");
  return L.join("\n");
}

function renderAnswer(query, results) {
  const L = [];
  L.push("# Answer: " + query);
  L.push("");
  L.push("_Local extractive answer — computed entirely on your device from your notes. No AI API was called._");
  L.push("");
  if (!results.length) {
    L.push("No notes matched. Try different keywords.");
    return L.join("\n");
  }
  for (const r of results.slice(0, 5)) {
    const snippet = (r.snippet || "").replace(/>/g, "").replace(/\s+/g, " ").trim();
    L.push("> " + (snippet || "(no snippet)") + " — [[" + r.title + "]]");
    L.push("");
  }
  L.push("## Sources");
  L.push("");
  for (const r of results) L.push("- [[" + r.title + "]] — relevance " + r.score.toFixed(3) + " — `" + r.path + "`");
  L.push("");
  return L.join("\n");
}

function renderDashboard(a, meta) {
  const now = (meta && meta.now) || "";
  const reports = (meta && meta.reports) || {};
  const L = [];
  L.push("# Vault Agent dashboard" + (now ? " — " + now : ""));
  L.push("");
  L.push("Scanned **" + a.notes.length + "** notes · **" + a.linkCount + "** links · **" + a.tagCount.size + "** tags · **" + a.clusters.length + "** themes");
  L.push("");
  L.push("## Latest reports");
  L.push("");
  if (reports.health) L.push("- [[" + reports.health.replace(/\.md$/, "") + "]]");
  if (reports.org) L.push("- [[" + reports.org.replace(/\.md$/, "") + "]]");
  if (reports.ideas) L.push("- [[" + reports.ideas.replace(/\.md$/, "") + "]]");
  L.push("");
  L.push("## Top hubs (most backlinks)");
  L.push("");
  for (const h of a.hubs.slice(0, 8)) {
    if (h.backlinks === 0 && h.outlinks === 0) break;
    L.push("- " + mdLink(a, h.path) + " — " + h.backlinks + " in / " + h.outlinks + " out");
  }
  L.push("");
  L.push("## Quick stats");
  L.push("");
  L.push("- Orphans: " + a.orphans.length + " · Broken links: " + a.broken.length + " · Stubs: " + a.stubs.length + " · Near-duplicates: " + a.duplicates.length);
  L.push("- Suggested links waiting: " + a.suggestions.length);
  L.push("- Idea lines captured: " + a.ideas.length);
  L.push("");
  L.push("## Commands");
  L.push("");
  L.push("- **Vault Agent: Full scan** — rebuild all reports");
  L.push("- **Vault Agent: Suggest links** — refresh the suggestions note");
  L.push("- **Vault Agent: Ideas & themes** — refresh design ideas and themes");
  L.push("- **Vault Agent: Organization** — MOCs, moves, tag cleanup");
  L.push("- **Vault Agent: Ask the vault (local)** — keyword search + extractive answer, fully offline");
  L.push("- **Vault Agent: Apply checked suggestions** — tick checkboxes in the suggestions note, then run this");
  L.push("");
  L.push("_Privacy: this plugin performs zero network calls. All analysis runs inside Obsidian on your machine._");
  L.push("");
  return L.join("\n");
}

module.exports = {
  STOPWORDS,
  IDEA_MARKER_RE,
  STRONG_MARKER_SOURCE,
  WEAK_MARKER_SOURCE,
  tokenize,
  parseFrontmatter,
  parseNote,
  buildVault,
  cosine,
  allPairs,
  findClusters,
  findIdeas,
  search,
  analyze,
  renderHealth,
  renderOrg,
  renderIdeas,
  renderAnswer,
  renderDashboard,
};
