<!-- KIT-VERSION: 1.1.0 -->
# Épic {{lettre}} · {{titre}}

> Template d'une **fiche épic** (maillon M3 — le regroupement). Nom de fichier `{{lettre}}-{{slug}}.md`.
> Les US détaillées vivent dans **M2** ; ici on **relie** (on ne duplique pas leur contenu).
> **Axe métier uniquement** : pas de colonne phase/brique — voir la matrice de couverture (M6).
> **Convention** : liens et nœuds mermaid au **nom complet du fichier** (`[[{{US1}}-{{slug}}]]`,
> `click {{US1}} "../M2-user-stories/{{US1}}-{{slug}}.md"`).

> {{intention de l'épic}}.

## User Stories de cet épic
{{[[US1-nom]] · [[US2-nom]] · …}}

| US | Nom |
|---|---|
| {{[[US1-nom]]}} | {{titre}} |

## Relations (mermaid)
```mermaid
flowchart TB
  EP["Épic {{lettre}} · {{titre}}"]
  EP --> {{US1}}["{{US1}} · {{titre US1}}"]
  click {{US1}} "../M2-user-stories/{{US1}}-{{slug}}.md"
```

## Liens
Maillon [[README|M3 index]] · Phasage [../M5-phasage/README.md](../M5-phasage/README.md) · Plan & matrice [../M6-plan-technique/README.md](../M6-plan-technique/README.md)
