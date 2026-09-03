/* =========================================================================
   FAMILY TREE — configure before deploying
   ========================================================================= */

// 1. Deploy apps-script/Code.gs as a Web App (see README) and paste the
//    /exec URL here. This is both where the site reads data FROM and
//    where the inline form POSTs new entries TO.
var APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxTtxgCaAkLskkjY9_J7j3L62TYOPqgRhhHNMgM_NMfbTvRbGe6BqJAhqG8EzDmNVpw/exec";

// 2. The four starting members — the fixed chain everyone else attaches to.
//    Fill NAME (leave blank to hide the name and show only the role) and an
//    optional photo URL.
var SEED_MEMBERS = [
  { id: "S1", name: "SHIVANAND TRIPATHI",       role: "Great-Grandfather", img: "" },
  { id: "S2", name: "SHRAWAN KUMAR TRIPATHI",   role: "Grandfather",       img: "" },
  { id: "S3", name: "RANGESHWAR NATH TRIPATHI", role: "Father",            img: "" },
  { id: "S4", name: "ISHAN TRIPATHI",           role: "You",               img: "" }
];
// Relation chain between the seed members above (edit if your chain differs):
var SEED_RELS = [
  { fr: "S1", to: "S2", t: "parent" },
  { fr: "S2", to: "S3", t: "parent" },
  { fr: "S3", to: "S4", t: "parent" }
];

/* ========================================================================= */

var DEFAULT_AVT = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='72' height='72' viewBox='0 0 72 72'%3E%3Crect width='72' height='72' fill='%23241808'/%3E%3Ccircle cx='36' cy='28' r='14' fill='%235a3a10'/%3E%3Cellipse cx='36' cy='62' rx='22' ry='16' fill='%235a3a10'/%3E%3C/svg%3E";

var S = { members: {}, rels: [], pending: [] };

function toast(msg, type) {
  var w = document.getElementById("toastWrap");
  var el = document.createElement("div");
  el.className = "toast " + (type || "");
  el.textContent = msg;
  w.appendChild(el);
  setTimeout(function () { el.remove(); }, 3200);
}

function showNotice(msg, isWarn) {
  var n = document.getElementById("noticeBanner");
  n.textContent = msg;
  n.className = "notice" + (isWarn ? " warn" : "");
  n.hidden = false;
}

// Apps Script sheet rows arrive already keyed by our fixed headers
// (Timestamp, Name, RelationshipType, RelatedTo, DOB, Marriage, ImageLink, Bio)
// so no header-guessing needed here — just map field names.
function rowsToSubmissions(rows) {
  return rows.filter(function (r) { return r.Name; }).map(function (r) {
    return {
      name: String(r.Name || "").trim(),
      img: String(r.ImageLink || "").trim(),
      type: normType(r.RelationshipType),
      relTo: String(r.RelatedTo || "").trim(),
      dob: String(r.DOB || "").trim(),
      marriage: String(r.Marriage || "").trim(),
      bio: String(r.Bio || "").trim()
    };
  });
}

// Basic types map straight onto parent/child/spouse/sibling edges.
// Extended types are derived from the existing graph relative to "Related To" —
// if they can't be resolved unambiguously (e.g. "Related To" has 2+ siblings
// so which one is the Uncle unclear), the submission goes to Pending instead
// of guessing wrong.
var BASIC_TYPES = { parent: 1, child: 1, spouse: 1, sibling: 1 };
function normType(v) {
  v = (v || "").toLowerCase();
  if (v.indexOf("grandchild") !== -1) return "grandchild";
  if (v.indexOf("grandparent") !== -1) return "grandparent";
  if (v.indexOf("nephew") !== -1) return "nephew";
  if (v.indexOf("niece") !== -1) return "niece";
  if (v.indexOf("uncle") !== -1) return "uncle";
  if (v.indexOf("aunt") !== -1) return "aunt";
  if (v.indexOf("cousin") !== -1) return "cousin";
  if (v.indexOf("in-law") !== -1 || v.indexOf("inlaw") !== -1) return "inlaw";
  if (v.indexOf("spouse") !== -1) return "spouse";
  if (v.indexOf("sibling") !== -1) return "sibling";
  if (v.indexOf("parent") !== -1) return "parent";   // "Parent of X" -> submitter is parent
  if (v.indexOf("child") !== -1) return "child";     // "Child of X"  -> submitter is child
  return "child";
}

