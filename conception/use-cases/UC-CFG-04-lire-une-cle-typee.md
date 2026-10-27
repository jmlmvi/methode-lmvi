---
id: UC-CFG-04
titre: "Lire une clé applicative typée"
theme: "UC-CFG · Configuration"
moteurs:
  java: ok
  socle-py: ok
  socle-py-django: ok
contrat: "5.9"
mecanismes: "raw.as_int, as_bool, as_str, as_list, défaut, C05"
---

# UC-CFG-04 — Lire une clé applicative typée

## Questions auxquelles répond ce cas d'usage
1. Comment lire un entier, un booléen ou une liste depuis la configuration ?
2. Où placer cette lecture dans mon code, et à quel moment ?
3. Faut-il un défaut, et où doit-il être écrit ?
4. Pourquoi un service n'a-t-il pas le droit de lire la configuration ?
5. Comment passer une valeur configurée à une règle de gestion ?
6. Que se passe-t-il si la valeur n'est pas convertible dans le type demandé ?

## Mots-clés
lecture typée, `as_int`, `as_bool`, `as_str`, `as_list`, défaut, `SocleConfig`, `raw`,
lue une fois, constructeur, `initialize`, échange de limites, C05, conversion,
clé applicative, préfixe `app.`

## Ce que c'est, et quand s'en servir
Les accesseurs typés de la configuration : un entier, un booléen, une chaîne, une liste, chacun
avec un défaut. On les appelle **une fois**, au démarrage du worker, et on range le résultat dans un
objet immuable qui sera passé au domaine (UC-DOM-05).

Le défaut écrit dans le code est le dernier filet : le vrai défaut, visible par l'exploitant, est
celui du fichier de configuration.

## Ce que le socle fait · ce qu'il interdit
Le socle convertit et applique le défaut en cas d'absence. La revue de code refuse une lecture de
configuration dans les couches du domaine (règle C05) : un service dont le comportement dépend de
l'environnement n'est pas testable.

Donc : lecture dans le constructeur ou l'initialisation du worker, rangement dans un échange,
passage en paramètre. Jamais de lecture à chaud au milieu d'une règle.

## Exemples
### Lire une fois, ranger, passer
```python
class OrdersWorker(Worker, ActionProvider):
    def __init__(self, techdb: TechDb, config: SocleConfig):
        self.limits = exchanges.OrderLimits(
            max_amount_cents=config.raw.as_int("app.orders.max-amount-cents", 100_000),
            max_outstanding_cents=config.raw.as_int("app.orders.max-outstanding-cents", 500_000))
        self._alerts = config.raw.as_bool("app.orders.alerts-enabled", False)
        self._channels = config.raw.as_list("app.orders.alert-channels")
```

### Le fichier porte le défaut visible
```yaml
app:
  orders:
    max-amount-cents: ${APP_ORDERS_MAX_AMOUNT_CENTS:100000}
    alerts-enabled: ${APP_ORDERS_ALERTS_ENABLED:false}
    alert-channels: ${APP_ORDERS_ALERT_CHANNELS:}
```

### Socle Java
```java
@Value("${app.orders.max-amount-cents:100000}") private long maxAmountCents;
```

## Pièges courants
- **Lire la configuration dans un service** : refusé par la revue, et la règle devient dépendante de
  l'environnement.
- **Relire à chaque appel** : coût inutile, et comportement qui peut changer en cours de traitement.
- **Défaut dans le code seulement** : l'exploitant ne sait pas quelle valeur est appliquée.
- **Une liste écrite comme une chaîne** et découpée à la main : utiliser l'accesseur de liste.
- **Un entier reçu en chaîne** par un appel non typé : la conversion échoue tard, à l'usage.

## Cas d'usage voisins
- UC-CFG-01 — configurer par fichier
- UC-DOM-05 — fournir l'heure et la configuration au domaine
- UC-WRK-07 — injecter ses dépendances
- UC-CFG-06 — documenter les clés d'une application
