-- Migration pour créer la table d'archive légale des consentements
-- Cette table conserve les preuves de consentement pour protection juridique

CREATE TABLE legal_consent_archive (
    id SERIAL PRIMARY KEY,
    original_user_id VARCHAR(255) NOT NULL,
    consented_at TIMESTAMP NULL,
    consent_version VARCHAR(50) NULL,
    consent_ip_hash VARCHAR(64) NULL, -- Hash anonymisé de l'IP originale
    deleted_at TIMESTAMP NOT NULL,
    archived_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- Index pour retrouver rapidement en cas de litige
    INDEX idx_original_user_id (original_user_id),
    INDEX idx_consented_at (consented_at),
    INDEX idx_archived_at (archived_at),

    -- Contrainte d'unicité pour éviter les doublons
    UNIQUE KEY unique_archive (original_user_id, deleted_at)
);

-- Commentaires pour documentation juridique
ALTER TABLE legal_consent_archive
COMMENT = 'Archive légale des consentements utilisateurs pour protection juridique en cas de litige. Conservation 10 ans minimum.';

ALTER TABLE legal_consent_archive
MODIFY COLUMN original_user_id VARCHAR(255) COMMENT 'ID original de l utilisateur avant anonymisation',
MODIFY COLUMN consented_at TIMESTAMP COMMENT 'Date exacte du consentement aux conditions',
MODIFY COLUMN consent_version VARCHAR(50) COMMENT 'Version des conditions acceptées',
MODIFY COLUMN consent_ip_hash VARCHAR(64) COMMENT 'Hash anonymisé de l IP lors du consentement',
MODIFY COLUMN deleted_at TIMESTAMP COMMENT 'Date de suppression du compte utilisateur',
MODIFY COLUMN archived_at TIMESTAMP COMMENT 'Date d archivage des preuves légales';