function parentsOfInGraph(id) {
  var out = [];
  S.rels.forEach(function (r) { if (r.t === "parent" && r.to === id) out.push(r.fr); });
  return out;
}
function childrenOfInGraph(id) {
  var out = [];
  S.rels.forEach(function (r) { if (r.t === "parent" && r.fr === id) out.push(r.to); });
  return out;
}
function siblingsOfInGraph(id) {
  var out = [];
  S.rels.forEach(function (r) {
    if (r.t === "sibling") { if (r.fr === id) out.push(r.to); if (r.to === id) out.push(r.fr); }
  });
  return out;
}
// "Sibling" in the fullest sense: explicit sibling-type edges PLUS anyone
// who shares a recorded parent with id. Two different submissions can end
// up expressing the same siblinghood two different ways (a floating
// "Sibling of" claim vs. both people separately being "Child of" the same
// parent) — this merges both views so downstream relation-resolving
// (uncle/aunt/nephew/niece/cousin) sees the complete picture either way.
function trueSiblingsOf(id) {
  var set = {};
  siblingsOfInGraph(id).forEach(function (s) { set[s] = true; });
  parentsOfInGraph(id).forEach(function (p) {
    childrenOfInGraph(p).forEach(function (c) { if (c !== id) set[c] = true; });
  });
  return Object.keys(set);
}

// Resolve an extended relation type to either:
//  - { anchors: [ids], t: "parent" }       submitter becomes CHILD of every anchor
//  - { anchor: id, t: "parent_of_anchor" }  submitter becomes PARENT of anchor
//  - { anchor: id, t: "sibling" }           floating fallback (no known parent to anchor to yet)
// or null if it can't be resolved unambiguously.
function resolveExtended(type, relToId) {
  if (type === "grandchild") { // child of a child of relToId
    var ch = childrenOfInGraph(relToId);
    if (ch.length === 1) return { anchors: [ch[0]], t: "parent" };
    return null;
  }
  if (type === "grandparent") { // parent of a parent of relToId
    var pa = parentsOfInGraph(relToId);
    if (pa.length === 1) return { anchor: pa[0], t: "parent_of_anchor" };
    return null;
  }
  if (type === "uncle" || type === "aunt") { // sibling of a parent of relToId
    var p1 = parentsOfInGraph(relToId);
    if (p1.length !== 1) return null;
    var gp = parentsOfInGraph(p1[0]); // relToId's grandparent(s), if known
    if (gp.length) return { anchors: gp, t: "parent" }; // real blood anchor: child of the grandparent(s)
    return { anchor: p1[0], t: "sibling" }; // grandparent not in tree yet — floating fallback
  }
  if (type === "nephew" || type === "niece") { // child of a sibling of relToId
    var sib = trueSiblingsOf(relToId);
    if (sib.length === 1) return { anchors: [sib[0]], t: "parent" };
    return null;
  }
  if (type === "cousin") { // child of an aunt/uncle: sibling of relToId's parent
    var p2 = parentsOfInGraph(relToId);
    if (p2.length === 1) {
      var auntsUncles = trueSiblingsOf(p2[0]);
      if (auntsUncles.length === 1) return { anchors: [auntsUncles[0]], t: "parent" };
    }
    return null;
  }
  return null; // in-law: always ambiguous, always pending
}

function findMemberByName(name) {
  var q = name.trim().toLowerCase();
  var ids = Object.keys(S.members);
  for (var i = 0; i < ids.length; i++) {
    if (S.members[ids[i]].name.trim().toLowerCase() === q) return ids[i];
  }
  return null;
}

