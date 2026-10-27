---
id: UC-FIL-03
titre: "Éditer ces fichiers depuis FrontendEditorZen"
theme: "UC-FIL · Repository et fichiers"
moteurs:
  java: ok
  socle-py: hors
  socle-py-django: hors
contrat: "5.9"
mecanismes: "éditeur, API repository, rôles, prévisualisation"
---

# UC-FIL-03 — Éditer ces fichiers depuis FrontendEditorZen

## Questions auxquelles répond ce cas d'usage
1. Avec quel outil un fonctionnel modifie-t-il les définitions ?
2. Qui a le droit d'éditer quoi ?
3. Peut-on prévisualiser l'effet d'une modification avant de l'appliquer ?
4. Comment éviter deux modifications concurrentes qui s'écrasent ?
5. Dans les moteurs Python, cet outil s'applique-t-il ?
6. Comment organiser la validation métier d'un changement avant mise en service ?

## Mots-clés
éditeur, FrontendEditorZen, édition, rôles, droits, prévisualisation,
concurrence, écrasement, verrou, validation métier, circuit d'approbation,
environnement de recette, hors périmètre

## Ce que c'est, et quand s'en servir
L'interface d'édition des fichiers du dépôt : un fonctionnel y modifie des définitions sans toucher
au code ni au dépôt de sources.

Ce qui fait la différence entre un outil utile et un risque, ce n'est pas l'éditeur : c'est le
**circuit** autour. Qui peut éditer, qui valide, où l'on essaie avant la production.

## Ce que le socle fait · ce qu'il interdit
Java : l'éditeur s'appuie sur l'API du dépôt, avec les droits associés. Moteurs Python : **hors
périmètre**, puisque le dépôt lui-même l'est.

Deux manques classiques, à combler par l'organisation plus que par l'outil : l'édition **concurrente**
(deux personnes modifient le même fichier, la dernière écrase la première — il faut un verrou ou une
détection de conflit) et l'**essai avant mise en service** (une modification appliquée directement en
production est un déploiement sans test).

## Exemples
### Le circuit minimal, quel que soit l'outil
```
éditer → valider (schéma + cohérence) → essayer sur un environnement de recette → appliquer
```

### Moteurs Python — l'équivalent par la configuration
```bash
# La modification passe par le dépôt de sources : revue, test, livraison.
git commit -m "pricing: palier grand compte à 5 %"
```
C'est moins souple qu'un éditeur, mais le circuit — revue, essai, trace — est intégré.

## Pièges courants
- **Éditer directement en production** : aucun essai, aucun retour arrière simple.
- **Pas de détection de conflit** : la dernière écriture gagne, en silence.
- **Droits d'édition trop larges** : un fichier qui change le comportement est du code.
- **Aucune trace de qui a modifié quoi** : impossible d'expliquer un changement de comportement.

## Cas d'usage voisins
- UC-FIL-01 — exposer un dépôt de fichiers éditables
- UC-FIL-04 — versionner et auditer les modifications
- UC-UI-05 — servir un formulaire piloté par un schéma
- UC-FIL-02 — déclarer un type de fichier et son validateur
