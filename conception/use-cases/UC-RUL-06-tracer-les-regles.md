---
id: UC-RUL-06
titre: "Tracer les règles déclenchées"
theme: "UC-RUL · Moteurs de décision et code dynamique"
moteurs:
  java: ok
  socle-py: hors
  socle-py-django: hors
contrat: "5.9"
mecanismes: "audit des règles, règles appliquées, conformité"
---

# UC-RUL-06 — Tracer les règles déclenchées

## Questions auxquelles répond ce cas d'usage
1. Comment savoir quelles règles se sont appliquées à un dossier donné ?
2. Faut-il tracer les règles qui n'ont pas déclenché ?
3. À quoi sert cette trace — débogage, conformité, réclamation client ?
4. Comment relier une trace de règle à l'appel qui l'a provoquée ?
5. Dans les moteurs Python, comment obtenir la même traçabilité ?
6. Quelle rétention appliquer à ces traces ?

## Mots-clés
trace de règles, règles appliquées, audit, conformité, réclamation, explicabilité,
corrélation, identifiant d'appel, rétention, volumétrie, `errorType`,
journalisation, événement, hors périmètre

## Ce que c'est, et quand s'en servir
Garder la liste des règles qui ont déclenché sur un cas, dans l'ordre. C'est ce qui permet de
répondre à une réclamation (« pourquoi ce refus ? ») et de déboguer un comportement surprenant sans
rejouer l'intégralité du traitement.

La question « faut-il tracer ce qui n'a pas déclenché » se tranche par l'usage : pour expliquer une
décision, les règles appliquées suffisent ; pour déboguer un jeu de règles, voir les candidates
écartées aide — mais le volume explose.

## Ce que le socle fait · ce qu'il interdit
Java : le moteur de règles et le moteur de décision tracent leurs déclenchements, requêtables depuis
la base technique.

Moteurs Python : **hors périmètre** pour le moteur ; la traçabilité, elle, s'obtient simplement
parce que chaque règle porte un **code**. Un refus remonte son code à l'appelant (UC-ACT-12), et
l'audit des actions garde l'invocation (UC-ACT-06) : le lien est fait. Pour les règles qui
s'appliquent sans refuser (une remise accordée), il faut l'écrire explicitement — un événement ou
une colonne.

Ce qu'il ne faut pas faire : s'appuyer sur un message en langage naturel pour reconstituer une
règle. Les messages changent, les codes ne doivent pas.

## Exemples
### Moteurs Python — le code de la règle part dans la réponse et dans l'audit
```json
{"success": false, "error": "Montant 999999999 au-dessus du plafond 100000",
 "errorType": "AMOUNT_ABOVE_LIMIT"}
```
```sql
SELECT ACTION_NAME, CALLER_ID, SUCCESS FROM TECHDB_WORKER_ACTIONS
WHERE ACTION_NAME = 'create_order' ORDER BY X_ID DESC LIMIT 20;
```

### Tracer une règle appliquée sans refus
```python
# Une remise accordée est une décision : elle se trace, avec sa version de grille.
self.techdb.record_event("discount_applied", self.name,
                         datas=f"rule=KEY_ACCOUNT rate=0.05 grid={grid.version}")
```

### Socle Java
```sql
SELECT MODEL_NAME, MODEL_VERSION, CAST(OUTPUTS AS VARCHAR(2048)) FROM JDM_AUDIT
ORDER BY X_ID DESC LIMIT 20;
```

## Pièges courants
- **Tracer le message, pas le code** : le message change de version en version.
- **Tracer toutes les règles évaluées** : volumétrie énorme pour un bénéfice marginal.
- **Pas de corrélation** avec l'appel d'origine : la trace existe mais ne se relie à rien.
- **Oublier la version de la règle** : la trace devient inexplicable après une modification.
- **Aucune rétention** : les traces de décision survivent à l'intérêt qu'on leur porte.

## Cas d'usage voisins
- UC-RUL-04 — auditer et mettre en cache les décisions
- UC-RUL-05 — exécuter un moteur de règles métier
- UC-ACT-06 — auditer les invocations
- UC-SUP-10 — journaliser avec un contexte de corrélation