/* ---------- Build tree from seed + form submissions ---------- */
function buildData(submissions) {
  S.members = {}; S.rels = []; S.pending = [];
  var n = 0;

  SEED_MEMBERS.forEach(function (m) {
    S.members[m.id] = { name: m.name || m.role, role: m.role, img: m.img, seed: true };
  });
  SEED_RELS.forEach(function (r) { S.rels.push(r); });

  submissions.forEach(function (sub) {
    if (sub.name.trim().toLowerCase() === sub.relTo.trim().toLowerCase()) {
      sub.reason = "can't be related to yourself — check the Related To name";
      S.pending.push(sub); return;
    }
    var relToId = findMemberByName(sub.relTo);
    if (!relToId) { sub.reason = 'name "' + sub.relTo + '" not found'; S.pending.push(sub); return; }

    var edge = null, multiAnchors = null;
    if (BASIC_TYPES[sub.type]) {
      if (sub.type === "parent") edge = { fr: null, to: relToId, t: "parent" };       // submitter is parent
      else if (sub.type === "child") edge = { fr: relToId, to: null, t: "parent" };   // submitter is child
      else if (sub.type === "spouse") edge = { fr: null, to: relToId, t: "spouse" };
      else if (sub.type === "sibling") {
        // Anchor to the SAME recorded parent(s) as relTo, so siblinghood is
        // an actual shared-parent link, not just a floating claim.
        var sibParents = parentsOfInGraph(relToId);
        if (sibParents.length) multiAnchors = sibParents;
        else edge = { fr: null, to: relToId, t: "sibling" }; // relTo has no recorded parent yet — floating fallback
      }
    } else {
      var res = resolveExtended(sub.type, relToId);
      if (!res) { sub.reason = sub.type + " relation could not be worked out yet (add the in-between family member first)"; S.pending.push(sub); return; }
      if (res.t === "parent") multiAnchors = res.anchors;                                   // submitter is child of every anchor
      else if (res.t === "parent_of_anchor") edge = { fr: null, to: res.anchor, t: "parent" }; // submitter is parent of anchor
      else if (res.t === "sibling") edge = { fr: null, to: res.anchor, t: "sibling" };
    }
    if (!edge && !multiAnchors) { S.pending.push(sub); return; }

    n++;
    var id = "F" + n;
    S.members[id] = { name: sub.name, role: "", img: sub.img, dob: sub.dob, marriage: sub.marriage, bio: sub.bio, seed: false };
    if (multiAnchors) {
      multiAnchors.forEach(function (p) { S.rels.push({ fr: p, to: id, t: "parent" }); });
    } else {
      if (edge.fr === null) edge.fr = id; else edge.to = id;
      S.rels.push(edge);
    }
  });
}

