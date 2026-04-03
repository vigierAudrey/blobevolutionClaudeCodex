-- Contrainte d'invariant capacité : bookedCount ne peut dépasser capacity.
-- Complète la contrainte initiale (capacity > 0 AND bookedCount >= 0) déjà présente
-- dans 20250918_booking_module. Appliquée directement en DB (db push), reconstituée
-- pour la chaîne de migration (fresh DB deploy).
ALTER TABLE "ProAvailability"
  ADD CONSTRAINT "ProAvailability_bookedCount_lte_capacity_check"
  CHECK ("bookedCount" <= capacity);
