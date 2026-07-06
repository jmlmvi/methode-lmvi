#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# KIT-VERSION: 1.1.0
"""Génère les fiches US (M2) et épics (M3) d'un chantier Besoin2Plan, avec liens
Obsidian [[...]] + mermaid. Déterministe, idempotent, GÉNÉRIQUE : toutes les données
vivent dans un fichier YAML passé en argument (voir us-data.example.yml).

Usage :
    python3 gen-fiches-us.py <us-data.yml>

Contrat d'écrasement (kit v1.1) :
  - les fiches US (M2/*.md hors README), les fiches épic (M3/<note>.md), l'index
    M2/README.md et la matrice générée sont RÉGÉNÉRÉS INTÉGRALEMENT à chaque run —
    la source de vérité est le YAML, ne pas les éditer à la main ;
  - tout autre fichier du chantier n'est modifié que par le patch de liens
    ([[CODE]] nu → [[CODE-slug]]), rien d'autre.

Option A (méthode §0) : la fiche US est purement métier — AUCUNE phase ni brique.
Si le YAML fournit phase/brique, ils alimentent un brouillon de matrice de couverture
M6-plan-technique/matrice-couverture.generated.md (à fusionner dans le README M6).
"""
import os, re, sys, glob, unicodedata

try:
    import yaml
except ImportError:
    sys.exit("PyYAML requis : pip install pyyaml")

if len(sys.argv) != 2:
    sys.exit(__doc__.split("Usage :")[1].split("\n")[1].strip() and
             "Usage : python3 gen-fiches-us.py <us-data.yml>")

DATA_PATH = os.path.abspath(sys.argv[1])
with open(DATA_PATH, encoding="utf-8") as f:
    DATA = yaml.safe_load(f)

ROOT = DATA["root"]
if not os.path.isabs(ROOT):
    ROOT = os.path.normpath(os.path.join(os.path.dirname(DATA_PATH), ROOT))
CHANTIER = DATA.get("chantier", os.path.basename(ROOT))
SPEC = DATA.get("spec")                      # lien relatif depuis M2 vers la spec (optionnel)
SPEC_US = (SPEC + DATA.get("spec_us_anchor", "")) if SPEC else None
SPEC_RG = (SPEC + DATA.get("spec_rg_anchor", "")) if SPEC else None
EPICS = DATA["epics"]                        # lettre -> {note, titre, intention}
US = DATA["us"]                              # code  -> {epic, titre, acteur, veux, afin,
                                             #           deps, rg, ctx, ca, [phase], [brique], [statut]}
M2 = os.path.join(ROOT, "M2-user-stories")
M3 = os.path.join(ROOT, "M3-epics")
M6 = os.path.join(ROOT, "M6-plan-technique")
os.makedirs(M2, exist_ok=True); os.makedirs(M3, exist_ok=True)

# dépendants (reverse)
dependents = {k: [] for k in US}
for k, v in US.items():
    for d in v.get("deps", []):
        dependents.setdefault(d, []).append(k)

def slug(s):
    s = s.split("(")[0]                      # retire "(PIVOT)"
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    s = re.sub(r"[^a-zA-Z0-9]+", "-", s).strip("-").lower()
    return s[:40].strip("-")

# nom de fichier = CODE-nom (code = ID stable + tri ; nom = lisibilité)
FN = {c: f"{c}-{slug(v['titre'])}" for c, v in US.items()}
def wl(c):                                   # [[A1-deposer-un-texte-source]]
    return f"[[{FN[c]}]]"

def rg_link(r):
    return f"[{r}]({SPEC_RG})" if SPEC_RG else f"`{r}`"