/* ---------- Generation layout ---------- */
function calcGens() {
  var ids = Object.keys(S.members);
  var parentOf = {}, childOf = {}, spouseOf = {}, siblingOf = {};
  S.rels.forEach(function (r) {
    if (r.t === "parent") {
      (parentOf[r.fr] = parentOf[r.fr] || []).push(r.to);
      (childOf[r.to] = childOf[r.to] || []).push(r.fr);
    }
    if (r.t === "spouse") { spouseOf[r.fr] = r.to; spouseOf[r.to] = r.fr; }
    if (r.t === "sibling") {
      (siblingOf[r.fr] = siblingOf[r.fr] || []).push(r.to);
      (siblingOf[r.to] = siblingOf[r.to] || []).push(r.fr);
    }
  });
  // A "root" is someone with no recorded parent, AND whose entire
  // spouse/sibling "peer group" also has no recorded parent anywhere in
  // it. Anyone connected (directly or through a chain of spouses/siblings)
  // to someone who DOES have a recorded parent is deferred — they inherit
  // their generation from that peer during the walk below instead of
  // getting wrongly pinned to generation 0.
  var peers = {};
  function addPeer(a, b) { (peers[a] = peers[a] || []).push(b); (peers[b] = peers[b] || []).push(a); }
  Object.keys(spouseOf).forEach(function (id) { addPeer(id, spouseOf[id]); });
  Object.keys(siblingOf).forEach(function (id) { siblingOf[id].forEach(function (o) { addPeer(id, o); }); });

  var compVisited = {}, componentHasParent = {};
  ids.forEach(function (id) {
    if (compVisited[id]) return;
    var stack = [id], comp = [];
    compVisited[id] = true;
    while (stack.length) {
      var cur = stack.pop(); comp.push(cur);
      (peers[cur] || []).forEach(function (p) { if (!compVisited[p]) { compVisited[p] = true; stack.push(p); } });
    }
    var hasParent = comp.some(function (c) { return childOf[c] && childOf[c].length; });
    comp.forEach(function (c) { componentHasParent[c] = hasParent; });
  });

  var roots = ids.filter(function (id) {
    if (childOf[id] && childOf[id].length) return false;
    return !componentHasParent[id];
  });
  if (!roots.length) roots = [ids[0]];

  var gens = {}, queue = [], visited = {};
  roots.forEach(function (r) { gens[r] = 0; queue.push(r); visited[r] = true; });

  var i = 0;
  while (i < queue.length) {
    var cur = queue[i++], g = gens[cur];
    var sp = spouseOf[cur];
    if (sp !== undefined && gens[sp] === undefined) { gens[sp] = g; if (!visited[sp]) { visited[sp] = true; queue.push(sp); } }
    (siblingOf[cur] || []).forEach(function (sib) {
      if (gens[sib] === undefined) { gens[sib] = g; if (!visited[sib]) { visited[sib] = true; queue.push(sib); } }
    });
    (parentOf[cur] || []).forEach(function (ch) {
      if (gens[ch] === undefined) { gens[ch] = g + 1; if (!visited[ch]) { visited[ch] = true; queue.push(ch); } }
    });
  }
  // Safety net: anyone still unassigned inherits a peer's (spouse or
  // sibling) generation, repeating until nothing more can be resolved.
  var changed = true;
  while (changed) {
    changed = false;
    ids.forEach(function (id) {
      if (gens[id] !== undefined) return;
      var sp = spouseOf[id];
      if (sp !== undefined && gens[sp] !== undefined) { gens[id] = gens[sp]; changed = true; return; }
      var sibs = siblingOf[id] || [];
      for (var k = 0; k < sibs.length; k++) {
        if (gens[sibs[k]] !== undefined) { gens[id] = gens[sibs[k]]; changed = true; return; }
      }
    });
  }
  ids.forEach(function (id) { if (gens[id] === undefined) gens[id] = 0; });
  return { gens: gens, spouseOf: spouseOf };
}

function spouseGroups(arr, spMap) {
  var res = [], placed = {};
  arr.forEach(function (id) {
    if (placed[id]) return; placed[id] = true;
    var gr = [id], sp = spMap[id];
    if (sp && arr.indexOf(sp) !== -1 && !placed[sp]) { placed[sp] = true; gr.push(sp); }
    res.push(gr);
  });
  return res;
}

/* ---------- Branching tree builder (real parent->child / spouse / sibling lines) ---------- */
function buildRelMaps() {
  var parentOf = {}, childOf = {}, spouseOf = {}, siblingOf = {};
  S.rels.forEach(function (r) {
    if (r.t === "parent") {
      (parentOf[r.fr] = parentOf[r.fr] || []).push(r.to);
      (childOf[r.to] = childOf[r.to] || []).push(r.fr);
    }
    if (r.t === "spouse") { spouseOf[r.fr] = r.to; spouseOf[r.to] = r.fr; }
    if (r.t === "sibling") {
      (siblingOf[r.fr] = siblingOf[r.fr] || []).push(r.to);
      (siblingOf[r.to] = siblingOf[r.to] || []).push(r.fr);
    }
  });
  return { parentOf: parentOf, childOf: childOf, spouseOf: spouseOf, siblingOf: siblingOf };
}

