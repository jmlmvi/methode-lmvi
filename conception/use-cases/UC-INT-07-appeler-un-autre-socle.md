---
id: UC-INT-07
titre: "Appeler un autre Socle en client authentifié"
theme: "UC-INT · Intégrations et transports"
moteurs:
  java: ok
  socle-py: P-4
  socle-py-django: P-4
contrat: "5.9"
mecanismes: "SocleAuthClient, jeton de service, appel d'action, protections"
---

# UC-INT-07 — Appeler un autre Socle en client authentifié

## Questions auxquelles répond ce cas d'usage
1. Comment mon application appelle-t-elle une action d'une autre application Socle ?
2. Avec quelle identité — une clé, un jeton de service, le jeton de l'utilisateur ?
3. Faut-il propager l'identité de l'utilisateur d'origine ?
4. Quelles protections appliquer à cet appel sortant ?
5. Dans les moteurs Python, un client est-il fourni ?
6. Comment éviter un couplage fort entre les deux applications ?

## Mots-clés
appel sortant, autre Socle, `SocleAuthClient`, jeton de service, propagation
d'identité, délégation, clé d'administration, action distante, délai, reprise,
disjoncteur, couplage, message, P-4

## Ce que c'est, et quand s'en servir
Une application Socle qui appelle une action d'une autre : vérifier un droit auprès d'un
référentiel, déclencher une facturation, demander un calcul.

La question centrale est l'**identité de l'appel**. Trois cas : propager le jeton de l'utilisateur
d'origine (le plus juste quand l'action est faite pour lui — l'audit et le tenant suivent), utiliser
un jeton de service (pour un traitement autonome), ou la clé d'administration (à réserver aux
appels d'infrastructure, puisqu'elle n'identifie personne).

## Ce que le socle fait · ce qu'il interdit
Java : un client authentifié est fourni, qui gère l'obtention du jeton. Moteurs Python : phase
**P-4** ; en attendant, l'appel se fait avec un client HTTP ordinaire — et donc avec les règles des
appels sortants : **délai obligatoire** (UC-RES-05), et protection si le pair est critique
(UC-WRK-10).

Ce qu'il ne faut pas faire : enchaîner les applications en synchrone pour une opération qui pourrait
être asynchrone. Chaque appel synchrone ajoute sa latence et sa probabilité de panne ; un message
(UC-BUS-05) découple et survit à l'indisponibilité du destinataire.

## Exemples
### Propager l'identité de l'utilisateur
```python
def _demander_facture(self, reference: str, context: ActionContext) -> dict:
    # Le jeton de l'utilisateur voyage : l'audit distant porte son nom, le tenant suit.
    response = httpx.post(
        f"{self._facturation_url}/admin/workers/invoice_worker/actions/create_invoice",
        headers={"Authorization": f"Bearer {context.token}"},
        json={"reference": reference}, timeout=self._timeout_s)
    response.raise_for_status()
    return response.json()["data"]
```

### Traiter la réponse comme un contrat
```python
corps = response.json()
if not corps["success"]:
    # Un refus métier distant reste un refus métier : on le remonte avec son code.
    return ActionResult.failure(corps["error"], corps.get("errorType", "REMOTE_REFUSED"))
```

### Socle Java
```java
socleAuthClient.callAction("facturation", "invoice_worker", "create_invoice",
                           Map.of("reference", reference));
```

## Pièges courants
- **Pas de délai** : la panne du pair devient la vôtre.
- **Utiliser la clé d'administration** pour une action faite au nom d'un utilisateur : l'audit
  distant perd l'identité, et le tenant doit être bricolé.
- **Ignorer le champ de succès** de la réponse : un refus métier passe pour un succès.
- **Chaîner trois appels synchrones** : la latence s'additionne, la fiabilité se multiplie à la
  baisse.
- **Adresse du pair en dur** : elle change, et rien ne le dit.

## Cas d'usage voisins
- UC-INT-04 — relier deux instances en pair-à-pair
- UC-SEC-04 — accepter un JWT délégué sur les actions REST
- UC-RES-05 — imposer un délai à tout appel sortant
- UC-WRK-10 — worker d'appel externe protégé