def us_fiche(uid, v):
    e = v["epic"]; enote, etitle = EPICS[e]["note"], EPICS[e]["titre"]
    deps = v.get("deps", []); deps_l = " ".join(wl(d) for d in deps) or "—"
    aval = " ".join(wl(d) for d in dependents.get(uid, [])) or "—"
    rg = ", ".join(rg_link(r) for r in v.get("rg", [])) or "—"
    ca = "\n".join(f"- {c}" for c in v["ca"])
    statut = v.get("statut", "à faire")
    def lab(c): return f'{c} · {US[c]["titre"]}'
    mm = ['```mermaid', 'flowchart LR',
          f'  {uid}["{lab(uid)}"] --> EP["Épic {e} · {etitle}"]']
    for d in deps:
        mm.append(f'  {d}["{lab(d)}"] --> {uid}')
    # nœuds cliquables → fiche (Obsidian ; ignoré par GitHub securityLevel strict)
    mm.append(f'  click {uid} "{FN[uid]}.md"')
    mm.append(f'  click EP "../M3-epics/{enote}.md"')
    for d in deps:
        mm.append(f'  click {d} "{FN[d]}.md"')
    mm.append('```')
    mm = "\n".join(mm)
    spec_l = f" · [Spec]({SPEC_US})" if SPEC_US else ""
    return f"""---
aliases: ["{uid}"]
tags: [us, "epic/{e}"]
---
# {uid} · {v['titre']}

| | |
|---|---|
| **Nom** | {v['titre']} |
| **Code** | `{uid}` (identifiant stable) |
| **Épic (propriétaire)** | [[{enote}]] · {e} — {etitle} |
| **RG liées** | {rg} |
| **Statut** | {statut} |

> **Phase & brique** : voir la [matrice de couverture](../M6-plan-technique/README.md) (méthode §0 :
> la fiche US est purement métier, le mapping vit dans M6).

## Histoire
**En tant que** {v['acteur']}, **je veux** {v['veux']}, **afin de** {v['afin']}.

## Contexte
{v['ctx']}

## Critères d'acceptation
{ca}

## Dépendances
- **Amont** (requiert) : {deps_l}
- **Aval** (requis par) : {aval}

## Relations (mermaid)
{mm}

## Liens
Épic [[{enote}]] · dépend de {deps_l} · requis par {aval}{spec_l}
"""

def epic_fiche(letter):
    ep = EPICS[letter]; enote, etitle, intent = ep["note"], ep["titre"], ep["intention"]
    us_ids = [k for k in US if US[k]["epic"] == letter]
    us_links = " · ".join(wl(u) for u in us_ids)
    rows = "\n".join(f"| {wl(u)} | {US[u]['titre']} |" for u in us_ids)
    mm = ['```mermaid', 'flowchart TB', f'  EP["Épic {letter} · {etitle}"]']
    for u in us_ids:
        mm.append(f'  EP --> {u}["{u} · {US[u]["titre"]}"]')
    for u in us_ids:
        mm.append(f'  click {u} "../M2-user-stories/{FN[u]}.md"')
    mm.append('```')
    mm = "\n".join(mm)
    return f"""# Épic {letter} · {etitle}

> {intent}. Regroupement métier (maillon **M3**). Les US détaillées vivent dans **M2** ; ici on relie.
> Phase & brique par US : voir la [matrice de couverture](../M6-plan-technique/README.md).

## User Stories de cet épic
{us_links}

| US | Nom |
|---|---|
{rows}

## Relations (mermaid)
{mm}

## Liens
Maillon [[README|M3 index]] · Phasage [../M5-phasage/README.md](../M5-phasage/README.md) · Plan & matrice [../M6-plan-technique/README.md](../M6-plan-technique/README.md)
"""

# --- nettoyage des anciennes fiches US (contrat : M2/*.md régénérés, README compris) ---
for old in glob.glob(os.path.join(M2, "*.md")):
    if os.path.basename(old) != "README.md":
        os.remove(old)

# --- écriture US (M2, à plat, nom de fichier CODE-nom) ---
for uid, v in US.items():
    with open(os.path.join(M2, FN[uid] + ".md"), "w", encoding="utf-8") as f:
        f.write(us_fiche(uid, v))