// Top-level "units" — connected clusters (via spouse/sibling links) among
// people with no recorded parent. Someone who married in (no parent of
// their own) but whose spouse DOES have a recorded parent is NOT a root —
// they get attached to their spouse during the recursive walk below
// instead. Only a peer-cluster where NOBODY has a recorded parent anywhere
// becomes an actual top-level unit.
function rootUnits(maps, ids) {
  var peers = {};
  function addPeer(a, b) { (peers[a] = peers[a] || []).push(b); (peers[b] = peers[b] || []).push(a); }
  Object.keys(maps.spouseOf).forEach(function (id) { addPeer(id, maps.spouseOf[id]); });
  Object.keys(maps.siblingOf).forEach(function (id) { maps.siblingOf[id].forEach(function (o) { addPeer(id, o); }); });

  var compVisited = {}, componentHasParent = {};
  ids.forEach(function (id) {
    if (compVisited[id]) return;
    var stack = [id], comp = [];
    compVisited[id] = true;
    while (stack.length) {
      var cur = stack.pop(); comp.push(cur);
      (peers[cur] || []).forEach(function (p) { if (!compVisited[p]) { compVisited[p] = true; stack.push(p); } });
    }
    var hasParent = comp.some(function (c) { return maps.childOf[c] && maps.childOf[c].length; });
    comp.forEach(function (c) { componentHasParent[c] = hasParent; });
  });

  var noParentSet = {};
  ids.forEach(function (id) {
    if ((!maps.childOf[id] || !maps.childOf[id].length) && !componentHasParent[id]) noParentSet[id] = true;
  });

  var visited = {}, units = [];
  Object.keys(noParentSet).forEach(function (id) {
    if (visited[id]) return;
    var stack = [id], comp = [];
    visited[id] = true;
    while (stack.length) {
      var cur = stack.pop(); comp.push(cur);
      (peers[cur] || []).forEach(function (nb) { if (noParentSet[nb] && !visited[nb]) { visited[nb] = true; stack.push(nb); } });
    }
    units.push(comp);
  });
  return units;
}

function connKind(a, b, maps) { return maps.spouseOf[a] === b ? "spouse" : "sibling"; }

function unitChildren(unit, maps) {
  var seen = {}, order = [];
  unit.forEach(function (id) {
    (maps.parentOf[id] || []).forEach(function (ch) { if (!seen[ch]) { seen[ch] = true; order.push(ch); } });
  });
  return order;
}

function buildUnitLi(unit, maps, usedSpouses) {
  var li = document.createElement("li");
  var row = document.createElement("div"); row.className = "unit-row";
  unit.forEach(function (id, idx) {
    row.appendChild(mkCard(id));
    if (idx < unit.length - 1) {
      var kind = connKind(unit[idx], unit[idx + 1], maps);
      var bar = document.createElement("div"); bar.className = "conn-bar conn-" + kind;
      row.appendChild(bar);
    }
  });
  li.appendChild(row);

  var kids = unitChildren(unit, maps);
  if (kids.length) {
    var ul = document.createElement("ul");
    kids.forEach(function (kid) {
      var kidUnit = [kid];
      var sp = maps.spouseOf[kid];
      if (sp !== undefined && !usedSpouses[sp]) { usedSpouses[sp] = true; kidUnit.push(sp); }
      ul.appendChild(buildUnitLi(kidUnit, maps, usedSpouses));
    });
    li.appendChild(ul);
  }
  return li;
}

