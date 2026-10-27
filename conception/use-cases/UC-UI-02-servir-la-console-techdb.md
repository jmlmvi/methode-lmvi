---
id: UC-UI-02
titre: "Servir la console TechDB"
theme: "UC-UI · Pages et frontend"
moteurs:
  java: ok
  socle-py: P-3
  socle-py-django: P-3
contrat: "5.9"
mecanismes: "page de console, lecture seule, API SQL bridée"
---

# UC-UI-02 — Servir la console TechDB

## Questions auxquelles répond ce cas d'usage
1. Comment inspecter la base technique depuis un navigateur ?
2. La console permet-elle d'écrire, ou seulement de lire ?
3. Comment est-elle protégée, et par quel titre d'accès ?
4. Quelles limites s'appliquent aux requêtes lancées depuis la console ?
5. Dans les moteurs Python, où en est cette page ?
6. Est-ce raisonnable de l'activer en production ?

## Mots-clés
console TechDB, page, navigateur, lecture seule, API SQL bridée, limites,
débit, protection par clé, activation, `socle.techdb.console.enabled`,
production, diagnostic, P-3

## Ce que c'est, et quand s'en servir
Une page d'inspection de la base technique, adossée à l'API de lecture bridée (UC-DB-04) : lister
les tables, regarder les dernières lignes, lancer une lecture bornée. Cela évite d'ouvrir un accès
réseau à la base pour un diagnostic.

## Ce que le socle fait · ce qu'il interdit
Java : la console existe, protégée, en lecture seule, avec les limites de l'API sous-jacente. Son
activation est une clé de configuration. Moteurs Python : phase **P-3**.

Ce qu'il ne faut pas faire : une console maison qui accepte du SQL libre. Sans les restrictions de
l'API bridée, c'est un accès d'administration de base de données exposé sur le web.

## Exemples
### Configuration (Java)
```yaml
socle:
  techdb:
    console:
      enabled: ${TECHDB_CONSOLE_ENABLED:false}
      path: ${TECHDB_CONSOLE_PATH:/hub/techdb}
```

### Moteurs Python — en attendant P-3
```bash
sqlite3 data/socle-techdb.sqlite3 ".tables"
psql "$TECHDB_PG_URL" -c "SELECT worker_name, state FROM techdb_worker_states;"
```

## Pièges courants
- **L'activer en production sans y penser** : une page de plus sur une surface sensible. Décider,
  et tracer la décision.
- **Croire qu'elle montre les données métier** : elle montre ce que le socle expose.
- **Y corriger des données** : une correction passe par une action, auditée.
- **Oublier la limite de lignes** : une requête large ralentit l'instance.

## Cas d'usage voisins
- UC-DB-08 — console TechDB d'exploitation
- UC-DB-04 — interroger la TechDB en SQL
- UC-UI-01 — servir le tableau de bord des workers
- UC-SEC-07 — fermer par défaut les surfaces non publiques
