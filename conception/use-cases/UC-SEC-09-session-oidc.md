---
id: UC-SEC-09
titre: "Protéger des routes par session OIDC"
theme: "UC-SEC · Sécurité et identité"
moteurs:
  java: ok
  socle-py: ok
  socle-py-django: ok
contrat: "5.9"
mecanismes: "socle.oidc.protected-paths, JWT exigé, RG-16"
---

# UC-SEC-09 — Protéger des routes par session OIDC

## Questions auxquelles répond ce cas d'usage
1. Comment réserver une famille de routes aux utilisateurs authentifiés ?
2. Quelle différence avec la protection par clé d'administration ?
3. Quelles routes sont concernées par défaut ?
4. Puis-je y mettre les routes d'une interface utilisateur de mon application ?
5. Que répond l'instance à un appel sans jeton sur une route protégée ainsi ?
6. Pourquoi certaines pages du Hub répondent-elles 401 à un utilisateur connecté ?

## Mots-clés
OIDC, session, `protected-paths`, `SOCLE_OIDC_PROTECTED_PATHS`, jeton exigé,
JWT délégué, RG-16, `/api/repository`, interface utilisateur, pages du Hub,
401, authentification d'utilisateur, arbitrage 5.10

## Ce que c'est, et quand s'en servir
Une liste de chemins pour lesquels un **jeton délégué valide est exigé** — pas une clé d'appelant de
confiance, mais une identité d'utilisateur. C'est la bonne protection pour tout ce qui est destiné à
une personne : interface, API consommée par un frontend, ressources éditables.

La distinction est importante. La clé d'administration convient à un script ou à une sonde ; elle ne
dit pas qui agit. Sur une surface utilisateur, on veut l'identité — pour l'audit, pour les scopes,
pour le tenant.

## Ce que le socle fait · ce qu'il interdit
Le socle exige et vérifie le jeton sur ces chemins (UC-SEC-03) et pose l'identité résolue. La liste
est configurable ; par défaut elle couvre les ressources éditables du socle.

Un point connu, et assumé : certaines pages du Hub sont protégées par la **clé d'administration**
depuis la sécurisation par défaut, alors que la bonne réponse pour un utilisateur serait une session
OIDC. L'arbitrage est posé pour une version ultérieure. En attendant, un utilisateur ne peut pas
atteindre ces pages avec son seul jeton — ce n'est pas un bogue, c'est un chantier identifié.

## Exemples
### Configuration
```yaml
socle:
  oidc:
    enabled: ${SOCLE_OIDC_ENABLED:false}
    protected-paths: ${SOCLE_OIDC_PROTECTED_PATHS:/api/repository}
```

### Protéger les routes d'une interface applicative
```bash
SOCLE_OIDC_ENABLED=true \
SOCLE_OIDC_PROTECTED_PATHS=/api/repository,/app/api \
socle-py-django run
```

### Ce que reçoit un appel sans jeton
```json
{"error": "invalid_token", "detail": "Authorization header manquant ou mal formé"}
```

## Pièges courants
- **Activer la liste sans configurer l'émetteur** : toutes les requêtes sont refusées, et le
  message parle de jeton alors que le problème est la configuration.
- **Protéger une sonde** : l'orchestrateur d'infrastructure ne peut plus l'interroger.
- **Mélanger les deux protections sur la même route** : décider laquelle a du sens, et la
  documenter.
- **Croire qu'un jeton valide donne tous les droits** : les scopes restent à vérifier (UC-ACT-04).

## Cas d'usage voisins
- UC-SEC-03 — accepter les JWT délégués du Hub
- UC-SEC-07 — fermer par défaut les surfaces non publiques
- UC-SEC-08 — déclarer les routes publiques
- UC-UI-04 — héberger un frontend FrontendShell
