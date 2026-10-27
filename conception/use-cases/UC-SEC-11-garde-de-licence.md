---
id: UC-SEC-11
titre: "Garde de licence TheSocle"
theme: "UC-SEC · Sécurité et identité"
moteurs:
  java: ok
  socle-py: P-4
  socle-py-django: P-4
contrat: "5.9"
mecanismes: "LicenseGuard, TOFU, enregistrement, non bloquant, F5"
---

# UC-SEC-11 — Garde de licence TheSocle

## Questions auxquelles répond ce cas d'usage
1. À quoi sert la garde de licence, et qu'est-ce qu'elle vérifie ?
2. Est-ce qu'une licence absente ou invalide empêche l'application de démarrer ?
3. Que signifie l'enregistrement à la première utilisation ?
4. Où l'état de la licence est-il visible pour un exploitant ?
5. Dans les moteurs Python, ce mécanisme est-il présent ?
6. Comment se comporte une instance hors connexion ?

## Mots-clés
licence, `LicenseGuard`, TOFU, confiance à la première utilisation, enregistrement,
non bloquant, démarrage, état de licence, exploitation, hors connexion,
avertissement, F5, P-4

## Ce que c'est, et quand s'en servir
Un mécanisme d'enregistrement de l'instance auprès de la plateforme, sur le principe de la confiance
à la première utilisation : la première annonce fixe l'identité, les suivantes la confirment.

Le point important pour un développeur est le **comportement choisi** : la garde ne bloque pas le
démarrage. Une licence absente, expirée ou injoignable produit un avertissement et un état visible,
pas une application morte — un choix d'exploitation, pour qu'un problème administratif n'ait pas
l'effet d'une panne.

## Ce que le socle fait · ce qu'il interdit
Java : la garde s'enregistre au démarrage, conserve l'état, et l'expose aux surfaces
d'exploitation. Moteurs Python : phase **P-4**.

Ce qu'il ne faut pas faire : conditionner une fonctionnalité métier à l'état de licence dans son
propre code. L'application sert, et l'état de licence est une information d'exploitation.

## Exemples
### Socle Java — l'état, pour l'exploitant
```bash
curl -H "X-Admin-Key: $ADMIN_API_KEY" localhost:8080/admin/workers | jq '.license_guard'
```

### Ce qu'on lit dans les journaux
```
… WARN  eu.lmvi.socle.license - [step:license_not_registered] démarrage poursuivi
```

## Pièges courants
- **Attendre un blocage** : il n'y en a pas, par choix. Surveiller l'état plutôt que de compter sur
  un échec de démarrage.
- **Lier du métier à la licence** : une règle de gestion ne dépend pas d'un enregistrement de
  plateforme.
- **Oublier le cas hors connexion** : l'instance doit servir sans joindre la plateforme.

## Cas d'usage voisins
- UC-SEC-10 — s'enregistrer auprès du registre de workers
- UC-SEC-12 — lire ses secrets au démarrage
- UC-SUP-02 — lister les workers et leur état
- UC-INT-06 — s'insérer derrière la Gateway
