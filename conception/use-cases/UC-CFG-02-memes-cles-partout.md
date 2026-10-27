---
id: UC-CFG-02
titre: "Partager les mêmes clés de configuration entre les moteurs"
theme: "UC-CFG · Configuration"
moteurs:
  java: ok
  socle-py: ok
  socle-py-django: ok
contrat: "5.9"
mecanismes: "clés socle.*, contrat, préfixe socle.python, RG-22"
---

# UC-CFG-02 — Partager les mêmes clés de configuration entre les moteurs

## Questions auxquelles répond ce cas d'usage
1. La configuration d'un backend Java est-elle valable pour un backend Python ?
2. Pourquoi existe-t-il quelques clés propres à l'implémentation Python ?
3. Comment nommer une clé nouvelle sans casser l'alignement des moteurs ?
4. Où est écrite la liste de référence des clés ?
5. Que se passe-t-il si un moteur ignore une clé que l'autre honore ?
6. Comment vérifier qu'une clé est bien lue, et pas silencieusement ignorée ?

## Mots-clés
clés partagées, `socle.*`, contrat de configuration, alignement, `socle.python`,
exception RG-22, référence des clés, conformité, divergence, ignorée silencieusement,
migration de clé, dépréciation

## Ce que c'est, et quand s'en servir
Les clés de configuration du socle font partie du **contrat** : un exploitant qui connaît un backend
sait configurer les autres, et les outils de la plateforme peuvent écrire une configuration sans
savoir quel moteur tourne derrière.

L'exception est explicite et limitée : les clés qui n'ont de sens que dans l'implémentation Python
(paquets de workers à balayer, réglages de la couche web Python) vivent sous un préfixe dédié. Tout
le reste est commun.

## Ce que le socle fait · ce qu'il interdit
Chaque moteur lit les clés communes avec le même nom et le même sens. La suite de conformité vérifie
le comportement qui en découle (UC-CTR-02), ce qui attrape les divergences de lecture.

Ce qu'un moteur ne fait pas : prévenir qu'une clé inconnue a été ignorée. Une clé mal orthographiée
est donc silencieuse — c'est le piège le plus courant, et la raison pour laquelle on vérifie l'effet,
pas la présence de la ligne.

Une clé nouvelle qui concerne le comportement observable est une **évolution de contrat** : elle se
décide et se livre dans les trois moteurs (UC-CTR-05).

## Exemples
### Clés communes
```yaml
socle:
  app_name: ${APP_NAME:mon-app}
  http: {port: ${HTTP_PORT:8080}}
  admin: {api-key: ${ADMIN_API_KEY:}}
  techdb: {backend: ${TECHDB_BACKEND:h2}}
  mcp: {enabled: ${MCP_ENABLED:true}}
```

### Clés propres à l'implémentation Python
```yaml
socle:
  python:
    worker-packages: ${SOCLE_WORKER_PACKAGES:mon_app.workers}
    django:
      installed-apps: ${SOCLE_PYTHON_DJANGO_INSTALLED_APPS:mon_app.orders}
```

### Vérifier l'effet d'une clé, pas sa présence
```bash
HTTP_PORT=18380 socle-py-django run &
curl -s localhost:18380/health/ready >/dev/null && echo "clé honorée"
```

## Pièges courants
- **Une faute de frappe** : la clé est ignorée sans un mot. Vérifier l'effet observable.
- **Inventer une clé sous le préfixe du socle** pour un besoin applicatif : elle entre en collision
  avec le contrat.
- **Ajouter une clé dans un seul moteur** : la configuration cesse d'être portable, et la
  conformité finit par le dire.
- **Renommer une clé sans transition** : les déploiements existants perdent leur réglage
  silencieusement.

## Cas d'usage voisins
- UC-CFG-01 — configurer par fichier
- UC-CTR-01 — écrire un contrat hors du code
- UC-CTR-05 — faire évoluer un contrat dans les trois moteurs
- UC-CFG-06 — documenter les clés d'une application
