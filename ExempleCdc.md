# Cahier des Charges — Plateforme BilanSocle

*Multi-tenant · Moteur de parcours générique · Planning intelligent · Constructeur visuel*

Coaching professionnel & Bilan de compétences

|                   |                                                                                                                                                                                                                                                                                                                                                          |
|-------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Projet**        | BilanSocle — Plateforme multi-tenant coaching & bilan de compétences                                                                                                                                                                                                                                                                                     |
| **Référence**     | SPEC-BILANSOCLE-001                                                                                                                                                                                                                                                                                                                                      |
| **Version**       | v5.0                                                                                                                                                                                                                                                                                                                                                     |
| **Auteur**        | LMVI-CONSEIL / Jean-Marc Henry                                                                                                                                                                                                                                                                                                                           |
| **Client pilote** | Marie Gallante Coaching Professionnel — Nantes                                                                                                                                                                                                                                                                                                               |
| **Date**          | 29 mai 2026                                                                                                                                                                                                                                                                                                                                              |
| **Statut**        | À valider en phase de spécification                                                                                                                                                                                                                                                                                                                      |
| **Évolution v5**  | Reprise intégrale du périmètre v3 + planning v4. Unification de la numérotation des formulaires (FORM-STD-01 à 14), restauration du bilan intermédiaire coaching (formulaire + template), de l’email d’envoi manuel de ressources, du concept Condition, de la règle de validation Qualiopi, et enrichissement des descriptions de tests psychologiques. |

> *📝 v5.0 — Version exhaustive et cohérente : reprend l’intégralité du contenu v3 (vision, architecture multi-tenant, bibliothèque plateforme, moteur de parcours générique, tests psychologiques, formulaires, 360°, communications, modèle de données, règles métier, intégrations, budget) ET l’ensemble des apports v4 (module planning Cosmo CalDAV, MCP langage naturel, interface Calendly-like, modes de planification, délais adaptatifs, métadonnées d’engagement, parcours client détaillé). Corrige les incohérences v4 : numérotation unique des formulaires (FORM-STD-01 à 14), bilan intermédiaire coaching réintégré (FORM-STD-14 + TPL-CO-03), email d’envoi manuel de ressources rétabli (EMAIL-14), concept Condition et règle de validation parcours Qualiopi restaurés, descriptions détaillées des tests psychologiques réintégrées.*

## 1. Vision de la Plateforme

BilanSocle est une plateforme SaaS multi-tenant destinée aux cabinets de
coaching et de bilan de compétences. Elle remplace l'outillage artisanal
(Google Drive, Google Forms, documents Word manuels, calendriers
personnels) par un environnement intégré, paramétrable et conforme
Qualiopi/EDOF.

Différenciation clé : le moteur de parcours générique permet à chaque
consultant de construire ses propres séquences d'accompagnement (6, 8,
10, 12, 16, 24 séances...) via un constructeur visuel drag & drop. Le
module planning intelligent (Cosmo CalDAV + interface Calendly-like +
MCP langage naturel) automatise la gestion des rendez-vous. Chaque
parcours est une définition réutilisable que le système instancie pour
chaque bénéficiaire.

| **Dimension**              | **Description**                                                                         |
|----------------------------|-----------------------------------------------------------------------------------------|
| Modèle                     | SaaS multi-tenant — 1 tenant = 1 cabinet (consultant solo ou équipe)                    |
| Client pilote              | Marie Gallante Coaching Professionnel (Nantes) — certifiée Qualiopi, référencée CPF         |
| Cible à terme              | Tous les cabinets de coaching et bilan de compétences certifiés Qualiopi en France      |
| Contraintes réglementaires | Qualiopi, EDOF/Mon Compte Formation, Code du travail, RGPD                              |
| Hébergement                | TheSocleHub (VPS dédié) — gestionnaire de tenants intégré                               |
| Infrastructure             | TheSocle V005 — James (mail), Cosmo (CalDAV), InferenceWorker (IA), TranscriptionWorker |

## 2. Architecture Multi-Tenant

### 2.1 Structure Globale

| **Niveau**           | **Acteur**               | **Périmètre**                                                                | **Isolation**                   |
|----------------------|--------------------------|------------------------------------------------------------------------------|---------------------------------|
| **PLATEFORME**       | LMVI (admin global)      | Gestion tenants, bibliothèque par défaut, monitoring global                  | TheSocleHub                     |
| **TENANT / CABINET** | Admin cabinet (ex: Marie) | Consultants, bénéficiaires, personnalisations, parcours, templates, planning | Étanchéité totale entre tenants |
| **CONSULTANT**       | Consultant du cabinet    | Ses bénéficiaires uniquement (sauf admin cabinet)                            | Contrôle d'accès par rôle       |

> *📝 Isolation stricte : un bénéficiaire, un document ou un formulaire appartient à un seul tenant. Aucune donnée ne traverse les frontières de tenant, y compris pour LMVI. L'administrateur plateforme ne voit que les métadonnées de gestion, jamais les données des bénéficiaires.*

### 2.2 Modèle de Rôles

| **Rôle**                | **Description**                   | **Visibilité**                    | **Droits clés**                                                      |
|-------------------------|-----------------------------------|-----------------------------------|----------------------------------------------------------------------|
| Admin Plateforme (LMVI) | Gestionnaire global TheSocleHub   | Métadonnées tenants uniquement    | Créer/suspendre tenants, gérer bibliothèque plateforme               |
| Admin Cabinet           | Propriétaire du tenant (ex: Marie) | TOUS les bénéficiaires du cabinet | Gérer consultants, parcours, templates, planning global              |
| Consultant              | Praticien du cabinet              | SES bénéficiaires uniquement      | Créer bilans, gérer son planning, utiliser les ressources du cabinet |
| Bénéficiaire            | Client accompagné                 | Son espace personnel uniquement   | Formulaires, documents, choisir créneaux RDV, messagerie             |
| Tiers 360°              | Répondant externe ponctuel        | Formulaire unique via token       | Répondre au questionnaire 360° anonymement                           |

### 2.3 Gestionnaire de Tenants — TheSocleHub

| **Action MCP**            | **Description**                                                        | **Acteur**           |
|---------------------------|------------------------------------------------------------------------|----------------------|
| tenant_create             | Créer un nouveau tenant (nom cabinet, admin, domaine mail, plan)       | LMVI                 |
| tenant_activate / suspend | Activer ou suspendre un tenant                                         | LMVI                 |
| tenant_configure          | Configurer les paramètres du tenant (logo, charte, domaine mail dédié) | Admin cabinet        |
| tenant_library_import     | Importer des éléments de la bibliothèque plateforme dans le tenant     | Admin cabinet        |
| tenant_consultant_add     | Ajouter un consultant au tenant avec son rôle                          | Admin cabinet        |
| tenant_stats              | Statistiques du tenant (bilans actifs, satisfaction, engagement)       | Admin cabinet + LMVI |

## 3. Module Planning — Architecture Complète

Le module planning est l'un des composants les plus différenciants de
BilanSocle. Il s'appuie sur Cosmo (CalDAV Worker TheSocle) comme backend
calendrier — comme James gère les mails, Cosmo gère les agendas. Il
propose une interface Calendly-like intégrée dans l'espace bénéficiaire
et une saisie des disponibilités par MCP en langage naturel.

### 3.1 Architecture Technique

| **Composant**                  | **Rôle**                                                                                                   | **Technologie**                                       |
|--------------------------------|------------------------------------------------------------------------------------------------------------|-------------------------------------------------------|
| PlanningWorker (TheSocle)      | Orchestrateur central — gère disponibilités, calcul créneaux, instanciation RDV, alertes décrochage        | Worker TheSocle V005                                  |
| Cosmo (CalDAV Worker)          | Backend calendrier — stockage événements, sync CalDAV standard iPhone/Android                              | Cosmo CalDAV (comme James pour les mails)             |
| Interface Calendly-like        | Vue bénéficiaire pour choisir ses créneaux RDV — intégrée dans l'espace bénéficiaire authentifié           | React — composant sélection créneaux                  |
| MCP Planning (langage naturel) | Interface MCP pour saisir les disponibilités en langage naturel via Claude ou autre client MCP             | InferenceWorker + outil MCP planning_set_availability |
| Moteur de règles délais        | Calcule le délai minimum entre deux RDV selon le nœud TypeParcours en cours — filtre les créneaux proposés | PlanningWorker — lecture delai_min_jours du nœud      |
| API Jours Fériés               | Calendrier officiel des jours fériés français pour le calcul des ponts                                     | API data.gouv.fr — cache annuel TechDB                |
| API Vacances Scolaires         | Calendrier des vacances scolaires par zone (A, B, C) pour le calcul automatique                            | API Éducation Nationale — cache annuel TechDB         |

### 3.2 Saisie des Disponibilités — MCP Langage Naturel

Le consultant configure ses disponibilités via Claude (ou tout client
MCP) en langage naturel. Le PlanningWorker expose un outil MCP
planning_set_availability qui interprète les instructions via
InferenceWorker et met à jour le calendrier Cosmo.

|                                                                                               |
|-----------------------------------------------------------------------------------------------|
| **Exemples de phrases que le consultant peut dicter à Claude pour configurer son planning :** |

| **Phrase en langage naturel**                                                                   | **Ce que le système calcule et enregistre**                                                                            |
|-------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------|
| "En 2027, bloque tous les ponts des jours fériés français qui sont d'1 jour"                    | Calcule les ponts 2027 (ex: vendredi si Ascension un jeudi) via API jours fériés et marque ces jours indisponibles     |
| "Bloque les premières semaines de chaque période de vacances scolaires zone A"                  | Récupère le calendrier officiel Zone A 2026-2027 (API Éducation Nationale) et marque la 1ère semaine de chaque période |
| "Du 15 juillet au 31 août, pas de nouveaux clients mais je reste dispo pour mes clients actifs" | Marque la période en mode 'pas de nouvelles entrées' — séances des bilans en cours restent planifiables                |
| "Tous les lundis et mardis matin de 9h à 12h sont disponibles pour des bilans CPF"              | Crée des règles de disponibilité récurrentes pour ces créneaux                                                         |
| "Je ne travaille jamais le mercredi"                                                            | Marque tous les mercredis comme indisponibles en règle permanente                                                      |
| "Libère la semaine du 3 au 7 mars 2027 pour une formation"                                      | Marque cette semaine spécifique comme indisponible                                                                     |
| "En décembre, je réduis à 2 créneaux de bilan par semaine maximum"                              | Paramètre une limite de capacité hebdomadaire pour décembre                                                            |

