---
id: UC-DB-08
titre: "Console TechDB d'exploitation"
theme: "UC-DB · TechDB"
moteurs:
  java: ok
  socle-py: P-3
  socle-py-django: P-3
contrat: "5.9"
mecanismes: "console HTML, lecture seule, I2"
---

# UC-DB-08 — Console TechDB d'exploitation

## Questions auxquelles répond ce cas d'usage
1. Existe-t-il une interface pour regarder la base technique sans outil externe ?
2. Qui a le droit d'y accéder, et comment est-elle protégée ?
3. Peut-on y écrire, ou seulement consulter ?
4. En quoi diffère-t-elle d'un client de base de données classique ?
5. Dans les moteurs Python, par quoi la remplacer aujourd'hui ?
6. Est-ce raisonnable de l'exposer en production ?

## Mots-clés
console, interface web, page d'exploitation, lecture seule, inspection, tables,
`techdb_*`, protection par clé, administration, diagnostic, Jinja2, Alpine.js,
accès production, P-3

## Ce que c'est, et quand s'en servir
Une page servie par l'application pour inspecter la base technique : lister les tables, regarder les
dernières lignes, lancer une lecture bornée. L'intérêt est d'éviter d'ouvrir un accès réseau à la
base pour un simple diagnostic.

C'est un confort d'exploitation, pas un outil de développement : en développement, on travaille
directement sur la base locale.

## Ce que le socle fait · ce qu'il interdit
Java : la console fait partie des pages d'exploitation, protégée comme les autres surfaces
d'administration, et adossée à l'API de lecture (UC-DB-04) — donc en lecture seule, avec ses
limites.

**Moteurs Python : phase P-3**, avec l'ensemble des pages d'exploitation. En attendant, le
diagnostic passe par les actions et les statistiques.

Ce qu'il ne faut pas faire : bricoler une page qui prend du SQL libre. Sans les restrictions de
l'API de lecture, c'est une porte d'administration de base de données exposée sur le web.

## Exemples
### Socle Java
```bash
# Page protégée par la clé d'administration (RG-15)
open https://mon-app.thesocle.net/hub/techdb
```

### Moteurs Python — en attendant
```bash
curl -H "X-Admin-Key: $ADMIN_API_KEY" localhost:8080/admin/workers | jq
sqlite3 data/socle-techdb.sqlite3 ".tables"
```

## Pièges courants
- **L'exposer sans protection** : la liste des surfaces protégées par défaut inclut ces pages, et
  c'est précisément pour cette raison.
- **S'en servir pour corriger des données** : une console de lecture n'est pas un outil de
  correction. Une correction passe par une action, tracée et auditée.
- **Confondre avec la console d'une base** : on y voit ce que le socle expose, pas la base entière.

## Cas d'usage voisins
- UC-DB-04 — interroger la TechDB en SQL
- UC-UI-02 — servir la console TechDB
- UC-SEC-07 — fermer par défaut les surfaces non publiques
- UC-SUP-12 — tableau de bord d'exploitation
