-- ============================================================================
-- STANDARD THESOCLE — fonctions triggers + helper attach_thesocle_triggers
-- Réutilisable : remplacer "schema_regies" par le schéma de ton app.
-- Extrait de l'init.sql de Régie (VALIDÉ sur PG16/17). Voir specsTablesPgsql.md.
-- Chaque table appelle ensuite : SELECT <schema>.attach_thesocle_triggers('<table>');
-- ============================================================================
CREATE OR REPLACE FUNCTION schema_regies.update_changed_fields()
RETURNS TRIGGER AS $$
BEGIN
    NEW.x_dateChanged := NOW();
    NEW.x_version := COALESCE(OLD.x_version, 0) + 1;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Audit AFTER INSERT : x_comment = [{x_id, x_date, action:INSERT, datas}]
CREATE OR REPLACE FUNCTION schema_regies.z_after_insert()
RETURNS TRIGGER AS $$
DECLARE
    payload jsonb;
    schema_name text := TG_TABLE_SCHEMA;
    table_name  text := TG_TABLE_NAME;
BEGIN
    SELECT jsonb_object_agg(k, v)
      INTO payload
      FROM jsonb_each(to_jsonb(NEW)) AS t(k, v)
     WHERE NOT (k LIKE 'x\_%' ESCAPE '\') AND k <> 'datas';

    EXECUTE format(
        'UPDATE %I.%I SET x_comment = jsonb_build_array(jsonb_build_object(
            ''x_id'', $1, ''x_date'', $2, ''action'', ''INSERT'', ''datas'', $3
        )) WHERE x_id = $1',
        schema_name, table_name)
    USING NEW.x_id, NEW.x_dateCreated, COALESCE(payload, '{}'::jsonb);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Audit AFTER UPDATE : préfixe x_comment avec un objet UPDATE des champs modifiés
-- (ignore préfixés x_, datas, x_sub)
CREATE OR REPLACE FUNCTION schema_regies.z_after_update()
RETURNS TRIGGER AS $$
DECLARE
    diff jsonb := '{}'::jsonb;
    old_j jsonb := to_jsonb(OLD);
    new_j jsonb := to_jsonb(NEW);
    schema_name text := TG_TABLE_SCHEMA;
    table_name  text := TG_TABLE_NAME;
    k text;
    new_entry jsonb;
    existing  jsonb;
BEGIN
    FOR k IN SELECT jsonb_object_keys(new_j)
    LOOP
        CONTINUE WHEN k LIKE 'x\_%' ESCAPE '\' OR k = 'datas' OR k = 'x_sub';
        IF (old_j->k) IS DISTINCT FROM (new_j->k) THEN
            diff := diff || jsonb_build_object(k, new_j->k);
        END IF;
    END LOOP;
    IF diff = '{}'::jsonb THEN RETURN NEW; END IF;
    new_entry := jsonb_build_object(
        'x_id', NEW.x_id, 'x_date', NEW.x_dateChanged,
        'action', 'UPDATE', 'datas', diff);
    existing := COALESCE(NEW.x_comment, '[]'::jsonb);
    EXECUTE format(
        'UPDATE %I.%I SET x_comment = $1 WHERE x_id = $2',
        schema_name, table_name)
    USING (jsonb_build_array(new_entry) || existing), NEW.x_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION schema_regies.z_after_delete()
RETURNS TRIGGER AS $$
BEGIN
    RETURN OLD;  -- extension future : journal externe
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- Helper : attache les 4 triggers standard THESOCLE à une table du schéma.
--   3 triggers d'audit AFTER (DISABLE par défaut) + update_changed_fields BEFORE.
--   DRY : même comportement que l'écriture explicite, sans répétition.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION schema_regies.attach_thesocle_triggers(p_table text)
RETURNS void AS $$
BEGIN
    EXECUTE format('DROP TRIGGER IF EXISTS after_insert_audit_%1$s ON schema_regies.%1$I', p_table);
    EXECUTE format('CREATE TRIGGER after_insert_audit_%1$s AFTER INSERT ON schema_regies.%1$I
                    FOR EACH ROW EXECUTE FUNCTION schema_regies.z_after_insert()', p_table);
    EXECUTE format('ALTER TABLE schema_regies.%1$I DISABLE TRIGGER after_insert_audit_%1$s', p_table);

    EXECUTE format('DROP TRIGGER IF EXISTS after_update_audit_%1$s ON schema_regies.%1$I', p_table);
    EXECUTE format('CREATE TRIGGER after_update_audit_%1$s AFTER UPDATE ON schema_regies.%1$I
                    FOR EACH ROW EXECUTE FUNCTION schema_regies.z_after_update()', p_table);
    EXECUTE format('ALTER TABLE schema_regies.%1$I DISABLE TRIGGER after_update_audit_%1$s', p_table);

    EXECUTE format('DROP TRIGGER IF EXISTS after_delete_audit_%1$s ON schema_regies.%1$I', p_table);
    EXECUTE format('CREATE TRIGGER after_delete_audit_%1$s AFTER DELETE ON schema_regies.%1$I
                    FOR EACH ROW EXECUTE FUNCTION schema_regies.z_after_delete()', p_table);
    EXECUTE format('ALTER TABLE schema_regies.%1$I DISABLE TRIGGER after_delete_audit_%1$s', p_table);

    EXECUTE format('DROP TRIGGER IF EXISTS after_update_%1$s ON schema_regies.%1$I', p_table);
    EXECUTE format('CREATE TRIGGER after_update_%1$s BEFORE UPDATE ON schema_regies.%1$I
                    FOR EACH ROW EXECUTE FUNCTION schema_regies.update_changed_fields()', p_table);
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 2. TABLES MÉTIER
--    Ordre = respect des dépendances FK (tables référencées d'abord).

-- ---- GABARIT d'une table (13 colonnes x_* + séquence + index + triggers) ----
CREATE SEQUENCE IF NOT EXISTS schema_regies.seq_db_projet_x_id START 1 INCREMENT 1;
CREATE TABLE IF NOT EXISTS schema_regies.db_projet (
    x_id           BIGINT PRIMARY KEY DEFAULT nextval('schema_regies.seq_db_projet_x_id'),
    x_dateCreated  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    x_dateChanged  TIMESTAMPTZ,
    x_sub          VARCHAR(255),
    x_partition    VARCHAR(30),
    x_version      BIGINT DEFAULT 0,
    x_active       BOOLEAN DEFAULT TRUE,
    x_createdBy    VARCHAR(255),
    x_updatedBy    VARCHAR(255),
    x_comment      JSONB,
    x_keyhash      VARCHAR(32),
    x_hash         VARCHAR(32),
    x_datas        JSONB,
    code           VARCHAR(60)  NOT NULL,   -- slug projet (unique par tenant)
    titre          VARCHAR(255) NOT NULL,
    description    TEXT,
    id_intro_defaut       BIGINT,           -- → db_biblio_element (FK différée)
    id_conclusion_defaut  BIGINT,           -- → db_biblio_element (FK différée)
    fuseau         VARCHAR(50) DEFAULT 'Europe/Paris',
    datas          JSONB
);
CREATE UNIQUE INDEX IF NOT EXISTS uidx_db_projet_code ON schema_regies.db_projet (x_partition, code) WHERE x_active;
SELECT schema_regies.attach_thesocle_triggers('db_projet');