### 3.3 Modes de Planification des RDV

| **Mode**                               | **Description**                                                                                                           | **Comportement**                                                                           | **Idéal pour**                                     |
|----------------------------------------|---------------------------------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------|----------------------------------------------------|
| **Mode Automatique Complet**           | Le système planifie l'intégralité des RDV dès le démarrage, en respectant les délais min de chaque nœud                   | Propose d'emblée tous les créneaux au bénéficiaire — il choisit et confirme en une fois    | Bénéficiaires très organisés, bilans courts        |
| **Mode Progressif N RDV (recommandé)** | Planifie N RDV à l'avance (N configurable : 1, 2, 3...). Quand un RDV est réalisé, le suivant est proposé automatiquement | Après chaque séance, le bénéficiaire reçoit une invitation à choisir le prochain créneau   | Majorité des bilans — équilibre autonomie/contrôle |
| **Mode Manuel**                        | Le consultant décide manuellement quand proposer le RDV suivant                                                           | Aucune proposition automatique — le consultant ouvre la planification quand il le juge bon | Bilans complexes, bénéficiaires fragiles, coaching |

> *📝 Valeur par défaut : Mode Progressif 2 RDV à l'avance. Modifiable globalement par le tenant ou individuellement par bilan.*

### 3.4 Délais Adaptatifs entre Séances

| **Transition**                 | **delai_min_jours**      | **Justification**                                                              | **Configurable** |
|--------------------------------|--------------------------|--------------------------------------------------------------------------------|------------------|
| Après RDV Préalable → Séance 1 | 3-7 jours                | Temps de compléter le formulaire de réflexion préalable                        | Oui              |
| Séance 1 → Séance 2            | 10-15 jours              | Interséance légère (synthèse parcours de vie)                                  | Oui              |
| Séance 2 → Séance 3            | 10-15 jours              | Interséance Potentialis® Partie 1                                              | Oui              |
| Séance 3 → Séance 4            | 10-15 jours              | RIASEC (~45 min) à compléter                                                   | Oui              |
| Séance 4 → Séance 5            | 10-15 jours              | Questionnaire valeurs et besoins (~2h)                                         | Oui              |
| Séance 5 → Séance 6            | 14-21 jours \[RENFORCÉ\] | Drivers + 360° feedback (invitations tiers, délai réponse) — charge importante | Oui              |
| Séance 6 → Séance 7            | 10-15 jours              | Ikigaï + étude réalisme à compléter                                            | Oui              |
| Séance 7 → Séance 8            | 10-15 jours              | Plan d'action final à finaliser et envoyer                                     | Oui              |
| Séance 8 → Suivi 6 mois        | 180 jours                | Obligation réglementaire Qualiopi                                              | Non — fixe       |

### 3.5 Interface Calendly-like — Espace Bénéficiaire

| **Élément**            | **Description**                                                                                                                                                          |
|------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Déclenchement          | Quand le système passe en mode 'planification du prochain RDV', une carte apparaît dans l'espace bénéficiaire : 'Choisissez votre prochain rendez-vous'                  |
| Affichage des créneaux | Vue calendrier mensuelle ou hebdomadaire — seuls les créneaux disponibles du consultant s'affichent, filtrés par le delai_min_jours du nœud suivant                      |
| Confirmation           | Clic sur un créneau → confirmation immédiate → EMAIL-03 (confirmation RDV) → ajout dans Cosmo (calendrier consultant + bénéficiaire)                                     |
| Modification de RDV    | Le bénéficiaire peut modifier son RDV jusqu'à X heures avant (paramétrable). Il choisit un nouveau créneau dans la même interface. Le nombre de modifications est tracé. |
| Annulation             | Si le bénéficiaire annule sans replanifier sous Y heures, alerte consultant. Le RDV passe en 'à replanifier' dans le tableau de bord.                                    |
| Vue mobile             | Interface responsive — accessible depuis smartphone. Compatible ajout au calendrier natif iPhone/Android (CalDAV ou lien .ics).                                          |

### 3.6 Métadonnées d'Engagement Bénéficiaire

| **Métadonnée**           | **Description**                                                                            | **Usage consultant**                                                      |
|--------------------------|--------------------------------------------------------------------------------------------|---------------------------------------------------------------------------|
| nb_modifications_rdv     | Nombre total de modifications de RDV sur l'ensemble du parcours                            | Indicateur d'instabilité agenda — peut justifier une adaptation du rythme |
| nb_annulations_rdv       | Nombre d'annulations (avec ou sans replanification)                                        | Alerte consultant si \> 2 — signe possible de décrochage                  |
| delai_moyen_confirmation | Délai moyen entre proposition d'un créneau et confirmation par le bénéficiaire (en heures) | Indicateur d'engagement — bénéficiaire très rapide vs lent                |
| nb_formulaires_en_retard | Nombre de formulaires complétés après le délai d'alerte                                    | Indicateur de charge cognitive ou de désengagement                        |
| taux_ponctualite         | Pourcentage de séances démarrées à l'heure                                                 | Statistique qualité cabinet — Qualiopi                                    |
| date_premiere_connexion  | Date de première connexion à l'espace personnel                                            | Indicateur d'activation — alerte si \> 72h après invitation               |
| frequence_connexion      | Nombre de connexions à l'espace entre deux séances                                         | Bénéficiaire très actif vs passif — adapter l'accompagnement              |

> *📝 Ces métadonnées sont visibles par le consultant dans le dossier bénéficiaire (section 'Engagement') et agrégées dans les statistiques du cabinet. Elles ne sont jamais exposées au bénéficiaire lui-même.*

## 4. Moteur de Parcours Générique

### 4.1 Concepts Fondamentaux

| **Concept**         | **Définition**                                                                                                             | **Analogie**         |
|---------------------|----------------------------------------------------------------------------------------------------------------------------|----------------------|
| TypeParcours        | Définition réutilisable — graphe JSON de nœuds avec connexions, conditions, ressources, délais et mode de planification    | Template / Classe    |
| Parcours (instance) | Instanciation d'un TypeParcours pour un bénéficiaire — copie du graphe avec données réelles                                | Instance / Objet     |
| Nœud                | Unité élémentaire : séance présentielle (N5) ou étape interséance (N1-N4)                                                  | Étape du workflow    |
| Connexion           | Lien entre deux nœuds — porte les conditions (delai_min_jours, prérequis complété)                                         | Transition           |
| Ressource           | Document, formulaire, test psychologique ou application attaché à un nœud                                                  | Asset                |
| Déclencheur         | Événement qui active une action (envoi email, alerte, ouverture formulaire, planification RDV suivant)                     | Trigger              |
| Condition           | Règle qui doit être satisfaite avant d’activer le nœud suivant (formulaire X complété, document Y rendu, délai min écoulé) | Guard / Précondition |

### 4.2 Taxonomie des 5 Types de Nœuds

| **Type** | **Nom**                         | **Description**                                                                                                                        | **Alertes délai**                   |
|----------|---------------------------------|----------------------------------------------------------------------------------------------------------------------------------------|-------------------------------------|
| **N1**   | Lecture                         | Le bénéficiaire reçoit des documents à lire. Aucune action requise.                                                                    | Aucune                              |
| **N2**   | Lecture + Rendu                 | Tout N1 + dépôt d'un ou plusieurs documents par le bénéficiaire.                                                                       | Alerte consultant si délai dépassé  |
| **N3**   | Lecture + Rendu + Formulaire(s) | Tout N2 + complétion d'un ou plusieurs formulaires ou tests psychologiques (optionnels, choix du consultant).                          | Alerte consultant si délai dépassé  |
| **N4**   | Niveau 3 + Application          | Tout N3 + déclenchement d'une application (360°, enquête tiers...) avec son propre cycle de vie.                                       | Alerte tiers non-répondants + délai |
| **N5**   | Séance Présentielle             | RDV consultant/bénéficiaire. Génère feuille de présence, CR dictée+IA. Déclenche la planification du RDV suivant selon le mode choisi. | Rappel RDV J-2 et J-0               |

### 4.3 Tests Psychologiques — Paramétrables par Consultant

Les tests ne sont pas systématiques — chaque consultant choisit quels
tests utiliser, à quel moment du parcours, et peut créer ses propres
questionnaires. La bibliothèque plateforme fournit des tests open source
prêts à l'emploi.

| **Test**                              | **Licence**                   | **Items**    | **Scoring auto**           | **Intégrable dans**            |
|---------------------------------------|-------------------------------|--------------|----------------------------|--------------------------------|
| RIASEC / AFC Holland                  | Open source (ONET)            | 42           | Oui — profil hexagonal     | N3 ou N4                       |
| IPIP-NEO Big Five (50 items)          | Domaine public (IPIP.ori.org) | 50           | Oui — profil radar OCEAN   | N3                             |
| IPIP-NEO Big Five (120 items)         | Domaine public                | 120          | Oui — profil détaillé      | N3                             |
| Schwartz Values Survey                | Libre académique              | 40           | Oui — cercle valeurs       | N3                             |
| Drivers AT (messages contraignants)   | Libre de droits               | 40           | Oui — profil drivers       | N3                             |
| Intelligences Multiples (Gardner)     | Libre académique              | 40           | Oui — histogramme          | N3                             |
| MBTI-like open source                 | Open source (16 types)        | 60           | Oui — type cognitif        | N3                             |
| Potentialis® (méthode Mm2i)           | Propriétaire — partenariat    | Livret guidé | Manuel (séance consultant) | N3 (livret) + N5 (restitution) |
| Questionnaire consultant personnalisé | Propriétaire tenant           | Variable     | Configurable               | N1 à N4                        |

> *📝 Dimensions des tests (libres de droits) : RIASEC — 6 types (Réaliste, Investigateur, Artistique, Social, Entrepreneur, Conventionnel) ; Big Five / OCEAN — 5 dimensions (Ouverture, Conscience, Extraversion, Agréabilité, Névrosisme) ; Schwartz — 10 valeurs motivationnelles universelles ; Drivers AT — 5 messages contraignants (Sois parfait, Fais des efforts, Fais plaisir, Sois fort, Dépêche-toi) ; Gardner — 8 intelligences multiples ; MBTI-like — 4 dimensions (E/I, S/N, T/F, J/P). Ikigaï est proposé comme module de synthèse visuelle (intersection des 4 cercles, voir FORM-STD-09). Chaque test est rendu dans l’espace bénéficiaire (tablette en séance ou navigateur), stocké dans le dossier, visible du consultant, et sert d’input à l’IA pour la structuration des comptes-rendus et la synthèse finale.*

