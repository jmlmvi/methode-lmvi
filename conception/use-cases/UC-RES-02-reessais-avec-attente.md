---
id: UC-RES-02
titre: "Réessayer avec attente croissante"
theme: "UC-RES · Résilience des appels sortants"
moteurs:
  java: ok
  socle-py: P-4
  socle-py-django: P-4
contrat: "5.9"
mecanismes: "retry, backoff exponentiel, jitter, erreurs rejouables"
---

# UC-RES-02 — Réessayer avec attente croissante

## Questions auxquelles répond ce cas d'usage
1. Comment réessayer un appel qui a échoué sans aggraver la situation ?
2. Quelles erreurs faut-il réessayer, et lesquelles jamais ?
3. Combien de tentatives, et avec quelle attente entre chacune ?
4. Qu'est-ce que la dispersion aléatoire, et pourquoi en a-t-on besoin ?
5. Peut-on réessayer une écriture sans créer de doublon ?
6. Où placer la reprise — dans le worker, ou au-dessus ?
7. Dans les moteurs Python, cette mécanique est-elle fournie ?

## Mots-clés
reprise, retry, tentatives, attente croissante, backoff exponentiel, dispersion, jitter,
erreur transitoire, erreur définitive, 4xx, 5xx, délai, idempotence, doublon,
tempête de reprises, P-4

## Ce que c'est, et quand s'en servir
Beaucoup d'échecs réseau sont passagers. Réessayer **un nombre borné de fois**, avec une attente qui
croît et une part d'aléatoire, récupère ces échecs sans transformer un incident en avalanche.

La règle de tri est essentielle : on réessaie l'indisponible et le temporaire (connexion refusée,
délai dépassé, erreur serveur), jamais le définitif (requête invalide, ressource inexistante, refus
métier). Réessayer une erreur définitive, c'est multiplier le même échec.

## Ce que le socle fait · ce qu'il interdit
Java : la reprise fait partie de l'enveloppe de protection, avec ses réglages. Moteurs Python :
phase **P-4**.

La part aléatoire n'est pas un raffinement : sans elle, tous les appelants qui ont échoué en même
temps réessaient en même temps, et le service qui se relève retombe aussitôt.

Et une reprise suppose l'idempotence côté serveur, ou une clé d'idempotence côté client : sinon,
« réessayer » veut dire « payer deux fois » (UC-BUS-07).

## Exemples
### Socle Java
```yaml
resilience:
  retry:
    max-attempts: ${RETRY_MAX_ATTEMPTS:3}
    initial-delay-ms: ${RETRY_INITIAL_DELAY_MS:200}
    multiplier: ${RETRY_MULTIPLIER:2.0}
```

### Moteurs Python — borné, croissant, dispersé
```python
def _call_with_retry(self, payload: dict) -> dict:
    attente = 0.2
    for tentative in range(3):
        try:
            response = httpx.post(self._url, json=payload, timeout=self._timeout_s)
            if response.status_code < 500:          # 4xx : définitif, on ne réessaie pas
                response.raise_for_status()
                return response.json()
        except (httpx.TimeoutException, httpx.ConnectError):
            pass                                    # transitoire : on réessaiera
        if tentative < 2:
            time.sleep(attente + random.uniform(0, attente / 2))   # dispersion
            attente *= 2
    raise ProviderUnavailable("Fournisseur injoignable après 3 tentatives")
```
Cette attente se trouve dans un travail **synchrone**, exécuté hors de la boucle d'événements
(UC-WRK-11) ; dans un worker, on ne bloque jamais la boucle.

## Pièges courants
- **Réessayer une erreur définitive** : trois fois la même erreur, trois fois le coût.
- **Pas de dispersion** : tous les clients reviennent à la même seconde.
- **Reprise non bornée** : on ne sort jamais de l'échec.
- **Reprise sans idempotence** : doublons métier.
- **Attendre dans du code asynchrone** : on gèle l'instance au lieu d'un seul traitement.

## Cas d'usage voisins
- UC-RES-01 — disjoncteur
- UC-RES-05 — imposer un délai à tout appel sortant
- UC-BUS-07 — rendre un consommateur idempotent
- UC-WRK-11 — travail bloquant ou asynchrone
