export const placementLogoMigration = `
ALTER TABLE placement_resources ADD COLUMN IF NOT EXISTS logo_id uuid REFERENCES company_logos(id);
INSERT INTO migrations(id) VALUES ('024-shared-placement-logos') ON CONFLICT DO NOTHING;
`;
