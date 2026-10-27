---
id: UC-DB-12
titre: "Travailler avec des bases applicatives tierces"
theme: "UC-DB · TechDB"
moteurs:
  java: ok
  socle-py: hors
  socle-py-django: hors
contrat: "5.9"
mecanismes: "H2DatabaseWorker, PostgresqlDatabaseWorker, MariadbDatabaseWorker"
---

# UC-DB-12 — Travailler avec des bases applicatives tierces

## Questions auxquelles répond ce cas d'usage
1. Comment lire ou écrire dans une base qui n'est pas la base technique du socle ?
2. Existe-t-il des workers fournis pour les moteurs courants ?
3. Puis-je ouvrir moi-même une connexion depuis un worker Python ?
4. Comment gérer le cycle de vie d'une connexion dans un worker ?
5. Que faire quand la base tierce est indisponible — le worker doit-il se déclarer malade ?
6. Comment éviter de mélanger données techniques et données d'un système tiers ?

## Mots-clés
base tierce, base applicative, `H2DatabaseWorker`, `PostgresqlDatabaseWorker`,
`MariadbDatabaseWorker`, connexion, pool, cycle de vie, indisponibilité, santé,
hors périmètre, legacy, intégration, lecture externe

## Ce que c'est, et quand s'en servir
Beaucoup d'applications doivent parler à une base **qui ne leur appartient pas** : un entrepôt, un
système historique, une base de référence. Le Socle Java fournit des workers dédiés par moteur, qui
tiennent la connexion et son cycle de vie.

Dans les moteurs Python, c'est **hors périmètre déclaré**. Rien n'interdit d'y accéder, mais rien
n'est fourni : la connexion, son pool, sa santé et ses protections sont à votre charge, et la
responsabilité est entière.

## Ce que le socle fait · ce qu'il interdit
Java : les workers de base gèrent l'ouverture, la fermeture, l'état de santé et exposent des
actions de requête — avec les mêmes protections que le reste.

Python : la base technique est la seule base que le socle connaît. Si vous ouvrez une connexion
tierce, trois règles tiennent lieu de garde-fous : l'ouvrir à l'initialisation et la fermer à
l'arrêt (pas dans chaque cycle), ne jamais la toucher depuis la boucle d'événements (code synchrone,
hors boucle), et refléter son indisponibilité dans la santé du worker plutôt que de la laisser
remonter en panne silencieuse.

Et surtout : ne pas mettre les données d'un système tiers dans les tables du socle « en attendant ».

## Exemples
### Socle Java
```java
@Autowired private PostgresqlDatabaseWorker externalDb;
List<Map<String, Object>> rows = externalDb.query("SELECT id, label FROM referentiel");
```

### Moteurs Python — à votre charge, avec discipline
```python
class LegacyWorker(Worker):
    def initialize(self) -> None:
        # Ouverture UNE fois, à l'initialisation ; jamais dans do_work.
        self._pool = psycopg_pool.ConnectionPool(self._dsn, min_size=1, max_size=4,
                                                 timeout=5.0)
        self._available = True

    def do_work(self) -> None:          # synchrone : exécuté hors de la boucle d'événements
        try:
            with self._pool.connection() as conn:
                rows = conn.execute("SELECT id, label FROM referentiel").fetchall()
            self._available = True
        except psycopg.OperationalError:
            self._available = False     # la santé dit la vérité
            raise

    def is_healthy(self) -> bool:
        return self._available

    def stop(self) -> None:
        self._pool.close()
```

## Pièges courants
- **Ouvrir une connexion par cycle** : on épuise le serveur d'en face.
- **Toucher la base tierce depuis du code asynchrone** : on bloque toute l'instance.
- **Se déclarer sain alors que la base est injoignable** : le superviseur et les sondes mentent.
- **Copier les données tierces dans les tables du socle** : le schéma `techdb_*` appartient au
  contrat.
- **Pas de délai sur la connexion** : une base lente devient une instance bloquée.

## Cas d'usage voisins
- UC-DB-01 — persister l'état technique
- UC-WRK-10 — worker d'appel externe protégé
- UC-WRK-11 — travail bloquant ou asynchrone
- UC-WRK-08 — publier santé et statistiques
