<!-- KIT-VERSION: 1.8.0 -->
<!-- PROUVE-SUR: — (niveau Feature v1.8 non prouvé ; chaîne de base prouvée sur Régie kit v1.0) -->
---
aliases: ["{{ID}}"]
tags: [us, "feature/{{code-feature}}", "epic/{{lettre}}"]
---
# {{ID}} · {{titre}}

> Template d'une **fiche US** (1 fichier par US dans M2). **Nom de fichier = `{{ID}}-{{slug-du-nom}}.md`.**
> **Axe métier uniquement** : la fiche ne porte **ni phase ni brique** — ce rattachement vit dans la
> **matrice de couverture (M6)**, seule source de vérité du mapping (méthode §0).
> **Convention de liens** : liens Obsidian et nœuds mermaid au **nom complet du fichier**
> (`[[{{ID}}-{{slug}}]]`, `click {{ID}} "{{ID}}-{{slug}}.md"`) → navigables dans Obsidian.
> US transverse : une seule feature **propriétaire** (l'épic propriétaire = celui de la feature) ;
> regroupements secondaires via tags `feature/{{y}}` / `epic/{{y}}` additionnels.

| | |
|---|---|
| **Nom** | {{titre}} |
| **Code** | `{{ID}}` (identifiant stable) |
| **Feature (propriétaire)** | [[{{feature-fichier}}]] · {{code-feature}} — {{titre feature}} |
| **Épic (propriétaire)** | [[{{epic-note}}]] · {{lettre}} — {{titre épic}} *(celui de la feature)* |
| **RG liées** | {{RG-Ax, …}} |
| **Statut** | à faire *(cycle : à faire · en cours · livrée · splittée → US filles · abandonnée, raison en M4)* |

> **Phase & brique** : voir la [matrice de couverture](../M6-plan-technique/README.md).

## Histoire
**En tant que** {{acteur}}, **je veux** {{capacité}}, **afin de** {{bénéfice}}.

## Contexte
{{1–3 phrases : pourquoi cette US, cas concret, ce qui la rend explicite}}

## Critères d'acceptation
- {{CA-1}}
- {{CA-2}}
- {{CA-3 (pour les pivots)}}

## Dépendances
- **Amont** (requiert) : {{[[Dep1-nom]] [[Dep2-nom]]}}
- **Aval** (requis par) : {{[[Aval1-nom]]}}

## Relations (mermaid)
```mermaid
flowchart LR
  {{ID}}["{{ID}} · {{titre}}"] --> FT["{{code-feature}} · {{titre feature}}"]
  FT --> EP["Épic {{lettre}} · {{titre épic}}"]
  {{DEP}}["{{DEP}} · {{nom dép}}"] --> {{ID}}
  click {{ID}} "{{ID}}-{{slug}}.md"
  click FT "../M3-epics/{{feature-fichier}}.md"
  click EP "../M3-epics/{{epic-note}}.md"
  click {{DEP}} "{{DEP}}-{{slug}}.md"
```

## Liens
Feature [[{{feature-fichier}}]] · Épic [[{{epic-note}}]] · dépend de {{[[Dep1-nom]]}} · requis par {{[[Aval1-nom]]}} · [Spec]({{lien-spec}})
