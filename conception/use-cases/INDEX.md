<!-- Généré par outils/generer-index.py depuis catalogue.json — ne pas éditer à la main. -->
# Catalogue des cas d'usage — Socle V005

> **148 cas d'usage** · 17 thèmes · contrat **5.9**
> Trois moteurs : **Socle V005 Java** (référence), **socle-py** (FastAPI), **socle-py-django** (ORM Django + Ninja).

**Tout développement commence ici.** On cherche son cas d'usage, on lit sa fiche, et c'est elle qui dit par quel mécanisme du socle passer — pas le code d'un voisin, pas un modèle recopié sans sa raison.

Légende : ✅ disponible · ⏳ prévu (phase du chantier) · ❌ hors périmètre déclaré · — sans objet.

## Thèmes

| Thème | Intention | Cas |
|---|---|---|
| [UC-WRK · Workers et cycle de vie](#uc-wrk) | écrire une unité de traitement et la faire tourner au bon rythme | 12 |
| [UC-BUS · KvBus](#uc-bus) | faire communiquer les workers d'une même instance | 8 |
| [UC-ACT · Actions REST et MCP](#uc-act) | exposer les capacités des workers aux humains, aux frontends et aux agents IA | 14 |
| [UC-DB · TechDB](#uc-db) | persister et exploiter l'état technique de l'instance | 12 |
| [UC-DOM · Domaine applicatif et couches](#uc-dom) | placer les règles de gestion et les données métier au bon endroit | 8 |
| [UC-SEC · Sécurité et identité](#uc-sec) | savoir qui appelle, avec quels droits, pour quel tenant | 12 |
| [UC-CFG · Configuration](#uc-cfg) | configurer une application sans toucher au code | 6 |
| [UC-SUP · Supervision et exploitation](#uc-sup) | surveiller, redémarrer, drainer et arrêter une instance | 12 |
| [UC-OPS · Workers intégrés du framework](#uc-ops) | utiliser les workers d'exploitation livrés avec le socle | 10 |
| [UC-RES · Résilience des appels sortants](#uc-res) | appeler un système tiers sans se laisser entraîner par ses pannes | 5 |
| [UC-RUL · Moteurs de décision et code dynamique](#uc-rul) | décider et calculer sans redéployer | 9 |
| [UC-PIP · Pipelines](#uc-pip) | chaîner des étapes de traitement | 5 |
| [UC-INT · Intégrations et transports](#uc-int) | s'insérer dans la plateforme et parler aux autres systèmes | 8 |
| [UC-UI · Pages et frontend](#uc-ui) | servir des interfaces d'exploitation et d'application | 7 |
| [UC-FIL · Repository et fichiers](#uc-fil) | exposer des fichiers éditables et leurs validateurs | 5 |
| [UC-CTR · Contrats et conformité](#uc-ctr) | garder les moteurs indiscernables dans la durée | 6 |
| [UC-DEV · Outillage du développeur](#uc-dev) | démarrer, contrôler et livrer une application | 9 |

## UC-WRK

**Workers et cycle de vie** — écrire une unité de traitement et la faire tourner au bon rythme.

| Id | Cas d'usage | java | socle-py | socle-py-django |
|---|---|---|---|---|
| [UC-WRK-01](./UC-WRK-01-planifier-par-intervalle.md) | Exécuter une tâche toutes les N millisecondes | ✅ | ✅ | ✅ |
| [UC-WRK-02](./UC-WRK-02-planifier-par-cron.md) | Exécuter une tâche à heure fixe (cron) | ✅ | ✅ | ✅ |
| [UC-WRK-03](./UC-WRK-03-worker-passif.md) | Worker passif : jamais planifié, piloté par ses actions | ✅ | ✅ | ✅ |
| [UC-WRK-04](./UC-WRK-04-decouverte-automatique.md) | Faire découvrir ses workers automatiquement | ✅ | ✅ | ✅ |
| [UC-WRK-05](./UC-WRK-05-priorites-demarrage-arret.md) | Ordonner démarrage et arrêt par priorités | ✅ | ✅ | ✅ |
| [UC-WRK-06](./UC-WRK-06-desactiver-un-worker.md) | Désactiver un worker sans le supprimer | ✅ | ✅ | ✅ |
| [UC-WRK-07](./UC-WRK-07-injecter-ses-dependances.md) | Injecter ses dépendances par le constructeur | ✅ | ✅ | ✅ |
| [UC-WRK-08](./UC-WRK-08-sante-et-statistiques.md) | Publier santé et statistiques d'un worker | ✅ | ✅ | ✅ |
| [UC-WRK-09](./UC-WRK-09-worker-evenementiel.md) | Worker événementiel : consommer un flux en continu | ✅ | ⏳ P-4 | ⏳ P-4 |
| [UC-WRK-10](./UC-WRK-10-worker-appel-externe-protege.md) | Worker d'appel externe protégé | ✅ | ⏳ P-4 | ⏳ P-4 |
| [UC-WRK-11](./UC-WRK-11-bloquant-ou-asynchrone.md) | Travail bloquant ou non bloquant (sync / async) | — | ✅ | ✅ |
| [UC-WRK-12](./UC-WRK-12-registre-partage.md) | Partager un état entre workers sans base | ✅ | ✅ | ✅ |

## UC-BUS

**KvBus** — faire communiquer les workers d'une même instance.

| Id | Cas d'usage | java | socle-py | socle-py-django |
|---|---|---|---|---|
| [UC-BUS-01](./UC-BUS-01-cle-valeur-avec-expiration.md) | Stocker une valeur clé/valeur avec expiration | ✅ | ✅ | ✅ |
| [UC-BUS-02](./UC-BUS-02-operations-atomiques.md) | Opérations atomiques (incrément, compare-and-set) | ✅ | ✅ | ✅ |
| [UC-BUS-03](./UC-BUS-03-publication-simple.md) | Publier un événement à tous les abonnés | ✅ | ✅ | ✅ |
| [UC-BUS-04](./UC-BUS-04-s-abonner-a-un-sujet.md) | S'abonner à un sujet, et seulement à l'initialisation | ✅ | ✅ | ✅ |
| [UC-BUS-05](./UC-BUS-05-publication-fiable.md) | Publication fiable : groupe de consommateurs, au moins une fois | ✅ | ✅ | ✅ |
| [UC-BUS-06](./UC-BUS-06-file-des-echecs.md) | File des messages en échec : inspecter, rejouer, purger | ✅ | ✅ | ✅ |
| [UC-BUS-07](./UC-BUS-07-consommateur-idempotent.md) | Rendre un consommateur idempotent | ✅ | ✅ | ✅ |
| [UC-BUS-08](./UC-BUS-08-bus-interchangeable.md) | Changer d'implémentation de bus (mémoire vers Redis) | ✅ | ❌ | ❌ |

## UC-ACT

**Actions REST et MCP** — exposer les capacités des workers aux humains, aux frontends et aux agents IA.

| Id | Cas d'usage | java | socle-py | socle-py-django |
|---|---|---|---|---|
| [UC-ACT-01](./UC-ACT-01-declarer-une-action.md) | Déclarer une action avec ses paramètres typés | ✅ | ✅ | ✅ |
| [UC-ACT-02](./UC-ACT-02-valider-les-parametres.md) | Valider les paramètres d'une action | ✅ | ✅ | ✅ |
| [UC-ACT-03](./UC-ACT-03-delai-maximal.md) | Imposer un délai maximal d'exécution | ✅ | ✅ | ✅ |
| [UC-ACT-04](./UC-ACT-04-exiger-un-scope.md) | Exiger un scope pour une action | ✅ | ✅ | ✅ |
| [UC-ACT-05](./UC-ACT-05-lecture-seule-et-confirmation.md) | Action en lecture seule ou à confirmation requise | ✅ | ✅ | ✅ |
| [UC-ACT-06](./UC-ACT-06-auditer-les-invocations.md) | Auditer les invocations sans secret en clair | ✅ | ✅ | ✅ |
| [UC-ACT-07](./UC-ACT-07-invoquer-en-rest.md) | Invoquer une action en REST (synchrone) | ✅ | ✅ | ✅ |
| [UC-ACT-08](./UC-ACT-08-invoquer-en-asynchrone.md) | Invoquer une action en asynchrone et suivre le job | ✅ | ✅ | ✅ |
| [UC-ACT-09](./UC-ACT-09-exposer-en-outils-mcp.md) | Exposer les actions comme outils MCP | ✅ | ✅ | ✅ |
| [UC-ACT-10](./UC-ACT-10-publier-la-specification.md) | Publier la spécification des actions | ✅ | ✅ | ✅ |
| [UC-ACT-11](./UC-ACT-11-publier-un-openapi.md) | Publier un OpenAPI exact, sécurité comprise | ✅ | ✅ | ✅ |
| [UC-ACT-12](./UC-ACT-12-refus-metier-ou-panne.md) | Distinguer un refus métier d'une panne | ✅ | ✅ | ✅ |
| [UC-ACT-13](./UC-ACT-13-consommer-depuis-un-agent.md) | Consommer les actions depuis un agent IA | ✅ | ✅ | ✅ |
| [UC-ACT-14](./UC-ACT-14-agreger-avec-mcpagger.md) | Agréger plusieurs instances dans un catalogue (MCPagger) | ✅ | ⏳ P-4 | ⏳ P-4 |

## UC-DB

**TechDB** — persister et exploiter l'état technique de l'instance.

| Id | Cas d'usage | java | socle-py | socle-py-django |
|---|---|---|---|---|
| [UC-DB-01](./UC-DB-01-persister-l-etat-technique.md) | Persister l'état technique d'une instance | ✅ | ✅ | ✅ |
| [UC-DB-02](./UC-DB-02-choisir-le-moteur.md) | Choisir le moteur : H2, PostgreSQL, SQLite | ✅ | ✅ | ✅ |
| [UC-DB-03](./UC-DB-03-migrations-tracees.md) | Faire évoluer le schéma par migrations tracées | ✅ | ✅ | ✅ |
| [UC-DB-04](./UC-DB-04-interroger-en-sql.md) | Interroger la TechDB en SQL en lecture seule | ✅ | ⏳ P-3 | ⏳ P-3 |
| [UC-DB-05](./UC-DB-05-lire-les-evenements.md) | Lire les événements récents par action | ✅ | ⏳ P-3 | ⏳ P-3 |
| [UC-DB-06](./UC-DB-06-purger-selon-la-retention.md) | Purger selon une rétention | ✅ | ⏳ P-3 | ⏳ P-3 |
| [UC-DB-07](./UC-DB-07-sauvegarder-et-restaurer.md) | Sauvegarder et restaurer | ✅ | ⏳ P-3 | ⏳ P-3 |
| [UC-DB-08](./UC-DB-08-console-techdb.md) | Console TechDB d'exploitation | ✅ | ⏳ P-3 | ⏳ P-3 |
| [UC-DB-09](./UC-DB-09-isoler-par-tenant.md) | Isoler les données métier par tenant | ✅ | ✅ | ✅ |
| [UC-DB-10](./UC-DB-10-refuser-sans-tenant.md) | Refuser un accès sans tenant à une table partitionnée | ✅ | ✅ | ✅ |
| [UC-DB-11](./UC-DB-11-tables-metier-en-sql.md) | Écrire les tables métier en SQL brut | ✅ | ✅ | ✅ |
| [UC-DB-12](./UC-DB-12-bases-applicatives-tierces.md) | Travailler avec des bases applicatives tierces | ✅ | ❌ | ❌ |

## UC-DOM

**Domaine applicatif et couches** — placer les règles de gestion et les données métier au bon endroit.

| Id | Cas d'usage | java | socle-py | socle-py-django |
|---|---|---|---|---|
| [UC-DOM-01](./UC-DOM-01-modeliser-avec-l-orm.md) | Modéliser une entité métier avec l'ORM Django | — | — | ✅ |
| [UC-DOM-02](./UC-DOM-02-separer-les-couches.md) | Séparer les couches de l'application | ✅ | ✅ | ✅ |
| [UC-DOM-03](./UC-DOM-03-echanges-immuables.md) | Faire franchir la frontière par des échanges immuables | — | — | ✅ |
| [UC-DOM-04](./UC-DOM-04-regles-de-gestion-en-service.md) | Porter les règles de gestion dans un service | ✅ | ✅ | ✅ |
| [UC-DOM-05](./UC-DOM-05-fournir-heure-et-configuration.md) | Fournir l'heure et la configuration au domaine | ✅ | ✅ | ✅ |
| [UC-DOM-06](./UC-DOM-06-integrite-par-contraintes.md) | Porter l'intégrité par des contraintes en base | — | — | ✅ |
| [UC-DOM-07](./UC-DOM-07-ecritures-de-masse.md) | Écritures de masse dans un QuerySet dédié | — | — | ✅ |
| [UC-DOM-08](./UC-DOM-08-migrations-applicatives.md) | Générer et appliquer les migrations d'une application métier | — | — | ✅ |

## UC-SEC

**Sécurité et identité** — savoir qui appelle, avec quels droits, pour quel tenant.

| Id | Cas d'usage | java | socle-py | socle-py-django |
|---|---|---|---|---|
| [UC-SEC-01](./UC-SEC-01-cle-d-administration.md) | Protéger l'API d'administration par clé | ✅ | ✅ | ✅ |
| [UC-SEC-02](./UC-SEC-02-cle-mcp.md) | Protéger /mcp par clé | ✅ | ✅ | ✅ |
| [UC-SEC-03](./UC-SEC-03-jwt-delegues-du-hub.md) | Accepter les JWT délégués du Hub | ✅ | ✅ | ✅ |
| [UC-SEC-04](./UC-SEC-04-jwt-sur-les-actions-rest.md) | Accepter un JWT délégué sur les actions REST | ✅ | ✅ | ✅ |
| [UC-SEC-05](./UC-SEC-05-transmettre-scopes-et-tenant.md) | Transmettre scopes et tenant jusqu'à l'action | ✅ | ✅ | ✅ |
| [UC-SEC-06](./UC-SEC-06-proxy-de-confiance.md) | Ne croire l'en-tête de tenant que derrière un proxy de confiance | ✅ | ✅ | ✅ |
| [UC-SEC-07](./UC-SEC-07-fermer-par-defaut.md) | Fermer par défaut toute surface non publique | ✅ | ✅ | ✅ |
| [UC-SEC-08](./UC-SEC-08-routes-publiques.md) | Déclarer les routes publiques d'une application | ✅ | ✅ | ✅ |
| [UC-SEC-09](./UC-SEC-09-session-oidc.md) | Protéger des routes par session OIDC | ✅ | ✅ | ✅ |
| [UC-SEC-10](./UC-SEC-10-registre-de-workers.md) | S'enregistrer auprès du registre de workers | ✅ | ⏳ P-4 | ⏳ P-4 |
| [UC-SEC-11](./UC-SEC-11-garde-de-licence.md) | Garde de licence TheSocle | ✅ | ⏳ P-4 | ⏳ P-4 |
| [UC-SEC-12](./UC-SEC-12-secrets-au-demarrage.md) | Lire ses secrets au démarrage (Vault) | ✅ | ⏳ P-4 | ⏳ P-4 |

## UC-CFG

**Configuration** — configurer une application sans toucher au code.

| Id | Cas d'usage | java | socle-py | socle-py-django |
|---|---|---|---|---|
| [UC-CFG-01](./UC-CFG-01-configurer-par-fichier.md) | Configurer par fichier avec substitution d'environnement | ✅ | ✅ | ✅ |
| [UC-CFG-02](./UC-CFG-02-memes-cles-partout.md) | Partager les mêmes clés entre les moteurs | ✅ | ✅ | ✅ |
| [UC-CFG-03](./UC-CFG-03-refuser-une-configuration-invalide.md) | Refuser au démarrage une configuration invalide | ✅ | ✅ | ✅ |
| [UC-CFG-04](./UC-CFG-04-lire-une-cle-typee.md) | Lire une clé applicative typée | ✅ | ✅ | ✅ |
| [UC-CFG-05](./UC-CFG-05-profils-d-environnement.md) | Basculer par profils d'environnement | ✅ | ❌ | ❌ |
| [UC-CFG-06](./UC-CFG-06-documenter-ses-cles.md) | Documenter les clés d'une application | ✅ | ✅ | ✅ |

## UC-SUP

**Supervision et exploitation** — surveiller, redémarrer, drainer et arrêter une instance.

| Id | Cas d'usage | java | socle-py | socle-py-django |
|---|---|---|---|---|
| [UC-SUP-01](./UC-SUP-01-sondes-de-sante.md) | Répondre aux sondes de vivacité et de disponibilité | ✅ | ✅ | ✅ |
| [UC-SUP-02](./UC-SUP-02-lister-les-workers.md) | Lister les workers, leur état et leurs statistiques | ✅ | ✅ | ✅ |
| [UC-SUP-03](./UC-SUP-03-redemarrage-automatique.md) | Redémarrer automatiquement un worker malade | ✅ | ⏳ P-4 | ⏳ P-4 |
| [UC-SUP-04](./UC-SUP-04-redemarrage-manuel.md) | Redémarrer un worker à la main | ✅ | ⏳ P-4 | ⏳ P-4 |
| [UC-SUP-05](./UC-SUP-05-declencher-hors-cycle.md) | Déclencher hors cycle un worker planifié | ✅ | ⏳ P-4 | ⏳ P-4 |
| [UC-SUP-06](./UC-SUP-06-drain-et-arret-ordonne.md) | Drainer puis arrêter proprement | ✅ | ⏳ P-4 | ⏳ P-4 |
| [UC-SUP-07](./UC-SUP-07-drain-http.md) | Drain HTTP seul, annulable | ✅ | ⏳ P-4 | ⏳ P-4 |
| [UC-SUP-08](./UC-SUP-08-metriques-prometheus.md) | Exposer des métriques Prometheus | ✅ | ⏳ P-4 | ⏳ P-4 |
| [UC-SUP-09](./UC-SUP-09-escalade-du-superviseur.md) | Escalade quand le redémarrage ne suffit pas | ✅ | ⏳ P-4 | ⏳ P-4 |
| [UC-SUP-10](./UC-SUP-10-journaliser-avec-contexte.md) | Journaliser avec un contexte de corrélation | ✅ | ✅ | ✅ |
| [UC-SUP-11](./UC-SUP-11-rapport-d-erreurs.md) | Agréger et expédier un rapport d'erreurs | ✅ | ⏳ P-4 | ⏳ P-4 |
| [UC-SUP-12](./UC-SUP-12-tableau-de-bord.md) | Tableau de bord d'exploitation des workers | ✅ | ⏳ P-4 | ⏳ P-4 |

## UC-OPS

**Workers intégrés du framework** — utiliser les workers d'exploitation livrés avec le socle.

| Id | Cas d'usage | java | socle-py | socle-py-django |
|---|---|---|---|---|
| [UC-OPS-01](./UC-OPS-01-piloter-par-commandes.md) | Piloter le système par commandes | ✅ | ⏳ P-4 | ⏳ P-4 |
| [UC-OPS-02](./UC-OPS-02-hygiene-periodique.md) | Hygiène périodique automatique | ✅ | ⏳ P-4 | ⏳ P-4 |
| [UC-OPS-03](./UC-OPS-03-gerer-les-files-d-echec.md) | Gérer les files d'échec | ✅ | ⏳ P-4 | ⏳ P-4 |
| [UC-OPS-04](./UC-OPS-04-semaphores-nommes.md) | Limiter une ressource par sémaphores nommés | ✅ | ❌ | ❌ |
| [UC-OPS-05](./UC-OPS-05-routes-http-applicatives.md) | Servir des routes HTTP applicatives | ✅ | ❌ | ❌ |
| [UC-OPS-06](./UC-OPS-06-recevoir-un-webhook.md) | Recevoir un webhook externe | ✅ | ❌ | ❌ |
| [UC-OPS-07](./UC-OPS-07-page-html-depuis-un-worker.md) | Servir une page HTML depuis un worker | ✅ | ✅ | ✅ |
| [UC-OPS-08](./UC-OPS-08-plugins-a-chaud.md) | Charger des plugins à chaud | ✅ | ❌ | ❌ |
| [UC-OPS-09](./UC-OPS-09-deboguer-en-execution.md) | Déboguer en cours d'exécution | ✅ | ❌ | ❌ |
| [UC-OPS-10](./UC-OPS-10-catalogue-des-actions.md) | Catalogue des actions pour l'exploitant | ✅ | ⏳ P-4 | ⏳ P-4 |

## UC-RES

**Résilience des appels sortants** — appeler un système tiers sans se laisser entraîner par ses pannes.

| Id | Cas d'usage | java | socle-py | socle-py-django |
|---|---|---|---|---|
| [UC-RES-01](./UC-RES-01-disjoncteur.md) | Couper les appels après une série d'échecs | ✅ | ⏳ P-4 | ⏳ P-4 |
| [UC-RES-02](./UC-RES-02-reessais-avec-attente.md) | Réessayer avec attente croissante | ✅ | ⏳ P-4 | ⏳ P-4 |
| [UC-RES-03](./UC-RES-03-limiter-le-debit.md) | Refuser au-delà d'un débit autorisé | ✅ | ⏳ P-4 | ⏳ P-4 |
| [UC-RES-04](./UC-RES-04-combiner-les-protections.md) | Combiner disjoncteur, reprises et débit | ✅ | ⏳ P-4 | ⏳ P-4 |
| [UC-RES-05](./UC-RES-05-timeout-obligatoire.md) | Imposer un délai à tout appel HTTP sortant | ✅ | ✅ | ✅ |

## UC-RUL

**Moteurs de décision et code dynamique** — décider et calculer sans redéployer.

| Id | Cas d'usage | java | socle-py | socle-py-django |
|---|---|---|---|---|
| [UC-RUL-01](./UC-RUL-01-decision-en-graphe.md) | Modéliser une décision en graphe (JDM) | ✅ | ❌ | ❌ |
| [UC-RUL-02](./UC-RUL-02-types-de-noeuds.md) | Choisir le type de nœud adapté (JDM) | ✅ | ❌ | ❌ |
| [UC-RUL-03](./UC-RUL-03-evaluateur-d-expression.md) | Écrire un évaluateur d'expression (JDM) | ✅ | ❌ | ❌ |
| [UC-RUL-04](./UC-RUL-04-auditer-les-decisions.md) | Auditer et mettre en cache les décisions | ✅ | ❌ | ❌ |
| [UC-RUL-05](./UC-RUL-05-moteur-de-regles.md) | Exécuter un moteur de règles métier | ✅ | ❌ | ❌ |
| [UC-RUL-06](./UC-RUL-06-tracer-les-regles.md) | Tracer les règles déclenchées | ✅ | ❌ | ❌ |
| [UC-RUL-07](./UC-RUL-07-compiler-a-la-volee.md) | Compiler du code à la volée (Janino) | ✅ | ❌ | ❌ |
| [UC-RUL-08](./UC-RUL-08-interfaces-de-calcul.md) | Exposer des interfaces de calcul dynamique | ✅ | ❌ | ❌ |
| [UC-RUL-09](./UC-RUL-09-script-dynamique.md) | Exécuter un script dynamique | ✅ | ❌ | ❌ |

## UC-PIP

**Pipelines** — chaîner des étapes de traitement.

| Id | Cas d'usage | java | socle-py | socle-py-django |
|---|---|---|---|---|
| [UC-PIP-01](./UC-PIP-01-pipeline-v1.md) | Chaîner des étapes en pipeline (V1) | ✅ | ❌ | ❌ |
| [UC-PIP-02](./UC-PIP-02-etape-typee-v2.md) | Déclarer une étape typée (V2) | ✅ | ❌ | ❌ |
| [UC-PIP-03](./UC-PIP-03-orchestrer-un-pipeline.md) | Orchestrer un pipeline V2 | ✅ | ❌ | ❌ |
| [UC-PIP-04](./UC-PIP-04-motifs-de-pipeline.md) | Appliquer les motifs de pipeline courants | ✅ | ❌ | ❌ |
| [UC-PIP-05](./UC-PIP-05-agreger-des-resultats.md) | Agréger des résultats de plusieurs sources | ✅ | ❌ | ❌ |

## UC-INT

**Intégrations et transports** — s'insérer dans la plateforme et parler aux autres systèmes.

| Id | Cas d'usage | java | socle-py | socle-py-django |
|---|---|---|---|---|
| [UC-INT-01](./UC-INT-01-consommer-kafka.md) | Consommer un sujet Kafka | ✅ | ❌ | ❌ |
| [UC-INT-02](./UC-INT-02-exposer-grpc.md) | Exposer un service gRPC | ✅ | ❌ | ❌ |
| [UC-INT-03](./UC-INT-03-sessions-grpc.md) | Tenir des sessions gRPC | ✅ | ❌ | ❌ |
| [UC-INT-04](./UC-INT-04-pair-a-pair-grpc.md) | Relier deux instances en pair-à-pair | ✅ | ❌ | ❌ |
| [UC-INT-05](./UC-INT-05-grpc-web.md) | Servir gRPC-Web à un frontend | ✅ | ❌ | ❌ |
| [UC-INT-06](./UC-INT-06-derriere-la-gateway.md) | S'insérer derrière la Gateway TheSocle | ✅ | ✅ | ✅ |
| [UC-INT-07](./UC-INT-07-appeler-un-autre-socle.md) | Appeler un autre Socle en client authentifié | ✅ | ⏳ P-4 | ⏳ P-4 |
| [UC-INT-08](./UC-INT-08-manifeste-de-deploiement.md) | Déployer via le manifeste du Hub | ✅ | ✅ | ✅ |

## UC-UI

**Pages et frontend** — servir des interfaces d'exploitation et d'application.

| Id | Cas d'usage | java | socle-py | socle-py-django |
|---|---|---|---|---|
| [UC-UI-01](./UC-UI-01-servir-le-tableau-de-bord.md) | Servir le tableau de bord des workers | ✅ | ⏳ P-4 | ⏳ P-4 |
| [UC-UI-02](./UC-UI-02-servir-la-console-techdb.md) | Servir la console TechDB | ✅ | ⏳ P-3 | ⏳ P-3 |
| [UC-UI-03](./UC-UI-03-servir-le-catalogue.md) | Servir le catalogue des actions | ✅ | ⏳ P-4 | ⏳ P-4 |
| [UC-UI-04](./UC-UI-04-heberger-un-frontend.md) | Héberger un frontend FrontendShell | ✅ | ⏳ P-5 | ⏳ P-5 |
| [UC-UI-05](./UC-UI-05-formulaire-par-schema.md) | Servir un formulaire piloté par un schéma | ✅ | ❌ | ❌ |
| [UC-UI-06](./UC-UI-06-moteur-de-gabarits.md) | Rendre une page avec un moteur de gabarits | ✅ | ✅ | ✅ |
| [UC-UI-07](./UC-UI-07-interface-mcpagger.md) | Exposer l'interface MCPagger | ✅ | ⏳ P-4 | ⏳ P-4 |

## UC-FIL

**Repository et fichiers** — exposer des fichiers éditables et leurs validateurs.

| Id | Cas d'usage | java | socle-py | socle-py-django |
|---|---|---|---|---|
| [UC-FIL-01](./UC-FIL-01-depot-de-fichiers.md) | Exposer un dépôt de fichiers éditables | ✅ | ❌ | ❌ |
| [UC-FIL-02](./UC-FIL-02-type-de-fichier-et-validateur.md) | Déclarer un type de fichier et son validateur | ✅ | ❌ | ❌ |
| [UC-FIL-03](./UC-FIL-03-editer-depuis-editorzen.md) | Éditer ces fichiers depuis FrontendEditorZen | ✅ | ❌ | ❌ |
| [UC-FIL-04](./UC-FIL-04-versionner-et-auditer.md) | Versionner et auditer les modifications | ✅ | ❌ | ❌ |
| [UC-FIL-05](./UC-FIL-05-charger-des-definitions.md) | Charger au démarrage des définitions du dépôt | ✅ | ❌ | ❌ |

## UC-CTR

**Contrats et conformité** — garder les moteurs indiscernables dans la durée.

| Id | Cas d'usage | java | socle-py | socle-py-django |
|---|---|---|---|---|
| [UC-CTR-01](./UC-CTR-01-ecrire-un-contrat.md) | Écrire un contrat hors du code | ✅ | ✅ | ✅ |
| [UC-CTR-02](./UC-CTR-02-suite-de-conformite.md) | Jouer la suite de conformité croisée | ✅ | ✅ | ✅ |
| [UC-CTR-03](./UC-CTR-03-version-de-contrat.md) | Annoncer sa version de contrat | ✅ | ✅ | ✅ |
| [UC-CTR-04](./UC-CTR-04-conformite-en-ci.md) | Faire échouer la CI sur une régression de contrat | ✅ | ✅ | ✅ |
| [UC-CTR-05](./UC-CTR-05-faire-evoluer-un-contrat.md) | Faire évoluer un contrat dans les trois moteurs | ✅ | ✅ | ✅ |
| [UC-CTR-06](./UC-CTR-06-backends-indiscernables.md) | Vérifier qu'un backend est indiscernable d'un autre | ✅ | ✅ | ✅ |

## UC-DEV

**Outillage du développeur** — démarrer, contrôler et livrer une application.

| Id | Cas d'usage | java | socle-py | socle-py-django |
|---|---|---|---|---|
| [UC-DEV-01](./UC-DEV-01-creer-un-projet.md) | Créer un projet neuf | ✅ | ✅ | ✅ |
| [UC-DEV-02](./UC-DEV-02-squelette-en-couches.md) | Obtenir un squelette complet en couches | ❌ | ❌ | ✅ |
| [UC-DEV-03](./UC-DEV-03-choisir-un-modele-de-worker.md) | Partir du bon modèle de worker | ✅ | ✅ | ✅ |
| [UC-DEV-04](./UC-DEV-04-revue-des-conventions.md) | Contrôler son code contre les conventions | ❌ | ❌ | ✅ |
| [UC-DEV-05](./UC-DEV-05-hook-de-pre-commit.md) | Bloquer un commit non conforme | ❌ | ❌ | ✅ |
| [UC-DEV-06](./UC-DEV-06-pile-docker.md) | Construire et lancer la pile Docker | ✅ | ✅ | ✅ |
| [UC-DEV-07](./UC-DEV-07-mettre-en-place-la-ci.md) | Mettre en place la CI | ✅ | ✅ | ✅ |
| [UC-DEV-08](./UC-DEV-08-archive-du-starter-pack.md) | Emporter le framework et sa doc hors du dépôt | ❌ | ❌ | ✅ |
| [UC-DEV-09](./UC-DEV-09-application-de-demonstration.md) | Faire tourner une application de démonstration | ✅ | ✅ | ✅ |

## Couverture par moteur

| Moteur | ✅ | ⏳ | ❌ | — |
|---|---|---|---|---|
| java | 138 | 0 | 4 | 6 |
| socle-py | 72 | 34 | 37 | 5 |
| socle-py-django | 81 | 34 | 33 | 0 |

Les ⏳ sont des phases cadrées du chantier (P-3 TechDB d'exploitation, P-4 supervision et workers intégrés, P-5 frontend et outillage) ; les ❌ sont les exclusions écrites de la spécification signée. Chaque fiche dit quoi faire en attendant — et ce qu'il ne faut surtout pas réimplémenter à la main.
