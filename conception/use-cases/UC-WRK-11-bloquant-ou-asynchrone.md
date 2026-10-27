---
id: UC-WRK-11
titre: "Travail bloquant ou non bloquant (sync / async)"
theme: "UC-WRK · Workers et cycle de vie"
moteurs:
  java: na
  socle-py: ok
  socle-py-django: ok
contrat: "5.9"
mecanismes: "def do_work, async def do_work, asyncio.to_thread, techdb.run, techdb.arun"
---

# UC-WRK-11 — Travail bloquant ou non bloquant (sync / async)

## Questions auxquelles répond ce cas d'usage
1. Dois-je écrire mon travail en `async` ou en synchrone ?
2. Mon worker fait une requête HTTP bloquante : est-ce que je gèle toute l'application ?
3. Pourquoi l'ORM est-il interdit dans la boucle d'événements ?
4. Quand utiliser l'accès synchrone à la base technique, et quand sa variante asynchrone ?
5. Mes sondes de santé deviennent lentes dès que mon worker travaille : pourquoi ?
6. Ai-je le droit de créer une tâche asynchrone pour paralléliser mon traitement ?
7. Comment ce choix se traduit-il dans une action, et pas seulement dans un cycle ?

## Mots-clés
asynchrone, `async def`, synchrone, bloquant, boucle d'événements, event loop, `asyncio`,
`asyncio.to_thread`, `techdb.run`, `techdb.arun`, ORM interdit dans la boucle, latence,
`await`, tâche créée à la main interdite, C15

## Ce que c'est, et quand s'en servir
Les moteurs Python servent HTTP et MCP sur une boucle d'événements. Le socle accepte les deux
écritures du travail, et la règle est simple : **du code qui bloque s'écrit en synchrone** (le socle
l'exécute hors de la boucle), **du code qui attend du réseau sans bloquer s'écrit en asynchrone**.

Le cas le plus fréquent est l'accès aux données : l'ORM de Django est bloquant par nature, donc il
passe toujours par la base technique, en version synchrone depuis du code synchrone, en version
asynchrone depuis du code asynchrone.

## Ce que le socle fait · ce qu'il interdit
Le socle exécute un travail synchrone à l'écart de la boucle, et un travail asynchrone sur la
boucle. Il ne peut pas deviner qu'un travail déclaré asynchrone fait un appel bloquant : dans ce
cas, toute l'instance ralentit — sondes, actions, MCP compris.

Interdits : créer soi-même une tâche asynchrone ou un fil d'exécution, et utiliser l'accès
synchrone à la base depuis une fonction asynchrone (la revue de code le refuse, règle C15). Le
parallélisme est le métier de l'orchestrateur, pas du worker.

## Exemples
### Code bloquant : rester synchrone
```python
def do_work(self) -> None:                       # exécuté hors de la boucle
    rows = self.techdb.run(lambda: selectors.OrderSelector.get_all())
    report = render_report(rows)                 # calcul long, bloquant : très bien ici
    self._write(report)
```

### Code asynchrone : ne rien bloquer
```python
async def do_work(self) -> None:
    async with httpx.AsyncClient(timeout=5.0) as client:
        response = await client.get(self._url)
    # Dans une fonction async, l'accès à la base passe par sa variante asynchrone.
    await self.techdb.arun(lambda: mutators.QuoteMutator.save(response.json()))
```

### Dans une action
```python
@action("recompute", description="Recalculer l'encours")
def recompute(self, params: dict[str, Any], context: ActionContext) -> ActionResult:
    # Une action synchrone tourne déjà hors de la boucle : techdb.run convient.
    total = self.techdb.run(lambda: services.OrderService.outstanding(tenant_context=ctx))
    return ActionResult.ok({"outstanding_cents": total})
```

## Pièges courants
- **Un `async def` qui appelle une bibliothèque bloquante** : c'est le défaut le plus coûteux, et
  il ne se voit qu'en charge.
- **Mélanger les deux accès à la base** dans la même pile d'appels : erreur à l'exécution, souvent
  tardive.
- **Créer une tâche asynchrone pour « faire en parallèle »** : interdit ; découper en deux workers,
  ou passer par le bus.
- **Croire que l'asynchrone rend plus rapide** : il rend plus concurrent. Un calcul long gagne à
  être synchrone.

## Cas d'usage voisins
- UC-WRK-01 — planifier par intervalle
- UC-DB-01 — persister l'état technique
- UC-ACT-08 — invoquer une action en asynchrone
- UC-RES-05 — imposer un délai à tout appel sortant
