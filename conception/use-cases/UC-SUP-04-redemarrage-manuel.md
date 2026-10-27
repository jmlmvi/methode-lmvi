---
id: UC-SUP-04
titre: "Redémarrer un worker à la main"
theme: "UC-SUP · Supervision et exploitation"
moteurs:
  java: ok
  socle-py: P-4
  socle-py-django: P-4
contrat: "5.9"
mecanismes: "action de redémarrage, /supervision, cycle de vie, B5"
---

# UC-SUP-04 — Redémarrer un worker à la main

## Questions auxquelles répond ce cas d'usage
1. Comment relancer un seul worker sans redémarrer toute l'instance ?
2. Que se passe-t-il exactement pendant ce redémarrage ?
3. Les abonnements au bus sont-ils refaits ?
4. Qui a le droit de déclencher cette opération ?
5. L'opération est-elle tracée ?
6. Dans les moteurs Python, par quoi la remplacer aujourd'hui ?

## Mots-clés
redémarrage manuel, relancer un worker, `/supervision`, action d'exploitation,
arrêt puis démarrage, abonnements refaits, `initialize`, trace, audit, scope,
confirmation, instance entière, P-4

## Ce que c'est, et quand s'en servir
L'opération d'exploitation qui arrête puis relance **un** worker : son arrêt est appelé, puis son
initialisation et son démarrage. Utile après une correction de configuration, pour réinitialiser un
état, ou pour reprendre après une panne externe résolue.

C'est moins brutal que redémarrer l'instance : les autres workers continuent, le serveur HTTP reste
en service.

## Ce que le socle fait · ce qu'il interdit
Java : l'opération est exposée dans les surfaces d'exploitation, protégée, et tracée — comme toute
action sensible, elle est auditée.

Moteurs Python : phase **P-4**. En attendant, on redémarre l'instance, ou on expose une action
applicative de réinitialisation **ciblée** (recharger un référentiel, reconnecter un client) plutôt
que d'imiter un cycle de vie à la main — appeler soi-même l'arrêt puis l'initialisation d'un worker
depuis une action contourne l'orchestrateur, et son état de planification ne suivra pas.

## Exemples
### Socle Java
```bash
curl -X POST -H "X-Admin-Key: $ADMIN_API_KEY" \
  localhost:8080/supervision/workers/collect_worker/restart
```

### Moteurs Python — une réinitialisation ciblée, pas un faux cycle de vie
```python
@action("reload_referential", description="Recharge le référentiel en mémoire",
        required_scope="ops.write", requires_confirmation=True)
def reload_referential(self, params: dict[str, Any], context: ActionContext) -> ActionResult:
    self._referential = self._load_referential()        # ciblé, idempotent, traçable
    return ActionResult.ok({"entries": len(self._referential)})
```

### Redémarrer l'instance, quand c'est la bonne réponse
```bash
docker compose restart app
```

## Pièges courants
- **Imiter le cycle de vie depuis une action** : l'orchestrateur ne sait plus où en est le worker.
- **Oublier que les abonnements sont refaits** : un redémarrage mal conçu peut doubler les
  abonnements (UC-BUS-04).
- **En faire une habitude** : un worker qu'il faut relancer chaque semaine cache un défaut à
  corriger.
- **Opération non tracée** : personne ne sait qui a relancé quoi, ni quand.

## Cas d'usage voisins
- UC-SUP-03 — redémarrage automatique
- UC-SUP-05 — déclencher hors cycle
- UC-OPS-01 — piloter le système par commandes
- UC-BUS-04 — s'abonner à un sujet
