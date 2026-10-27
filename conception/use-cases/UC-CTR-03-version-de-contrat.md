---
id: UC-CTR-03
titre: "Annoncer sa version de contrat"
theme: "UC-CTR · Contrats et conformité"
moteurs:
  java: ok
  socle-py: ok
  socle-py-django: ok
contrat: "5.9"
mecanismes: "CONTRACT_VERSION, --version, spec.json, H3"
---

# UC-CTR-03 — Annoncer sa version de contrat

## Questions auxquelles répond ce cas d'usage
1. Comment savoir quelle version de contrat respecte une instance en service ?
2. Quelle différence entre la version du paquet et la version du contrat ?
3. Où cette version est-elle lisible — ligne de commande, API, spécification ?
4. Pourquoi deux instances de versions de paquet différentes peuvent-elles être compatibles ?
5. Que vérifie un client avant de parler à une instance ?
6. Qui incrémente la version de contrat, et quand ?

## Mots-clés
version de contrat, `CONTRACT_VERSION`, version de paquet, `--version`,
`spec.json`, compatibilité, client, annonce, H3, 5.9, incrément,
évolution, rétrocompatibilité

## Ce que c'est, et quand s'en servir
Deux versions distinctes, et il faut les tenir séparées : la **version du paquet** (l'implémentation
livrée) et la **version du contrat** (le comportement observable promis). Deux instances de paquets
différents peuvent respecter le même contrat — c'est précisément le but.

Un client, un outil de plateforme ou un agrégateur lit la version de contrat pour savoir à quoi il
parle, sans se soucier de l'implémentation.

## Ce que le socle fait · ce qu'il interdit
Chaque moteur expose sa version de contrat : en ligne de commande et dans la spécification publiée.
C'est une exigence du chantier, pas une coquetterie — sans annonce, la compatibilité se devine.

Ce qu'il ne faut pas faire : incrémenter la version de contrat à chaque livraison. Elle ne bouge que
lorsque le **comportement observable** change (UC-CTR-05). Et inversement : changer un format sans
toucher la version, c'est casser les clients en silence.

## Exemples
### Lire la version
```bash
socle-py-django --version
# socle-py-django 0.1.0 (contrat 5.9)

curl -s -H "X-Admin-Key: $ADMIN_API_KEY" localhost:8080/mcpagger/spec.json | jq '.contract'
# "5.9"
```

### Dans le code du moteur
```python
__version__ = "0.1.0"          # version du paquet
CONTRACT_VERSION = "5.9"       # version du contrat partagé
```

### Ce qu'un client vérifie
```bash
contrat=$(curl -s -H "X-Admin-Key: $KEY" "$url/mcpagger/spec.json" | jq -r '.contract')
[ "$contrat" = "5.9" ] || echo "contrat inattendu : $contrat"
```

## Pièges courants
- **Confondre les deux versions** : on croit incompatible ce qui l'est, et inversement.
- **Changer un format sans changer la version** : les clients cassent sans préavis.
- **Incrémenter à chaque livraison** : la version perd son sens.
- **Ne pas annoncer** : les clients doivent deviner, donc sonder.

## Cas d'usage voisins
- UC-CTR-01 — écrire un contrat hors du code
- UC-CTR-05 — faire évoluer un contrat dans les trois moteurs
- UC-ACT-10 — publier la spécification des actions
- UC-CTR-06 — vérifier qu'un backend est indiscernable