### 4.4 Propriétés Configurables d'un Nœud

| **Propriété**      | **Description**                                                                       | **Valeurs possibles**                                        |
|--------------------|---------------------------------------------------------------------------------------|--------------------------------------------------------------|
| type               | Type de nœud (N1 à N5)                                                                | lecture / rendu / formulaire / application / seance          |
| label              | Nom affiché dans le constructeur et dans l'interface bénéficiaire                     | Texte libre (ex: 'Réflexion préalable')                      |
| phase              | Phase réglementaire du bilan à laquelle appartient ce nœud                            | preliminaire / investigation / conclusion / suivi            |
| delai_min_jours    | Délai minimum (en jours) depuis le nœud précédent                                     | Entier (0 = immédiat)                                        |
| delai_alerte_jours | Délai après lequel une alerte est envoyée au consultant si le nœud n'est pas complété | Entier (null = pas d'alerte)                                 |
| documents_lecture  | Liste des templates de documents à mettre à disposition du bénéficiaire               | Références TPL-xx                                            |
| documents_rendu    | Liste des types de documents que le bénéficiaire doit rendre                          | Texte libre (ex: 'CV', 'Synthèse parcours')                  |
| formulaires        | Liste des formulaires à compléter                                                     | Références FORM-xx ou formulaires personnalisés              |
| applications       | Liste des applications à déclencher (360°, test psycho...)                            | Références APP-xx                                            |
| trame_cr           | Trame de compte-rendu pour l'IA (nœuds N5 uniquement)                                 | Référence à un template de trame                             |
| signature_requise  | Si oui, génère une feuille de présence à signer                                       | true / false                                                 |
| conditions_entree  | Conditions à satisfaire pour activer ce nœud                                          | Liste de règles (formulaire X complété, document Y rendu...) |

### 4.5 Constructeur Visuel React Flow

| **Fonctionnalité**       | **Description**                                                                                                                                  |
|--------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------|
| Canvas drag & drop       | Zone de travail — nœuds colorés par type (N1 vert, N2 jaune, N3 orange, N4 rouge, N5 bleu), reliés par flèches conditionnelles                   |
| Palette de nœuds         | Barre latérale avec les 5 types de nœuds à glisser sur le canvas                                                                                 |
| Panneau de configuration | Clic sur un nœud → panneau : label, phase, delai_min_jours, delai_alerte, documents, formulaires, tests, applications, trame CR, mode planning   |
| Sélecteur de ressources  | Accès à la bibliothèque du tenant (templates, formulaires, tests) depuis le panneau                                                              |
| Validation Qualiopi      | Vérification automatique : 3 phases réglementaires présentes, documents obligatoires attachés, pas de nœud isolé                                 |
| Duplication et héritage  | Dupliquer un TypeParcours existant. Importer depuis la bibliothèque plateforme. Principe de copie — jamais de modification du template original. |
| Instanciation            | Création bilan → sélection TypeParcours → copie du graphe avec données réelles bénéficiaire + calcul planning automatique                        |

> *📝 Aperçu bénéficiaire : un bouton « Aperçu » simule l’espace bénéficiaire pour le nœud sélectionné, afin de visualiser ce que verra le client avant publication. React Flow est une bibliothèque open source (licence MIT) de visualisation de graphes pour React, utilisée notamment par Retool, n8n et Typeform pour leurs éditeurs visuels (reactflow.dev). Règle de composition : un nœud N5 (séance) peut référencer des nœuds N1 à N4 comme étapes de préparation (avant la séance) ou de suivi (interséance) — c’est ainsi que l’on modélise séance → interséance → séance suivante.*

### 4.6 Exemple — TypeParcours BC-16h (Marie Gallante)

Ci-dessous la modélisation du parcours de référence de Marie Gallante dans le
moteur générique :

| **Nœud** | **Type** | **Label**                                         | **Phase**     | **Délai min** | **Ressources attachées**                              | **Signature** |
|----------|----------|---------------------------------------------------|---------------|---------------|-------------------------------------------------------|---------------|
| N0       | N5       | RDV Préalable                                     | preliminaire  | 0j            | TPL-BC-01, TPL-BC-02, TPL-BC-04, TPL-BC-05, TPL-BC-06 | Oui           |
| N0b      | N3       | Avant séance 1 (auto-analyse)                     | preliminaire  | 0j            | FORM-STD-01, ressources séance 1                      | Non           |
| N1       | N5       | Séance 1 — Relecture de vie                       | investigation | 3j            | TPL-COM-01                                            | Oui           |
| N1b      | N2       | Interséance 1 — Parcours de vie                   | investigation | 7j            | FORM-STD-02                                           | Non           |
| N2       | N5       | Séance 2 — Potentialis® Partie 1                  | investigation | 10j           | TPL-COM-01, Livret Potentialis®                       | Oui           |
| N2b      | N3       | Interséance 2 — Potentialis® Partie 1             | investigation | 7j            | FORM-STD-03 (livret)                                  | Non           |
| N3       | N5       | Séance 3 — Potentialis® Partie 2                  | investigation | 10j           | TPL-COM-01                                            | Oui           |
| N3b      | N3       | Interséance 3 — RIASEC (~45 min)                  | investigation | 7j            | FORM-STD-04 (RIASEC)                                  | Non           |
| N4       | N5       | Séance 4 — Restitution Potentialis® + RIASEC      | investigation | 10j           | TPL-COM-01                                            | Oui           |
| N4b      | N3       | Interséance 4 — Valeurs et besoins (~2h)          | investigation | 7j            | FORM-STD-06                                           | Non           |
| N5s      | N5       | Séance 5 — Valeurs, besoins, aspirations          | investigation | 14j           | TPL-COM-01                                            | Oui           |
| N5b      | N4       | Interséance 5 — Drivers + 360° \[DÉLAI RENFORCÉ\] | investigation | 10j           | FORM-STD-07, APP-360                                  | Non           |
| N6       | N5       | Séance 6 — Drivers + 360° + Ikigaï                | investigation | 14j           | TPL-COM-01, FORM-STD-09                               | Oui           |
| N6b      | N3       | Interséance 6 — Réalisme projet                   | investigation | 7j            | FORM-STD-10                                           | Non           |
| N7       | N5       | Séance 7 — Décision + Plan d'action               | investigation | 10j           | TPL-COM-01, FORM-STD-11                               | Oui           |
| N7b      | N2       | Interséance 7 — Plan d'action final               | investigation | 7j            | FORM-STD-11 (finalisation)                            | Non           |
| N8       | N5       | Séance 8 — Conclusion + Synthèse finale           | conclusion    | 10j           | TPL-BC-08, TPL-BC-09, TPL-BC-10                       | Oui           |
| N9       | N3       | Suivi 6 mois                                      | suivi         | 180j          | FORM-STD-12                                           | Non           |

## 5. Bibliothèque Plateforme

### 5.1 Types de Parcours par Défaut

| **Ref.**     | **Type de parcours**         | **Nb séances**     | **Durée** | **Usage typique**                    |
|--------------|------------------------------|--------------------|-----------|--------------------------------------|
| PARC-BC-06   | Bilan de compétences 6h      | 3 + RDV préalable  | 1-2 mois  | Bilan court, profil déjà construit   |
| PARC-BC-08   | Bilan de compétences 8h      | 4 + RDV préalable  | 2 mois    | Bilan standard court                 |
| PARC-BC-10   | Bilan de compétences 10h     | 5 + RDV préalable  | 2-3 mois  | Bilan standard                       |
| PARC-BC-12   | Bilan de compétences 12h     | 6 + RDV préalable  | 2-3 mois  | Bilan standard enrichi               |
| PARC-BC-16   | Bilan de compétences 16h     | 8 + RDV préalable  | 3-4 mois  | Bilan complet (référence Marie Gallante) |
| PARC-BC-24   | Bilan de compétences 24h     | 12 + RDV préalable | 4-5 mois  | Bilan approfondi                     |
| PARC-CO-FREE | Coaching libre               | N paramétrables    | Variable  | Coaching sans contrainte CPF         |
| PARC-CO-06   | Coaching structuré 6 séances | 6                  | 2-3 mois  | Coaching avec objectif défini        |

> *📝 Héritage par copie : un tenant ne modifie jamais les templates de la bibliothèque plateforme. Il travaille sur une copie qu'il peut personnaliser librement sans impacter les autres tenants.*

### 5.2 Bibliothèque de Formulaires Standards

| **Ref.**    | **Formulaire**                               | **Moment du parcours**   | **Type**                              | **Disponible pour**  |
|-------------|----------------------------------------------|--------------------------|---------------------------------------|----------------------|
| FORM-STD-01 | Réflexion préalable                          | Avant séance 1           | Questions ouvertes + échelles         | Tous bilans          |
| FORM-STD-02 | Synthèse parcours de vie                     | Interséance 1            | Texte libre structuré + chronologie   | Tous bilans          |
| FORM-STD-03 | Livret Potentialis® (parties 1+2)            | Interséances 2 et 3      | Auto-évaluation guidée                | Bilans BC            |
| FORM-STD-04 | Test RIASEC / AFC Holland                    | Interséance 3            | QCM 42 items (~45 min)                | Bilans BC            |
| FORM-STD-05 | Big Five IPIP-NEO                            | Variable                 | QCM 50 ou 120 items                   | Bilans BC + coaching |
| FORM-STD-06 | Valeurs et besoins professionnels            | Interséance 4            | Classement + questions ouvertes (~2h) | Bilans BC            |
| FORM-STD-07 | Drivers — messages contraignants             | Interséance 5            | QCM analyse transactionnelle          | Bilans BC            |
| FORM-STD-08 | 360° Feedback générique                      | Interséance 5 → séance 6 | QCM + texte libre anonyme (tiers)     | Bilans BC + coaching |
| FORM-STD-09 | Ikigaï — synthèse et pistes                  | Interséance 6            | Texte structuré + 4 zones             | Bilans BC            |
| FORM-STD-10 | Étude du réalisme d'un nouveau projet        | Interséance 6            | Critères pondérés + texte             | Bilans BC            |
| FORM-STD-11 | Plan d'action personnel                      | Interséance 7            | Tableau objectifs/étapes/échéances    | Tous parcours        |
| FORM-STD-12 | Questionnaire satisfaction finale (Qualiopi) | Fin bilan + suivi 6 mois | Échelles NPS + questions ouvertes     | Tous parcours        |
| FORM-STD-13 | Découverte coaching                          | Avant séance 1 coaching  | Questions ouvertes                    | Coaching             |
| FORM-STD-14 | Bilan intermédiaire coaching                 | Mi-parcours coaching     | Évaluation objectifs mi-parcours      | Coaching             |

