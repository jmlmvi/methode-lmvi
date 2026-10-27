---
id: UC-SEC-01
titre: "Protéger l'API d'administration par clé"
theme: "UC-SEC · Sécurité et identité"
moteurs:
  java: ok
  socle-py: ok
  socle-py-django: ok
contrat: "5.9"
mecanismes: "X-Admin-Key, ADMIN_API_KEY, ALLOW_INSECURE_ADMIN, RG-15"
---

# UC-SEC-01 — Protéger l'API d'administration par clé

## Questions auxquelles répond ce cas d'usage
1. Quel en-tête faut-il envoyer pour appeler une route d'administration ?
2. Où se configure la clé, et comment est-elle fournie en production ?
3. Que se passe-t-il au démarrage si aucune clé n'est définie ?
4. Quelles routes sont protégées par cette clé, et lesquelles restent ouvertes ?
5. Comment travailler en local sans clé, sans affaiblir la production ?
6. La comparaison de la clé est-elle sensible aux attaques par mesure de temps ?
7. Une clé suffit-elle, ou faut-il une identité utilisateur ?

## Mots-clés
clé d'administration, `X-Admin-Key`, `ADMIN_API_KEY`, `ADMIN_AUTH_ENABLED`,
`ALLOW_INSECURE_ADMIN`, 401, Unauthorized, RG-15, surfaces protégées, `/admin`, `/workers`,
`/mcpagger`, comparaison à temps constant, secret injecté, Hub

## Ce que c'est, et quand s'en servir
Le titre d'accès le plus simple : un secret partagé, envoyé dans un en-tête, exigé sur toutes les
surfaces d'administration. C'est ce qu'utilisent un script d'exploitation, une sonde interne, le Hub
ou un développeur avec `curl`.

Il **identifie un appelant de confiance, pas une personne**. Dès qu'il faut savoir *qui* agit, avec
quels droits et pour quel tenant, c'est le jeton délégué (UC-SEC-03) qui prend le relais.

## Ce que le socle fait · ce qu'il interdit
Le socle applique la vérification **dans un middleware, avant le routage** : une route protégée
répond 401 sans que le code de l'application soit atteint. La comparaison du secret se fait à temps
constant. La liste des préfixes protégés est la même que celle du filtre d'administration Java —
c'est un point de contrat.

Le démarrage est **fermé par défaut** : si l'administration est exposée sans clé, l'instance
refuse de démarrer, sauf activation explicite d'une porte de développement (bruyante dans les
journaux). Cette fermeture par défaut a été alignée entre les moteurs dans le cadre de la
sécurisation des surfaces (UC-SEC-07).

## Exemples
### Configuration
```yaml
socle:
  admin:
    api-key: ${ADMIN_API_KEY:}
    public-endpoints: "${ADMIN_PUBLIC_ENDPOINTS:/health,/health/live,/health/ready,/metrics}"
  security:
    allow-insecure-admin: ${ALLOW_INSECURE_ADMIN:false}   # développement UNIQUEMENT
```

### Appeler
```bash
curl -H "X-Admin-Key: $ADMIN_API_KEY" localhost:8080/admin/workers
curl localhost:8080/admin/workers
# {"error":"Unauthorized","message":"…","timestamp":1792072779603}
```

### En local, sans clé
```bash
ALLOW_INSECURE_ADMIN=true socle-py-django run      # journaux explicites, jamais en production
```

### En production
La clé est injectée par la plateforme (variable d'environnement fournie par le Hub ou le
gestionnaire de secrets), jamais écrite dans le fichier de configuration du dépôt.

## Pièges courants
- **Mettre la clé dans le dépôt** : elle finit dans l'historique Git, donc elle est compromise.
- **Partager la même clé entre environnements** : une fuite en préproduction ouvre la production.
- **Croire une route ouverte parce qu'elle répond en local** : vérifier avec la configuration de
  production, où la clé est exigée.
- **Utiliser la clé pour un utilisateur final** : aucune identité, aucun tenant, aucun audit
  nominatif.
- **Oublier que la liste publique est configurable** : une route ajoutée par erreur à cette liste
  ouvre une surface.

## Cas d'usage voisins
- UC-SEC-02 — protéger /mcp par clé
- UC-SEC-03 — accepter les JWT délégués du Hub
- UC-SEC-07 — fermer par défaut les surfaces non publiques
- UC-SEC-08 — déclarer les routes publiques
