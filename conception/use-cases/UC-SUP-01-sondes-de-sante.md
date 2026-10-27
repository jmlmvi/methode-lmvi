---
id: UC-SUP-01
titre: "Répondre aux sondes de vivacité et de disponibilité"
theme: "UC-SUP · Supervision et exploitation"
moteurs:
  java: ok
  socle-py: ok
  socle-py-django: ok
contrat: "5.9"
mecanismes: "/health, /health/live, /health/ready, /health/detailed"
---

# UC-SUP-01 — Répondre aux sondes de vivacité et de disponibilité

## Questions auxquelles répond ce cas d'usage
1. Quelles routes de santé expose une application Socle, et laquelle brancher où ?
2. Quelle différence entre « vivant » et « prêt », et pourquoi deux sondes ?
3. Quel code HTTP renvoie une instance qui n'est pas prête ?
4. Que contient la réponse, et que peut-on en déduire ?
5. Ces routes sont-elles publiques ?
6. Comment la santé d'un worker influence-t-elle la disponibilité de l'instance ?
7. Comment se comporte la sonde pendant un arrêt en cours ?

## Mots-clés
sonde, santé, `/health`, `/health/live`, `/health/ready`, `/health/detailed`, vivacité,
liveness, disponibilité, readiness, 200, 503, `UP`, `DOWN`, drain, `http_draining`,
Docker healthcheck, Kubernetes, orchestrateur d'infrastructure, routes publiques

## Ce que c'est, et quand s'en servir
Deux questions différentes, deux sondes. **Vivant** : le processus répond, il n'est pas bloqué —
si cette sonde échoue, on redémarre le conteneur. **Prêt** : l'instance peut recevoir du trafic —
si cette sonde échoue, on la retire du répartiteur sans la tuer.

C'est la distinction qui permet un démarrage lent (migrations, chargement de référentiel) et un
arrêt propre : pendant le drain, l'instance reste vivante mais cesse d'être prête.

## Ce que le socle fait · ce qu'il interdit
Le socle sert les trois routes : les deux sondes simples, et une version détaillée — protégée,
elle — qui raconte l'état interne. La réponse de disponibilité agrège l'état des composants (bus,
registre partagé, drain HTTP) et rend un code d'erreur quand l'instance n'est pas en mesure de
servir.

Les sondes simples sont publiques par défaut, et doivent le rester : un orchestrateur
d'infrastructure n'a pas de clé. La version détaillée, elle, décrit l'intérieur : elle reste
protégée (UC-SEC-07).

## Exemples
### Les trois routes
```bash
curl localhost:8080/health/live     # {"probe":"liveness","status":"UP"}
curl localhost:8080/health/ready
# {"timestamp":1792072779603,"probe":"readiness","status":"UP",
#  "components":{"kv_bus":"UP","shared_data":"UP","http_draining":"ACCEPTING"}}
curl -H "X-Admin-Key: $ADMIN_API_KEY" localhost:8080/health/detailed
```

### Dans une image
```dockerfile
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import urllib.request,sys; \
    sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8080/health/ready', timeout=4).status==200 else 1)"
```

### Dans la pile
```yaml
healthcheck:
  test: ["CMD", "pg_isready", "-U", "techdb"]
depends_on:
  db: {condition: service_healthy}
```

## Pièges courants
- **Brancher le redémarrage sur la disponibilité** : une instance en démarrage lent se fait tuer en
  boucle.
- **Protéger les sondes simples** : l'infrastructure ne peut plus les lire, et croit l'instance
  morte.
- **Une sonde lente** : si la santé fait un appel réseau, la sonde expire et l'instance est déclarée
  morte alors qu'elle va bien (UC-WRK-08).
- **Ignorer le drain** : pendant l'arrêt, « pas prêt » est la bonne réponse, pas une anomalie.
- **Croire 200 synonyme de bonne santé métier** : la sonde parle de l'instance, pas de vos règles.

## Cas d'usage voisins
- UC-WRK-08 — publier santé et statistiques
- UC-SUP-06 — drainer puis arrêter proprement
- UC-SEC-08 — déclarer les routes publiques
- UC-DEV-06 — construire et lancer la pile Docker
