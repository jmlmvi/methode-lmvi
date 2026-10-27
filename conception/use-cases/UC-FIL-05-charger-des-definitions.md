---
id: UC-FIL-05
titre: "Charger au démarrage des définitions du dépôt"
theme: "UC-FIL · Repository et fichiers"
moteurs:
  java: ok
  socle-py: hors
  socle-py-django: hors
contrat: "5.9"
mecanismes: "chargement au démarrage, cache, rechargement, détection de modification"
---

# UC-FIL-05 — Charger au démarrage des définitions du dépôt

## Questions auxquelles répond ce cas d'usage
1. Quand les définitions sont-elles lues : au démarrage, à chaque appel, sur modification ?
2. Que doit faire l'application si une définition est illisible au démarrage ?
3. Comment recharger après modification sans redémarrer ?
4. Comment éviter que deux instances travaillent avec des versions différentes ?
5. Dans les moteurs Python, comment charger des définitions de configuration ?
6. Comment savoir quelle version est active sur une instance ?

## Mots-clés
chargement au démarrage, cache, rechargement, détection de modification,
définition illisible, échec au démarrage, version active, cohérence entre
instances, action de rechargement, hors périmètre, journalisation

## Ce que c'est, et quand s'en servir
Les définitions se lisent **une fois**, au démarrage, et se rangent en mémoire : les relire à chaque
appel coûte et rend le comportement instable. Le rechargement se fait alors explicitement, par une
action.

Trois questions à trancher pour chaque jeu de définitions : que faire si elles sont illisibles,
comment recharger, et comment savoir ce qui est actif.

## Ce que le socle fait · ce qu'il interdit
Java : le dépôt détecte les modifications, ce qui permet d'invalider un cache. Moteurs Python :
**hors périmètre** pour le dépôt ; pour la configuration, la lecture au démarrage est le modèle
(UC-CFG-04), et le rechargement s'expose par une action si le besoin existe.

Deux exigences : une définition illisible doit **empêcher le démarrage** quand elle est nécessaire
(mieux vaut un refus net qu'un comportement arbitraire — UC-CFG-03), et la **version active** doit
être visible, sinon on ne peut pas diagnostiquer une divergence entre deux instances.

## Exemples
### Charger une fois, exposer la version
```python
def initialize(self) -> None:
    self._grille = self._charger_grille()        # échoue bruyamment si illisible
    log.info("[step:pricing_grid_loaded] version=%s paliers=%s",
             self._grille.version, len(self._grille.tiers))

def get_stats(self) -> dict:
    return {"pricing_grid_version": self._grille.version}   # version active, visible
```

### Recharger explicitement
```python
@action("reload_pricing_grid", description="Recharge la grille de remise",
        required_scope="pricing.admin")
def reload_pricing_grid(self, params: dict[str, Any], context: ActionContext) -> ActionResult:
    self._grille = self._charger_grille()
    log.info("[step:pricing_grid_reloaded] version=%s", self._grille.version)
    return ActionResult.ok({"version": self._grille.version})
```

### Vérifier la cohérence entre instances
```bash
for h in app-1 app-2; do
  curl -s -H "X-Admin-Key: $ADMIN_API_KEY" http://$h:8080/admin/workers \
    | jq -r --arg h "$h" '"\($h) \(.workers.pricing_worker.stats.pricing_grid_version)"'
done
```

## Pièges courants
- **Relire à chaque appel** : coût, et comportement qui change en cours de traitement.
- **Démarrer malgré une définition illisible** : l'application fait n'importe quoi, sans le dire.
- **Rechargement silencieux** : le comportement change sans trace.
- **Version active invisible** : deux instances divergent et personne ne le voit.
- **Recharger sans scope** : n'importe qui change le comportement.

## Cas d'usage voisins
- UC-FIL-02 — déclarer un type de fichier et son validateur
- UC-CFG-03 — refuser une configuration invalide
- UC-RUL-04 — auditer et mettre en cache les décisions
- UC-CFG-04 — lire une clé typée
