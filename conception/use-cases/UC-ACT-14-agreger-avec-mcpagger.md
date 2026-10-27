---
id: UC-ACT-14
titre: "Agréger plusieurs instances dans un catalogue (MCPagger)"
theme: "UC-ACT · Actions REST et MCP"
moteurs:
  java: ok
  socle-py: P-4
  socle-py-django: P-4
contrat: "5.9"
mecanismes: "MCPagger, agrégation, génération, interface, Hub"
---

# UC-ACT-14 — Agréger plusieurs instances dans un catalogue (MCPagger)

## Questions auxquelles répond ce cas d'usage
1. J'ai plusieurs backends Socle : comment présenter leurs outils dans un seul catalogue ?
2. Comment un agent accède-t-il à plusieurs applications sans en connaître les adresses ?
3. Qui agrège — chaque instance, ou un composant central ?
4. Que publie une instance pour être agrégeable, et faut-il l'activer ?
5. Dans les moteurs Python, l'agrégation existe-t-elle déjà ?
6. Comment éviter les collisions de noms d'outils entre deux applications ?

## Mots-clés
MCPagger, agrégation, catalogue central, plusieurs instances, multi-backend, Hub, proxy MCP,
découverte, `spec.json`, `mcp-tools.json`, génération, interface d'exploration,
collision de noms, préfixe, P-4

## Ce que c'est, et quand s'en servir
Quand la plateforme héberge plusieurs applications Socle, chacune publie ses outils. L'agrégation
les rassemble en un seul catalogue : un agent se branche une fois et voit l'ensemble, avec la
provenance de chaque outil.

Côté application, le travail est minimal : publier sa spécification et sa liste d'outils
(UC-ACT-10), ce que le socle fait déjà. L'agrégation se passe au-dessus.

## Ce que le socle fait · ce qu'il interdit
Le Socle Java porte la chaîne complète — agrégation, génération du catalogue, interface
d'exploration, intégration au Hub. Une instance n'a qu'à rester fidèle à son contrat de
publication.

Dans les moteurs Python, les documents nécessaires sont publiés dès aujourd'hui, mais la chaîne
d'agrégation et son interface relèvent de la phase **P-4**. En attendant, on agrège côté client
(configurer plusieurs serveurs MCP dans l'agent) ou côté Hub, plutôt que d'écrire un agrégateur
maison qui divergerait du contrat.

Point de vigilance de conception : les noms d'outils sont `worker__action`, sans nom
d'application. Deux applications qui nomment un worker de la même façon produisent des outils
homonymes — c'est l'agrégateur qui doit les distinguer par leur provenance, donc il ne faut pas
compter sur l'unicité globale d'un nom d'outil.

## Exemples
### Ce que publie chaque instance
```bash
curl -H "X-Admin-Key: $ADMIN_API_KEY" localhost:8080/mcpagger/spec.json
curl -H "X-Admin-Key: $ADMIN_API_KEY" localhost:8080/mcpagger/mcp-tools.json
curl -H "X-Admin-Key: $ADMIN_API_KEY" localhost:8080/mcp/info
```

### Agrégation côté client, en attendant P-4
```json
{
  "mcpServers": {
    "commandes": { "url": "https://commandes.thesocle.net/mcp", "headers": {"Authorization": "Bearer …"} },
    "facturation": { "url": "https://facturation.thesocle.net/mcp", "headers": {"Authorization": "Bearer …"} }
  }
}
```

## Pièges courants
- **Supposer un nom d'outil unique au monde** : il est unique dans une instance, pas au-delà.
- **Écrire son propre agrégateur** : il faudra le défaire quand la chaîne arrivera, et il ne
  parlera pas le même contrat.
- **Exposer les routes de publication sans protection** pour « faciliter l'agrégation » : c'est la
  surface d'administration.
- **Oublier qu'un catalogue agrégé est un cache** : il se périme après une livraison.

## Cas d'usage voisins
- UC-ACT-10 — publier la spécification des actions
- UC-ACT-09 — exposer les actions en outils MCP
- UC-UI-07 — exposer l'interface MCPagger
- UC-INT-06 — s'insérer derrière la Gateway
