---
id: UC-WRK-07
titre: "Injecter ses dépendances par le constructeur"
theme: "UC-WRK · Workers et cycle de vie"
moteurs:
  java: ok
  socle-py: ok
  socle-py-django: ok
contrat: "5.9"
mecanismes: "injection par type, KvBus, SocleConfig, SharedDataRegistry, TechDb"
---

# UC-WRK-07 — Injecter ses dépendances par le constructeur

## Questions auxquelles répond ce cas d'usage
1. Comment mon worker obtient-il le bus interne, la configuration ou la base technique ?
2. Puis-je créer moi-même une connexion à la base dans mon worker ?
3. Pourquoi l'annotation de type du paramètre est-elle obligatoire ?
4. Comment écrire un test unitaire d'un worker sans démarrer l'application entière ?
5. Que se passe-t-il si je demande un composant que le socle ne connaît pas ?
6. Où mettre ce qui doit être fait une seule fois, avant le premier travail ?
7. Un worker peut-il recevoir un service de mon domaine métier ?

## Mots-clés
injection, injection par constructeur, dépendances, annotée par son type, `KvBus`, `SocleConfig`,
`SharedDataRegistry`, `TechDb`, `@Component`, instanciation, `initialize`, testabilité,
double de test, singleton interdit, variable globale interdite

## Ce que c'est, et quand s'en servir
Un worker **déclare ce dont il a besoin dans son constructeur**, annoté par le type, et le socle le
lui fournit à la découverte. C'est vrai pour les composants du framework (bus interne,
configuration, registre partagé, base technique) et, en Java, pour les services du contexte.

L'intérêt est double : le worker ne sait pas d'où viennent ses dépendances — donc on peut lui en
donner d'autres en test — et le socle garde la main sur leur cycle de vie.

## Ce que le socle fait · ce qu'il interdit
Le socle lit la signature du constructeur et résout chaque paramètre **par son type**. Un paramètre
non annoté, ou d'un type qu'il ne connaît pas, fait échouer l'instanciation au démarrage — bruyamment,
plutôt que silencieusement à la première requête.

Interdits : aller chercher une dépendance dans une variable globale, construire soi-même une
connexion, instancier un autre worker. Et tout ce qui ouvre une ressource va dans l'initialisation,
pas dans le constructeur : le constructeur se contente de retenir ce qu'on lui donne.

## Exemples
### socle-py-django et socle-py
```python
class StockWorker(Worker, ActionProvider):
    def __init__(self, kv_bus: KvBus, config: SocleConfig, techdb: TechDb):
        self._kv_bus = kv_bus
        self._limits = exchanges.StockLimits(config.raw.as_int("app.stock.max", 1000))
        self._techdb = techdb          # accès à la base : toujours par le socle

    def initialize(self) -> None:
        # ce qui ne se fait qu'une fois, et qui peut échouer
        self._kv_bus.sub("stock/updated", self._on_update)
```

### Socle Java
```java
@Component
public class StockWorker implements Worker {
    private final KvBus kvBus;
    public StockWorker(KvBus kvBus) { this.kvBus = kvBus; }   // injection par constructeur
}
```

### En test, sans application
```python
worker = StockWorker(kv_bus=InMemoryKvBus(), config=load_config(env={}), techdb=fake_techdb)
```

## Pièges courants
- **Travailler dans le constructeur** : ouvrir une connexion, lire un fichier, s'abonner. Tout cela
  appartient à l'initialisation ; le constructeur doit être sans effet de bord.
- **S'abonner au bus ailleurs qu'à l'initialisation** : interdit (UC-BUS-04), et la revue le refuse.
- **Demander un type trop précis** (une implémentation plutôt qu'une interface) : le worker devient
  intestable et dépend d'un choix d'infrastructure.
- **Accumuler les dépendances** : au-delà de trois ou quatre, c'est que le worker fait trop de
  choses — la logique appartient à un service (UC-DOM-04).

## Cas d'usage voisins
- UC-WRK-04 — découverte automatique
- UC-BUS-04 — s'abonner à un sujet
- UC-DOM-04 — porter les règles de gestion dans un service
- UC-CFG-04 — lire une clé de configuration typée
