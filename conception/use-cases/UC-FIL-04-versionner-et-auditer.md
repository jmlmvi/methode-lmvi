---
id: UC-FIL-04
titre: "Versionner et auditer les modifications de fichiers"
theme: "UC-FIL · Repository et fichiers"
moteurs:
  java: ok
  socle-py: hors
  socle-py-django: hors
contrat: "5.9"
mecanismes: "historique, auteur, horodatage, retour arrière"
---

# UC-FIL-04 — Versionner et auditer les modifications de fichiers

## Questions auxquelles répond ce cas d'usage
1. Comment savoir qui a modifié une définition, et quand ?
2. Peut-on revenir à la version précédente d'un fichier ?
3. Comment relier un changement de comportement à une modification de fichier ?
4. Combien de versions faut-il garder ?
5. Dans les moteurs Python, comment obtenir cette traçabilité ?
6. Faut-il un audit même quand le fichier est validé avant enregistrement ?

## Mots-clés
version, historique, auteur, horodatage, retour arrière, rollback, audit,
traçabilité, corrélation, changement de comportement, rétention des versions,
dépôt de sources, Git, hors périmètre

## Ce que c'est, et quand s'en servir
Un fichier qui change le comportement d'une application mérite le même traitement qu'un changement
de code : savoir qui l'a modifié, quand, ce qui a changé, et pouvoir revenir en arrière.

Sans cela, un comportement devenu faux est inexplicable : le code n'a pas bougé, les journaux ne
disent rien, et personne ne se souvient d'avoir touché un fichier.

## Ce que le socle fait · ce qu'il interdit
Java : le dépôt conserve l'historique des modifications avec leur auteur. Moteurs Python : **hors
périmètre** pour le dépôt — et la réponse est le dépôt de sources, qui fait exactement cela : auteur,
date, différence, retour arrière, et revue en prime.

Un point à ne pas négliger : la validation à l'enregistrement **ne remplace pas** l'audit. Un
fichier peut être valide et faux — la validation dit qu'il est bien formé, l'audit dit qui a décidé.

## Exemples
### Moteurs Python — la traçabilité par le dépôt de sources
```bash
git log --follow -p -- application.yml       # qui, quand, quoi, et pourquoi
git revert <commit>                           # retour arrière tracé
```

### Relier un changement de comportement à son origine
```bash
# La version de la grille appliquée est écrite dans la trace de décision (UC-RUL-04).
grep "grid=" logs/app.log | tail -5
```

### Socle Java
L'historique du dépôt porte l'auteur et l'horodatage de chaque modification.

## Pièges courants
- **Aucun historique** : un comportement change sans explication possible.
- **Retour arrière non testé** : on découvre qu'il ne fonctionne pas au mauvais moment.
- **Rétention infinie des versions** : le dépôt grossit sans limite.
- **Audit sans corrélation** : on sait qu'un fichier a changé, pas quelles décisions en ont
  découlé.

## Cas d'usage voisins
- UC-FIL-01 — exposer un dépôt de fichiers éditables
- UC-FIL-03 — éditer ces fichiers depuis FrontendEditorZen
- UC-RUL-04 — auditer et mettre en cache les décisions
- UC-ACT-06 — auditer les invocations