/* ---------- Render ---------- */
function renderTree() {
  var root = document.getElementById("treeRoot");
  var empty = document.getElementById("emptyState");
  root.innerHTML = "";
  var ids = Object.keys(S.members);

  document.getElementById("statMembers").textContent = ids.length;
  document.getElementById("statPending").textContent = S.pending.length;

  if (!ids.length) { empty.hidden = false; return; }
  empty.hidden = true;

  var calc = calcGens(), gens = calc.gens; // still used for the Generations stat
  var maxGen = 0;
  ids.forEach(function (id) { if (gens[id] > maxGen) maxGen = gens[id]; });
  document.getElementById("statGens").textContent = maxGen + 1;

  var maps = buildRelMaps();
  var usedSpouses = {};
  var roots = rootUnits(maps, ids);
  roots.forEach(function (u) { u.forEach(function (id) { usedSpouses[id] = true; }); });

  var wrap = document.createElement("ul"); wrap.className = "tree";
  roots.forEach(function (u) { wrap.appendChild(buildUnitLi(u, maps, usedSpouses)); });
  root.appendChild(wrap);

  renderPending();
}

function mkCard(id) {
  var m = S.members[id];
  var card = document.createElement("div"); card.className = "member-card"; card.dataset.id = id;
  var avWrap = document.createElement("div"); avWrap.className = "card-avatar-wrap";
  var img = document.createElement("img"); img.className = "card-avatar";
  img.src = m.img || DEFAULT_AVT; img.alt = ""; img.loading = "lazy";
  img.onerror = function () { this.src = DEFAULT_AVT; };
  avWrap.appendChild(img);
  var nm = document.createElement("div"); nm.className = "card-name"; nm.textContent = m.name;
  card.appendChild(avWrap); card.appendChild(nm);
  if (m.role) { var rl = document.createElement("div"); rl.className = "card-role"; rl.textContent = m.role; card.appendChild(rl); }
  card.addEventListener("click", function () { openDetail(id); });
  return card;
}

function renderPending() {
  var sec = document.getElementById("pendingSection");
  var list = document.getElementById("pendingList");
  list.innerHTML = "";
  if (!S.pending.length) { sec.hidden = true; return; }
  sec.hidden = false;
  S.pending.forEach(function (p) {
    var chip = document.createElement("div"); chip.className = "pending-chip";
    chip.textContent = p.name + " \u2014 " + (p.reason || "could not be placed");
    list.appendChild(chip);
  });
}

