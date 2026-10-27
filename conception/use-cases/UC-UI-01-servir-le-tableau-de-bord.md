---
id: UC-UI-01
titre: "Servir le tableau de bord des workers"
theme: "UC-UI · Pages et frontend"
moteurs:
  java: ok
  socle-py: P-4
  socle-py-django: P-4
contrat: "5.9"
mecanismes: "page /dashboard, gabarits, protection par clé"
---

# UC-UI-01 — Servir le tableau de bord des workers

## Questions auxquelles répond ce cas d'usage
1. Comment obtenir une page d'état plutôt que du JSON ?
2. Quelle adresse, et quelle protection ?
3. Quelles données la page affiche-t-elle, et d'où viennent-elles ?
4. Peut-on la personnaliser pour son application ?
5. Dans les moteurs Python, où en est cette page ?
6. Faut-il l'activer explicitement ?

## Mots-clés
tableau de bord, `/dashboard`, page, gabarit, Jinja2, Thymeleaf, Alpine.js,
état des workers, santé, statistiques, protection par clé, exploitation,
activation, P-4

## Ce que c'est, et quand s'en servir
La présentation visuelle de ce que la liste des workers donne en JSON : une page, servie par
l'application, qui montre l'état de l'instance. Utile pendant un incident, quand on n'a pas envie de
composer des appels.

## Ce que le socle fait · ce qu'il interdit
Java : la page est servie par le framework, alimentée par les mêmes services que la liste des
workers, et protégée comme les autres surfaces d'administration. Moteurs Python : phase **P-4**,
avec l'ensemble des pages d'exploitation — les données, elles, sont déjà disponibles (UC-SUP-02).

Ce qu'il ne faut pas faire : réécrire sa propre page d'état dans l'application. Elle divergerait de
celle du socle, et il faudrait la maintenir ; en attendant la page officielle, le JSON suffit.

## Exemples
### Socle Java
```bash
open https://mon-app.thesocle.net/dashboard        # clé d'administration exigée
```

### Moteurs Python — les mêmes données
```bash
curl -s -H "X-Admin-Key: $ADMIN_API_KEY" localhost:8080/admin/workers \
  | jq '.workers | to_entries[] | {worker: .key, healthy: .value.healthy, stats: .value.stats}'
```

### Configuration (Java)
```yaml
socle:
  dashboard:
    enabled: ${DASHBOARD_ENABLED:true}
```

## Pièges courants
- **La croire publique** : c'est une surface d'administration, protégée par défaut.
- **Y chercher un historique** : c'est un instantané.
- **Écrire une page concurrente** dans l'application : double maintenance.
- **La donner à un public métier** : elle parle de workers, pas de métier.

## Cas d'usage voisins
- UC-SUP-12 — tableau de bord d'exploitation
- UC-SUP-02 — lister les workers et leur état
- UC-UI-06 — rendre une page avec un moteur de gabarits
- UC-SEC-07 — fermer par défaut les surfaces non publiques
