---
id: UC-SUP-08
titre: "Exposer des métriques Prometheus"
theme: "UC-SUP · Supervision et exploitation"
moteurs:
  java: ok
  socle-py: P-4
  socle-py-django: P-4
contrat: "5.9"
mecanismes: "/metrics, SocleMetrics, compteurs, jauges, B3"
---

# UC-SUP-08 — Exposer des métriques Prometheus

## Questions auxquelles répond ce cas d'usage
1. Comment suivre dans le temps ce qu'une application Socle fait ?
2. Quelle route expose les métriques, et est-elle publique ?
3. Quelles métriques le socle fournit-il tout seul ?
4. Comment ajouter une métrique propre à mon métier ?
5. Quelle différence entre une métrique et une statistique de worker ?
6. Dans les moteurs Python, les métriques sont-elles déjà disponibles ?
7. Quels pièges de nommage et de cardinalité éviter ?

## Mots-clés
métriques, Prometheus, `/metrics`, `SocleMetrics`, compteur, jauge, histogramme,
cardinalité, étiquettes, labels, collecte, tendance, alerte, Grafana,
statistiques de worker, B3, P-4

## Ce que c'est, et quand s'en servir
Des séries temporelles : combien d'exécutions, combien d'erreurs, quelle durée, quelle taille de
file. Là où la liste des workers donne un instantané (UC-SUP-02), les métriques donnent la tendance
— donc l'alerte utile et la capacité de dire « depuis quand ».

Dès qu'une application est en production avec un collecteur, c'est le bon canal pour ses indicateurs.

## Ce que le socle fait · ce qu'il interdit
Java : une route de métriques et un composant pour les publier, avec les indicateurs du socle
(workers, actions, bus, base). Moteurs Python : phase **P-4** ; la route des métriques simples fait
partie des chemins publics par défaut, et les indicateurs applicatifs passent pour l'instant par les
statistiques des workers.

Deux règles de prudence, valables partout : ne jamais mettre une valeur à cardinalité élevée en
étiquette (identifiant de commande, adresse, identifiant de tenant sur un parc important) — on fait
exploser la collecte ; et ne pas exposer de valeur métier confidentielle dans une métrique, qui est
souvent moins protégée que le reste.

## Exemples
### Socle Java
```bash
curl localhost:8080/metrics | grep socle_
# socle_worker_executions_total{worker="collect_worker"} 1041
```

### Moteurs Python — en attendant P-4
```python
def get_stats(self) -> dict:
    # Les statistiques du worker tiennent lieu d'indicateurs, lisibles par la liste des workers.
    return {"cycles": self._cycles, "errors": self._errors,
            "dlq_size": self._kv_bus.dlq_sizes().get(f"{TOPIC}/{GROUP}", 0)}
```

### Nommage et étiquettes
```
# Bien : une étiquette de faible cardinalité
orders_created_total{status="DRAFT"}
# À éviter : une étiquette par commande
orders_created_total{reference="C-1"}
```

## Pièges courants
- **Étiquettes à forte cardinalité** : la collecte grossit sans limite et devient inexploitable.
- **Une métrique par cas particulier** : préférer peu de séries bien choisies.
- **Exposer des valeurs métier** dans une route moins protégée que les autres.
- **Confondre métrique et journal** : une métrique compte, elle ne raconte pas.
- **Alerter sur une valeur brute** plutôt que sur une tendance : on alerte à chaque pic.

## Cas d'usage voisins
- UC-SUP-02 — lister les workers et leur état
- UC-WRK-08 — publier santé et statistiques
- UC-SUP-12 — tableau de bord d'exploitation
- UC-SEC-08 — déclarer les routes publiques
