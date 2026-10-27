---
id: UC-SEC-12
titre: "Lire ses secrets au démarrage (Vault)"
theme: "UC-SEC · Sécurité et identité"
moteurs:
  java: ok
  socle-py: P-4
  socle-py-django: P-4
contrat: "5.9"
mecanismes: "signal Vault, injection par l'environnement, F6"
---

# UC-SEC-12 — Lire ses secrets au démarrage (Vault)

## Questions auxquelles répond ce cas d'usage
1. Où mon application doit-elle prendre ses secrets — fichier, environnement, coffre ?
2. Comment un secret arrive-t-il dans une instance déployée ?
3. Que faire si le coffre n'est pas disponible au démarrage ?
4. Peut-on recharger un secret sans redémarrer ?
5. Dans les moteurs Python, l'intégration au coffre existe-t-elle ?
6. Comment éviter qu'un secret apparaisse dans les journaux ou l'audit ?

## Mots-clés
secret, Vault, coffre, signal Vault, variable d'environnement, injection, `ADMIN_API_KEY`,
`MCP_API_KEY`, clé privée JWT, rotation, rechargement, journaux, masquage,
`.env`, dépôt, F6, P-4

## Ce que c'est, et quand s'en servir
Les secrets d'une application — clés d'accès, identifiants de base, clés de signature — ne vivent
ni dans le dépôt ni dans l'image. Ils sont fournis à l'instance au démarrage, par l'environnement,
alimenté par la plateforme ou un coffre.

Le signal de disponibilité du coffre au démarrage est une US de la phase **P-4** pour les moteurs
Python ; le mécanisme de base, lui, fonctionne déjà partout : la configuration lit des variables
d'environnement, et c'est la plateforme qui les remplit.

## Ce que le socle fait · ce qu'il interdit
Le socle lit la configuration avec substitution d'environnement (UC-CFG-01), donc tout secret est
une variable. Il masque les valeurs sensibles dans l'audit des actions (UC-ACT-06).

Ce qu'il ne fait pas : protéger vos propres traces. Un secret journalisé par votre code est un
secret en clair, conservé. Et il n'y a pas de rechargement à chaud : un secret changé demande un
redémarrage de l'instance — ce qui doit être prévu dans la procédure de rotation.

## Exemples
### Un secret est une variable, jamais une valeur en dur
```yaml
socle:
  admin:
    api-key: ${ADMIN_API_KEY:}        # pas de défaut : absent = administration fermée
  mcp:
    api-key: ${MCP_API_KEY:}
```

### Le fichier d'exemple, dans le dépôt — sans valeurs
```bash
# .env.example  (le .env réel n'est JAMAIS commité)
ADMIN_API_KEY=
MCP_API_KEY=
TECHDB_URL=
TRUSTED_PROXIES=
```

### Vérifier qu'aucun secret n'est versionné
```bash
git grep -nE "(api[-_]?key|secret|password)\s*[:=]\s*[^\$\s]" -- ':!*.example' | head
```

## Pièges courants
- **Un défaut en dur** pour « faire tourner en local » : il finit en production.
- **Un secret commité** : l'historique Git le conserve, donc il est à révoquer, pas à supprimer.
- **Journaliser la configuration complète** au démarrage : les secrets partent avec.
- **Oublier le redémarrage** après rotation : l'instance travaille avec l'ancien secret jusqu'à son
  prochain démarrage.
- **Croire le masquage de l'audit universel** : il protège l'audit des actions, pas vos messages de
  journal.

## Cas d'usage voisins
- UC-CFG-01 — configurer par fichier
- UC-ACT-06 — auditer les invocations
- UC-SEC-01 — protéger l'API d'administration par clé
- UC-DEV-06 — construire et lancer la pile Docker
