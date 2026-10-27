---
id: UC-DB-11
titre: "Écrire les tables métier en SQL brut"
theme: "UC-DB · TechDB"
moteurs:
  java: ok
  socle-py: ok
  socle-py-django: ok
contrat: "5.9"
mecanismes: "insert_tenant, query_tenant, DDL selon le dialecte"
---

# UC-DB-11 — Écrire les tables métier en SQL brut

## Questions auxquelles répond ce cas d'usage
1. Puis-je travailler en SQL direct plutôt qu'avec un ORM ?
2. Comment garder l'isolation par tenant quand on écrit soi-même ses requêtes ?
3. Qui crée la table — faut-il un script d'initialisation ?
4. Comment écrire une création de table qui marche sur les deux moteurs de base ?
5. Quand le SQL brut est-il préférable à l'ORM, et quand est-ce un mauvais choix ?
6. Comment éviter l'injection dans une requête construite ?

## Mots-clés
SQL brut, requête directe, `insert_tenant`, `query_tenant`, `execute`, `query`,
paramètres liés, injection SQL, DDL, création de table, dialecte, portabilité,
`tenant_aware_worker.py`, sans ORM, performance

## Ce que c'est, et quand s'en servir
L'accès direct, avec deux opérations qui portent l'isolation : une insertion qui pose la partition,
et une lecture qui la restreint. C'est le chemin naturel dans `socle-py` (qui n'a pas d'ORM) et un
choix possible dans `socle-py-django`.

Le SQL brut se justifie pour une requête d'agrégation particulière, pour un volume qui demande une
écriture fine, ou pour une application très simple. Dès qu'il y a des règles de gestion et un
modèle qui évolue, l'ORM et les couches (UC-DOM-01) coûtent moins cher à la longue.

## Ce que le socle fait · ce qu'il interdit
Le socle fournit les opérations isolées par tenant, exécute hors de la boucle d'événements, et
laisse le choix du dialecte à la configuration. Il ne crée pas vos tables : la création relève de
l'initialisation du worker ou d'une migration.

Interdits, et ils comptent : construire une requête par concaténation de valeurs (injection), et
écrire une requête liée à un dialecte dans du code censé tourner sur les deux moteurs.

## Exemples
### Insertion et lecture isolées
```python
TABLE = "x_tenant_notes"

self.techdb.insert_tenant(tenant_context, TABLE, {"title": title})          # partition posée
rows = self.techdb.query_tenant(tenant_context,
                                f"SELECT title FROM {TABLE} ORDER BY title, x_id")
```

### Création de la table, selon le dialecte
```python
def initialize(self) -> None:
    if self.techdb.settings.vendor == "postgres":
        auto = "BIGSERIAL PRIMARY KEY"
    else:
        auto = "BIGINT AUTO_INCREMENT PRIMARY KEY"
    self.techdb.execute(
        f"CREATE TABLE IF NOT EXISTS {TABLE} ("
        f"x_id {auto}, x_partition VARCHAR(30) NOT NULL, title VARCHAR(200) NOT NULL)")
```

### Paramètres liés — toujours
```python
rows = self.techdb.query("SELECT title FROM x_tenant_notes WHERE title LIKE %s", (f"%{motif}%",))
# JAMAIS : f"… WHERE title LIKE '%{motif}%'"
```

### Socle Java
```java
techDb.insertTenant(tenant, "x_tenant_notes", Map.of("title", title));
```

## Pièges courants
- **Concaténer une valeur dans la requête** : injection SQL, y compris depuis une action validée
  (la validation n'échappe rien).
- **Oublier la partition** en écrivant soi-même l'insertion : utiliser l'opération dédiée plutôt
  qu'une insertion nue.
- **Un `SELECT *` sur une table partagée** : on remonte des colonnes qu'on ne contrôle pas, et on
  casse à la première migration.
- **Du DDL de dialecte** dans du code partagé entre moteurs de base.
- **Trier sans clé de départage** : l'ordre varie d'une exécution à l'autre.

## Cas d'usage voisins
- UC-DB-09 — isoler les données métier par tenant
- UC-DOM-01 — modéliser une entité métier avec l'ORM
- UC-DB-02 — choisir le moteur
- UC-DB-12 — bases applicatives tierces
