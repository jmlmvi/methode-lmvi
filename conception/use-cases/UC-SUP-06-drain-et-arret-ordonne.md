---
id: UC-SUP-06
titre: "Drainer puis arrêter proprement"
theme: "UC-SUP · Supervision et exploitation"
moteurs:
  java: ok
  socle-py: P-4
  socle-py-django: P-4
contrat: "5.9"
mecanismes: "DRAINING, priorités d'arrêt, graceful shutdown, B7"
---

# UC-SUP-06 — Drainer puis arrêter proprement

## Questions auxquelles répond ce cas d'usage
1. Comment arrêter une instance sans couper un traitement en cours ?
2. Qu'est-ce que le drain, et que devient le trafic pendant cette phase ?
3. Dans quel ordre les workers sont-ils arrêtés ?
4. Combien de temps le socle attend-il avant de forcer l'arrêt ?
5. Que doit faire mon worker dans sa méthode d'arrêt ?
6. Le drain est-il réversible ?
7. Comment un orchestrateur d'infrastructure doit-il déclencher cet arrêt ?

## Mots-clés
drain, `DRAINING`, arrêt propre, graceful shutdown, priorités d'arrêt, `stop_priority`,
SIGTERM, délai de grâce, trafic, sonde de disponibilité, irréversible, travail en cours,
fermeture des ressources, B7, P-4

## Ce que c'est, et quand s'en servir
L'arrêt en deux temps. D'abord le **drain** : plus aucune nouvelle échéance ne démarre, la sonde de
disponibilité passe au rouge, le répartiteur cesse d'envoyer du trafic, les traitements en cours
finissent. Ensuite l'**arrêt** des workers, dans l'ordre de leurs priorités.

C'est ce qui permet un déploiement sans perte : l'instance sortante vide ses traitements pendant que
la nouvelle prend le trafic.

## Ce que le socle fait · ce qu'il interdit
Le socle conduit la séquence : passage en drain, attente des travaux en cours, arrêt ordonné, puis
fin du processus. Le drain de l'orchestrateur est **irréversible** (côté Java ; le drain HTTP seul,
lui, est annulable — UC-SUP-07).

Ce que le socle attend de chaque worker : que sa méthode d'arrêt **rende la main rapidement** et
ferme ce qu'elle a ouvert — souscriptions fiables, pools, fichiers. Un arrêt qui bloque fait expirer
le délai de grâce, et le processus est tué sans ménagement.

La pilotabilité fine du drain en exploitation relève de la phase **P-4** dans les moteurs Python ;
l'arrêt ordonné à la réception du signal, lui, fonctionne déjà.

## Exemples
### Ce que fait un worker à l'arrêt
```python
def stop(self) -> None:
    self._subscription.close()      # ce qu'on a ouvert, on le ferme
    self._pool.close()
    # Pas de travail long ici : on rend la main.
```

### Ce que voit l'infrastructure
```bash
docker compose stop app             # SIGTERM, puis délai de grâce
curl localhost:8080/health/ready    # 503 pendant le drain : à retirer du répartiteur
```

### Les priorités décident de l'ordre
```python
class ReferentialWorker(Worker):
    stop_priority = 200            # s'arrête en dernier : les autres s'en servent
```

## Pièges courants
- **Un arrêt qui attend** : attendre la fin d'une longue tâche dans la méthode d'arrêt fait dépasser
  le délai de grâce.
- **Ne rien fermer** : connexions et souscriptions laissées ouvertes, et un redémarrage qui traîne
  des fantômes.
- **Ignorer le drain dans le répartiteur** : on envoie du trafic à une instance qui s'arrête.
- **Un délai de grâce trop court** côté infrastructure : les traitements en cours sont tués.
- **Compter sur l'arrêt pour sauvegarder** : ce qui compte est écrit au fil de l'eau, pas à la fin.

## Cas d'usage voisins
- UC-SUP-07 — drain HTTP seul, annulable
- UC-WRK-05 — priorités de démarrage et d'arrêt
- UC-SUP-01 — répondre aux sondes de santé
- UC-DEV-06 — construire et lancer la pile Docker
