---
id: UC-RES-01
titre: "Couper les appels après une série d'échecs (disjoncteur)"
theme: "UC-RES · Résilience des appels sortants"
moteurs:
  java: ok
  socle-py: P-4
  socle-py-django: P-4
contrat: "5.9"
mecanismes: "circuit breaker, seuil d'échecs, ouvert, semi-ouvert, fermé"
---

# UC-RES-01 — Couper les appels après une série d'échecs (disjoncteur)

## Questions auxquelles répond ce cas d'usage
1. Mon fournisseur est en panne : comment arrêter de l'appeler pour rien ?
2. Qu'est-ce qu'un disjoncteur ouvert, fermé, semi-ouvert ?
3. Combien d'échecs faut-il pour ouvrir, et quand réessaie-t-on ?
4. Que reçoit l'appelant pendant que le disjoncteur est ouvert ?
5. Comment éviter qu'un disjoncteur ouvert passe pour une panne de mon application ?
6. Dans les moteurs Python, existe-t-il déjà, et sinon que faire ?
7. Comment voir son état en exploitation ?

## Mots-clés
disjoncteur, circuit breaker, ouvert, fermé, semi-ouvert, half-open, seuil d'échecs,
fenêtre, temporisation, dégradation, repli, fallback, panne externe,
`executeProtected`, état, statistiques, P-4

## Ce que c'est, et quand s'en servir
Un interrupteur automatique : après N échecs consécutifs, on **cesse d'appeler** pendant un temps
donné, puis on laisse passer un appel d'essai. Si l'essai réussit, on rouvre le robinet.

L'intérêt n'est pas d'être poli avec le fournisseur, c'est de se protéger soi-même : chaque appel
vers un service en panne consomme une attente, un fil d'exécution, parfois une connexion. Sans
disjoncteur, la panne d'en face devient la nôtre.

## Ce que le socle fait · ce qu'il interdit
Java : le disjoncteur est fourni, réglable par configuration, et son état apparaît dans les
statistiques du worker. Moteurs Python : phase **P-4**.

Ce que le socle ne décide pas pour vous : ce que fait l'appelant quand le circuit est ouvert. Il
faut une réponse explicite — un refus typé, une valeur de repli, une mise en file pour plus tard.
Rendre un succès vide est le pire choix : l'appelant croit l'opération faite.

En attendant la phase P-4 en Python, ne pas improviser un disjoncteur maison dans chaque worker :
le délai obligatoire (UC-RES-05) couvre le pire, et un compteur d'échecs simple dans le worker
suffit à se mettre en veille.

## Exemples
### Socle Java
```java
return executeProtected(() -> client.charge(order));     // disjoncteur + reprises + débit
```
```yaml
resilience:
  circuit-breaker:
    failure-threshold: ${CB_FAILURE_THRESHOLD:5}
    open-duration-ms: ${CB_OPEN_DURATION_MS:30000}
```

### Moteurs Python — se mettre en veille, simplement
```python
def _charge(self, order_id: str) -> dict:
    if self._failures >= 5 and self._now_ms() < self._retry_after_ms:
        raise ProviderUnavailable("Fournisseur en panne, appels suspendus")  # refus explicite
    try:
        response = httpx.post(self._url, json={"order": order_id}, timeout=self._timeout_s)
        response.raise_for_status()
    except httpx.HTTPError:
        self._failures += 1
        self._retry_after_ms = self._now_ms() + 30_000
        raise
    self._failures = 0
    return response.json()
```

### Dire la vérité à l'appelant
```python
except ProviderUnavailable as exc:
    return ActionResult.failure(str(exc), "PROVIDER_UNAVAILABLE")
```

## Pièges courants
- **Rendre un succès vide** quand le circuit est ouvert : l'appelant croit avoir payé.
- **Ouvrir sur une erreur métier** (refus de paiement légitime) : le circuit s'ouvre alors que le
  service fonctionne. N'ouvrir que sur l'indisponibilité.
- **Jamais de réessai** : le circuit reste ouvert après le retour du service.
- **État invisible** : personne ne sait pourquoi les appels ne partent plus. Le publier dans les
  statistiques.
- **Se déclarer malade** parce que le fournisseur est en panne : le superviseur redémarre un worker
  qui va bien (UC-SUP-03).

## Cas d'usage voisins
- UC-RES-02 — réessayer avec attente croissante
- UC-RES-03 — limiter le débit
- UC-RES-05 — imposer un délai à tout appel sortant
- UC-WRK-10 — worker d'appel externe protégé
