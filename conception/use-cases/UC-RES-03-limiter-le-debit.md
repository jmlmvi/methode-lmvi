---
id: UC-RES-03
titre: "Refuser au-delà d'un débit autorisé"
theme: "UC-RES · Résilience des appels sortants"
moteurs:
  java: ok
  socle-py: P-4
  socle-py-django: P-4
contrat: "5.9"
mecanismes: "rate limiter, quota, jeton, fenêtre, RATE_LIMIT_ADMIN_RPM"
---

# UC-RES-03 — Refuser au-delà d'un débit autorisé

## Questions auxquelles répond ce cas d'usage
1. Mon contrat m'autorise N appels par minute : comment le faire respecter par le code ?
2. Faut-il refuser l'appel ou le mettre en attente ?
3. Quelle différence avec un sémaphore qui limite la simultanéité ?
4. Le socle limite-t-il aussi les appels entrants vers mon application ?
5. Comment partager un quota entre plusieurs instances ?
6. Dans les moteurs Python, cette limite est-elle fournie ?

## Mots-clés
limiteur de débit, rate limiter, quota, appels par minute, fenêtre, jeton, seau,
refus, 429, mise en attente, simultanéité, sémaphore, entrant, sortant,
`RATE_LIMIT_ENABLED`, `RATE_LIMIT_ADMIN_RPM`, P-4

## Ce que c'est, et quand s'en servir
Une borne de **rythme** : au-delà du débit autorisé, on refuse. C'est d'abord une obligation
contractuelle (un fournisseur facture ou coupe au-delà d'un quota), et ensuite une protection : un
traitement de masse qui part en boucle peut épuiser un quota en quelques secondes.

À distinguer du sémaphore (UC-OPS-04), qui borne la **simultanéité**. Les deux se combinent : trois
appels à la fois, cent par minute.

## Ce que le socle fait · ce qu'il interdit
Côté **entrant**, le socle sait limiter le débit sur les surfaces d'administration — une protection
contre un script devenu fou ou un balayage. Elle est désactivée par défaut et se règle par
configuration.

Côté **sortant**, le limiteur fait partie de l'enveloppe de protection du Socle Java ; dans les
moteurs Python c'est la phase **P-4**.

Choix important : refuser plutôt que mettre en attente. Une file d'attente invisible transforme un
dépassement de quota en latence inexplicable, et la mémoire finit par souffrir. Un refus explicite
remonte à l'appelant, qui peut décider.

Et un quota partagé entre instances ne peut pas tenir dans la mémoire d'une instance : il demande
une ressource commune.

## Exemples
### Limiter l'entrant (configuration du socle)
```yaml
socle:
  admin:
    rate-limit-enabled: ${RATE_LIMIT_ENABLED:false}
    rate-limit-admin-rpm: ${RATE_LIMIT_ADMIN_RPM:60}
    rate-limit-shutdown-rph: ${RATE_LIMIT_SHUTDOWN_RPH:5}
```

### Moteurs Python — borner le sortant, simplement
```python
def _allowed(self) -> bool:
    # Fenêtre glissante grossière, locale à l'instance : suffisant pour se protéger.
    maintenant = time.monotonic()
    self._appels = [t for t in self._appels if maintenant - t < 60.0]
    if len(self._appels) >= self._max_par_minute:
        return False
    self._appels.append(maintenant)
    return True
```
```python
if not self._allowed():
    return ActionResult.failure("Quota fournisseur atteint, réessayez plus tard", "RATE_LIMITED")
```

## Pièges courants
- **Mettre en attente au lieu de refuser** : latence invisible, mémoire qui grossit.
- **Un quota local présenté comme global** : avec trois instances, le quota est triplé.
- **Confondre débit et simultanéité** : limiter l'un ne limite pas l'autre.
- **Refuser sans code clair** : l'appelant ne sait pas qu'il doit réessayer plus tard.
- **Activer la limite entrante sans la mesurer** : on coupe des appelants légitimes.

## Cas d'usage voisins
- UC-RES-01 — disjoncteur
- UC-RES-04 — combiner les protections
- UC-OPS-04 — sémaphores nommés
- UC-ACT-12 — distinguer un refus métier d'une panne