# --- écriture épics (M3) ---
for letter in EPICS:
    with open(os.path.join(M3, f"{EPICS[letter]['note']}.md"), "w", encoding="utf-8") as f:
        f.write(epic_fiche(letter))

# --- index M2 ---
by_epic = {}
for uid, v in US.items():
    by_epic.setdefault(v["epic"], []).append(uid)
idx = [f"# M2 · User Stories — {CHANTIER}",
 "",
 f"> **{len(US)} fiches US explicites**, une par fichier, reliées en graphe (**liens Obsidian `[[…]]`** + mermaid).",
 "> Les épics (regroupement) vivent dans **[M3](../M3-epics/)** ; le mapping phase/brique vit dans la",
 "> **[matrice de couverture (M6)](../M6-plan-technique/README.md)** — jamais dans les fiches (méthode §0).",
 "",
 "## Index par épic",
 ""]
for letter in EPICS:
    enote, etitle = EPICS[letter]["note"], EPICS[letter]["titre"]
    links = " · ".join(wl(u) for u in by_epic.get(letter, []))
    idx.append(f"- **[[{enote}|Épic {letter} — {etitle}]]** : {links}")
idx += ["",
 "## Vue d'ensemble (mermaid)",
 "```mermaid",
 "flowchart LR",
 f'  M1["M1 Spec"] --> M2["M2 · {len(US)} fiches US"]',
 '  M2 --> M3["M3 Épics (regroupement)"]',
 '  M6["M6 Matrice de couverture"] -. "mapping US→phase→brique" .-> M2',
 "```",
 "",
 "## Definition of Done",
 f"- [x] {len(US)} US découpées en fiches explicites (template `TEMPLATE-US.md` du kit)",
 "- [x] Chaque fiche reliée : épic (M3), dépendances (`[[…]]`) — axe métier seul",
 "- [x] Pas de solution technique dans l'énoncé ; critères d'acceptation présents",
 ""]
with open(os.path.join(M2, "README.md"), "w", encoding="utf-8") as f:
    f.write("\n".join(idx))

# --- matrice de couverture (brouillon M6) si phase/brique fournis dans le YAML ---
mapped = {u: v for u, v in US.items() if v.get("phase") or v.get("brique")}
if mapped:
    os.makedirs(M6, exist_ok=True)
    mat = [f"# Matrice de couverture (générée) — {CHANTIER}",
     "",
     "> **Brouillon généré** depuis le YAML (`phase`/`brique` par US) — à fusionner dans le README M6.",
     "> Colonnes Gate et Statut à compléter à la main dans le README M6 (source de vérité).",
     "",
     "| US | Épic | Phase | Brique technique | Gate | Statut / révisé le |",
     "|----|------|-------|------------------|------|--------------------|"]
    for u in sorted(mapped):
        v = mapped[u]
        mat.append(f"| {u} | {v['epic']} — {EPICS[v['epic']]['titre']} | {v.get('phase','?')} "
                   f"| {v.get('brique','?')} | *(à compléter)* | à faire |")
    mat.append("")
    with open(os.path.join(M6, "matrice-couverture.generated.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(mat))

# --- patch : liens nus [[CODE]] restants (fichiers édités à la main) -> nom complet ---
patched = 0
for p in glob.glob(os.path.join(ROOT, "**", "*.md"), recursive=True):
    if "_templates" in p:
        continue
    txt = open(p, encoding="utf-8").read(); orig = txt
    for c in US:
        txt = re.sub(r"\[\[" + re.escape(c) + r"\]\]", f"[[{FN[c]}]]", txt)
    if txt != orig:
        open(p, "w", encoding="utf-8").write(txt); patched += 1

print(f"OK : {len(US)} fiches US + {len(EPICS)} fiches épic + index M2"
      + (f" + matrice M6 ({len(mapped)} lignes)" if mapped else "")
      + f" ; patch liens: {patched} fichiers")
