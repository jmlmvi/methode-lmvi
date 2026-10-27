---
id: UC-CFG-06
titre: "Documenter les clés de configuration d'une application"
theme: "UC-CFG · Configuration"
moteurs:
  java: ok
  socle-py: ok
  socle-py-django: ok
contrat: "5.9"
mecanismes: "application.yml commenté, .env.example, README généré"
---

# UC-CFG-06 — Documenter les clés de configuration d'une application

## Questions auxquelles répond ce cas d'usage
1. Comment un exploitant sait-il quelles variables il doit fournir ?
2. Où documenter une clé — dans le fichier, dans le README, ou les deux ?
3. Comment distinguer les variables obligatoires de celles qui ont un défaut acceptable ?
4. Comment signaler qu'une variable contient un secret ?
5. Comment éviter que la documentation se périme ?
6. Que faut-il livrer avec l'application pour qu'elle soit déployable par quelqu'un d'autre ?

## Mots-clés
documentation des clés, `application.yml`, commentaires, `.env.example`, variables
obligatoires, défaut, secret, README, déploiement, exploitant, périmée, revue,
tableau des variables, projet généré

## Ce que c'est, et quand s'en servir
Une application n'est déployable que si quelqu'un d'autre que son auteur sait quoi lui fournir.
Trois supports complémentaires : le fichier de configuration **commenté** (la clé, son sens, son
défaut), un fichier d'exemple de variables **sans valeurs** (la liste de ce qu'il faut remplir), et
un tableau dans le README pour les variables qui comptent au déploiement.

Le projet généré livre les trois dès le départ — c'est le moment où cela coûte le moins cher.

## Ce que le socle fait · ce qu'il interdit
Le socle documente ses propres clés dans sa référence de configuration ; les clés applicatives sont
à votre charge. Rien n'est automatique : une clé non documentée est une clé que l'exploitant
découvrira dans un message d'erreur.

Ce qui périme la documentation : lire une clé dans le code sans l'ajouter au fichier. La lecture et
la déclaration vont ensemble, dans le même changement.

## Exemples
### Le fichier dit le sens et le défaut
```yaml
app:
  orders:
    # Plafond d'une commande, en centimes. Au-delà : refus AMOUNT_ABOVE_LIMIT.
    max-amount-cents: ${APP_ORDERS_MAX_AMOUNT_CENTS:100000}
    # Encours confirmé maximum par tenant, en centimes.
    max-outstanding-cents: ${APP_ORDERS_MAX_OUTSTANDING_CENTS:500000}
```

### Le fichier d'exemple liste ce qu'il faut fournir
```bash
# .env.example — copier en .env, qui n'est jamais commité
ADMIN_API_KEY=            # OBLIGATOIRE — clé de l'API d'administration
MCP_API_KEY=              # OBLIGATOIRE si MCP est activé
TECHDB_BACKEND=postgres
TECHDB_URL=
TRUSTED_PROXIES=          # vide = l'en-tête de tenant n'est jamais honoré
```

### Le README porte le tableau utile au déploiement
| Variable | Obligatoire | Défaut | Rôle |
|---|---|---|---|
| `ADMIN_API_KEY` | oui | — | clé de l'API d'administration |
| `TECHDB_BACKEND` | non | `h2` | moteur de la base technique |
| `TRUSTED_PROXIES` | non | vide | proxys dont l'en-tête de tenant est cru |

## Pièges courants
- **Lire une clé sans la déclarer** : elle n'existe pour personne d'autre que son auteur.
- **Mettre des valeurs dans le fichier d'exemple** : il finit copié tel quel, avec un faux secret.
- **Documenter ailleurs que près du code** : la documentation lointaine se périme la première.
- **Oublier de dire qu'une variable est un secret** : elle se retrouve dans un ticket ou un canal
  de discussion.
- **Ne pas dire ce qu'implique un défaut** : « vide » peut signifier « désactivé » ou « jamais
  honoré », ce n'est pas la même chose.

## Cas d'usage voisins
- UC-CFG-01 — configurer par fichier
- UC-CFG-04 — lire une clé typée
- UC-SEC-12 — lire ses secrets au démarrage
- UC-DEV-02 — obtenir un squelette complet en couches
