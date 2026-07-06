#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# KIT-VERSION: 1.4.0
"""Génère les fiches US (M2), épics (M3) et — pilier conception — fiches RG, matrice
d'habilitations et squelettes de tests Gherkin d'un chantier Besoin2Plan, avec liens
Obsidian [[...]] + mermaid. Déterministe, idempotent, GÉNÉRIQUE : toutes les données
vivent dans un fichier YAML passé en argument (voir us-data.example.yml ; sections
optionnelles `rg:` et `roles:`).

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
RG = DATA.get("rg") or {}                    # OPTIONNEL (pilier conception) : code -> {titre, enonce,
                                             #   type, source, [exceptions], [exemples],
                                             #   [contre_exemples], [statut]}
ROLES = DATA.get("roles") or {}              # OPTIONNEL : cle -> {label, [description]} ;
                                             #   si vide, dérivés des acteurs des US
M2 = os.path.join(ROOT, "M2-user-stories")
M3 = os.path.join(ROOT, "M3-epics")
M6 = os.path.join(ROOT, "M6-plan-technique")
M1 = os.path.join(ROOT, "M1-spec-besoins")
RGDIR = os.path.join(M1, "RG")
TSQ = os.path.join(ROOT, "tests-squelettes")
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
RGFN = {c: f"{c}-{slug(v.get('titre', c))}" for c, v in RG.items()}
def wl(c):                                   # [[A1-deposer-un-texte-source]]
    return f"[[{FN[c]}]]"

def rg_link(r):
    if r in RGFN:                            # fiche RG (pilier conception) prioritaire
        return f"[[{RGFN[r]}]]"
    return f"[{r}]({SPEC_RG})" if SPEC_RG else f"`{r}`"

# index inverse RG -> US concernées
rg_us = {r: [] for r in RG}
for u, v in US.items():
    for r in v.get("rg", []):
        rg_us.setdefault(r, []).append(u)

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

# ============ Pilier CONCEPTION (sections YAML optionnelles rg: / roles:) ============

def rg_fiche(code, v):
    fiche_us = rg_us.get(code, [])
    us_l = " · ".join(wl(u) for u in fiche_us) or "—"
    exc = "\n".join(f"- {e}" for e in v.get("exceptions", [])) or "- aucune"
    ex, cex = v.get("exemples", []), v.get("contre_exemples", [])
    rows = "\n".join(f"| {ex[i] if i < len(ex) else ''} | {cex[i] if i < len(cex) else ''} |"
                     for i in range(max(len(ex), len(cex), 1)))
    mm = ['```mermaid', 'flowchart LR', f'  RG["{code} · {v.get("titre", code)}"]']
    for u in fiche_us:
        mm.append(f'  RG --> {u}["{u} · {US[u]["titre"]}"]')
        mm.append(f'  click {u} "../../M2-user-stories/{FN[u]}.md"')
    mm.append('```')
    return f"""---
aliases: ["{code}"]
tags: [rg, "type/{v.get('type', 'invariant')}"]
---
# {code} · {v.get('titre', code)}

| | |
|---|---|
| **Code** | `{code}` (identifiant stable) |
| **Énoncé** | {v['enonce']} |
| **Type** | {v.get('type', 'invariant')} |
| **Source** | {v.get('source', 'spec M1')} |
| **Statut** | {v.get('statut', 'active')} |
| **US concernées** | {us_l} |
| **Tests** | `@{code}` (exemples/contre-exemples ci-dessous → squelettes générés) |

## Exceptions
{exc}

## Exemples (cas conformes) / Contre-exemples (cas rejetés)
| ✅ Conforme | ⛔ Rejeté |
|---|---|
{rows}

