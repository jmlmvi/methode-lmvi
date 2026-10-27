---
id: UC-DB-07
titre: "Sauvegarder et restaurer la TechDB"
theme: "UC-DB · TechDB"
moteurs:
  java: ok
  socle-py: P-3
  socle-py-django: P-3
contrat: "5.9"
mecanismes: "sauvegarde, restauration, K3, cohérence"
---

# UC-DB-07 — Sauvegarder et restaurer la TechDB

## Questions auxquelles répond ce cas d'usage
1. Comment sauvegarder l'état technique d'une instance, et à quelle fréquence ?
2. Que doit-on retrouver après restauration pour considérer que c'est réussi ?
3. Peut-on sauvegarder à chaud, instance en service ?
4. Comment vérifier qu'une sauvegarde est restaurable — sans attendre l'incident ?
5. La sauvegarde contient-elle des données sensibles ?
6. Dans les moteurs Python, par quel moyen sauvegarder aujourd'hui ?
7. Faut-il sauvegarder la base technique si toutes les données métier sont ailleurs ?

## Mots-clés
sauvegarde, backup, restauration, restore, cohérence, à chaud, à froid, `pg_dump`,
fichier SQLite, reprise, plan de reprise, test de restauration, données sensibles,
chiffrement, P-3

## Ce que c'est, et quand s'en servir
Copier la base technique pour pouvoir y revenir : état des workers, offsets de reprise, audit,
événements, et les tables métier si l'application en a. La question n'est pas « est-ce utile »
mais « qu'est-ce qu'on accepte de perdre ».

Le critère de réussite est simple et exigeant : après restauration **sur une base vide**, on
retrouve les mêmes données. Une sauvegarde jamais restaurée n'est pas une sauvegarde, c'est un
fichier.

## Ce que le socle fait · ce qu'il interdit
Java : la sauvegarde et la restauration sont outillées, avec la garantie de cohérence associée.
Dans les moteurs Python, c'est la phase **P-3** ; en attendant, on s'appuie sur les outils du
moteur de base — copie du fichier local à l'arrêt, ou export du serveur à chaud.

Ce qu'il ne faut pas faire : copier un fichier de base **pendant** qu'une instance écrit dedans, et
appeler cela une sauvegarde. Le résultat est parfois lisible, parfois corrompu — et on ne le
découvre qu'au moment de restaurer.

## Exemples
### PostgreSQL — à chaud
```bash
pg_dump --no-owner --format=custom "$TECHDB_PG_URL" > techdb-$(date +%F).dump
pg_restore --clean --no-owner --dbname "$TECHDB_PG_URL_CIBLE" techdb-2026-10-15.dump
```

### Fichier local — à froid
```bash
docker compose stop app            # on n'écrit plus
cp data/socle-techdb.sqlite3 sauvegardes/techdb-$(date +%F).sqlite3
docker compose start app
```

### Éprouver la restauration
```bash
# Sur une base vide, puis comparer ce qui compte : lignes d'audit, offsets, tables métier.
psql "$CIBLE" -c "SELECT COUNT(*) FROM techdb_worker_actions;"
psql "$CIBLE" -c "SELECT key, value FROM techdb_offsets ORDER BY key;"
```

## Pièges courants
- **Copier un fichier de base à chaud** : sauvegarde potentiellement corrompue.
- **Ne jamais tester la restauration** : le jour de l'incident n'est pas le bon moment pour
  découvrir un problème de format ou de version.
- **Oublier que la sauvegarde contient de l'audit** : donc des identifiants d'appelants, parfois
  des données métier. Elle se protège comme la base.
- **Sauvegarder sans les migrations correspondantes** : restaurer un schéma plus ancien que le code
  qui va le lire, c'est une panne au démarrage.
- **Croire la base technique négligeable** : les offsets de reprise perdus, ce sont des
  retraitements ou des trous.

## Cas d'usage voisins
- UC-DB-06 — purger selon une rétention
- UC-DB-03 — migrations tracées
- UC-DB-02 — choisir le moteur
- UC-SUP-06 — drainer puis arrêter proprement