function openDetail(id) {
  var m = S.members[id];
  var parents = [], children = [], spouses = [], siblings = [];
  S.rels.forEach(function (r) {
    if (r.t === "parent" && r.fr === id) children.push(r.to);
    if (r.t === "parent" && r.to === id) parents.push(r.fr);
    if (r.t === "spouse") { var o = r.fr === id ? r.to : (r.to === id ? r.fr : null); if (o) spouses.push(o); }
    if (r.t === "sibling") { var o2 = r.fr === id ? r.to : (r.to === id ? r.fr : null); if (o2) siblings.push(o2); }
  });
  function chips(list) {
    if (!list.length) return '<span style="color:var(--text3);font-size:.75rem">Koi nahi</span>';
    return list.map(function (rid) {
      var rm = S.members[rid]; if (!rm) return "";
      return '<span class="rel-chip">' + escapeHtml(rm.name) + "</span>";
    }).join("");
  }
  var avSrc = (m.img && /^https?:\/\//i.test(m.img)) ? escapeHtml(m.img) : DEFAULT_AVT;
  var inner = document.getElementById("detailInner");
  inner.innerHTML =
    '<img class="dp-avatar" src="' + avSrc + '" onerror="this.src=\'' + DEFAULT_AVT + '\'" alt="">' +
    '<div class="dp-name">' + escapeHtml(m.name) + "</div>" +
    (m.role ? '<div class="dp-role">' + escapeHtml(m.role) + "</div>" : "") +
    (m.dob ? '<div class="dp-bio">Janam: ' + escapeHtml(m.dob) + "</div>" : "") +
    (m.marriage ? '<div class="dp-bio">Vivah: ' + escapeHtml(m.marriage) + "</div>" : "") +
    (m.bio ? '<div class="dp-bio">' + escapeHtml(m.bio) + "</div>" : "") +
    '<div class="dp-sec"><h4>Mata-Pita</h4>' + chips(parents) + "</div>" +
    '<div class="dp-sec"><h4>Jeevan Saathi</h4>' + chips(spouses) + "</div>" +
    '<div class="dp-sec"><h4>Santaan</h4>' + chips(children) + "</div>" +
    '<div class="dp-sec"><h4>Bhai-Behen</h4>' + chips(siblings) + "</div>";
  document.getElementById("memberOverlay").hidden = false;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}

/* ---------- Load data ---------- */
function loadData() {
  if (!APPS_SCRIPT_URL) {
    buildData([]);
    renderTree();
    showNotice("Preview mode: sirf shuru ke 5 members dikh rahe hain. Apps Script URL jodo js/app.js mein (APPS_SCRIPT_URL) taaki form submissions yahan aayein.");
    return;
  }
  fetch(APPS_SCRIPT_URL + "?t=" + Date.now())
    .then(function (res) { if (!res.ok) throw new Error("fetch failed"); return res.json(); })
    .then(function (data) {
      if (!data.ok) throw new Error(data.error || "bad response");
      var submissions = rowsToSubmissions(data.rows || []);
      buildData(submissions);
      renderTree();
      document.getElementById("noticeBanner").hidden = true;
    })
    .catch(function (err) {
      buildData([]);
      renderTree();
      showNotice("Data load nahi ho payi: " + err.message + " (README dekho).", true);
    });
}

/* ---------- Submit the inline form ---------- */
function submitForm(e) {
  e.preventDefault();
  if (!APPS_SCRIPT_URL) { toast("Pehle APPS_SCRIPT_URL set karo js/app.js mein", "error"); return; }
  var f = e.target;
  var payload = {
    name: f.fName.value.trim(),
    relationshipType: f.fType.value,
    relatedTo: f.fRelTo.value.trim(),
    dob: f.fDob.value,
    marriage: f.fMarriage.value,
    img: f.fImg.value.trim(),
    bio: f.fBio.value.trim()
  };
  if (!payload.name || !payload.relationshipType || !payload.relatedTo) {
    toast("Naam, Relationship Type, aur Related To zaroori hain", "error");
    return;
  }
  var btn = document.getElementById("submitBtn");
  btn.disabled = true; btn.textContent = "Jama ho raha hai\u2026";
  fetch(APPS_SCRIPT_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" }, // avoids CORS preflight on Apps Script
    body: JSON.stringify(payload)
  })
    .then(function (res) { return res.json(); })
    .then(function (data) {
      if (!data.ok) throw new Error(data.error || "failed");
      toast("Jud gaye! Tree mein dikhega thodi der mein.", "success");
      f.reset();
      loadData();
    })
    .catch(function () {
      toast("Submit nahi ho paya. Apps Script URL/deployment check karo.", "error");
    })
    .finally(function () {
      btn.disabled = false; btn.textContent = "Jama Karein";
    });
}

/* ---------- Wire up ---------- */
document.addEventListener("DOMContentLoaded", function () {
  document.getElementById("memberForm").addEventListener("submit", submitForm);
  document.getElementById("btnRefresh").addEventListener("click", function () { loadData(); toast("Refresh ho raha hai\u2026"); });
  document.getElementById("btnTheme").addEventListener("click", function () {
    document.body.classList.toggle("light");
    try { localStorage.setItem("ftTheme", document.body.classList.contains("light") ? "light" : "dark"); } catch (e) {}
  });
  document.getElementById("detailClose").addEventListener("click", function () { document.getElementById("memberOverlay").hidden = true; });
  document.getElementById("memberOverlay").addEventListener("click", function (e) { if (e.target === this) this.hidden = true; });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") document.getElementById("memberOverlay").hidden = true; });

  try { if (localStorage.getItem("ftTheme") === "light") document.body.classList.add("light"); } catch (e) {}

  loadData();
});
