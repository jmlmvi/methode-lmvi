---
id: UC-RES-04
titre: "Combiner disjoncteur, reprises et débit"
theme: "UC-RES · Résilience des appels sortants"
moteurs:
  java: ok
  socle-py: P-4
  socle-py-django: P-4
contrat: "5.9"
mecanismes: "ResilienceManager, ordre des protections, executeProtected"
---

# UC-RES-04 — Combiner disjoncteur, reprises et débit

## Questions auxquelles répond ce cas d'usage
1. Dans quel ordre appliquer le délai, la reprise, le disjoncteur et la limite de débit ?
2. Les protections peuvent-elles se contredire — par exemple reprise et disjoncteur ?
3. Comment régler l'ensemble sans tout casser ?
4. Que doit voir l'appelant quand une protection refuse ?
5. Comment mesurer l'effet des protections en production ?
6. Dans les moteurs Python, par quoi commencer en attendant la phase P-4 ?

## Mots-clés
résilience, `ResilienceManager`, combinaison, ordre des protections, délai, reprise,
disjoncteur, débit, interaction, réglage, mesure, refus, compteurs, observabilité,
`executeProtected`, P-4

## Ce que c'est, et quand s'en servir
Les quatre protections ne s'emploient pas isolément. L'ordre qui fonctionne, de l'extérieur vers
l'intérieur : **la limite de débit** d'abord (inutile d'essayer si le quota est épuisé), puis **le
disjoncteur** (inutile d'essayer si le service est connu en panne), puis **la reprise**, et au
contact du réseau **le délai**.

Mis dans le mauvais ordre, ils se contredisent : des reprises placées à l'extérieur du disjoncteur
le rouvrent en permanence ; des reprises qui ignorent le quota le brûlent trois fois plus vite.

## Ce que le socle fait · ce qu'il interdit
Java : un gestionnaire applique l'enveloppe complète et publie ses compteurs, ce qui évite d'avoir à
réfléchir à l'ordre dans chaque worker. Moteurs Python : phase **P-4**.

Ce qui ne doit jamais manquer, même sans enveloppe : **le délai**, qui est déjà obligatoire
(UC-RES-05) et vérifié par la revue de code. C'est la protection qui empêche le pire — un worker
bloqué pour toujours.

Et chaque refus de protection doit être **compté** : sans compteurs, on ne sait pas si une
protection sauve l'application ou l'empêche de fonctionner.

## Exemples
### Socle Java — l'enveloppe complète
```java
return resilienceManager.execute("payment",
        () -> client.charge(order));     // débit → disjoncteur → reprises → délai
```

### Moteurs Python — l'ordre, à la main
```python
def _charge(self, order_id: str) -> dict:
    if not self._allowed():                                  # 1. débit
        raise RateLimited("Quota fournisseur atteint")
    if self._circuit_open():                                 # 2. disjoncteur
        raise ProviderUnavailable("Appels suspendus")
    return self._call_with_retry({"order": order_id})        # 3. reprises → 4. délai
```

### Mesurer
```python
def get_stats(self) -> dict:
    return {"calls": self._calls, "rate_limited": self._rate_limited,
            "circuit_open_refusals": self._circuit_refusals, "retries": self._retries,
            "timeouts": self._timeouts}
```

## Pièges courants
- **Reprises à l'extérieur du disjoncteur** : il ne se referme jamais vraiment.
- **Reprises qui ignorent le quota** : le quota saute trois fois plus vite.
- **Tout régler au maximum** : des protections si tolérantes qu'elles ne protègent plus.
- **Aucun compteur** : impossible de savoir ce qui refuse, ni pourquoi.
- **Oublier le délai** : toutes les autres protections deviennent inutiles si un appel peut
  attendre indéfiniment.

## Cas d'usage voisins
- UC-RES-01 — disjoncteur
- UC-RES-02 — réessayer avec attente croissante
- UC-RES-03 — limiter le débit
- UC-RES-05 — imposer un délai à tout appel sortant
