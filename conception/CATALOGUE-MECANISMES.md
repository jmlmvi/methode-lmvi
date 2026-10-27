<!-- KIT-VERSION: 1.11.3 -->
# Catalogue des mécanismes du socle — de la brique à la fiche

> **À quoi ça sert** : au plan technique (M6, §3 bis), ce qui reste à écrire dans l'app — une fois
> écartés les services du Hub (`CATALOGUE-SERVICES.md`) — se route vers une fiche `UC-XXX-NN`. La
> fiche dit par quel mécanisme du socle passer, et pourquoi ; la brique la cite et la suit, pas le
> code d'un voisin.
>
> **Source canonique** : `APP-ZZ-TEMPLATE/docs/use-cases/` (148 fiches, index `INDEX.md`, généré
> depuis `catalogue.json`), celle que lit `controle-avant-go.sh`. Recensé le 2026-10-27, contrat
> socle 5.9 ; la source fait foi — si elle a grandi, régénérer cette table.
>
> Colonne **Java** : ✅ disponible · ⏳ prévu · ❌ hors périmètre · — sans objet. Les moteurs
> socle-py et socle-py-django ont leur colonne dans l'index source.

## UC-WRK · Workers et cycle de vie

Pour : écrire une unité de traitement et la faire tourner au bon rythme.

| Ma brique doit… | Fiche | Java |
|---|---|---|
| Exécuter une tâche toutes les N millisecondes | `UC-WRK-01` | ✅ |
| Exécuter une tâche à heure fixe (cron) | `UC-WRK-02` | ✅ |
| Worker passif : jamais planifié, piloté par ses actions | `UC-WRK-03` | ✅ |
| Faire découvrir ses workers automatiquement | `UC-WRK-04` | ✅ |
| Ordonner démarrage et arrêt par priorités | `UC-WRK-05` | ✅ |
| Désactiver un worker sans le supprimer | `UC-WRK-06` | ✅ |
| Injecter ses dépendances par le constructeur | `UC-WRK-07` | ✅ |
| Publier santé et statistiques d'un worker | `UC-WRK-08` | ✅ |
| Worker événementiel : consommer un flux en continu | `UC-WRK-09` | ✅ |
| Worker d'appel externe protégé | `UC-WRK-10` | ✅ |
| Travail bloquant ou non bloquant (sync / async) | `UC-WRK-11` | — |
| Partager un état entre workers sans base | `UC-WRK-12` | ✅ |

## UC-BUS · KvBus

Pour : faire communiquer les workers d'une même instance.

| Ma brique doit… | Fiche | Java |
|---|---|---|
| Stocker une valeur clé/valeur avec expiration | `UC-BUS-01` | ✅ |
| Opérations atomiques (incrément, compare-and-set) | `UC-BUS-02` | ✅ |
| Publier un événement à tous les abonnés | `UC-BUS-03` | ✅ |
| S'abonner à un sujet, et seulement à l'initialisation | `UC-BUS-04` | ✅ |
| Publication fiable : groupe de consommateurs, au moins une fois | `UC-BUS-05` | ✅ |
| File des messages en échec : inspecter, rejouer, purger | `UC-BUS-06` | ✅ |
| Rendre un consommateur idempotent | `UC-BUS-07` | ✅ |
| Changer d'implémentation de bus (mémoire vers Redis) | `UC-BUS-08` | ✅ |

## UC-ACT · Actions REST et MCP

Pour : exposer les capacités des workers aux humains, aux frontends et aux agents IA.

| Ma brique doit… | Fiche | Java |
|---|---|---|
| Déclarer une action avec ses paramètres typés | `UC-ACT-01` | ✅ |
| Valider les paramètres d'une action | `UC-ACT-02` | ✅ |
| Imposer un délai maximal d'exécution | `UC-ACT-03` | ✅ |
| Exiger un scope pour une action | `UC-ACT-04` | ✅ |
| Action en lecture seule ou à confirmation requise | `UC-ACT-05` | ✅ |
| Auditer les invocations sans secret en clair | `UC-ACT-06` | ✅ |
| Invoquer une action en REST (synchrone) | `UC-ACT-07` | ✅ |
| Invoquer une action en asynchrone et suivre le job | `UC-ACT-08` | ✅ |
| Exposer les actions comme outils MCP | `UC-ACT-09` | ✅ |
| Publier la spécification des actions | `UC-ACT-10` | ✅ |
| Publier un OpenAPI exact, sécurité comprise | `UC-ACT-11` | ✅ |
| Distinguer un refus métier d'une panne | `UC-ACT-12` | ✅ |
| Consommer les actions depuis un agent IA | `UC-ACT-13` | ✅ |
| Agréger plusieurs instances dans un catalogue (MCPagger) | `UC-ACT-14` | ✅ |

