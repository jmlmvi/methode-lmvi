---
id: UC-WRK-12
titre: "Partager un état entre workers sans base"
theme: "UC-WRK · Workers et cycle de vie"
moteurs:
  java: ok
  socle-py: ok
  socle-py-django: ok
contrat: "5.9"
mecanismes: "SharedDataRegistry, KvBus, registre partagé"
---

# UC-WRK-12 — Partager un état entre workers sans base

## Questions auxquelles répond ce cas d'usage
1. Deux de mes workers doivent se partager une donnée en mémoire : par où passer ?
2. Quelle différence entre le registre partagé et le bus interne clé/valeur ?
3. Cette donnée survit-elle au redémarrage de l'instance ?
4. Un worker peut-il appeler directement une méthode d'un autre worker ?
5. Comment éviter qu'un worker lise une donnée que l'autre n'a pas encore produite ?
6. Est-ce partagé entre plusieurs instances de l'application ?
7. Quand faut-il passer à la base technique plutôt qu'à un partage en mémoire ?

## Mots-clés
registre partagé, `SharedDataRegistry`, état partagé, mémoire, en mémoire, entre workers,
couplage, découplage, bus interne, `KvBus`, volatile, non persistant, une seule instance,
import direct interdit, priorités de démarrage

## Ce que c'est, et quand s'en servir
Un emplacement commun, fourni par le socle, où un worker dépose une donnée qu'un autre consulte :
un référentiel chargé au démarrage, un état courant, un résultat de calcul réutilisable. C'est le
moyen propre de relier deux workers **sans qu'ils se connaissent**.

Trois choix selon le besoin : le registre partagé pour un objet en mémoire, le bus clé/valeur pour
une valeur simple avec expiration (UC-BUS-01), la base technique pour ce qui doit survivre au
redémarrage (UC-DB-01).

## Ce que le socle fait · ce qu'il interdit
Le socle fournit le registre à la découverte, à tous les workers de l'instance. Il ne réplique
rien : le contenu est **local à l'instance et volatile**. Deux instances derrière la Gateway ne
partagent pas ce registre.

Un worker n'importe jamais un autre worker pour l'appeler. Le producteur dépose, le consommateur
lit ; si l'ordre compte, il se règle par les priorités de démarrage (UC-WRK-05), pas par une
attente. Et un consommateur doit toujours savoir se comporter quand la donnée n'est pas encore là.

## Exemples
### socle-py-django et socle-py
```python
class ReferentialWorker(Worker):
    start_priority = 10                                  # dépose avant que l'autre ne lise

    def __init__(self, shared: SharedDataRegistry):
        self._shared = shared

    def initialize(self) -> None:
        self._shared.set("referential:currencies", load_currencies())

class QuoteWorker(Worker):
    def __init__(self, shared: SharedDataRegistry):
        self._shared = shared

    def do_work(self) -> None:
        currencies = self._shared.get("referential:currencies")
        if currencies is None:                           # absence = cas normal, pas une panne
            return
        ...
```

### Socle Java
```java
public QuoteWorker(SharedDataRegistry shared) { this.shared = shared; }
Object currencies = shared.get("referential:currencies");
```

## Pièges courants
- **Croire que c'est persistant** : tout est perdu au redémarrage. Ce qui doit survivre va en base.
- **Croire que c'est partagé entre instances** : derrière la Gateway, chaque instance a son
  registre. Pour un état commun à plusieurs instances, c'est la base technique.
- **Supposer la donnée présente** : au premier cycle, elle peut manquer. Toujours traiter l'absence.
- **Y stocker un objet mutable partagé** et le modifier depuis deux workers : on fabrique une
  course. Déposer des valeurs immuables.
- **Remplacer un vrai message par du sondage du registre** : si l'événement compte, c'est le bus
  (UC-BUS-03).

## Cas d'usage voisins
- UC-BUS-01 — clé/valeur avec expiration
- UC-BUS-03 — publier un événement
- UC-WRK-05 — priorités de démarrage et d'arrêt
- UC-DB-01 — persister l'état technique
