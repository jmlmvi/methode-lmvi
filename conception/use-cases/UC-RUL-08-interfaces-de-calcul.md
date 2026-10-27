---
id: UC-RUL-08
titre: "Exposer des interfaces de calcul dynamique"
theme: "UC-RUL · Moteurs de décision et code dynamique"
moteurs:
  java: ok
  socle-py: hors
  socle-py-django: hors
contrat: "5.9"
mecanismes: "interfaces Janino, contrat de calcul, implémentations interchangeables"
---

# UC-RUL-08 — Exposer des interfaces de calcul dynamique

## Questions auxquelles répond ce cas d'usage
1. Comment définir un contrat de calcul que plusieurs implémentations peuvent remplir ?
2. Quelle signature donner à une fonction de calcul remplaçable ?
3. Comment choisir l'implémentation active sans redéployer ?
4. Comment tester toutes les implémentations d'un même contrat ?
5. Dans les moteurs Python, comment obtenir la même souplesse sans code dynamique ?
6. Comment éviter qu'une implémentation fautive casse l'application ?

## Mots-clés
interface de calcul, contrat, implémentation interchangeable, stratégie,
signature, choix par configuration, test de contrat, isolation, erreur,
valeur de repli, hors périmètre, protocole, typage

## Ce que c'est, et quand s'en servir
Plutôt que du code libre, on définit une **interface** : des entrées nommées, une sortie typée, et
plusieurs implémentations possibles. Le Socle Java permet de remplir ce contrat par du code compilé
à la volée ; l'idée reste valable sans code dynamique.

C'est la bonne façon de rendre un calcul remplaçable : le contrat est fixe et testé, seule
l'implémentation varie.

## Ce que le socle fait · ce qu'il interdit
Java : les interfaces de calcul sont documentées, et une implémentation dynamique doit les
respecter. Moteurs Python : **hors périmètre** pour la partie dynamique ; le motif de stratégie,
lui, est du Python ordinaire — un protocole, plusieurs classes, un choix par configuration.

Deux exigences qui évitent les mauvaises surprises : un **jeu de tests du contrat**, joué contre
chaque implémentation (c'est ce qui garantit qu'elles sont interchangeables), et un comportement
défini en cas d'échec d'une implémentation — refus explicite ou valeur de repli, jamais un silence.

## Exemples
### Moteurs Python — le contrat
```python
class DiscountStrategy(typing.Protocol):
    """Contrat d'une stratégie de remise."""
    def rate(self, *, amount_cents: int, country: str) -> Decimal: ...
```

### Deux implémentations, un choix par configuration
```python
class TieredDiscount:
    def rate(self, *, amount_cents: int, country: str) -> Decimal:
        return Decimal("0.05") if amount_cents > 10_000 else Decimal("0.02")

class NoDiscount:
    def rate(self, *, amount_cents: int, country: str) -> Decimal:
        return Decimal("0")
```

### Le même test pour toutes
```python
@pytest.mark.parametrize("strategy", [TieredDiscount(), NoDiscount()])
def test_le_contrat_est_respecte(strategy):
    taux = strategy.rate(amount_cents=12_000, country="FR")
    assert Decimal("0") <= taux <= Decimal("1")        # le contrat, vérifié partout
```

### Socle Java
```java
public interface DiscountCalculator { BigDecimal rate(long amountCents, String country); }
```

## Pièges courants
- **Un contrat sans tests** : les implémentations divergent, et le remplacement casse.
- **Une signature trop large** (un dictionnaire en entrée, un objet en sortie) : plus de contrat du
  tout.
- **Aucun comportement défini en cas d'échec** : l'application se tait.
- **Choisir l'implémentation par un chemin de module** lu en configuration : c'est de l'exécution
  arbitraire (UC-RUL-07).

## Cas d'usage voisins
- UC-RUL-07 — compiler du code à la volée
- UC-RUL-05 — exécuter un moteur de règles métier
- UC-DOM-04 — porter les règles de gestion dans un service
- UC-CFG-04 — lire une clé typée
