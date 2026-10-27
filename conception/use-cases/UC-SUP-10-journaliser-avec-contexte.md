---
id: UC-SUP-10
titre: "Journaliser avec un contexte de corrélation"
theme: "UC-SUP · Supervision et exploitation"
moteurs:
  java: ok
  socle-py: ok
  socle-py-django: ok
contrat: "5.9"
mecanismes: "[step:…], MDC, trace, logger.exception, paramètres en arguments"
---

# UC-SUP-10 — Journaliser avec un contexte de corrélation

## Questions auxquelles répond ce cas d'usage
1. Comment écrire un message de journal utile, qui se retrouve dans une recherche ?
2. À quoi servent les marqueurs d'étape entre crochets qu'on voit partout ?
3. Comment relier toutes les lignes d'un même appel ?
4. Pourquoi faut-il passer les valeurs en arguments plutôt que de les formater soi-même ?
5. Comment journaliser une exception sans recopier son message ?
6. Quel niveau choisir, et qu'est-ce que ça déclenche en aval ?
7. Que ne faut-il jamais écrire dans un journal ?

## Mots-clés
journalisation, journal, `logger`, `[step:…]`, marqueur d'étape, MDC, corrélation,
trace, `logger.exception`, niveau, ERROR, WARN, INFO, arguments de journalisation,
secret en clair, rapport d'erreurs, recherche, exploitation

## Ce que c'est, et quand s'en servir
Les journaux sont le premier outil de diagnostic, et ils ne sont utiles que s'ils sont **cherchables
et corrélables**. Le socle emploie partout des marqueurs d'étape de la forme `[step:nom_d_etape]` :
une recherche sur le marqueur retrouve toutes les occurrences, dans tous les moteurs.

L'autre moitié du sujet est la corrélation : un identifiant de trace porté par l'appel permet de
relire une invocation de bout en bout, à travers plusieurs workers.

## Ce que le socle fait · ce qu'il interdit
Le socle journalise ses étapes avec ces marqueurs, pose le contexte de corrélation et l'identité
résolue, et masque les valeurs sensibles **dans l'audit des actions** — pas dans vos messages.

Les conventions sont explicites : pas de `except` nu, un message utile pour une exception
(`logger.exception("Impossible de …")`) sans recopier le texte de l'exception, et les valeurs
passées **en arguments** du journaliseur, jamais interpolées dans la chaîne. Cette dernière règle
n'est pas cosmétique : elle permet le filtrage, évite le coût de formatage inutile et empêche des
surprises d'échappement.

Et un enseignement d'exploitation : le **niveau** compte, parce qu'il alimente des chaînes en aval.
Des messages de configuration journalisés en erreur ont déjà été capturés et expédiés par le rapport
d'erreurs, créant du bruit d'alerte pour une situation normale.

## Exemples
### Un message qui se retrouve
```python
log.info("[step:orders_confirmed] reference=%s tenant=%s", reference, partition)
```

### Une exception
```python
try:
    self._call_provider()
except httpx.TimeoutException:
    # Message utile ; pas de recopie du texte de l'exception, qui est déjà joint.
    log.exception("Impossible de joindre le fournisseur de paiement")
    raise
```

### Ce qu'il ne faut pas écrire
```python
log.info(f"appel avec {params}")            # interpolation + paramètres possiblement sensibles
log.error("[step:worker_cron_invalid] …")   # niveau ERROR pour un cas normal → bruit d'alerte
log.info("jeton=%s", token)                 # secret en clair, conservé
```

### Socle Java
```java
logger.info("[worker:{}][step:process][id:{}] Traitement de l'événement", getName(), id);
```

## Pièges courants
- **Interpoler les valeurs** : perte de filtrage, coût inutile, et risque de fuite.
- **Journaliser un secret** : l'audit est masqué, pas vos messages.
- **Le mauvais niveau** : une erreur journalisée pour un cas normal nourrit les alertes en aval.
- **Un message sans contexte** (« échec ») : inutilisable dans une recherche.
- **Avaler l'exception après l'avoir journalisée** : si le traitement doit échouer, laisser remonter.

## Cas d'usage voisins
- UC-ACT-06 — auditer les invocations
- UC-SUP-11 — agréger et expédier un rapport d'erreurs
- UC-CFG-03 — refuser une configuration invalide
- UC-SEC-12 — lire ses secrets au démarrage