## UC-DB · TechDB

Pour : persister et exploiter l'état technique de l'instance.

| Ma brique doit… | Fiche | Java |
|---|---|---|
| Persister l'état technique d'une instance | `UC-DB-01` | ✅ |
| Choisir le moteur : H2, PostgreSQL, SQLite | `UC-DB-02` | ✅ |
| Faire évoluer le schéma par migrations tracées | `UC-DB-03` | ✅ |
| Interroger la TechDB en SQL en lecture seule | `UC-DB-04` | ✅ |
| Lire les événements récents par action | `UC-DB-05` | ✅ |
| Purger selon une rétention | `UC-DB-06` | ✅ |
| Sauvegarder et restaurer | `UC-DB-07` | ✅ |
| Console TechDB d'exploitation | `UC-DB-08` | ✅ |
| Isoler les données métier par tenant | `UC-DB-09` | ✅ |
| Refuser un accès sans tenant à une table partitionnée | `UC-DB-10` | ✅ |
| Écrire les tables métier en SQL brut | `UC-DB-11` | ✅ |
| Travailler avec des bases applicatives tierces | `UC-DB-12` | ✅ |

## UC-DOM · Domaine applicatif et couches

Pour : placer les règles de gestion et les données métier au bon endroit.

| Ma brique doit… | Fiche | Java |
|---|---|---|
| Modéliser une entité métier avec l'ORM Django | `UC-DOM-01` | — |
| Séparer les couches de l'application | `UC-DOM-02` | ✅ |
| Faire franchir la frontière par des échanges immuables | `UC-DOM-03` | — |
| Porter les règles de gestion dans un service | `UC-DOM-04` | ✅ |
| Fournir l'heure et la configuration au domaine | `UC-DOM-05` | ✅ |
| Porter l'intégrité par des contraintes en base | `UC-DOM-06` | — |
| Écritures de masse dans un QuerySet dédié | `UC-DOM-07` | — |
| Générer et appliquer les migrations d'une application métier | `UC-DOM-08` | — |

## UC-SEC · Sécurité et identité

Pour : savoir qui appelle, avec quels droits, pour quel tenant.

| Ma brique doit… | Fiche | Java |
|---|---|---|
| Protéger l'API d'administration par clé | `UC-SEC-01` | ✅ |
| Protéger /mcp par clé | `UC-SEC-02` | ✅ |
| Accepter les JWT délégués du Hub | `UC-SEC-03` | ✅ |
| Accepter un JWT délégué sur les actions REST | `UC-SEC-04` | ✅ |
| Transmettre scopes et tenant jusqu'à l'action | `UC-SEC-05` | ✅ |
| Ne croire l'en-tête de tenant que derrière un proxy de confiance | `UC-SEC-06` | ✅ |
| Fermer par défaut toute surface non publique | `UC-SEC-07` | ✅ |
| Déclarer les routes publiques d'une application | `UC-SEC-08` | ✅ |
| Protéger des routes par session OIDC | `UC-SEC-09` | ✅ |
| S'enregistrer auprès du registre de workers | `UC-SEC-10` | ✅ |
| Garde de licence TheSocle | `UC-SEC-11` | ✅ |
| Lire ses secrets au démarrage (Vault) | `UC-SEC-12` | ✅ |

## UC-CFG · Configuration

Pour : configurer une application sans toucher au code.

| Ma brique doit… | Fiche | Java |
|---|---|---|
| Configurer par fichier avec substitution d'environnement | `UC-CFG-01` | ✅ |
| Partager les mêmes clés entre les moteurs | `UC-CFG-02` | ✅ |
| Refuser au démarrage une configuration invalide | `UC-CFG-03` | ✅ |
| Lire une clé applicative typée | `UC-CFG-04` | ✅ |
| Basculer par profils d'environnement | `UC-CFG-05` | ✅ |
| Documenter les clés d'une application | `UC-CFG-06` | ✅ |

