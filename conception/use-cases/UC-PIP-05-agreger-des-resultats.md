---
id: UC-PIP-05
titre: "Agréger des résultats de plusieurs sources"
theme: "UC-PIP · Pipelines"
moteurs:
  java: ok
  socle-py: hors
  socle-py-django: hors
contrat: "5.9"
mecanismes: "AbstractAggregationWorker, AggregationStore, expiration, fenêtre"
---

# UC-PIP-05 — Agréger des résultats de plusieurs sources

## Questions auxquelles répond ce cas d'usage
1. Comment rassembler des morceaux qui arrivent séparément avant de traiter l'ensemble ?
2. Comment savoir qu'un groupe est complet ?
3. Que faire d'un groupe qui reste incomplet — attendre, abandonner, traiter partiellement ?
4. Où est stocké l'état d'agrégation en cours ?
5. Dans les moteurs Python, comment agréger sans le worker dédié ?
6. Comment éviter qu'un groupe oublié reste en mémoire indéfiniment ?

## Mots-clés
agrégation, `AbstractAggregationWorker`, `AggregationStore`, groupe, corrélation,
complétude, fenêtre de temps, expiration, délai de garde, incomplet,
partiel, mémoire, base, hors périmètre

## Ce que c'est, et quand s'en servir
Des éléments arrivent séparément — trois réponses de fournisseurs, les lignes d'une même commande,
les mesures d'une même période — et le traitement n'a de sens qu'une fois le groupe rassemblé.
L'agrégation garde les morceaux, détecte la complétude, et déclenche.

Le cœur du sujet n'est pas le rassemblement, c'est **l'incomplétude** : il faut décider ce qu'on
fait d'un groupe qui n'arrive jamais à son terme, et au bout de combien de temps.

## Ce que le socle fait · ce qu'il interdit
Java : un worker d'agrégation fournit la mécanique — clé de corrélation, critère de complétude,
magasin d'état (en mémoire ou persistant), et vérification périodique des expirations.

Moteurs Python : **hors périmètre**. On agrège soi-même, et le choix du magasin est la décision
structurante : la mémoire est simple mais perdue au redémarrage ; le bus avec expiration convient à
un groupe de courte vie ; la base est la seule option quand le groupe doit survivre.

Dans tous les cas : **une expiration est obligatoire**. Un groupe sans date limite est une fuite de
mémoire ou une ligne de base qui ne sera jamais nettoyée, et un traitement qui n'arrive jamais.

## Exemples
### Moteurs Python — agrégation courte, dans le bus
```python
def _handle(self, message: dict) -> None:
    cle = f"aggregation:{message['order_id']}"
    groupe = self._kv_bus.get(cle) or {"parts": [], "expected": message["total_parts"]}
    groupe["parts"].append(message["part"])
    if len(groupe["parts"]) >= groupe["expected"]:
        self._kv_bus.delete(cle)
        self._traiter_complet(message["order_id"], groupe["parts"])
    else:
        # Expiration OBLIGATOIRE : un groupe incomplet ne doit pas vivre pour toujours.
        self._kv_bus.set(cle, groupe, ttl_seconds=900)
```

### Traiter les groupes expirés — la décision explicite
```python
def do_work(self) -> None:
    for cle in self._kv_bus.scan("aggregation:"):
        groupe = self._kv_bus.get(cle)
        if groupe and self._trop_vieux(groupe):
            # Décision écrite : partiel accepté, ou abandon tracé. Jamais de silence.
            self._traiter_partiel(cle, groupe)
```

### Socle Java
```java
public class QuoteAggregationWorker extends AbstractAggregationWorker<Quote, QuoteGroup> { … }
```

## Pièges courants
- **Pas d'expiration** : fuite de mémoire, groupes fantômes, traitements qui n'arrivent jamais.
- **Agrégation en mémoire pour un groupe de longue vie** : perdu au redémarrage.
- **Aucune décision sur l'incomplet** : le groupe reste, et personne ne sait qu'il manque quelque
  chose.
- **Clé de corrélation faible** : deux groupes se mélangent.
- **Traitement partiel silencieux** : on produit un résultat faux sans le dire.

## Cas d'usage voisins
- UC-PIP-04 — motifs de pipeline courants
- UC-BUS-01 — clé/valeur avec expiration
- UC-BUS-05 — publication fiable avec groupes
- UC-DB-01 — persister l'état technique
