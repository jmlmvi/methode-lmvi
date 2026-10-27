---
id: UC-SEC-08
titre: "Déclarer les routes publiques d'une application"
theme: "UC-SEC · Sécurité et identité"
moteurs:
  java: ok
  socle-py: ok
  socle-py-django: ok
contrat: "5.9"
mecanismes: "ADMIN_PUBLIC_ENDPOINTS, joker, public-routes.yaml"
---

# UC-SEC-08 — Déclarer les routes publiques d'une application

## Questions auxquelles répond ce cas d'usage
1. Quelles routes sont publiques par défaut, et pourquoi celles-là ?
2. Comment ouvrir une route supplémentaire sans ouvrir le reste ?
3. Le joker en fin de chemin ouvre-t-il tout un sous-arbre ?
4. Faut-il rendre les sondes publiques, et avec quel niveau de détail ?
5. Comment vérifier que je n'ai pas ouvert plus que prévu ?
6. Où est écrit le contrat des routes publiques, commun aux moteurs ?

## Mots-clés
routes publiques, `ADMIN_PUBLIC_ENDPOINTS`, `public-endpoints`, joker, préfixe,
`/health`, `/health/live`, `/health/ready`, `/metrics`, `public-routes.yaml`, contrat,
ouverture de surface, sondes, orchestrateur d'infrastructure, vérification

## Ce que c'est, et quand s'en servir
La liste des chemins accessibles sans titre d'accès. Par défaut, les sondes de santé et les
métriques simples — c'est le minimum pour qu'un orchestrateur d'infrastructure puisse décider si
l'instance est vivante et prête.

On y ajoute une route quand un appelant anonyme doit légitimement l'atteindre : une page d'accueil
publique, un point de contrôle d'un répartiteur. Chaque ajout est une décision de sécurité, pas un
réglage de confort.

## Ce que le socle fait · ce qu'il interdit
Le socle compare le chemin à la liste, en acceptant un joker en fin de chemin qui ouvre **tout le
sous-arbre**. C'est puissant et dangereux : la différence entre un chemin exact et un préfixe avec
joker est la différence entre une route et une famille de routes.

La liste des routes publiques fait partie des contrats partagés : elle est écrite hors du code,
identique pour les trois moteurs, et vérifiée par la suite de conformité (UC-CTR-02).

## Exemples
### Configuration
```yaml
socle:
  admin:
    public-endpoints: "${ADMIN_PUBLIC_ENDPOINTS:/health,/health/live,/health/ready,/metrics}"
```

### Ajouter une route publique
```bash
ADMIN_PUBLIC_ENDPOINTS=/health,/health/live,/health/ready,/metrics,/public/accueil \
  socle-py-django run
```

### Le joker, et ce qu'il ouvre vraiment
```bash
# /public/* ouvre TOUT ce qui commence par /public/ — y compris ce qui sera ajouté demain.
ADMIN_PUBLIC_ENDPOINTS=/health,/public/*
```

### Vérifier ce qui est réellement ouvert
```bash
for p in /health /health/ready /admin/workers /mcpagger/spec.json /public/accueil; do
  printf '%-24s %s\n' "$p" "$(curl -s -o /dev/null -w '%{http_code}' localhost:8080$p)"
done
```

## Pièges courants
- **Ouvrir avec un joker trop haut** (`/admin/*`, `/*`) : toute la surface d'administration devient
  publique.
- **Ouvrir une sonde détaillée** : elle raconte l'intérieur du système ; la version détaillée reste
  protégée, et c'est voulu.
- **Modifier la liste sans relecture** : c'est une liste de sécurité, elle mérite la même attention
  qu'un changement de code.
- **Compter sur l'obscurité d'un chemin** : une route publique est publique, même avec un nom
  improbable.
- **Divergence entre moteurs** : la liste est un contrat ; la changer d'un côté seulement casse la
  conformité.

## Cas d'usage voisins
- UC-SEC-07 — fermer par défaut les surfaces non publiques
- UC-SUP-01 — répondre aux sondes de santé
- UC-CTR-01 — écrire un contrat hors du code
- UC-SEC-09 — protéger des routes par session OIDC