### 5.3 Templates de Documents par Défaut

| **Ref.**   | **Document**                     | **Type prestation** | **Obligatoire Qualiopi** | **Variables dynamiques clés**                                  |
|------------|----------------------------------|---------------------|--------------------------|----------------------------------------------------------------|
| TPL-BC-01  | Synthèse entretien préalable     | Bilan BC            | Oui                      | Nom bénéf., date, consultant, objectif, financement, situation |
| TPL-BC-02  | Convention de formation CPF      | Bilan BC CPF        | Oui                      | Nom, dates, heures, montant CPF, numéro EDOF                   |
| TPL-BC-03  | Convention de formation hors CPF | Bilan BC hors CPF   | Oui                      | Nom, dates, heures, montant, financeur                         |
| TPL-BC-04  | Attestation éligibilité CPF      | Bilan BC CPF        | Oui                      | Nom, numéro CPF, date                                          |
| TPL-BC-05  | Livret d'accueil                 | Bilan BC            | Oui                      | Nom cabinet, consultant, logo, dates parcours                  |
| TPL-BC-06  | Programme prévisionnel           | Bilan BC            | Oui                      | Type parcours, nb séances, phases, outils, dates               |
| TPL-BC-07  | Feuille de présence              | Tous                | Oui                      | Nom, date séance, durée, phase, lieu                           |
| TPL-BC-08  | Synthèse finale                  | Bilan BC            | Oui — Code travail       | Agrégation IA depuis CR + conclusion consultant                |
| TPL-BC-09  | Certificat de réalisation        | Bilan BC            | Oui                      | Nom, dates, heures réalisées, type bilan                       |
| TPL-BC-10  | Autorisation conservation RGPD   | Tous                | Oui — RGPD               | Nom, durée conservation, droits                                |
| TPL-BC-11  | Devis (financement entreprise)   | Bilan BC entreprise | Non                      | Nom entreprise, montant HT/TTC, TVA, conditions                |
| TPL-CO-01  | Contrat de coaching              | Coaching            | Non                      | Nom, objectifs, nb séances, tarif, code déontologie            |
| TPL-CO-02  | Synthèse coaching                | Coaching            | Non                      | Agrégation IA depuis CR + conclusion consultant                |
| TPL-COM-01 | Compte-rendu de séance           | Tous                | Non                      | Date, phase, points clés IA, travaux interséance               |

> *📝 Personnalisation tenant : chaque tenant dispose d'une copie de ces templates qu'il peut modifier (logo, charte graphique, contenu). Les variables dynamiques sont injectées automatiquement depuis les données du bilan. Le consultant peut créer des variantes de templates pour différents profils de bénéficiaires.*

### 5.4 Constructeur de Formulaires — Types de Champs

| **Type de champ**                     | **Usage typique**                                      | **Rendu bénéficiaire**                              |
|---------------------------------------|--------------------------------------------------------|-----------------------------------------------------|
| Texte court                           | Nom, titre de poste, réponse brève                     | Champ texte mono-ligne                              |
| Texte long                            | Descriptions libres, narrations, synthèses, réflexions | Zone de texte multi-lignes expansible               |
| Échelle de Likert (1-5 ou 1-10)       | Satisfaction, accord/désaccord, intensité              | Curseur ou boutons radio numérotés                  |
| QCM choix unique                      | Tests RIASEC, drivers, intelligences multiples         | Boutons radio avec images optionnelles              |
| QCM choix multiple                    | Compétences, valeurs, intérêts à sélectionner          | Cases à cocher                                      |
| Classement par priorité (drag & drop) | Valeurs professionnelles, besoins, objectifs           | Liste glisser-déposer pour ordonner                 |
| Tableau structuré                     | Plan d'action (objectif / étape / date / ressource)    | Tableau éditable avec ajout de lignes               |
| Photolangage                          | Projection sur images symboliques, vision board        | Galerie d'images cliquables avec sélection multiple |

## 6. Personnalisation par Tenant

### 6.1 Ce que chaque tenant peut personnaliser

| **Élément**                   | **Personnalisable ?**             | **Comment**                                        | **Héritage bibliothèque**                                     |
|-------------------------------|-----------------------------------|----------------------------------------------------|---------------------------------------------------------------|
| Types de parcours             | Oui — totalement                  | Constructeur visuel React Flow                     | Copie depuis bibliothèque plateforme ou création from scratch |
| Templates de documents        | Oui — totalement                  | Éditeur de templates (variables dynamiques)        | Copie depuis bibliothèque plateforme + adaptation charte      |
| Formulaires et questionnaires | Oui — totalement                  | Constructeur de formulaires (8 types de champs)    | Copie depuis bibliothèque + modification                      |
| Tests psychologiques          | Configurable (questions, scoring) | Paramétrage depuis l'interface admin tenant        | Tests open source fournis par la plateforme                   |
| Emails templates              | Oui — totalement                  | Éditeur WYSIWYG + variables dynamiques             | Copie depuis bibliothèque + adaptation logo/charte            |
| Trames de compte-rendu IA     | Oui                               | Éditeur de trame (structure, points clés attendus) | Templates par défaut fournis par la plateforme                |
| Logo et charte graphique      | Oui                               | Upload logo, couleurs primaires/secondaires        | Non applicable                                                |
| Domaine mail dédié            | Oui                               | Configuration DNS via TheSocle (James Worker)      | Non applicable                                                |

### 6.2 Instanciation d'un Parcours pour un Bénéficiaire

Quand un consultant crée un nouveau bilan, voici le processus
d'instanciation :

| **Étape** | **Action**                                                                     | **Résultat**                                                    |
|-----------|--------------------------------------------------------------------------------|-----------------------------------------------------------------|
| 1         | Le consultant sélectionne un TypeParcours (ex: PARC-BC-16)                     | Le système charge le graphe de nœuds du TypeParcours            |
| 2         | Le consultant ajuste si nécessaire (supprimer un nœud, modifier un délai)      | Personnalisation de l'instance pour ce bénéficiaire             |
| 3         | Le système injecte les données du bénéficiaire dans les variables dynamiques   | Templates et emails pré-remplis avec nom, dates, financement... |
| 4         | Le planning est calculé automatiquement depuis la date de démarrage            | Proposition de créneaux selon disponibilités consultant         |
| 5         | L'espace bénéficiaire est créé avec les ressources du premier nœud actif       | Le bénéficiaire reçoit EMAIL-01 avec son accès                  |
| 6         | Au fil du parcours, chaque nœud s'active quand ses conditions sont satisfaites | Déclenchement automatique des ressources, formulaires, alertes  |

## 7. Parcours Client Détaillé — Exemple BC 16h (Marie Gallante)

Le tableau suivant décrit l'instanciation du TypeParcours PARC-BC-16
pour un bénéficiaire de Marie Gallante. C'est la référence métier qui a servi
à concevoir le moteur générique.

|                             |
|-----------------------------|
| **ÉTAPE 0 — RDV Préalable** |

| **Action**                                                      | **Acteur**          | **Document généré**          | **Signature**             | **Email déclenché**         |
|-----------------------------------------------------------------|---------------------|------------------------------|---------------------------|-----------------------------|
| Enregistrement bénéficiaire (nom, prénom, mail, tél, situation) | Consultant          | Fiche bénéficiaire           | Non                       | —                           |
| Import CV multi-format + import LinkedIn                        | Consultant / Bénéf. | Dossier bénéficiaire         | Non                       | —                           |
| Analyse du besoin — adéquation bilan ?                          | Consultant          | —                            | Non                       | —                           |
| Synthèse de l'entretien préalable                               | Consultant          | TPL-BC-01 Synthèse préalable | Oui — bénéf. + consultant | EMAIL-02                    |
| Signature convention de formation / CPF                         | Consultant + Bénéf. | TPL-BC-02 Convention         | Oui                       | EMAIL-02                    |
| Attestation sur l'honneur éligibilité CPF                       | Bénéficiaire        | TPL-BC-04 Attestation CPF    | Oui                       | EMAIL-02                    |
| Remise livret d'accueil + programme                             | Consultant          | TPL-BC-05 Livret accueil     | Non                       | EMAIL-01 Bienvenue          |
| Ouverture espace bénéficiaire + planification auto RDV suivant  | Système             | —                            | Non                       | EMAIL-08 Invitation créneau |

|                                                         |
|---------------------------------------------------------|
| **AVANT LE RDV 1 — Interséance (travail bénéficiaire)** |

| **Action**                                                                | **Acteur**   | **Formulaire** | **Alerte si délai dépassé**    |
|---------------------------------------------------------------------------|--------------|----------------|--------------------------------|
| Questionnaire réflexion préalable (job actuel, contexte)                  | Bénéficiaire | FORM-STD-01    | Oui — EMAIL-11                 |
| Prise de connaissance ressources séance 1 (lignes de vie, roue de la vie) | Bénéficiaire | Ressources N1  | Non                            |
| Choix du créneau RDV 1 via interface Calendly-like                        | Bénéficiaire | —              | Oui — EMAIL-12 si non confirmé |

|                                                                  |
|------------------------------------------------------------------|
| **PHASE 1 — Séance 1 : Entretien diagnostic / Relecture de vie** |

| **Action**                                                                                     | **Acteur**          | **Document**                             | **Signature**  |
|------------------------------------------------------------------------------------------------|---------------------|------------------------------------------|----------------|
| État des lieux ressources, réactualisation situation                                           | Consultant          | TPL-COM-01 CR séance 1 (dictée+IA)       | Non            |
| Cadre de l'accompagnement : objectif, lieu, planning                                           | Consultant          | Planning calculé auto par PlanningWorker | Non            |
| Relecture parcours professionnel et personnel (lignes de vie, arbre de vie, pyramide de Dilts) | Consultant + Bénéf. | —                                        | Non            |
| Feuille de présence séance 1                                                                   | Consultant + Bénéf. | TPL-BC-07 Feuille de présence            | Oui — tablette |
| Déclenchement planification RDV 2 (mode progressif)                                            | Système             | —                                        | Non            |

