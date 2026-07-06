# Slot 7 · Standard tables PostgreSQL (THESOCLE)

Le standard des tables — **embarqué dans la méthode** (pas seulement pointé).

| Fichier | Contenu |
|---|---|
| `specsTablesPgsql.md` | le **standard officiel** : champs `x_*`, séquences, 4 triggers, nommage FK `id_*`, préfixes `z_/db_/tr_` |
| `STANDARD-thesocle-tables.sql` | **SQL prouvé (PG16/17)** : fonctions `update_changed_fields` + `z_after_insert/update/delete`, helper **`attach_thesocle_triggers(table)`**, et un **gabarit de table** (13 colonnes `x_*` + séquence + index + triggers) |

- **Source canonique** : `docs/docs-socleV005/01-docsV2/specsTablesPgsql.md` + `191-postgresql-database-worker` + l'`init.sql` de toute app THESOCLE.
- **Instancier** : copier les fonctions/helper dans l'`init.sql` de l'app (schéma local), puis pour chaque table : bloc `x_*` + séquence + `SELECT <schema>.attach_thesocle_triggers('<table>')`.

> Règle (contrat §3) : 1 schéma/app, `x_partition`=tenant, owner admin. Fonctions triggers **locales au schéma** (évite le piège fonction publique).
