---
id: UC-SUP-12
titre: "Tableau de bord d'exploitation des workers"
theme: "UC-SUP · Supervision et exploitation"
moteurs:
  java: ok
  socle-py: P-4
  socle-py-django: P-4
contrat: "5.9"
mecanismes: "StatusDashboardWorker, /dashboard, pages d'exploitation, I1"
---

# UC-SUP-12 — Tableau de bord d'exploitation des workers

## Questions auxquelles répond ce cas d'usage
1. Existe-t-il une page qui montre l'état des workers sans passer par des appels JSON ?
2. Qui a accès à cette page, et comment est-elle protégée ?
3. Que montre-t-elle de plus que la liste des workers ?
4. Peut-on y agir — relancer, déclencher, drainer ?
5. Dans les moteurs Python, cette page existe-t-elle ?
6. Est-ce raisonnable de l'ouvrir à des utilisateurs non techniques ?

## Mots-clés
tableau de bord, `/dashboard`, `StatusDashboardWorker`, page d'exploitation, état des
workers, santé, statistiques, actions d'exploitation, protection par clé, Jinja2,
Alpine.js, lecture, pilotage, I1, P-4

## Ce que c'est, et quand s'en servir
Une page servie par l'application qui présente l'état de l'instance : workers, santé,
statistiques, planifications — et, côté Java, des commandes d'exploitation. C'est le confort qui
évite de composer des appels à la main pendant un incident.

Elle ne remplace pas une supervision centralisée : elle montre **une** instance, à **un** instant.

## Ce que le socle fait · ce qu'il interdit
Java : la page fait partie des pages d'exploitation, adossée aux mêmes services que la liste des
workers, et protégée comme les autres surfaces d'administration. Moteurs Python : phase **P-4**,
avec l'ensemble des pages ; les mêmes données sont déjà disponibles en JSON (UC-SUP-02).

Ce qu'il ne faut pas faire : ouvrir cette page à un public non technique pour « donner de la
visibilité ». Elle expose la mécanique interne, et parfois des commandes d'exploitation. Un public
métier a besoin d'un écran métier, pas du tableau de bord du socle.

## Exemples
### Socle Java
```bash
open https://mon-app.thesocle.net/dashboard      # clé d'administration exigée
```

### Moteurs Python — les mêmes données, en attendant
```bash
watch -n 5 'curl -s -H "X-Admin-Key: $ADMIN_API_KEY" localhost:8080/admin/workers \
  | jq ".workers | to_entries[] | {(.key): {healthy: .value.healthy, stats: .value.stats}}"'
```

## Pièges courants
- **L'exposer publiquement** : c'est une surface d'administration, protégée par défaut pour cette
  raison.
- **La confondre avec une supervision** : pas d'historique, pas d'agrégation multi-instances.
- **Y chercher le métier** : elle parle de workers, pas de commandes ni de clients.
- **Y donner des commandes sans audit** : toute action d'exploitation doit être tracée.

## Cas d'usage voisins
- UC-SUP-02 — lister les workers et leur état
- UC-UI-01 — servir le tableau de bord des workers
- UC-SEC-07 — fermer par défaut les surfaces non publiques
- UC-SUP-08 — exposer des métriques Prometheus