Interséance : remplir 'Synthèse de mon parcours de vie' (FORM-STD-02) —
déposé dans l'espace partagé

|                                                      |
|------------------------------------------------------|
| **PHASE 2 — Séances 2-3 : Exploration Potentialis®** |

| **Séance**    | **Action**                                                                          | **Formulaire / Outil**       | **Signature**          |
|---------------|-------------------------------------------------------------------------------------|------------------------------|------------------------|
| Séance 2      | Présentation Potentialis® + ateliers aptitudes sensorielles et créatives (Partie 1) | Livret Potentialis® Partie 1 | Oui — feuille présence |
| Interséance 2 | Reprendre notes + remplir livret Potentialis® Partie 1                              | FORM-STD-03 Partie 1         | Alerte si retard       |
| Séance 3      | Évaluation formative + ateliers raisonnement logique et relationnels (Partie 2)     | Livret Potentialis® Partie 2 | Oui — feuille présence |
| Interséance 3 | Reprendre notes Potentialis® + réaliser test RIASEC (~45 min)                       | FORM-STD-04 RIASEC           | Alerte si retard       |

|                                                            |
|------------------------------------------------------------|
| **PHASE 2 — Séance 4 : Restitution Potentialis® + RIASEC** |

| **Action**                                                                     | **Acteur**          | **Document généré**                | **Signature**  |
|--------------------------------------------------------------------------------|---------------------|------------------------------------|----------------|
| Restitution profil Potentialis® (sensoriel, cognitif, relationnel)             | Consultant          | Rapport Potentialis® généré auto   | Non            |
| Traduction potentiels → orientations (fonctions, environnements préférentiels) | Consultant + Bénéf. | —                                  | Non            |
| Analyse écart situation actuelle / fonctionnement découvert                    | Consultant + Bénéf. | —                                  | Non            |
| Restitution profil RIASEC (domaines d'intérêt)                                 | Consultant          | Rapport RIASEC généré auto         | Non            |
| Premières hypothèses de changement                                             | Consultant + Bénéf. | TPL-COM-01 CR séance 4 (dictée+IA) | Non            |
| Feuille de présence séance 4                                                   | Consultant + Bénéf. | TPL-BC-07                          | Oui — tablette |

Interséance 4 : questionnaire valeurs et besoins professionnels
(FORM-STD-06, ~2h)

|                                                                                 |
|---------------------------------------------------------------------------------|
| **PHASE 2 — Séance 5 : Valeurs, besoins, aspirations \[délai renforcé après\]** |

| **Action**                                                         | **Acteur**          | **Document**                       | **Signature**  |
|--------------------------------------------------------------------|---------------------|------------------------------------|----------------|
| Appropriation système de valeurs et besoins professionnels         | Consultant + Bénéf. | Résultats FORM-STD-06              | Non            |
| Synthèse soft-skills, motivations, valeurs, aspirations, priorités | Consultant + Bénéf. | TPL-COM-01 CR séance 5 (dictée+IA) | Non            |
| Feuille de présence séance 5                                       | Consultant + Bénéf. | TPL-BC-07                          | Oui — tablette |

Interséance 5 \[DÉLAI RENFORCÉ 14-21 jours\] : test drivers
(FORM-STD-07) + lancement 360° (APP-360 — invitations tiers, relances
auto, consolidation anonymisée)

|                                                  |
|--------------------------------------------------|
| **PHASE 2 — Séance 6 : Drivers + 360° + Ikigaï** |

| **Action**                                                                          | **Acteur**          | **Document**                             | **Signature**  |
|-------------------------------------------------------------------------------------|---------------------|------------------------------------------|----------------|
| Analyse résultats drivers (messages contraignants)                                  | Consultant + Bénéf. | Résultats FORM-STD-07                    | Non            |
| Analyse feedbacks 360° reçus des tiers (rapport consolidé anonymisé)                | Consultant          | Rapport 360° consolidé (consultant seul) | Non            |
| Ikigaï — synthèse, renforcement, pistes d'exploration                               | Consultant + Bénéf. | FORM-STD-09 Ikigaï                       | Non            |
| Identification directions pressenties (formation, mobilité, reconversion, création) | Consultant + Bénéf. | —                                        | Non            |
| CR séance 6 (dictée + IA)                                                           | Consultant          | TPL-COM-01                               | Non            |
| Feuille de présence séance 6                                                        | Consultant + Bénéf. | TPL-BC-07                                | Oui — tablette |

Interséance 6 : terminer Ikigaï + remplir 'Étude du réalisme d'un
nouveau projet' (FORM-STD-10) + enquêtes métiers

|                                                   |
|---------------------------------------------------|
| **PHASE 2 — Séance 7 : Décision + Plan d'action** |

| **Action**                                                                 | **Acteur**          | **Document**              | **Signature**  |
|----------------------------------------------------------------------------|---------------------|---------------------------|----------------|
| Étude projets réalistes à la lumière des explorations (interne et externe) | Consultant + Bénéf. | FORM-STD-10 finalisé      | Non            |
| Arbre de vie décisionnel (valeurs, contraintes, options)                   | Consultant + Bénéf. | —                         | Non            |
| Chemin de vie — imaginaire d'avenir positif                                | Consultant + Bénéf. | —                         | Non            |
| Co-construction plan d'action à 6 mois                                     | Consultant + Bénéf. | FORM-STD-11 Plan d'action | Non            |
| CR séance 7 (dictée + IA)                                                  | Consultant          | TPL-COM-01                | Non            |
| Feuille de présence séance 7                                               | Consultant + Bénéf. | TPL-BC-07                 | Oui — tablette |

Interséance 7 : renforcer enquêtes, affiner projet, plan d'action final
(FORM-STD-11), vision board optionnel

|                                                              |
|--------------------------------------------------------------|
| **PHASE 3 — Séance 8 : Conclusion et remise de la synthèse** |

| **Action**                                                            | **Acteur**          | **Document**                            | **Signature**           |
|-----------------------------------------------------------------------|---------------------|-----------------------------------------|-------------------------|
| Ancrage décision, intention, responsabilisation dans la mise en œuvre | Consultant          | —                                       | Non                     |
| Remise synthèse finale (document obligatoire Code du travail)         | Consultant          | TPL-BC-08 Synthèse finale (IA + dictée) | Oui — bénéficiaire seul |
| Feuille de présence séance 8                                          | Consultant + Bénéf. | TPL-BC-07                               | Oui — tablette          |
| Bilan du parcours (modalités, résultats, relation)                    | Consultant + Bénéf. | —                                       | Non                     |
| Voyage de vie — relecture du parcours                                 | Consultant + Bénéf. | —                                       | Non                     |

|                                         |
|-----------------------------------------|
| **FIN DU BILAN — Actions automatiques** |

| **Action**                                     | **Acteur**     | **Document**                | **Signature**    |
|------------------------------------------------|----------------|-----------------------------|------------------|
| Certificat de réalisation                      | Système (auto) | TPL-BC-09 Certificat        | Oui — consultant |
| Questionnaire satisfaction finale (Qualiopi)   | Bénéficiaire   | FORM-STD-12                 | Non              |
| Autorisation conservation des documents        | Bénéficiaire   | TPL-BC-10 Autorisation RGPD | Oui              |
| Déclaration sortie EDOF (si CPF)               | Système (auto) | API EDOF                    | Non              |
| Envoi email clôture + synthèse PDF             | Système        | EMAIL-09 Clôture bilan      | Non              |
| Planification automatique suivi 6 mois (J+180) | Système        | Batch + EMAIL-10            | Non              |

### 7.2 Coaching Professionnel — Parcours Libre

| **Étape**                                      | **Description**                                                           | **Documents spécifiques coaching**      |
|------------------------------------------------|---------------------------------------------------------------------------|-----------------------------------------|
| Entretien découverte                           | Premier contact, définition des objectifs coaching                        | TPL-CO-01 Contrat de coaching           |
| Séances (nombre libre, mode Manuel recommandé) | Accompagnement selon objectifs définis — CR dictée+IA après chaque séance | TPL-COM-01 CR séance (dictée+IA)        |
| Bilan intermédiaire (optionnel)                | Point d'étape à mi-parcours                                               | TPL-CO-03 Bilan intermédiaire coaching  |
| Clôture                                        | Évaluation objectifs atteints, plan de suite                              | TPL-CO-02 Synthèse coaching (IA+dictée) |
| Suivi post-coaching (optionnel)                | Point à 3 ou 6 mois                                                       | EMAIL-C02 Suivi post-coaching           |

## 8. Catalogue de Documents par Type de Prestation

### 8.1 Documents Communs à Tous les Parcours

| **Ref.**   | **Document**           | **Génération**                                                | **Signature**             | **Confidentialité**   |
|------------|------------------------|---------------------------------------------------------------|---------------------------|-----------------------|
| TPL-COM-01 | Compte-rendu de séance | Dictée + transcription + structuration IA selon trame nœud N5 | Non                       | Consultant uniquement |
| TPL-COM-02 | Feuille de présence    | Auto à chaque nœud N5                                         | Oui — tablette présentiel | Dossier partagé       |
| TPL-COM-03 | Plan d'action          | Depuis FORM-STD-11 finalisé                                   | Non                       | Dossier partagé       |

### 8.2 Documents Bilan de Compétences CPF (Qualiopi obligatoires)

| **Ref.**  | **Document**                                 | **Obligatoire**       | **Génération**                              | **Signature**             |
|-----------|----------------------------------------------|-----------------------|---------------------------------------------|---------------------------|
| TPL-BC-01 | Synthèse entretien préalable                 | Oui                   | Trame pré-remplie depuis fiche bénéficiaire | Oui — bénéf. + consultant |
| TPL-BC-02 | Convention de formation CPF                  | Oui                   | Auto depuis données bilan + EDOF            | Oui — bénéf. + consultant |
| TPL-BC-03 | Convention hors CPF                          | Oui                   | Auto depuis données bilan                   | Oui — bénéf. + consultant |
| TPL-BC-04 | Attestation éligibilité CPF                  | Oui (si CPF)          | Template fixe                               | Oui — bénéficiaire        |
| TPL-BC-05 | Livret d'accueil                             | Oui                   | PDF personnalisé nom/dates/logo cabinet     | Non                       |
| TPL-BC-06 | Programme prévisionnel                       | Oui                   | Auto depuis TypeParcours instancié          | Non                       |
| TPL-BC-07 | Feuille de présence                          | Oui                   | Auto à chaque séance N5                     | Oui — tablette            |
| TPL-BC-08 | Synthèse finale                              | Oui — Code du travail | IA depuis CR séances + dictée conclusion    | Oui — bénéficiaire seul   |
| TPL-BC-09 | Certificat de réalisation                    | Oui                   | Auto à clôture du bilan                     | Oui — consultant          |
| TPL-BC-10 | Autorisation conservation RGPD               | Oui — RGPD            | Template fixe                               | Oui — bénéficiaire        |
| TPL-BC-11 | CGV + Code déontologie + Règlement intérieur | Oui — annexes         | PDF statique joint au contrat               | Non                       |
| TPL-BC-12 | Devis (financement entreprise)               | Non                   | Template paramétrable                       | Non                       |

### 8.3 Documents Coaching

| **Ref.**  | **Document**                 | **Génération**                                                             | **Signature**             |
|-----------|------------------------------|----------------------------------------------------------------------------|---------------------------|
| TPL-CO-01 | Contrat de coaching          | Template paramétrable (objectifs, nb séances, tarif, code déontologie SFC) | Oui — bénéf. + consultant |
| TPL-CO-02 | Synthèse coaching            | IA depuis CR + dictée conclusion                                           | Non                       |
| TPL-CO-03 | Bilan intermédiaire coaching | Template libre — point d’étape mi-parcours                                 | Non                       |

## 9. Formulaires — Migration Google Forms

### 9.1 Constructeur de Formulaires

Voir section 5.3 — 8 types de champs disponibles dans le constructeur
intégré à la bibliothèque plateforme.

### 9.2 Inventaire des Formulaires à Migrer (Google Forms → BilanSocle)

| **Ref. std.** | **Formulaire**                          | **Moment**               | **Type nœud** | **Migration**                              |
|---------------|-----------------------------------------|--------------------------|---------------|--------------------------------------------|
| FORM-STD-01   | Réflexion préalable                     | Avant séance 1           | N3            | Recréer dans constructeur                  |
| FORM-STD-02   | Synthèse parcours de vie                | Interséance 1            | N2 (rendu)    | Recréer dans constructeur                  |
| FORM-STD-03   | Livret Potentialis® (parties 1+2)       | Interséances 2 et 3      | N3            | Recréer — intégrer scoring Potentialis®    |
| FORM-STD-04   | Test RIASEC / AFC Holland               | Interséance 3            | N3            | Intégrer module RIASEC open source         |
| FORM-STD-05   | Big Five IPIP-NEO                       | Variable                 | N3            | Intégrer module IPIP-NEO open source       |
| FORM-STD-06   | Valeurs et besoins professionnels (~2h) | Interséance 4            | N3            | Recréer avec champs classement + texte     |
| FORM-STD-07   | Drivers (messages contraignants AT)     | Interséance 5            | N3            | Intégrer module Drivers                    |
| FORM-STD-08   | 360° Feedback                           | Interséance 5 → séance 6 | N4 (app)      | Voir section 9 — Application 360°          |
| FORM-STD-09   | Ikigaï                                  | Interséance 6            | N3            | Recréer avec 4 zones texte + visualisation |
| FORM-STD-10   | Étude réalisme projet                   | Interséance 6            | N3            | Recréer dans constructeur                  |
| FORM-STD-11   | Plan d'action personnel                 | Interséance 7            | N2+N3         | Recréer avec tableau structuré             |
| FORM-STD-12   | Satisfaction finale (Qualiopi)          | Fin bilan + suivi 6 mois | N3            | Recréer avec NPS + questions Qualiopi      |
| FORM-STD-13   | Découverte coaching                     | Avant séance 1 coaching  | N3            | Créer (nouveau)                            |
| FORM-STD-14   | Bilan intermédiaire coaching            | Mi-parcours coaching     | N3            | Créer (nouveau)                            |

## 10. Application 360° Feedback

| **Étape**           | **Description**                                                                                                    | **Acteur**          | **Fonctionnalité application**                     |
|---------------------|--------------------------------------------------------------------------------------------------------------------|---------------------|----------------------------------------------------|
| Configuration       | Le consultant paramètre le questionnaire 360° pour ce bénéficiaire (questions, nb répondants min, délai, anonymat) | Consultant          | Interface configuration depuis nœud N4             |
| Invitation tiers    | Le bénéficiaire saisit les emails des tiers à inviter                                                              | Bénéficiaire        | Saisie emails + déclenchement EMAIL-06             |
| Réponse tiers       | Le tiers reçoit un lien unique sécurisé (token), répond anonymement, ne peut répondre qu'une fois                  | Tiers               | Formulaire public sécurisé — token unique          |
| Suivi               | Le consultant voit en temps réel le taux de réponse (X/Y répondants)                                               | Consultant          | Tableau de bord 360° dans le dossier               |
| Relance automatique | Si tiers non-répondant après délai paramétrable → relance EMAIL-07                                                 | Système             | Batch de relance                                   |
| Consolidation       | À l'échéance → consolidation automatique anonymisée — réponses individuelles jamais accessibles                    | Système             | Rapport consolidé — moyennes, verbatims anonymisés |
| Restitution séance  | En séance 6, le consultant présente le rapport au bénéficiaire sur sa tablette                                     | Consultant + Bénéf. | Mode présentation tablette                         |

> *📝 Confidentialité absolue : les réponses individuelles des tiers sont anonymisées irréversiblement à la consolidation. Même le consultant ne peut pas identifier qui a dit quoi. Seuls les agrégats sont accessibles.*

> *📝 Restitution consultant : avant la séance 6, le consultant dispose d’une vue confidentielle du rapport 360° consolidé (moyennes, écarts, verbatims anonymisés) pour préparer la restitution. Cette vue est accessible au consultant uniquement.*

## 11. Catalogue des Communications

### 11.1 Architecture Multi-Canal

| **Canal**                                            | **Usage**                                                                 | **Backend**             | **Config tenant**                  |
|------------------------------------------------------|---------------------------------------------------------------------------|-------------------------|------------------------------------|
| Email domaine dédié (ex: marie@mariegallante-coaching.fr) | Emails officiels : documents, convocations, 360°, rappels RDV             | James Worker (TheSocle) | DNS + domaine configuré par tenant |
| Gmail (sync OAuth2)                                  | Emails personnels Marie, réponses bénéficiaires Gmail, matching threads    | API Gmail OAuth2        | Configuration OAuth2 par tenant    |
| CalDAV (Cosmo)                                       | Sync calendrier consultant iPhone/Android + invitations iCal bénéficiaire | Cosmo CalDAV Worker     | Automatique par tenant             |
| Messagerie espace partagé                            | Échanges informels dans le cadre du bilan                                 | Application interne     | Notifications email optionnelles   |

> *📝 Matching multi-canal : tout email reçu par le consultant (domaine dédié OU Gmail) est analysé et automatiquement rattaché au dossier bénéficiaire correspondant via matching de l'adresse email. Vue unifiée de toutes les communications.*

### 11.2 Catalogue des Emails Templates

| **Ref.**  | **Email**                                      | **Déclencheur**                            | **Destinataire**    | **Canal**              |
|-----------|------------------------------------------------|--------------------------------------------|---------------------|------------------------|
| EMAIL-01  | Bienvenue + accès espace bénéficiaire          | Validation dossier                         | Bénéficiaire        | Domaine dédié          |
| EMAIL-02  | Envoi documents à signer                       | Génération document signable               | Bénéficiaire        | Domaine dédié          |
| EMAIL-03  | Confirmation RDV                               | Choix créneau par bénéficiaire             | Bénéf. + Consultant | Domaine dédié + Cosmo  |
| EMAIL-04  | Rappel RDV J-2                                 | Batch automatique — désactivable           | Bénéficiaire        | Domaine dédié ou Gmail |
| EMAIL-04b | Rappel RDV J-0 matin                           | Batch 8h — désactivable                    | Bénéficiaire        | Domaine dédié ou Gmail |
| EMAIL-05  | Mise à disposition formulaire / ressource      | Activation nœud N1-N4                      | Bénéficiaire        | Domaine dédié          |
| EMAIL-06  | Invitation 360° (tiers)                        | Lancement 360° par bénéficiaire            | Tiers               | Domaine dédié          |
| EMAIL-07  | Relance 360° (tiers)                           | Batch si non-réponse — désactivable        | Tiers               | Domaine dédié          |
| EMAIL-08  | Invitation à choisir un créneau RDV            | Activation mode planification              | Bénéficiaire        | Domaine dédié          |
| EMAIL-09  | Clôture bilan + synthèse PDF                   | Fin séance 8 + signature                   | Bénéficiaire        | Domaine dédié          |
| EMAIL-10  | Suivi 6 mois                                   | Batch J+180 fin de bilan                   | Bénéficiaire        | Domaine dédié ou Gmail |
| EMAIL-11  | Alerte consultant (formulaire/rendu en retard) | Délai dépassé                              | Consultant          | Gmail                  |
| EMAIL-12  | Alerte consultant (créneau non choisi)         | Bénéficiaire n'a pas confirmé sous X jours | Consultant          | Gmail                  |
| EMAIL-13  | Alerte consultant (annulation / décrochage)    | Annulation tardive ou seuil dépassé        | Consultant          | Gmail                  |
| EMAIL-14  | Envoi de ressources manuelles                  | Action manuelle du consultant              | Bénéficiaire        | Gmail ou domaine       |
| EMAIL-C01 | Bienvenue coaching                             | Création dossier coaching                  | Bénéficiaire        | Domaine dédié          |
| EMAIL-C02 | Suivi post-coaching                            | Batch 3 ou 6 mois post-clôture             | Bénéficiaire        | Domaine dédié ou Gmail |

## 12. Modèle de Données

| **Entité**         | **Description**                                                                                  | **Clé isolation**         | **Relations principales**                           |
|--------------------|--------------------------------------------------------------------------------------------------|---------------------------|-----------------------------------------------------|
| Tenant             | Cabinet consultant — unité d'isolation principale                                                | tenant_id                 | Consultants, TypeParcours, Templates, Bénéficiaires |
| Consultant         | Praticien du cabinet — appartient à un tenant                                                    | tenant_id + user_id       | Bilans, DisponibiliteRegles, CosmoCalendrier        |
| DisponibiliteRegle | Règle de disponibilité (récurrente ou ponctuelle, saisie MCP ou manuelle)                        | tenant_id + consultant_id | PlanningWorker                                      |
| Beneficiaire       | Client — emails multiples, situation, LinkedIn URL, métadonnées engagement                       | tenant_id + benef_id      | Parcours, Documents, FormReponses, EmailThreads     |
| MetaEngagement     | Métadonnées engagement : nb_modif_rdv, nb_annulations, delai_confirm, taux_ponctualite...        | parcours_id               | Bénéficiaire, Parcours                              |
| TypeParcours       | Définition réutilisable — graphe JSON nœuds, connexions, ressources, mode_planning, N_rdv_avance | tenant_id + type_id       | Noeud, Connexion, Ressources                        |
| Parcours           | Instance d'un TypeParcours pour un bénéficiaire                                                  | tenant_id + parcours_id   | Bénéficiaire, TypeParcours, NoeudsInstances         |
| NoeudInstance      | Nœud instancié — dates réelles, statut, données bénéficiaire                                     | parcours_id + noeud_id    | Parcours, Documents, FormReponses, RDV              |
| RDV                | Rendez-vous planifié — lié à nœud N5, stocké dans Cosmo CalDAV                                   | tenant_id + rdv_id        | NoeudInstance, Consultant, Bénéficiaire             |
| Document           | Document généré ou signé — PDF archivé horodaté                                                  | tenant_id + doc_id        | NoeudInstance, Signataires                          |
| FormReponse        | Réponses bénéficiaire à un formulaire (JSON chiffré AES-256)                                     | tenant_id + form_rep_id   | NoeudInstance, Bénéficiaire                         |
| Feedback360        | Réponse anonymisée d'un tiers — token unique                                                     | tenant_id + fb_id         | NoeudInstance                                       |
| Rapport360         | Consolidation anonymisée des feedbacks                                                           | tenant_id + rapport_id    | NoeudInstance, Feedback360 agrégés                  |
| EmailThread        | Thread email unifié (domaine dédié + Gmail)                                                      | tenant_id + thread_id     | Bénéficiaire, Consultant                            |
| TemplateDocument   | Template de document du tenant (hérité ou personnalisé)                                          | tenant_id + tpl_id        | TypeParcours, NoeudInstance                         |
| TemplateEmail      | Template email du tenant avec variables dynamiques                                               | tenant_id + email_tpl_id  | NoeudInstance (déclencheur)                         |

> *📝 RGPD : FormReponses et comptes-rendus chiffrés au repos (AES-256). Feedback360 anonymisés irréversiblement à la consolidation. Durée de conservation : 5 ans après clôture (obligation Qualiopi). Droit à l'effacement sur demande bénéficiaire.*

## 13. Règles Métier

| **\#** | **Règle**                             | **Détail**                                                                                                                                                                        | **Phase** |
|--------|---------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-----------|
| R1     | 3 phases obligatoires BC              | Tout bilan comporte préliminaire, investigation, conclusion (Code du travail Art. L6313-10). Le constructeur React Flow valide leur présence.                                     | Phase 1   |
| R2     | Synthèse finale — destinataire unique | La synthèse finale est remise au bénéficiaire uniquement — seul destinataire légal, sauf accord écrit explicite.                                                                  | Phase 2   |
| R3     | Suivi post-bilan 6 mois               | Entretien de suivi obligatoire dans les 6 mois (Qualiopi indicateur 15). Déclenché automatiquement par batch J+180.                                                               | Phase 1   |
| R4     | Consentement volontaire               | Le bénéficiaire signe son engagement volontaire (TPL-BC-01) avant tout démarrage.                                                                                                 | Phase 2   |
| R5     | Confidentialité comptes-rendus        | Notes consultant techniquement inaccessibles au bénéficiaire — contrôle d'accès au niveau de la donnée.                                                                           | Phase 1   |
| R6     | Délai adaptatif planning              | Le PlanningWorker filtre les créneaux proposés selon le delai_min_jours du nœud N5 suivant. Délai renforcé avant séance 6 (360°).                                                 | Phase 1   |
| R7     | Isolation tenant                      | Étanchéité totale — aucune donnée ne traverse les frontières de tenant, y compris pour LMVI.                                                                                      | Phase 1   |
| R8     | Anonymat 360°                         | Réponses individuelles anonymisées irréversiblement à la consolidation.                                                                                                           | Phase 1   |
| R9     | Financement CPF EDOF                  | Bilans CPF : déclaration entrée avant première séance, sorties et certificat à la clôture.                                                                                        | Phase 2   |
| R10    | Héritage bibliothèque par copie       | Un tenant ne modifie jamais les templates de la bibliothèque plateforme — il travaille sur une copie.                                                                             | Phase 1   |
| R11    | Tests psycho non obligatoires         | Les tests sont des ressources optionnelles — le consultant choisit lesquels utiliser et à quel moment.                                                                            | Phase 1   |
| R12    | Traçabilité Qualiopi                  | Toutes les actions (séances, signatures, docs générés, emails envoyés, RDV modifiés) sont horodatées et non modifiables.                                                          | Phase 2   |
| R13    | Métadonnées engagement                | nb_modifications_rdv et nb_annulations tracés automatiquement — non visibles du bénéficiaire.                                                                                     | Phase 1   |
| R14    | Validation parcours Qualiopi          | Le constructeur React Flow valide automatiquement, avant publication d’un TypeParcours : présence des 3 phases réglementaires, documents obligatoires attachés, aucun nœud isolé. | Phase 1   |

## 14. Intégrations Externes

| **Système**                                  | **Type**                                                                            | **Fréquence** | **Estimation** | **Phase** |
|----------------------------------------------|-------------------------------------------------------------------------------------|---------------|----------------|-----------|
| Cosmo CalDAV (TheSocle)                      | Backend calendrier — sync iPhone/Android consultant + invitations iCal bénéficiaire | Temps réel    | ~3h            | Phase 1   |
| API Jours Fériés (data.gouv.fr)              | Calcul automatique des ponts pour MCP planning                                      | Cache annuel  | ~1h            | Phase 1   |
| API Vacances Scolaires (Éducation Nationale) | Calcul automatique vacances par zone A/B/C pour MCP planning                        | Cache annuel  | ~1h            | Phase 1   |
| LinkedIn (profil public + export ZIP)        | Import données bénéficiaire                                                         | À la demande  | ~5h            | Phase 1   |
| TranscriptionWorker (DGX Spark)              | Transcription dictées post-séance (faster-whisper)                                  | À la demande  | Natif TheSocle | Phase 1   |
| InferenceWorker (DGX Spark)                  | Structuration IA CR, synthèse finale, interprétation MCP planning                   | À la demande  | Natif TheSocle | Phase 1   |
| React Flow (open source MIT)                 | Constructeur visuel de parcours drag & drop                                         | —             | ~4h intégr.    | Phase 1   |
| Tests psycho open source                     | RIASEC, Big Five IPIP-NEO, Schwartz, Drivers AT, Gardner, MBTI-like                 | —             | ~4h intégr.    | Phase 1   |
| Gmail (API Google OAuth2)                    | Lecture + envoi + sync threads par tenant                                           | Temps réel    | ~4h            | Phase 2   |
| Google Calendar (API Google)                 | Sync bidirectionnelle RDV (alternative ou complément à Cosmo)                       | Temps réel    | ~3h            | Phase 2   |
| James Worker (TheSocle)                      | Envoi emails domaine dédié, gestion DNS par tenant                                  | Événementiel  | ~2h            | Phase 2   |
| EDOF / Mon Compte Formation (API CDC)        | Déclaration entrées/sorties CPF, heures, certificats                                | Événementiel  | ~4h            | Phase 2   |

## 15. Fonctionnalités — Synthèse Complète

### 15.1 Phase 1 — Livraison pilote Marie Gallante (~42h)

| **\#** | **Fonctionnalité**                      | **Description détaillée**                                                                                                                                                                                                                    | **Composants TheSocle**                | **Estim.** |
|--------|-----------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|----------------------------------------|------------|
| F1     | Dossier bénéficiaire                    | Création depuis premier contact. Import CV multi-format (PDF, Word, photo OCR). Import LinkedIn (profil public + export ZIP). Gestion multi-adresses email. Type prestation + financement.                                                   | FileWorker, OCRWorker, LinkedInParser  | ~4h        |
| F2     | Tableau de bord consultant              | Vue synthétique tous bilans actifs : étape, prochaine séance, formulaires en attente, documents à signer, 360° en attente, métadonnées engagement. Filtrable par statut/type.                                                                | Dashboard UI, PlanningWorker           | ~5h        |
| F3     | Moteur de parcours + instanciation      | TypeParcours → Parcours instance. Instanciation avec données bénéficiaire. Gestion nœuds actifs, conditions, déclencheurs, délais adaptatifs.                                                                                                | ParcoursWorker, TechDB                 | ~6h        |
| F4     | Constructeur visuel React Flow          | Drag & drop 5 types nœuds. Panneau config par nœud (ressources, formulaires, délais, alertes, mode planning). Validation Qualiopi automatique.                                                                                               | React Flow, ParcoursWorker             | ~6h        |
| F5     | Module Planning complet                 | Disponibilités par MCP langage naturel (API jours fériés + vacances). Modes automatique/progressif N/manuel. Délais adaptatifs par nœud. Interface Calendly-like bénéficiaire. Sync CalDAV iPhone/Android via Cosmo. Métadonnées engagement. | PlanningWorker, Cosmo, InferenceWorker | ~8h        |
| F6     | Espace partagé bénéficiaire             | Ressources N1, dépôt documents N2, formulaires N3, messagerie, interface Calendly-like pour RDV, progression parcours. Responsive tablette + navigateur.                                                                                     | BeneficiaireWorker, StorageWorker      | ~4h        |
| F7     | Bibliothèque formulaires + constructeur | Migration FORM-STD-01 à 14 depuis Google Forms. Constructeur 8 types de champs. Activation automatique par nœud. Suivi complétion.                                                                                                           | FormWorker, TechDB                     | ~5h        |
| F8     | Tests psychologiques intégrés           | RIASEC, Big Five IPIP-NEO, Schwartz, Drivers AT, Gardner, MBTI-like. Scoring automatique. Rapports dans dossier. Optionnels — configurables par consultant.                                                                                  | TestWorker, InferenceWorker            | ~4h        |

### 15.2 Phase 2 — Complétion plateforme (~55h)

| **\#** | **Fonctionnalité**              | **Description**                                                                                                                                   | **Composants TheSocle**              | **Estim.** |
|--------|---------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------|--------------------------------------|------------|
| F9     | Application 360° Feedback       | Config par bénéficiaire. Invitations tiers (token unique). Relances auto. Consolidation anonymisée. Rapport consultant. Mode présentation séance. | 360Worker, MailWorker                | ~4h        |
| F10    | Comptes-rendus dictée + IA      | Dictée → TranscriptionWorker → structuration InferenceWorker selon trame nœud N5. Retravail consultant. Confidentiel.                             | TranscriptionWorker, InferenceWorker | ~4h        |
| F11    | Multi-tenant + TheSocleHub      | Isolation stricte. Gestionnaire TheSocleHub. 5 rôles. Actions MCP tenant_create/configure/stats.                                                  | TheSocleHub, Keycloak multi-realm    | ~5h        |
| F12    | Bibliothèque plateforme         | 8 TypeParcours défaut (6h-24h). 13 templates documents. Formulaires standards. Héritage par copie.                                                | LibraryWorker, TechDB                | ~3h        |
| F13    | Documents Qualiopi + signatures | Génération auto TPL-BC-01 à 12. Signature tablette présentiel. PDF horodaté. Archivage automatique.                                               | DocumentWorker, SignatureWorker      | ~6h        |
| F14    | Synthèse finale assistée IA     | Agrégation CR + résultats tests + notes consultant. IA propose structure. Dictée conclusion. Export Word + PDF signé.                             | InferenceWorker, DocumentWorker      | ~4h        |
| F15    | Intégration mail multi-canal    | James + Gmail OAuth2 + matching threads + catalogue EMAIL-01 à 16.                                                                                | James, MailWorker, GmailSync         | ~6h        |
| F16    | Sync Google Calendar            | Bidirectionnelle par consultant/tenant — alternative ou complément à Cosmo.                                                                       | GoogleCalendarWorker                 | ~3h        |
| F17    | Batch mensuel rappels           | Rappels, suivis 6 mois, formulaires en souffrance. Validation + envoi en un clic. Désactivable.                                                   | SchedulerWorker, MailWorker          | ~3h        |
| F18    | Remontée EDOF automatique       | API Mon Compte Formation — entrées, heures, sorties, certificats.                                                                                 | EDOFWorker, API CDC                  | ~4h        |
| F19    | Gestion documentaire avancée    | Templates paramétrables par tenant. Variantes de trames. Injection variables dynamiques.                                                          | DocumentWorker, TemplateEngine       | ~3h        |
| F20    | Tests psycho avancés            | Potentialis® numérique (partenariat Mm2i), MBTI officiel (si licence).                                                                            | TestWorker, PartnerAPI               | ~6h        |
| F21    | Statistiques cabinet            | Taux satisfaction, profils, délais moyens, NPS, métadonnées engagement agrégées.                                                                  | AnalyticsWorker                      | ~4h        |

### 15.3 Phase 3 — Évolutions (~41h)

| **\#** | **Fonctionnalité**             | **Description**                                                                | **Priorité** | **Estim.** |
|--------|--------------------------------|--------------------------------------------------------------------------------|--------------|------------|
| E1     | App mobile Expo (React Native) | Packaging application web responsive en app native iOS/Android via Expo        | Haute        | ~15h       |
| E2     | Vision Board numérique         | Outil de collage d'images symboliques pour l'exercice de projection (séance 7) | Moyenne      | ~5h        |
| E3     | Marketplace de parcours        | Les cabinets partagent leurs TypeParcours dans une communauté BilanSocle       | Faible       | ~10h       |
| E4     | Facturation tenants            | Intégration Stripe, plans d'abonnement, facturation automatique                | Phase 4      | ~8h        |
| E5     | Notifications push mobile      | Alertes temps réel rappels RDV et formulaires via app Expo                     | Phase 4      | ~3h        |

## 16. Accélérateurs Infrastructure TheSocle V005

| **Besoin**                                                | **Couvert par TheSocle V005**                            | **Gain estimé** |
|-----------------------------------------------------------|----------------------------------------------------------|-----------------|
| Auth multi-tenant + rôles (5 niveaux)                     | JWT + Keycloak — multi-realm natif (1 realm = 1 tenant)  | ~8h éco.        |
| Backend calendrier + sync iPhone/Android (Cosmo)          | Cosmo CalDAV Worker natif — comme James pour les mails   | ~6h éco.        |
| Interprétation MCP langage naturel planning               | InferenceWorker + outil MCP exposé par PlanningWorker    | ~4h éco.        |
| API jours fériés + vacances scolaires (cache)             | TechDB + SchedulerWorker pour mise à jour annuelle       | ~2h éco.        |
| Isolation données par tenant                              | Row-level security PostgreSQL + filtrage tenant_id natif | ~5h éco.        |
| Stockage fichiers (CV, PDF, documents signés)             | Stockage S3-compatible natif                             | ~4h éco.        |
| Envoi emails domaine dédié par tenant                     | James Worker + MailWorker — multi-domaine                | ~4h éco.        |
| Tâches planifiées (batch rappels, relances, suivi 6 mois) | Scheduler natif TheSocle                                 | ~3h éco.        |
| Transcription vocale (dictée comptes-rendus)              | TranscriptionWorker (faster-whisper / DGX Spark)         | ~3h éco.        |
| Traitement IA (structuration CR, synthèse, MCP planning)  | InferenceWorker → DGX Spark / LLM routing                | ~5h éco.        |
| Gestionnaire de tenants                                   | TheSocleHub existant — actions MCP dédiées               | ~4h éco.        |
| Sécurité (HTTPS, rate limiting, audit trail, chiffrement) | Infrastructure TheSocle native                           | ~4h éco.        |

**Total économisé grâce à l'infrastructure TheSocle V005 : ~52h**

## 17. Synthèse Budgétaire

### Vue d'ensemble

| **Phase**               | **Contenu**                                                                                                                                                      | **Heures** | **Livrable**                                       |
|-------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------|------------|----------------------------------------------------|
| Phase 1                 | Livraison pilote Marie Gallante — moteur parcours, planning complet Cosmo+Calendly-like+MCP, constructeur React Flow, formulaires, tests psycho, espace bénéficiaire | ~42h       | Plateforme opérationnelle pour 1 tenant pilote     |
| Phase 2                 | Complétion — 360°, IA dictée, multi-tenant, Qualiopi, EDOF, mail multi-canal, statistiques                                                                       | ~55h       | Plateforme commercialisable multi-tenants          |
| Phase 3                 | Évolutions — app mobile, marketplace, facturation                                                                                                                | ~41h       | Plateforme SaaS complète                           |
| TOTAL                   | Plateforme BilanSocle complète                                                                                                                                   | ~138h      | Produit SaaS multi-cabinets Qualiopi               |
| Économies TheSocle V005 | Cosmo, James, InferenceWorker, TranscriptionWorker, auth, storage, scheduler, audit                                                                              | ~52h éco.  | Vs développement from scratch (~30% du coût total) |

### Phase 1 — Détail (~42h)

| **Poste**                                                                                                                        | **Heures** |
|----------------------------------------------------------------------------------------------------------------------------------|------------|
| F1 — Dossier bénéficiaire + import LinkedIn/CV                                                                                   | ~4h        |
| F2 — Tableau de bord consultant                                                                                                  | ~5h        |
| F3 — Moteur de parcours + instanciation                                                                                          | ~6h        |
| F4 — Constructeur visuel React Flow                                                                                              | ~6h        |
| F5 — Module Planning complet (Cosmo + CalDAV + MCP langage naturel + Calendly-like + délais adaptatifs + métadonnées engagement) | ~8h        |
| F6 — Espace partagé bénéficiaire                                                                                                 | ~4h        |
| F7 — Bibliothèque formulaires + constructeur (migration Google Forms)                                                            | ~5h        |
| F8 — Tests psychologiques intégrés (RIASEC, Big Five, Drivers...)                                                                | ~4h        |
| TOTAL Phase 1                                                                                                                    | ~42h       |

> *📝 Le module Planning (F5, 8h) est le plus complexe de la Phase 1. Il inclut : Cosmo CalDAV Worker, interface Calendly-like bénéficiaire, outil MCP langage naturel (API jours fériés + vacances scolaires), 3 modes de planification, délais adaptatifs par nœud, et métadonnées d'engagement. C'est l'élément le plus différenciant de BilanSocle par rapport à un Google Drive.*

### Recommandation Finale

BilanSocle v5 est une plateforme architecturalement cohérente et
différenciante. Les quatre décisions structurantes — multi-tenant isolé,
moteur de parcours générique, planning intelligent Cosmo CalDAV,
constructeur visuel React Flow — sont les bonnes pour construire un
produit commercialisable auprès de Sandra, Béatrice et l'ensemble des
cabinets Qualiopi français.

La Phase 1 (~42h) avec Marie Gallante comme tenant pilote valide
l'architecture complète et livre un outil opérationnel qui transforme
immédiatement son quotidien. Le planning en particulier est le composant
le plus visible — c'est l'élément qui remplace Google Drive, l'échange
d'emails de créneaux et les rappels manuels en une seule interface
fluide.

L'infrastructure TheSocle V005 économise ~52h sur l'ensemble du projet
(~30% du coût total). Cosmo pour le calendrier (comme James pour les
mails) est une décision d'architecture qui offre une synchronisation
CalDAV native sur tous les appareils sans dépendance à Google Calendar.

> *📝 Ce document constitue la base de travail pour la phase de spécification technique (~5-8h). Prochaines étapes : (1) validation du modèle de données TechDB avec l'équipe technique, (2) spécification détaillée du PlanningWorker (nouveau worker TheSocle dédié), (3) maquettes de l'interface Calendly-like et du constructeur React Flow. Co-construit avec l'assistance d'une IA, calibré sur la pratique réelle de Marie Gallante et l'architecture TheSocle V005.*