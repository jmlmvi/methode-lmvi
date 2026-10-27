---
id: UC-SUP-07
titre: "Drain HTTP seul, annulable"
theme: "UC-SUP · Supervision et exploitation"
moteurs:
  java: ok
  socle-py: P-4
  socle-py-django: P-4
contrat: "5.9"
mecanismes: "drain HTTP, cancel_drain, http_draining, ACCEPTING"
---

# UC-SUP-07 — Drain HTTP seul, annulable

## Questions auxquelles répond ce cas d'usage
1. Comment retirer une instance du trafic sans l'arrêter ?
2. Quelle différence entre le drain HTTP et le drain de l'orchestrateur ?
3. Peut-on annuler et remettre l'instance en service ?
4. Les workers continuent-ils de travailler pendant un drain HTTP ?
5. Où voit-on l'état du drain ?
6. À quoi sert cette opération concrètement en production ?

## Mots-clés
drain HTTP, `http_draining`, `ACCEPTING`, `DRAINING`, annulable, `cancel_drain`,
retirer du trafic, répartiteur, maintenance, diagnostic à chaud, workers actifs,
sonde de disponibilité, P-4

## Ce que c'est, et quand s'en servir
Cesser d'accepter de nouvelles requêtes HTTP **sans** arrêter l'instance : les workers continuent,
l'état reste en place, et on peut annuler. C'est la manœuvre d'exploitation qui permet d'isoler une
instance pour l'observer, ou de la sortir du trafic le temps d'une vérification.

À ne pas confondre avec le drain de l'orchestrateur (UC-SUP-06), qui prépare un arrêt et ne
s'annule pas.

## Ce que le socle fait · ce qu'il interdit
Le socle expose l'état du drain HTTP dans la sonde de disponibilité : une instance en drain répond
qu'elle n'est pas prête, ce qui suffit à un répartiteur pour l'éviter. Côté Java, l'opération se
pilote et s'annule ; dans les moteurs Python, le pilotage relève de la phase **P-4**, mais l'état
est déjà publié.

Ce que le drain HTTP ne fait pas : arrêter les traitements planifiés. Une instance drainée continue
de travailler — c'est précisément son intérêt, et aussi son risque si on l'oublie.

## Exemples
### Lire l'état
```bash
curl localhost:8080/health/ready | jq '.components.http_draining'
# "ACCEPTING"  ou  "DRAINING"
```

### Socle Java — piloter
```bash
curl -X POST -H "X-Admin-Key: $ADMIN_API_KEY" localhost:8080/supervision/http-drain
curl -X POST -H "X-Admin-Key: $ADMIN_API_KEY" localhost:8080/supervision/http-drain/cancel
```

### Moteurs Python — en attendant P-4
```bash
# Retirer l'instance du trafic au niveau du répartiteur ou de la pile, pas dans l'application.
docker compose stop app      # ou retrait de la cible côté Gateway
```

## Pièges courants
- **Oublier qu'une instance drainée travaille toujours** : ses traitements planifiés continuent à
  écrire.
- **Confondre les deux drains** : l'un préserve, l'autre prépare l'arrêt.
- **Drainer et oublier d'annuler** : une instance saine reste hors trafic, et la capacité manque.
- **Compter sur le drain HTTP pour une maintenance de données** : il ne gèle pas les écritures des
  workers.

## Cas d'usage voisins
- UC-SUP-06 — drainer puis arrêter proprement
- UC-SUP-01 — répondre aux sondes de santé
- UC-OPS-01 — piloter le système par commandes
- UC-INT-06 — s'insérer derrière la Gateway
