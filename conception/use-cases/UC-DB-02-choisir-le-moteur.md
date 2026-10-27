---
id: UC-DB-02
titre: "Choisir le moteur de base — H2, PostgreSQL, SQLite"
theme: "UC-DB · TechDB"
moteurs:
  java: ok
  socle-py: ok
  socle-py-django: ok
contrat: "5.9"
mecanismes: "socle.techdb.backend, TECHDB_URL, h2, postgres, sqlite"
---

# UC-DB-02 — Choisir le moteur de base : H2, PostgreSQL, SQLite

## Questions auxquelles répond ce cas d'usage
1. Quelle base utiliser en développement, et laquelle en production ?
2. Comment bascule-t-on de l'une à l'autre — code ou configuration ?
3. H2 est une base Java : comment un backend Python s'en sort-il ?
4. Mon SQL écrit pour H2 fonctionnera-t-il sur PostgreSQL ?
5. Comment vérifier, au démarrage, quel moteur est réellement utilisé ?
6. Faut-il des migrations différentes selon le moteur ?
7. Où est stocké le fichier de base en mode local ?

## Mots-clés
H2, PostgreSQL, SQLite, `socle.techdb.backend`, `TECHDB_BACKEND`, `TECHDB_URL`, `TECHDB_PATH`,
bascule, portabilité SQL, `MERGE`, `DATEADD`, dialecte, `[step:techdb_initialized]`,
`[step:techdb_h2_served_by_sqlite]`, développement, production

## Ce que c'est, et quand s'en servir
Le moteur de la base technique est un **choix de configuration**, pas de code : un fichier local
pour développer, un serveur PostgreSQL en production. Le schéma et le comportement observable
restent les mêmes — c'est ce que la suite de conformité vérifie (UC-CTR-02).

Particularité des moteurs Python : H2 est une base Java. Le backend `h2` y est servi par un fichier
SQLite, ce qui donne le même confort local sans dépendance à la machine virtuelle Java. Le journal
de démarrage le dit explicitement, pour qu'il n'y ait pas de malentendu.

## Ce que le socle fait · ce qu'il interdit
Le socle lit le moteur et l'adresse dans la configuration, ouvre la base, applique les migrations
et journalise ce qu'il a fait : moteur retenu, dialecte réel, chemin du fichier le cas échéant.

Ce qu'il ne peut pas faire : rendre portable un SQL qui ne l'est pas. Le SQL propre à un dialecte
(fusion de lignes, arithmétique de dates) a déjà causé des correctifs côté Java lorsqu'un backend
PostgreSQL est apparu. La règle est donc : du SQL standard, ou l'ORM, et jamais une astuce de
dialecte dans du code partagé.

## Exemples
### Configuration
```yaml
socle:
  techdb:
    enabled: ${TECHDB_ENABLED:true}
    backend: ${TECHDB_BACKEND:h2}            # h2 | postgres | sqlite
    url: ${TECHDB_URL:jdbc:h2:file:./data/socle-techdb;AUTO_SERVER=TRUE}
```
```bash
# Production : PostgreSQL
TECHDB_BACKEND=postgres TECHDB_URL=jdbc:postgresql://db:5432/techdb socle-py-django run
```

### Vérifier au démarrage
```
… INFO socle.techdb.db.techdb - [step:techdb_h2_served_by_sqlite] data/socle-techdb.sqlite3
… INFO socle.techdb.db.techdb - [step:techdb_initialized] backend=h2 vendor=sqlite alias=default
```

### Tester sur les deux
```bash
.venv/bin/pytest -q                                                            # SQLite
SOCLE_TEST_PG_URL=jdbc:postgresql://127.0.0.1:15432/techdb .venv/bin/pytest -q  # + PostgreSQL
```

## Pièges courants
- **Développer sur un moteur et livrer sur un autre sans jamais tester le second** : les écarts se
  révèlent en production. La suite de tests sait jouer sur les deux.
- **Écrire du SQL de dialecte** : il casse à la bascule. Préférer l'ORM ou du SQL standard.
- **Oublier le volume du fichier local** : en mode fichier, la base vit dans le dossier de données
  de l'application — à exclure des images et des sauvegardes de code.
- **Croire l'adresse purement cosmétique** : la forme de l'URL détermine le dialecte retenu.

## Cas d'usage voisins
- UC-DB-01 — persister l'état technique
- UC-DB-03 — migrations tracées
- UC-CTR-02 — jouer la suite de conformité
- UC-DEV-06 — construire et lancer la pile Docker
