---
id: UC-RES-05
titre: "Imposer un délai à tout appel HTTP sortant"
theme: "UC-RES · Résilience des appels sortants"
moteurs:
  java: ok
  socle-py: ok
  socle-py-django: ok
contrat: "5.9"
mecanismes: "timeout obligatoire, revue de code C16, httpx, requests"
---

# UC-RES-05 — Imposer un délai à tout appel HTTP sortant

## Questions auxquelles répond ce cas d'usage
1. Pourquoi un appel HTTP sans délai est-il refusé par la revue de code ?
2. Que se passe-t-il concrètement quand un tiers ne répond jamais ?
3. Quelle valeur de délai choisir, et faut-il la rendre configurable ?
4. Le délai de l'action protège-t-il déjà mes appels sortants ?
5. Comment la revue de code détecte-t-elle un appel sans délai ?
6. Le même principe s'applique-t-il aux connexions de base de données ?

## Mots-clés
délai, timeout, appel sortant, HTTP, `httpx`, `requests`, obligatoire, C16,
revue de code, blocage, fil d'exécution, boucle d'événements, valeur configurable,
connexion, lecture, base de données, convention

## Ce que c'est, et quand s'en servir
La règle la plus simple et la plus rentable du lot : **aucun appel réseau sans délai**. C'est une
convention du commanditaire, et elle est vérifiée mécaniquement — la revue de code refuse un appel
HTTP qui n'en porte pas (règle C16).

La raison tient en une phrase : par défaut, la plupart des clients HTTP attendent **indéfiniment**.
Un tiers qui accepte la connexion puis ne répond plus bloque le worker, puis la boucle
d'événements, puis les sondes — et l'instance entière est déclarée morte pour une panne qui n'est
pas la sienne.

## Ce que le socle fait · ce qu'il interdit
Le socle ne peut pas poser le délai à votre place : c'est votre client HTTP. Il fait ce qu'il peut —
la revue de code bloque la livraison, le hook de pré-commit la bloque avant le commit, et la CI la
bloque avant la fusion.

Le délai de l'action (UC-ACT-03) **ne remplace pas** celui de l'appel : abandonner l'action ne
libère pas une connexion bloquée côté système. Les deux sont nécessaires, et le délai de l'appel
doit être plus court que celui de l'action.

## Exemples
### Correct
```python
response = httpx.post(self._url, json=payload, timeout=self._timeout_s)      # délai explicite
with httpx.Client(timeout=5.0) as client:                                    # ou sur le client
    response = client.get(url)
```
```python
# Valeur configurable, défaut raisonnable
self._timeout_s = config.raw.as_float("app.payment.timeout-seconds", 5.0)
```

### Refusé par la revue
```python
response = httpx.post(self._url, json=payload)        # C16 : appel HTTP sans timeout
requests.get(url)                                     # C16
```

### Ce que dit la revue
```bash
socle-py-django review src
#   src/mon_app/workers/payment_worker.py:42  C16
#   appel HTTP sans timeout : un tiers qui ne répond pas bloque le worker
```

### Socle Java
```java
HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
HttpRequest.newBuilder(uri).timeout(Duration.ofSeconds(5)).build();
```

## Pièges courants
- **Un délai sur la connexion seulement** : la connexion s'établit, et la lecture attend pour
  toujours. Couvrir les deux.
- **Un délai trop long** (soixante secondes) : « presque jamais bloqué » revient au même sous
  charge.
- **Un délai plus long que celui de l'action** : l'action abandonne, l'appel continue.
- **Oublier les connexions de base** : le principe est le même, un serveur de base lent bloque
  autant.
- **Le même délai partout** : un appel de santé et un export n'ont pas les mêmes besoins.

## Cas d'usage voisins
- UC-RES-01 — disjoncteur
- UC-RES-02 — réessayer avec attente croissante
- UC-ACT-03 — imposer un délai maximal à une action
- UC-DEV-04 — contrôler son code contre les conventions