## UC-SUP · Supervision et exploitation

Pour : surveiller, redémarrer, drainer et arrêter une instance.

| Ma brique doit… | Fiche | Java |
|---|---|---|
| Répondre aux sondes de vivacité et de disponibilité | `UC-SUP-01` | ✅ |
| Lister les workers, leur état et leurs statistiques | `UC-SUP-02` | ✅ |
| Redémarrer automatiquement un worker malade | `UC-SUP-03` | ✅ |
| Redémarrer un worker à la main | `UC-SUP-04` | ✅ |
| Déclencher hors cycle un worker planifié | `UC-SUP-05` | ✅ |
| Drainer puis arrêter proprement | `UC-SUP-06` | ✅ |
| Drain HTTP seul, annulable | `UC-SUP-07` | ✅ |
| Exposer des métriques Prometheus | `UC-SUP-08` | ✅ |
| Escalade quand le redémarrage ne suffit pas | `UC-SUP-09` | ✅ |
| Journaliser avec un contexte de corrélation | `UC-SUP-10` | ✅ |
| Agréger et expédier un rapport d'erreurs | `UC-SUP-11` | ✅ |
| Tableau de bord d'exploitation des workers | `UC-SUP-12` | ✅ |

## UC-OPS · Workers intégrés du framework

Pour : utiliser les workers d'exploitation livrés avec le socle.

| Ma brique doit… | Fiche | Java |
|---|---|---|
| Piloter le système par commandes | `UC-OPS-01` | ✅ |
| Hygiène périodique automatique | `UC-OPS-02` | ✅ |
| Gérer les files d'échec | `UC-OPS-03` | ✅ |
| Limiter une ressource par sémaphores nommés | `UC-OPS-04` | ✅ |
| Servir des routes HTTP applicatives | `UC-OPS-05` | ✅ |
| Recevoir un webhook externe | `UC-OPS-06` | ✅ |
| Servir une page HTML depuis un worker | `UC-OPS-07` | ✅ |
| Charger des plugins à chaud | `UC-OPS-08` | ✅ |
| Déboguer en cours d'exécution | `UC-OPS-09` | ✅ |
| Catalogue des actions pour l'exploitant | `UC-OPS-10` | ✅ |

## UC-RES · Résilience des appels sortants

Pour : appeler un système tiers sans se laisser entraîner par ses pannes.

| Ma brique doit… | Fiche | Java |
|---|---|---|
| Couper les appels après une série d'échecs | `UC-RES-01` | ✅ |
| Réessayer avec attente croissante | `UC-RES-02` | ✅ |
| Refuser au-delà d'un débit autorisé | `UC-RES-03` | ✅ |
| Combiner disjoncteur, reprises et débit | `UC-RES-04` | ✅ |
| Imposer un délai à tout appel HTTP sortant | `UC-RES-05` | ✅ |

## UC-RUL · Moteurs de décision et code dynamique

Pour : décider et calculer sans redéployer.

| Ma brique doit… | Fiche | Java |
|---|---|---|
| Modéliser une décision en graphe (JDM) | `UC-RUL-01` | ✅ |
| Choisir le type de nœud adapté (JDM) | `UC-RUL-02` | ✅ |
| Écrire un évaluateur d'expression (JDM) | `UC-RUL-03` | ✅ |
| Auditer et mettre en cache les décisions | `UC-RUL-04` | ✅ |
| Exécuter un moteur de règles métier | `UC-RUL-05` | ✅ |
| Tracer les règles déclenchées | `UC-RUL-06` | ✅ |
| Compiler du code à la volée (Janino) | `UC-RUL-07` | ✅ |
| Exposer des interfaces de calcul dynamique | `UC-RUL-08` | ✅ |
| Exécuter un script dynamique | `UC-RUL-09` | ✅ |

## UC-PIP · Pipelines

Pour : chaîner des étapes de traitement.

