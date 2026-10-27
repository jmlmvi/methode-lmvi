---
id: UC-INT-04
titre: "Relier deux instances en pair-à-pair"
theme: "UC-INT · Intégrations et transports"
moteurs:
  java: ok
  socle-py: hors
  socle-py-django: hors
contrat: "5.9"
mecanismes: "connexions entre pairs, découverte, reprise de lien"
---

# UC-INT-04 — Relier deux instances en pair-à-pair

## Questions auxquelles répond ce cas d'usage
1. Comment faire communiquer directement deux instances Socle ?
2. Comment une instance découvre-t-elle l'autre ?
3. Que se passe-t-il quand le lien tombe ?
4. Quand ce couplage direct est-il préférable à un passage par la plateforme ?
5. Dans les moteurs Python, est-ce possible ?
6. Quels risques de couplage ce montage introduit-il ?

## Mots-clés
pair-à-pair, connexion entre pairs, instance à instance, découverte, annuaire,
rupture de lien, reprise, couplage, dépendance, plateforme, Gateway,
appel authentifié, hors périmètre

## Ce que c'est, et quand s'en servir
Deux instances qui se parlent directement, sans passer par un intermédiaire. Le Socle Java le
permet dans son architecture gRPC.

Avant d'y recourir, la question utile est celle du **couplage** : deux instances liées directement
se déploient, se surveillent et tombent ensemble. Passer par la plateforme (UC-INT-06) ou par un
appel authentifié (UC-INT-07) coûte un intermédiaire, mais garde les deux côtés indépendants.

## Ce que le socle fait · ce qu'il interdit
Java : les connexions entre pairs sont gérées par le socle, avec leur cycle de vie.

Moteurs Python : **hors périmètre**. Ce qui reste disponible et dans le contrat : un appel REST
authentifié d'une instance vers une action de l'autre — avec les protections d'appel sortant
(UC-RES-05 au minimum), puisque l'autre instance est un système tiers comme un autre.

Un montage à éviter absolument : deux instances qui s'appellent mutuellement en synchrone dans le
même traitement. Une panne d'un côté devient un blocage des deux, et le diagnostic est pénible.

## Exemples
### Moteurs Python — un appel d'instance à instance, dans le contrat
```python
def _notifier_facturation(self, reference: str) -> None:
    response = httpx.post(
        f"{self._facturation_url}/admin/workers/invoice_worker/actions/create_invoice",
        headers={"Authorization": f"Bearer {self._jeton}"},
        json={"reference": reference},
        timeout=self._timeout_s)              # délai obligatoire
    response.raise_for_status()
```

### Mieux : découpler par le bus ou un message
```python
# Si la facturation peut se faire un peu plus tard, un message vaut mieux qu'un appel.
self._kv_bus.publish("orders/confirmed", {"reference": reference})
```

## Pièges courants
- **Appels croisés synchrones** : un côté bloque l'autre, et les deux tombent ensemble.
- **Adresses en dur** : un déplacement d'instance casse le lien.
- **Pas de délai** sur l'appel : la panne du pair devient la vôtre.
- **Couplage de version** : les deux instances doivent être déployées ensemble, ce qu'on cherchait
  à éviter.

## Cas d'usage voisins
- UC-INT-07 — appeler un autre Socle en client authentifié
- UC-INT-06 — s'insérer derrière la Gateway
- UC-BUS-05 — publication fiable avec groupes
- UC-RES-05 — imposer un délai à tout appel sortant
