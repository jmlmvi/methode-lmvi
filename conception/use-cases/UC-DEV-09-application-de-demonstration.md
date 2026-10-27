---
id: UC-DEV-09
titre: "Faire tourner une application de démonstration"
theme: "UC-DEV · Outillage du développeur"
moteurs:
  java: ok
  socle-py: ok
  socle-py-django: ok
contrat: "5.9"
mecanismes: "demo/, applications de conformité, exemples exécutables, J3"
---

# UC-DEV-09 — Faire tourner une application de démonstration

## Questions auxquelles répond ce cas d'usage
1. Existe-t-il une application d'exemple qui tourne, pour découvrir le socle ?
2. Où la trouve-t-on dans chaque moteur, et comment la démarrer ?
3. Que peut-on y essayer : REST, MCP, base, tenant ?
4. Quelle différence avec les applications de conformité ?
5. Peut-on s'en servir de point de départ pour une vraie application ?
6. Comment essayer MCP depuis un client réel ?

## Mots-clés
démonstration, `demo/`, exemple exécutable, découverte, REST, MCP, tenant,
applications de conformité, ports 18080, 18181, 18282, point de départ,
starter pack, client MCP, J3

## Ce que c'est, et quand s'en servir
Une application qui tourne, pour voir le socle en marche avant d'écrire du code : des workers
démarrés, des actions appelables en REST et en MCP, une base technique active.

Trois objets à ne pas confondre : la **démonstration** (pour découvrir et expérimenter), les
**applications de conformité** (minimales, faites pour être testées — UC-CTR-02), et le **projet
généré** par le starter pack (le vrai point de départ d'une application, UC-DEV-02).

## Ce que le socle fait · ce qu'il interdit
Chaque moteur livre sa démonstration, et la démonstration Java expose un grand nombre de workers
publics avec MCP. C'est l'endroit où essayer un client MCP réel, parce que tout y est déjà branché.

Ce qu'il ne faut pas faire : partir de la démonstration pour une vraie application. Elle est faite
pour montrer, donc elle est large, et elle n'a pas les couches, les tests, la revue ni l'outillage du
projet généré. Le point de départ d'un développement, c'est le générateur.

## Exemples
### Démarrer la démonstration (moteurs Python)
```bash
cd socle-py-django/demo && ../.venv/bin/socle-py-django run
curl localhost:8080/health/ready
curl -H "X-Admin-Key: $ADMIN_API_KEY" localhost:8080/admin/workers
```

### Essayer MCP
```bash
curl -X POST localhost:8080/mcp -H "Authorization: Bearer $MCP_API_KEY" \
  -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

### Les applications de conformité, pour la suite de tests
```bash
contracts/conformance/apps/java/run.sh            # 18080
contracts/conformance/apps/python/run.sh          # 18181
contracts/conformance/apps/python-django/run.sh   # 18282
```

### Le vrai point de départ
```bash
socle-py-django new mon-app && cd mon-app && make check
```

## Pièges courants
- **Partir de la démonstration** pour une application réelle : pas de couches, pas de revue, pas de
  tests.
- **Confondre démonstration et conformité** : les secondes sont minimales et dédiées aux tests.
- **Laisser une démonstration tourner** sur un port qu'on croit libre : conflits inexpliqués.
- **Essayer MCP sans clé** : refus, et c'est le comportement attendu.

## Cas d'usage voisins
- UC-DEV-02 — obtenir un squelette complet en couches
- UC-CTR-02 — jouer la suite de conformité croisée
- UC-ACT-13 — consommer les actions depuis un agent IA
- UC-DEV-01 — créer un projet neuf
