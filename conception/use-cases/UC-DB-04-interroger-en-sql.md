---
id: UC-DB-04
titre: "Interroger la TechDB en SQL en lecture seule"
theme: "UC-DB · TechDB"
moteurs:
  java: ok
  socle-py: P-3
  socle-py-django: P-3
contrat: "5.9"
mecanismes: "API SQL de la TechDB, lecture seule, débit limité, techdb_query"
---

# UC-DB-04 — Interroger la TechDB en SQL en lecture seule

## Questions auxquelles répond ce cas d'usage
1. Comment inspecter la base technique d'une instance en production sans s'y connecter ?
2. Peut-on exécuter n'importe quelle requête, ou seulement des lectures ?
3. Comment cette API est-elle protégée contre un usage abusif ?
4. Pourquoi ma requête sur certaines colonnes est-elle refusée ?
5. Un agent IA peut-il s'en servir pour diagnostiquer un incident ?
6. Dans les moteurs Python, cette API existe-t-elle, et sinon comment faire ?

## Mots-clés
API SQL, requête, lecture seule, `SELECT`, interdiction d'écriture, débit limité,
60 requêtes par minute, `techdb_query`, diagnostic, exploitation, filtrage de mots-clés,
`CAST`, CLOB, console, P-3

## Ce que c'est, et quand s'en servir
Une porte de lecture sur la base technique, exposée comme une action : on envoie une requête, on
reçoit des lignes. C'est l'outil de diagnostic d'un exploitant ou d'un agent — comprendre pourquoi
un worker a échoué, retrouver un audit, compter des événements — sans ouvrir un accès à la base.

Quand la question se répète, on ne laisse pas l'exploitant écrire du SQL : on en fait une action
dédiée du worker concerné (UC-DB-05), avec des paramètres bornés.

## Ce que le socle fait · ce qu'il interdit
Java : l'action n'accepte que de la lecture, limite le débit, et filtre les requêtes. Un point
d'expérience utile : le filtre de mots-clés a d'abord refusé des colonnes légitimes du socle, parce
qu'il cherchait des sous-chaînes ; il travaille désormais en limite de mot. Autre détail connu : sur
H2, lire une colonne de type texte long demande un transtypage explicite.

**Moteurs Python : phase P-3.** En attendant, on diagnostique par les actions du worker, par les
statistiques, et — en développement — directement sur le fichier de base. Ce qu'il ne faut pas
faire : exposer une action maison qui prend du SQL libre sans ni restriction de lecture, ni limite
de débit, ni filtrage. Ce serait une porte ouverte sur l'ensemble des données.

## Exemples
### Socle Java — par l'action
```bash
curl -X POST -H "X-Admin-Key: $ADMIN_API_KEY" -H "Content-Type: application/json" \
  -d '{"sql":"SELECT WORKER_NAME, STATE FROM TECHDB_WORKER_STATES ORDER BY X_ID DESC"}' \
  localhost:8080/admin/workers/techdb_worker/actions/techdb_query
```

### Le piège du texte long sur H2
```sql
SELECT X_ID, CAST(DATAS AS VARCHAR(2048)) AS DATAS FROM TECHDB_API_RESULTS LIMIT 20;
```

### Moteurs Python — en attendant
```bash
# En développement, sur le fichier local
sqlite3 data/socle-techdb.sqlite3 \
  "SELECT worker_name, action_name, success FROM techdb_worker_actions ORDER BY x_id DESC LIMIT 10;"
```

## Pièges courants
- **Exposer du SQL libre sans garde-fous** : lecture seule, débit, filtrage — les trois, ou rien.
- **Oublier le transtypage** sur les colonnes de texte long en H2 : la valeur revient vide ou
  illisible.
- **Faire du SQL un usage applicatif** : cette porte est un outil de diagnostic, pas une API de
  données. Les besoins récurrents deviennent des actions.
- **Laisser une requête lourde sans limite de lignes** : on charge l'instance pour un diagnostic.

## Cas d'usage voisins
- UC-DB-05 — lire les événements récents par action
- UC-DB-08 — console TechDB d'exploitation
- UC-ACT-04 — exiger un scope
- UC-ACT-06 — auditer les invocations
