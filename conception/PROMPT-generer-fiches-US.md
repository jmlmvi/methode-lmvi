<!-- KIT-VERSION: 1.1.0 -->
# Prompt — générer les fiches US & Épic (maillons M2/M3)

> Kit de génération réutilisable pour découper les US en **fiches nommées, reliées** (Obsidian `[[…]]`
> + mermaid). Deux voies : **le script** (déterministe) ou **le prompt** (pour un agent IA).
> **Option A (méthode §0)** : la fiche US est purement métier — ni phase ni brique ; le mapping vit
> dans la matrice de couverture (M6).

## Voie 1 — le script (recommandé, déterministe)

Fichier : [`gen-fiches-us.py`](gen-fiches-us.py) — **générique**, toutes les données vivent dans un
YAML (modèle : [`us-data.example.yml`](us-data.example.yml) = le chantier Régie). Il génère :
- `M2-user-stories/<CODE>-<nom>.md` — 1 fiche par US (frontmatter `aliases: [<CODE>]` +
  `tags: [us, "epic/<lettre>"]`, histoire, contexte, CA, dépendances amont/aval, RG, mermaid, `[[…]]`) ;
- `M3-epics/<lettre>-<nom>.md` — 1 fiche par épic (regroupe et pointe vers ses US) ;
- `M2-user-stories/README.md` — l'index ;
- `M6-plan-technique/matrice-couverture.generated.md` — **si** le YAML fournit `phase`/`brique` par US
  (brouillon à fusionner dans le README M6, la source de vérité du mapping).

**Réutiliser** : copier `us-data.example.yml`, remplacer `chantier`/`root`/`spec`/`epics`/`us`, puis :
```bash
python3 gen-fiches-us.py mon-chantier/us-data.yml
```
**Contrat d'écrasement** : les fiches US/épic, l'index M2 et la matrice générée sont **régénérés
intégralement** à chaque run — la source de vérité est le YAML, ne pas les éditer à la main. Les autres
fichiers du chantier ne sont touchés que par le patch de liens (`[[CODE]]` nu → `[[CODE-slug]]`).
Le **code** reste l'ID stable (tri, traçabilité, matrice) ; le **nom** rend le fichier lisible ; **les
liens `[[…]]` utilisent le nom complet du fichier** (résolution Obsidian fiable), le code restant en
alias frontmatter.

## Voie 2 — le prompt (pour un agent IA, sans script)

> Tu produis les fiches US et Épic d'un chantier, à partir de sa **spec de besoins (M1)** et de son
> **récapitulatif d'US**. Respecte strictement :
>
> 1. **Une fiche par US**, fichier `M2-user-stories/<CODE>-<slug-du-nom>.md`. Frontmatter
>    `aliases: ["<CODE>"]` + `tags: [us, "epic/<lettre>"]` (épic secondaire éventuel = tag `epic/<y>`
>    additionnel ; **jamais de tag phase**).
> 2. Structure de chaque fiche (voir [`TEMPLATE-US.md`](TEMPLATE-US.md)) : titre `# <CODE> · <Nom>`,
>    table (Nom, Code, Épic propriétaire `[[…]]`, RG liées, Statut — **ni Phase ni Brique** : renvoi
>    vers la matrice M6), **Histoire** (En tant que… je veux… afin de…), **Contexte** (1–3 phrases
>    explicites), **Critères d'acceptation** (2–3, plus riches sur les pivots — option Gherkin),
>    **Dépendances** (Amont/Aval en `[[…]]`), **Relations (mermaid)**, **Liens**.
> 3. **Une fiche par épic**, `M3-epics/<lettre>-<slug>.md` (voir [`TEMPLATE-EPIC.md`](TEMPLATE-EPIC.md)) :
>    regroupe et **pointe** vers ses US ; ne duplique pas leur contenu ; pas de colonne phase.
> 4. **Tout est relié au NOM COMPLET du fichier** (résolution Obsidian fiable) :
>    - liens Obsidian `[[<CODE>-<slug>]]` — US ↔ épic ↔ dépendances ;
>    - **dans le mermaid** : les **labels** portent le nom complet (`{{ID}} · {{titre}}`) **et** chaque
>      nœud est **cliquable** vers sa fiche : `click <CODE> "<CODE>-<slug>.md"` (US↔US même dossier),
>      `click <CODE> "../M2-user-stories/<CODE>-<slug>.md"` (depuis une fiche épic).
>    - Vérifie qu'**aucun lien / click** ne pointe vers un fichier inexistant.
> 5. **Zéro invention** : chaque US vient de la spec ; pas d'US fantôme pour « faire joli ».