## Relations (mermaid)
{chr(10).join(mm)}
"""

if RG:
    os.makedirs(RGDIR, exist_ok=True)
    for old in glob.glob(os.path.join(RGDIR, "*.md")):
        os.remove(old)                       # contrat : fiches RG régénérées intégralement
    for code, v in RG.items():
        with open(os.path.join(RGDIR, RGFN[code] + ".md"), "w", encoding="utf-8") as f:
            f.write(rg_fiche(code, v))
    ridx = [f"# Règles de gestion — {CHANTIER}", "",
            "> 1 fiche par RG (générées — source de vérité = YAML). Type `droit_acces` = conditions",
            "> fines de la matrice d'habilitations. Une RG ne se supprime jamais (statut `abrogée`).",
            "", "| RG | Titre | Type | Statut | US concernées |", "|---|---|---|---|---|"]
    for code in sorted(RG):
        v = RG[code]
        ridx.append(f"| [[{RGFN[code]}]] | {v.get('titre', code)} | {v.get('type', 'invariant')} "
                    f"| {v.get('statut', 'active')} | {' '.join(rg_us.get(code, [])) or '—'} |")
    orphan_rg = sorted(set(r for v in US.values() for r in v.get("rg", [])) - set(RG))
    if orphan_rg:
        ridx += ["", f"> ⚠️ RG référencées par des US mais **sans fiche** (à ajouter au YAML) : "
                 f"{', '.join(orphan_rg)}"]
    with open(os.path.join(RGDIR, "README.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(ridx) + "\n")

# --- matrice d'habilitations (brouillon) : rôles déclarés ou dérivés des acteurs ---
if ROLES or RG:
    os.makedirs(M1, exist_ok=True)
    roles = ROLES or {slug(a).replace("-", "_"): {"label": a}
                      for a in dict.fromkeys(v["acteur"] for v in US.values())}
    hab = [f"# Matrice d'habilitations (générée) — {CHANTIER}", "",
           "> **Brouillon** (pilier conception, TEMPLATE-HABILITATIONS) : ✅ dérivés de l'acteur de",
           "> chaque US ; les `?` sont à qualifier À LA MAIN en ✅ / ⛔ (→ test négatif 403) /",
           "> ⚠️ → RG `droit_acces`. DoD : aucune cellule en `?`. Mapping IAM : en M6.",
           "", "| US | " + " | ".join(v.get("label", k) for k, v in roles.items()) + " |",
           "|----|" + "|".join([":---:"] * len(roles)) + "|"]
    for u in sorted(US):
        cells = ["✅" if US[u]["acteur"] == v.get("label", k) or US[u]["acteur"] == k else "?"
                 for k, v in roles.items()]
        hab.append(f"| {u} | " + " | ".join(cells) + " |")
    with open(os.path.join(M1, "matrice-habilitations.generated.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(hab) + "\n")

# --- squelettes de tests Gherkin (acceptation @US-x + règles @RG-x) ---
os.makedirs(os.path.join(TSQ, "acceptance"), exist_ok=True)
for old in glob.glob(os.path.join(TSQ, "**", "*.feature"), recursive=True):
    os.remove(old)
HEAD = ("# language: fr\n# SQUELETTE GÉNÉRÉ (pilier conception) — à déplacer dans le repo de code\n"
        "# et à implémenter. Zéro mock : tant que non implémenté, il reste `en_attente`.\n")
for u, v in US.items():
    lines = [HEAD + f"@US-{u} @epic-{v['epic']}",
             f"Fonctionnalité: {u} · {v['titre']}",
             f"  # En tant que {v['acteur']}, je veux {v['veux']}, afin de {v['afin']}."]
    for i, ca in enumerate(v["ca"], 1):
        lines += [f"", f"  Scénario: {u} CA-{i}", f"    # Étant donné … (TODO)",
                  f"    # Quand … (TODO)", f"    # Alors {ca}"]
    with open(os.path.join(TSQ, "acceptance", f"{FN[u]}.feature"), "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
if RG:
    os.makedirs(os.path.join(TSQ, "rg"), exist_ok=True)
    for code, v in RG.items():
        lines = [HEAD + f"@RG-{code}", f"Fonctionnalité: {code} · {v.get('titre', code)}",
                 f"  # Règle : {v['enonce']}"]
        for i, ex in enumerate(v.get("exemples", []), 1):
            lines += ["", f"  Scénario: {code} conforme-{i}", f"    # Alors {ex}"]
        for i, cex in enumerate(v.get("contre_exemples", []), 1):
            lines += ["", f"  Scénario: {code} rejet-{i}", f"    # Alors le cas est REFUSÉ : {cex}"]
        with open(os.path.join(TSQ, "rg", f"{RGFN[code]}.feature"), "w", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")
with open(os.path.join(TSQ, "README.md"), "w", encoding="utf-8") as f:
    f.write(f"# Squelettes de tests (générés) — {CHANTIER}\n\n"
            "> Générés depuis le YAML (CA des US + exemples/contre-exemples des RG). **À déplacer\n"
            "> dans le repo de code** puis implémenter (cf. conception/TEMPLATE-TESTS.md : tagging,\n"
            "> niveaux, gate). Régénérés intégralement à chaque run.\n")

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
      + (f" + {len(RG)} fiches RG" if RG else "")
      + (" + matrice habilitations" if (ROLES or RG) else "")
      + f" + squelettes tests ({len(US)} US" + (f", {len(RG)} RG" if RG else "") + ")"
      + f" ; patch liens: {patched} fichiers")
