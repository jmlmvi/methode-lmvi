---
id: UC-DEV-06
titre: "Construire et lancer la pile Docker"
theme: "UC-DEV · Outillage du développeur"
moteurs:
  java: ok
  socle-py: ok
  socle-py-django: ok
contrat: "5.9"
mecanismes: "Dockerfile, docker-compose, vendor, healthcheck, TRUSTED_PROXIES"
---

# UC-DEV-06 — Construire et lancer la pile Docker

## Questions auxquelles répond ce cas d'usage
1. Comment construire l'image de mon application, et que doit-elle contenir ?
2. Pourquoi faut-il déposer la roue du framework dans le projet avant de construire ?
3. Que lance la pile complète, et dans quel ordre ?
4. Comment l'application attend-elle que la base soit prête ?
5. Quelles variables faut-il fournir, et lesquelles sont volontairement vides ?
6. Comment le conteneur sait-il que l'application est en bonne santé ?
7. Comment essayer une action multi-tenant dans la pile ?

## Mots-clés
Docker, `Dockerfile`, `docker-compose.yml`, `make vendor`, roue, `vendor/`,
PostgreSQL, `pg_isready`, `depends_on`, `service_healthy`, `HEALTHCHECK`,
`/health/ready`, `.env`, `TRUSTED_PROXIES`, `make up`, `make down`

## Ce que c'est, et quand s'en servir
L'image de l'application et la pile qui la fait tourner avec sa base. Le projet généré livre les
deux, et une cible pour chaque étape : construire la roue du framework, lancer, arrêter, suivre les
journaux.

L'étape qui surprend est la **roue** : le framework n'étant publié sur aucun index, l'image ne peut
pas l'installer depuis le réseau. On la construit dans le projet, et l'image l'installe de là.

## Ce que le socle fait · ce qu'il interdit
L'image installe la roue déposée dans le projet et **échoue avec un message explicite** si elle est
absente — plutôt que de construire une image sans framework. Elle déclare un contrôle de santé qui
interroge la sonde de disponibilité.

La pile démarre la base **avant** l'application, et l'application attend que la base se déclare
saine. Et la variable des proxys de confiance est **vide par défaut** dans la pile : c'est
volontaire (UC-SEC-06), au prix d'un refus de tenant qu'il faut comprendre.

## Exemples
### Construire et lancer
```bash
make vendor      # construit la roue du framework dans vendor/
make up          # application + PostgreSQL
make logs        # suivre
make down        # arrêter
```

### Ce que dit la pile
```yaml
services:
  db:
    image: postgres:16-alpine
    healthcheck: {test: ["CMD", "pg_isready", "-U", "techdb"], interval: 5s, retries: 10}
  app:
    build: .
    depends_on: {db: {condition: service_healthy}}
    environment:
      TECHDB_BACKEND: postgres
      TRUSTED_PROXIES: ${TRUSTED_PROXIES:-}        # vide par défaut : volontaire
```

### Le contrôle de santé de l'image
```dockerfile
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import urllib.request,sys; \
    sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8080/health/ready', timeout=4).status==200 else 1)"
```

### Essayer une action dans la pile
```bash
# Déclarer le réseau local comme proxy de confiance, sinon le tenant n'est pas cru.
echo 'TRUSTED_PROXIES=127.0.0.1,::1' >> .env && make up
```

## Pièges courants
- **Construire sans la roue** : la construction échoue — et c'est mieux qu'une image inutilisable.
- **Oublier les variables d'environnement** : l'administration refuse de démarrer sans clé.
- **Démarrer l'application avant la base** sans contrôle de santé : échecs au démarrage.
- **Mettre une plage large de proxys de confiance** pour « que ça marche » : on supprime
  l'isolation (UC-SEC-06).
- **Embarquer le fichier de base local dans l'image** : données de développement en production.

## Cas d'usage voisins
- UC-DEV-07 — mettre en place la CI
- UC-SUP-01 — répondre aux sondes de santé
- UC-SEC-06 — proxy de confiance pour l'en-tête de tenant
- UC-DB-02 — choisir le moteur de base
