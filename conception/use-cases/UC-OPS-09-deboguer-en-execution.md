---
id: UC-OPS-09
titre: "Déboguer en cours d'exécution"
theme: "UC-OPS · Workers intégrés du framework"
moteurs:
  java: ok
  socle-py: hors
  socle-py-django: hors
contrat: "5.9"
mecanismes: "DebugWorker, Arthas, threads, piles d'appel, scopes dédiés"
---

# UC-OPS-09 — Déboguer en cours d'exécution

## Questions auxquelles répond ce cas d'usage
1. Comment inspecter une instance en production sans l'arrêter ?
2. Quelles informations peut-on obtenir : fils d'exécution, piles d'appel, état mémoire ?
3. Qui a le droit d'utiliser ces outils, et comment est-ce protégé ?
4. Quels risques pour la stabilité et la confidentialité ?
5. Dans les moteurs Python, ce mécanisme existe-t-il ?
6. Que faire à la place pour diagnostiquer un blocage en production ?

## Mots-clés
débogage, `DebugWorker`, Arthas, in-process, fils d'exécution, threads, pile d'appel,
mémoire, diagnostic en production, scope dédié, risque, confidentialité, hors périmètre,
journalisation, statistiques, blocage

## Ce que c'est, et quand s'en servir
Inspecter une application vivante : lister les fils d'exécution, obtenir une pile d'appel, regarder
l'état de la machine. Le Socle Java intègre un worker dédié, passif, avec des actions protégées par
des droits spécifiques.

C'est l'outil de dernier recours — quand les journaux et les statistiques ne suffisent pas à
expliquer un blocage.

## Ce que le socle fait · ce qu'il interdit
Java : le worker de débogage est passif, démarre tard, et chaque action exige un droit dédié. Le
cloisonnement est serré pour une bonne raison : ces outils donnent accès à l'intérieur du
processus, donc potentiellement à des données en mémoire.

Moteurs Python : **hors périmètre**. Le diagnostic passe par ce qui est prévu pour cela — les
journaux avec leurs marqueurs d'étape (UC-SUP-10), les statistiques des workers (UC-WRK-08), les
événements (UC-DB-05). Un blocage se diagnostique d'abord par ces trois sources.

Ce qu'il ne faut surtout pas faire en Python : ouvrir un interpréteur distant ou une console
d'exécution « temporaire » sur une instance de production. C'est une porte ouverte, et elle reste
ouverte.

## Exemples
### Socle Java
```bash
curl -X POST -H "X-Admin-Key: $ADMIN_API_KEY" -H "Content-Type: application/json" -d '{}' \
  localhost:8080/admin/workers/debug_worker/actions/debug_status
```

### Moteurs Python — diagnostiquer avec ce qui existe
```bash
# 1. l'état déclaré
curl -s -H "X-Admin-Key: $ADMIN_API_KEY" localhost:8080/admin/workers | jq
# 2. les journaux, par marqueur d'étape
grep -E "\[step:(scheduler_task_error|worker_initialized)\]" logs/app.log | tail -40
# 3. la pile d'un processus bloqué, depuis le système
kill -QUIT <pid>        # ou py-spy dump --pid <pid>, en dehors du périmètre du socle
```

## Pièges courants
- **Laisser un outil de débogage activé** : la surface reste ouverte après l'incident.
- **Une console d'exécution en production** : exécution de code arbitraire, et accès aux données.
- **Déboguer sans avoir lu les journaux** : la réponse y est souvent déjà.
- **Oublier la confidentialité** : une pile d'appel ou un dump mémoire contient des données
  métier.

## Cas d'usage voisins
- UC-SUP-10 — journaliser avec un contexte de corrélation
- UC-WRK-08 — publier santé et statistiques
- UC-DB-05 — lire les événements récents
- UC-OPS-08 — charger des plugins à chaud
