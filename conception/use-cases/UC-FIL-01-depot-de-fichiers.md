---
id: UC-FIL-01
titre: "Exposer un dépôt de fichiers éditables"
theme: "UC-FIL · Repository et fichiers"
moteurs:
  java: ok
  socle-py: hors
  socle-py-django: hors
contrat: "5.9"
mecanismes: "repository, /api/repository, types de fichiers, OIDC"
---

# UC-FIL-01 — Exposer un dépôt de fichiers éditables

## Questions auxquelles répond ce cas d'usage
1. Comment permettre à un fonctionnel de modifier des définitions sans livraison ?
2. Quels types de fichiers peut-on exposer, et où vivent-ils ?
3. Comment l'accès est-il protégé ?
4. Que se passe-t-il quand un fichier est modifié — rechargement automatique ?
5. Dans les moteurs Python, ce dépôt existe-t-il ?
6. Quelle alternative pour rendre des définitions modifiables ?

## Mots-clés
repository, dépôt de fichiers, éditable, `/api/repository`, définitions,
JDM, scripts, interface, types de fichiers, OIDC, protection, rechargement,
hors périmètre, configuration, versions

## Ce que c'est, et quand s'en servir
Un dépôt de fichiers que l'application expose en lecture et en écriture, pour que des définitions —
modèles de décision, scripts, définitions d'écrans — soient modifiables sans livraison, par un
éditeur dédié.

C'est puissant et à manier avec prudence : ces fichiers **changent le comportement** de
l'application.

## Ce que le socle fait · ce qu'il interdit
Java : le dépôt est exposé par une API, protégée par session OIDC (c'est le chemin protégé par
défaut, UC-SEC-09), avec des types de fichiers et leurs validateurs (UC-FIL-02).

Moteurs Python : **hors périmètre déclaré**. Ce qui existe pour rendre un comportement ajustable :
la configuration (UC-CFG-04) — un seuil, une grille, un choix parmi des stratégies implémentées.
C'est moins souple et beaucoup plus sûr.

Ce qu'il ne faut surtout pas improviser : un point d'entrée d'écriture de fichiers dans
l'application. Sans validation de type, sans contrôle de chemin et sans audit, c'est une écriture
arbitraire sur le système de fichiers du serveur.

## Exemples
### Socle Java
```bash
curl -H "Authorization: Bearer $JWT" \
  localhost:8080/api/repository/ui-tables/files
```

### Moteurs Python — l'ajustable passe par la configuration
```yaml
app:
  pricing:
    strategy: ${APP_PRICING_STRATEGY:palier}      # choix fermé
    tiers:
      - {from_cents: 10000, rate: "0.05"}
      - {from_cents: 0,     rate: "0.02"}
```

### Ce qu'il ne faut pas écrire
```python
@action("write_file")                       # écriture arbitraire sur le serveur
@param("path", required=True)
@param("content", required=True)
```

## Pièges courants
- **Écriture de fichier sans contrôle de chemin** : remontée de répertoire, écrasement de code.
- **Pas de validation de type** : un fichier invalide casse l'application au prochain rechargement.
- **Pas d'audit** : personne ne sait qui a changé quoi.
- **Pas de version** : impossible de revenir en arrière.
- **Confondre configuration et code** : un fichier qui décide est du code, avec les mêmes exigences.

## Cas d'usage voisins
- UC-FIL-02 — déclarer un type de fichier et son validateur
- UC-FIL-04 — versionner et auditer les modifications
- UC-CFG-04 — lire une clé typée
- UC-SEC-09 — protéger des routes par session OIDC
