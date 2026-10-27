---
id: UC-INT-02
titre: "Exposer un service gRPC"
theme: "UC-INT · Intégrations et transports"
moteurs:
  java: ok
  socle-py: hors
  socle-py-django: hors
contrat: "5.9"
mecanismes: "serveur gRPC, définitions de service, port dédié"
---

# UC-INT-02 — Exposer un service gRPC

## Questions auxquelles répond ce cas d'usage
1. Comment exposer une API gRPC depuis une application Socle ?
2. Sur quel port, et comment cette surface est-elle protégée ?
3. Quand gRPC apporte-t-il vraiment quelque chose par rapport aux actions REST ?
4. Comment les définitions de service sont-elles partagées avec les clients ?
5. Dans les moteurs Python, gRPC est-il supporté ?
6. Que faire quand un partenaire impose gRPC ?

## Mots-clés
gRPC, service, définitions, protobuf, port dédié, protection, authentification,
flux bidirectionnel, performance, actions REST, hors périmètre, passerelle,
Gateway, contrat

## Ce que c'est, et quand s'en servir
gRPC sert bien deux besoins : les échanges à très haut débit entre services internes, et les flux
bidirectionnels. Pour le reste — exposer des capacités à des humains, des frontends et des agents —
les actions (UC-ACT-01) couvrent mieux le besoin, puisqu'elles donnent REST, MCP, validation, scope
et audit d'un seul coup.

## Ce que le socle fait · ce qu'il interdit
Java : le socle porte une architecture gRPC, avec son serveur et ses sessions (UC-INT-03).

Moteurs Python : **hors périmètre déclaré**. Un serveur gRPC ajouté dans un worker tournerait sur
son propre port, sans la politique de sécurité du socle, sans son audit, sans sa documentation.
Techniquement possible, mais hors contrat — et la surface créée serait à protéger entièrement à la
main.

Quand un partenaire impose gRPC, le montage honnête est une **passerelle** : un service gRPC dédié,
hors du Socle, qui traduit vers les actions. On garde le contrat du socle d'un côté et l'exigence du
partenaire de l'autre.

## Exemples
### Moteurs Python — la passerelle
```
client gRPC → passerelle (service dédié) → POST /admin/workers/<worker>/actions/<action>
```

### Ce que l'application expose, et qui suffit presque toujours
```bash
curl -H "X-Admin-Key: $ADMIN_API_KEY" localhost:8080/admin/actions
curl -H "X-Admin-Key: $ADMIN_API_KEY" localhost:8080/mcpagger/openapi.json
```

### Socle Java
Les services gRPC sont déclarés et servis par le socle ; voir aussi les sessions et les
connexions entre pairs.

## Pièges courants
- **Un serveur gRPC dans un worker Python** : surface non protégée par la politique du socle.
- **Choisir gRPC pour la mode** : on perd MCP, l'audit, la documentation et la validation.
- **Oublier l'authentification** sur un port dédié : il n'hérite de rien.
- **Partager des définitions sans version** : les clients cassent à la première évolution.

## Cas d'usage voisins
- UC-INT-03 — tenir des sessions gRPC
- UC-INT-04 — relier deux instances en pair-à-pair
- UC-ACT-01 — déclarer une action
- UC-OPS-05 — servir des routes HTTP applicatives
