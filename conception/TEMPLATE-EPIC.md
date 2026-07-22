<!-- KIT-VERSION: 1.8.0 -->
<!-- PROUVE-SUR: — (niveau Feature v1.8 non prouvé ; chaîne de base prouvée sur Régie kit v1.0) -->
# Épic {{lettre}} · {{titre}}

> Template d'une **fiche épic** (maillon M3 — l'étage haut du regroupement **Épic → Feature → US**).
> Nom de fichier `{{lettre}}-{{slug}}.md`. L'épic regroupe des **features** (fiches
> `TEMPLATE-FEATURE.md`, même dossier) ; les US détaillées vivent dans **M2** — ici on **relie**.
> **Axe métier uniquement** : pas de colonne phase/brique — voir la matrice de couverture (M6).
> **Convention** : liens et nœuds mermaid au **nom complet du fichier** (`[[{{US1}}-{{slug}}]]`,
> `click {{US1}} "../M2-user-stories/{{US1}}-{{slug}}.md"`).

> {{intention de l'épic}}.

## Features de cet épic
{{[[F-X1-nom]] · [[F-X2-nom]] · …}}

| Feature | Intention | US |
|---|---|---|
| {{[[F-X1-nom]]}} | {{capacité démontrable}} | {{[[US1-nom]] [[US2-nom]]}} |

## Relations (mermaid)
```mermaid
flowchart TB
  EP["Épic {{lettre}} · {{titre}}"]
  EP --> {{F1}}["{{F-X1}} · {{titre feature}}"]
  {{F1}} --> {{US1}}["{{US1}} · {{titre US1}}"]
  click {{F1}} "{{F-X1}}-{{slug}}.md"
  click {{US1}} "../M2-user-stories/{{US1}}-{{slug}}.md"
```

## Liens
Maillon [[README|M3 index]] · Phasage [../M5-phasage/README.md](../M5-phasage/README.md) · Plan & matrice [../M6-plan-technique/README.md](../M6-plan-technique/README.md)
