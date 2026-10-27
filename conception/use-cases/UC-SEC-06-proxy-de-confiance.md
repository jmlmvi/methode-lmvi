---
id: UC-SEC-06
titre: "Ne croire l'en-tête de tenant que derrière un proxy de confiance"
theme: "UC-SEC · Sécurité et identité"
moteurs:
  java: ok
  socle-py: ok
  socle-py-django: ok
contrat: "5.9"
mecanismes: "TRUSTED_PROXIES, X-SSO-Tenant, X-Forwarded-For, S6"
---

# UC-SEC-06 — Ne croire l'en-tête de tenant que derrière un proxy de confiance

## Questions auxquelles répond ce cas d'usage
1. Pourquoi mon appel avec l'en-tête de tenant est-il refusé en local ?
2. Quel est le nom exact de l'en-tête, et qui a le droit de le poser ?
3. Comment déclarer un proxy de confiance, et avec quelle valeur ?
4. Que risque-t-on si on fait confiance à cet en-tête sans restriction ?
5. Comment essayer une application multi-tenant sur son poste ?
6. Quelle valeur faut-il mettre en production, derrière la Gateway ?
7. Même question pour l'adresse d'origine de l'appelant : qui la pose ?

## Mots-clés
proxy de confiance, `TRUSTED_PROXIES`, `socle.security.trusted-proxies`, `X-SSO-Tenant`,
`X-Forwarded-For`, usurpation, falsification, tenant, CIDR, `127.0.0.1`, Gateway,
vide par défaut, S6, `MISSING_TENANT`, essai local

## Ce que c'est, et quand s'en servir
Derrière la Gateway, le tenant et l'adresse d'origine arrivent dans des en-têtes. Un en-tête est
trivial à falsifier : le socle ne l'honore donc **que si la requête vient d'un pair déclaré de
confiance**. La liste est **vide par défaut**, donc aucun en-tête de ce genre n'est cru tant qu'on
ne l'a pas remplie.

C'est la cause numéro un de l'étonnement « mon appel est refusé alors que j'envoie bien le
tenant » : l'en-tête est ignoré, l'identité reste vide, et la table partitionnée refuse —
exactement comme prévu.

## Ce que le socle fait · ce qu'il interdit
Le socle compare l'adresse du pair à la liste de confiance (adresses ou plages) ; si elle n'y est
pas, il ignore purement et simplement l'en-tête de tenant et l'adresse transmise. Sinon il les
prend en compte et pose l'identité.

Il n'y a pas de demi-mesure possible : élargir la liste à tout le monde revient à laisser n'importe
quel client choisir son tenant, donc à supprimer l'isolation. En production, on déclare l'adresse de
la Gateway, et rien d'autre.

## Exemples
### Configuration
```yaml
socle:
  security:
    # Vide = l'en-tête n'est JAMAIS honoré. En production : l'adresse de la Gateway.
    trusted-proxies: ${TRUSTED_PROXIES:}
```

### Essayer en local
```bash
TRUSTED_PROXIES=127.0.0.1,::1 ADMIN_API_KEY=$KEY socle-py-django run

curl -X POST -H "X-Admin-Key: $KEY" -H "X-SSO-Tenant: acme" \
  -H "Content-Type: application/json" -d '{"reference":"C-1","amount_cents":12000}' \
  localhost:8080/admin/workers/orders_worker/actions/create_order
```

### Sans proxy de confiance — le refus attendu
```json
{"success": false, "error": "Refusing tenant-less access to partitioned table 'x_orders' …",
 "errorType": "MISSING_TENANT"}
```

### Dans la pile Docker
```yaml
environment:
  TRUSTED_PROXIES: ${TRUSTED_PROXIES:-}      # vide par défaut : c'est volontaire
```

## Pièges courants
- **Mettre une plage large** (`0.0.0.0/0`) pour « que ça marche » : chaque client peut alors
  choisir son tenant. C'est la fuite de données la plus directe qu'on puisse s'infliger.
- **Chercher le bogue dans l'application** quand le refus vient de là : lire les journaux, l'en-tête
  a simplement été ignoré.
- **Se tromper de nom d'en-tête** : il faut le nom exact, et il est documenté.
- **Déclarer la confiance en préproduction et l'oublier en production** : l'isolation ne tient plus
  qu'à la configuration, donc elle se relit à chaque déploiement.
- **Faire confiance à l'adresse transmise** pour un contrôle d'accès sans cette liste : même
  problème.

## Cas d'usage voisins
- UC-SEC-05 — transmettre scopes et tenant
- UC-DB-10 — refuser un accès sans tenant
- UC-DB-09 — isoler les données métier par tenant
- UC-INT-06 — s'insérer derrière la Gateway
