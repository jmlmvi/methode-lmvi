<!-- KIT-VERSION: 1.8.0 -->
<!-- PROUVE-SUR: — -->
# Feature {{code}} · {{titre}}

> Template d'une **fiche feature** (maillon M3 — l'étage intermédiaire du regroupement métier
> **Épic → Feature → US**). Nom de fichier `{{code}}-{{slug}}.md`, dans `M3-epics/` avec les épics.
> Une feature = une **capacité démontrable d'un bloc** — plus fine que l'épic (thème de valeur),
> plus large que l'US (intention testable) ; c'est l'unité naturelle du phasage (M5).
> **Axe métier uniquement** : ni phase ni brique — voir la matrice de couverture (M6).
> **Feature-enveloppe** (petit chantier) : même périmètre que son épic — le déclarer ici.

| | |
|---|---|
| **Nom** | {{titre}} |
| **Code** | `{{code}}` (identifiant stable, ex. `F-B1`) |
| **Épic (propriétaire)** | [[{{epic-note}}]] · {{lettre}} — {{titre épic}} |
| **Capacité démontrable** | {{1 phrase : « on peut … » — formulable telle quelle en gate M5}} |
| **Statut** | à faire *(dérivé de ses US : à faire · en cours · livrée)* |

## User Stories de cette feature
{{[[US1-nom]] · [[US2-nom]] · …}}

| US | Nom |
|---|---|
| {{[[US1-nom]]}} | {{titre US1}} |

## Relations (mermaid)
```mermaid
flowchart TB
  EP["Épic {{lettre}} · {{titre épic}}"] --> FT["{{code}} · {{titre}}"]
  FT --> {{US1}}["{{US1}} · {{titre US1}}"]
  click EP "{{epic-note}}.md"
  click {{US1}} "../M2-user-stories/{{US1}}-{{slug}}.md"
```

## Liens
Épic [[{{epic-note}}]] · Maillon [[README|M3 index]] · Phase & brique par US :
[matrice de couverture](../M6-plan-technique/README.md)