| Ma brique doit… | Fiche | Java |
|---|---|---|
| Chaîner des étapes en pipeline (V1) | `UC-PIP-01` | ✅ |
| Déclarer une étape typée (V2) | `UC-PIP-02` | ✅ |
| Orchestrer un pipeline V2 | `UC-PIP-03` | ✅ |
| Appliquer les motifs de pipeline courants | `UC-PIP-04` | ✅ |
| Agréger des résultats de plusieurs sources | `UC-PIP-05` | ✅ |

## UC-INT · Intégrations et transports

Pour : s'insérer dans la plateforme et parler aux autres systèmes.

| Ma brique doit… | Fiche | Java |
|---|---|---|
| Consommer un sujet Kafka | `UC-INT-01` | ✅ |
| Exposer un service gRPC | `UC-INT-02` | ✅ |
| Tenir des sessions gRPC | `UC-INT-03` | ✅ |
| Relier deux instances en pair-à-pair | `UC-INT-04` | ✅ |
| Servir gRPC-Web à un frontend | `UC-INT-05` | ✅ |
| S'insérer derrière la Gateway TheSocle | `UC-INT-06` | ✅ |
| Appeler un autre Socle en client authentifié | `UC-INT-07` | ✅ |
| Déployer via le manifeste du Hub | `UC-INT-08` | ✅ |

## UC-UI · Pages et frontend

Pour : servir des interfaces d'exploitation et d'application.

| Ma brique doit… | Fiche | Java |
|---|---|---|
| Servir le tableau de bord des workers | `UC-UI-01` | ✅ |
| Servir la console TechDB | `UC-UI-02` | ✅ |
| Servir le catalogue des actions | `UC-UI-03` | ✅ |
| Héberger un frontend FrontendShell | `UC-UI-04` | ✅ |
| Servir un formulaire piloté par un schéma | `UC-UI-05` | ✅ |
| Rendre une page avec un moteur de gabarits | `UC-UI-06` | ✅ |
| Exposer l'interface MCPagger | `UC-UI-07` | ✅ |

## UC-FIL · Repository et fichiers

Pour : exposer des fichiers éditables et leurs validateurs.

| Ma brique doit… | Fiche | Java |
|---|---|---|
| Exposer un dépôt de fichiers éditables | `UC-FIL-01` | ✅ |
| Déclarer un type de fichier et son validateur | `UC-FIL-02` | ✅ |
| Éditer ces fichiers depuis FrontendEditorZen | `UC-FIL-03` | ✅ |
| Versionner et auditer les modifications | `UC-FIL-04` | ✅ |
| Charger au démarrage des définitions du dépôt | `UC-FIL-05` | ✅ |

## UC-CTR · Contrats et conformité

Pour : garder les moteurs indiscernables dans la durée.

| Ma brique doit… | Fiche | Java |
|---|---|---|
| Écrire un contrat hors du code | `UC-CTR-01` | ✅ |
| Jouer la suite de conformité croisée | `UC-CTR-02` | ✅ |
| Annoncer sa version de contrat | `UC-CTR-03` | ✅ |
| Faire échouer la CI sur une régression de contrat | `UC-CTR-04` | ✅ |
| Faire évoluer un contrat dans les trois moteurs | `UC-CTR-05` | ✅ |
| Vérifier qu'un backend est indiscernable d'un autre | `UC-CTR-06` | ✅ |

## UC-DEV · Outillage du développeur

Pour : démarrer, contrôler et livrer une application.

| Ma brique doit… | Fiche | Java |
|---|---|---|
| Créer un projet neuf | `UC-DEV-01` | ✅ |
| Obtenir un squelette complet en couches | `UC-DEV-02` | ❌ |
| Partir du bon modèle de worker | `UC-DEV-03` | ✅ |
| Contrôler son code contre les conventions | `UC-DEV-04` | ❌ |
| Bloquer un commit non conforme | `UC-DEV-05` | ❌ |
| Construire et lancer la pile Docker | `UC-DEV-06` | ✅ |
| Mettre en place la CI | `UC-DEV-07` | ✅ |
| Emporter le framework et sa doc hors du dépôt | `UC-DEV-08` | ❌ |
| Faire tourner une application de démonstration | `UC-DEV-09` | ✅ |


> **Aucune ligne ne répond ?** La brique porte `NON COUVERT` dans la table de routage de M6,
> avec sa raison ; la fiche est écrite en M7, une fois la solution trouvée.
