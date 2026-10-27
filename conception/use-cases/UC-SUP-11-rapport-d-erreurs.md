---
id: UC-SUP-11
titre: "Agréger et expédier un rapport d'erreurs"
theme: "UC-SUP · Supervision et exploitation"
moteurs:
  java: ok
  socle-py: P-4
  socle-py-django: P-4
contrat: "5.9"
mecanismes: "error reporting, capture des journaux ERROR, envoi à blanc, K4"
---

# UC-SUP-11 — Agréger et expédier un rapport d'erreurs

## Questions auxquelles répond ce cas d'usage
1. Comment être prévenu des erreurs d'une instance sans lire ses journaux ?
2. Qu'est-ce qui est capturé exactement, et par quel mécanisme ?
3. Comment éviter d'être noyé par des erreurs répétitives ?
4. Comment tester l'envoi sans attendre une vraie panne ?
5. Que se passe-t-il si le destinataire est injoignable ?
6. Dans les moteurs Python, ce rapport existe-t-il ?
7. Quels pièges de contenu — données sensibles, volume ?

## Mots-clés
rapport d'erreurs, error reporting, capture ERROR, agrégation, déduplication,
envoi à blanc, dry-run, destinataire, alerte, bruit, volumétrie, `techdb`,
données sensibles, K4, P-4

## Ce que c'est, et quand s'en servir
Un mécanisme qui **capte les erreurs journalisées**, les regroupe et les expédie — pour qu'une panne
se signale d'elle-même au lieu d'attendre qu'on ouvre les journaux.

Indispensable dès qu'une application tourne sans surveillance humaine continue. Et redoutable si le
niveau de journalisation est mal choisi : tout ce qui est journalisé en erreur part dans le rapport.

## Ce que le socle fait · ce qu'il interdit
Java : un worker intégré capte les journaux d'erreur, les agrège, et les expédie ; son état et ses
compteurs sont visibles en exploitation. Deux leçons d'exploitation sont inscrites dans son
histoire : un worker qui se déclarait sain après une initialisation en échec, et un compteur publié
à une valeur impossible avec une alerte restée au vert — les deux ont été corrigés, et ils montrent
ce qu'on attend d'un tel composant : dire la vérité, et figer l'alerte plutôt que de la laisser
retomber silencieusement.

Moteurs Python : phase **P-4**. En attendant, c'est la collecte de journaux de la plateforme qui
joue ce rôle ; l'important côté application est de **journaliser au bon niveau** (UC-SUP-10) pour
que ce qui sera capté demain soit pertinent.

## Exemples
### Vérifier sans attendre la panne
```bash
# Envoi à blanc : on contrôle la chaîne, pas la panne.
curl -X POST -H "X-Admin-Key: $ADMIN_API_KEY" -H "Content-Type: application/json" -d '{"dry_run":true}' \
  localhost:8080/admin/workers/error_report_worker/actions/send_report
```

### Ce qu'on surveille
```bash
curl -s -H "X-Admin-Key: $ADMIN_API_KEY" localhost:8080/admin/workers \
  | jq '.workers.error_report_worker.stats'
# {"rows_total": 12, "techdb_readable": true, "alert_stale": false}
```

### Ce qui pollue un rapport
```python
log.error("[step:cache_miss] clé absente")   # un cas normal journalisé en erreur → bruit
```

## Pièges courants
- **Journaliser en erreur ce qui est normal** : le rapport devient inexploitable, et les vraies
  pannes passent inaperçues.
- **Pas de déduplication** : une erreur en boucle génère des milliers d'envois.
- **Des données sensibles dans un message d'erreur** : elles partent chez le destinataire.
- **Une alerte qui retombe toute seule** après un incident non résolu : figer l'alerte tant que la
  cause n'est pas traitée.
- **Un composant d'alerte qui se dit sain quand il est cassé** : c'est l'alerte qu'on ne reçoit
  jamais.

## Cas d'usage voisins
- UC-SUP-10 — journaliser avec un contexte de corrélation
- UC-SUP-09 — escalade du superviseur
- UC-OPS-02 — hygiène périodique automatique
- UC-DB-05 — lire les événements récents
