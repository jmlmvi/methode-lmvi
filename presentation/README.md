# Présentation — la méthode Besoin→Plan

`Besoin2Plan-la-methode.pptx` : 32 diapositives qui expliquent la méthode (kit 1.16.0) et justifient chacune de ses règles.

| Partie | Contenu |
|---|---|
| 01 La chaîne | les huit maillons M0→M7, les six arrêts, les profils, la matrice de couverture, le routage |
| 02 Les contrepoids | les sept contrôles adversariaux : relecture par un autre modèle (exemple réel Your360), `[À ARBITRER]`, script, contrôle avant go, boucles de retour |
| 03 Les tests | la preuve externe, les tests alignés sur les axes, la matrice des droits devenue tests négatifs, la gate d'écran, zéro simulation |
| 04 Historique | 1.0 → 1.16, le constat à l'origine de chaque règle, la méthode soumise à ses propres règles |

Chaque chiffre a sa source dans les **notes de l'orateur**.
Graphisme repris de `09-CONTENUS-THESOCLE/PowerPoint/` (dépôt TheHub4TheSocle) : `_source/commun.js` et `_source/couches.js` en sont des copies ; seul le pied de page change.

## Reconstruire

```bash
# modules : pptxgenjs, react-icons, react, react-dom, sharp (hors dépôt)
NODE_PATH=<node_modules> APPLY_THEME=<skill pptx>/scripts/apply_theme.js node _source/construire.js
```

## À mettre à jour quand…

- le kit change de version : diapositives « Quatre mois, seize versions », « Chaque règle a sa cicatrice » et « Où en est la méthode » ;
- les catalogues changent (44 guides, 148 fiches, 61 howtos de packs) : `couches.js` (routage) et « Où en est la méthode ».
