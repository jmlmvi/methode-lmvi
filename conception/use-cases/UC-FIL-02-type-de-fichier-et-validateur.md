---
id: UC-FIL-02
titre: "Déclarer un type de fichier et son validateur"
theme: "UC-FIL · Repository et fichiers"
moteurs:
  java: ok
  socle-py: hors
  socle-py-django: hors
contrat: "5.9"
mecanismes: "FileTypes, validateurs, refus à l'enregistrement"
---

# UC-FIL-02 — Déclarer un type de fichier et son validateur

## Questions auxquelles répond ce cas d'usage
1. Comment empêcher l'enregistrement d'un fichier de définition invalide ?
2. Où déclare-t-on les types de fichiers acceptés et leurs règles ?
3. La validation se fait-elle à l'écriture ou au chargement ?
4. Que doit contenir un message de refus pour être utile à un fonctionnel ?
5. Dans les moteurs Python, comment valider une définition en configuration ?
6. Comment éviter qu'un fichier valide casse quand même l'application ?

## Mots-clés
type de fichier, `FileTypes`, validateur, validation, refus, message d'erreur,
enregistrement, chargement, schéma, extension, définition, cohérence,
hors périmètre, démarrage

## Ce que c'est, et quand s'en servir
Si des fichiers pilotent le comportement, il faut les valider **avant** de les accepter. Un type de
fichier déclare son extension, son schéma et ses règles de cohérence ; un validateur refuse ce qui
ne passe pas, avec un message exploitable par la personne qui édite.

## Ce que le socle fait · ce qu'il interdit
Java : les types de fichiers et leurs validateurs sont déclarés et appliqués par le dépôt.

Moteurs Python : **hors périmètre** pour le dépôt, mais le principe s'applique à la configuration :
une définition lue au démarrage doit être validée au démarrage, et une configuration incohérente
doit empêcher le démarrage (UC-CFG-03) plutôt que de produire une erreur au premier appel.

Le piège qui subsiste même avec un validateur : la **validité syntaxique ne fait pas la
cohérence**. Un fichier bien formé peut référencer un champ inexistant. La validation utile vérifie
aussi les références.

## Exemples
### Valider une définition de configuration au démarrage
```python
def initialize(self) -> None:
    grille = self._charger_grille()
    if not grille.tiers:
        raise ValueError("app.pricing.tiers : au moins un palier est requis")
    if not any(t.from_cents == 0 for t in grille.tiers):
        # Cohérence, pas seulement syntaxe : il faut un palier par défaut.
        raise ValueError("app.pricing.tiers : un palier à partir de 0 est requis")
```

### Un message exploitable
```
app.pricing.tiers[2].rate = "zéro" : un nombre décimal est attendu (ex. 0.05)
```

### Socle Java
Les validateurs sont associés aux types de fichiers du dépôt et refusent l'enregistrement.

## Pièges courants
- **Valider seulement la syntaxe** : un fichier bien formé mais incohérent passe.
- **Valider au chargement seulement** : l'auteur de la modification n'est plus là quand l'erreur
  apparaît.
- **Un message illisible** : le fonctionnel ne peut pas corriger seul.
- **Pas de palier ou de cas par défaut** : des cas non couverts à l'exécution.

## Cas d'usage voisins
- UC-FIL-01 — exposer un dépôt de fichiers éditables
- UC-CFG-03 — refuser une configuration invalide
- UC-RUL-02 — choisir le type de nœud adapté
- UC-FIL-05 — charger des définitions au démarrage
