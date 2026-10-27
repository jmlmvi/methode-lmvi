---
id: UC-CFG-05
titre: "Basculer par profils d'environnement"
theme: "UC-CFG · Configuration"
moteurs:
  java: ok
  socle-py: hors
  socle-py-django: hors
contrat: "5.9"
mecanismes: "profils Spring, fichiers par environnement, hors périmètre Python"
---

# UC-CFG-05 — Basculer par profils d'environnement

## Questions auxquelles répond ce cas d'usage
1. Comment avoir une configuration différente en développement, en intégration et en production ?
2. Les profils existent-ils dans les moteurs Python ?
3. Par quoi les remplacer quand ils n'existent pas ?
4. Faut-il un fichier de configuration par environnement dans le dépôt ?
5. Comment éviter qu'un réglage de développement parte en production ?
6. Comment savoir, sur une instance, quelle configuration est réellement appliquée ?

## Mots-clés
profil, `spring.profiles.active`, environnement, développement, intégration, production,
fichier par environnement, variables d'environnement, douze facteurs, `ENV_NAME`,
hors périmètre, surcharge, `--config`

## Ce que c'est, et quand s'en servir
Le mécanisme de profils du Socle Java : un même fichier porte des blocs par environnement, et le
profil actif décide. Pratique quand les différences sont nombreuses et structurelles.

Dans les moteurs Python, c'est **hors périmètre déclaré**. L'approche retenue y est celle des
variables d'environnement : un seul fichier de configuration, toutes les valeurs variables en
variables, et l'environnement qui décide. C'est plus simple, et c'est ce qu'attendent les plateformes
de déploiement.

## Ce que le socle fait · ce qu'il interdit
Java : le profil actif sélectionne les blocs de configuration. Python : un fichier, une substitution
d'environnement, et la possibilité de désigner un autre fichier au lancement.

Ce qu'il ne faut pas faire dans les moteurs Python : empiler des fichiers par environnement dans le
dépôt et choisir par un `if` au démarrage. On reconstruit un mécanisme de profils sans ses
garde-fous, et on finit par livrer le mauvais fichier.

## Exemples
### Socle Java
```bash
java -jar app.jar --spring.profiles.active=production
```

### Moteurs Python — l'environnement décide
```bash
# Développement
TECHDB_BACKEND=h2 ALLOW_INSECURE_ADMIN=true socle-py-django run
# Production (valeurs injectées par la plateforme)
TECHDB_BACKEND=postgres TECHDB_URL=… ADMIN_API_KEY=… TRUSTED_PROXIES=10.0.0.4 socle-py-django run
```

### Un fichier distinct, quand c'est vraiment nécessaire
```bash
socle-py-django run --config ./application-integration.yml
```

### Savoir ce qui est appliqué
```yaml
socle:
  env_name: ${ENV_NAME:dev}      # annoncé par l'instance, visible en exploitation
```

## Pièges courants
- **Un fichier par environnement dans le dépôt** : tôt ou tard, le mauvais est livré.
- **Des réglages de développement par défaut** : ils deviennent la production si personne ne décide.
- **Aucune trace de l'environnement** sur l'instance : impossible de savoir ce qu'on regarde.
- **Attendre des profils en Python** : ils n'existent pas, et ce n'est pas un oubli.

## Cas d'usage voisins
- UC-CFG-01 — configurer par fichier
- UC-CFG-03 — refuser une configuration invalide
- UC-SEC-12 — lire ses secrets au démarrage
- UC-DEV-06 — construire et lancer la pile Docker
