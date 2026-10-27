---
id: UC-PIP-04
titre: "Appliquer les motifs de pipeline courants"
theme: "UC-PIP · Pipelines"
moteurs:
  java: ok
  socle-py: hors
  socle-py-django: hors
contrat: "5.9"
mecanismes: "ETL, fan-out, reprise avec état, compensation, orchestration de workers"
---

# UC-PIP-04 — Appliquer les motifs de pipeline courants

## Questions auxquelles répond ce cas d'usage
1. Quels motifs reviennent toujours dans un traitement en chaîne ?
2. Comment paralléliser une étape sans désordonner le résultat ?
3. Comment reprendre un traitement long après un incident, sans tout refaire ?
4. Comment annuler l'effet des étapes déjà exécutées quand une étape échoue ?
5. Comment enchaîner des workers plutôt que des étapes ?
6. Dans les moteurs Python, quels motifs sont transposables tels quels ?

## Mots-clés
motif, ETL, extraction, transformation, chargement, fan-out, parallélisation,
reprise avec état, compensation, annulation, saga, orchestration de workers,
ordre, idempotence, hors périmètre

## Ce que c'est, et quand s'en servir
Quatre ou cinq formes couvrent l'essentiel : la chaîne extraction-transformation-chargement, la
parallélisation d'une étape coûteuse, la reprise avec état pour les traitements longs, la
compensation quand une étape tardive échoue, et l'orchestration de workers quand les étapes sont
déjà des workers.

Les connaître évite de réinventer — et surtout d'oublier la partie désagréable de chacun : l'ordre
pour la parallélisation, l'idempotence pour la reprise, la compensation pour les effets déjà
produits.

## Ce que le socle fait · ce qu'il interdit
Java : ces motifs sont documentés avec le moteur de pipeline et s'appuient sur la base technique
pour l'état.

Moteurs Python : **hors périmètre** pour le moteur, mais les motifs se transposent par le bus et la
base. Ce qui ne se transpose pas automatiquement, c'est la **compensation** : rien ne la fournit, il
faut écrire explicitement l'opération inverse de chaque étape à effet de bord — et accepter qu'elle
puisse elle aussi échouer, donc être rejouable.

## Exemples
### Parallélisation, sans perdre le regroupement
```python
# On parallélise par clé : tous les éléments d'une même commande vont au même consommateur,
# donc l'ordre est préservé là où il compte.
self._kv_bus.publish(f"etl/lines/{order_id % 4}", ligne)
```

### Reprise avec état
```python
depuis = self.techdb.get_offset("etl:invoices") or 0
...
self.techdb.save_offset("etl:invoices", topic="invoices", value=dernier)
```

### Compensation
```python
try:
    paiement = self._charger(order)
    self._expedier(order)                 # si cette étape échoue, le paiement est déjà fait
except ExpeditionImpossible:
    self._rembourser(paiement)            # opération inverse, écrite et rejouable
    raise
```

### Orchestration de workers
```python
# Chaque worker fait une étape, et publie pour le suivant : pas de moteur, des contrats de sujets.
self._kv_bus.publish("orders/validated", {"order_id": order_id})
```

## Pièges courants
- **Paralléliser ce qui doit rester ordonné** : partitionner par clé plutôt que distribuer au
  hasard.
- **Reprise sans idempotence** : au redémarrage, les éléments en vol sont retraités.
- **Compensation oubliée** : des effets de bord partiels restent, et personne ne le sait.
- **Compensation non rejouable** : elle échoue et laisse un état intermédiaire définitif.
- **Chaîne trop longue** : au-delà de quelques étapes, le diagnostic devient très coûteux.

## Cas d'usage voisins
- UC-PIP-02 — déclarer une étape typée
- UC-PIP-03 — orchestrer un pipeline V2
- UC-PIP-05 — agréger des résultats de plusieurs sources
- UC-BUS-07 — rendre un consommateur idempotent
