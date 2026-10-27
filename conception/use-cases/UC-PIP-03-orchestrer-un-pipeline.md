---
id: UC-PIP-03
titre: "Orchestrer un pipeline V2"
theme: "UC-PIP · Pipelines"
moteurs:
  java: ok
  socle-py: hors
  socle-py-django: hors
contrat: "5.9"
mecanismes: "orchestrateur de pipeline, état en TechDB, reprise, observabilité"
---

# UC-PIP-03 — Orchestrer un pipeline V2

## Questions auxquelles répond ce cas d'usage
1. Qui déclenche un pipeline, et comment suit-on son avancement ?
2. Où est conservé l'état d'une exécution, et survit-il au redémarrage ?
3. Comment reprendre une exécution interrompue sans tout refaire ?
4. Comment mesurer le débit et repérer l'étape qui ralentit l'ensemble ?
5. Comment arrêter une exécution en cours proprement ?
6. Dans les moteurs Python, comment orchestrer un enchaînement d'étapes ?

## Mots-clés
orchestration, pipeline, exécution, état, `TechDB`, reprise, point de reprise,
avancement, débit, goulot d'étranglement, observabilité, arrêt, annulation,
hors périmètre, offsets

## Ce que c'est, et quand s'en servir
Un pipeline a besoin d'un chef d'orchestre : quelque chose qui le déclenche, suit son état, permet
de reprendre après incident et dit où il en est. Sans cela, on a un enchaînement d'étapes, pas un
traitement exploitable.

Le point crucial est l'**état persistant** : une exécution qui ne vit qu'en mémoire est perdue au
redémarrage, et personne ne sait ce qui a été traité.

## Ce que le socle fait · ce qu'il interdit
Java : un worker d'orchestration pilote les exécutions, conserve l'état en base technique, et
publie des métriques par étape — ce qui permet de repérer le goulot d'étranglement.

Moteurs Python : **hors périmètre** pour le moteur. Ce qui existe et qu'on utilise : les
**offsets** de la base technique pour la reprise (UC-DB-01), le bus fiable pour le passage d'étape
en étape, et les statistiques des workers pour l'avancement. C'est à écrire, mais les briques sont
là.

Dans les deux cas, une exigence : savoir dire « traité jusqu'à X ». Un traitement de masse sans
point de reprise impose de tout rejouer après le moindre incident.

## Exemples
### Moteurs Python — reprise par offset
```python
def do_work(self) -> None:
    depuis = self.techdb.get_offset("etl:orders") or 0
    lignes = self.techdb.run(lambda: selectors.OrderSelector.get_since(x_id=depuis, limit=500))
    for ligne in lignes:
        self._kv_bus.publish("etl/extracted", {"id": ligne.x_id})
    if lignes:
        # Point de reprise écrit APRÈS publication : au pire, on republie (idempotence requise).
        self.techdb.save_offset("etl:orders", topic="orders", value=lignes[-1].x_id)
```

### Suivre l'avancement
```python
def get_stats(self) -> dict:
    return {"offset": self.techdb.get_offset("etl:orders") or 0,
            "published": self._published,
            "dlq_size": self._kv_bus.dlq_sizes().get("etl/extracted/transform_worker", 0)}
```

### Socle Java
Le worker d'orchestration expose ses exécutions et leur état ; les métriques par étape montrent le
débit et les files.

## Pièges courants
- **État d'exécution en mémoire seule** : perdu au redémarrage, et plus personne ne sait où on en
  était.
- **Point de reprise écrit avant le traitement** : en cas d'incident, on saute des éléments. Après,
  on en republie — et l'idempotence rattrape (UC-BUS-07).
- **Aucune mesure par étape** : impossible de savoir laquelle freine.
- **Un lot sans limite** : un traitement de masse qui charge tout en mémoire.
- **Pas d'arrêt propre** : une exécution interrompue laisse un état incohérent.

## Cas d'usage voisins
- UC-PIP-02 — déclarer une étape typée
- UC-PIP-04 — motifs de pipeline courants
- UC-DB-01 — persister l'état technique
- UC-BUS-07 — rendre un consommateur idempotent
