---
id: UC-DB-05
titre: "Lire les événements récents par action"
theme: "UC-DB · TechDB"
moteurs:
  java: ok
  socle-py: P-3
  socle-py-django: P-3
contrat: "5.9"
mecanismes: "record_event, techdb_events, actions de lecture, K2"
---

# UC-DB-05 — Lire les événements récents par action

## Questions auxquelles répond ce cas d'usage
1. Comment donner à un exploitant ou à un agent le moyen de voir ce qui vient de se passer ?
2. Qu'est-ce qu'un événement du socle, et qui en écrit ?
3. Comment exposer cette lecture sans ouvrir un accès SQL ?
4. Quels filtres sont utiles — type, source, fenêtre de temps ?
5. Combien de temps les événements sont-ils conservés ?
6. Dans les moteurs Python, par quoi remplacer cette lecture en attendant ?
7. Comment éviter qu'un agent noie l'instance en lisant tout l'historique ?

## Mots-clés
événements, `record_event`, `techdb_events`, journal technique, lecture par action,
diagnostic, fenêtre de temps, filtre, limite de lignes, rétention, agent IA, exploitation,
`read_only`, P-3

## Ce que c'est, et quand s'en servir
Les événements sont la mémoire courte du socle : démarrages, arrêts, incidents de workers, faits
marquants écrits par l'application. Les rendre lisibles **par une action** — plutôt que par du SQL —
donne un diagnostic sûr et borné, utilisable par un humain comme par un agent.

C'est la bonne réponse à « que s'est-il passé cette nuit ? » : une action avec un type, une source,
une fenêtre et une limite, plutôt qu'une requête libre.

## Ce que le socle fait · ce qu'il interdit
Le socle écrit ses propres événements et fournit l'écriture aux applications. L'exposition en
lecture par des actions outillées est portée par le Socle Java ; elle relève de la phase **P-3**
dans les moteurs Python.

Ce qu'il ne faut pas faire en attendant : exposer une action qui rend « tous les événements ». Une
lecture d'exploitation se borne — fenêtre de temps, limite de lignes, filtre obligatoire — sinon
elle devient un moyen simple de charger l'instance et d'exfiltrer son historique.

## Exemples
### Écrire un événement métier
```python
self.techdb.record_event("order_confirmed", self.name, datas=f"reference={reference}")
```

### Exposer une lecture bornée (ce qu'on écrit soi-même en attendant P-3)
```python
@action("recent_events", description="Événements récents de ce worker", read_only=True)
@param("type", description="Type d'événement", required=True, max_length=40)
@param("limit", description="Nombre de lignes", type=ParameterType.INTEGER,
       min_value=1, max_value=200, default=50)
def recent_events(self, params: dict[str, Any], context: ActionContext) -> ActionResult:
    rows = self.techdb.query(
        "SELECT event_type, source, datas FROM techdb_events "
        "WHERE event_type = %s ORDER BY x_id DESC LIMIT %s",
        (params["type"], params["limit"]))          # paramètres liés, jamais concaténés
    return ActionResult.ok({"count": len(rows), "events": rows})
```

### Socle Java
La lecture des événements est outillée par les workers intégrés d'exploitation, avec les mêmes
bornes.

## Pièges courants
- **Concaténer les paramètres dans le SQL** : injection. Toujours des paramètres liés.
- **Aucune limite de lignes** : la réponse grossit avec l'historique.
- **Écrire des données sensibles dans un événement** : le journal technique n'est pas masqué comme
  l'audit des actions.
- **Confondre événement et audit** : l'audit raconte les invocations d'actions (UC-ACT-06), les
  événements racontent la vie du système.
- **S'en servir comme d'un journal applicatif volumineux** : la table a une rétention, et une purge.

## Cas d'usage voisins
- UC-DB-04 — interroger la TechDB en SQL
- UC-DB-06 — purger selon une rétention
- UC-ACT-06 — auditer les invocations
- UC-SUP-11 — agréger et expédier un rapport d'erreurs
